// GENERATED COPY - source: packages/shared/src/xiaotao-operation-v3-prepare.mjs
// Server-only prototype. It is not injected into the production control plane.
// This adapter recognises only one existing text-chat request. Multi-round
// agent and art operations require their own trusted business adapters.
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {companionInput} from './companion-chat.mjs';
import {companionPricingPolicy} from './companion-pricing.mjs';
import {estimateXiaotaoOnlineCredits} from './feature-credits.mjs';
import {hasXiaotaoDecimalV1,isXiaotaoCreditAmount,sumXiaotaoCreditAmounts} from './xiaotao-decimal-usage.mjs';
import {canonicalizeXiaotaoV3StyleIntent} from './xiaotao-style-framework-v3.mjs';
import {canonicalizeXiaotaoV3VideoIntent} from './xiaotao-video-framework-v3.mjs';
import {canonicalizeXiaotaoV3UiIntent} from './xiaotao-ui-framework-v3.mjs';
import {canonicalizeXiaotaoV3AudioIntent} from './xiaotao-audio-framework-v3.mjs';
import {createXiaotaoOperationV3Tickets} from './xiaotao-operation-v3-ticket.mjs';
import {createXiaotaoOperationV3Ports} from './xiaotao-operation-v3-ports.mjs';
import {XIAOTAO_ONLINE_MODEL_IDS} from './xiaotao-online-models.mjs';

const fail=(code,statusCode=400)=>{throw Object.assign(new Error(code),{code,statusCode});};
const PLAIN_FIELDS=new Set(['mode','requestId','message','history','promptLanguage']);
// RunningHub advertises image input for these exact routes. The separate
// server-owned vision and video flags, plus the policy, are still mandatory.
const VIDEO_VISION_MODELS=new Set(XIAOTAO_ONLINE_MODEL_IDS);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function canonicalizeXiaotaoV3TextIntent(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>!PLAIN_FIELDS.has(k)) || input.mode!=='chat') fail('operation-intent-unsupported');
  if(input.history!==undefined && (!Array.isArray(input.history) || input.history.some(row=>!row || typeof row!=='object' || Array.isArray(row) || Object.keys(row).some(k=>!['role','content'].includes(k))))) fail('operation-intent-unsupported');
  // Reuse the same validation as the existing production chat; do not invent
  // a separate interpretation of a message or its history.
  const intent={mode:'chat',requestId:input.requestId,message:input.message,
    ...(input.history!==undefined?{history:input.history.map(({role,content})=>({role,content}))}:{}),
    ...(input.promptLanguage!==undefined?{promptLanguage:input.promptLanguage}:{})};
  const compiled=companionInput(intent);
  const intentHash=createHash('sha256').update(JSON.stringify({schema:'nf.xiaotao.operation.chat-intent.v1',intent})).digest('hex');
  return {intent,compiled,intentHash};
}
// A separate, opt-in vision contract leaves the existing text hash and legacy
// routing unchanged. The immutable hash binds the actual image bytes, order and
// role; the database and signed ticket only receive the digest, never the image.
export function canonicalizeXiaotaoV3ChatIntent(input,{visionEnabled=false}={}) {
  if(!Object.hasOwn(input||{},'images'))return canonicalizeXiaotaoV3TextIntent(input);
  if(visionEnabled!==true || !input || typeof input!=='object' || Array.isArray(input) ||
    Object.keys(input).some(k=>!PLAIN_FIELDS.has(k)&&k!=='images') || !Array.isArray(input.images) ||
    input.images.length<1 || input.images.length>3)fail('operation-intent-unsupported');
  if(input.history!==undefined && (!Array.isArray(input.history) || input.history.some(row=>!row || typeof row!=='object' || Array.isArray(row) || Object.keys(row).some(k=>!['role','content'].includes(k)))))fail('operation-intent-unsupported');
  const images=input.images.map(image=>{
    if(!image || typeof image!=='object' || Array.isArray(image) || Object.keys(image).some(k=>!['role','source','dataUrl'].includes(k)) ||
      typeof image.dataUrl!=='string' || (image.role!==undefined && typeof image.role!=='string') ||
      (image.source!==undefined && !(Number.isSafeInteger(image.source)&&image.source>=0&&image.source<=999) &&
        !(typeof image.source==='string' && image.source.length<=120)))fail('operation-intent-unsupported');
    return {dataUrl:image.dataUrl,...(image.role!==undefined?{role:image.role}:{}),...(image.source!==undefined?{source:image.source}:{})};
  });
  const intent={mode:input.mode,requestId:input.requestId,message:input.message,
    ...(input.history!==undefined?{history:input.history.map(({role,content})=>({role,content}))}:{}),
    ...(input.promptLanguage!==undefined?{promptLanguage:input.promptLanguage}:{}),images};
  const compiled=companionInput(intent);
  if(compiled.imageCount!==images.length || compiled.textOnly!==false)fail('operation-intent-unsupported');
  const intentHash=createHash('sha256').update(JSON.stringify({schema:'nf.xiaotao.operation.vision-intent.v1',intent})).digest('hex');
  return {intent,compiled,intentHash};
}
export async function canonicalizeXiaotaoV3OperationIntent(input,{actor,model,isCurrent,visionEnabled=false,styleEnabled=false,styleVisionModels=[],videoRewriteEnabled=false,uiDraftEnabled=false,audioRewriteEnabled=false}={}) {
  if(input?.mode==='style-analysis') {
    if(styleEnabled!==true)fail('operation-intent-unsupported');
    if(input.kind!=='aifx-supplement'&&(visionEnabled!==true||!styleVisionModels.includes(model)))fail('model-vision-unavailable',503);
    return canonicalizeXiaotaoV3StyleIntent(input);
  }
  if(input?.mode==='video-rewrite') {
    if(videoRewriteEnabled!==true)fail('operation-intent-unsupported');
    if(Object.hasOwn(input,'images')&&(visionEnabled!==true||!VIDEO_VISION_MODELS.has(model)))fail('model-vision-unavailable',503);
    return canonicalizeXiaotaoV3VideoIntent(input,{visionEnabled});
  }
  if(input?.mode==='ui-draft') {
    if(uiDraftEnabled!==true)fail('operation-intent-unsupported');
    if(Array.isArray(input?.request?.references)&&input.request.references.length>0&&(visionEnabled!==true||!VIDEO_VISION_MODELS.has(model)))fail('model-vision-unavailable',503);
    return canonicalizeXiaotaoV3UiIntent(input,{actor,model,isCurrent});
  }
  if(input?.mode==='audio-rewrite') {
    if(audioRewriteEnabled!==true)fail('operation-intent-unsupported');
    return canonicalizeXiaotaoV3AudioIntent(input);
  }
  return canonicalizeXiaotaoV3ChatIntent(input,{visionEnabled});
}
const snapshotText=policy=>JSON.stringify({schema:policy.schema,revision:policy.revision,providerRevision:policy.providerRevision,
  defaultModel:policy.defaultModel,config:policy.config,models:policy.models});

