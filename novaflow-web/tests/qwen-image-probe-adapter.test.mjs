import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createContext,runInContext} from 'node:vm';import {createDomSandbox} from '../worker/src/comfy/dom-shim.mjs';
const [runtime,art]=await Promise.all([readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8'),readFile(new URL('../renderer/art-generate-model.resource.js',import.meta.url),'utf8')]);
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('real art adapter probes only the selected node, always for the Turbo line',async()=>{
 const calls=[];const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,AbortController,TextEncoder,TextDecoder,URL,NOVAFLOW_WEB_CONFIG:{controlUrl:'https://control.test'},fetch:async raw=>{const url=new URL(String(raw));calls.push(url.pathname+url.search);if(url.pathname.endsWith('/api/web/capabilities')){const node=url.searchParams.get('worker');return Response.json({taskTypes:[],features:{qwenImage21:node===A,qwenImage21Workers:node===A?1:0,qwenImage21Turbo:node===B,qwenImage21TurboWorkers:node===B?1:0}});}throw Error('unexpected '+url.pathname);}});
 const ctx=createContext(sandbox);runInContext(art,ctx);sandbox.__NovaFlowArtGenerate={state:{active:true,provider:'local',mode:'txt2img',nsfw:false,localQwen21Variant:'standard'}};runInContext(runtime,ctx);
 sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await new Promise(setImmediate);
 const stats=()=>sandbox.electronAPI.runtimeRequestJson({baseUrl:'http://127.0.0.1:8188',path:'/system_stats',init:{method:'GET'}});
 // Node A only carries the old standard flag, node B the Turbo flag: since 2026-11-06 only Turbo counts.
 let result=await stats();assert.equal(result.ok,false);assert.equal(result.status,503);
 sandbox.__NovaFlowArtGenerate.state.localQwen21Variant='turbo';result=await stats();assert.equal(result.ok,false);
 sandbox.NovaFlowWebRuntime.setComputeNode({id:B});await new Promise(setImmediate);result=await stats();assert.equal(result.ok,true);assert.match(result.data.devices[0].name,/1 台算力节点/);
 sandbox.__NovaFlowArtGenerate.state.localQwen21Variant='standard';result=await stats();assert.equal(result.ok,true);assert.ok(calls.some(s=>s.includes('worker='+A)));assert.ok(calls.some(s=>s.includes('worker='+B)));
});
