// AIFX material recognition: one model picker shared with 小桃 (same list), local by
// default and free; an online model reads through 小桃's online operation, quoted by the
// real estimate and charged by real usage. The two never fall back to each other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { STYLE_OUTPUT_TOKENS } from '../../packages/shared/src/xiaotao-style-framework-v3.mjs';
import { XIAOTAO_ONLINE_MODEL_IDS } from '../../packages/shared/src/xiaotao-online-models.mjs';

const require = createRequire(import.meta.url);
const { MATERIAL_FIELDS, parseAifxMaterialText } = require('../../admin/admin-server/aifx-material.js');
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const runtimeSource = readFileSync(fileURLToPath(new URL('../../renderer/aifx-repaint-runtime.js', import.meta.url)), 'utf8');
const webRuntimeSource = readFileSync(fileURLToPath(new URL('../../renderer/novaflow-web-runtime.js', import.meta.url)), 'utf8');
const agentSource = readFileSync(fileURLToPath(new URL('../../renderer/xiaotao-art-agent.js', import.meta.url)), 'utf8');
const companionSource = readFileSync(fileURLToPath(new URL('../../supabase/functions/novaflow-companion/index.ts', import.meta.url)), 'utf8');
const frameworkSource = readFileSync(fileURLToPath(new URL('../../packages/shared/src/xiaotao-style-framework-v3.mjs', import.meta.url)), 'utf8');
const materialSource = readFileSync(fileURLToPath(new URL('../../admin/admin-server/aifx-material.js', import.meta.url)), 'utf8');
const LOCAL_MATERIAL = { name: 'GLOWING PETAL', material: 'made of petals. NO METAL.', elements: 'made of petals.', colours: 'yellow, red', breakup: 'It SHEDS petals.' };

function page({ withState = false, stored = {} } = {}) {
  const storage = new Map(Object.entries(stored));
  const calls = { local: [], online: [], cloud: [] };
  class Node {
    constructor(tag = 'div') {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.style = { setProperty() {}, cssText: '' };
      this.attributes = {};
      this.classList = { contains: () => false, add() {}, remove() {} };
      this.dataset = {};
      this.hidden = false;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest() { return null; }
    contains() { return false; }
    getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; }
  }
  const document = {
    readyState: 'complete',
    head: new Node('head'),
    body: new Node('body'),
    documentElement: new Node('html'),
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) {
      const node = new Node(tag);
      if (tag === 'canvas') {
        node.getContext = () => ({ fillStyle: '', fillRect() {}, drawImage() {} });
        node.toDataURL = () => 'data:image/jpeg;base64,QQ==';
      }
      return node;
    },
  };
  const context = {
    console, setTimeout, clearTimeout, URL, Blob, performance, Math, JSON, Promise, AbortController,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    document,
    electronAPI: {
      async promptAssistantDescribeArtStyle(payload) {
        if (payload.assistantSelectionScope) {
          calls.online.push(payload);
          return context.onlineReply ? context.onlineReply(payload) : { ok: false, error: 'unexpected online call' };
        }
        calls.local.push(payload);
        return context.localReply ? context.localReply(payload) : { ok: true, material: { ...LOCAL_MATERIAL } };
      },
      async smartAiImageReverse(payload) {
        calls.cloud.push(payload);
        return context.cloudReply ? context.cloudReply(payload) : { ok: false, error: 'unexpected cloud call' };
      },
    },
    crypto: globalThis.crypto,
    NovaFlowXiaotaoArtAgent: {
      MODEL_PICKER_GROUPS: [{ key: 'local', ids: ['qwen3.5-9b-heretic'] }, { key: 'online', ids: [...XIAOTAO_ONLINE_MODEL_IDS] }],
      panel: { controller: {
        estimates: [],
        pricingPolicyKey: () => 'sha256:policy',
        styleReadAvailable: (id) => id !== 'openai/gpt-6.1-sol-saver',
        operationEstimate(input) { this.estimates.push(input); return { credits: 0.4213 }; },
        refreshPricingPolicy: async () => null,
        prefetchPricingPolicy() {},
        businessModelSnapshot: () => ({ provider: 'api', modelId: 'xai/grok-4.7', epoch: 7 }),
        onlineBusinessUi: (modelId) => ({ fromPanel: modelId, confirmImageUpload: async () => true, onPricingQuote() {}, confirmPricingQuote: async () => true, onBillingNotice: () => true }),
      } },
    },
    NovaFlowFeatureCreditPrices: {
      settlementText: (quota) => {
        const charged = quota?.charged_credits ?? quota?.settled_credits;
        if (charged == null || Number(charged) <= 0) return '';
        return `实扣 ${charged} 积分，剩余 ${quota.balance_after}`;
      },
    },
  };
  context.window = context;
  context.globalThis = context;
  const source = withState ? runtimeSource.replace('  window.NovaFlowAifxMvp = {', '  window.__aifxState = state; window.NovaFlowAifxMvp = {') : runtimeSource;
  runInContext(source, createContext(context), { filename: 'aifx-repaint-runtime.js' });
  return { context, calls, storage, api: context.NovaFlowAifxMvp };
}

