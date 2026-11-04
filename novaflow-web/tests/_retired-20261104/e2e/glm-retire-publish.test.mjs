import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanionChat} from '../../packages/shared/src/companion-chat.mjs';
import {settleXiaotaoOnlineCredits} from '../../packages/shared/src/feature-credits.mjs';
import {hasXiaotaoModelRate} from '../../packages/shared/src/xiaotao-model-rates.mjs';

const GLM='glm/glm-5.3-flash', GROK='xai/grok-4.7', GPT='openai/gpt-6.1-sol-saver';
const payload={requestId:'retire-mock-1',mode:'chat',promptLanguage:'zh-CN',message:'测试',history:[]};
const provider={apiKey:'fake-test-only',baseUrl:'https://llm.runninghub.ai/v1',model:GROK,configRevision:'1',pricingSnapshotReady:true,
 creditConfig:{credits_per_usd:211,xiaotao_online:{markup:1.5,message_cap_credits:80,enabled_models:[GLM,GPT]}}};
function harness({factory=createCompanionChat,model=GROK,fetchImpl}={}){
 const calls=[];
 const instance=factory({provider:{...provider,model},charge:async args=>{
  calls.push('reserve');const value=await args.run();calls.push('settle');return {...value,quota:{status:'settled',settled_credits:value.settledCredits}};
 },fetchImpl:fetchImpl|| (async(_url,init)=>{calls.push('fetch');const id=JSON.parse(init.body).model;return Response.json({model:id,choices:[{finish_reason:'stop',message:{role:'assistant',content:'好'}}],usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14}});})});
 return {instance,calls};
}
const retired=e=>e.code==='companion-model-retired'&&e.status===503&&/核对积分状态/.test(e.message);

test('published policy never enables retired GLM, even when the config enables it',async()=>{
 const {instance}=harness();const policy=await instance.pricing();
 assert.equal(policy.models.find(x=>x.id===GLM).available,false);
 assert.equal(policy.models.find(x=>x.id===GROK).available,true);
 assert.equal(policy.models.find(x=>x.id===GPT).available,true);
});
test('explicit GLM quote and reply fail before reservation and provider',async()=>{
 const {instance,calls}=harness();const body={...payload,modelId:GLM};
 await assert.rejects(instance.quote({payload:body}),retired);
 await assert.rejects(instance.reply({user:{id:'u'},payload:body}),retired);
 assert.deepEqual(calls,[]);
});
test('legacy request without model ID rejects an old GLM default',async()=>{
 const {instance,calls}=harness({model:GLM});const policy=await instance.pricing();
 assert.equal(policy.models.find(x=>x.id==='legacy-online').available,false);
 await assert.rejects(instance.quote({payload}),retired);
 await assert.rejects(instance.reply({user:{id:'u'},payload}),retired);
 assert.deepEqual(calls,[]);
});
test('Grok and GPT retain priced mock request flow',async()=>{
 for(const id of [GROK,GPT]){
  const {instance,calls}=harness();const body={...payload,requestId:id===GROK?'mock-grok':'mock-gpt',modelId:id};
  const quote=await instance.quote({payload:body});
  const response=await instance.reply({user:{id:'u'},payload:{...body,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}});
  assert.equal(response.model,id);assert.equal(response.quota.status,'settled');assert.deepEqual(calls,['reserve','fetch','settle']);
 }
});
test('historical GLM rate remains available for settlement',()=>{
 assert.equal(hasXiaotaoModelRate(GLM),true);
 const result=settleXiaotaoOnlineCredits({model:GLM,usage:{prompt_tokens:1000,completion_tokens:500,total_tokens:1500},reservedCredits:2,config:provider.creditConfig});
 assert.ok(Number.isSafeInteger(result.credits));assert.ok(result.credits>=0);assert.equal(result.pricingSource,'token_rate_estimate');
});
