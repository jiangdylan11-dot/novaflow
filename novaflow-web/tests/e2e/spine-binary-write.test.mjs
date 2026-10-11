// .skel export: renderer/spine-binary-write.js writes Spine binary from the JSON of the same
// version (3.8 / 4.0 / 4.1 / 4.2).
//
// Every check reads the written bytes back with the real runtime of that version and compares
// the SkeletonData with the one the runtime's SkeletonJson reads from the source JSON: bones,
// slots, constraints, skins and attachments, events, every animation timeline frame by frame
// with its curves.
//   3.8  the real 3.8.99 fixture (.skel → JSON via spine-skel-import.js → .skel) must read as
//        the same SkeletonData as the original bytes; the editor's JSON samples via SkeletonJson.
//   4.x  the samples converted up by spine-version-convert.js, plus a hand-made project that
//        uses everything the 4.x formats add (sequences, physics, inherit, split channels,
//        two-colour slots, IK/transform/path timelines, every attachment type).
// Runtimes: vendor/spine (3.8, 4.0), tests/fixtures/spine-runtimes (spine-core 4.1.24, 4.2.120).
//
//   node novaflow-web/tests/e2e/spine-binary-write.test.mjs

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const here = new URL('./', import.meta.url);
const read = (rel) => readFile(new URL(rel, here), 'utf8');
const importerSource = await read('../../renderer/spine-skel-import.js');
const writerSource = await read('../../renderer/spine-binary-write.js');
const converterSource = await read('../../renderer/spine-version-convert.js');
const skelBytes = new Uint8Array(await readFile(new URL('../fixtures/spine-3.8/skeleton.skel', here)));

let checks = 0;
const ok = (v, what) => { assert.ok(v, what); checks += 1; };
const equal = (a, b, what) => { assert.deepEqual(a, b, what); checks += 1; };
// deep equality with a numeric tolerance (float32 in the binary vs doubles from JSON)
function near(a, b, tol, path = '$') {
  if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > tol) throw new Error(`${path}: ${a} vs ${b}`); return; }
  if (Array.isArray(a) || Array.isArray(b)) { if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) throw new Error(`${path}: length ${a && a.length} vs ${b && b.length}`); a.forEach((x, i) => near(x, b[i], tol, `${path}[${i}]`)); return; }
  if (a && b && typeof a === 'object' && typeof b === 'object') { const ka = Object.keys(a).sort(), kb = Object.keys(b).sort(); if (ka.join() !== kb.join()) throw new Error(`${path}: keys ${ka} vs ${kb}`); for (const k of ka) { try { near(a[k], b[k], tol, `${path}.${k}`) } catch (e) { if (a.kind && !e.kinded) { e.message = `[${a.kind}] ` + e.message; e.kinded = true } throw e } } return; }
  if (a !== b) throw new Error(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}
const close = (a, b, what) => { try { near(a, b, 2e-3) } catch (e) { throw new assert.AssertionError({ message: `${what}: ${e.message}` }) } checks += 1; };

function boot(source, name) {
  const sandbox = { console, TextDecoder, TextEncoder, Math, Float32Array, Int16Array, Uint16Array, Uint8Array, DataView, Map, Set, Error, setTimeout, atob, btoa };
  sandbox.globalThis = sandbox; sandbox.window = sandbox;
  runInContext(source + '\n;this.__spine = typeof spine !== "undefined" ? spine : undefined', createContext(sandbox));
  return name === 'spine' ? sandbox.__spine : sandbox[name];
}
const importer = boot(importerSource, 'NovaFlowSpineSkel');
const writer = boot(writerSource, 'NovaFlowSpineBinary');
const SV = boot(converterSource, 'NovaFlowSpineVersion');
ok(writer && typeof writer.write === 'function' && typeof writer.write38 === 'function' && typeof writer.write4 === 'function', 'the writer is published as NovaFlowSpineBinary.write / write38 / write4');
const runtimes = {
  '3.8': boot(await read('../../renderer/vendor/spine/spine-webgl-3.8.js'), 'spine'),
  '4.0': boot(await read('../../renderer/vendor/spine/spine-webgl-4.0.js'), 'spine'),
  '4.1': boot(await read('../fixtures/spine-runtimes/spine-core-4.1.24.js'), 'spine'),
  '4.2': boot(await read('../fixtures/spine-runtimes/spine-core-4.2.120.js'), 'spine'),
};
for (const [v, s] of Object.entries(runtimes)) ok(s && s.SkeletonBinary && s.SkeletonJson, `runtime ${v} loaded`);

