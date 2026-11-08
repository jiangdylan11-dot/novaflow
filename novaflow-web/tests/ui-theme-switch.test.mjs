import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../renderer/ui-design-theme-switch.js');
const api = globalThis.FoartUiThemeSwitch;

test('prompt locks layout and text, names the theme and its description', () => {
  const prompt = api.buildPrompt({ theme: { name: '埃及神话', description: '黄金与青金石' } });
  assert.match(prompt, /"埃及神话": 黄金与青金石/);
  assert.match(prompt, /Layout lock/);
  assert.match(prompt, /reproduce every readable word and number exactly/);
  assert.doesNotMatch(prompt, /Image 2/);
});

test('later screens of a theme follow the first finished one; user note and text choice reach the prompt', () => {
  const prompt = api.buildPrompt({ theme: { name: '糖果乐园' }, anchored: true, keepText: false, note: '人物换成女性' });
  assert.match(prompt, /Image 2 is a finished screen from this same "糖果乐园" set/);
  assert.match(prompt, /titles and decorative words may be rewritten/);
  assert.match(prompt, /人物换成女性/);
});

test('a theme without a name is refused', () => {
  assert.throws(() => api.buildPrompt({ theme: { name: ' ' } }), /请选择主题/);
});

test('output keeps the screen aspect ratio: 2K long edge online, 1536 local, multiples of 16', () => {
  assert.deepEqual(api.outputSize('gpt', 1512, 3276), { width: 944, height: 2048 });
  const local = api.outputSize('local', 1920, 1080);
  assert.equal(local.width, 1536);
  assert.equal(local.height % 16, 0);
});

test('default library is a starting set of named themes with descriptions', () => {
  assert.ok(api.DEFAULT_THEMES.length >= 10);
  for (const theme of api.DEFAULT_THEMES) assert.ok(theme.name && theme.description);
});

test('local engine gets Chinese wording that counts every person and symbol out', () => {
  const prompt = api.buildPrompt({ theme: { name: '东方仙侠' }, provider: 'local', anchored: true });
  assert.match(prompt, /^把图1这张游戏界面整体换成「东方仙侠」主题/);
  assert.match(prompt, /一个人物都不能保留原来的衣服/);
  assert.match(prompt, /一个符号都不能保留原来的造型/);
  assert.match(prompt, /图2是同一套「东方仙侠」主题已完成的界面/);
});
