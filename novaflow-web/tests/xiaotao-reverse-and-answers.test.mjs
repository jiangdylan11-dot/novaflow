import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {normalizeCreditConfig} from '../packages/shared/src/feature-credits.mjs';
import {FOART_TOOL_SCHEMA,validateFoartPlan} from '../packages/shared/src/foart-tool-plan.mjs';

// Controller test with synthetic data; no account, model or network is used.
const read=name=>readFileSync(new URL('../renderer/'+name,import.meta.url),'utf8');
const MODEL='deepseek/deepseek-v4.1-flash';
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
  const api=()=>({captureFoartBillingOwner:()=>({owner:'test-user',current:()=>true}),captureFoartSessionGuard:()=>()=>true,
    onlineBusinessAvailableSync:()=>true,artAgentStop:async()=>({ok:true}),artAgentStatus:async()=>({ok:true}),companionPricing:async()=>({ok:true,policy}),
    artAgentChat:async payload=>{chats.push(payload);const next=chat.shift();if(!next)throw Error('unexpected chat');
      return {ok:true,data:{reply:next,history:[...payload.history,{role:'user',content:payload.message},{role:'assistant',content:next}].slice(-12)}};},
    foartOperationStart:async payload=>{starts.push(payload);const next=foart.shift();if(!next)throw Error('unexpected planner call');return next;}});
  const bridge={clearPrepared(){},hasResult:()=>false,async captureChat({drawingPreview,includeDrawingReferences}={}){
    return {artContext:{surface:'drawing'},images:includeDrawingReferences?refs.map((ref,i)=>({source:i+1,role:ref.drawingRole,dataUrl:ref.dataUrl,name:ref.name})):[],drawingPreview};}};
  const c=root.NovaFlowXiaotaoArtAgent.createController({bridge,api});
  assert.equal(c.setModel('xai/grok-4.7'),true);await c.refreshPricingPolicy();
  return {c,chats,starts,setPrompt:value=>{rtState.prompt=value;}};
}
const refs=()=>[{name:'a.png',dataUrl:png('a'),drawingRole:'subject'},{name:'b.png',dataUrl:png('b'),drawingRole:'style'}];

test('反推@参考图N sends only that picture through image chat, never the tool planner',async()=>{
  const f=await fixture({refs:refs(),chat:['一位女孩站在海边']});
  assert.equal(await f.c.send('反推@参考图2'),true);
  assert.equal(f.starts.length,0);assert.equal(f.chats.length,1);
  assert.deepEqual(Array.from(f.chats[0].images,image=>image.dataUrl),[png('b')]);
  assert.match(f.chats[0].message,/提示词/);
  assert.equal(f.c.state.messages.at(-1).content,'一位女孩站在海边');
});
test('反推 with no picture stops before any request',async()=>{
  const f=await fixture();
  assert.equal(await f.c.send('反推@参考图1'),false);
  assert.equal(f.chats.length+f.starts.length,0);assert.match(f.c.state.error,/没有找到要反推的图片/);
});
test('a pointed reply to a planner question keeps the earlier request, with or without a page prompt',async()=>{
  for(const prompt of ['','一位女孩站在海边']){
    const f=await fixture({refs:refs(),prompt,foart:[clarify('要换成什么衣服？'),done('好的')]});
    await f.c.send('帮我把图1的衣服换掉');
    assert.equal(f.c.state.status,'等待补充需求');
    await f.c.send('换成黑色的吊带背心');
    assert.equal(f.starts.length,2);
    assert.match(f.starts[1].message,/帮我把图1的衣服换掉[\s\S]*用户回答：换成黑色的吊带背心/);
    assert.doesNotMatch(f.c.state.status,/提示词来源/);
  }
});
test('a request for details with no question mark still waits for the answer',async()=>{
  const ask='参考图1已收到，但还没说明要换成什么衣服。请告诉我新衣服的款式（例如白色衬衫、红色连衣裙、黑色西装），以及是否保留原图的姿势、背景和人物特征，我就用图生图直接改。';
  const f=await fixture({refs:refs(),prompt:'一位女孩站在海边',foart:[done(ask),done('好的')]});
  await f.c.send('帮我把图1的衣服换掉');
  await f.c.send('换成黑色的吊带背心');
  assert.equal(f.starts.length,2);
  assert.match(f.starts[1].message,/帮我把图1的衣服换掉[\s\S]*用户回答：换成黑色的吊带背心/);
});
test('a question asked in plain chat is answered through the tools with its context',async()=>{
  const f=await fixture({refs:refs(),chat:['你想把衣服换成什么样？'],foart:[done('好的')]});
  await f.c.send('这件衣服不太好看');
  await f.c.send('黑色的吊带背心');
  assert.equal(f.starts.length,1);
  assert.match(f.starts[0].message,/这件衣服不太好看[\s\S]*用户回答：黑色的吊带背心/);
});
test('an edit request with no prompt anywhere goes to the tools instead of asking for a prompt',async()=>{
  const f=await fixture({refs:refs(),foart:[done('好的')]});
  await f.c.send('换成黑色的吊带背心');
  assert.equal(f.starts.length,1);assert.doesNotMatch(f.c.state.status,/提示词来源/);
});
test('asking to optimize an empty prompt still asks for the prompt',async()=>{
  const f=await fixture({refs:refs()});
  await f.c.send('优化提示词');
  assert.equal(f.starts.length+f.chats.length,0);assert.match(f.c.state.status,/提示词来源/);
});
test('filling the page after being asked for a prompt just runs the new request',async()=>{
  const f=await fixture({refs:refs()});
  await f.c.send('优化提示词');
  f.setPrompt('换成黑色的吊带背心');
  await f.c.send('优化提示词');
  assert.doesNotMatch(f.c.state.error,/已变化/);
});
test('a reply that picks no source is read as a new request',async()=>{
  const f=await fixture({refs:refs(),prompt:'海边的女孩',foart:[done('好的')]});
  await f.c.send('优化提示词：森林里的男孩');
  assert.match(f.c.state.status,/提示词来源/);
  await f.c.send('打开音频');
  assert.equal(f.starts.length,1);assert.equal(f.c.state.error,'');
});
test('a failed turn stays in this session context',async()=>{
  const f=await fixture({refs:refs(),foart:[{ok:false,error:'操作未完成'},done('好的')]});
  assert.equal(await f.c.send('把图1换成黑白'),false);
  await f.c.send('把图2也换成黑白');
  assert.ok(f.starts[1].history.some(row=>row.content==='把图1换成黑白'));
});
