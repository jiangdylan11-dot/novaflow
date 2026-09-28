// The AI 助手 dialog does one thing per surface (2026-09-28): there is no 「你希望 AI 做什么」
// choice. Where the surface has pictures (H3 图生 / 首尾帧 / 多参, 美工 生图 with references,
// the plain animation dialog with frames) the assistant reads them together with the user's
// words, and it needs words: the prompt box or 补充要求. Runs the real overlay and workflows in a
// VM with a small fake DOM; one exported line gives the test the dialog's state and entry points.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL('../../renderer/' + file, import.meta.url), 'utf8');
const TEXT_REQUIRED = '请先在提示词或补充要求里写想要的效果';
const ROOT_ID = 'novaflow-smart-ai-dialog-root';

class FakeNode {
  constructor(attributes = {}) {
    this.attributes = { ...attributes };
    this.children = {};
    this.listeners = {};
    this.isConnected = true;
    this.textContent = '';
    this.style = { setProperty() {} };
    this.classList = { contains: () => false };
  }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  removeEventListener() {}
  dispatch(type) { for (const listener of this.listeners[type] || []) listener({ type, target: this, preventDefault() {}, stopPropagation() {} }); }
  dispatchEvent(event) { this.dispatch(event.type); return true; }
  querySelector(selector) { const value = this.children[selector]; return Array.isArray(value) ? value[0] ?? null : value ?? null; }
  querySelectorAll(selector) { const value = this.children[selector]; return Array.isArray(value) ? value : value ? [value] : []; }
  closest(selector) { return this.ancestors?.[selector] ?? null; }
  contains() { return false; }
  focus() {}
  getBoundingClientRect() { return { width: 120, height: 24 }; }
}
class HTMLElement extends FakeNode {}
class HTMLTextAreaElement extends HTMLElement { constructor(value = '') { super(); this.value = value; } }
class HTMLInputElement extends HTMLElement {}
class HTMLButtonElement extends HTMLElement { constructor() { super(); this.disabled = false; } }
class HTMLImageElement extends HTMLElement { constructor(src) { super(); this.src = src; this.currentSrc = src; } }
class HTMLMediaElement extends HTMLElement {}
class HTMLSelectElement extends HTMLElement {}

// Decodes like a browser image: 1536 x 1024, and a 'broken' source fails to decode.
class FakeImage {
  constructor() { this.naturalWidth = 1536; this.naturalHeight = 1024; this.width = 1536; this.height = 1024; }
  set src(value) { this._src = value; setTimeout(() => this.onload?.(), 0); }
  get src() { return this._src; }
  async decode() { if (String(this._src).includes('broken')) throw new Error('参考图解码失败'); }
}

