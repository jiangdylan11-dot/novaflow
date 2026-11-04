import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker} from '../worker/src/worker-core.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reply=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
const policy={enabled:true,owner_enabled:true,sharing_enabled:false,sharing_scope:'pool',allowed_user_ids:[]};

async function fixture() {
 const dir=await mkdtemp(join(tmpdir(),'foart-claim-pause-'));
 const previousFetch=globalThis.fetch,claims=[],heartbeats=[],failures=[],completions=[],freeRequests=[];
 let claimHandler=async()=>reply({task:null}),heartbeatHandler=async()=>reply({policy,worker:{}}),queueHandler=async()=>reply({queue_running:[],queue_pending:[]}),freeHandler=async()=>reply({});
 const taskStart=deferred(),taskFinish=deferred();let cancelled=false;
 const assistant={status:()=>({localModels:[]}),runForTask:async(_id,_method,_request,context)=>{
   taskStart.resolve();await taskFinish.promise;cancelled=context.isCancelled();return {ok:true};
 }};
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(String(input));
  if(url.port==='19081'){
   if(url.pathname==='/system_stats')return reply({system:{comfyui_version:'test'}});
   if(url.pathname==='/queue')return queueHandler();
   if(url.pathname==='/free'){freeRequests.push(true);return freeHandler();}
   return reply({});
  }
  if(url.port==='19082'){
   if(url.pathname==='/api/worker/register')return reply({workerToken:'fixture',grantKey:'fixture',policy,worker:{}});
   if(url.pathname==='/api/worker/heartbeat'){const body=JSON.parse(init.body);heartbeats.push(body);return heartbeatHandler(body);}
   if(url.pathname==='/api/worker/claim'){claims.push(true);return claimHandler();}
   if(url.pathname.endsWith('/complete')){completions.push(url.pathname);return reply({ok:true});}
   if(url.pathname.endsWith('/fail')){failures.push(JSON.parse(init.body));return reply({ok:true});}
   return reply({ok:true});
  }
  throw Error('unexpected test URL '+url.origin);
 };
 const worker=createWorker({controlUrl:'http://127.0.0.1:19082',comfyImageUrl:'http://127.0.0.1:19081',
  dataDir:dir,configPath:join(dir,'identity.json'),workflowDir:dir,rendererDir:dir,gatewayPort:0,gatewayHost:'127.0.0.1',
  publicEndpoint:'http://127.0.0.1:19083',tunnel:false,registrationProfile:'compute-only',localTasks:null,
  pollIntervalMs:3600000,heartbeatIntervalMs:3600000,promptAssistant:()=>assistant});
 await worker.startSharing();worker.setComputeReady(true);
 async function prepareTask(id='fixture-task') {
  const d=join(dir,'tasks',id,'input');await mkdir(d,{recursive:true});await writeFile(join(d,'request.json'),JSON.stringify({modelId:'qwen3.5-9b-heretic',mode:'chat'}));
  return {id,task_type:'prompt_assistant',model_id:'qwen3.5-9b-heretic',parameters:{action:'art-agent-chat',model_id:'qwen3.5-9b-heretic'},references:[{name:'request.json'}]};
 }
 return {worker,claims,heartbeats,failures,completions,freeRequests,taskStart,taskFinish,prepareTask,get cancelled(){return cancelled},
  setClaim(fn){claimHandler=fn},setHeartbeat(fn){heartbeatHandler=fn},setQueue(fn){queueHandler=fn},setFree(fn){freeHandler=fn},
  async cleanup(){taskFinish.resolve();await worker.stop().catch(()=>{});globalThis.fetch=previousFetch;await rm(dir,{recursive:true,force:true})}};
}

