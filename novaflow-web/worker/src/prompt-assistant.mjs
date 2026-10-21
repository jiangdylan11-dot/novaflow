// 提示词助手 on the compute machine.
//
// The desktop client starts prompt-assistant-service.py beside ComfyUI's own
// Python and talks to it over stdin/stdout, one JSON line per request. The
// browser opened by 启动NovaFlow reaches the same script through the local
// server here, so 本地模型 in 智能 AI means this machine's Qwen3-VL 8B instead
// of a refusal.
//
// Every command runs on that one model. It is here when its NF4 cache folder
// is (what the script loads), or its raw folder is (what that cache is built
// from); either one is enough.
//
// The model shares the GPU with the drawing runtime, so a request follows the
// desktop's order: refuse while a task runs, ask ComfyUI to unload, run the
// script, then stop it again so the next 绘图 has its memory back.
import { spawn } from 'node:child_process';
import { planUiCatalog, cpuCatalog } from './ui-catalog-planner.mjs';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL_TYPE = 'qwen3_vl_8b_abliterated_nf4';
export const MODEL_DIR = 'Huihui-Qwen3-VL-8B-Instruct-Abliterated';
export const CACHE_DIR = MODEL_DIR + '-novaflow-bnb-nf4-v1';
// The cache folder's own marks, as prompt_assistant/qwen3_vl_adapter.py writes them.
const CACHE_MANIFEST = 'novaflow_nf4_cache.json';
const CACHE_SCHEMA = 'nf.qwen3-vl.bnb-nf4-cache.v1';
const CACHE_INVALID_MARKER = '.novaflow-cache-invalid.json';
export const MODEL_MISSING_ERROR = '未配置千问 3 提示词模型：请把 NF4 缓存文件夹放到模型目录的 prompt_assistant\\cache\\' + CACHE_DIR
  + '，或把原始模型文件夹放到 prompt_assistant\\' + MODEL_DIR;
const H3_REVERSE_PURPOSES = ['minimax-h3-i2v-reverse', 'minimax-h3-fl2v-reverse'];
const START_TIMEOUT_MS = 12000;
const STOP_TIMEOUT_MS = 5000;

function runtimeJsonDefault() {
  return join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow', 'AI-Runtime', 'runtime.json');
}

/** The script that does the inference, shipped with the desktop client and copied beside this app. */
export function serviceScriptPath() {
  const candidates = [
    join(process.resourcesPath || '', 'desktop-license', 'prompt-assistant-service.py'),
    fileURLToPath(new URL('../../../particle-editor-desktop/prompt-assistant-service.py', import.meta.url))
  ];
  return candidates.find(path => path && existsSync(path)) || candidates[0];
}

function readRuntime(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    return { installPath: resolve(String(data.installPath || dirname(path))), modelsPath: String(data.modelsPath || '').trim() };
  } catch {
    return { installPath: dirname(path), modelsPath: '' };
  }
}

function isFile(path) { try { return Boolean(path) && statSync(path).isFile(); } catch { return false; } }
function isDir(path) { try { return Boolean(path) && statSync(path).isDirectory(); } catch { return false; } }
const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const isQwen3Config = config => Array.isArray(config?.architectures) && config.architectures.includes('Qwen3VLForConditionalGeneration');

/** model.safetensors, or every shard model.safetensors.index.json names, inside the folder. */
function hasWeights(folder) {
  if (existsSync(join(folder, 'model.safetensors'))) return true;
  const indexPath = join(folder, 'model.safetensors.index.json');
  if (!existsSync(indexPath)) return false;
  const shards = Array.from(new Set(Object.values(readJson(indexPath)?.weight_map || {}))).map(name => String(name || '').trim()).filter(Boolean);
  return shards.length > 0 && shards.every(name => {
    const full = resolve(folder, name);
    const rel = relative(resolve(folder), full);
    return rel && !rel.startsWith('..') && !isAbsolute(rel) && isFile(full);
  });
}

/** The raw Huihui-Qwen3-VL-8B folder: what the NF4 cache is built from. */
function isReverseModelDir(candidate) {
  try {
    if (!isDir(candidate)) return false;
    for (const name of ['config.json', 'tokenizer_config.json', 'preprocessor_config.json']) {
      if (!existsSync(join(candidate, name))) return false;
    }
    return isQwen3Config(readJson(join(candidate, 'config.json'))) && hasWeights(candidate);
  } catch {
    return false;
  }
}

/**
 * The NF4 cache folder the script loads the model from. The structure only:
 * whether it still matches this machine's torch / transformers / bitsandbytes
 * is the script's call when it loads it.
 */
