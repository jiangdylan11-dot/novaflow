import test from 'node:test';
import assert from 'node:assert/strict';
import {createComfyClient} from '../worker/src/comfy/comfy-client.mjs';
test('queue and release forward explicit timeout signal; default remains bounded',async()=>{
 const seen=[],signal=AbortSignal.timeout(3000);
 const client=createComfyClient({baseUrl:'http://127.0.0.1:8188',fetchImpl:async(url,init)=>{seen.push({url,signal:init.signal});return new Response('{}',{status:200});}});
 await client.queueState({signal});await client.freeMemory({signal});await client.queueState();await client.freeMemory();
 assert.equal(seen[0].signal,signal);assert.equal(seen[1].signal,signal);assert.ok(seen[2].signal instanceof AbortSignal);assert.ok(seen[3].signal instanceof AbortSignal);
});
