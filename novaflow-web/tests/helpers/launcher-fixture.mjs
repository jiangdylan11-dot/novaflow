// Test-only Electron bindings. No real license, runtime, network registration,
// browser launch, or user configuration is read or modified by this fixture.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { tmpdir } from 'node:os';

export async function createLauncherFixture() {
  const handlers = new Map(), instances = [], windows = [], opened = [], events = [];
  const app = new EventEmitter();
  Object.assign(app, { getPath: () => tmpdir(), getVersion: () => '0.4.11', setPath(name, value) { this[name] = value; }, whenReady: () => ({ then() {} }), requestSingleInstanceLock: () => true,
    quit() { this.emit('before-quit'); this.quitCalled = true; } });
  const fixture = { config: { controlUrl: 'https://control.test', registrationCode: 'test-node' },
    licenseState: { status: 'unlicensed', locked: true, machineId: 'TEST-MACHINE-ONLY' },
    localFailure: false, fileCanceled: true, handlers, instances, windows, opened, events, app };
  const license = {
    state: async () => fixture.licenseState,
    async importLicense(text) {
      if (text !== 'test-only-license') throw new Error('测试授权内容无效');
      fixture.licenseState = { ...fixture.licenseState, status: 'licensed', locked: false };
      return fixture.licenseState;
    }
  };
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options;
      this.webContents = { send: (name, value) => events.push({ name, value }) };
      windows.push(this);
    }
    loadFile() {}
    hide() { this.hidden = true; }
    show() { this.hidden = false; }
    minimize() { this.minimized = true; }
    isMinimized() { return !!this.minimized; }
    restore() { this.minimized = false; }
    focus() { this.focused = true; }
    isDestroyed() { return false; }
  }
  class FakeTray extends EventEmitter {
    constructor() { super(); fixture.tray = this; }
    setToolTip(text) { this.tooltip = text; }
    setContextMenu(menu) { this.menu = menu; }
  }
  const fakeFs = {
    mkdirSync() {}, existsSync() { return true; }, appendFileSync() {},
    readFileSync: file => JSON.stringify(String(file).endsWith('identity.json') ? fixture.identity || {} : fixture.config),
    writeFileSync: (_file, data) => { fixture.config = JSON.parse(data); },
    promises: { readFile: async () => 'test-only-license' }
  };
  const sandbox = createContext({
    __dirname: fileURLToPath(new URL('../../worker/electron/', import.meta.url)),
    process: { resourcesPath: '/test-resources' }, console, license,
    require(name) {
      if (name === 'node:path') return path;
      if (name === 'node:fs') return fakeFs;
      if (name === 'electron') return {
        app,
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
        shell: { openExternal: async url => { opened.push(url); } },
        dialog: { showOpenDialog: async () => ({ canceled: fixture.fileCanceled, filePaths: ['test-fixture.nfl'] }) },
        BrowserWindow: FakeWindow, Tray: FakeTray, Menu: { buildFromTemplate: items => items }
      };
      throw new Error('Unexpected fixture import: ' + name);
    },
    factory(opts) {
      let localRunning = false, sharing = false;
      const instance = { stopped: false, onChange() {},
        getState: () => ({ localRunning, sharing, version: '0.4.4', status: localRunning || sharing ? 'idle' : 'offline' }),
        openUrl: 'http://127.0.0.1:4784/#local-pair=test-only',
        async start() {
          if (fixture.localFailure) throw new Error('Local fixture failure');
          localRunning = true; return this.getState();
        },
        async startSharing(settings) {
          if ((settings?.registrationCode ?? opts.registrationCode) === 'bad-code') throw new Error('Registration rejected');
          sharing = true; return this.getState();
        },
        async stopLocal() { localRunning = false; return this.getState(); },
        async stopSharing() { sharing = false; return this.getState(); },
        async stop() { this.stopped = true; localRunning = false; sharing = false; }
      };
      instances.push(instance); return instance;
    }
  });
  runInContext(await readFile(new URL('../../worker/electron/main.cjs', import.meta.url), 'utf8'), sandbox);
  runInContext('createWorker = factory; localLicense = license; createWindow(); createTray();', sandbox);
  fixture.call = (name, payload) => handlers.get('worker:' + name)({ sender: windows[0].webContents }, payload);
  return fixture;
}
