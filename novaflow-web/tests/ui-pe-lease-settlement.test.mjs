import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForOwnedUiPrompt} from '../worker/src/native-ui-draft.mjs';
test('cancellation waits for the owned Comfy prompt to finish without touching other prompts',async()=>{
 let polls=0,cancel=false;const seen=[];
 const history=async id=>{seen.push(id);polls++;if(polls===1){cancel=true;return {status:{completed:false}};}if(polls===2)throw Error('temporary outage');return {status:{completed:true,status_str:'success'}};};
 await assert.rejects(waitForOwnedUiPrompt({promptId:'owned',history,isCancelled:()=>cancel,timeoutMs:100000,pollMs:0,sleep:async()=>{}}),/cancelled after its model task finished/);
 assert.equal(polls,3);assert.deepEqual(seen,['owned','owned','owned']);
});
test('timeout cannot release the lease until owned history is terminal',async()=>{
 let clock=0,polls=0;
 await assert.rejects(waitForOwnedUiPrompt({promptId:'owned',timeoutMs:5,pollMs:1,now:()=>clock,sleep:async()=>{clock+=10},history:async()=>{polls++;return polls===3?{status:{completed:true,status_str:'success'}}:{status:{completed:false}};}}),/timed out; its model task has now finished/);
 assert.equal(polls,3);
});
test('successful and explicit error terminal statuses are distinguished',async()=>{
 const h={status:{completed:true,status_str:'success'},outputs:{'4':{text:['ok']}}};
 assert.equal(await waitForOwnedUiPrompt({promptId:'own',timeoutMs:100,pollMs:0,history:async()=>h}),h);
 await assert.rejects(waitForOwnedUiPrompt({promptId:'own',timeoutMs:100,pollMs:0,history:async()=>({status:{status_str:'error'}})}),/model failed/);
});
