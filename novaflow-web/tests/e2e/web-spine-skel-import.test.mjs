// .skel import: the binary skeleton becomes the JSON the app already reads.
//
// spine-skel-import.js turns a Spine 3.8 .skel into 3.8 JSON. The check here
// is the strongest one available without Spine itself: the vendored
// spine-webgl-3.8 runtime reads the binary with its SkeletonBinary and the
// converted text with its SkeletonJson, and everything the two SkeletonData
// carry - bones, slots, constraints, skins and attachments, events, every
// animation's timelines frame by frame with their curves - must be identical.
//
// The fixture is a real 3.8.99 export (tests/fixtures/spine-3.8).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const here = new URL('./', import.meta.url);
const converterSource = await readFile(new URL('../../renderer/spine-skel-import.js', here), 'utf8');
const runtimeSource = await readFile(new URL('../../renderer/vendor/spine/spine-webgl-3.8.js', here), 'utf8');
const skelBytes = new Uint8Array(await readFile(new URL('../fixtures/spine-3.8/skeleton.skel', here)));
const atlasText = await readFile(new URL('../fixtures/spine-3.8/skeleton.atlas', here), 'utf8');

let checks = 0;
const equal = (a, b, what) => { assert.deepEqual(a, b, what); checks += 1; };
const ok = (value, what) => { assert.ok(value, what); checks += 1; };

// ---------------------------------------------------------- the converter
function bootConverter() {
  const sandbox = { console, TextDecoder };
  sandbox.globalThis = sandbox;
  runInContext(converterSource, createContext(sandbox));
  return sandbox.NovaFlowSpineSkel;
}
const converter = bootConverter();
ok(converter && typeof converter.toJson === 'function', 'the converter is published as NovaFlowSpineSkel');

const converted = converter.toJson(skelBytes);
equal(converted.version, '3.8.99', 'the fixture is a 3.8.99 export');
const json = JSON.parse(converted.text);
equal(json.skeleton.spine, '3.8.99', 'the JSON header carries the version');
ok(Array.isArray(json.bones) && json.bones.length > 1, 'bones came through (' + json.bones.length + ')');
ok(Array.isArray(json.slots) && json.slots.length > 0, 'slots came through (' + json.slots.length + ')');
ok(Array.isArray(json.skins) && json.skins.length > 0, 'skins came through (' + json.skins.length + ')');
ok(json.animations && Object.keys(json.animations).length > 0, 'animations came through (' + Object.keys(json.animations).join(', ') + ')');
equal(json.bones[0].parent, undefined, 'the root bone has no parent');
ok(json.bones.slice(1).every((bone) => typeof bone.parent === 'string'), 'every other bone names its parent');
ok(json.slots.every((slot) => /^[0-9a-f]{8}$/.test(slot.color)), 'slot colours are rrggbbaa strings');

