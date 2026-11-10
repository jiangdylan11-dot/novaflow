import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createXiaotaoMemoryRoutes, createMemoryXiaotaoMemoryStore } from '../../packages/shared/src/xiaotao-memory.mjs';

// Values made inside the vm are compared by content, not by realm.
const plain = value => JSON.parse(JSON.stringify(value));
class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const users = { a: { id: 'user-a' }, b: { id: 'user-b' } };
const requireUser = async headers => { const user = users[headers.authorization]; if (!user) throw new HttpError(401, 'unauthorized', 'missing'); return user; };

test('memory routes keep each account to its own preferences', async () => {
  const routes = createXiaotaoMemoryRoutes({ store: createMemoryXiaotaoMemoryStore(), requireUser, HttpError });
  const call = (who, method, path, body) => routes.handle({ method, path, headers: { authorization: who }, body });
  assert.equal(await call('a', 'GET', '/api/web/other'), null);
  await assert.rejects(call('x', 'GET', '/api/web/xiaotao/memory'), e => e.status === 401);
  const saved = await call('a', 'POST', '/api/web/xiaotao/memory', { category: 'art', slot: 'art.style', text: '喜欢厚涂', source: 'explicit' });
  assert.equal(saved.item.text, '喜欢厚涂');
  // Same kind replaces, never piles up.
  await call('a', 'POST', '/api/web/xiaotao/memory', { category: 'art', slot: 'art.style', text: '喜欢二次元', source: 'adopted' });
  let list = await call('a', 'GET', '/api/web/xiaotao/memory');
  assert.deepEqual(list.items.map(i => i.text), ['喜欢二次元']);
  assert.equal((await call('b', 'GET', '/api/web/xiaotao/memory')).items.length, 0);
  // Links, tokens, unknown kinds and extra fields are refused.
  for (const body of [{ category: 'art', slot: 'art.style', text: '看 https://x.example', source: 'explicit' },
    { category: 'secret', slot: 'x', text: '好', source: 'explicit' },
    { category: 'art', slot: 'Bad Slot', text: '好', source: 'explicit' },
    { category: 'art', slot: 'art.style', text: '好', source: 'explicit', extra: 1 },
    { category: 'art', slot: 'art.style', text: 'x'.repeat(121), source: 'explicit' }])
    await assert.rejects(call('a', 'POST', '/api/web/xiaotao/memory', body), e => e.status === 400);
  // At most 20 per account; the oldest goes.
  for (let i = 0; i < 25; i++) await call('a', 'POST', '/api/web/xiaotao/memory', { category: 'chat', slot: 'note.' + i, text: '第' + i + '条', source: 'explicit' });
  list = await call('a', 'GET', '/api/web/xiaotao/memory');
  assert.equal(list.items.length, 20);
  assert.equal(list.items[0].text, '第24条');
  // Switched off: nothing new is kept.
  await call('a', 'POST', '/api/web/xiaotao/memory/settings', { enabled: false });
  assert.equal((await call('a', 'GET', '/api/web/xiaotao/memory')).enabled, false);
  await assert.rejects(call('a', 'POST', '/api/web/xiaotao/memory', { category: 'art', slot: 'art.color', text: '暖色', source: 'explicit' }), e => e.status === 409);
  // Delete one, then everything.
  const one = list.items[3].id;
  assert.equal((await call('a', 'POST', '/api/web/xiaotao/memory/delete', { id: one })).deleted, 1);
  await assert.rejects(call('a', 'POST', '/api/web/xiaotao/memory/delete', { id: 'nope' }), e => e.status === 400);
  assert.equal((await call('a', 'POST', '/api/web/xiaotao/memory/delete', { all: true })).deleted, 19);
});

