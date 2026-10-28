// GENERATED COPY - source: packages/shared/src/feature-credits.mjs
// Single credit balance for online features.
// Call sites still pass charge({ feature, amount }). This module is the price
// card and the RPC adapter behind that seam. Local features quote 0 and are
// not reserved. Amount is a call budget for text features and an image count
// for per-image features; the credited units follow the card, not the budget.
//
// credits_to_cny is an admin field and stays empty until an operator fills it.
// CREDITS_PER_USD stays an internal cost coefficient, not a user-facing formula.

export const DEFAULT_LOW_BALANCE_USD = 2;
export const DEFAULT_LOW_BALANCE_CNY = 15;
export const DEFAULT_BALANCE_TTL_SECONDS = 600;
export const DEFAULT_STALE_BALANCE_POLICY = 'allow';
export const DEFAULT_CREDITS_PER_USD = 211;
export const DEFAULT_TOKEN_MARKUP = 2;
export const DEFAULT_SETTLE_CAP_CREDITS = 40;
// Hold for one 小桃 online message. The charge is still ceil(USD × 211 × markup),
// not this table. Text is about one token per two characters, plus a reply
// allowance. Each staged file adds the tokens that kind usually costs the
// model. usd_per_million_tokens turns that into a USD hold. The per-message
// cap is xiaotao_online.message_cap_credits.
export const DEFAULT_XIAOTAO_ONLINE_ESTIMATE = Object.freeze({
  message_cap_credits: 80,
  chars_per_token: 2,
  output_tokens: 512,
  usd_per_million_tokens: 10,
  file_tokens: Object.freeze({ image: 2500, video: 12000, audio: 4000 })
});
// Measured stable-token charges at 211 credits/USD and markup 2, then the
// per-image settle cap. 2k/high raw is 46 and settles at the cap (40).
// 1k/low 3, 1k/medium 6 and 2k/medium 12 stay under the cap.
// Unmeasured cells follow the measured 1k↔2k and medium↔high ratios, then the cap.
export const DEFAULT_ESTIMATE_CREDITS = Object.freeze({
  '1k': Object.freeze({ low: 3, medium: 6, high: 23 }),
  '2k': Object.freeze({ low: 6, medium: 12, high: 40 }),
  '4k': Object.freeze({ low: 12, medium: 24, high: 40 })
});
export const DEFAULT_GPT_IMAGE_ROUTES = Object.freeze({
  text_endpoint: '/openapi/v2/rhart-image-g-2.5-official-token/sunburst/text-to-image',
  image_endpoint: '/openapi/v2/rhart-image-g-2.5/sunburst/image-to-image',
  fallback_text_endpoint: '/openapi/v2/rhart-image-g-2-official/text-to-image',
  fallback_image_endpoint: '/openapi/v2/rhart-image-g-2-official/image-to-image',
  token_markers: Object.freeze(['official-token']),
  text_model: 'rhart-image-g-2.5-official-token',
  image_model: 'rhart-image-g-2.5',
  official_model: 'rhart-image-g-2-official'
});
export const RH_LOW_BALANCE_MESSAGE = '云服务余额不足，请联系管理员';

// credit_ledger.status. A failed or moderated call is released, not a second status.
// reserved: the hold is open and credits.balance is already reduced by estimated_credits.
// settled: the call succeeded; settled_credits is the charge that stays on the balance.
// released: failure, moderation, or cancel. settled_credits is 0 and the hold was returned.
export const LEDGER_STATUSES = Object.freeze({
  reserved: 'hold open; balance reduced by estimated_credits',
  settled: 'success; settled_credits is the charge',
  released: 'failure, moderation, or cancel; settled_credits is 0 and the hold was returned'
});

export const DEFAULT_FEATURE_PRICES = Object.freeze({
  xiaotao_vision: 4,
  online_chat_turn: 4,
  prompt_optimize: 4,
  image_reverse: 4,
  lean_research: 14,
  gpt_image_2_5_economy: 20,
  gpt_image_2_official: 4,
  grok_image_g42: 6,
  local: 0
});

// Published catalog estimates (USD). Not a bill. Stable-token has no public price.
export const DEFAULT_RH_COST_USD = Object.freeze({
  xiaotao_vision: 0.0073,
  online_chat_turn: 0.0034,
  prompt_optimize: 0.0075,
  image_reverse: 0.0073,
  lean_research: 0.0306,
  gpt_image_2_5_economy: 0.05,
  gpt_image_2_official: 0.009,
  grok_image_g42: 0.01,
  local: 0
});