export function isReverseCacheDir(candidate) {
  try {
    if (!isDir(candidate) || existsSync(join(candidate, CACHE_INVALID_MARKER))) return false;
    if (readJson(join(candidate, CACHE_MANIFEST))?.schema !== CACHE_SCHEMA) return false;
    const config = readJson(join(candidate, 'config.json'));
    if (!isQwen3Config(config) || config?.quantization_config?.quant_method !== 'bitsandbytes') return false;
    const has = name => isFile(join(candidate, name));
    if (!has('tokenizer.json') && !has('tokenizer_config.json')) return false;
    if (!has('processor_config.json') && !has('preprocessor_config.json')) return false;
    if (!has('chat_template.jinja') && !(has('tokenizer_config.json') && readJson(join(candidate, 'tokenizer_config.json'))?.chat_template)) return false;
    return hasWeights(candidate);
  } catch {
    return false;
  }
}

function sanitizeFileName(value, fallback = 'image.png') {
  const name = String(value || '').replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, '_').trim().slice(0, 120);
  return name && name !== '.' && name !== '..' ? name : fallback;
}

function failureMetadata(value) {
  const direct = value && typeof value === 'object' ? value : {};
  const nested = direct.failure && typeof direct.failure === 'object' ? direct.failure : {};
  const source = { ...direct, ...nested };
  const clean = (field, max) => String(source[field] || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const metadata = {};
  for (const [field, max] of [['errorCode', 80], ['message', 240], ['reverseProvider', 120], ['providerFailureCode', 80], ['requestedVisualSchema', 40], ['failureCategory', 48], ['failureClass', 80], ['generationGate', 32]]) {
    const text = clean(field, max);
    if (text) metadata[field] = text;
  }
  const leaf = clean('validationLeaf', 80);
  if (['visual-semantics', 'visual-person-count', 'visual-body-exposure', 'visual-age', 'visual-interaction', 'visual-signals', 'visual-fact-classification'].includes(leaf)) metadata.validationLeaf = leaf;
  for (const field of ['retryable', 'retryAttempted', 'legacyFallbackSuppressed', 'sensitivePromptBlocked']) {
    if (typeof source[field] === 'boolean') metadata[field] = source[field];
  }
  if (Number.isFinite(Number(source.retryCount))) metadata.retryCount = Math.max(0, Math.min(2, Math.trunc(Number(source.retryCount))));
  return metadata;
}

function failureCodes(result) {
  const codes = [];
  const push = value => { const code = String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 120); if (code) codes.push(code); };
  const collect = source => {
    if (!source || typeof source !== 'object') return;
    push(source.errorCode); push(source.providerFailureCode); push(source.failureClass);
    if (source.failure && typeof source.failure === 'object') collect(source.failure);
    if (source.data && typeof source.data === 'object') collect(source.data);
  };
  collect(result);
  return codes;
}

const CACHE_PREPARATION_CODES = ['cache-preparation-required', 'cache-invalid-rebuild-required'];
// Some feature paths wrap the adapter error into their own message; the code still shows in the text.
const isCachePreparationFailure = result => failureCodes(result).some(code => CACHE_PREPARATION_CODES.includes(code))
  || (result?.ok === false && CACHE_PREPARATION_CODES.some(code => String(result?.error || '').includes(code)));

// ---------------------------------------------------------------- payloads
// The same limits the desktop's IPC handlers apply before the script sees a
// request; a browser talks to the script only through these.

function h3ReferenceFrames(value, requirements = '') {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 13) throw new Error('H3 参考画面数量无效');
  const labels = new Set((requirements.match(/^Available resource labels:[^\n]*/im)?.[0] || '').match(/<(?:Picture|Video) [1-9]\d*>/g) || []);
  const seen = new Map();
  let bytes = 0;
  return value.map(item => {
    const label = String(item?.label || '');
    const dataUrl = String(item?.dataUrl || '');
    if (!labels.has(label) || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('H3 参考画面与素材不匹配');
    bytes += dataUrl.length;
    if (dataUrl.length > 2500000 || bytes > 16000000) throw new Error('H3 参考画面过大');
    if (label.startsWith('<Picture')) {
      if (seen.has(label)) throw new Error('H3 参考图重复');
      seen.set(label, 0);
      return { label, dataUrl };
    }
    const timeSeconds = Number(item?.timeSeconds);
    const previous = seen.get(label);
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > 15 || (previous != null && timeSeconds <= previous)) throw new Error('H3 参考视频帧时间无效');
    seen.set(label, timeSeconds);
    return { label, dataUrl, timeSeconds };
  });
}

function expectedRect(value) {
  if (!value || typeof value !== 'object') return null;
  const box = ['xNorm', 'yNorm', 'wNorm', 'hNorm'].map(key => Number(value[key]));
  const [x, y, w, h] = box;
  if (!box.every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) return null;
  const round = n => Math.round(n * 10000) / 10000;
  return { xNorm: round(x), yNorm: round(y), wNorm: round(w), hNorm: round(h) };
}

