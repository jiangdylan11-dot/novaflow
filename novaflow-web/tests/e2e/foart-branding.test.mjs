import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { syncBrandAssets } from '../../tools/sync-brand-assets.mjs';
import { RELEASE_VERSION } from '../../packages/shared/src/release.mjs';

const read = path => readFile(new URL('../../' + path, import.meta.url), 'utf8');

test('all application surfaces receive the approved foart artwork', async () => {
  await syncBrandAssets({ check: true });
  const ico = await readFile(new URL('../../branding/foart-app-icon.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const at = 6 + i * 16;
    sizes.push(ico[at] || 256);
    assert(ico.readUInt32LE(at + 12) + ico.readUInt32LE(at + 8) <= ico.length);
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 96, 128, 256]);
  const wordmark = await readFile(new URL('../../branding/foart-brush-wordmark.png', import.meta.url));
  const brushF = await readFile(new URL('../../branding/foart-brush-f.png', import.meta.url));
  for (const theme of ['dark', 'light']) {
    const svg = await read(`branding/foart-logo-${theme}.svg`);
    assert(svg.includes(`base64,${wordmark.toString('base64')}`), 'wordmark preserves the approved brush texture');
    assert.doesNotMatch(svg, /<text|font-family/i, 'wordmark has no installed-font dependency');
    if (theme === 'light') assert.match(svg, /#252424/);
  }
  const primaryIcon = await read('branding/foart-app-icon.svg');
  assert.match(primaryIcon, /rx="105" fill="#242424"/);
  assert(primaryIcon.includes(`base64,${brushF.toString('base64')}`), 'app icon uses only the standalone brush F');
  const adminIcon = await read('branding/foart-admin-icon.svg');
  assert(adminIcon.includes(`base64,${brushF.toString('base64')}`), 'admin keeps the exact same F shape');
  assert.match(primaryIcon, /values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/);
  assert.doesNotMatch(adminIcon, /filter="url\(#white-ink\)"/);
  const adminLogo = await read('branding/foart-admin-logo.svg');
  assert(adminLogo.includes(`base64,${wordmark.toString('base64')}`));
  assert.match(adminLogo, /filter="url\(#white-ink\)"/);
  const contact = await read('branding/foart-contact.svg');
  const originalQr = await readFile(new URL('../../renderer/assets/QR.png', import.meta.url));
  assert(contact.includes(`base64,${originalQr.toString('base64')}`), 'contact artwork preserves the exact scannable QR raster');
});

test('product rename keeps license, protocol and persisted configuration identities', async () => {
  const worker = JSON.parse(await read('worker/electron-builder.json'));
  assert.equal(worker.productName, 'Foart');
  assert.equal(worker.executableName, 'Foart');
  assert.equal(worker.appId, 'com.novaflow.worker');
  assert.deepEqual(worker.protocols[0].schemes, ['novaflow']);
  assert.equal(worker.fileAssociations[0].ext, 'nfproj');
  assert.equal(worker.nsis.shortcutName, 'Foart');
  const adminPackage = JSON.parse(await read('admin/electron-builder.json'));
  assert(adminPackage.files.includes('build/foart-logo-dark.svg'), 'admin installer must include its new wordmark');
  assert(adminPackage.files.includes('build/foart-admin-brush.ico'), 'admin installer must include the white brush icon');
  assert.equal(adminPackage.win.icon, 'build/foart-admin-brush.ico');
  assert.equal(worker.win.icon, 'electron/assets/foart-brush.ico');
  const main = await read('worker/electron/main.cjs');
  assert.match(main, /'NovaFlow UI Trial' : 'NovaFlow Worker'/);
  assert.match(main, /licenseDataDir: path.join\(app.getPath\('appData'\), 'NovaFlow'\)/);
  const admin = await read('admin/admin-main.js');
  assert.match(admin, /"novaflow-license-manager"/);
  assert.match(admin, /title: "Foart 后台管理"/);
  assert.match(await read('admin/license-admin-core.js'), /payload\?\.product !== "NovaFlow"/);
  const runtime = await read('renderer/novaflow-web-runtime.js');
  assert.match(runtime, /novaflow_web_session_v1/);
  for (const file of ['package.json', 'worker/package.json', 'web/package.json']) assert.equal(JSON.parse(await read(file)).version, RELEASE_VERSION);
  for (const file of ['supabase/functions/novaflow-web/release.mjs', 'supabase/functions/_art-shared/release.mjs']) assert((await read(file)).includes(`"${RELEASE_VERSION}"`));
});

test('built webpage uses foart from first paint through login', async () => {
  assert.match(await read('web-dist/index.html'), /<title>Foart<\/title>/);
  assert.match(await read('web-dist/index.html'), /assets\/foart-logo-dark\.svg/);
  assert.equal(JSON.parse(await read('web-dist/release.json')).product, 'Foart');
  const login = (await read('web-dist/novaflow-web-account.js')).replace(/\\u([0-9a-f]{4})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
  assert.match(login, /Foart 游戏美术创作工作台/);
  assert.match(login, /foart-logo-dark\.svg/);
});