export const PER_IMAGE_FEATURES = Object.freeze([
  'gpt_image_2_5_economy',
  'gpt_image_2_official',
  'grok_image_g42',
  'gpt_image_2_5_token'
]);

const ALIASES = Object.freeze({
  'xiaotao-vision': 'xiaotao_vision',
  xiaotao_vision: 'xiaotao_vision',
  'xiaotao-text': 'online_chat_turn',
  'online-chat-turn': 'online_chat_turn',
  online_chat_turn: 'online_chat_turn',
  'prompt-optimize': 'prompt_optimize',
  prompt_optimize: 'prompt_optimize',
  // One charge per call. A caller's amount is a provider retry budget, not a
  // per-image multiplier, until this key is listed in PER_IMAGE_FEATURES.
  'image-reverse': 'image_reverse',
  image_reverse: 'image_reverse',
  'video-reverse': 'image_reverse',
  // Same price as image reverse. The charge call still sends image-reverse;
  // this alias lets a quote name the AIFX material job without a new price key.
  'aifx-material': 'image_reverse',
  aifx_material: 'image_reverse',
  'ui-catalog': 'lean_research',
  'lean-research': 'lean_research',
  lean_research: 'lean_research',
  'gpt-image-2.5': 'gpt_image_2_5_economy',
  'gpt-image-2.5-economy': 'gpt_image_2_5_economy',
  gpt_image_2_5: 'gpt_image_2_5_economy',
  gpt_image_2_5_economy: 'gpt_image_2_5_economy',
  'gpt-image-2.5-token': 'gpt_image_2_5_token',
  gpt_image_2_5_token: 'gpt_image_2_5_token',
  'gpt-image-2': 'gpt_image_2_official',
  gpt_image_2: 'gpt_image_2_official',
  gpt_image_2_official: 'gpt_image_2_official',
  'g-4.2': 'grok_image_g42',
  'grok-image-g42': 'grok_image_g42',
  grok_image_g42: 'grok_image_g42',
  local: 'local'
});

export const FEATURE_PRICE_FIELDS = Object.freeze([
  ['xiaotao_vision', '小桃在线理解', '每次'],
  ['online_chat_turn', '在线对话', '每次'],
  ['prompt_optimize', '提示词优化', '每次'],
  ['image_reverse', '图像反推', '每图'],
  ['lean_research', 'UI 目录分析', '每轮'],
  ['gpt_image_2_5_economy', 'GPT Image 2.5 图生图', '每张'],
  ['gpt_image_2_official', 'GPT Image 2 官方', '每张'],
  ['grok_image_g42', 'g-4.2 出图', '每张'],
  ['local', '本地', '不扣']
]);

export const LEDGER_CSV_COLUMNS = Object.freeze([
  'created_at', 'settled_at', 'user_id', 'user_email_or_account', 'feature', 'model', 'status',
  'estimated_credits', 'settled_credits', 'balance_after', 'rh_cost_usd', 'rh_cost_currency',
  'usage_key', 'error_code'
]);

export function canonicalFeature(feature) {
  const raw = String(feature || '').trim();
  if (!raw) return '';
  if (raw === 'local' || raw.startsWith('local_') || raw.startsWith('local-')) return 'local';
  if (Object.prototype.hasOwnProperty.call(ALIASES, raw)) return ALIASES[raw];
  const underscored = raw.replace(/-/g, '_');
  if (Object.prototype.hasOwnProperty.call(ALIASES, underscored)) return ALIASES[underscored];
  return underscored;
}

export function isLocalFeature(feature) {
  return canonicalFeature(feature) === 'local';
}

const ESTIMATE_RESOLUTIONS = ['1k', '2k', '4k'];
const ESTIMATE_QUALITIES = ['low', 'medium', 'high'];
const GPT_ENDPOINT_PATH = /^\/openapi\/v2\/[a-zA-Z0-9_./-]+$/;

function normalizeSettleCap(value) {
  const amount = Math.round(Number(value));
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) return DEFAULT_SETTLE_CAP_CREDITS;
  return amount;
}

