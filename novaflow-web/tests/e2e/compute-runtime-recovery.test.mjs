// An image runtime that lost its GPU (a display driver reset) keeps its process and port but answers 500.
// The node used to stay online without any image or video model for hours, and "退出 Foart" could wait
// forever on a claim that never finished. Both are covered here with the real assistant and worker core.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createComputeAssistant } from '../../worker/src/compute-assistant.mjs';
import { forceQuitCommand } from '../../worker/src/force-quit.cjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
const until = async (test, label, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await test()) return; await new Promise(r => setTimeout(r, 25)); }
  assert.fail('timed out: ' + label);
};
let broken = false;
const comfy = createServer((req, res) => {
  if (broken) { res.statusCode = 500; res.end('500 Internal Server Error'); return; }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(req.url === '/system_stats' ? { system: { comfyui_version: 'fixture' }, devices: [] } : {}));
});
const comfyUrl = await listen(comfy);
let hangClaims = false, claims = 0;
const hung = [];
const policy = { enabled: true, owner_enabled: true, sharing_enabled: false, sharing_scope: 'pool', allowed_user_ids: [] };
const remote = createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  let reply = { ok: true, worker: { policy, pending_approval: false, worker_name: 'fixture' } };
  if (req.url === '/api/worker/register') reply = { workerToken: 'fixture-worker', grantKey: 'fixture-grant-key', worker: reply.worker };
  if (req.url === '/api/worker/claim') { claims++; if (hangClaims) { hung.push(res); return; } reply = { task: null }; }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(reply));
});
const controlUrl = await listen(remote);
const dataDir = await mkdtemp(join(tmpdir(), 'foart-runtime-recovery-'));
const modelsRoot = join(dataDir, 'models'); await mkdir(modelsRoot);
const runtimeJsonPath = join(dataDir, 'runtime.json'), strataConfigPath = join(dataDir, 'strata.json');
await writeFile(runtimeJsonPath, JSON.stringify({ installPath: dataDir, modelsPath: modelsRoot }));
await writeFile(strataConfigPath, JSON.stringify({ enabled: false, analysisBackend: 'strata', modelFiles: [], baseUrl: comfyUrl, expectedModel: { ids: ['fixture-disabled'] } }));
const lines = [];
let starts = 0, stops = 0, reused = false;
// What the real service layer returns for a runtime it started (reused: false) or found running (reused: true).
const services = {
  start: async () => { starts++; broken = false; return [{ kind: 'image', url: comfyUrl, running: true, reused }]; },
  stop: async () => { stops++; }
};
const assistant = await createComputeAssistant({ controlUrl, dataDir, configPath: join(dataDir, 'identity.json'),
  modelsRoot, comfyImageUrl: comfyUrl, comfyVideoUrl: comfyUrl, services, tunnel: false, gatewayPort: 0, gatewayHost: '127.0.0.1',
  pollIntervalMs: 20, runtimeRetryIntervalMs: 40, runtimeHealthIntervalMs: 20, runtimeUnhealthyMs: 200,
  promptAssistant: { analysisBackend: 'strata', runtimeJsonPath, strataConfigPath },
  logger: (message, meta) => lines.push(message + ' ' + JSON.stringify(meta || {})) });
try {
  await assistant.start();
  await until(() => starts === 1 && assistant.getState().runtimeReady, 'the runtime starts once');
  await new Promise(r => setTimeout(r, 400));
  assert.equal(starts, 1, 'a healthy runtime is left alone');
  assert.equal(stops, 0);

  broken = true;
  await until(() => starts === 2, 'a runtime that answers 500 is restarted');
  assert.equal(stops, 1, 'the broken one was stopped first');
  assert(lines.some(l => l.startsWith('generation service has not answered')), 'the restart is logged');
  await until(() => assistant.getState().runtimeReady, 'the node is ready again');
  await assistant.worker.heartbeat();
  assert(lines.some(l => l.startsWith('generation service')), 'the change in service health is logged');

  // A borrowed runtime belongs to whoever started it.
  reused = true; broken = true;
  await until(() => starts === 3, 'our own runtime is restarted once more');
  broken = true;
  await new Promise(r => setTimeout(r, 600));
  assert.equal(starts, 3, 'a borrowed runtime is never restarted');
  broken = false;

  await until(() => lines.some(l => l.startsWith('claim: ')), 'the claim loop says what it is doing');
  assert(lines.filter(l => l.startsWith('claim: ')).length < 12, 'without a line for every poll');

  // A claim the server never answers must not keep the node from stopping.
  hangClaims = true;
  const before = claims;
  await until(() => claims > before, 'a claim is in flight');
  const started = Date.now();
  await assistant.stop();
  assert(Date.now() - started < 15000, 'stop returns although a claim is still in flight (' + (Date.now() - started) + ' ms)');
  assert(lines.some(l => l.startsWith('stop: a task claim did not finish')), 'and says what it gave up waiting for');
  assert.equal(assistant.getState().sharing, false);

  const command = forceQuitCommand();
  assert(command.includes('$env:FOART_QUIT_PID') && command.includes('$env:FOART_QUIT_RUNTIMES'), 'the forced quit takes its targets from the environment');
  assert(command.includes("comfyui\\main.py"), 'and only ends a recorded process that is still the image runtime');
  console.log('compute runtime recovery: broken runtime restarted, claim reasons logged, stop never waits forever');
} finally {
  for (const res of hung) { try { res.destroy(); } catch { /* closed */ } }
  await assistant.stop().catch(() => {});
  remote.closeAllConnections?.(); comfy.closeAllConnections?.();
  await Promise.all([new Promise(resolve => remote.close(resolve)), new Promise(resolve => comfy.close(resolve))]);
}
