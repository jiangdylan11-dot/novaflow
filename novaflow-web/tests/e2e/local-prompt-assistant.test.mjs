// 提示词助手 on the machine 启动NovaFlow opened the browser from: the assistant
// starts the desktop's service script, hands the GPU over from ComfyUI first,
// stops the script afterwards, and the page reaches it only through the paired
// local server. The hosted site keeps refusing, since no machine stands behind it.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { createLocalAssistant } from '../../worker/src/local-assistant.mjs';
import { createPromptAssistant, MODEL_NAME, normalizeOptimizeRequest } from '../../worker/src/prompt-assistant.mjs';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
const equal = (a, b, message) => { assert.equal(a, b, message); checks++; };
const wait = async fn => { const end = Date.now() + 15000; while (!await fn()) { if (Date.now() > end) throw new Error('wait timed out'); await new Promise(r => setTimeout(r, 30)); } };
const listen = async server => { await new Promise(r => server.listen(0, '127.0.0.1', r)); return 'http://127.0.0.1:' + server.address().port; };
const fixture = fileURLToPath(new URL('../fixtures/prompt-assistant-fake-service.mjs', import.meta.url));

// A ComfyUI that is idle or drawing, and remembers being asked to unload.
let queueBusy = false;
const freeCalls = [];
const comfy = createServer(async (req, res) => {
  const send = body => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
  if (req.url === '/system_stats') return send({ system: { comfyui_version: 'fixture' }, devices: [] });
  if (req.url === '/queue' && req.method === 'GET') return send({ queue_running: queueBusy ? [[0, 'drawing']] : [], queue_pending: [] });
  if (req.url === '/free' && req.method === 'POST') { let body = ''; for await (const chunk of req) body += chunk; freeCalls.push(JSON.parse(body)); return send({}); }
  res.statusCode = 404; send({});
});
const comfyUrl = await listen(comfy);

// The runtime layout the desktop reads: runtime.json names where the models are.
const dataDir = await mkdtemp(join(tmpdir(), 'novaflow-prompt-assistant-test-'));
const runtimeDir = join(dataDir, 'AI-Runtime'); await mkdir(join(runtimeDir, 'engine', 'ComfyUI'), { recursive: true });
const modelsDir = join(dataDir, 'models'); await mkdir(join(modelsDir, 'text_encoders'), { recursive: true });
await writeFile(join(modelsDir, 'text_encoders', MODEL_NAME), 'not really weights');
const runtimeJsonPath = join(runtimeDir, 'runtime.json');
await writeFile(runtimeJsonPath, '﻿' + JSON.stringify({ installPath: runtimeDir, modelsPath: modelsDir, port: 8188 }));
const webRoot = join(dataDir, 'web'); await mkdir(webRoot); await writeFile(join(webRoot, 'index.html'), '<html><head></head><body>NovaFlow</body></html>');
const workflowDir = join(dataDir, 'workflows'); await mkdir(workflowDir);
const license = { state: async () => ({ status: 'licensed', machineId: 'fixture' }), assertAllowed: async () => {}, importLicense: async () => { throw new Error('fixture'); } };
const services = { start: async () => [{ kind: 'image', running: true, reused: true }], stop: async () => {} };
const promptAssistantOptions = { pythonPath: process.execPath, serviceScript: fixture, runtimeJsonPath };
const assistant = await createLocalAssistant({ dataDir, configPath: join(dataDir, 'identity.json'), workflowDir, webRoot,
  localPort: 0, gatewayPort: 0, gatewayHost: '127.0.0.1', tunnel: false, workerName: 'prompt-assistant-test',
  comfyImageUrl: comfyUrl, comfyVideoUrl: comfyUrl, license, services, pollIntervalMs: 30, promptAssistant: promptAssistantOptions });
