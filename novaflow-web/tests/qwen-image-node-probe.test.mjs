import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
const text=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const start=text.indexOf('  function selectedImageProbeType()'),end=text.indexOf('  const nativeFetch =',start);assert.ok(start>0&&end>start);
function fixture(caps){const requests=[];const box={root:{__NovaFlowArtGenerate:{state:{active:true,provider:'local',mode:'txt2img',localQwen21Variant:'standard'}},NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1'})}},computeNodeEpoch:0,computeNode:{id:'node-a'},session:{token:'a'},taskMode:()=> 'shared',currentSession(){return box.session;},control:async(method,path)=>{requests.push({method,path,node:box.computeNode?.id,token:box.session?.token});return typeof caps==='function'?caps(box):caps;},Date,Number,console};
 vm.createContext(box);vm.runInContext(text.slice(start,end)+'\nglobalThis.selected=selectedImageProbeType;globalThis.probe=poolHas;',box);return {box,requests,selected:()=>box.selected(),probe:()=>box.probe(box.selected())};}
const data=(std,turbo,legacy=0)=>({taskTypes:[{task_type:'qwen_t2i',available_workers:legacy}],features:{qwenImage21:std>0,qwenImage21Workers:std,qwenImage21Turbo:turbo>0,qwenImage21TurboWorkers:turbo}});
test('art probes the exact selected model instead of legacy 2511',async()=>{
 let f=fixture(data(1,0));assert.equal(f.selected(),'qwen21-standard');assert.equal(await f.probe(),1);f.box.root.__NovaFlowArtGenerate.state.localQwen21Variant='turbo';assert.equal(f.selected(),'qwen21-turbo');assert.equal(await f.probe(),0);
 f=fixture(data(0,1));assert.equal(await f.probe(),0);f.box.root.__NovaFlowArtGenerate.state.localQwen21Variant='turbo';assert.equal(await f.probe(),1);
 f.box.root.__NovaFlowArtGenerate.state.active=false;assert.equal(f.selected(),'qwen21-turbo');assert.equal(await f.probe(),1);
});
test('missing new fields fail closed for turbo and preserve older standard support',async()=>{
 const f=fixture({taskTypes:[],features:{qwenImage21:true}});assert.equal(await f.probe(),1);f.box.root.__NovaFlowArtGenerate.state.localQwen21Variant='turbo';assert.equal(await f.probe(),0);
});
test('selected node or account changes invalidate cached counts and stale replies',async()=>{
 let f=fixture(b=>data(b.computeNode.id==='node-a'?1:0,0));assert.equal(await f.probe(),1);f.box.computeNode={id:'node-b'};f.box.computeNodeEpoch++;assert.equal(await f.probe(),0);assert.deepEqual(f.requests.map(x=>x.node),['node-a','node-b']);
 f=fixture(b=>data(b.session.token==='a'?1:0,0));assert.equal(await f.probe(),1);f.box.session={token:'b'};assert.equal(await f.probe(),0);assert.deepEqual(f.requests.map(x=>x.token),['a','b']);
 let release;f=fixture(()=>new Promise(r=>{release=r;}));const pending=f.probe();f.box.computeNode={id:'node-b'};f.box.computeNodeEpoch++;release(data(1,1));assert.equal(await pending,0);
});
