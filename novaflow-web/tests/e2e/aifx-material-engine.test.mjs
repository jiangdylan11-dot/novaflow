// AIFX material recognition: local Flash at 0 credits, cloud image-reverse at the
// image_reverse price. The two channels never fall back to each other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { quoteFeature } from '../../packages/shared/src/feature-credits.mjs';
import { DEFAULT_RUNNINGHUB_LLM_MODEL } from '../../packages/shared/src/runninghub-llm.mjs';

const require = createRequire(import.meta.url);
const { MATERIAL_FIELDS, parseAifxMaterialText, buildAifxMaterialReverseRequest } = require('../../admin/admin-server/aifx-material.js');
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const runtimeSource = readFileSync(fileURLToPath(new URL('../../renderer/aifx-repaint-runtime.js', import.meta.url)), 'utf8');
const serverSource = readFileSync(fileURLToPath(new URL('../../admin/admin-server/server.js', import.meta.url)), 'utf8');
const materialSource = readFileSync(fileURLToPath(new URL('../../admin/admin-server/aifx-material.js', import.meta.url)), 'utf8');
const LOCAL_MATERIAL = { name: 'GLOWING PETAL', material: 'made of petals. NO METAL.', elements: 'made of petals.', colours: 'yellow, red', breakup: 'It SHEDS petals.' };

function page() {
  const storage = new Map();
  const calls = { local: [], cloud: [] };
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
    console, setTimeout, clearTimeout, URL, Blob, performance, Math, JSON, Promise,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    document,
    electronAPI: {
      async promptAssistantDescribeArtStyle(payload) {
        calls.local.push(payload);
        return context.localReply ? context.localReply(payload) : { ok: true, material: { ...LOCAL_MATERIAL } };
      },
      async smartAiImageReverse(payload) {
        calls.cloud.push(payload);
        return context.cloudReply ? context.cloudReply(payload) : { ok: false, error: 'unexpected cloud call' };
      },
    },
    NovaFlowFeatureCreditPrices: {
      quoteFeature,
      settlementText: (quota) => {
        const charged = quota?.charged_credits ?? quota?.settled_credits;
        if (charged == null || Number(charged) <= 0) return '';
        return `实扣 ${charged} 积分，剩余 ${quota.balance_after}`;
      },
    },
  };
  context.window = context;
  context.globalThis = context;
  runInContext(runtimeSource, createContext(context), { filename: 'aifx-repaint-runtime.js' });
  return { context, calls, storage, api: context.NovaFlowAifxMvp };
}

const image = { naturalWidth: 320, naturalHeight: 180 };

test('a missing engine preference stays local and does not call the cloud', async () => {
  const p = page();
  assert.equal(p.api.materialEngine(), 'local');
  assert.equal(p.api.materialCreditText(), '');
  const blob = {};
  const first = await p.api.recognizeMaterial(blob, image);
  const second = await p.api.recognizeMaterial(blob, image);
  assert.equal(p.calls.local.length, 1);
  assert.equal(p.calls.local[0].purpose, 'aifx-material');
  assert.equal(p.calls.cloud.length, 0);
  assert.equal(first.read.material, LOCAL_MATERIAL.material);
  assert.equal(second.read.material, LOCAL_MATERIAL.material);
  assert.equal(quoteFeature({ feature: 'aifx-material' }).credits, 4);
});

