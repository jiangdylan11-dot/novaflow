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
const policy = { enabled: true, owner_enabled: true, sharing_enabled: false, sharing_scope: 'pool', allowed_user_ids: [] };
const remote = createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  const body = JSON.parse(text || '{}');
  let reply = { ok: true, worker: omitPolicy ? {} : { policy } };
  if (req.url === '/api/worker/register') {
    registration = body; registrations++;
    if (rejectRegistration) { res.statusCode = 403; reply = { error: 'fixture registration denied' }; }
    else reply = { workerToken: 'fixture-worker', grantKey: 'fixture-compute-grant-key', worker: omitPolicy ? {} : { policy } };
  }
  if (req.url === '/api/worker/claim') { claims++; reply = { task: null }; }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(reply));
});
const controlUrl = await listen(remote);
const dataDir = await mkdtemp(join(tmpdir(), 'foart-compute-assistant-'));
const modelsRoot = join(dataDir, 'models'); await mkdir(modelsRoot);
const runtimeJsonPath = join(dataDir, 'runtime.json'), strataConfigPath = join(dataDir, 'strata.json');
await writeFile(runtimeJsonPath, JSON.stringify({ installPath: dataDir, modelsPath: modelsRoot }));
await writeFile(strataConfigPath, JSON.stringify({ enabled: false, analysisBackend: 'strata', modelFiles: [], baseUrl: comfyUrl, expectedModel: { ids: ['fixture-disabled'] } }));
let starts = 0, stops = 0, cleaned = 0;
const services = { start: async () => { starts++; return [{ kind: 'image', url: comfyUrl }]; }, stop: async () => { stops++; } };
const assistant = await createComputeAssistant({ controlUrl, dataDir, configPath: join(dataDir, 'identity.json'),
  modelsRoot, comfyImageUrl: comfyUrl, comfyVideoUrl: comfyUrl, services, tunnel: false, gatewayPort: 0, gatewayHost: '127.0.0.1',
  registrationCode: 'fixture-code', pollIntervalMs: 20,
  promptAssistant: { analysisBackend: 'strata', runtimeJsonPath, strataConfigPath },
  license: { assertAllowed() { throw new Error('compute companion must never use a machine license'); } },
  clearRunFiles: () => { cleaned++; }, logger() {} });
try {
  await assert.rejects(assistant.start(), /fixture registration denied/);
  assert.equal(stops, 1, 'failed registration releases model services');
  rejectRegistration = false;
  omitPolicy = true;
  await assert.rejects(assistant.start(), /权限服务需要升级/);
  assert.equal(claims, 0, 'old platforms cannot silently add the device to the public pool');
  omitPolicy = false;
  await assistant.start();
  assert.equal(starts, 3, 'failed registration and incompatible platforms are retryable');
  assert.equal(registration.profile, 'compute-only');
  assert.equal(registration.registration_code, 'fixture-code');
  assert.equal(registrations, 3);
  assert.equal(assistant.getState().profile, 'compute-only');
  assert.equal(assistant.getState().workbenchUrl, '');
  assert.equal(assistant.getState().localRunning, false);
  assert.equal(assistant.getState().sharing, true, 'node connects for owner tasks even with public sharing disabled');
  assert.equal(assistant.getState().policy.sharing_enabled, false);
  const endpoint = assistant.getState().localEndpointUrl;
  assert.equal((await fetch(endpoint + '/')).status, 404, 'gateway does not serve Foart pages');
  assert.equal((await fetch(endpoint + '/local/state')).status, 404, 'gateway does not expose local editor API');
  const deadline = Date.now() + 3000;
  while (!claims && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert(claims > 0, 'connected private node polls server-side access controlled tasks');
  omitPolicy = true;
  await assistant.worker.heartbeat();
  assert.equal(assistant.getState().connected, false);
  const before = claims;
  await assistant.worker.claimAndRun();
  assert.equal(claims, before, 'missing policy stops new claims after a platform downgrade');
  omitPolicy = false;
  await assistant.worker.heartbeat();
  assert.equal(assistant.getState().connected, true, 'a valid heartbeat restores connectivity');
  await assistant.stop();
  assert.equal(assistant.getState().sharing, false);
  assert.equal(stops, 3);
  assert.equal(cleaned, 1);
  console.log('compute assistant: registration, private connectivity, no editor/license and lifecycle passed');
} finally {
  await assistant.stop().catch(() => {});
  await Promise.all([new Promise(resolve => remote.close(resolve)), new Promise(resolve => comfy.close(resolve))]);
}
