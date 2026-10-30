// 提示词助手 on the machine 启动NovaFlow opened the browser from: the assistant
// starts the desktop's service script, hands the GPU over from ComfyUI first,
// stops the script afterwards, and the page reaches it only through the paired
// local server. The hosted site keeps refusing, since no machine stands behind it.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { createLocalAssistant } from '../../worker/src/local-assistant.mjs';
import { createPromptAssistant, isReverseCacheDir, normalizeOptimizeRequest, normalizeReverseRequest, CACHE_DIR, MODEL_DIR, MODEL_MISSING_ERROR } from '../../worker/src/prompt-assistant.mjs';
import { createWorker } from '../../worker/src/worker-core.mjs';
import { inspectModel } from '../../worker/src/models/model-manager.mjs';
import { findModel } from '../../packages/shared/src/model-manifest.mjs';
import { PROMPT_ASSISTANT_MODEL_ID } from '../../packages/shared/src/protocol.mjs';
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

// The two folders the Qwen3-VL model comes in, shaped as the script writes and reads them.
const writeJson = (path, value) => writeFile(path, JSON.stringify(value));
async function writeModelFolder(dir) {
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, 'config.json'), { architectures: ['Qwen3VLForConditionalGeneration'] });
  await writeJson(join(dir, 'tokenizer_config.json'), {});
  await writeJson(join(dir, 'preprocessor_config.json'), {});
  const shards = ['model-00001-of-00002.safetensors', 'model-00002-of-00002.safetensors'];
  await writeJson(join(dir, 'model.safetensors.index.json'), { metadata: { note: 'x'.repeat(12000) }, weight_map: { a: shards[0], b: shards[1] } });
  for (const shard of shards) await writeFile(join(dir, shard), 'not really weights');
}
async function writeCacheFolder(dir) {
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, 'novaflow_nf4_cache.json'), { schema: 'nf.qwen3-vl.bnb-nf4-cache.v1', quantization: { method: 'bitsandbytes', bits: 4, quantType: 'nf4' }, runtimeVersions: { torch: 'fixture' } });
  await writeJson(join(dir, 'config.json'), { architectures: ['Qwen3VLForConditionalGeneration'], quantization_config: { quant_method: 'bitsandbytes' } });
  await writeJson(join(dir, 'tokenizer.json'), {});
  await writeJson(join(dir, 'tokenizer_config.json'), {});
  await writeJson(join(dir, 'processor_config.json'), {});
  await writeFile(join(dir, 'chat_template.jinja'), '{{ messages }}');
  await writeJson(join(dir, 'model.safetensors.index.json'), { weight_map: { a: 'model-00001-of-00001.safetensors' } });
  await writeFile(join(dir, 'model-00001-of-00001.safetensors'), 'not really weights');
}

