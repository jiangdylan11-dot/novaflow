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
