import test from 'node:test';
import assert from 'node:assert/strict';
import { createBorrowedRuntimeServices } from '../../worker/src/borrowed-runtime-services.mjs';
import { writeConfig, readConfig } from '../../tools/set-web-config.mjs';

test('parallel trial observes only loopback runtimes and never unloads or starts them', async () => {
  const requests = [];
  const service = createBorrowedRuntimeServices({ fetchImpl: async (url, init) => { requests.push({ url, method: init.method }); return { ok: true }; } });
  assert.equal((await service.start())[0].running, true);
  await service.stop();
  assert.deepEqual(requests, [{ url: 'http://127.0.0.1:8188/system_stats', method: 'GET' }]);
  const offline = createBorrowedRuntimeServices({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await offline.start())[0].running, false);
  await offline.stop();
  assert.throws(() => createBorrowedRuntimeServices({ imageUrl: 'https://example.com' }), /loopback/);
});

test('site configuration refuses the compute control function as the account login service', () => {
  const html = 'window.NOVAFLOW_WEB_CONFIG = window.NOVAFLOW_WEB_CONFIG || { controlUrl: "https://host/functions/v1/novaflow-web", authUrl: "https://host/functions/v1/novaflow-backend" };';
  assert.throws(() => writeConfig(html, { authUrl: 'https://host/functions/v1/novaflow-web' }), /账号认证地址/);
  assert.equal(readConfig(writeConfig(html, { controlUrl: 'https://host/functions/v1/novaflow-web' })).authUrl, 'https://host/functions/v1/novaflow-backend');
});

// Electron lifecycle is exercised through the existing fake bindings, never a real window.
test('trial launcher keeps its own profile and ports and preserves stable runtime files', async () => {
  const { createLauncherFixture } = await import('../helpers/launcher-fixture.mjs');
  const f = await createLauncherFixture({ localUiTrial: true });
  assert.deepEqual(f.removed, []);
  assert.equal(f.app.userData.endsWith('NovaFlow UI Trial'), true);
  assert.equal(f.tray.tooltip, 'NovaFlow UI 本地试用版');
  assert.equal(f.windows[0].options.title, 'NovaFlow UI 本地试用版');
  f.licenseState = { status: 'licensed', locked: false };
  const results = await Promise.all([f.call('start'), f.call('start')]);
  assert.equal(results.every(r => r.ok), true);
  assert.equal(f.opened.length, 1);
  assert.equal(f.instances[0].options.localPort, 4785);
  assert.equal(f.instances[0].options.gatewayPort, 8897);
  assert.equal(f.instances[0].options.runtimePolicy, 'existing-only');
  await f.tray.menu.find(item => item.label === '退出本地助手').click();
  assert.deepEqual(f.removed, []);
});
