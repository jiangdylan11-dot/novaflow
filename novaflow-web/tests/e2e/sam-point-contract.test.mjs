import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createWorkflowHost } from '../../worker/src/comfy/workflow-host.mjs';

test('SAM accepts canvas strings and web arrays, with foreground kept opaque', async () => {
  const host = await createWorkflowHost({
    rendererDir: fileURLToPath(new URL('../../worker-renderer/', import.meta.url)),
    objectInfo: {
      ...Object.fromEntries(['LoadImage', 'SAM Parameters', 'SAM Image Mask', 'InvertMask', 'JoinImageWithAlpha', 'SaveImage'].map(n => [n, {}])),
      'SAM Model Loader': { input: { required: { model_size: [['ViT-B']] } } }
    }
  });
  const build = prompts => host.buildGraph({ module: 'spine-split-runtime', method: 'samPointWorkflowFromPrompts',
    options: { __args: [{}, 'fixture.png', 'sam_test', prompts, {}] } });
  const fromCanvas = await build({ points: '[10,20]; [30,40]', labels: '[1,0]' });
  const fromWeb = await build({ points: [[10, 20], [30, 40]], labels: [1, 0] });
  assert.deepEqual(fromCanvas, fromWeb);
  assert.equal(fromCanvas['3'].inputs.points, '[10,20]; [30,40]');
  // Core JoinImageWithAlpha computes alpha=1-mask, while SAM returns foreground=1.
  const inversion = fromCanvas[fromCanvas['5'].inputs.alpha[0]];
  assert.equal(inversion.class_type, 'InvertMask');
  assert.deepEqual(Array.from(inversion.inputs.mask), ['4', 1]);
  await assert.rejects(build({ points: [[10, 20]], labels: [0] }), /提示点无效/);
  await assert.rejects(build({ points: [[10, 20]], labels: [1, 0] }), /提示点无效/);
});
