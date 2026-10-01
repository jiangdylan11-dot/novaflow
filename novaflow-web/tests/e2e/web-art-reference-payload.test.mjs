import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
import { instrumentModule } from '../../tools/instrument-workflow-module.mjs';

test('Web image-to-image uploads pixels separately from its ControlNet task parameters', async () => {
  const submissions = [];
  const uploads = [];
  const response = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json' }
  });
  const task = { id: 'art-task', assigned_worker_id: 'worker-1', status: 'queued' };
  const sandbox = createDomSandbox({
    HTMLButtonElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {},
    Response, Request, Blob, FormData,
    NOVAFLOW_WEB_CONFIG: { controlUrl: 'https://control.test' },
    fetch: async (input, init = {}) => {
      const url = String(input);
      if (url === 'https://control.test/api/web/tasks' && init.method === 'POST') {
        submissions.push({ raw: init.body, body: JSON.parse(init.body) });
        return response({ task });
      }
      if (url === 'https://control.test/api/web/tasks/art-task') return response({ task });
      if (url.endsWith('/grant')) return response({ grant: {
        endpoint: 'https://worker.test', token: 'test', expiresAt: new Date(Date.now() + 600000).toISOString()
      } });
      if (url.startsWith('https://worker.test/gw/') && init.method === 'PUT') {
        uploads.push({ url, bytes: init.body.byteLength });
        return response({ ok: true });
      }
      throw new Error('Unexpected request: ' + url);
    }
  });
  const context = createContext(sandbox);
  runInContext(await readFile(new URL('../../renderer/novaflow-web-runtime.js', import.meta.url), 'utf8'), context);
  // This is the Web build's redacted art wrapper: its ControlNet builder records
  // metadata for the worker instead of adding graph nodes in the browser.
  const webBrand = await readFile(new URL('../../web-dist/novaflow-brand-runtime.js', import.meta.url), 'utf8');
  const brand = instrumentModule(webBrand, { moduleName: 'browser-art', forceNames: [
    'buildArtGenerateRunWorkflow', 'resolveArtGenerateReferenceInputs', 'applyArtReferenceControlNet'
  ] }).code;
  runInContext(brand, context);
  const art = sandbox.__nfBuilders['browser-art'];

  const pixels = [
    'data:image/png;base64,' + 'A'.repeat(180000),
    'data:image/png;base64,' + 'B'.repeat(180000)
  ];
  const original = pixels.map((dataUrl, index) => ({ name: `ref${index + 1}.png`, dataUrl }));
  const plan = {
    roles: ['pose', 'ui_layout'],
    capabilities: { controlNetNames: ['qwen-control-union.safetensors'], previewUrl: pixels[0] },
    conditioning: [
      { sourceIndex: 0, role: 'pose', processor: 'openpose', dataUrl: pixels[0], previewUrl: pixels[0] },
      { sourceIndex: 1, role: 'ui_layout', processor: 'canny', dataUrl: pixels[1], previewUrl: pixels[1] }
    ]
  };
  const resolved = art.resolveArtGenerateReferenceInputs(original, plan);
  assert.equal(resolved.refs[0].dataUrl, pixels[0]);
  assert.equal(resolved.refs[1].dataUrl, pixels[1]);
  assert.ok(Buffer.byteLength(JSON.stringify(resolved.rolePlan), 'utf8') > 256 * 1024);

  const names = [];
  for (const ref of original) {
    const uploaded = await sandbox.electronAPI.runtimeUploadImage({ fileName: ref.name, dataBase64: ref.dataUrl });
    names.push(uploaded.result.name);
  }
  const built = art.buildArtGenerateRunWorkflow(
    'local', 'img2img', names, 'NovaFlow_Test', 'restyle', '', 'client', [],
    { provider: 'local', mode: 'img2img', width: 800, height: 800 }
  );
  art.applyArtReferenceControlNet(built.workflow, names, null);
  assert.equal(built.workflow.options.__controlNet, undefined);
  art.applyArtReferenceControlNet(built.workflow, names, resolved.rolePlan);
  assert.equal(JSON.stringify(built.workflow).includes(pixels[0]), false);
  assert.equal(JSON.stringify(built.workflow).includes(pixels[1]), false);
  assert.deepEqual(JSON.parse(JSON.stringify(built.workflow.options.__controlNet)), {
    capabilities: { controlNetNames: ['qwen-control-union.safetensors'] },
    conditioning: [
      { sourceIndex: 0, role: 'pose', processor: 'openpose' },
      { sourceIndex: 1, role: 'ui_layout', processor: 'canny' }
    ]
  });

  const sent = await sandbox.electronAPI.runtimeRequestJson({
    path: '/prompt', init: { method: 'POST', body: JSON.stringify({ prompt: built.workflow }) }
  });
  assert.equal(sent.ok, true);
  assert.equal(submissions.length, 1);
  assert.ok(Buffer.byteLength(submissions[0].raw, 'utf8') < 256 * 1024);
  assert.equal(submissions[0].raw.includes(pixels[0]), false);
  assert.equal(submissions[0].raw.includes(pixels[1]), false);
  assert.deepEqual(submissions[0].body.references.map((ref) => ref.name), names);
  assert.deepEqual(uploads.map((upload) => upload.bytes), [135000, 135000]);
});