function mandatoryChecklist(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 48).map(item => {
    if (!item || typeof item !== 'object') return null;
    const checklistToken = String(item.checklistToken || '').trim();
    const semanticToken = String(item.semanticToken || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(semanticToken)) return null;
    if (!/^region-[1-9]\d{0,2}:[a-z0-9][a-z0-9-]{0,63}$/.test(checklistToken)) return null;
    if (!checklistToken.endsWith(':' + semanticToken) || seen.has(checklistToken)) return null;
    seen.add(checklistToken);
    const rect = expectedRect(item.expectedRect);
    return {
      checklistToken,
      regionId: String(item.regionId || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120),
      kind: String(item.kind || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '').slice(0, 48),
      semanticToken,
      ...(rect ? { expectedRect: rect } : {})
    };
  }).filter(Boolean);
}

export function normalizeOptimizeRequest(payload = {}) {
  const prompt = String(payload.prompt || '');
  const negativePrompt = String(payload.negativePrompt || '');
  const surface = String(payload.surface || '').trim().slice(0, 80);
  const purpose = String(payload.purpose || '').trim().slice(0, 80);
  const usesUiQwen = surface === 'ui-design' && payload.targetEngine === 'qwen-2.1';
  const usesH3 = purpose.toLowerCase().replace(/_/g, '-') === 'minimax-h3-prompt-enhance';
  // H3 requirements carry the whole source prompt, the labels and then the
  // user's own request last; the script takes up to 48000, so a shorter cut
  // here would drop exactly that request.
  const requirements = String(payload.requirements || '').trim().slice(0, usesH3 ? 48000 : usesUiQwen ? 4000 : 2000);
  const currentPrompt = String(payload.currentPrompt ?? payload.current_prompt ?? prompt).trim().slice(0, 20000);
  const h3Mode = String(payload.h3Mode ?? payload.h3_mode ?? '').trim().slice(0, 80);
  const h3Duration = payload.durationSeconds ?? payload.duration_seconds ?? payload.duration;
  const h3VisualSchema = String(payload.visualSchema ?? payload.visual_schema ?? '').trim().slice(0, 80);
  const requestedSchema = String(payload.promptSchema ?? payload.prompt_schema ?? '').trim();
  const promptSchema = surface === 'art' && purpose === 'optimize' && Boolean(currentPrompt) && requestedSchema === 'nf.art.prompt.v1' ? requestedSchema : '';
  const requestedDetail = String(payload.promptDetailMode ?? payload.prompt_detail_mode ?? '').trim();
  const promptDetailMode = promptSchema === 'nf.art.prompt.v1' && requestedDetail === 'simple-structured-v1'
    && currentPrompt.length <= 120 && !/[\r\n]/u.test(currentPrompt)
    && !/__NOVAFLOW_[A-Z0-9_:-]+__/iu.test(currentPrompt)
    && !/@(?:参考图[1-9][0-9]*|视频参考|声音参考)/u.test(currentPrompt)
    && !/\[[^\]\r\n]{1,32}\]|【[^】\r\n]{1,32}】/u.test(currentPrompt)
    ? requestedDetail : '';
  const ordinaryArtPatch = purpose === 'optimize' && Boolean(currentPrompt) && ['', 'art', 'drawing', 'image'].includes(surface.toLowerCase());
  const policy = payload.contentPolicy && typeof payload.contentPolicy === 'object' && !Array.isArray(payload.contentPolicy) ? payload.contentPolicy : null;
  return {
    timeoutMs: usesH3 || (ordinaryArtPatch && !promptSchema) ? 900000 : 300000,
    request: {
      prompt, negativePrompt,
      supportsNegativePrompt: payload.supportsNegativePrompt !== false,
      nsfw: payload.nsfw === true,
      requirements, surface, purpose, provider: 'local', currentPrompt,
      ...(usesUiQwen ? { targetEngine:'qwen-2.1', supportsNegativePrompt:payload.supportsNegativePrompt !== false, uiDesignIntent:payload.uiDesignIntent, uiPreserveLayout:payload.uiPreserveLayout } : {}),
      ...(usesH3 ? { h3ReferenceFrames: h3ReferenceFrames(payload.h3ReferenceFrames, requirements) } : {}),
      ...(usesH3 && payload.h3Reverse === true ? { h3Reverse: true } : {}),
      ...(usesH3 && h3Mode ? { h3Mode } : {}),
      ...(usesH3 && h3Duration !== undefined && h3Duration !== null && h3Duration !== '' ? { durationSeconds: h3Duration } : {}),
      ...(usesH3 && h3VisualSchema ? { visualSchema: h3VisualSchema } : {}),
      // As for reverse: with a policy the script checks the user's words for minors before writing.
      ...(usesH3 && policy ? { contentPolicy: { sensitiveVisualAnalysis: policy.sensitiveVisualAnalysis === true, allSubjectsConfirmedAdult: policy.allSubjectsConfirmedAdult === true } } : {}),
      ...(promptSchema ? { promptSchema } : {}),
      ...(promptDetailMode ? { promptDetailMode } : {})
    }
  };
}

