// Cloud GPT images go only through the RunningHub image API.
// One key: NOVAFLOW_RUNNINGHUB_API_KEY.
// Text-to-image: NOVAFLOW_RUNNINGHUB_GPT_IMAGE_ENDPOINT (empty = GPT Image 2.5).
// Image-to-image: NOVAFLOW_RUNNINGHUB_GPT_IMAGE_I2I_ENDPOINT, its own path
// (empty = /openapi/v2/rhart-image-g-2.5/sunburst/image-to-image). It is not
// derived by rewriting the text path.
// The upload host follows the image host (default https://www.runninghub.ai)
// unless NOVAFLOW_RUNNINGHUB_UPLOAD_BASE_URL sets it separately.
// A 404, business code 1001, or an empty taskId on a 2.5 path retries the
// official GPT Image 2 endpoint once. That retry is settled at the official
// price; the 2.5 hold is released. With no retry left, 1001 and an empty
// taskId become Chinese errors and the hold is released.

import { describeRunningHubFailure } from './runninghub-llm.mjs';
import { quoteFeature } from './feature-credits.mjs';

export const DEFAULT_GPT_IMAGE_ENDPOINT = '/openapi/v2/rhart-image-g-2.5-official-token/sunburst/text-to-image';
export const DEFAULT_GPT_IMAGE_I2I_ENDPOINT = '/openapi/v2/rhart-image-g-2.5/sunburst/image-to-image';
export const FALLBACK_GPT_IMAGE_ENDPOINT = '/openapi/v2/rhart-image-g-2-official/text-to-image';
export const FALLBACK_GPT_IMAGE_I2I_ENDPOINT = '/openapi/v2/rhart-image-g-2-official/image-to-image';
export const DEFAULT_IMAGE_BASE_URL = 'https://www.runninghub.ai';
export const QUERY_PATH = '/openapi/v2/query';
export const UPLOAD_PATH = '/openapi/v2/media/upload/binary';
export const DEFAULT_BALANCE_BLOCK_USD = 2;
export const MAX_IMAGE_COUNT = 10;

export const DEFAULT_IMAGE_PRICES = Object.freeze({
  gpt_image_2_5_economy: 22,
  gpt_image_2_5: 22,
  gpt_image_2_official: 4
});

const IMAGE_HOSTS = new Set(['www.runninghub.ai', 'runninghub.ai', 'www.runninghub.cn', 'runninghub.cn']);

export const ASPECT_RATIOS = Object.freeze([
  '1:1', '1:2', '2:1', '1:3', '3:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '21:9', '9:21', '16:9'
]);

const SIZE_PRESETS = Object.freeze({
  '1024x1024': { aspectRatio: '1:1', resolution: '1k' },
  '1024x1536': { aspectRatio: '2:3', resolution: '1k' },
  '1536x1024': { aspectRatio: '3:2', resolution: '1k' },
  '2048x2048': { aspectRatio: '1:1', resolution: '2k' },
  '2048x1152': { aspectRatio: '16:9', resolution: '2k' },
  '1152x2048': { aspectRatio: '9:16', resolution: '2k' },
  '3840x2160': { aspectRatio: '16:9', resolution: '4k' },
  '2160x3840': { aspectRatio: '9:16', resolution: '4k' }
});

const ENDPOINT_PATH = /^\/openapi\/v2\/[a-zA-Z0-9_./-]+$/;
const RELEASE_CODES = ['invalid_prompt', 'content_policy_violation', 'content_policy', 'content_filter', 'moderation_rejected', 'moderation', 'sensitive_content', 'sensitive'];
const MISSING_ENDPOINT_MESSAGE = '出图接口不存在（1001），本次未扣积分';
const EMPTY_TASK_MESSAGE = '出图服务没有返回任务编号，本次未扣积分';

function readEnv(source, name) {
  const value = typeof source === 'function' ? source(name) : source?.[name];
  return String(value || '').trim();
}

function assertEndpoint(value, fallback) {
  const text = String(value || '').trim() || fallback;
  if (!ENDPOINT_PATH.test(text) || text.split('/').includes('..')) {
    throw Object.assign(new Error('GPT 出图路径须以 /openapi/v2/ 开头'), { statusCode: 503 });
  }
  return text;
}

