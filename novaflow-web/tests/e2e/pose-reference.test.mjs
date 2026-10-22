import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createHash } from 'node:crypto';

const renderer = new URL('../../renderer/', import.meta.url);
const source = await readFile(new URL('pose-reference.tool.js', renderer), 'utf8');
const context = createContext({ URL, setTimeout, clearTimeout });
runInContext(source, context);
const tool = context.NovaFlowPoseReferenceTool;
const document = { version: 1, width: 768, height: 1024, background: '#e4e5e8', pose: { bones: { head: [5, 10, 0] }, bonePositions: { Root: [0, 0, 0] }, modelRotation: [0, 30, 0], camera: { posX: 0, posY: 1, posZ: 4, targetX: 0, targetY: 1, targetZ: 0 }, ikEffectorPositions: { hand_l: [1, 2, 0] } } };
const plain = value => JSON.parse(JSON.stringify(value));

function bridge(references = [], limit = 3) {
  return {
    state: { active: true, mode: 'txt2img', provider: 'local', nsfw: true, steps: 6, cfg: 1, prompt: '保留我的提示词', running: false },
    references: () => references, referenceLimit: () => limit,
    setReference(index, value) { references[index] = value; },
    setMode(mode) { this.state.mode = mode; }, render() { this.rendered = true; },
  };
}

test('pose file round trip retains camera, IK and translated joints without sharing mutable state', () => {
  const restored = tool.normalizeDocument(document);
  assert.deepEqual(plain(restored), document);
  restored.pose.bones.head[0] = 90;
  assert.equal(document.pose.bones.head[0], 5);
  assert.throws(() => tool.normalizeDocument({}), /骨骼/);
  assert.throws(() => tool.normalizeDocument({ pose: { bones: { head: ['5', 0, 0] } } }), /骨骼旋转/);
  assert.throws(() => tool.normalizeDocument({ pose: { bones: {}, camera: { posX: 'bad' } } }), /镜头/);
  assert.throws(() => tool.normalizeDocument({ pose: { bones: {}, bonePositions: { Root: [0, 0] } } }), /关节位置/);
  assert.throws(() => tool.normalizeDocument(JSON.parse('{"pose":{"bones":{},"__proto__":{}}}')), /无效字段/);
});

test('sending a pose fills the first empty reference and preserves the 2511 route, parameters and prompt', () => {
  const existing = { name: '角色.png', dataUrl: 'existing' };
  const api = bridge([existing, null, { dataUrl: 'style' }]);
  const before = { ...api.state };
  assert.equal(tool.applyReference(api, document, 'data:image/png;base64,aGVsbG8='), 1);
  assert.equal(api.references()[0], existing);
  assert.equal(api.references()[2].dataUrl, 'style');
  assert.equal(api.references()[1].width, 768);
  assert.deepEqual(plain(api.references()[1].poseDocument), document);
  assert.deepEqual([api.state.nsfw, api.state.steps, api.state.cfg, api.state.provider, api.state.prompt], [before.nsfw, before.steps, before.cfg, before.provider, before.prompt]);
  assert.equal(api.state.mode, 'img2img');
  assert.equal(api.rendered, true);
});

test('a full reference list or a running generation rejects the addition without overwriting anything', () => {
  const references = [{ dataUrl: 'one' }, { dataUrl: 'two' }, { dataUrl: 'three' }];
  const api = bridge(references);
  const before = JSON.stringify(references);
  assert.throws(() => tool.applyReference(api, document, 'data:image/png;base64,aGVsbG8='), /已满/);
  assert.equal(JSON.stringify(references), before);
  const running = bridge([]); running.state.running = true;
  assert.throws(() => tool.applyReference(running, document, 'data:image/png;base64,aGVsbG8='), /生成结束/);
  assert.equal(running.references().length, 0);
});

