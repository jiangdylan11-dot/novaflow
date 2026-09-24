// The topbar 算力源 picker: what the chip says, which rows the dialog offers,
// and that a 普通账户 is pointed at the administrator instead of a node.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';

const source = await readFile(new URL('../../renderer/novaflow-web-compute-node.js', import.meta.url), 'utf8');
let checks = 0;
// Values built inside the VM carry that context's prototypes; compare by shape.
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const check = (actual, expected) => { assert.deepEqual(plain(actual), expected); checks++; };

// A host like the one the brand runtime builds: a label span inside a status box.
function fakeHost() {
  const attrs = new Map();
  const label = { textContent: 'AI 已连接', style: { setProperty(k, v) { this[k] = v; } } };
  const host = {
    children: [],
    getAttribute: (k) => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, String(v)),
    querySelector: (sel) => (sel.includes('ai-runtime-state') ? label : null),
    insertBefore(node) { this.children.unshift(node); return node; }
  };
  return { host, label, attrs };
}

const picked = [];
let currentNode = null;
const sandbox = createDomSandbox({
  setInterval: () => 0, clearInterval() {},
  NovaFlowWebRuntime: {
    get computeNode() { return currentNode; },
    setComputeNode(node) { currentNode = node; picked.push(node); return node; },
    listComputeNodes: async () => ({ ok: true, nodes: [], compute: { shared: true } }),
    localAssistant: false
  },
  electronAPI: {}
});
const { host, label } = fakeHost();
const mounted = new Map();
sandbox.document.getElementById = (id) => id === 'novaflow-topbar-ai-runtime-status' ? host
  : host.children.find((c) => c.id === id) || mounted.get(id) || null;
const nativeCreate = sandbox.document.createElement;
sandbox.document.createElement = (tag) => {
  const node = nativeCreate(tag);
  let text = '';
  Object.defineProperty(node, 'textContent', { get: () => text, set: (v) => { text = String(v); }, configurable: true });
  const attrs = new Map();
  node.setAttribute = (k, v) => attrs.set(k, String(v));
  node.getAttribute = (k) => attrs.get(k) ?? null;
  return node;
};
sandbox.document.head.appendChild = (node) => { mounted.set(node.id, node); return node; };
runInContext(source, createContext(sandbox));
const picker = sandbox.NovaFlowWebComputeNode;

// ---- the chip
check(picker.mount(), true);
const chip = host.children[0];
check(label.style.display, 'none'); // the brand label yields its spot
check(chip.textContent, 'AI 已连接'); // nothing pinned: the brand wording
host.setAttribute('data-novaflow-topbar-ai-runtime-phase', 'connected');
currentNode = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'studio-5090' };
picker.render();
check(chip.textContent, '已链接 AI-studio-5090');
check(chip.getAttribute('data-phase'), 'connected');
host.setAttribute('data-novaflow-topbar-ai-runtime-phase', 'disconnected');
picker.render();
check(chip.textContent, 'AI-studio-5090 未连接');
check(picker.chipText(null, 'disconnected', ''), 'AI 未连接');
check(picker.chipText({ name: 'x' }, 'starting', ''), 'AI-x 启动中');

// ---- the rows
const reply = {
  ok: true,
  compute: { shared: true, premium: true },
  nodes: [
    { id: '11111111-1111-1111-1111-111111111111', name: 'studio-5090', gpu_name: 'RTX 5090', vram_mb: 32768, tier: 'premium', status: 'idle', online: true },
    { id: '22222222-2222-2222-2222-222222222222', name: 'laptop-3060', gpu_name: 'RTX 3060', vram_mb: 12288, tier: 'standard', status: 'busy', online: true },
    { id: '33333333-3333-3333-3333-333333333333', name: 'old-box', gpu_name: '', vram_mb: 0, status: 'offline', online: false }
  ]
};
const hosted = picker.buildRows(reply, { id: '22222222-2222-2222-2222-222222222222', name: 'laptop-3060' }, false);
check(hosted.allowed, true);
check(hosted.premium, true);
check(hosted.rows.map((r) => [r.name, r.status, r.locked, r.selected]), [
  ['自动分配', 'auto', false, false],
  ['studio-5090', 'idle', false, false],
  ['laptop-3060', 'busy', false, true],
  ['old-box', 'offline', false, false]
]);
check(hosted.rows[1].hint, 'RTX 5090 · 32 GB 显存');
check(hosted.rows[3].hint, '算力节点');
check(hosted.rows[0].hint, '任意空闲的算力节点');
// A node without a tier is 普通; the pool comes back grouped, 普通 first.
check(hosted.rows.map((r) => r.tier ?? null), [null, 'premium', 'standard', 'standard']);
check(hosted.groups.map((g) => [g.tier, g.title, g.rows.map((r) => r.name)]), [
  ['standard', '普通算力节点', ['laptop-3060', 'old-box']],
  ['premium', '高级算力节点', ['studio-5090']]
]);
check(picker.TIER_TEXT, { standard: '普通节点', premium: '高级节点' });

const local = picker.buildRows(reply, null, true);
check(local.rows[0], { id: null, name: '本机', hint: '启动NovaFlow 的这台电脑', status: 'local', locked: false, selected: true });

// A 中级账户: 普通 nodes open, 高级 nodes locked, auto-assign only reaches 普通 nodes.
const mid = picker.buildRows({ ...reply, compute: { shared: true, premium: false } }, null, false);
check(mid.allowed, true);
check(mid.premium, false);
check(mid.rows.map((r) => [r.name, r.locked]), [['自动分配', false], ['studio-5090', true], ['laptop-3060', false], ['old-box', false]]);
check(mid.rows[0].hint, '任意空闲的普通算力节点');
check(/高级账户/.test(picker.PREMIUM_LOCKED), true);

// A 普通账户: every pool row is locked, the local machine is not, and the note names the administrator.
const basic = picker.buildRows({ ...reply, compute: { shared: false } }, null, true);
check(basic.allowed, false);
check(basic.rows.map((r) => r.locked), [false, true, true, true]);
const basicHosted = picker.buildRows({ ...reply, compute: { shared: false } }, null, false);
check(basicHosted.rows.map((r) => r.locked), [true, true, true, true]);
check(/联系管理员/.test(picker.CONTACT_ADMIN), true);
check(picker.buildRows(null, null, false).rows.length, 1); // an unreadable pool still offers the default
check(picker.buildRows(null, null, false).groups, []);

console.log(checks + ' passed, 0 failed: topbar 算力源 chip and picker rows');