// 美工 反推 sends '用户提示词：…\n用户补充要求：…'; past the cap the prompt is
// shortened, never the 补充要求 after it.
function keepSupplement(text, cap) {
  if (text.length <= cap) return text;
  const at = text.lastIndexOf('\n用户补充要求');
  const tail = at > 0 ? text.slice(at) : '';
  return tail && tail.length < cap ? text.slice(0, cap - tail.length) + tail : text.slice(0, cap);
}

export function normalizeReverseRequest(payload = {}) {
  const surface = String(payload.surface || '').trim().slice(0, 80);
  const purpose = String(payload.purpose || '').trim().slice(0, 80);
  const normalizedPurpose = purpose.toLowerCase().replace(/_/g, '-');
  const usesUiQwen = surface === 'ui-design' && payload.targetEngine === 'qwen-2.1';
  const usesH3 = H3_REVERSE_PURPOSES.includes(normalizedPurpose);
  const requirements = usesH3 ? String(payload.requirements || '').trim().slice(0, 12000) : keepSupplement(String(payload.requirements || '').trim(), usesUiQwen ? 4000 : 2000);
  const currentPrompt = String(payload.currentPrompt ?? payload.current_prompt ?? payload.prompt ?? '').trim().slice(0, 20000);
  const language = String(payload.preferredOutputLanguage || '').trim().toLowerCase();
  const preferredOutputLanguage = usesH3 ? (language === 'en' ? 'en' : language === 'zh-cn' ? 'zh-CN' : '') : '';
  const checklist = mandatoryChecklist(payload.mandatoryChecklist);
  const images = Array.isArray(payload.images) ? payload.images.map((item, index) => ({
    name: sanitizeFileName(item?.name, 'reference_' + (index + 1) + '.png'),
    slotType: String(item?.slotType || item?.role || '').slice(0, 80),
    role: String(item?.role || item?.slotType || '').slice(0, 80),
    label: String(item?.label || '').slice(0, 80),
    dataUrl: String(item?.dataUrl || '')
  })).filter(item => item.dataUrl) : [];
  if (Array.isArray(payload.images) && images.length !== payload.images.length) throw new Error('参考图数据无效，本次未截断提交');
  const visualSchema = String(payload.visualSchema || '').trim().slice(0, 80);
  if (usesH3 && visualSchema !== 'nf.h3.visual.v1') throw new Error('MiniMax H3 reverse requires visualSchema nf.h3.visual.v1');
  if (usesH3 && (typeof payload.userPrompt !== 'string' || typeof payload.userRequirements !== 'string')) throw new Error('MiniMax H3 reverse requires explicit userPrompt and userRequirements fields');
  const policy = payload.contentPolicy && typeof payload.contentPolicy === 'object' ? payload.contentPolicy : {};
  const usesUiSplit = purpose === 'ui-layer-proposal' && surface === 'ui-design';
  if (usesUiSplit && (images.length !== 1 || visualSchema !== 'nf.ui.split.v1')) throw new Error('UI 拆图需一张原图及有效识别协议');
  const usesVisualV2 = purpose === 'static-image-reverse' && images.length === 1 && visualSchema === 'nf.visual.v2';
  return {
    usesVisualV2,
    timeoutMs: usesH3 ? 180000 * Math.max(1, images.length) : 300000,
    request: {
      images, requirements, surface, purpose, provider: 'local', currentPrompt,
      ...(usesUiQwen ? { targetEngine:'qwen-2.1', supportsNegativePrompt:payload.supportsNegativePrompt !== false, uiDesignIntent:payload.uiDesignIntent, uiPreserveLayout:payload.uiPreserveLayout } : {}),
      ...(usesH3 ? { userPrompt: payload.userPrompt.trim().slice(0, 20000), userRequirements: payload.userRequirements.trim().slice(0, 12000), h3Mode: payload.h3Mode, durationSeconds: payload.durationSeconds } : {}),
      ...(preferredOutputLanguage ? { preferredOutputLanguage } : {}),
      mandatoryChecklist: checklist,
      mandatoryChecklistTokens: checklist.map(item => item.checklistToken),
      ...(usesH3 ? { visualSchema, contentPolicy: { sensitiveVisualAnalysis: policy.sensitiveVisualAnalysis === true, allSubjectsConfirmedAdult: policy.allSubjectsConfirmedAdult === true } } : {}),
      ...(usesVisualV2 ? { visualSchema, nsfw: payload.nsfw === true } : {}),
      ...(usesUiSplit ? { visualSchema, targetEngine: 'ui-split', ...(payload.uiSplitScope === 'children' ? { uiSplitScope: 'children', uiSplitGroupName: String(payload.uiSplitGroupName || '').slice(0, 120) } : {}) } : {})
    }
  };
}

