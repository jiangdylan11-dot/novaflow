import test from 'node:test';
import assert from 'node:assert/strict';
import {createComfyClient} from '../worker/src/comfy/comfy-client.mjs';

const reply=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
const client=histories=>{
  let reads=0;
  const fetchImpl=async url=>{
    const path=new URL(url).pathname;
    if(path.startsWith('/history/'))return reply(histories[Math.min(reads++,histories.length-1)]);
    if(path==='/queue')return reply({queue_running:[],queue_pending:[]});
    return reply({});
  };
  return {comfy:createComfyClient({baseUrl:'http://127.0.0.1:8188',fetchImpl,logger:()=>{}}),reads:()=>reads};
};
const done={p1:{status:{status_str:'success',completed:true},outputs:{}}};

test('a prompt that finishes between the history and queue reads is not reported lost',async()=>{
  const {comfy,reads}=client([{},done]);
  const entry=await comfy.waitForPrompt('p1',{pollMs:1});
  assert.equal(entry.status.status_str,'success');assert.equal(reads(),2);
});

test('a prompt missing from both on two reads in a row is still reported lost',async()=>{
  const {comfy}=client([{}]);
  await assert.rejects(comfy.waitForPrompt('p1',{pollMs:1}),/lost the prompt/);
});
