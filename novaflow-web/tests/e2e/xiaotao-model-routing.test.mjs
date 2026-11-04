import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanionChat} from '../../packages/shared/src/companion-chat.mjs';

const payload = {requestId:'model-choice-123', mode:'chat', promptLanguage:'en', message:'Hello', history:[]};
const makeService = model => {
  const calls = [];
  const service = createCompanionChat({
    provider:{apiKey:'fixture', baseUrl:'https://provider.test/v1', model},
    charge:async args => {calls.push('charge'); const result=await args.run(); return {...result,quota:{settled_credits:result.settledCredits}};},
    fetchImpl:async (_url,init) => {calls.push(JSON.parse(init.body).model); return Response.json({model:'xai/grok-4.7',choices:[{finish_reason:'stop',message:{role:'assistant',content:'Hello'}}],usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14}});}
  });
  return {service,calls};
};

test('explicit Grok selection uses only matching configured model',async () => {
  const {service,calls}=makeService('xai/grok-4.7');
  await service.reply({user:{id:'u'},payload:{...payload,modelId:'xai/grok-4.7'}});
  assert.deepEqual(calls,['charge','xai/grok-4.7']);
});

test('unavailable selection or changed server model fails before reserve and inference',async () => {
  for (const [configured,selected] of [
    ['xai/grok-4.7','deepseek/deepseek-v4.1-flash'],
    ['xai/grok-4.7','bytedance/doubao-seed-2.1-lite'],
    ['xai/grok-4.7','openai/gpt-6.1'],
    ['xai/grok-4.6','xai/grok-4.7']
  ]) {
    const {service,calls}=makeService(configured);
    await assert.rejects(service.reply({user:{id:'u'},payload:{...payload,modelId:selected}}),/未扣积分/);
    assert.deepEqual(calls,[]);
  }
});

test('audio and video metadata are rejected before reserve and inference',async () => {
  for (const kind of ['audio','video']) {
    const {service,calls}=makeService('xai/grok-4.7');
    await assert.rejects(service.reply({user:{id:'u'},payload:{...payload,modelId:'xai/grok-4.7',uploads:[{kind,name:'sample'}]}}),/暂不支持分析音频或视频/);
    assert.deepEqual(calls,[]);
  }
});


test('unexpected returned model releases reservation without settling',async () => {
  let settled=0,released=0;
  const {createOnlineAiCharge}=await import('../../packages/shared/src/online-ai-charge.mjs');
  const charge=createOnlineAiCharge({reserve:async()=>({status:'reserved',idempotent:false,amount:1}),settle:async()=>settled++,release:async()=>released++});
  const service=createCompanionChat({provider:{apiKey:'fixture',baseUrl:'https://provider.test/v1',model:'xai/grok-4.7'},charge,
    fetchImpl:async()=>Response.json({model:'unexpected-model',choices:[{finish_reason:'stop',message:{role:'assistant',content:'Hello'}}],usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14}})});
  await assert.rejects(service.reply({user:{id:'u'},payload:{...payload,modelId:'xai/grok-4.7'}}),/模型与所选模型不一致/);
  assert.equal(settled,0);assert.equal(released,1);
});


test('legacy text and image metadata remain accepted without an explicit selection',async () => {
  for (const uploads of [[],[{kind:'image',name:'reference.png'}]]) {
    const {service,calls}=makeService('xai/grok-4.7');
    await service.reply({user:{id:'u'},payload:{...payload,uploads}});
    assert.deepEqual(calls,['charge','xai/grok-4.7']);
  }
});
