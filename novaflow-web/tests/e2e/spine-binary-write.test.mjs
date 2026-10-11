// .skel export: renderer/spine-binary-write.js writes Spine 3.8 binary from 3.8 JSON.
//
// Two checks with the vendored spine-webgl-3.8 runtime:
//   1. the real 3.8.99 fixture (tests/fixtures/spine-3.8/skeleton.skel) goes .skel → JSON
//      (spine-skel-import.js) → .skel (this writer); the runtime's SkeletonBinary must read the
//      same SkeletonData from both byte strings - bones, slots, constraints, skins, attachments,
//      events and every animation timeline frame by frame with its curves.
//   2. the editor's JSON samples (work/skeleton-structure-lab/samples) read through SkeletonJson
//      and through write38 + SkeletonBinary must match the same way.
//
//   node novaflow-web/tests/e2e/spine-binary-write.test.mjs

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const here = new URL('./', import.meta.url);
const read = (rel) => readFile(new URL(rel, here), 'utf8');
const runtimeSource = await read('../../renderer/vendor/spine/spine-webgl-3.8.js');
const importerSource = await read('../../renderer/spine-skel-import.js');
const writerSource = await read('../../renderer/spine-binary-write.js');
const skelBytes = new Uint8Array(await readFile(new URL('../fixtures/spine-3.8/skeleton.skel', here)));

let checks = 0;
const ok = (v, what) => { assert.ok(v, what); checks += 1; };
const equal = (a, b, what) => { assert.deepEqual(a, b, what); checks += 1; };
// deep equality with a numeric tolerance (float32 in the binary vs doubles from JSON)
function near(a, b, tol, path = '$') {
  if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > tol) throw new Error(`${path}: ${a} vs ${b}`); return; }
  if (Array.isArray(a) || Array.isArray(b)) { if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) throw new Error(`${path}: length ${a && a.length} vs ${b && b.length}`); a.forEach((x, i) => near(x, b[i], tol, `${path}[${i}]`)); return; }
  if (a && b && typeof a === 'object' && typeof b === 'object') { const ka = Object.keys(a).sort(), kb = Object.keys(b).sort(); if (ka.join() !== kb.join()) throw new Error(`${path}: keys ${ka} vs ${kb}`); for (const k of ka) near(a[k], b[k], tol, `${path}.${k}`); return; }
  if (a !== b) throw new Error(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}
const close = (a, b, what) => { try { near(a, b, 2e-3) } catch (e) { throw new assert.AssertionError({ message: `${what}: ${e.message}` }) } checks += 1; };

function boot(source, name) {
  const sandbox = { console, TextDecoder, TextEncoder, Math, Float32Array, Int16Array, Uint16Array, Uint8Array, DataView, Map, Set, Error, setTimeout };
  sandbox.globalThis = sandbox; sandbox.window = sandbox;
  runInContext(source + (name === 'spine' ? '\n;this.spine = spine' : ''), createContext(sandbox));
  return sandbox[name];
}
const spine = boot(runtimeSource, 'spine');
const importer = boot(importerSource, 'NovaFlowSpineSkel');
const writer = boot(writerSource, 'NovaFlowSpineBinary');
ok(writer && typeof writer.write38 === 'function', 'the writer is published as NovaFlowSpineBinary.write38');

// ---------------------------------------------------------- runtime readers
function fakeRegion() {
  const r = { u: 0, v: 0, u2: 1, v2: 1, width: 1, height: 1, originalWidth: 1, originalHeight: 1, offsetX: 0, offsetY: 0, rotate: false, degrees: 0, texture: null };
  r.renderObject = r; return r;
}
const loader = {
  newRegionAttachment: (skin, name) => { const a = new spine.RegionAttachment(name); a.region = fakeRegion(); return a; },
  newMeshAttachment: (skin, name) => { const a = new spine.MeshAttachment(name); a.region = fakeRegion(); return a; },
  newBoundingBoxAttachment: (skin, name) => new spine.BoundingBoxAttachment(name),
  newPathAttachment: (skin, name) => new spine.PathAttachment(name),
  newPointAttachment: (skin, name) => new spine.PointAttachment(name),
  newClippingAttachment: (skin, name) => new spine.ClippingAttachment(name),
};
const fromBinary = (bytes) => new spine.SkeletonBinary(loader).readSkeletonData(bytes);
const fromJson = (json) => new spine.SkeletonJson(loader).readSkeletonData(JSON.parse(JSON.stringify(json)));

