import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../renderer/ui-design-theme-switch.js');
const api = globalThis.FoartUiThemeSwitch;

test('prompt locks layout and text, names the theme and its description', () => {
  const prompt = api.buildPrompt({ theme: { name: '埃及神话', description: '黄金与青金石' }, keepLayout: true });
  assert.match(prompt, /"埃及神话": 黄金与青金石/);
  assert.match(prompt, /Layout lock/);
  assert.match(prompt, /reproduce every readable word and number exactly/);
  assert.doesNotMatch(prompt, /Image 2/);
});

test('later screens of a theme follow the first finished one; user note and text choice reach the prompt', () => {
  const prompt = api.buildPrompt({ theme: { name: '糖果乐园' }, keepLayout: true, anchored: true, keepText: false, note: '人物换成女性' });
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
  const prompt = api.buildPrompt({ theme: { name: '东方仙侠' }, keepLayout: true, provider: 'local', anchored: true });
  assert.match(prompt, /^把图1这张游戏界面整体换成「东方仙侠」主题/);
  assert.match(prompt, /一个人物都不能保留原来的衣服/);
  assert.match(prompt, /一个符号都不能保留原来的造型/);
  assert.match(prompt, /图2是同一套「东方仙侠」主题已完成的界面/);
});

test('default is a redesign from the screen function list, never from the picture', () => {
  const inventory = '符号盘：5列4行\n底部按钮：“菜单”、旋转按钮（图标，无文字）';
  const local = api.buildPrompt({ theme: { name: '埃及神话' }, provider: 'local', inventory });
  assert.match(local, /^为「埃及神话」主题从零设计一张全新的游戏界面/);
  assert.match(local, /符号盘：5列4行/);
  assert.match(local, /区域名、说明和括号里的注释不要写进画面/);
  assert.doesNotMatch(local, /图1/);
  const anchored = api.buildPrompt({ theme: { name: '埃及神话' }, provider: 'local', inventory, anchored: true });
  assert.match(anchored, /图1是同一套「埃及神话」主题已完成的另一张界面/);
  const online = api.buildPrompt({ theme: { name: '埃及神话' }, inventory });
  assert.match(online, /Design a completely new game UI screen from zero/);
  assert.doesNotMatch(online, /Layout lock/);
  assert.throws(() => api.buildPrompt({ theme: { name: '埃及神话' } }), /缺少界面功能清单/);
});

test('server reads a screen into a Chinese function list (ui-inventory)', async () => {
  const { inspectXiaotaoV3StyleReply, STYLE_OUTPUT_TOKENS } = await import('../packages/shared/src/xiaotao-style-framework-v3.mjs');
  assert.equal(STYLE_OUTPUT_TOKENS['ui-inventory'], 700);
  const { inventory } = inspectXiaotaoV3StyleReply({ kind: 'ui-inventory', reply: '界面类型：竖屏老虎机\n\n符号盘：横向每行5个、纵向共4行' });
  assert.equal(inventory, '界面类型：竖屏老虎机\n符号盘：横向每行5个、纵向共4行');
  assert.throws(() => inspectXiaotaoV3StyleReply({ kind: 'ui-inventory', reply: 'slot machine, 5x4' }));
});

test('layout sketch plan reads bands, grid and button rows from the function list', () => {
  const plan = api.sketchPlan('符号盘（约占屏幕高度40%）：横向每行5个、纵向共4行\n角色区（约占35%）：3个角色\n底部按钮栏（约占12%）：从左到右为“菜单”、“极速”、旋转按钮（图标，无文字，最大，居中）、“自动”、“声音”');
  assert.deepEqual(plan.map(b => [b.kind, b.cols, b.rows]), [['grid', 5, 4], ['cast', 0, 1], ['row', 5, 1]]);
  assert.equal(api.sketchPlan('界面类型：竖屏'), null);
  const sketched = api.buildPrompt({ theme: { name: '糖果乐园' }, provider: 'local', inventory: '符号盘：5', sketched: true, anchored: true });
  assert.match(sketched, /图1是灰色布局草图/);
  assert.match(sketched, /图2是同一套「糖果乐园」主题已完成的另一张界面/);
});

test('layout blocks for 布局编辑 stay inside the canvas and name every cell and button', () => {
  const plan = api.sketchPlan('符号盘（约占屏幕高度40%）：横向每行5个、纵向共4行\n角色区（约占35%）：3个角色\n底部按钮栏（约占12%）：从左到右为“菜单”、“极速”、旋转按钮（图标，无文字）、“自动”、“声音”');
  const blocks = api.sketchBlocks(plan, 704, 1536);
  assert.equal(blocks.length, 26);
  for (const b of blocks) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 704 && b.y + b.height <= 1536 && b.name && Number.isInteger(b.width));
  assert.match(blocks.at(-1).purpose, /声音$/);
});

test('read boxes place layout blocks where the regions are on the source', () => {
  const plan = api.sketchPlan('符号盘［2,1,96,40］：横向每行5个、纵向共4行\n角色区［0,42,100,34］：3个角色\n底部按钮栏［1,88,98,11］：从左到右为“菜单”、“极速”、旋转按钮（图标，无文字）、“自动”、“声音”');
  const blocks = api.sketchBlocks(plan, 1000, 2000);
  const cast = blocks.find(b => b.name === '角色区');
  assert.deepEqual([cast.x, cast.y, cast.width, cast.height], [0, 840, 1000, 680]);
  assert.equal(blocks.filter(b => b.name.startsWith('符号格')).length, 20);
});

test('多种排版: each arrangement names its composition; a screen without a grid gets no grid wording', () => {
  assert.equal(api.ARRANGEMENTS.length, 3);
  const lobby = '玩家信息［1,1,22,12］：昵称“星海旅人”\n左侧活动入口［1,17,8,58］：从上到下“签到”“首充”\n角色区［35,12,30,88］：1个主角全身立绘';
  const prompt = api.buildPrompt({ theme: { name: '赛博朋克' }, provider: 'local', inventory: lobby, arrangement: api.ARRANGEMENTS[0] });
  assert.match(prompt, /排版方式：主角色大幅立于画面一侧/);
  assert.match(prompt, /不要出现清单之外的格子/);
  assert.doesNotMatch(prompt, /符号/);
  const plan = api.sketchPlan(lobby);
  assert.deepEqual(plan.map(b => [b.kind, b.rows]), [['bar', 1], ['column', 2], ['cast', 1]]);
});
