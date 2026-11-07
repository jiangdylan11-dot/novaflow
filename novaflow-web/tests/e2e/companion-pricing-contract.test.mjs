import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanionChat} from '../../packages/shared/src/companion-chat.mjs';
import {createControlPlane} from '../../packages/shared/src/control-plane.mjs';
import {createCompanionPricingContext} from '../../packages/shared/src/companion-pricing-context.mjs';
import {companionPricingPolicy} from '../../packages/shared/src/companion-pricing.mjs';
import {createHmac} from 'node:crypto';

const payload={requestId:'pricing-contract-1',mode:'chat',promptLanguage:'en',message:'Hello',history:[]};
const provider={apiKey:'private-key-do-not-expose',baseUrl:'https://private-provider.example/v1',model:'xai/grok-4.7',configRevision:'1',pricingSnapshotReady:true,
  creditConfig:{credits_per_usd:123,token_billing:{round:'floor',min_credits_per_image:2},xiaotao_online:{markup:1.3,message_cap_credits:37,enabled_models:['openai/gpt-6.1-sol-saver']}}};
function fixture(overrides={}) {
  const calls=[];
  const instance=createCompanionChat({provider:{...provider,...overrides},charge:async args=>{calls.push(['reserve',args.estimatedCredits]);const result=await args.run();return {...result,quota:{settled_credits:result.settledCredits}};},
    fetchImpl:async(_url,init)=>{const model=JSON.parse(init.body).model;calls.push(['provider',model]);return Response.json({model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14,prompt_tokens_details:{cached_tokens:0}}});}});
  return {instance,calls};
}
test('public snapshot exposes the actual normalized quote settings, never credentials or endpoint',async()=>{
  const policy=await fixture().instance.pricing();
  assert.match(policy.version,/^sha256:[a-f0-9]{64}$/);assert.ok(policy.expiresAt>Date.now());
  assert.equal(policy.config.credits_per_usd,123);assert.equal(policy.config.token_billing.round,'floor');
  assert.equal(policy.config.token_billing.min_credits_per_image,2);assert.equal(policy.config.xiaotao_online.message_cap_credits,37);
  assert.equal(policy.config.xiaotao_online.output_tokens,2048);
  assert.equal(policy.models.find(m=>m.id==='openai/gpt-6.1-sol-saver').available,true);
  assert.equal(policy.models.find(m=>m.id==='deepseek/deepseek-v4.1-flash').available,false);
  assert.doesNotMatch(JSON.stringify(policy),/private-key-do-not-expose|private-provider\.example/);
});
test('deployment revision changes the pricing version even with identical settings',async()=>{
 const a=await companionPricingPolicy(provider,{revision:'test-a'}),b=await companionPricingPolicy(provider,{revision:'test-b'});
 assert.notEqual(a.version,b.version);
});
test('quote and charge use matching request, version and estimate; no provider call before charge',async()=>{
  const {instance,calls}=fixture();const request={...payload,modelId:'openai/gpt-6.1-sol-saver'};
  const quote=await instance.quote({user:{id:'u'},payload:request});assert.deepEqual(calls,[]);
  await instance.reply({user:{id:'u'},payload:{...request,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}});
  assert.deepEqual(calls,[['reserve',quote.estimatedCredits],['provider',request.modelId]]);
});
test('changed pricing, capability or content fail before reserve; missing version cannot use new routes',async()=>{
  const original=fixture();const request={...payload,modelId:'openai/gpt-6.1-sol-saver'};
  const quote=await original.instance.quote({payload:request});
  const binding={pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint};
  const rateChanged=fixture({creditConfig:{...provider.creditConfig,credits_per_usd:124}});
  await assert.rejects(rateChanged.instance.reply({user:{id:'u'},payload:{...request,...binding}}),e=>/重新报价/.test(e.message) && /未调用模型/.test(e.message) && !/核对/.test(e.message) && !/本次未扣积分/.test(e.message));assert.deepEqual(rateChanged.calls,[]);
  const providerChanged=fixture({configRevision:'2'});
  await assert.rejects(providerChanged.instance.reply({user:{id:'u'},payload:{...request,...binding}}),/重新报价/);assert.deepEqual(providerChanged.calls,[]);
  const noProviderRevision=fixture({configRevision:null});assert.ok((await noProviderRevision.instance.pricing()).models.every(model=>!model.available));
  await assert.rejects(noProviderRevision.instance.quote({payload:request}),/尚未开通|无法安全报价/);assert.deepEqual(noProviderRevision.calls,[]);
  await assert.rejects(original.instance.reply({user:{id:'u'},payload:{...request,message:'changed',...binding}}),/重新报价/);assert.deepEqual(original.calls,[]);
  await assert.rejects(original.instance.reply({user:{id:'u'},payload:request}),/重新报价/);assert.deepEqual(original.calls,[]);
  const closed=fixture({pricingSnapshotReady:false});await assert.rejects(closed.instance.quote({payload:request}),/尚未同步/);assert.deepEqual(closed.calls,[]);
});
test('pricing and quote endpoints require a user session before accessing the companion',async()=>{
 let calls=0;
 const plane=createControlPlane({store:{getUserById:async()=>null,getUserSession:async()=>null},secrets:{sessionSecret:'fixture-only'},
  companion:{pricing:async()=>{calls++;},quote:async()=>{calls++;}}});
 assert.equal((await plane.handle({method:'GET',path:'/api/web/companion/pricing',headers:{}})).status,401);
 assert.equal((await plane.handle({method:'POST',path:'/api/web/companion/quote',headers:{},body:payload})).status,401);
 assert.equal(calls,0);
});
test('authenticated pricing route sends safe policy and reports stale quote with stable code',async()=>{
 const {instance,calls}=fixture();const store={getUserById:async()=>({id:'u',status:'active'}),getUserSession:async()=>({id:'s',user_id:'u',revoked_at:null})};
 const plane=createControlPlane({store,secrets:{sessionSecret:'fixture-secret'},companion:instance});
 const encoded=Buffer.from(JSON.stringify({sub:'u',sid:'s',exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
 const token='nfs_'+encoded+'.'+createHmac('sha256','fixture-secret').update(encoded).digest('base64url');const headers={authorization:'Bearer '+token};
 const response=await plane.handle({method:'GET',path:'/api/web/companion/pricing',headers});assert.equal(response.status,200);assert.ok(response.body.policy.version);
 const body={...payload,modelId:'openai/gpt-6.1-sol-saver'};const quoted=await plane.handle({method:'POST',path:'/api/web/companion/quote',headers,body});assert.equal(quoted.status,200);
 const q=quoted.body.quote;const stale=await plane.handle({method:'POST',path:'/api/web/companion/chat',headers,body:{...body,message:'changed',pricingVersion:q.pricingVersion,quoteFingerprint:q.quoteFingerprint}});
 assert.equal(stale.status,409);assert.equal(stale.body.code,'companion-pricing-changed');assert.deepEqual(calls,[]);
});
test('versioned path uses DB cap and exact server snapshot through v2 reserve and settle',async()=>{
 const raw={credits_per_usd:170,token_billing:{round:'floor'},xiaotao_online:{message_cap_credits:25,markup:1.2}};
 const dbSnapshot={protocol:'xiaotao-pricing-v2',config:raw,message_cap_credits:25};let stored,providerCalls=0;
 const rpc=async(name,args)=>{
  if(name==='reserve_xiaotao_credits_v2'){
   assert.deepEqual(args.p_expected_config,raw);assert.equal(args.p_expected_cap,25);assert.match(args.p_policy_version,/^sha256:/);assert.equal(args.p_model,'openai/gpt-6.1-sol-saver');
   assert.equal(args.p_metadata.pricing_version,args.p_policy_version);assert.equal(args.p_metadata.pricing_policy.credits_per_usd,170);
   stored={cap:25,hold:args.p_estimated_credits};return {status:'reserved',units:1,estimated_credits:stored.hold,message_cap_credits:25,policy_version:args.p_policy_version};
  }
  if(name==='settle_xiaotao_credits_v2'){assert.ok(stored);return {status:'settled',settled_credits:Math.min(stored.cap,args.p_settled_credits)};}
  assert.fail('unexpected RPC '+name);
 };
 const service=await createCompanionPricingContext({provider,dbSnapshot,envOnline:{enabled_models:['openai/gpt-6.1-sol-saver'],message_cap_credits:999},rpc,
    legacyCharge:async()=>assert.fail('versioned path must use v2'),fetchImpl:async()=>{providerCalls++;return Response.json({model:'openai/gpt-6.1-sol-saver',choices:[{finish_reason:'stop',message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:1000,completion_tokens:50,prompt_tokens_details:{cached_tokens:0}}});}});
 const policy=await service.pricing();assert.equal(policy.config.credits_per_usd,170);assert.equal(policy.config.xiaotao_online.message_cap_credits,25);
 const body={...payload,modelId:'openai/gpt-6.1-sol-saver'};const quote=await service.quote({payload:body});
 const result=await service.reply({user:{id:'u'},payload:{...body,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}});
 assert.equal(stored.hold,quote.estimatedCredits);assert.equal(providerCalls,1);assert.equal(result.quota.status,'settled');
});
test('database config change during reserve fails before upstream and database v2 absence fails closed',async()=>{
 let calls=0;const snapshot={protocol:'xiaotao-pricing-v2',config:{xiaotao_online:{message_cap_credits:80}},message_cap_credits:80};
 const rpc=async(name)=>{if(name==='reserve_xiaotao_credits_v2')throw Error('xiaotao pricing changed; obtain a new quote');assert.fail('unexpected '+name);};
 const options={provider,dbSnapshot:snapshot,envOnline:{enabled_models:['openai/gpt-6.1-sol-saver']},rpc,legacyCharge:async()=>assert.fail('legacy'),fetchImpl:async()=>{calls++;}};
 const service=await createCompanionPricingContext(options);const body={...payload,modelId:'openai/gpt-6.1-sol-saver'};const quote=await service.quote({payload:body});
 await assert.rejects(service.reply({user:{id:'u'},payload:{...body,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}}),e=>e.status===409 && /未调用模型/.test(e.message) && !/核对/.test(e.message) && !/本次未扣积分/.test(e.message));
 assert.equal(calls,0);
 const closed=await createCompanionPricingContext({...options,dbSnapshot:null});
 assert.ok((await closed.pricing()).models.every(model=>!model.available));
 await assert.rejects(closed.quote({payload:body}),/尚未同步/);assert.equal(calls,0);
});
test('unexpected v2 reservation terms are released and never reach provider',async()=>{
 let calls=0,released=0;
 const snapshot={protocol:'xiaotao-pricing-v2',config:{xiaotao_online:{message_cap_credits:80}},message_cap_credits:80};
 const rpc=async(name,args)=>{if(name==='reserve_xiaotao_credits_v2')return {status:'reserved',units:1,estimated_credits:args.p_estimated_credits,message_cap_credits:79,policy_version:args.p_policy_version};
  if(name==='release_feature_credits'){released++;return {status:'released'};}assert.fail('unexpected '+name);};
 const service=await createCompanionPricingContext({provider,dbSnapshot:snapshot,envOnline:{enabled_models:['openai/gpt-6.1-sol-saver']},rpc,fetchImpl:async()=>{calls++;}});
 const body={...payload,modelId:'openai/gpt-6.1-sol-saver'};const quote=await service.quote({payload:body});
 await assert.rejects(service.reply({user:{id:'u'},payload:{...body,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}}),e=>e.status===409);
 assert.equal(calls,0);assert.equal(released,1);
});
test('uncertain reserve or failed release never reaches provider and never claims refund',async()=>{
 for(const scenario of ['reserve-timeout','release-failed']){
  let calls=0;const snapshot={protocol:'xiaotao-pricing-v2',config:{xiaotao_online:{message_cap_credits:80}},message_cap_credits:80};
  const rpc=async(name,args)=>{if(name==='reserve_xiaotao_credits_v2'){
    if(scenario==='reserve-timeout')throw Error('transport timeout');
    return {status:'reserved',units:1,estimated_credits:args.p_estimated_credits,message_cap_credits:79,policy_version:args.p_policy_version};
   }if(name==='release_feature_credits')throw Error('transport timeout');assert.fail('unexpected '+name);};
  const service=await createCompanionPricingContext({provider,dbSnapshot:snapshot,envOnline:{enabled_models:['openai/gpt-6.1-sol-saver']},rpc,fetchImpl:async()=>{calls++;}});
  const body={...payload,modelId:'openai/gpt-6.1-sol-saver'};const quote=await service.quote({payload:body});
  await assert.rejects(service.reply({user:{id:'u'},payload:{...body,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}}),
   e=>e.status===503 && /未调用模型/.test(e.message) && !/未扣积分/.test(e.message) && /待核对|未确认/.test(e.message));
  assert.equal(calls,0);
 }
});
test('a definite database insufficient-balance rollback remains actionable and does not invoke provider',async()=>{
 let calls=0;const snapshot={protocol:'xiaotao-pricing-v2',config:{xiaotao_online:{message_cap_credits:80}},message_cap_credits:80};
 const rpc=async(name)=>{if(name==='reserve_xiaotao_credits_v2')throw Object.assign(new Error('积分不足'),{code:'P0001'});assert.fail('unexpected '+name);};
 const service=await createCompanionPricingContext({provider,dbSnapshot:snapshot,envOnline:{enabled_models:['openai/gpt-6.1-sol-saver']},rpc,fetchImpl:async()=>{calls++;}});
 const body={...payload,modelId:'openai/gpt-6.1-sol-saver'};const quote=await service.quote({payload:body});
 await assert.rejects(service.reply({user:{id:'u'},payload:{...body,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}}),e=>e.status===402 && /积分不足/.test(e.message));
 assert.equal(calls,0);
});
test('after provider request, uncertain settlement or release is reported without a second release',async()=>{
 for(const scenario of ['settle-timeout','provider-fails-release-timeout']){
  let calls=0,releases=0;
  const snapshot={protocol:'xiaotao-pricing-v2',config:{xiaotao_online:{message_cap_credits:80}},message_cap_credits:80};
  const rpc=async(name,args)=>{
   if(name==='reserve_xiaotao_credits_v2')return {status:'reserved',units:1,estimated_credits:args.p_estimated_credits,message_cap_credits:80,policy_version:args.p_policy_version};
   if(name==='settle_xiaotao_credits_v2')throw Error('transport timeout');
   if(name==='release_feature_credits'){releases++;throw Error('transport timeout');}
   assert.fail('unexpected '+name);
  };
  const service=await createCompanionPricingContext({provider,dbSnapshot:snapshot,envOnline:{enabled_models:['openai/gpt-6.1-sol-saver']},rpc,fetchImpl:async()=>{
   calls++;if(scenario==='provider-fails-release-timeout')return new Response('failure',{status:502});
     return Response.json({model:'openai/gpt-6.1-sol-saver',choices:[{finish_reason:'stop',message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:100,completion_tokens:4,prompt_tokens_details:{cached_tokens:0}}});
  }});
  const body={...payload,modelId:'openai/gpt-6.1-sol-saver'};const quote=await service.quote({payload:body});
  await assert.rejects(service.reply({user:{id:'u'},payload:{...body,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}}),
   e=>e.status===503 && !/未扣积分/.test(e.message) && /待核对|未确认/.test(e.message));
  assert.equal(calls,1);assert.equal(releases,scenario==='settle-timeout'?0:1);
 }
});