export function resolveTextEndpoint(value) {
  return assertEndpoint(value, DEFAULT_GPT_IMAGE_ENDPOINT);
}

export function resolveImageEndpoint(value) {
  return assertEndpoint(value, DEFAULT_GPT_IMAGE_I2I_ENDPOINT);
}

export function fallbackFor(endpoint) {
  const path = assertEndpoint(endpoint, DEFAULT_GPT_IMAGE_ENDPOINT);
  if (!path.includes('2.5')) return '';
  if (path === FALLBACK_GPT_IMAGE_ENDPOINT || path === FALLBACK_GPT_IMAGE_I2I_ENDPOINT) return '';
  return path.includes('image-to-image') ? FALLBACK_GPT_IMAGE_I2I_ENDPOINT : FALLBACK_GPT_IMAGE_ENDPOINT;
}

export function featureForEndpoint(endpoint) {
  return String(endpoint || '').includes('2.5') ? 'gpt_image_2_5_economy' : 'gpt_image_2_official';
}

export function referenceLimitForEndpoint(endpoint) {
  return String(endpoint || '').includes('2.5') ? 16 : 10;
}

function integerPrice(value, fallback) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100) return fallback;
  return amount;
}

export function resolveImagePrices(overrides) {
  const source = overrides && typeof overrides === 'object' ? overrides : {};
  const economy = integerPrice(source.gpt_image_2_5_economy ?? source.gpt_image_2_5, DEFAULT_IMAGE_PRICES.gpt_image_2_5_economy);
  const official = integerPrice(source.gpt_image_2_official, DEFAULT_IMAGE_PRICES.gpt_image_2_official);
  return {
    gpt_image_2_5_economy: economy,
    gpt_image_2_5: economy,
    gpt_image_2_official: official
  };
}

function pricesFromEnv(source) {
  const raw = readEnv(source, 'NOVAFLOW_FEATURE_CREDIT_PRICES');
  if (!raw) return resolveImagePrices(null);
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw Object.assign(new Error('出图积分单价配置不是合法 JSON'), { statusCode: 503 }); }
  return resolveImagePrices(parsed);
}

function resolveImageHost(value) {
  const raw = String(value || '').trim();
  let baseUrl;
  try { baseUrl = new URL(raw); }
  catch { throw Object.assign(new Error('RunningHub 地址格式不正确'), { statusCode: 503 }); }
  if (baseUrl.protocol !== 'https:' || !IMAGE_HOSTS.has(baseUrl.hostname) || baseUrl.username || baseUrl.password || (baseUrl.pathname && baseUrl.pathname !== '/') || baseUrl.search || baseUrl.hash) {
    throw Object.assign(new Error('GPT 出图地址须为 https://www.runninghub.ai 或 https://www.runninghub.cn'), { statusCode: 503 });
  }
  return baseUrl.origin;
}

export function readRunningHubImageConfig(source = {}) {
  const apiKey = readEnv(source, 'NOVAFLOW_RUNNINGHUB_API_KEY');
  if (/[\r\n\0]/.test(apiKey)) throw Object.assign(new Error('RunningHub API Key 格式不正确'), { statusCode: 503 });
  const baseUrl = resolveImageHost(readEnv(source, 'NOVAFLOW_RUNNINGHUB_BASE_URL') || DEFAULT_IMAGE_BASE_URL);
  const uploadRaw = readEnv(source, 'NOVAFLOW_RUNNINGHUB_UPLOAD_BASE_URL');
  const uploadBaseUrl = uploadRaw ? resolveImageHost(uploadRaw) : baseUrl;
  const threshold = Number(readEnv(source, 'NOVAFLOW_RUNNINGHUB_BALANCE_BLOCK_USD') || DEFAULT_BALANCE_BLOCK_USD);
  return {
    apiKey,
    baseUrl,
    uploadBaseUrl,
    gptImageEndpoint: resolveTextEndpoint(readEnv(source, 'NOVAFLOW_RUNNINGHUB_GPT_IMAGE_ENDPOINT')),
    gptImageI2iEndpoint: resolveImageEndpoint(readEnv(source, 'NOVAFLOW_RUNNINGHUB_GPT_IMAGE_I2I_ENDPOINT')),
    prices: pricesFromEnv(source),
    balanceBlockUsd: Number.isFinite(threshold) && threshold >= 0 ? threshold : DEFAULT_BALANCE_BLOCK_USD,
    configured: Boolean(apiKey)
  };
}

