// Default-closed, single-phase text-chat execution prototype. No production
// route injects this module. `infer` must be a trusted, no-retry server adapter;
// tests inject a synthetic provider. Existing v2 traffic is unchanged.
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {canonicalizeXiaotaoV3OperationIntent} from './xiaotao-operation-v3-prepare.mjs';
import {inspectXiaotaoV3StyleReply} from './xiaotao-style-framework-v3.mjs';
import {inspectXiaotaoV3VideoReply} from './xiaotao-video-framework-v3.mjs';
import {xiaotaoVideoResponseFormat} from './xiaotao-video-response-format.mjs';
import {inspectXiaotaoV3UiReply} from './xiaotao-ui-framework-v3.mjs';
import {companionPricingPolicy,COMPANION_OUTPUT_TOKENS} from './companion-pricing.mjs';
import {estimateXiaotaoOnlineCredits} from './feature-credits.mjs';
import {hasXiaotaoDecimalV1,isXiaotaoCreditAmount} from './xiaotao-decimal-usage.mjs';
import {createXiaotaoOperationV3Tickets} from './xiaotao-operation-v3-ticket.mjs';
import {createXiaotaoOperationV3Ports} from './xiaotao-operation-v3-ports.mjs';
import {XIAOTAO_ONLINE_MODEL_IDS} from './xiaotao-online-models.mjs';

