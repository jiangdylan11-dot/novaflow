import { createHash, randomUUID } from 'node:crypto';

export const FLASH_BRAIN_BASE_URL = 'http://127.0.0.1:8198';
const DEFAULTS = Object.freeze({ maxTokens: 4096, temperature: 0.4, topP: 0.95, topK: 20, minP: 0,
  repetitionPenalty: 1, seed: 957282577, reasoningEffort: 'low', reasoningBudgetTokens: 1024,
  requestTimeoutMs: 180000, maxResponseBytes: 2 * 1024 * 1024, maxInputChars: 256 * 1024,
  maxImages: 16, maxImageBytes: 24 * 1024 * 1024, maxTotalImageBytes: 48 * 1024 * 1024 });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const elapsed = start => Math.round((performance.now() - start) * 1000) / 1000;

export class FlashBrainError extends Error {
  constructor(code, message, options) { super(message, options); this.code = code; this.errorCode = code; this.resourcesReleased = false; this.generationReady = false; }
}
const failure = (code, message) => new FlashBrainError(code, message);
function requireValue(condition, code, message) { if (!condition) throw failure(code, message); }
function endpointUrl(value) {
  requireValue(typeof value === 'string' && /^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(value), 'strata-invalid-config', 'Flash 地址必须是 http://127.0.0.1:独立端口');
  const url = new URL(value), port = Number(value.match(/:(\d+)\/?$/)[1]);
  requireValue(port >= 1 && port <= 65535, 'strata-invalid-config', 'Flash 端口无效');
  return url.origin;
}
const pathKey = value => /^[A-Za-z]:[\\/]/.test(value) ? value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : value.replace(/\/+$/, '');
const absolutePath = value => typeof value === 'string' && /^(?:[A-Za-z]:[\\/]|\/)/.test(value);
function parentAbortReason(parent) {
  const reason = parent?.reason;
  if (reason instanceof Error && !(reason.name === 'AbortError' && typeof reason.code !== 'string')) return reason;
  return failure('strata-aborted', 'Flash 任务已取消');
}
function expectedIdentity(value) {
  requireValue(object(value), 'strata-invalid-config', 'Flash 模型身份配置无效');
  const list = (plural, singular) => {
    const values = value[plural] ?? (value[singular] === undefined ? [] : [value[singular]]);
    requireValue(Array.isArray(values) && values.every(item => typeof item === 'string' && item.trim() && item.length <= 2000), 'strata-invalid-config', 'Flash 模型身份配置无效');
    return [...new Set(values.map(item => item.trim()))];
  };
  const result = { ids: list('ids', 'id'), paths: list('paths', 'path') };
  requireValue(result.ids.length + result.paths.length > 0 && result.paths.every(absolutePath), 'strata-not-configured', '尚未配置经核验的 Flash 模型身份');
  return result;
}
function scope(parent, timeoutMs, timeoutCode = 'strata-timeout') {
  const controller = new AbortController();
  const abort = () => controller.abort(failure('strata-aborted', 'Flash 任务已取消'));
  const fromParent = () => controller.abort(parentAbortReason(parent));
  if (parent?.aborted) fromParent(); else parent?.addEventListener('abort', fromParent, { once: true });
  const timer = setTimeout(() => controller.abort(failure(timeoutCode, 'Flash 操作超时')), timeoutMs);
  return { signal: controller.signal, abort, close() { clearTimeout(timer); parent?.removeEventListener('abort', fromParent); } };
}
function bounded(promise, signal) {
  const task = Promise.resolve(promise);
  if (signal.aborted) { void task.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    task.then(value => { signal.removeEventListener('abort', aborted); resolve(value); },
      error => { signal.removeEventListener('abort', aborted); reject(error); });
  });
}
function text(value, name, max, required = false) {
  requireValue(typeof value === 'string' && value.length <= max && (!required || value.trim()), 'strata-invalid-request', `${name}为空或格式无效`);
  return value;
}
function responseFormat(value) {
  if (value === undefined || value === null) return undefined;
  requireValue(object(value) && (value.type === 'json_object' || value.type === 'text' || (value.type === 'json_schema' && object(value.json_schema))), 'strata-invalid-request', 'Flash 输出格式配置无效');
  try { return JSON.parse(JSON.stringify(value)); } catch { throw failure('strata-invalid-request', 'Flash 输出格式配置无效'); }
}
function options(config) {
  requireValue(object(config), 'strata-invalid-config', 'Flash 推理配置无效');
  const result = { ...DEFAULTS, ...config };
  const integer = (key, min, max) => Number.isInteger(result[key]) && result[key] >= min && result[key] <= max;
  requireValue(integer('maxTokens', 1, 131072) && Number.isFinite(result.temperature) && result.temperature >= 0 && result.temperature <= 2
    && Number.isFinite(result.topP) && result.topP > 0 && result.topP <= 1 && integer('topK', 0, 100000)
    && Number.isFinite(result.minP) && result.minP >= 0 && result.minP <= 1 && Number.isFinite(result.repetitionPenalty) && result.repetitionPenalty > 0
    && Number.isSafeInteger(result.seed) && integer('reasoningBudgetTokens', 0, 131072) && integer('requestTimeoutMs', 1, 2147483647)
    && ['none', 'minimal', 'low', 'medium', 'high'].includes(result.reasoningEffort)
    && integer('maxResponseBytes', 256, 32 * 1024 * 1024) && integer('maxInputChars', 1, 4 * 1024 * 1024)
    && integer('maxImages', 0, 32) && integer('maxImageBytes', 1, 64 * 1024 * 1024) && integer('maxTotalImageBytes', 1, 256 * 1024 * 1024),
  'strata-invalid-config', 'Flash 推理或响应上限配置无效');
  result.responseFormat = responseFormat(result.responseFormat);
  return Object.freeze(result);
}
function imageInput(image, config) {
  requireValue(object(image) && typeof image.dataUrl === 'string', 'strata-invalid-request', 'Flash 需要完整图片 data URL');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
  requireValue(match && match[2].length % 4 === 0 && match[2].length <= Math.ceil(config.maxImageBytes / 3) * 4, 'strata-invalid-request', '图片编码或大小无效');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  requireValue(valid && bytes.length <= config.maxImageBytes && bytes.toString('base64') === match[2], 'strata-invalid-request', '图片类型或完整编码无效');
  return { dataUrl: image.dataUrl, bytes: bytes.length, ...(image.name === undefined ? {} : { name: text(image.name, '图片名', 240) }) };
}

