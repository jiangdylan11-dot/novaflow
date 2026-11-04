import test from 'node:test';
import assert from 'node:assert/strict';
import {checkQwenGpuResources, watchQwenGpuResources, QWEN_GPU_COLD_FREE_MIB, QWEN_GPU_RUNNING_FREE_MIB} from '../worker/src/qwen-gpu-resource-guard.mjs';

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
