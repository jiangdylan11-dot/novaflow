import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { verifyScriptReferences, verifyUiReleaseAssets } from '../../tools/verify-ui-release-assets.mjs';
import { normalizeReverseRequest } from '../../worker/src/prompt-assistant.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const resources = process.env.NOVAFLOW_TEST_RELEASE_RESOURCES;
const webRoot = resources ? join(resources, 'web-dist') : join(root, 'web-dist');
const workerRendererRoot = resources ? join(resources, 'worker-renderer') : join(root, 'worker-renderer');

test('build rejects a missing local script even when other scripts exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'novaflow-assets-test-'));
  await writeFile(join(dir, 'index.html'), '<script src="https://cdn.invalid/a.js"></script><script src="./present.js?v=1"></script><script src="./missing.js?v=2"></script>');
  await writeFile(join(dir, 'present.js'), '');
  await assert.rejects(() => verifyScriptReferences(dir), /missing\.js/);
  await writeFile(join(dir, 'missing.js'), '');
  assert.equal((await verifyScriptReferences(dir)).scripts.length, 2);
});

test('actual emitted browser/worker/Python dependencies form a complete UI release', async () => {
  const result = await verifyUiReleaseAssets({ webRoot, workerRendererRoot,
    workerSrcRoot: resources ? join(resources, 'app/src') : join(root, 'worker/src'),
    desktopRoot: resources ? join(resources, 'desktop-license') : resolve(root, '../particle-editor-desktop') });
  assert.ok(result.checkedScripts > 100);
  assert.equal(result.nativeLayerExtractor, true);
});

class Node {
  constructor(doc, tag = 'div') { this.ownerDocument = doc; this.tagName = tag; this.style = {}; this.attrs = {}; this.children = []; this.listeners = new Map(); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  append(...items) { for (const node of items) { node.remove?.(); this.children.push(node); node.parentElement = this; } }
  appendChild(node) { this.append(node); return node; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
  get isConnected() { return Boolean(this.connected || this.parentElement?.isConnected); }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  removeEventListener(name) { this.listeners.delete(name); }
  contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
async function browser() {
  const doc = { querySelector: () => null, getElementById: () => null, body: { classList: { contains: () => true } },
    createElement: tag => new Node(doc, tag), createElementNS: (_ns, tag) => new Node(doc, tag) };
  const context = { console, document: doc, setTimeout, clearTimeout, AbortController, crypto: webcrypto, atob, Uint8Array,
    addEventListener() {}, removeEventListener() {}, MutationObserver: class { observe() {} disconnect() {} } };
  context.window = context; vm.createContext(context);
  for (const name of ['ui-design-prompt.pipeline.js', 'ui-design-assistant.workflow.js', 'art-generate-model.resource.js', 'ui-design-style-reference.js', 'ui-smart-split.core.js', 'ui-design.smart-split.js', 'ui-design.drawing.js']) {
    vm.runInContext(await readFile(join(webRoot, name), 'utf8'), context, { filename: name });
  }
  return context;
}

test('actual emitted UI prepare reaches a generation-ready result using the real style module', async () => {
  const context = await browser();
  const exact = '冻结的完整已编译原文';
  context.NovaFlowUiDesignPromptPipeline = { ...context.NovaFlowUiDesignPromptPipeline, run: async () => ({prompt: exact,
    uiCatalog: {schema:'nf.ui.structure-catalog.v1'}, uiPlan: {version:1,layoutMode:'preserve',layoutReference:1,visualMode:'theme-redesign',references:[{index:1,role:'layout'}],layoutChanges:[],preserve:[]} }) };
  const original = {id:'layout',role:'layout',dataUrl:'data:image/png;base64,YWJj'};
  const result = await context.NovaFlowUiDesignDrawing.prepare({state:{provider:'local',mode:'img2img',prompt:'参考图1的布局，完整重做为霓虹都市主题',width:960,height:2080,nsfw:false},references:[original],referenceLimit:10});
  assert.equal(result.promptSnapshot.prompt, exact);
  assert.equal(result.references[0].dataUrl, original.dataUrl);
});

test('actual emitted smart split registers and mounts its visible UI panel', async () => {
  const context = await browser();
  context.NovaFlowLeftPanelAccordion = Object.fromEntries(['panelStyle','headerStyle','titleStyle','iconStyle','labelStyle','chevronStyle','bodyStyle'].map(key => [key, () => ({})]));
  context.NovaFlowLeftPanelAccordion.chevronClass = () => '';
  const host = new Node(context.document); host.connected = true; host.setAttribute('data-psd-fusion-ui', '1');
  host.querySelector = selector => selector.includes('control-category') ? new Node(context.document) : null;
  const mounted = context.NovaFlowUiSmartSplit.mount({leftHost:host,store:{}});
  const panel = host.children.find(node => node.getAttribute('data-novaflow-ui-smart-split') === '1');
  assert.ok(panel && panel.isConnected); assert.equal(panel.style.display, '');
  assert.equal(typeof mounted.recognize, 'function'); assert.equal(typeof mounted.refine, 'function');
  mounted.destroy(); assert.equal(host.children.includes(panel), false);
});

test('emitted native extractor honors queue/cancel guards before its mocked pixel extraction', async () => {
  const source = await readFile(join(workerRendererRoot, 'spine-split-runtime.js'), 'utf8');
  const start = source.indexOf('    async extractUiObject('), end = source.indexOf('\n    },', start);
  assert.ok(start > 0 && end > start);
  let pixels = 0, queued = false;
  const context = {state:{busy:false},window:{__NovaFlowArtGenerate:{state:{running:false}}},
    detectComfyBaseUrl:async()=>'http://cpu.invalid',requestJson:async()=>({ok:true,data:{queue_running:queued?['other-task']:[],queue_pending:[]}}),
    runRmbgCutout:async()=>{pixels++;return 'CPU_TRANSPARENT_RESULT';},syncSplitWorkspace() {}};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end).replace('async extractUiObject(', 'async function extractUiObject(') + '\n}', context);
  assert.equal(await context.extractUiObject('CPU_IMAGE'), 'CPU_TRANSPARENT_RESULT');
  queued = true; await assert.rejects(() => context.extractUiObject('CPU_IMAGE'), /已有任务/);
  await assert.rejects(() => context.extractUiObject('CPU_IMAGE', {signal:{aborted:true}}), /取消/);
  assert.equal(pixels,1); assert.equal(context.state.busy,false);
});

test('normal local request transport retains the UI split recognition protocol', () => {
  const result = normalizeReverseRequest({surface:'ui-design',purpose:'ui-layer-proposal',visualSchema:'nf.ui.split.v1',images:[{dataUrl:'data:image/png;base64,YWJj'}]});
  assert.equal(result.request.purpose, 'ui-layer-proposal');
  assert.equal(result.request.visualSchema, 'nf.ui.split.v1');
});
