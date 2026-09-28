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

// GPT and Google (2026-09-28): the same rows — 输出尺寸, W/H under it when custom, 生成参数 with one setting.
test('GPT and Google lay the node out the same way', () => {
  const rows = {};
  for (const provider of ['gpt', 'google']) {
    const { host } = mountTool(provider, { width: 1536, height: 1024 });
    const params = byAttr(host, 'data-novaflow-ui-design-node-params-body', '1');
    rows[provider] = {
      label: byAttr(host, 'data-novaflow-ui-design-output-size-label', '1').textContent,
      notice: byAttr(host, 'data-novaflow-ui-design-output-contract', provider),
      settings: walk(params).filter((node) => node.tagName === 'SELECT').length,
      outputs: walk(params).filter((node) => node.tagName === 'OUTPUT').length,
    };
  }
  assert.deepEqual(rows.gpt, { label: '输出尺寸', notice: null, settings: 1, outputs: 0 });
  assert.deepEqual(rows.google, rows.gpt);
});

test('custom W and H fill the columns under the size select', () => {
  const { host } = mountTool('gpt', { width: 1536, height: 1008 });
  const custom = byAttr(host, 'data-novaflow-ui-design-custom-size', '1');
  assert.equal(custom.style.gridTemplateColumns, '54px minmax(0, 1fr) minmax(0, 1fr)');
  for (const axis of ['width', 'height']) {
    const input = byAttr(host, 'data-novaflow-ui-design-dimension-input', axis);
    assert.deepEqual(input.important, { width: '100%', 'max-width': 'none' });
  }
});
