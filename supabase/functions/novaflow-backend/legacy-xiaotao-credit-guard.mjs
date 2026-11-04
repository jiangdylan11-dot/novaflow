// Compatibility guard for the identified 2.0.261 XiaoTao GPT Image route.
// The marker identifies an old UI request; it is not an authentication claim.
export function isLegacyXiaotaoGptImageOptimize(payload) {
  return payload?.surface === 'art' && payload?.purpose === 'optimize'
    && payload?.targetEngine === 'gpt-image-2.5' && payload?.completeVisualBrief === true;
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function validStoredCreditConfig(config) {
  if (!isObject(config) || !isObject(config.prices) || !isObject(config.token_billing)) return false;
  const p = config.prices, t = config.token_billing;
  return isFiniteNonnegative(p.prompt_optimize) && isFiniteNonnegative(p.image_reverse)
    && typeof config.credits_per_usd === 'number' && Number.isFinite(config.credits_per_usd) && config.credits_per_usd > 0
    && typeof t.markup === 'number' && Number.isFinite(t.markup) && t.markup > 0 && t.markup <= 1000
    && ['ceil', 'floor', 'round'].includes(t.round)
    && isFiniteNonnegative(t.min_credits_per_image) && Number.isInteger(t.min_credits_per_image)
    && typeof t.settle_cap_credits === 'number' && Number.isFinite(t.settle_cap_credits)
    && t.settle_cap_credits > 0 && t.min_credits_per_image <= t.settle_cap_credits
    && isObject(t.estimate_credits) && Object.keys(t.estimate_credits).length > 0;
}

// This is a compatibility marker, never an authentication or billing grant.
// The independent UI uses the legacy feature's existing price; XiaoTao's
// decimal operation must use its own operation-scoped charging path instead.
export const INDEPENDENT_UI_CONTRACT = 'independent-ui-v263';

export async function legacyXiaotaoCreditGuard(payload, readConfig, options = {}) {
  const route = options.route || 'prompt-optimize';
  const uiRequest = route === 'ui-catalog' || payload?.surface === 'ui-design'
    || String(payload?.purpose || '').startsWith('ui-design-');
  const legacyArt = route === 'prompt-optimize' && isLegacyXiaotaoGptImageOptimize(payload);
  // Only new requests are stopped. A handler that has already reserved can
  // finish with the pricing snapshot under which that request was accepted.
  if (options.maintenance === true && (route === 'prompt-optimize' || uiRequest)) return 'maintenance';
  if (!legacyArt && !uiRequest) return null;
  let config;
  try { config = await readConfig(); } catch { return 'unavailable'; }
  if (!validStoredCreditConfig(config)) return 'unavailable';
  const locations = [config.xiaotao_online, config.token_billing?.xiaotao_online];
  if (locations.some(value => value != null && !isObject(value))) return 'unavailable';
  // A confirmed older stored schema has no xiaotao_online object at all;
  // the pricing layer supplies its legacy defaults.  Distinguish that schema
  // from a missing/corrupt configuration before allowing legacy requests.
  if (!locations.some(value => isObject(value) && Object.keys(value).length > 0)) {
    return null;
  }
  const policies = locations.filter(value => value != null);
  let decimal = false, legacy = false;
  for (const policy of policies) {
    const hasDecimal = ['credit_amount_policy', 'credit_precision', 'credit_rounding'].some(key => Object.hasOwn(policy, key));
    if (hasDecimal || (policy.minimum_positive_credits != null && policy.minimum_positive_credits !== 1)) {
      if (policy.credit_amount_policy !== 'decimal-v1' || policy.credit_precision !== 6
          || policy.credit_rounding !== 'ceil' || policy.minimum_positive_credits !== 0) return 'unavailable';
      decimal = true;
    } else legacy = true;
  }
  if (decimal && legacy) return 'unavailable';
  if (decimal && (legacyArt || (uiRequest && payload?.foartUiContract !== INDEPENDENT_UI_CONTRACT))) return 'refresh';
  return null;
}