test('vendored core matches the pinned upstream and the compact mannequin has valid skinning and licenses', async () => {
  const provenance = JSON.parse(await readFile(new URL('vendor/vnccs/UPSTREAM.json', renderer)));
  assert.equal(provenance.mannequin.bodyStage, 'adult');
  assert.equal(provenance.mannequin.shape.age, 45.5, 'the upstream adult morph target must not regress to a normalized infant age');
  for (const [file, digest] of Object.entries(provenance.files)) {
    const bytes = await readFile(new URL(`vendor/vnccs/${file}`, renderer));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, file);
  }
  const model = JSON.parse(await readFile(new URL('vendor/vnccs/pose_studio/assets/mannequin.json', renderer)));
  const count = model.vertices.length / 3;
  assert.ok(model.bones.length > 40);
  assert.equal(model.skinIndices.length, count * 4);
  assert.equal(model.skinWeights.length, count * 4);
  assert.ok(model.indices.every(index => Number.isInteger(index) && index >= 0 && index < count));
  assert.ok(model.skinIndices.every(index => Number.isInteger(index) && index >= 0 && index < model.bones.length));
  for (let i = 0; i < count; i++) assert.ok(Math.abs(model.skinWeights.slice(i * 4, i * 4 + 4).reduce((a, b) => a + b, 0) - 1) < 0.0001);
  const html = await readFile(new URL('index.html', renderer), 'utf8');
  assert.equal((html.match(/src="\.\/pose-reference\.tool\.js/g) || []).length, 1);
});

test('all 136 upstream poses and previews are present, unmodified, and load on the adult rig', async () => {
  const manifest = JSON.parse(await readFile(new URL('vendor/vnccs/pose_library/index.json', renderer)));
  assert.equal(manifest.poses.length, 136);
  assert.equal(new Set(manifest.poses.map(p => p.id)).size, 136);
  const model = JSON.parse(await readFile(new URL('vendor/vnccs/pose_studio/assets/mannequin.json', renderer)));
  const bones = new Set(model.bones.map(b => b.name));
  for (const entry of manifest.poses) {
    const raw = await readFile(new URL(`vendor/vnccs/pose_library/${entry.json}`, renderer));
    assert.equal(createHash('sha256').update(raw).digest('hex'), entry.jsonSha256, entry.id);
    const preview = await readFile(new URL(`vendor/vnccs/pose_library/${entry.preview}`, renderer));
    assert.equal(createHash('sha256').update(preview).digest('hex'), entry.previewSha256, entry.id);
    const doc = tool.normalizeDocument(JSON.parse(raw));
    assert.ok(Object.keys(doc.pose.bones).length > 0, entry.name);
    assert.ok(Object.keys(doc.pose.bones).every(bone => bones.has(bone)), entry.name);
    assert.equal(doc.pose.mesh, undefined, 'a library pose must not change the adult body');
    assert.equal(doc.pose.prompt, undefined, 'a library pose must not replace user prompt text');
  }
});

test('actual OrbitControls rotates on empty left drag, pans on Ctrl-left drag and ignores right drag, and leaves rig drags exclusive', async () => {
  const THREE = await import(new URL('vendor/vnccs/vendor/three/three.module.js', renderer));
  const { OrbitControls } = await import(new URL('vendor/vnccs/vendor/three/OrbitControls.js', renderer));
  class Canvas {
    style = {}; clientWidth = 640; clientHeight = 480; listeners = new Map();
    addEventListener(type, fn, options) { const list = this.listeners.get(type) || []; list.push({ fn, capture: options === true || options?.capture }); this.listeners.set(type, list); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.fn !== fn)); }
    capture = null; setPointerCapture(id) { this.capture = id; } hasPointerCapture(id) { return this.capture === id; } releasePointerCapture() { this.capture = null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; }
    fire(type, button, x, y, ctrlKey = false) { let stopped = false; const event = { type, button, ctrlKey, clientX: x, clientY: y, pageX: x, pageY: y, pointerId: 1, pointerType: 'mouse', preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stopped = true; } }; for (const { fn } of [...this.listeners.get(type) || []].sort((a, b) => Number(b.capture || false) - Number(a.capture || false))) { fn(event); if (stopped) break; } }
  }
  const canvas = new Canvas(), camera = new THREE.PerspectiveCamera(45, 640 / 480, 0.1, 100);
  camera.position.set(0, 0, 5);
  const orbit = new OrbitControls(camera, canvas);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  tool.configureNavigation({ THREE, orbit, camera, skinnedMesh: mesh, jointMarkers: [] }, canvas);
  const drag = (button, from, to, ctrl = false) => { canvas.fire('pointerdown', button, ...from, ctrl); canvas.fire('pointermove', button, ...to, ctrl); canvas.fire('pointerup', button, ...to, ctrl); };
  const initialPosition = camera.position.clone(), initialTarget = orbit.target.clone();
  drag(0, [20, 20], [100, 60]);
  assert.ok(camera.position.distanceTo(initialPosition) > 0.1, 'empty left drag must orbit');
  assert.ok(orbit.target.distanceTo(initialTarget) < 1e-10, 'orbit must retain its target');
  const initialOffset = camera.position.clone().sub(orbit.target), targetBeforePan = orbit.target.clone();
  drag(2, [30, 30], [100, 80]);
  assert.ok(orbit.target.distanceTo(targetBeforePan) < 1e-10, 'right drag is disabled');
  drag(0, [320, 240], [100, 80], true);
  assert.ok(orbit.target.distanceTo(targetBeforePan) > 0.1, 'Ctrl-left drag must pan even over the body');
  assert.equal(canvas.capture, null, 'pan releases pointer capture');
  assert.ok(camera.position.clone().sub(orbit.target).distanceTo(initialOffset) < 1e-10, 'pan must retain view direction');
  canvas.fire('pointerdown', 0, 10, 10, true);
  canvas.fire('pointercancel', 0, 10, 10, true);
  assert.equal(canvas.capture, null, 'cancelled navigation releases capture');
  const targetAfterCancel = orbit.target.clone();
  canvas.fire('pointermove', 0, 140, 80);
  assert.ok(orbit.target.distanceTo(targetAfterCancel) < 1e-10, 'a cancelled drag must not keep moving the camera');
  orbit.target.set(0, 0, 0); camera.position.set(0, 0, 5); orbit.update();
  const positionBeforeRigDrag = camera.position.clone();
  drag(0, [320, 240], [350, 260]);
  assert.ok(camera.position.distanceTo(positionBeforeRigDrag) < 1e-10, 'dragging the rig must not rotate the camera');
  orbit.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});

