// Exercise failed registration cleanup and the actual Electron IPC retry path.
import strictAssert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorker } from '../../worker/src/worker-core.mjs';

let checks = 0;
const assert = new Proxy(strictAssert, { get(target, key) {
  const fn = target[key];
  return typeof fn === 'function' ? (...args) => { checks++; return fn(...args); } : fn;
} });
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
let rejectRegistration = true, registrations = 0;
const control = createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  let body = { ok: true }, status = 200;
  if (req.url === '/system_stats') body = { system: {}, devices: [] };
  if (req.url === '/api/worker/register') {
    registrations++;
    if (rejectRegistration) { status = 401; body = { error: 'missing session token' }; }
    else body = { workerToken: 'fixture-token', grantKey: 'fixture-key' };
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
});
await listen(control);
const base = 'http://127.0.0.1:' + control.address().port;
const probe = createServer();
await listen(probe);
const gatewayPort = probe.address().port;
await close(probe);
const dir = await mkdtemp(path.join(tmpdir(), 'nf-start-retry-'));
const worker = createWorker({ controlUrl: base, dataDir: dir, configPath: path.join(dir, 'identity.json'),
  workflowDir: '', comfyImageUrl: base, comfyVideoUrl: base, gatewayPort, gatewayHost: '127.0.0.1',
  tunnel: false, pollIntervalMs: 60000, logger() {} });
try {
  await assert.rejects(Promise.all([worker.start(), worker.start()]), /注册码/);
  assert.equal(registrations, 1);
  assert.equal(worker.getState().status, 'offline');
  assert.match(worker.getState().lastError, /云端没有此节点/);
  assert.equal(worker.getState().endpointUrl, '');
  // Binding the exact same port proves that the failed startup released it.
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(gatewayPort, '127.0.0.1', resolve); });
  assert.equal(probe.address().port, gatewayPort);
  await close(probe);
  rejectRegistration = false;
  const retried = await worker.start();
  assert.equal(registrations, 2);
  assert.equal(retried.status, 'idle');
  assert.equal(retried.lastError, '');
} finally {
  await worker.stop();
  await close(control);
  await rm(dir, { recursive: true, force: true });
}

console.log(checks + ' passed, 0 failed: registration failure cleanup');
