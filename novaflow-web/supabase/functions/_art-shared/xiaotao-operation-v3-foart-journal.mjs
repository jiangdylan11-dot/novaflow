// GENERATED COPY - source: packages/shared/src/xiaotao-operation-v3-foart-journal.mjs
// Server-only, default-closed adapter for the isolated Foart journal protocol.
// Browser-supplied plans, prices and provider usage must never call this API.
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {readFoartPlan,validateFoartContext} from './foart-tool-plan.mjs';
import {inspectRotationPlan} from './xiaotao-operation-v3-foart-rotation.mjs';
import {xiaotaoCreditAmountPolicy,isXiaotaoCreditAmount} from './xiaotao-decimal-usage.mjs';

const fail=(code,statusCode=400)=>{throw Object.assign(new Error(code),{code,statusCode});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
// The journal row only needs a valid surface label; the plan hash binds the tool.
const foartPlanSurface=op=>op.action==='animation'?'animation':op.action==='media'?(op.operation?.target==='audio'?'audio':'video'):
  /^(?:image_|art_|draw$)/.test(op.action||'')?'drawing':/^ui_/.test(op.action||'')?'ui':'tools';
const phase=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
function identity(value) {
  if(!value||!uuid(value.operationId)||!uuid(value.userId)||typeof value.sessionId!=='string'||!value.sessionId||value.sessionId.length>128||
    !['xai/grok-4.7','openai/gpt-6.1-sol-saver','deepseek/deepseek-v4.1-flash'].includes(value.model)||!/^sha256:[a-f0-9]{64}$/.test(value.policyVersion||'')||!hex(value.intentHash))fail('invalid-server-actor');
  return {p_operation_id:value.operationId.toLowerCase(),p_user_id:value.userId.toLowerCase(),p_session_id:value.sessionId,
    p_model:value.model,p_policy_version:value.policyVersion,p_intent_hash:value.intentHash};
}
function sequence(value){if(!Number.isSafeInteger(value)||value<1||value>13)fail('invalid-foart-sequence');return value;}
function withoutMedia(value,key='',depth=0) {
  if(depth>64)fail('invalid-foart-context');
  if(typeof value==='string'&&(/^data:/i.test(value)||(/^(?:dataUrl|imageUrl|previewUrl|blob|bytes)$/i.test(key)&&value)))fail('foart-media-consent-required',409);
  if(value&&typeof value==='object')for(const [name,child] of Object.entries(value))withoutMedia(child,name,depth+1);
}
function canonicalContext(context) {
  validateFoartContext(context);withoutMedia(context);
  const text=JSON.stringify(context);if(Buffer.byteLength(text,'utf8')>60000)fail('invalid-foart-context');return text;
}

export function createXiaotaoV3FoartJournal({enabled=false,rpc}={}) {
  if(enabled===true&&typeof rpc!=='function')fail('invalid-server-config',503);
  const ready=()=>{if(enabled!==true)fail('operation-billing-disabled',503);};
  const call=async(name,args)=>{try{return await rpc(name,args);}catch{fail('operation-status-unknown',503);}};
  return Object.freeze({
    // Invoke only with the validated, actual provider output *after* usage was
    // recorded. The database independently requires that recorded stage.
    async recordPlan({actor,sequence:seq,phaseId,requestHash,plan,context,rotationEnabled=false,generalEnabled=false,evidence}) {
      ready();const id=identity(actor);sequence(seq);
      if(!phase(phaseId)||!hex(requestHash))fail('invalid-foart-stage');
      const contextText=canonicalContext(context);
      // readFoartPlan may truncate an actionable prefix; this limited journal
      // authorizes only a provider response that originally contains one open.
      if(!plan||typeof plan!=='object'||Array.isArray(plan)||plan.status!=='act'||!Array.isArray(plan.operations)||plan.operations.length!==1)
        fail('foart-continuation-unsupported',409);
      const parsed=readFoartPlan(JSON.stringify(plan),context);
      if(parsed.status!=='act'||parsed.operations.length!==1)fail('foart-continuation-unsupported',409);
      const animation=parsed.operations[0].action==='animation';
      const rotation=animation&&rotationEnabled===true?inspectRotationPlan(parsed,context,seq,evidence):null;
      if(!rotation&&!generalEnabled&&parsed.operations[0].action!=='open')fail('foart-continuation-unsupported',409);
      const planText=JSON.stringify(parsed);if(Buffer.byteLength(planText,'utf8')>60000)fail('invalid-foart-plan');
      const planHash=hash(planText),contextHash=hash(contextText);
      const common={...id,p_sequence:seq,p_phase_id:phaseId,p_request_hash:requestHash,p_plan_hash:planHash,p_context_hash:contextHash};
      const result=rotation?await call('record_xiaotao_animation_plan_v3',{...common,p_action_kind:rotation.actionKind,p_target_hash:rotation.targetHash})
        :await call('record_xiaotao_foart_plan_v3',{...common,p_surface:parsed.operations[0].surface||foartPlanSurface(parsed.operations[0])});
      if(result?.status!=='recorded'||result.planHash!==planHash||typeof result.idempotent!=='boolean')fail('operation-status-unknown',503);
      return {status:'recorded',planHash,contextHash,idempotent:result.idempotent};
    },
    async loadRecordedPhase(input) {
      ready();return call('load_xiaotao_foart_plan_v3',{...identity(input),p_sequence:sequence(input.sequence)});
    },
    async loadPolicySnapshot(input) {
      ready();return call('get_xiaotao_operation_snapshot_v3',identity(input));
    },
    async claimNext(input) {
      ready();const id=identity(input),previous=sequence(input.sequence-1);
      if(input.sequence!==previous+1||input.phaseId!==`foart_${input.sequence}`||input.phaseKind!=='planner'||input.feature!=='online_chat_turn'||
        !hex(input.requestHash)||!hex(input.previousPlanHash)||
        !Number.isSafeInteger(input.phaseCap)||input.phaseCap<1||!['ceil','round','floor'].includes(input.roundMode)||
        !input.expectedConfig||typeof input.expectedConfig!=='object'||Array.isArray(input.expectedConfig)||typeof input.policySnapshotText!=='string'||
        Buffer.byteLength(input.policySnapshotText,'utf8')>65536||'sha256:'+hash(input.policySnapshotText)!==input.policyVersion)fail('invalid-foart-stage');
      let snapshot;try{snapshot=JSON.parse(input.policySnapshotText);}catch{fail('invalid-foart-stage');}
      if(!snapshot||snapshot.schema!=='nf.xiaotao.pricing.v1'||!snapshot.config||typeof snapshot.config!=='object'||Array.isArray(snapshot.config))fail('invalid-foart-stage');
      const amountPolicy=xiaotaoCreditAmountPolicy(snapshot.config);
      if(amountPolicy==='invalid'||amountPolicy!==xiaotaoCreditAmountPolicy(input.expectedConfig)||
        !isXiaotaoCreditAmount(input.estimatedCredits,snapshot.config,{max:input.phaseCap}))fail('invalid-foart-stage');
      const animation=['inspect_bones','key_bones'].includes(input.previousActionKind)||input.strictContext===true;
      if(animation&&(!hex(input.previousContextHash)||!['open','inspect_bones','key_bones'].includes(input.previousActionKind)||(input.previousActionKind==='open'?input.previousTargetHash!==null:!hex(input.previousTargetHash))))fail('invalid-foart-stage');
      const bind=animation?{p_previous_context_hash:input.previousContextHash,p_previous_action_kind:input.previousActionKind,p_previous_target_hash:input.previousTargetHash}:{};
      return call(animation?'claim_xiaotao_animation_next_v3':'claim_xiaotao_foart_next_v3',{...id,p_previous_sequence:previous,p_previous_plan_hash:input.previousPlanHash,...bind,
        p_expected_config:structuredClone(input.expectedConfig),p_policy_snapshot_text:input.policySnapshotText,p_expected_cap:input.phaseCap,p_round_mode:input.roundMode,
        p_phase_id:input.phaseId,p_feature:input.feature,p_usage_key:`xiaotao-v3:${id.p_operation_id}:${input.phaseId}`,
        p_request_hash:input.requestHash,p_estimated_credits:input.estimatedCredits});
    }
  });
}
