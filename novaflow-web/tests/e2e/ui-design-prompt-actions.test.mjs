// The UI 生成器's 设计要求 has the same two buttons as 绘图's prompt bar (2026-09-28): 「AI 助手」 and
// 「编辑」, marked for the brand sheet's icons (sparkles / pencil) and the prompt-action look; 编辑 opens
// the same full-prompt editor 绘图 uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.parentElement = null;
    const important = {};
    this.important = important;
    this.style.setProperty = (name, value, priority) => { if (priority === 'important') important[name] = value; };
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener.call(this, { preventDefault() {}, stopPropagation() {}, ...event, target: this }); }
  focus() { this.focused = true; }
}
const walk = (node) => [node, ...node.children.flatMap(walk)];
const byAttr = (root, name, value) => walk(root).find((node) => node.getAttribute?.(name) === value) || null;

function mountTool(provider = 'local', canvas = { width: 1280, height: 720 }) {
  const opened = [];
  const context = { module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout, __NovaFlowSmartAI: { openPromptEditor: (control, title, options) => { opened.push({ control, title, options }); return true; } } };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(new URL('../../renderer/ui-design-generate.tool.js', import.meta.url), 'utf8'), context);
  const tool = context.module.exports;
  const documentRef = { createElement: (tag) => Object.assign(new FakeElement(tag), { ownerDocument: documentRef }) };
  const host = documentRef.createElement('div');
  const assistantOpenings = [];
  tool.mount({
    host, variant: 'node', state: { provider, prompt: '暗色游戏商城' },
    getCanvasSize: () => canvas,
    onChange() {},
    onOpenDesignAssistant(payload) { assistantOpenings.push(payload); },
  });
  return { host, opened, assistantOpenings };
}

test('设计要求 shows 「AI 助手」 and 「编辑」 with the prompt-bar look and icons', () => {
  const { host } = mountTool();
  const assistant = byAttr(host, 'data-novaflow-ui-design-design-assistant', '1');
  const edit = byAttr(host, 'data-novaflow-ui-design-prompt-edit', '1');
  assert.equal(assistant.textContent, 'AI 助手');
  assert.equal(edit.textContent, '编辑');
  for (const [button, kind] of [[assistant, 'assistant'], [edit, 'edit']]) {
    assert.equal(button.getAttribute('data-novaflow-prompt-action-button'), '1');
    assert.equal(button.getAttribute('data-novaflow-prompt-action-kind'), kind);
    assert.equal(button.style.height, '24px');
    assert.equal(button.style.fontSize, '11px');
    assert.equal(button.style.fontWeight, '500');
  }
  assert.equal(assistant.parentElement, edit.parentElement, 'the two buttons sit together');
  assert.equal(walk(host).some((node) => node.textContent === '设计助手'), false);
});

test('「编辑」 opens the shared full-prompt editor on 设计要求; 「AI 助手」 still opens the assistant', () => {
  const { host, opened, assistantOpenings } = mountTool();
  const prompt = byAttr(host, 'data-novaflow-ui-design-prompt-field', 'prompt');
  byAttr(host, 'data-novaflow-ui-design-prompt-edit', '1').dispatchEvent({ type: 'click' });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].control, prompt);
  assert.equal(opened[0].title, '设计要求');
  assert.equal(typeof opened[0].options.resolveTarget, 'function');
  byAttr(host, 'data-novaflow-ui-design-design-assistant', '1').dispatchEvent({ type: 'click' });
  assert.equal(assistantOpenings.length, 1);
  assert.equal(assistantOpenings[0].promptTextarea, prompt);
});

