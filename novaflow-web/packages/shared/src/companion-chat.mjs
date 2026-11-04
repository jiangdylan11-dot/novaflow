// One metered multimodal conversation, without application execution tools.
import {isArtPromptLanguage,artPromptLanguageSystem} from './art-prompt-language.mjs';
import {postRunningHubResponses} from './runninghub-llm.mjs';
import {XIAOTAO_TEXT_SYSTEM,XIAOTAO_VISION_SYSTEM,estimateXiaotaoOnlineCredits,settleXiaotaoOnlineCredits,xiaotaoFileKind,tokenUsageRecord,xiaotaoOnlinePolicy,parseUsageUsd} from './feature-credits.mjs';
import {FOART_TOOL_SYSTEM,validateFoartContext,readFoartPlan,foartPlanResponseFormat,foartUnsupportedMediaAnalysis} from './foart-tool-plan.mjs';
import {isXiaotaoFlatRateModel} from './xiaotao-online-models.mjs';
import {COMPANION_OUTPUT_TOKENS,companionPricingPolicy,companionQuoteFingerprint,isNewPricedModel} from './companion-pricing.mjs';
export class CompanionError extends Error {constructor(status,message,code='companion-failed'){super(message);this.status=status;this.code=code;}}
const need=(ok,message)=>{if(!ok)throw new CompanionError(400,message);};
const MAX_OUTPUT_TOKENS=COMPANION_OUTPUT_TOKENS;
function sampleTokenCount(value){
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value.trim()))return null;
 const count=Math.round(Number(value));
 return Number.isSafeInteger(count)&&count>=0?count:null;
}
function combinedUsage(records){
 const sum=key=>records.every(row=>Number.isFinite(row?.[key])&&row[key]>=0)?records.reduce((total,row)=>total+row[key],0):null;
 const cached=records.map(row=>row?.prompt_tokens_details?.cached_tokens);
 const costs=records.map(row=>parseUsageUsd(row).usd);
 return Object.fromEntries([...['input_tokens','output_tokens','prompt_tokens','completion_tokens','total_tokens'].map(key=>[key,sum(key)]),['consumeMoney',costs.every(n=>n!=null)?costs.reduce((a,b)=>a+b,0):null],...(cached.every(n=>Number.isFinite(n))?[['prompt_tokens_details',{cached_tokens:cached.reduce((a,b)=>a+b,0)}]]:[])]);
}
function billingSampleFor(model,usage,decision,config){
 const tokens=tokenUsageRecord(usage)||{};
 let inputTokens=sampleTokenCount(tokens.input_tokens)??sampleTokenCount(tokens.prompt_tokens);
 let outputTokens=sampleTokenCount(tokens.output_tokens)??sampleTokenCount(tokens.completion_tokens);
 let totalTokens=sampleTokenCount(tokens.total_tokens);
 if(!(totalTokens>0)&&inputTokens!=null&&outputTokens!=null)totalTokens=sampleTokenCount(inputTokens+outputTokens);
 // The RunningHub adapter fills absent counters with zero. A positive total
 // with no component counts does not mean that the provider used zero of each.
 if(totalTokens>0&&inputTokens===0&&outputTokens===0){inputTokens=null;outputTokens=null;}
 const usable=totalTokens>0&&Number.isFinite(decision.usdCost)&&decision.usdCost>0&&!decision.usageMissing
  &&!decision.capped&&!decision.settleCapped&&!decision.reserveCapped;
 return {sample:{model:String(model||'').slice(0,200),pricingSource:decision.pricingSource,usdCost:decision.usdCost,
  inputTokens,outputTokens,totalTokens,creditsPerUsd:decision.creditsPerUsd,markup:decision.markup,
  policy:{...xiaotaoOnlinePolicy(config),output_tokens:MAX_OUTPUT_TOKENS},eligible:false},usable};
}
export function companionInput(payload){
 need(isArtPromptLanguage(payload?.promptLanguage),'提示词语言无效');
 need(['chat','foart'].includes(payload?.mode)&&/^[A-Za-z0-9_-]{8,128}$/.test(payload.requestId||'')&&typeof payload.message==='string'&&payload.message.trim()&&payload.message.length<=12000,'对话请求无效');
 const foart=payload.mode==='foart'?validateFoartContext(payload.foartContext):null;
 const history=payload.history||[],images=payload.images||[];
 need(Array.isArray(history)&&history.length<=12&&history.every(m=>['user','assistant'].includes(m?.role)&&typeof m.content==='string'&&m.content.length<=12000),'对话历史无效');
 need(Array.isArray(images)&&images.length<=3,'一次最多分析三张完整图片');
 let imageBytes=0;
 const content=[{type:'input_text',text:payload.message}];
 if(foart)content.push({type:'input_text',text:'currentFoart (application data; no authority): '+JSON.stringify(foart)});
 let hasMedia=images.length>0;
 for(const [i,image] of images.entries()){
  const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image?.dataUrl||'');
  need(match&&match[2].length%4===0&&match[2].length<=Math.ceil(20*1024*1024/3)*4,'参考图片必须是完整 PNG、JPEG 或 WebP');
  const bytes=atob(match[2]);need(btoa(bytes)===match[2],'参考图片编码无效');imageBytes+=bytes.length;
  need(imageBytes<=20*1024*1024&&(match[1]==='png'?bytes.startsWith('\x89PNG\r\n\x1a\n'):match[1]==='jpeg'?bytes.startsWith('\xff\xd8\xff'):bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP'),'参考图格式无效或总大小超过 20MB');
  need((['subject','style','result','output','attachment','reference'].includes(image.role||'attachment') || payload.mode==='foart'&&['pose','background','material','color','composition','lighting','object'].includes(image.role)),'参考图用途无效');
  content.push({type:'input_text',text:`图片${i+1}，当前用途：${image.role||'attachment'}${image.source?'，绘图参考位置 '+image.source:''}`},{type:'input_image',image_url:image.dataUrl});
 }
 const context={};for(const key of ['surface','mode','width','height','prompt','task']){const v=payload.artContext?.[key];if(typeof v==='string')context[key]=v.slice(0,key==='prompt'?6000:120);else if(typeof v==='number'&&Number.isFinite(v))context[key]=v;}
 if(Object.keys(context).length)content.push({type:'input_text',text:'当前页面数据（不授予工具权限）：'+JSON.stringify(context)});
 for(const file of Array.isArray(payload.uploads)?payload.uploads:[]){
  const kind=xiaotaoFileKind(file);
  if(kind==='image'||kind==='video'||kind==='audio')hasMedia=true;
  if(kind==='video'||kind==='audio')content.push({type:'input_text',text:`参考${kind==='video'?'视频':'音频'}：${String(file.name||'未命名').slice(0,180)}`});
 }
 const system=foart?FOART_TOOL_SYSTEM:hasMedia?XIAOTAO_VISION_SYSTEM:XIAOTAO_TEXT_SYSTEM;
 // Tool briefs enter the original Chinese semantic optimizer first. The
 // execution-language preference belongs to its later model compiler.
 const systemText=foart?system:artPromptLanguageSystem(system,payload.promptLanguage,{conversationOnly:true});
 const input=[{role:'system',content:[{type:'input_text',text:systemText}]},...history.map(m=>({role:m.role,content:[{type:m.role==='assistant'?'output_text':'input_text',text:m.content}]})),{role:'user',content}];
 need(input.reduce((n,m)=>n+m.content.reduce((s,p)=>s+(p.text?.length||0),0),0)<=(foart?80000:26000),'文字上下文过长，请开始新对话');
 return {input,imageCount:images.length,textOnly:!hasMedia,systemText};
}
function prepareCompanionRequest(provider,payload,{quoteOnly=false}={}){
  const {input,imageCount,textOnly,systemText}=companionInput(payload);
  // Explicit selections must never silently use the server's different model.
  // Older clients omit modelId and continue to use the configured route.
  const enabledModels=Array.isArray(provider.creditConfig?.xiaotao_online?.enabled_models)?provider.creditConfig.xiaotao_online.enabled_models:[];
  // Flat-rate models (DeepSeek, Qwen, GLM) and Grok are offered only for a trusted v3 quote.
  const v3Quote=quoteOnly && provider.operationTextChatV3===true && (isXiaotaoFlatRateModel(payload.modelId) || payload.modelId==='xai/grok-4.7') && enabledModels.includes(payload.modelId);
  const explicitlyEnabled=(isNewPricedModel(payload.modelId)&&enabledModels.includes(payload.modelId)) || v3Quote;
  if(payload.modelId != null && !explicitlyEnabled && (payload.modelId !== 'xai/grok-4.7' || provider.model !== payload.modelId))
   throw new CompanionError(503,'所选在线模型尚未开通或后台配置不匹配，本次未扣积分');
  const selectedModel=payload.modelId || provider.model;
  if(isXiaotaoFlatRateModel(selectedModel) && !v3Quote)
   throw new CompanionError(503,'所选在线模型只支持按操作计费，本次未扣积分');
  // Metadata binds native tools; it does not grant audio/video understanding.
  if((payload.mode!=='foart'&&(Array.isArray(payload.uploads)?payload.uploads:[]).some(file=>['video','audio'].includes(xiaotaoFileKind(file))))||payload.mode==='foart'&&foartUnsupportedMediaAnalysis(payload.message,(payload.uploads||[]).map(file=>({...file,kind:xiaotaoFileKind(file)}))))
   throw new CompanionError(400,'当前在线模型暂不支持分析音频或视频，本次未扣积分');
  if(!provider.apiKey)throw new CompanionError(503,textOnly?'在线对话服务尚未配置':'在线图片分析服务尚未配置');
  const historyText=(payload.history||[]).map(item=>item?.content||'').join('\n');
  const uploads=Array.isArray(payload.uploads)?payload.uploads:[];
  const imageCountForBill=Math.max(imageCount,uploads.filter(file=>xiaotaoFileKind(file)==='image').length);
  const captions=uploads.filter(file=>['video','audio'].includes(xiaotaoFileKind(file))).map(file=>`参考${xiaotaoFileKind(file)==='video'?'视频':'音频'}：${String(file.name||'未命名').slice(0,180)}`);
  const files=Array.from({length:imageCountForBill},()=>({kind:'image'}));
  const estimate=estimateXiaotaoOnlineCredits({text:payload.message+(payload.mode==='foart'?'\n'+JSON.stringify(payload.foartContext):'')+(captions.length?'\n'+captions.join('\n'):''),history:historyText,system:systemText,files,outputTokens:MAX_OUTPUT_TOKENS,config:provider.creditConfig,model:selectedModel,promptLanguage:payload.promptLanguage,
   ...(provider.operationTextChatV3===true && provider.operationDecimalCreditsV1===true && provider.operationDecimalLedgerReady===true ? {amountPolicy:'decimal-v1'} : {})});
  const feature=imageCountForBill?'xiaotao-vision':'xiaotao-text';
  return {input,imageCount,textOnly,systemText,selectedModel,explicitlyEnabled,estimate,feature};
}
export function createCompanionChat({provider,fetchImpl=fetch,charge}){
 // A request uses one immutable pricing snapshot even if a caller later
 // refreshes its in-memory configuration while the provider is processing.
 provider={...provider,creditConfig:provider?.creditConfig == null ? provider?.creditConfig : structuredClone(provider.creditConfig)};
 return {
 async pricing(){return companionPricingPolicy(provider);},
 async quote({payload}){
  if(provider.pricingSnapshotReady !== true)throw new CompanionError(503,'在线计费策略尚未同步，本次未扣积分');
  const {selectedModel,estimate}=prepareCompanionRequest(provider,payload,{quoteOnly:true});
  const policy=await companionPricingPolicy(provider);
  if(!policy.models.some(model=>model.id === (payload.modelId || 'legacy-online') && model.available))
   throw new CompanionError(503,'所选在线模型尚未开通或无法安全报价，本次未扣积分');
  return {pricingVersion:policy.version,quoteFingerprint:await companionQuoteFingerprint(payload,policy.version),modelId:selectedModel,estimatedCredits:estimate.credits};
 },
 async reply({user,payload}){
  const {input,imageCount,textOnly,selectedModel,explicitlyEnabled,estimate,feature}=prepareCompanionRequest(provider,payload);
  // New routes require a quote; old clients on the established route remain
  // compatible. If either quote field is supplied, both must match this snapshot.
  let validatedPolicy=null;
  if(isNewPricedModel(selectedModel) || payload.pricingVersion != null || payload.quoteFingerprint != null){
   if(provider.pricingSnapshotReady !== true)throw new CompanionError(503,'在线计费策略尚未同步。本次未调用模型；如该请求曾提交，请核对积分状态');
   const policy=await companionPricingPolicy(provider);
   if(!policy.models.some(model=>model.id === (payload.modelId || 'legacy-online') && model.available))
    throw new CompanionError(503,'所选在线模型尚未开通或无法安全报价。本次未调用模型；如该请求曾提交，请核对积分状态');
   if(payload.pricingVersion !== policy.version || payload.quoteFingerprint !== await companionQuoteFingerprint(payload,policy.version))
    throw new CompanionError(409,'计费策略或请求内容已变化，请重新报价。本次未调用模型；如该请求曾提交，请核对积分状态','companion-pricing-changed');
   validatedPolicy=policy;
  }
  if(typeof charge!=='function')throw new CompanionError(503,'在线计量未配置');
  let calibration=null,decisionCredits=null;
  const requirePricedUsage = usage => {
   if(!isNewPricedModel(selectedModel))return;
   const part=settleXiaotaoOnlineCredits({usage,model:selectedModel,config:provider.creditConfig});
   if(part.usageMissing)throw new CompanionError(502,'在线模型已被请求，但用量或费用无法核实；本次未结算积分，请核对预留状态。供应商可能仍产生费用。');
  };
  try{
   const charged=await charge({userId:user.id,feature,amount:1,usageKey:'xiaotao:'+payload.requestId,estimatedCredits:estimate.credits,metadata:{model:selectedModel,imageAnalysis:imageCount>0,estimate:estimate.credits,...(validatedPolicy?{pricing_version:validatedPolicy.version,pricing_policy:validatedPolicy.config}:{})},run:async()=>{
    let posted;
    try{posted=await postRunningHubResponses({body:{model:selectedModel,input,temperature:.4,reasoning:{effort:'low'},max_output_tokens:MAX_OUTPUT_TOKENS,...(payload.mode==='foart'?{text:{format:foartPlanResponseFormat(payload.foartContext)}}:{})},config:{apiKey:provider.apiKey,baseUrl:provider.baseUrl,model:selectedModel},fetchImpl,timeoutMs:60000,maxRetries:0});}
    catch(error){error.chargedAmount=0;throw error;}
    let result=posted.data;
    if(payload.modelId && (result.model ? result.model !== payload.modelId : explicitlyEnabled))
     throw Object.assign(new CompanionError(502,'在线服务返回的模型与所选模型不一致，本次未扣积分'),{chargedAmount:0});
    if(explicitlyEnabled && result.finish_reason==='length')
     throw Object.assign(new CompanionError(502,'在线模型回答被截断，本次未扣积分'),{chargedAmount:0});
    if(result.status!=='completed'||!Array.isArray(result.output)||result.output.some(m=>m.type==='function_call'))throw Object.assign(new CompanionError(502,textOnly?'小桃AI未返回完整文字回复，本次未自动重试':'在线图片分析未返回完整回答，本次未自动重试'),{chargedAmount:0});
    let reply=result.output.flatMap(m=>m.type==='message'&&m.role==='assistant'?(m.content||[]).filter(p=>p.type==='output_text'&&typeof p.text==='string').map(p=>p.text):[]).join('\n').trim();
    if(!reply)throw Object.assign(new CompanionError(502,textOnly?'小桃AI未返回完整文字回复，本次未自动重试':'在线图片分析未返回文字'),{chargedAmount:0});
    requirePricedUsage(result.usage);
    let toolPlan,planningRepairUsed=false;
    const usageRecords=[result.usage],requestIds=[String(posted.requestId||result.id||'').slice(0,200)];
    if(payload.mode==='foart'){
      try{toolPlan=readFoartPlan(reply,payload.foartContext);}
      catch(error){
        // Repair a malformed plan once, before any operation is executed.
        // Missing user intent must still become a clarification, never a guess.
        const firstUsage=result.usage;
        const repaired=await postRunningHubResponses({body:{model:selectedModel,input:[...input,{role:'assistant',content:[{type:'output_text',text:reply}]},{role:'user',content:[{type:'input_text',text:'The previous plan failed validation BEFORE execution: '+error.message+'. No tool was executed. Correct only the invalid JSON fields using the exact operation schema and currentFoart IDs. Do not repeat previously receipted work. image_generate/image_optimize require prompt, generationMode (txt2img or img2img), and useResult (boolean). Atlas conversion uses the whole native batch and cannot use inputIds. If user intent or a required material is missing, return status clarify with no operations.'}]}],temperature:.1,reasoning:{effort:'low'},max_output_tokens:MAX_OUTPUT_TOKENS,text:{format:foartPlanResponseFormat(payload.foartContext)}},config:{apiKey:provider.apiKey,baseUrl:provider.baseUrl,model:selectedModel},fetchImpl,timeoutMs:60000,maxRetries:0});
        result=repaired.data;planningRepairUsed=true;usageRecords.push(result.usage);requestIds.push(String(repaired.requestId||result.id||'').slice(0,200));
        if(payload.modelId && (result.model ? result.model !== payload.modelId : explicitlyEnabled))
         throw Object.assign(new CompanionError(502,'在线服务返回的模型与所选模型不一致，本次未扣积分'),{chargedAmount:0});
        if(explicitlyEnabled && result.finish_reason==='length')
         throw Object.assign(new CompanionError(502,'在线模型回答被截断，本次未扣积分'),{chargedAmount:0});
        if(result.status!=='completed'||!result.output_text)throw Object.assign(new CompanionError(502,'小桃工具方案校正未完成，未执行操作'),{chargedAmount:0});
        requirePricedUsage(result.usage);
        reply=result.output_text;result={...result,usage:combinedUsage([firstUsage,result.usage])};
        try{toolPlan=readFoartPlan(reply,payload.foartContext);}catch(secondError){throw Object.assign(new CompanionError(502,secondError.message),{chargedAmount:0});}
      }
      reply=toolPlan.reply;
    }
    const decision=settleXiaotaoOnlineCredits({usage:result.usage,usageRecords,model:result.model||selectedModel,reservedCredits:estimate.credits,config:provider.creditConfig});
    if(isNewPricedModel(selectedModel) && decision.usageMissing)throw new CompanionError(502,'在线模型已被请求，但用量或费用无法核实；本次未结算积分，请核对预留状态。供应商可能仍产生费用。');
    calibration=billingSampleFor(result.model||selectedModel,result.usage,decision,provider.creditConfig);if(planningRepairUsed)calibration.usable=false;decisionCredits=decision.credits;
    return {amount:1,reply,...(toolPlan?{toolPlan}:{}),model:result.model||selectedModel,imageCount,settledCredits:decision.credits,rhCostUsd:decision.usdCost,pricingSource:decision.pricingSource,metadata:{model:result.model||selectedModel,provider_request_id:requestIds.at(-1),provider_request_ids:requestIds,imageCount,usage:result.usage,request_usage:usageRecords.map(tokenUsageRecord),planningRepairUsed,token_rate_estimate:decision.tokenRateEstimate,billing_warning:decision.warning||null,billing_mode:'token',estimated_credits:estimate.credits,settled_credits:decision.credits}};
   }});
   const actual=sampleTokenCount(charged.quota?.settled_credits);
   const billingSample=calibration?{...calibration.sample,eligible:calibration.usable&&actual!=null&&Number(charged.quota?.settled_credits)===actual&&actual===decisionCredits
    &&charged.quota?.balance_short!==true&&!(Number(charged.quota?.uncollected_credits)>0)
    &&charged.quota?.capped!==true&&charged.quota?.settle_capped!==true&&charged.quota?.reserve_capped!==true}:null;
   return {reply:charged.reply,...(charged.toolPlan?{toolPlan:charged.toolPlan}:{}),model:charged.model,imageCount:charged.imageCount,billingSample,quota:{...(charged.quota||{}),billing_mode:'token',estimated_credits:estimate.credits,settled_credits:charged.quota?.settled_credits??charged.settledCredits,feature}};
  }catch(error){
   if(error instanceof CompanionError)throw error;
   if(error?.code==='xiaotao_pricing_snapshot_changed')throw new CompanionError(409,'计费策略已变化，请重新报价。本次未调用模型；如该请求曾提交，请核对积分状态','companion-pricing-changed');
   if(['xiaotao_reservation_release_unconfirmed','xiaotao_reservation_status_unknown','xiaotao_settlement_status_unknown'].includes(error?.code))
    throw new CompanionError(503,error.message,error.code);
   const status=Number(error?.statusCode)||502;
   throw new CompanionError(status===409?409:status===402?402:502,status===409?'这次对话已提交，请使用新的消息编号':status===402?(error instanceof Error&&/云服务余额不足|积分不足|维护中|单价未配置/.test(error.message)?error.message:'积分不足或暂时不可用'):error instanceof Error&&/在线|小桃AI/.test(error.message)?error.message:textOnly?'在线对话暂未完成，本次未自动重试':'在线图片分析暂未完成，本次未自动重试');
  }
 }};
}