function normalizeEstimateCredits(value, cap) {
  const stored = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  for (const resolution of ESTIMATE_RESOLUTIONS) {
    const row = stored[resolution] && typeof stored[resolution] === 'object' ? stored[resolution] : {};
    const next = {};
    for (const quality of ESTIMATE_QUALITIES) {
      const amount = Math.round(Number(row[quality]));
      const fallback = DEFAULT_ESTIMATE_CREDITS[resolution][quality];
      const chosen = Number.isInteger(amount) && amount >= 0 && amount <= 1000000 ? amount : fallback;
      next[quality] = Math.min(cap, chosen);
    }
    out[resolution] = next;
  }
  return out;
}

function normalizeRoute(value, fallback) {
  const text = String(value || '').trim();
  if (!text || !GPT_ENDPOINT_PATH.test(text) || text.split('/').includes('..')) return fallback;
  return text;
}

function normalizeModelId(value, fallback) {
  const text = String(value || '').trim();
  if (!text || text.length > 200 || /[\r\n\0]/.test(text)) return fallback;
  return text;
}

function normalizeTokenMarkers(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const markers = [];
  for (const item of list) {
    const text = String(item || '').trim();
    if (!text || text.length > 80 || !/^[a-zA-Z0-9_.-]+$/.test(text)) continue;
    markers.push(text);
  }
  return markers.length ? markers : [...DEFAULT_GPT_IMAGE_ROUTES.token_markers];
}

function normalizeTokenBilling(input, cap) {
  const stored = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const markup = Number(stored.markup);
  const round = String(stored.round || '').trim().toLowerCase();
  const minRaw = Math.round(Number(stored.min_credits_per_image));
  const minCredits = Number.isInteger(minRaw) && minRaw >= 0 && minRaw <= cap ? minRaw : 1;
  return {
    markup: Number.isFinite(markup) && markup > 0 && markup <= 1000 ? markup : DEFAULT_TOKEN_MARKUP,
    round: round === 'round' || round === 'floor' ? round : 'ceil',
    min_credits_per_image: minCredits,
    settle_cap_credits: cap,
    estimate_credits: normalizeEstimateCredits(stored.estimate_credits, cap)
  };
}

function normalizeGptImageRoutes(input) {
  const stored = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    text_endpoint: normalizeRoute(stored.text_endpoint, DEFAULT_GPT_IMAGE_ROUTES.text_endpoint),
    image_endpoint: normalizeRoute(stored.image_endpoint, DEFAULT_GPT_IMAGE_ROUTES.image_endpoint),
    fallback_text_endpoint: normalizeRoute(stored.fallback_text_endpoint, DEFAULT_GPT_IMAGE_ROUTES.fallback_text_endpoint),
    fallback_image_endpoint: normalizeRoute(stored.fallback_image_endpoint, DEFAULT_GPT_IMAGE_ROUTES.fallback_image_endpoint),
    token_markers: normalizeTokenMarkers(stored.token_markers),
    text_model: normalizeModelId(stored.text_model, DEFAULT_GPT_IMAGE_ROUTES.text_model),
    image_model: normalizeModelId(stored.image_model, DEFAULT_GPT_IMAGE_ROUTES.image_model),
    official_model: normalizeModelId(stored.official_model, DEFAULT_GPT_IMAGE_ROUTES.official_model)
  };
}

