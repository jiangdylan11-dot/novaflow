// 小桃上传：对话框走 IPC，文件先停在输入框，发送时才按意图放进参考位。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createGateway } from '../../worker/src/gateway/gateway.mjs';
import { inspectWorkerUpload } from '../../packages/shared/src/xiaotao-upload-guard.mjs';
import { issueGrantToken } from '../../packages/shared/src/tokens.mjs';
import { GRANT_OP } from '../../packages/shared/src/protocol.mjs';

const root = new URL('../../', import.meta.url);
const workspace = new URL('../../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, file.startsWith('particle-editor-desktop/') ? workspace : root), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok  ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}

function bytes(size = 8) { const data = new Uint8Array(size); data[0] = 137; return data; }
function file(name, type, size = 8) {
  return new File([bytes(size)], name, { type });
}
function load() {
  const saved = new Map();
  const refs = [];
  const placed = [];
  const resources = [];
  const modes = [];
  const runtime = {
    state: { active: true, provider: 'local', mode: 'txt2img', references: refs },
    references: () => refs,
    referenceLimit: () => 4,
    setMode(mode) { this.state.mode = mode; modes.push(mode); },
    activate(mode) { modes.push('activate:' + mode); },
    setReference(index, value) { refs[index] = value; placed.push({ index, name: value.name }); },
    render() {}
  };
  const imports = [];
  const sandbox = {
    console, TextEncoder, crypto: webcrypto, setTimeout, clearTimeout, setInterval, clearInterval,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    File, Blob, Uint8Array,
    URL: { createObjectURL(file) { return 'blob:test/' + (file?.name || 'file'); }, revokeObjectURL() {} },
    localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    __NovaFlowArtGenerate: runtime,
    NovaFlowH3Media: { async importFiles(kind, files, options) { imports.push({ kind, names: files.map(item => item.name), representation: options?.representation }); const dataUrl = await files[0]?.text?.(); return { errors: [], imported: files.map(item => ({ kind, dataUrl: String(dataUrl || '') })) }; } }
  };
  sandbox.window = sandbox;
  const vm = createContext(sandbox);
  runInContext(read('renderer/xiaotao-upload.js'), vm);
  runInContext(read('renderer/xiaotao-art-agent.js'), vm);
  return { sandbox, api: sandbox.NovaFlowXiaotaoUpload, agent: sandbox.NovaFlowXiaotaoArtAgent, runtime, refs, placed, resources, modes, imports };
}

await test('dialog filters are only the slot formats, and the IPC handler uses that same list', () => {
  const { api } = load();
  const filters = api.dialogFilters();
  assert.equal(JSON.stringify(filters[0].extensions), JSON.stringify(['png', 'jpg', 'jpeg', 'webp', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']));
  assert.equal(JSON.stringify(filters.map(item => item.name)), JSON.stringify(['参考资源', '图片', '视频', '音频']));
  const main = read('particle-editor-desktop/main.js');
  const preload = read('particle-editor-desktop/preload.js');
  assert.match(main, /xiaotao-pick-uploads/);
  assert.match(main, /multiSelections/);
  assert.match(preload, /pickXiaotaoUploads:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("xiaotao-pick-uploads"\)/);
  for (const ext of filters[0].extensions) assert.match(main, new RegExp(`"${ext}"`));
  assert.doesNotMatch(main.slice(main.indexOf('xiaotao-pick-uploads'), main.indexOf('open-spine-image')), /All Files|extensions:\s*\[\s*"\*"\s*\]/);
});

await test('validation accepts slot formats and rejects extension, MIME, and size mismatches', () => {
  const { api } = load();
  assert.equal(api.inspectUpload(file('a.png', 'image/png')).kind, 'image');
  assert.equal(api.inspectUpload(file('a.jpg', 'image/jpeg')).kind, 'image');
  assert.equal(api.inspectUpload(file('a.jpeg', 'image/jpeg')).kind, 'image');
  assert.equal(api.inspectUpload(file('a.webp', 'image/webp')).kind, 'image');
  assert.equal(api.inspectUpload(file('a.mp4', 'video/mp4')).kind, 'video');
  assert.equal(api.inspectUpload(file('a.mov', 'video/quicktime')).kind, 'video');
  assert.equal(api.inspectUpload(file('a.webm', 'video/webm')).kind, 'video');
  assert.equal(api.inspectUpload(file('a.mp3', 'audio/mpeg')).kind, 'audio');
  assert.equal(api.inspectUpload(file('a.wav', 'audio/wav')).kind, 'audio');
  assert.equal(api.inspectUpload(file('a.m4a', 'audio/mp4')).kind, 'audio');
  assert.equal(api.inspectUpload({ name: 'clip.gif', type: 'image/gif', size: 10 }).ok, false);
  assert.match(api.inspectUpload({ name: 'clip.png', type: 'audio/mpeg', size: 10 }).message, /不一致/);
  assert.match(api.inspectUpload({ name: 'big.png', type: 'image/png', size: api.IMAGE_MAX_BYTES + 1 }).message, /24MB/);
  assert.match(api.inspectUpload({ name: 'big.mp4', type: 'video/mp4', size: api.MEDIA_MAX_BYTES + 1 }).message, /64MB/);
  assert.equal(api.inspectUpload({ name: 'no-type.png', type: '', size: 10 }).ok, false);
});

await test('video and audio route to 多参, images follow intent, unclear intent asks', () => {
  const { api } = load();
  const video = { name: 'clip.mp4', kind: 'video' };
  const audio = { name: 'voice.wav', kind: 'audio' };
  const image = { name: 'still.png', kind: 'image' };
  assert.equal(api.planRoutes('随便说一句', [video, audio]).place.map(item => item.destination.id).join(), 'multi_reference,multi_reference');
  assert.equal(api.planRoutes('放到图生视频', [image]).place[0].destination.id, 'image_video');
  assert.equal(api.planRoutes('这张做首尾帧的首帧', [image]).place[0].destination.id, 'first_frame');
  assert.equal(api.planRoutes('尾帧用这张', [image]).place[0].destination.id, 'last_frame');
  const pair = api.planRoutes('两张分别做首帧和尾帧', [image, { ...image, name: 'end.png' }]);
  assert.equal(JSON.stringify(pair.place.map(item => item.destination.id)), JSON.stringify(['first_frame', 'last_frame']));
  assert.equal(api.planRoutes('放进多参视频', [image]).place[0].destination.id, 'multi_reference');
  assert.equal(api.planRoutes('这张是图生图参考', [image]).place[0].destination.id, 'img2img');
  const unclear = api.planRoutes('帮我看看', [image]);
  assert.equal(unclear.place.length, 0);
  assert.equal(unclear.ask.length, 1);
  assert.equal(JSON.stringify(api.choiceList().map(item => item.label)), JSON.stringify(['图生视频参考', '首尾帧首帧', '首尾帧尾帧', '多参视频参考', '图生图参考图']));
  assert.equal(api.planRoutes('图生视频还是图生图？', [image]).ask.length, 1);
  const rejected = api.planRoutes('放到图生视频', [audio]);
  assert.equal(rejected.place.length, 0);
  assert.match(rejected.reject[0].message, /多参视频/);
  assert.equal(api.planRoutes('这个视频能放图生视频吗？', [video]).place[0].destination.id, 'multi_reference');
});

function controllerFor(env, host) {
  const bridge = env.agent.createBridge();
  return env.agent.createController({ bridge, api: () => ({ artAgentChat: async () => ({ ok: true, data: { reply: '好', history: [] } }) }), uploadHost: host });
}

await test('staging an upload does not send a message or touch 绘图, and remove drops only that file', async () => {
  const env = load();
  const host = env.api.createUploadHost(env.sandbox);
  const controller = controllerFor(env, host);
  assert.equal(await controller.stageUploads([file('test.png', 'image/png'), file('clip.mp4', 'video/mp4')]), true);
  assert.equal(controller.state.staged.length, 2);
  assert.equal(controller.state.staged.every(item => item.status === 'ready'), true);
  assert.equal(controller.state.messages.some(item => item.role === 'user'), false);
  assert.equal(env.placed.length, 0);
  assert.equal(env.refs.length, 0);
  assert.equal(controller.removeStaged(controller.state.staged[0].id), true);
  assert.equal(JSON.stringify(controller.state.staged.map(item => item.name)), JSON.stringify(['clip.mp4']));
  assert.equal(await controller.send(''), false);
  assert.match(controller.state.error, /用途/);
  assert.equal(env.placed.length, 0);
  assert.equal(controller.state.staged.length, 1);
});

await test('send routes files into the matching slots and the resource list', async () => {
  const env = load();
  const doc = documentFor();
  env.sandbox.document = doc;
  const host = env.api.createUploadHost(env.sandbox);
  const controller = controllerFor(env, host);
  await controller.stageUploads([
    file('still.png', 'image/png'),
    file('end.png', 'image/png'),
    file('clip.mp4', 'video/mp4'),
    file('voice.m4a', 'audio/mp4')
  ]);
  const before = controller.state.messages.length;
  assert.equal(await controller.send('这两张做首帧和尾帧'), true);
  assert.equal(controller.state.staged.length, 0);
  assert.equal(controller.state.messages[before].role, 'user');
  assert.equal(controller.state.messages[before].attachments.length, 4);
  assert.equal(JSON.stringify(host.placed.map(item => item.id)), JSON.stringify(['first_frame', 'last_frame', 'multi_reference', 'multi_reference']));
  assert.equal(JSON.stringify(env.imports.map(item => item.kind)), JSON.stringify(['video', 'audio']));
  assert.equal(doc.modes.includes('first_last'), true);
  assert.equal(doc.modes.includes('multi_reference'), true);
  assert.equal(doc.primary.includes('动画'), true);
  assert.equal(doc.slots.get('首帧').querySelector('input').__novaflowFiles[0].name, 'still.png');
  assert.equal(doc.slots.get('尾帧').querySelector('input').__novaflowFiles[0].name, 'end.png');
  assert.equal(doc.resource.__novaflowFiles.length, 4);
  assert.equal(env.refs.length, 0);
});

await test('an image follows 图生图 and 图生视频, and an unclear image waits for a chip', async () => {
  const env = load();
  const doc = documentFor();
  env.sandbox.document = doc;
  doc.querySelector('[data-novaflow-primary-label="动画"]').click();
  const host = env.api.createUploadHost(env.sandbox);
  const controller = controllerFor(env, host);
  await controller.stageUploads([file('draw.png', 'image/png')]);
  await controller.send('放到图生图');
  assert.equal(env.runtime.state.mode, 'img2img');
  assert.equal(env.placed[0].name, 'draw.png');
  assert.equal(env.refs[0].dataUrl, 'blob:test/draw.png');
  assert.equal(String(env.refs[0].dataUrl).startsWith('data:'), false);
  assert.equal(doc.primary.includes('美工'), true);
  await controller.stageUploads([file('motion.png', 'image/png')]);
  assert.equal(await controller.send('放到图生视频参考'), true);
  assert.equal(env.sandbox.document.slots.get('参考图').getAttribute('data-novaflow-resource-occupied'), '1');
  await controller.stageUploads([file('maybe.png', 'image/png')]);
  const placedBefore = host.placed.length;
  assert.equal(await controller.send('这张怎么用'), true);
  assert.equal(host.placed.length, placedBefore);
  const ask = controller.state.messages.findLast(item => item.choices);
  assert.match(ask.content, /maybe.png/);
  assert.equal(ask.choices.length, 5);
  assert.equal(await controller.chooseUploadDestination('multi_reference', ask.pendingId), true);
  assert.equal(host.placed.at(-1).id, 'multi_reference');
  assert.equal(env.imports.at(-1).names[0], 'maybe.png');
});

async function flushFrames(frames, pending) {
  for (let guard = 0; guard < 16; guard++) {
    await Promise.resolve();
    if (frames.length) {
      const batch = frames.splice(0);
      for (const fn of batch) fn();
      continue;
    }
    const state = await Promise.race([
      pending.then(() => 'done', () => 'done'),
      new Promise(resolve => setTimeout(() => resolve('wait'), 0))
    ]);
    if (state === 'done' && !frames.length) return pending;
  }
  return pending;
}

await test('图生图 placement yields, keeps a light reference, and skips a second mode render', async () => {
  const env = load();
  const doc = documentFor();
  env.sandbox.document = doc;
  const frames = [];
  env.sandbox.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  env.sandbox.URL = { createObjectURL(file) { return 'blob:light/' + file.name; }, revokeObjectURL() {} };
  const renders = [];
  const refreshed = [];
  env.runtime.render = (options) => { renders.push(options || {}); };
  env.runtime.refreshReferences = () => { refreshed.push('grid'); return true; };
  const host = env.api.createUploadHost(env.sandbox);
  const preview = 'data:image/png;base64,' + 'A'.repeat(8000);
  const first = host.place({
    destination: env.api.destinationById('img2img'),
    file: file('still.png', 'image/png', 64),
    kind: 'image', name: 'still.png', mimeType: 'image/png', previewUrl: preview
  });
  await flushFrames(frames, first);
  assert.equal(env.runtime.state.mode, 'img2img');
  assert.equal(env.refs[0].dataUrl, 'blob:light/still.png');
  assert.equal(env.refs[0].dataUrl.includes('AAAA'), false);
  assert.equal(env.refs[0].file.name, 'still.png');
  assert.equal(typeof env.refs[0].file.arrayBuffer, 'function');
  assert.equal(renders.filter(item => item.forceBottom === true).length, 1);
  assert.equal(env.modes.filter(item => item === 'img2img').length, 1);
  assert.ok(frames.length === 0);

  renders.length = 0;
  env.runtime.state.active = true;
  const second = host.place({
    destination: env.api.destinationById('img2img'),
    file: file('next.png', 'image/png', 32),
    kind: 'image', name: 'next.png', mimeType: 'image/png', previewUrl: preview
  });
  await flushFrames(frames, second);
  assert.equal(env.modes.filter(item => item === 'img2img').length, 1);
  assert.equal(env.modes.filter(item => item === 'activate:img2img').length, 1);
  assert.equal(renders.some(item => item.forceBottom === true), false);
  assert.equal(refreshed.length, 1);
  assert.equal(env.refs[1].dataUrl, 'blob:light/next.png');
  assert.equal(env.refs[1].dataUrl.includes('AAAA'), false);
});

await test('unsupported files are rejected in chat and never staged', async () => {
  const env = load();
  const controller = controllerFor(env, env.api.createUploadHost(env.sandbox));
  await controller.stageUploads([
    { name: 'clip.gif', type: 'image/gif', size: 20 },
    { name: 'big.png', type: 'image/png', size: env.api.IMAGE_MAX_BYTES + 1 },
    { name: 'wrong.mp3', type: 'video/mp4', size: 20 }
  ]);
  assert.equal(controller.state.staged.length, 0);
  assert.equal(controller.state.messages.filter(item => item.role === 'user').length, 0);
  const text = controller.state.messages.map(item => item.content).join('\n');
  assert.match(text, /不支持 clip.gif/);
  assert.match(text, /超过 24MB/);
  assert.match(text, /不一致/);
});

await test('the upload button opens the dialog through IPC and does not send', async () => {
  const env = load();
  const picks = [];
  env.sandbox.electronAPI = {
    async pickXiaotaoUploads() {
      picks.push('ipc');
      return { canceled: false, files: [{ name: 'test.png', mimeType: 'image/png', size: 8, base64: Buffer.from(bytes()).toString('base64') }] };
    }
  };
  const ui = mount(env);
  await ui.click('上传');
  assert.deepEqual(picks, ['ipc']);
  assert.equal(ui.controller.state.messages.some(item => item.role === 'user'), false);
  assert.equal(ui.controller.state.staged[0].name, 'test.png');
  assert.equal(env.placed.length, 0);
  assert.equal(ui.panel.querySelector('.nf-xiaotao-attachment-menu'), null);
  const card = ui.panel.querySelector('.nf-xiaotao-staged-item');
  assert.equal(card.querySelector('.nf-xiaotao-staged-thumb').getAttribute('alt'), 'test.png');
  assert.equal(card.querySelector('.nf-xiaotao-staged-remove').textContent, '×');
  card.querySelector('.nf-xiaotao-staged-remove').click();
  assert.equal(ui.controller.state.staged.length, 0);
});

await test('drag-and-drop and paste stage files without sending', async () => {
  const env = load();
  const ui = mount(env);
  ui.footer.ondrop({ preventDefault() {}, dataTransfer: { files: [file('drop.png', 'image/png')] } });
  await flush();
  ui.input.onpaste({ preventDefault() {}, clipboardData: { files: [file('paste.mp3', 'audio/mpeg')] } });
  await flush();
  assert.equal(JSON.stringify(ui.controller.state.staged.map(item => item.name)), JSON.stringify(['drop.png', 'paste.mp3']));
  assert.equal(ui.controller.state.messages.some(item => item.role === 'user'), false);
});

await test('remove control is a round corner button shown on hover and keyboard focus', () => {
  const css = read('renderer/xiaotao-art-agent.css');
  assert.match(css, /\.nf-xiaotao-staged-thumb[\s\S]*border-radius:\s*12px/);
  assert.match(css, /\.nf-xiaotao-staged-remove[\s\S]*border-radius:\s*50%[\s\S]*background:\s*#1a1a1a[\s\S]*opacity:\s*0/);
  assert.match(css, /\.nf-xiaotao-staged-item:hover \.nf-xiaotao-staged-remove/);
  assert.match(css, /\.nf-xiaotao-staged-item:focus-within \.nf-xiaotao-staged-remove/);
  assert.match(css, /\.nf-xiaotao-staged-remove:focus/);
  assert.match(css, /nf-xiaotao-staged-spinner/);
});

await test('old attachment paths and the dangling closeAssistant reference are gone', () => {
  const agent = read('renderer/xiaotao-art-agent.js');
  const audio = read('renderer/audio-studio.tool.js');
  const css = read('renderer/xiaotao-art-agent.css');
  for (const source of [agent, audio, css, read('renderer/xiaotao-upload.js')]) {
    assert.doesNotMatch(source, /closeAssistant/);
    assert.doesNotMatch(source, /nf-xiaotao-attachment-menu|attachmentRole|替换画风图|替换主体图/);
  }
  assert.doesNotMatch(agent, /function attachImages|attachResources|已添加图/);
  assert.match(agent, /data-novaflow-primary-entry/);
});

function documentFor() {
  const slots = new Map();
  const primary = [];
  const modes = [];
  const nodes = [];
  function make(tag, attrs = {}) {
    const node = {
      tagName: tag.toUpperCase(), children: [], attributes: new Map(Object.entries(attrs)), hidden: false, className: '', textContent: '', style: {},
      __novaflowFiles: [],
      setAttribute(key, value) { this.attributes.set(key, String(value)); },
      getAttribute(key) { return this.attributes.get(key) ?? null; },
      append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); nodes.push(child); } },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      querySelectorAll(selector) {
        const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
        return all.filter(child => matches(child, selector));
      }
    };
    nodes.push(node);
    return node;
  }
  function matches(node, selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (part === '*') return true;
      const tag = part.match(/^[a-z0-9]+/i);
      if (tag && node.tagName !== tag[0].toUpperCase()) return false;
      const attrs = [...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
      return attrs.every(([, key, value]) => node.getAttribute(key) != null && (value === undefined || node.getAttribute(key) === value));
    });
  }
  const doc = {
    primary, modes, slots,
    getElementById(id) { return nodes.find(node => node.id === id) || null; },
    querySelector(selector) { return doc.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) { return nodes.filter(node => matches(node, selector)); },
    createElement: (tag) => make(tag)
  };
  const art = make('button', { 'data-novaflow-primary-entry': '1', 'data-novaflow-primary-label': '美工', 'aria-pressed': 'true' });
  const animation = make('button', { 'data-novaflow-primary-entry': '1', 'data-novaflow-primary-label': '动画', 'aria-pressed': 'false' });
  for (const button of [art, animation]) button.click = () => { for (const peer of [art, animation]) peer.setAttribute('aria-pressed', peer === button ? 'true' : 'false'); primary.push(button.getAttribute('data-novaflow-primary-label')); };
  for (const mode of ['image_video', 'first_last', 'multi_reference']) {
    const button = make('button', { 'data-novaflow-ai-generation-mode': mode });
    button.click = () => modes.push(mode);
  }
  for (const name of ['参考图', '首帧', '尾帧']) {
    const slot = make('div', { 'data-ais-import': name });
    const input = make('input'); input.type = 'file'; slot.append(input); slots.set(name, slot);
  }
  const resource = make('input'); resource.id = 'novaflow-ai-sequence-upload-input'; doc.resource = resource;
  return doc;
}

function mount(env) {
  const events = {};
  const nodes = [];
  class Node {
    constructor(tag, text = '') { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map(); this.style = {}; this.dataset = {}; this.hidden = false; this.className = ''; this.ownText = text; this.listeners = {}; nodes.push(this); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.ownText = ''; this.append(...children); }
    set textContent(value) { this.children = []; this.ownText = String(value); }
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); this['on' + type] = (event) => { for (const listener of this.listeners[type] || []) listener(event); }; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [child, ...child.querySelectorAll(selector)]).filter(child => match(child, selector)); }
    getBoundingClientRect() { return { left: 10, top: 10, right: 80, bottom: 80, width: 70, height: 70 }; }
    getClientRects() { return [this.getBoundingClientRect()]; }
    closest() { return null; }
    focus() {}
    click() { return this.onclick?.({ target: this, preventDefault() {}, stopPropagation() {} }); }
  }
  function match(node, selector) {
    if (selector.startsWith('.')) return node.className.split(' ').includes(selector.slice(1));
    return true;
  }
  const doc = { readyState: 'complete', hidden: false, body: null, createElement: (tag) => new Node(tag), createTextNode: (text) => new Node('#text', text), getElementById: (id) => nodes.find(node => node.id === id) || null, querySelectorAll: () => [], addEventListener(name, fn) { (events[name] ||= []).push(fn); } };
  doc.body = new Node('body');
  Object.assign(env.sandbox, { document: doc, innerWidth: 1200, innerHeight: 800, addEventListener() {}, setTimeout() { return 0; }, setInterval() { return 0; }, clearTimeout() {}, clearInterval() {} });
  env.agent.mount();
  const panel = nodes.find(node => node.id === 'nf-xiaotao-art-panel');
  return {
    panel, nodes, controller: env.agent.panel.controller,
    footer: nodes.find(node => node.className === 'nf-xiaotao-compose'),
    input: nodes.find(node => node.getAttribute('aria-label') === '给智能助手的消息'),
    click(label) { return nodes.find(node => node.tagName === 'BUTTON' && node.textContent === label).click(); }
  };
}
function flush() { return new Promise(resolve => setTimeout(resolve, 0)); }

