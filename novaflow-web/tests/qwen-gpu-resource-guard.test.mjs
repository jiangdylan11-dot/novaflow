import test from 'node:test';
import assert from 'node:assert/strict';
import {checkQwenGpuResources, watchQwenGpuResources, admitQwenGpuWithRelease, QWEN_GPU_COLD_FREE_MIB, QWEN_GPU_RUNNING_FREE_MIB} from '../worker/src/qwen-gpu-resource-guard.mjs';

const idle = () => ({currentTaskId:null});
const empty = async () => ({ok:true,json:async()=>({queue_running:[],queue_pending:[]})});
const memory = async () => ({freeMiB:14000,totalMiB:16000});
const options = extra => ({worker:{getState:idle},comfyUrls:['http://127.0.0.1:8188'],fetchImpl:empty,queryGpu:memory,...extra});
test('an idle owned worker with a verified queue and enough memory is admitted',async()=>{
  assert.deepEqual(await checkQwenGpuResources(options()),{ok:true});
  assert.deepEqual(await checkQwenGpuResources(options({worker:{getState:()=>({currentTaskId:'own'})},ownTaskId:'own'})),{ok:true});
});
test('other work, an active queue, or pending generation blocks Qwen',async()=>{
  assert.equal((await checkQwenGpuResources(options({worker:{getState:()=>({currentTaskId:'other'})}}))).errorCode,'qwen-gpu-worker-busy');
  for(const queue of [{queue_running:[1],queue_pending:[]},{queue_running:[],queue_pending:[1]}])
    assert.equal((await checkQwenGpuResources(options({fetchImpl:async()=>({ok:true,json:async()=>queue})}))).errorCode,'qwen-gpu-generation-busy');
});
test('missing/remote/invalid queues fail closed; a refused loopback server is offline',async()=>{
  for(const extra of [{comfyUrls:[]},{comfyUrls:['http://example.com:8188']},{fetchImpl:async()=>({ok:true,json:async()=>({})})},
    {fetchImpl:async()=>{throw Error('timeout');}}])
    assert.equal((await checkQwenGpuResources(options(extra))).errorCode,'qwen-gpu-queue-unverified');
  assert.deepEqual(await checkQwenGpuResources(options({fetchImpl:async()=>{throw Object.assign(Error('offline'),{code:'ECONNREFUSED'});}})),{ok:true});
});
test('GPU memory is verified and thresholds distinguish loading from warm residency',async()=>{
  const low=async()=>({freeMiB:1000,totalMiB:16000});
  assert.equal((await checkQwenGpuResources(options({queryGpu:low,minFreeMiB:QWEN_GPU_COLD_FREE_MIB}))).errorCode,'qwen-gpu-memory-low');
  assert.deepEqual(await checkQwenGpuResources(options({queryGpu:low,minFreeMiB:QWEN_GPU_RUNNING_FREE_MIB})),{ok:true});
  for(const queryGpu of [async()=>null,async()=>({freeMiB:20000,totalMiB:16000}),async()=>{throw Error('unavailable');}])
    assert.equal((await checkQwenGpuResources(options({queryGpu}))).errorCode,'qwen-gpu-memory-unverified');
});
test('worker ownership is checked again after asynchronous probes',async()=>{
  let count=0;
  const worker={getState:()=>({currentTaskId:++count===1?null:'other'})};
  assert.equal((await checkQwenGpuResources(options({worker}))).errorCode,'qwen-gpu-worker-busy');
});
test('a running-session monitor can observe queue and memory during a graceful handoff',async()=>{
  const worker={getState:()=>({currentTaskId:'next-generation-task'})};
  assert.deepEqual(await checkQwenGpuResources(options({worker,checkWorker:false,minFreeMiB:QWEN_GPU_RUNNING_FREE_MIB})),{ok:true});
  const fetchImpl=async()=>({ok:true,json:async()=>({queue_running:[1],queue_pending:[]})});
  assert.equal((await checkQwenGpuResources(options({worker,fetchImpl,checkWorker:false}))).errorCode,'qwen-gpu-generation-busy');
});
test('watch cancels only its own model on a busy queue and stops on close',async()=>{
  let tick,cleared=false,checks=0;
  const own=new AbortController(),other=new AbortController();
  const stop=watchQwenGpuResources({abort:own,check:async()=>{checks++;return {ok:false,errorCode:'qwen-gpu-generation-busy',error:'busy'};},
    setIntervalImpl:(fn,ms)=>{assert.equal(ms,5000);tick=fn;return 7;},clearIntervalImpl:id=>{assert.equal(id,7);cleared=true;}});
  await tick();assert.equal(own.signal.aborted,true);assert.equal(own.signal.reason.errorCode,'qwen-gpu-generation-busy');
  assert.equal(other.signal.aborted,false);stop();await tick();assert.equal(checks,1);assert.equal(cleared,true);
});
test('a pending observation cannot cancel a model after the watch closes',async()=>{
  let tick,finish;
  const own=new AbortController();
  const stop=watchQwenGpuResources({abort:own,check:()=>new Promise(resolve=>{finish=resolve;}),
    setIntervalImpl:fn=>{tick=fn;return 1;},clearIntervalImpl:()=>{}});
  const pending=tick();stop();finish({ok:false,errorCode:'qwen-gpu-memory-low'});await pending;
  assert.equal(own.signal.aborted,false);
});

