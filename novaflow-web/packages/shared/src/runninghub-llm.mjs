// Online text and vision go through one RunningHub LLM host and one API key.
// GPT image stays a later phase and is not a text model here.
export const DEFAULT_RUNNINGHUB_LLM_BASE_URL = 'https://llm.runninghub.ai/v1';
export const DEFAULT_RUNNINGHUB_LLM_MODEL = 'xai/grok-4.7';
const LLM_HOSTS = new Set(['llm.runninghub.ai', 'llm.runninghub.cn']);
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const TEXT_PARTS = new Set(['input_text', 'output_text', 'text']);
const IMAGE_PARTS = new Set(['input_image', 'image_url', 'image']);

function readEnv(source, name) {
  const value = typeof source === 'function' ? source(name) : source?.[name];
  return String(value || '').trim();
}

export function normalizeRunningHubLlmBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw Object.assign(new Error('RunningHub LLM 地址格式不正确'), { statusCode: 503 }); }
  const path = url.pathname.replace(/\/+$/, '');
  if (url.protocol !== 'https:' || !LLM_HOSTS.has(url.hostname) || url.port || url.username || url.password || url.search || url.hash || path !== '/v1') {
    throw Object.assign(new Error('RunningHub LLM 地址须为 https://llm.runninghub.ai/v1 或 https://llm.runninghub.cn/v1'), { statusCode: 503 });
  }
  return url.origin + '/v1';
}

export function normalizeRunningHubLlmModel(value) {
  const model = String(value || '').trim();
  if (!MODEL_ID.test(model) || /[\r\n\0]/.test(model)) {
    throw Object.assign(new Error('RunningHub LLM 模型 ID 格式不正确'), { statusCode: 503 });
  }
  return model;
}

export function readRunningHubLlmConfig(source = {}) {
  const apiKey = readEnv(source, 'NOVAFLOW_RUNNINGHUB_API_KEY');
  if (/[\r\n\0]/.test(apiKey)) throw Object.assign(new Error('RunningHub API Key 格式不正确'), { statusCode: 503 });
  return {
    apiKey,
    baseUrl: normalizeRunningHubLlmBaseUrl(readEnv(source, 'NOVAFLOW_RUNNINGHUB_LLM_BASE_URL') || DEFAULT_RUNNINGHUB_LLM_BASE_URL),
    model: normalizeRunningHubLlmModel(readEnv(source, 'NOVAFLOW_RUNNINGHUB_LLM_MODEL') || DEFAULT_RUNNINGHUB_LLM_MODEL),
    configured: Boolean(apiKey)
  };
}

export function runningHubHttpError(status) {
  const code = Number(status) || 0;
  if (code === 401 || code === 403) return '在线模型鉴权未通过（HTTP '+code+'），请核对线上配置是否已同步，以及企业共享 Key 的调用权限';
  if (code === 402 || code === 429) return '在线模型额度或请求频率不足，请稍后重试';
  if (code === 404) return '在线模型地址或模型 ID 不可用';
  if (code === 400) return '在线模型没有接受这次请求';
  return '在线模型暂时不可用（HTTP ' + (code || '未知') + '）';
}

const MODERATION_CODES = new Set(['content_policy', 'content_policy_violation', 'content_filter', 'moderation', 'moderation_rejected', 'sensitive', 'sensitive_content']);

function failureTokens(data) {
  const out = [];
  const push = (value) => {
    if (value === undefined || value === null || value === '' || value === 0 || value === '0') return;
    out.push(String(value).toLowerCase());
  };
  if (!data || typeof data !== 'object') return out;
  push(data.code);
  push(data.errorCode);
  push(data.type);
  const error = data.error;
  if (error && typeof error === 'object') {
    push(error.code);
    push(error.type);
  }
  return out;
}

/** Classify a provider failure from status and code fields only. Upstream message text is never copied. */
export function describeRunningHubFailure(httpStatus, data) {
  const http = Number(httpStatus) || 0;
  const tokens = failureTokens(data);
  const business = tokens.map(Number).find((value) => Number.isInteger(value) && value > 0);
  const moderation = tokens.some((token) => MODERATION_CODES.has(token));
  const invalidPrompt = tokens.includes('invalid_prompt');
  let message = '在线模型未完成请求';
  let statusCode = http >= 400 && http < 600 ? http : 502;
  let retryable = false;
  if (business === 1014) {
    message = '在线模型拒绝了当前密钥类型（1014），请核对企业共享 Key 的调用权限';
    statusCode = 403;
  } else if (business === 421) {
    message = '在线模型正在排队，请稍后重试';
    statusCode = 503;
    retryable = true;
  } else if (business === 1003) {
    message = '在线模型暂时繁忙，请稍后重试';
    statusCode = 503;
    retryable = true;
  } else if (moderation) {
    message = '内容未通过在线审核，请修改后再试';
    statusCode = http === 400 || http === 422 ? http : 400;
  } else if (invalidPrompt) {
    message = '提示内容无法提交，请修改后再试';
    statusCode = 400;
  } else if (http === 401 || http === 403) {
    message = runningHubHttpError(http);
    statusCode = http;
  } else if (http === 402 || http === 429) {
    message = runningHubHttpError(http);
    statusCode = http;
  } else if (http === 404) {
    message = runningHubHttpError(http);
    statusCode = 404;
  } else if (http === 400) {
    message = runningHubHttpError(http);
    statusCode = 400;
  } else if (http >= 500 || http === 0) {
    message = runningHubHttpError(http || 502);
    statusCode = http >= 500 ? http : 502;
    retryable = true;
  }
  return { message, statusCode, retryable, moderation: moderation || invalidPrompt };
}