export function normalizeCreditConfig(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const stored = input.prices && typeof input.prices === 'object' && !Array.isArray(input.prices) ? input.prices : {};
  const prices = { ...DEFAULT_FEATURE_PRICES };
  for (const [key, amount] of Object.entries(stored)) {
    const canonical = canonicalFeature(key);
    if (!/^[a-z0-9_]+$/.test(canonical)) continue;
    if (amount === '' || amount == null) continue;
    const n = Math.round(Number(amount));
    if (Number.isInteger(n) && n >= 0 && n <= 1000000) prices[canonical] = n;
  }
  prices.local = 0;
  delete prices.gpt_image_2_5_token;
  const costs = { ...DEFAULT_RH_COST_USD };
  const storedCosts = input.rh_cost_usd && typeof input.rh_cost_usd === 'object' ? input.rh_cost_usd : {};
  for (const [key, amount] of Object.entries(storedCosts)) {
    const canonical = canonicalFeature(key);
    const n = Number(amount);
    if (Number.isFinite(n) && n >= 0) costs[canonical] = n;
  }
  costs.local = 0;
  const cnyRaw = input.credits_to_cny;
  const cny = cnyRaw === '' || cnyRaw == null ? null : Number(cnyRaw);
  const threshold = Number(input.low_balance_usd);
  const thresholdCny = Number(input.low_balance_cny);
  const ttl = Number(input.balance_ttl_seconds);
  const perUsd = Number(input.credits_per_usd);
  const policy = String(input.stale_balance_policy || '').trim().toLowerCase();
  const settleCap = normalizeSettleCap(input.token_billing?.settle_cap_credits ?? input.settle_cap_credits);
  return {
    prices,
    rh_cost_usd: costs,
    credits_to_cny: Number.isFinite(cny) && cny > 0 ? cny : null,
    low_balance_usd: Number.isFinite(threshold) && threshold >= 0 ? threshold : DEFAULT_LOW_BALANCE_USD,
    low_balance_cny: Number.isFinite(thresholdCny) && thresholdCny >= 0 ? thresholdCny : DEFAULT_LOW_BALANCE_CNY,
    balance_ttl_seconds: Number.isFinite(ttl) && ttl >= 30 ? Math.round(ttl) : DEFAULT_BALANCE_TTL_SECONDS,
    stale_balance_policy: policy === 'block' ? 'block' : DEFAULT_STALE_BALANCE_POLICY,
    credits_per_usd: Number.isFinite(perUsd) && perUsd > 0 ? perUsd : DEFAULT_CREDITS_PER_USD,
    token_billing: normalizeTokenBilling(input.token_billing, settleCap),
    gpt_image: normalizeGptImageRoutes(input.gpt_image),
    xiaotao_online: normalizeXiaotaoOnline(input.xiaotao_online || input.token_billing?.xiaotao_online)
  };
}

function clampOnlineInt(value, min, max, fallback) {
  const amount = Math.round(Number(value));
  return Number.isInteger(amount) && amount >= min && amount <= max ? amount : fallback;
}

export function xiaotaoOnlinePolicy(config) {
  return normalizeCreditConfig(config).xiaotao_online;
}

function normalizeXiaotaoOnline(input) {
  const stored = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const files = stored.file_tokens && typeof stored.file_tokens === 'object' ? stored.file_tokens : {};
  const defaults = DEFAULT_XIAOTAO_ONLINE_ESTIMATE;
  const usd = Number(stored.usd_per_million_tokens);
  return {
    message_cap_credits: clampOnlineInt(stored.message_cap_credits, 1, 1000000, defaults.message_cap_credits),
    chars_per_token: clampOnlineInt(stored.chars_per_token, 1, 100, defaults.chars_per_token),
    output_tokens: clampOnlineInt(stored.output_tokens, 0, 100000, defaults.output_tokens),
    usd_per_million_tokens: Number.isFinite(usd) && usd >= 0 && usd <= 1000 ? usd : defaults.usd_per_million_tokens,
    file_tokens: {
      image: clampOnlineInt(files.image, 0, 1000000, defaults.file_tokens.image),
      video: clampOnlineInt(files.video, 0, 1000000, defaults.file_tokens.video),
      audio: clampOnlineInt(files.audio, 0, 1000000, defaults.file_tokens.audio)
    }
  };
}

export function xiaotaoFileKind(file) {
  const kind = String(file?.kind || '').toLowerCase();
  if (kind === 'video' || kind === 'audio' || kind === 'image') return kind;
  const name = String(file?.name || '').toLowerCase();
  if (/\.(mp4|mov|webm)$/.test(name)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(name)) return 'audio';
  return file ? 'image' : '';
}

// Reservation only. A longer message or a heavier file raises the hold because
// it is expected to use more tokens. Nothing here is a flat per-file fee.
export function estimateXiaotaoOnlineCredits({ text = '', history = '', files = [], config } = {}) {
  const policy = xiaotaoOnlinePolicy(config);
  const chars = String(text || '').length + String(history || '').length;
  let tokens = Math.ceil(chars / policy.chars_per_token) + policy.output_tokens;
  const counts = { image: 0, video: 0, audio: 0 };
  for (const file of Array.isArray(files) ? files : []) {
    const kind = xiaotaoFileKind(file);
    if (!kind) continue;
    counts[kind] += 1;
    tokens += policy.file_tokens[kind];
  }
  const usd = tokens / 1000000 * policy.usd_per_million_tokens;
  const raw = creditsFromUsd(usd, config);
  const active = chars > 0 || counts.image + counts.video + counts.audio > 0;
  const credits = active ? Math.max(1, Math.min(policy.message_cap_credits, Math.max(0, raw || 0))) : 0;
  return { tokens, usd, rawCredits: raw, credits, counts, cap: policy.message_cap_credits };
}