// ---------------------------------------------------------- runtime readers
function fakeRegion() {
  const r = { u: 0, v: 0, u2: 1, v2: 1, width: 1, height: 1, originalWidth: 1, originalHeight: 1, offsetX: 0, offsetY: 0, rotate: false, degrees: 0, texture: null };
  r.renderObject = r; return r;
}
const loaderFor = (spine) => ({
  newRegionAttachment: (skin, name) => { const a = new spine.RegionAttachment(name); a.region = fakeRegion(); return a; },
  newMeshAttachment: (skin, name) => { const a = new spine.MeshAttachment(name); a.region = fakeRegion(); return a; },
  newBoundingBoxAttachment: (skin, name) => new spine.BoundingBoxAttachment(name),
  newPathAttachment: (skin, name) => new spine.PathAttachment(name),
  newPointAttachment: (skin, name) => new spine.PointAttachment(name),
  newClippingAttachment: (skin, name) => new spine.ClippingAttachment(name),
});
const fromBinary = (v, bytes) => new runtimes[v].SkeletonBinary(loaderFor(runtimes[v])).readSkeletonData(bytes);
const fromJson = (v, json) => new runtimes[v].SkeletonJson(loaderFor(runtimes[v])).readSkeletonData(JSON.parse(JSON.stringify(json)));

// ---------------------------------------------------------- a comparable picture of SkeletonData
// the binary carries float32: compare both sides at float32 precision
const r5 = (x) => (typeof x === 'number' ? Math.round(Math.fround(x) * 1e4) / 1e4 : x);
// references to other data objects become their names
const REF = new Set(['parent', 'boneData', 'bones', 'target', '_target', '_bone', '_bones', 'skin', 'region', 'renderObject', 'attachmentLoader', 'timelineAttachment', 'parentMesh', 'data', 'slot', 'attachment', 'endSlot', 'bone', 'constraints', 'defaultSkin']);
function plain(v, depth) {
  if (v == null) return null;
  if (typeof v === 'number') return r5(v);
  if (typeof v === 'function') return undefined;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return Array.from(v, (x) => plain(x, depth));
  if (v instanceof Map || v instanceof Set) return `[${v.constructor.name}]`;
  if (depth <= 0) return v.name != null ? String(v.name) : '[obj]';
  const out = { kind: v.constructor && v.constructor.name };
  for (const k of Object.keys(v)) {
    if (k === 'id' || k === 'propertyIds') continue; // attachment / sequence ids come from a global counter (and sit inside property ids)
    if (k === 'offset' || k === 'uvs') continue; // derived by updateRegion (the 4.1 JSON reader runs it for sequences too, the binary reader does not)
    const x = v[k];
    if (REF.has(k)) {
      if (x && typeof x === 'object' && !Array.isArray(x) && !ArrayBuffer.isView(x)) { out[k] = x.name != null ? String(x.name) : '[obj]'; continue; }
      if (Array.isArray(x)) { out[k] = x.map((y) => (y && typeof y === 'object' && y.name != null ? String(y.name) : plain(y, 0))); continue; }
    }
    const p = plain(x, depth - 1);
    if (p !== undefined) out[k] = p;
  }
  return out;
}
function picture(data) {
  // timeline order follows the source's listing order and does not matter for playback
  const sortByJson = (list) => list.sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1));
  return {
    header: [data.hash, data.version, r5(data.x), r5(data.y), r5(data.width), r5(data.height), r5(data.fps), data.imagesPath, data.audioPath, r5(data.referenceScale)],
    bones: data.bones.map((b) => plain(b, 2)),
    slots: data.slots.map((s) => plain(s, 2)),
    ik: data.ikConstraints.map((c) => plain(c, 2)),
    transform: data.transformConstraints.map((c) => plain(c, 2)),
    path: data.pathConstraints.map((c) => plain(c, 2)),
    physics: (data.physicsConstraints || []).map((c) => plain(c, 2)),
    skins: data.skins.map((s) => plain(s, 4)),
    defaultSkin: data.defaultSkin ? data.defaultSkin.name : null,
    events: data.events.map((e) => plain(e, 2)),
    animations: data.animations.map((a) => ({ name: a.name, duration: r5(a.duration), timelines: sortByJson(a.timelines.map((t) => plain(t, 3))) })),
  };
}
/** JSON vs binary: the JSON reader leaves editor-only values (bone / skin / shape colours, icons,
 *  the hash) at runtime defaults; sequences get a fresh id per read. Both pictures lose them. */
