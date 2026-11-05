import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {webcrypto} from 'node:crypto';import vm from 'node:vm';
// 本地模型不显示错误框：失败说成普通回复；“做一张…图”是操作请求，直接建议切换在线。
const agent=await readFile(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
const upload=await readFile(new URL('../renderer/xiaotao-upload.js',import.meta.url),'utf8');
const source=await readFile(new URL('../renderer/xiaotao-prompt-source.js',import.meta.url),'utf8');
function setup(chatReply){
  const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem(){}}};root.window=root;root.globalThis=root;vm.createContext(root);
  vm.runInContext(upload,root);vm.runInContext(source,root);vm.runInContext(agent,root);
  let chats=0;
  const api=()=>({captureFoartSessionGuard:()=>()=>true,qwenBusinessAvailableSync:()=>true,runtimeFeatures:async()=>({}),artAgentChat:async()=>{chats++;return chatReply;}});
  const bridge={clearPrepared(){},captureChat:()=>({artContext:{surface:'other'},images:[]}),hasResult:()=>false};
  const c=root.NovaFlowXiaotaoArtAgent.createController({api,bridge});c.state.qwen35CpuTrialAvailable=true;
  return {c,get chats(){return chats;}};
}
test('做一张…图 on the local model gets the switch notice without calling the model',async()=>{
  const t=setup({ok:true,data:{reply:'x',history:[],toolTrace:[]}});
  assert.equal(await t.c.send('做一张小女孩牵着狗走在海边的图'),true);
  assert.equal(t.chats,0);assert.equal(t.c.state.error,'');assert.match(t.c.state.messages.at(-1).content,/在线模型/);
});
test('a local runtime failure is said as a plain reply, never an error box',async()=>{
  const t=setup({ok:false,errorCode:'qwen-gpu-memory-low',error:'可用显存不足，本地 GPU 模型未启动或正在安全退出。'});
  await t.c.send('海边适合什么色调？');
  assert.equal(t.chats,1);assert.equal(t.c.state.error,'');
  const last=t.c.state.messages.at(-1);assert.equal(last.role,'assistant');assert.doesNotMatch(last.content,/显存/);assert.match(last.content,/在线模型/);
});
