import {createCompanionChat} from './companion-chat.mjs';
import {companionPricingPolicy,companionProviderRevision} from './companion-pricing.mjs';
import {createOnlineAiCharge} from './online-ai-charge.mjs';
import {createXiaotaoV2CreditPorts} from './xiaotao-v2-credit-ports.mjs';
import {createCompanionArtBusiness} from './companion-art-business.mjs';
import {XIAOTAO_FLAT_RATE_MODEL_IDS,isXiaotaoFlatRateModel} from './xiaotao-online-models.mjs';
import {withLiveRates} from './runninghub-live-rates.mjs';

// A malformed server overlay must not silently become a chargeable default.
// Preserve the signal without throwing here: recovery-only paths must stay usable.
const INVALID_ONLINE_OVERLAY=Symbol('invalid-online-pricing-overlay');
const invalidOverlay=()=>({enabled_models:[],[INVALID_ONLINE_OVERLAY]:true});
export function parseCompanionOnlineOverlay(input) {
  if (input === undefined) return undefined;
  try {
    const parsed=JSON.parse(input);
    return parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed : invalidOverlay();
  } catch { return invalidOverlay(); }
}

const invalidPricingConfig=()=>{throw Object.assign(new Error('在线计费配置无效，暂时无法执行；请联系管理员核对'),{status:503,statusCode:503,code:'operation-billing-unavailable'});};

// Defaults remain valid for absent fields. An explicitly malformed value must
// not silently become a different chargeable price or rounding policy.
function validateEffectiveOnlinePrices(raw, online) {
  const fail=invalidPricingConfig;
  const own=(value,key)=>Object.hasOwn(value,key);
  const object=value=>value && typeof value==='object' && !Array.isArray(value);
  const finite=(value,min,max,{integer=false}={})=>{
    if(typeof value!=='number' && !(typeof value==='string' && value.trim()!==''))return false;
    const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max&&(!integer||Number.isSafeInteger(n));
  };
  if(own(raw,'xiaotao_online')&&!object(raw.xiaotao_online))fail();
  if(object(raw.xiaotao_online)&&own(raw.xiaotao_online,'message_cap_credits')){
    const cap=raw.xiaotao_online.message_cap_credits;
    if(typeof cap==='string'&&!/^\d+(?:\.\d+)?$/.test(cap))fail();
    if(!finite(cap,1,1000000,{integer:true}))fail();
  }
  if(own(raw,'credits_per_usd')&&!finite(raw.credits_per_usd,Number.MIN_VALUE,Number.MAX_VALUE))fail();
  if(own(raw,'token_billing')) {
    if(!object(raw.token_billing))fail();
    if(own(raw.token_billing,'round') && (typeof raw.token_billing.round!=='string'||!['ceil','floor','round'].includes(raw.token_billing.round.trim().toLowerCase())))fail();
  }
  if(own(online,'markup')&&!finite(online.markup,Number.MIN_VALUE,1000))fail();
  if(own(online,'usd_per_million_tokens')&&!finite(online.usd_per_million_tokens,0,1000))fail();
  const rounded=(value,min,max)=>finite(value,0,Number.MAX_VALUE) && Math.round(Number(value))>=min && Math.round(Number(value))<=max;
  for(const [key,min,max] of [['chars_per_token',1,100],['output_tokens',0,100000]])if(own(online,key)&&!rounded(online[key],min,max))fail();
  if(own(online,'file_tokens')){
    if(!object(online.file_tokens))fail();
    for(const key of ['image','video','audio'])if(own(online.file_tokens,key)&&!rounded(online.file_tokens[key],0,1000000))fail();
  }
  if(own(online,'grok_4_7_rates')){
    const rates=online.grok_4_7_rates;if(!object(rates))fail();
    for(const key of ['input','output','cached_input','high_input','high_output','high_cached_input'])if(own(rates,key)&&!finite(rates[key],0,1000))fail();
    if(own(rates,'high_input_threshold')&&!finite(rates.high_input_threshold,1,Number.MAX_SAFE_INTEGER,{integer:true}))fail();
  }
  if(own(online,'model_rates')){
    const rates=online.model_rates;if(!object(rates))fail();
    const models={
      ...Object.fromEntries(XIAOTAO_FLAT_RATE_MODEL_IDS.map(model=>[model,['input','output','cached']])),
      'openai/gpt-6.1-sol-saver':['input','output','cached','highInput','highOutput']
    };
    for(const [model,keys] of Object.entries(models)){
      if(!own(rates,model))continue;const entry=rates[model];if(!object(entry))fail();
      for(const key of keys)if(own(entry,key)&&!finite(entry[key],0,1000))fail();
      if(model==='openai/gpt-6.1-sol-saver'&&own(entry,'highAbove')&&(!Number.isSafeInteger(entry.highAbove)||entry.highAbove<0))fail();
    }
  }
}