// 多退少补: the desired charge is the actual USD amount, bounded by the
// per-message cap, and is allowed to exceed the reservation. The SQL settlement
// refunds the surplus or tops up the shortfall without taking the balance negative.
// A missing usage record still charges the reserved estimate.
export function settleXiaotaoOnlineCredits({ usage, reservedCredits, config } = {}) {
  const policy = xiaotaoOnlinePolicy(config);
  const normalized = normalizeCreditConfig(config);
  const cap = policy.message_cap_credits;
  const reserved = Math.max(0, Math.round(Number(reservedCredits) || 0));
  const parsed = parseUsageUsd(usage);
  const usd = parsed.usd;
  const base = {
    tokens: tokenUsageRecord(usage),
    money: usage && typeof usage === 'object' ? (usage.thirdPartyConsumeMoney ?? null) : null,
    consumeMoney: usage && typeof usage === 'object' ? (usage.consumeMoney ?? null) : null,
    moneySource: parsed.source || null,
    usdCost: usd,
    creditsPerUsd: normalized.credits_per_usd,
    markup: normalized.token_billing.markup,
    settleCap: cap,
    reservedCredits: reserved
  };
  if (usd == null) {
    const credits = Math.min(reserved, cap);
    return {
      ...base,
      rawCredits: null,
      credits,
      capped: reserved > cap,
      settleCapped: reserved > cap,
      reserveCapped: false,
      toppedUp: false,
      shortfall: 0,
      refund: Math.max(0, reserved - credits),
      pricingSource: 'estimate_cap',
      usageMissing: true,
      warning: reserved > cap
        ? `thirdPartyConsumeMoney and consumeMoney missing; charging reserved estimate capped at ${credits}`
        : 'thirdPartyConsumeMoney and consumeMoney missing; charging reserved estimate'
    };
  }
  const raw = creditsFromUsd(usd, normalized);
  const credits = Math.min(raw, cap);
  const toppedUp = credits > reserved;
  return {
    ...base,
    rawCredits: raw,
    credits,
    capped: credits < raw,
    settleCapped: raw > cap,
    reserveCapped: false,
    toppedUp,
    shortfall: toppedUp ? credits - reserved : 0,
    refund: credits < reserved ? reserved - credits : 0,
    pricingSource: 'rh_consume_money',
    usageMissing: false,
    warning: raw > cap ? `token charge capped at ${cap}: raw ${raw}, charging ${credits}` : ''
  };
}

export function creditsFromUsd(usd, config) {
  let money = usd;
  if (typeof money === 'string') {
    const text = money.trim();
    if (!text || !/^\d+(\.\d+)?$/.test(text)) return null;
    money = Number(text);
  }
  money = Number(money);
  if (!Number.isFinite(money) || money < 0) return null;
  const normalized = normalizeCreditConfig(config);
  if (money === 0) return 0;
  const raw = money * normalized.credits_per_usd * normalized.token_billing.markup;
  const mode = normalized.token_billing.round;
  let credits = mode === 'floor' ? Math.floor(raw + 1e-9) : mode === 'round' ? Math.round(raw) : Math.ceil(raw - 1e-9);
  if (!Number.isFinite(credits)) return null;
  return Math.max(normalized.token_billing.min_credits_per_image, credits);
}

