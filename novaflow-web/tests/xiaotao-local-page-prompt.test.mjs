import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {webcrypto} from 'node:crypto';import vm from 'node:vm';
// 本地大脑在视频 H3 页面收到画面描述：和在线大脑一样写进提示词框（H3 草稿），不在对话里回方案。
const agent=await readFile(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
const upload=await readFile(new URL('../renderer/xiaotao-upload.js',import.meta.url),'utf8');
const source=await readFile(new URL('../renderer/xiaotao-prompt-source.js',import.meta.url),'utf8');
function setup(){
  const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem(){}}};root.window=root;root.globalThis=root;vm.createContext(root);
  vm.runInContext(upload,root);vm.runInContext(source,root);vm.runInContext(agent,root);
  let page='',chats=0,optimized=null;
  const video={mode:'minimax_h3_local',genType:'first_last',prompt:''};
  root.__NovaFlowArtGenerate={captureContext:()=>({routeRevision:1})};
  root.NovaFlowAudioStudio={isOpen:()=>true,sub:()=>'video'};
  root.NovaFlowAiSequenceGeneration={capture:()=>({...video,prompt:page}),optimizationContext:async()=>({mode:'first_last',durationSeconds:2})};
  root.NovaFlowMediaAgent={captureH3PromptSourceGuard:()=>({isCurrent:()=>true}),captureH3TextDraft:async({sourcePrompt,requirements})=>({request:{prompt:sourcePrompt,requirements,h3Mode:'first_last',durationSeconds:2},isCurrent:()=>true,
    applyDraft:async prompt=>{page=prompt;return {phase:'applied'};}})};
  root.__NovaFlowSmartAI={optimizeForAgent:async options=>{optimized=options;return {analysisBackend:'qwen-cpu',modelIdentity:{id:'qwen35-heretic'},resourcesReleased:true,generationReady:true,displayPrompt:'【参考帧对齐】\n…\n\n【画面与动作】\n[镜头 1] 女孩发丝轻轻飘动，2 秒后回到开头姿态形成循环。'};}};
  const api=()=>({captureFoartSessionGuard:()=>()=>true,qwenBusinessAvailableSync:()=>true,qwen21NativeRewriteV3AvailableSync:()=>true,runtimeFeatures:async()=>({}),artAgentChat:async()=>{chats++;return {ok:true,data:{reply:'一段方案',history:[],toolTrace:[]}};}});
  const bridge={clearPrepared(){},captureChat:()=>({artContext:{surface:'other'},images:[]}),hasResult:()=>false};
  const c=root.NovaFlowXiaotaoArtAgent.createController({api,bridge});c.state.qwen35CpuTrialAvailable=true;
  return {c,get page(){return page;},get chats(){return chats;},get optimized(){return optimized;}};
}
test('local brain writes an H3 draft into the video box for a description',async()=>{
  const t=setup();assert.equal(t.c.state.modelId,'qwen3.5-9b-heretic');
  assert.equal(await t.c.send('2秒循环动画'),true,t.c.state.error);
  assert.equal(t.chats,0);assert.equal(t.optimized.prompt,'2秒循环动画');assert.match(t.page,/【画面与动作】/);
  assert.equal(t.c.state.messages.at(-1).content.startsWith('视频提示词已优化并更新到输入框'),true);
});
test('questions on the video page still go to chat',async()=>{
  const t=setup();assert.equal(await t.c.send('循环动画一般怎么做？'),true);assert.equal(t.chats,1);assert.equal(t.page,'');
});
test('a generate request gets the switch notice and an offer for the video box; 要 writes it',async()=>{
  const t=setup();assert.equal(await t.c.send('生成一个2秒循环动画'),true);assert.equal(t.chats,0);assert.match(t.c.state.messages.at(-1).content,/视频输入框/);
  assert.equal(await t.c.send('要'),true,t.c.state.error);assert.equal(t.optimized.prompt,'生成一个2秒循环动画');assert.match(t.page,/【画面与动作】/);
});
