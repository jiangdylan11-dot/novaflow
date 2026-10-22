import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { detectedPeople, applyDetectedPose, createImagePoseRecognizer, mergeCroppedPoseResult, layoutDetectedPeople, uncertainPoseParts, correctPoseJoint } from '../../renderer/pose-reference-image.js';
import { poseQuality, remapPoseResult, mergePoseCandidates } from '../../renderer/pose-reference-image-math.js';

function detection(x = 0.3) {
  const points = Array.from({ length: 33 }, () => ({ x, y: 0.1, z: 0, visibility: 0.99, presence: 0.99 }));
  for (const i of [11, 12]) points[i] = { ...points[i], x: x + (i === 11 ? 0.07 : -0.07), y: 0.3 };
  for (const i of [23, 24]) points[i] = { ...points[i], x: x + (i === 23 ? 0.04 : -0.04), y: 0.6 };
  return points;
}

test('multi-person results keep distinct people in image order and filter duplicate/invalid bodies', () => {
  const left = detection(0.25), right = detection(0.75), hidden = detection(0.5);
  for (const point of hidden) point.visibility = 0.1;
  const result = { landmarks: [right, left, detection(0.251), hidden], worldLandmarks: [right, left, left, hidden] };
  const people = detectedPeople(result);
  assert.equal(people.length, 2);
  assert.equal(people[0].x, 0.25); assert.equal(people[1].x, 0.75);
  assert.equal(people[0].world, left);
  assert.deepEqual(detectedPeople({ landmarks: [[]], worldLandmarks: [] }), []);
  assert.deepEqual(detectedPeople(null), []);
  const overlapping = detection(0.25); overlapping[15].x += 0.4; overlapping[16].x -= 0.4;
  assert.equal(detectedPeople({ landmarks: [left, overlapping], worldLandmarks: [left, overlapping] }).length, 2, 'overlapping people with different limbs must remain separate');
});

test('overhead and occluded torsos are not rejected solely for hidden hips or a short projected torso', () => {
  const points = detection();
  points[23].y = points[24].y = 0.3;
  points[23].visibility = points[24].visibility = 0.01;
  points[11].x = points[12].x = points[23].x = points[24].x = 0.3;
  const world = detection();
  assert.ok(poseQuality(points, world));
  assert.equal(detectedPeople({ landmarks: [points], worldLandmarks: [world] }).length, 1);
  for (const p of points) p.presence = 0.1;
  assert.equal(poseQuality(points, world), null, 'low presence is still rejected');
});

test('rotated recognition maps pixel coordinates and world axes back to the original image', () => {
  const original = detection(), world = original.map(p => ({ ...p, x: p.x - 0.5, y: p.y - 0.5 }));
  for (const rotation of [0, 90, 180, 270]) {
    const angle = rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    const rotated = original.map(p => { const [x, y] = rotation === 90 ? [1 - p.y, p.x] : rotation === 180 ? [1 - p.x, 1 - p.y] : rotation === 270 ? [p.y, 1 - p.x] : [p.x, p.y]; return { ...p, x, y }; });
    const rotatedWorld = world.map(p => ({ ...p, x: c * p.x - s * p.y, y: s * p.x + c * p.y }));
    const [restored] = remapPoseResult({ landmarks: [rotated], worldLandmarks: [rotatedWorld] }, { rotation });
    for (let i = 0; i < 33; i++) for (const key of ['x', 'y']) {
      assert.ok(Math.abs(restored.points[i][key] - original[i][key]) < 1e-8);
      assert.ok(Math.abs(restored.world[i][key] - world[i][key]) < 1e-8);
    }
  }
});