function parseUsdField(raw) {
  if (raw == null || typeof raw === 'object') return null;
  const text = String(raw).trim();
  if (!text || text.toLowerCase() === 'null' || !/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseThirdPartyUsd(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return parseUsdField(usage.thirdPartyConsumeMoney);
}

// Prefer the provider's third-party USD, then the channel's own consumeMoney.
export function parseUsageUsd(usage) {
  if (!usage || typeof usage !== 'object') return { usd: null, source: '' };
  const thirdParty = parseUsdField(usage.thirdPartyConsumeMoney);
  if (thirdParty != null) return { usd: thirdParty, source: 'thirdPartyConsumeMoney' };
  const consume = parseUsdField(usage.consumeMoney);
  if (consume != null) return { usd: consume, source: 'consumeMoney' };
  return { usd: null, source: '' };
}

export function tokenUsageRecord(usage) {
  const raw = usage && typeof usage === 'object' ? (usage.tokenUsage || usage.token_usage) : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const pick = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens', 'input_tokens_details', 'output_tokens_details']) {
    if (raw[key] != null) pick[key] = raw[key];
  }
  if (!Object.keys(pick).length) return null;
  try {
    if (JSON.stringify(pick).length > 4000) return null;
  } catch {
    return null;
  }
  return pick;
}

function estimateResolution(value) {
  const key = String(value || '').trim().toLowerCase();
  return ESTIMATE_RESOLUTIONS.includes(key) ? key : '2k';
}

function estimateQuality(value) {
  const key = String(value || '').trim().toLowerCase();
  return ESTIMATE_QUALITIES.includes(key) ? key : 'medium';
}

export function estimateTokenImageCredits({ resolution, quality, count = 1, previewUsd, config } = {}) {
  const normalized = normalizeCreditConfig(config);
  const cap = normalized.token_billing.settle_cap_credits;
  const tier = estimateResolution(resolution);
  const level = estimateQuality(quality);
  let perImage = Math.min(cap, Math.max(0, Math.round(Number(normalized.token_billing.estimate_credits[tier][level]) || 0)));
  if (previewUsd != null && previewUsd !== '') {
    const previewCredits = creditsFromUsd(previewUsd, normalized);
    if (previewCredits != null) perImage = Math.min(cap, Math.max(perImage, previewCredits));
  }
  const images = Math.max(1, Math.min(100, Math.round(Number(count)) || 1));
  return {
    resolution: tier,
    quality: level,
    perImage,
    count: images,
    credits: perImage * images,
    settleCap: cap
  };
}

// Final charge is min(ceil(USD × credits_per_usd × markup), settle cap, reserved).
// Money is thirdPartyConsumeMoney, then consumeMoney. If both are missing, charge
// the reserved estimate (never above the settle cap) and set a warning.
export function settleTokenImageCredits({ usage, reservedCredits, config } = {}) {
  const normalized = normalizeCreditConfig(config);
  const cap = normalized.token_billing.settle_cap_credits;
  const reserved = Math.max(0, Math.round(Number(reservedCredits) || 0));
  const parsed = parseUsageUsd(usage);
  const usd = parsed.usd;
  const base = {
    tokens: tokenUsageRecord(usage),
    money: usage && typeof usage === 'object' ? (usage.thirdPartyConsumeMoney ?? null) : null,
    consumeMoney: usage && typeof usage === 'object' ? (usage.consumeMoney ?? null) : null,
    moneySource: parsed.source || null,
    usdCost: usd,
    creditsPerUsd: normalized.credits_per_usd,
    markup: normalized.token_billing.markup,
    settleCap: cap,
    reservedCredits: reserved
  };
  if (usd == null) {
    const credits = Math.min(reserved, cap);
    const settleCapped = reserved > cap;
    return {
      ...base,
      rawCredits: null,
      credits,
      capped: settleCapped,
      settleCapped,
      reserveCapped: false,
      pricingSource: 'estimate_cap',
      usageMissing: true,
      warning: settleCapped
        ? `thirdPartyConsumeMoney and consumeMoney missing; charging reserved estimate capped at ${credits}`
        : 'thirdPartyConsumeMoney and consumeMoney missing; charging reserved estimate'
    };
  }
  const raw = creditsFromUsd(usd, normalized);
  const settleCapped = raw > cap;
  const reserveCapped = raw > reserved;
  const credits = Math.min(raw, cap, reserved);
  return {
    ...base,
    rawCredits: raw,
    credits,
    capped: credits < raw,
    settleCapped,
    reserveCapped,
    pricingSource: 'rh_consume_money',
    usageMissing: false,
    warning: settleCapped || reserveCapped
      ? `token charge capped: raw ${raw}, settle cap ${cap}, reserved ${reserved}, charging ${credits}`
      : ''
  };
}

export function tokenPricingDetails({ decision, endpoint, taskId, resolution, quality, model, count = 1 } = {}) {
  return {
    billing_mode: 'token',
    resolution: resolution || null,
    quality: quality || null,
    count,
    endpoint: endpoint || null,
    task_id: taskId || null,
    model: model || null,
    token_usage: decision?.tokens || null,
    third_party_consume_money: decision?.money ?? null,
    consume_money: decision?.consumeMoney ?? null,
    money_source: decision?.moneySource || null,
    usd_cost: decision?.usdCost ?? null,
    credits_per_usd: decision?.creditsPerUsd ?? null,
    markup: decision?.markup ?? null,
    settle_cap_credits: decision?.settleCap ?? null,
    raw_credits: decision?.rawCredits ?? null,
    estimated_credits: decision?.reservedCredits ?? null,
    settled_credits: decision?.credits ?? null,
    capped: decision?.capped === true,
    settle_capped: decision?.settleCapped === true,
    reserve_capped: decision?.reserveCapped === true,
    usage_missing: decision?.usageMissing === true,
    pricing_source: decision?.pricingSource || null,
    fallback: false
  };
}

export function quoteFeature({ feature, units = 1, prices } = {}) {
  const key = canonicalFeature(feature);
  const config = normalizeCreditConfig(prices && prices.prices ? prices : { prices });
  const table = config.prices;
  const perImage = PER_IMAGE_FEATURES.includes(key);
  const count = perImage ? Math.max(1, Math.min(100, Math.round(Number(units)) || 1)) : 1;
  if (!key || key === 'local') {
    return { feature: 'local', units: count, unitPrice: 0, credits: 0, rhCostUsd: 0, local: true, perImage: false };
  }
  if (!Object.prototype.hasOwnProperty.call(table, key) || table[key] == null) {
    return { feature: key, units: count, unitPrice: null, credits: null, rhCostUsd: null, local: false, perImage, unpriced: true };
  }
  const unitPrice = Math.max(0, Math.round(Number(table[key])));
  const unitCost = Number(config.rh_cost_usd[key] || 0);
  return {
    feature: key,
    units: count,
    unitPrice,
    credits: unitPrice * count,
    rhCostUsd: Math.round(unitCost * count * 1e8) / 1e8,
    local: unitPrice === 0,
    perImage,
    unpriced: false
  };
}

export function creditsFromRemainingCount(remaining, price = DEFAULT_FEATURE_PRICES.xiaotao_vision) {
  const count = Math.max(0, Number(remaining) || 0);
  const unit = Number(price);
  if (!Number.isFinite(unit) || unit < 0) return 0;
  return Math.ceil(count * unit - 1e-9);
}

export function balanceCacheFresh({ checkedAt, ttlSeconds = DEFAULT_BALANCE_TTL_SECONDS, now = Date.now() } = {}) {
  const ttl = Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds) >= 30 ? Number(ttlSeconds) : DEFAULT_BALANCE_TTL_SECONDS;
  if (checkedAt == null || checkedAt === '') return { fresh: false, stale: true, missing: true, ttlSeconds: ttl };
  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at)) return { fresh: false, stale: true, missing: true, ttlSeconds: ttl };
  const ageMs = now - at;
  const fresh = ageMs >= 0 && ageMs <= ttl * 1000;
  return { fresh, stale: !fresh, missing: false, ageMs, ttlSeconds: ttl };
}

