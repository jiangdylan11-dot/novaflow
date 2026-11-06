import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=await readFile(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
const modelId='qwen3.5-9b-heretic';
function page() {
  const values=new Map(),calls=[];let status={available:true,features:{qwen35CpuTrial:true}};
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const sandbox={crypto:webcrypto,console,AbortController,setTimeout,clearTimeout,localStorage:storage};sandbox.window=sandbox;
  runInContext(source,createContext(sandbox));
  const bridge={clearPrepared(){},async captureChat(){return {artContext:{surface:'other'},images:[]};},capture(){throw Error('no drawing context');}};
  const api=()=>({promptAssistantGetStatus:async()=>({ok:true,result:await status}),artAgentChat:async payload=>{calls.push(payload);return {ok:true,data:{reply:'你好',history:[],toolTrace:[]}};}});
  const controller=sandbox.NovaFlowXiaotaoArtAgent.createController({bridge,storage,api});controller.setModel(modelId);// 小桃 opens on 豆包; pick the local brain.
  return {controller,calls,setStatus:value=>{status=value;}};
}
test('Qwen is enabled only by its independent capability and sends the explicit local model',async()=>{
  const p=page(),c=p.controller;assert.equal(c.state.modelId,modelId);assert.equal(c.setModel(modelId),false);assert.equal(c.modelAvailable(modelId),false);
  assert.equal(await c.send('你好'),false);assert.equal(p.calls.length,0);// The local brain never shows an error box; it answers in plain words.
  assert.equal(c.state.error,'');assert.match(c.state.messages.at(-1).content,/设备待检测/);
  await c.calibrateLocalStatus();assert.equal(c.modelAvailable(modelId),true);
  assert.equal(await c.send('你好'),true);assert.equal(p.calls.length,1);assert.equal(p.calls[0].modelId,modelId);assert.equal(p.calls[0].provider,'local');assert.equal(p.calls[0].mode,'chat');
  p.setStatus({available:true,features:{qwen35CpuTrial:false}});await c.calibrateLocalStatus();assert.equal(c.modelAvailable(modelId),false);
  assert.equal(await c.send('再次提问'),false);assert.equal(p.calls.length,1);
});
test('missing capability and an outdated response after node change cannot enable Qwen',async()=>{
  const p=page(),c=p.controller;c.setModel(modelId);p.setStatus({});await c.calibrateLocalStatus();assert.equal(c.modelAvailable(modelId),false);
  p.setStatus({available:false,features:{qwen35CpuTrial:true}});await c.calibrateLocalStatus();assert.equal(c.modelAvailable(modelId),true);
  let resolve;const pending=new Promise(r=>{resolve=r;});p.setStatus(pending);const check=c.calibrateLocalStatus();c.invalidateLocalCapability();resolve({available:true,features:{qwen35CpuTrial:true}});await check;
  assert.equal(c.modelAvailable(modelId),false);assert.equal(await c.send('你好'),false);assert.equal(p.calls.length,0);
});
test('Qwen readiness is unknown until an explicit successful result and resets on failure or node change',async()=>{
  const p=page(),c=p.controller;
  assert.equal(c.state.qwen35CpuTrialChecked,false);
  p.setStatus({features:{qwen35CpuTrial:false}});await c.calibrateLocalStatus();
  assert.equal(c.state.qwen35CpuTrialChecked,true);assert.equal(c.modelAvailable(modelId),false);
  p.setStatus({});await c.calibrateLocalStatus();assert.equal(c.state.qwen35CpuTrialChecked,false);
  p.setStatus({features:{qwen35CpuTrial:true}});await c.calibrateLocalStatus();assert.equal(c.state.qwen35CpuTrialChecked,true);assert.equal(c.modelAvailable(modelId),true);
  p.setStatus(Promise.reject(new Error('network down')));await c.calibrateLocalStatus();assert.equal(c.state.qwen35CpuTrialChecked,false);assert.equal(c.modelAvailable(modelId),false);
  p.setStatus({features:{qwen35CpuTrial:false}});await c.calibrateLocalStatus();c.invalidateLocalCapability();assert.equal(c.state.qwen35CpuTrialChecked,false);
});
test('older readiness results and failures cannot overwrite newer probe or reset',async()=>{
  const p=page(),c=p.controller;let resolveOld,rejectOld;
  p.setStatus(new Promise(resolve=>{resolveOld=resolve;}));const old=c.calibrateLocalStatus();
  p.setStatus({features:{qwen35CpuTrial:false}});await c.calibrateLocalStatus();resolveOld({features:{qwen35CpuTrial:true}});await old;
  assert.equal(c.state.qwen35CpuTrialChecked,true);assert.equal(c.modelAvailable(modelId),false);
  p.setStatus(new Promise((resolve,reject)=>{rejectOld=reject;}));const failing=c.calibrateLocalStatus();
  p.setStatus({features:{qwen35CpuTrial:true}});await c.calibrateLocalStatus();rejectOld(new Error('old failed'));await failing;
  assert.equal(c.state.qwen35CpuTrialChecked,true);assert.equal(c.modelAvailable(modelId),true);
  p.setStatus(new Promise(resolve=>{resolveOld=resolve;}));const stale=c.calibrateLocalStatus();c.invalidateLocalCapability();resolveOld({features:{qwen35CpuTrial:false}});await stale;
  assert.equal(c.state.qwen35CpuTrialChecked,false);assert.equal(c.modelAvailable(modelId),false);
});