test('pause waits for a claim already in flight and its real worker task to finish without cancellation',async()=>{
 const f=await fixture();const claim=deferred(),claimStarted=deferred();
 try{
  const task=await f.prepareTask();f.setClaim(()=>{claimStarted.resolve();return claim.promise});
  const running=f.worker.claimAndRun();await claimStarted.promise;
  let settled=false;const paused=f.worker.pauseClaims({timeoutMs:3000}).then(v=>(settled=true,v));
  assert.equal(f.worker.getState().claimsPaused,true);assert.equal(f.worker.getState().sharing,true);
  assert.equal(await f.worker.claimAndRun(),false);assert.equal(f.claims.length,1);
  assert.equal((await f.worker.releaseIdleModels()).code,'runtime-busy');assert.equal(f.freeRequests.length,0);
  await wait(10);assert.equal(settled,false,'in-flight claim must drain');
  claim.resolve(reply({task}));await f.taskStart.promise;await wait(10);
  assert.equal(settled,false,'already claimed task must finish naturally');
  assert.equal(f.worker.getState().currentTaskId,task.id);f.taskFinish.resolve();await running;
  assert.deepEqual(await paused,{ok:true,paused:true,locallyIdle:true});
  assert.equal(f.cancelled,false);assert.equal(f.completions.length,1);assert.equal(f.failures.length,0);
  assert.equal(await f.worker.claimAndRun(),false);assert.equal(f.claims.length,1);
  f.worker.resumeClaims();f.setClaim(async()=>reply({task:null}));assert.equal(await f.worker.claimAndRun(),false);assert.equal(f.claims.length,2);
 }finally{claim.resolve(reply({task:null}));await f.cleanup()}
});

test('repeat pause is stable, resume cancels waiting pauses and does not cancel the in-flight claim',async()=>{
 const f=await fixture();const claim=deferred(),started=deferred();
 try{
  f.setClaim(()=>{started.resolve();return claim.promise});const running=f.worker.claimAndRun();await started.promise;
  const a=f.worker.pauseClaims({timeoutMs:3000}),b=f.worker.pauseClaims({timeoutMs:3000});
  assert.equal(f.worker.getState().claimsPaused,true);f.worker.resumeClaims();
  assert.deepEqual(await a,{ok:false,paused:false,reason:'pause-resumed'});assert.deepEqual(await b,{ok:false,paused:false,reason:'pause-resumed'});
  claim.resolve(reply({task:null}));await running;
  assert.deepEqual(await f.worker.pauseClaims({timeoutMs:1000}),{ok:true,paused:true,locallyIdle:true});
  assert.deepEqual(await f.worker.pauseClaims({timeoutMs:1000}),{ok:true,paused:true,locallyIdle:true});
  f.worker.resumeClaims();f.worker.resumeClaims();assert.equal(f.worker.getState().sharing,true);assert.equal(f.worker.getState().claimsPaused,false);
 }finally{claim.resolve(reply({task:null}));await f.cleanup()}
});

test('a failed in-flight claim stays paused and reports unknown remote reservation',async()=>{
 const f=await fixture();const claim=deferred(),started=deferred();
 try{
  f.setClaim(()=>{started.resolve();return claim.promise});const running=f.worker.claimAndRun();await started.promise;
  const paused=f.worker.pauseClaims({timeoutMs:3000});claim.reject(new Error('simulated disconnect'));await running;
  assert.deepEqual(await paused,{ok:false,paused:true,locallyIdle:true,reason:'claim-outcome-unknown'});
  assert.equal(f.worker.getState().claimOutcomeUnknown,true);assert.equal((await f.worker.releaseIdleModels()).ok,true);assert.equal(f.freeRequests.length,1);assert.equal(await f.worker.claimAndRun(),false);
  f.worker.resumeClaims();assert.equal(f.worker.getState().claimsPaused,false);
  f.setClaim(async()=>reply({task:null}));assert.equal(await f.worker.claimAndRun(),false);
  assert.deepEqual(await f.worker.pauseClaims({timeoutMs:1000}),{ok:false,paused:true,locallyIdle:true,reason:'claim-outcome-unknown'});
 }finally{claim.resolve(reply({task:null}));await f.cleanup()}
});

test('pause supersedes an older idle heartbeat and survives duplicate start',async()=>{
 const f=await fixture();const old=deferred(),started=deferred();let first=true;
 try{
  f.setHeartbeat(body=>{if(first){first=false;started.resolve(body);return old.promise}return Promise.resolve(reply({policy,worker:{}}));});
  const heartbeat=f.worker.heartbeat();const sent=await started.promise;assert.equal(sent.status,'idle');
  assert.deepEqual(await f.worker.pauseClaims({timeoutMs:1000}),{ok:true,paused:true,locallyIdle:true});
  old.resolve(reply({policy,worker:{}}));await heartbeat;await wait(20);
  assert.equal(f.heartbeats.at(-1).status,'maintenance');
  await f.worker.startSharing();assert.equal(f.worker.getState().claimsPaused,true);
  assert.equal(await f.worker.claimAndRun(),false);assert.equal(f.claims.length,0);
 }finally{old.resolve(reply({policy,worker:{}}));await f.cleanup()}
});