// All injected arguments are server-owned. Never pass browser-provided provider,
// keys, RPC, isCurrent, pricing, costs, or an untrusted canonicalizer here.
export function createXiaotaoOperationV3Prepare({enabled=false,visionEnabled=false,styleEnabled=false,styleVisionModels=[],videoRewriteEnabled=false,uiDraftEnabled=false,audioRewriteEnabled=false,secret,loadProvider,rpc}={}) {
  if(enabled===true && (!Buffer.isBuffer(secret)||secret.length<32||typeof loadProvider!=='function'||typeof rpc!=='function')) fail('invalid-server-config',503);
  const key=enabled===true?Buffer.from(secret):null;
  return async function prepareXiaotaoOperationV3({user,sessionId,payload,signal,isCurrent}={}) {
    if(enabled!==true)fail('operation-billing-disabled',503);
    if(!user||typeof user.id!=='string'||!UUID.test(user.id)||typeof sessionId!=='string'||!sessionId||sessionId.length>128||typeof isCurrent!=='function') fail('invalid-server-actor');
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!['nonce','model','intent'].includes(k))||!UUID.test(payload.nonce||'')||!XIAOTAO_ONLINE_MODEL_IDS.includes(payload.model)) fail('invalid-operation-terms');
    if(signal?.aborted)fail('cancelled-before-prepare',409);
    const actor={userId:user.id.toLowerCase(),sessionId};
    if(await isCurrent(actor)!==true)fail('selection-stale',401);
    const {intentHash,compiled}=await canonicalizeXiaotaoV3OperationIntent(payload.intent,{actor,model:payload.model,isCurrent,visionEnabled,styleEnabled,styleVisionModels,videoRewriteEnabled,uiDraftEnabled,audioRewriteEnabled});
    const loaded=await loadProvider();
    if(!loaded||typeof loaded!=='object'||!loaded.creditConfig||typeof loaded.creditConfig!=='object')fail('operation-pricing-unavailable',503);
    const provider={...loaded,creditConfig:structuredClone(loaded.creditConfig),
      ...(loaded.billingExpectedConfig!=null?{billingExpectedConfig:structuredClone(loaded.billingExpectedConfig)}:{})};
    const policy=await companionPricingPolicy(provider);
    if(!policy.models.some(item=>item.id===payload.model&&item.available===true))fail('operation-model-unavailable',503);
    const decimalAmountPolicy=hasXiaotaoDecimalV1(policy.config)?{amountPolicy:'decimal-v1'}:{};
    let styleQuote=null;
    if(payload.intent.mode==='audio-rewrite') {
      if(policy.config.xiaotao_online.operation_audio_rewrite_v3!==true)fail('operation-billing-disabled',503);
      const estimate=estimateXiaotaoOnlineCredits({text:compiled.userText,history:'',system:compiled.systemText,files:[],outputTokens:compiled.outputTokens,config:policy.config,model:payload.model,...decimalAmountPolicy});
      if(!isXiaotaoCreditAmount(estimate.credits,policy.config))fail('operation-pricing-unavailable',503);
      styleQuote={estimatedCredits:estimate.credits,outputTokens:compiled.outputTokens};
    }
    if(payload.intent.mode==='ui-draft') {
      if(policy.config.xiaotao_online.operation_ui_draft_v3!==true)fail('operation-billing-disabled',503);
      if(compiled.imageCount&&(!policy.config.xiaotao_online.operation_vision_chat_v3||!VIDEO_VISION_MODELS.has(payload.model)))fail('model-vision-unavailable',503);
      const estimate=estimateXiaotaoOnlineCredits({text:compiled.userText,history:'',system:compiled.systemText,files:Array.from({length:compiled.imageCount},()=>({kind:'image'})),outputTokens:compiled.outputTokens,config:policy.config,model:payload.model,...decimalAmountPolicy});
      if(!isXiaotaoCreditAmount(estimate.credits,policy.config))fail('operation-pricing-unavailable',503);
      styleQuote={estimatedCredits:estimate.credits,outputTokens:compiled.outputTokens};
    }
    if(payload.intent.mode==='video-rewrite') {
      if(policy.config.xiaotao_online.operation_video_rewrite_v3!==true)fail('operation-billing-disabled',503);
      if(compiled.imageCount&&(!policy.config.xiaotao_online.operation_vision_chat_v3||!VIDEO_VISION_MODELS.has(payload.model)))fail('model-vision-unavailable',503);
      const estimate=estimateXiaotaoOnlineCredits({text:compiled.userText,history:'',system:compiled.systemText,files:Array.from({length:compiled.imageCount},()=>({kind:'image'})),outputTokens:compiled.outputTokens,config:policy.config,model:payload.model,...decimalAmountPolicy});
      if(!isXiaotaoCreditAmount(estimate.credits,policy.config))fail('operation-pricing-unavailable',503);
      styleQuote={estimatedCredits:estimate.credits,outputTokens:compiled.outputTokens};
    }
    if(payload.intent.mode==='style-analysis') {
      if(policy.config.xiaotao_online.operation_style_v3!==true)fail('operation-billing-disabled',503);
      if(compiled.imageCount&&(!policy.config.xiaotao_online.operation_vision_chat_v3||!policy.config.xiaotao_online.operation_style_vision_models?.includes(payload.model)))fail('model-vision-unavailable',503);
      const stages=compiled.stages||[compiled];
      const estimates=stages.map(stage=>estimateXiaotaoOnlineCredits({text:stage.userText,history:'',system:stage.systemText,files:Array.from({length:stage.imageCount},()=>({kind:'image'})),outputTokens:stage.outputTokens,config:policy.config,model:payload.model,...decimalAmountPolicy}));
      if(estimates.some(item=>!isXiaotaoCreditAmount(item.credits,policy.config)))fail('operation-pricing-unavailable',503);
      let total;try{total=sumXiaotaoCreditAmounts(estimates.map(item=>item.credits),policy.config);}catch{fail('operation-pricing-unavailable',503);}
      styleQuote={estimatedCredits:total,outputTokens:compiled.outputTokens};
    }
    const rawSnapshot=snapshotText(policy);
    const ports=createXiaotaoOperationV3Ports(rpc,{enabled:true,policyVersion:policy.version,
      roundMode:policy.config.token_billing.round,expectedCap:policy.config.xiaotao_online.message_cap_credits,
      expectedConfig:provider.billingExpectedConfig??provider.creditConfig,policySnapshotText:rawSnapshot});
    const tickets=createXiaotaoOperationV3Tickets({enabled:true,secret:key,isCurrent:async candidate=>isCurrent(candidate)});
    const issued=await tickets.issue({actor,nonce:payload.nonce,model:payload.model,policyVersion:policy.version,intentHash});
    if(signal?.aborted || await isCurrent(actor)!==true)fail('selection-stale',409);
    // The token is not returned until the durable route claim has succeeded.
    // This claim protects only traffic sharing this identity and gateway;
    // legacy v2 direct requests do not magically gain cross-protocol idempotency.
    const result=await ports.claimRoute({actor:{...actor,operationId:issued.operationId,model:payload.model,
      policyVersion:policy.version,intentHash},operationId:issued.operationId,route:'v3'});
    if(!result || result.route!=='v3' || typeof result.idempotent!=='boolean')fail('operation-status-unknown',503);
    if(signal?.aborted || await isCurrent(actor)!==true)fail('selection-stale',409);
    return {...issued,model:payload.model,policyVersion:policy.version,intentHash,...(styleQuote||{})};
  };
}