// A direct reading (cache omitted) compares the money now. A stored domestic
// snapshot (cache: true) blocks only while checkedAt is inside the TTL.
// Missing or stale cache follows stalePolicy: allow (default, warn) or block.
export function lowBalanceState({
  remainMoney,
  currency,
  thresholdUsd = DEFAULT_LOW_BALANCE_USD,
  thresholdCny = DEFAULT_LOW_BALANCE_CNY,
  checkedAt,
  ttlSeconds = DEFAULT_BALANCE_TTL_SECONDS,
  stalePolicy = DEFAULT_STALE_BALANCE_POLICY,
  cache = false,
  now
} = {}) {
  const usd = Number.isFinite(Number(thresholdUsd)) && Number(thresholdUsd) >= 0 ? Number(thresholdUsd) : DEFAULT_LOW_BALANCE_USD;
  const cny = Number.isFinite(Number(thresholdCny)) && Number(thresholdCny) >= 0 ? Number(thresholdCny) : DEFAULT_LOW_BALANCE_CNY;
  const policy = String(stalePolicy || '').toLowerCase() === 'block' ? 'block' : 'allow';
  const cur = String(currency || '').trim().toUpperCase();
  const freshness = balanceCacheFresh({ checkedAt, ttlSeconds, now });
  if (cache && !freshness.fresh) {
    return {
      known: false, blocked: policy === 'block', warn: true, stale: true, missing: freshness.missing,
      stalePolicy: policy, currency: cur || 'USD', thresholdUsd: usd, thresholdCny: cny, remainMoney: null
    };
  }
  const money = remainMoney == null || remainMoney === '' ? null : Number(remainMoney);
  if (!Number.isFinite(money)) {
    return { known: false, blocked: false, warn: Boolean(cache), stale: false, currency: cur || 'USD', thresholdUsd: usd, thresholdCny: cny };
  }
  const threshold = cur === 'CNY' ? cny : usd;
  const comparable = cur === '' || cur === 'USD' || cur === 'CNY';
  const below = money <= 0 || (comparable && money < threshold);
  return {
    known: true, blocked: below, warn: below || !comparable, stale: false, missing: false,
    currency: cur || 'USD', remainMoney: money, thresholdUsd: usd, thresholdCny: cny, threshold, comparable
  };
}

