// Loopback-only browser workbench. The public Worker gateway NEVER mounts
// these routes. Browser pairing is provided only by the local assistant UI.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, join, sep, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createGateway } from './gateway/gateway.mjs';
import { issueGrantToken, safeCompare } from '../../packages/shared/src/tokens.mjs';
import { TASK_TYPE_REQUIREMENTS } from '../../packages/shared/src/protocol.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
// 提示词助手 requests carry reference images and H3 frames as data URLs (the
// desktop's own limits: 2.5 MB a frame, 16 MB a request); everything else is
// small JSON.
const PROMPT_ASSISTANT_PREFIX = '/local/prompt-assistant/';
const PROMPT_ASSISTANT_BODY_LIMIT = 24 * 1024 * 1024;
async function bodyOf(req, limit = 256 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail('请求过大', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw fail('无效 JSON'); }
}

export async function startLocalServer({ worker, tasks, license, dataDir, webRoot, port = 4784, controlUrl = '', promptAssistant = null, artLearning = null, artActor = null, artKnowledgeEnabled = false, artKnowledgeUrl = '' }) {
  const secret = randomBytes(32).toString('hex');
  const grantKey = randomBytes(32).toString('hex');
  const gateway = createGateway({ workerId: worker.identity.workerId, dataDir, getGrantKey: () => grantKey });
  let origin = '';
  const lifecycleClients = new Set();
  const root = await realpath(webRoot);
  const server = createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== new URL(origin).host) throw fail('invalid host', 403);
      if (req.headers.origin && req.headers.origin !== origin) throw fail('foreign origin', 403);
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/gw/')) {
        const id = /^\/gw\/tasks\/([^/]+)\//.exec(url.pathname)?.[1];
        if (!tasks.has(id)) throw fail('本机任务不存在', 404);
        gateway.server.emit('request', req, res); return;
      }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/local/')) {
        if (!safeCompare(req.headers['x-novaflow-local'] || '', secret)) throw fail('请从本地助手点击“启动NovaFlow”连接本机', 401);
        const body = req.method === 'POST' ? await bodyOf(req, url.pathname.startsWith(PROMPT_ASSISTANT_PREFIX) ? PROMPT_ASSISTANT_BODY_LIMIT : undefined) : {};
        const s = worker.getState();
        if (req.method === 'GET' && url.pathname === '/local/events') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
          res.write('data: ready\n\n');
          lifecycleClients.add(res);
          res.on('close', () => lifecycleClients.delete(res));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/local/state') return json(200, s);
        if (req.method === 'GET' && url.pathname === '/local/license') return json(200, await license.state());
        if (req.method === 'POST' && url.pathname === '/local/bind-account') return json(200, await worker.bindAccount(String(body.token || '')));
        if (req.method === 'POST' && url.pathname === '/local/license') return json(200, await license.importLicense(body.text));
        // 提示词助手: the desktop's Python service on this machine, reached by
        // the browser 启动NovaFlow opened. A failed run answers 200 with ok:false,
        // the shape the editor reads from the desktop bridge.
        if (url.pathname.startsWith(PROMPT_ASSISTANT_PREFIX)) {
          if (!promptAssistant) throw fail('本机没有提示词助手', 404);
          const action = url.pathname.slice(PROMPT_ASSISTANT_PREFIX.length);
          if (req.method === 'POST' && action === 'art-learning') {
            if (!artLearning) throw fail('本机尚未启用任务反馈服务', 404);
            // A logged-in browser may only use this node's verified bound account.
            // Unbound local mode is one paired device owner, not a Web tenant API.
            const {accountId,accountToken,...command} = body;
            if(artActor){const ownerId=await artActor.identify(body);if(command.action==='forget-session'){artActor.forget(accountToken);return json(200,{ok:true});}return json(200,{ok:true,data:command.action==='identify'?{ownerId}:await artActor.runAs(ownerId,()=>artLearning.command(command))});}
            if (accountId && accountId !== s.boundAccount?.id) throw fail('当前账号与本机任务所属账号不一致，请先绑定本机账号', 403);
            return json(200, {ok:true,data:await artLearning.command(command)});
          }
          if (req.method === 'GET' && action === 'status') return json(200, promptAssistant.status());
          if (req.method === 'POST' && action === 'optimize-prompt') return json(200, await promptAssistant.optimizePrompt(body));
          if (req.method === 'POST' && action === 'reverse-image-prompt') return json(200, await promptAssistant.reverseImagePrompt(body));
          if (req.method === 'POST' && action === 'cancel-request') return json(200, await promptAssistant.cancelRequest(body));
          if (req.method === 'POST' && action === 'describe-art-style') return json(200, await promptAssistant.describeArtStyle(body));
          if (req.method === 'POST' && action === 'art-agent-chat') {
            const {accountId,accountToken,...payload}=body;let ownerId=null,learningAllowed=!accountId||accountId===s.boundAccount?.id;
            if(artActor){try{ownerId=await artActor.identify(body);learningAllowed=true;}catch{learningAllowed=false;}}
            const run=()=>promptAssistant.artAgentChat(payload,{learningAllowed});
            const response = ownerId?await artActor.runAs(ownerId,run):await run();
            if (!learningAllowed) response.learningWarning = '当前登录身份暂时无法核验，本次沿用原有生成流程，未读写账号任务反馈';
            return json(200,response);
          }
          if (req.method === 'POST' && action === 'art-agent-stop') return json(200, await promptAssistant.artAgentStop(body));
          throw fail('未找到本机接口', 404);
        }
        // 音频 AI 助手 (本地): the audio pipeline's own rewrite, answered as {ok, prompt}.
        if (req.method === 'POST' && url.pathname === '/local/audio/optimize-prompt') return json(200, await worker.rewriteAudioPrompt(body));
        if (req.method === 'GET' && url.pathname === '/api/web/capabilities') {
          return json(200, { available_workers: s.comfy.image || s.comfy.video ? 1 : 0, models: s.models, features: s.features || {},
            taskTypes: Object.entries(TASK_TYPE_REQUIREMENTS).map(([task_type, spec]) => ({ task_type, ...spec,
              available_workers: s.models.some(m => m.model_id === spec.modelId && m.status === 'ready') ? 1 : 0 })) });
        }
        if (req.method === 'GET' && url.pathname === '/api/web/workers') return json(200, { workers: [{ ...s, id: s.workerId, worker_name: s.workerName }] });
        // The page checks each chosen H3 LoRA before an animation run, as it does with the control
        // plane in shared mode: the selection must still be in this node's list for the run's mode
        // and steps (without this route every local run with an H3 LoRA stopped at a 404).
        if (url.pathname === '/api/web/loras/h3/validate' && req.method === 'POST') {
          const mode = String(body.mode || 'i2v');
          const steps = Number(body.steps || 4);
          if (!['t2v', 'i2v', 'fl2v', 'r2v'].includes(mode) || !Number.isInteger(steps) || steps < 1 || steps > 100) throw fail('invalid LoRA context');
          const catalog = await worker.readLoraCatalog('h3', { mode, steps });
          const item = (catalog.items || []).find(entry => entry.name === body.name && entry.fingerprint === body.fingerprint);
          const strength = Number(body.strength);
          if (!item || !Number.isFinite(strength) || strength < 0 || strength > 2) throw fail('LoRA 已变化或不兼容，请重新选择');
          return json(200, { ok: true, item, strength });
        }
        if (url.pathname.startsWith('/api/web/loras/') && req.method === 'GET') {
          const kind = url.pathname.split('/').pop();
          return json(200, await worker.readLoraCatalog(kind, { nsfw: url.searchParams.get('nsfw') === 'true', engine: url.searchParams.get('engine') === 'qwen-2.1' ? 'qwen-2.1' : '', mode: url.searchParams.get('mode') || 't2v', steps: Number(url.searchParams.get('steps')) || 4 }));
        }
        if (url.pathname === '/api/web/tasks' && req.method === 'GET') return json(200, { tasks: tasks.list() });
        if (url.pathname === '/api/web/tasks' && req.method === 'POST') {
          if (!s.localRunning) throw fail('本地服务未启动', 503);
          await license.assertAllowed();
          return json(201, { task: await tasks.create(body, s.workerId) });
        }
        const match = /^\/api\/web\/tasks\/([^/]+)(?:\/(grant|cancel))?$/.exec(url.pathname);
        if (match) {
          const task = tasks.get(match[1]);
          if (!task) throw fail('本机任务不存在', 404);
          if (!match[2] && req.method === 'GET') {
            const queue = tasks.queueView(task.id);
            return json(200, { task: queue ? { ...task, queue } : task });
          }
          if (match[2] === 'cancel' && req.method === 'POST') return json(200, { task: await worker.cancelLocalTask(task.id) });
          if (match[2] === 'grant' && req.method === 'POST') {
            if (!['upload', 'download'].includes(body.op)) throw fail('无效的文件操作');
            if (body.op === 'upload' && !['queued', 'assigned', 'uploading'].includes(task.status)) throw fail('上传窗口已关闭', 409);
            const token = await issueGrantToken({ userId: 'local-owner', workerId: s.workerId, taskId: task.id, op: body.op, ttlSeconds: 3600 }, grantKey);
            return json(200, { grant: { token, endpoint: origin, expiresAt: new Date(Date.now() + 3600000).toISOString() } });
          }
        }
        throw fail('未找到本机接口', 404);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw fail('method not allowed', 405);
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const path = await realpath(resolve(root, '.' + pathname));
      if (!path.startsWith(root + sep)) throw fail('invalid path', 403);
      let bytes = await readFile(path);
      if (path === join(root, 'index.html')) {
        // The same web-dist used by the hosted site; only local connection
        // metadata is injected, never a license bypass or session credential.
        const config = JSON.stringify({ controlUrl, localAssistant: true, localOrigin: origin, artKnowledgeEnabled: artKnowledgeEnabled === true, artKnowledgeUrl }).replace(/</g, '\\u003c');
        bytes = Buffer.from(bytes.toString().replace('<head>', '<head><script>window.NOVAFLOW_WEB_CONFIG=' + config + ';</script>'));
      }
      res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'SAMEORIGIN' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) { json(error.status || (error.code === 'ENOENT' ? 404 : 400), { error: String(error.message || error) }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + server.address().port;
  return { origin, openUrl: origin + '/#local-pair=' + secret, server,
    close: () => new Promise(resolve => {
      for (const client of lifecycleClients) client.end('data: closed\n\n');
      lifecycleClients.clear();
      server.close(resolve); server.closeIdleConnections();
    }) };
}