function clampCount(value) {
  const count = Math.round(Number(value) || 1);
  if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGE_COUNT) {
    throw Object.assign(new Error('生成张数须为 1 到 10 的整数'), { statusCode: 400 });
  }
  return count;
}

export function quoteGptImage({ endpoint, imageEndpoint, mode = 'txt2img', count = 1, prices } = {}) {
  const path = String(mode || 'txt2img') === 'img2img' ? resolveImageEndpoint(imageEndpoint) : resolveTextEndpoint(endpoint);
  const feature = featureForEndpoint(path);
  const table = resolveImagePrices(prices);
  const images = clampCount(count);
  const quoted = quoteFeature({ feature, units: images, prices: { prices: table } });
  return {
    feature: quoted.feature,
    perImage: quoted.unitPrice,
    count: images,
    credits: quoted.credits,
    endpoint: path,
    model: quoted.feature,
    mayFallback: Boolean(fallbackFor(path))
  };
}

export function formatCreditButtonLabel(credits) {
  const amount = Math.round(Number(credits));
  if (!Number.isInteger(amount) || amount < 0) return '开始生成 · 积分待确认';
  if (amount === 0) return '开始生成';
  return `开始生成 · ${amount}积分`;
}

export function formatChargedRemaining(charged, remaining) {
  const spent = Math.round(Number(charged) || 0);
  const left = Number(remaining);
  const spentText = `本次扣 ${spent}积分`;
  if (!Number.isFinite(left)) return spentText;
  return `${spentText}，剩余 ${left}`;
}

function closestAspect(width, height) {
  const ratio = Math.max(1, width) / Math.max(1, height);
  let best = '1:1';
  let bestDelta = Infinity;
  for (const item of ASPECT_RATIOS) {
    const [w, h] = item.split(':').map(Number);
    const delta = Math.abs(Math.log(ratio) - Math.log(w / h));
    if (delta < bestDelta) {
      best = item;
      bestDelta = delta;
    }
  }
  return best;
}

function resolutionTier(width, height) {
  const longEdge = Math.max(width, height);
  if (longEdge >= 3000) return '4k';
  if (longEdge >= 1600) return '2k';
  return '1k';
}

function positiveDimension(value, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(64, Math.min(3840, number));
}

export function mapGptImageParams({ mode = 'txt2img', prompt, settings = {}, images = [], width, height, endpoint, imageEndpoint } = {}) {
  const text = String(prompt || '').trim();
  if (!text || text.length > 20000) {
    throw Object.assign(new Error(text ? '提示词过长，请缩短到 20000 字以内' : '请先输入提示词'), { statusCode: 400 });
  }
  const normalizedMode = String(mode || 'txt2img') === 'img2img' ? 'img2img' : 'txt2img';
  const source = settings && typeof settings === 'object' ? settings : {};
  const size = String(source.size || source.gptSize || '').trim();
  let mapped = SIZE_PRESETS[size];
  if (!mapped) {
    const customWidth = positiveDimension(source.customWidth ?? source.gptCustomWidth ?? width, 1024);
    const customHeight = positiveDimension(source.customHeight ?? source.gptCustomHeight ?? height, 1024);
    mapped = { aspectRatio: closestAspect(customWidth, customHeight), resolution: resolutionTier(customWidth, customHeight) };
  }
  const quality = ['low', 'medium', 'high'].includes(String(source.quality || '')) ? String(source.quality) : 'medium';
  const path = normalizedMode === 'img2img' ? resolveImageEndpoint(imageEndpoint) : resolveTextEndpoint(endpoint);
  const refs = Array.isArray(images) ? images.filter(Boolean) : [];
  if (normalizedMode === 'img2img' && refs.length < 1) {
    throw Object.assign(new Error('图生图需要至少一张参考图'), { statusCode: 400 });
  }
  const limit = referenceLimitForEndpoint(path);
  if (refs.length > limit) {
    throw Object.assign(new Error(`当前模型最多 ${limit} 张参考图，请先移除多余图片`), { statusCode: 400 });
  }
  const body = {
    prompt: text,
    aspectRatio: mapped.aspectRatio,
    resolution: mapped.resolution,
    quality
  };
  if (normalizedMode === 'img2img') body.imageUrls = refs.map((item) => (typeof item === 'string' ? item : item.url)).filter(Boolean);
  return { mode: normalizedMode, endpoint: path, body, referenceCount: refs.length };
}

