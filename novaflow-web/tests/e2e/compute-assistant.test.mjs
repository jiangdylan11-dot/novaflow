import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createComputeAssistant } from '../../worker/src/compute-assistant.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
const comfy = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(req.url === '/system_stats' ? { system: { comfyui_version: 'fixture' }, devices: [] } : {}));
});
const comfyUrl = await listen(comfy);
let registration = null, claims = 0, registrations = 0, rejectRegistration = true, omitPolicy = false;
let pendingApproval = true, platformName = '待审批设备', modelReports = [];
let heartbeats = [], failHeartbeat = false;
const policy = { enabled: false, owner_enabled: false, sharing_enabled: false, sharing_scope: 'pool', allowed_user_ids: [] };
const workerReply = () => omitPolicy ? {} : { policy, pending_approval: pendingApproval, worker_name: platformName };
const remote = createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  const body = JSON.parse(text || '{}');
  let reply = { ok: true, worker: workerReply() };
  if (req.url === '/api/worker/register') {
    registration = body; registrations++;
    if (rejectRegistration) { res.statusCode = 401; reply = { error: 'missing session token' }; }
    else reply = { workerToken: 'fixture-worker', grantKey: 'fixture-compute-grant-key', worker: workerReply() };
  }
  if (req.url === '/api/worker/claim') { claims++; reply = { task: null }; }
  if (req.url === '/api/worker/heartbeat') {
    heartbeats.push(body);
    if (failHeartbeat) { res.statusCode = 503; reply = { error: 'fixture disconnect' }; }
  }
  if (req.url === '/api/worker/models') modelReports.push(body.models);
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(reply));
});
const controlUrl = await listen(remote);
const dataDir = await mkdtemp(join(tmpdir(), 'foart-compute-assistant-'));
const modelsRoot = join(dataDir, 'models'); await mkdir(modelsRoot);
const runtimeJsonPath = join(dataDir, 'runtime.json'), strataConfigPath = join(dataDir, 'strata.json');
await writeFile(runtimeJsonPath, JSON.stringify({ installPath: dataDir, modelsPath: modelsRoot }));
await writeFile(strataConfigPath, JSON.stringify({ enabled: false, analysisBackend: 'strata', modelFiles: [], baseUrl: comfyUrl, expectedModel: { ids: ['fixture-disabled'] } }));
let starts = 0, stops = 0, cleaned = 0, environmentMissing = true;
const services = { start: async () => { starts++; if (environmentMissing) throw new Error('fixture environment missing'); return [{ kind: 'image', url: comfyUrl }]; }, stop: async () => { stops++; } };
const assistant = await createComputeAssistant({ controlUrl, dataDir, configPath: join(dataDir, 'identity.json'),
  modelsRoot, comfyImageUrl: comfyUrl, comfyVideoUrl: comfyUrl, services, tunnel: false, gatewayPort: 0, gatewayHost: '127.0.0.1',
  pollIntervalMs: 20, runtimeRetryIntervalMs: 50,
  promptAssistant: { analysisBackend: 'strata', runtimeJsonPath, strataConfigPath },
  license: { assertAllowed() { throw new Error('compute companion must never use a machine license'); } },
  clearRunFiles: () => { cleaned++; }, logger() {} });