test('timeout keeps the pause active and never cancels a pending claim',async()=>{
 const f=await fixture();const claim=deferred(),started=deferred();
 try{
  f.setClaim(()=>{started.resolve();return claim.promise});const running=f.worker.claimAndRun();await started.promise;
  assert.deepEqual(await f.worker.pauseClaims({timeoutMs:20}),{ok:false,paused:true,reason:'pause-timeout'});
  assert.equal(await f.worker.claimAndRun(),false);assert.equal(f.claims.length,1);
  claim.resolve(reply({task:null}));await running;
  assert.deepEqual(await f.worker.pauseClaims({timeoutMs:1000}),{ok:true,paused:true,locallyIdle:true});
 }finally{claim.resolve(reply({task:null}));await f.cleanup()}
});

test('malformed claim response cannot certify the remote reservation as drained',async()=>{
 const f=await fixture();
 try{
  f.setClaim(async()=>reply({ok:true}));assert.equal(await f.worker.claimAndRun(),false);
  assert.deepEqual(await f.worker.pauseClaims({timeoutMs:1000}),{ok:false,paused:true,locallyIdle:true,reason:'claim-outcome-unknown'});
  assert.equal(f.worker.getState().claimOutcomeUnknown,true);
 }finally{await f.cleanup()}
});


test('paused manual release excludes resume and duplicate until response; user resumes explicitly',async()=>{
 const f=await fixture(),gate=deferred(),started=deferred();
 try{
  assert.equal((await f.worker.pauseClaims({timeoutMs:1000})).ok,true);
  f.setFree(()=>{started.resolve();return gate.promise});
  const release=f.worker.releaseIdleModels();await started.promise;
  assert.equal(f.worker.getState().manualReleaseBusy,true);assert.equal(f.worker.getState().claimsPaused,true);
  assert.throws(()=>f.worker.resumeClaims(),/释放请求进行中/);
  assert.equal((await f.worker.releaseIdleModels()).code,'runtime-busy');assert.equal(await f.worker.claimAndRun(),false);assert.equal(f.claims.length,0);
  gate.resolve(reply({}));assert.deepEqual(await release,{ok:true,code:'release-requested',requested:1});
  assert.equal(f.worker.getState().claimsPaused,true);assert.equal(f.worker.getState().manualReleaseBusy,false);assert.equal(f.freeRequests.length,1);
  f.worker.resumeClaims();assert.equal(f.worker.getState().claimsPaused,false);
 }finally{gate.resolve(reply({}));await f.cleanup()}
});

test('paused manual release refuses new external queue work between checks',async()=>{
 const f=await fixture();let checks=0;
 try{assert.equal((await f.worker.pauseClaims({timeoutMs:1000})).ok,true);f.setQueue(async()=>reply(++checks===1?{queue_running:[],queue_pending:[]}:{queue_running:[],queue_pending:[{}]}));
  assert.equal((await f.worker.releaseIdleModels()).code,'runtime-busy');assert.equal(f.freeRequests.length,0);assert.equal(f.worker.getState().claimsPaused,true);
 }finally{await f.cleanup()}
});

test('paused release unknown is never retried automatically and remains paused',async()=>{
 const f=await fixture();try{assert.equal((await f.worker.pauseClaims({timeoutMs:1000})).ok,true);f.setFree(async()=>{throw Error('simulated timeout')});
  assert.deepEqual(await f.worker.releaseIdleModels(),{ok:false,code:'release-unknown',requested:0});assert.equal(f.freeRequests.length,1);assert.equal(f.worker.getState().claimsPaused,true);
  await wait(20);assert.equal(f.freeRequests.length,1);
 }finally{await f.cleanup()}
});


test('heartbeat disconnect and reconnection preserve paused claims',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.worker.pauseClaims({timeoutMs:1000})).ok,true);await wait(20);
  f.setHeartbeat(async()=>{throw new Error('simulated heartbeat disconnect')});await f.worker.heartbeat();
  assert.equal(f.worker.getState().claimsPaused,true);assert.equal(await f.worker.claimAndRun(),false);
  f.setHeartbeat(async()=>reply({policy,worker:{}}));await f.worker.heartbeat();
  assert.equal(f.worker.getState().claimsPaused,true);assert.equal(f.heartbeats.at(-1).status,'maintenance');
  assert.equal(await f.worker.claimAndRun(),false);assert.equal(f.claims.length,0);
 }finally{await f.cleanup()}
});
