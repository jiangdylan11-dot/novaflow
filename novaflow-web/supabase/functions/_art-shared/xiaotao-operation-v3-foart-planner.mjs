// GENERATED COPY - source: packages/shared/src/xiaotao-operation-v3-foart-planner.mjs
// Default-closed vertical prototype for a single existing Foart open(surface)
// action followed by another planner turn. No production assembly enables it.
// Authenticated server code supplies actor, model adapter and DB ports; the
// browser never supplies a price, provider, ledger amount or trusted plan.
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {companionInput} from './companion-chat.mjs';
import {companionPricingPolicy,COMPANION_OUTPUT_TOKENS} from './companion-pricing.mjs';
import {estimateXiaotaoOnlineCredits} from './feature-credits.mjs';
import {xiaotaoCreditAmountPolicy} from './xiaotao-decimal-usage.mjs';
import {foartPlanResponseFormat,readFoartPlan} from './foart-tool-plan.mjs';
import {inspectRotationPlan} from './xiaotao-operation-v3-foart-rotation.mjs';
import {IDLE_DRAFT_SYSTEM,isIdleDraftRequest,idleDraftTargets,idleDraftResponseFormat,readIdleDraft} from './xiaotao-operation-v3-idle-draft.mjs';
import {createXiaotaoOperationV3Tickets} from './xiaotao-operation-v3-ticket.mjs';
import {createXiaotaoOperationV3Ports} from './xiaotao-operation-v3-ports.mjs';
import {createXiaotaoV3FoartJournal} from './xiaotao-operation-v3-foart-journal.mjs';
import {canonicalizeXiaotaoV3FoartIntent,createXiaotaoV3FoartContinuation} from './xiaotao-operation-v3-foart-continuation.mjs';

