// GENERATED COPY - source: packages/shared/src/xiaotao-memory.mjs
// 小桃记忆: each account's own short preference list. Only preference text is
// kept (never chat logs or pictures); a newer preference of the same kind
// replaces the old one and an account keeps at most 20.
export const XIAOTAO_MEMORY_CATEGORIES = Object.freeze(['model','art','video','audio','ui','export','chat','avoid']);
export const XIAOTAO_MEMORY_LIMIT = 20;
const SLOT = /^[a-z0-9_.:-]{1,64}$/;
const UNSAFE = /data:|https?:\/\/|www\.|Bearer\s|nfw_|sk-[A-Za-z0-9]|@[A-Za-z0-9-]+\.[A-Za-z]/i;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cleanXiaotaoMemoryText(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text && text.length <= 120 && !UNSAFE.test(text) ? text : '';
}

export function createXiaotaoMemoryRoutes({ store, requireUser, HttpError }) {
  const fail = (status, code, message) => { throw new HttpError(status, code, message); };
  const plain = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
  const ready = () => { if (typeof store.listXiaotaoMemory !== 'function') fail(503, 'xiaotao-memory-unavailable', '记忆功能暂不可用'); };
  return {
    async handle({ method, path, headers, body }) {
      if (path !== '/api/web/xiaotao/memory' && !path.startsWith('/api/web/xiaotao/memory/')) return null;
      ready();
      const user = await requireUser(headers);
      if (method === 'GET' && path === '/api/web/xiaotao/memory') {
        return { ok: true, enabled: await store.getXiaotaoMemoryEnabled(user.id), limit: XIAOTAO_MEMORY_LIMIT, items: await store.listXiaotaoMemory(user.id) };
      }
      if (method !== 'POST') fail(404, 'xiaotao-memory-route', '未知的记忆操作');
      if (path === '/api/web/xiaotao/memory') {
        if (!plain(body, ['category', 'slot', 'text', 'source'])) fail(400, 'xiaotao-memory-invalid', '记忆格式无效');
        const text = cleanXiaotaoMemoryText(body.text);
        if (!XIAOTAO_MEMORY_CATEGORIES.includes(body.category) || typeof body.slot !== 'string' || !SLOT.test(body.slot)
          || !['explicit', 'adopted'].includes(body.source) || !text) fail(400, 'xiaotao-memory-invalid', '这条记忆不能保存');
        if (!await store.getXiaotaoMemoryEnabled(user.id)) fail(409, 'xiaotao-memory-off', '记忆已关闭');
        return { ok: true, item: await store.saveXiaotaoMemory(user.id, { category: body.category, slot: body.slot, text, source: body.source }) };
      }
      if (path === '/api/web/xiaotao/memory/delete') {
        if (!plain(body, ['id', 'all']) || (body.all !== true && !(typeof body.id === 'string' && ID.test(body.id)))) fail(400, 'xiaotao-memory-invalid', '删除请求无效');
        return { ok: true, deleted: await store.deleteXiaotaoMemory(user.id, body.all === true ? null : body.id) };
      }
      if (path === '/api/web/xiaotao/memory/settings') {
        if (!plain(body, ['enabled']) || typeof body.enabled !== 'boolean') fail(400, 'xiaotao-memory-invalid', '设置无效');
        await store.setXiaotaoMemoryEnabled(user.id, body.enabled);
        return { ok: true, enabled: body.enabled };
      }
      fail(404, 'xiaotao-memory-route', '未知的记忆操作');
    }
  };
}

// Memory-only store for the local control plane and tests.
export function createMemoryXiaotaoMemoryStore() {
  const rows = new Map(), off = new Set();
  const list = userId => [...rows.values()].filter(r => r.userId === userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.seq - a.seq);
  let seq = 0;
  const view = ({ id, category, slot, text, source, updatedAt }) => ({ id, category, slot, text, source, updatedAt });
  return {
    async listXiaotaoMemory(userId) { return list(userId).map(view); },
    async getXiaotaoMemoryEnabled(userId) { return !off.has(userId); },
    async setXiaotaoMemoryEnabled(userId, enabled) { if (enabled) off.delete(userId); else off.add(userId); },
    async saveXiaotaoMemory(userId, item) {
      const old = list(userId).find(r => r.category === item.category && r.slot === item.slot);
      const row = { ...(old || { id: crypto.randomUUID(), userId }), ...item, updatedAt: new Date().toISOString(), seq: ++seq };
      rows.set(row.id, row);
      for (const extra of list(userId).slice(XIAOTAO_MEMORY_LIMIT)) rows.delete(extra.id);
      return view(row);
    },
    async deleteXiaotaoMemory(userId, id) {
      let n = 0;
      for (const row of list(userId)) if (id === null || row.id === id) { rows.delete(row.id); n++; }
      return n;
    }
  };
}