function nativeToolCalls(value, toolNames, code = 'strata-invalid-request') {
  requireValue(Array.isArray(value) && value.length >= 1 && value.length <= 4, code, 'Flash 工具调用列表无效');
  const seen = new Set();
  return value.map(call => {
    requireValue(object(call) && typeof call.id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(call.id)
      && !seen.has(call.id) && call.type === 'function' && object(call.function)
      && toolNames.has(call.function.name) && typeof call.function.arguments === 'string'
      && call.function.arguments.length <= 24000, code, 'Flash 工具调用名称、编号或参数无效');
    seen.add(call.id);
    return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } };
  });
}

function conversationInput(input, config) {
  requireValue(input.tools === undefined || Array.isArray(input.tools) && input.tools.length <= 12,
    'strata-invalid-request', 'Flash 对话工具定义无效');
  const names = new Set(), tools = (input.tools || []).map(tool => {
    requireValue(object(tool) && tool.type === 'function' && object(tool.function)
      && typeof tool.function.name === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(tool.function.name)
      && !names.has(tool.function.name) && object(tool.function.parameters), 'strata-invalid-request', 'Flash 对话工具定义无效');
    names.add(tool.function.name);
    const copy = JSON.parse(JSON.stringify(tool));
    requireValue(JSON.stringify(copy).length <= 16000, 'strata-invalid-request', 'Flash 工具定义超过上限');
    return copy;
  });
  requireValue(Array.isArray(input.messages) && input.messages.length >= 2 && input.messages.length <= 40,
    'strata-invalid-request', 'Flash 对话消息数量无效');
  const images = [], pending = new Set(), allCallIds = new Set();
  let chars = 0, bytes = 0;
  const messages = input.messages.map((message, index) => {
    requireValue(object(message) && ['system', 'user', 'assistant', 'tool'].includes(message.role)
      && ((index === 0) === (message.role === 'system')), 'strata-invalid-request', 'Flash 对话角色无效');
    requireValue(!pending.size || message.role === 'tool', 'strata-invalid-request', 'Flash 工具结果尚未配对');
    let content;
    if (typeof message.content === 'string') {
      content = text(message.content, '对话内容', config.maxInputChars);
      chars += content.length;
    } else if (message.role === 'assistant' && message.content == null) content = null;
    else {
      requireValue(message.role === 'user' && Array.isArray(message.content) && message.content.length >= 1
        && message.content.length <= 64, 'strata-invalid-request', 'Flash 对话内容无效');
      content = message.content.map(part => {
        requireValue(object(part), 'strata-invalid-request', 'Flash 对话图片内容无效');
        if (part.type === 'text') {
          const value = text(part.text, '对话内容', config.maxInputChars); chars += value.length;
          return { type: 'text', text: value };
        }
        requireValue(part.type === 'image_url' && object(part.image_url), 'strata-invalid-request', 'Flash 对话仅接受完整本机图片');
        const image = imageInput({ dataUrl: part.image_url.url }, config);
        bytes += image.bytes; images.push(image);
        requireValue(images.length <= config.maxImages && bytes <= config.maxTotalImageBytes,
          'strata-invalid-request', 'Flash 对话图片超过上限');
        return { type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } };
      });
    }
    const result = { role: message.role, content };
    if (message.role === 'assistant' && message.tool_calls !== undefined) {
      result.tool_calls = nativeToolCalls(message.tool_calls, names);
      for (const call of result.tool_calls) {
        requireValue(!allCallIds.has(call.id), 'strata-invalid-request', 'Flash 对话工具编号重复');
        pending.add(call.id); allCallIds.add(call.id);
      }
    } else requireValue(message.tool_calls === undefined, 'strata-invalid-request', '工具调用只能来自 assistant');
    if (message.role === 'tool') {
      requireValue(typeof message.tool_call_id === 'string' && pending.delete(message.tool_call_id)
        && typeof content === 'string', 'strata-invalid-request', 'Flash 对话工具结果编号无效');
      result.tool_call_id = message.tool_call_id;
    }
    requireValue(message.function_call === undefined, 'strata-invalid-request', '旧版 function_call 不受支持');
    return result;
  });
  requireValue(!pending.size && ['user', 'tool'].includes(messages.at(-1).role) && chars <= config.maxInputChars,
    'strata-invalid-request', 'Flash 对话未完成或超过上限');
  return { messages, tools, toolNames: names, images };
}

