// NovaFlow Worker Gateway.
//
// The only surface a browser may reach on a compute node (spec 9). ComfyUI
// itself stays bound to 127.0.0.1 and is never proxied wholesale - the gateway
// serves task files and nothing else.
//
//   Internet -> Gateway -> grant check -> task scoping -> data/tasks/<id>/...
//
// Every request must carry a nfg_ grant minted by the control plane and signed
// with THIS worker's derived key. The grant names the task, the worker and the
// operation, so a token for one task cannot read another, and a token for a
// different worker will not verify here at all.
//
// Video is served with HTTP Range support so an MP4 starts playing while it
// downloads (spec 12).

import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, lstat, mkdir, readdir, rm, rmdir, open, link } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join, resolve, extname, sep, dirname } from 'node:path';
import { verifyGrantToken } from '../../../packages/shared/src/tokens.mjs';
import { GRANT_OP, isSafeFilename } from '../../../packages/shared/src/protocol.mjs';
import { inspectWorkerUpload, uploadByteCap } from '../../../packages/shared/src/xiaotao-upload-guard.mjs';
import { CANDIDATE_TASKS_ROOT, candidateTaskIdState, candidateTaskDirectory } from './candidate-task-path.mjs';

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.json': 'application/json'
};

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const QWEN_FOART_PLAN_SCOPE = 'qwen-foart-plan-v1';
const QWEN_FOART_PLAN_PREFIX = 'qwen-foart-plan-';
const QWEN_FOART_PLAN_REQUEST = 'qwen-foart-plan-request.json';
const QWEN_FOART_PLAN_MAX_BYTES = 262144;
const QWEN_IMAGE_EDIT_SCOPE = 'qwen21-local-image-edit-v1';
const QWEN_IMAGE_EDIT_PREFIX = 'qwen21-local-image-edit-';
const QWEN_IMAGE_EDIT_MAX_BYTES = 16 * 1024 * 1024;

// Reserve the entire name prefix, including Windows case/trailing-dot aliases.
// The verifier and the signed grant, not a client header, decide authority.
function qwenFoartPlanPath(name, kind, method) {
  const folded = name.toLowerCase().replace(/\.+$/, '');
  const imageEdit=folded.startsWith(QWEN_IMAGE_EDIT_PREFIX);
  if (!imageEdit && !folded.startsWith(QWEN_FOART_PLAN_PREFIX)) return null;
  if (name !== folded) return { invalid: true };
  const scope=imageEdit?QWEN_IMAGE_EDIT_SCOPE:QWEN_FOART_PLAN_SCOPE;
  if (kind === 'input' && name === (imageEdit?'qwen21-local-image-edit-request.json':QWEN_FOART_PLAN_REQUEST) && ['PUT', 'POST'].includes(method))
    return { op: GRANT_OP.UPLOAD,scope,maxBytes:imageEdit?QWEN_IMAGE_EDIT_MAX_BYTES:QWEN_FOART_PLAN_MAX_BYTES };
  const result = (imageEdit?/^qwen21-local-image-edit-result-([1-9]|1[0-9]|20)\.json$/:/^qwen-foart-plan-result-([1-9]|1[0-9]|20)\.json$/).exec(name);
  if (kind === 'output' && result && ['GET', 'HEAD'].includes(method))
    return { op: GRANT_OP.DOWNLOAD, scope,attempt: Number(result[1]) };
  return { invalid: true };
}

function contentTypeFor(name) {
  return CONTENT_TYPES[extname(String(name)).toLowerCase()] || 'application/octet-stream';
}

function corsHeaders(origin) {
  return {
    // A grant is the authorisation, not the origin, so any page the user has
    // open may fetch with one. We never set credentials:true, so no cookie or
    // ambient credential rides along.
    'access-control-allow-origin': origin || '*',
    'access-control-allow-headers': 'content-type, x-novaflow-grant, x-novaflow-upload-slot, x-novaflow-candidate-proof, range',
    'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
    'access-control-expose-headers': 'content-range, accept-ranges, content-length, x-novaflow-task',
    // Chrome's Private Network Access check. The site is on a public https
    // origin and this gateway is on the viewer's own machine, so without this
    // the browser refuses the request before it is sent - and the only symptom
    // is "Failed to fetch" with no explanation. It is not a relaxation of
    // anything: a grant is still required, and it is what actually authorises.
    'access-control-allow-private-network': 'true'
  };
}