// ---------------------------------------------------------------- ComfyUI
async function inspectQueue(baseUrl, timeoutMs = 2500) {
  try {
    const res = await fetch(baseUrl + '/queue', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, state: 'indeterminate', error: 'HTTP ' + res.status };
    const data = await res.json();
    if (!Array.isArray(data?.queue_running) || !Array.isArray(data?.queue_pending)) return { ok: false, state: 'indeterminate', error: 'invalid_queue_shape' };
    const running = data.queue_running.length, pending = data.queue_pending.length;
    return { ok: true, state: running + pending > 0 ? 'busy' : 'idle', running, pending };
  } catch (error) {
    // Nothing listening: the drawing runtime is off and owes us no memory.
    const code = String(error?.cause?.code || error?.code || '');
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') return { ok: true, state: 'no-listener' };
    return { ok: false, state: 'indeterminate', error: String(error?.name === 'TimeoutError' ? 'timeout' : error?.message || error) };
  }
}

async function freeMemory(baseUrl, timeoutMs = 15000) {
  const post = async path => {
    try {
      const res = await fetch(baseUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(timeoutMs) });
      return { ok: res.ok, status: res.status };
    } catch (error) { return { ok: false, error: String(error?.message || error) }; }
  };
  const first = await post('/free');
  return first.status === 404 ? post('/api/free') : first;
}

