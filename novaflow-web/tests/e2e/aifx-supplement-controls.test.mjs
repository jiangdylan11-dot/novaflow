// AI 特效 提示词补充 wins where it conflicts with the defaults: its spread and colour asks replace the
// arrangement and the colour the panel would use anyway, everything else is said as an addition.
// 2026-10-15: "以补充为准" - a control sentence merely appended beside an opposite default changed
// nothing; replacing the default did.
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

test('the request is split phrase by phrase into additions and whole-effect controls', () => {
  const split = (text) => JSON.parse(JSON.stringify(api.splitSupplement(text)));
  assert.deepEqual(split('多条不规则波浪线条拖尾，增加少量金币，扩散不要太大，密集一点'),
    { additions: '多条不规则波浪线条拖尾，增加少量金币', spread: 'tight', colour: null });
  for (const wide of ['散开一点', '铺满整个画面', '再散一点']) assert.equal(split(wide).spread, 'wide', wide);
  assert.deepEqual(split('飘落樱花花瓣，范围大一点'), { additions: '飘落樱花花瓣', spread: 'wide', colour: null });
  // An amount that belongs to an added thing stays with it.
  assert.deepEqual(split('增加少量金币'), { additions: '增加少量金币', spread: '', colour: null });
  // Where it should gather is said as well as how tightly.
  assert.equal(split('冒出紫色火焰，集中在左下角').additions, '冒出紫色火焰，集中在左下角');
  assert.deepEqual(split('整体变成蓝色').colour, { words: 'blue', adjective: 'blue', tint: '#3d7bff' });
  assert.equal(split('颜色改成粉紫渐变').colour.words, 'pink and purple gradient');
  assert.equal(split('整体偏红').colour.words, 'red');
  assert.equal(split('叶子换成金色').colour.words, 'gold');
  // A coloured thing to add is not a recolour.
  assert.equal(split('冒出紫色火焰').colour, null);
  assert.equal(split('碎片变金币').additions, '碎片变金币');
});

test('a reference read keeps its elements and gets the arrangement by rule, overruled by the request', () => {
  const read = { elements: 'made of glowing sunflowers with bright yellow petals and a deep red center.', colours: 'yellow, red' };
  const plain = api.referenceMaterial(read, { shape: 'crescent slash' });
  assert.match(plain, /^made of glowing sunflowers with bright yellow petals/);
  assert.match(plain, /Main colours: yellow, red\./);
  assert.match(plain, /packed densely close along it/);
  const wide = api.referenceMaterial(read, { shape: 'crescent slash', spread: 'wide' });
  assert.match(wide, /scattered widely around it/);
  assert.doesNotMatch(wide, /packed densely close/, 'the default gives way instead of arguing');
  const blue = api.referenceMaterial(read, { shape: 'crescent slash', colour: api.splitSupplement('整体变成蓝色').colour });
  assert.doesNotMatch(blue, /yellow petals|red center/);
  assert.match(blue, /blue petals and a blue center/);
  assert.match(blue, /All of it in blue, NOT yellow, red\./);
  // A node that predates the split sends its finished sentence; it goes in as it came.
  assert.equal(api.referenceMaterial({ material: 'made of old words.' }, { spread: 'wide' }), 'made of old words.');
});

test('a 风格库 preset takes the same overrides', () => {
  const blue = api.splitSupplement('整体变成蓝色').colour;
  const fire = api.presetWithOverrides(api.getPreset('fire'), { shape: 'slash arc', spread: 'wide', colour: blue });
  assert.match(fire.material, /^made of blazing blue flame with a white-hot inner edge/);
  assert.match(fire.material, /thrown widely around the slash arc/);
  assert.equal(fire.accent, '#3d7bff');
  assert.equal(api.presetWithOverrides(api.getPreset('fire'), {}), api.getPreset('fire'), 'no request, no copy');
});

test('controls the panel took out never reach the prompt in Chinese; an older panel keeps its words', () => {
  const handled = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'gold', supplement: '散开一点', supplementEnglish: '',
    supplementControls: { spread: 'wide', colour: '' }, strength: 20, lifecycle: 'loop' });
  assert.ok(!handled[5].inputs.prompt.includes('散开'));
  const older = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'gold', supplement: '散开一点', strength: 20, lifecycle: 'loop' });
  assert.ok(older[5].inputs.prompt.includes('散开一点'));
});