export function createGateway({ workerId, dataDir, getGrantKey, onUpload, logger, verifyCandidateAccess,
  verifyQwenFoartPlanAccess, candidateVerificationTimeoutMs = 8000 }) {
  const log = logger || (() => {});
  if(!Number.isSafeInteger(candidateVerificationTimeoutMs)||candidateVerificationTimeoutMs<10||candidateVerificationTimeoutMs>20000)
    throw new RangeError('Invalid candidate verification timeout');

  function taskDir(taskId, kind) {
    // taskId is validated as a uuid before this is ever called, so no path
    // component here can come from user input unchecked.
    return join(dataDir, 'tasks', taskId, kind);
  }

  async function readGrant(req, url, expect) {
    const token = String(
      req.headers['x-novaflow-grant'] || url.searchParams.get('grant') || ''
    ).trim();
    if (!token) throw Object.assign(new Error('missing grant'), { status: 401 });
    const grantKey = await getGrantKey();
    if (!grantKey) throw Object.assign(new Error('worker is not registered'), { status: 503 });
    try {
      return await verifyGrantToken(token, grantKey, { ...expect, workerId });
    } catch (error) {
      const expired = /expired/i.test(String(error?.message || ''));
      throw Object.assign(new Error(String(error?.message || 'invalid grant')), {
        status: expired ? 401 : 403
      });
    }
  }

  // The worker-held grant key is not sufficient for this scope. The optional
  // callback must contact the authoritative service and validate independent
  // session-bound proof; no current production caller supplies it.
  async function candidateAccess(req,taskId,op,grant,phase,content) {
    if(typeof verifyCandidateAccess!=='function')throw Object.assign(new Error('candidate verification unavailable'),{status:503});
    const proof=String(req.headers['x-novaflow-candidate-proof']||'');
    if(!proof||proof.length>8192)throw Object.assign(new Error('candidate proof required'),{status:403});
    const controller=new AbortController(),socket=req.socket;
    const onClose=()=>controller.abort();
    const timer=setTimeout(()=>controller.abort(),candidateVerificationTimeoutMs);
    let onAbort;
    const cancelled=new Promise((_,reject)=>{
      onAbort=()=>reject(new Error('candidate verification cancelled'));
      controller.signal.addEventListener('abort',onAbort,{once:true});
    });
    // The socket may already be closed before Promise.race is installed.
    // Mark this promise handled even if the preflight check returns early.
    void cancelled.catch(()=>{});
    if(!socket||socket.destroyed||req.aborted)controller.abort();else socket.once('close',onClose);
    let result;
    try {
      if(controller.signal.aborted)throw new Error('candidate verification cancelled');
      result=await Promise.race([Promise.resolve().then(()=>verifyCandidateAccess({taskId,workerId,op,phase,proof,
        ...(phase==='finish' && op===GRANT_OP.UPLOAD ? {sha256:content?.sha256,bytes:content?.bytes} : {}),
        untrustedGrantUser:grant.sub,signal:controller.signal})),cancelled]);
      if(controller.signal.aborted||socket.destroyed)throw new Error('candidate verification cancelled');
    } catch(error) {
      const denied=!controller.signal.aborted && !socket?.destroyed && [401,403].includes(error?.status);
      throw Object.assign(new Error(denied?'candidate verification denied':'candidate verification unavailable'),{status:denied?403:503});
    }
    finally {
      clearTimeout(timer);socket?.removeListener('close',onClose);
      controller.signal.removeEventListener('abort',onAbort);controller.abort();
    }
    if(!result||result.authorized!==true||result.taskId!==taskId||result.workerId!==workerId||result.op!==op||
      result.userId!==grant.sub||result.scope!=='qwen-foart-rotation-candidate-v1'||
      !Number.isSafeInteger(result.attempt)||result.attempt<1||typeof result.sessionId!=='string'||!result.sessionId)
      throw Object.assign(new Error('candidate verification denied'),{status:403});
    if(phase==='finish' && op===GRANT_OP.UPLOAD){
      if(!content || !/^[a-f0-9]{64}$/.test(content.sha256) || !Number.isSafeInteger(content.bytes) || content.bytes<1)
        throw Object.assign(new Error('candidate content verification unavailable'),{status:503});
      // An ordinary authorization response or a simple echo is not evidence
      // that the server checked an immutable digest/length binding.
      if(!Object.hasOwn(result,'digestBound') || !Object.hasOwn(result,'sha256') || !Object.hasOwn(result,'bytes'))
        throw Object.assign(new Error('candidate content verification unavailable'),{status:503});
      if(result.digestBound!==true || result.sha256!==content.sha256 || result.bytes!==content.bytes)
        throw Object.assign(new Error('candidate content verification denied'),{status:403});
    }
    return result;
  }

  // The scoped nfg_ grant is necessary but not sufficient: the registered
  // node must consult the control plane, which derives actor/session from the
  // server-owned task, checks node ownership, task status and attempt, and
  // checks the pre-committed input digest before publication.
  async function qwenFoartPlanAccess(req,taskId,op,grant,phase,attempt,content) {
    if(typeof verifyQwenFoartPlanAccess!=='function')
      throw Object.assign(new Error('plan verification unavailable'),{status:503});
    const controller=new AbortController(),socket=req.socket;
    const onClose=()=>controller.abort();
    const timer=setTimeout(()=>controller.abort(),candidateVerificationTimeoutMs);
    let onAbort;
    const cancelled=new Promise((_,reject)=>{
      onAbort=()=>reject(new Error('plan verification cancelled'));
      controller.signal.addEventListener('abort',onAbort,{once:true});
    });
    void cancelled.catch(()=>{});
    if(!socket||socket.destroyed||req.aborted)controller.abort();else socket.once('close',onClose);
    let result;
    try {
      if(controller.signal.aborted)throw new Error('plan verification cancelled');
      result=await Promise.race([Promise.resolve().then(()=>verifyQwenFoartPlanAccess({taskId,workerId,op,phase,
        ...(attempt===undefined ? {} : {attempt}),
        ...(phase==='finish' && op===GRANT_OP.UPLOAD ? {sha256:content?.sha256,bytes:content?.bytes} : {}),
        scope:grant.scope,untrustedGrantUser:grant.sub,signal:controller.signal})),cancelled]);
      if(controller.signal.aborted||socket.destroyed)throw new Error('plan verification cancelled');
    } catch(error) {
      const denied=!controller.signal.aborted && !socket?.destroyed && [401,403].includes(error?.status);
      throw Object.assign(new Error(denied?'plan verification denied':'plan verification unavailable'),{status:denied?403:503});
    } finally {
      clearTimeout(timer);socket?.removeListener('close',onClose);
      controller.signal.removeEventListener('abort',onAbort);controller.abort();
    }
    if(!result||result.authorized!==true||result.taskId!==taskId||result.workerId!==workerId||result.op!==op||
      result.userId!==grant.sub||result.scope!==grant.scope||
      !Number.isSafeInteger(result.attempt)||result.attempt<1||result.attempt>20||
      (attempt!==undefined&&result.attempt!==attempt)||typeof result.sessionId!=='string'||!result.sessionId)
      throw Object.assign(new Error('plan verification denied'),{status:403});
    if(phase==='finish'&&op===GRANT_OP.UPLOAD){
      if(!content||!/^[a-f0-9]{64}$/.test(content.sha256)||!Number.isSafeInteger(content.bytes)||content.bytes<1)
        throw Object.assign(new Error('plan content verification unavailable'),{status:503});
      if(result.digestBound!==true||result.sha256!==content.sha256||result.bytes!==content.bytes)
        throw Object.assign(new Error('plan content verification denied'),{status:403});
    }
    return result;
  }

  async function serveFile(req, res, filePath, { download = false } = {}) {
    let info;
    try {
      info = await stat(filePath);
    } catch {
      res.writeHead(404, { 'content-type': 'application/json', ...corsHeaders(req.headers.origin) });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }

    const type = contentTypeFor(filePath);
    const base = {
      'content-type': type,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=60',
      ...corsHeaders(req.headers.origin)
    };
    if (download) base['content-disposition'] = 'attachment; filename="' + filePath.split(/[\\/]/).pop() + '"';

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
      if (m) {
        let start = m[1] === '' ? null : Number(m[1]);
        let end = m[2] === '' ? null : Number(m[2]);
        if (start === null && end !== null) {
          // suffix range: last N bytes
          start = Math.max(0, info.size - end);
          end = info.size - 1;
        } else {
          start = start ?? 0;
          end = end === null ? info.size - 1 : Math.min(end, info.size - 1);
        }
        if (start > end || start >= info.size) {
          res.writeHead(416, { 'content-range': 'bytes */' + info.size, ...corsHeaders(req.headers.origin) });
          res.end();
          return;
        }
        res.writeHead(206, {
          ...base,
          'content-range': 'bytes ' + start + '-' + end + '/' + info.size,
          'content-length': String(end - start + 1)
        });
        if (req.method === 'HEAD') { res.end(); return; }
        createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
    }

    res.writeHead(200, { ...base, 'content-length': String(info.size) });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(filePath).pipe(res);
  }

  // Count bytes as they arrive and stop at the cap. The file is removed unless
  // the whole body lands under the cap, so a rejected upload leaves nothing behind.
  async function streamUpload(req, filePath, maxBytes, tooBigMessage) {
    await mkdir(dirname(filePath), { recursive: true });
    const out = createWriteStream(filePath);
    const head = Buffer.alloc(64);
    let headLen = 0;
    let total = 0;
    let oversize = false;
    const drop = async () => {
      out.destroy();
      await rm(filePath, { force: true });
    };
    try {
      // Breaking a request's default async iterator destroys its socket. Keep
      // it alive until the 413 response has been written to the client.
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > maxBytes) {
          oversize = true;
          break;
        }
        if (headLen < head.length) {
          const n = Math.min(head.length - headLen, buf.length);
          buf.copy(head, headLen, 0, n);
          headLen += n;
        }
        if (!out.write(buf)) await once(out, 'drain');
      }
    } catch (error) {
      await drop();
      throw error;
    }
    await new Promise((resolve) => out.end(resolve));
    if (oversize || total <= 0) {
      await drop();
      const message = oversize ? tooBigMessage : '是空文件';
      throw Object.assign(new Error(message), { status: oversize ? 413 : 400, close: oversize });
    }
    return { total, head: head.subarray(0, headLen) };
  }

  // Candidate inputs remain invisible to waitForInputs until verified, fully
  // written and published with link(), which fails rather than replacing an
  // existing final file on both Windows and POSIX.
  async function streamCandidateUpload(req,dir,filePath,maxBytes,tooBigMessage,verifyAgain,
    protectedRoot=join(dataDir,CANDIDATE_TASKS_ROOT)) {
    // Do not follow a pre-existing junction/symlink into another task tree.
    const root=protectedRoot,task=dirname(dir);
    for(const part of [root,task,dir]){
      try{await mkdir(part);}catch(error){if(error?.code!=='EEXIST')throw error;}
      const info=await lstat(part);
      if(info.isSymbolicLink()||!info.isDirectory())throw Object.assign(new Error('candidate directory unavailable'),{status:503});
    }
    const tmp=join(dir,`.${randomUUID()}.upload`);
    let handle,created=false;
    try {
      handle=await open(tmp,'wx',0o600);created=true;
      const head=Buffer.alloc(64),hash=createHash('sha256');let headLen=0,total=0;
      for await (const chunk of req.iterator({destroyOnReturn:false})) {
        const buf=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=buf.length;
        if(total>maxBytes)throw Object.assign(new Error(tooBigMessage),{status:413,close:true});
        if(headLen<head.length){const n=Math.min(head.length-headLen,buf.length);buf.copy(head,headLen,0,n);headLen+=n;}
        hash.update(buf);await handle.writeFile(buf);
      }
      if(!req.complete||req.aborted||req.socket?.destroyed)throw Object.assign(new Error('candidate upload interrupted'),{status:400});
      if(total<=0)throw Object.assign(new Error('empty candidate file'),{status:400});
      await handle.close();handle=null;
      const sha256=hash.digest('hex');
      await verifyAgain({total,sha256,head:head.subarray(0,headLen)});
      if(req.aborted||req.socket?.destroyed||!req.complete)throw Object.assign(new Error('candidate upload interrupted'),{status:400});
      try {await link(tmp,filePath);} catch(error) {
        throw Object.assign(new Error(error?.code==='EEXIST'?'candidate input already exists':'candidate atomic publication unavailable'),{status:error?.code==='EEXIST'?409:503});
      }
      return {total,head:head.subarray(0,headLen)};
    } finally {
      if(handle)await handle.close().catch(()=>{});
      if(created)await rm(tmp,{force:true}).catch(()=>{});
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const fail = (status, message, close) => {
      const payload = Buffer.from(JSON.stringify({ ok: false, error: message }));
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': payload.length, connection: close ? 'close' : 'keep-alive', ...corsHeaders(req.headers.origin) });
      if (close && !req.readableEnded) {
        // Deliver the complete error now, then drain only long enough to close
        // gracefully. Closing a Windows socket with unread upload bytes resets
        // it and hides the 413 from fetch. No more bytes are written to disk.
        res.write(payload);
        const finish = () => { clearTimeout(timeout); res.end(); };
        const timeout = setTimeout(finish, 3000);
        timeout.unref();
        req.once('end', finish);
        req.once('error', finish);
        req.resume();
      } else res.end(payload);
    };

    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(req.headers.origin));
        res.end();
        return;
      }

      if (url.pathname === '/gw/health') {
        res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders(req.headers.origin) });
        res.end(JSON.stringify({ ok: true, service: 'novaflow-worker-gateway', workerId }));
        return;
      }

      // Is this request arriving from outside this machine?
      //
      // The gateway is reachable two ways: on 127.0.0.1 by a browser running
      // on this machine, and through a Cloudflare tunnel by anyone. A tunnel
      // forwards whatever method it is handed - a PUT through one arrives at
      // the origin exactly like a GET - so the restriction has to live here.
      //
      // From outside: read only, and the warehouse only. Nobody gets to put a
      // file on this disk or read anything but a finished result. The owner's
      // own browser reaches 127.0.0.1 and keeps the full gateway.
      // Measured against a real quick tunnel: cloudflared keeps the original
      // Host and adds cf-connecting-ip / cdn-loop. Cloudflare routes by Host,
      // so a client cannot reach this tunnel while pretending to be local, and
      // the cf headers arrive whatever the client sends. A request from the
      // owner's own browser carries none of the three.
      const hostHeader = String(req.headers.host || '').toLowerCase();
      const fromOutside = Boolean(req.headers['cf-connecting-ip'])
        || Boolean(req.headers['cdn-loop'])
        || !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(hostHeader);

      const m = /^\/gw\/tasks\/([0-9a-fA-F-]{36})\/(input|output|preview)\/([^/]+)$/.exec(url.pathname);
      if (!m) { fail(404, 'not found'); return; }

      const [, taskId, kind, rawName] = m;
      const candidateState=candidateTaskIdState(taskId);
      if(candidateState==='noncanonical-candidate'){fail(400, 'candidate task id must be lowercase');return;}
      const candidate=candidateState==='candidate';
      const name = decodeURIComponent(rawName);
      if (!isSafeFilename(name)) { fail(400, 'unacceptable filename'); return; }
      const qwenPlan=qwenFoartPlanPath(name,kind,req.method);
      if(qwenPlan?.invalid){fail(404,'not found');return;}
      if(candidate&&qwenPlan){fail(404,'not found');return;}
      // Reserved candidate proofs are scoped to one request and one result.
      // Reject every other path/method before consulting grants or verifiers.
      if(candidate && !((kind==='input' && name==='request.json' && ['PUT','POST'].includes(req.method)) ||
        (kind==='output' && name==='result.json' && ['GET','HEAD'].includes(req.method)))) {
        fail(404, 'not found'); return;
      }

      // Belt and braces: the resolved path must still live under this task's
      // directory, so even a filename that slipped past the pattern cannot
      // escape the task sandbox.
      const dir = candidate ? candidateTaskDirectory(dataDir,taskId,kind) : taskDir(taskId, kind);
      const filePath = resolve(dir, name);
      if (!filePath.startsWith(resolve(dir) + sep)) { fail(400, 'unacceptable path'); return; }

      // What the outside world may do here.
      //
      // Read a finished result, and place the reference image for a task it
      // owns. Nothing else: no reading anyone's inputs (the warehouse is the
      // only thing on show), no other method, no other shape.
      //
      // The write is not an open door. It needs a grant the control plane
      // mints only for the signed-in user who created that task, bound to
      // {user, task, this worker, upload}, good for 15 minutes, capped at
      // 64 MB, landing only in that one task's input folder, and swept when
      // the task ends.
      const reading = (req.method === 'GET' || req.method === 'HEAD') && kind !== 'input';
      const placing = (req.method === 'PUT' || req.method === 'POST') && kind === 'input';
      if (fromOutside && !reading && !placing) {
        log('refused from outside', { host: hostHeader, method: req.method, kind });
        fail(403, 'this address serves finished results and reference uploads only');
        return;
      }

      if ((req.method === 'PUT' || req.method === 'POST') && kind === 'input') {
        const grant = await readGrant(req, url, { taskId, op: GRANT_OP.UPLOAD });
        if(qwenPlan ? grant.scope!==qwenPlan.scope : [QWEN_FOART_PLAN_SCOPE,QWEN_IMAGE_EDIT_SCOPE].includes(grant.scope)){
          fail(403,'plan grant scope mismatch');return;
        }
        if(qwenPlan&&(!Number.isSafeInteger(grant.attempt)||grant.attempt<1||grant.attempt>20)){
          fail(403,'plan grant attempt mismatch');return;
        }
        const cap = Math.min(uploadByteCap(name), MAX_UPLOAD_BYTES);
        const capLabel = cap <= 24 * 1024 * 1024 ? '24MB' : '64MB';
        if(candidate){
          const first=await candidateAccess(req,taskId,GRANT_OP.UPLOAD,grant,'start');
          const streamed=await streamCandidateUpload(req,dir,filePath,cap,`${name} 超过 ${capLabel}`,async current=>{
            const verdict=inspectWorkerUpload({name,mimeType:req.headers['content-type'],bytes:current.head,size:current.total,
              slot:String(req.headers['x-novaflow-upload-slot']||'').trim()});
            if(!verdict.ok)throw Object.assign(new Error(verdict.message),{status:400});
            const last=await candidateAccess(req,taskId,GRANT_OP.UPLOAD,grant,'finish',
              {sha256:current.sha256,bytes:current.total});
            if(last.attempt!==first.attempt||last.sessionId!==first.sessionId||last.userId!==first.userId)
              throw Object.assign(new Error('candidate authorization changed'),{status:403});
          });
          log('candidate input received',{taskId,name,bytes:streamed.total});
          if(onUpload)await onUpload({taskId,name,bytes:streamed.total,userId:grant.sub});
          res.writeHead(200,{'content-type':'application/json',...corsHeaders(req.headers.origin)});
          res.end(JSON.stringify({ok:true,name,bytes:streamed.total}));return;
        }
        if(qwenPlan){
          const first=await qwenFoartPlanAccess(req,taskId,GRANT_OP.UPLOAD,grant,'start');
          if(first.attempt!==grant.attempt){fail(403,'plan grant attempt mismatch');return;}
          const streamed=await streamCandidateUpload(req,dir,filePath,Math.min(cap,qwenPlan.maxBytes),
            'scoped input exceeds limit',async current=>{
              const verdict=inspectWorkerUpload({name,mimeType:req.headers['content-type'],bytes:current.head,size:current.total,
                slot:String(req.headers['x-novaflow-upload-slot']||'').trim()});
              if(!verdict.ok)throw Object.assign(new Error(verdict.message),{status:400});
              const last=await qwenFoartPlanAccess(req,taskId,GRANT_OP.UPLOAD,grant,'finish',first.attempt,
                {sha256:current.sha256,bytes:current.total});
              if(last.attempt!==first.attempt||last.sessionId!==first.sessionId||last.userId!==first.userId)
                throw Object.assign(new Error('plan authorization changed'),{status:403});
            },join(dataDir,'tasks'));
          log('plan input received',{taskId,name,bytes:streamed.total});
          if(onUpload)await onUpload({taskId,name,bytes:streamed.total,userId:grant.sub});
          res.writeHead(200,{'content-type':'application/json',...corsHeaders(req.headers.origin)});
          res.end(JSON.stringify({ok:true,name,bytes:streamed.total}));return;
        }
        const streamed = await streamUpload(req, filePath, cap, `${name} 超过 ${capLabel}`);
        const slot = String(req.headers['x-novaflow-upload-slot'] || '').trim();
        const verdict = inspectWorkerUpload({
          name,
          mimeType: req.headers['content-type'],
          bytes: streamed.head,
          size: streamed.total,
          slot
        });
        if (!verdict.ok) {
          await rm(filePath, { force: true });
          throw Object.assign(new Error(verdict.message), { status: 400 });
        }
        log('input received', { taskId, name, bytes: streamed.total });
        if (onUpload) await onUpload({ taskId, name, bytes: streamed.total, userId: grant.sub });
        res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders(req.headers.origin) });
        res.end(JSON.stringify({ ok: true, name, bytes: streamed.total }));
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && kind !== 'input') {
        const grant=await readGrant(req, url, { taskId, op: GRANT_OP.DOWNLOAD });
        if(qwenPlan ? grant.scope!==qwenPlan.scope : [QWEN_FOART_PLAN_SCOPE,QWEN_IMAGE_EDIT_SCOPE].includes(grant.scope)){
          fail(403,'plan grant scope mismatch');return;
        }
        if(qwenPlan&&grant.attempt!==qwenPlan.attempt){fail(403,'plan grant attempt mismatch');return;}
        if(candidate)await candidateAccess(req,taskId,GRANT_OP.DOWNLOAD,grant,'start');
        if(qwenPlan)await qwenFoartPlanAccess(req,taskId,GRANT_OP.DOWNLOAD,grant,'start',qwenPlan.attempt);
        await serveFile(req, res, filePath, { download: url.searchParams.get('download') === '1' });
        return;
      }

      fail(405, 'method not allowed');
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) log('gateway error', { path: url.pathname, error: String(error?.stack || error) });
      fail(status, String(error?.message || 'gateway error'), error?.close);
    }
  });

  return {
    server,
    async listen(port, host = '0.0.0.0') {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.removeListener('error', reject); resolve(); });
      });
      return server.address().port;
    },
    async close() {
      await new Promise((r) => server.close(r));
    }
  };
}