// ---------------------------------------------------------- the runtime as the judge
function bootRuntime() {
  const sandbox = { console, TextDecoder, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  runInContext(runtimeSource, createContext(sandbox));
  return sandbox.spine;
}
const spine = bootRuntime();
ok(spine && spine.SkeletonBinary && spine.SkeletonJson, 'spine-webgl-3.8 loads without a browser');

const fakeTexture = () => ({ setFilters() {}, setWraps() {}, getImage() { return { width: 268, height: 268 }; }, dispose() {} });
const atlas = new spine.TextureAtlas(atlasText, fakeTexture);
const loader = new spine.AtlasAttachmentLoader(atlas);

// The runtime wants the bytes in its own realm.
const fromBinary = new spine.SkeletonBinary(loader).readSkeletonData(runInContext('Uint8Array', createContext({})).from(skelBytes));
const fromJson = new spine.SkeletonJson(loader).readSkeletonData(converted.text);

const arr = (value) => (value == null ? null : Array.from(value));
const color = (value) => (value ? [value.r, value.g, value.b, value.a] : null);
const names = (list) => arr(list).map((item) => item.name);
const attachmentSummary = (attachment) => {
  if (!attachment) return null;
  const out = { kind: attachment.constructor.name, name: attachment.name };
  for (const key of ['path', 'x', 'y', 'scaleX', 'scaleY', 'rotation', 'width', 'height', 'hullLength', 'closed', 'constantSpeed', 'worldVerticesLength']) {
    if (attachment[key] !== undefined) out[key] = attachment[key];
  }
  if (attachment.color) out.color = color(attachment.color);
  for (const key of ['vertices', 'bones', 'regionUVs', 'triangles', 'edges', 'lengths']) {
    if (attachment[key] != null) out[key] = arr(attachment[key]);
  }
  if (attachment.endSlot) out.endSlot = attachment.endSlot.name;
  if (attachment.parentMesh !== undefined) out.parentMesh = attachment.parentMesh ? attachment.parentMesh.name : null;
  if (attachment.deformAttachment !== undefined) out.inheritDeform = attachment.deformAttachment === attachment ? 'self' : attachment.deformAttachment ? attachment.deformAttachment.name : null;
  return out;
};
const timelineSummary = (timeline) => {
  const out = { kind: timeline.constructor.name };
  for (const key of ['slotIndex', 'boneIndex', 'ikConstraintIndex', 'transformConstraintIndex', 'pathConstraintIndex']) {
    if (timeline[key] !== undefined) out[key] = timeline[key];
  }
  if (timeline.frames) out.frames = arr(timeline.frames).map((frame) => (frame && frame.data ? { time: frame.time, name: frame.data.name, int: frame.intValue, float: frame.floatValue, string: frame.stringValue, volume: frame.volume, balance: frame.balance } : frame));
  if (timeline.curves) out.curves = arr(timeline.curves);
  if (timeline.attachmentNames) out.attachmentNames = arr(timeline.attachmentNames);
  if (timeline.drawOrders) out.drawOrders = arr(timeline.drawOrders).map(arr);
  if (timeline.frameVertices) out.frameVertices = arr(timeline.frameVertices).map(arr);
  if (timeline.attachment) out.attachment = timeline.attachment.name;
  return out;
};
const summary = (data) => ({
  // audioPath is left out: the 3.8 JSON reader never reads it, while the binary one does.
  header: { hash: data.hash, version: data.version, x: data.x, y: data.y, width: data.width, height: data.height, fps: data.fps, imagesPath: data.imagesPath },
  bones: arr(data.bones).map((bone) => ({ name: bone.name, parent: bone.parent ? bone.parent.name : null, length: bone.length, x: bone.x, y: bone.y, rotation: bone.rotation, scaleX: bone.scaleX, scaleY: bone.scaleY, shearX: bone.shearX, shearY: bone.shearY, transformMode: bone.transformMode, skinRequired: bone.skinRequired })),
  slots: arr(data.slots).map((slot) => ({ name: slot.name, bone: slot.boneData.name, color: color(slot.color), darkColor: color(slot.darkColor), attachmentName: slot.attachmentName, blendMode: slot.blendMode })),
  ik: arr(data.ikConstraints).map((c) => ({ name: c.name, order: c.order, skinRequired: c.skinRequired, bones: names(c.bones), target: c.target.name, mix: c.mix, softness: c.softness, bendDirection: c.bendDirection, compress: c.compress, stretch: c.stretch, uniform: c.uniform })),
  transform: arr(data.transformConstraints).map((c) => ({ name: c.name, order: c.order, skinRequired: c.skinRequired, bones: names(c.bones), target: c.target.name, local: c.local, relative: c.relative, offsetRotation: c.offsetRotation, offsetX: c.offsetX, offsetY: c.offsetY, offsetScaleX: c.offsetScaleX, offsetScaleY: c.offsetScaleY, offsetShearY: c.offsetShearY, rotateMix: c.rotateMix, translateMix: c.translateMix, scaleMix: c.scaleMix, shearMix: c.shearMix })),
  path: arr(data.pathConstraints).map((c) => ({ name: c.name, order: c.order, skinRequired: c.skinRequired, bones: names(c.bones), target: c.target.name, positionMode: c.positionMode, spacingMode: c.spacingMode, rotateMode: c.rotateMode, offsetRotation: c.offsetRotation, position: c.position, spacing: c.spacing, rotateMix: c.rotateMix, translateMix: c.translateMix })),
  skins: arr(data.skins).map((skin) => ({
    name: skin.name,
    bones: names(skin.bones),
    constraints: names(skin.constraints),
    attachments: arr(skin.attachments).map((slotAttachments) => {
      if (!slotAttachments) return null;
      const out = {};
      for (const key of Object.keys(slotAttachments).sort()) out[key] = attachmentSummary(slotAttachments[key]);
      return out;
    })
  })),
  events: arr(data.events).map((e) => ({ name: e.name, intValue: e.intValue, floatValue: e.floatValue, stringValue: e.stringValue, audioPath: e.audioPath, volume: e.volume, balance: e.balance })),
  animations: arr(data.animations).map((animation) => ({ name: animation.name, duration: animation.duration, timelines: arr(animation.timelines).map(timelineSummary) })),
  defaultSkin: data.defaultSkin ? data.defaultSkin.name : null
});

const binarySummary = summary(fromBinary);
const jsonSummary = summary(fromJson);
equal(jsonSummary.header, binarySummary.header, 'header: hash, version, bounds');
equal(jsonSummary.bones, binarySummary.bones, 'bones');
equal(jsonSummary.slots, binarySummary.slots, 'slots');
equal(jsonSummary.ik, binarySummary.ik, 'IK constraints');
equal(jsonSummary.transform, binarySummary.transform, 'transform constraints');
equal(jsonSummary.path, binarySummary.path, 'path constraints');
equal(jsonSummary.skins, binarySummary.skins, 'skins and their attachments');
equal(jsonSummary.events, binarySummary.events, 'events');
equal(jsonSummary.defaultSkin, binarySummary.defaultSkin, 'default skin');
equal(jsonSummary.animations.length, binarySummary.animations.length, 'the same number of animations');
for (let i = 0; i < binarySummary.animations.length; i += 1) {
  equal(jsonSummary.animations[i], binarySummary.animations[i], 'animation "' + binarySummary.animations[i].name + '" frame for frame');
}
const timelineCount = binarySummary.animations.reduce((sum, a) => sum + a.timelines.length, 0);
ok(timelineCount > 0, timelineCount + ' timelines compared');

// ---------------------------------------------------------- refusals
{
  for (const [bytes, pattern, what] of [
    [new Uint8Array(4), /不是 Spine/, 'a few bytes'],
    [new TextEncoder().encode('{"skeleton":{"spine":"3.8.99"}}'), /不是 Spine|损坏/, 'a JSON file named .skel'],
    [(() => { const v = new TextEncoder().encode('4.1.24'); const out = new Uint8Array(8 + 1 + v.length + 32); out[8] = v.length + 1; out.set(v, 9); return out; })(), /4\.1\.24/, 'a 4.x header']
  ]) {
    let error = null;
    try { converter.toJson(bytes); } catch (e) { error = e; }
    ok(error && pattern.test(error.message), what + ' is refused with a reason: ' + (error && error.message));
  }
  equal(converter.isSkelName('Hero.SKEL'), true, '.skel is recognised regardless of case');
  equal(converter.isSkelName('hero.json'), false, '.json is not');
}

console.log(checks + ' passed, 0 failed: .skel import converts Spine 3.8 binaries to the JSON the app reads');
