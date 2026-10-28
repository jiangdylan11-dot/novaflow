// One metering seam for online text and vision.
// Callers pass a feature id and an amount. Today's adapter holds that amount
// on the existing provider balance; a later single credit balance replaces
// this adapter, not the call sites. This module does not create quota tables.
const FEATURE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function units(value, label) {
  const amount = Math.round(Number(value));
  if (!Number.isInteger(amount) || amount < 0 || amount > 100) {
    throw Object.assign(new Error(label || '在线计量数量无效'), { statusCode: 400 });
  }
  return amount;
}

export function createOnlineAiCharge({ reserve, settle, release } = {}) {
  if (typeof reserve !== 'function' || typeof settle !== 'function' || typeof release !== 'function') {
    throw new Error('在线计量未配置');
  }
  return async function chargeOnlineAi({ userId, feature, amount = 1, usageKey, metadata, run } = {}) {
    const featureId = String(feature || '').trim();
    const requested = units(amount, '在线计量数量无效');
    if (!FEATURE_ID.test(featureId) || requested < 1 || typeof run !== 'function' || !userId || !usageKey) {
      throw Object.assign(new Error('在线计量参数无效'), { statusCode: 400 });
    }
    let reservation;
    try {
      reservation = await reserve({ userId, feature: featureId, amount: requested, usageKey, metadata: metadata || {} });
    } catch {
      throw Object.assign(new Error('在线AI次数不足或暂时不可用'), { statusCode: 402 });
    }
    const granted = units(reservation?.amount ?? requested);
    if (reservation?.status !== 'reserved' || reservation?.idempotent || granted < 1) {
      throw Object.assign(new Error('这次请求已提交，请使用新的编号'), { statusCode: 409 });
    }
    try {
      const outcome = await run({ amount: granted });
      // A rejected or incomplete result is not a charge, even if the provider answered.
      if (outcome?.success === false) {
        const quota = await release({ userId, feature: featureId, amount: granted, usageKey, reason: outcome?.moderation ? 'moderation' : 'rejected' });
        return { ...outcome, quota };
      }
      const used = units(outcome?.amount ?? requested);
      const quota = used > 0
        ? await settle({ userId, feature: featureId, amount: used, usageKey, success: true, metadata: outcome?.metadata || {} })
        : await release({ userId, feature: featureId, amount: granted, usageKey, reason: 'no charge' });
      return { ...outcome, quota };
    } catch (error) {
      // Failure always releases the hold. Call sites cannot settle a failed or moderated request.
      try {
        error.quota = await release({ userId, feature: featureId, amount: granted, usageKey, reason: error?.moderation ? 'moderation' : 'incomplete' });
      } catch {
        error.quotaFailed = true;
      }
      throw error;
    }
  };
}