const fail=(code,statusCode=400,extra={})=>{throw Object.assign(new Error(code),{code,statusCode},extra);};
function untrustedTicketModel(token) {
  if(typeof token!=='string'||token.length>4096)fail('invalid-operation-ticket');
  try {
    const parts=token.split('.');if(parts.length!==2)throw Error();
    const parsed=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if(!XIAOTAO_ONLINE_MODEL_IDS.includes(parsed?.model))throw Error();
    return parsed.model;
  } catch {fail('invalid-operation-ticket');}
}
const policyText=p=>JSON.stringify({schema:p.schema,revision:p.revision,providerRevision:p.providerRevision,defaultModel:p.defaultModel,config:p.config,models:p.models});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function actualReply(data) {
  if(data?.status!=='completed'||data?.finish_reason!=='stop'||!Array.isArray(data.output)||data.output.some(row=>row?.type==='function_call'))return null;
  const reply=data.output.flatMap(row=>row?.type==='message'&&row.role==='assistant'&&Array.isArray(row.content)
    ? row.content.filter(part=>part?.type==='output_text'&&typeof part.text==='string').map(part=>part.text):[]).join('\n').trim();
  return reply||null;
}
// Two native V3 planner stages remain inside one signed operation. Neither a
// browser nor the model chooses stage names, sequences, prices or receipts.
async function executeCombinedStyle({intent,compiled,intentHash,model,policy,verified,ports,trustedActor,infer,signal,sessionFresh}) {
  const results=[];
  const cancel=async errorCode=>{
    const receipt=await ports.finalize({actor:trustedActor,operationId:verified.operationId,outcome:'cancel'});
    if(receipt?.status!=='settled'||receipt.outcome!=='cancel'||!isXiaotaoCreditAmount(receipt.charged,policy.config,{allowZero:true,max:14000000}))fail('operation-status-unknown',503);
    if(!await sessionFresh())fail('selection-stale',401);
    return {ok:false,errorCode,receipt};
  };
  for(let i=0;i<2;i++) {
    if(i>0 && (signal?.aborted||!await sessionFresh()))return cancel('operation-cancelled-after-dispatch');
    const current=compiled.stages[i],phaseId=i===0?'style_material':'style_supplement';
    const stage={actor:trustedActor,operationId:verified.operationId,phaseId,
      hash:digest({schema:'nf.xiaotao.operation.style-stage.v1',operationId:verified.operationId,model,policyVersion:policy.version,intentHash,phaseId,sequence:i+1})};
    let estimate;
    try {estimate=estimateXiaotaoOnlineCredits({text:current.userText,history:'',system:current.systemText,
      files:Array.from({length:current.imageCount},()=>({kind:'image'})),outputTokens:current.outputTokens,config:policy.config,model,
      ...(hasXiaotaoDecimalV1(policy.config)?{amountPolicy:'decimal-v1'}:{})});}
    catch(error) {if(i>0)return cancel('operation-pricing-unavailable');throw error;}
    if(!isXiaotaoCreditAmount(estimate?.credits,policy.config)) {
      if(i>0)return cancel('operation-pricing-unavailable');
      fail('operation-pricing-unavailable',503);
    }
    let reserve;
    try {reserve=await ports.reserveStage({...stage,sequence:i+1,phaseKind:'planner',feature:current.imageCount?'xiaotao_vision':'online_chat_turn',estimatedCredits:estimate.credits});}
    catch(error) {
      // Only the port's proven pre-reservation SQL failures are safe to settle.
      // An uncertain RPC result might have committed a hold; never replay it.
      if(i>0 && ['insufficient_credits','provider-pool-insufficient'].includes(error?.code))return cancel(error.code);
      throw error;
    }
    if(reserve?.status!=='reserved'||reserve.idempotent!==false)fail('operation-status-unknown',503);
    if(signal?.aborted||!await sessionFresh())return cancel(i===0?'cancelled-before-dispatch':'operation-cancelled-after-dispatch');
    const marked=await ports.markDispatched(stage);
    if(marked?.status!=='dispatched'||marked.first_dispatch!==true)fail('operation-status-unknown',503);
    if(signal?.aborted||!await sessionFresh())fail('operation-status-unknown',503);
    let posted;
    try {posted=await infer({body:{model,input:current.input,temperature:0.4,reasoning:{effort:'low'},max_output_tokens:current.outputTokens},model,signal,maxRetries:0,includeBillingIntegrity:true});}
    catch {fail('operation-status-unknown',503);}
    const data=posted?.data;if(!data||data.model!==model||!data.usage)fail('operation-status-unknown',503);
    let recorded;try {recorded=await ports.recordAssessedUsage({...stage,usageRecords:[data.usage]});}catch {fail('operation-status-unknown',503);}
    if(recorded?.status!=='recorded')fail('operation-status-unknown',503);
    const reply=actualReply(data);let parsed=null;
    if(reply)try {parsed=inspectXiaotaoV3StyleReply({kind:i===0?'aifx-material':'aifx-supplement',reply});}catch{}
    if(!parsed)return cancel('operation-style-result-invalid');
    if(signal?.aborted||!await sessionFresh())return cancel('operation-cancelled-after-dispatch');
    results.push(parsed);
  }
  const receipt=await ports.finalize({actor:trustedActor,operationId:verified.operationId,outcome:'success'});
  if(receipt?.status!=='settled'||receipt.outcome!=='success'||!isXiaotaoCreditAmount(receipt.charged,policy.config,{allowZero:true,max:14000000}))fail('operation-status-unknown',503);
  if(!await sessionFresh())fail('selection-stale',401);
  return {ok:true,styleResult:{...results[0],...results[1]},model,receipt};
}
export function createXiaotaoOperationV3Chat({enabled=false,visionEnabled=false,styleEnabled=false,styleVisionModels=[],videoRewriteEnabled=false,uiDraftEnabled=false,audioRewriteEnabled=false,secret,loadProvider,rpc,infer}={}) {
  if(enabled===true&&(!Buffer.isBuffer(secret)||secret.length<32||typeof loadProvider!=='function'||typeof rpc!=='function'||typeof infer!=='function'))fail('invalid-server-config',503);
  const key=enabled===true?Buffer.from(secret):null;
  return async function executeXiaotaoOperationV3({user,sessionId,payload,signal,isCurrent}={}) {
    if(enabled!==true)fail('operation-billing-disabled',503);
    if(!user||typeof user.id!=='string'||typeof sessionId!=='string'||!sessionId||typeof isCurrent!=='function')fail('invalid-server-actor');
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==2||Object.keys(payload).some(k=>!['operationToken','intent'].includes(k)))fail('invalid-operation-terms');
    if(signal?.aborted)fail('cancelled-before-prepare',409);
    const actor={userId:user.id.toLowerCase(),sessionId};
    if(await isCurrent(actor)!==true)fail('selection-stale',401);
    const sessionFresh=async()=>{try{return await isCurrent(actor)===true;}catch{return false;}};
    const model=untrustedTicketModel(payload.operationToken);
    const {intent,compiled,intentHash,uiPrepared,uiAdapter}=await canonicalizeXiaotaoV3OperationIntent(payload.intent,{actor,model,isCurrent,visionEnabled,styleEnabled,styleVisionModels,videoRewriteEnabled,uiDraftEnabled,audioRewriteEnabled});
    const loaded=await loadProvider();
    if(!loaded||typeof loaded!=='object'||!loaded.creditConfig||typeof loaded.creditConfig!=='object')fail('operation-pricing-unavailable',503);
    const provider={...loaded,creditConfig:structuredClone(loaded.creditConfig),
      ...(loaded.billingExpectedConfig!=null?{billingExpectedConfig:structuredClone(loaded.billingExpectedConfig)}:{})};
    const policy=await companionPricingPolicy(provider);
    if(!policy.models.some(row=>row.id===model&&row.available===true))fail('operation-model-unavailable',503);
    if(intent.mode==='style-analysis'&&policy.config.xiaotao_online.operation_style_v3!==true)fail('operation-billing-disabled',503);
    if(intent.mode==='video-rewrite'&&policy.config.xiaotao_online.operation_video_rewrite_v3!==true)fail('operation-billing-disabled',503);
    if(intent.mode==='video-rewrite'&&compiled.imageCount&&(!policy.config.xiaotao_online.operation_vision_chat_v3||!XIAOTAO_ONLINE_MODEL_IDS.includes(model)))fail('model-vision-unavailable',503);
    if(intent.mode==='ui-draft'&&policy.config.xiaotao_online.operation_ui_draft_v3!==true)fail('operation-billing-disabled',503);
    if(intent.mode==='ui-draft'&&compiled.imageCount&&(!policy.config.xiaotao_online.operation_vision_chat_v3||!XIAOTAO_ONLINE_MODEL_IDS.includes(model)))fail('model-vision-unavailable',503);
    if(intent.mode==='audio-rewrite'&&policy.config.xiaotao_online.operation_audio_rewrite_v3!==true)fail('operation-billing-disabled',503);
    if(intent.mode==='style-analysis'&&compiled.imageCount&&(!policy.config.xiaotao_online.operation_vision_chat_v3||!policy.config.xiaotao_online.operation_style_vision_models?.includes(model)))fail('model-vision-unavailable',503);
    const tickets=createXiaotaoOperationV3Tickets({enabled:true,secret:key,isCurrent:async candidate=>isCurrent(candidate)});
    const verified=await tickets.verify({actor,token:payload.operationToken,model,policyVersion:policy.version,intentHash});
    const ports=createXiaotaoOperationV3Ports(rpc,{enabled:true,policyVersion:policy.version,roundMode:policy.config.token_billing.round,
      expectedCap:policy.config.xiaotao_online.message_cap_credits,expectedConfig:provider.billingExpectedConfig??provider.creditConfig,policySnapshotText:policyText(policy)});
    const trustedActor={...actor,operationId:verified.operationId,model,policyVersion:policy.version,intentHash};
    if(intent.kind==='aifx-material-supplement')return executeCombinedStyle({intent,compiled,intentHash,model,policy,verified,ports,trustedActor,infer,signal,sessionFresh});
    const stage={actor:trustedActor,operationId:verified.operationId,phaseId:'chat',
      hash:digest({schema:'nf.xiaotao.operation.chat-stage.v1',operationId:verified.operationId,model,policyVersion:policy.version,intentHash})};
    const styleAnalysis=intent.mode==='style-analysis';
    const videoRewrite=intent.mode==='video-rewrite';
    const uiDraft=intent.mode==='ui-draft';
    const audioRewrite=intent.mode==='audio-rewrite';
    const outputTokens=styleAnalysis||videoRewrite||uiDraft||audioRewrite?compiled.outputTokens:COMPANION_OUTPUT_TOKENS;
    const estimate=estimateXiaotaoOnlineCredits({text:styleAnalysis||videoRewrite||uiDraft||audioRewrite?compiled.userText:intent.message,history:(intent.history||[]).map(x=>x.content).join('\n'),
      system:compiled.systemText,files:Array.from({length:compiled.imageCount},()=>({kind:'image'})),outputTokens,config:policy.config,model,promptLanguage:intent.promptLanguage,
      ...(hasXiaotaoDecimalV1(policy.config)?{amountPolicy:'decimal-v1'}:{})});
    if(!isXiaotaoCreditAmount(estimate.credits,policy.config))fail('operation-pricing-unavailable',503);
    const reserve=await ports.reserveStage({...stage,sequence:1,phaseKind:'planner',feature:compiled.imageCount?'xiaotao_vision':'online_chat_turn',estimatedCredits:estimate.credits});
    if(reserve?.status!=='reserved')fail('operation-status-unknown',503);
    // Never retry a provider call after an idempotent reservation. Another
    // executor may own its dispatch; the database is the source of truth.
    if(reserve.idempotent!==false)fail('operation-status-unknown',503);
    if(signal?.aborted || !await sessionFresh()) {
      const cancelled=await ports.finalize({actor:trustedActor,operationId:verified.operationId,outcome:'cancel'});
      if(cancelled?.status!=='settled'||cancelled.outcome!=='cancel')fail('operation-status-unknown',503);
      if(!await sessionFresh())fail('selection-stale',401);
      return {ok:false,errorCode:'cancelled-before-dispatch',receipt:cancelled};
    }
    const marked=await ports.markDispatched(stage);
    if(marked?.status!=='dispatched'||marked.first_dispatch!==true)fail('operation-status-unknown',503);
    // Once the marker commits, cancellation and uncertain provider results stay
    // held for reconciliation, even if this process has not seen a response.
    if(signal?.aborted || await isCurrent(actor)!==true)fail('operation-status-unknown',503);
    let posted;
    try {posted=await infer({body:{model,input:compiled.input,temperature:audioRewrite?.5:.4,reasoning:{effort:'low'},max_output_tokens:outputTokens,
      ...(videoRewrite?{text:{format:xiaotaoVideoResponseFormat(intent.h3Mode)}}:{})},
      model,signal,maxRetries:0,includeBillingIntegrity:true});}
    catch {fail('operation-status-unknown',503);}
    const data=posted?.data;
    if(!data||data.model!==model||!data.usage)fail('operation-status-unknown',503);
    let recorded;
    try {recorded=await ports.recordAssessedUsage({...stage,usageRecords:[data.usage]});}
    catch {fail('operation-status-unknown',503);}
    if(recorded?.status!=='recorded')fail('operation-status-unknown',503);
    const providerReply=actualReply(data);
    const reply=(videoRewrite&&providerReply?.length>12000)||(audioRewrite&&providerReply?.length>4000)?null:providerReply;
    let videoDraft=null;
    if(videoRewrite&&reply){try{videoDraft=inspectXiaotaoV3VideoReply({intent,intentHash:verified.intentHash,reply});}catch{}}
    let uiPreview=null;
    if(uiDraft&&reply){try{uiPreview=await inspectXiaotaoV3UiReply({uiPrepared,uiAdapter,reply,signal});}catch{}}
    let styleResult=null;
    if(styleAnalysis&&reply){try{styleResult=inspectXiaotaoV3StyleReply({kind:intent.kind,reply});}catch{}}
    const stillCurrent=await sessionFresh();
    const outcome=reply&&(!styleAnalysis||styleResult)&&(!videoRewrite||videoDraft)&&(!uiDraft||uiPreview)&&!signal?.aborted&&stillCurrent?'success':'cancel';
    // Known usage is settled even if provider output cannot be used, the
    // caller cancelled, or the session expired after dispatch.
    const receipt=await ports.finalize({actor:trustedActor,operationId:verified.operationId,outcome});
    if(receipt?.status!=='settled'||receipt.outcome!==outcome||!isXiaotaoCreditAmount(receipt.charged,policy.config,{allowZero:true,max:14000000}))fail('operation-status-unknown',503);
    if(!await sessionFresh())fail('selection-stale',401);
    if(!reply)return {ok:false,errorCode:'operation-provider-output-invalid',receipt};
    if(videoRewrite&&!videoDraft)return {ok:false,errorCode:'operation-video-draft-invalid',receipt};
    if(uiDraft&&!uiPreview)return {ok:false,errorCode:'operation-ui-draft-invalid',receipt};
    if(styleAnalysis&&!styleResult)return {ok:false,errorCode:'operation-style-result-invalid',receipt};
    if(outcome!=='success')return {ok:false,errorCode:'operation-cancelled-after-dispatch',receipt};
    if(styleAnalysis)return {ok:true,styleResult,model,receipt};
    if(videoRewrite)return {ok:true,videoDraft,model,receipt};
    if(uiDraft)return {ok:true,uiDraft:uiPreview,model,receipt};
    return {ok:true,reply,model,receipt};
  };
}
