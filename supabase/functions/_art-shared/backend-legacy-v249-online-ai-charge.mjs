// GENERATED COPY - source: packages/shared/src/backend-legacy-v249-online-ai-charge.mjs
// One metering seam for online text and vision.
// Callers pass a feature id and an amount. Amount stays the call budget (or
// image count). The credit card in feature-credits.mjs turns that into a
// credit hold. Reserve/settle/release are the credit RPCs. Local features run
// and never reserve. A low RunningHub pool rejects before any hold.
import { isLocalFeature, lowBalanceState, publicCreditError, quoteFeature, RH_LOW_BALANCE_MESSAGE } from './backend-legacy-v249-feature-credits.mjs';

const FEATURE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function units(value, label) {
  const amount = Math.round(Number(value));
  if (!Number.isInteger(amount) || amount < 0 || amount > 100) {
    throw Object.assign(new Error(label || '在线计量数量无效'), { statusCode: 400 });
  }
  return amount;
}

export function createOnlineAiCharge({ reserve, settle, release, prices, pool, strictSettlement = false } = {}) {
  if (typeof reserve !== 'function' || typeof settle !== 'function' || typeof release !== 'function') {
    throw new Error('在线计量未配置');
  }
  return async function chargeOnlineAi({ userId, feature, amount = 1, usageKey, metadata, run, pool: callPool, estimatedCredits } = {}) {
    const featureId = String(feature || '').trim();
    const requested = units(amount, '在线计量数量无效');
    if (!FEATURE_ID.test(featureId) || requested < 1 || typeof run !== 'function' || !userId || !usageKey) {
      throw Object.assign(new Error('在线计量参数无效'), { statusCode: 400 });
    }
    const quoted = quoteFeature({ feature: featureId, units: requested, prices });
    const explicitRaw = estimatedCredits == null || estimatedCredits === '' ? null : Math.round(Number(estimatedCredits));
    const hasExplicit = explicitRaw != null && Number.isInteger(explicitRaw) && explicitRaw >= 1 && explicitRaw <= 1000000;
    if (isLocalFeature(featureId) || (!hasExplicit && (quoted.local || quoted.credits === 0))) {
      const outcome = await run({ amount: 0, credits: 0, local: true });
      return { ...outcome, quota: { status: 'local', charged_credits: 0, local: true, feature: quoted.feature } };
    }
    if (!hasExplicit && quoted.unpriced) {
      throw Object.assign(new Error('该功能积分单价未配置'), { statusCode: 402 });
    }
    const holdCredits = hasExplicit ? explicitRaw : quoted.credits;
    const activePool = callPool === undefined ? pool : callPool;
    const poolState = typeof activePool === 'function' ? await activePool() : activePool;
    if (poolState && (poolState.blocked === true || lowBalanceState(poolState).blocked)) {
      throw Object.assign(new Error(RH_LOW_BALANCE_MESSAGE), { statusCode: 402, code: 'rh_low_balance' });
    }
    let reservation;
    let settling=false,releasing=false;
    try {
      reservation = await reserve({
        userId, feature: featureId, amount: requested, credits: holdCredits,
        estimatedCredits: hasExplicit ? holdCredits : undefined,
        usageKey, metadata: metadata || {}
      });
    } catch (error) {
      if (['xiaotao_pricing_snapshot_changed','xiaotao_reservation_release_unconfirmed','xiaotao_reservation_status_unknown'].includes(error?.code)) throw error;
      const failure = Object.assign(new Error(publicCreditError(error?.message || error)), { statusCode: 402 });
      if (error?.code) failure.code = error.code;
      throw failure;
    }
    const granted = units(reservation?.amount ?? requested);
    if (reservation?.status !== 'reserved' || reservation?.idempotent || granted < 1) {
      throw Object.assign(new Error('这次请求已提交，请使用新的编号'), { statusCode: 409 });
    }
    try {
      const outcome = await run({ amount: granted });
      // A rejected or incomplete result is not a charge, even if the provider answered.
      if (outcome?.success === false) {
        releasing=true;
        const quota = await release({ userId, feature: featureId, amount: granted, usageKey, reason: outcome?.moderation ? 'moderation' : 'rejected' });
        if(strictSettlement && quota?.status!=='released')throw Error('release not confirmed');
        return { ...outcome, quota };
      }
      const used = units(outcome?.amount ?? requested);
      settling=used>0;releasing=used===0;
      const quota = used > 0
        ? await settle({
          userId, feature: featureId, amount: used, usageKey, success: true,
          metadata: outcome?.metadata || {},
          settledCredits: outcome?.settledCredits,
          rhCostUsd: outcome?.rhCostUsd,
          pricingSource: outcome?.pricingSource
        })
        : await release({ userId, feature: featureId, amount: granted, usageKey, reason: 'no charge' });
      if(strictSettlement && releasing && quota?.status!=='released')throw Error('release not confirmed');
      if(strictSettlement && settling && quota?.status!=='settled')throw Error('settlement not confirmed');
      return { ...outcome, quota };
    } catch (error) {
      if(strictSettlement && settling)
        throw Object.assign(new Error('模型已请求，积分结算状态待核对；请勿重复提交'),{statusCode:503,code:'xiaotao_settlement_status_unknown'});
      if(strictSettlement && releasing)
        throw Object.assign(new Error('请求未完成，但积分预留释放未确认，请稍后核对'),{statusCode:503,code:'xiaotao_reservation_release_unconfirmed'});
      // Failure always releases the hold. Call sites cannot settle a failed or moderated request.
      try {
        error.quota = await release({ userId, feature: featureId, amount: granted, usageKey, reason: error?.moderation ? 'moderation' : 'incomplete' });
        if(strictSettlement && error.quota?.status!=='released')throw Error('release not confirmed');
      } catch {
        if(strictSettlement)throw Object.assign(new Error('请求未完成，但积分预留释放未确认，请稍后核对'),{statusCode:503,code:'xiaotao_reservation_release_unconfirmed'});
        error.quotaFailed = true;
      }
      throw error;
    }
  };
}
