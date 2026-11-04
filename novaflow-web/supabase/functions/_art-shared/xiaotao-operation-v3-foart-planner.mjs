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

export function createXiaotaoV3FoartPlanner({enabled=false,secret,loadProvider,rpc,infer,foartGeneralEnabled=false}={}) {
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
    loadPolicySnapshot:journal.loadPolicySnapshot,claimNext:journal.claimNext,foartGeneralEnabled});
  async function validateTicket({actor,operationToken,originalIntent,initialContext,isCurrent,allowExpiredForCancellation=false}) {
    const terms=tokenTerms(operationToken),canonical=canonicalizeXiaotaoV3FoartIntent(originalIntent,initialContext);
    const verified=await signed(actor,isCurrent).verify({actor,token:operationToken,model:terms.model,policyVersion:terms.policyVersion,intentHash:canonical.intentHash,allowExpiredForCancellation});
    return {terms,canonical,trusted:{...actor,operationId:verified.operationId,model:terms.model,policyVersion:terms.policyVersion,intentHash:canonical.intentHash}};
  }
  async function runReserved({trusted,stage,request,ports,originalIntent,initialContext,signal,isCurrent,generalEnabled=false}) {
    if(signal?.aborted||!await session(isCurrent,trusted)) {
      const receipt=await ports.finalize({actor:trusted,operationId:trusted.operationId,outcome:'cancel'});
      if(receipt?.status!=='settled')fail('operation-status-unknown',503);
      return {ok:false,errorCode:'cancelled-before-dispatch',receipt};
    }
    const marked=await ports.markDispatched(stage);if(marked?.status!=='dispatched'||marked.first_dispatch!==true)fail('operation-status-unknown',503);
    if(signal?.aborted||!await session(isCurrent,trusted))fail('operation-status-unknown',503);
    const compiled=companionInput(request);let posted;
    try{posted=await infer({body:{model:trusted.model,input:compiled.input,temperature:.4,reasoning:{effort:'low'},max_output_tokens:COMPANION_OUTPUT_TOKENS,
      text:{format:foartPlanResponseFormat(request.foartContext)}},model:trusted.model,signal,maxRetries:0,includeBillingIntegrity:true});}
    catch{fail('operation-status-unknown',503);}
    const data=posted?.data;if(!data||data.model!==trusted.model||!data.usage)fail('operation-status-unknown',503);
    const recorded=await ports.recordAssessedUsage({...stage,usageRecords:[data.usage]});if(recorded?.status!=='recorded')fail('operation-status-unknown',503);
    let plan,planIssue='';try{const text=outputText(data);if(!text)throw Error('方案没有完整返回');plan=readFoartPlan(text,request.foartContext);}catch(error){planIssue=String(error?.message||'').slice(0,200);}
    const current=await session(isCurrent,trusted);
    if(signal?.aborted||!current||!plan) {
      const receipt=await ports.finalize({actor:trusted,operationId:trusted.operationId,outcome:'cancel'});if(receipt?.status!=='settled')fail('operation-status-unknown',503);
      if(!current)fail('selection-stale',401);return {ok:false,errorCode:'operation-planner-incomplete',planIssue,receipt};
    }
    if(plan.status==='act') {
      // A tool can change what the next one may do, so run the first and replan.
      if(generalEnabled&&plan.operations.length>1)plan={...plan,operations:plan.operations.slice(0,1)};
      if(!generalEnabled||plan.operations.length!==1||stage.sequence>=14) {
        const receipt=await ports.finalize({actor:trusted,operationId:trusted.operationId,outcome:'cancel'});if(receipt?.status!=='settled')fail('operation-status-unknown',503);
        return {ok:false,errorCode:'foart-operation-unsupported',receipt};
      }
      await journal.recordPlan({actor:trusted,sequence:stage.sequence,phaseId:stage.phaseId,requestHash:stage.hash,plan,context:request.foartContext});
      const next=await continuation().issue({actor:trusted,operationId:trusted.operationId,model:trusted.model,policyVersion:trusted.policyVersion,
        originalIntent,initialContext,previousContext:request.foartContext,sequence:stage.sequence,isCurrent});
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
      const issued=await signed(actor,isCurrent).issue({actor,nonce,model,policyVersion:policy.version,intentHash:canonical.intentHash});
      const trusted={...actor,operationId:issued.operationId,model,policyVersion:policy.version,intentHash:canonical.intentHash};
      const claim=await ports.claimRoute({actor:trusted,operationId:issued.operationId,route:'v3'});
      if(claim?.route!=='v3'||typeof claim.idempotent!=='boolean'||!await session(isCurrent,actor))fail('operation-status-unknown',503);
      return {...issued,model,policyVersion:policy.version};
    },
    async start({actor,operationToken,originalIntent,initialContext,signal,isCurrent}) {
      ready();const checked=await validateTicket({actor,operationToken,originalIntent,initialContext,isCurrent}),{policy,ports}=await latest();
      if(policy.version!==checked.terms.policyVersion||!policy.models.some(row=>row.id===checked.terms.model&&row.available===true))fail('operation-pricing-unavailable',503);
      const stage={actor:checked.trusted,operationId:checked.trusted.operationId,phaseId:'foart_1',sequence:1,
        hash:hash({schema:'nf.xiaotao.operation.foart-stage.v1',operationId:checked.trusted.operationId,intentHash:checked.canonical.intentHash,sequence:1})};
      const estimate=estimateXiaotaoOnlineCredits({text:checked.canonical.intent.message+'\n'+JSON.stringify(checked.canonical.initial),
        history:(checked.canonical.intent.history||[]).map(x=>x.content).join('\n'),system:checked.canonical.compiled.systemText,files:[],outputTokens:COMPANION_OUTPUT_TOKENS,
        config:policy.config,model:checked.trusted.model,promptLanguage:checked.canonical.intent.promptLanguage,
        ...(xiaotaoCreditAmountPolicy(policy.config)==='decimal-v1'?{amountPolicy:'decimal-v1'}:{})});
      const held=await ports.reserveStage({...stage,phaseKind:'planner',feature:'online_chat_turn',estimatedCredits:estimate.credits});
      if(held?.status!=='reserved'||held.idempotent!==false)fail('operation-status-unknown',503);
      return runReserved({trusted:checked.trusted,stage,request:checked.canonical.request,ports,originalIntent,initialContext,signal,isCurrent,generalEnabled:generalAllowed(policy)});
    },
    async resume({actor,operationToken,originalIntent,initialContext,previousContext,continuationToken,receipt,context,signal,isCurrent}) {
      ready();const checked=await validateTicket({actor,operationToken,originalIntent,initialContext,isCurrent});
      const snapshot=await journal.loadPolicySnapshot(checked.trusted),ports=portsFor(snapshot);
      let snapshotPolicy;try{snapshotPolicy=JSON.parse(snapshot.policy_snapshot_text);}catch{fail('invalid-policy-snapshot',503);}
      const next=await continuation().continue({actor,operationId:checked.trusted.operationId,model:checked.trusted.model,policyVersion:checked.trusted.policyVersion,
        originalIntent,initialContext,previousContext,continuationToken,receipt,context,isCurrent});
      const stage={actor:checked.trusted,operationId:checked.trusted.operationId,phaseId:next.phaseId,sequence:next.sequence,hash:next.requestHash};
      return runReserved({trusted:checked.trusted,stage,request:next.request,ports,originalIntent,initialContext,signal,isCurrent,generalEnabled:generalAllowed(snapshotPolicy)});
    },
    async cancel({actor,operationToken,originalIntent,initialContext,isCurrent}) {
      ready();const checked=await validateTicket({actor,operationToken,originalIntent,initialContext,isCurrent,allowExpiredForCancellation:true});
      const ports=portsFor(await journal.loadPolicySnapshot(checked.trusted),{allowSettled:true});
      return ports.finalize({actor:checked.trusted,operationId:checked.trusted.operationId,outcome:'cancel'});
    }
  });
}
