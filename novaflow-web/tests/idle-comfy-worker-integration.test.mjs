import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker} from '../worker/src/worker-core.mjs';

test('website-only worker starts automatic reclaimer and shares task claim guard with manual release',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'foart-idle-worker-'));
  const oldFetch=globalThis.fetch,oldInterval=globalThis.setInterval,oldClear=globalThis.clearInterval,oldNow=Date.now;
  let clock=1000000, timer, freeCalls=0, queueBusy=false, queueMalformed=false, claimStart, finishClaim, claims=0;
  const claimStarted=new Promise(resolve=>{claimStart=resolve;});
  const policy={enabled:true,owner_enabled:true,sharing_enabled:false,sharing_scope:'pool',allowed_user_ids:[]};
  const reply=(data)=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(String(input));
    if(url.port==='19081'){
      if(url.pathname==='/system_stats')return reply({system:{comfyui_version:'test'}});
      if(url.pathname==='/queue')return reply(queueMalformed?{}:{queue_running:queueBusy?[{}]:[],queue_pending:[]});
      if(url.pathname==='/free'){freeCalls++;return reply({});}
      return reply({});
    }
    if(url.port==='19082'){
      if(url.pathname==='/api/worker/register')return reply({workerToken:'fixture',grantKey:'fixture',policy,worker:{}});
      if(url.pathname==='/api/worker/heartbeat')return reply({policy,worker:{}});
      if(url.pathname==='/api/worker/claim'){claims++;claimStart();return new Promise(resolve=>{finishClaim=()=>resolve(reply({task:null}));});}
      return reply({});
    }
    throw Error('unexpected test URL '+url.origin);
  };
  Date.now=()=>clock;
  globalThis.setInterval=(fn,ms,...args)=>{
    if(ms===30000){timer=fn;return {unref(){}};}
    return oldInterval(fn,ms,...args);
  };
  globalThis.clearInterval=(handle)=>{if(handle && handle.unref && handle===timer)return;oldClear(handle);};
  const worker=createWorker({controlUrl:'http://127.0.0.1:19082',comfyImageUrl:'http://127.0.0.1:19081',
    dataDir:dir,configPath:join(dir,'identity.json'),workflowDir:dir,rendererDir:dir,gatewayPort:0,gatewayHost:'127.0.0.1',
    publicEndpoint:'http://127.0.0.1:19083',tunnel:false,registrationProfile:'compute-only',localTasks:null,
    pollIntervalMs:3600000,heartbeatIntervalMs:3600000});
  try {
    await worker.startSharing();
    worker.setComputeReady(true);
    assert.equal(typeof timer,'function','compute-only lifecycle must start auto timer');
    clock+=899999; timer(); await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(freeCalls,0);
    clock+=1; timer(); await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(freeCalls,1,'automatic path should release after default idle interval');
    assert.equal((await worker.pauseClaims({timeoutMs:1000})).ok,true);
    clock+=900001; timer(); await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(freeCalls,1,'automatic path must remain disabled while paused');
    worker.resumeClaims();
    queueBusy=true;
    assert.equal((await worker.releaseIdleModels()).code,'runtime-busy');
    queueBusy=false;queueMalformed=true;
    assert.equal((await worker.releaseIdleModels()).code,'queue-unknown');
    queueMalformed=false;
    const claim=worker.claimAndRun();await claimStarted;
    assert.equal((await worker.releaseIdleModels()).code,'runtime-busy');
    finishClaim();await claim;
    assert.equal((await worker.releaseIdleModels()).code,'release-requested');
    assert.equal(freeCalls,2);assert.equal(claims,1);
  } finally {
    if(finishClaim)finishClaim();
    await worker.stop().catch(()=>{});
    globalThis.fetch=oldFetch;globalThis.setInterval=oldInterval;globalThis.clearInterval=oldClear;Date.now=oldNow;
    await rm(dir,{recursive:true,force:true});
  }
});