test('sending a pose from Enhance opens image editing and preserves the current provider and references', () => {
  const existing = { dataUrl: 'character' }, api = bridge([existing]); api.state.active = false; api.state.provider = 'gpt';
  api.activate = function (mode) { this.state.active = true; this.state.mode = mode; };
  assert.equal(tool.applyReference(api, document, 'data:image/png;base64,aGVsbG8='), 1);
  assert.equal(api.state.active, true); assert.equal(api.state.mode, 'img2img'); assert.equal(api.state.provider, 'gpt'); assert.equal(api.references()[0], existing);
});

test('pose selectors bypass global portals while ordinary workspace selectors retain their behavior', async () => {
  const brand = await readFile(new URL('novaflow-brand-runtime.js', renderer), 'utf8');
  const start = brand.indexOf('  function shouldPortalNativeSelect('), end = brand.indexOf('  function setNativeControlValue(', start);
  class Select {
    disabled = false; multiple = false; size = 0; options = [{}];
    constructor(pose) { this.pose = pose; }
    closest(selector) { return this.pose && selector === '[data-novaflow-pose-reference="1"]' ? {} : null; }
    getBoundingClientRect() { return { width: 100, height: 32 }; }
  }
  const host = createContext({ HTMLSelectElement: Select, window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) } });
  runInContext(brand.slice(start, end), host);
  assert.equal(host.shouldPortalNativeSelect(new Select(true)), false);
  assert.equal(host.shouldPortalNativeSelect(new Select(false)), true);
});

