// One metering seam for online text and vision.
// Callers pass a feature id and an amount. Amount stays the call budget (or
// image count). The credit card in feature-credits.mjs turns that into a
// credit hold. Reserve/settle/release are the credit RPCs. Local features run
// and never reserve. A low RunningHub pool rejects before any hold.
import { isLocalFeature, lowBalanceState, publicCreditError, quoteFeature, RH_LOW_BALANCE_MESSAGE } from './feature-credits.mjs';

const FEATURE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function units(value, label) {
  const amount = Math.round(Number(value));
  if (!Number.isInteger(amount) || amount < 0 || amount > 100) {
    throw Object.assign(new Error(label || '在线计量数量无效'), { statusCode: 400 });
  }
  return amount;
}

export function createOnlineAiCharge({ reserve, settle, release, prices, pool, strictSettlement = false, guardedDispatch = false, markDispatched } = {}) {
  if (typeof reserve !== 'function' || typeof settle !== 'function' || typeof release !== 'function') {
    throw new Error('在线计量未配置');
  }
  if (guardedDispatch === true && (strictSettlement !== true || typeof markDispatched !== 'function')) {
    throw new Error('受保护的在线派发未配置');
  }
  return async function chargeOnlineAi({ userId, feature, amount = 1, usageKey, metadata, run, pool: callPool, estimatedCredits } = {}) {
    const featureId = String(feature || '').trim();
    const requested = units(amount, '在线计量数量无效');
    if (!FEATURE_ID.test(featureId) || requested < 1 || typeof run !== 'function' || !userId || !usageKey) {
      throw Object.assign(new Error('在线计量参数无效'), { statusCode: 400 });
    }
    let boundMetadata = metadata || {};
    if (guardedDispatch === true) {
      try {
        boundMetadata = JSON.parse(JSON.stringify(boundMetadata));
        if (!boundMetadata || typeof boundMetadata !== 'object' || Array.isArray(boundMetadata)) throw Error('invalid metadata');
        const freeze=value=>{if(value && typeof value==='object' && !Object.isFrozen(value)){for(const part of Object.values(value))freeze(part);Object.freeze(value);}};
        freeze(boundMetadata);
      } catch { throw Object.assign(new Error('受保护派发的计费参数无效'), { statusCode:400 }); }
    }
    const quoted = quoteFeature({ feature: featureId, units: requested, prices });
    const explicitRaw = estimatedCredits == null || estimatedCredits === '' ? null : Math.round(Number(estimatedCredits));
    const hasExplicit = explicitRaw != null && Number.isInteger(explicitRaw) && explicitRaw >= 1 && explicitRaw <= 1000000;
    if (isLocalFeature(featureId) || (!hasExplicit && (quoted.local || quoted.credits === 0))) {
      if (guardedDispatch === true) throw Object.assign(new Error('受保护派发需要积分预留'), { statusCode:400 });
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
        usageKey, metadata: boundMetadata
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
    let dispatchAttempted=false, dispatchConfirmed=false, dispatchTainted=false, dispatchWindowOpen=true;
    const markProviderDispatched = async () => {
      if (!dispatchWindowOpen || dispatchAttempted) {
        dispatchTainted=true;
        throw Object.assign(new Error('派发标记重复或已失效'), { code:'xiaotao_dispatch_status_unknown' });
      }
      // Mark the local attempt BEFORE the RPC. A timeout may hide a committed
      // marker; no error after this point may automatically release the hold.
      dispatchAttempted=true;
      const marker=await markDispatched({userId,feature:featureId,usageKey,amount:granted,estimatedCredits:holdCredits,metadata:boundMetadata});
      if (!dispatchWindowOpen || dispatchTainted || marker?.status!=='dispatched' || marker.first_dispatch!==true)
        throw Object.assign(new Error('派发状态未确认'), { code:'xiaotao_dispatch_status_unknown' });
      dispatchConfirmed=true;
    };
    try {
      const outcome = await run(guardedDispatch === true ? { amount:granted, markProviderDispatched } : { amount:granted });
      dispatchWindowOpen=false;
      if (guardedDispatch === true && (!dispatchConfirmed || dispatchTainted)) throw Error('provider dispatch not confirmed');
      if (guardedDispatch === true && (!outcome || typeof outcome !== 'object' || Array.isArray(outcome))) throw Error('provider outcome missing');
      // Once dispatched, even an unsuccessful answer may have provider cost.
      if (guardedDispatch === true && outcome?.success === false) throw Error('provider outcome incomplete');
      // A rejected or incomplete result is not a charge, even if the provider answered.
      if (outcome?.success === false) {
        releasing=true;
        const quota = await release({ userId, feature: featureId, amount: granted, usageKey, reason: outcome?.moderation ? 'moderation' : 'rejected' });
        if(strictSettlement && quota?.status!=='released')throw Error('release not confirmed');
        return { ...outcome, quota };
      }
      const used = units(outcome?.amount ?? requested);
      if (guardedDispatch === true && (used === 0 || !Number.isSafeInteger(outcome.settledCredits) || outcome.settledCredits < 0
          || !Number.isFinite(outcome.rhCostUsd) || outcome.rhCostUsd < 0 || (outcome.settledCredits === 0 && outcome.rhCostUsd !== 0)))
        throw Error('provider outcome has no verified settlement');
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
      dispatchWindowOpen=false;
      if (guardedDispatch === true && dispatchAttempted && !settling)
        throw Object.assign(new Error('在线请求结果未确认，可以稍后再试'),{statusCode:503,code:'xiaotao_dispatch_status_unknown'});
      if(strictSettlement && settling)
        throw Object.assign(new Error('模型已请求，积分结算尚未确认，可以稍后再试'),{statusCode:503,code:'xiaotao_settlement_status_unknown'});
      if(strictSettlement && releasing)
        throw Object.assign(new Error('请求未完成，但积分预留释放未确认，本次未完成，稍后再试一次'),{statusCode:503,code:'xiaotao_reservation_release_unconfirmed'});
      // Failure always releases the hold. Call sites cannot settle a failed or moderated request.
      try {
        error.quota = await release({ userId, feature: featureId, amount: granted, usageKey, reason: error?.moderation ? 'moderation' : 'incomplete' });
        if(strictSettlement && error.quota?.status!=='released')throw Error('release not confirmed');
      } catch {
        if(strictSettlement)throw Object.assign(new Error('请求未完成，但积分预留释放未确认，本次未完成，稍后再试一次'),{statusCode:503,code:'xiaotao_reservation_release_unconfirmed'});
        error.quotaFailed = true;
      }
      throw error;
    }
  };
}
