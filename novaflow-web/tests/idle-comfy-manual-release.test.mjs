import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdleComfyReclaimer} from '../worker/src/idle-comfy-reclaimer.mjs';

const idleQueue=()=>({queue_running:[],queue_pending:[]});
function fixture({queue=async()=>idleQueue(),free=async()=>{},idle=()=>true,clock=()=>1000000}={}) {
  let reserved=false, attempts=0;
  const client={baseUrl:'http://127.0.0.1:8188',queueState:queue,freeMemory:async()=>{attempts++;return free();}};
  const reclaimer=createIdleComfyReclaimer({isIdle:()=>idle(),reserve:()=>{if(reserved)return false;reserved=true;return true;},
    release:()=>{reserved=false;},freeBytes:()=>16*1024**3,now:clock,schedule:()=>0,cancel:()=>{}});
  reclaimer.watch(client);
  return {reclaimer,client,get reserved(){return reserved;},get attempts(){return attempts;}};
}

test('manual release reserves worker and excludes concurrent request until complete',async()=>{
  let finish; const hold=new Promise(resolve=>{finish=resolve;});
  const f=fixture({free:()=>hold});
  const running=f.reclaimer.releaseNow();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.reserved,true);
  assert.deepEqual(await f.reclaimer.releaseNow(),{ok:false,code:'runtime-busy',requested:0});
  finish();
  assert.deepEqual(await running,{ok:true,code:'release-requested',requested:1});
  assert.equal(f.reserved,false); assert.equal(f.attempts,1);
});
test('busy worker and nonempty Comfy queue never release',async()=>{
  const busy=fixture({idle:()=>false});
  assert.equal((await busy.reclaimer.releaseNow()).code,'runtime-busy');
  const queued=fixture({queue:async()=>({queue_running:[],queue_pending:[{}]})});
  assert.equal((await queued.reclaimer.releaseNow()).code,'runtime-busy');
  assert.equal(queued.attempts,0); assert.equal(queued.reserved,false);
});
test('invalid or unreachable queue fails closed',async()=>{
  for (const queue of [async()=>({}),async()=>{throw Error('offline');}]) {
    const f=fixture({queue});
    assert.equal((await f.reclaimer.releaseNow()).code,'queue-unknown');
    assert.equal(f.attempts,0); assert.equal(f.reserved,false);
  }
});
test('new queue work between checks prevents release',async()=>{
  let reads=0;
  const f=fixture({queue:async()=>++reads===1?idleQueue():({queue_running:[{}],queue_pending:[]})});
  assert.equal((await f.reclaimer.releaseNow()).code,'runtime-busy');
  assert.equal(f.attempts,0); assert.equal(f.reserved,false);
});
test('unknown provider response reports unknown, releases reservation and does not retry',async()=>{
  const f=fixture({free:async()=>{throw Error('timeout');}});
  assert.deepEqual(await f.reclaimer.releaseNow(),{ok:false,code:'release-unknown',requested:0});
  assert.equal(f.attempts,1); assert.equal(f.reserved,false);
  assert.equal(await f.reclaimer.poll(),false); assert.equal(f.attempts,1);
});
test('multiple endpoints report partial completion if another endpoint becomes busy',async()=>{
  const f=fixture();
  let reads=0;
  f.reclaimer.watch({baseUrl:'http://127.0.0.1:8189',queueState:async()=>++reads===1?idleQueue():({queue_running:[{}],queue_pending:[]}),freeMemory:async()=>{throw Error('must not release busy endpoint');}});
  assert.deepEqual(await f.reclaimer.releaseNow(),{ok:false,code:'runtime-busy',requested:1});
  assert.equal(f.attempts,1); assert.equal(f.reserved,false);
});
test('retargeted Comfy client is released once, not via both old and new keys',async()=>{
  const f=fixture();
  f.client.baseUrl='http://127.0.0.1:8189';
  f.reclaimer.watch(f.client);
  assert.deepEqual(await f.reclaimer.releaseNow(),{ok:true,code:'release-requested',requested:1});
  assert.equal(f.attempts,1);
});
test('automatic path still honors default 15-minute idle threshold',async()=>{
  let now=1000000; const f=fixture({clock:()=>now});
  now+=899999; assert.equal(await f.reclaimer.poll(),false); assert.equal(f.attempts,0);
  now+=1; assert.equal(await f.reclaimer.poll(),true); assert.equal(f.attempts,1);
});
