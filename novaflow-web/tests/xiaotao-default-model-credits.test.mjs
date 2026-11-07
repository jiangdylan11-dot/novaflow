import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {normalizeCreditConfig} from '../packages/shared/src/feature-credits.mjs';
import {FOART_TOOL_SCHEMA,validateFoartPlan} from '../packages/shared/src/foart-tool-plan.mjs';

// 小桃 opens on 豆包; with no credits it tells the user to switch to the free model or ask the admin to top up.
// Controller test with synthetic data; no account, model or network is used.
const read=name=>readFileSync(new URL('../renderer/'+name,import.meta.url),'utf8');
const MODEL='bytedance/doubao-seed-2.1-lite';
const png=name=>'data:image/png;base64,'+Buffer.from(name).toString('base64');
const clarify=reply=>({ok:true,data:{toolPlan:{schema:FOART_TOOL_SCHEMA,status:'clarify',reply,operations:[]}}});
const done=reply=>({ok:true,data:{toolPlan:{schema:FOART_TOOL_SCHEMA,status:'reply',reply,operations:[]}}});
async function fixture({refs=[],prompt='',foart=[],chat=[]}={}) {
  const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,btoa:value=>Buffer.from(value,'binary').toString('base64')};
  root.window=root;createContext(root);
  runInContext(read('xiaotao-prompt-source.js'),root);runInContext(read('xiaotao-upload.js'),root);runInContext(read('xiaotao-art-agent.js'),root);
  const rtState={active:true,prompt,mode:'img2img'};
  root.__NovaFlowArtGenerate={state:rtState,capturePrompt(){},references:()=>refs,capturePromptSourceGuard:()=>({isCurrent:()=>true}),
    captureContext:()=>({generationSurface:'drawing',state:rtState,routeRevision:1,references:refs})};
  root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA,validateFoartPlan,foartAnimationExportAllowed:()=>true,foartUnsupportedMediaAnalysis:()=>false};
  root.NovaFlowFoartTools={setUploads(){},capture:()=>({schema:FOART_TOOL_SCHEMA,controls:[]}),settlePending:async()=>null,images:async()=>[]};
  const config=normalizeCreditConfig({});
  Object.assign(config.xiaotao_online,{billing_scope:'operation',minimum_positive_credits:1,operation_text_chat_v3:true,operation_vision_chat_v3:true,operation_foart_open_v3:true});
  const policy={version:'sha256:'+'a'.repeat(64),expiresAt:Date.now()+60000,defaultModel:'xai/grok-4.7',config,models:[{id:'xai/grok-4.7',available:true},{id:MODEL,available:true}]};
  const chats=[],starts=[];
  const extra={};const api=()=>({...extra,captureFoartBillingOwner:()=>({owner:'test-user',current:()=>true}),captureFoartSessionGuard:()=>()=>true,
    onlineBusinessAvailableSync:()=>true,artAgentStop:async()=>({ok:true}),artAgentStatus:async()=>({ok:true}),companionPricing:async()=>({ok:true,policy}),
    artAgentChat:async payload=>{chats.push(payload);const next=chat.shift();if(!next)throw Error('unexpected chat');
      return {ok:true,data:{reply:next,history:[...payload.history,{role:'user',content:payload.message},{role:'assistant',content:next}].slice(-12)}};},
    foartOperationStart:async payload=>{starts.push(payload);const next=foart.shift();if(!next)throw Error('unexpected planner call');return next;}});
  const bridge={clearPrepared(){},hasResult:()=>false,async captureChat({drawingPreview,includeDrawingReferences}={}){
    return {artContext:{surface:'drawing'},images:includeDrawingReferences?refs.map((ref,i)=>({source:i+1,role:ref.drawingRole,dataUrl:ref.dataUrl,name:ref.name})):[],drawingPreview};}};
  const c=root.NovaFlowXiaotaoArtAgent.createController({bridge,api});
  const opened={modelId:c.state.modelId,provider:c.state.provider};await c.refreshPricingPolicy();
  return {c,opened,chats,starts,root,tools:root.NovaFlowFoartTools,api:extra,setPrompt:value=>{rtState.prompt=value;}};
}

test('小桃 opens on 豆包 Seed 2.1 Lite',async()=>{
  const f=await fixture();
  assert.deepEqual(f.opened,{modelId:'bytedance/doubao-seed-2.1-lite',provider:'api'});
  assert.equal(f.c.modelAvailable('bytedance/doubao-seed-2.1-lite'),true);
});
for(const failure of ['积分不足','insufficient_credits'])test('no credits ('+failure+') becomes a reply pointing to the free model or a top-up',async()=>{
  const f=await fixture({foart:[{ok:false,errorCode:'insufficient_credits',error:failure}]});
  await f.c.send('帮我想一个海边的画面');
  assert.equal(f.c.state.error,'');
  const last=f.c.state.messages.at(-1);
  assert.equal(last.role,'assistant');assert.match(last.content,/积分不足/);assert.match(last.content,/免费的本地模型/);assert.match(last.content,/联系管理员充值/);
});
test('a billing-pool shortage is not shown as the user lacking credits',async()=>{
  const f=await fixture({foart:[{ok:false,errorCode:'provider-pool-insufficient',error:'计费池余额不足，请联系管理员'}]});
  await f.c.send('帮我想一个海边的画面');
  assert.match(f.c.state.error,/计费池/);assert.doesNotMatch(String(f.c.state.messages.at(-1)?.content||''),/免费的本地模型/);
});