await test('the web page opens a file input, stages until send, then uses the worker upload', async () => {
  const env = load();
  const uploads = [];
  const chats = [];
  env.sandbox.electronAPI = {
    async runtimeUploadFile(payload) {
      uploads.push({ name: payload.fileName, size: payload.bytes.byteLength, kind: payload.kind, slot: payload.slot });
      return { ok: true, result: { name: payload.fileName, kind: payload.kind, slot: payload.slot } };
    },
    async artAgentChat(payload) {
      chats.push(payload);
      return { ok: true, data: { reply: '好', history: [], provider: 'api', quota: { billing_mode: 'token', settled_credits: 3 } } };
    }
  };
  const ui = mount(env);
  const created = [];
  const original = env.sandbox.document.createElement.bind(env.sandbox.document);
  env.sandbox.document.createElement = (tag) => {
    const node = original(tag);
    if (tag === 'input') {
      created.push(node);
      node.click = () => {
        node.files = [file('web.png', 'image/png'), file('clip.mp4', 'video/mp4')];
        node.onchange();
      };
    }
    return node;
  };
  await ui.click('上传');
  assert.equal(created.length, 1);
  assert.equal(created[0].multiple, true);
  assert.equal(created[0].getAttribute('accept'), env.api.fileAccept());
  for (const token of ['.png', '.jpg', '.mp4', '.mp3', 'image/webp', 'video/webm', 'audio/mpeg']) assert.match(created[0].accept, new RegExp(token.replace('.', '\\.')));
  assert.equal(ui.controller.state.messages.some(item => item.role === 'user'), false);
  assert.equal(ui.controller.state.messages.some(item => /本地客户端/.test(String(item.content || ''))), false);
  assert.equal(JSON.stringify(ui.controller.state.staged.map(item => item.name)), JSON.stringify(['web.png', 'clip.mp4']));
  assert.equal(uploads.length, 0);
  assert.doesNotMatch(read('renderer/xiaotao-art-agent.js'), /请使用本地客户端上传文件/);

  env.sandbox.document = documentFor();
  env.sandbox.electronAPI.pickXiaotaoUploads = async () => ({ canceled: true });
  const desktop = env.api.createUploadHost(env.sandbox);
  await desktop.place({ destination: env.api.destinationById('multi_reference'), file: new File([magic('mp4')], 'desk.mp4', { type: 'video/mp4' }), kind: 'video', name: 'desk.mp4', mimeType: 'video/mp4' });
  assert.equal(uploads[0].kind, 'video');
  assert.equal(uploads[0].slot, 'multi_reference');
  uploads.length = 0;
  delete env.sandbox.electronAPI.pickXiaotaoUploads;

  const doc = documentFor();
  env.sandbox.document = doc;
  const host = env.api.createUploadHost(env.sandbox);
  const controller = env.agent.createController({
    bridge: env.agent.createBridge(),
    api: () => env.sandbox.electronAPI,
    uploadHost: host
  });
  await controller.stageUploads([new File([magic('png')], 'web.png', { type: 'image/png' }), new File([magic('mp4')], 'clip.mp4', { type: 'video/mp4' })]);
  assert.equal(controller.setProvider('api'), true);
  assert.equal(await controller.send('放进多参视频'), true);
  assert.equal(JSON.stringify(uploads.map(item => item.name)), JSON.stringify(['web.png', 'clip.mp4']));
  assert.equal(JSON.stringify(uploads.map(item => item.kind)), JSON.stringify(['image', 'video']));
  assert.equal(uploads.every(item => item.slot === 'multi_reference'), true);
  assert.equal(env.imports.every(item => item.representation === 'object-url'), true);
  assert.equal(uploads[0].size, magic('png').byteLength);
  assert.equal(uploads[1].size, magic('mp4').byteLength);
  assert.equal(JSON.stringify(host.placed.map(item => item.id)), JSON.stringify(['multi_reference', 'multi_reference']));
  assert.equal(doc.resource.__novaflowFiles.map(item => item.name).join(), 'web.png,clip.mp4');
  assert.equal(JSON.stringify(chats[0].uploads), JSON.stringify([{ kind: 'image', name: 'web.png' }, { kind: 'video', name: 'clip.mp4' }]));
  assert.equal(chats[0].provider, 'api');

  await controller.stageUploads([new File([magic('png')], 'draw.png', { type: 'image/png' })]);
  assert.equal(await controller.send('放到图生图'), true);
  assert.equal(uploads.at(-1).name, 'draw.png');
  assert.equal(host.placed.at(-1).id, 'img2img');
  assert.equal(env.sandbox.__NovaFlowArtGenerate.references()[0].name, 'draw.png');

  await controller.stageUploads([new File([magic('png')], 'maybe.png', { type: 'image/png' })]);
  assert.equal(await controller.send('这张怎么用'), true);
  const ask = controller.state.messages.findLast(item => item.choices);
  assert.equal(ask.choices.length, 5);
  assert.equal(await controller.chooseUploadDestination('image_video', ask.pendingId), true);
  assert.equal(uploads.at(-1).name, 'maybe.png');
  assert.equal(host.placed.at(-1).id, 'image_video');
});