let origin, pairing;
const call = async (method, path, body, extra = {}) => {
  const r = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', 'x-novaflow-local': pairing, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
try {
  await assistant.start(); origin = assistant.getState().workbenchUrl; pairing = new URL(assistant.openUrl).hash.split('=')[1];

  // -- paired local routes, desktop-shaped answers ---------------------------
  equal((await fetch(origin + '/local/prompt-assistant/status')).status, 401, 'status needs the pairing key');
  const status = (await call('GET', '/local/prompt-assistant/status')).body;
  check(status.ok === true && status.enabled === true && status.runtimeStatus === '模型可用', 'the drawing text encoder makes the assistant available');
  check(status.modelPath.endsWith(MODEL_NAME) && status.reverseModelEnabled === false, 'status names the model it found and the reverse model it did not');
  check(!assistant.promptAssistant.running, 'the script is not started until asked');

  const optimize = await call('POST', '/local/prompt-assistant/optimize-prompt', { prompt: 'hello', surface: 'art', purpose: 'optimize', provider: 'gpt', requirements: 'more light' });
  equal(optimize.status, 200);
  check(optimize.body.ok === true && optimize.body.data.positivePrompt === 'optimized: hello' && optimize.body.data.negativePrompt === 'blurry', 'optimize answers with the script data');
  equal(optimize.body.runtimeStatus, '模型可用');
  equal(optimize.body.data.echo.provider, 'local', 'a browser cannot pick a cloud provider on this machine');
  equal(optimize.body.data.echo.currentPrompt, 'hello', 'currentPrompt defaults to the prompt as on desktop');
  equal(optimize.body.data.echo.modelPath, join(modelsDir, 'text_encoders', MODEL_NAME), 'the script gets the model path in its environment');
  equal(optimize.body.data.echo.comfyRoot, join(runtimeDir, 'engine', 'ComfyUI'), 'the script gets ComfyUI from the runtime install');
  equal(optimize.body.data.echo.runtimeJson, runtimeJsonPath);
  equal(freeCalls.length, 1, 'ComfyUI was asked to unload before the model loaded');
  check(freeCalls[0].unload_models === true && freeCalls[0].free_memory === true, 'the unload asks for models and memory');
  await wait(() => !assistant.promptAssistant.running);
  check(true, 'the script is stopped after the request so 绘图 gets its memory back');

  // -- the GPU is not taken from a drawing in progress -------------------------
  queueBusy = true;
  const blocked = (await call('POST', '/local/prompt-assistant/optimize-prompt', { prompt: 'hello' })).body;
  check(blocked.ok === false && blocked.errorCode === 'runtime-generation-busy' && blocked.runtimeStatus === '绘图生成中', 'a busy ComfyUI queue blocks the request');
  equal(freeCalls.length, 1, 'no unload is sent while ComfyUI is drawing');
  check(!assistant.promptAssistant.running, 'nothing was started for the blocked request');
  queueBusy = false;

  // -- one request at a time -------------------------------------------------
  const first = call('POST', '/local/prompt-assistant/optimize-prompt', { prompt: 'delay' });
  await wait(() => assistant.promptAssistant.busy);
  const second = (await call('POST', '/local/prompt-assistant/optimize-prompt', { prompt: 'hello' })).body;
  check(second.ok === false && second.errorCode === 'prompt-assistant-busy', 'a second request waits its turn');
  check((await first).body.data.positivePrompt === 'optimized: delay', 'the first request still completes');

  // -- failures come back as answers, not as broken connections ---------------
  const failed = (await call('POST', '/local/prompt-assistant/optimize-prompt', { prompt: 'fail' })).body;
  check(failed.ok === false && failed.error === 'model refused' && failed.errorCode === 'generation-blocked' && failed.retryable === false, 'the script failure keeps its code');
  const statusAfter = (await call('GET', '/local/prompt-assistant/status')).body;
  equal(statusAfter.error, 'model refused', 'status reports the last failure');
  const recovered = (await call('POST', '/local/prompt-assistant/optimize-prompt', { prompt: 'again' })).body;
  check(recovered.ok === true && recovered.data.positivePrompt === 'optimized: again', 'the next request starts a fresh script');
  equal((await call('GET', '/local/prompt-assistant/status')).body.error, '', 'a success clears the failure');

  // -- image payloads are larger than any other local request ---------------
  const dataUrl = 'data:image/png;base64,' + 'A'.repeat(1500000);
  const reverse = (await call('POST', '/local/prompt-assistant/reverse-image-prompt', { purpose: 'static-image-reverse', images: [{ name: '../x.png', dataUrl }], visualSchema: 'nf.visual.v2' })).body;
  check(reverse.ok === true && reverse.data.images === 1 && reverse.data.bytes === dataUrl.length, 'a 1.5 MB reference image reaches the script whole');
  equal((await call('POST', '/local/bind-account', { token: 'x'.repeat(300000) })).status, 413, 'other local routes keep their small limit');
  const invalid = (await call('POST', '/local/prompt-assistant/reverse-image-prompt', { purpose: 'minimax-h3-i2v-reverse', images: [{ dataUrl }] })).body;
  check(invalid.ok === false && invalid.errorCode === 'invalid-request' && /nf\.h3\.visual\.v1/.test(invalid.error), 'the desktop request contract is enforced');
  const style = (await call('POST', '/local/prompt-assistant/describe-art-style', { name: 'scene.png', dataUrl: 'data:image/png;base64,QQ==' })).body;
  check(style.ok === true && style.style === 'flat vector', '万物迁移 gets the scene style');
  equal((await call('POST', '/local/prompt-assistant/nope', {})).status, 404);

  // -- payload shaping matches the desktop handler ---------------------------
  const shaped = normalizeOptimizeRequest({ surface: 'art', purpose: 'optimize', currentPrompt: 'a cat', promptSchema: 'nf.art.prompt.v1', promptDetailMode: 'simple-structured-v1', requirements: 'x'.repeat(5000) });
  check(shaped.request.promptSchema === 'nf.art.prompt.v1' && shaped.request.promptDetailMode === 'simple-structured-v1' && shaped.request.requirements.length === 2000 && shaped.timeoutMs === 300000, 'structured art prompts keep their schema and limits');
  const patch = normalizeOptimizeRequest({ purpose: 'optimize', currentPrompt: 'a cat' });
  check(patch.request.promptSchema === undefined && patch.timeoutMs === 900000, 'a plain rewrite gets the desktop\'s long budget');
  assert.throws(() => normalizeOptimizeRequest({ purpose: 'minimax-h3-prompt-enhance', h3ReferenceFrames: [{ label: '<Picture 1>', dataUrl: 'data:image/png;base64,QQ==' }] }), /H3 参考画面与素材不匹配/); checks++;

  // -- without the model the answer says so; another instance holding it too --
  const bare = createPromptAssistant({ ...promptAssistantOptions, runtimeJsonPath: join(dataDir, 'missing.json'), comfyUrls: [] });
  check(bare.status().enabled === false && bare.status().error === '未配置模型', 'no runtime.json means no model');
  check((await bare.optimizePrompt({ prompt: 'x' })).ok === false, 'nothing is started without a model');
  const taken = createPromptAssistant({ ...promptAssistantOptions, comfyUrls: [], env: { FAKE_PROMPT_ASSISTANT_STARTUP: 'already-running' } });
  const elsewhere = await taken.optimizePrompt({ prompt: 'x' });
  check(elsewhere.ok === false && elsewhere.errorCode === 'prompt-assistant-already-running' && elsewhere.retryable === true, 'the desktop client holding the model is reported, not fought');

  // -- the page forwards only from a paired local machine ---------------------
  const source = await readFile(new URL('../../renderer/novaflow-web-runtime.js', import.meta.url), 'utf8');
  const requests = [];
  const pair = 'b'.repeat(64);
  const storage = new Map();
  const local = createDomSandbox({ Response, Request, Blob, FormData, AbortSignal, Event,
    location: { hash: '#local-pair=' + pair, pathname: '/', search: '' }, history: { replaceState() {} },
    sessionStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    NOVAFLOW_WEB_CONFIG: { localAssistant: true, localOrigin: 'http://127.0.0.1:4784', controlUrl: 'https://control.test' },
    fetch: async (url, init) => { requests.push({ url: String(url), init }); return new Response(JSON.stringify(String(url).endsWith('/status') ? { ok: true, enabled: true } : { ok: true, data: { positivePrompt: 'from the machine' } })); }
  });
  runInContext(source, createContext(local));
  const forwarded = await local.electronAPI.promptAssistantOptimizePrompt({ prompt: 'hello', surface: 'art' });
  equal(forwarded.data.positivePrompt, 'from the machine', 'the desktop bridge shape passes through untouched');
  equal(requests.at(-1).url, 'http://127.0.0.1:4784/local/prompt-assistant/optimize-prompt');
  equal(requests.at(-1).init.headers['x-novaflow-local'], pair, 'the page sends its pairing key');
  equal(JSON.parse(requests.at(-1).init.body).surface, 'art');
  await local.electronAPI.promptAssistantReverseImagePrompt({ images: [] });
  equal(requests.at(-1).url, 'http://127.0.0.1:4784/local/prompt-assistant/reverse-image-prompt');
  await local.electronAPI.promptAssistantDescribeArtStyle({ dataUrl: 'data:image/png;base64,QQ==' });
  equal(requests.at(-1).url, 'http://127.0.0.1:4784/local/prompt-assistant/describe-art-style');
  equal((await local.electronAPI.promptAssistantGetStatus()).enabled, true, 'status comes from the machine');
  equal(requests.at(-1).url, 'http://127.0.0.1:4784/local/prompt-assistant/status');
  local.fetch = async () => { throw new Error('assistant closed'); };
  equal((await local.electronAPI.promptAssistantOptimizePrompt({ prompt: 'x' })).error, 'assistant closed', 'a lost machine answers ok:false rather than throwing');

  const cloud = createDomSandbox({ Response, Request, Blob, FormData, AbortSignal, Event,
    NOVAFLOW_WEB_CONFIG: { controlUrl: 'https://control.test' },
    fetch: async (url, init) => { requests.push({ url: String(url), init }); return new Response('{}'); }
  });
  runInContext(source, createContext(cloud));
  const before = requests.length;
  const refused = await cloud.electronAPI.promptAssistantOptimizePrompt({ prompt: 'hello' });
  check(refused.ok === false && refused.error === '提示词助手在 Web 版通过智能 AI 提供', 'the hosted site still says where the assistant is');
  equal(requests.length, before, 'the hosted site sends nothing anywhere');
  equal(cloud.electronAPI.promptAssistantDescribeArtStyle, undefined, 'the hosted site does not offer the style describer');
} finally {
  await assistant.stop(); comfy.closeAllConnections(); comfy.close();
}
console.log(checks + ' passed, 0 failed: 提示词助手 runs the desktop service on the paired local machine');