// ---------------------------------------------------------- a comparable picture of SkeletonData
// the binary carries float32: compare both sides at float32 precision
const r5 = (x) => (typeof x === 'number' ? Math.round(Math.fround(x) * 1e4) / 1e4 : x);
const arr = (a) => Array.from(a || [], r5);
const color = (c) => (c ? [c.r, c.g, c.b, c.a].map(r5) : null);
let loose = false; // JSON samples: the JSON reader leaves editor-only colors at runtime defaults, the binary carries Spine's
function attachment(a) {
  if (!a) return null;
  const out = { kind: a.constructor.name, name: a.name };
  if (a.path !== undefined) out.path = a.path;
  for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'width', 'height', 'hullLength', 'worldVerticesLength', 'closed', 'constantSpeed', 'inheritDeform']) if (a[k] !== undefined) out[k] = r5(a[k]);
  if (a.color && !(loose && !(a instanceof spine.RegionAttachment) && !(a instanceof spine.MeshAttachment))) out.color = color(a.color);
  if (a.vertices) out.vertices = arr(a.vertices);
  if (a.bones) out.bones = arr(a.bones);
  if (a.regionUVs) out.uvs = arr(a.regionUVs);
  if (a.triangles) out.triangles = arr(a.triangles);
  if (a.lengths) out.lengths = arr(a.lengths);
  if (a.endSlot) out.endSlot = a.endSlot.name;
  if (a.parentMesh) out.parentMesh = a.parentMesh.name;
  return out;
}
function timeline(t) {
  const out = { kind: t.constructor.name, frames: arr(t.frames) };
  // bezier tables are computed from the control points: float32 inputs shift them in the 4th decimal
  if (t.curves) out.curves = Array.from(t.curves);
  for (const k of ['boneIndex', 'slotIndex', 'ikConstraintIndex', 'transformConstraintIndex', 'pathConstraintIndex']) if (t[k] !== undefined) out[k] = t[k];
  if (t.attachmentNames) out.attachmentNames = Array.from(t.attachmentNames);
  if (t.frameVertices) out.frameVertices = Array.from(t.frameVertices, arr);
  if (t.drawOrders) out.drawOrders = Array.from(t.drawOrders, (d) => (d ? Array.from(d) : null));
  if (t.events) out.events = t.events.map((e) => [r5(e.time), e.data.name, e.intValue, r5(e.floatValue), e.stringValue, r5(e.volume), r5(e.balance)]);
  if (t.attachment) out.attachment = t.attachment.name;
  return out;
}
function picture(data) {
  return {
    header: [data.hash, data.version, r5(data.x), r5(data.y), r5(data.width), r5(data.height), r5(data.fps), data.imagesPath, data.audioPath],
    bones: data.bones.map((b) => [b.name, b.parent ? b.parent.name : null, r5(b.length), r5(b.x), r5(b.y), r5(b.rotation), r5(b.scaleX), r5(b.scaleY), r5(b.shearX), r5(b.shearY), b.transformMode, b.skinRequired, loose ? null : color(b.color)]),
    slots: data.slots.map((s) => [s.name, s.boneData.name, color(s.color), color(s.darkColor), s.attachmentName, s.blendMode]),
    ik: data.ikConstraints.map((c) => [c.name, c.order, c.skinRequired, c.bones.map((b) => b.name), c.target.name, c.bendDirection, c.compress, c.stretch, c.uniform, r5(c.mix), r5(c.softness)]),
    transform: data.transformConstraints.map((c) => [c.name, c.order, c.skinRequired, c.bones.map((b) => b.name), c.target.name, c.local, c.relative, r5(c.offsetRotation), r5(c.offsetX), r5(c.offsetY), r5(c.offsetScaleX), r5(c.offsetScaleY), r5(c.offsetShearY), r5(c.rotateMix), r5(c.translateMix), r5(c.scaleMix), r5(c.shearMix)]),
    path: data.pathConstraints.map((c) => [c.name, c.order, c.skinRequired, c.bones.map((b) => b.name), c.target.name, c.positionMode, c.spacingMode, c.rotateMode, r5(c.offsetRotation), r5(c.position), r5(c.spacing), r5(c.rotateMix), r5(c.translateMix)]),
    skins: data.skins.map((s) => [s.name, s.bones.map((b) => b.name), s.constraints.map((c) => c.name), s.attachments.map((m, i) => [data.slots[i] ? data.slots[i].name : i, m ? Object.fromEntries(Object.entries(m).map(([k, a]) => [k, attachment(a)])) : null])]),
    defaultSkin: data.defaultSkin ? data.defaultSkin.name : null,
    events: data.events.map((e) => [e.name, e.intValue, r5(e.floatValue), e.stringValue, e.audioPath, r5(e.volume), r5(e.balance)]),
    // timeline order follows the source's slot/bone listing order and does not matter for playback
    animations: data.animations.map((a) => [a.name, r5(a.duration), a.timelines.map(timeline).sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1))]),
  };
}

