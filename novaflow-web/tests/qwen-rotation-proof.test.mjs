import test from 'node:test';
import assert from 'node:assert/strict';
import {base64UrlJson,deriveWorkerGrantKey,hmacSha256,issueQwenRotationProof,
  verifyQwenRotationProofSignature} from '../packages/shared/src/tokens.mjs';

const secret='synthetic-control-secret-for-tests-only';
const identity={taskId:'fa047a0a-1111-8111-8111-111111111111',
  workerId:'11111111-1111-4111-8111-111111111111',
  userId:'22222222-2222-4222-8222-222222222222',
  sessionId:'33333333-3333-4333-8333-333333333333',attempt:1,op:'upload'};
const now=()=>Math.floor(Date.now()/1000);
const issue=(extra={})=>issueQwenRotationProof({...identity,sessionExpiresAt:now()+600,...extra},secret);
async function signed(payload,key) {
  const encoded=base64UrlJson(payload);
  return `nfr_${encoded}.${await hmacSha256(encoded,key)}`;
}

test('short proof binds actor and never outlives the verified session expiry',async()=>{
  const sessionExpiresAt=now()+15;
  const proof=await issue({sessionExpiresAt});
  const p=await verifyQwenRotationProofSignature(proof,secret);
  assert.deepEqual({taskId:p.task,workerId:p.wid,userId:p.sub,sessionId:p.sid,attempt:p.attempt,op:p.op},identity);
  assert.ok(p.exp<=sessionExpiresAt && p.exp-p.iat<=60);
});

test('node-held grant key cannot forge a control-plane proof or reuse an altered identity',async()=>{
  const proof=await issue(),p=await verifyQwenRotationProofSignature(proof,secret);
  const nodeKey=await deriveWorkerGrantKey(identity.workerId,secret);
  await assert.rejects(verifyQwenRotationProofSignature(await signed({...p,sub:'44444444-4444-4444-8444-444444444444'},nodeKey),secret));
  await assert.rejects(verifyQwenRotationProofSignature(await signed({...p,op:'download'},nodeKey),secret));
  await assert.rejects(verifyQwenRotationProofSignature(proof.replace(/^nfr_/,'nfg_'),secret));
});

test('invalid task, actor, attempt, operation, secret and expired sessions fail closed',async()=>{
  for(const extra of [{taskId:'11111111-1111-4111-8111-111111111111'},
    {taskId:identity.taskId.toUpperCase()},{sessionId:''},{workerId:'not-uuid'},
    {attempt:0},{attempt:1.1},{op:'execute'},{sessionExpiresAt:now()-1}]) {
    await assert.rejects(issue(extra));
  }
  await assert.rejects(issueQwenRotationProof({...identity,sessionExpiresAt:now()+30},''));
  await assert.rejects(verifyQwenRotationProofSignature('nfr_'+ 'a'.repeat(8193),secret));
});

test('signed malformed, expired, future-issued or overlong proofs are rejected',async()=>{
  const proof=await issue(),p=await verifyQwenRotationProofSignature(proof,secret);
  const proofKey=await hmacSha256('novaflow-web-qwen-rotation-proof:v1',secret);
  const current=now();
  for(const patch of [{exp:'not-a-number'},{iat:current-20,exp:current-1},
    {iat:current+5,exp:current+10},{iat:current,exp:current+61},{attempt:0},
    {scope:'qwen-readonly'},{aud:'another-service'},
    {task:'11111111-1111-4111-8111-111111111111'}]) {
    await assert.rejects(verifyQwenRotationProofSignature(await signed({...p,...patch},proofKey),secret));
  }
});