const fail=(code,statusCode=400)=>{throw Object.assign(new Error(code),{code,statusCode});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const policyText=p=>JSON.stringify({schema:p.schema,revision:p.revision,providerRevision:p.providerRevision,defaultModel:p.defaultModel,config:p.config,models:p.models});
function tokenTerms(token) {
  if(typeof token!=='string'||token.length>4096)fail('invalid-operation-ticket');
  try{const parts=token.split('.');if(parts.length!==2)throw Error();const value=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if(!['xai/grok-4.7','openai/gpt-6.1-sol-saver','deepseek/deepseek-v4.1-flash'].includes(value?.model)||!/^sha256:[a-f0-9]{64}$/.test(value.policyVersion||''))throw Error();
    return {model:value.model,policyVersion:value.policyVersion};}catch{fail('invalid-operation-ticket');}
}
function outputText(data) {
  if(data?.status!=='completed'||data?.finish_reason!=='stop'||!Array.isArray(data.output)||data.output.some(row=>row?.type==='function_call'))return null;
  return data.output.flatMap(row=>row?.type==='message'&&row.role==='assistant'&&Array.isArray(row.content)
    ? row.content.filter(part=>part?.type==='output_text'&&typeof part.text==='string').map(part=>part.text):[]).join('\n').trim()||null;
}

function singleMusicOrOpenFormat(openEnabled){
  const object=(properties,required)=>({type:'object',properties,required,additionalProperties:false});
  const music=object({action:{const:'generate_music'},target:{const:'audio'},prompt:{type:'string'},count:{type:'integer',minimum:1,maximum:1},seconds:{type:'number',minimum:8,maximum:300},bpm:{type:'integer',minimum:40,maximum:220},loop:{type:'boolean'}},['action','target','prompt','count']);
  const media=object({action:{const:'media'},operation:music},['action','operation']);
  const open=object({action:{const:'open'},surface:{enum:['drawing','ui','video','audio','effects','particle','tools','animation']}},['action','surface']);
  return {type:'json_schema',name:'foart_single_music_draft',strict:false,schema:object({schema:{const:'nf.foart.tool-plan.v1'},status:{enum:['act','reply','clarify','done']},reply:{type:'string'},operations:{type:'array',items:openEnabled?{anyOf:[media,open]}:media,maxItems:1}},['schema','status','reply','operations'])};
}
function isSingleMusicDraft(plan,context){
  if(context?.media?.active!==true||context.media.sub!=='audio'||plan?.status!=='act'||plan.operations?.length!==1)return false;
  const wrapper=plan.operations[0],op=wrapper?.operation;
  return wrapper?.action==='media'&&Object.keys(wrapper).every(k=>['action','operation'].includes(k))&&op&&typeof op==='object'&&!Array.isArray(op)&&
    Object.keys(op).every(k=>['action','target','prompt','seconds','bpm','count','loop'].includes(k))&&op.action==='generate_music'&&op.target==='audio'&&
    typeof op.prompt==='string'&&op.prompt.trim().length>0&&op.prompt.length<=4000&&op.count===1&&
    (op.seconds===undefined||Number.isFinite(op.seconds)&&op.seconds>=8&&op.seconds<=300)&&
    (op.bpm===undefined||Number.isInteger(op.bpm)&&op.bpm>=40&&op.bpm<=220)&&(op.loop===undefined||typeof op.loop==='boolean');
}
function musicPolicyReady(policy){
  const c=policy?.config?.xiaotao_online;
  return policy?.config&&xiaotaoCreditAmountPolicy(policy.config)==='decimal-v1'&&
    c?.operation_foart_audio_music_v3===true&&c.credit_amount_policy==='decimal-v1'&&
    c.credit_precision===6&&c.credit_rounding==='ceil'&&c.minimum_positive_credits===0;
}
export function createXiaotaoV3FoartPlanner({enabled=false,secret,loadProvider,rpc,infer,foartRotationEnabled=false,foartGeneralEnabled=false,foartIdleDraftEnabled=false,foartAudioMusicEnabled=false}={}) {
  if(enabled===true&&(!Buffer.isBuffer(secret)||secret.length<32||typeof loadProvider!=='function'||typeof rpc!=='function'||typeof infer!=='function'))fail('invalid-server-config',503);
  const key=enabled===true?Buffer.from(secret):null;
  const ready=()=>{if(enabled!==true)fail('operation-billing-disabled',503);};
  // Natural-language operation: any validated Foart tool, one per billed phase.
  const generalAllowed=policy=>foartGeneralEnabled===true&&policy?.config?.xiaotao_online?.operation_foart_general_v3===true;
  const journal=createXiaotaoV3FoartJournal({enabled,rpc});
  const session=async(isCurrent,actor)=>{try{return typeof isCurrent==='function'&&await isCurrent(actor)===true;}catch{return false;}};
  function signed(actor,isCurrent){return createXiaotaoOperationV3Tickets({enabled:true,secret:key,isCurrent:async candidate=>session(isCurrent,candidate)});}
  function portsFor(snapshot,{allowSettled=false}={}) {
    if(!snapshot||(snapshot.status!=='open'&&!(allowSettled&&snapshot.status==='settled'))||typeof snapshot.policy_snapshot_text!=='string')fail('operation-status-unknown',503);
    return createXiaotaoOperationV3Ports(rpc,{enabled:true,policyVersion:snapshot.policy_version,roundMode:snapshot.round_mode,
      expectedCap:snapshot.phase_cap,expectedConfig:snapshot.expected_config,policySnapshotText:snapshot.policy_snapshot_text});
  }
  async function latest() {
    const loaded=await loadProvider();if(!loaded?.creditConfig||typeof loaded.creditConfig!=='object')fail('operation-pricing-unavailable',503);
    const provider={...loaded,creditConfig:structuredClone(loaded.creditConfig),...(loaded.billingExpectedConfig?{billingExpectedConfig:structuredClone(loaded.billingExpectedConfig)}:{})};
    const policy=await companionPricingPolicy(provider);
    return {provider,policy,ports:createXiaotaoOperationV3Ports(rpc,{enabled:true,policyVersion:policy.version,roundMode:policy.config.token_billing.round,
      expectedCap:policy.config.xiaotao_online.message_cap_credits,expectedConfig:provider.billingExpectedConfig??provider.creditConfig,policySnapshotText:policyText(policy)})};
  }
  const continuation=()=>createXiaotaoV3FoartContinuation({enabled:true,secret:key,loadRecordedPhase:journal.loadRecordedPhase,
    loadPolicySnapshot:journal.loadPolicySnapshot,claimNext:journal.claimNext,foartRotationEnabled,foartGeneralEnabled});
  async function validateTicket({actor,operationToken,originalIntent,initialContext,isCurrent,allowExpiredForCancellation=false}) {
    const terms=tokenTerms(operationToken),canonical=canonicalizeXiaotaoV3FoartIntent(originalIntent,initialContext);
    const verified=await signed(actor,isCurrent).verify({actor,token:operationToken,model:terms.model,policyVersion:terms.policyVersion,intentHash:canonical.intentHash,allowExpiredForCancellation});
    return {terms,canonical,trusted:{...actor,operationId:verified.operationId,model:terms.model,policyVersion:terms.policyVersion,intentHash:canonical.intentHash}};
  }
  async function runReserved({trusted,stage,request,ports,originalIntent,initialContext,signal,isCurrent,rotationEnabled=false,idleDraftEnabled=false,audioEnabled=false,openEnabled=false,generalEnabled=false,evidence,previousActionKind}) {
    if(signal?.aborted||!await session(isCurrent,trusted)) {
      const receipt=await ports.finalize({actor:trusted,operationId:trusted.operationId,outcome:'cancel'});
      if(receipt?.status!=='settled')fail('operation-status-unknown',503);
      return {ok:false,errorCode:'cancelled-before-dispatch',receipt};
    }
    const marked=await ports.markDispatched(stage);if(marked?.status!=='dispatched'||marked.first_dispatch!==true)fail('operation-status-unknown',503);
    if(signal?.aborted||!await session(isCurrent,trusted))fail('operation-status-unknown',503);
    const compiled=companionInput(request);let posted;
    const modelInput=idleDraftEnabled?[{role:'system',content:[{type:'input_text',text:IDLE_DRAFT_SYSTEM}]},...compiled.input.slice(1)]:compiled.input;
    try{posted=await infer({body:{model:trusted.model,input:modelInput,temperature:.4,reasoning:{effort:'low'},max_output_tokens:COMPANION_OUTPUT_TOKENS,
      text:{format:idleDraftEnabled?idleDraftResponseFormat(request.foartContext):audioEnabled&&request.foartContext?.media?.active===true&&request.foartContext?.media?.sub==='audio'?singleMusicOrOpenFormat(openEnabled):foartPlanResponseFormat(request.foartContext,rotationEnabled&&request.foartContext?.animation?.active?{communityAnimationInspection:true,communityAnimationStage:stage.sequence===1?'inspect':'plan'}:{})}},model:trusted.model,signal,maxRetries:0,includeBillingIntegrity:true});}
    catch{fail('operation-status-unknown',503);}
    const data=posted?.data;if(!data||data.model!==trusted.model||!data.usage)fail('operation-status-unknown',503);
    const recorded=await ports.recordAssessedUsage({...stage,usageRecords:[data.usage]});if(recorded?.status!=='recorded')fail('operation-status-unknown',503);
    let plan,idleDraft,rawPlan;try{const text=outputText(data);if(!text)throw Error();if(idleDraftEnabled)idleDraft=readIdleDraft(text,request.foartContext);else {rawPlan=JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));plan=readFoartPlan(text,request.foartContext);}}catch{}
    const current=await session(isCurrent,trusted);
    if(signal?.aborted||!current||(!plan&&!idleDraft)) {
      const receipt=await ports.finalize({actor:trusted,operationId:trusted.operationId,outcome:'cancel'});if(receipt?.status!=='settled')fail('operation-status-unknown',503);
      if(!current)fail('selection-stale',401);return {ok:false,errorCode:'operation-planner-incomplete',receipt};
    }
    // A draft is a terminal model result, not an executed tool. Its actual
    // usage is settled once before the browser offers a separate native,
    // trusted-click preview; no additional phase or SQL journal is needed.
    if(idleDraft) {
      const receipt=await ports.finalize({actor:trusted,operationId:trusted.operationId,outcome:'success'});
      if(receipt?.status!=='settled'||receipt.outcome!=='success')fail('operation-status-unknown',503);
      if(!await session(isCurrent,trusted))fail('selection-stale',401);
      return {ok:true,idleDraft,receipt};
    }
    if(plan.status==='act') {
      if(audioEnabled&&isSingleMusicDraft(rawPlan,request.foartContext)&&isSingleMusicDraft(plan,request.foartContext)){
        // This ends the AI operation only; no generation task is dispatched.
        // Unknown settlement never returns an executable draft.
        const receipt=await ports.finalize({actor:trusted,operationId:trusted.operationId,outcome:'success'});
        if(receipt?.status!=='settled'||receipt.outcome!=='success')fail('operation-status-unknown',503);
        if(!await session(isCurrent,trusted))fail('selection-stale',401);
        if(typeof receipt.uncollected!=='number'||!Number.isFinite(receipt.uncollected)||receipt.uncollected<0)
          return {ok:false,errorCode:'operation-receipt-incomplete',receipt};
        if(receipt.uncollected!==0)return {ok:false,errorCode:'operation-uncollected',receipt};
        return {ok:true,resultKind:'audio_music_draft',toolPlan:plan,receipt,audioDraft:true};
      }
      // A tool can change what the next one may do, so run the first and replan.
      if(generalEnabled&&plan.operations.length>1)plan={...plan,operations:plan.operations.slice(0,1)};
      const general=generalEnabled&&plan.operations.length===1;
      let rotation=null;
      if(rotationEnabled&&plan.operations.length===1&&plan.operations[0].action==='animation') {
        try{rotation=inspectRotationPlan(plan,request.foartContext,stage.sequence,evidence);}catch{}
      }
      if(plan.operations.length!==1||(!rotation&&!general&&(!openEnabled||plan.operations[0].action!=='open'||previousActionKind==='key_bones'||previousActionKind==='inspect_bones'))||stage.sequence>=14) {
        const receipt=await ports.finalize({actor:trusted,operationId:trusted.operationId,outcome:'cancel'});if(receipt?.status!=='settled')fail('operation-status-unknown',503);
        return {ok:false,errorCode:'foart-operation-unsupported',receipt};
      }
      await journal.recordPlan({actor:trusted,sequence:stage.sequence,phaseId:stage.phaseId,requestHash:stage.hash,plan,context:request.foartContext,rotationEnabled,generalEnabled,evidence});
      const next=await continuation().issue({actor:trusted,operationId:trusted.operationId,model:trusted.model,policyVersion:trusted.policyVersion,
        originalIntent,initialContext,previousContext:request.foartContext,sequence:stage.sequence,general,isCurrent});
      if(!await session(isCurrent,trusted))fail('selection-stale',401);
      return {ok:true,toolPlan:plan,continuationToken:next.continuationToken,sequence:stage.sequence,billing:{status:'pending'}};
    }
    const receipt=await ports.finalize({actor:trusted,operationId:trusted.operationId,outcome:'success'});
    if(receipt?.status!=='settled'||receipt.outcome!=='success')fail('operation-status-unknown',503);
    if(!await session(isCurrent,trusted))fail('selection-stale',401);
    return {ok:true,toolPlan:plan,receipt};
  }
  return Object.freeze({
    async prepare({actor,nonce,model,originalIntent,initialContext,isCurrent}) {
      ready();const canonical=canonicalizeXiaotaoV3FoartIntent(originalIntent,initialContext),{policy,ports}=await latest();
      if(!policy.models.some(row=>row.id===model&&row.available===true))fail('operation-model-unavailable',503);
      if(canonical.intent.musicDraftRequested===true&&!(foartAudioMusicEnabled===true&&musicPolicyReady(policy)))fail('foart-operation-unsupported',409);
      if(isIdleDraftRequest(canonical.intent.message)&&!(generalAllowed(policy)&&canonical.intent.idleDraftRequested!==true)){
        if(canonical.intent.idleDraftRequested!==true||foartIdleDraftEnabled!==true||policy.config?.xiaotao_online?.operation_foart_idle_draft_v3!==true||xiaotaoCreditAmountPolicy(policy.config)!=='decimal-v1')fail('foart-operation-unsupported',409);
        idleDraftTargets(canonical.initial);
      }
      const issued=await signed(actor,isCurrent).issue({actor,nonce,model,policyVersion:policy.version,intentHash:canonical.intentHash});
      const trusted={...actor,operationId:issued.operationId,model,policyVersion:policy.version,intentHash:canonical.intentHash};
      const claim=await ports.claimRoute({actor:trusted,operationId:issued.operationId,route:'v3'});
      if(claim?.route!=='v3'||typeof claim.idempotent!=='boolean'||!await session(isCurrent,actor))fail('operation-status-unknown',503);
      return {...issued,model,policyVersion:policy.version};
    },
    async start({actor,operationToken,originalIntent,initialContext,signal,isCurrent}) {
      ready();const checked=await validateTicket({actor,operationToken,originalIntent,initialContext,isCurrent}),{policy,ports}=await latest();
      if(policy.version!==checked.terms.policyVersion||!policy.models.some(row=>row.id===checked.terms.model&&row.available===true))fail('operation-pricing-unavailable',503);
      if(checked.canonical.intent.musicDraftRequested===true&&!(foartAudioMusicEnabled===true&&musicPolicyReady(policy)))fail('foart-operation-unsupported',409);
      const idleRequested=isIdleDraftRequest(checked.canonical.intent.message)&&!(generalAllowed(policy)&&checked.canonical.intent.idleDraftRequested!==true);
      if(idleRequested){
        if(checked.canonical.intent.idleDraftRequested!==true||foartIdleDraftEnabled!==true||policy.config?.xiaotao_online?.operation_foart_idle_draft_v3!==true||xiaotaoCreditAmountPolicy(policy.config)!=='decimal-v1')fail('foart-operation-unsupported',409);
        idleDraftTargets(checked.canonical.initial);
      }
      const stage={actor:checked.trusted,operationId:checked.trusted.operationId,phaseId:'foart_1',sequence:1,
        hash:hash({schema:'nf.xiaotao.operation.foart-stage.v1',operationId:checked.trusted.operationId,intentHash:checked.canonical.intentHash,sequence:1})};
      const estimate=estimateXiaotaoOnlineCredits({text:checked.canonical.intent.message+'\n'+JSON.stringify(checked.canonical.initial),
        history:(checked.canonical.intent.history||[]).map(x=>x.content).join('\n'),system:checked.canonical.compiled.systemText,files:[],outputTokens:COMPANION_OUTPUT_TOKENS,
        config:policy.config,model:checked.trusted.model,promptLanguage:checked.canonical.intent.promptLanguage,
        ...(xiaotaoCreditAmountPolicy(policy.config)==='decimal-v1'?{amountPolicy:'decimal-v1'}:{})});
      const held=await ports.reserveStage({...stage,phaseKind:'planner',feature:'online_chat_turn',estimatedCredits:estimate.credits});
      if(held?.status!=='reserved'||held.idempotent!==false)fail('operation-status-unknown',503);
      return runReserved({trusted:checked.trusted,stage,request:checked.canonical.request,ports,originalIntent,initialContext,signal,isCurrent,idleDraftEnabled:idleRequested,audioEnabled:foartAudioMusicEnabled===true&&checked.canonical.intent.musicDraftRequested===true&&musicPolicyReady(policy),openEnabled:policy.config?.xiaotao_online?.operation_foart_open_v3===true,generalEnabled:generalAllowed(policy),rotationEnabled:!generalAllowed(policy)&&foartRotationEnabled===true&&policy.config?.xiaotao_online?.operation_foart_open_v3===true&&policy.config?.xiaotao_online?.operation_foart_rotation_v3===true});
    },
    async resume({actor,operationToken,originalIntent,initialContext,previousContext,previousPlan,continuationToken,receipt,context,signal,isCurrent}) {
      ready();const checked=await validateTicket({actor,operationToken,originalIntent,initialContext,isCurrent});
      const snapshot=await journal.loadPolicySnapshot(checked.trusted),ports=portsFor(snapshot);
      let snapshotPolicy;try{snapshotPolicy=JSON.parse(snapshot.policy_snapshot_text);}catch{fail('invalid-policy-snapshot',503);}
      if(checked.canonical.intent.musicDraftRequested===true&&!(foartAudioMusicEnabled===true&&musicPolicyReady(snapshotPolicy)))fail('foart-operation-unsupported',409);
      const next=await continuation().continue({actor,operationId:checked.trusted.operationId,model:checked.trusted.model,policyVersion:checked.trusted.policyVersion,
        originalIntent,initialContext,previousContext,previousPlan,continuationToken,receipt,context,isCurrent});
      const stage={actor:checked.trusted,operationId:checked.trusted.operationId,phaseId:next.phaseId,sequence:next.sequence,hash:next.requestHash};
      return runReserved({trusted:checked.trusted,stage,request:next.request,ports,originalIntent,initialContext,signal,isCurrent,audioEnabled:foartAudioMusicEnabled===true&&checked.canonical.intent.musicDraftRequested===true&&musicPolicyReady(snapshotPolicy),openEnabled:snapshotPolicy?.config?.xiaotao_online?.operation_foart_open_v3===true,generalEnabled:generalAllowed(snapshotPolicy),rotationEnabled:!generalAllowed(snapshotPolicy)&&foartRotationEnabled===true&&snapshotPolicy?.config?.xiaotao_online?.operation_foart_open_v3===true&&snapshotPolicy?.config?.xiaotao_online?.operation_foart_rotation_v3===true,evidence:next.evidence,previousActionKind:next.previousActionKind});
    },
    async cancel({actor,operationToken,originalIntent,initialContext,isCurrent}) {
      ready();const checked=await validateTicket({actor,operationToken,originalIntent,initialContext,isCurrent,allowExpiredForCancellation:true});
      const ports=portsFor(await journal.loadPolicySnapshot(checked.trusted),{allowSettled:true});
      return ports.finalize({actor:checked.trusted,operationId:checked.trusted.operationId,outcome:'cancel'});
    }
  });
}