function businessErrorCode(data) {
  if (!data || typeof data !== 'object') return 0;
  const values = [data.errorCode, data.code, data.data?.errorCode, data.data?.code, data.error?.code];
  for (const value of values) {
    if (value === undefined || value === null || value === '' || typeof value === 'object') continue;
    const code = Number(value);
    if (Number.isInteger(code) && code > 0) return code;
  }
  return 0;
}

function releaseCode(data) {
  const fields = [data?.errorCode, data?.code, data?.error?.code, data?.error?.type, data?.failedReason?.code, data?.failedReason?.type];
  const text = fields.map((value) => String(value || '').toLowerCase()).join(' ');
  return RELEASE_CODES.find((code) => text.includes(code)) || '';
}

export function describeImageFailure(httpStatus, data) {
  const business = businessErrorCode(data);
  if (business === 1001 || Number(httpStatus) === 404) {
    return { message: MISSING_ENDPOINT_MESSAGE, statusCode: 404, retryable: false, moderation: false, missingEndpoint: true };
  }
  if (business === 1) {
    return { message: 'RunningHub API Key 无效，请核对密钥与出图站点', statusCode: 401, retryable: false, moderation: false };
  }
  const described = describeRunningHubFailure(httpStatus, data && typeof data === 'object' ? data : {});
  const code = releaseCode(data);
  if (described.moderation || code) {
    const message = code === 'invalid_prompt' || described.message.includes('提示内容无法提交')
      ? '提示内容未通过审核，请修改后再试'
      : '内容未通过在线审核，请修改后再试';
    return { message, statusCode: 400, retryable: false, moderation: true };
  }
  return described;
}

function imageError(httpStatus, data) {
  const described = describeImageFailure(httpStatus, data);
  return Object.assign(new Error(described.message), {
    statusCode: described.statusCode,
    moderation: described.moderation === true,
    retryable: described.retryable === true,
    missingEndpoint: described.missingEndpoint === true
  });
}

function unwrapTask(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.taskId || payload.status) return payload;
  const data = payload.data;
  if (data && typeof data === 'object' && (data.taskId || data.status)) return data;
  return payload;
}

function resultUrl(task) {
  const results = Array.isArray(task?.results) ? task.results : [];
  const hit = results.find((item) => typeof item?.url === 'string' && /^https:\/\//.test(item.url));
  return hit ? hit.url : '';
}

async function readJson(response) {
  try { return await response.json(); }
  catch { return null; }
}

function authHeaders(apiKey, extra) {
  return { Authorization: `Bearer ${apiKey}`, ...extra };
}

export function poolBlocksNewTask(account, threshold = DEFAULT_BALANCE_BLOCK_USD) {
  const money = account?.balance?.money ?? account?.remainMoney;
  if (money === null || money === undefined || money === '') return false;
  const value = Number(money);
  if (!Number.isFinite(value)) return false;
  return value < Number(threshold);
}

export async function uploadReferenceImage({ fetchImpl, config, bytes, mime = 'image/png', filename = 'reference.png' }) {
  if (!config?.apiKey) throw Object.assign(new Error('RunningHub 出图尚未配置'), { statusCode: 503 });
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), filename);
  const uploadBase = config.uploadBaseUrl || config.baseUrl;
  const response = await fetchImpl(`${uploadBase}${UPLOAD_PATH}`, {
    method: 'POST',
    headers: authHeaders(config.apiKey),
    body: form
  });
  const payload = await readJson(response);
  if (!response.ok || businessErrorCode(payload) > 0) throw imageError(response.ok ? 401 : response.status, payload);
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const url = data?.downloadUrl || data?.download_url || data?.url || data?.fileUrl || data?.file_url;
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
    throw Object.assign(new Error('参考图上传未返回可用地址'), { statusCode: 502 });
  }
  return url;
}

