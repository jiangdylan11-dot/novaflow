// Synthetic browser transport only. The release switch remains false in source.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createDomSandbox} from '../../worker/src/comfy/dom-shim.mjs';

const original=readFileSync(new URL('../../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const marker='  function mimeFor(name) {';
const exportForTest='  root.__candidateTransportTest={qwenCandidatePayloadDigest,candidateGrantFor,grantFor,putTaskInput,fetchTaskOutput,cancelPromptAssistantRequest,pooledPromptRequests};\n';
assert.ok(original.includes(marker));
const id='fa047a0a-0000-8000-8000-000000000001',legacy='11111111-1111-4111-8111-111111111111';
const worker='22222222-2222-4222-8222-222222222222';
function setup({enabled=true,endpoint='https://worker.test',controlEndpoint='https://control.test',wrongNode=false,crypto=webcrypto,guard=()=>{},proofStatus=200,session=true,node=true,creationStatus=200,createdTask,onCreate,onTaskGet,onProof,onCandidateCancel,taskState}={}) {
  const requests=[],storage=new Map(),tokens={proof:'nfr_SYNTHETIC_TEST',grant:'nfg_SYNTHETIC_TEST'};let uploaded=false;
  if(node)storage.set('novaflow.web.compute.node.v1',JSON.stringify({id:worker,name:'synthetic'}));
  if(session){const token='nfs_'+Buffer.from(JSON.stringify({sub:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.SYNTHETIC';storage.set('novaflow.client.auth.session.v1',JSON.stringify({session:{token}}));}
  const task=taskId=>({id:taskId,assigned_worker_id:worker,status:uploaded?'completed':'assigned',attempt_count:1,...taskState});
  const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,AbortController,TextEncoder,TextDecoder,URL,crypto,
    location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},atob:s=>Buffer.from(s,'base64').toString('binary'),NovaFlowClientAuth:{hasPersistedSessionIdentity:()=>session},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k),key:i=>[...storage.keys()][i]??null,get length(){return storage.size}},
    NOVAFLOW_WEB_CONFIG:{localAssistant:false,controlUrl:controlEndpoint},
    fetch:async(raw,init={})=>{const path=String(raw);requests.push({path,init});
      if(path.includes('/api/web/capabilities'))return Response.json({taskTypes:[],features:{qwen35CpuTrial:true,qwen35FoartRotationCandidate:true,qwen35FoartRotationOwnerLeaseBound:true}});
      if(path.endsWith('/api/web/qwen-rotation/tasks')){onCreate?.(storage);if(creationStatus!==200)return Response.json({error:'synthetic'},{status:creationStatus});return Response.json({ok:true,task:createdTask||{id,status:'queued',attempt_count:0,assigned_worker_id:null}});}
      if(path.endsWith('/qwen-rotation-proof')){
        if(proofStatus!==200)return Response.json({error:'synthetic-private-detail'},{status:proofStatus});
        onProof?.();
        const op=JSON.parse(init.body).op;return Response.json({ok:true,proof:tokens.proof,grant:{token:tokens.grant,op,taskId:id,
          workerId:wrongNode?'33333333-3333-4333-8333-333333333333':worker,endpoint,expiresAt:new Date(Date.now()+30000).toISOString()}});
      }
      if(path.endsWith('/grant'))return Response.json({ok:true,grant:{token:tokens.grant,endpoint,expiresAt:new Date(Date.now()+30000).toISOString()}});
      if(path.endsWith('/qwen-rotation-cancel'))return onCandidateCancel?.(storage,init) || Response.json({ok:true,cancelled:true});
      if(path.endsWith('/cancel'))return Response.json({ok:true,cancelled:true});
      if(path.includes('/api/web/tasks/')){onTaskGet?.(storage);return Response.json({ok:true,task:task(path.split('/').at(-1))});}
      if(path.includes('/gw/tasks/')){if(init.method==='PUT')uploaded=true;return new Response('{"ok":true,"result":"fixture"}',{status:200});}
      throw Error('unexpected synthetic request: '+path);
    }});
  let source=original.replace(marker,exportForTest+marker);
  if(enabled)source=source.replace('const QWEN_ROTATION_CANDIDATE_RELEASE_ENABLED = false;', 'const QWEN_ROTATION_CANDIDATE_RELEASE_ENABLED = true;');
  runInContext(source,createContext(sandbox));
  return {f:sandbox.__candidateTransportTest,api:sandbox.electronAPI,requests,storage,tokens,task,opts:{candidate:true,expectedNodeId:worker,assertCurrent:guard,signal:new AbortController().signal}};
}

test('candidate upload and download use fresh scoped proofs in headers only',async()=>{
  const x=setup(),bytes=new TextEncoder().encode('{"fixture":true}');
  await x.f.putTaskInput(id,'request.json',bytes,undefined,x.opts);
  const output=await x.f.fetchTaskOutput({...x.task(id),status:'completed'},'result.json',x.opts);
  assert.match(new TextDecoder().decode(output),/fixture/);
  const proofRequests=x.requests.filter(r=>r.path.endsWith('/qwen-rotation-proof'));
  assert.deepEqual(proofRequests.map(r=>JSON.parse(r.init.body).op),['upload','download']);
  for(const call of proofRequests){assert.equal(call.init.redirect,'error');assert.equal(call.init.cache,'no-store');}
  const nodeRequests=x.requests.filter(r=>r.path.includes('/gw/tasks/'));assert.equal(nodeRequests.length,2);
  for(const call of nodeRequests){assert.equal(call.init.headers['x-novaflow-candidate-proof'],x.tokens.proof);
    assert.equal(call.init.headers['x-novaflow-grant'],x.tokens.grant);assert.equal(call.init.redirect,'error');assert.equal(call.init.credentials,'omit');
    assert.ok(!call.path.includes(x.tokens.proof));assert.ok(!call.path.includes(x.tokens.grant));}
  assert.equal([...x.storage.values()].some(v=>String(v).includes(x.tokens.proof)),false);
});
test('ordinary v4 still uses old grant/download route without candidate proof',async()=>{
  const x=setup();await x.f.putTaskInput(legacy,'request.json',new TextEncoder().encode('{}'));
  await x.f.fetchTaskOutput({...x.task(legacy),status:'completed'},'result.json');
  assert.equal(x.requests.filter(r=>r.path.endsWith('/qwen-rotation-proof')).length,0);
  const output=x.requests.find(r=>r.path.includes('/output/'));assert.ok(output.path.includes('?grant='));
  assert.equal(output.init.headers,undefined);
});
test('mismatched node, unsafe endpoint, revoked proof and stale guard never reach gateway',async()=>{
  for(const option of [{wrongNode:true},{endpoint:'http://outside.test'},{endpoint:'https://user:password@worker.test'},{proofStatus:403},{guard:()=>{throw Error('stale');}}]){
    const x=setup(option);await assert.rejects(x.f.putTaskInput(id,'request.json',new TextEncoder().encode('{}'),undefined,x.opts));
    assert.equal(x.requests.some(r=>r.path.includes('/gw/tasks/')),false);
  }
});
test('selection becomes stale after proof: no candidate bytes reach gateway',async()=>{
  let current=true;const x=setup({guard:()=>current,onProof:()=>{current=false;}});
  await assert.rejects(x.f.putTaskInput(id,'request.json',new TextEncoder().encode('{}'),undefined,x.opts));
  assert.equal(x.requests.some(r=>r.path.endsWith('/qwen-rotation-proof')),true);
  assert.equal(x.requests.some(r=>r.path.includes('/gw/tasks/')),false);
});
test('an already cancelled candidate never requests proof',async()=>{
  const x=setup(),controller=new AbortController();controller.abort();x.opts.signal=controller.signal;
  await assert.rejects(x.f.putTaskInput(id,'request.json',new TextEncoder().encode('{}'),undefined,x.opts));
  assert.equal(x.requests.some(r=>r.path.endsWith('/qwen-rotation-proof')),false);
});
test('candidate proof refuses an insecure control-plane origin',async()=>{
  const x=setup({controlEndpoint:'http://nonloopback.test'});
  await assert.rejects(x.f.candidateGrantFor(x.task(id),'upload',x.opts));
  await assert.rejects(x.f.putTaskInput(id,'request.json',new TextEncoder().encode('{}'),undefined,x.opts));
  assert.equal(x.requests.some(r=>r.path.includes('/api/web/tasks')),false);
});
test('digest covers exact UTF-8 bytes and unavailable WebCrypto fails closed',async()=>{
  const bytes=new TextEncoder().encode('{"message":"中文"}'),x=setup();
  const expected=Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  assert.equal(await x.f.qwenCandidatePayloadDigest(bytes),expected);
  await assert.rejects(setup({crypto:{randomUUID:()=>id}}).f.qwenCandidatePayloadDigest(bytes));
});
test('dedicated creation binds exact uploaded bytes without sending them to control plane',async()=>{
  const x=setup(),payload={requestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',provider:'local',modelId:'qwen3.5-9b-heretic',
    mode:'foart',foartAnimationStage:'rotation_candidate',message:'合成测试',history:[],images:[]};
  const response=await x.api.artAgentChat(payload,{isCurrent:()=>true});assert.equal(response.ok,true);
  const creation=x.requests.find(r=>r.path.endsWith('/api/web/qwen-rotation/tasks'));assert.ok(creation);
  const body=JSON.parse(creation.init.body),bytes=new TextEncoder().encode(JSON.stringify(payload));
  const digest=Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  assert.deepEqual(body,{requestId:payload.requestId,workerId:worker,sha256:digest,bytes:bytes.length});
  assert.equal(creation.init.redirect,'error');assert.equal(creation.init.cache,'no-store');
  assert.equal(creation.init.body.includes('合成测试'),false);assert.equal(x.requests.some(r=>r.path.endsWith('/api/web/tasks')&&r.init.method==='POST'),false);
  const upload=x.requests.find(r=>r.path.includes('/gw/tasks/')&&r.init.method==='PUT');assert.deepEqual([...upload.init.body],[...bytes]);
});
test('candidate creation without WebCrypto refuses before any task is created',async()=>{
  const x=setup({crypto:{randomUUID:()=>id}}),response=await x.api.artAgentChat({requestId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',provider:'local',modelId:'qwen3.5-9b-heretic',
    mode:'foart',foartAnimationStage:'rotation_candidate',message:'合成测试',history:[],images:[]},{isCurrent:()=>true});
  assert.equal(response.ok,false);assert.match(response.error,/无法验证候选请求摘要/);
  assert.equal(x.requests.some(r=>r.path.endsWith('/api/web/qwen-rotation/tasks')),false);
});
test('candidate creation refuses missing session or selected node',async()=>{
  for(const options of [{session:false},{node:false}]){const x=setup(options),response=await x.api.artAgentChat({requestId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',provider:'local',modelId:'qwen3.5-9b-heretic',
    mode:'foart',foartAnimationStage:'rotation_candidate',message:'合成测试',history:[],images:[]},{isCurrent:()=>true});
    assert.equal(response.ok,false);assert.equal(x.requests.some(r=>r.path.endsWith('/api/web/qwen-rotation/tasks')),false);}
});
test('candidate creation refuses oversized input and malformed server task before upload',async()=>{
  const requestId='ffffffff-ffff-4fff-8fff-ffffffffffff';
  for(const options of [{large:true},{createdTask:{id:legacy,status:'queued',attempt_count:0,assigned_worker_id:null}},{createdTask:{id,status:'queued',attempt_count:0}}]){
    const x=setup(options),response=await x.api.artAgentChat({requestId,provider:'local',modelId:'qwen3.5-9b-heretic',
      mode:'foart',foartAnimationStage:'rotation_candidate',message:options.large?'x'.repeat(262144):'合成测试',history:[],images:[]},{isCurrent:()=>true});
    assert.equal(response.ok,false);assert.equal(x.requests.some(r=>r.path.includes('/gw/tasks/')),false);
    if(options.large)assert.equal(x.requests.some(r=>r.path.endsWith('/api/web/qwen-rotation/tasks')),false);
  }
});
test('unknown creation result is not retried and does not upload',async()=>{
  const x=setup({creationStatus:500}),response=await x.api.artAgentChat({requestId:'ffffffff-ffff-4fff-8fff-ffffffffffff',provider:'local',modelId:'qwen3.5-9b-heretic',
    mode:'foart',foartAnimationStage:'rotation_candidate',message:'合成测试',history:[],images:[]},{isCurrent:()=>true});
  assert.equal(response.ok,false);assert.match(response.error,/结果未确认/);
  assert.equal(x.requests.filter(r=>r.path.endsWith('/api/web/qwen-rotation/tasks')).length,1);assert.equal(x.requests.some(r=>r.path.includes('/gw/tasks/')),false);
});
test('changed model guard cancels known task; changed session never uses new identity to cancel',async()=>{
  let checks=0;const x=setup(),response=await x.api.artAgentChat({requestId:'ffffffff-ffff-4fff-8fff-ffffffffffff',provider:'local',modelId:'qwen3.5-9b-heretic',
    mode:'foart',foartAnimationStage:'rotation_candidate',message:'合成测试',history:[],images:[]},{isCurrent:()=>++checks<5});
  assert.equal(response.ok,false);assert.equal(x.requests.some(r=>r.path.endsWith('/qwen-rotation-cancel')),true);assert.equal(x.requests.some(r=>r.path.includes('/gw/tasks/')),false);
  const y=setup({onCreate:storage=>storage.delete('novaflow.client.auth.session.v1')}),lost=await y.api.artAgentChat({requestId:'ffffffff-ffff-4fff-8fff-ffffffffffff',provider:'local',modelId:'qwen3.5-9b-heretic',
    mode:'foart',foartAnimationStage:'rotation_candidate',message:'合成测试',history:[],images:[]},{isCurrent:()=>true});
  assert.equal(lost.ok,false);assert.equal(y.requests.some(r=>r.path.endsWith('/qwen-rotation-cancel')),false);assert.equal(y.requests.some(r=>r.path.includes('/gw/tasks/')),false);
});

function registerCancellation(x,{candidate=true,guard=()=>true}={}) {
  const inputAbort=new AbortController();
  x.f.pooledPromptRequests.set('cancel-fixture',{taskId:id,candidate,candidateSession:guard,inputAbort});
  return inputAbort;
}
test('candidate cancellation reads and sends the actual queued or assigned attempt exactly once',async()=>{
  for(const [status,attempt] of [['queued',0],['assigned',1]]){
    const x=setup({taskState:{status,attempt_count:attempt}}),abort=registerCancellation(x);
    const result=await x.f.cancelPromptAssistantRequest({requestId:'cancel-fixture'});
    assert.equal(result.ok,true);assert.equal(result.cancelled,true);assert.equal(abort.signal.aborted,true);
    const calls=x.requests.filter(r=>r.path.includes('/api/web/tasks/'));
    assert.equal(calls.length,2);assert.equal(calls[0].init.method,'GET');assert.ok(calls[1].path.endsWith('/qwen-rotation-cancel'));
    assert.deepEqual(JSON.parse(calls[1].init.body),{attempt});
  }
});
test('candidate session change during status read prevents a cancellation under the new identity',async()=>{
  let current=true;const x=setup({onTaskGet:()=>{current=false;}});registerCancellation(x,{guard:()=>current});
  const result=await x.f.cancelPromptAssistantRequest({requestId:'cancel-fixture'});
  assert.equal(result.ok,false);assert.equal(x.requests.some(r=>r.path.endsWith('/qwen-rotation-cancel')),false);
});
test('completed candidate is terminal but not reported cancelled',async()=>{
  const x=setup({taskState:{status:'completed'}});registerCancellation(x);
  const result=await x.f.cancelPromptAssistantRequest({requestId:'cancel-fixture'});
  assert.equal(result.ok,true);assert.equal(result.cancelled,false);assert.equal(result.terminal,true);
  assert.equal(x.requests.some(r=>r.path.endsWith('/qwen-rotation-cancel')),false);
});
test('candidate attempt race is not reported as cancelled or retried',async()=>{
  const x=setup({taskState:{status:'queued',attempt_count:0},onCandidateCancel:()=>Response.json({ok:false,error:'attempt changed'},{status:409})});registerCancellation(x);
  const result=await x.f.cancelPromptAssistantRequest({requestId:'cancel-fixture'});
  assert.equal(result.ok,false);const calls=x.requests.filter(r=>r.path.endsWith('/qwen-rotation-cancel'));
  assert.equal(calls.length,1);assert.deepEqual(JSON.parse(calls[0].init.body),{attempt:0});
});
test('session change during candidate cancellation does not claim confirmed success',async()=>{
  let current=true;const x=setup({onCandidateCancel:()=>{current=false;return Response.json({ok:true,cancelled:true});}});
  registerCancellation(x,{guard:()=>current});
  const result=await x.f.cancelPromptAssistantRequest({requestId:'cancel-fixture'});
  assert.equal(result.ok,false);assert.equal(x.requests.filter(r=>r.path.endsWith('/qwen-rotation-cancel')).length,1);
});
test('ordinary v4 cancellation keeps its old endpoint and does not query candidate state',async()=>{
  const x=setup();registerCancellation(x,{candidate:false});
  const result=await x.f.cancelPromptAssistantRequest({requestId:'cancel-fixture'});
  assert.equal(result.ok,true);assert.equal(result.cancelled,true);
  const calls=x.requests.filter(r=>r.path.includes('/api/web/tasks/'));assert.equal(calls.length,1);assert.ok(calls[0].path.endsWith('/cancel'));
  assert.equal(calls[0].path.endsWith('/qwen-rotation-cancel'),false);
});
