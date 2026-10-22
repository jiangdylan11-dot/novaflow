import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { detectedPeople, applyDetectedPose, createImagePoseRecognizer } from '../../renderer/pose-reference-image.js';

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
  assert.match(await readFile(new URL('LICENSE.txt', base), 'utf8'), /Apache License/);
});
