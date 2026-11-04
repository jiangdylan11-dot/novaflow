import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createXiaotaoOperationV3Prepare as create,canonicalizeXiaotaoV3TextIntent} from '../packages/shared/src/xiaotao-operation-v3-prepare.mjs';

const user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},sessionId='session';
const nonce='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const intent=()=>({mode:'chat',requestId:'request_123',message:'请帮我整理提示词',history:[{role:'user',content:'你好'}],promptLanguage:'zh-CN'});
const payload=()=>({nonce,model:'xai/grok-4.7',intent:intent()});
const provider=()=>({apiKey:'test-only',model:'xai/grok-4.7',configRevision:'1',pricingSnapshotReady:true,creditConfig:{}});
const secret=Buffer.alloc(32,7);
const call=(fn,p=payload(),current=async()=>true)=>fn({user,sessionId,payload:p,isCurrent:current});

test('shared canonicalization preserves legacy intent digest and clones the chat history',()=>{
  const input=intent(),actual=canonicalizeXiaotaoV3TextIntent(input);
  const expected=createHash('sha256').update(JSON.stringify({schema:'nf.xiaotao.operation.chat-intent.v1',intent:input})).digest('hex');
  assert.equal(actual.intentHash,expected);assert.ok(Array.isArray(actual.compiled.input));
  input.history[0].content='mutated';assert.equal(actual.intent.history[0].content,'你好');
  assert.throws(()=>canonicalizeXiaotaoV3TextIntent({...intent(),cost:0}),e=>e.code==='operation-intent-unsupported');
});

test('disabled without any provider or database access',async()=>{
  const fn=create();
  await assert.rejects(call(fn),e=>e.code==='operation-billing-disabled');
});
test('existing plain-chat intent is server-bound and durable claim precedes token return',async()=>{
  const calls=[],fn=create({enabled:true,secret,loadProvider:async()=>provider(),rpc:async(name,args)=>{
    calls.push({name,args});return {route:'v3',idempotent:false};
  }});
  const result=await call(fn);
  assert.equal(calls.length,1);assert.equal(calls[0].name,'claim_xiaotao_operation_route_v3');
  assert.equal(calls[0].args.p_operation_id,result.operationId);assert.equal(calls[0].args.p_user_id,user.id);
  assert.equal(calls[0].args.p_intent_hash,result.intentHash);assert.equal(calls[0].args.p_policy_version,result.policyVersion);
  assert.equal(calls[0].args.p_route,'v3');assert.equal(JSON.stringify(calls).includes(intent().message),false);
  assert.ok(result.token);assert.equal(JSON.stringify(result).includes(intent().message),false);
});
test('rejects extra fields, model unavailability and unsupported art or media before claim',async()=>{
  let calls=0;
  const fn=create({enabled:true,secret,loadProvider:async()=>provider(),rpc:async()=>{calls++;return {route:'v3',idempotent:false};}});
  for(const p of [
    {...payload(),userId:user.id},
    {...payload(),intent:{...intent(),cost:0}},
    {...payload(),intent:{...intent(),images:[]}},
    {...payload(),intent:{...intent(),mode:'foart'}},
    {...payload(),intent:{...intent(),history:[{role:'user',content:'x',price:0}]}},
    {...payload(),model:'openai/gpt-6.1-sol-saver'}
  ]) await assert.rejects(call(fn,p));
  assert.equal(calls,0);
});
test('same nonce and user with a changed intent conflicts at server route claim',async()=>{
  const claims=new Map(),fn=create({enabled:true,secret,loadProvider:async()=>provider(),rpc:async(name,args)=>{
    const previous=claims.get(args.p_operation_id);
    if(previous && previous!==args.p_intent_hash)throw Error('intent mismatch');
    claims.set(args.p_operation_id,args.p_intent_hash);
    return {route:'v3',idempotent:!!previous};
  }});
  const first=await call(fn),again=await call(fn);
  assert.equal(first.operationId,again.operationId);
  await assert.rejects(call(fn,{...payload(),intent:{...intent(),message:'不同操作'}}),e=>e.code==='operation-status-unknown');
});
test('revoked session, abort, and unconfirmed claim never produce a token',async()=>{
  let claims=0,checks=0;
  const fn=create({enabled:true,secret,loadProvider:async()=>provider(),rpc:async()=>{claims++;return {route:'v3',idempotent:false};}});
  await assert.rejects(call(fn,payload(),async()=>false),e=>e.code==='selection-stale');assert.equal(claims,0);
  await assert.rejects(fn({user,sessionId,payload:payload(),signal:{aborted:true},isCurrent:async()=>true}),e=>e.code==='cancelled-before-prepare');
  await assert.rejects(call(fn,payload(),async()=>++checks<3),e=>e.code==='selection-stale');assert.equal(claims,0);
  const unknown=create({enabled:true,secret,loadProvider:async()=>provider(),rpc:async()=>({})});
  await assert.rejects(call(unknown),e=>e.code==='operation-status-unknown');
});