function strip(pic) {
  // by position, not class name: the vendored 4.0 runtime is minified
  for (const b of pic.bones) { delete b.color; delete b.icon; delete b.visible; }
  // a dark colour has no alpha: the binary reader leaves it 0, the JSON reader 1
  for (const s of pic.slots) if (s.darkColor && typeof s.darkColor === 'object') delete s.darkColor.a;
  const isPicture = (a) => a && typeof a === 'object' && ('regionUVs' in a || ('rotation' in a && 'width' in a));
  for (const s of pic.skins) {
    delete s.color;
    for (const map of s.attachments || []) if (map && typeof map === 'object') for (const a of Object.values(map)) if (a && typeof a === 'object' && !isPicture(a)) delete a.color;
  }
  // a draw-order key without offsets: the JSON reader keeps null (setup order), the binary reader builds the identity
  for (const an of pic.animations) for (const t of an.timelines) if (Array.isArray(t.drawOrders)) t.drawOrders = t.drawOrders.map((d) => (Array.isArray(d) && d.every((x, i) => x === i) ? null : d));
  pic.header = pic.header.slice(2, 6).map((x) => (x == null ? 0 : x)).concat([pic.header[9] == null ? 100 : pic.header[9]]);
  return pic;
}

// ---------------------------------------------------------- 1. the real 3.8 fixture, round trip
{
  const original = fromBinary('3.8', skelBytes);
  const json = JSON.parse(importer.toJson(skelBytes).text);
  const rewritten = writer.write(json, '3.8', { nonessential: true });
  ok(rewritten instanceof Uint8Array && rewritten.length > 1000, `the fixture writes back as ${rewritten.length} bytes (source ${skelBytes.length})`);
  const again = fromBinary('3.8', rewritten);
  const a = picture(original), b = picture(again);
  for (const key of Object.keys(a)) equal(b[key], a[key], `3.8 fixture round trip: ${key} identical`);
  ok(Math.abs(rewritten.length - skelBytes.length) < skelBytes.length * 0.02, `fixture size within 2% (${rewritten.length} vs ${skelBytes.length})`);
}

// ---------------------------------------------------------- 2. JSON vs binary, every version
const samples = ['jiaye/a.json', 'wild/wild.json', 'cloud/cloud.json']
  .map((rel) => new URL('../../../work/skeleton-structure-lab/samples/' + rel, here))
  .filter((u) => existsSync(u));