function magic(kind) {
  if (kind === 'png') return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  if (kind === 'gif') return Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
  if (kind === 'mp4') return Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  return Uint8Array.from([1, 2, 3, 4]);
}

await test('the worker rejects a file the client extension check would allow, and 小桃 shows that error', async () => {
  const env = load();
  const uploads = [];
  env.sandbox.electronAPI = {
    async runtimeUploadFile(payload) { uploads.push(payload.fileName); return { ok: true, result: { name: payload.fileName, kind: payload.kind } }; },
    async artAgentChat() { return { ok: true, data: { reply: '好', history: [] } }; }
  };
  env.sandbox.document = documentFor();
  const host = env.api.createUploadHost(env.sandbox);
  const controller = env.agent.createController({ bridge: env.agent.createBridge(), api: () => env.sandbox.electronAPI, uploadHost: host });
  assert.equal(controller.setProvider('api'), true);
  const fake = new File([magic('gif')], 'fake.png', { type: 'image/png' });
  await controller.stageUploads([fake]);
  assert.equal(await controller.send('放到图生图'), true);
  assert.equal(uploads.length, 0);
  assert.equal(host.placed.length, 0);
  assert.match(controller.state.messages.map(item => item.content).join('\n'), /fake.png 的文件内容与 PNG 不符/);
  const shared = inspectWorkerUpload({ name: 'fake.png', mimeType: 'image/png', bytes: magic('gif'), slot: 'img2img' });
  assert.equal(shared.ok, false);
  assert.equal(shared.message, env.api.inspectWorkerUpload({ name: 'fake.png', mimeType: 'image/png', bytes: magic('gif'), slot: 'img2img' }).message);
  const videoOnImageSlot = inspectWorkerUpload({ name: 'clip.mp4', mimeType: 'video/mp4', bytes: magic('mp4'), slot: 'img2img' });
  assert.equal(videoOnImageSlot.ok, false);
  assert.match(videoOnImageSlot.message, /不能放到图生图参考图/);
  assert.equal(inspectWorkerUpload({ name: 'clip.mp4', mimeType: 'video/mp4', bytes: magic('mp4'), slot: 'multi_reference' }).ok, true);
  assert.equal(inspectWorkerUpload({ name: 'still.png', mimeType: 'image/png', bytes: magic('png'), slot: 'img2img' }).kind, 'image');
});

