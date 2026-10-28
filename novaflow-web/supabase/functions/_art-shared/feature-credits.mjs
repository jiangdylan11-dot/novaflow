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
  gpt_image_2_5_economy: 22,
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
  'image-reverse': 'image_reverse',
  image_reverse: 'image_reverse',
  'video-reverse': 'image_reverse',
  'ui-catalog': 'lean_research',
  'lean-research': 'lean_research',
  lean_research: 'lean_research',
  'gpt-image-2.5': 'gpt_image_2_5_economy',
  'gpt-image-2.5-economy': 'gpt_image_2_5_economy',
  gpt_image_2_5: 'gpt_image_2_5_economy',
  gpt_image_2_5_economy: 'gpt_image_2_5_economy',
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
  ['gpt_image_2_5_economy', 'GPT Image 2.5', '每张'],
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
  return {
    prices,
    rh_cost_usd: costs,
    credits_to_cny: Number.isFinite(cny) && cny > 0 ? cny : null,
    low_balance_usd: Number.isFinite(threshold) && threshold >= 0 ? threshold : DEFAULT_LOW_BALANCE_USD,
    low_balance_cny: Number.isFinite(thresholdCny) && thresholdCny >= 0 ? thresholdCny : DEFAULT_LOW_BALANCE_CNY,
    balance_ttl_seconds: Number.isFinite(ttl) && ttl >= 30 ? Math.round(ttl) : DEFAULT_BALANCE_TTL_SECONDS,
    stale_balance_policy: policy === 'block' ? 'block' : DEFAULT_STALE_BALANCE_POLICY,
    credits_per_usd: Number.isFinite(perUsd) && perUsd > 0 ? perUsd : DEFAULT_CREDITS_PER_USD
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
    reserve: async ({ userId, feature, amount, usageKey, metadata }) => {
      const row = await call('reserve_feature_credits', {
        p_user_id: userId,
        p_usage_key: usageKey,
        p_feature: feature,
        p_units: amount,
        p_model: metadata?.model || null,
        p_metadata: metadata || {}
      });
      return {
        status: row?.status,
        idempotent: row?.idempotent === true,
        amount: Number(row?.units ?? amount) || Number(amount) || 0,
        credits: Number(row?.estimated_credits ?? 0)
      };
    },
    settle: async ({ userId, feature, amount, usageKey, metadata }) => call('settle_feature_credits', {
      p_user_id: userId,
      p_usage_key: usageKey,
      p_feature: feature,
      p_actual_units: amount,
      p_model: metadata?.model || null,
      p_metadata: metadata || {}
    }),
    release: async ({ userId, feature, usageKey, reason }) => call('release_feature_credits', {
      p_user_id: userId,
      p_usage_key: usageKey,
      p_feature: feature,
      p_reason: String(reason || 'incomplete').slice(0, 240),
      p_metadata: {}
    })
  };
}
