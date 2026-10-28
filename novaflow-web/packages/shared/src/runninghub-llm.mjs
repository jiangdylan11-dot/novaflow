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
  if (code === 401 || code === 403) return '在线模型拒绝了当前密钥，请核对 RunningHub Key';
  if (code === 402 || code === 429) return '在线模型额度或请求频率不足，请稍后重试';
  if (code === 404) return '在线模型地址或模型 ID 不可用';
  return '在线模型暂时不可用（HTTP ' + (code || '未知') + '）';
}

function businessError(code) {
  if (Number(code) === 1014) return '在线模型拒绝了当前密钥类型（1014），请核对 RunningHub Key 与站点';
  return '在线模型未完成请求';
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
    throw Object.assign(new Error(businessError(data.code)), { statusCode: 502 });
  }
  const message = choice?.message || {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const text = choiceText(message.content).trim();
  const output = [];
  for (const call of toolCalls) output.push({ type: 'function_call', name: String(call?.function?.name || ''), arguments: String(call?.function?.arguments || '') });
  if (text) output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
  const finish = String(choice?.finish_reason || '');
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
      completion_tokens: outputTokens
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

export async function postRunningHubResponses({ body, config, fetchImpl = fetch, timeoutMs = 60000, signal } = {}) {
  if (!config?.apiKey) throw Object.assign(new Error('在线模型尚未配置'), { statusCode: 503, providerCallStarted: false });
  if (!config.baseUrl || !config.model) throw Object.assign(new Error('在线模型配置无效'), { statusCode: 503, providerCallStarted: false });
  const wire = responsesToChatCompletions(body, config.model);
  let response;
  try {
    response = await fetchImpl(String(config.baseUrl).replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + config.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(wire),
      signal: signal || AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.statusCode) throw error;
    throw Object.assign(new Error(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? '在线模型响应超时' : '在线模型暂时不可用'), { statusCode: 502, providerCallStarted: true });
  }
  let raw = null;
  try {
    const text = await response.text();
    raw = text ? JSON.parse(text) : null;
  } catch { raw = null; }
  if (!response.ok || !raw || typeof raw !== 'object') {
    throw Object.assign(new Error(runningHubHttpError(response.status)), { statusCode: response.status >= 400 && response.status < 600 ? response.status : 502, providerCallStarted: true });
  }
  try {
    return { wire, data: chatCompletionToResponses(raw), status: response.status, providerCallStarted: true, requestId: String(raw.id || response.headers?.get?.('x-request-id') || '').trim() };
  } catch (error) {
    throw Object.assign(new Error(error?.message || '在线模型未完成请求'), { statusCode: error?.statusCode || 502, providerCallStarted: true });
  }
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