// The runtime layout the desktop reads: runtime.json names where the models are.
// This machine has only the NF4 cache, the one folder a new install needs.
const dataDir = await mkdtemp(join(tmpdir(), 'novaflow-prompt-assistant-test-'));
const runtimeDir = join(dataDir, 'AI-Runtime'); await mkdir(join(runtimeDir, 'engine', 'ComfyUI'), { recursive: true });
const modelsDir = join(dataDir, 'models');
const cacheDir = join(modelsDir, 'prompt_assistant', 'cache', CACHE_DIR);
await writeCacheFolder(cacheDir);
const runtimeJsonPath = join(runtimeDir, 'runtime.json');
await writeFile(runtimeJsonPath, '﻿' + JSON.stringify({ installPath: runtimeDir, modelsPath: modelsDir, port: 8188 }));
const webRoot = join(dataDir, 'web'); await mkdir(webRoot); await writeFile(join(webRoot, 'index.html'), '<html><head></head><body>NovaFlow</body></html>');
const workflowDir = join(dataDir, 'workflows'); await mkdir(workflowDir);
const license = { state: async () => ({ status: 'licensed', machineId: 'fixture' }), assertAllowed: async () => {}, importLicense: async () => { throw new Error('fixture'); } };
const services = { start: async () => [{ kind: 'image', running: true, reused: true }], stop: async () => {} };
const promptAssistantOptions = { analysisBackend: 'legacy-nf4', pythonPath: process.execPath, serviceScript: fixture, runtimeJsonPath };
{
  const blocked = createPromptAssistant(promptAssistantOptions);
  equal(blocked.status().analysisBackend, 'strata', 'production ignores an explicit legacy backend');
  const missed = await blocked.optimizePrompt({ prompt: 'hello', surface: 'art' });
  equal(missed.ok, false);
  equal(missed.errorCode, 'flash-model-missing', 'a missing Flash model does not start the Python service');
  check(blocked.running !== true, 'prompt-assistant-service.py stays down');
  await blocked.stop();
}
const previousLegacyFlag = process.env.NOVAFLOW_LEGACY_PROMPT_ASSISTANT;
process.env.NOVAFLOW_LEGACY_PROMPT_ASSISTANT = '1';
const assistant = await createLocalAssistant({ dataDir, configPath: join(dataDir, 'identity.json'), workflowDir, webRoot, modelsRoot: modelsDir,
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
  check(status.ok === true && status.enabled === true && status.runtimeStatus === '模型可用', 'the NF4 cache folder alone makes the assistant available');
  equal(status.modelType, 'qwen3_vl_8b_abliterated_nf4', 'status names the Qwen3-VL model');
  check(status.cacheReady === true && status.cachePath === cacheDir && status.modelFolderReady === false, 'status names the cache it found and the raw folder it did not need');
  equal(assistant.getState().models.find(m => m.model_id === PROMPT_ASSISTANT_MODEL_ID)?.status, 'ready', 'the node reports 提示词助手 ready from the cache alone');
  check(!assistant.promptAssistant.running, 'the script is not started until asked');

  const optimize = await call('POST', '/local/prompt-assistant/optimize-prompt', { prompt: 'hello', surface: 'art', purpose: 'optimize', provider: 'gpt', requirements: 'more light' });
  equal(optimize.status, 200);
  check(optimize.body.ok === true && optimize.body.data.positivePrompt === 'optimized: hello' && optimize.body.data.negativePrompt === 'blurry', 'optimize answers with the script data');
  equal(optimize.body.runtimeStatus, '模型可用');
  equal(optimize.body.data.echo.provider, 'local', 'a browser cannot pick a cloud provider on this machine');
  equal(optimize.body.data.echo.currentPrompt, 'hello', 'currentPrompt defaults to the prompt as on desktop');
  equal(optimize.body.data.echo.cachePath, cacheDir, 'the script gets the NF4 cache path in its environment');
  equal(optimize.body.data.echo.modelPath, join(modelsDir, 'prompt_assistant', MODEL_DIR), 'and where the raw folder would be');
  equal(optimize.body.data.echo.legacyModelPath, null, 'the retired Qwen2.5 file is no longer passed');
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
  const small = [{ name: 'a.png', dataUrl: 'data:image/png;base64,QQ==' }];
  const artReverse = (await call('POST', '/local/prompt-assistant/reverse-image-prompt', { purpose: 'art-reverse', surface: 'art', images: small })).body;
  check(artReverse.ok === true && artReverse.data.purpose === 'art-reverse', 'every reverse mode runs on the one Qwen3 model, not only the static one');
  for (const surface of ['art', 'ui-design']) {
    const multi = (await call('POST', '/local/prompt-assistant/reverse-image-prompt', { purpose: surface === 'art' ? 'roleReference' : 'ui-design-reference', surface, images: Array.from({length:16}, (_, i) => ({...small[0], name:`reference_${i + 1}.png`})) })).body;
    check(multi.ok === true && multi.data.images === 16, surface + ': all sixteen references reach the Python transport');
  }
  const h3Reverse = (await call('POST', '/local/prompt-assistant/reverse-image-prompt', { purpose: 'minimax-h3-i2v-reverse', visualSchema: 'nf.h3.visual.v1', userPrompt: '', userRequirements: '', images: small })).body;
  check(h3Reverse.ok === true && h3Reverse.data.purpose === 'minimax-h3-i2v-reverse', 'H3 reverse needs no second model either');
  equal((await call('POST', '/local/bind-account', { token: 'x'.repeat(300000) })).status, 413, 'other local routes keep their small limit');
  const invalid = (await call('POST', '/local/prompt-assistant/reverse-image-prompt', { purpose: 'minimax-h3-i2v-reverse', images: [{ dataUrl }] })).body;
  check(invalid.ok === false && invalid.errorCode === 'invalid-request' && /nf\.h3\.visual\.v1/.test(invalid.error), 'the desktop request contract is enforced');
  const style = (await call('POST', '/local/prompt-assistant/describe-art-style', { name: 'scene.png', dataUrl: 'data:image/png;base64,QQ==' })).body;
  check(style.ok === true && style.style === 'flat vector', '万物迁移 gets the scene style');
  const material = (await call('POST', '/local/prompt-assistant/describe-art-style', { name: 'reference.jpg', dataUrl: 'data:image/jpeg;base64,QQ==', purpose: 'aifx-material' })).body;
  check(material.ok === true && material.material?.material === 'made of petals. NO METAL.' && material.material?.name === 'GLOWING PETAL' && material.style === undefined,
    'AI 特效 gets its 参考图 back as a material entry through the same call');
  check(material.material?.elements === 'made of petals.' && material.material?.colours === 'yellow, red',
    'the elements and colours come through apart, so 提示词补充 can overrule the arrangement and the colour');
  const translated = (await call('POST', '/local/prompt-assistant/describe-art-style', { purpose: 'aifx-supplement', supplement: '多点彩带飘落' })).body;
  check(translated.ok === true && translated.supplement === 'Multiple multicolored ribbons falling' && translated.style === undefined,
    'AI 特效 has its 提示词补充 translated through the same call, with no picture');
  const empty = (await call('POST', '/local/prompt-assistant/describe-art-style', { purpose: 'aifx-supplement', supplement: '  ' })).body;
  check(empty.ok === false && empty.errorCode === 'invalid-request', 'an empty 提示词补充 is refused before the model');
  equal((await call('POST', '/local/prompt-assistant/nope', {})).status, 404);

  // -- payload shaping matches the desktop handler ---------------------------
  const shaped = normalizeOptimizeRequest({ surface: 'art', purpose: 'optimize', currentPrompt: 'a cat', promptSchema: 'nf.art.prompt.v1', promptDetailMode: 'simple-structured-v1', requirements: 'x'.repeat(5000) });
  check(shaped.request.promptSchema === 'nf.art.prompt.v1' && shaped.request.promptDetailMode === 'simple-structured-v1' && shaped.request.requirements.length === 2000 && shaped.timeoutMs === 300000, 'structured art prompts keep their schema and limits');
  const patch = normalizeOptimizeRequest({ purpose: 'optimize', currentPrompt: 'a cat' });
  check(patch.request.promptSchema === undefined && patch.timeoutMs === 900000, 'a plain rewrite gets the desktop\'s long budget');
  const modelEdit=normalizeOptimizeRequest({surface:'art',purpose:'optimize',targetEngine:'qwen-2.1',qwenPromptMode:'img2img',currentPrompt:'只改变球的颜色'}).request;
  check(modelEdit.targetEngine==='qwen-2.1' && modelEdit.qwenPromptMode==='img2img','ordinary Qwen editing retains model-specific rewriting rules through the original service');
  check(!('qwenPromptMode' in normalizeOptimizeRequest({surface:'animation',purpose:'optimize',targetEngine:'qwen-2.1',qwenPromptMode:'img2img'}).request),'image rewriting rules do not cross into video');
  assert.throws(() => normalizeOptimizeRequest({ purpose: 'minimax-h3-prompt-enhance', h3ReferenceFrames: [{ label: '<Picture 1>', dataUrl: 'data:image/png;base64,QQ==' }] }), /H3 参考画面与素材不匹配/); checks++;
  // An H3 requirement carries the whole source prompt first and the user's own request last.
  const longH3 = normalizeOptimizeRequest({ purpose: 'minimax-h3-prompt-enhance', requirements: 'x'.repeat(30000) + '\n用户修改要求：镜头慢慢推近' });
  check(longH3.request.requirements.endsWith('用户修改要求：镜头慢慢推近'), 'a long H3 requirement keeps the user request at its end');
  equal(normalizeOptimizeRequest({ purpose: 'minimax-h3-prompt-enhance', requirements: 'x'.repeat(60000) }).request.requirements.length, 48000, 'the H3 cap is the script\'s own 48000');
  // H3 优化提示词 carries the content policy the way reverse does. The script checks only sensitiveVisualAnalysis=true
  // (the AI 助手 dialog); a generation compile sends false and an old dialog none, and both run as before.
  const policed = normalizeOptimizeRequest({ purpose: 'minimax-h3-prompt-enhance', contentPolicy: { sensitiveVisualAnalysis: true, extra: 1 } }).request.contentPolicy;
  check(policed.sensitiveVisualAnalysis === true && policed.allSubjectsConfirmedAdult === false && !('extra' in policed), 'H3 optimize forwards only the two policy switches');
  check(!('contentPolicy' in normalizeOptimizeRequest({ purpose: 'minimax-h3-prompt-enhance' }).request) && !('contentPolicy' in normalizeOptimizeRequest({ purpose: 'optimize', contentPolicy: {} }).request), 'no policy is invented, and art never gets one');
  const compilePolicy = normalizeOptimizeRequest({ purpose: 'minimax-h3-prompt-enhance', requirements: 'H3 compile: translate-only\nSource prompt:\nx', contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false } }).request.contentPolicy;
  check(compilePolicy.sensitiveVisualAnalysis === false, 'a generation compile keeps its policy false, so the script does not check it');
  // 美工 反推: prompt box and 补充要求 together stay within 2000, the 补充要求 whole.
  // The renderer's role reference string: 用户生成要求：用户提示词：…\n用户补充要求：…
  const artText = '用户生成要求：用户提示词：' + '猫'.repeat(2500) + '\n用户补充要求：画面改为夜晚';
  const artReverse2000 = normalizeReverseRequest({ purpose: 'roleReference', requirements: artText }).request.requirements;
  check(artReverse2000.length === 2000 && artReverse2000.startsWith('用户生成要求：用户提示词：猫') && artReverse2000.endsWith('\n用户补充要求：画面改为夜晚'), 'a long prompt box is cut, never the 补充要求');
  equal(normalizeReverseRequest({ purpose: 'static-image-reverse', requirements: 'x'.repeat(3000) }).request.requirements.length, 2000, 'other text keeps the plain 2000 cap');
  const shortArt = '用户提示词：一只橘猫\n用户补充要求：画面改为夜晚';
  equal(normalizeReverseRequest({ purpose: 'static-image-reverse', requirements: shortArt }).request.requirements, shortArt, 'a short request is passed whole');

  // -- without the model the answer says so; another instance holding it too --
  const bare = createPromptAssistant({ ...promptAssistantOptions, runtimeJsonPath: join(dataDir, 'missing.json'), comfyUrls: [] });
  check(bare.status().enabled === false && bare.status().runtimeStatus === '未配置模型' && bare.status().error === MODEL_MISSING_ERROR, 'no runtime.json means no model');
  check(/千问 3 提示词模型/.test(MODEL_MISSING_ERROR) && MODEL_MISSING_ERROR.includes(CACHE_DIR) && MODEL_MISSING_ERROR.includes(MODEL_DIR), 'the missing-model answer names both folders');
  check((await bare.optimizePrompt({ prompt: 'x' })).ok === false, 'nothing is started without a model');

  // -- which folders make the model: the NF4 cache or the raw folder, never the Qwen2.5 file --
  const layouts = [
    { name: 'cache-only', cache: true, enabled: true },
    { name: 'raw-only', raw: true, enabled: true },
    { name: 'neither', enabled: false },
    { name: 'qwen25-only', qwen25: true, enabled: false },
    { name: 'qwen25-and-cache', qwen25: true, cache: true, enabled: true },
    { name: 'cache-marked-invalid', cache: true, invalid: true, enabled: false }
  ];
  for (const layout of layouts) {
    const root = join(dataDir, 'layout-' + layout.name), models = join(root, 'models');
    await mkdir(models, { recursive: true });
    if (layout.raw) await writeModelFolder(join(models, 'prompt_assistant', MODEL_DIR));
    if (layout.cache) await writeCacheFolder(join(models, 'prompt_assistant', 'cache', CACHE_DIR));
    if (layout.invalid) await writeJson(join(models, 'prompt_assistant', 'cache', CACHE_DIR, '.novaflow-cache-invalid.json'), { errorCode: 'fixture' });
    if (layout.qwen25) {
      await mkdir(join(models, 'text_encoders'), { recursive: true });
      await writeFile(join(models, 'text_encoders', 'qwen_2.5_vl_7b_fp8_scaled.safetensors'), 'x'.repeat(1000));
    }
    await writeJson(join(root, 'runtime.json'), { installPath: root, modelsPath: models });
    const local = createPromptAssistant({ ...promptAssistantOptions, runtimeJsonPath: join(root, 'runtime.json'), comfyUrls: [] });
    const state = local.status();
    equal(state.enabled, layout.enabled, layout.name + ': the assistant is ' + (layout.enabled ? 'on' : 'off'));
    equal(state.runtimeStatus, layout.enabled ? '模型可用' : '未配置模型', layout.name + ': runtime status');
    equal(state.error, layout.enabled ? '' : MODEL_MISSING_ERROR, layout.name + ': error');
    if (layout.enabled) {
      // Every command, including the ones that used to need the Qwen2.5 file.
      check((await local.optimizePrompt({ prompt: 'x', purpose: 'optimize' })).ok === true, layout.name + ': optimize runs');
      check((await local.reverseImagePrompt({ purpose: 'art-reverse', images: small })).ok === true, layout.name + ': reverse runs');
      check((await local.describeArtStyle({ dataUrl: small[0].dataUrl })).ok === true, layout.name + ': style runs');
    } else {
      const refused = await local.reverseImagePrompt({ purpose: 'art-reverse', images: small });
      check(refused.ok === false && refused.error === MODEL_MISSING_ERROR && !/Qwen2\.5/.test(refused.error), layout.name + ': a request says which model is missing');
      check(!local.running, layout.name + ': nothing was started');
    }
    // Pool readiness: the manifest's own disk check, and what the node reports.
    const disk = await inspectModel(models, findModel(PROMPT_ASSISTANT_MODEL_ID));
    equal(disk.status, 'missing', layout.name + ': the production manifest no longer advertises NF4 weights');
    const node = createWorker({ dataDir: root, configPath: join(root, 'identity.json'), modelsRoot: models, tunnel: false, promptAssistant: local, logger: () => {} });
    const reported = (await node.reportModels()).find(m => m.model_id === PROMPT_ASSISTANT_MODEL_ID);
    equal(reported.status, layout.enabled ? 'ready' : 'missing', layout.name + ': the node advertises 提示词助手 only when the assistant can run');
    equal(reported.detail.prompt_assistant.enabled, layout.enabled, layout.name + ': the report says why');
  }
  check(!isReverseCacheDir(join(dataDir, 'layout-neither', 'models', 'prompt_assistant', 'cache', CACHE_DIR)), 'a missing cache folder is no cache');
  const partial = join(dataDir, 'partial-cache'); await writeCacheFolder(partial);
  await writeJson(join(partial, 'model.safetensors.index.json'), { weight_map: { a: 'model-00001-of-00002.safetensors', b: 'model-00002-of-00002.safetensors' } });
  check(!isReverseCacheDir(partial), 'a cache with a shard missing is no cache');
  const unquantized = join(dataDir, 'unquantized-cache'); await writeCacheFolder(unquantized);
  await writeJson(join(unquantized, 'config.json'), { architectures: ['Qwen3VLForConditionalGeneration'] });
  check(!isReverseCacheDir(unquantized), 'a folder that is not NF4-quantized is no cache');
  const templated = join(dataDir, 'template-in-tokenizer'); await writeCacheFolder(templated);
  await rm(join(templated, 'chat_template.jinja'));
  check(!isReverseCacheDir(templated), 'a cache without a chat template is no cache');
  await writeJson(join(templated, 'tokenizer_config.json'), { chat_template: '{{ messages }}' });
  check(isReverseCacheDir(templated), 'the chat template may live in tokenizer_config.json');
  // A machine with only the raw model folder: the script reports the missing NF4 copy once,
  // the assistant builds it and retries, and later requests find it on disk.
  const cacheMarker = join(dataDir, 'nf4-cache-built.txt');
  const rawOnly = createPromptAssistant({ ...promptAssistantOptions, comfyUrls: [], env: { FAKE_PROMPT_ASSISTANT_CACHE_MARKER: cacheMarker } });
  const firstOptimize = await rawOnly.optimizePrompt({ prompt: 'raw only' });
  check(firstOptimize.ok === true && firstOptimize.data.positivePrompt === 'optimized: raw only', 'a missing NF4 copy is built once and the optimize request retried');
  equal(firstOptimize.data.echo.requireCache, '1', 'the script is told to report a missing NF4 copy instead of quantizing every time');
  check((await readFile(cacheMarker, 'utf8')) === 'built', 'the NF4 copy was prepared on disk');
  const styleAfterBuild = await rawOnly.describeArtStyle({ dataUrl: 'data:image/png;base64,QQ==' });
  check(styleAfterBuild.ok === true && styleAfterBuild.style === 'flat vector', '画风提取 runs straight away once the copy exists');
  await rm(cacheMarker);
  const reverseRetried = await rawOnly.reverseImagePrompt({ images: [{ name: 'a.png', dataUrl: 'data:image/png;base64,QQ==' }], purpose: 'roleReference' });
  check(reverseRetried.ok === true && reverseRetried.data.prompt === 'a cat on a mat', 'every reverse purpose, not only static reverse, prepares and retries');
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
  // -- the hosted site asks the pool: a node with the model answers as a task --
  const before = requests.length;
  const refused = await cloud.electronAPI.promptAssistantOptimizePrompt({ prompt: 'hello' });
  check(refused.ok === false && refused.error.startsWith('提示词助手在 Web 版通过智能 AI 提供'), 'an empty pool still says where the assistant is');
  equal(requests.length, before + 1, 'the hosted site asked the pool once');
  equal(requests.at(-1).url, 'https://control.test/api/web/capabilities');
  equal(typeof cloud.electronAPI.promptAssistantDescribeArtStyle, 'function', 'the hosted site offers the style describer through the pool');

  const poolRequests = [];
  let poolPolls = 0;
  const pool = createDomSandbox({ Response, Request, Blob, FormData, AbortSignal, Event, TextEncoder, TextDecoder,
    NOVAFLOW_WEB_CONFIG: { controlUrl: 'https://control.test' },
    fetch: async (url, init) => {
      const u = String(url); poolRequests.push({ url: u, init });
      const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (u.endsWith('/api/web/capabilities')) return reply({ ok: true, taskTypes: [{ task_type: 'prompt_assistant', available_workers: 1 }] });
      if (u.endsWith('/api/web/tasks') && init.method === 'POST') return reply({ task: { id: 'pa-1', status: 'queued' } });
      if (u.endsWith('/api/web/tasks/pa-1/grant')) return reply({ grant: { endpoint: 'https://node.test', token: 'g-1', expiresAt: new Date(Date.now() + 600000).toISOString() } });
      if (u.endsWith('/api/web/tasks/pa-1')) { poolPolls += 1; return reply({ task: { id: 'pa-1', status: poolPolls < 2 ? 'assigned' : 'completed', assigned_worker_id: 'w-1' } }); }
      if (u.startsWith('https://node.test/gw/tasks/pa-1/input/request.json')) return reply({ ok: true });
      if (u.startsWith('https://node.test/gw/tasks/pa-1/output/result.json')) return reply({ ok: true, data: { positivePrompt: 'from the pool' } });
      return reply({ error: 'unexpected ' + u }, 404);
    }
  });
  pool.localStorage.setItem('novaflow_web_session_v1', JSON.stringify({ token: 'cloud-session' }));
  runInContext(source, createContext(pool));
  const pooled = await pool.electronAPI.promptAssistantOptimizePrompt({ prompt: 'hello', surface: 'art' });
  equal(pooled.data.positivePrompt, 'from the pool', 'the node reply comes back in the desktop bridge shape');
  const created = poolRequests.find(r => r.url.endsWith('/api/web/tasks') && r.init.method === 'POST');
  const createdBody = JSON.parse(created.init.body);
  equal(createdBody.task_type, 'prompt_assistant');
  equal(createdBody.parameters.action, 'optimize-prompt');
  equal(createdBody.references[0].name, 'request.json');
  const upload = poolRequests.find(r => r.url.startsWith('https://node.test/gw/tasks/pa-1/input/request.json'));
  equal(upload.init.method, 'PUT');
  equal(upload.init.headers['x-novaflow-grant'], 'g-1', 'the request travels to the node under a grant');
  equal(JSON.parse(new TextDecoder().decode(upload.init.body)).surface, 'art', 'the whole payload is the uploaded request');
  await pool.electronAPI.promptAssistantReverseImagePrompt({ images: [{ name: 'a.png', dataUrl: 'data:image/png;base64,QQ==' }] });
  equal(JSON.parse(poolRequests.filter(r => r.url.endsWith('/api/web/tasks') && r.init.method === 'POST').at(-1).init.body).parameters.action, 'reverse-image-prompt');
} finally {
  if (previousLegacyFlag === undefined) delete process.env.NOVAFLOW_LEGACY_PROMPT_ASSISTANT; else process.env.NOVAFLOW_LEGACY_PROMPT_ASSISTANT = previousLegacyFlag;
  await assistant.stop(); comfy.closeAllConnections(); comfy.close();
}
console.log(checks + ' passed, 0 failed: 提示词助手 runs the desktop service on the paired local machine');