const image = { naturalWidth: 320, naturalHeight: 180 };
const ONLINE = 'deepseek/deepseek-v4.1-flash';
const onlineMaterial = { name: 'CLOUD PETAL', material: 'soft petals', elements: 'petals', colours: 'red', breakup: 'sheds' };

test('the picker starts on the local model, reads for free and never goes online', async () => {
  const p = page();
  assert.equal(p.api.materialModel(), 'qwen3.5-9b-heretic');
  assert.equal(p.api.materialCreditText(), '');
  const blob = {};
  const first = await p.api.recognizeMaterial(blob, image);
  const second = await p.api.recognizeMaterial(blob, image);
  assert.equal(p.calls.local.length, 1);
  assert.equal(p.calls.local[0].purpose, 'aifx-material');
  assert.equal(p.calls.online.length, 0);
  assert.equal(first.read.material, LOCAL_MATERIAL.material);
  assert.equal(second.read.material, LOCAL_MATERIAL.material);
  assert.equal(first.model, 'qwen3.5-9b-heretic');
});

test('an online model shows the real estimate and reads through the online operation', async () => {
  const p = page();
  const controller = p.context.NovaFlowXiaotaoArtAgent.panel.controller;
  let quoteLine = '';
  p.context.onlineReply = async (payload) => {
    payload.onPricingQuote({ requestId: payload.requestId, estimatedCredits: 0.5 });
    assert.equal(await payload.confirmPricingQuote({}), true);
    assert.equal(await payload.confirmImageUpload({ count: 1 }), true);
    assert.equal(payload.onBillingNotice({ requestId: payload.requestId, submitted: true }), true);
    quoteLine = p.api.materialCreditText();
    return { ok: true, material: { ...onlineMaterial }, model: ONLINE, quota: { status: 'settled', settled_credits: 0.37, quote_estimated_credits: 0.5 } };
  };
  assert.equal(p.api.setMaterialModel(ONLINE), true);
  assert.equal(p.api.materialModel(), ONLINE);
  assert.equal(p.api.materialCreditText(), '本次预估 0.42 积分，按实际用量结算');
  const asked = controller.estimates.at(-1);
  assert.equal(asked.modelId, ONLINE);
  assert.equal(asked.outputTokens, STYLE_OUTPUT_TOKENS['aifx-material']);
  assert.equal(asked.images.length, 1);
  const found = await p.api.recognizeMaterial({}, image);
  assert.equal(p.calls.local.length, 0);
  assert.equal(p.calls.online.length, 1);
  const sent = p.calls.online[0];
  assert.equal(sent.assistantSelectionScope, 'aifx-material');
  assert.equal(sent.assistantProvider, 'api');
  assert.equal(sent.assistantModelId, ONLINE);
  assert.equal(sent.assistantSelectionEpoch, p.context.FoartAifxMaterialModel.businessModelSnapshot().epoch);
  assert.equal(sent.purpose, 'aifx-material');
  assert.equal(found.read.material, 'soft petals');
  assert.equal(found.quota.settled_credits, 0.37);
  assert.equal(found.model, ONLINE);
  assert.match(quoteLine, /本次预估 0\.42 积分/);
});

test('a model without image reading says so instead of a price', () => {
  const p = page();
  p.api.setMaterialModel('openai/gpt-6.1-sol-saver');
  assert.equal(p.api.materialCreditText(), '该模型暂未开通图片材质识别，请换一个模型');
  assert.equal(p.api.setMaterialModel('other/model'), false);
  assert.equal(p.api.materialModel(), 'openai/gpt-6.1-sol-saver');
});

test('an online failure keeps its message and does not call the local describer', async () => {
  const p = page();
  p.context.onlineReply = () => ({ ok: false, error: '积分不足' });
  p.api.setMaterialModel(ONLINE);
  const found = await p.api.recognizeMaterial({}, image);
  assert.equal(found.read, null);
  assert.equal(found.quota, null);
  assert.match(found.error, /积分不足/);
  assert.equal(p.calls.online.length, 1);
  assert.equal(p.calls.local.length, 0);
});

