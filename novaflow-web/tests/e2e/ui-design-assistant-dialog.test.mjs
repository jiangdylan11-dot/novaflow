// The UI 设计助手 dialog follows the AI 助手 (2026-09-28): it needs the user's own words (设计要求 or
// 补充要求) and shows the same notice box while both are empty, and a running request has a
// 任务中止 button that ends the wait at once and never writes a late answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const NOTICE = '请先在设计要求或补充要求里写想要的效果';

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.checked = false;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  removeEventListener() {}
  remove() {}
  fire(type) { for (const listener of this.listeners[type] || []) listener({ type, target: this, preventDefault() {} }); }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const hit = child instanceof FakeElement ? child.find(predicate) : null;
      if (hit) return hit;
    }
    return null;
  }
}

function fakeDocument() {
  const body = new FakeElement('body');
  return { body, documentElement: body, createElement: (tag) => new FakeElement(tag), addEventListener() {}, removeEventListener() {} };
}

// The shipped file is a browser script: it registers itself on the global object it runs in.
const sandbox = { setTimeout, clearTimeout, Promise };
vm.runInNewContext(readFileSync(new URL('../../renderer/ui-design-assistant.dialog.js', import.meta.url), 'utf8'), sandbox);
const dialogApi = sandbox.NovaFlowUiDesignAssistantDialog;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function openDialog({ prompt = '', run } = {}) {
  const documentRef = fakeDocument();
  const applied = [];
  let cancelled = 0;
  const workflow = {
    analysisReferenceLimit: () => 3,
    createSession: () => ({ cancel() { cancelled += 1; }, run: run || (async () => ({ prompt: '写入的设计要求', engine: 'grok', provider: 'grok' })) }),
  };
  const handle = dialogApi.open({ documentRef, workflow, getPrompt: () => prompt, references: [], structure: {}, apply: (payload) => applied.push(payload) });
  const host = documentRef.body.children[0];
  const find = (predicate) => host.find(predicate);
  return {
    handle, applied, cancelled: () => cancelled,
    notice: find((node) => node.getAttribute('data-novaflow-ui-design-assistant-notice') === '1'),
    stop: find((node) => node.getAttribute('data-novaflow-ui-design-assistant-stop') === '1'),
    submit: find((node) => node.tagName === 'BUTTON' && node.textContent === '生成并写入设计要求'),
    requirements: find((node) => node.tagName === 'TEXTAREA'),
    status: find((node) => node.getAttribute('aria-live') === 'polite'),
  };
}

test('with no 设计要求 and no 补充要求 the notice shows and the request is refused', async () => {
  const d = openDialog();
  await tick();
  assert.equal(d.notice.textContent, NOTICE);
  assert.equal(d.notice.style.display, 'block');
  assert.equal(d.submit.disabled, true);
  assert.equal(await d.handle.submit(), false);
  assert.equal(d.applied.length, 0);
  d.requirements.value = '按钮改成圆角，主色用绿色';
  d.requirements.fire('input');
  assert.equal(d.notice.style.display, 'none');
  assert.equal(d.submit.disabled, false);
  assert.equal(await d.handle.submit(), true);
  assert.equal(d.applied[0].prompt, '写入的设计要求');
});

test('the page 设计要求 alone is enough', async () => {
  const d = openDialog({ prompt: '做一个手游登录页' });
  await tick();
  assert.equal(d.notice.style.display, 'none');
  assert.equal(d.submit.disabled, false);
  d.handle.close();
});

test('任务中止 shows while running, ends the wait at once and never writes a late answer', async () => {
  let finish;
  const d = openDialog({ prompt: '做一个手游登录页', run: () => new Promise((resolve) => { finish = resolve; }) });
  await tick();
  assert.equal(d.stop.style.display, 'none');
  const pending = d.handle.submit();
  await tick();
  assert.equal(d.stop.textContent, '任务中止');
  assert.equal(d.stop.style.display, 'block');
  assert.equal(d.submit.disabled, true);
  d.stop.fire('click');
  assert.equal(await pending, false);
  assert.equal(d.cancelled() >= 1, true);
  assert.equal(d.status.textContent, '任务已中止');
  assert.equal(d.stop.style.display, 'none');
  assert.equal(d.submit.disabled, false);
  finish({ prompt: '迟到的结果', engine: 'grok', provider: 'grok' });
  await tick();
  assert.equal(d.applied.length, 0);
  assert.equal(d.handle.snapshot().pending, false);
  d.handle.close();
});
