import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadSpine } = require('../../../tools/qwen-rapid-migration-smoke.cjs');
const runtime = loadSpine('novaflow-web/renderer/spine-split-runtime.js');
const parts = ['hair_front', 'face', 'eyebrow_l', 'eyelash_r', 'irides_r', 'ears_l', 'earwear', 'headwear', 'head', 'body']
  .map(id => ({ id, dataUrl: 'image', ...(id === 'head' ? { seeThroughHeadLayer: true } : {}) }));

test('whole-head mode preserves facial details for compositing and removes only the redundant face', () => {
  runtime.state.includeFaceDetails = false;
  assert.deepEqual(Array.from(runtime.applySeeThroughHeadLayer(parts)), parts.filter(p => p.id !== 'face'));
  assert.equal(parts.length, 10, 'source layer list is not mutated');
});

test('separate facial detail mode retains the face and features instead of whole head', () => {
  runtime.state.includeFaceDetails = true;
  assert.deepEqual(Array.from(runtime.applySeeThroughHeadLayer(parts)), parts.filter(p => p.id !== 'head'));
});

test('missing or unusable whole-head output keeps original layers', () => {
  runtime.state.includeFaceDetails = false;
  const noHead = parts.filter(p => p.id !== 'head');
  assert.equal(runtime.applySeeThroughHeadLayer(noHead), noHead);
  const emptyHead = [...noHead, { id: 'head', seeThroughHeadLayer: true, dataUrl: '' }];
  assert.equal(runtime.applySeeThroughHeadLayer(emptyHead), emptyHead);
});