function page({ respond } = {}) {
  const byId = new Map([['novaflow-smart-ai-style', {}]]);
  const calls = { grok: [], local: [], grokReverse: [], localReverse: [] };
  const answer = respond || (() => ({ ok: false, error: 'engine stopped by the test' }));
  // The dialog root keeps the rendered HTML and hands out fresh controls per render.
  class DialogRoot extends HTMLElement {
    set innerHTML(html) {
      this.html = html;
      const submit = new HTMLButtonElement();
      submit.disabled = /class="novaflow-smart-ai-submit" disabled/.test(html);
      submit.textContent = /class="novaflow-smart-ai-submit"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
      const message = new HTMLElement({ 'data-visible': /novaflow-smart-ai-message" data-visible="(\d)"/.exec(html)?.[1] ?? '0' });
      message.textContent = /class="novaflow-smart-ai-message"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
      this.children = {
        '.novaflow-smart-ai-dialog': new HTMLElement(),
        '.novaflow-smart-ai-body': new HTMLElement(),
        '.novaflow-smart-ai-close': new HTMLButtonElement(),
        '.novaflow-smart-ai-textarea': new HTMLTextAreaElement(),
        '.novaflow-smart-ai-submit': submit,
        '.novaflow-smart-ai-message': message,
      };
    }
    get innerHTML() { return this.html; }
    remove() { this.isConnected = false; byId.delete(this.id); }
  }
  const canvas = () => ({
    width: 0, height: 0,
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toDataURL() { return `data:image/jpeg;base64,${this.width}x${this.height}`; },
  });
  const storage = new Map([['novaflow.client.auth.session.v1', JSON.stringify({ session: { token: 'session-token' } })]]);
  const context = vm.createContext({
    console, setTimeout, clearTimeout, Event, JSON, Promise,
    URL: class extends URL { static createObjectURL() { return 'blob:fake'; } static revokeObjectURL() {} },
    fetch: async () => ({ ok: true, status: 200, blob: async () => ({ size: 100, type: 'image/png' }) }),
    Image: FakeImage,
    Element: FakeNode, HTMLElement, HTMLTextAreaElement, HTMLInputElement, HTMLButtonElement, HTMLImageElement, HTMLMediaElement, HTMLSelectElement,
    MutationObserver: class { observe() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    document: {
      readyState: 'complete', addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
      getElementById: (id) => byId.get(id) ?? null,
      createElement: (tag) => tag === 'canvas' ? canvas() : new DialogRoot(),
      documentElement: new HTMLElement(), head: { appendChild() {} },
      body: { appendChild(node) { if (node.id) byId.set(node.id, node); }, getAttribute: () => '' },
    },
    electronAPI: {
      async smartAiPromptOptimize(payload) { calls.grok.push(payload); return answer(payload, 'grok'); },
      async promptAssistantOptimizePrompt(payload) { calls.local.push(payload); return answer(payload, 'local'); },
      async smartAiImageReverse(payload) { calls.grokReverse.push(payload); return answer(payload, 'grok-reverse'); },
      async promptAssistantReverseImagePrompt(payload) { calls.localReverse.push(payload); return answer(payload, 'local-reverse'); },
    },
  });
  context.window = context;
  context.globalThis = context;
  for (const file of ['h3-prompt-format.js', 'ai-sequence-minimax-h3-prompt.workflow.js', 'ai-sequence-minimax-h3-reverse.workflow.js', 'smart-ai-art-auto-intent.workflow.js', 'resource-mention.tool.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  const overlay = read('novaflow-smart-ai.js');
  const exposed = overlay.replace(/\n  migrateMiniMaxH3PromptHistory\(\);/, '\n  window.__smartAiDialogTest = { state, openDialog, runSmartAi, captureMiniMaxH3PromptContext };\n  migrateMiniMaxH3PromptHistory();');
  assert.notEqual(exposed, overlay, 'the overlay still ends with its history migration');
  vm.runInContext(exposed, context, { filename: 'novaflow-smart-ai.js' });
  const api = context.__smartAiDialogTest;
  const dialog = () => byId.get(ROOT_ID);
  const settle = async () => {
    for (let index = 0; index < 50; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!api.state.imagesLoading) return;
    }
  };
  const type = (text) => {
    const textarea = dialog().querySelector('.novaflow-smart-ai-textarea');
    textarea.value = text;
    textarea.dispatch('input');
  };
  return { context, api, calls, dialog, settle, type, byId };
}

// A MiniMax H3 bottom workspace in one generation mode with the given upload slots.
function h3Surface(p, mode, prompt, slots = {}) {
  const workspace = new HTMLElement({ 'data-novaflow-ai-model-method': 'minimax_h3_local', 'data-novaflow-ai-generation-mode': mode, 'data-novaflow-ai-bottom-workspace': '1' });
  workspace.children['[data-novaflow-h3-duration="1"], [data-novaflow-h3-duration]'] = { value: '5' };
  for (const [domKind, src] of Object.entries(slots)) {
    const slot = new HTMLElement({ 'data-novaflow-resource-id': `${domKind}-upload`, 'data-novaflow-resource-occupied': '1' });
    slot.children.img = new HTMLImageElement(src);
    workspace.children[`[data-ais-import="${domKind}"]`] = slot;
  }
  const positive = new HTMLTextAreaElement(prompt);
  const promptTarget = { positive, workspace };
  const miniMaxH3 = p.api.captureMiniMaxH3PromptContext(null, promptTarget);
  assert.equal(miniMaxH3?.mode, mode);
  return { surface: 'animation', button: null, promptTarget, miniMaxH3, positive };
}

// 美工 › 生图 with the given reference pictures (图生图 when there are any).
function artSurface(prompt, references = []) {
  const workspace = new HTMLElement({ 'data-novaflow-art-generate-nsfw': '0' });
  const positive = new HTMLTextAreaElement(prompt);
  const negative = new HTMLTextAreaElement('');
  const frame = (textarea) => Object.assign(new HTMLElement(), { children: { textarea } });
  workspace.children['[data-novaflow-art-generate-prompt-kind="positive"]'] = frame(positive);
  workspace.children['[data-novaflow-art-generate-prompt-kind="negative"]'] = frame(negative);
  workspace.children['[data-novaflow-art-generate-render-mode]'] = new HTMLElement({ 'data-novaflow-art-generate-render-mode': references.length ? 'img2img' : 'txt2img' });
  workspace.children['[data-novaflow-art-generate-reference-column="1"] [data-ais-import]'] = references.map((src, index) => {
    const slot = new HTMLElement({ 'data-ais-import': `art_reference_${index + 1}` });
    slot.children.img = { src, currentSrc: src };
    return slot;
  });
  const button = new HTMLButtonElement();
  button.ancestors = { '#novaflow-art-generate-workspace': workspace };
  return { surface: 'art', button, artGenerateMode: references.length ? 'img2img' : 'txt2img', nsfw: false, promptTarget: null, positive, negative, workspace };
}

// The plain animation dialog (a model other than H3) with optional frames.
function plainAnimationSurface(prompt, frames = []) {
  const workspace = new HTMLElement({ 'data-novaflow-ai-bottom-workspace': '1' });
  workspace.children['[data-ais-import]'] = frames.map((src, index) => {
    const slot = new HTMLElement({ 'data-ais-import': index ? 'last_frame' : 'first_frame' });
    slot.children.img = { src, currentSrc: src };
    return slot;
  });
  const button = new HTMLButtonElement();
  button.ancestors = { '[data-novaflow-ai-bottom-workspace="1"]': workspace };
  const positive = new HTMLTextAreaElement(prompt);
  return { surface: 'animation', button, promptTarget: { positive, workspace: null }, positive };
}

async function open(p, surface, engine = 'grok') {
  p.api.openDialog(surface);
  await p.settle();
  p.api.state.engine = engine;
  p.type(p.api.state.requirements);
  return p.dialog();
}

const FRAME = 'data:image/png;base64,ZnJhbWU=';
const H3_SURFACES = {
  text_video: {},
  image_video: { 首帧: FRAME },
  first_last: { 首帧: FRAME, 尾帧: 'data:image/png;base64,bGFzdA==' },
  multi_reference: { 参考图1: FRAME, 参考图2: 'data:image/png;base64,c2Vjb25k' },
};

test('no surface offers 「你希望 AI 做什么」 or names 反推', async () => {
  const surfaces = [
    ...Object.entries(H3_SURFACES).flatMap(([mode, slots]) => [
      (p) => h3Surface(p, mode, '', slots), (p) => h3Surface(p, mode, '她转身挥手', slots),
    ]),
    () => artSurface(''), () => artSurface('冰系女剑客'),
    () => artSurface('', ['https://refs.test/a.png']), () => artSurface('冰系女剑客', ['https://refs.test/a.png']),
    () => artSurface('', ['https://refs.test/a.png', 'https://refs.test/b.png']),
    () => plainAnimationSurface(''), () => plainAnimationSurface('人物转身', ['https://refs.test/first.png']),
  ];
  for (const make of surfaces) {
    const p = page();
    const root = await open(p, make(p));
    assert.doesNotMatch(root.html, /你希望 AI 做什么|data-smart-ai-mode|novaflow-smart-ai-mode-card|反推|可留空/);
    assert.match(root.html, /处理方式/, 'the engine choice stays');
    assert.match(root.html, /novaflow-smart-ai-textarea/, '补充要求 stays');
  }
});

test('the dialog blocks until the prompt box or 补充要求 has words, and re-checks while typing', async () => {
  const cases = [
    (p) => h3Surface(p, 'image_video', '', H3_SURFACES.image_video),
    (p) => h3Surface(p, 'first_last', '', H3_SURFACES.first_last),
    (p) => h3Surface(p, 'multi_reference', '', H3_SURFACES.multi_reference),
    (p) => h3Surface(p, 'text_video', ''),
    () => artSurface('', ['https://refs.test/a.png']),
    () => artSurface('', ['https://refs.test/a.png', 'https://refs.test/b.png']),
    () => plainAnimationSurface('', ['https://refs.test/first.png']),
  ];
  for (const make of cases) {
    const p = page();
    const root = await open(p, make(p));
    let submit = root.querySelector('.novaflow-smart-ai-submit');
    let message = root.querySelector('.novaflow-smart-ai-message');
    assert.equal(submit.disabled, true);
    assert.equal(message.textContent, TEXT_REQUIRED);
    assert.equal(message.getAttribute('data-visible'), '1');
    p.type('人物缓慢转身，镜头轻推');
    assert.equal(submit.disabled, false, 'typing a 补充要求 enables the one action');
    assert.equal(message.textContent, '');
    assert.equal(message.getAttribute('data-visible'), '0');
    p.type('   ');
    assert.equal(submit.disabled, true, 'blank text blocks again');
    assert.equal(message.textContent, TEXT_REQUIRED);
    // A forced submit is refused before any engine is asked.
    await p.api.runSmartAi();
    assert.equal(p.api.state.message, TEXT_REQUIRED);
    assert.equal(p.calls.grok.length + p.calls.local.length + p.calls.grokReverse.length + p.calls.localReverse.length, 0);
    submit = p.dialog().querySelector('.novaflow-smart-ai-submit');
    message = p.dialog().querySelector('.novaflow-smart-ai-message');
    assert.equal(submit.disabled, true);
    assert.equal(message.textContent, TEXT_REQUIRED);
  }
  // A filled prompt box is enough: 补充要求 is optional then.
  const p = page();
  const root = await open(p, h3Surface(p, 'image_video', '她转身挥手', H3_SURFACES.image_video));
  assert.equal(root.querySelector('.novaflow-smart-ai-submit').disabled, false);
  assert.equal(root.querySelector('.novaflow-smart-ai-submit').textContent, '优化并写入提示词');
  assert.match(root.html, /补充要求（可选）/);
  assert.match(root.html, /将参考已上传的 首帧/);
});

test('H3 图生 / 首尾帧 / 多参: one optimize request with the frames at 768 px on both engines', async () => {
  for (const engine of ['grok', 'local']) {
    for (const [mode, labels] of [['image_video', ['<Picture 1>']], ['first_last', ['<Picture 1>', '<Picture 2>']], ['multi_reference', ['<Picture 1>', '<Picture 2>']]]) {
      const p = page();
      await open(p, h3Surface(p, mode, '她转身挥手', H3_SURFACES[mode]), engine);
      p.type('动作放慢一些');
      await p.api.runSmartAi();
      const sent = engine === 'grok' ? p.calls.grok : p.calls.local;
      assert.equal(sent.length, 1, `${mode}/${engine}: exactly one call`);
      assert.equal(p.calls.grokReverse.length + p.calls.localReverse.length, 0, 'the reverse bridges are not called from the dialog');
      assert.equal(sent[0].purpose, 'minimax-h3-prompt-enhance');
      assert.equal(sent[0].h3Mode, mode);
      assert.deepEqual(Array.from(sent[0].h3ReferenceFrames, (frame) => frame.label), labels);
      for (const frame of sent[0].h3ReferenceFrames) assert.equal(frame.dataUrl, 'data:image/jpeg;base64,768x512');
      assert.deepEqual({ ...sent[0].contentPolicy }, { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false });
      assert.match(sent[0].requirements, /Source prompt:\n[\s\S]*转身挥手[\s\S]*\n\n动作放慢一些$/);
      assert.equal(sent[0].h3Reverse, undefined);
    }
  }
  // 文生视频 has no pictures to send.
  const p = page();
  await open(p, h3Surface(p, 'text_video', '雨夜街头，她撑伞走过'));
  await p.api.runSmartAi();
  assert.equal(p.calls.grok.length, 1);
  assert.deepEqual(Array.from(p.calls.grok[0].h3ReferenceFrames), []);
});

test('H3: an unreadable frame stops the action instead of sending text alone', async () => {
  for (const mode of ['image_video', 'first_last']) {
    const p = page();
    const slots = mode === 'image_video' ? { 首帧: 'data:image/png;base64,broken' } : { 首帧: FRAME, 尾帧: 'data:image/png;base64,broken' };
    await open(p, h3Surface(p, mode, '她转身挥手', slots));
    await p.api.runSmartAi();
    assert.equal(p.calls.grok.length, 0, `${mode}: nothing is sent without the frames`);
    assert.match(p.api.state.message, /参考图解码失败/);
    assert.equal(p.api.state.loading, false);
  }
});

test('H3 base modes with only a 补充要求 use it as the source; 多参 keeps its upload brief', async () => {
  for (const mode of ['text_video', 'image_video', 'first_last']) {
    const p = page();
    const surface = h3Surface(p, mode, '', H3_SURFACES[mode]);
    const root = await open(p, surface);
    assert.equal(root.querySelector('.novaflow-smart-ai-submit').textContent, '生成并写入提示词');
    p.type('她慢慢转身，向镜头挥手');
    await p.api.runSmartAi();
    assert.equal(p.calls.grok.length, 1, `${mode}: the 补充要求 alone is enough`);
    assert.doesNotMatch(p.api.state.message, /source prompt cannot be empty/);
    assert.match(p.calls.grok[0].requirements, /Source prompt:\n[\s\S]*她慢慢转身，向镜头挥手$/);
    assert.match(p.calls.grok[0].prompt, /她慢慢转身，向镜头挥手/);
    assert.equal(surface.positive.value, '', 'the prompt box is written only on success');
  }
  const p = page();
  await open(p, h3Surface(p, 'multi_reference', '', H3_SURFACES.multi_reference));
  p.type('两人并肩走向镜头');
  await p.api.runSmartAi();
  assert.equal(p.calls.grok.length, 1);
  assert.equal(p.calls.grok[0].h3Reverse, true);
  assert.match(p.calls.grok[0].requirements, /两人并肩走向镜头\n素材反推：/);
  assert.equal(p.calls.grok[0].h3ReferenceFrames.length, 2);
});

test('H3 image modes run the explicit minor + sensitive pre-check before any request', async () => {
  for (const mode of ['image_video', 'first_last', 'multi_reference']) {
    const p = page();
    await open(p, h3Surface(p, mode, '未成年人', H3_SURFACES[mode]));
    p.type('裸露');
    await p.api.runSmartAi();
    assert.equal(p.calls.grok.length, 0, `${mode}: blocked in the UI`);
    assert.match(p.api.state.message, /检测到明确未成年人证据与敏感内容同时存在/);
  }
});

test('H3 图生: a valid answer is written to the prompt box and the dialog closes', async () => {
  const narrative = 'The woman shown in <Picture 1> turns toward the camera and slowly raises her hand to wave. The camera holds a static shot.';
  const p = page({ respond: () => ({ ok: true, prompt: `integrated_multimodal_description: [Shot 1] ${narrative}\noverall_soundscape: Street ambience and the rustle of her sleeve.\nnon_diegetic_music: N/A` }) });
  const surface = h3Surface(p, 'image_video', '她转身挥手', H3_SURFACES.image_video);
  await open(p, surface);
  await p.api.runSmartAi();
  assert.equal(p.calls.grok.length, 1);
  assert.equal(p.api.state.message, '');
  assert.equal(p.api.state.open, false);
  assert.match(surface.positive.value, /raises her hand to wave/);
});

test('美工 生图 routes from the references and sends the prompt box with 补充要求', async () => {
  // No references: the text-only 提示词优化 as before, without pictures.
  let p = page();
  await open(p, artSurface('冰系女剑客'));
  assert.equal(p.api.state.mode, 'optimize');
  await p.api.runSmartAi();
  assert.equal(p.calls.grok.length, 1);
  assert.equal(p.calls.grok[0].purpose, 'optimize');
  assert.equal(p.calls.grok[0].images, undefined);

  // One reference: one role-reference call reads the picture (the subject) with both texts,
  // on both engines, and its answer is written; no text-only second pass.
  const written = { ok: true, prompt: '冰系女剑客站在雪夜街头，蓝白配色。', negativePrompt: '低质量，模糊' };
  let root;
  for (const engine of ['grok', 'local']) {
    p = page({ respond: (payload, kind) => kind.endsWith('reverse') ? written : { ok: false, error: 'unexpected' } });
    const single = artSurface('冰系女剑客，蓝白配色', ['https://refs.test/a.png']);
    root = await open(p, single, engine);
    assert.equal(p.api.state.mode, 'reverse');
    assert.match(root.html, /已检测 1 张参考图；将结合参考图、提示词与补充要求/);
    assert.match(root.html, /补充要求（可选）/);
    assert.doesNotMatch(root.html, /参考图用途/);
    assert.equal(root.querySelector('.novaflow-smart-ai-submit').textContent, '优化并写入提示词');
    p.type('背景换成雪夜');
    await p.api.runSmartAi();
    const sent = engine === 'grok' ? p.calls.grokReverse : p.calls.localReverse;
    assert.equal(sent.length, 1, `${engine}: one call`);
    assert.equal(p.calls.grokReverse.length + p.calls.localReverse.length + p.calls.grok.length + p.calls.local.length, 1, `${engine}: nothing else`);
    assert.equal(sent[0].purpose, 'roleReference');
    assert.equal(sent[0].visualSchema, undefined);
    assert.deepEqual(Array.from(sent[0].images, (image) => image.role), ['subject']);
    assert.equal(sent[0].requirements, '用户生成要求：用户提示词：冰系女剑客，蓝白配色\n用户补充要求：背景换成雪夜');
    if (engine === 'grok') assert.equal(sent[0].scenario, 'role_reference');
    assert.equal(p.api.state.message, '');
    assert.equal(p.api.state.open, false);
    assert.equal(single.positive.value, written.prompt);
  }

  // Only the prompt box: it is sent as written.
  p = page();
  await open(p, artSurface('冰系女剑客', ['https://refs.test/a.png']), 'local');
  await p.api.runSmartAi();
  assert.equal(p.calls.localReverse.length, 1);
  assert.equal(p.calls.localReverse[0].requirements, '用户生成要求：冰系女剑客');

  // Two references: 参考图用途 shows without any choice, and the role route gets both texts.
  p = page({ respond: (payload, engine) => engine === 'grok-reverse' ? { ok: true, prompt: '冰系女剑客站在雪夜街头，蓝白配色。' } : { ok: false, error: 'unexpected' } });
  const surface = artSurface('冰系女剑客', ['https://refs.test/a.png', 'https://refs.test/b.png']);
  root = await open(p, surface);
  assert.match(root.html, /参考图用途/);
  assert.equal(root.querySelector('.novaflow-smart-ai-submit').textContent, '结合多参考图生成提示词');
  p.type('背景换成雪夜');
  await p.api.runSmartAi();
  assert.equal(p.calls.grokReverse.length, 1);
  assert.equal(p.calls.grokReverse[0].purpose, 'roleReference');
  assert.equal(p.calls.grokReverse[0].images.length, 2);
  assert.equal(p.calls.grokReverse[0].requirements, '用户生成要求：用户提示词：冰系女剑客\n用户补充要求：背景换成雪夜');
  assert.equal(surface.positive.value, '冰系女剑客站在雪夜街头，蓝白配色。');
  assert.equal(p.api.state.open, false);
});

test('美工 reference roles follow the words in the prompt box as well as in 补充要求', async () => {
  for (const [box, extra] of [['冰系女剑客，图2作为背景参考', ''], ['冰系女剑客', '图2作为背景参考']]) {
    const p = page();
    await open(p, artSurface(box, ['https://refs.test/a.png', 'https://refs.test/b.png']));
    if (extra) p.type(extra);
    await p.api.runSmartAi();
    assert.equal(p.calls.grokReverse.length, 1);
    assert.deepEqual(Array.from(p.calls.grokReverse[0].images, (image) => image.role), ['subject', 'background'], `${box} / ${extra}`);
  }
});

test('美工 references: an @参考图 mention in the prompt box survives the one call', async () => {
  const answer = { ok: true, prompt: '[风格设定]\n写实摄影风格。\n\n[主体物品]\n一名成年女性坐在木质窗台边。', negativePrompt: '模糊，低质量' };
  for (const references of [['https://refs.test/a.png'], ['https://refs.test/a.png', 'https://refs.test/b.png']]) {
    for (const engine of ['grok', 'local']) {
      const p = page({ respond: (payload, kind) => kind.endsWith('reverse') ? answer : { ok: false, error: 'unexpected' } });
      const surface = artSurface('@参考图1 的女性坐在窗边', references);
      await open(p, surface, engine);
      await p.api.runSmartAi();
      const sent = engine === 'grok' ? p.calls.grokReverse : p.calls.localReverse;
      assert.equal(sent.length, 1);
      assert.equal(sent[0].requirements, '用户生成要求：@参考图1 的女性坐在窗边', 'the words go as written, without placeholders');
      assert.equal(p.api.state.message, '', `${references.length} refs / ${engine}`);
      assert.equal(p.api.state.open, false);
      assert.equal(surface.positive.value, `@参考图1\n${answer.prompt}`, 'a mention the answer dropped is put back');
    }
  }
});

test('美工 references: an over-long text is refused with a notice, never cut', async () => {
  const p = page({ respond: () => ({ ok: false, error: 'stop' }) });
  await open(p, artSurface('冰'.repeat(1850), ['https://refs.test/a.png']));
  p.type('雪'.repeat(51));
  await p.api.runSmartAi();
  assert.equal(p.calls.grokReverse.length + p.calls.grok.length, 0, 'nothing is sent');
  assert.equal(p.api.state.message, '提示词和补充要求合计超过 1900 字，请精简后再试');
  // At the limit the whole text goes, both parts intact, inside the 2000 characters the transports accept.
  p.type('雪'.repeat(50));
  await p.api.runSmartAi();
  assert.equal(p.calls.grokReverse.length, 1);
  assert.equal(p.calls.grokReverse[0].requirements, `用户生成要求：用户提示词：${'冰'.repeat(1850)}\n用户补充要求：${'雪'.repeat(50)}`);
  assert.ok(p.calls.grokReverse[0].requirements.length <= 2000);
});

test('美工 references: explicit minor wording with sensitive wording is stopped before and after the call', async () => {
  let p = page();
  await open(p, artSurface('未成年人', ['https://refs.test/a.png']));
  p.type('裸露');
  await p.api.runSmartAi();
  assert.equal(p.calls.grokReverse.length + p.calls.grok.length, 0, 'blocked in the UI');
  assert.equal(p.api.state.message, '检测到明确未成年人内容与敏感意图同时存在，已阻止处理');
  // An answer that pairs them is not written.
  p = page({ respond: () => ({ ok: true, prompt: '一名儿童站在海边，裸露上身。', negativePrompt: '模糊' }) });
  const surface = artSurface('海边的人物', ['https://refs.test/a.png']);
  await open(p, surface);
  await p.api.runSmartAi();
  assert.equal(p.calls.grokReverse.length, 1);
  assert.equal(surface.positive.value, '海边的人物');
  assert.match(p.api.state.message, /^分析完成—未写入：/);
});

// The reference route grades its pictures in its one call (contentSafety beside the prompt) and the dialog
// uses it as the static reverse used generationGate: adult sensitive content switches 生图 to NSFW, anything
// else is written untouched, explicit minor evidence with sensitive content shows the static route's message.
const REFERENCE_MINOR_BLOCKED = '分析完成—未写入：检测到年轻或未成年人特征，敏感提示词已阻止。';
const REFERENCE_PROMPT = '[风格设定]\n写实摄影风格。\n\n[主体物品]\n一名成年女性坐在木质窗台边。';
const REFERENCE_SETS = [['https://refs.test/a.png'], ['https://refs.test/a.png', 'https://refs.test/b.png']];
// Each bridge's own shape: the web Grok bridge wraps the Edge JSON in result, the local worker answers in data.
function referenceAnswer(engine, contentSafety, extra = {}) {
  const fields = { ...(contentSafety === undefined ? {} : { contentSafety }), ...extra };
  return engine === 'grok'
    ? { ok: true, result: { ok: true, provider: 'grok', prompt: REFERENCE_PROMPT, negative_prompt: '模糊', has_negative_prompt: true, visualSchema: '', contentWarnings: [], sensitivePromptBlocked: false, ...fields } }
    : { ok: true, data: { prompt: REFERENCE_PROMPT, negativePrompt: '模糊', ...fields } };
}
// The 生图 panel's NSFW switch, as window.__NovaFlowArtGenerate exposes it.
function withNsfwSwitch(p, surface, available = true) {
  p.byId.set('novaflow-art-generate-workspace', surface.workspace);
  const switched = [];
  if (available) {
    p.context.__NovaFlowArtGenerate = { setNsfw(value) { switched.push(value); surface.workspace.setAttribute('data-novaflow-art-generate-nsfw', value ? '1' : '0'); } };
  }
  return switched;
}
async function runReference(answer, { engine, references, prompt = '成年女性坐在窗边', nsfwSwitch = true }) {
  const p = page({ respond: (payload, kind) => kind.endsWith('reverse') ? answer : { ok: false, error: 'unexpected second call' } });
  const surface = artSurface(prompt, references);
  const switched = withNsfwSwitch(p, surface, nsfwSwitch);
  await open(p, surface, engine);
  await p.api.runSmartAi();
  const label = `${references.length} refs / ${engine}`;
  assert.equal(p.calls.grokReverse.length + p.calls.localReverse.length, 1, `${label}: one call`);
  assert.equal(p.calls.grok.length + p.calls.local.length, 0, `${label}: no second pass`);
  assert.equal((engine === 'grok' ? p.calls.grokReverse : p.calls.localReverse)[0].purpose, 'roleReference');
  return { p, surface, switched, label };
}

test('美工 references: adult sensitive content switches 生图 to NSFW, then writes, on both engines', async () => {
  for (const references of REFERENCE_SETS) {
    for (const engine of ['grok', 'local']) {
      const { p, surface, switched, label } = await runReference(referenceAnswer(engine, { sensitiveContent: true, explicitMinorEvidence: false }), { engine, references });
      assert.deepEqual(switched, [true], label);
      assert.equal(surface.workspace.getAttribute('data-novaflow-art-generate-nsfw'), '1', label);
      assert.equal(surface.positive.value, REFERENCE_PROMPT, label);
      assert.equal(p.api.state.message, '', label);
      assert.equal(p.api.state.open, false, label);
    }
  }
  // Without the panel's switch nothing is written, as on the static route.
  const { p, surface } = await runReference(referenceAnswer('grok', { sensitiveContent: true, explicitMinorEvidence: false }), { engine: 'grok', references: REFERENCE_SETS[0], nsfwSwitch: false });
  assert.equal(surface.positive.value, '成年女性坐在窗边');
  assert.equal(p.api.state.message, '分析结果尚未写入：无法自动开启 Art NSFW 生成开关，请确认 Art 生成面板可用后重新分析。');
  // Explicit minor words in the answer still stop an adult-sensitive write.
  const young = referenceAnswer('local', { sensitiveContent: true, explicitMinorEvidence: false });
  young.data.prompt = REFERENCE_PROMPT.replace('一名成年女性', '一名儿童');
  const stopped = await runReference(young, { engine: 'local', references: REFERENCE_SETS[1] });
  assert.equal(stopped.surface.positive.value, '成年女性坐在窗边');
  assert.deepEqual(stopped.switched, []);
  assert.match(stopped.p.api.state.message, /^分析完成—未写入：/);
});

test('美工 references: neutral content and older engines write without touching NSFW', async () => {
  for (const references of REFERENCE_SETS) {
    for (const engine of ['grok', 'local']) {
      for (const contentSafety of [{ sensitiveContent: false, explicitMinorEvidence: false }, { sensitiveContent: false, explicitMinorEvidence: true }, undefined]) {
        const { p, surface, switched, label } = await runReference(referenceAnswer(engine, contentSafety), { engine, references, prompt: '海边的人物' });
        const caseLabel = `${label} / ${JSON.stringify(contentSafety ?? 'no signal')}`;
        assert.deepEqual(switched, [], caseLabel);
        assert.equal(surface.workspace.getAttribute('data-novaflow-art-generate-nsfw'), '0', caseLabel);
        assert.equal(surface.positive.value, REFERENCE_PROMPT, caseLabel);
        assert.equal(p.api.state.message, '', caseLabel);
        assert.equal(p.api.state.open, false, caseLabel);
      }
    }
  }
});

test('美工 references: explicit minor evidence with sensitive content is never written and shows the static route message', async () => {
  const refusals = {
    grok: [
      { ok: false, error: 'Grok 未通过未成年人敏感内容安全校验' },
      { ok: false, error: 'Grok 未通过未成年人敏感内容安全校验', errorCode: 'provider_content_policy', retryable: false },
      referenceAnswer('grok', { sensitiveContent: true, explicitMinorEvidence: true }),
    ],
    local: [
      { ok: false, error: 'MiniMax H3 敏感内容检测到明确未成年人证据，已阻断', errorCode: 'h3-sensitive-young-evidence-blocked', generationGate: 'blocked' },
      referenceAnswer('local', { sensitiveContent: true, explicitMinorEvidence: true }),
      { ok: true, data: { prompt: '', negativePrompt: '', generationGate: 'blocked', sensitivePromptBlocked: true, contentSafety: { sensitiveContent: true, explicitMinorEvidence: true } } },
    ],
  };
  for (const references of REFERENCE_SETS) {
    for (const [engine, answers] of Object.entries(refusals)) {
      for (const [index, answer] of answers.entries()) {
        const { p, surface, switched, label } = await runReference(answer, { engine, references, prompt: '海边的人物' });
        const caseLabel = `${label} / refusal ${index}`;
        assert.equal(surface.positive.value, '海边的人物', caseLabel);
        assert.deepEqual(switched, [], caseLabel);
        assert.equal(p.api.state.message, REFERENCE_MINOR_BLOCKED, caseLabel);
        assert.equal(p.api.state.loading, false, caseLabel);
        assert.equal(p.api.state.open, true, caseLabel);
      }
    }
  }
  // Any other failure keeps its own message.
  const { p } = await runReference({ ok: false, error: '提示词版式未通过检查' }, { engine: 'grok', references: REFERENCE_SETS[0] });
  assert.equal(p.api.state.message, '生成失败\n提示词版式未通过检查');
});

test('the plain animation dialog reads its frames together with the prompt and 补充要求', async () => {
  const p = page();
  await open(p, plainAnimationSurface('人物转身', ['https://refs.test/first.png']));
  assert.equal(p.api.state.mode, 'reverse');
  p.type('镜头轻推');
  await p.api.runSmartAi();
  assert.equal(p.calls.grokReverse.length, 1);
  assert.equal(p.calls.grokReverse[0].prompt, '人物转身');
  assert.equal(p.calls.grokReverse[0].requirements, '镜头轻推');
  assert.equal(p.calls.grokReverse[0].images.length, 1);
});