async function loadClient(server) {
  const sandbox = { console, electronAPI: { xiaotaoMemory: async (op, body) => server(op, body) } };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(await readFile(new URL('../../renderer/xiaotao-memory.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.NovaFlowXiaotaoMemory;
}

test('小桃 understands what to remember and what not to', async () => {
  const memory = await loadClient(async () => ({ ok: true, enabled: true, items: [] }));
  const explicit = text => { const r = memory.explicitMemory(text); return r && { text: r.text, category: r.category, slot: r.slot, only: r.only }; };
  assert.deepEqual(explicit('记住我喜欢厚涂二次元'), { text: '喜欢厚涂二次元', category: 'art', slot: 'art.style', only: true });
  assert.deepEqual(explicit('记住：叫我小江'), { text: '叫我小江', category: 'chat', slot: 'chat.name', only: true });
  assert.equal(explicit('以后画图都用 GPT Image 2.5').category, 'model');
  assert.equal(explicit('以后画图都用 GPT Image 2.5').slot, 'model.image');
  assert.equal(explicit('以后视频都用 8 秒').slot, 'video.duration');
  assert.deepEqual(explicit('以后都不要加背景音乐'), { text: '以后都不要加背景音乐', category: 'avoid', slot: 'audio.music', only: false });
  assert.equal(explicit('以后都加背景音乐').slot, 'audio.music');
  assert.equal(explicit('以后导出都用 webm 格式').category, 'export');
  assert.equal(explicit('以后 UI 按钮都放右边').category, 'ui');
  assert.equal(explicit('帮我画一只猫，以后都用暖色调').slot, 'art.color');
  // One-off asks and complaints are not memories.
  for (const text of ['画一只猫', '不满意', '这次用 Grok 画', '记住', '记住 https://x.example/a'])
    assert.equal(memory.explicitMemory(text), null, text);
});

test('an adopted turn keeps at most two things it actually used', async () => {
  const memory = await loadClient(async () => ({ ok: true, enabled: true, items: [] }));
  const receipt = '已生成\n实际工具回执：' + JSON.stringify([{ action: 'image_generate', modelLabel: 'GPT Image 2.5' }]);
  const learned = memory.fromAdoption([{ role: 'user', content: '画一个二次元厚涂少女，不要写实' }, { role: 'assistant', content: receipt }]);
  assert.deepEqual(plain(learned.map(i => [i.slot, i.text, i.source])), [['model.image', '画图常用 GPT Image 2.5', 'adopted'], ['art.style', '喜欢的画风：二次元、厚涂', 'adopted']]);
  const video = memory.fromAdoption([{ role: 'user', content: '做个视频' }, { role: 'assistant', content: '好\n实际工具回执：' + JSON.stringify([{ action: 'video_generate', surface: 'video', seconds: 6 }]) }]);
  assert.deepEqual(plain(video.map(i => i.text)), ['视频时长常用 6 秒']);
  assert.deepEqual(plain(memory.fromAdoption([{ role: 'user', content: '你好' }])), []);
});

test('the memory rides at the front of the history and never stacks', async () => {
  const items = [{ id: '1', category: 'art', slot: 'art.style', text: '喜欢厚涂' }, { id: '2', category: 'avoid', slot: 'audio.music', text: '不要背景音乐' }];
  const memory = await loadClient(async op => op === 'list' ? { ok: true, enabled: true, items } : { ok: true });
  assert.deepEqual(plain(memory.withMemory([{ role: 'user', content: 'hi' }])), [{ role: 'user', content: 'hi' }]);
  await memory.load();
  const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }));
  const sent = memory.withMemory(history);
  assert.equal(sent.length, 12);
  assert.match(sent[0].content, /^我的偏好记忆（/);
  assert.match(sent[0].content, /画风画法：喜欢厚涂/);
  assert.match(sent[0].content, /不要：不要背景音乐/);
  assert.deepEqual(memory.withMemory(sent).length, 12);
  assert.deepEqual(plain(memory.stripMemory(sent)), history.slice(-10));
  assert.match(memory.withMemoryText('old'), /^我的偏好记忆（[\s\S]*\nold$/);
  // Switched off or unavailable: nothing is added.
  const off = await loadClient(async op => op === 'list' ? { ok: true, enabled: false, items } : { ok: true });
  await off.load();
  assert.deepEqual(plain(off.withMemory(history)), history);
  const down = await loadClient(async () => ({ ok: false, status: 500, error: 'x' }));
  await down.load();
  assert.equal(down.ready(), false);
  assert.equal(down.snapshot().error, '记忆暂不可用');
});

test('a newer preference replaces the opposite one', async () => {
  const deleted = [];
  let items = [{ id: 'old', category: 'avoid', slot: 'audio.music', text: '不要背景音乐' }];
  const memory = await loadClient(async (op, body) => {
    if (op === 'list') return { ok: true, enabled: true, items };
    if (op === 'save') return { ok: true, item: { id: 'new', ...body } };
    if (op === 'delete') { deleted.push(body.id); return { ok: true, deleted: 1 }; }
    return { ok: true };
  });
  await memory.load();
  const saved = await memory.save([{ category: 'audio', slot: 'audio.music', text: '以后都加背景音乐', source: 'explicit' }]);
  assert.equal(saved.length, 1);
  assert.deepEqual(deleted, ['old']);
  assert.deepEqual(plain(memory.snapshot().items.map(i => i.id)), ['new']);
});
