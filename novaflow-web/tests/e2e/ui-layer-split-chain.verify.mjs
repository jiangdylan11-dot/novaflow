// Manual check of the whole 确认拆图 chain on a machine with the Foart runtime (several minutes on the GPU):
//   npm run sync:runtime
//   node novaflow-web/tests/e2e/ui-layer-split-chain.verify.mjs <image.png> <regions.json> <out dir>
// The built web runtime (as the page loads it) → a local control plane → a real worker from source with the
// production prompt assistant → the split process → the layers back in the page's hands.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { createWorker, UI_LAYER_SPLIT_CAPABILITY } from '../../worker/src/worker-core.mjs';
import { createPromptAssistant } from '../../worker/src/prompt-assistant.mjs';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
import { approveComputeWorker } from '../helpers.mjs';

const [imageFile, regionsFile, out] = process.argv.slice(2);
assert.ok(imageFile && regionsFile && out, 'usage: <image.png> <regions.json> <out dir>');
const root = fileURLToPath(new URL('../../', import.meta.url));
const comfyUrl = process.env.FOART_VERIFY_COMFY_URL || 'http://127.0.0.1:8188';
const queue = await (await fetch(comfyUrl + '/queue')).json();
assert.equal(queue.queue_running.length + queue.queue_pending.length, 0, 'the image service is busy; run this when the node is idle');
await mkdir(join(out, 'layers'), { recursive: true });
const control = await startLocalControlPlane({ port: 0 });
const post = async (path, body) => (await fetch(control.url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const login = await post('/dev/login', { email: 'ui-split-chain@foart.local', balance: 1000 });
const code = await post('/dev/registration-code', { email: 'ui-split-chain@foart.local' });
const runtimeJson = process.env.FOART_VERIFY_RUNTIME_JSON || 'C:/ProgramData/Foart/AI-Runtime/runtime.json';
const modelsRoot = JSON.parse((await readFile(runtimeJson, 'utf8')).replace(/^﻿/, '')).modelsPath;
const events = [];
let assistant = null;
const worker = createWorker({ controlUrl: control.url, dataDir: join(out, 'worker'), configPath: join(out, 'identity.json'),
  workflowDir: join(root, 'worker/workflows'), rendererDir: join(root, 'worker-renderer'), tunnel: false, modelsRoot, comfyImageUrl: comfyUrl, comfyVideoUrl: comfyUrl,
  registrationCode: code.registration_code, gatewayPort: 0, gatewayHost: '127.0.0.1', pollIntervalMs: 500, promptAssistant: () => assistant,
  logger: (event, data) => { events.push(event); if (/fail|error|split|claim: took|registered/i.test(event)) console.log('[worker]', event, JSON.stringify(data ?? {}).slice(0, 240)); } });
assistant = createPromptAssistant({ worker, comfyUrls: [comfyUrl], logger: (event, data) => { events.push(event); if (/split|fail|error/i.test(event)) console.log('[assistant]', event, JSON.stringify(data ?? {}).slice(0, 240)); } });
let exit = 0;
try {
  await worker.start();
  await approveComputeWorker(control.db, worker.getState().workerId);
  await worker.heartbeat?.();
  const reported = worker.getState().models.find(model => model.model_id === UI_LAYER_SPLIT_CAPABILITY);
  console.log('node reports', JSON.stringify(reported), JSON.stringify(worker.getState().models.filter(model => /flux-removal|lama|turbo$/.test(model.model_id))));
  assert.equal(reported?.status, 'ready', 'the node reports the split capability');
  const sandbox = createDomSandbox({ fetch, Response, Request, Blob, FormData, setTimeout, clearTimeout,
    HTMLButtonElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {},
    NOVAFLOW_WEB_CONFIG: { controlUrl: control.url } });
  runInContext(await readFile(join(root, 'web-dist/novaflow-web-runtime.js'), 'utf8'), createContext(sandbox));
  sandbox.NovaFlowWebRuntime.setSession(login.session);
  const caps = await (await fetch(control.url + '/api/web/capabilities', { headers: { authorization: 'Bearer ' + login.session.token } })).json();
  console.log('server says', JSON.stringify({ uiLayerSplit: caps.features.uiLayerSplit, uiLayerSplitWorkers: caps.features.uiLayerSplitWorkers,
    prompt_assistant: caps.taskTypes.find(type => type.task_type === 'prompt_assistant')?.available_workers }));
  assert.equal(caps.features.uiLayerSplit, true);
  const regions = JSON.parse(await readFile(regionsFile, 'utf8'));
  const dataUrl = 'data:image/png;base64,' + (await readFile(imageFile)).toString('base64');
  const started = Date.now();
  const result = await sandbox.electronAPI.promptAssistantReverseImagePrompt({ surface: 'ui-design', purpose: 'ui-layer-split', visualSchema: 'nf.ui.layers.v1',
    images: [{ name: 'ui.png', role: 'source', dataUrl }], regions });
  const data = result?.data || result || {};
  assert.equal(result?.ok !== false, true, String(result?.error || ''));
  assert.equal(data.visualSchema, 'nf.ui.layers.v1');
  assert.equal(data.method, 'qwen21-rgba-atlas-v1', 'the page received a generated atlas from the current helper');
  const requested = regions.filter(region => region.kind !== 'group').map(region => region.id).sort();
  assert.deepEqual(data.layers.filter(layer => layer.group !== 'background').map(layer => layer.id).sort(), requested);
  assert.ok(Array.isArray(data.layers) && data.layers.some(layer => layer.group === 'background'));
  assert.ok(events.includes('ui layer split completed'), 'the node ran the split itself');
  let z = 0;
  for (const layer of data.layers) await writeFile(join(out, 'layers', String(z++).padStart(2, '0') + '_' + layer.group + '.png'), Buffer.from(layer.dataUrl.split(',')[1], 'base64'));
  console.log('确认拆图 whole chain: ' + data.layers.length + ' layers in ' + Math.round((Date.now() - started) / 1000) + ' s → ' + join(out, 'layers'));
} catch (error) { exit = 1; console.log('CHAIN FAILED', String(error?.stack || error).slice(0, 1500)); }
finally { try { await worker.stop?.(); } catch { /* down */ } try { await assistant?.stop?.(); } catch { /* down */ } try { control.server?.close(); } catch { /* closed */ } setTimeout(() => process.exit(exit), 500); }
