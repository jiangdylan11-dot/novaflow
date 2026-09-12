const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../particle-editor/art-quality-profile.workflow.js'), 'utf8'), context);
const api = context.window.NovaFlowArtQualityProfile;
const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/art-quality-legacy-character-prompt.json'), 'utf8'));

test('ordinary character edits do not acquire colored lines or added rim lighting', () => {
  const raw = '保留角色服装、姿势和风格，仅修改背景。';
  const result = api.compileFinal({ prompt: raw, mode: 'img2img', nsfw: false });
  assert.ok(result.prompt.startsWith(raw + '\n\n'));
  assert.doesNotMatch(result.directorInstruction, /彩色辅助线|受控轮廓光/);
  assert.match(result.directorInstruction, /遵循用户指定或参考图已有的光照/);
});

test('text generation uses the same neutral edge default', () => {
  const result = api.compileFinal({ prompt: '设计一名穿长裙的成年角色。', mode: 'txt2img' });
  assert.doesNotMatch(result.directorInstruction, /彩色辅助线|受控轮廓光/);
});

test('explicit user lighting and colored outlines remain intact', () => {
  const raw = '角色海报，明确要求青色轮廓光、彩色辅助线和霓虹描边。';
  const result = api.compileFinal({ prompt: raw, assetType: 'character' });
  assert.ok(result.prompt.startsWith(raw + '\n\n'));
  assert.doesNotMatch(result.negativePrompt, /彩色辅助线|轮廓光|霓虹描边/);
});

test('an exact old generated suffix is replaced without duplicating quality instructions', () => {
  assert.match(legacy.prompt, /只允许局部细弱彩色辅助线/);
  const result = api.compileFinal({ prompt: legacy.prompt, negativePrompt: legacy.negativePrompt, mode: 'img2img' });
  assert.ok(result.prompt.startsWith(legacy.raw + '\n\n'));
  assert.equal(result.prompt.split('高完成度角色CG质量：').length - 1, 1);
  assert.doesNotMatch(result.prompt, /只允许局部细弱彩色辅助线|受控轮廓光/);
  assert.equal(result.negativePrompt, legacy.negativePrompt);
});

test('partial matches authored by users are never removed', () => {
  const raw = '风格说明：只允许局部细弱彩色辅助线。请保留我的这项设计要求。';
  const result = api.compileFinal({ prompt: raw, assetType: 'character' });
  assert.ok(result.prompt.startsWith(raw + '\n\n'));
});

test('compiling again is idempotent after migrating an old suffix', () => {
  const first = api.compileFinal({ prompt: legacy.prompt, negativePrompt: legacy.negativePrompt });
  const second = api.compileFinal({ prompt: first.prompt, negativePrompt: first.negativePrompt });
  assert.equal(second.prompt, first.prompt);
  assert.equal(second.negativePrompt, first.negativePrompt);
  assert.equal(second.applied, false);
});

test('edge complaints are not affirmative requests for inked character style', () => {
  for (const prompt of ['不要粗黑描边', '避免黑色外轮廓', '粗黑描边太重', '减轻粗黑描边']) {
    const result = api.compileFinal({ prompt, assetType: 'character' });
    assert.equal(result.explicitFlatStyle, false, prompt);
    assert.match(result.directorInstruction, /线条纤细轻淡/);
    assert.doesNotMatch(result.directorInstruction, /建立清晰轮廓|动作线/);
  }
});

test('affirmative style and preservation requests still win over the default', () => {
  for (const prompt of ['使用粗黑描边', '不要改动粗黑描边', '不要裁切人物，保持赛璐璐画风', '不要粗黑描边，使用像素画']) {
    const result = api.compileFinal({ prompt });
    assert.equal(result.explicitFlatStyle, true, prompt);
    assert.doesNotMatch(result.directorInstruction, /线条纤细轻淡/);
  }
  assert.equal(api.build({prompt:'角色', style:'cel_comic'}).explicitFlatStyle, true);
});

test('the 2.3.213 canonical suffix also migrates exactly once', () => {
  const raw = '成年角色，穿着泳装，白色背景。';
  const latest = api.compileFinal({prompt: raw});
  const previous = latest.prompt
    .replace('保持稳定重心和原有动作', '建立清晰轮廓、稳定重心和有表现力的动作线')
    .replace('轮廓由局部固有色与明暗过渡自然衔接，边缘轻柔细腻，线条纤细轻淡', '轮廓主要由明暗、色彩和材质边缘建立，边缘干净自然');
  assert.notEqual(previous, latest.prompt);
  assert.equal(api.compileFinal({prompt: previous}).prompt, latest.prompt);
});

test('the assistant uses the shared negation-aware style decision', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../particle-editor/novaflow-smart-ai.js'), 'utf8');
  const body = source.match(/function artExplicitOutlineRequested\(\) \{([\s\S]*?)\n  \}/)[1];
  const decide = new Function('window', 'state', body);
  assert.equal(decide(context.window, {requirements:'不要粗黑描边', artStyle:'auto'}), false);
  assert.equal(decide(context.window, {requirements:'使用粗黑描边', artStyle:'auto'}), true);
});

test('only pure local edge requests bypass whole-prompt structured rewriting', () => {
  const prompt = '成年女性角色换穿蓝色比基尼，保留原图姿势和白色背景。';
  for (const request of ['不要过黑过重的描边', '描边不要太黑太重', '减轻黑色描边', '轮廓线细一点']) {
    assert.equal(api.canApplySoftEdgeEdit(prompt, request), true);
  }
  for (const request of ['不要减轻描边', '保留粗黑描边', '不要过黑过重的描边并换成红色衣服']) {
    assert.equal(api.canApplySoftEdgeEdit(prompt, request), false);
  }
  assert.equal(api.canApplySoftEdgeEdit(prompt+'使用粗黑描边。', '不要过黑过重的描边'), false);
  assert.equal(api.canApplySoftEdgeEdit('[风格设定]\n媒介=数字绘画', '不要过黑过重的描边'), false);
  const source = fs.readFileSync(path.resolve(__dirname, '../../particle-editor/novaflow-smart-ai.js'), 'utf8');
  const start = source.indexOf('const usesLocalSoftEdgeEdit =');
  const end = source.indexOf('const usesSimpleStructuredArtPromptContract', start);
  const route = new Function('window', 'currentPrompt', 'state', 'useGrok', 'isArtTextRequest', 'isOptimizeRequest', 'artTextPurpose', 'isMiniMaxH3Request', 'shouldUseStructuredArtPromptContract', source.slice(start,end) + 'return usesStructuredArtPromptContract;');
  const call = (requirements, cloud=false) => route(context.window, prompt, {requirements}, cloud, true, true, 'optimize', false, Boolean);
  assert.equal(call('不要过黑过重的描边'), false);
  assert.equal(call('不要过黑过重的描边', true), true);
  assert.equal(call('换成红色泳装'), true);
});
