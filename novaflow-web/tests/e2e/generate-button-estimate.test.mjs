// The generate button shows a short estimate and changes with resolution, quality, count, and mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const renderer = new URL('../../renderer/', import.meta.url);

function loadClient() {
  const context = { console, module: { exports: {} }, exports: {} };
  context.globalThis = context;
  context.window = context;
  for (const name of [
    'art-generate-model.resource.js',
    'feature-credit-prices.js',
    'art-generate-credit-pricing.tool.js',
  ]) {
    vm.runInNewContext(readFileSync(new URL(name, renderer), 'utf8'), context, { filename: name });
  }
  return context.NovaFlowArtGenerateCreditPricing;
}

const pricing = loadClient();

function labelFor(state) {
  return pricing.getButtonLabel(pricing.createSnapshot(state));
}

test('the displayed credit estimate follows resolution, quality, count, and mode', () => {
  assert.equal(labelFor({ provider: 'gpt', mode: 'txt2img', count: 1, gptSize: '1024x1024', gptQualityTxt2img: 'low' }), '生成 · 约3分');
  assert.equal(labelFor({ provider: 'gpt', mode: 'txt2img', count: 1, gptSize: '1024x1024', gptQualityTxt2img: 'medium' }), '生成 · 约6分');
  assert.equal(labelFor({ provider: 'gpt', mode: 'txt2img', count: 3, gptSize: '1024x1024', gptQualityTxt2img: 'medium' }), '生成 · 约18分');
  assert.equal(labelFor({ provider: 'gpt', mode: 'txt2img', count: 1, gptSize: '2048x2048', gptQualityTxt2img: 'high' }), '生成 · 约40分');
  assert.equal(labelFor({ provider: 'gpt', mode: 'img2img', count: 1, gptSize: '2048x2048', gptQualityImg2img: 'high' }), '生成 · 20分');
  assert.equal(labelFor({ provider: 'local', mode: 'txt2img', count: 1 }), '生成');

  const token = pricing.createSnapshot({ provider: 'gpt', mode: 'txt2img', count: 1, gptSize: '1024x1024', gptQualityTxt2img: 'low' });
  const fixed = pricing.createSnapshot({ provider: 'gpt', mode: 'img2img', count: 1, gptSize: '2048x2048', gptQualityImg2img: 'high' });
  assert.match(pricing.getButtonTitle(token), /预估上限 3 积分/);
  assert.match(pricing.getButtonTitle(token), /若回退官方通道/);
  assert.match(pricing.getButtonTitle(fixed), /本次将扣 20 积分/);
  for (const state of [token, fixed]) {
    const label = pricing.getButtonLabel(state);
    assert.doesNotMatch(label, /开始生成|预估上限|回退|积分/);
  }
});
