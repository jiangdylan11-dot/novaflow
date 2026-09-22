// Exercise failed registration cleanup and the actual Electron IPC retry path.
import strictAssert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
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

// Load the unmodified Electron entry file with platform bindings stubbed.
// Drive its registered IPC handlers, just as the Start / Save buttons do.
const handlers = new Map(), instances = [], options = [];
let config = { controlUrl: 'https://control.test', registrationCode: 'bad-code' };
const fakeFs = {
  mkdirSync() {}, existsSync() { return true; }, appendFileSync() {},
  readFileSync() { return JSON.stringify(config); },
  writeFileSync(_file, data) { config = JSON.parse(data); }
};
let releaseStart;
const sandbox = createContext({
  __dirname: fileURLToPath(new URL('../../worker/electron/', import.meta.url)),
  process: { resourcesPath: '/resources' }, console,
  require(name) {
    if (name === 'node:path') return path;
    if (name === 'node:fs') return fakeFs;
    if (name === 'electron') return {
      app: { getPath() { return tmpdir(); }, whenReady() { return { then() {} }; }, on() {}, requestSingleInstanceLock() { return true; } },
      ipcMain: { handle(name, fn) { handlers.set(name, fn); } }, shell: {}, dialog: {}, BrowserWindow: class {}
    };
    throw new Error('unexpected require: ' + name);
  },
  factory(opts) {
    options.push(opts);
    const instance = { stopped: false, onChange() {}, getState() { return { status: 'idle' }; },
      async start() {
        if (opts.registrationCode === 'bad-code') throw new Error('registration rejected');
        await new Promise(resolve => { releaseStart = resolve; });
        return this.getState();
      },
      async startSharing() { return this.getState(); },
      async stop() { this.stopped = true; }
    };
    instances.push(instance);
    return instance;
  }
});
runInContext(await readFile(new URL('../../worker/electron/main.cjs', import.meta.url), 'utf8'), sandbox);
runInContext('createWorker = factory;', sandbox);
const start = handlers.get('worker:start');
assert.equal((await start()).ok, false);
assert.equal(instances[0].stopped, true);
await handlers.get('worker:setConfig')(null, { registrationCode: 'new-code' });
const pending = start();
await new Promise(resolve => setImmediate(resolve));
const concurrent = start();
releaseStart();
assert.equal((await pending).state.status, 'idle');
assert.equal((await concurrent).state.status, 'idle');
assert.equal(instances.length, 2);
assert.equal(options[1].registrationCode, 'new-code');
assert.equal(config.registrationCode, 'new-code');
assert.equal((await handlers.get('worker:share')()).ok, true);
assert.equal(config.registrationCode, '');
console.log(checks + ' passed, 0 failed: registration failure cleanup and Electron retry');
