import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
require('../../renderer/spine-version-convert.js');
require('../../renderer/spine-binary-write.js');
require('../../renderer/spine-sequence-atlas.js');
const V = globalThis.NovaFlowSpineVersion, B = globalThis.NovaFlowSpineBinary, A = globalThis.NovaFlowSequenceAtlas;
const context = vm.createContext({ console, Math, Float32Array, Int16Array, Uint16Array, setTimeout });
// Official 3.7.94 runtime: https://github.com/EsotericSoftware/spine-runtimes/blob/3.7.94/spine-ts/build/spine-webgl.js
vm.runInContext(readFileSync(new URL('../fixtures/spine-runtimes/spine-webgl-3.7.94.js', import.meta.url), 'utf8'), context);
const S = context.spine;
const loader = {
  newRegionAttachment: (_skin, name) => { const a = new S.RegionAttachment(name); a.region = { u: 0, v: 0, u2: 1, v2: 1, width: 16, height: 16, originalWidth: 16, originalHeight: 16, offsetX: 0, offsetY: 0 }; return a; },
  newMeshAttachment: (_skin, name) => { const a = new S.MeshAttachment(name); a.region = { u: 0, v: 0, u2: 1, v2: 1, width: 16, height: 16, originalWidth: 16, originalHeight: 16 }; return a; },
  newBoundingBoxAttachment: (_skin, name) => new S.BoundingBoxAttachment(name),
  newPathAttachment: (_skin, name) => new S.PathAttachment(name),
  newPointAttachment: (_skin, name) => new S.PointAttachment(name),
  newClippingAttachment: (_skin, name) => new S.ClippingAttachment(name),
};
const read = json => new S.SkeletonJson(loader).readSkeletonData(JSON.parse(JSON.stringify(json)));
const fixture = () => ({
  skeleton: { spine: '3.8.99', width: 16, height: 16, images: 'images/' },
  bones: [{ name: 'root' }, { name: 'child', parent: 'root', x: 8 }],
  slots: [{ name: 'slot', bone: 'child', attachment: 'picture' }],
  ik: [{ name: 'ik', bones: ['child'], target: 'root', softness: 2 }],
  path: [{ name: 'follow', bones: ['child'], target: 'slot' }],
  skins: [{ name: 'default', attachments: { slot: { picture: { width: 16, height: 16 } } } },
    { name: 'alternate', attachments: { slot: { picture: { path: 'alt', width: 16, height: 16 } } } },
    { name: 'empty', attachments: {} }],
  events: { hit: { int: 3, string: 'hello' } },
  animations: { move: {
    bones: { root: { translate: [{ x: 0, y: 0, curve: 0.2, c2: 0, c3: 0, c4: 1 }, { time: 1, x: 24, y: 12 }],
      rotate: [{}, { time: 1, angle: 20 }], scale: [{}, { time: 1, x: 1.2 }] } },
    slots: { slot: { attachment: [{ name: 'picture' }, { time: 1, name: null }] } },
    ik: { ik: [{ mix: 0.5, softness: 2, curve: 'stepped' }, { time: 1, mix: 1 }] },
    path: { follow: { position: [{ position: 0 }, { time: 1, position: 10 }] } },
    events: [{ time: 0.5, name: 'hit' }], drawOrder: [{ time: 0.5 }],
  } },
});