// The DB snapshot is service-only. It is checked again atomically by the v2
// reservation RPC, and its cap is persisted in the ledger for settlement.
export async function createCompanionPricingContext({liveRates=null,provider,dbSnapshot,envOnline,legacyCharge,rpc,fetchImpl,artBusiness,operationV3}={}) {
  const operationRequired=operationV3?.enabled===true;
  const legacyUnavailable=()=>{throw Object.assign(new Error('在线计费已升级，请更新页面后重新发起；未提交的新阶段不会扣费。'),{status:409,code:'operation-billing-required'});};
  const raw=dbSnapshot?.config == null ? dbSnapshot?.config : structuredClone(dbSnapshot.config);
  const cap=dbSnapshot?.message_cap_credits;
  const ready=dbSnapshot?.protocol === 'xiaotao-pricing-v2' && raw && typeof raw==='object' && !Array.isArray(raw)
    && Number.isSafeInteger(cap) && cap>=1 && cap<=1000000 && typeof rpc==='function'
    && companionProviderRevision(provider)!==null;
  const overlay=envOnline && typeof envOnline==='object' && !Array.isArray(envOnline) ? envOnline : {};
  if(overlay[INVALID_ONLINE_OVERLAY])invalidPricingConfig();
  if(!ready) {
    if(operationRequired)throw Object.assign(new Error('操作级计费状态暂不可用，请稍后重试。'),{status:503,code:'operation-billing-unavailable'});
    const service=createCompanionChat({provider:{...provider,creditConfig:{xiaotao_online:overlay},pricingSnapshotReady:false},charge:legacyCharge,fetchImpl});
    const art=await createCompanionArtBusiness();
    service.artQuote=request=>art.quote(request);
    service.artExecute=request=>art.execute(request);
    service.artCancel=request=>art.cancel(request);
    return service;
  }
  // A rolling deploy can leave old Edge instances alive. Never advertise or
  // dispatch v3 until the database-wide legacy reservation fence is active.
  if(operationRequired){
    let gate;try{gate=await rpc('get_xiaotao_operation_v3_gate_state',{});}catch{}
    if(!gate||gate.enforced!==true)throw Object.assign(new Error('操作级计费切换尚未完成，请稍后重试。'),{status:503,code:'operation-billing-unavailable'});
  }
  const dbOnline=raw.xiaotao_online && typeof raw.xiaotao_online==='object' && !Array.isArray(raw.xiaotao_online) ? raw.xiaotao_online : {};
  // Existing authorization for extra routes remains explicit in companion env;
  // public/account DB settings alone do not grant a model route.
  const enabledModels=envOnline === undefined ? ['openai/gpt-6.1-sol-saver', ...(operationRequired ? XIAOTAO_FLAT_RATE_MODEL_IDS : [])] : Array.isArray(overlay.enabled_models) ? overlay.enabled_models.some(isXiaotaoFlatRateModel) ? [...new Set([...overlay.enabled_models,...XIAOTAO_FLAT_RATE_MODEL_IDS])] : overlay.enabled_models : [];
  const online=withLiveRates({...dbOnline,...overlay,message_cap_credits:cap,enabled_models:enabledModels},liveRates);
  const creditConfig={...raw,xiaotao_online:online};
  validateEffectiveOnlinePrices(raw,online);
  const buildOperationHandlers=operationV3?.enabled===true && typeof operationV3.createHandlers==='function';
  // A server-owned opt-in is necessary but not sufficient.  The service-role
  // readiness RPC is provided only by the checked decimal ledger migration;
  // ordinary user payloads and mutable price configuration cannot claim it.
  const buildDecimalHandlers=buildOperationHandlers && operationV3.decimalCreditsEnabled===true;
  let decimalLedgerReady=false;
  if(buildDecimalHandlers){
    let readiness;try{readiness=await rpc('get_xiaotao_decimal_v1_readiness',{});}catch{}
    const amountKeys=['credit_amount_policy','credit_precision','credit_rounding','minimum_positive_credits'];
    const matchesDatabase=amountKeys.every(key=>Object.hasOwn(dbOnline,key)&&Object.hasOwn(online,key)&&dbOnline[key]===online[key]);
    decimalLedgerReady=readiness?.ready===true && readiness?.protocol==='nf.xiaotao.decimal.v1'
      && readiness?.credit_precision===6 && matchesDatabase;
  }
  // The capability is published only by a trusted server assembly, and only
  // when its handler factory explicitly confirms that both endpoints enforce
  // image binding. It is part of the hashed pricing policy, not a client flag.
  const buildVisionHandlers=buildOperationHandlers && operationV3.visionEnabled===true;
  const buildStyleHandlers=buildOperationHandlers && operationV3.styleEnabled===true;
  const buildVideoHandlers=buildOperationHandlers && operationV3.videoRewriteEnabled===true;
  const buildAudioHandlers=buildOperationHandlers && operationV3.audioRewriteEnabled===true;
  const buildUiDraftHandlers=buildOperationHandlers && operationV3.uiDraftEnabled===true;
  const buildFoartOpenHandlers=buildOperationHandlers && operationV3.foartOpenEnabled===true;
  const buildFoartHandlers=buildFoartOpenHandlers;
  const buildGeneralHandlers=buildFoartOpenHandlers && operationV3.foartGeneralEnabled===true;
  const buildArtOperationHandlers=artBusiness?.enabled===true && artBusiness?.accountingReady===true && typeof artBusiness?.operationV3ForRequest==='function';
  const snapshotProvider={...provider,creditConfig,pricingSnapshotReady:true,operationTextChatV3:buildOperationHandlers,
    operationDecimalCreditsV1:buildDecimalHandlers,operationDecimalLedgerReady:decimalLedgerReady,
    operationVisionChatV3:buildVisionHandlers,operationStyleV3:buildStyleHandlers,operationStyleVisionModels:buildStyleHandlers&&buildVisionHandlers?operationV3.styleVisionModels:[],operationVideoRewriteV3:buildVideoHandlers,operationAudioRewriteV3:buildAudioHandlers,operationUiDraftV3:buildUiDraftHandlers,operationFoartOpenV3:buildFoartOpenHandlers,operationFoartGeneralV3:buildGeneralHandlers,
    operationArtV3:buildArtOperationHandlers};
  // An opt-in factory receives precisely the effective snapshot advertised to
  // the webpage and the raw DB comparison config. Neither comes from a request.
  const builtOperationHandlers=buildOperationHandlers
    ? await operationV3.createHandlers({provider:{...snapshotProvider,creditConfig:structuredClone(creditConfig),billingExpectedConfig:structuredClone(raw)},rpc})
    : null;
  if(buildOperationHandlers && (typeof builtOperationHandlers?.prepareXiaotaoOperationV3!=='function'||typeof builtOperationHandlers?.executeXiaotaoOperationV3!=='function'))
    throw Object.assign(new Error('operation-billing-unavailable'),{code:'operation-billing-unavailable',statusCode:503});
  if(buildDecimalHandlers && builtOperationHandlers?.operationDecimalCreditsSupported!==true)
    throw Object.assign(new Error('operation-decimal-unavailable'),{code:'operation-decimal-unavailable',statusCode:503});
  if(buildStyleHandlers && builtOperationHandlers?.operationStyleSupported!==true)
    throw Object.assign(new Error('operation-style-unavailable'),{code:'operation-style-unavailable',statusCode:503});
  if(buildVideoHandlers && builtOperationHandlers?.operationVideoRewriteSupported!==true)
    throw Object.assign(new Error('operation-video-rewrite-unavailable'),{code:'operation-video-rewrite-unavailable',statusCode:503});
  if(buildAudioHandlers && builtOperationHandlers?.operationAudioRewriteSupported!==true)
    throw Object.assign(new Error('operation-audio-rewrite-unavailable'),{code:'operation-audio-rewrite-unavailable',statusCode:503});
  if(buildUiDraftHandlers && builtOperationHandlers?.operationUiDraftSupported!==true)
    throw Object.assign(new Error('operation-ui-draft-unavailable'),{code:'operation-ui-draft-unavailable',statusCode:503});
  if(buildVisionHandlers && builtOperationHandlers?.operationVisionSupported!==true)
    throw Object.assign(new Error('operation-vision-unavailable'),{code:'operation-vision-unavailable',statusCode:503});
  if(buildFoartHandlers && ['prepare','start','resume','cancel'].some(name=>typeof builtOperationHandlers?.foart?.[name]!=='function'))
    throw Object.assign(new Error('operation-foart-unavailable'),{code:'operation-foart-unavailable',statusCode:503});
  const policy=await companionPricingPolicy(snapshotProvider);
  const v2Ports=createXiaotaoV2CreditPorts(rpc,{expectedConfig:raw,expectedCap:cap,policyVersion:policy.version});
  const versionedCharge=createOnlineAiCharge({...v2Ports,strictSettlement:true});
  const guardedArtCharge=createOnlineAiCharge({...v2Ports,strictSettlement:true,guardedDispatch:true});
  const versioned=createCompanionChat({provider:snapshotProvider,charge:versionedCharge,fetchImpl});
  // Bind each art request to the verifier supplied by the control plane for
  // that request. Never retain one caller's session closure in a shared context.
  const artForRequest=async request=>{
    // A v3 adapter owns a session-verification closure. Construct it for this
    // request only; never reuse one caller's verifier in a shared context.
    const operationV3=typeof artBusiness?.operationV3ForRequest==='function'
      ? await artBusiness.operationV3ForRequest({provider:{...snapshotProvider,billingExpectedConfig:structuredClone(raw)},
        rpc,isCurrent:request?.isCurrent}) : undefined;
    if(operationRequired && (!buildArtOperationHandlers||operationV3?.enabled!==true))
      throw Object.assign(new Error('在线美工的操作级计费尚未开通，本次未提交。'),{status:503,code:'operation-art-unavailable'});
    return createCompanionArtBusiness({...artBusiness,operationV3,isCurrent:request?.isCurrent,
      provider:snapshotProvider,charge:guardedArtCharge,fetchImpl});
  };
  // Server-owned, opt-in injection only. No request field or stored setting
  // enables v3. The legacy pricing/settlement route remains untouched.
  const operationHandlers=buildOperationHandlers ? builtOperationHandlers : operationV3?.enabled===true &&
    typeof operationV3.prepareXiaotaoOperationV3==='function' && typeof operationV3.executeXiaotaoOperationV3==='function'
    ? {prepareXiaotaoOperationV3:operationV3.prepareXiaotaoOperationV3,executeXiaotaoOperationV3:operationV3.executeXiaotaoOperationV3}
    : {};
  return {
    ...operationHandlers,
    ...(buildFoartHandlers?{foartOperation:builtOperationHandlers.foart}:{}),
    pricing:()=>versioned.pricing(),
    quote:request=>versioned.quote(request),
    artQuote:async request=>(await artForRequest(request)).quote(request),
    artExecute:async request=>(await artForRequest(request)).execute(request),
    artCancel:async request=>(await artForRequest(request)).cancel(request),
    // Cutover rejects new old-route work before any quote, reservation or
    // provider call. Requests already inside their old closure may settle.
    reply:request=>operationRequired ? legacyUnavailable() : versioned.reply(request)
  };
}
