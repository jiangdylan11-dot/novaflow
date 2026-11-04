import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createDomSandbox} from '../worker/src/comfy/dom-shim.mjs';
const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
// The released local business route accepts text-only Qwen image prompting
// only when the caller identifies the supported art / txt2img scope.
const QWEN_TEXT_SCOPE={surface:'art',purpose:'optimize',targetEngine:'qwen-2.1',qwenPromptMode:'txt2img'};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({release=true,stallPost=false,stallGrant=false,stallUpload=false,assignment=A}={}){
 const caps=[],calls=[],events=new Map();let finishPost,finishGrant,uploadSignal;
 const postGate=stallPost?new Promise(resolve=>{finishPost=resolve;}):null;
 const grantGate=stallGrant?new Promise(resolve=>{finishGrant=resolve;}):null;
 class CE {constructor(type,init={}){this.type=type;this.detail=init.detail;}}
 const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,Event,TextEncoder,TextDecoder,crypto:webcrypto,CustomEvent:CE,
  NOVAFLOW_WEB_CONFIG:{controlUrl:'https://control.test',xiaotaoQwenBusinessEnabled:release},
  addEventListener:(type,fn)=>{if(!events.has(type))events.set(type,new Set());events.get(type).add(fn)},
  removeEventListener:(type,fn)=>events.get(type)?.delete(fn),
  dispatchEvent:event=>{for(const fn of [...(events.get(event.type)||[])])fn(event);return true;},
  fetch:async(url,init={})=>{
   const target=String(url),method=init.method||'GET';calls.push({target,method,body:init.body});
   if(target.includes('/api/web/capabilities'))return new Promise((resolve,reject)=>caps.push({target,resolve,reject}));
   if(target.endsWith('/api/web/tasks')&&method==='POST'){if(postGate)await postGate;return Response.json({task:{id:'task-1',status:'queued'}});}
   if(target.endsWith('/api/web/tasks/task-1/cancel'))return Response.json({ok:true});
   if(target.endsWith('/api/web/tasks/task-1')&&method==='GET')return Response.json({task:{id:'task-1',status:'assigned',assigned_worker_id:assignment}});
   if(target.endsWith('/api/web/tasks/task-1/grant')){if(grantGate)await grantGate;return Response.json({grant:{endpoint:'https://gateway.test',token:'fixture',expiresAt:new Date(Date.now()+120000).toISOString()}});}
   if(target.includes('/input/request.json')){uploadSignal=init.signal;if(stallUpload)return new Promise((resolve,reject)=>{if(init.signal?.aborted)return reject(Error('aborted'));init.signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});return new Response('ok');}
   throw Error('unexpected fixture request');
  }});
 const fixtureToken='nfs_'+Buffer.from(JSON.stringify({sub:'synthetic',exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.signature';
 sandbox.localStorage.setItem('novaflow_web_session_v1',JSON.stringify({token:fixtureToken}));
 sandbox.NovaFlowClientAuth={hasPersistedSessionIdentity:()=>true};
 const instrumented=source.replace('  function authHeaders(extra) {','  root.__syntheticSaveSession=saveSession;\n  function authHeaders(extra) {');
 assert.notEqual(instrumented,source);runInContext(instrumented,createContext(sandbox));
 const answer=(index,business,extra={})=>caps[index].resolve(Response.json({features:{qwen35BusinessTrial:business,qwenImage21:true,...extra},taskTypes:[]}));
 return {sandbox,caps,calls,answer,finishPost,finishGrant,getUploadSignal:()=>uploadSignal};
}
async function ready(p){await turn();assert.equal(p.caps.length,1);p.answer(0,false);await turn();}

test('H3 refuses older business-only nodes before submitting',async()=>{
 const p=fixture();await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();p.answer(1,true,{qwen21NativeRewriteV3:false});await turn();
 p.sandbox.NovaFlowXiaotaoArtAgent={panel:{controller:{businessModelSnapshot:()=>({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0}),subscribeBusinessModel:()=>()=>{}}}};
 const result=await p.sandbox.electronAPI.promptAssistantOptimizePrompt({surface:'animation',purpose:'minimax-h3-prompt-enhance',h3Mode:'text_video',assistantSelectionScope:'xiaotao',requestId:'h3-old',prompt:'角色向前走',h3ReferenceFrames:[]});
 assert.equal(result.errorCode,'qwen-h3-node-unavailable');assert.ok(!p.calls.some(x=>x.target.endsWith('/api/web/tasks')&&x.method==='POST'));
});

test('H3 rechecks capability and pins its task to the same owned node',async()=>{
 const p=fixture({stallPost:true});await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();p.answer(1,true,{qwen21NativeRewriteV3:true});await turn();
 p.sandbox.NovaFlowXiaotaoArtAgent={panel:{controller:{businessModelSnapshot:()=>({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0}),subscribeBusinessModel:()=>()=>{}}}};
 const payload={surface:'animation',purpose:'minimax-h3-prompt-enhance',h3Mode:'text_video',assistantSelectionScope:'xiaotao',requestId:'h3-pinned',prompt:'角色向前走',h3ReferenceFrames:[]};
 const result=p.sandbox.electronAPI.promptAssistantOptimizePrompt(payload);await turn();p.answer(2,true,{qwen21NativeRewriteV3:true});await turn();
 const sent=p.calls.find(x=>x.target.endsWith('/api/web/tasks')&&x.method==='POST');assert.equal(JSON.parse(sent.body).target_worker_id,A);
 p.sandbox.NovaFlowWebRuntime.setComputeNode({id:B});await turn();assert.equal((await result).errorCode,'assistant-selection-changed');p.finishPost();await turn();await turn();
 assert.ok(!p.calls.some(x=>x.target.includes('/input/request.json')));p.answer(3,false);await turn();
});
