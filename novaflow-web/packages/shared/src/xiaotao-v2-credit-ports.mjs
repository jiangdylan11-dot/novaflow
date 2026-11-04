import {createFeatureCreditPorts} from './feature-credits.mjs';

// Used only for versioned companion requests. The raw database snapshot is
// service-side only; it is never put in user metadata or returned to clients.
export function createXiaotaoV2CreditPorts(rpc,{expectedConfig,expectedCap,policyVersion}={}) {
  const legacy=createFeatureCreditPorts(rpc);
  return {
    ...legacy,
    async markDispatched({userId,feature,usageKey,metadata,estimatedCredits}) {
      return rpc('mark_xiaotao_art_dispatched_v2',{
        p_user_id:userId,p_usage_key:usageKey,p_feature:feature,p_model:metadata?.model,
        p_stage:metadata?.art_stage,p_request_hash:metadata?.art_request_hash,
        p_session_id:metadata?.art_session_id,p_policy_version:metadata?.pricing_version,
        p_estimated_credits:estimatedCredits
      });
    },
    async reserve({userId,feature,amount,usageKey,metadata,estimatedCredits}) {
      try {
        const row=await rpc('reserve_xiaotao_credits_v2',{
          p_user_id:userId,p_usage_key:usageKey,p_feature:feature,p_units:amount,
          p_model:metadata?.model || null,p_metadata:metadata || {},p_estimated_credits:estimatedCredits,
          p_expected_cap:expectedCap,p_expected_config:expectedConfig,p_policy_version:policyVersion
        });
        if(row?.status==='reserved' && row?.idempotent !== true &&
          (Number(row?.message_cap_credits)!==expectedCap || row?.policy_version!==policyVersion ||
           Number(row?.estimated_credits)!==Number(estimatedCredits))) {
          // A confirmed new hold with unexpected terms must never reach the
          // provider. Return it through the existing idempotent release path.
          try {const released=await legacy.release({userId,feature,usageKey,reason:'pricing snapshot mismatch'});if(released?.status!=='released')throw Error('release not confirmed');}
          catch {throw Object.assign(new Error('未调用模型，但积分预留释放未确认，请稍后核对'),{statusCode:503,code:'xiaotao_reservation_release_unconfirmed'});}
          throw Object.assign(new Error('计费预留与报价不一致，本次未调用模型'),{statusCode:409,code:'xiaotao_pricing_snapshot_changed'});
        }
        return {status:row?.status,idempotent:row?.idempotent===true,
          amount:Number(row?.units ?? amount) || Number(amount) || 0,
          credits:Number(row?.estimated_credits ?? estimatedCredits ?? 0)};
      } catch(error) {
        if(error?.code==='xiaotao_pricing_snapshot_changed' || error?.code==='xiaotao_reservation_release_unconfirmed')throw error;
        if(String(error?.message || '').includes('xiaotao pricing changed; obtain a new quote'))
          throw Object.assign(new Error('计费策略已变化，请重新报价。本次未调用模型；如该请求曾提交，请核对积分状态'),{statusCode:409,code:'xiaotao_pricing_snapshot_changed'});
        // These exact server-side exceptions are transaction rollbacks before
        // a new hold; retain the established actionable balance messages.
        if(error?.code==='P0001' && ['积分不足','计费池余额不足，请联系管理员','额度迁移维护中，请稍后再试','该功能积分单价未配置'].includes(error?.message))throw error;
        // A transport failure may occur after the DB commits; do not claim
        // that no hold exists or retry the provider with a new usage key.
        throw Object.assign(new Error('未调用模型，积分预留状态待核对'),{statusCode:503,code:'xiaotao_reservation_status_unknown'});
      }
    },
    async settle({userId,feature,amount,usageKey,metadata,settledCredits,rhCostUsd,pricingSource}) {
      return rpc('settle_xiaotao_credits_v2',{
        p_user_id:userId,p_usage_key:usageKey,p_feature:feature,p_actual_units:amount,
        p_model:metadata?.model || null,p_metadata:metadata || {},p_settled_credits:settledCredits ?? null,
        p_rh_cost_usd:rhCostUsd ?? null,p_pricing_source:pricingSource || null
      });
    }
  };
}