test('3.7.94 JSON loads in the official runtime and preserves curves, skins and events', () => {
  const source = fixture(), original = structuredClone(source), json = V.fromSpine38(source, '3.7.94');
  assert.deepEqual(source, original);
  assert(V.TARGETS.includes('3.7'));
  assert.equal(json.skeleton.spine, '3.7.94');
  assert.deepEqual(json.animations.move.bones.root.translate[0].curve, [0.2, 0, 0, 1]);
  assert.equal('softness' in json.ik[0], false);
  assert.deepEqual(json.animations.move.bones.root.rotate[0], { time: 0, angle: 0 });
  assert.deepEqual(json.animations.move.bones.root.scale[0], { time: 0, x: 1, y: 1 });
  assert.deepEqual(json.animations.move.paths.follow.position[0], { time: 0, position: 0 });
  assert.equal('path' in json.animations.move, false);
  const data = read(json);
  assert.equal(data.skins.length, 3);
  assert.equal(data.events.length, 1);
  assert.equal(data.findAnimation('move').duration, 1);
  const imported = V.toSpine38(json);
  assert.deepEqual(imported.animations.move.path, json.animations.move.paths);
  assert.equal(imported.nfSpine3, '3.7.94');
  assert.equal(V.fromSpine38(imported).skeleton.spine, '3.7.94');
  assert.deepEqual(V.fromSpine38(imported, '3.7'), json);
  assert.equal('nfSpine3' in V.fromSpine38(imported, '4.2'), false);
  const bytes = B.write(json, '3.7');
  assert(Buffer.from(bytes).includes(Buffer.from('3.7.94')));
  assert.deepEqual(bytes, B.write37(json));
  // Optional output for official libGDX JSON/SKEL playback comparison (Spine37Readback.java).
  if (process.env.NOVAFLOW_SPINE37_OUTPUT) {
    mkdirSync(process.env.NOVAFLOW_SPINE37_OUTPUT, { recursive: true });
    writeFileSync(`${process.env.NOVAFLOW_SPINE37_OUTPUT}/fixture.json`, JSON.stringify(json));
    writeFileSync(`${process.env.NOVAFLOW_SPINE37_OUTPUT}/fixture.skel`, bytes);
  }
});

test('3.7.94 sequences export compatible JSON and atlas through the shared writer', async () => {
  for (const packed of [false, true]) for (const custom of [false, true]) {
    const files = new Map(), writer = A.createWriter({ baseName: 'picture', version: '3.7', packed, fps: 10,
      settings: { maxWidth: 64, maxHeight: 64 }, write: async (name, data) => files.set(name, data) });
    const rgba = new Uint8Array(16 * 16 * 4).fill(255);
    await writer.addRgba(rgba, 16, 16, custom ? 'picture' : undefined);
    await writer.addRgba(rgba, 16, 16, custom ? 'alt' : undefined);
    await writer.finish(custom ? V.fromSpine38(fixture(), '3.7') : undefined);
    const json = JSON.parse(files.get('picture.json'));
    assert.equal(json.skeleton.spine, '3.7.94');
    assert.equal(Array.isArray(json.skins), false);
    assert(read(json).animations.length > 0);
    if (packed) {
      assert(!files.get('picture.atlas').includes('pma:'));
      const atlas = new S.TextureAtlas(files.get('picture.atlas'), () => new S.FakeTexture({ width: 64, height: 64 }));
      assert(atlas.regions.length > 0);
    }
  }
});

test('3.7.94 binary sequence writer keeps the selected version', async () => {
  const files = new Map(), writer = A.createWriter({ baseName: 'sequence', version: '3.7', skel: true,
    write: async (name, data) => files.set(name, data) });
  await writer.addRgba(new Uint8Array(16 * 16 * 4).fill(255), 16, 16);
  await writer.finish();
  assert(Buffer.from(files.get('sequence.skel')).includes(Buffer.from('3.7.94')));
  assert(!files.has('sequence.json'));
});

test('editor export collects images from 3.7 skin maps', () => {
  const source = readFileSync(new URL('../../renderer/spine-skeleton-editor.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function exportImageNames('), end = source.indexOf('\n  /**', start);
  const ctx = vm.createContext({});
  vm.runInContext(source.slice(start, end), ctx);
  assert.deepEqual(Array.from(ctx.exportImageNames(V.fromSpine38(fixture(), '3.7'))), ['picture', 'alt']);
});

test('the application export builder preserves the 3.7 wire format', () => {
  const source = readFileSync(new URL('../../renderer/novaflow-brand-runtime.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function buildSkeletonSpineExportJson(');
  const end = source.indexOf('  function prepareSkeletonSpineProjectForExport(', start);
  const keys = source.match(/const SKELETON_SPINE_EXPORT_PROJECT_KEYS = \[[\s\S]*?\];/)[0];
  const ctx = vm.createContext({ console: { info() {} }, TextEncoder });
  vm.runInContext('this.window=this;' + readFileSync(new URL('../../renderer/spine-export-optimizer.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(keys + '\nconst cloneSkeletonSpineExportValue=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));\n' + source.slice(start, end), ctx);
  const json = V.fromSpine38(fixture(), '3.7');
  const out = JSON.parse(ctx.buildSkeletonSpineExportJson({ project: json }, { jsonText: JSON.stringify(json) }));
  assert.deepEqual(out, json);
  assert.equal(read(out).findAnimation('move').duration, 1);
});