const VERSIONS = ['3.8', '4.0', '4.1', '4.2'];
function checkJsonVsBinary(label, version, json) {
  const viaJson = fromJson(version, json);
  const bytes = writer.write(json, version, { nonessential: true });
  const viaBinary = fromBinary(version, bytes);
  const a = strip(picture(viaJson)), b = strip(picture(viaBinary));
  for (const key of Object.keys(a)) {
    try { close(b[key], a[key], `${label} ${version}: ${key} identical after write (${bytes.length} bytes)`) }
    catch (e) {
      // say which timeline that was
      const m = /timelines\[(\d+)\]/.exec(e.message);
      if (m && key === 'animations') { const i = Number(m[1]); const an = Number((/\$\[(\d+)\]/.exec(e.message) || [0, 0])[1]); console.error(`  binary: ${JSON.stringify(b.animations[an].timelines[i]).slice(0, 500)}
  json:   ${JSON.stringify(a.animations[an].timelines[i]).slice(0, 500)}`) }
      throw e
    }
  }
  return bytes;
}
for (const u of samples) {
  const json38 = JSON.parse(await readFile(u, 'utf8'));
  const name = decodeURIComponent(u.pathname.split('/').pop());
  for (const v of VERSIONS) {
    const json = v === '3.8' ? json38 : SV.fromSpine38(json38, v);
    checkJsonVsBinary(name, v, json);
  }
}

