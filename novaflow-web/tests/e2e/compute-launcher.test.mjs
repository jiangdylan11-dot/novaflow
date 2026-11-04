import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const requireTelemetry = createRequire(import.meta.url);

const handlers = new Map(), opened = [], instances = [], windows = [];
let config = { workerName: 'fixture-node', registrationCode: 'test-code' };
const app = Object.assign(new EventEmitter(), { setName() {}, setAppUserModelId() {}, setPath() {},
  getPath: () => 'C:/fixture', getVersion: () => 'test-version', isPackaged: true,
  whenReady: () => ({ then() {} }), requestSingleInstanceLock: () => true, quit() {} });
class Window extends EventEmitter {
  constructor(options) { super(); this.options = options; this.webContents = { send() {}, setWindowOpenHandler() {}, on() {} }; windows.push(this); }
  loadFile(value) { this.file = value; } show() {} focus() {} isDestroyed() { return false; }
}
const fs = { mkdirSync() {}, appendFileSync() {}, existsSync: () => true,
  readFileSync: () => JSON.stringify(config), writeFileSync(_file, value) { config = JSON.parse(value); } };
const sandbox = createContext({ __dirname: 'C:/fixture/app/electron', process: { env: {}, resourcesPath: 'C:/fixture/resources' },
  require(name) {
    if (name === 'node:fs') return fs;
    if (name === 'node:path') return path;
    if (name === 'node:url') return { pathToFileURL };
    if (name === 'node:os') return { hostname: () => 'fixture', totalmem: () => 16 * 1024 ** 3, freemem: () => 4 * 1024 ** 3, cpus: () => [{times:{user:1,nice:0,sys:0,idle:1,irq:0}}] };
    if (name === 'node:child_process') return { execFile: (_exe, _args, _options, callback) => callback(null, 'Test GPU, 2048, 8192, 55, 18') };
    if (name === '../src/resource-telemetry.cjs') return requireTelemetry('../../worker/src/resource-telemetry.cjs');
    if (name === 'electron') return { app, BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      shell: { openExternal: async url => opened.push(url), openPath() {} }, dialog: {}, Tray: class {}, Menu: {} };
    throw Error(name);
  },
  async fixtureFactory(options) {
    let sharing = false;
    const instance = { options, onChange() {}, getState: () => ({ sharing }), worker: { releaseIdleModels: async () => ({ ok: true, code: 'release-requested', requested: 1 }) },
      async start() { sharing = true; }, async stop() { sharing = false; } };
    instances.push(instance); return instance;
  }
});
// The launcher is exercised in a VM with fixture paths, where Node's dynamic
// import requires experimental VM modules. Resolve the actual packaged policy
// here and replace only that import in the fixture, so missing policy files and
// unsafe default flags still fail the test.
sandbox.fixtureRotationPolicy = await import(new URL('../../worker/src/qwen-rotation-release-policy.mjs', import.meta.url));
const launcherSource = await readFile(new URL('../../worker/electron/compute-main.cjs', import.meta.url), 'utf8');
const policyImport = "import(pathToFileURL(path.join(__dirname, '../src/qwen-rotation-release-policy.mjs')).href)";
assert.equal(launcherSource.split(policyImport).length, 2, 'launcher must load the managed rotation policy once');
runInContext(launcherSource.replace(policyImport, 'Promise.resolve(fixtureRotationPolicy)'), sandbox);
runInContext('assistantFactory = fixtureFactory; show();', sandbox);
const call = (name, payload) => handlers.get('compute:' + name)({ sender: windows[0].webContents }, payload);
assert.equal(windows[0].file.endsWith('compute-ui.html'), true);
assert.equal(windows[0].options.webPreferences.sandbox, true);
assert.equal(windows[0].options.titleBarStyle, 'hidden');
assert.equal(windows[0].options.width, 560);
assert.equal(windows[0].options.height, 480);
assert.equal(windows[0].options.resizable, false);
assert.equal(windows[0].options.maximizable, false);
assert.equal(windows[0].options.fullscreenable, false);
assert.equal((await call('freeMemory')).ok, false);
assert.equal((await handlers.get('compute:freeMemory')({ sender: {} })).ok, false);
assert.equal(instances.length, 0, 'untrusted renderer must not connect');
const connected = await runInContext('serial(connect)', sandbox);
assert.equal(connected.ok, true, JSON.stringify(connected));
assert.equal((await call('state')).operation, null, 'automatic startup clears progress');
assert.equal(instances[0].options.rendererDir, path.join('C:/fixture/resources', 'compute-renderer'));
assert.equal(instances[0].options.license, undefined);
assert.equal(instances[0].options.webRoot, undefined);
assert.equal(instances[0].options.registrationCode, undefined, 'old saved codes are not sent');
assert.equal(instances[0].options.workerName, 'foart-fixture', 'initial name is automatic');
assert.equal(instances[0].options.qwenRotationVerificationEnabled, false, 'rotation verification stays closed by default');
assert.equal(instances[0].options.qwenRotationCandidateEnabled, false, 'rotation candidates stay closed by default');
assert.equal((await call('freeMemory')).ok, true);
assert.equal((await call('state')).resources.ram.used, 12 * 1024 ** 3);
assert.equal((await call('state')).resources.vram.used, 2048 * 1024 ** 2);
await call('website');
assert.deepEqual(opened, ['https://foart.net/']);
await runInContext('serial(stop)', sandbox);
assert.equal((await call('state')).paused, true);
assert.equal(['config', 'save', 'models', 'connect', 'pause'].some(name => handlers.has('compute:' + name)), false, 'no user settings or manual connection controls');
assert.equal([...handlers.keys()].some(name => /license|Local/i.test(name)), false);
console.log('compute launcher: website-only entry, node lifecycle and narrow authenticated IPC passed');
