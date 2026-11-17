// Manual verification (about two minutes; not part of the suite): a node whose tunnel cannot open
// still registers and keeps its local gateway, says so, and recovers by itself when the tunnel opens.
//   node novaflow-web/tests/e2e/tunnel-nonblocking.verify.mjs
// The "tunnel tool" is node itself: it exits 1 until a script named `tunnel` exists in the working directory.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { createWorker } from '../../worker/src/worker-core.mjs';
import { approveComputeWorker, check, call, section, finish, waitFor } from '../helpers.mjs';
import { startComfyStub } from '../helpers/comfy-stub.mjs';

const WORKFLOW_DIR = new URL('../../worker/workflows/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const RENDERER_DIR = new URL('../../worker-renderer/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const comfy = await startComfyStub();
const ctx = await startLocalControlPlane({ port: 0 });
const dataDir = await mkdtemp(join(tmpdir(), 'nfweb-tunnel-'));
const cwd = await mkdtemp(join(tmpdir(), 'nfweb-tunnel-cwd-'));
process.chdir(cwd);
process.env.NOVAFLOW_CLOUDFLARED = process.execPath;
const lines = [];
let worker;
try {
  const owner = (await call(ctx.url, 'POST', '/dev/login', { body: { email: 'owner@novaflow.local', balance: 1000 } })).body.session.token;
  const code = (await call(ctx.url, 'POST', '/api/web/workers/codes', { token: owner, body: { label: 'tunnel', max_uses: 1, valid_days: 1 } })).body.registration_code;
  worker = createWorker({ controlUrl: ctx.url, dataDir, workflowDir: WORKFLOW_DIR, rendererDir: RENDERER_DIR, configPath: join(dataDir, 'identity.json'),
    comfyImageUrl: comfy.url, comfyVideoUrl: comfy.url, gatewayPort: 0, gatewayHost: '127.0.0.1', workerName: 'tunnel-node', registrationCode: code,
    pollIntervalMs: 500, heartbeatIntervalMs: 1500, logger: (message, meta) => lines.push(message + ' ' + JSON.stringify(meta || {})) });
  const mine = async () => (await call(ctx.url, 'GET', '/api/web/workers', { token: owner })).body.workers.find(w => w.id === worker.getState().workerId);

  section('1. the tunnel never opens');
  const started = Date.now();
  await worker.start();
  await approveComputeWorker(ctx.db, worker.getState().workerId);
  let state = worker.getState();
  check('start() resolves instead of throwing', true, null);
  check('after waiting for the tunnel (seconds)', Date.now() - started > 40000, Date.now() - started);
  check('the tool was retried with backoff, not every two seconds', lines.filter(l => l.startsWith('tunnel closed')).length <= 4, lines.filter(l => l.startsWith('tunnel closed')).length);
  check('each exit logs the tool\'s own reason', lines.some(l => l.startsWith('tunnel closed') && /MODULE_NOT_FOUND|Cannot find module/.test(l)), lines.find(l => l.startsWith('tunnel closed')));
  check('the node is registered', state.connected === true && Boolean(state.workerId), state);
  check('on its local address', /^http:\/\/127\.0\.0\.1:\d+$/.test(state.endpointUrl) && state.transport === 'direct', [state.endpointUrl, state.transport]);
  check('the local gateway answers', (await fetch(state.localEndpointUrl + '/').catch(() => null)) !== null, state.localEndpointUrl);
  check('the status text says the tunnel is pending', /外网共享连接暂未建立/.test(state.lastError), state.lastError);
  await waitFor(async () => (await mine())?.status === 'maintenance', { timeoutMs: 8000 }).catch(() => {});
  check('the control plane sees it as not taking cloud tasks', (await mine())?.status === 'maintenance', await mine());
  state = worker.getState();
  check('the pending text survives heartbeats', /外网共享连接暂未建立/.test(state.lastError), state.lastError);

  section('2. the tunnel opens later');
  await writeFile(join(cwd, 'tunnel'), "console.error('|  https://verify-node-open.trycloudflare.com  |'); setInterval(() => {}, 1000);\n");
  await waitFor(() => /trycloudflare/.test(worker.getState().endpointUrl) && worker.getState().transport === 'tunnel', { timeoutMs: 100000 });
  state = worker.getState();
  check('the node picks up the public address by itself', state.endpointUrl === 'https://verify-node-open.trycloudflare.com', state.endpointUrl);
  await waitFor(async () => (await mine())?.status === 'idle', { timeoutMs: 10000 }).catch(() => {});
  const row = await mine();
  check('the control plane has the new address and transport', row?.endpoint_url === state.endpointUrl && row?.transport === 'tunnel', row);
  check('and it takes cloud tasks again', row?.status === 'idle', row?.status);
  check('the pending text is gone', worker.getState().lastError === '', worker.getState().lastError);
} finally {
  try { await worker?.stop(); } catch { /* already down */ }
  try { ctx.server.close(); } catch { /* closed */ }
  try { await comfy.close(); } catch { /* closed */ }
  process.chdir(tmpdir());
  for (const dir of [dataDir, cwd]) await rm(dir, { recursive: true, force: true }).catch(() => {});
}
finish();
