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

test('node A late response cannot override node B disabled capability',async()=>{
 const p=fixture();await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});p.sandbox.NovaFlowWebRuntime.setComputeNode({id:B});await turn();
 assert.match(p.caps[1].target,new RegExp(A));assert.match(p.caps[2].target,new RegExp(B));p.answer(2,false,{marker:'B'});await turn();p.answer(1,true,{marker:'A'});await turn();
 assert.equal(p.sandbox.electronAPI.qwenBusinessAvailableSync(),false);assert.equal(p.sandbox.electronAPI.runtimeFeaturesSync().marker,'A');
});

test('node epoch rejects stale A reply after A to B to A round trip',async()=>{
 const p=fixture();await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});p.sandbox.NovaFlowWebRuntime.setComputeNode({id:B});p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();
 p.answer(3,false,{marker:'latest A'});await turn();p.answer(1,true,{marker:'old A'});p.answer(2,true,{marker:'B'});await turn();
 assert.equal(p.sandbox.electronAPI.qwenBusinessAvailableSync(),false);assert.equal(p.sandbox.electronAPI.runtimeFeaturesSync().marker,'B');
});

test('same-node capability queries resolve newest request only',async()=>{
 const p=fixture();await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();p.answer(1,false);await turn();
 const first=p.sandbox.electronAPI.runtimeFeatures(),second=p.sandbox.electronAPI.runtimeFeatures();await turn();p.answer(3,false,{marker:'latest'});await second;p.answer(2,true,{marker:'stale'});await first;
 assert.equal(p.sandbox.electronAPI.qwenBusinessAvailableSync(),false);assert.equal(p.sandbox.electronAPI.runtimeFeaturesSync().marker,'stale');
});

test('node switch to pool and current failure clear business capability while preserving unrelated cache on failure',async()=>{
 const p=fixture();await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();p.answer(1,true,{other:'retained'});await turn();assert.equal(p.sandbox.electronAPI.qwenBusinessAvailableSync(),true);
 const request=p.sandbox.electronAPI.runtimeFeatures();await turn();p.caps[2].reject(Error('offline'));await request;
 assert.equal(p.sandbox.electronAPI.qwenBusinessAvailableSync(),false);assert.equal(p.sandbox.electronAPI.runtimeFeaturesSync().other,'retained');
 p.sandbox.NovaFlowWebRuntime.setComputeNode(null);await turn();assert.equal(p.sandbox.electronAPI.qwenBusinessAvailableSync(),false);p.caps[3].reject(Error('offline'));await turn();assert.equal(p.sandbox.electronAPI.qwenBusinessAvailableSync(),false);
});

test('release switch defaults off even if node reports business ready',async()=>{
 const p=fixture({release:false});await turn();p.answer(0,true,{other:'available'});await turn();
 assert.equal(p.sandbox.electronAPI.runtimeFeaturesSync().qwen35BusinessTrial,true);assert.equal(p.sandbox.electronAPI.qwenBusinessAvailableSync(),false);assert.equal(p.sandbox.electronAPI.runtimeFeaturesSync().other,'available');
});

test('node switch while task POST is pending cancels A and never uploads its input',async()=>{
 const p=fixture({stallPost:true});await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();p.answer(1,true);await turn();
 p.sandbox.NovaFlowXiaotaoArtAgent={panel:{controller:{businessModelSnapshot:()=>({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0}),subscribeBusinessModel:()=>()=>{}}}};
 const result=p.sandbox.electronAPI.promptAssistantOptimizePrompt({...QWEN_TEXT_SCOPE,assistantSelectionScope:'xiaotao',requestId:'switch-node',prompt:'synthetic'});
 await turn();p.answer(2,true);await turn();const sent=p.calls.find(x=>x.target.endsWith('/api/web/tasks')&&x.method==='POST');assert.equal(JSON.parse(sent.body).target_worker_id,A);
 p.sandbox.NovaFlowWebRuntime.setComputeNode({id:B});await turn();const reply=await result;assert.equal(reply.errorCode,'assistant-selection-changed');p.finishPost();await turn();await turn();
 assert.ok(p.calls.some(x=>x.target.endsWith('/api/web/tasks/task-1/cancel')));assert.ok(!p.calls.some(x=>x.target.includes('/input/request.json')));
 p.answer(3,false);await turn();
});


