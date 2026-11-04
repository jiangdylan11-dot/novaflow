import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createIdleComfyReclaimer} from '../../worker/src/idle-comfy-reclaimer.mjs';

// Run the actual worker tick body with a controlled clock and local stub client.
// It calls watch on every tick, as the production worker does; no server is touched.
const source = readFileSync(new URL('../../worker/src/worker-core.mjs', import.meta.url), 'utf8');
const match = source.match(/function startIdleReclaimer\(\)\s*\{[\s\S]*?const tick = \(\) => \{([\s\S]*?)\n    \};/);
assert(match, 'actual worker tick not found');
const tickFactory = new vm.Script(`(function(state,comfyImage,comfyVideo,idleReclaimer,log){ return () => {${match[1]}\n}; })`);
const buildTick = tickFactory.runInNewContext();
const G = 1024 ** 3;
function fixture({free=16*G, failure=false}={}) {
  let time=1000000, idle=true, lock=false, count=0, pending, queue={queue_running:[],queue_pending:[]};
  const client={baseUrl:'http://127.0.0.1:8188', queueState:async()=>queue,
    freeMemory:async()=>{count++;if(failure)throw Error('unknown result');}};
  const reclaimer=createIdleComfyReclaimer({now:()=>time,freeBytes:()=>free,isIdle:()=>idle,
    reserve:()=>{if(lock)return false;lock=true;return true;},release:()=>{lock=false;}});
  const proxy={watch:(...args)=>reclaimer.watch(...args),poll:()=>{pending=reclaimer.poll();return pending;}};
  const tick=buildTick({comfy:{image:true,video:false}},client,client,proxy,()=>{});
  return {client,reclaimer,advance:n=>{time+=n},setIdle:value=>{idle=value},setQueue:value=>{queue=value},
    count:()=>count,locked:()=>lock,tick:async()=>{tick();await pending;}};
}

test('actual tick does not re-arm a successful release while idle',async()=>{
  const f=fixture();await f.tick();f.advance(900000);await f.tick();assert.equal(f.count(),1);
  for(let i=0;i<80;i++){f.advance(30000);await f.tick();}assert.equal(f.count(),1);assert.equal(f.locked(),false);
});
test('actual tick does not retry an unknown outcome while idle',async()=>{
  const f=fixture({failure:true});await f.tick();f.advance(900000);await f.tick();assert.equal(f.count(),1);
  for(let i=0;i<80;i++){f.advance(30000);await f.tick();}assert.equal(f.count(),1);assert.equal(f.locked(),false);
});
test('new Foart graph re-arms after release and preserves normal hot interval',async()=>{
  const f=fixture();await f.tick();f.advance(900000);await f.tick();f.reclaimer.noteGraph(f.client);
  f.advance(899999);await f.tick();assert.equal(f.count(),1);f.advance(1);await f.tick();assert.equal(f.count(),2);
});
test('observed external queued work re-arms, then waits for a fresh idle window',async()=>{
  const f=fixture();await f.tick();f.advance(900000);await f.tick();
  f.setQueue({queue_running:[['external']],queue_pending:[]});f.advance(30000);await f.tick();assert.equal(f.count(),1);
  f.setQueue({queue_running:[],queue_pending:[]});f.advance(899999);await f.tick();assert.equal(f.count(),1);
  f.advance(1);await f.tick();assert.equal(f.count(),2);
});
test('low-memory idle interval remains 120 seconds',async()=>{
  const f=fixture({free:4*G});await f.tick();f.advance(119999);await f.tick();assert.equal(f.count(),0);
  f.advance(1);await f.tick();assert.equal(f.count(),1);
});
test('active Foart work and pending Comfy work never release models',async()=>{
  const f=fixture({free:4*G});await f.tick();f.setIdle(false);f.advance(120000);await f.tick();assert.equal(f.count(),0);
  f.setIdle(true);f.setQueue({queue_running:[],queue_pending:[['work']]});f.advance(120000);await f.tick();assert.equal(f.count(),0);
});
test('explicit manual request can re-arm after an idle release',async()=>{
  const f=fixture();await f.tick();f.advance(900000);await f.tick();f.reclaimer.watch(f.client,{manual:true});
  const result=await f.reclaimer.releaseNow();assert.equal(result.ok,true);assert.equal(result.requested,1);assert.equal(f.count(),2);
});
