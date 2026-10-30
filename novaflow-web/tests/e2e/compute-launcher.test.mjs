import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
    if (name === 'node:os') return { hostname: () => 'fixture' };
    if (name === 'electron') return { app, BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      shell: { openExternal: async url => opened.push(url), openPath() {} }, dialog: {}, Tray: class {}, Menu: {} };
    throw Error(name);
  },
  async fixtureFactory(options) {
    let sharing = false;
    const instance = { options, onChange() {}, getState: () => ({ sharing }),
      async start() { sharing = true; }, async stop() { sharing = false; } };
    instances.push(instance); return instance;
  }
});
runInContext(await readFile(new URL('../../worker/electron/compute-main.cjs', import.meta.url), 'utf8'), sandbox);
runInContext('assistantFactory = fixtureFactory; show();', sandbox);
const call = (name, payload) => handlers.get('compute:' + name)({ sender: windows[0].webContents }, payload);
assert.equal(windows[0].file.endsWith('compute-ui.html'), true);
assert.equal(windows[0].options.webPreferences.sandbox, true);
assert.equal((await handlers.get('compute:connect')({ sender: {} })).ok, false);
assert.equal(instances.length, 0, 'untrusted renderer must not connect');
const connected = await call('connect');
assert.equal(connected.ok, true);
assert.equal(connected.state.operation, null, 'IPC cannot overwrite completed progress with a stale snapshot');
assert.equal(instances[0].options.rendererDir, path.join('C:/fixture/resources', 'compute-renderer'));
assert.equal(instances[0].options.license, undefined);
assert.equal(instances[0].options.webRoot, undefined);
assert.equal(config.registrationCode, '', 'successful registration clears the one-time code');
await call('website');
assert.deepEqual(opened, ['https://foart.net/']);
await call('pause');
assert.equal((await call('state')).paused, true);
await call('save', { workerName: 'updated', controlUrl: 'https://attacker.invalid', license: 'bypass' });
assert.equal(instances.at(-1).options.workerName, 'updated');
assert.equal(config.controlUrl, undefined, 'renderer cannot redirect platform credentials');
assert.equal(config.license, undefined);
assert.equal([...handlers.keys()].some(name => /license|Local/i.test(name)), false);
console.log('compute launcher: website-only entry, node lifecycle and narrow authenticated IPC passed');