test('rotation passes merge repeated people without collapsing two overlapping people from one pass', () => {
  const left = detection(0.3), right = detection(0.35);
  right[15].x += 0.4; right[16].x -= 0.4;
  const pass = remapPoseResult({ landmarks: [left, right], worldLandmarks: [left, right] });
  const merged = mergePoseCandidates([pass, pass, pass]);
  assert.equal(merged.landmarks.length, 2);
  const cropped = mergeCroppedPoseResult({ landmarks: [], worldLandmarks: [] }, { landmarks: [left], worldLandmarks: [left] }, { x: 0.2, y: 0.1, width: 0.5, height: 0.6 }, 1.5);
  assert.ok(Math.abs(cropped.landmarks[0][11].x - (0.2 + left[11].x * 0.5)) < 1e-8);
  assert.equal(cropped.imageAspect, 1.5);
});

test('multi-person layout retains vertical image arrangement instead of flattening all people onto one floor', () => {
  const positions = layoutDetectedPeople([{ x: 0.3, y: 0.3, torso: 0.2, imageAspect: 1.5 }, { x: 0.7, y: 0.7, torso: 0.2, imageAspect: 1.5 }], 18);
  assert.ok(positions[0].x < positions[1].x);
  assert.ok(positions[0].y > positions[1].y);
  assert.ok(Math.abs(positions[0].x / positions[0].y + 1.5) < 1e-8, 'image aspect is applied once');
  assert.deepEqual(layoutDetectedPeople([], 18), []);
});

test('partial detections disclose uncertain limbs and correction updates image joints without stretching the rig', () => {
  const points = detection(), world = structuredClone(points);
  for (const i of [25, 27]) points[i].visibility = 0.03;
  const person = detectedPeople({ landmarks: [points], worldLandmarks: [world], imageAspect: 1.5 })[0];
  assert.deepEqual(uncertainPoseParts(person), ['左腿']);
  assert.equal(correctPoseJoint(person, 25, 0.9, 0.65), true);
  assert.deepEqual(uncertainPoseParts(person), ['左腿'], 'an uncertain ankle still requires correction');
  correctPoseJoint(person, 27, 2, -1);
  assert.deepEqual(uncertainPoseParts(person), []);
  assert.equal(points[27].x, 1); assert.equal(points[27].y, 0);
  assert.equal(points[25].corrected, true);
  assert.deepEqual(world, detection(), '2D corrections retain the estimated depth and original bone lengths');
  correctPoseJoint(person, 23, 0.7, 0.8);
  assert.equal(person.x, (0.7 + points[24].x) / 2);
  assert.equal(correctPoseJoint(person, 0, 0.1, 0.2), false);
  assert.equal(correctPoseJoint(person, 25, NaN, 0.2), false);
});

