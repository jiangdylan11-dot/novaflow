// AI 特效 风格参考 takes several pictures at once (Dylan, 2026-11-04: "风格参考应该是支持多参的").
// Read out as words they blend into one material; sent as pictures each one is its own <Picture N>.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(fileURLToPath(new URL('../../renderer/aifx-restyle.workflow.js', import.meta.url)), 'utf8');
const sandbox = {};
sandbox.globalThis = sandbox;
runInContext(source, createContext(sandbox), { filename: 'aifx-restyle.workflow.js' });
const api = sandbox.NovaFlowAifxRestyleWorkflow;

test('several reads blend into one material sentence, each colour named once', () => {
  const sunflower = { elements: 'made of glowing sunflowers with bright yellow petals.', colours: 'yellow, red' };
  const ice = { elements: 'made of cracked ice shards.', colours: 'cyan, white, yellow' };
  const text = api.referenceMaterial([sunflower, ice], { shape: 'crescent slash' });
  assert.match(text, /^made of glowing sunflowers with bright yellow petals, mixed together with cracked ice shards, all of it blended/);
  assert.match(text, /Main colours: yellow, red, cyan, white\./);
  const blue = api.referenceMaterial([sunflower, ice], { colour: api.splitSupplement('整体变成蓝色').colour });
  assert.doesNotMatch(blue, /yellow petals/);
  assert.match(blue, /All of it in blue, NOT yellow, red, cyan, white\./);
  assert.equal(api.referenceMaterial([], {}), '');
});

test('every picture goes to H3 in order and the prompt names each one', () => {
  const workflow = api.buildWorkflow({ sourceVideo: 'clip.mp4', referenceImages: ['a.png', 'b.png', 'c.png'], durationSec: 1 });
  const conditioning = workflow[5];
  assert.equal(conditioning.class_type, 'MiniMaxH3ReferenceToVideo');
  assert.deepEqual(['20', '21', '22'].map(id => workflow[id].inputs.image), ['a.png', 'b.png', 'c.png']);
  for (let i = 0; i < 3; i += 1) assert.deepEqual([...conditioning.inputs['ref_images.ref_image_' + i]], [String(20 + i), 0]);
  assert.equal(conditioning.inputs['ref_images.ref_image_3'], undefined);
  assert.match(conditioning.inputs.prompt, /<Picture 1>, <Picture 2> and <Picture 3>/);
  assert.match(conditioning.inputs.prompt, /<Picture 3>: attribute_transfer/);
  assert.ok(api.validateWorkflow(workflow));
  const one = api.buildWorkflow({ sourceVideo: 'clip.mp4', referenceImages: ['a.png'], durationSec: 1 });
  assert.doesNotMatch(one[5].inputs.prompt, /<Picture 2>/);
  assert.match(one[5].inputs.prompt, /<Picture 1> supplies the material/);
  assert.throws(() => api.buildWorkflow({ sourceVideo: 'clip.mp4', referenceImages: ['1', '2', '3', '4', '5'] }), /at most 4/);
});
