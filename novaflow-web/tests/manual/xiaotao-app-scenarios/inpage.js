// Injected into the real Foart page. Builds a 小桃 controller on the real bridge and tools; only the backend is fake.
window.__xt=(function(){
  const calls=[];const real=window.electronAPI;
  const FOART_TOOL_SCHEMA='nf.foart.tool-plan.v1';
  const MODEL='deepseek/deepseek-v4.1-flash';
  const config={xiaotao_online:{billing_scope:'operation',minimum_positive_credits:1,operation_text_chat_v3:true,operation_vision_chat_v3:true,operation_foart_open_v3:true,operation_audio_rewrite_v3:true,operation_video_rewrite_v3:true}};
  let session=0;
  const overrides={
    companionPricing:async()=>{calls.push(['companionPricing']);return {ok:true,policy:{version:'sha256:'+'a'.repeat(64),expiresAt:Date.now()+3600e3,defaultModel:MODEL,config:window.__xtConfig,models:[{id:MODEL,available:true},{id:'bytedance/doubao-seed-2.1-lite',available:true}]}};},
    onlineBusinessAvailableSync:()=>true,onlineTextArtAvailableSync:()=>true,onlineVisionArtAvailableSync:()=>true,onlineVideoVisionAvailableSync:()=>true,
    captureFoartBillingOwner:()=>({owner:'test-user',current:()=>true}),captureFoartSessionGuard:()=>()=>true,
    artAgentStop:async()=>({ok:true}),artAgentStatus:async()=>({ok:true}),foartOperationCancel:async()=>({ok:true}),
    artAgentChat:async p=>{calls.push(['artAgentChat',{message:p.message,images:(p.images||[]).length}]);const reply=await window.__nodeChat(JSON.stringify({message:p.message,images:(p.images||[]).length}));return {ok:true,data:{reply,history:[...(p.history||[]),{role:'user',content:p.message},{role:'assistant',content:reply}].slice(-12)}};},
    foartOperationStart:async p=>{calls.push(['foartOperationStart',{message:p.message}]);const plan=JSON.parse(await window.__nodePlan(JSON.stringify({round:'start',message:p.message,context:p.foartContext})));if(plan.__error)return plan.__error;return {ok:true,data:{toolPlan:plan,foartOperationSession:{id:'s'+(++session)}}};},
    foartOperationResume:async p=>{calls.push(['foartOperationResume',{}]);const plan=JSON.parse(await window.__nodePlan(JSON.stringify({round:'resume',receipts:p.receipts||p.toolReceipts||null,context:p.foartContext||p.context,keys:Object.keys(p)})));if(plan.__error)return plan.__error;return {ok:true,data:{toolPlan:plan,foartOperationSession:{id:'s'+(++session)}}};},
  };
  overrides.promptAssistantOptimizePrompt=async p=>{calls.push(['promptAssistantOptimizePrompt',{mode:p.qwenPromptMode,images:(p.images||[]).length,prompt:String(p.prompt).slice(0,200)}]);
    const img=p.qwenPromptMode==='img2img';
    return {ok:true,analysisBackend:'runninghub',modelIdentity:{id:p.assistantModelId},reviewRequired:true,releaseEligible:true,displayPrompt:String(p.prompt)+'，画面细节丰富',modelPrompt:'[EN] '+String(p.prompt)+', rich detail',modelPromptLanguage:'en',modelPromptPolicy:'qwen21-native-rewrite-v3',translationValidation:img?'native-edit-and-literals':'paired-prose-and-literals',promptContract:'qwen21-native-rewrite-v3',targetEngine:p.targetEngine,hasNegativePrompt:true,negativePrompt:'低质量，模糊',quota:{status:'settled',settled_credits:0.12,pricing_source:'token_rate_estimate',cache_known:true}};};
  overrides.runtimeUploadFile=async p=>{calls.push(['runtimeUploadFile',{name:p.fileName,slot:p.slot}]);return {ok:true,result:{name:p.fileName,kind:p.kind}};};
  const stubs={};
  // Patch the page's own electronAPI so the panel and the native tools both see the fake backend.
  for(const k of Object.keys(real)){const v=real[k];if(typeof v==='function'&&!(k in overrides)){real[k]=(...a)=>{calls.push(['REAL:'+k]);return v.apply(real,a);};}}
  Object.assign(real,overrides);
  const A=window.NovaFlowXiaotaoArtAgent;
  let c=null;
  return {calls,stubs,api:real,
    async make(){c=A.panel?.controller;if(!c)throw Error('no panel controller');if(!c.setModel(MODEL))throw Error('setModel failed');await c.refreshPricingPolicy();return true;},
    get c(){return c;},
    async send(text){const r=await c.send(text);return r;},
    state(){const s=c.state;return {status:s.status,error:s.error,pending:s.pending,messages:s.messages.map(m=>({role:m.role,content:String(m.content).slice(0,600)})),staged:(s.staged||[]).length};},
  };
})();