test('cold admission after a generation unloads idle Comfy caches and re-checks memory',async()=>{
  let free=4000,released=0,freeCalls=0;
  const fetchImpl=async(url,init)=>{
    if(String(url).endsWith('/free')){freeCalls++;free=14000;return {ok:true,json:async()=>({})};}
    return empty();
  };
  const check=()=>checkQwenGpuResources(options({fetchImpl,queryGpu:async()=>({freeMiB:free,totalMiB:16000})}));
  const release=async()=>{released++;await fetchImpl('http://127.0.0.1:8188/free',{method:'POST'});return {ok:true};};
  assert.equal((await check()).errorCode,'qwen-gpu-memory-low');
  assert.deepEqual(await admitQwenGpuWithRelease({check,release,sleep:async()=>{}}),{ok:true});
  assert.equal(released,1);assert.equal(freeCalls,1);
});

test('cold admission waits for the driver to return memory after the unload',async()=>{
  let checks=0;
  const check=async()=>(++checks>=4 ? {ok:true} : {ok:false,errorCode:'qwen-gpu-memory-low',error:'low'});
  assert.deepEqual(await admitQwenGpuWithRelease({check,release:async()=>({ok:true}),sleep:async()=>{}}),{ok:true});
  assert.equal(checks,4);
});

test('admission never releases for warm checks, other failures, or a busy generation service',async()=>{
  let released=0;const release=async()=>{released++;return {ok:true};};
  const low={ok:false,errorCode:'qwen-gpu-memory-low',error:'low'};
  assert.deepEqual(await admitQwenGpuWithRelease({check:async()=>low,release,warm:true}),low);
  const busy={ok:false,errorCode:'qwen-gpu-generation-busy',error:'busy'};
  assert.deepEqual(await admitQwenGpuWithRelease({check:async()=>busy,release}),busy);
  assert.equal(released,0);
  const refused={ok:false,errorCode:'runtime-generation-busy',error:'busy'};
  let checks=0;
  assert.deepEqual(await admitQwenGpuWithRelease({check:async()=>{checks++;return low;},release:async()=>refused,sleep:async()=>{}}),low);
  assert.equal(checks,1);
  checks=0;
  assert.deepEqual(await admitQwenGpuWithRelease({check:async()=>{checks++;return low;},release:async()=>({ok:true}),sleep:async()=>{},attempts:3}),low);
  assert.equal(checks,4);
});
