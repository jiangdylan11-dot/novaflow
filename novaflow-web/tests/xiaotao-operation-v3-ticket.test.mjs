import test from 'node:test';
import assert from 'node:assert/strict';
import {createXiaotaoOperationV3Tickets as create} from '../packages/shared/src/xiaotao-operation-v3-ticket.mjs';

const secret=Buffer.alloc(32,7), actor={userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId:'session-a'};
const nonce='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',model='xai/grok-4.7',policyVersion='sha256:'+'c'.repeat(64),intentHash='d'.repeat(64);
const terms={actor,nonce,model,policyVersion,intentHash};
test('operation tickets remain disabled without explicit server opt-in',async()=>{
  const t=create();await assert.rejects(t.issue(terms),e=>e.code==='operation-billing-disabled');
});
test('server ticket binds actor, model, policy and digest without prompt content',async()=>{
  const t=create({enabled:true,secret,isCurrent:async()=>true,now:()=>1000});
  const one=await t.issue(terms),again=await t.issue(terms);
  assert.equal(one.operationId,again.operationId);assert.equal(one.token,again.token);
  const decoded=await t.verify({...terms,token:one.token});assert.equal(decoded.operationId,one.operationId);
  assert.equal(decoded.policyVersion,policyVersion);assert.equal(decoded.intentHash,intentHash);
  await assert.rejects(t.verify({...terms,actor:{...actor,sessionId:'other'},token:one.token}));
  await assert.rejects(t.verify({...terms,actor:{...actor,userId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},token:one.token}));
  await assert.rejects(t.verify({...terms,policyVersion:'sha256:'+'e'.repeat(64),token:one.token}));
  await assert.rejects(t.verify({...terms,intentHash:'e'.repeat(64),token:one.token}));
  await assert.rejects(t.verify({...terms,model:'openai/gpt-6.1-sol-saver',token:one.token}));
  const parts=one.token.split('.');parts[0]=parts[0].slice(0,-1)+(parts[0].endsWith('a')?'b':'a');
  await assert.rejects(t.verify({...terms,token:parts.join('.')}));
});
test('nonce identity cannot be reused across users and ticket expires',async()=>{
  let now=1000;const t=create({enabled:true,secret,isCurrent:async()=>true,now:()=>now});
  const one=await t.issue({...terms,ttlMs:10}),two=await t.issue({...terms,actor:{...actor,userId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}});
  assert.notEqual(one.operationId,two.operationId);now=1010;
  await assert.rejects(t.verify({...terms,token:one.token}),e=>e.code==='invalid-operation-ticket');
  assert.equal((await t.verify({...terms,token:one.token,allowExpiredForCancellation:true})).operationId,one.operationId);
  await assert.rejects(t.verify({...terms,actor:{...actor,sessionId:'other'},token:one.token,allowExpiredForCancellation:true}));
});
test('same nonce with a changed intent keeps the operation identity for database conflict detection',async()=>{
  const t=create({enabled:true,secret,isCurrent:async()=>true,now:()=>1000});
  const one=await t.issue(terms),changed=await t.issue({...terms,intentHash:'e'.repeat(64)});
  assert.equal(one.operationId,changed.operationId);
  assert.notEqual(one.token,changed.token);
});
test('session revocation and unsupported model fail closed',async()=>{
  let live=true;const t=create({enabled:true,secret,isCurrent:async()=>live,now:()=>1000});
  const one=await t.issue(terms);live=false;
  await assert.rejects(t.verify({...terms,token:one.token}),e=>e.code==='selection-stale');
  await assert.rejects(t.issue({...terms,model:'unknown/model'}));
});
test('DeepSeek ticket is bound to the exact model and policy',async()=>{
  const t=create({enabled:true,secret,isCurrent:async()=>true,now:()=>1000});
  const ds={...terms,model:'deepseek/deepseek-v4.1-flash'};
  const issued=await t.issue(ds);
  assert.equal((await t.verify({...ds,token:issued.token})).operationId,issued.operationId);
  await assert.rejects(t.verify({...ds,model:'xai/grok-4.7',token:issued.token}));
});
