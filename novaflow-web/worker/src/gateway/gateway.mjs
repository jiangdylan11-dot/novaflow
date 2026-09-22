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
import { createReadStream } from 'node:fs';
import { stat, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { verifyGrantToken } from '../../../packages/shared/src/tokens.mjs';
import { GRANT_OP, isSafeFilename } from '../../../packages/shared/src/protocol.mjs';

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json'
};

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

function contentTypeFor(name) {
  return CONTENT_TYPES[extname(String(name)).toLowerCase()] || 'application/octet-stream';
}

function corsHeaders(origin) {
  return {
    // A grant is the authorisation, not the origin, so any page the user has
    // open may fetch with one. We never set credentials:true, so no cookie or
    // ambient credential rides along.
    'access-control-allow-origin': origin || '*',
    'access-control-allow-headers': 'content-type, x-novaflow-grant, range',
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

export function createGateway({ workerId, dataDir, getGrantKey, onUpload, logger }) {
  const log = logger || (() => {});

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

  async function readUpload(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) {
        throw Object.assign(new Error('upload exceeds ' + MAX_UPLOAD_BYTES + ' bytes'), { status: 413 });
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const fail = (status, message) => {
      res.writeHead(status, { 'content-type': 'application/json', ...corsHeaders(req.headers.origin) });
      res.end(JSON.stringify({ ok: false, error: message }));
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
      const name = decodeURIComponent(rawName);
      if (!isSafeFilename(name)) { fail(400, 'unacceptable filename'); return; }

      // Belt and braces: the resolved path must still live under this task's
      // directory, so even a filename that slipped past the pattern cannot
      // escape the task sandbox.
      const dir = taskDir(taskId, kind);
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
        const bytes = await readUpload(req);
        await mkdir(dir, { recursive: true });
        await writeFile(filePath, bytes);
        log('input received', { taskId, name, bytes: bytes.length });
        if (onUpload) await onUpload({ taskId, name, bytes: bytes.length, userId: grant.sub });
        res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders(req.headers.origin) });
        res.end(JSON.stringify({ ok: true, name, bytes: bytes.length }));
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && kind !== 'input') {
        await readGrant(req, url, { taskId, op: GRANT_OP.DOWNLOAD });
        await serveFile(req, res, filePath, { download: url.searchParams.get('download') === '1' });
        return;
      }

      fail(405, 'method not allowed');
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) log('gateway error', { path: url.pathname, error: String(error?.stack || error) });
      fail(status, String(error?.message || 'gateway error'));
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

export async function sweepTaskFiles({ dataDir, ttlSeconds, now = Date.now(), activeTaskIds = [] }) {
  const active = new Set((activeTaskIds || []).map(String));
  const root = join(dataDir, 'tasks');
  const expiredTasks = [];
  let removedFiles = 0;
  let removedBytes = 0;

  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { expiredTasks, removedFiles, removedBytes };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const taskId = entry.name;
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
        files = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.isFile()) continue;
        const p = join(dir, f.name);
        let info;
        try { info = await stat(p); } catch { continue; }
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