function partText(part) {
  return typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '';
}

function partImage(part) {
  const value = part?.image_url ?? part?.imageUrl ?? part?.url;
  if (typeof value === 'string') return value;
  return value && typeof value.url === 'string' ? value.url : '';
}

function convertContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const part of content) {
    if (!part || part.type === 'function_call' || part.type === 'tool_result' || part.type === 'tool_use') continue;
    if (typeof part === 'string' || TEXT_PARTS.has(part.type) || (typeof part.text === 'string' && !IMAGE_PARTS.has(part.type))) {
      const text = partText(part);
      if (text) parts.push({ type: 'text', text });
      continue;
    }
    if (IMAGE_PARTS.has(part.type)) {
      const url = partImage(part);
      if (url) parts.push({ type: 'image_url', image_url: { url } });
    }
  }
  if (!parts.length) return '';
  if (parts.some(part => part.type === 'image_url')) return parts;
  return parts.map(part => part.text).join('\n');
}

function responseFormat(body) {
  const format = body?.text?.format;
  if (format?.type !== 'json_schema' || !format.schema || typeof format.schema !== 'object' || Array.isArray(format.schema)) return undefined;
  const name = String(format.name || 'novaflow_response');
  return {
    type: 'json_schema',
    json_schema: {
      name: /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : 'novaflow_response',
      strict: format.strict !== false,
      schema: JSON.parse(JSON.stringify(format.schema))
    }
  };
}

/** OpenAI Responses multimodal body -> RunningHub /v1/chat/completions body. Tools are dropped. */
export function responsesToChatCompletions(body, model) {
  const source = Array.isArray(body?.input) ? body.input : Array.isArray(body?.messages) ? body.messages : [];
  const messages = [];
  for (const item of source) {
    const role = ['system', 'user', 'assistant'].includes(item?.role) ? item.role : 'user';
    const content = convertContent(item?.content);
    if (!content || (Array.isArray(content) && !content.length)) continue;
    messages.push({ role, content });
  }
  if (!messages.length) throw Object.assign(new Error('在线模型请求没有可发送的内容'), { statusCode: 400 });
  const chat = { model: normalizeRunningHubLlmModel(model || body?.model || DEFAULT_RUNNINGHUB_LLM_MODEL), messages };
  const temperature = Number(body?.temperature);
  if (Number.isFinite(temperature)) chat.temperature = Math.max(0, Math.min(2, temperature));
  const maxTokens = Number(body?.max_output_tokens ?? body?.max_tokens);
  if (Number.isFinite(maxTokens) && maxTokens > 0) chat.max_tokens = Math.min(8192, Math.round(maxTokens));
  const format = responseFormat(body);
  if (format) chat.response_format = format;
  return chat;
}

function choiceText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => partText(part)).filter(Boolean).join('\n');
}

/** RunningHub chat completion -> Responses-shaped result the existing parsers already read. */
export function chatCompletionToResponses(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error('在线模型未返回完整回答'), { statusCode: 502 });
  }
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  if ((data.code !== undefined && data.code !== 0 && data.code !== '0' && !choice) || (data.error && !choice)) {
    const described = describeRunningHubFailure(0, data);
    throw Object.assign(new Error(described.message), { statusCode: described.statusCode, retryable: described.retryable, moderation: described.moderation });
  }
  const finish = String(choice?.finish_reason || '');
  if (finish === 'content_filter') {
    throw Object.assign(new Error('内容未通过在线审核，请修改后再试'), { statusCode: 400, retryable: false, moderation: true });
  }
  const message = choice?.message || {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const text = choiceText(message.content).trim();
  const output = [];
  for (const call of toolCalls) output.push({ type: 'function_call', name: String(call?.function?.name || ''), arguments: String(call?.function?.arguments || '') });
  if (text) output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
  const completed = output.length > 0 && (finish === 'stop' || finish === 'length' || toolCalls.length > 0);
  const usage = data.usage && typeof data.usage === 'object' ? data.usage : {};
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  return {
    id: String(data.id || ''),
    model: String(data.model || ''),
    status: completed ? 'completed' : 'incomplete',
    output_text: text,
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: Number(usage.total_tokens ?? inputTokens + outputTokens) || 0,
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      thirdPartyConsumeMoney: usage.thirdPartyConsumeMoney ?? null,
      consumeMoney: usage.consumeMoney ?? null
    }
  };
}

export function responsesOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === 'string' && part.text.trim()) chunks.push(part.text.trim());
    }
  }
  return chunks.join('\n').trim();
}

