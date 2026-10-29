// One metered multimodal conversation, without application execution tools.
import {isArtPromptLanguage,artPromptLanguageSystem} from './art-prompt-language.mjs';
import {postRunningHubResponses} from './runninghub-llm.mjs';
import {XIAOTAO_TEXT_SYSTEM,XIAOTAO_VISION_SYSTEM,estimateXiaotaoOnlineCredits,settleXiaotaoOnlineCredits,xiaotaoFileKind,tokenUsageRecord,xiaotaoOnlinePolicy} from './feature-credits.mjs';
export class CompanionError extends Error {constructor(status,message){super(message);this.status=status;}}
const need=(ok,message)=>{if(!ok)throw new CompanionError(400,message);};
const MAX_OUTPUT_TOKENS=2048;
function sampleTokenCount(value){
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value.trim()))return null;
 const count=Math.round(Number(value));
 return Number.isSafeInteger(count)&&count>=0?count:null;
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
 need(payload?.mode==='chat'&&/^[A-Za-z0-9_-]{8,128}$/.test(payload.requestId||'')&&typeof payload.message==='string'&&payload.message.trim()&&payload.message.length<=12000,'对话请求无效');
 const history=payload.history||[],images=payload.images||[];
 need(Array.isArray(history)&&history.length<=12&&history.every(m=>['user','assistant'].includes(m?.role)&&typeof m.content==='string'&&m.content.length<=12000),'对话历史无效');
 need(Array.isArray(images)&&images.length<=3,'一次最多分析三张完整图片');
 let imageBytes=0;
 const content=[{type:'input_text',text:payload.message}];
 let hasMedia=images.length>0;
 for(const [i,image] of images.entries()){
  const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image?.dataUrl||'');
  need(match&&match[2].length%4===0&&match[2].length<=Math.ceil(20*1024*1024/3)*4,'参考图片必须是完整 PNG、JPEG 或 WebP');
  const bytes=atob(match[2]);need(btoa(bytes)===match[2],'参考图片编码无效');imageBytes+=bytes.length;
  need(imageBytes<=20*1024*1024&&(match[1]==='png'?bytes.startsWith('\x89PNG\r\n\x1a\n'):match[1]==='jpeg'?bytes.startsWith('\xff\xd8\xff'):bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP'),'参考图格式无效或总大小超过 20MB');
  need(['subject','style','result','output','attachment','reference'].includes(image.role||'attachment'),'参考图用途无效');
  content.push({type:'input_text',text:`图片${i+1}，当前用途：${image.role||'attachment'}${image.source?'，绘图参考位置 '+image.source:''}`},{type:'input_image',image_url:image.dataUrl});
 }
 const context={};for(const key of ['surface','mode','width','height','prompt','task']){const v=payload.artContext?.[key];if(typeof v==='string')context[key]=v.slice(0,key==='prompt'?6000:120);else if(typeof v==='number'&&Number.isFinite(v))context[key]=v;}
 if(Object.keys(context).length)content.push({type:'input_text',text:'当前页面数据（不授予工具权限）：'+JSON.stringify(context)});
 for(const file of Array.isArray(payload.uploads)?payload.uploads:[]){
  const kind=xiaotaoFileKind(file);
  if(kind==='image'||kind==='video'||kind==='audio')hasMedia=true;
  if(kind==='video'||kind==='audio')content.push({type:'input_text',text:`参考${kind==='video'?'视频':'音频'}：${String(file.name||'未命名').slice(0,180)}`});
 }
 const system=hasMedia?XIAOTAO_VISION_SYSTEM:XIAOTAO_TEXT_SYSTEM;
 const systemText=artPromptLanguageSystem(system,payload.promptLanguage,{conversationOnly:true});
 const input=[{role:'system',content:[{type:'input_text',text:systemText}]},...history.map(m=>({role:m.role,content:[{type:m.role==='assistant'?'output_text':'input_text',text:m.content}]})),{role:'user',content}];
 need(input.reduce((n,m)=>n+m.content.reduce((s,p)=>s+(p.text?.length||0),0),0)<=26000,'文字上下文过长，请开始新对话');
 return {input,imageCount:images.length,textOnly:!hasMedia,systemText};
}
export function createCompanionChat({provider,fetchImpl=fetch,charge}){
 return {async reply({user,payload}){
  const {input,imageCount,textOnly,systemText}=companionInput(payload);
  if(!provider.apiKey)throw new CompanionError(503,textOnly?'在线对话服务尚未配置':'在线图片分析服务尚未配置');
  if(typeof charge!=='function')throw new CompanionError(503,'在线计量未配置');
  const historyText=(payload.history||[]).map(item=>item?.content||'').join('\n');
  const uploads=Array.isArray(payload.uploads)?payload.uploads:[];
  const imageCountForBill=Math.max(imageCount,uploads.filter(file=>xiaotaoFileKind(file)==='image').length);
  const captions=uploads.filter(file=>['video','audio'].includes(xiaotaoFileKind(file))).map(file=>`参考${xiaotaoFileKind(file)==='video'?'视频':'音频'}：${String(file.name||'未命名').slice(0,180)}`);
  const files=Array.from({length:imageCountForBill},()=>({kind:'image'}));
  const estimate=estimateXiaotaoOnlineCredits({text:payload.message+(captions.length?'\n'+captions.join('\n'):''),history:historyText,system:systemText,files,outputTokens:MAX_OUTPUT_TOKENS,config:provider.creditConfig,promptLanguage:payload.promptLanguage});
  const feature=imageCountForBill?'xiaotao-vision':'xiaotao-text';
  let calibration=null,decisionCredits=null;
  try{
   const charged=await charge({userId:user.id,feature,amount:1,usageKey:'xiaotao:'+payload.requestId,estimatedCredits:estimate.credits,metadata:{imageAnalysis:imageCount>0,estimate:estimate.credits},run:async()=>{
    let posted;
    try{posted=await postRunningHubResponses({body:{model:provider.model,input,temperature:.4,max_output_tokens:MAX_OUTPUT_TOKENS},config:{apiKey:provider.apiKey,baseUrl:provider.baseUrl,model:provider.model},fetchImpl,timeoutMs:60000});}
    catch(error){error.chargedAmount=0;throw error;}
    const result=posted.data;
    if(result.status!=='completed'||!Array.isArray(result.output)||result.output.some(m=>m.type==='function_call'))throw Object.assign(new CompanionError(502,textOnly?'小桃AI未返回完整文字回复，本次未自动重试':'在线图片分析未返回完整回答，本次未自动重试'),{chargedAmount:0});
    const reply=result.output.flatMap(m=>m.type==='message'&&m.role==='assistant'?(m.content||[]).filter(p=>p.type==='output_text'&&typeof p.text==='string').map(p=>p.text):[]).join('\n').trim();
    if(!reply)throw Object.assign(new CompanionError(502,textOnly?'小桃AI未返回完整文字回复，本次未自动重试':'在线图片分析未返回文字'),{chargedAmount:0});
    const decision=settleXiaotaoOnlineCredits({usage:result.usage,reservedCredits:estimate.credits,config:provider.creditConfig});
    calibration=billingSampleFor(result.model||provider.model,result.usage,decision,provider.creditConfig);decisionCredits=decision.credits;
    return {amount:1,reply,model:result.model||provider.model,imageCount,settledCredits:decision.credits,rhCostUsd:decision.usdCost,pricingSource:decision.pricingSource,metadata:{model:result.model,imageCount,usage:result.usage,billing_mode:'token',estimated_credits:estimate.credits,settled_credits:decision.credits}};
   }});
   const actual=sampleTokenCount(charged.quota?.settled_credits);
   const billingSample=calibration?{...calibration.sample,eligible:calibration.usable&&actual!=null&&Number(charged.quota?.settled_credits)===actual&&actual===decisionCredits
    &&charged.quota?.balance_short!==true&&!(Number(charged.quota?.uncollected_credits)>0)
    &&charged.quota?.capped!==true&&charged.quota?.settle_capped!==true&&charged.quota?.reserve_capped!==true}:null;
   return {reply:charged.reply,model:charged.model,imageCount:charged.imageCount,billingSample,quota:{...(charged.quota||{}),billing_mode:'token',estimated_credits:estimate.credits,settled_credits:charged.quota?.settled_credits??charged.settledCredits,feature}};
  }catch(error){
   if(error instanceof CompanionError)throw error;
   const status=Number(error?.statusCode)||502;
   throw new CompanionError(status===409?409:status===402?402:502,status===409?'这次对话已提交，请使用新的消息编号':status===402?(error instanceof Error&&/云服务余额不足|积分不足|维护中|单价未配置/.test(error.message)?error.message:'积分不足或暂时不可用'):error instanceof Error&&/在线|小桃AI/.test(error.message)?error.message:textOnly?'在线对话暂未完成，本次未自动重试':'在线图片分析暂未完成，本次未自动重试');
  }
 }};
}