test('a local failure does not go online', async () => {
  const p = page();
  p.context.localReply = () => ({ ok: false, error: '本地 Flash 模型不可用', errorCode: 'flash-model-missing' });
  const found = await p.api.recognizeMaterial({}, image);
  assert.equal(found.read, null);
  assert.match(found.error, /本地材质识别不可用/);
  assert.equal(p.calls.local.length, 1);
  assert.equal(p.calls.online.length, 0);
});

test('both channels normalize the same material fields', () => {
  const parsed = parseAifxMaterialText('```json\n' + JSON.stringify({ ...LOCAL_MATERIAL, extra: 'ignore' }) + '\n```');
  assert.deepEqual(Object.keys(parsed).sort(), [...MATERIAL_FIELDS].sort());
  assert.deepEqual(Object.keys(LOCAL_MATERIAL).sort(), [...MATERIAL_FIELDS].sort());
  assert.equal(parsed.material, LOCAL_MATERIAL.material);
  assert.equal(parseAifxMaterialText('{"name":"X"}'), null);
});

test('switching the model drops the cached read and asks the new model', async () => {
  const p = page();
  p.context.onlineReply = () => ({ ok: true, material: { ...LOCAL_MATERIAL, material: 'online glass' }, quota: { status: 'settled', settled_credits: 1 } });
  const blob = {};
  await p.api.recognizeMaterial(blob, image);
  await p.api.recognizeMaterial(blob, image);
  assert.equal(p.calls.local.length, 1);
  const before = p.context.FoartAifxMaterialModel.businessModelSnapshot().epoch;
  p.api.setMaterialModel(ONLINE);
  assert.equal(p.context.FoartAifxMaterialModel.businessModelSnapshot().epoch, before + 1);
  const again = await p.api.recognizeMaterial(blob, image);
  assert.equal(p.calls.local.length, 1);
  assert.equal(p.calls.online.length, 1);
  assert.equal(again.read.material, 'online glass');
  p.api.setMaterialModel('qwen3.5-9b-heretic');
  await p.api.recognizeMaterial(blob, image);
  assert.equal(p.calls.local.length, 2);
});

test('the choice is not stored, and the old 本地/云端 key is cleared', () => {
  const p = page({ stored: { 'novaflow.aifx.material.engine.v1': 'grok' } });
  assert.equal(p.api.materialModel(), 'qwen3.5-9b-heretic');
  assert.deepEqual([...p.storage.keys()], []);
  p.api.setMaterialModel(ONLINE);
  assert.deepEqual([...p.storage.keys()], []);
});

test('a run from the 小桃 panel reads online with its model under 小桃\'s choice, once, and leaves the picker alone', async () => {
  const p = page({ withState: true });
  p.context.onlineReply = () => ({ ok: true, material: { ...LOCAL_MATERIAL } });
  p.context.NovaFlowAifxRestyleWorkflow = { getPreset: () => null, splitSupplement: () => ({ additions: '', spread: '', colour: null }), referenceMaterial: () => 'read' };
  Object.assign(p.context, { addEventListener() {}, removeEventListener() {} });
  p.context.NovaFlowAifxRestyleClient = { ensureRuntime: async () => { throw new Error('stop here'); } };
  const blob = {};
  Object.assign(p.context.__aifxState, { source: {}, reference: { blob, image, fileName: 'reference.jpg' } });
  await assert.rejects(p.api.runProductionPipeline({ model: 'xai/grok-4.7' }), /stop here/);
  assert.equal(p.calls.online.length, 1);
  assert.equal(p.calls.online[0].assistantSelectionScope, 'xiaotao');
  assert.equal(p.calls.online[0].assistantModelId, 'xai/grok-4.7');
  assert.equal(p.calls.online[0].assistantSelectionEpoch, 7);
  assert.equal(p.calls.online[0].fromPanel, 'xai/grok-4.7');
  assert.equal(p.calls.local.length, 0);
  assert.equal(p.api.materialModel(), 'qwen3.5-9b-heretic');
  await assert.rejects(p.api.runProductionPipeline({ model: 'xai/grok-4.7' }), /stop here/);
  assert.equal(p.calls.online.length, 1);
  await assert.rejects(p.api.runProductionPipeline(), /stop here/);
  assert.equal(p.calls.online.length, 1);
  assert.equal(p.calls.local.length, 1);
});

