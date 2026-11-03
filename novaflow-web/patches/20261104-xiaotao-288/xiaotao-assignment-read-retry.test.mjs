import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const start=source.indexOf('  async function waitForAssignment('),end=source.indexOf('  async function putReferences(',start);assert.ok(start>0&&end>start);
function fixture(handler,{onTimer}={}){const calls=[],tasks=new Map();let clock=0;
 const box={control:async(method,path)=>{calls.push({method,path});return handler(calls.length);},tasks,taskErrorText:()=>'',Date:{now:()=>clock},setTimeout:(fn,ms)=>{clock+=ms;onTimer?.();queueMicrotask(fn);return 1;},clearTimeout(){},console};
 vm.createContext(box);vm.runInContext(source.slice(start,end)+'\nglobalThis.run=waitForAssignment;',box);
 return {run:box.run,calls,get clock(){return clock;}};
}
test('assignment polling retries transient GET failures and keeps the same queued task',async()=>{
 const f=fixture(n=>{if(n<=2)throw new TypeError('Failed to fetch');if(n===3)return {task:{status:'queued'}};return {task:{status:'assigned',assigned_worker_id:'node-a'}};});
 const task=await f.run('task-a',{assertCurrent(){}});assert.equal(task.assigned_worker_id,'node-a');assert.equal(f.calls.length,4);assert.ok(f.calls.every(c=>c.method==='GET'&&c.path==='/api/web/tasks/task-a'));assert.equal(f.clock,2500);
});
test('persistent network failure is bounded and HTTP 4xx never retries',async()=>{
 const a=fixture(()=>{throw new TypeError('Failed to fetch');});await assert.rejects(a.run('task-a'),/Failed to fetch/);assert.equal(a.calls.length,4);assert.equal(a.clock,4200);
 const b=fixture(()=>{throw Object.assign(new Error('forbidden'),{status:403});});await assert.rejects(b.run('task-a'),/forbidden/);assert.equal(b.calls.length,1);
});
test('cancellation and changed account or node stop polling without retry',async()=>{
 for(const kind of ['cancel','context']){const controller=new AbortController();let current=true;
  const f=fixture(()=>{if(kind==='cancel')controller.abort();else current=false;throw new TypeError('Failed to fetch');});
  await assert.rejects(f.run('task-a',{signal:controller.signal,assertCurrent(){if(!current)throw Error('context changed');}}),kind==='cancel'?/取消/:/context changed/);assert.equal(f.calls.length,1);
 }
});
test('a successful status read resets the bounded consecutive retry count',async()=>{
 const f=fixture(n=>{if(n===4)return {task:{status:'queued'}};if(n===8)return {task:{assigned_worker_id:'node-a'}};throw new TypeError('Failed to fetch');});
 assert.equal((await f.run('task-a')).assigned_worker_id,'node-a');assert.equal(f.calls.length,8);
});
test('cancellation during a retry delay stops before the next GET',async()=>{
 const controller=new AbortController();const f=fixture(()=>{throw new TypeError('Failed to fetch');},{onTimer:()=>queueMicrotask(()=>controller.abort())});
 await assert.rejects(f.run('task-a',{signal:controller.signal}),/取消/);assert.equal(f.calls.length,1);
});
