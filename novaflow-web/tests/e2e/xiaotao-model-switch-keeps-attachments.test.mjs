// Switching 小桃's brain keeps the attachments the user placed but has not sent yet.
// Attachments belong to the message being written, not to a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('../../renderer/xiaotao-art-agent.js', import.meta.url)), 'utf8');

function load() {
  const revoked = [];
  const root = {
    console, btoa, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, Math, JSON,
    crypto: { randomUUID: () => 'id-' + Math.random().toString(16).slice(2) },
    URL: { createObjectURL: file => 'blob:' + file.name, revokeObjectURL: url => revoked.push(url) },
    NovaFlowXiaotaoUpload: { inspectUpload: file => ({ ok: true, kind: 'image', mimeType: 'image/png', ext: 'png' }) },
  };
  root.window = root; root.globalThis = root;
  createContext(root);
  runInContext(source, root);
  const controller = root.NovaFlowXiaotaoArtAgent.createController({ bridge: { clearPrepared() {} }, api: () => null });
  return { controller, revoked };
}
const image = name => ({ name, size: 4, type: 'image/png', arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer });

test('placed reference images survive a model switch and are not duplicated or released', async () => {
  const { controller, revoked } = load();
  const { state } = controller;
  const [doubao, deepseek] = ['bytedance/doubao-seed-2.1-lite', 'deepseek/deepseek-v4.1-flash'];
  assert.equal(state.modelId, doubao);
  assert.equal(await controller.stageUploads([image('subject.png'), image('style.png')]), true);
  const placed = [...state.staged].map(item => item.id);
  assert.deepEqual([...state.staged].map(item => item.name), ['subject.png', 'style.png']);

  assert.equal(controller.setModel(deepseek), true);
  assert.deepEqual([...state.staged].map(item => item.id), placed, 'images stay after switching 豆包 → DeepSeek');
  assert.ok(state.staged.every(item => item.status === 'ready' && item.previewUrl));

  controller.removeStaged(placed[1]);
  assert.equal(controller.setModel(doubao), true);
  assert.deepEqual([...state.staged].map(item => item.id), [placed[0]], 'switching back does not bring back a removed image');

  controller.releaseStagedMedia();
  assert.equal(new Set(revoked).size, revoked.length, 'each preview is released once');
});
