// Image generation offers Qwen locally and GPT Image 2.5 in the cloud.
// The video panel's local option is MiniMaxH3(本地).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const renderer = new URL('../../renderer/', import.meta.url);

function load(name, extra = {}) {
  const context = {
    console,
    module: { exports: {} },
    exports: {},
    localStorage: { getItem: () => null, setItem() {} },
    ...extra,
  };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(readFileSync(new URL(name, renderer), 'utf8'), context, { filename: name });
  return context.module.exports;
}

const imageLabels = [
  { value: 'local', label: 'Qwen（本地）' },
  { value: 'gpt', label: 'GPT Image 2.5' },
];

test('image generation selectors are Qwen（本地） and GPT Image 2.5', () => {
  for (const file of [
    'art-generate-mode.tool.js',
    'ui-design-mode.tool.js',
    'ui-design-generate.tool.js',
  ]) {
    const api = load(file);
    assert.deepEqual(Array.from(api.PROVIDER_OPTIONS, (option) => ({ value: String(option.value), label: String(option.label) })), imageLabels, file);
  }
  const models = load('art-generate-model.resource.js');
  assert.deepEqual(Array.from(models.providerOptions, (option) => ({ value: String(option.value), label: String(option.label) })), imageLabels);
  assert.equal(models.providerTitle('local'), 'Qwen（本地）');
  assert.equal(models.providerTitle('gpt'), 'GPT Image 2.5');
  assert.equal(models.providerTitle('google'), 'Qwen（本地）');
});

test('the video panel local option is MiniMaxH3(本地)', () => {
  const resource = load('ai-sequence-minimax-h3.resource.js');
  assert.equal(resource.MODEL.label, 'MiniMaxH3(本地)');
  const workflow = load('ai-sequence-minimax-h3.workflow.js');
  assert.equal(workflow.PROFILES[0].label, 'MiniMaxH3(本地)');
  assert.equal(workflow.PROFILES[0].id, 'beta5_int8');
  const brand = readFileSync(new URL('novaflow-brand-runtime.js', renderer), 'utf8');
  assert.match(brand, /option\.textContent = "MiniMaxH3\(本地\)"/);
  const bundle = readFileSync(new URL('assets/index-BbIa-2NM.js', renderer), 'utf8');
  assert.match(bundle, /label:`MiniMaxH3\(本地\)`/);
  assert.match(bundle, /value:`beta5_int8`,children:`MiniMaxH3\(本地\)`/);
});

test('retired selector names are not the image or video option labels', () => {
  const files = [
    'art-generate-mode.tool.js',
    'art-generate-model.resource.js',
    'ui-design-mode.tool.js',
    'ui-design-generate.tool.js',
    'ui-design-generate.workflow.js',
    'ai-sequence-minimax-h3.resource.js',
    'ai-sequence-minimax-h3.workflow.js',
    'novaflow-brand-runtime.js',
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, renderer), 'utf8');
    assert.equal(source.includes('本地H3'), false, file);
    assert.equal(source.includes('GPT（云）'), false, file);
  }
});