test('node switch while A upload grant is pending prevents gateway PUT',async()=>{
 const p=fixture({stallGrant:true});await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();p.answer(1,true);await turn();
 p.sandbox.NovaFlowXiaotaoArtAgent={panel:{controller:{businessModelSnapshot:()=>({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0}),subscribeBusinessModel:()=>()=>{}}}};
 const result=p.sandbox.electronAPI.promptAssistantOptimizePrompt({...QWEN_TEXT_SCOPE,assistantSelectionScope:'xiaotao',requestId:'switch-grant',prompt:'synthetic'});
 await turn();p.answer(2,true);await turn();await turn();assert.ok(p.calls.some(x=>x.target.endsWith('/api/web/tasks/task-1/grant')));
 p.sandbox.NovaFlowWebRuntime.setComputeNode({id:B});await turn();assert.equal((await result).errorCode,'assistant-selection-changed');p.finishGrant();await turn();await turn();
 assert.ok(!p.calls.some(x=>x.target.includes('/input/request.json')));p.answer(3,false);await turn();
});

test('node switch aborts an already-started upload and does not accept its result',async()=>{
 const p=fixture({stallUpload:true});await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();p.answer(1,true);await turn();
 p.sandbox.NovaFlowXiaotaoArtAgent={panel:{controller:{businessModelSnapshot:()=>({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0}),subscribeBusinessModel:()=>()=>{}}}};
 const result=p.sandbox.electronAPI.promptAssistantOptimizePrompt({...QWEN_TEXT_SCOPE,assistantSelectionScope:'xiaotao',requestId:'switch-upload',prompt:'synthetic'});
 await turn();p.answer(2,true);await turn();await turn();assert.ok(p.calls.some(x=>x.target.includes('/input/request.json')));assert.equal(p.getUploadSignal().aborted,false);
 p.sandbox.NovaFlowWebRuntime.setComputeNode({id:B});await turn();assert.equal((await result).errorCode,'assistant-selection-changed');assert.equal(p.getUploadSignal().aborted,true);
 assert.ok(p.calls.some(x=>x.target.endsWith('/api/web/tasks/task-1/cancel')));p.answer(3,false);await turn();
});

test('actual same-tab runtime logout immediately aborts an in-flight Qwen input upload',async()=>{
 const p=fixture({stallUpload:true});await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();p.answer(1,true);await turn();
 p.sandbox.NovaFlowXiaotaoArtAgent={panel:{controller:{businessModelSnapshot:()=>({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0}),subscribeBusinessModel:()=>()=>{}}}};
 const result=p.sandbox.electronAPI.promptAssistantOptimizePrompt({...QWEN_TEXT_SCOPE,assistantSelectionScope:'xiaotao',requestId:'logout-upload',prompt:'synthetic'});
 await turn();p.answer(2,true);await turn();await turn();assert.ok(p.calls.some(x=>x.target.includes('/input/request.json')));assert.equal(p.getUploadSignal().aborted,false);
 p.sandbox.__syntheticSaveSession(null);assert.equal(p.getUploadSignal().aborted,true);
 assert.equal((await result).errorCode,'assistant-session-cancel-unconfirmed');assert.ok(p.calls.some(x=>x.target.endsWith('/api/web/tasks/task-1/cancel')));
});


test('newer failed query does not suppress older successful legacy capability result',async()=>{
 for(const release of [false,true]){
  const p=fixture({release});await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();p.answer(1,false);await turn();
  const first=p.sandbox.electronAPI.runtimeFeatures(),second=p.sandbox.electronAPI.runtimeFeatures();await turn();
  p.caps[3].reject(Error('offline'));await second;
  p.caps[2].resolve(Response.json({features:{qwen35BusinessTrial:true,qwenImage21:false,marker:'legacy-result'},taskTypes:[{kind:'image',available_workers:1}]}));await first;
  assert.equal(p.sandbox.electronAPI.runtimeFeaturesSync().qwenImage21,true);assert.equal(p.sandbox.electronAPI.runtimeFeaturesSync().marker,'legacy-result');
  assert.equal(p.sandbox.electronAPI.qwenBusinessAvailableSync(),false);
 }
});