/**
 * One owned local model lifecycle, with sequential native inference stages.
 * The caller supplies trusted load/unload hooks; unload must prove text AND
 * vision release. A release fault permanently closes this object's gate.
 * Legacy infer stays text-only. inferConversation transports bounded native
 * tool calls; the caller must own the explicit tool registry and execution.
 */
export function createFlashBrainSession({ baseUrl = FLASH_BRAIN_BASE_URL, expectedModel = {}, fetchImpl = globalThis.fetch,
  lifecycle, timeoutMs = 180000, releaseTimeoutMs = 75000, identityTimeoutMs = 10000, apiKey = '', config = {}, onInference } = {}) {
  const endpoint = endpointUrl(baseUrl), expected = expectedIdentity(expectedModel), defaults = options(config);
  requireValue(typeof fetchImpl === 'function' && object(lifecycle) && typeof lifecycle.load === 'function' && typeof lifecycle.unload === 'function', 'strata-invalid-config', 'Flash 需要可信的加载和卸载生命周期');
  requireValue(onInference === undefined || typeof onInference === 'function', 'strata-invalid-config', 'Flash 审计回调无效');
  requireValue([timeoutMs, releaseTimeoutMs, identityTimeoutMs].every(value => Number.isFinite(value) && value >= 1 && value <= 2147483647)
    && typeof apiKey === 'string' && apiKey.length <= 4096 && !/[\r\n]/.test(apiKey), 'strata-invalid-config', 'Flash 超时或认证配置无效');
  let busy = false, cleanupFault = false, active = null, lastIdentity = null, lastGenerationReady = false;
  const headers = { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };

  async function json(path, { signal, body, optional = false }) {
    let response;
    try { response = await bounded(fetchImpl(endpoint + path, { method: body === undefined ? 'GET' : 'POST', headers, redirect: 'error', signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), signal); }
    catch { if (signal.aborted) throw signal.reason; throw failure('strata-unavailable', '无法连接本机 Flash 服务'); }
    if (optional && [404, 405].includes(response.status)) { void response.body?.cancel?.().catch?.(() => {}); return null; }
    if (!response.ok) { void response.body?.cancel?.().catch?.(() => {}); throw failure('strata-http-error', `本机 Flash 接口返回 HTTP ${Number(response.status) || 0}`); }
    const advertised = Number(response.headers?.get('content-length'));
    const reader = response.body?.getReader?.();
    if (!reader || (Number.isFinite(advertised) && advertised > defaults.maxResponseBytes)) {
      void reader?.cancel?.().catch?.(() => {});
      throw failure('strata-invalid-response', 'Flash 响应为空或超过上限');
    }
    const parts = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await bounded(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        requireValue(size <= defaults.maxResponseBytes, 'strata-invalid-response', 'Flash 响应超过上限');
        parts.push(value);
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, size)));
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof FlashBrainError) throw error;
      throw failure('strata-invalid-response', 'Flash 接口未返回有效 JSON');
    } finally { void reader.cancel().catch(() => {}); }
  }

  async function identify(signal) {
    const models = await json('/v1/models', { signal });
    const ids = [...new Set((Array.isArray(models?.data) ? models.data : []).map(item => item?.id).filter(id => typeof id === 'string' && id.trim() && id.length <= 2000))];
    const props = await json('/props', { signal, optional: !expected.paths.length });
    // The actual loaded path is authoritative; an alias must never hide a
    // contradictory /props model_path. Do not infer a weight path from an ID.
    const authoritative = [props?.model_path, props?.model_info?.model_path, props?.model_info?.path].find(absolutePath);
    const reported = authoritative || [props?.model, props?.default_generation_settings?.model].find(absolutePath);
    const matchedPath = expected.paths.find(path => reported && pathKey(path) === pathKey(reported));
    if (expected.paths.length) requireValue(matchedPath, 'strata-identity-mismatch', 'Flash 实际加载路径与已核验权重不匹配');
    const matchingIds = ids.filter(id => expected.ids.includes(id));
    const id = ids.length === 1 ? ids[0] : matchingIds.length === 1 ? matchingIds[0] : undefined;
    requireValue(id && (matchedPath || expected.ids.includes(id)), 'strata-identity-mismatch', 'Flash 实际模型身份不匹配或不唯一');
    return Object.freeze({ id, ...(matchedPath ? { path: matchedPath, reportedPath: reported } : {}),
      verification: matchedPath ? 'server-weight-path' : 'server-model-id', expectedIdMatched: expected.ids.includes(id), baseUrl: endpoint });
  }

  async function withSession(callback, { signal } = {}) {
    if (cleanupFault) throw failure('strata-release-unconfirmed', 'Flash 资源释放尚未确认，当前会话入口已锁定');
    if (busy) throw failure('strata-busy', 'Flash 正在处理另一项任务');
    requireValue(typeof callback === 'function', 'strata-invalid-request', 'Flash 会话回调无效');
    busy = true; lastGenerationReady = false;
    const started = performance.now(), requestId = randomUUID(), operation = scope(signal, timeoutMs);
    active = operation;
    const timing = { loadMs: null, modelLoadMs: null, identityMs: null, callbackMs: null, requestMs: 0, unloadMs: null, totalMs: null, requests: [] };
    let receipt, identity, value, error, attemptedLoad = false, loadSettled = false, loadFinished, sessionOpen = false, inferBusy = false, resourcesReleased = false;
    try {
      if (operation.signal.aborted) throw operation.signal.reason;
      attemptedLoad = true;
      const loadStart = performance.now();
      const loadPromise = Promise.resolve().then(() => lifecycle.load({ baseUrl: endpoint, requestId, ownerToken: requestId, signal: operation.signal }));
      loadFinished = loadPromise.then(result => { loadSettled = true; receipt = result; }, () => { loadSettled = true; });
      try { receipt = await bounded(loadPromise, operation.signal); }
      catch { if (operation.signal.aborted) throw operation.signal.reason; throw failure('strata-load-failed', 'Flash 模型加载失败'); }
      finally { timing.loadMs = elapsed(loadStart); }
      requireValue(receipt?.ok !== false, 'strata-load-failed', 'Flash 模型加载失败');
      if (Number.isFinite(receipt?.modelLoadMs) && receipt.modelLoadMs >= 0) timing.modelLoadMs = receipt.modelLoadMs;
      const identityScope = scope(operation.signal, identityTimeoutMs), identityStart = performance.now();
      try { identity = await identify(identityScope.signal); lastIdentity = identity; }
      finally { timing.identityMs = elapsed(identityStart); identityScope.close(); }
      sessionOpen = true;
      const runInference = (input, conversationMode = false) => {
        const job = (async () => {
          requireValue(sessionOpen && !operation.signal.aborted, 'strata-session-closed', 'Flash 会话已结束或取消');
          requireValue(!inferBusy, 'strata-busy', '同一 Flash 会话中的推理必须顺序执行');
          requireValue(object(input), 'strata-invalid-request', 'Flash 推理输入无效');
          const conversation = conversationMode ? conversationInput(input, defaults) : null;
          if (!conversationMode) requireValue(input.tools === undefined && input.messages === undefined,
            'strata-invalid-request', '普通 Flash infer 不接受对话或工具参数');
          const system = conversationMode ? null : text(input.system, '系统提示词', defaults.maxInputChars);
          const user = conversationMode ? null : text(input.user, '用户提示词', defaults.maxInputChars, true);
          const stage = input.stage === undefined ? undefined : text(input.stage, '阶段名', 120);
          requireValue(input.images === undefined || Array.isArray(input.images), 'strata-invalid-request', 'Flash 图片列表无效');
          requireValue((input.images?.length || 0) <= defaults.maxImages, 'strata-invalid-request', 'Flash 图片数量超过上限');
          let totalImageBytes = 0;
          const images = conversation?.images || (input.images || []).map(image => {
            const result = imageInput(image, defaults); totalImageBytes += result.bytes;
            requireValue(totalImageBytes <= defaults.maxTotalImageBytes, 'strata-invalid-request', 'Flash 完整图片合计超过上限');
            return result;
          });
          const maxTokens = input.maxTokens ?? defaults.maxTokens, temperature = input.temperature ?? defaults.temperature;
          requireValue(Number.isInteger(maxTokens) && maxTokens >= 1 && maxTokens <= 131072 && Number.isFinite(temperature) && temperature >= 0 && temperature <= 2, 'strata-invalid-request', 'Flash 生成参数无效');
          const reasoningEffort = input.reasoningEffort ?? defaults.reasoningEffort;
          const reasoningBudgetTokens = input.reasoningBudgetTokens ?? defaults.reasoningBudgetTokens;
          requireValue(['none', 'minimal', 'low', 'medium', 'high'].includes(reasoningEffort)
            && Number.isInteger(reasoningBudgetTokens) && reasoningBudgetTokens >= 0 && reasoningBudgetTokens <= 131072,
          'strata-invalid-request', 'Flash 单次思考设置无效');
          const format = conversationMode ? undefined : responseFormat(input.responseFormat === undefined ? defaults.responseFormat : input.responseFormat);
          const content = [{ type: 'text', text: user }];
          images.forEach((image, index) => {
            content.push({ type: 'text', text: `<image${index + 1}>${image.name ? `: ${image.name}` : ''}` }, { type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } });
          });
          const body = { model: identity.id, messages: conversation?.messages || [{ role: 'system', content: system }, { role: 'user', content }], stream: false,
            max_tokens: maxTokens, temperature, top_p: defaults.topP, top_k: defaults.topK, min_p: defaults.minP,
            seed: defaults.seed, reasoning_effort: reasoningEffort,
            reasoning_budget_tokens: reasoningBudgetTokens, presence_penalty: 0, frequency_penalty: 0, repetition_penalty: defaults.repetitionPenalty,
            ...(format ? { response_format: format } : {}),
            ...(conversationMode && conversation.tools.length ? { tools: conversation.tools, tool_choice: 'auto', parallel_tool_calls: false } : {}) };
          inferBusy = true;
          const requestStart = performance.now(), requestScope = scope(operation.signal, defaults.requestTimeoutMs), auditRequestId = randomUUID();
          const audit = async outcome => {
            if (!onInference) return;
            // Copy both sides: a diagnostics consumer cannot rewrite the native
            // answer before validation. Authentication headers are never passed.
            let imageIndex = 0;
            const auditBody = { ...body, messages: body.messages.map(message => ({ ...message,
              content: Array.isArray(message.content) ? message.content.map(part => {
                if (part.type !== 'image_url') return { ...part };
                const image = images[imageIndex++], comma = image.dataUrl.indexOf(',');
                const bytes = Buffer.from(image.dataUrl.slice(comma + 1), 'base64');
                return { type: 'image_audit', mime: image.dataUrl.slice(5, image.dataUrl.indexOf(';')), bytes: bytes.length,
                  sha256: createHash('sha256').update(bytes).digest('hex'), ...(image.name === undefined ? {} : { name: image.name }) };
              }) : message.content
            })) };
            try {
              await onInference(JSON.parse(JSON.stringify({ request: auditBody,
                ...outcome, ...(stage === undefined ? {} : { stage }), elapsedMs: elapsed(requestStart),
                requestId: typeof outcome.response?.id === 'string' && outcome.response.id.length <= 240 ? outcome.response.id : auditRequestId
              })));
            } catch (cause) { throw new FlashBrainError('strata-audit-failed', 'Flash 原生推理审计失败，本次未重试', { cause }); }
          };
          try {
            let response;
            try { response = await json('/v1/chat/completions', { signal: requestScope.signal, body }); }
            catch (error) {
              await audit({ error: { code: error?.code || 'strata-inference-failed', message: String(error?.message || error) } });
              throw error;
            }
            await audit({ response });
            const choice = response?.choices?.[0], message = choice?.message;
            if (!conversationMode) requireValue(!message?.tool_calls?.length && !message?.function_call && choice?.finish_reason !== 'tool_calls', 'strata-tool-response', 'Flash 返回了未授权的工具调用');
            requireValue(choice?.finish_reason !== 'length', 'strata-output-truncated', 'Flash 输出被截断');
            let nativeMessage;
            if (conversationMode) {
              requireValue(object(message) && message.role === 'assistant' && !message.function_call,
                'strata-invalid-response', 'Flash 未返回有效 assistant 消息');
              if (choice?.finish_reason === 'tool_calls') {
                requireValue(message.content == null || typeof message.content === 'string', 'strata-invalid-response', 'Flash 工具消息内容无效');
                nativeMessage = { role: 'assistant', content: message.content ?? null,
                  tool_calls: nativeToolCalls(message.tool_calls, conversation.toolNames, 'strata-invalid-response') };
              } else {
                requireValue(choice?.finish_reason === 'stop' && !message.tool_calls?.length
                  && typeof message.content === 'string' && message.content.trim(), 'strata-invalid-response', 'Flash 未返回完整对话结果');
                nativeMessage = { role: 'assistant', content: message.content };
              }
            } else requireValue(choice?.finish_reason === 'stop' && typeof message?.content === 'string' && message.content.trim(), 'strata-invalid-response', 'Flash 未返回完整文本结果');
            requireValue(response.model === identity.id, 'strata-identity-mismatch', 'Flash 响应模型与当前核验模型不一致');
            const actualRequestId = typeof response.id === 'string' && response.id.length <= 240 ? response.id : randomUUID();
            const requestMs = elapsed(requestStart);
            const requestTiming = { requestMs, ...(stage === undefined ? {} : { stage }) };
            timing.requests.push({ requestId: actualRequestId, ...requestTiming });
            return { text: message.content, ...(conversationMode ? { message: nativeMessage, finishReason: choice.finish_reason } : {}), requestId: actualRequestId, model: response.model,
              usage: object(response.usage) ? response.usage : null, timing: requestTiming };
          } finally { requestScope.close(); timing.requestMs += elapsed(requestStart); inferBusy = false; }
        })();
        // A fire-and-forget caller cannot create an unhandled rejection while
        // cleanup closes its session. It still cannot obtain a successful gate.
        void job.catch(() => {});
        return job;
      };
      const infer = input => runInference(input, false);
      const inferConversation = input => runInference(input, true);
      const callbackStart = performance.now();
      try { value = await bounded(Promise.resolve().then(() => callback({ infer, inferConversation, identity })), operation.signal); }
      finally { timing.callbackMs = elapsed(callbackStart); }
      requireValue(!inferBusy, 'strata-session-incomplete', 'Flash 回调结束时仍有未等待的推理');
    } catch (caught) { error = operation.signal.aborted ? operation.signal.reason : caught; }
    finally {
      sessionOpen = false;
      if (inferBusy) operation.abort();
      operation.close();
      if (attemptedLoad) {
        const cleanup = scope(undefined, releaseTimeoutMs), releaseStart = performance.now();
        try {
          const unload = () => bounded(Promise.resolve().then(() => lifecycle.unload({ baseUrl: endpoint, requestId, ownerToken: requestId, receipt, signal: cleanup.signal })), cleanup.signal);
          let released = await unload();
          // If load ignored cancellation, an early unload cannot prove that a
          // late loader will not reacquire resources. Wait within the cleanup
          // deadline, then unload again after the loader has settled.
          if (!loadSettled) { await bounded(loadFinished, cleanup.signal); released = await unload(); }
          requireValue(released?.released === true && released?.ok !== false, 'strata-release-unconfirmed', 'Flash 文本与视觉资源未确认释放');
          resourcesReleased = true;
        } catch (releaseError) {
          cleanupFault = true;
          error = new FlashBrainError('strata-release-unconfirmed', 'Flash 文本与视觉资源未确认释放，当前会话入口已锁定', { cause: error || releaseError });
        } finally { timing.unloadMs = elapsed(releaseStart); cleanup.close(); }
      }
      if (!cleanupFault && !error && (operation.signal.aborted || signal?.aborted)) error = operation.signal.reason || parentAbortReason(signal);
      timing.totalMs = elapsed(started); active = null; busy = false;
    }
    if (error) {
      if (!(error instanceof FlashBrainError)) error = new FlashBrainError(typeof error?.code === 'string' ? error.code : error?.errorCode || 'strata-session-failed', error instanceof Error ? error.message : 'Flash 会话失败', { cause: error });
      Object.assign(error, { resourcesReleased, generationReady: false, timing, ...(identity ? { identity } : {}) });
      throw error;
    }
    lastGenerationReady = true;
    return { value, identity, timing, resourcesReleased: true, generationReady: true };
  }

  return { withSession, getStatus: () => ({ busy, cleanupFault, generationReady: !busy && !cleanupFault && lastGenerationReady, modelIdentity: lastIdentity, baseUrl: endpoint }),
    cancel() { if (!active) return false; active.abort(); return true; } };
}
