import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {createDomSandbox} from '../../worker/src/comfy/dom-shim.mjs';
const source=await readFile(new URL('../../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
function fixture({enabled=false,consent=false,offline=false,outcome=false,empty=false}={}) {
  const calls=[],timers=[],evidence=[{taskId:'task-1',resultSHA256:'a'.repeat(64),feedback:'satisfied',improvement:false}];let rejectUpload=offline;
  const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,Event,TextEncoder,crypto:webcrypto,
    setInterval:fn=>{timers.push(fn);return 1;},setTimeout:()=>1,clearTimeout(){},clearInterval(){},
    NOVAFLOW_WEB_CONFIG:{localAssistant:true,localOrigin:'http://127.0.0.1:4784',controlUrl:'https://control.test',artKnowledgeEnabled:enabled},
    fetch:async(url,init)=>{const path=String(url),body=init?.body?JSON.parse(init.body):null;calls.push({path,body});
      if(path.endsWith('/consent'))return Response.json({ok:true,allowed:consent});
      if(path.endsWith('/candidates')||path.endsWith('/outcomes')){if(rejectUpload)throw Error('network unavailable');return Response.json({ok:true,accepted:true});}
      if(body?.action==='pending')return Response.json({ok:true,data:{candidates:empty?[]:[outcome?{schema:'nf.art.method-outcome.v1',key:'key',status:'candidate',appliedMethodIds:['00000000-0000-0000-0000-000000000001'],evidence:evidence[0]}:{schema:'nf.art.method-candidate.v1',key:'key',status:'candidate',method:'分析明暗块面。',scope:{skillId:'style-transfer',generationModel:'qwen-2.1',variant:'standard',brain:'*'},evidence}]}});
      return Response.json({ok:true,data:{feedback:'satisfied'}});
    }});
  sandbox.localStorage.setItem('novaflow_web_session_v1',JSON.stringify({token:'same-account-token',user:{id:'verified-account'}}));
  runInContext(source,createContext(sandbox));return {sandbox,calls,timers,evidence,setOnline:()=>{rejectUpload=false;}};
}
const settle=()=>new Promise(r=>setTimeout(r,20));
test('cloud rollout is off by default; local feedback works with no cloud writes',async()=>{
  const f=fixture();assert.equal((await f.sandbox.electronAPI.artLearning({action:'feedback',message:'满意'})).ok,true);await settle();
  assert(!f.calls.some(c=>c.path.includes('/art-knowledge')));assert.equal(f.timers.length,0);
});
test('background upload requires account consent and never sends the original feedback text',async()=>{
  const denied=fixture({enabled:true});await denied.sandbox.electronAPI.artLearning({action:'feedback',message:'PRIVATE TEXT'});await settle();
  assert(!denied.calls.some(c=>c.path.endsWith('/candidates')));
  const f=fixture({enabled:true,consent:true});await f.sandbox.electronAPI.artLearning({action:'feedback',message:'PRIVATE TEXT'});await settle();
  const sent=f.calls.find(c=>c.path.endsWith('/candidates'));assert(sent);assert(!JSON.stringify(sent).includes('PRIVATE TEXT'));
  const ack=f.calls.find(c=>c.body?.action==='ack');assert.equal(ack.body.evidenceSHA256,createHash('sha256').update(JSON.stringify(f.evidence)).digest('hex'));
  assert.equal(ack.body.accountId,'verified-account');
});
test('network failure preserves the outbox and does not fail the feedback; next background pass retries',async()=>{
  const f=fixture({enabled:true,consent:true,offline:true});
  assert.equal((await f.sandbox.electronAPI.artLearning({action:'feedback',message:'满意'})).ok,true);await settle();
  assert(!f.calls.some(c=>c.body?.action==='ack'));f.setOnline();for(const fn of f.timers)fn();await settle();assert(f.calls.some(c=>c.body?.action==='ack'));
});
test('empty outbox avoids cloud queries; published-method outcomes use their own endpoint',async()=>{
  const empty=fixture({enabled:true,consent:true,empty:true});await empty.sandbox.electronAPI.artLearning({action:'feedback',message:'满意'});await settle();
  assert(!empty.calls.some(c=>c.path.includes('/art-knowledge')));
  const f=fixture({enabled:true,consent:true,outcome:true});await f.sandbox.electronAPI.artLearning({action:'feedback',message:'PRIVATE TEXT'});await settle();
  const sent=f.calls.find(c=>c.path.endsWith('/outcomes'));assert(sent);assert(!JSON.stringify(sent).includes('PRIVATE TEXT'));assert(f.calls.some(c=>c.body?.action==='ack'));
});
