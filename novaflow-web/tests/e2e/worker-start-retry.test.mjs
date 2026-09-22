// Exercise failed registration cleanup and the actual Electron IPC retry path.
import strictAssert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createWorker } from '../../worker/src/worker-core.mjs';
const require = createRequire(import.meta.url);
const { createLicenseGate } = require('../../worker/electron/license-window.cjs');
const { renderLicenseLockScreenHtml } = require('../../../particle-editor-desktop/license/licenseLockScreen.js');

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
const windows = [];
let licenseState = { status: 'licensed', locked: false, machineId: 'TEST-MACHINE' };
const license = {
  state: async () => licenseState,
  renderLockScreen: renderLicenseLockScreenHtml,
  async importLicense(text) {
    if (text !== 'valid-fixture') throw new Error('invalid fixture license');
    licenseState = { ...licenseState, status: 'licensed', locked: false };
    return licenseState;
  }
};
class FakeWindow extends EventEmitter {
  constructor(opts) {
    super(); this.options = opts;
    this.webContents = new EventEmitter();
    this.webContents.setWindowOpenHandler = () => {};
    windows.push(this);
  }
  loadURL(url) { this.html = decodeURIComponent(url.split(',').slice(1).join(',')); return Promise.resolve(); }
  focus() {}
  close() { this.emit('closed'); }
  destroy() { this.close(); }
}
let config = { controlUrl: 'https://control.test', registrationCode: 'bad-code' };
const fakeFs = {
  mkdirSync() {}, existsSync() { return true; }, appendFileSync() {},
  readFileSync() { return JSON.stringify(config); },
  writeFileSync(_file, data) { config = JSON.parse(data); }
};
let releaseStart;
const sandbox = createContext({
  __dirname: fileURLToPath(new URL('../../worker/electron/', import.meta.url)),
  process: { resourcesPath: '/resources' }, console, license,
  require(name) {
    if (name === 'node:path') return path;
    if (name === 'node:fs') return fakeFs;
    if (name === './license-window.cjs') return { createLicenseGate };
    if (name === 'electron') return {
      app: { getPath() { return tmpdir(); }, whenReady() { return { then() {} }; }, on() {}, requestSingleInstanceLock() { return true; } },
      ipcMain: { handle(name, fn) { handlers.set(name, fn); } }, shell: {},
      dialog: { async showOpenDialog() { return { canceled: true }; } }, BrowserWindow: FakeWindow
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
runInContext('createWorker = factory; localLicense = license;', sandbox);
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
await handlers.get('worker:stop')();
licenseState = { ...licenseState, status: 'unlicensed', locked: true };
const cancelled = start();
await new Promise(resolve => setImmediate(resolve));
assert.equal(instances.length, 2); // No runtime instance before binding.
assert.equal(windows.length, 1);
assert.match(windows[0].html, /TEST-MACHINE/);
assert.match(windows[0].html, /导入 license.nfl/);
assert.match(windows[0].html, /粘贴导入/);
assert.equal(windows[0].options.modal, true);
windows[0].close();
assert.equal((await cancelled).canceled, true);
assert.equal(instances.length, 2);
const retryBinding = start();
const sameAttempt = start();
await new Promise(resolve => setImmediate(resolve));
assert.equal(windows.length, 2);
const event = { sender: windows[1].webContents };
assert.equal((await handlers.get('assistant-license:continue')({ sender: {} })).ok, false);
assert.equal((await handlers.get('assistant-license:continue')(event)).ok, false);
assert.equal((await handlers.get('assistant-license:importFile')(event)).canceled, true);
assert.equal((await handlers.get('assistant-license:importText')(event, { text: 'invalid-fixture' })).ok, false);
assert.equal(instances.length, 2);
assert.equal((await handlers.get('assistant-license:machine')(event)).machineId, 'TEST-MACHINE');
assert.equal((await handlers.get('assistant-license:importText')(event, { text: 'valid-fixture' })).ok, true);
assert.equal((await handlers.get('assistant-license:continue')(event)).ok, true);
await new Promise(resolve => setImmediate(resolve));
releaseStart();
assert.equal((await retryBinding).ok, true);
assert.equal((await sameAttempt).ok, true);
assert.equal(instances.length, 3);
// A stale success-shaped but locked state still cannot start.
await handlers.get('worker:stop')();
licenseState = { ...licenseState, locked: true, reason: 'remote_banned' };
const locked = start();
await new Promise(resolve => setImmediate(resolve));
assert.equal(instances.length, 3);
assert.equal(windows.length, 3);
const stopDuringBinding = handlers.get('worker:stop')();
assert.equal((await locked).canceled, true);
assert.equal((await stopDuringBinding).ok, true);
// Closing the launcher during a slow online check must not open a late modal.
let releaseLicense;
license.state = () => new Promise(resolve => { releaseLicense = resolve; });
const checking = start();
await new Promise(resolve => setImmediate(resolve));
const stopChecking = handlers.get('worker:stop')();
releaseLicense(licenseState);
assert.equal((await checking).canceled, true);
assert.equal((await stopChecking).ok, true);
assert.equal(windows.length, 3);
license.state = async () => licenseState;
// Settings uses the same binding screen without requiring local services.
const inspectLicense = handlers.get('worker:license')();
await new Promise(resolve => setImmediate(resolve));
assert.equal(windows.length, 4);
assert.equal(instances.length, 3);
windows[3].close();
assert.equal((await inspectLicense).state.locked, true);
console.log(checks + ' passed, 0 failed: registration failure cleanup and Electron retry');