export async function collectPages(fetchPage, pageSize = 500) {
  const size = Math.max(1, Math.min(1000, Math.round(Number(pageSize)) || 500));
  const rows = [];
  let offset = 0;
  for (;;) {
    const batch = await fetchPage({ offset, limit: size });
    const list = Array.isArray(batch) ? batch : [];
    rows.push(...list);
    if (list.length < size) return rows;
    offset += list.length;
  }
}

export function ledgerUserLookup(userText) {
  const user = String(userText || '').trim();
  if (!user) return null;
  if (/^[0-9a-f-]{36}$/i.test(user)) return { id: user };
  return {
    email: user.includes('@') ? user : `${user}@accounts.novaflow.local`,
    displayName: user
  };
}

export function publicCreditError(message) {
  const text = String(message || '');
  if (text.includes('云服务余额不足')) return RH_LOW_BALANCE_MESSAGE;
  if (text.includes('积分迁移维护中')) return '积分迁移维护中，请稍后再试';
  if (text.includes('单价未配置')) return '该功能积分单价未配置';
  if (text.includes('积分不足或暂时不可用')) return '积分不足或暂时不可用';
  if (text.includes('积分不足')) return '积分不足';
  return '积分不足或暂时不可用';
}

export function ledgerCsv(rows) {
  const esc = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [LEDGER_CSV_COLUMNS.join(',')];
  for (const row of rows || []) lines.push(LEDGER_CSV_COLUMNS.map((key) => esc(row[key])).join(','));
  return `\uFEFF${lines.join('\n')}\n`;
}

export function createFeatureCreditPorts(rpc) {
  if (typeof rpc !== 'function') throw new Error('在线计量未配置');
  const call = async (name, args) => {
    try {
      return await rpc(name, args);
    } catch (error) {
      const wrapped = new Error(publicCreditError(error?.message || error));
      wrapped.statusCode = 402;
      if (String(error?.message || '').includes('云服务余额不足')) wrapped.code = 'rh_low_balance';
      throw wrapped;
    }
  };
  return {
    reserve: async ({ userId, feature, amount, usageKey, metadata, estimatedCredits }) => {
      const args = {
        p_user_id: userId,
        p_usage_key: usageKey,
        p_feature: feature,
        p_units: amount,
        p_model: metadata?.model || null,
        p_metadata: metadata || {}
      };
      if (estimatedCredits != null && estimatedCredits !== '') args.p_estimated_credits = estimatedCredits;
      const row = await call('reserve_feature_credits', args);
      return {
        status: row?.status,
        idempotent: row?.idempotent === true,
        amount: Number(row?.units ?? amount) || Number(amount) || 0,
        credits: Number(row?.estimated_credits ?? estimatedCredits ?? 0)
      };
    },
    settle: async ({ userId, feature, amount, usageKey, metadata, settledCredits, rhCostUsd, pricingSource }) => {
      const args = {
        p_user_id: userId,
        p_usage_key: usageKey,
        p_feature: feature,
        p_actual_units: amount,
        p_model: metadata?.model || null,
        p_metadata: metadata || {}
      };
      if (settledCredits != null && settledCredits !== '' && Number.isFinite(Number(settledCredits))) {
        args.p_settled_credits = Number(settledCredits);
      }
      if (rhCostUsd != null && rhCostUsd !== '' && Number.isFinite(Number(rhCostUsd)) && Number(rhCostUsd) >= 0) {
        args.p_rh_cost_usd = Number(rhCostUsd);
      }
      if (pricingSource) args.p_pricing_source = String(pricingSource).slice(0, 40);
      return call('settle_feature_credits', args);
    },
    release: async ({ userId, feature, usageKey, reason }) => call('release_feature_credits', {
      p_user_id: userId,
      p_usage_key: usageKey,
      p_feature: feature,
      p_reason: String(reason || 'incomplete').slice(0, 240),
      p_metadata: {}
    })
  };
}
