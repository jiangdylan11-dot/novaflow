// Exercise the shipped adapters with the return shapes and entry points used
// by the art and animation panels. No paid providers or GPU are used here.
import strictAssert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
import { createWorkflowHost } from '../../worker/src/comfy/workflow-host.mjs';
import { instrumentModule } from '../../tools/instrument-workflow-module.mjs';
import { isAllowedWorkflowCall } from '../../packages/shared/src/workflow-modules.mjs';
import { withReferences } from '../../worker/src/worker-core.mjs';
import { fileURLToPath } from 'node:url';

const web = new URL('../../web-dist/', import.meta.url);
let checks = 0;
const assert = new Proxy(strictAssert, { get(target, key) {
  const fn = target[key];
  return typeof fn === 'function' ? (...args) => { checks += 1; return fn(...args); } : fn;
} });
const submissions = [];
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
let task;
const sandbox = createDomSandbox({
  HTMLButtonElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {},
  Response, Request, Blob, FormData,
  NOVAFLOW_WEB_CONFIG: { controlUrl: 'https://control.test' },
  fetch: async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/api/web/capabilities')) return response({ taskTypes: ['qwen_t2i', 'h3_i2v'].map(task_type => ({ task_type, available_workers: 1 })) });
    if (url.endsWith('/api/web/tasks') && init.method === 'POST') {
      const body = JSON.parse(init.body);
      assert.ok(isAllowedWorkflowCall(body.workflow.module, body.workflow.method), JSON.stringify(body.workflow));
      submissions.push(body);
      task = { id: 'test-task', assigned_worker_id: 'test-worker', status: 'completed', output_manifest: { files: [{ name: 'NovaFlow_result-task.mp4', kind: 'video' }] } };
      return response({ task });
    }
    if (url.endsWith('/api/web/tasks/test-task')) return response({ task });
    if (url.endsWith('/grant')) return response({ grant: { endpoint: 'https://worker.test', token: 'test', expiresAt: new Date(Date.now() + 600000).toISOString() } });
    if (url.startsWith('https://worker.test/gw/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } });
    throw new Error('Unexpected request (including local runtime/owner APIs): ' + url);
  }
});
const context = createContext(sandbox);
runInContext(await readFile(new URL('novaflow-web-runtime.js', web), 'utf8'), context);
const api = sandbox.electronAPI;
const stats = await api.runtimeRequestJson({ baseUrl: 'http://127.0.0.1:8188', path: '/system_stats' });
assert.ok(stats.ok && stats.data.system && stats.data.devices.length === 1);
assert.equal(stats.data, stats.result);
const uploaded = await api.runtimeUploadImage({ fileName: 'test.png', dataBase64: 'AQID' });
assert.equal(uploaded.data.name, 'test.png');
// A prepared image from another panel must not contaminate text-to-video.
runInContext(await readFile(new URL('ai-sequence-minimax-h3.workflow.js', web), 'utf8'), context);
const video = sandbox.NovaFlowAiSequenceMiniMaxH3Workflow.getWorkflowJson({ mode: 't2v', prompt: 'a girl by the sea' });
const marker = JSON.parse(String(video));
assert.equal(marker.module, 'NovaFlowAiSequenceMiniMaxH3Workflow');
const sent = await sandbox.fetch('http://127.0.0.1:8189/prompt', { method: 'POST', body: JSON.stringify({ prompt: marker }) });
assert.equal(sent.status, 200);
assert.equal((await sent.json()).prompt_id, 'test-task');
assert.deepEqual(submissions[0].references, []);
const history = await sandbox.fetch('http://127.0.0.1:8189/api/history/test-task');
assert.equal((await history.json())['test-task'].outputs['nf-output'].gifs[0].filename, 'NovaFlow_result-task.mp4');
const binary = await sandbox.electronAPI.runtimeRequestBinary({ path: '/view?filename=NovaFlow_result-task.mp4' });
assert.equal(binary.dataBase64, 'AQID');
assert.equal(binary.contentType, 'video/mp4');
const direct = await sandbox.fetch('http://127.0.0.1:8189/view?filename=NovaFlow_result-task.mp4&type=output');
assert.deepEqual([...new Uint8Array(await direct.arrayBuffer())], [1, 2, 3]);
assert.equal((await sandbox.fetch('http://127.0.0.1:8189/object_info')).status, 503);
runInContext(await readFile(new URL('ai-sequence-minimax-h3-output.resource.js', web), 'utf8'), context);
const outputResource = sandbox.NovaFlowAiSequenceMiniMaxH3OutputResource;
const published = await outputResource.publish({ promptId: 'test-task', filename: 'NovaFlow_result-task.mp4', type: 'output' });
assert.ok(published.objectUrl.startsWith('blob:'));
assert.equal(published.id, 'test-task:output::NovaFlow_result-task.mp4');
assert.deepEqual([...new Uint8Array(await (await fetch(published.objectUrl)).arrayBuffer())], [1, 2, 3]);
assert.equal((await outputResource.list()).length, 1);
assert.equal((await api.aiSeqReadTempFile({ path: 'C:/private.txt' })).ok, false);
assert.equal((await api.minimaxH3OutputPublish({ promptId: 'other-task', filename: 'NovaFlow_result-task.mp4' })).ok, false);
outputResource.dispose();
await api.runtimeUploadImage({ fileName: 'test.png', dataBase64: 'AQID' });
const cutoutIntent = sandbox.NovaFlowWebRuntime.serverOnly('spine-split-runtime', 'defaultRmbgWorkflow', ['', 'test.png', 'cutout', null]);
await api.runtimeRequestJson({ path: '/prompt', init: { method: 'POST', body: JSON.stringify({ prompt: JSON.parse(String(cutoutIntent)) }) } });
assert.deepEqual(submissions[1].references.map(ref => ref.name), ['test.png']);

// Invoke the actual art wrapper with the same fixed-seed callback as the UI.
const brand = instrumentModule(await readFile(new URL('novaflow-brand-runtime.js', web), 'utf8'), {
  moduleName: 'browser-art', forceNames: ['buildArtGenerateRunWorkflow', 'buildArtGenerateWorkflowWithSeed']
}).code;
runInContext(brand, context);
const art = sandbox.__nfBuilders['browser-art'];
const built = art.buildArtGenerateWorkflowWithSeed(42, () => art.buildArtGenerateRunWorkflow(
  'local', 'txt2img', [], 'NovaFlow_Test', 'a girl by the sea', '', 'client', [],
  { provider: 'local', mode: 'txt2img', width: 512, height: 512, seed: 42, localTextQuality: 'instant', references: ['PRIVATE_PIXELS'], promptHistory: ['PRIVATE_HISTORY'] }
));
assert.equal(built.workflow.module, 'novaflow-brand-runtime');
assert.equal(built.workflow.fn, 'buildArtGenerateRunWorkflow');
assert.equal(built.workflow.options.__args[8].seed, 42);
assert.ok(!JSON.stringify(built).includes('PRIVATE_'));
const artSent = await sandbox.electronAPI.runtimeRequestJson({ path: '/prompt', init: { method: 'POST', body: JSON.stringify({ prompt: built.workflow }) } });
assert.equal(artSent.data.prompt_id, 'test-task');

const inpaint = sandbox.NovaFlowWebRuntime.serverOnly('spine-split-runtime', 'defaultQwenInpaintWorkflow', [
  'http://127.0.0.1:8188', 'image.png', 'mask.png', 'NovaFlow_Repair', 'repair', { inpaintMode: 'complete' }
]);
const options = JSON.parse(String(inpaint)).options;
const mapped = withReferences(options, ['task-image.png', 'task-mask.png'], [{ name: 'image.png' }, { name: 'mask.png' }], 'defaultQwenInpaintWorkflow');
assert.deepEqual(mapped.__args.slice(1, 5), ['task-image.png', 'task-mask.png', 'NovaFlow_Repair', 'repair']);
assert.throws(() => withReferences(options, [], [], 'defaultQwenInpaintWorkflow'), /uploaded task reference/);

const host = await createWorkflowHost({ rendererDir: fileURLToPath(new URL('../../worker-renderer/', import.meta.url)), objectInfo: {
  RMBG: { input: { required: { image: ['IMAGE'], model: [['RMBG-2.0']], sensitivity: ['FLOAT', { default: 1 }] } } }
} });
const cutout = await host.buildGraph({ module: 'spine-split-runtime', method: 'defaultRmbgWorkflow', options: { __args: ['', 'task-image.png', 'NovaFlow_Cutout', null] } });
assert.equal(cutout['1'].inputs.image, 'task-image.png');
assert.equal(cutout['2'].class_type, 'RMBG');
await assert.rejects(host.buildGraph({ module: 'spine-split-runtime', method: 'patchWorkflow', options: {} }), /not available/);
runInContext(await readFile(new URL('novaflow-web-capabilities.js', web), 'utf8'), context);
const cached = await sandbox.electronAPI.aiSeqCacheTempFile({ fileName: 'result.png', cacheKey: 'art-output', bytes: new Uint8Array([4, 5, 6]) });
assert.ok(cached.ok && cached.path.startsWith('blob:'));
assert.equal(cached.bytes, 3);
assert.deepEqual([...new Uint8Array(await (await fetch(cached.path)).arrayBuffer())], [4, 5, 6]);
await sandbox.electronAPI.aiSeqCacheReleaseOutput({ key: 'art-output' });
await assert.rejects(fetch(cached.path));
console.log(checks + ' passed, 0 failed: shipped image/video contracts, art intent, positional references and worker cutout');