test('scene documents retain independent poses, positions, selection and empty scenes', () => {
  const scene = { ...document, version: 2, activeCharacterId: 'person-2', characters: [
    { id: 'person-1', name: '人物 1', pose: { bones: { head: [10, 0, 0] } }, transform: { x: -10, y: 0, z: 0 } },
    { id: 'person-2', name: '人物 2', pose: { bones: { head: [-20, 0, 0] } }, transform: { x: 10, y: 0, z: 5 }, body: { gender: 'male', age: 'child' } },
  ] };
  const restored = tool.normalizeDocument(scene);
  assert.deepEqual(plain(restored), scene);
  restored.characters[0].pose.bones.head[0] = 90;
  assert.equal(scene.characters[0].pose.bones.head[0], 10);
  assert.equal(tool.normalizeDocument({ ...scene, characters: [] }).activeCharacterId, null);
  assert.throws(() => tool.normalizeDocument({ ...scene, characters: [scene.characters[0], scene.characters[0]] }), /编号重复/);
  assert.throws(() => tool.normalizeDocument({ ...scene, characters: [{ ...scene.characters[0], transform: { x: NaN } }] }), /人物位置/);
  assert.throws(() => tool.normalizeDocument({ ...scene, characters: [{ ...scene.characters[0], body: { age: 'unknown', gender: 'neutral' } }] }), /体型/);
  const legacy = tool.normalizeDocument({ ...scene, characters: [{ ...scene.characters[0], body: { gender: 'neutral', age: 'adult' }, pose: { bones: { head: [10, 0, 0] }, bonePositions: { pelvis: [1, 2, 3] } } }] });
  assert.equal(legacy.characters[0].body.gender, 'neutral');
  assert.deepEqual(plain(legacy.characters[0].pose.bonePositions), { pelvis: [1, 2, 3] }, 'neutral joint edits must survive document validation');
});

test('workspace coordinate fallbacks never intercept buttons inside the pose dialog', async () => {
  const source = await readFile(new URL('spine-split-runtime.js', renderer), 'utf8');
  class Element { constructor(pose = true) { this.pose = pose; } closest() { return this.pose ? this : null; } }
  const host = createContext({ Element });
  for (const name of ['splitControlElementFromPoint', 'splitLayerCommandElementFromPoint', 'splitLayerRowElementFromPoint', 'splitSetToggleElementFromPoint', 'inpaintModeElementFromPoint', 'splitToolElementFromPoint']) {
    const start = source.indexOf(`  function ${name}(event) {`), end = source.indexOf('\n  function ', start + 10);
    runInContext(source.slice(start, end), host);
    // None of the workspace globals exist in this context: a modal event must
    // return before inspecting underlying geometry, rows, actions or tools.
    assert.equal(host[name]({ target: new Element(), clientX: 120, clientY: 180 }), null, name);
    let checked = false;
    host.isMountedCardVisible = () => { checked = true; return false; };
    host[name]({ target: new Element(false), clientX: 120, clientY: 180 });
    assert.equal(checked, true, `${name} retains ordinary workspace routing`);
    delete host.isMountedCardVisible;
  }
});