test('the overlay exposes the editor, and the dialog is titled 「AI 助手」', () => {
  const overlay = readFileSync(new URL('../../renderer/novaflow-smart-ai.js', import.meta.url), 'utf8');
  assert.match(overlay, /openPromptEditor\(control, title, options\) \{\s*return openSmartAiPromptEditor\(control, title \|\| "提示词", options \|\| \{\}\);/);
  // 确认编辑 writes into the field that replaced a rebuilt one.
  assert.match(overlay, /const target = control\.isConnected \? control : \(typeof options\.resolveTarget === "function" && options\.resolveTarget\(\)\) \|\| control;/);
  const dialog = readFileSync(new URL('../../renderer/ui-design-assistant.dialog.js', import.meta.url), 'utf8');
  assert.match(dialog, /text: 'AI 助手', 'data-nf-dialog': 'title'/);
  assert.doesNotMatch(dialog, /'设计助手'/);
});

test('pressing a button keeps 设计要求 focused, so its save cannot rebuild the node under the click', () => {
  const { host } = mountTool();
  for (const attr of ['data-novaflow-ui-design-design-assistant', 'data-novaflow-ui-design-prompt-edit']) {
    let prevented = false;
    byAttr(host, attr, '1').dispatchEvent({ type: 'mousedown', preventDefault() { prevented = true; } });
    assert.equal(prevented, true, attr);
  }
});

// GPT, Google and 本地 (2026-09-29): 输出尺寸, then W / H edge to edge when custom, then each generation
// setting as a row at 输出尺寸's level — no 生成参数 heading or box.
test('every provider lays the settings out as rows at the level of 输出尺寸', () => {
  const expected = { gpt: ['gptQualityImg2img'], google: ['googleResolution'], local: ['randomSeed'] };
  for (const provider of ['gpt', 'google', 'local']) {
    const { host } = mountTool(provider, { width: 1536, height: 1024 });
    assert.equal(byAttr(host, 'data-novaflow-ui-design-output-size-label', '1').textContent, '输出尺寸');
    assert.equal(byAttr(host, 'data-novaflow-ui-design-output-contract', provider), null);
    assert.equal(byAttr(host, 'data-novaflow-ui-design-node-params-header', '1'), null, 'no 生成参数 heading');
    assert.equal(byAttr(host, 'data-novaflow-ui-design-node-params-body', '1'), null, 'no settings box');
    const rows = walk(host).filter((node) => node.getAttribute?.('data-novaflow-ui-design-param-row')).map((node) => node.getAttribute('data-novaflow-ui-design-param-row'));
    assert.deepEqual(rows.filter((key) => key !== 'localEditStrength'), expected[provider], provider);
    const sizeRow = byAttr(host, 'data-novaflow-ui-design-output-size-row', '1');
    for (const key of rows) assert.equal(byAttr(host, 'data-novaflow-ui-design-param-row', key).parentElement, sizeRow.parentElement, key + ' sits beside 输出尺寸');
  }
  const seedRow = byAttr(mountTool('local').host, 'data-novaflow-ui-design-param-row', 'randomSeed');
  assert.equal(seedRow.children[0].textContent, '随机种子');
});

test('custom W and H take the full width, edge to edge', () => {
  const { host } = mountTool('gpt', { width: 1536, height: 1008 });
  const custom = byAttr(host, 'data-novaflow-ui-design-custom-size', '1');
  assert.equal(custom.style.gridTemplateColumns, 'minmax(0, 1fr) minmax(0, 1fr)');
  assert.equal(custom.children.length, 2);
  for (const axis of ['width', 'height']) {
    const input = byAttr(host, 'data-novaflow-ui-design-dimension-input', axis);
    assert.deepEqual(input.important, { width: '100%', 'max-width': 'none' });
  }
});

test('a press on the generator controls leaves the focus in 设计要求 (the canvas does not take it)', () => {
  const workspace = readFileSync(new URL('../../renderer/ui-design.workspace.js', import.meta.url), 'utf8');
  const handler = /card\.addEventListener\('pointerdown', function \(event\) \{[\s\S]*?\n      \}\)/.exec(workspace)?.[0] || '';
  const guard = handler.indexOf("closest('[data-novaflow-ui-design-generator-controls]')");
  assert.ok(guard > 0, 'the card handler checks for the generator controls');
  assert.ok(guard < handler.indexOf('focusViewport()'), 'before it focuses the canvas');
});

test("GPT's own presets stay selected, and W / H opt out of the page's 49px number width", () => {
  const { host } = mountTool('gpt', { width: 1536, height: 1024 });
  assert.equal(byAttr(host, 'data-novaflow-ui-design-custom-size', '1'), null, '1536 × 1024 is a GPT preset, not Custom');
  const custom = mountTool('gpt', { width: 1536, height: 1008 }).host;
  for (const axis of ['width', 'height']) assert.equal(byAttr(custom, 'data-novaflow-ui-design-dimension-input', axis).getAttribute('data-novaflow-number-fill'), '1');
  const runtime = readFileSync(new URL('../../renderer/novaflow-brand-runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /function setNovaflowNumericFieldWidth\(field\) \{\s*if \(!\(field instanceof HTMLElement\)\) return;\s*\/\/[^\n]*\n\s*if \(field\.getAttribute\("data-novaflow-number-fill"\) === "1"\) return;/);
});
