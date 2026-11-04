import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createWorker,emptyClaimDelayMs} from '../worker/src/worker-core.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reply=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve};};
const policy={enabled:true,owner_enabled:true,sharing_enabled:false,sharing_scope:'pool',allowed_user_ids:[]};

test('empty queue revisits within a five-second budget with the standard two-second poll',()=>{
  assert.equal(emptyClaimDelayMs(2000,2000),2000);
  assert.equal(emptyClaimDelayMs(4000,2000),3000);
  assert.equal(emptyClaimDelayMs(30000,2000),3000);
  assert.ok(emptyClaimDelayMs(30000,2000)+2000<=5000);
});

async function fixture({pollIntervalMs=20,timeoutMs=2500,rotation=false,assistantStatus={localModels:[]}}={}) {
  const dir=await mkdtemp(join(tmpdir(),'foart-idle-claim-'));
  const originalFetch=globalThis.fetch,claims=[];
  const started=deferred(),finish=deferred();let nextTask=null,claimOverride=null;
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(String(input));
    if(url.port==='19091') {
      if(url.pathname==='/system_stats')return reply({system:{comfyui_version:'test'}});
      if(url.pathname==='/queue')return reply({queue_running:[],queue_pending:[]});
      return reply({});
    }
    if(url.port==='19092') {
      if(url.pathname==='/api/worker/register')return reply({workerToken:'fixture',grantKey:'fixture',policy,worker:{}});
      if(url.pathname==='/api/worker/heartbeat')return reply({policy,worker:{}});
      if(url.pathname==='/api/worker/claim') {claims.push(performance.now());if(claimOverride)return claimOverride();const task=nextTask;nextTask=null;return reply({task});}
      return reply({ok:true});
    }
    throw Error('unexpected test URL '+url.origin);
  };
  const assistant={status:()=>assistantStatus,runForTask:async()=>{started.resolve();await finish.promise;return {ok:true};}};
  const worker=createWorker({controlUrl:'http://127.0.0.1:19092',comfyImageUrl:'http://127.0.0.1:19091',
    dataDir:dir,configPath:join(dir,'identity.json'),workflowDir:dir,rendererDir:dir,gatewayPort:0,gatewayHost:'127.0.0.1',
    publicEndpoint:'http://127.0.0.1:19093',tunnel:false,registrationProfile:'compute-only',localTasks:null,
    pollIntervalMs,heartbeatIntervalMs:3600000,promptAssistant:()=>assistant,logger:()=>{},
    qwenRotationCandidateEnabled:rotation,qwenRotationVerificationEnabled:rotation});
  await worker.startSharing();worker.setComputeReady(true);
  const until=async check=>{const deadline=performance.now()+timeoutMs;while(!check()){if(performance.now()>deadline)throw Error('timed out waiting for worker state');await pause(5);}};
  return {worker,claims,started,finish,until,
    setClaim(handler){claimOverride=handler;},
    async offerTask(){const id='fixture-task',input=join(dir,'tasks',id,'input');await mkdir(input,{recursive:true});
      await writeFile(join(input,'request.json'),JSON.stringify({modelId:'qwen3.5-9b-heretic',mode:'chat'}));
      nextTask={id,task_type:'prompt_assistant',model_id:'qwen3.5-9b-heretic',parameters:{action:'art-agent-chat',model_id:'qwen3.5-9b-heretic'},references:[{name:'request.json'}]};},
    async cleanup(){finish.resolve();await worker.stop().catch(()=>{});globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});}};
}

test('idle cloud claims back off, pause suppresses them, and resume restores the first interval',async()=>{
  const f=await fixture();
  try {
    await f.until(()=>f.claims.length>=6);
    const gaps=f.claims.slice(1,6).map((value,i)=>value-f.claims[i]);
    // The scaled 20ms base corresponds to 2, 4, 8, 16, 30 seconds in the product.
    for(const [i,minimum] of [15,35,70,145,280].entries())assert.ok(gaps[i]>=minimum,`gap ${i}: ${gaps[i]}`);
    assert.ok((await f.worker.pauseClaims({timeoutMs:1000})).ok);
    const count=f.claims.length;await pause(80);assert.equal(f.claims.length,count);
    const resumed=performance.now();f.worker.resumeClaims();await f.until(()=>f.claims.length>count);
    assert.ok(f.claims[count]-resumed<120,'resumed worker should not wait for the previous 300ms backoff');
    await f.worker.stopSharing();const stopped=f.claims.length;await pause(80);assert.equal(f.claims.length,stopped);
  } finally {await f.cleanup();}
});

test('standard two-second polling finds newly queued work after an idle backoff',{timeout:20000},async()=>{
  const f=await fixture({pollIntervalMs:2000,timeoutMs:16000});
  try {
    await f.until(()=>f.claims.length>=3);
    const offeredAt=performance.now();await f.offerTask();await f.started.promise;
    assert.ok(performance.now()-offeredAt<5500,'an idle node should claim within about five seconds');
    f.finish.resolve();
  } finally {await f.cleanup();}
});

test('a stale in-flight empty reply cannot restore a delay after pause and resume',async()=>{
  const f=await fixture(),pending=deferred();
  try {
    f.setClaim(()=>pending.promise);await f.until(()=>f.claims.length===1);
    const paused=f.worker.pauseClaims({timeoutMs:1000});
    f.worker.resumeClaims();assert.equal((await paused).reason,'pause-resumed');
    const resumed=performance.now();pending.resolve(reply({task:null}));
    await f.until(()=>f.claims.length>=2);
    assert.ok(f.claims[1]-resumed<120,'a pre-resume reply must not defer a resumed node');
  } finally {pending.resolve(reply({task:null}));await f.cleanup();}
});

test('failed claim responses retain exponential service-failure backoff',async()=>{
  const f=await fixture();
  try {
    f.setClaim(()=>{throw new Error('offline');});await f.until(()=>f.claims.length>=6);
    const gaps=f.claims.slice(1,6).map((value,i)=>value-f.claims[i]);
    for(const [i,minimum] of [15,35,70,145,280].entries())assert.ok(gaps[i]>=minimum,`failure gap ${i}: ${gaps[i]}`);
  } finally {await f.cleanup();}
});

test('an explicitly failed assistant status retains service-failure backoff',async()=>{
  const f=await fixture({rotation:true,assistantStatus:{ok:false,localModels:[]}});
  try {
    await f.until(()=>f.claims.length>=6);
    const gaps=f.claims.slice(1,6).map((value,i)=>value-f.claims[i]);
    for(const [i,minimum] of [15,35,70,145,280].entries())assert.ok(gaps[i]>=minimum,`status failure gap ${i}: ${gaps[i]}`);
  } finally {await f.cleanup();}
});

test('an accepted task prevents empty claims and completion restores the first interval',async()=>{
  const f=await fixture();
  try {
    await f.until(()=>f.claims.length>=4);
    await f.offerTask();
    // An explicit caller is allowed to check immediately even during backoff.
    const running=f.worker.claimAndRun();await f.started.promise;
    const count=f.claims.length;await pause(100);assert.equal(f.claims.length,count);
    const done=performance.now();f.finish.resolve();assert.equal(await running,true);
    await f.until(()=>f.claims.length>count);
    assert.ok(f.claims[count]-done<120,'completion should reset the long idle backoff');
  } finally {await f.cleanup();}
});