try {
  await assert.rejects(assistant.start(), /平台自动接入服务需要升级/);
  assert.equal(starts, 0, 'registration never requires a local model environment');
  rejectRegistration = false;
  omitPolicy = true;
  await assert.rejects(assistant.start(), /权限服务需要升级/);
  assert.equal(claims, 0, 'old platforms cannot silently add the device to the public pool');
  omitPolicy = false;
  await assistant.start();
  assert.equal(starts, 0, 'a pending node does not start any model services');
  assert.equal(registration.profile, 'compute-only');
  assert.equal(registration.registration_code, undefined, 'public enrollment uses no code');
  assert.equal(registrations, 3);
  assert.equal(assistant.getState().profile, 'compute-only');
  assert.equal(assistant.getState().workbenchUrl, '');
  assert.equal(assistant.getState().localRunning, false);
  assert.equal(assistant.getState().sharing, true, 'pending nodes stay connected for administrator approval');
  assert.equal(assistant.getState().pendingApproval, true);
  assert.equal(assistant.getState().workerName, '待审批设备');
  assert.equal(assistant.getState().runtimeReady, false);
  await assistant.worker.heartbeat();
  assert.equal(heartbeats.at(-1).status, 'maintenance', 'pending node does not advertise idle');
  assert(modelReports.every(models => models.length === 0), 'pending node advertises no existing local runtime');
  await assistant.worker.claimAndRun();
  assert.equal(claims, 0, 'pending node does not request tasks');
  assert.equal(assistant.getState().policy.sharing_enabled, false);
  const endpoint = assistant.getState().localEndpointUrl;
  assert.equal((await fetch(endpoint + '/')).status, 404, 'gateway does not serve Foart pages');
  assert.equal((await fetch(endpoint + '/local/state')).status, 404, 'gateway does not expose local editor API');
  const wait = async predicate => { const deadline = Date.now() + 4000; while (!predicate()) { if (Date.now() > deadline) throw new Error('fixture timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } };
  pendingApproval = false; platformName = '合作方一号';
  policy.enabled = true; policy.owner_enabled = true;
  await assistant.worker.heartbeat();
  await wait(() => starts > 0 && !assistant.getState().runtimeStarting && !!assistant.getState().environmentError);
  assert.equal(assistant.getState().connected, true, 'missing model environment does not take the device off the platform');
  assert.equal(assistant.getState().pendingApproval, false);
  assert.equal(assistant.getState().workerName, '合作方一号');
  assert.match(assistant.getState().lastError, /environment missing/);
  await assistant.worker.heartbeat();
  assert.equal(heartbeats.at(-1).status, 'maintenance', 'missing environment is not advertised as idle');
  assert.equal(claims, 0, 'authorized but unready node does not claim tasks');
  environmentMissing = false;
  await wait(() => assistant.getState().runtimeReady);
  await wait(() => claims > 0);
  assert(claims > 0, 'connected private node polls server-side access controlled tasks');
  assert.equal(assistant.getState().environmentError, '');
  const started = starts;
  await assistant.worker.heartbeat();
  assert.equal(heartbeats.at(-1).status, 'idle', 'authorized, ready node recovers its idle status');
  const beforeConcurrent = heartbeats.length;
  await Promise.all([assistant.worker.heartbeat(), assistant.worker.heartbeat()]);
  assert.equal(heartbeats.length - beforeConcurrent, 1, 'overlapping heartbeats cannot reorder readiness');
  const beforeUnready = heartbeats.length;
  assistant.worker.setComputeReady(false);
  await wait(() => heartbeats.length > beforeUnready && heartbeats.at(-1).status === 'maintenance');
  assistant.worker.setComputeReady(true);
  await assistant.worker.heartbeat();
  assert.equal(heartbeats.at(-1).status, 'idle', 'runtime readiness recovery restores idle');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(starts, started, 'model-report emits cannot reenter runtime startup');
  platformName = '平台重新命名';
  await assistant.worker.heartbeat();
  assert.equal(assistant.getState().workerName, '平台重新命名');
  await assistant.worker.register();
  assert.equal(registration.worker_name, '平台重新命名', 're-registration does not send the original local name');
  assert.equal(assistant.getState().workerName, '平台重新命名');
  omitPolicy = true;
  const beforeMissing = heartbeats.length;
  await assistant.worker.heartbeat();
  assert.equal(assistant.getState().connected, false);
  assert.equal(heartbeats[beforeMissing].status, 'idle');
  assert.equal(heartbeats.at(-1).status, 'maintenance', 'missing policy withdraws the accepted idle heartbeat');
  await assistant.worker.heartbeat();
  assert.equal(heartbeats.at(-1).status, 'maintenance', 'later failed policy heartbeats cannot re-advertise idle');
  const before = claims;
  await assistant.worker.claimAndRun();
  assert.equal(claims, before, 'missing policy stops new claims after a platform downgrade');
  omitPolicy = false;
  await assistant.worker.heartbeat();
  assert.equal(assistant.getState().connected, true, 'a valid heartbeat restores connectivity');
  await wait(() => assistant.getState().runtimeReady);
  await assistant.worker.heartbeat();
  assert.equal(heartbeats.at(-1).status, 'idle', 'recovered policy and environment restore idle');
  failHeartbeat = true;
  await assistant.worker.heartbeat();
  assert.equal(assistant.getState().connected, false, 'network failure marks the worker disconnected');
  const duringFailure = heartbeats.length;
  await assistant.worker.heartbeat();
  assert.equal(heartbeats[duringFailure].status, 'maintenance', 'disconnected worker never sends idle');
  failHeartbeat = false;
  await assistant.worker.heartbeat();
  assert.equal(heartbeats.at(-1).status, 'maintenance', 'first reconnect verifies policy before advertising');
  await wait(() => assistant.getState().runtimeReady);
  await assistant.worker.heartbeat();
  assert.equal(heartbeats.at(-1).status, 'idle', 'successful reconnect restores idle');
  policy.owner_enabled = false;
  await assistant.worker.heartbeat();
  assert.equal(heartbeats.at(-1).status, 'maintenance', 'revoked permissions immediately withdraw idle');
  const afterRevocation = claims;
  await assistant.worker.claimAndRun();
  assert.equal(claims, afterRevocation, 'removing all use permissions blocks new claims');
  await wait(() => !assistant.getState().runtimeReady);
  await assistant.stop();
  assert.equal(assistant.getState().sharing, false);
  assert(stops >= 3);
  assert.equal(cleaned, 1);
  console.log('compute assistant: registration, private connectivity, no editor/license and lifecycle passed');
} finally {
  await assistant.stop().catch(() => {});
  await Promise.all([new Promise(resolve => remote.close(resolve)), new Promise(resolve => comfy.close(resolve))]);
}