function providerFailure(httpStatus, data, extra = {}) {
  const described = describeRunningHubFailure(httpStatus, data);
  return Object.assign(new Error(described.message), { statusCode: described.statusCode, retryable: described.retryable, moderation: described.moderation === true, providerCallStarted: true, ...extra });
}

function defaultRetryDelay(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 200 * (2 ** attempt)));
}

export async function postRunningHubResponses({ body, config, fetchImpl = fetch, timeoutMs = 60000, signal, maxRetries = 2, delay = defaultRetryDelay } = {}) {
  if (!config?.apiKey) throw Object.assign(new Error('在线模型尚未配置'), { statusCode: 503, providerCallStarted: false, retryable: false });
  if (!config.baseUrl || !config.model) throw Object.assign(new Error('在线模型配置无效'), { statusCode: 503, providerCallStarted: false, retryable: false });
  const wire = responsesToChatCompletions(body, config.model);
  const url = String(config.baseUrl).replace(/\/$/, '') + '/chat/completions';
  let started = false;
  let lastError;
  const attempts = Math.max(0, Math.round(Number(maxRetries))) + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + config.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(wire),
        signal: signal || AbortSignal.timeout(timeoutMs)
      });
      started = true;
    } catch (error) {
      if (error?.statusCode) throw error;
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      lastError = Object.assign(new Error(timedOut ? '在线模型响应超时' : '在线模型暂时不可用'), { statusCode: 502, retryable: timedOut && !signal?.aborted, providerCallStarted: true });
      if (!lastError.retryable || attempt + 1 >= attempts) throw lastError;
      await delay(attempt);
      continue;
    }
    let raw = null;
    try {
      const text = await response.text();
      raw = text ? JSON.parse(text) : null;
    } catch { raw = null; }
    const businessFailure = raw && typeof raw === 'object' && ((raw.code !== undefined && raw.code !== 0 && raw.code !== '0' && !raw.choices) || (raw.error && !raw.choices));
    if (!response.ok || !raw || typeof raw !== 'object' || businessFailure) {
      lastError = providerFailure(response.status, raw);
      if (!lastError.retryable || attempt + 1 >= attempts) throw lastError;
      await delay(attempt);
      continue;
    }
    try {
      return { wire, data: chatCompletionToResponses(raw), status: response.status, providerCallStarted: true, requestId: String(raw.id || response.headers?.get?.('x-request-id') || '').trim() };
    } catch (error) {
      lastError = Object.assign(error instanceof Error ? error : new Error('在线模型未完成请求'), { statusCode: error?.statusCode || 502, retryable: error?.retryable === true, moderation: error?.moderation === true, providerCallStarted: true });
      if (!lastError.retryable || attempt + 1 >= attempts) throw lastError;
      await delay(attempt);
    }
  }
  lastError.providerCallStarted = started || lastError.providerCallStarted === true;
  throw lastError;
}

const CATALOG_ROLES = new Set(['layout', 'style', 'color', 'material', 'content', 'identity', 'character_identity']);
const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Local UI catalog job -> one Responses request. The caller sends it through RunningHub. */
export function uiCatalogResponsesRequest(job) {
  const system = String(job?.systemInstruction || '').trim();
  if (!system || system.length > 30000) throw Object.assign(new Error('目录分析指令无效'), { statusCode: 400 });
  const required = Array.isArray(job?.outputSchema?.required) ? job.outputSchema.required : [];
  if (!required.length || required.length > 80 || required.some(key => typeof key !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(key))) {
    throw Object.assign(new Error('目录输出结构无效'), { statusCode: 400 });
  }
  const images = Array.isArray(job?.images) ? job.images : [];
  if (!images.length || images.length > 8) throw Object.assign(new Error('目录分析需要参考图'), { statusCode: 400 });
  const content = [{ type: 'input_text', text: '只输出 schema 规定的 JSON。上下文：' + JSON.stringify(job?.context ?? {}).slice(0, 20000) }];
  for (const [index, image] of images.entries()) {
    const role = String(image?.role || 'layout');
    if (!CATALOG_ROLES.has(role)) throw Object.assign(new Error('参考图用途无效'), { statusCode: 400 });
    const url = String(image?.imageUrl || image?.dataUrl || '');
    if (!DATA_IMAGE.test(url)) throw Object.assign(new Error('参考图必须是完整的 data URL'), { statusCode: 400 });
    content.push({ type: 'input_text', text: '图片' + (index + 1) + '，用途：' + role }, { type: 'input_image', image_url: url });
  }
  const maxTokens = Number(job?.maxOutputTokens);
  return {
    input: [{ role: 'system', content: [{ type: 'input_text', text: system }] }, { role: 'user', content }],
    temperature: 0.2,
    max_output_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.min(8192, Math.round(maxTokens)) : 3072,
    text: { format: { type: 'json_schema', name: 'novaflow_ui_catalog', strict: true, schema: { type: 'object', additionalProperties: false, required, properties: Object.fromEntries(required.map(key => [key, { type: 'string' }])) } } }
  };
}