test('retargeting real mannequin landmarks preserves rest lengths and source geometry', async () => {
  const THREE = await import('../../renderer/vendor/vnccs/vendor/three/three.module.js');
  const { PoseViewerCore } = await import('../../renderer/vendor/vnccs/pose_studio/core.js');
  const viewer = new PoseViewerCore({ width: 640, height: 480 }, { enableTextureSkinning: false, skinMode: 'flat_color' });
  viewer.THREE = THREE; viewer.scene = new THREE.Scene(); viewer.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
  viewer.orbit = { target: new THREE.Vector3(), update() {} }; viewer.requestRender = () => {};
  viewer.initialized = true;
  viewer.loadData(JSON.parse(await readFile(new URL('../../renderer/vendor/vnccs/pose_studio/assets/mannequin.json', import.meta.url))));
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: -1.6, z: -0.04 }));
  const set = (i, x, y, z = 0) => { world[i] = { x, y: -y, z: -z }; };
  set(11, 0.2, 1.4); set(12, -0.2, 1.4); set(23, 0.1, 0.9); set(24, -0.1, 0.9);
  set(13, 0.45, 1.65); set(15, 0.4, 1.95); set(14, -0.5, 1.35); set(16, -0.75, 1.2);
  set(25, 0.3, 0.6); set(27, 0.3, 0.15); set(26, -0.3, 0.5); set(28, -0.5, 0.1);
  set(7, 0.07, 1.6); set(8, -0.07, 1.6); set(2, 0.03, 1.64, 0.1); set(5, -0.03, 1.64, 0.1); set(0, 0, 1.6, 0.15);
  const offsets = Object.fromEntries(Object.entries(viewer.bones).map(([name, bone]) => [name, bone.position.toArray()]));
  const meshBefore = Array.from(viewer.skinnedMesh.geometry.attributes.position.array);
  applyDetectedPose(viewer, { world });
  assert.ok(Math.abs(viewer.bones.upperarm_l.rotation.z) > 0.1, 'recognition must change the arm pose');
  for (const [name, bone] of Object.entries(viewer.bones)) {
    if (name !== 'pelvis') assert.ok(bone.position.distanceTo(new THREE.Vector3(...offsets[name])) < 1e-6, name + ' retains rest offset');
    assert.ok([bone.rotation.x, bone.rotation.y, bone.rotation.z].every(Number.isFinite), name);
  }
  assert.deepEqual(Array.from(viewer.skinnedMesh.geometry.attributes.position.array), meshBefore);
  assert.throws(() => applyDetectedPose(viewer, { world: world.map(() => ({ x: NaN, y: 0, z: 0 })) }), /无效关节/);
  const base = world.map(p => ({ x: 0.5 + p.x * 0.3, y: 0.7 + p.y * 0.3, z: p.z, visibility: 0.99, presence: 0.99 }));
  for (const rotation of [0, 90, 180, 270]) {
    viewer.resetPose();
    const a = rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const points = base.map(p => ({ ...p, x: 0.5 + c * (p.x - 0.5) - s * (p.y - 0.5), y: 0.5 + s * (p.x - 0.5) + c * (p.y - 0.5) }));
    applyDetectedPose(viewer, { world, points, imageAspect: 1 });
    const position = name => viewer.bones[name].getWorldPosition(new THREE.Vector3());
    for (const [name, child, i, j] of [['upperarm_l', 'lowerarm_l', 11, 13], ['lowerarm_l', 'hand_l', 13, 15], ['thigh_r', 'calf_r', 24, 26], ['calf_r', 'foot_r', 26, 28]]) {
      const actual = position(child).sub(position(name)), expected = new THREE.Vector2(points[j].x - points[i].x, points[i].y - points[j].y);
      const error = Math.atan2(actual.y, actual.x) - Math.atan2(expected.y, expected.x);
      assert.ok(Math.abs(Math.atan2(Math.sin(error), Math.cos(error))) < 1e-5, `${rotation} degrees: ${name} must follow the image`);
    }
    assert.deepEqual(Array.from(viewer.skinnedMesh.geometry.attributes.position.array), meshBefore, 'lying and inverted retargeting never stretches the mesh');
  }
});

test('image importer rejects pose JSON and oversized files before decoding or starting a worker', async () => {
  const recognizer = createImagePoseRecognizer();
  await assert.rejects(recognizer.detect({ type: 'application/json', size: 100 }), /图片/);
  await assert.rejects(recognizer.detect({ type: 'image/png', size: 21 * 1024 * 1024 }), /20 MB/);
  recognizer.close();
  await assert.rejects(recognizer.detect({ type: 'image/png', size: 100 }), /取消/);
});

test('local inference runtime and model match their pinned upstream hashes and ship license', async () => {
  const base = new URL('../../renderer/vendor/mediapipe/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('UPSTREAM.json', base)));
  assert.equal(manifest.version, '0.10.32');
  for (const [file, hash] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(await readFile(new URL(file, base))).digest('hex'), hash, file);
  const parts = await Promise.all(manifest.modelParts.map(file => readFile(new URL(file, base))));
  assert.ok(parts.every(part => part.length < 25 * 1024 * 1024), 'model chunks fit the published asset limit');
  assert.equal(createHash('sha256').update(Buffer.concat(parts)).digest('hex'), manifest.modelSha256);
  assert.match(await readFile(new URL('LICENSE.txt', base), 'utf8'), /Apache License/);
});
