// 粒子特效 → Spine 工程: the package is packed the way 骨骼动画's is - the attachments' pictures in
// atlas pages from the shared packer (spine-sequence-atlas.js, the saved 图集打包设置), the
// skeleton as JSON or .skel (spine-binary-write.js) - and the dialog's web save writes the
// .skel in place of the .json.
//
//   node --test novaflow-web/tests/e2e/particle-spine-export-pack.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../renderer/spine-sequence-atlas.js';
import '../../renderer/spine-binary-write.js';
import { exportSpinePackage } from '../../renderer/assets/particle-spine-export.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAABAAAAAQCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAgAB/6X2XQAAAABJRU5ErkJggg==';
const sprite = (name) => ({ id: name + '-id', name, dataUrl: png, mode: 'single', weight: 1 });
const system = (name, sprites) => ({
  enabled: true, systemName: name, mode: 'burst', burstCount: 4,
  lifetimeMin: 1, lifetimeMax: 1, systemX: 0, systemY: 0,
  shape: { type: 'point', x: 0, y: 0 }, sizeStart: 32, sizeEnd: 32, opacityStart: 1, opacityEnd: 1, sprites
});

// every picture is a 32×32 with a filled 20×20 middle: trim shrinks the region, orig keeps the source
const decodeRgba = async () => {
  const width = 32, height = 32, rgba = new Uint8Array(width * height * 4);
  for (let y = 6; y < 26; y++) for (let x = 6; x < 26; x++) rgba.set([255, 128, 0, 255], (y * width + x) * 4);
  return { rgba, width, height };
};
const control = (patch) => { globalThis.__NovaFlowParticleSpineExport = { decodeRgba, settings: { maxWidth: 256, maxHeight: 256, paddingX: 2, paddingY: 2, trim: true, alphaThreshold: 2, scale: 100 }, ...patch }; };

function bootRuntime(source) {
  const sandbox = { console, TextDecoder, TextEncoder, Math, Float32Array, Int16Array, Uint16Array, Uint8Array, DataView, Map, Set, Error, setTimeout, atob, btoa };
  sandbox.globalThis = sandbox; sandbox.window = sandbox;
  vm.runInContext(source + '\n;this.__spine = typeof spine !== "undefined" ? spine : undefined', vm.createContext(sandbox));
  return sandbox.__spine;
}
const region = () => { const r = { u: 0, v: 0, u2: 1, v2: 1, width: 1, height: 1, originalWidth: 1, originalHeight: 1, offsetX: 0, offsetY: 0, rotate: false, degrees: 0, texture: null }; r.renderObject = r; return r; };
const loaderFor = (spine) => ({
  newRegionAttachment: (skin, name) => { const a = new spine.RegionAttachment(name); a.region = region(); return a; },
  newMeshAttachment: (skin, name) => { const a = new spine.MeshAttachment(name); a.region = region(); return a; },
  newBoundingBoxAttachment: (skin, name) => new spine.BoundingBoxAttachment(name),
  newPathAttachment: (skin, name) => new spine.PathAttachment(name),
  newPointAttachment: (skin, name) => new spine.PointAttachment(name),
  newClippingAttachment: (skin, name) => new spine.ClippingAttachment(name)
});
const atlasRegions = (atlas) => atlas.split('\n').filter((line) => line && !line.startsWith(' ') && !/^(size|format|filter|repeat|pma):/.test(line) && !line.endsWith('.png'));
const atlasPages = (atlas) => atlas.split('\n').filter((line) => line.endsWith('.png'));

test('the JSON package packs every used picture into one atlas page with the shared settings', async () => {
  control({ skel: false });
  const pkg = await exportSpinePackage([system('fire', [sprite('flame'), sprite('spark')])], '3.8', { exportName: '火花' });
  assert.deepEqual(atlasPages(pkg.atlas), ['火花.png'], 'one page named after the export');
  assert.deepEqual(pkg.images.map((image) => image.fileName), ['火花.png']);
  assert.match(pkg.images[0].dataUrl, /^data:image\/png;base64,/);
  assert.deepEqual(atlasRegions(pkg.atlas).sort(), ['火花_1', '火花_2'], 'both renamed sprites are regions');
  assert.match(pkg.atlas, /\n  size: 20, 20\n  orig: 32, 32\n  offset: 6, 6\n/, 'the region is trimmed to the painted middle, the source size kept');
  assert.equal(pkg.skel, undefined);
  const json = JSON.parse(pkg.json);
  assert.equal(json.skeleton.images, './', 'a packed package points at the atlas beside it');
  const attachments = Object.values(json.skins[0].attachments).flatMap((slot) => Object.values(slot));
  assert.ok(attachments.length >= 2 && attachments.every((a) => a.width === 32 && a.height === 32), 'attachments keep the picture size');
  const spine = bootRuntime(await readFile(new URL('../../renderer/vendor/spine/spine-webgl-3.8.js', import.meta.url), 'utf8'));
  const data = new spine.SkeletonJson(loaderFor(spine)).readSkeletonData(pkg.json);
  assert.ok(data.slots.length >= 1 && data.animations.length === 1, 'the official 3.8 runtime reads the packed skeleton');
});