test('the old radio, fixed price and fixed cloud model are gone; the picker is 小桃\'s', () => {
  assert.doesNotMatch(runtimeSource, /data-aifx-material-engine-value|type="radio" name="aifx-material-engine"/);
  assert.doesNotMatch(runtimeSource, /smartAiImageReverse|本次将扣|CLOUD_MATERIAL_MODEL|deepseek|'grok'|云端/);
  assert.doesNotMatch(runtimeSource, /localStorage\.setItem\([^)]*material/);
  // Panel order (Dylan, Nov 4): 生成特效, 数量, model picker, 提示词补充, 风格库, then a small upload box.
  const order = ['data-action="generate"', 'data-action="candidates"', 'data-aifx-material-model', 'data-action="prompt-supplement"', 'data-action="open-style-library"', 'data-action="pick-style"']
    .map((marker) => runtimeSource.indexOf(marker));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), String(order));
  assert.match(runtimeSource, /nf-upload-dropzone--small aifx-reference-zone/);
  assert.match(runtimeSource, /agent\.createModelPicker\(document/);
  assert.match(runtimeSource, /agent\.modelOptionInfo\(/);
  assert.match(agentSource, /const picker=createModelPicker\(doc,/);
  assert.match(agentSource, /root\.NovaFlowXiaotaoArtAgent = \{MODEL_PICKER_GROUPS, modelOptionInfo, onlineGroupLabel, createModelPicker,/);
});

test('the estimate uses the server\'s own material prompt size and answer budget', () => {
  const text = (name) => {
    const line = frameworkSource.split('\n').find((row) => row.startsWith('const ' + name + ' = '));
    return JSON.parse(line.slice(line.indexOf('= ') + 2).replace(/;\s*$/, ''));
  };
  const chars = text('EFFECT_MATERIAL_SYSTEM_TEXT').length + text('EFFECT_MATERIAL_QUESTION').length;
  assert.match(runtimeSource, new RegExp('const MATERIAL_PROMPT_CHARS = ' + chars + '\\b'));
  assert.match(runtimeSource, new RegExp('const MATERIAL_OUTPUT_TOKENS = ' + STYLE_OUTPUT_TOKENS['aifx-material'] + '\\b'));
});

test('the page runtime takes the 特效 choice only for one online material read', () => {
  assert.match(webRuntimeSource, /payload\.assistantSelectionScope === 'aifx-material'[\s\S]{0,700}action !== 'describe-art-style' \|\| payload\.purpose !== 'aifx-material' \|\| selected\?\.provider !== 'api'[\s\S]{0,400}return selectedOnlineStyleAnalysis\(payload,selected,owner\)/);
  assert.match(webRuntimeSource, /selectionOwner=\(\)=>scope==='aifx-material'\?root\.FoartAifxMaterialModel:root\.NovaFlowXiaotaoArtAgent\?\.panel\?\.controller/);
  assert.match(webRuntimeSource, /payload\.isInputCurrent\(\)===true&&selectionOwner\(\)===controller&&/);
  assert.match(companionSource, /styleEnabled:v3Capabilities\?\.vision===true,styleVisionModels:v3Capabilities\?\.vision===true\?\[\.\.\.XIAOTAO_VISION_MODEL_IDS\]:\[\]/);
});

test('the supplement stays local whatever model reads the picture', async () => {
  const p = page();
  p.api.setMaterialModel(ONLINE);
  const translated = await p.api.translateSupplement('下缘不断滴落融水');
  assert.equal(p.calls.online.length, 0);
  assert.equal(p.calls.local.length, 1);
  assert.equal(p.calls.local[0].purpose, 'aifx-supplement');
  assert.equal(translated, '');
});

test('style-transfer files stay untouched and the material prompt has no secret', () => {
  const names = execFileSync('git', ['diff', '--name-only', 'feature/novaflow-web'], { cwd: repoRoot, encoding: 'utf8' });
  for (const banned of [
    'novaflow-web/worker/src/flash-art-agent.mjs',
    'novaflow-web/worker/src/flash-art-direction.mjs',
    'style-transfer.v1.json',
  ]) assert.equal(names.includes(banned), false, banned);
  assert.doesNotMatch(names, /art-skills\//);
  assert.doesNotMatch(materialSource, /sk-[A-Za-z0-9]{8,}|api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i);
  assert.doesNotMatch(materialSource, /require\(|from ['"]/);
});
