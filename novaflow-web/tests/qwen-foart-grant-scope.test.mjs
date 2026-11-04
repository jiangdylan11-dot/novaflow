import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64UrlJson, hmacSha256, issueGrantToken, verifyGrantToken
} from '../packages/shared/src/tokens.mjs';

const key = 'synthetic-test-key';
const base = {userId:'test-user',taskId:'test-task',workerId:'test-worker',op:'upload',ttlSeconds:60};
const expected = {taskId:base.taskId,workerId:base.workerId,op:base.op};

async function signSynthetic(payload) {
  const encoded=base64UrlJson(payload);
  return 'nfg_'+encoded+'.'+await hmacSha256(encoded,key);
}

test('legacy grant retains its original payload and verification contract',async()=>{
  const token=await issueGrantToken({...base,attempt:9},key);
  const payload=await verifyGrantToken(token,key,expected);
  assert.deepEqual(Object.keys(payload).sort(),['exp','iat','kind','nonce','op','sub','task','wid'].sort());
  assert.equal(payload.sub,base.userId);
  assert.equal(payload.scope,undefined);
  assert.equal(payload.attempt,undefined);
  await assert.rejects(verifyGrantToken(token,key,{...expected,workerId:'other-worker'}));
  await assert.rejects(verifyGrantToken(token,key,{...expected,op:'download'}));
});

test('scoped grant binds a valid numeric attempt without exposing a session',async()=>{
  for(const attempt of [1,20]){
    const token=await issueGrantToken({...base,scope:'qwen-foart-plan-v1',attempt,sessionId:'not-in-token'},key);
    const payload=await verifyGrantToken(token,key,expected);
    assert.equal(payload.scope,'qwen-foart-plan-v1');
    assert.equal(payload.attempt,attempt);
    assert.equal(payload.sid,undefined);
    assert.equal(payload.sessionId,undefined);
    assert.equal(payload.sub,base.userId);
  }
});

test('unknown scope and invalid scoped attempts are rejected at issue and verify',async()=>{
  for(const attempt of [undefined,null,0,-1,21,1.5,'1',NaN]){
    await assert.rejects(issueGrantToken({...base,scope:'qwen-foart-plan-v1',attempt},key));
    const signed=await signSynthetic({kind:'grant',sub:'test-user',task:'test-task',wid:'test-worker',op:'upload',
      exp:Math.floor(Date.now()/1000)+60,scope:'qwen-foart-plan-v1',attempt});
    await assert.rejects(verifyGrantToken(signed,key,expected));
  }
  for(const scope of ['',null,'other','QWEN-FOART-PLAN-V1']){
    await assert.rejects(issueGrantToken({...base,scope,attempt:1},key));
    const signed=await signSynthetic({kind:'grant',sub:'test-user',task:'test-task',wid:'test-worker',op:'upload',
      exp:Math.floor(Date.now()/1000)+60,scope,attempt:1});
    await assert.rejects(verifyGrantToken(signed,key,expected));
  }
});

test('signed scoped fields cannot be altered or used with another worker or operation',async()=>{
  const token=await issueGrantToken({...base,scope:'qwen-foart-plan-v1',attempt:1},key);
  const [body,signature]=token.slice(4).split('.');
  const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  payload.attempt=2;
  const forged='nfg_'+base64UrlJson(payload)+'.'+signature;
  await assert.rejects(verifyGrantToken(forged,key,expected));
  await assert.rejects(verifyGrantToken(token,'other-key',expected));
  await assert.rejects(verifyGrantToken(token,key,{...expected,workerId:'other-worker'}));
  await assert.rejects(verifyGrantToken(token,key,{...expected,op:'download'}));
});
