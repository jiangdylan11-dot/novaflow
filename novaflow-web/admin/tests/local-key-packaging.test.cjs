const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

test('admin package excludes secrets and uses external keys without replacing user data', async () => {
  const config = require('../electron-builder.json');
  assert.equal(config.files.includes('.secrets/license-private-key.pem'), false);
  assert.ok(config.files.includes('!**/.secrets/**'));
  assert.ok(config.files.includes('!**/*private-key*'));
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  const {FileMatcher} = require('app-builder-lib/out/fileMatcher');
  const appRoot = path.resolve(__dirname, '..');
  const filter = new FileMatcher(appRoot, appRoot, value => value, config.files).createFilter();
  const fileStat = {isDirectory: () => false};
  assert.equal(filter(path.join(appRoot, 'license-admin-gui', 'ipc.js'), fileStat), true);
  assert.equal(filter(path.join(appRoot, '.secrets', 'license-private-key.pem'), fileStat), false);
  assert.equal(filter(path.join(appRoot, 'admin-server', '.secrets', 'test.key'), fileStat), false);

  // All key material below is synthetic, generated solely in this task's temp directory.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foart-admin-key-test-'));
  const docs = path.join(root, 'docs');
  const base = path.join(docs, 'NovaFlow-License');
  const keys = path.join(base, 'keys');
  const publicKey = path.join(keys, 'license-public-key.b64');
  const privateKey = path.join(keys, 'license-private-key.pem');
  const license = path.join(root, 'test-license.nfl');
  const handlers = new Map();
  const fakeElectron = {
    ipcMain: {handle: (name, fn) => handlers.set(name, fn), on: () => {}},
    app: {getPath: name => name === 'documents' ? docs : root},
    dialog: {}, shell: {}, BrowserWindow: {}
  };
  const oldLoad = Module._load;
  const oldEnv = process.env.FOART_LICENSE_PRIVATE_KEY_PATH;
  let ipc;
  try {
    delete process.env.FOART_LICENSE_PRIVATE_KEY_PATH;
    Module._load = function (name, ...args) {
      return name === 'electron' ? fakeElectron : oldLoad.call(this, name, ...args);
    };
    ipc = require('../license-admin-gui/ipc.js');
    Module._load = oldLoad;
    ipc.registerLicenseAdminIpc();

    assert.equal(ipc.getDefaultPaths().privateKeyPath, privateKey);
    assert.equal(ipc.getDefaultPaths().publicKeyPath, publicKey);
    assert.equal(ipc.getDefaultPaths().verificationPublicKeyPath, path.resolve(__dirname, '../license-public-key.b64'));
    const defaultStatus = await handlers.get('admin-status')(null, {});
    assert.equal(defaultStatus.ok, true);
    assert.equal(defaultStatus.status.publicKeyPath, path.resolve(__dirname, '../license-public-key.b64'));
    const noKey = await handlers.get('admin-license-code')(null, {machineId:'test-machine'});
    assert.equal(noKey.ok, false);
    assert.match(noKey.error, /未找到本机签发私钥/);

    const core = require('../license-admin-core.js');
    core.generateKeyPair(publicKey, privateKey);
    assert.equal(ipc.getDefaultPaths().verificationPublicKeyPath, publicKey);
    const signed = await handlers.get('admin-issue-license')(null, {
      machineId:'test-machine', licenseKey:'test-license', outPath:license
    });
    assert.equal(signed.ok, true);
    assert.equal(core.verifyLicenseFile({licensePath:license, publicKeyPath:publicKey, machineId:'test-machine'}).ok, true);
    const verified = await handlers.get('admin-verify-license')(null, {licensePath:license, machineId:'test-machine'});
    assert.equal(verified.ok, true);
    assert.equal(verified.result.ok, true);

    process.env.FOART_LICENSE_PRIVATE_KEY_PATH = privateKey;
    assert.equal(ipc.getDefaultPaths().mode, 'configured');
    const configured = await handlers.get('admin-license-code')(null, {machineId:'test-machine'});
    assert.equal(configured.ok, true);
    process.env.FOART_LICENSE_PRIVATE_KEY_PATH = 'relative-key.pem';
    const invalid = await handlers.get('admin-license-code')(null, {machineId:'test-machine'});
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /绝对路径/);
    const explicit = await handlers.get('admin-license-code')(null, {machineId:'test-machine', privateKeyPath:privateKey});
    assert.equal(explicit.ok, true);
  } finally {
    Module._load = oldLoad;
    if (oldEnv === undefined) delete process.env.FOART_LICENSE_PRIVATE_KEY_PATH;
    else process.env.FOART_LICENSE_PRIVATE_KEY_PATH = oldEnv;
    for (const file of [license, publicKey, privateKey]) if (fs.existsSync(file)) fs.unlinkSync(file);
    for (const dir of [keys, base, docs, root]) if (fs.existsSync(dir)) fs.rmdirSync(dir);
  }
});
