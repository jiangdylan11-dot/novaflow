import {normalizeCreditConfig} from './feature-credits.mjs';
import {RELEASE_VERSION} from './release.mjs';

const EXTRA_MODELS = Object.freeze(['glm/glm-5.3-flash','openai/gpt-6.1-sol-saver']);
const GROK = 'xai/grok-4.7';
const DEEPSEEK = 'deepseek/deepseek-v4.1-flash';
const RETIRED_GLM = 'glm/glm-5.3-flash';
export const COMPANION_OUTPUT_TOKENS = 2048;
export function companionProviderRevision(provider) {
  const rev=provider?.configRevision;
  return typeof rev==='string' && /^[1-9]\d{0,18}$/.test(rev) ? rev : null;
}

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}

// Construct only a public allowlist, never return provider credentials or URL.
// Keep the normalized configuration identical to the values used for reserve
// and settlement. A content hash also invalidates quotes on capability changes.
// 272 is a parser-only release using 265's verified pricing contract.
// Future releases must use their own revision; explicit overrides remain unchanged.
const DEFAULT_PRICING_REVISION = ['2.0.272','2.0.275','2.0.276','2.0.277','2.0.278','2.0.279','2.0.280','2.0.281','2.0.282','2.0.283','2.0.284','2.0.285'].includes(RELEASE_VERSION) ? '2.0.265' : RELEASE_VERSION;
export async function companionPricingPolicy(provider = {}, {revision=DEFAULT_PRICING_REVISION} = {}) {
  const normalized = normalizeCreditConfig(provider.creditConfig);
  const config = {
    credits_per_usd: normalized.credits_per_usd,
    token_billing: {
      round: normalized.token_billing.round,
      min_credits_per_image: normalized.token_billing.min_credits_per_image,
      settle_cap_credits: normalized.token_billing.settle_cap_credits
    },
    xiaotao_online: {...normalized.xiaotao_online, output_tokens:COMPANION_OUTPUT_TOKENS}
  };
  const amountConfig = provider.creditConfig?.xiaotao_online;
  const amountKeys = ['credit_amount_policy','credit_precision','credit_rounding'];
  const decimalRequested = amountKeys.some(key => amountConfig != null && Object.hasOwn(amountConfig,key))
    || (amountConfig != null && Object.hasOwn(amountConfig,'minimum_positive_credits') && amountConfig.minimum_positive_credits !== 1)
    || provider.operationDecimalCreditsV1 === true || provider.operationDecimalLedgerReady === true;
  const decimalReady = provider.operationTextChatV3 === true
    && provider.operationDecimalCreditsV1 === true && provider.operationDecimalLedgerReady === true
    && amountConfig?.credit_amount_policy === 'decimal-v1' && amountConfig?.credit_precision === 6
    && amountConfig?.credit_rounding === 'ceil' && amountConfig?.minimum_positive_credits === 0;
  // Only a trusted server assembly with the v3 handlers may opt in. Include
  // the capability inside the versioned snapshot, never as an unhashed flag.
  if(provider.operationTextChatV3===true) {
    // The new amount policy is intentionally default-closed.  The readiness
    // signals are server-owned and must never be read from a request body or
    // inferred from the ordinary database setting alone.  Existing snapshots
    // retain their old shape and minimum until both the code and the decimal
    // ledger contract have been explicitly enabled and verified.
    Object.assign(config.xiaotao_online, {
      billing_scope:'operation',minimum_positive_credits:decimalReady?0:1,operation_text_chat_v3:true,
      ...(decimalReady ? {credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil'} : {})
    });
  }
  if(provider.operationTextChatV3===true && provider.operationStyleV3===true) {
    config.xiaotao_online.operation_style_v3=true;
    config.xiaotao_online.operation_style_vision_models=Array.isArray(provider.operationStyleVisionModels)?[...provider.operationStyleVisionModels]:[];
  }
  if(provider.operationTextChatV3===true && provider.operationVideoRewriteV3===true)
    config.xiaotao_online.operation_video_rewrite_v3=true;
  if(provider.operationTextChatV3===true && provider.operationAudioRewriteV3===true)
    config.xiaotao_online.operation_audio_rewrite_v3=true;
  if(provider.operationTextChatV3===true && provider.operationVisionChatV3===true)
    config.xiaotao_online.operation_vision_chat_v3=true;
  if(provider.operationTextChatV3===true && provider.operationUiDraftV3===true)
    config.xiaotao_online.operation_ui_draft_v3=true;
  if(provider.operationTextChatV3===true && provider.operationFoartOpenV3===true)
    config.xiaotao_online.operation_foart_open_v3=true;
  if(provider.operationTextChatV3===true && provider.operationFoartOpenV3===true && provider.operationFoartGeneralV3===true)
    config.xiaotao_online.operation_foart_general_v3=true;
  if(provider.operationArtV3===true)config.xiaotao_online.operation_art_v3=true;
  // Until a DB-backed pricing snapshot is atomically bound to reserve and
  // settlement, a versioned quote must not be represented as chargeable.
  const providerRevision=companionProviderRevision(provider);
  // A partially installed decimal contract cannot silently fall back to a
  // legacy integer quote: disable new charges until the trusted ledger is ready.
  const configured = Boolean(provider.apiKey) && provider.pricingSnapshotReady === true && providerRevision !== null
    && (!decimalRequested || decimalReady);
  const defaultModel = String(provider.model || '');
  const configuredExtras = Array.isArray(provider.creditConfig?.xiaotao_online?.enabled_models)
    ? provider.creditConfig.xiaotao_online.enabled_models : [];
  const models = [
    {id:GROK, available:configured && (defaultModel === GROK || (provider.operationTextChatV3 === true && configuredExtras.includes(GROK)))},
    ...EXTRA_MODELS.map(id => ({id, available:configured && id !== RETIRED_GLM && configuredExtras.includes(id)})),
    {id:DEEPSEEK, available:configured && provider.operationTextChatV3 === true && configuredExtras.includes(DEEPSEEK)},
    {id:'legacy-online', available:configured && (defaultModel === GROK || (defaultModel !== RETIRED_GLM && EXTRA_MODELS.includes(defaultModel) && configuredExtras.includes(defaultModel)))}
  ];
  // Bump schema whenever estimation or request canonicalization changes;
  // the release revision also changes on each deployment per project policy.
  const snapshot = {schema:'nf.xiaotao.pricing.v1', revision, providerRevision, defaultModel, config, models};
  return {...snapshot, version:await digest(snapshot), expiresAt:Date.now()+60000};
}

// Bind a quote to the exact submitted content without storing that content.
export async function companionQuoteFingerprint(payload, pricingVersion) {
  const body = Object.fromEntries(Object.entries(payload || {})
    .filter(([key]) => key !== 'pricingVersion' && key !== 'quoteFingerprint')
    .sort(([a],[b]) => a.localeCompare(b)));
  return digest({pricingVersion, payload:body});
}

export function isNewPricedModel(model) { return EXTRA_MODELS.includes(model); }