test('cloud recognition previews image_reverse, posts image-reverse, and shows the settled balance', async () => {
  const cloudMaterial = { name: 'CLOUD PETAL', material: 'soft petals', elements: 'petals', colours: 'red', breakup: 'sheds' };
  const p = page();
  p.storage.set('novaflow_web_session_v1', JSON.stringify({ token: 'session-token' }));
  p.context.cloudReply = () => ({
    ok: true,
    result: { ok: true, material: cloudMaterial, model: 'xai/grok-4.7', quota: { charged_credits: 4, balance_after: 96 } },
  });
  p.api.setMaterialEngine('grok');
  assert.equal(p.storage.get('novaflow.aifx.material.engine.v1'), 'grok');
  assert.equal(p.api.materialCreditText(), '本次将扣 4 积分');
  const blob = {};
  const found = await p.api.recognizeMaterial(blob, image);
  assert.equal(p.calls.cloud.length, 1);
  assert.equal(p.calls.local.length, 0);
  assert.equal(p.calls.cloud[0].purpose, 'aifx-material');
  assert.equal(p.calls.cloud[0].surface, 'aifx');
  assert.equal(p.calls.cloud[0].token, 'session-token');
  assert.equal(found.read.material, 'soft petals');
  assert.equal(found.quota.charged_credits, 4);
  assert.equal(found.quota.balance_after, 96);
  assert.equal(p.context.NovaFlowFeatureCreditPrices.settlementText(found.quota), '实扣 4 积分，剩余 96');
  const built = buildAifxMaterialReverseRequest({ images: [{ dataUrl: 'data:image/jpeg;base64,QQ==', name: 'reference.jpg' }] }, DEFAULT_RUNNINGHUB_LLM_MODEL);
  assert.equal(built.body.model, 'xai/grok-4.7');
  assert.equal(built.resultOptions.aifxMaterial, true);
  assert.equal(built.resultOptions.requiredProviderCalls, 1);
  assert.match(serverSource, /purpose === "aifx-material"\) return aifxMaterial\.buildAifxMaterialReverseRequest/);
  assert.match(serverSource, /feature: mode === "video_reverse" \? "video-reverse" : "image-reverse"/);
});

test('a cloud failure is not charged and does not call the local describer', async () => {
  const p = page();
  p.storage.set('novaflow_web_session_v1', JSON.stringify({ token: 'session-token' }));
  p.storage.set('novaflow.aifx.material.engine.v1', 'grok');
  p.context.cloudReply = () => ({ ok: false, error: '积分不足' });
  const found = await p.api.recognizeMaterial({}, image);
  assert.equal(found.read, null);
  assert.equal(found.quota, null);
  assert.match(found.error, /积分不足/);
  assert.equal(p.calls.cloud.length, 1);
  assert.equal(p.calls.local.length, 0);
});

test('a local failure does not call image reverse', async () => {
  const p = page();
  p.context.localReply = () => ({ ok: false, error: '本地 Flash 模型不可用', errorCode: 'flash-model-missing' });
  const found = await p.api.recognizeMaterial({}, image);
  assert.equal(found.read, null);
  assert.match(found.error, /本地材质识别不可用/);
  assert.equal(p.calls.local.length, 1);
  assert.equal(p.calls.cloud.length, 0);
});

test('both channels normalize the same material fields', () => {
  const cloud = parseAifxMaterialText('```json\n' + JSON.stringify({ ...LOCAL_MATERIAL, extra: 'ignore' }) + '\n```');
  assert.deepEqual(Object.keys(cloud).sort(), [...MATERIAL_FIELDS].sort());
  assert.deepEqual(Object.keys(LOCAL_MATERIAL).sort(), [...MATERIAL_FIELDS].sort());
  assert.equal(cloud.material, LOCAL_MATERIAL.material);
  assert.equal(parseAifxMaterialText('{"name":"X"}'), null);
});

test('switching the engine drops the cached read and asks the new channel', async () => {
  const p = page();
  p.storage.set('novaflow_web_session_v1', JSON.stringify({ token: 'session-token' }));
  p.context.cloudReply = () => ({ ok: true, result: { ok: true, material: { ...LOCAL_MATERIAL, material: 'cloud glass' }, quota: { charged_credits: 4, balance_after: 12 } } });
  const blob = {};
  await p.api.recognizeMaterial(blob, image);
  await p.api.recognizeMaterial(blob, image);
  assert.equal(p.calls.local.length, 1);
  p.api.setMaterialEngine('grok');
  const again = await p.api.recognizeMaterial(blob, image);
  assert.equal(p.calls.local.length, 1);
  assert.equal(p.calls.cloud.length, 1);
  assert.equal(again.read.material, 'cloud glass');
  p.storage.set('novaflow.aifx.material.engine.v1', 'nope');
  assert.equal(p.api.materialEngine(), 'local');
});

test('the panel toggle is next to the reference image and supplement stays local', async () => {
  assert.match(runtimeSource, /data-action="pick-style"[\s\S]{0,800}data-aifx-material-engine/);
  assert.match(runtimeSource, /novaflow\.aifx\.material\.engine\.v1/);
  const p = page();
  p.api.setMaterialEngine('grok');
  const translated = await p.api.translateSupplement('下缘不断滴落融水');
  assert.equal(p.calls.cloud.length, 0);
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