test('real upstream rigs add, switch, move, serialize and delete independently without moving the camera', async () => {
  const THREE = await import(new URL('vendor/vnccs/vendor/three/three.module.js', renderer));
  const { PoseViewerCore } = await import(new URL('vendor/vnccs/pose_studio/core.js', renderer));
  const viewer = new PoseViewerCore({ width: 640, height: 480 }, { enableTextureSkinning: false, skinMode: 'flat_color' });
  viewer.THREE = THREE; viewer.scene = new THREE.Scene(); viewer.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
  viewer.camera.position.set(0, 0, 50);
  viewer.orbit = { target: new THREE.Vector3(), update() {} };
  viewer.transform = Object.assign(new THREE.EventDispatcher(), { detach() { this.object = null; }, setMode(mode) { this.mode = mode; }, setSpace(space) { this.space = space; }, attach(object) { this.object = object; } }); viewer.requestRender = () => {};
  viewer.initialized = true;
  viewer.loadData(JSON.parse(await readFile(new URL('vendor/vnccs/pose_studio/assets/mannequin.json', renderer), 'utf8')));
  const catalog = JSON.parse(await readFile(new URL('vendor/vnccs/pose_studio/assets/body-types.json', renderer), 'utf8'));
  const models = Object.fromEntries(await Promise.all(catalog.bodies.map(async body => [body.id, JSON.parse(await readFile(new URL(`vendor/vnccs/pose_studio/assets/${body.file}`, renderer), 'utf8'))])));
  const characters = tool.createCharacters(viewer, () => {}, models);
  characters.restore({ pose: { bones: { head: [12, 0, 0] } } });
  assert.equal(characters.active().body.gender, 'neutral', 'all people default to the neutral mannequin');
  const cameraBefore = viewer.camera.position.clone();
  viewer.recordState(); viewer.bones.head.rotation.x = 0.7;
  const second = characters.add();
  assert.equal(characters.people.length, 2);
  assert.equal(second.transform.x, 10, 'new people must have a distinct nearby position');
  assert.equal(viewer.passiveCharacters.size, 1);
  const firstMesh = viewer.passiveCharacters.get('person-1').mesh;
  assert.notEqual(firstMesh.skeleton.bones[0], viewer.skeleton.bones[0]);
  assert.equal(viewer.history.length, 0, 'new person has separate history');
  viewer.bones.head.rotation.x = -0.4;
  characters.setPosition('x', 15);
  const saved = characters.snapshot();
  characters.select('person-1');
  assert.ok(Math.abs(viewer.bones.head.rotation.x - 0.7) < 1e-10);
  assert.equal(viewer.history.length, 1, 'person switching retains its undo history');
  assert.equal(viewer.passiveCharacters.get(second.id).mesh.position.x, 15);
  characters.select(second.id);
  assert.ok(Math.abs(viewer.bones.head.rotation.x + 0.4) < 1e-10);
  assert.ok(viewer.camera.position.distanceTo(cameraBefore) < 1e-10);
  characters.restore(saved);
  assert.equal(characters.active().id, second.id);
  assert.equal(viewer.skinnedMesh.position.x, 15);
  characters.setBody('age', 'child');
  assert.ok(viewer.camera.position.distanceTo(cameraBefore) < 1e-10, 'body changes must not rescale the camera');
  const childHeight = () => { viewer.skinnedMesh.computeBoundingBox(); return viewer.skinnedMesh.boundingBox.getSize(new THREE.Vector3()).y; };
  const height = childHeight();
  assert.equal(characters.active().body.age, 'child');
  assert.ok(Math.abs(viewer.bones.head.rotation.x + 0.4) < 1e-10, 'body changes retain pose rotations');
  characters.select('person-1'); characters.setBody('proportion', 9);
  assert.ok(childHeight() > height, 'adult and child must use different physical proportions');
  assert.ok(Math.abs(viewer.passiveCharacters.get(second.id).mesh.geometry.getAttribute('position').array[0] - models['child-neutral'].vertices[0]) < 1e-6);
  const mixed = characters.snapshot(); characters.restore(mixed);
  assert.equal(characters.active().body.gender, 'neutral'); assert.equal(characters.active().body.proportion, 9);
  characters.select(second.id);
  assert.equal(characters.active().body.age, 'child'); assert.equal(viewer.skinnedMesh.position.x, 15);
  assert.ok(Math.abs(childHeight() - height) < 1e-5, 'mixed body types survive scene restore');
  viewer.setIKMode(false);
  const movement = tool.configureRootTranslation(viewer, characters, () => {});
  viewer.selectBoneByName('Root'); movement.sync();
  assert.equal(viewer.transform.mode, 'translate'); assert.equal(viewer.transform.space, 'world');
  const poseBeforeMove = plain(viewer.getPose().bones);
  viewer.recordState(); viewer.transform.dispatchEvent({ type: 'dragging-changed', value: true });
  viewer.transform.object.position.x += 3; viewer.transform.object.position.z += 2;
  viewer.transform.dispatchEvent({ type: 'objectChange' });
  viewer.transform.dispatchEvent({ type: 'dragging-changed', value: false });
  assert.equal(characters.active().transform.x, 18); assert.equal(characters.active().transform.z, 2);
  assert.deepEqual(plain(viewer.getPose().bones), poseBeforeMove, 'whole-person movement must preserve every joint rotation');
  viewer.undo(); assert.equal(characters.active().transform.x, 15); assert.equal(characters.active().transform.z, 0);
  viewer.redo(); assert.equal(characters.active().transform.x, 18); assert.equal(characters.active().transform.z, 2);
  viewer.selectBoneByName('calf_l'); movement.sync();
  assert.equal(viewer.transform.mode, 'translate'); assert.equal(viewer.ikMode, false);
  const localBefore = viewer.bones.calf_l.position.clone();
  const footBefore = viewer.bones.foot_l.getWorldPosition(new THREE.Vector3());
  const bonesBefore = plain(viewer.getPose().bones), actorPositionBefore = { ...characters.active().transform };
  const footIndex = viewer.boneList.indexOf(viewer.bones.foot_l), skinIndices = viewer.skinnedMesh.geometry.getAttribute('skinIndex');
  let footVertex = -1;
  for (let i = 0; i < skinIndices.count && footVertex < 0; i++) for (let j = 0; j < 4; j++) {
    if (skinIndices.array[i * 4 + j] === footIndex && viewer.skinnedMesh.geometry.getAttribute('skinWeight').array[i * 4 + j] > 0.9) footVertex = i;
  }
  assert.ok(footVertex >= 0);
  const vertexBefore = viewer.skinnedMesh.getVertexPosition(footVertex, new THREE.Vector3());
  viewer.recordState(); movement.setOffset('y', -1.25);
  assert.ok(Math.abs(viewer.bones.calf_l.position.y - localBefore.y + 1.25) < 1e-8);
  assert.ok(viewer.bones.foot_l.getWorldPosition(new THREE.Vector3()).distanceTo(footBefore) > 1.2, 'moving a joint changes limb length');
  assert.ok(viewer.skinnedMesh.getVertexPosition(footVertex, new THREE.Vector3()).distanceTo(vertexBefore) > 1.2, 'the actual skinned vertices must follow, not just the marker');
  assert.deepEqual(plain(viewer.getPose().bones), bonesBefore);
  assert.deepEqual({ ...characters.active().transform }, actorPositionBefore);
  viewer.undo(); assert.ok(viewer.bones.calf_l.position.distanceTo(localBefore) < 1e-8);
  viewer.redo(); assert.ok(Math.abs(movement.getOffset('y') + 1.25) < 1e-8);
  const edited = characters.snapshot();
  characters.select('person-1'); characters.select(second.id);
  assert.ok(Math.abs(viewer.bones.calf_l.position.y - localBefore.y + 1.25) < 1e-8, 'joint positions survive person switching');
  characters.restore(edited);
  assert.ok(Math.abs(viewer.bones.calf_l.position.y - localBefore.y + 1.25) < 1e-8, 'joint positions survive scene saving and restoring');
  viewer.selectBoneByName('head'); movement.setMode('rotate'); movement.sync();
  assert.equal(viewer.transform.mode, 'rotate'); assert.equal(viewer.transform.space, 'local'); assert.equal(viewer.ikMode, true);
  movement.setMode('translate'); assert.equal(viewer.ikMode, false, 'joint translation must disable IK');
  movement.setMode('rotate'); assert.equal(viewer.ikMode, true, 'rotation must always enable IK, including when it was initially disabled');
  characters.remove(second.id); characters.remove('person-1');
  assert.equal(characters.people.length, 0); assert.equal(viewer.passiveCharacters.size, 0);
  assert.equal(viewer.skinnedMesh.visible, false);
  assert.equal(characters.snapshot().activeCharacterId, null);
  characters.add();
  assert.equal(viewer.skinnedMesh.visible, true, 'adding to an empty scene restores the editor rig');
  const femaleCalf = models['adult-female'].bones.find(bone => bone.name === 'calf_l');
  const femaleThigh = models['adult-female'].bones.find(bone => bone.name === femaleCalf.parent);
  const oldPosition = femaleCalf.headPos.map((v, i) => v - femaleThigh.headPos[i]); oldPosition[0] += 0.75;
  characters.restore({ characters: [{ id: 'person-1', name: '骨骼移动验证', body: { age: 'adult', gender: 'female' }, transform: { x: 4, y: 0, z: 0 }, pose: { bones: {}, bonePositions: { calf_l: oldPosition } } }] });
  assert.equal(characters.active().name, '人物 1'); assert.equal(characters.active().body.gender, 'neutral');
  assert.ok(Math.abs(viewer.bones.calf_l.position.x - viewer.shapedBoneRestPositions.calf_l.x - 0.75) < 1e-8, 'legacy body migration retains the manually edited offset');
  characters.setBody('proportion', 3);
  assert.ok(Math.abs(viewer.bones.calf_l.position.x - viewer.shapedBoneRestPositions.calf_l.x - 0.75) < 1e-8);
  characters.setBody('proportion', 9);
  assert.ok(Math.abs(viewer.bones.calf_l.position.x - viewer.shapedBoneRestPositions.calf_l.x - 0.75) < 1e-8, 'head ratios retain manually edited offsets');
  assert.equal(characters.snapshot().characters[0].body.proportion, 9);
  viewer.clearPassiveCharacters(); viewer._cleanupPrevious();
});