/**
 * TTL sweep over data/tasks (spec 13). Deletes bytes whose age exceeds the
 * configured window and reports which task ids lost their results, so the
 * control plane can mark result_expired without us guessing.
 */
// An empty task folder is normally a finished task whose files have aged out.
// It is also what a task looks like in the seconds after it is claimed and
// before it writes anything, so an empty folder is only safe to remove once it
// has been empty for a while AND is not one the worker is running right now.
export const EMPTY_TASK_GRACE_SECONDS = 3600;

export async function sweepTaskFiles({ dataDir, ttlSeconds, now = Date.now(), activeTaskIds = [], taskSpace = 'legacy' }) {
  if(!['legacy','candidate'].includes(taskSpace))throw new TypeError('Invalid task space');
  const candidateSpace=taskSpace==='candidate';
  const active = new Set((activeTaskIds || []).map(id=>candidateSpace?String(id).toLowerCase():String(id)));
  const root = join(dataDir, candidateSpace ? CANDIDATE_TASKS_ROOT : 'tasks');
  const expiredTasks = [];
  let removedFiles = 0;
  let removedBytes = 0;

  let entries = [];
  try {
    if(candidateSpace){const rootInfo=await lstat(root);if(rootInfo.isSymbolicLink()||!rootInfo.isDirectory())return {expiredTasks,removedFiles,removedBytes};}
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { expiredTasks, removedFiles, removedBytes };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const taskId = entry.name;
    if(candidateSpace && candidateTaskIdState(taskId)!=='candidate')continue;
    // Never touch a task this worker is in the middle of. Its output folder is
    // empty until ComfyUI finishes, and deleting it there makes the write fail
    // with ENOENT and costs the user the whole generation.
    if (active.has(taskId)) continue;
    let lostResult = false;

    for (const kind of ['input', 'preview', 'output']) {
      const dir = join(root, taskId, kind);
      const ttl = (kind === 'input' ? ttlSeconds.input : null);
      let files = [];
      try {
        if(candidateSpace){const info=await lstat(dir);if(info.isSymbolicLink()||!info.isDirectory())continue;}
        files = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.isFile()) continue;
        const p = join(dir, f.name);
        let info;
        try { info = candidateSpace ? await lstat(p) : await stat(p); } catch { continue; }
        if(candidateSpace && (!info.isFile()||info.isSymbolicLink()))continue;
        const ext = extname(f.name).toLowerCase();
        const isVideo = ext === '.mp4' || ext === '.webm';
        const window = ttl ?? (isVideo ? ttlSeconds.video : ttlSeconds.image);
        if (now - info.mtimeMs > window * 1000) {
          await rm(p, { force: true });
          removedFiles += 1;
          removedBytes += info.size;
          if (kind === 'output') lostResult = true;
        }
      }
    }

    if (lostResult) expiredTasks.push(taskId);

    if(candidateSpace){
      // Never recursively remove unknown siblings or linked directories.
      try {
        const dir=join(root,taskId),info=await lstat(dir);
        if(info.isDirectory()&&!info.isSymbolicLink()&&now-info.mtimeMs>EMPTY_TASK_GRACE_SECONDS*1000){
          for(const kind of ['input','preview','output']){
            const path=join(dir,kind);try{const item=await lstat(path);if(item.isDirectory()&&!item.isSymbolicLink())await rmdir(path);}catch{}
          }
          try{await rmdir(dir);}catch{}
        }
      } catch {}
      continue;
    }

    // Drop the task folder once nothing is left in it - but only if it has
    // been sitting empty, not if it was created moments ago.
    try {
      const remaining = await Promise.all(['input', 'preview', 'output'].map(async (kind) => {
        try { return (await readdir(join(root, taskId, kind))).length; } catch { return 0; }
      }));
      if (remaining.every((n) => n === 0)) {
        let folder;
        try { folder = await stat(join(root, taskId)); } catch { folder = null; }
        const age = folder ? now - folder.mtimeMs : 0;
        if (folder && age > EMPTY_TASK_GRACE_SECONDS * 1000) {
          await rm(join(root, taskId), { recursive: true, force: true });
        }
      }
    } catch { /* leave the folder if it is in use */ }
  }

  return { expiredTasks, removedFiles, removedBytes };
}