await test('多参 import keeps the file as a blob url instead of a base64 copy', async () => {
  const revoked = [];
  const sandbox = { console, crypto: webcrypto, URL: { createObjectURL(blob) { return 'blob:test/' + blob.size; }, revokeObjectURL(url) { revoked.push(url); } }, indexedDB: null };
  sandbox.window = sandbox;
  const vm = createContext(sandbox);
  runInContext(read('renderer/ai-sequence-h3-media.js'), vm);
  let readAsDataURL = 0;
  const store = sandbox.NovaFlowH3Media.createStore({ async get() { return null; }, async put() {} });
  const importer = sandbox.NovaFlowH3Media.createImporter(store, { readFile() { readAsDataURL += 1; throw new Error('should not base64'); } });
  const blob = new File([magic('png')], 'still.png', { type: 'image/png' });
  const result = await importer.importFiles('image', [blob], { representation: 'object-url' });
  assert.equal(result.errors.length, 0);
  assert.equal(readAsDataURL, 0);
  assert.equal(result.imported[0].dataUrl, 'blob:test/' + blob.size);
  assert.equal(result.imported[0].blob, blob);
  await store.remove(result.imported[0].sourceId);
  assert.equal(revoked.at(-1), result.imported[0].dataUrl);
});

await test('the worker gateway rejects a slot upload whose bytes do not match', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xiaotao-guard-'));
  const workerId = '11111111-1111-4111-8111-111111111111';
  const taskId = '22222222-2222-4222-8222-222222222222';
  const grantKey = '0123456789abcdef0123456789abcdef';
  const gateway = createGateway({ workerId, dataDir: dir, getGrantKey: async () => grantKey, logger: () => {} });
  const port = await gateway.listen(0, '127.0.0.1');
  try {
    const token = await issueGrantToken({ userId: 'user', taskId, workerId, op: GRANT_OP.UPLOAD, ttlSeconds: 60 }, grantKey);
    const rejected = await fetch(`http://127.0.0.1:${port}/gw/tasks/${taskId}/input/fake.png`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'x-novaflow-grant': token, 'x-novaflow-upload-slot': 'img2img' },
      body: magic('gif')
    });
    const body = await rejected.json();
    assert.equal(rejected.status, 400);
    assert.match(body.error, /文件内容与 PNG 不符/);
    const accepted = await fetch(`http://127.0.0.1:${port}/gw/tasks/${taskId}/input/still.png`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'x-novaflow-grant': token, 'x-novaflow-upload-slot': 'img2img' },
      body: magic('png')
    });
    assert.equal(accepted.status, 200);

    const headerless = await fetch(`http://127.0.0.1:${port}/gw/tasks/${taskId}/input/fake.png`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'x-novaflow-grant': token },
      body: magic('gif')
    });
    const headerlessBody = await headerless.json();
    assert.equal(headerless.status, 400);
    assert.match(headerlessBody.error, /文件内容与 PNG 不符/);
    const { access } = await import('node:fs/promises');
    await assert.rejects(access(join(dir, 'tasks', taskId, 'input', 'fake.png')));

    let sent = 0;
    const total = 25 * 1024 * 1024;
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream({
      pull(controller) {
        if (sent >= total) { controller.close(); return; }
        const n = Math.min(chunk.byteLength, total - sent);
        controller.enqueue(chunk.subarray(0, n));
        sent += n;
      }
    });
    const oversized = await fetch(`http://127.0.0.1:${port}/gw/tasks/${taskId}/input/big.png`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'x-novaflow-grant': token },
      duplex: 'half',
      body: stream
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.headers.get('connection'), 'close');
    const oversizedBody = await oversized.json();
    assert.equal(oversizedBody.ok, false);
    assert.ok(oversizedBody.error, 'an oversized upload must return its error before the socket closes');
    await assert.rejects(access(join(dir, 'tasks', taskId, 'input', 'big.png')));

    for (const name of ['request.json', 'frames-0.bin', 'pack.atlas', 'layer.psd']) {
      const kept = await fetch(`http://127.0.0.1:${port}/gw/tasks/${taskId}/input/${name}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', 'x-novaflow-grant': token },
        body: 'ok'
      });
      assert.equal(kept.status, 200, name);
    }
  } finally {
    await gateway.close();
    await rm(dir, { recursive: true, force: true });
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