test('v3 proof follows the selected node, session and latest capability response',async()=>{
 const p=fixture();await ready(p);
 assert.equal(p.sandbox.electronAPI.qwen21NativeRewriteV3AvailableSync(),false);
 p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();p.answer(1,true,{qwen21NativeRewriteV3:true});await turn();
 assert.equal(p.sandbox.electronAPI.qwen21NativeRewriteV3AvailableSync(),true);
 const old=p.sandbox.electronAPI.runtimeFeatures(),latest=p.sandbox.electronAPI.runtimeFeatures();await turn();
 p.answer(3,true,{qwen21NativeRewriteV3:false});await latest;p.answer(2,true,{qwen21NativeRewriteV3:true});await old;
 assert.equal(p.sandbox.electronAPI.qwen21NativeRewriteV3AvailableSync(),false);
 const refresh=p.sandbox.electronAPI.runtimeFeatures();await turn();p.answer(4,true,{qwen21NativeRewriteV3:true});await refresh;
 assert.equal(p.sandbox.electronAPI.qwen21NativeRewriteV3AvailableSync(),true);
 p.sandbox.NovaFlowWebRuntime.setComputeNode({id:B});assert.equal(p.sandbox.electronAPI.qwen21NativeRewriteV3AvailableSync(),false);await turn();p.answer(5,true,{qwen21NativeRewriteV3:true});await turn();
 assert.equal(p.sandbox.electronAPI.qwen21NativeRewriteV3AvailableSync(),true);
 p.sandbox.__syntheticSaveSession(null);assert.equal(p.sandbox.electronAPI.qwen21NativeRewriteV3AvailableSync(),false);
});

test('v3 rechecks node capability before creating a pinned task',async()=>{
 const p=fixture({stallPost:true});await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();p.answer(1,true,{qwen21NativeRewriteV3:true});await turn();
 p.sandbox.NovaFlowXiaotaoArtAgent={panel:{controller:{businessModelSnapshot:()=>({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0}),subscribeBusinessModel:()=>()=>{}}}};
 const payload={...QWEN_TEXT_SCOPE,assistantSelectionScope:'xiaotao',promptContract:'qwen21-native-rewrite-v3',requestId:'native-v3',prompt:'synthetic'};
 const refused=p.sandbox.electronAPI.promptAssistantOptimizePrompt(payload);await turn();p.answer(2,true,{qwen21NativeRewriteV3:false});
 assert.equal((await refused).ok,false);assert.ok(!p.calls.some(x=>x.target.endsWith('/api/web/tasks')&&x.method==='POST'));
 const result=p.sandbox.electronAPI.promptAssistantOptimizePrompt({...payload,requestId:'native-v3-pinned'});await turn();p.answer(3,true,{qwen21NativeRewriteV3:true});await turn();
 const sent=p.calls.find(x=>x.target.endsWith('/api/web/tasks')&&x.method==='POST');assert.equal(JSON.parse(sent.body).target_worker_id,A);
 p.sandbox.NovaFlowWebRuntime.setComputeNode({id:B});await turn();assert.equal((await result).errorCode,'assistant-selection-changed');p.finishPost();await turn();await turn();
 assert.ok(!p.calls.some(x=>x.target.includes('/input/request.json')));p.answer(4,false);await turn();
});

test('v3 refuses to upload when the actual assignment differs from the selected node',async()=>{
 const p=fixture({assignment:B});await ready(p);p.sandbox.NovaFlowWebRuntime.setComputeNode({id:A});await turn();p.answer(1,true,{qwen21NativeRewriteV3:true});await turn();
 p.sandbox.NovaFlowXiaotaoArtAgent={panel:{controller:{businessModelSnapshot:()=>({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0}),subscribeBusinessModel:()=>()=>{}}}};
 const result=p.sandbox.electronAPI.promptAssistantOptimizePrompt({...QWEN_TEXT_SCOPE,assistantSelectionScope:'xiaotao',promptContract:'qwen21-native-rewrite-v3',requestId:'wrong-node',prompt:'synthetic'});
 await turn();p.answer(2,true,{qwen21NativeRewriteV3:true});const response=await result;
 assert.equal(response.ok,false);assert.ok(!p.calls.some(x=>x.target.endsWith('/grant') || x.target.includes('/input/request.json')));
 assert.ok(p.calls.some(x=>x.target.endsWith('/api/web/tasks/task-1/cancel')));
});
