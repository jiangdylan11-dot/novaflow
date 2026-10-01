const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../../node_modules/typescript');

const bundle = fs.readFileSync('novaflow-web/renderer/assets/index-BbIa-2NM.js', 'utf8');
const runtime = fs.readFileSync('novaflow-web/renderer/novaflow-brand-runtime.js', 'utf8');
const names = ['isNovaflowCutoutProgressSurface', 'isFullscreenModalBackdrop',
  'getNovaflowProtectedModalDialogCard', 'clearInvalidNovaflowProtectedModalBackdrop',
  'clearInvalidNovaflowExportModalRoot'];
const functions = new Map();
let effect;
function inspect(source, kind) {
  const ast = ts.createSourceFile(kind, source, 99, true);
  function walk(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) functions.set(node.name.text, node.getText(ast));
    if (ts.isCallExpression(node) && node.arguments.length === 2) {
      const callback = node.arguments[0].getText(ast);
      if (callback.includes('e.style.display=`flex`') && callback.includes('novaflow-ai-rembg-overlay-root') && callback.length < 7000) effect = callback;
      // Reopening now reapplies the complete style object instead of setting display alone.
      if (callback.includes('Object.assign(e.style,{position:`fixed`') && callback.includes('novaflow-ai-rembg-overlay-root') && callback.length < 7000) effect = callback;
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
}
inspect(bundle, 'bundle');
inspect(runtime, 'runtime');
assert.ok(effect);

class Element {
  constructor() { this.attributes = {}; this.children = []; this.style = { removeProperty(key) { delete this[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; } }; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  appendChild(child) { this.append(child); }
  closest() { return this.id === 'novaflow-ai-rembg-overlay-root' || this.id === 'novaflow-cutout-preview-render-overlay' ? this : this.parentElement?.closest() || null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const attr = selector.match(/\[([^=\]]+)(?:=[^\]]+)?\]/)?.[1];
    return this.children.flatMap(child => [...(attr && child.getAttribute(attr) !== null ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }; }
}

function setup() {
  const body = new Element(), timers = new Map();
  let timer = 0;
  const document = { body, createElement: () => new Element(), getElementById: id => body.children.find(node => node.id === id) || null };
  const window = { innerWidth: 800, innerHeight: 600, getComputedStyle: node => node.style,
    setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id) };
  const context = vm.createContext({ document, window, HTMLElement: Element, R: 'ai', q: { state: 'idle' }, Ti: 0,
    removeAttributeIfPresent: (node, key) => node.removeAttribute(key), isDropdownControllerNode: () => false,
    isSourceOwnedLayout: () => false, isInsideSourceOwnedLayout: () => false,
    NOVAFLOW_MODAL_CARD_MEMO: new WeakMap(), NOVAFLOW_MODAL_CARD_MEMO_FRAME: 0 });
  vm.runInContext([...functions.values()].join('\n') + '\nconst updateOverlay=' + effect, context);
  function update(state) { context.q = state; context.Ti = state.progress01; vm.runInContext('updateOverlay()', context); }
  function flush() { for (const fn of timers.values()) fn(); timers.clear(); }
  return { context, document, update, flush };
}

test('second job restores an opaque topmost overlay after the first job hid it', () => {
  const env = setup();
  env.update({ state: 'running', message: 'first', progress01: .2 });
  const root = env.document.getElementById('novaflow-ai-rembg-overlay-root');
  env.update({ state: 'done' }); env.flush();
  assert.equal(root.style.display, 'none');
  // Reproduce the old runtime cleanup damage seen on the real second job.
  root.style.removeProperty('background'); root.style.removeProperty('z-index');
  env.update({ state: 'running', message: 'second', progress01: 0 });
  assert.equal(env.document.getElementById(root.id), root);
  assert.equal(root.style.display, 'flex');
  assert.equal(root.style.background, 'rgba(0,0,0,0.68)');
  assert.equal(root.style.zIndex, '2147483647');
});

test('generic dialog detection excludes cutout progress and its inner card', () => {
  const env = setup(); env.update({ state: 'running', progress01: 0 });
  env.context.root = env.document.getElementById('novaflow-ai-rembg-overlay-root');
  assert.equal(vm.runInContext('isFullscreenModalBackdrop(root)', env.context), false);
  assert.equal(vm.runInContext('getNovaflowProtectedModalDialogCard(root)', env.context), null);
  assert.equal(vm.runInContext('getNovaflowProtectedModalDialogCard(root.children[0])', env.context), null);
});

test('cleanup of old modal marks preserves cutout styles, and normal dialogs still clean up', () => {
  const env = setup(); env.update({ state: 'running', progress01: 0 });
  const root = env.document.getElementById('novaflow-ai-rembg-overlay-root'); env.context.root = root;
  for (const fn of ['clearInvalidNovaflowProtectedModalBackdrop', 'clearInvalidNovaflowExportModalRoot']) {
    root.setAttribute('data-novaflow-modal-backdrop', '1');
    vm.runInContext(fn + '(root)', env.context);
    assert.equal(root.getAttribute('data-novaflow-modal-backdrop'), null);
    assert.equal(root.style.background, 'rgba(0,0,0,0.68)');
    assert.equal(root.style.zIndex, '2147483647');
    env.context.normal = new Element(); Object.assign(env.context.normal.style, { background: 'black', zIndex: '99' });
    vm.runInContext(fn + '(normal)', env.context);
    assert.equal(env.context.normal.style.background, undefined);
    assert.equal(env.context.normal.style.zIndex, undefined);
  }
});
