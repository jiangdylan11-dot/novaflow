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
  for (const file of ['h3-prompt-format.js', 'ai-sequence-minimax-h3-prompt.workflow.js', 'ai-sequence-minimax-h3-reverse.workflow.js', 'smart-ai-art-auto-intent.workflow.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  const overlay = read('novaflow-smart-ai.js');
  const exposed = overlay.replace(/\n  migrateMiniMaxH3PromptHistory\(\);/, '\n  window.__smartAiDialogTest = { state, openDialog, runSmartAi, captureMiniMaxH3PromptContext, buildArtReferenceUserText, prepareStaticArtReverseFusion };\n  migrateMiniMaxH3PromptHistory();');
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
  return { context, api, calls, dialog, settle, type };
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
  return { surface: 'art', button, artGenerateMode: references.length ? 'img2img' : 'txt2img', nsfw: false, promptTarget: null, positive, negative };
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
  assert.match(root.html, /H3 补充要求（可选）/);
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

  // One reference: the static route reads the picture with both texts.
  p = page();
  let root = await open(p, artSurface('冰系女剑客，蓝白配色', ['https://refs.test/a.png']));
  assert.equal(p.api.state.mode, 'reverse');
  assert.match(root.html, /已检测 1 张参考图；将结合参考图、提示词与补充要求/);
  assert.match(root.html, /补充要求（可选）/);
  assert.equal(root.querySelector('.novaflow-smart-ai-submit').textContent, '优化并写入提示词');
  p.type('背景换成雪夜');
  await p.api.runSmartAi();
  assert.equal(p.calls.grokReverse.length, 1);
  assert.equal(p.calls.grokReverse[0].purpose, 'static-image-reverse');
  assert.equal(p.calls.grokReverse[0].images.length, 1);
  assert.equal(p.calls.grokReverse[0].requirements, '用户补充要求（只作为最终提示词约束，不作为图片可见事实）：用户提示词：冰系女剑客，蓝白配色\n用户补充要求：背景换成雪夜');

  // Only the prompt box: it is sent as written.
  p = page();
  await open(p, artSurface('冰系女剑客', ['https://refs.test/a.png']), 'local');
  await p.api.runSmartAi();
  assert.equal(p.calls.localReverse.length, 1);
  assert.equal(p.calls.localReverse[0].requirements, '用户补充要求（只作为最终提示词约束，不作为图片可见事实）：冰系女剑客');

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

test('美工 merged text stays inside the 2000-character requirements with room for the fusion wording', () => {
  const p = page();
  const merged = p.api.buildArtReferenceUserText('冰'.repeat(3000), '雪'.repeat(300));
  assert.equal(merged.length, 1600);
  assert.ok(merged.endsWith('用户补充要求：' + '雪'.repeat(300)), 'the 补充要求 is never cut for the prompt box');
  const fusion = p.api.prepareStaticArtReverseFusion('画面：一名女剑客站在桥上。', merged);
  assert.ok(fusion.request.requirements.length <= 2000);
  assert.match(fusion.request.requirements, /^用户本次修改要求（最高优先级）：用户提示词：冰+；用户补充要求：雪+\n/);
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