export function createPromptAssistant({ worker, comfyUrls = [], logger, pythonPath, serviceScript, runtimeJsonPath, modelPath, cachePath, env } = {}) {
  const log = logger || (() => {});
  let proc = null, startPromise = null, stopPromise = null, lease = null;
  let nextId = 1, buffer = '', stderrTail = [], pending = new Map();
  let lastError = '', lastWarning = '';
  // The pool task the worker is running for us: its own currentTaskId, not a drawing holding the GPU.
  let ownTaskId = '';

  function config() {
    const runtimeJson = runtimeJsonPath || process.env.NOVAFLOW_RUNTIME_JSON || runtimeJsonDefault();
    const runtime = readRuntime(runtimeJson);
    const script = serviceScript || serviceScriptPath();
    const python = pythonPath || process.env.NOVAFLOW_PROMPT_ASSISTANT_PYTHON
      || [join(runtime.installPath, 'engine', 'python', 'python.exe')].find(existsSync) || 'python';
    const folders = [modelPath, process.env.NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH,
      runtime.modelsPath && join(runtime.modelsPath, 'prompt_assistant', MODEL_DIR), runtime.modelsPath && join(runtime.modelsPath, 'vlm', MODEL_DIR)].filter(Boolean);
    const folder = folders.find(isReverseModelDir) || folders[0] || '';
    const cache = cachePath || process.env.NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_PATH
      || (runtime.modelsPath ? join(runtime.modelsPath, 'prompt_assistant', 'cache', CACHE_DIR) : join(dirname(folder || script), '.novaflow-cache', CACHE_DIR));
    const modelFolderReady = isReverseModelDir(folder), cacheReady = isReverseCacheDir(cache);
    const modelExists = modelFolderReady || cacheReady, serviceExists = isFile(script);
    return {
      modelType: MODEL_TYPE, modelPath: folder, modelFolderReady, cachePath: cache, cacheReady, modelExists,
      serviceScript: script, serviceExists, pythonPath: python,
      comfyRoot: process.env.NOVAFLOW_COMFY_ROOT || join(runtime.installPath, 'engine', 'ComfyUI'), runtimeJsonPath: runtimeJson,
      enabled: modelExists && serviceExists,
      runtimeStatus: lease ? '推理中' : modelExists ? '模型可用' : '未配置模型',
      error: !serviceExists ? 'Prompt Assistant 服务脚本不存在' : modelExists ? lastError : MODEL_MISSING_ERROR
    };
  }

  const publicConfig = cfg => ({
    modelType: cfg.modelType, modelPath: cfg.modelPath, modelFolderReady: cfg.modelFolderReady,
    cachePath: cfg.cachePath, cacheReady: cfg.cacheReady, enabled: cfg.enabled, runtimeStatus: cfg.runtimeStatus
  });

  function rejectPending(message) {
    const items = pending; pending = new Map();
    for (const item of items.values()) { clearTimeout(item.timer); item.reject(new Error(message)); }
  }

  function onStdout(text) {
    buffer += text;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          if (message && message.id !== undefined && pending.has(message.id)) {
            const item = pending.get(message.id);
            pending.delete(message.id);
            clearTimeout(item.timer);
            if (message.ok) item.resolve(message.data);
            else item.reject(Object.assign(new Error(message.error || message.message || 'Prompt Assistant 推理失败'), failureMetadata(message)));
          }
        } catch (error) { lastError = 'Prompt Assistant 输出解析失败：' + String(error?.message || error); }
      }
      index = buffer.indexOf('\n');
    }
  }

  function ensureProcess(cfg) {
    if (proc && !proc.killed) return Promise.resolve(proc);
    if (startPromise) return startPromise;
    startPromise = new Promise((resolvePromise, rejectPromise) => {
      let settled = false, startupFailure = null, startupBuffer = '';
      const settle = (error, child) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) { startPromise = null; rejectPromise(error); } else resolvePromise(child);
      };
      const child = spawn(cfg.pythonPath, [cfg.serviceScript], {
        cwd: dirname(cfg.serviceScript), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env, ...(env || {}), PYTHONIOENCODING: 'utf-8',
          NOVAFLOW_RUNTIME_JSON: cfg.runtimeJsonPath, NOVAFLOW_COMFY_ROOT: cfg.comfyRoot,
          NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH: cfg.modelPath,
          NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_TYPE: cfg.modelType,
          NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_PATH: cfg.cachePath,
          // A missing NF4 copy is reported instead of quantizing the raw folder on every request;
          // requestWithCache below builds it once and retries.
          NOVAFLOW_PROMPT_ASSISTANT_REVERSE_REQUIRE_CACHE: '1'
        }
      });
      proc = child; buffer = ''; stderrTail = [];
      // A pipe chunk can end inside a multi-byte character; the decoders keep
      // the tail so no Chinese in an answer turns into U+FFFD here.
      const stdoutDecoder = new StringDecoder('utf8'), stderrDecoder = new StringDecoder('utf8');
      child.stdout.on('data', chunk => {
        const text = stdoutDecoder.write(chunk);
        if (!settled) {
          startupBuffer += text;
          const lines = startupBuffer.split(/\r?\n/); startupBuffer = lines.pop() || '';
          for (const line of lines) {
            let startup = null;
            try { startup = JSON.parse(line.trim()); } catch { continue; }
            if (startup?.type === 'ready') { settle(null, child); break; }
            if (startup?.type === 'startup-error') {
              startupFailure = Object.assign(new Error(startup.error || 'Prompt Assistant 启动失败'), { errorCode: String(startup.errorCode || 'prompt-assistant-startup-error').slice(0, 80), failureCategory: 'resource_busy', retryable: true });
              settle(startupFailure); break;
            }
          }
        }
        onStdout(text);
      });
      child.stderr.on('data', chunk => {
        for (const line of stderrDecoder.write(chunk).split(/\r?\n/)) { const clean = line.trim(); if (clean) stderrTail.push(clean); }
        if (stderrTail.length > 40) stderrTail = stderrTail.slice(-40);
      });
      child.stdin.on('error', error => {
        if (proc !== child) return;
        lastError = 'Prompt Assistant 请求管道已断开：' + String(error?.message || error);
        rejectPending(lastError); settle(error); stop();
      });
      child.once('error', error => { if (proc !== child) return; lastError = String(error?.message || error); proc = null; rejectPending(lastError); settle(error); });
      child.once('exit', (code, signal) => {
        if (proc && proc !== child) return;
        const intentional = child.__intentionalStop === true;
        const detail = stderrTail.slice(-6).join('\n');
        const message = 'Prompt Assistant 服务已退出（code=' + (code ?? '') + ', signal=' + (signal || '') + (detail ? '）：' + detail : '）');
        // A stop we asked for is not a failure; the request's own outcome stays reported.
        if (!intentional) lastError = message;
        proc = null; startPromise = null;
        if (!intentional) rejectPending(message);
        if (settled) return;
        if (startupFailure) settle(startupFailure);
        else if (Number(code) === 73) settle(Object.assign(new Error('Prompt Assistant 本地模型正在另一个 NovaFlow 实例中使用，请等待当前任务完成后重试'), { errorCode: 'prompt-assistant-already-running', failureCategory: 'resource_busy', retryable: true }));
        else settle(new Error(intentional ? 'Prompt Assistant 服务已关闭' : message));
      });
      const timer = setTimeout(() => settle(new Error('Prompt Assistant 服务启动超时')), START_TIMEOUT_MS);
    });
    return startPromise;
  }

  function stop() {
    const child = proc;
    proc = null; startPromise = null; buffer = '';
    if (!child) return stopPromise || Promise.resolve('not-running');
    const exited = new Promise(resolvePromise => {
      const timer = setTimeout(() => resolvePromise('stop-timeout'), STOP_TIMEOUT_MS);
      timer.unref?.();
      child.once('exit', () => { clearTimeout(timer); resolvePromise('stopped'); });
    });
    stopPromise = exited;
    void exited.finally(() => { if (stopPromise === exited) stopPromise = null; });
    child.__intentionalStop = true;
    try { child.stdin?.write(JSON.stringify({ command: 'shutdown' }) + '\n'); } catch { /* already gone */ }
    try { if (!child.killed) child.kill(); } catch { /* already gone */ }
    rejectPending('Prompt Assistant 服务已关闭');
    return exited;
  }

  function send(child, command, payload, timeoutMs) {
    const id = nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => { pending.delete(id); stop(); rejectPromise(new Error('Prompt Assistant 推理超时')); }, Math.max(10000, Number(timeoutMs) || 300000));
      pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      const failWrite = error => {
        if (!error || !pending.has(id)) return;
        clearTimeout(pending.get(id).timer); pending.delete(id);
        rejectPromise(new Error('Prompt Assistant 请求发送失败：' + String(error.message || error)));
      };
      try { child.stdin.write(JSON.stringify({ id, command, ...payload }) + '\n', failWrite); } catch (error) { failWrite(error); }
    });
  }

  /** Make room on the GPU: nothing may be drawing, and ComfyUI unloads what it holds. */
  async function releaseRuntimes() {
    const state = worker?.getState?.() || {};
    if (state.currentTaskId && state.currentTaskId !== ownTaskId) return { ok: false, state: 'runtime-generation-busy', errorCode: 'runtime-generation-busy', error: '绘图模型正在生成或排队，请等待绘图完成后再优化提示词' };
    let released = false;
    for (const url of new Set(comfyUrls)) {
      const queue = await inspectQueue(url);
      if (queue.state === 'no-listener') continue;
      if (!queue.ok) return { ok: false, state: 'runtime-queue-indeterminate', errorCode: 'runtime-queue-indeterminate', error: '无法确认绘图队列状态，请稍后重试' };
      if (queue.state === 'busy') return { ok: false, state: 'runtime-generation-busy', errorCode: 'runtime-generation-busy', running: queue.running, pending: queue.pending, error: '绘图模型正在生成或排队，请等待绘图完成后再优化提示词' };
      if (!(await freeMemory(url)).ok) return { ok: false, state: 'runtime-memory-release-failed', errorCode: 'runtime-memory-release-failed', error: '绘图模型显存释放失败，请稍后重试' };
      const verified = await inspectQueue(url);
      if (!verified.ok || verified.state !== 'idle') return { ok: false, state: 'runtime-post-release-queue-not-idle', errorCode: 'runtime-post-release-queue-not-idle', error: '释放绘图模型后队列状态发生变化，请等待绘图完成后重试' };
      released = true;
    }
    return { ok: true, state: released ? 'runtime-memory-released' : 'runtime-unavailable-independent', released };
  }

  /**
   * One request, the desktop way: the lease keeps requests serial, the runtime
   * hands over the GPU first, and the script is stopped again afterwards so
   * the next 绘图 finds its memory free.
   */
  async function request(command, payload, timeoutMs) {
    const cfg = config();
    if (!cfg.enabled) return { ...publicConfig(cfg), ok: false, error: cfg.error };
    if (lease) return { ...publicConfig(cfg), ok: false, runtimeStatus: '推理中', error: 'Prompt Assistant 正在处理另一项任务，请等待完成后重试', errorCode: 'prompt-assistant-busy', failureCategory: 'resource_busy', retryable: true };
    lease = { command, startedAt: Date.now() };
    let result, started = false;
    try {
      const handoff = await releaseRuntimes();
      if (!handoff.ok) {
        log('prompt-assistant blocked', { command, state: handoff.state });
        return { ...publicConfig(cfg), ok: false, runtimeStatus: handoff.state === 'runtime-generation-busy' ? '绘图生成中' : '显存交接失败', error: handoff.error, errorCode: handoff.errorCode, retryable: true, resourceHandoff: handoff };
      }
      started = true;
      const child = await ensureProcess(cfg);
      const data = await send(child, command, payload, timeoutMs);
      lastError = '';
      lastWarning = data?.reverseFallbackReason ? '图片反推已回退到 ' + String(data?.reverseProvider || 'legacy') + '：' + String(data.reverseFallbackReason) : '';
      log('prompt-assistant done', { command, ms: Date.now() - lease.startedAt });
      result = { ...publicConfig(cfg), ok: true, runtimeStatus: '模型可用', warning: lastWarning, data };
    } catch (error) {
      lastError = String(error?.message || error);
      log('prompt-assistant failed', { command, error: lastError });
      result = { ...publicConfig(cfg), ok: false, runtimeStatus: '推理失败', error: lastError, ...failureMetadata(error) };
    } finally {
      const stopped = started ? await stop().catch(() => 'stop-error') : 'not-running';
      lease = null;
      if (stopped === 'stop-timeout' || stopped === 'stop-error') {
        result = { ...publicConfig(cfg), ok: false, runtimeStatus: '模型释放失败', error: 'Prompt Assistant 推理已结束，但模型进程未能确认退出，请重试', errorCode: stopped === 'stop-timeout' ? 'prompt-assistant-stop-timeout' : 'prompt-assistant-stop-failed', failureCategory: 'resource_cleanup', retryable: true };
      }
    }
    return result;
  }

  /** A machine with only the raw model folder builds the NF4 copy once on disk, then retries. */
  async function requestWithCache(command, payload, timeoutMs) {
    const result = await request(command, payload, timeoutMs);
    if (!isCachePreparationFailure(result)) return result;
    const prepared = await request('prepareReverseCache', {}, 900000);
    if (prepared?.ok !== true) return { ...prepared, ok: false, runtimeStatus: '模型准备失败', error: '千问 3 提示词模型的 NF4 磁盘缓存准备失败，请重试', errorCode: String(prepared?.errorCode || 'reverse-cache-prepare-failed'), failureCategory: 'model_preparation', retryable: true };
    return request(command, payload, timeoutMs);
  }

  const invalid = error => ({ ok: false, error: String(error?.message || error), errorCode: 'invalid-request' });

  const api = {
    get running() { return Boolean(proc); },
    get busy() { return Boolean(lease); },
    /** One request on behalf of a prompt_assistant pool task (worker-core). */
    async runForTask(taskId, method, payload) {
      if (!['optimizePrompt', 'reverseImagePrompt', 'describeArtStyle'].includes(String(method))) return invalid(new Error('未知的提示词助手操作'));
      ownTaskId = String(taskId || '');
      try { return await api[method](payload); }
      finally { ownTaskId = ''; }
    },
    status() {
      const cfg = config();
      return { ok: true, ...publicConfig(cfg), error: cfg.error, warning: lastWarning };
    },
    async optimizePrompt(payload) {
      let normalized;
      try { normalized = normalizeOptimizeRequest(payload); } catch (error) { return invalid(error); }
      return requestWithCache('optimizePrompt', normalized.request, normalized.timeoutMs);
    },
    async reverseImagePrompt(payload) {
      // UI PE uses the already-installed runtime model, not the unrelated NF4 assistant.
      if (payload?.uiPlanner === 'structure-catalog-v1') {
        if (payload.surface !== 'ui-design' || payload.targetEngine !== 'qwen-2.1' || payload.uiDesignIntent !== 'redesign' || payload.uiPreserveLayout !== true) return invalid(new Error('UI 结构编译请求范围无效'));
        if (lease) return { ok:false, error:'AI 助手正在处理另一项任务，请等待完成后重试', errorCode:'prompt-assistant-busy' };
        lease = { command:'uiStructureCatalog', startedAt:Date.now() };
        try {
          const handoff = await releaseRuntimes();
          if (!handoff.ok) return { ok:false, error:handoff.error, errorCode:handoff.errorCode };
          const cfg = config();
          const data = await planUiCatalog({ baseUrl:comfyUrls[0], payload, cpu: value => cpuCatalog({ python:cfg.pythonPath, serviceScript:cfg.serviceScript }, value) });
          return { ok:true, data };
        } catch (error) { return { ok:false, error:String(error?.message || error), errorCode:'ui-catalog-failed' }; }
        finally { lease = null; }
      }
      let normalized;
      try { normalized = normalizeReverseRequest(payload); } catch (error) { return invalid(error); }
      return requestWithCache('reverseImagePrompt', normalized.request, normalized.timeoutMs);
    },
    async describeArtStyle(payload) {
      // AI 特效 reads its 参考图 as a material entry, and has its 提示词补充 translated, through this same
      // call, so the action list, the protocol and the control plane stay as they are; everything else
      // still gets the style sentence.
      if (payload?.purpose === 'aifx-supplement') {
        const supplement = String(payload?.supplement || '').trim().slice(0, 400);
        if (!supplement) return invalid(new Error('没有要翻译的提示词补充'));
        const result = await requestWithCache('describeArtStyle', { purpose: 'aifx-supplement', supplement }, 120000);
        return result?.ok ? { ok: true, supplement: String(result.data?.supplement || '').slice(0, 600), model: String(result.data?.model || '') } : result;
      }
      const dataUrl = String(payload?.dataUrl || '');
      if (!dataUrl.startsWith('data:image/')) return invalid(new Error('请先选择可分析的图片'));
      const material = payload?.purpose === 'aifx-material';
      const result = await requestWithCache('describeArtStyle', {
        images: [{ name: sanitizeFileName(payload?.name, 'scene.png'), dataUrl }],
        ...(material ? { purpose: 'aifx-material' } : {})
      }, 240000);
      if (!result?.ok) return result;
      if (material) {
        const entry = result.data?.material || {};
        return {
          ok: true,
          material: {
            name: String(entry.name || '').slice(0, 60),
            material: String(entry.material || '').slice(0, 1000),
            elements: String(entry.elements || '').slice(0, 600),
            colours: String(entry.colours || '').slice(0, 160),
            breakup: String(entry.breakup || '').slice(0, 300)
          },
          model: String(result.data?.model || '')
        };
      }
      return { ok: true, style: String(result.data?.style || '').slice(0, 400), model: String(result.data?.model || '') };
    },
    /** The assistant window's 释放显存 button: the same GPU hand-over, with no request behind it. */
    releaseRuntimes,
    stop
  };
  return api;
}
