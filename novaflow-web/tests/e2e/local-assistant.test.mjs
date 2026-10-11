import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLocalAssistant } from '../../worker/src/local-assistant.mjs';
import { issueGrantToken } from '../../packages/shared/src/tokens.mjs';
import { MODEL_MANIFEST } from '../../packages/shared/src/model-manifest.mjs';
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
const wait = async fn => { const end = Date.now() + 15000; while (!await fn()) { if (Date.now() > end) throw new Error('wait timed out'); await new Promise(r => setTimeout(r, 30)); } };
const listen = async server => { await new Promise(r => server.listen(0, '127.0.0.1', r)); return 'http://127.0.0.1:' + server.address().port; };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const weights = MODEL_MANIFEST.flatMap(m => m.required_files.map(f => f.path.split('/').pop()));
const queued = [], finished = new Set(), cancelled = new Set();
let autoFinish = true, claims = 0, upstreamCalls = 0, licensed = true, rejectRegister = false;
const comfy = createServer(async (req, res) => {
  const send = body => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
  if (req.url === '/system_stats') return send({ system: { comfyui_version: 'fixture' }, devices: [] });
  if (req.url.startsWith('/object_info/')) { const name = decodeURIComponent(req.url.split('/').pop()); return send({ [name]: { input: { required: { model_name: [weights] } } } }); }
  if (req.url === '/prompt') { const id = randomUUID(); queued.push(id); if (autoFinish) finished.add(id); return send({ prompt_id: id }); }
  if (req.url.startsWith('/history/')) { const id = req.url.split('/').pop(); return send(cancelled.has(id) ? { [id]: { status: { status_str: 'error' } } } : finished.has(id) ? { [id]: { status: { completed: true, status_str: 'success' }, outputs: { '1': { images: [{ filename: 'result.png', type: 'output', subfolder: '' }] } } } } : {}); }
  if (req.url.startsWith('/view')) { res.setHeader('content-type', 'image/png'); return res.end(png); }
  if (req.url === '/interrupt') { let body = ''; for await (const chunk of req) body += chunk; cancelled.add(JSON.parse(body).prompt_id); return send({}); }
  if (req.url === '/queue') return send({ queue_running: queued.filter(id => !finished.has(id) && !cancelled.has(id)).map(id => [0, id]), queue_pending: [] });
  res.statusCode = 404; send({});
});
const comfyUrl = await listen(comfy);
const remoteQueue = [], remoteResults = new Map();
let holdNextClaim = false, releaseClaim = null;
const key = 'test-shared-grant-key-long-enough';
const remote = createServer(async (req, res) => {
  upstreamCalls++;
  let text = ''; for await (const chunk of req) text += chunk;
  const body = JSON.parse(text || '{}');
  const send = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
  if (req.url === '/api/worker/register') {
    if (rejectRegister) { res.statusCode = 401; return send({ error: 'registration rejected' }); }
    return send({ workerToken: 'fixture-worker', grantKey: key });
  }
  if (req.url === '/api/worker/claim') {
    claims++;
    if (holdNextClaim) { holdNextClaim = false; await new Promise(resolve => { releaseClaim = resolve; }); }
    return send({ task: remoteQueue.shift() || null, grantKey: key });
  }
  const m = /^\/api\/worker\/tasks\/([^/]+)\/(complete|fail)$/.exec(req.url);
  if (m) remoteResults.set(m[1], { ...body, action: m[2] });
  return send({ ok: true });
});
const controlUrl = await listen(remote);
const dataDir = await mkdtemp(join(tmpdir(), 'novaflow-assistant-test-'));
const webRoot = join(dataDir, 'web'); await mkdir(webRoot); await writeFile(join(webRoot, 'index.html'), '<html><head></head><body>NovaFlow</body></html>');
const workflowDir = join(dataDir, 'workflows'); await mkdir(workflowDir);
await writeFile(join(workflowDir, 'qwen_t2i.json'), JSON.stringify({ comfy: 'image', bindings: {}, graph: { '1': { class_type: 'Fixture', inputs: {} } } }));
const license = { state: async () => ({ status: licensed ? 'licensed' : 'locked', machineId: 'fixture' }),
  assertAllowed: async () => { if (!licensed) throw Object.assign(new Error('license rejected'), { status: 403 }); }, importLicense: async () => { throw new Error('fixture'); } };
