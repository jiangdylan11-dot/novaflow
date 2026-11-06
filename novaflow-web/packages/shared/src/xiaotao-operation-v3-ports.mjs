// Server-only, default-closed ports for the proposed operation billing contract.
// No route calls this module yet. The calling server must authenticate the
// actor and sign/verify operation identities. Usage below must come from the
// server-owned RunningHub adapter, never from a request body.
// Never pass browser-supplied cost, pricing snapshots or actor identities here.
import {normalizeCreditConfig, settleXiaotaoOnlineCredits} from './feature-credits.mjs';
import {xiaotaoCreditAmountPolicy,isXiaotaoCreditAmount,exactXiaotaoTokenCost} from './xiaotao-decimal-usage.mjs';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {XIAOTAO_ONLINE_MODEL_IDS} from './xiaotao-online-models.mjs';

const fail = (code, statusCode = 400) => { throw Object.assign(new Error(code), {code, statusCode}); };
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const MODELS = new Set(XIAOTAO_ONLINE_MODEL_IDS);

function assessedRecord(record) {
  // The adapter must inspect the unnormalized provider payload first: aliases
  // can disagree and flattening them would otherwise erase the conflict.
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.billing_token_usage_invalid !== false) fail('invalid-assessed-usage');
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const read = keys => {
    const values=keys.map(key=>record[key]).filter(value=>value!=null).map(count);
    return !values.length || values.some(value=>value==null) || new Set(values).size!==1 ? null : values[0];
  };
  const input=read(['input_tokens','prompt_tokens']), output=read(['output_tokens','completion_tokens']);
  if (input==null || output==null || !Number.isSafeInteger(input+output) || input+output<=0
    || (record.total_tokens!=null && count(record.total_tokens)!==input+output)) fail('invalid-assessed-usage');
  const details=['input_tokens_details','prompt_tokens_details'].map(key=>record[key]).filter(value=>value!=null);
  if(details.some(value=>!value || typeof value!=='object' || Array.isArray(value)))fail('invalid-assessed-usage');
  const cached=details.map(value=>value.cached_tokens==null ? undefined : count(value.cached_tokens));
  if(cached.some(value=>value===null || value>input))fail('invalid-assessed-usage');
  const present=cached.filter(value=>value!==undefined);
  if(new Set(present).size>1)fail('invalid-assessed-usage');
  const hit=record.prompt_cache_hit_tokens==null ? undefined : count(record.prompt_cache_hit_tokens);
  const miss=record.prompt_cache_miss_tokens==null ? undefined : count(record.prompt_cache_miss_tokens);
  if(hit===null || miss===null || (hit!==undefined && hit>input) || (miss!==undefined && miss>input))fail('invalid-assessed-usage');
  if(hit!==undefined && present.length && hit!==present[0])fail('invalid-assessed-usage');
  const knownHit=present[0] ?? hit;
  if(miss!==undefined && (knownHit===undefined || knownHit+miss!==input))fail('invalid-assessed-usage');
  // Deliberately discard consumeMoney/thirdPartyConsumeMoney: their LLM
  // currency has not been established. Missing cache is preserved as unknown.
  return {input_tokens:input,output_tokens:output,total_tokens:input+output,
    ...(knownHit!==undefined ? {input_tokens_details:{cached_tokens:knownHit}} : {})};
}

