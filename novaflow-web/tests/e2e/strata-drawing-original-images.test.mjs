import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('../../renderer/art-direction.workflow.js', import.meta.url), 'utf8');
const ref = (name, drawingRole) => ({ name: name + '.png', drawingRole, dataUrl: 'data:image/png;base64,' + Buffer.from(name).toString('base64') });

function harness(status) {
  const requests = [], canvases = [];
  let statusCalls = 0, imageReads = 0;
  class Image {
    set src(value) { imageReads++; this.url = value; this.naturalWidth = 800; this.naturalHeight = 1000; queueMicrotask(() => this.onload()); }
  }
  const sandbox = {
    TextEncoder, crypto: webcrypto, AbortController, queueMicrotask, setTimeout, clearTimeout, Image,
    localStorage: { getItem() { return null; } },
    document: { createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0, operations: [] };
      canvases.push(canvas);
      canvas.getContext = () => ({ fillRect() {}, drawImage(...args) { canvas.operations.push(args.slice(1)); } });
      canvas.toDataURL = () => 'data:image/jpeg;base64,' + Buffer.from(JSON.stringify([canvas.width, canvas.height, canvas.operations])).toString('base64');
      return canvas;
    } },
    electronAPI: {
      promptAssistantGetStatus: async () => { statusCalls++; return typeof status === 'function' ? status() : status; },
      promptAssistantReverseImagePrompt: async payload => { requests.push(payload); throw new Error('captured-local-request'); },
      smartAiImageReverse: async payload => { requests.push(payload); throw new Error('captured-cloud-request'); }
    }
  };
  sandbox.window = sandbox;
  runInContext(source, createContext(sandbox));
  return {
    api: sandbox.NovaFlowArtDirection, sandbox, requests, canvases,
    get statusCalls() { return statusCalls; }, get imageReads() { return imageReads; },
    prepare({ prompt = '图5用图2画风', engine = 'local', references = [null, ref('style', 'style'), null, null, ref('photo', 'subject')] } = {}) {
      return sandbox.NovaFlowArtDirection.prepare({ state: { prompt, provider: 'local', mode: 'img2img', width: 1280, height: 960, drawingAnalysisEngine: engine }, references, referenceLimit: 10, generationSurface: 'drawing' });
    }
  };
}

test('Strata drawing analysis forwards complete original data URLs in upload order with unchanged reference duties', async () => {
  const h = harness({ ok: true, analysisBackend: 'strata', supportsOriginalImages: true });
  const references = [null, ref('portrait-style', 'style'), null, null, ref('landscape-source', 'subject')];
  await assert.rejects(h.prepare({ references }), /captured-local-request/);
  const payload = h.requests[0];
  assert.deepEqual(Array.from(payload.images, r => r.dataUrl), [references[1].dataUrl, references[4].dataUrl]);
  assert.deepEqual(Array.from(payload.artContext.references, r => [r.source, ...r.roles]), [[2, 'style'], [5, 'subject']]);
  assert.equal(payload.currentPrompt, '图5用图2画风');
  assert.equal(payload.artContext.editEnhancer, 'qwen21-pe-i2i', 'transport does not rewrite the existing direction contract');
  assert.equal(h.imageReads, 0, 'original images are not decoded and recompressed by the analysis transport');
  assert.equal(h.canvases.length, 0);
  await assert.rejects(h.prepare({ prompt: '图5用图2画风，保持杯子', references }), /captured-local-request/);
  assert.equal(h.statusCalls, 1, 'successful capability lookup is reused without another HTTP round trip');
});

test('PE and unadvertised backends keep their existing letterboxed JPEG analysis input', async () => {
  for (const status of [
    { ok: true, analysisBackend: 'pe' },
    { ok: true, analysisBackend: 'strata', supportsOriginalImages: false },
    { ok: true, analysisBackend: 'another-model', supportsOriginalImages: true }
  ]) {
    const h = harness(status);
    await assert.rejects(h.prepare(), /captured-local-request/);
    assert.equal(h.imageReads, 2);
    for (const image of h.requests[0].images) {
      const [width, height, operations] = JSON.parse(Buffer.from(image.dataUrl.split(',')[1], 'base64').toString());
      assert.equal(width, 1024); assert.equal(height, 1024);
      assert.deepEqual(operations[0], [112, 12, 800, 1000]);
    }
  }
});

test('cloud analysis does not consult local capability or change its proportional image encoding', async () => {
  const h = harness({ ok: true, analysisBackend: 'strata', supportsOriginalImages: true });
  await assert.rejects(h.prepare({ engine: 'grok' }), /captured-cloud-request/);
  assert.equal(h.statusCalls, 0);
  assert.equal(h.imageReads, 2);
  for (const image of h.requests[0].images) {
    const [width, height] = JSON.parse(Buffer.from(image.dataUrl.split(',')[1], 'base64').toString());
    assert.equal(width, 800); assert.equal(height, 1000);
  }
});

test('a failed capability lookup is not retained as a permanent PE transport decision', async () => {
  let attempts = 0;
  const h = harness(() => ++attempts === 1 ? { ok: false, error: 'temporarily unavailable' } : { ok: true, result: { analysisBackend: 'strata', supportsOriginalImages: true } });
  await assert.rejects(h.prepare(), /captured-local-request/);
  assert.match(h.requests[0].images[0].dataUrl, /^data:image\/jpeg/);
  await assert.rejects(h.prepare({ prompt: '图5用图2画风，保持杯子' }), /captured-local-request/);
  assert.equal(h.statusCalls, 2);
  assert.equal(h.requests[1].images[0].dataUrl, ref('style', 'style').dataUrl);
});

test('an original-image request above the local 24MiB body limit fails before inference without silent recompression', async () => {
  const h = harness({ ok: true, analysisBackend: 'strata', supportsOriginalImages: true });
  const original = { name: 'large.png', drawingRole: 'subject', dataUrl: 'data:image/png;base64,' + 'A'.repeat(24 * 1024 * 1024) };
  await assert.rejects(h.prepare({ prompt: '保留主体', references: [original] }), /超过24MB/);
  assert.equal(h.requests.length, 0);
  assert.equal(h.imageReads, 0);
  assert.equal(original.dataUrl.length, 24 * 1024 * 1024 + 22);
});