test('scale and PMA come from the settings; a page that is too small splits', async () => {
  control({ skel: false, settings: { maxWidth: 64, maxHeight: 64, paddingX: 2, paddingY: 2, trim: false, scale: 50, premultiplyAlpha: true } });
  const pkg = await exportSpinePackage([system('many', [sprite('a'), sprite('b'), sprite('c'), sprite('d'), sprite('e'), sprite('f'), sprite('g'), sprite('h'), sprite('i'), sprite('j')])], '4.1', { exportName: 'pages' });
  assert.ok(atlasPages(pkg.atlas).length >= 2, 'ten 16px pictures do not fit one 64px page: ' + atlasPages(pkg.atlas).join(','));
  assert.equal(pkg.images.length, atlasPages(pkg.atlas).length);
  assert.match(pkg.atlas, /\n  size: 16, 16\n  orig: 16, 16\n/, 'scale 50% halves the atlas pixels');
  assert.match(pkg.atlas, /\npma: true\n/);
  const json = JSON.parse(pkg.json);
  const attachments = Object.values(json.skins[0].attachments).flatMap((slot) => Object.values(slot));
  assert.ok(attachments.every((a) => a.width === 32 && a.height === 32), 'the skeleton keeps the source size');
});

test('SKEL writes the chosen version as Spine binary that the official runtime reads', async () => {
  for (const version of ['3.8', '4.0', '4.1', '4.2']) {
    control({ skel: true });
    const pkg = await exportSpinePackage([system('fire', [sprite('flame'), sprite('spark')])], version, { exportName: 'bin' });
    assert.ok(pkg.skel instanceof Uint8Array && pkg.skel.length > 64, `${version}: .skel bytes`);
    assert.deepEqual(atlasPages(pkg.atlas), ['bin.png']);
    const runtimePath = version === '3.8' ? '../../renderer/vendor/spine/spine-webgl-3.8.js'
      : version === '4.0' ? '../../renderer/vendor/spine/spine-webgl-4.0.js'
        : `../fixtures/spine-runtimes/spine-core-${version === '4.1' ? '4.1.24' : '4.2.120'}.js`;
    const spine = bootRuntime(await readFile(new URL(runtimePath, import.meta.url), 'utf8'));
    const data = new spine.SkeletonBinary(loaderFor(spine)).readSkeletonData(pkg.skel);
    assert.ok(data.slots.length >= 1 && data.animations.length === 1, `${version}: the official runtime reads the binary`);
    // 单张 playback keeps one sprite per particle slot; every attachment it uses is an atlas region
    const names = [...new Set(data.skins[0].attachments.flatMap((slot) => Object.keys(slot || {})))];
    assert.ok(names.length >= 1 && names.every((name) => ['bin_1', 'bin_2'].includes(name)), `${version}: attachments are the atlas regions (${names.join(',')})`);
  }
});

test('the dialog save hands the .skel to the package writer in place of the .json', async () => {
  const html = await readFile(new URL('../../renderer/index.html', import.meta.url), 'utf8');
  const bundlePath = html.match(/src="\.\/(assets\/index-[^"]+\.js)\?/)[1];
  const bundle = await readFile(new URL(`../../renderer/${bundlePath}`, import.meta.url), 'utf8');
  const start = bundle.indexOf('handleExportSpinePackage:async()=>') + 'handleExportSpinePackage:'.length;
  const end = bundle.indexOf(',onProjectJsonPicked:', start);
  assert(start > 0 && end > start);
  const handler = bundle.slice(start, end);
  assert.match(handler, /e\.skel\?ks\(n,`\$\{a\}\.skel`/, 'the browser folder save writes .skel instead of .json when the package has one');
  control({ skel: true });
  let saved;
  const context = vm.createContext({
    n: [system('fire', [sprite('flame')])], t: { systemName: 'fire' }, Te: '烟火', T: '4.2',
    ze: (value) => value, we: () => {}, Je: () => 0,
    novaflowExportSpinePackage: exportSpinePackage,
    window: { electronAPI: { saveSpinePackage: async (payload) => { saved = payload; return { ok: true }; } } },
    alert: () => {}, console
  });
  assert.equal(await vm.runInContext(`(${handler})()`, context), true);
  assert.equal(saved.baseName, '烟火');
  assert.ok(saved.skel instanceof Uint8Array, 'the assistant save gets the binary skeleton');
  assert.deepEqual(saved.images.map((image) => image.fileName), ['烟火.png']);
  assert.ok(saved.atlas.includes('烟火.png'));
  delete globalThis.__NovaFlowParticleSpineExport;
});