export function createXiaotaoOperationV3Ports(rpc, options = {}) {
  const enabled = options.enabled === true;
  const {policyVersion, roundMode, expectedCap} = options;
  if (enabled && (typeof rpc !== 'function' || !text(policyVersion, 200) || !['ceil','round','floor'].includes(roundMode)
    || !Number.isSafeInteger(expectedCap) || expectedCap < 1 || expectedCap > 1000000 || !options.expectedConfig
    || typeof options.expectedConfig !== 'object' || Array.isArray(options.expectedConfig)
    || typeof options.policySnapshotText !== 'string' || Buffer.byteLength(options.policySnapshotText, 'utf8') > 65536)) fail('invalid-server-config', 503);
  // Retain the exact private DB configuration used for this quotation. A later
  // caller mutation must not silently change reserve terms or pricing policy.
  const expectedConfig = enabled ? structuredClone(options.expectedConfig) : null;
  // The policy version is a hash of the original JSON text. PostgreSQL jsonb
  // reorders keys, so recovery must hash this exact text, not a jsonb rendering.
  const policySnapshotText = enabled ? options.policySnapshotText : null;
  let pricingConfig = null;
  let amountPolicy = 'legacy';
  if (enabled) {
    if ('sha256:' + createHash('sha256').update(policySnapshotText, 'utf8').digest('hex') !== policyVersion) fail('invalid-policy-snapshot', 503);
    let snapshot;
    try { snapshot = JSON.parse(policySnapshotText); } catch { fail('invalid-policy-snapshot', 503); }
    if (!snapshot || snapshot.schema !== 'nf.xiaotao.pricing.v1' || !snapshot.config || typeof snapshot.config !== 'object'
      || Array.isArray(snapshot.config) || !Array.isArray(snapshot.models)) fail('invalid-policy-snapshot', 503);
    pricingConfig = structuredClone(snapshot.config);
    amountPolicy = xiaotaoCreditAmountPolicy(pricingConfig);
    if (amountPolicy === 'invalid' || amountPolicy !== xiaotaoCreditAmountPolicy(expectedConfig)) fail('invalid-policy-snapshot',503);
    const normalized = normalizeCreditConfig(pricingConfig);
    if (normalized.token_billing.round !== roundMode || normalized.xiaotao_online.message_cap_credits !== expectedCap) fail('invalid-policy-snapshot', 503);
  }
  const ready = () => { if (!enabled) fail('operation-billing-disabled', 503); };
  const actor = value => {
    if (!value || !uuid(value.userId) || !uuid(value.operationId) || !text(value.sessionId, 128) || !MODELS.has(value.model)
      || value.policyVersion!==policyVersion || !/^[a-f0-9]{64}$/i.test(value.intentHash || '')) fail('invalid-server-actor');
    return value;
  };
  const operation = value => { if (!uuid(value)) fail('invalid-operation'); return value; };
  const phase = value => { if (!text(value, 64) || !/^[A-Za-z0-9_-]+$/.test(value)) fail('invalid-phase'); return value; };
  const requestHash = value => { if (!/^[a-f0-9]{64}$/i.test(value || '')) fail('invalid-request-hash'); return value.toLowerCase(); };
  const identity = (value, operationId) => {
    const a = actor(value);
    const id=operation(operationId);
    if(a.operationId.toLowerCase()!==id.toLowerCase())fail('invalid-server-actor');
    return {p_operation_id:id, p_user_id:a.userId, p_session_id:a.sessionId,
      p_model:a.model, p_policy_version:policyVersion, p_intent_hash:a.intentHash.toLowerCase()};
  };
  // A timeout can occur after commit. Do not infer rollback or retry a provider.
  const call = async (name, args) => {
    try { return await rpc(name, args); }
    catch (error) {
      // These exact, trusted SQL errors are raised before reservation and
      // abort the transaction. Do not classify a timeout, another RPC, or a
      // similar-looking message as a known failure. Earlier phases, if any,
      // still require their existing settlement/reconciliation flow.
      if(name==='reserve_xiaotao_operation_stage_v3' && error?.code==='P0001') {
        if(error.message==='积分不足')throw Object.assign(new Error('积分不足'),{code:'insufficient_credits',statusCode:402});
        if(error.message==='云服务余额不足，请联系管理员')throw Object.assign(new Error('云服务余额不足，请联系管理员'),{code:'provider-pool-insufficient',statusCode:503});
      }
      fail('operation-status-unknown', 503);
    }
  };
  return Object.freeze({
    async claimRoute({actor:trustedActor, operationId, route}) {
      ready();
      if (!['v2','v3'].includes(route)) fail('invalid-route');
      return call('claim_xiaotao_operation_route_v3', {...identity(trustedActor,operationId),p_route:route});
    },
    // Only a trusted art compiler, after checking the signed request and image
    // manifest, may invoke these. Hashes from the browser are not evidence.
    async bindArtPlan({actor:trustedActor,operationId,artMode,structureHash}) {
      ready();
      if (!['art_single','art_dual'].includes(artMode)) fail('invalid-art-mode');
      return call('bind_xiaotao_art_plan_v3',{...identity(trustedActor,operationId),p_art_mode:artMode,p_structure_hash:requestHash(structureHash)});
    },
    async acceptArtStructure({actor:trustedActor,operationId,structureHash,parentHash}) {
      ready();
      return call('accept_xiaotao_art_structure_v3',{...identity(trustedActor,operationId),p_structure_hash:requestHash(structureHash),p_parent_hash:requestHash(parentHash)});
    },
    async registerArtEnglish({actor:trustedActor,operationId,parentHash,englishHash}) {
      ready();
      return call('register_xiaotao_art_english_v3',{...identity(trustedActor,operationId),p_parent_hash:requestHash(parentHash),p_english_hash:requestHash(englishHash)});
    },
    async acceptArtEnglish({actor:trustedActor,operationId,parentHash,englishHash}) {
      ready();
      return call('accept_xiaotao_art_english_v3',{...identity(trustedActor,operationId),p_parent_hash:requestHash(parentHash),p_english_hash:requestHash(englishHash)});
    },
    async reserveStage({actor:trustedActor, operationId, phaseId, sequence, phaseKind, feature, hash, estimatedCredits}) {
      ready();
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 14
        || !['planner','structure','english'].includes(phaseKind)
        || !['online_chat_turn','xiaotao_vision'].includes(feature)
        || !isXiaotaoCreditAmount(estimatedCredits,pricingConfig,{max:expectedCap})) fail('invalid-stage');
      const id=operation(operationId),stage=phase(phaseId);
      return call('reserve_xiaotao_operation_stage_v3', {...identity(trustedActor,operationId),
        p_expected_config:structuredClone(expectedConfig),p_policy_snapshot_text:policySnapshotText,p_expected_cap:expectedCap,p_round_mode:roundMode,
        p_phase_id:stage,p_sequence:sequence,p_phase_kind:phaseKind,p_feature:feature,p_usage_key:`xiaotao-v3:${id.toLowerCase()}:${stage}`,p_request_hash:requestHash(hash),
        p_estimated_credits:estimatedCredits});
    },
    async markDispatched({actor:trustedActor, operationId, phaseId, hash}) {
      ready();
      return call('mark_xiaotao_operation_stage_dispatched_v3', {...identity(trustedActor,operationId),
        p_phase_id:phase(phaseId),p_request_hash:requestHash(hash)});
    },
    // The server saw the provider call fail after dispatch: release this phase's hold in full.
    // The SQL accepts only a phase that is still 'dispatched' and keeps the evidence on the stage.
    async rejectDispatched({actor:trustedActor, operationId, phaseId, hash, evidence}) {
      ready();
      if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||!Object.keys(evidence).length||JSON.stringify(evidence).length>2000)fail('invalid-rejection-evidence');
      return call('reject_xiaotao_operation_stage_v3', {...identity(trustedActor,operationId),
        p_phase_id:phase(phaseId),p_request_hash:requestHash(hash),p_no_charge_evidence:structuredClone(evidence)});
    },
    // Only server-owned provider results belong here. Compute costs ourselves
    // from the frozen policy; never accept cost or raw credits from a caller.
    async recordAssessedUsage({actor:trustedActor, operationId, phaseId, hash, usageRecords}) {
      ready();
      const a=actor(trustedActor);
      if (!Array.isArray(usageRecords) || usageRecords.length<1 || usageRecords.length>10) fail('invalid-assessed-usage');
      const records=usageRecords.map(assessedRecord);
      const decision=settleXiaotaoOnlineCredits({usageRecords:records,config:pricingConfig,model:a.model});
      const normalized=normalizeCreditConfig(pricingConfig);
      const usdCost=decision.usdCost;
      const rawCredits=usdCost * normalized.credits_per_usd * normalized.xiaotao_online.markup;
      if (decision.pricingSource!=='token_rate_estimate' || decision.usageMissing || !money(usdCost) || !money(rawCredits)) fail('invalid-assessed-usage');
      // In decimal-v1, recompute from validated integer token counts and each
      // request's frozen tier rates.  Never derive a charge from the legacy
      // eight-decimal USD ledger column or a Number sum of provider stages.
      let exact = null;
      if (amountPolicy === 'decimal-v1') {
        try {
          const estimate=decision.tokenRateEstimate;
          const parts=Array.isArray(estimate?.requests)?estimate.requests:[estimate];
          // Missing cache counters are not evidence of zero hits. In the new
          // actual-usage policy keep the dispatched stage for reconciliation
          // rather than overcharging on an assumed uncached rate.
          if(parts.some(part=>part?.cacheKnown!==true))fail('invalid-assessed-usage');
          exact=exactXiaotaoTokenCost(parts,normalized.credits_per_usd,normalized.xiaotao_online.markup);
        } catch {fail('invalid-assessed-usage');}
      }
      return call('record_xiaotao_operation_stage_usage_v3', {...identity(trustedActor,operationId),
        p_phase_id:phase(phaseId),p_request_hash:requestHash(hash),p_usage:{records},
        p_usd_cost:exact ? exact.usdExact : usdCost,p_raw_credits:exact ? exact.rawCreditsExact : rawCredits});
    },
    // Holds left 'dispatched' when the edge worker died mid-request (546) are the server's to close.
    // Best effort, scoped to one account; the caller ignores a failure, so this never blocks a quote.
    async sweepStale({userId, minAgeSeconds=120}) {
      ready();
      if (!uuid(userId) || !Number.isSafeInteger(minAgeSeconds) || minAgeSeconds<60) fail('invalid-sweep');
      return rpc('sweep_xiaotao_stale_dispatched_v3', {p_user_id:userId, p_min_age_seconds:minAgeSeconds});
    },
    async finalize({actor:trustedActor, operationId, outcome}) {
      ready();
      if (!['success','cancel','refund'].includes(outcome)) fail('invalid-outcome');
      // refund: a failed turn that produced nothing settles as 'cancel' with every phase at 0 credits.
      if (outcome === 'refund') return call('finalize_xiaotao_operation_v3_refund', identity(trustedActor,operationId));
      return call('finalize_xiaotao_operation_v3', {...identity(trustedActor,operationId),p_outcome:outcome});
    }
  });
}