async function postTask({ fetchImpl, config, endpoint, body }) {
  const response = await fetchImpl(`${config.baseUrl}${endpoint}`, {
    method: 'POST',
    headers: authHeaders(config.apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  const payload = await readJson(response);
  return { response, payload, task: unwrapTask(payload) };
}

function submitShouldFallback(posted) {
  const http = Number(posted?.response?.status) || 0;
  const code = businessErrorCode(posted?.payload);
  if (http === 404 || code === 1001) return true;
  const taskId = String(posted?.task?.taskId || '').trim();
  return http >= 200 && http < 300 && code === 0 && !taskId;
}

function endpointGiveUp(posted) {
  const http = Number(posted?.response?.status) || 0;
  const code = businessErrorCode(posted?.payload);
  if (http === 404 || code === 1001) return imageError(http === 404 ? 404 : 200, posted?.payload);
  if (!posted?.response?.ok || code > 0) return imageError(posted?.response?.status || 502, posted?.payload);
  return Object.assign(new Error(EMPTY_TASK_MESSAGE), { statusCode: 502, moderation: false });
}

export async function submitAndPoll({ fetchImpl = fetch, config, endpoint, body, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxAttempts = 90, intervalMs = 1000 } = {}) {
  if (!config?.apiKey) throw Object.assign(new Error('RunningHub 出图尚未配置'), { statusCode: 503, moderation: false });
  let currentEndpoint = endpoint;
  let posted = await postTask({ fetchImpl, config, endpoint: currentEndpoint, body });
  let fellBack = false;
  const next = fallbackFor(currentEndpoint);
  if (submitShouldFallback(posted) && next) {
    currentEndpoint = next;
    fellBack = true;
    posted = await postTask({ fetchImpl, config, endpoint: currentEndpoint, body });
  }
  if (submitShouldFallback(posted)) throw endpointGiveUp(posted);
  if (!posted.response.ok || businessErrorCode(posted.payload) > 0) throw imageError(posted.response.status, posted.payload);
  let task = posted.task;
  if (task && String(task.status || '').toUpperCase() === 'FAILED') throw imageError(400, task);
  const taskId = String(task?.taskId || '').trim();
  if (!taskId) throw Object.assign(new Error(EMPTY_TASK_MESSAGE), { statusCode: 502, moderation: false });
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = String(task?.status || '').toUpperCase();
    if (status === 'SUCCESS') {
      const url = resultUrl(task);
      if (!url) throw Object.assign(new Error('出图完成但没有返回图片'), { statusCode: 502, moderation: false });
      const downloaded = await fetchImpl(url);
      if (!downloaded?.ok) throw Object.assign(new Error('出图结果下载失败'), { statusCode: 502, moderation: false });
      const bytes = Buffer.from(await downloaded.arrayBuffer());
      const mime = String(downloaded.headers?.get?.('content-type') || 'image/png').split(';')[0] || 'image/png';
      return {
        taskId,
        imageDataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
        endpoint: currentEndpoint,
        fellBack,
        usage: task.usage || null
      };
    }
    if (status === 'FAILED') throw imageError(400, task);
    if (attempt + 1 >= maxAttempts) break;
    await sleep(intervalMs);
    const queried = await fetchImpl(`${config.baseUrl}${QUERY_PATH}`, {
      method: 'POST',
      headers: authHeaders(config.apiKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ taskId })
    });
    const payload = await readJson(queried);
    if (!queried.ok || businessErrorCode(payload) > 0) throw imageError(queried.status, payload);
    task = unwrapTask(payload) || task;
  }
  throw Object.assign(new Error('出图超时，请稍后重试'), { statusCode: 504, moderation: false });
}

function dataUrlParts(value) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(value || '').trim());
  if (!match) return null;
  return { mime: match[1], bytes: Buffer.from(match[2].replace(/\s/g, ''), 'base64') };
}

