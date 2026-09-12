const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../../particle-editor/novaflow-brand-runtime.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf('\n  function ', start + 1);
  return source.slice(start, end);
}
const inject = new Function('ART_GENERATE_STATE', [
  'artGenerateNextWorkflowNodeKey',
  'artGenerateAspectFitPlan',
  'injectArtWorkflowTargetSize',
].map(extract).join('\n') + '\nreturn injectArtWorkflowTargetSize;')({});

test('ordinary img2img fits the original image without first center-cropping it', () => {
  const workflow = JSON.parse(source.match(/\n\s+img2img: `([^`]+)`/)[1]);
  const [legacyId, legacy] = Object.entries(workflow).find(([, node]) => node.class_type === 'FluxKontextImageScale');
  const input = [...legacy.inputs.image];
  const consumers = Object.values(workflow).filter(node =>
    Object.values(node.inputs).some(value => Array.isArray(value) && value[0] === legacyId));
  assert.ok(consumers.length > 0);
  assert.equal(inject(workflow, { width: 956, height: 1348 }, { width: 956, height: 1348 }), true);
  const [fitId, fit] = Object.entries(workflow).find(([, node]) => node.class_type === 'ImageScale');
  assert.deepEqual(fit.inputs.image, input, 'reference must reach aspect-fit before any fixed-ratio crop');
  assert.equal(fit.inputs.width, 956);
  assert.equal(fit.inputs.height, 1348);
  assert.equal(fit.inputs.crop, 'disabled');
  for (const node of consumers) {
    assert.ok(Object.values(node.inputs).some(value => Array.isArray(value) && value[0] === fitId));
    assert.ok(!Object.values(node.inputs).some(value => Array.isArray(value) && value[0] === legacyId));
  }
});

test('different target aspect ratio pads the whole reference and connects VAE and conditioning to it', () => {
  const graph = {
    input: { class_type: 'LoadImage', inputs: { image: 'reference.png' } },
    legacy: { class_type: 'FluxKontextImageScale', inputs: { image: ['input', 0] } },
    encode: { class_type: 'VAEEncode', inputs: { pixels: ['legacy', 0] } },
    condition: { class_type: 'TextEncodeQwenImageEditPlus', inputs: { image1: ['legacy', 0] } },
  };
  inject(graph, { width: 1920, height: 1080 }, { width: 1024, height: 1024 });
  const [fitId, fit] = Object.entries(graph).find(([, node]) => node.class_type === 'ImageScale');
  const [padId, pad] = Object.entries(graph).find(([, node]) => node.class_type === 'ImagePadForOutpaint');
  assert.deepEqual(fit.inputs.image, ['input', 0]);
  assert.equal(fit.inputs.width, 1024);
  assert.equal(fit.inputs.height, 576);
  assert.deepEqual(pad.inputs.image, [fitId, 0]);
  assert.equal(pad.inputs.top, 224);
  assert.equal(pad.inputs.bottom, 224);
  assert.deepEqual(graph.encode.inputs.pixels, [padId, 0]);
  assert.deepEqual(graph.condition.inputs.image1, [padId, 0]);
});

test('pixel-budget preprocessing keeps its existing direct-source behavior', () => {
  const graph = {
    budget: { class_type: 'ImageScaleToTotalPixels', inputs: { image: ['input', 0] } },
    encode: { class_type: 'VAEEncode', inputs: { pixels: ['budget', 0] } },
  };
  inject(graph, { width: 512, height: 512 }, { width: 512, height: 512 });
  const fit = Object.values(graph).find(node => node.class_type === 'ImageScale');
  assert.deepEqual(fit.inputs.image, ['input', 0]);
});

test('the ordinary workflow receives the whole multiline instruction as one prompt', () => {
  const names = ['artPromptLikeNegative', 'artPromptLikePositive', 'artGenerateNextWorkflowNodeKey',
    'artGenerateAspectFitPlan', 'injectArtWorkflowTargetSize', 'artGenerateReferenceLoadImageKeys',
    'artGenerateReferenceTextEncodeNodes', 'artGenerateConsumedReferenceCount',
    'syncArtWorkflowReferenceImages', 'patchArtWorkflow'];
  const state = { width: 956, height: 1348, randomSeed: false, seed: 123 };
  const patch = new Function('ART_GENERATE_STATE', names.map(extract).join('\n') + '\nreturn patchArtWorkflow;')(state);
  const graph = JSON.parse(source.match(/\n\s+img2img: `([^`]+)`/)[1]);
  const positive = '保留角色服装，只修改背景。\n\n保持原图已有的光照与边缘风格。';
  const negative = '模糊\n低完成度';
  patch(graph, ['reference.png'], 'test', positive, negative, [{ width: 956, height: 1348 }], state);
  const encoders = Object.values(graph).filter(node => node.class_type === 'TextEncodeQwenImageEditPlus');
  assert.ok(encoders.some(node => node.inputs.prompt === positive));
  assert.ok(encoders.some(node => node.inputs.prompt === negative));
  assert.ok(encoders.every(node => typeof node.inputs.prompt === 'string'));
});