let serviceStarts = 0;
const services = { start: async () => { serviceStarts++; return [{ kind: 'image', running: true, reused: true }]; }, stop: async () => {} };
const assistant = await createLocalAssistant({ controlUrl, dataDir, configPath: join(dataDir, 'identity.json'), workflowDir, webRoot,
  localPort: 0, gatewayPort: 0, gatewayHost: '127.0.0.1', tunnel: false, workerName: 'assistant-test',
  comfyImageUrl: comfyUrl, comfyVideoUrl: comfyUrl, license, services, pollIntervalMs: 30 });
let origin, pairing;
const call = async (method, path, body, extra = {}) => {
  const r = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', 'x-novaflow-local': pairing, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
try {
  licensed = false;
  await assert.rejects(assistant.start(), /license rejected/);
  check(serviceStarts === 0, 'unbound machine cannot start runtimes');
  check(!assistant.getState().localRunning && !assistant.getState().workbenchUrl, 'unbound machine cannot start queue or workbench');
  check(upstreamCalls === 0, 'unbound machine cannot register or share');
  licensed = true;
  await assistant.start(); origin = assistant.getState().workbenchUrl; pairing = new URL(assistant.openUrl).hash.split('=')[1];
  check(serviceStarts === 1, 'binding permits retry on same assistant');
  check(assistant.getState().localRunning && !assistant.getState().sharing, 'local starts private');
  check(upstreamCalls === 0, 'local startup does not contact cloud');
  check((await fetch(origin + '/local/state')).status === 401, 'unpaired request denied');
  check((await call('GET', '/local/state', undefined, { Origin: 'https://foreign.example' })).status === 403, 'foreign origin denied');
  const rebound = await new Promise((resolve, reject) => {
    const req = request(origin + '/local/state', { headers: { Host: 'rebind.example', 'x-novaflow-local': pairing } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  check(rebound === 403, 'DNS rebinding denied');
  const html = await (await fetch(origin)).text();
  check(html.includes('localAssistant') && !html.includes(pairing), 'served page contains no pairing key');
  licensed = false;
  check((await call('POST', '/api/web/tasks', { task_type: 'qwen_t2i' })).status === 403, 'device license enforced in backend');
  licensed = true;
  const local = (await call('POST', '/api/web/tasks', { task_type: 'qwen_t2i', parameters: {} })).body.task;
  await wait(() => assistant.tasks.get(local.id).status === 'completed');
  check(upstreamCalls === 0, 'private generation never contacts cloud');
  {
    // the page's history shim turns created_at / completed_at into execution_start / execution_success,
    // which the resource card reads as its 生成用时: a local task carries both once it completes
    const done = (await call('GET', '/api/web/tasks/' + local.id)).body.task;
    const submitted = Date.parse(done.created_at), completed = Date.parse(done.completed_at);
    check(Number.isFinite(submitted) && Number.isFinite(completed) && completed >= submitted, 'a completed local task is stamped completed_at after created_at');
  }
  const grant = (await call('POST', '/api/web/tasks/' + local.id + '/grant', { op: 'download' })).body.grant;
  const name = assistant.tasks.get(local.id).output_manifest.files[0].name;
  const download = await fetch(grant.endpoint + '/gw/tasks/' + local.id + '/output/' + name, { headers: { 'x-novaflow-grant': grant.token } });
  check(Buffer.from(await download.arrayBuffer()).equals(png), 'local output roundtrip bytes match');
  check((await fetch(origin + '/gw/tasks/' + local.id + '/output/' + name)).status === 401, 'local output requires task grant');

  rejectRegister = true;
  await assert.rejects(assistant.startSharing(), /registration rejected/); checks++;
  check(assistant.getState().localRunning && !assistant.getState().sharing, 'failed share startup preserves private local service');
  rejectRegister = false;

  autoFinish = false;
  const shared = { id: randomUUID(), task_type: 'qwen_t2i', parameters: {} };
  remoteQueue.push(shared);
  await assistant.startSharing();
  await wait(() => assistant.getState().currentTaskId === shared.id && queued.length === 2);
  await assistant.stopSharing();
  check(!assistant.getState().draining && assistant.getState().localRunning, 'stop sharing cancels without closing local service');
  check(cancelled.has(queued[1]), 'running shared prompt interrupted immediately');
  const later = (await call('POST', '/api/web/tasks', { task_type: 'qwen_t2i', parameters: {} })).body.task;
  check(queued.length === 2, 'private and shared never run concurrently');
  autoFinish = true;
  await wait(() => assistant.tasks.get(later.id).status === 'completed');
  check(remoteResults.get(shared.id)?.action === 'fail' && remoteResults.get(shared.id)?.error_code === 'worker_stopped', 'stopped shared task fails without completion billing');
  check(!assistant.getState().draining && !assistant.getState().sharing, 'sharing finishes disabled');
  const previousClaims = claims;
  await new Promise(r => setTimeout(r, 150));
  check(claims === previousClaims, 'no new cloud claims after stop sharing');
  const sharedGrant = await issueGrantToken({ userId: 'fixture', taskId: shared.id, workerId: assistant.worker.identity.workerId, op: 'download' }, key);
  const wrong = await fetch(origin + '/gw/tasks/' + local.id + '/output/' + name, { headers: { 'x-novaflow-grant': sharedGrant } });
  check(wrong.status === 401 || wrong.status === 403, 'public grant cannot read private local output');
  check(JSON.parse(await readFile(join(dataDir, 'local-tasks.json'))).some(t => t.id === local.id && t.status === 'completed'), 'local history persisted');

  // While sharing is enabled, finish one shared job with BOTH queues waiting.
  autoFinish = false; const remote2 = { ...shared, id: randomUUID() }; remoteQueue.push(remote2);
  await assistant.startSharing();
  await wait(() => assistant.getState().currentTaskId === remote2.id && queued.length === 4);
  remoteQueue.push({ ...shared, id: randomUUID() });
  const priority = (await call('POST', '/api/web/tasks', { task_type: 'qwen_t2i', parameters: {} })).body.task;
  finished.add(queued[3]);
  await wait(() => assistant.getState().currentTaskId === priority.id && queued.length === 5);
  check(remoteQueue.length === 1, 'local waiting task takes priority over next shared job');
  await assistant.stopSharing(); autoFinish = true; finished.add(queued[4]);
  await wait(() => assistant.tasks.get(priority.id).status === 'completed');
  check(remoteQueue.length === 1, 'unclaimed public job remains available elsewhere');
  const finishedGrant = await issueGrantToken({ userId: 'fixture', taskId: remote2.id, workerId: assistant.worker.identity.workerId, op: 'download' }, key);
  const sharedFile = remoteResults.get(remote2.id).outputs[0].name;
  const sharedDownload = await fetch(assistant.worker.localEndpoint + '/gw/tasks/' + remote2.id + '/output/' + sharedFile, { headers: { 'x-novaflow-grant': finishedGrant } });
  check(Buffer.from(await sharedDownload.arrayBuffer()).equals(png), 'shared result remains downloadable after stopping sharing');
  autoFinish = false;
  const cancel = (await call('POST', '/api/web/tasks', { task_type: 'qwen_t2i', parameters: {} })).body.task;
  await wait(() => assistant.tasks.get(cancel.id).prompt_id);
  check((await call('POST', '/api/web/tasks/' + cancel.id + '/cancel')).status === 200, 'running private task can be cancelled');
  await wait(() => !assistant.getState().currentTaskId);
  check(assistant.tasks.get(cancel.id).status === 'cancelled', 'worker completion/failure cannot overwrite cancellation');

  const stopNow = (await call('POST', '/api/web/tasks', { task_type: 'qwen_t2i', parameters: {} })).body.task;
  await wait(() => assistant.tasks.get(stopNow.id).prompt_id);
  const stopQueued = (await call('POST', '/api/web/tasks', { task_type: 'qwen_t2i', parameters: {} })).body.task;
  await assistant.worker.stopLocal();
  check(cancelled.has(assistant.tasks.get(stopNow.id).prompt_id), 'local stop interrupts running prompt');
  check(assistant.tasks.get(stopNow.id).status === 'cancelled' && assistant.tasks.get(stopQueued.id).status === 'cancelled', 'local stop cancels active and queued work');
  await wait(() => !assistant.getState().currentTaskId);
  // A cold share does not depend on the editor or its machine license.
  remoteQueue.length = 0;
  const events = await fetch(origin + '/local/events', { headers: { 'x-novaflow-local': pairing } });
  const closedMessage = events.text();
  await assistant.stopLocal();
  check((await closedMessage).includes('data: closed'), 'closing local editor notifies its browser');
  check(!assistant.getState().localRunning && !assistant.getState().workbenchUrl, 'local stop closes its own endpoint');
  licensed = false;
  autoFinish = false;
  const independent = { ...shared, id: randomUUID() };
  remoteQueue.push(independent);
  await assistant.startSharing();
  await wait(() => assistant.getState().currentTaskId === independent.id && queued.at(-1));
  check(assistant.getState().sharing && !assistant.getState().localRunning, 'unlicensed machine shares without opening editor');
  await assert.rejects(assistant.start(), /license rejected/); checks++;
  check(assistant.getState().sharing, 'denied local startup preserves active share');
  licensed = true;
  const startsBeforeLocal = serviceStarts;
  await assistant.start();
  check(serviceStarts === startsBeforeLocal, 'local start reuses sharing runtime');
  await assistant.stopLocal();
  check(assistant.getState().sharing && assistant.getState().currentTaskId === independent.id, 'closing local leaves shared task running');
  await assistant.stopSharing();
  check(!assistant.getState().sharing && !assistant.getState().draining, 'share stops immediately while editor is closed');
  finished.add(queued.at(-1)); autoFinish = true;
  await wait(() => remoteResults.has(independent.id));
  check(remoteResults.get(independent.id).action === 'fail', 'independent shared job is cancelled by stop');
  await assistant.startSharing();
  check(assistant.getState().sharing && !assistant.getState().localRunning, 'share restarts independently after stop');
  await assistant.stopSharing();
  licensed = false;
  const coldDir = await mkdtemp(join(tmpdir(), 'novaflow-cold-share-test-'));
  const cold = await createLocalAssistant({ controlUrl, dataDir: coldDir,
    configPath: join(coldDir, 'identity.json'), workflowDir, gatewayPort: 0,
    gatewayHost: '127.0.0.1', tunnel: false, comfyImageUrl: comfyUrl, comfyVideoUrl: comfyUrl,
    license, services: { start: async () => [], stop: async () => {} }, pollIntervalMs: 30 });
  try {
    await cold.startSharing();
    check(cold.getState().sharing && !cold.getState().localRunning, 'fresh unlicensed assistant starts directly in sharing mode');
    check(!cold.getState().workbenchUrl, 'sharing-only startup creates no local editor endpoint');
  } finally { await cold.stop(); }
  // The configured port is held by somebody else's ComfyUI (no NovaFlow nodes: every /prompt is
  // refused) and the runtime started elsewhere: tasks go where the runtime reports it ended up.
  licensed = true;
  let foreignPrompts = 0;
  const foreign = createServer((req, res) => {
    if (req.url === '/system_stats') return res.end('{"system":{"argv":["ComfyUI\\\\main.py"]}}');
    if (req.url === '/prompt') foreignPrompts++;
    res.statusCode = 400; res.end('{"error":{"type":"missing_node_type"}}');
  });
  const foreignUrl = await listen(foreign);
  const movedDir = await mkdtemp(join(tmpdir(), 'novaflow-moved-runtime-test-'));
  const moved = await createLocalAssistant({ controlUrl, dataDir: movedDir, configPath: join(movedDir, 'identity.json'), workflowDir, webRoot,
    localPort: 0, gatewayPort: 0, gatewayHost: '127.0.0.1', tunnel: false, comfyImageUrl: foreignUrl, comfyVideoUrl: '',
    license, services: { start: async () => [{ kind: 'image', url: comfyUrl, running: true, reused: false }], stop: async () => {} }, pollIntervalMs: 30 });
  try {
    await moved.start();
    const movedPairing = new URL(moved.openUrl).hash.split('=')[1];
    const posted = await (await fetch(moved.getState().workbenchUrl + '/api/web/tasks', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-novaflow-local': movedPairing }, body: JSON.stringify({ task_type: 'qwen_t2i', parameters: {} }) })).json();
    await wait(() => ['completed', 'failed'].includes(moved.tasks.get(posted.task.id).status));
    check(moved.tasks.get(posted.task.id).status === 'completed' && foreignPrompts === 0, 'a runtime moved to another port takes the tasks, not the ComfyUI on the configured one');
  } finally { await moved.stop(); foreign.closeAllConnections(); foreign.close(); }
  licensed = false;
  holdNextClaim = true;
  await assistant.startSharing();
  await wait(() => releaseClaim);
  await assistant.stopSharing();
  check(!assistant.getState().draining && !assistant.getState().sharing, 'stop does not wait for an in-flight claim');
  const lateClaim = { ...shared, id: randomUUID() }; remoteQueue.push(lateClaim);
  releaseClaim(); releaseClaim = null;
  await wait(() => remoteResults.has(lateClaim.id));
  check(remoteResults.get(lateClaim.id).error_code === 'worker_stopped', 'late claim cannot start after stop');
  check(!assistant.getState().sharing, 'empty claim clears draining without re-enabling share');
} finally {
  releaseClaim?.();
  for (const id of queued) finished.add(id);
  await assistant.stop(); comfy.closeAllConnections(); remote.closeAllConnections(); comfy.close(); remote.close();
}
console.log(checks + ' passed, 0 failed: local assistant private/shared HTTP lifecycle');