export async function prepareImageUrls({ fetchImpl, config, images = [] }) {
  const urls = [];
  for (const item of images) {
    if (!item) continue;
    if (typeof item === 'string' && /^https:\/\//.test(item)) { urls.push(item); continue; }
    const url = typeof item === 'object' ? item.url : '';
    if (typeof url === 'string' && /^https:\/\//.test(url)) { urls.push(url); continue; }
    const dataUrl = typeof item === 'string' ? item : item?.dataUrl;
    const inline = dataUrlParts(dataUrl) || (item?.base64 ? { mime: item.mime || 'image/png', bytes: Buffer.from(String(item.base64), 'base64') } : null);
    if (!inline) throw Object.assign(new Error('参考图格式不受支持'), { statusCode: 400 });
    urls.push(await uploadReferenceImage({ fetchImpl, config, bytes: inline.bytes, mime: inline.mime, filename: item?.filename || 'reference.png' }));
  }
  return urls;
}

async function settleFallback({ charge, request, usageKey, image, prices }) {
  const official = quoteGptImage({ endpoint: image.endpoint, count: 1, prices });
  if (official.perImage < 1 || typeof charge !== 'function') {
    return { success: true, image, charged: 0, quote: official, fellBack: true };
  }
  const settled = await charge({
    userId: request.userId,
    feature: official.feature,
    amount: 1,
    usageKey: `${usageKey}:official`,
    metadata: { model: official.feature, endpoint: image.endpoint, fallback: true },
    run: async () => ({
      success: true,
      amount: 1,
      image,
      metadata: { feature: official.feature, endpoint: image.endpoint, fallback: true }
    })
  });
  return { ...settled, charged: official.perImage, quote: official, fellBack: true, image };
}

export async function runChargedGptImage({ charge, config, request = {}, fetchImpl = fetch, sleep, poolAccount } = {}) {
  const mode = String(request.mode || 'txt2img') === 'img2img' ? 'img2img' : 'txt2img';
  const count = clampCount(request.count || 1);
  const quote = quoteGptImage({
    endpoint: config?.gptImageEndpoint,
    imageEndpoint: config?.gptImageI2iEndpoint,
    mode,
    count,
    prices: config?.prices
  });
  if (poolBlocksNewTask(poolAccount, config?.balanceBlockUsd)) {
    throw Object.assign(new Error('云服务余额不足，请联系管理员。本次未扣积分。'), { statusCode: 402, moderation: false, noCharge: true });
  }
  const images = await prepareImageUrls({ fetchImpl, config, images: request.images || [] });
  const mapped = mapGptImageParams({
    mode,
    prompt: request.prompt,
    settings: request.settings,
    images,
    width: request.width,
    height: request.height,
    endpoint: config?.gptImageEndpoint,
    imageEndpoint: config?.gptImageI2iEndpoint
  });
  const runOne = async (usageKey) => {
    const run = async () => {
      try {
        const image = await submitAndPoll({ fetchImpl, config, endpoint: mapped.endpoint, body: mapped.body, sleep });
        if (image.fellBack) return { success: false, fallback: true, image };
        return { success: true, amount: 1, image, metadata: { feature: quote.feature, endpoint: image.endpoint } };
      } catch (error) {
        if (error?.moderation) return { success: false, moderation: true, message: error.message };
        throw error;
      }
    };
    const finish = async (charged) => {
      if (charged?.fallback && charged.image) {
        return settleFallback({ charge, request, usageKey, image: charged.image, prices: config?.prices });
      }
      const spent = charged?.success === false ? 0 : quote.perImage;
      return { ...charged, charged: spent, quote };
    };
    if (quote.perImage < 1) return finish(await run());
    if (typeof charge !== 'function') throw Object.assign(new Error('在线计量未配置'), { statusCode: 503 });
    const charged = await charge({
      userId: request.userId,
      feature: quote.feature,
      amount: 1,
      usageKey,
      metadata: { model: quote.feature, endpoint: mapped.endpoint },
      run
    });
    return finish(charged);
  };
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const usageKey = count === 1 ? request.usageKey : `${request.usageKey}:${index + 1}`;
    results.push(await runOne(usageKey));
    if (results[index]?.success === false) break;
  }
  const spent = results.reduce((sum, item) => sum + (Number(item?.charged) || 0), 0);
  const last = results[results.length - 1] || {};
  return {
    quote,
    charged: spent,
    remaining: last.quota?.remaining ?? last.quota?.balance ?? last.remaining,
    results,
    mapped
  };
}