// ---------------------------------------------------------- 1. the real fixture, round trip
{
  const original = fromBinary(skelBytes);
  const json = JSON.parse(importer.toJson(skelBytes).text);
  const rewritten = writer.write38(json, { nonessential: true });
  ok(rewritten instanceof Uint8Array && rewritten.length > 1000, `the fixture writes back as ${rewritten.length} bytes (source ${skelBytes.length})`);
  const again = fromBinary(rewritten);
  const a = picture(original), b = picture(again);
  for (const key of Object.keys(a)) equal(b[key], a[key], `fixture round trip: ${key} identical`);
  // the fixture's own bytes: same length is expected when nothing is lost (strings may reorder)
  ok(Math.abs(rewritten.length - skelBytes.length) < skelBytes.length * 0.02, `fixture size within 2% (${rewritten.length} vs ${skelBytes.length})`);
}

// ---------------------------------------------------------- 2. the editor's JSON samples
const samples = ['jiaye/a.json', 'wild/wild.json', 'cloud/cloud.json']
  .map((rel) => new URL('../../../work/skeleton-structure-lab/samples/' + rel, here))
  .filter((u) => existsSync(u));
for (const u of samples) {
  const json = JSON.parse(await readFile(u, 'utf8'));
  loose = true;
  const viaJson = fromJson(json);
  const bytes = writer.write38(json, { nonessential: true });
  const viaBinary = fromBinary(bytes);
  const a = picture(viaJson), b = picture(viaBinary);
  // the JSON reader keeps the project's version string; the binary carries 3.8.99 (what Spine itself writes)
  a.header[1] = b.header[1] = '3.8.99';
  // the 3.8 JSON reader skips fps and the audio path; the binary carries them
  a.header[6] = b.header[6] = null; a.header[8] = b.header[8] = null;
  for (let i = 2; i <= 5; i++) if (a.header[i] == null) a.header[i] = 0; // no x/y/width/height in the JSON = 0 in the binary
  const name = decodeURIComponent(u.pathname.split('/').pop());
  for (const key of Object.keys(a)) close(b[key], a[key], `${name}: ${key} identical after write38 (${bytes.length} bytes)`);
}

// ---------------------------------------------------------- 3. refusals
assert.throws(() => writer.write38({ bones: [{ name: 'a', parent: 'missing' }, { name: 'b' }], slots: [] }), /父级/, 'a child before its parent is refused');
checks += 1;

console.log(`ok   spine-binary-write: ${checks} checks, ${samples.length} samples`);