test('neutral age and head-ratio models have pinned geometry, shared ground and measured nonuniform proportions', async () => {
  const catalog = JSON.parse(await readFile(new URL('vendor/vnccs/pose_studio/assets/body-types.json', renderer), 'utf8'));
  const models = {};
  for (const body of catalog.bodies) {
    const bytes = await readFile(new URL(`vendor/vnccs/pose_studio/assets/${body.file}`, renderer));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), body.sha256);
    if (body.shape) assert.equal(body.shape.show_genitals, false);
    models[body.id] = JSON.parse(bytes);
    assert.equal(models[body.id].bones.length, 53);
    const y = models[body.id].vertices.filter((_, i) => i % 3 === 1);
    assert.ok(Math.abs(Math.min(...y) + 8.450465) < 1e-5, 'all bodies share the same floor');
  }
  assert.equal(Object.keys(models).length, 22);
  assert.notDeepEqual(models['adult-female'].vertices, models['adult-male'].vertices);
  assert.notDeepEqual(models['child-female'].vertices, models['adult-female'].vertices);
  const shoulderRatio = model => {
    const bones = Object.fromEntries(model.bones.map(bone => [bone.name, bone]));
    const shoulderWidth = Math.hypot(...bones.upperarm_l.headPos.map((v, i) => v - bones.upperarm_r.headPos[i]));
    const y = model.vertices.filter((_, i) => i % 3 === 1);
    return shoulderWidth / (Math.max(...y) - Math.min(...y));
  };
  assert.ok(shoulderRatio(models['adult-male']) > shoulderRatio(models['adult-female']) * 1.1, 'adult meshes must differ in silhouette proportions, beyond overall scale');
  const presets = catalog.bodies.filter(body => body.proportion);
  assert.equal(presets.length, 16);
  for (const body of presets) {
    const model = models[body.id], y = model.vertices.filter((_, i) => i % 3 === 1), height = Math.max(...y) - Math.min(...y);
    const headHeight = Math.max(...y) - model.vertices[body.chinVertex * 3 + 1];
    assert.ok(Math.abs(height / headHeight - body.proportion) < 0.001, `${body.id}: measured head count`);
  }
  const small = models['adult-neutral-3'], tall = models['adult-neutral-9'];
  const boneLength = (model, name) => { const b = model.bones.find(bone => bone.name === name); return Math.hypot(...b.headPos.map((v, i) => b.tailPos[i] - v)); };
  assert.ok(boneLength(tall, 'calf_l') > boneLength(small, 'calf_l') * 1.5, '9-head legs must be proportionally longer');
  assert.ok(boneLength(small, 'head') > boneLength(tall, 'head') * 2, '3-head preset must enlarge the head instead of uniformly shrinking the figure');
  assert.ok(Math.abs(Math.max(...small.vertices.filter((_, i) => i % 3 === 1)) - Math.max(...tall.vertices.filter((_, i) => i % 3 === 1))) < 0.001, 'preset silhouettes retain the same overall standing height');

});