// ---------------------------------------------------------- 3. everything the 4.x formats add
function rich(version) {
  const minor = Number(version.split('.')[1]);
  const at41 = minor >= 1, at42 = minor >= 2;
  const json = {
    skeleton: { hash: 'yc/DaATqbh4', spine: SV.VERSIONS[version], x: -10, y: -20, width: 100, height: 200, images: './images/', audio: '', fps: 30, ...(at42 ? { referenceScale: 100 } : {}) },
    bones: [
      { name: 'root' },
      { name: 'hip', parent: 'root', length: 20, x: 1, y: 2, rotation: 10, color: 'ff0000ff' },
      { name: 'leg', parent: 'hip', length: 30, x: 20, rotation: -15, scaleX: 1.1, shearY: 3, [at42 ? 'inherit' : 'transform']: 'noScale' },
      { name: 'foot', parent: 'leg', length: 10, x: 30, skin: true },
      { name: 'cloth', parent: 'hip', length: 15, x: -5, y: -5 },
      { name: 'ikTarget', parent: 'root', x: 50, y: -40 },
      { name: 'ctrl', parent: 'root', x: 0, y: 60 },
      { name: 'pathBone', parent: 'root' },
    ],
    slots: [
      { name: 'body', bone: 'hip', attachment: 'body', color: 'ff00ffcc' },
      { name: 'legSlot', bone: 'leg', attachment: 'legMesh', dark: '102030', blend: 'additive' },
      { name: 'cloth', bone: 'cloth', attachment: 'clothRegion' },
      { name: 'linked', bone: 'leg' },
      { name: 'bb', bone: 'root', attachment: 'box' },
      { name: 'clip', bone: 'root', attachment: 'clipShape' },
      { name: 'pt', bone: 'root', attachment: 'marker' },
      { name: 'track', bone: 'root', attachment: 'rail' },
      { name: 'hidden', bone: 'root', ...(at42 ? { visible: false } : {}) },
    ],
    ik: [{ name: 'legIk', order: 1, bones: ['hip', 'leg'], target: 'ikTarget', mix: 0.75, softness: 2, bendPositive: false, compress: true, stretch: true, uniform: true }, { name: 'offIk', order: 2, bones: ['foot'], target: 'ikTarget', mix: 0, skin: true }],
    transform: [{ name: 'tc', order: 3, bones: ['cloth'], target: 'ctrl', rotation: 5, x: 1, y: 2, scaleX: 0.5, scaleY: 0.25, shearY: 1, mixRotate: 0.5, mixX: 0.4, mixY: 0.3, mixScaleX: 0.2, mixScaleY: 0.1, mixShearY: 0.05, local: true, relative: true }],
    path: [{ name: 'pc', order: 4, bones: ['pathBone'], target: 'track', positionMode: 'fixed', spacingMode: 'percent', rotateMode: 'chainScale', rotation: 7, position: 0.5, spacing: 3, mixRotate: 0.9, mixX: 0.8, mixY: 0.7 }],
    ...(at42 ? { physics: [{ name: 'ph', order: 5, bone: 'cloth', x: 0.5, y: 0.25, rotate: 1, scaleX: 0.1, shearX: 0.2, limit: 300, fps: 50, inertia: 0.8, strength: 60, damping: 0.9, mass: 2, wind: 1.5, gravity: -3, mix: 0.6, windGlobal: true, mixGlobal: true }] } : {}),
    skins: [
      { name: 'default', attachments: {
        body: { body: { x: 1, y: 2, rotation: 3, scaleX: 1.5, scaleY: 0.5, width: 40, height: 60, color: 'ffeeddcc', ...(at41 ? { sequence: { count: 3, start: 1, digits: 2, setup: 1 } } : {}) }, alt: { type: 'region', name: 'altName', path: 'pictures/alt', width: 10, height: 10 } },
        legSlot: { legMesh: { type: 'mesh', path: 'leg_img', uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3], vertices: [1, 0, 0, 0, 1, 1, 0, 10, 0, 1, 2, 0, 10, 10, 0.5, 1, 0, 10, 0.5, 1, 0, 0, 10, 1], hull: 4, edges: [0, 2, 2, 4, 4, 6, 6, 0], width: 10, height: 10, color: 'ff0000ff', ...(at41 ? { sequence: { count: 2 } } : {}) }, legLinked: { type: 'linkedmesh', parent: 'legMesh', skin: 'default', width: 10, height: 10, [at41 ? 'timelines' : 'deform']: false } },
        cloth: { clothRegion: { width: 5, height: 5 } },
        // a linked mesh shares its parent's slot (the runtimes look the parent up there)
        linked: {},
        bb: { box: { type: 'boundingbox', vertexCount: 3, vertices: [0, 0, 10, 0, 0, 10], color: '12345678' } },
        clip: { clipShape: { type: 'clipping', end: 'pt', vertexCount: 3, vertices: [0, 0, 5, 0, 0, 5] } },
        pt: { marker: { type: 'point', x: 3, y: 4, rotation: 45 } },
        track: { rail: { type: 'path', closed: true, constantSpeed: false, vertexCount: 6, vertices: [1, 7, 0, 0, 1, 1, 7, 10, 0, 1, 1, 7, 20, 0, 1, 1, 7, 30, 10, 1, 1, 7, 40, 0, 1, 1, 7, 50, 10, 1], lengths: [12, 34] } },
      } },
      { name: 'alt', bones: ['foot'], ik: ['offIk'], transform: ['tc'], path: ['pc'], ...(at42 ? { physics: ['ph'], color: '00ff00ff' } : {}), attachments: { body: { body: { width: 1, height: 1 } } } },
    ],
    events: { hit: { int: -3, float: 1.5, string: 'ouch', audio: 'hit.wav', volume: 0.5, balance: -0.2 }, plain: {} },
    animations: {
      move: {
        slots: {
          body: { attachment: [{ time: 0, name: 'body' }, { time: 0.5, name: null }, { time: 1, name: 'alt' }], rgba: [{ time: 0, color: 'ff0000ff', curve: [0.1, 1, 0.2, 0.9, 0.1, 0, 0.2, 0.1, 0.1, 0, 0.2, 0.1, 0.1, 1, 0.2, 1] }, { time: 0.5, color: '00ff0080', curve: 'stepped' }, { time: 1, color: '0000ffff' }] },
          legSlot: { rgba2: [{ time: 0, light: 'ffffffff', dark: '000000', curve: [0.1, 1, 0.2, 1, 0.1, 1, 0.2, 1, 0.1, 1, 0.2, 1, 0.1, 1, 0.2, 1, 0.1, 0, 0.2, 0.1, 0.1, 0, 0.2, 0.1, 0.1, 0, 0.2, 0.1] }, { time: 1, light: '80808080', dark: '404040' }], alpha: [{ time: 0, value: 1, curve: [0.25, 1, 0.75, 0.6] }, { time: 1, value: 0.6 }] }, // 0.6 = 153/255 exactly
          cloth: { rgb: [{ time: 0, color: 'ff0000' }, { time: 1, color: '00ff00' }], rgb2: [{ time: 0, light: 'ff0000', dark: '001122' }, { time: 1, light: '00ff00', dark: '334455' }] },
        },
        bones: {
          hip: { rotate: [{ time: 0, value: 0, curve: [0.25, 0, 0.75, 30] }, { time: 1, value: 30 }], translate: [{ time: 0, x: 0, y: 0, curve: [0.3, 0, 0.6, 5, 0.3, 0, 0.6, 7] }, { time: 1, x: 5, y: 7 }], scale: [{ time: 0, x: 1, y: 1, curve: 'stepped' }, { time: 1, x: 2, y: 0.5 }], shear: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 3, y: 4 }] },
          leg: { translatex: [{ time: 0, value: 1 }, { time: 1, value: 2 }], translatey: [{ time: 0, value: -1 }, { time: 1, value: -2 }], scalex: [{ time: 0, value: 1 }, { time: 1, value: 1.5 }], scaley: [{ time: 0, value: 1 }, { time: 1, value: 0.5 }], shearx: [{ time: 0, value: 0 }, { time: 1, value: 10 }], sheary: [{ time: 0, value: 0 }, { time: 1, value: -10 }], ...(at42 ? { inherit: [{ time: 0, inherit: 'normal' }, { time: 0.5, inherit: 'onlyTranslation' }] } : {}) },
        },
        ik: { legIk: [{ time: 0, mix: 1, softness: 0, bendPositive: true, compress: true, curve: [0.1, 1, 0.2, 0.5, 0.1, 0, 0.2, 2] }, { time: 0.5, mix: 0.5, softness: 2, bendPositive: false, stretch: true, curve: 'stepped' }, { time: 1, mix: 0 }] },
        transform: { tc: [{ time: 0, mixRotate: 1, mixX: 1, mixY: 0.5, mixScaleX: 1, mixScaleY: 0.25, mixShearY: 1, curve: [0.1, 1, 0.2, 0, 0.1, 1, 0.2, 0, 0.1, 0.5, 0.2, 0, 0.1, 1, 0.2, 0, 0.1, 0.25, 0.2, 0, 0.1, 1, 0.2, 0] }, { time: 1, mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 1 }] }, // mixShearY constant: the 4.0 JSON reader never advances it (runtime bug)
        path: { pc: { position: [{ time: 0, value: 0, curve: [0.1, 0, 0.2, 1] }, { time: 1, value: 1 }], spacing: [{ time: 0, value: 1 }, { time: 1, value: 2, }], mix: [{ time: 0, mixRotate: 1, mixX: 1, mixY: 1, curve: 'stepped' }, { time: 1, mixRotate: 0, mixX: 0.5, mixY: 0.25 }] } },
        ...(at42 ? { physics: { ph: { inertia: [{ time: 0, value: 1, curve: [0.1, 1, 0.2, 0] }, { time: 1, value: 0 }], strength: [{ time: 0, value: 100 }, { time: 1, value: 50 }], damping: [{ time: 0, value: 1 }, { time: 1, value: 0.5 }], mass: [{ time: 0, value: 1 }, { time: 1, value: 2 }], wind: [{ time: 0, value: 0 }, { time: 1, value: 3 }], gravity: [{ time: 0, value: 0 }, { time: 1, value: -9 }], mix: [{ time: 0, value: 1 }, { time: 1, value: 0 }], reset: [{ time: 0.25 }, { time: 0.75 }] } } } : {}),
        ...(at41
          ? { attachments: { default: { legSlot: { legMesh: { deform: [{ time: 0, curve: [0.1, 0, 0.2, 1] }, { time: 0.5, offset: 2, vertices: [1, 2, 3, 4], curve: 'stepped' }, { time: 1 }], sequence: [{ time: 0, mode: 'loop', index: 1, delay: 0.1 }, { time: 0.5, mode: 'pingpongReverse', index: 0 }, { time: 1, mode: 'hold', delay: 0 }] }, legMesh2: undefined }, body: { body: { deform: [{ time: 0, vertices: [1, 1] }, { time: 1 }] } } } } }
          : { deform: { default: { legSlot: { legMesh: [{ time: 0, curve: [0.1, 0, 0.2, 1] }, { time: 0.5, offset: 2, vertices: [1, 2, 3, 4], curve: 'stepped' }, { time: 1 }] } } } }),
        drawOrder: [{ time: 0, offsets: [{ slot: 'cloth', offset: -2 }, { slot: 'bb', offset: 1 }] }, { time: 1 }],
        events: [{ time: 0, name: 'hit', int: 5, float: 2.5, string: 'other', volume: 0.1, balance: 0.9 }, { time: 0.5, name: 'plain' }, { time: 1, name: 'hit' }],
      },
      still: { bones: { foot: { rotate: [{ time: 0, value: 5 }] } } },
    },
  };
  // the body deform key above sits on a region attachment (not deformable): drop it
  if (at41) delete json.animations.move.attachments.default.body;
  if (at41) delete json.animations.move.attachments.default.legSlot.legMesh2;
  return json;
}
for (const v of ['4.0', '4.1', '4.2']) {
  const json = rich(v);
  const bytes = checkJsonVsBinary('rich', v, json);
  const data = fromBinary(v, bytes);
  ok(data.skins.length === 2 && data.animations.length === 2 && data.events.length === 2, `rich ${v}: 2 skins, 2 animations, 2 events read back`);
  const move = data.animations.find((a) => a.name === 'move');
  const kinds = new Set(move.timelines.map((t) => t.constructor.name.replace(/^_/, ''))); // esbuild prefixes classes with static fields
  const expected = ['AttachmentTimeline', 'RGBATimeline', 'RGBA2Timeline', 'AlphaTimeline', 'RGBTimeline', 'RGB2Timeline', 'RotateTimeline', 'TranslateTimeline', 'ScaleTimeline', 'ShearTimeline', 'TranslateXTimeline', 'TranslateYTimeline', 'ScaleXTimeline', 'ScaleYTimeline', 'ShearXTimeline', 'ShearYTimeline', 'IkConstraintTimeline', 'TransformConstraintTimeline', 'PathConstraintPositionTimeline', 'PathConstraintSpacingTimeline', 'PathConstraintMixTimeline', 'DeformTimeline', 'DrawOrderTimeline', 'EventTimeline',
    ...(v !== '4.0' ? ['SequenceTimeline'] : []), ...(v === '4.2' ? ['InheritTimeline', 'PhysicsConstraintInertiaTimeline', 'PhysicsConstraintStrengthTimeline', 'PhysicsConstraintDampingTimeline', 'PhysicsConstraintMassTimeline', 'PhysicsConstraintWindTimeline', 'PhysicsConstraintGravityTimeline', 'PhysicsConstraintMixTimeline', 'PhysicsConstraintResetTimeline'] : [])];
  if (v === '4.0') ok(move.timelines.length === expected.length, `rich 4.0: ${expected.length} timelines came through the binary (${move.timelines.length})`);
  else for (const k of expected) ok(kinds.has(k), `rich ${v}: ${k} came through the binary`);
  if (v === '4.2') ok(data.physicsConstraints.length === 1 && data.physicsConstraints[0].windGlobal === true && Math.abs(data.physicsConstraints[0].massInverse - 0.5) < 1e-6, 'rich 4.2: the physics constraint came through');
}

// ---------------------------------------------------------- 4. refusals
assert.throws(() => writer.write({ bones: [{ name: 'a', parent: 'missing' }, { name: 'b' }], slots: [] }, '3.8'), /父级/, 'a child before its parent is refused');
assert.throws(() => writer.write({ bones: [{ name: 'root' }], slots: [] }, '4.3'), /不支持/, '4.3 is refused');
checks += 2;

console.log(`ok   spine-binary-write: ${checks} checks, ${samples.length} samples × ${VERSIONS.length} versions`);
