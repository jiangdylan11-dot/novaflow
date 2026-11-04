import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanionPricingContext} from '../packages/shared/src/companion-pricing-context.mjs';
import {companionPricingPolicy} from '../packages/shared/src/companion-pricing.mjs';

const provider={apiKey:'synthetic',model:'xai/grok-4.7',configRevision:'1'};
const dbSnapshot={protocol:'xiaotao-pricing-v2',config:{xiaotao_online:{message_cap_credits:80}},message_cap_credits:80};
const rpc=async name=>{if(name==='get_xiaotao_operation_v3_gate_state')return {enforced:true};throw Error('unexpected RPC');};
const prepareXiaotaoOperationV3=async request=>({id:request.user.id});
const executeXiaotaoOperationV3=async()=>({reply:'synthetic'});
test('v3 handlers require both explicit trusted opt-in and ready pricing snapshot',async()=>{
  for(const [snapshot,operationV3] of [
    [dbSnapshot,undefined],
    [dbSnapshot,{enabled:false,prepareXiaotaoOperationV3,executeXiaotaoOperationV3}],
    [dbSnapshot,{enabled:true,prepareXiaotaoOperationV3}]
  ]) {
    const ctx=await createCompanionPricingContext({provider,dbSnapshot:snapshot,rpc,operationV3});
    assert.equal(ctx.prepareXiaotaoOperationV3,undefined);
    assert.equal(ctx.executeXiaotaoOperationV3,undefined);
    assert.equal(typeof ctx.reply,'function');
  }
  await assert.rejects(createCompanionPricingContext({provider,dbSnapshot:null,rpc,
    operationV3:{enabled:true,prepareXiaotaoOperationV3,executeXiaotaoOperationV3}}),e=>e.code==='operation-billing-unavailable');
  const ctx=await createCompanionPricingContext({provider,dbSnapshot,rpc,operationV3:{enabled:true,prepareXiaotaoOperationV3,executeXiaotaoOperationV3}});
  assert.equal(ctx.prepareXiaotaoOperationV3,prepareXiaotaoOperationV3);
  assert.equal(ctx.executeXiaotaoOperationV3,executeXiaotaoOperationV3);
  assert.equal((await ctx.prepareXiaotaoOperationV3({user:{id:'synthetic'}})).id,'synthetic');
  assert.equal(typeof ctx.reply,'function');
});
test('only a trusted handler factory advertises the operation capability inside the hashed policy',async()=>{
  let supplied;
  const ctx=await createCompanionPricingContext({provider,dbSnapshot,rpc,envOnline:{markup:2},operationV3:{enabled:true,createHandlers:async input=>{
    supplied=input.provider;return {prepareXiaotaoOperationV3,executeXiaotaoOperationV3};
  }}});
  const advertised=await ctx.pricing(),inner=await companionPricingPolicy(supplied);
  assert.equal(advertised.version,inner.version);
  assert.equal(advertised.config.xiaotao_online.billing_scope,'operation');
  assert.equal(advertised.config.xiaotao_online.minimum_positive_credits,1);
  assert.equal(advertised.config.xiaotao_online.operation_text_chat_v3,true);
  assert.equal(supplied.creditConfig.xiaotao_online.markup,2);
  assert.equal(supplied.billingExpectedConfig.xiaotao_online.markup,undefined);
  const closed=await createCompanionPricingContext({provider:{...provider,operationTextChatV3:true},dbSnapshot,rpc});
  assert.equal((await closed.pricing()).config.xiaotao_online.operation_text_chat_v3,undefined);
  await assert.rejects(createCompanionPricingContext({provider,dbSnapshot,rpc,operationV3:{enabled:true,createHandlers:async()=>({})}}),e=>e.code==='operation-billing-unavailable');
});
test('vision capability is separately opted in, requires handler attestation and changes the hashed policy',async()=>{
  const base={enabled:true,createHandlers:async()=>({prepareXiaotaoOperationV3,executeXiaotaoOperationV3})};
  const text=await createCompanionPricingContext({provider,dbSnapshot,rpc,operationV3:base});
  const textPolicy=await text.pricing();assert.equal(textPolicy.config.xiaotao_online.operation_vision_chat_v3,undefined);
  await assert.rejects(createCompanionPricingContext({provider,dbSnapshot,rpc,operationV3:{...base,visionEnabled:true}}),e=>e.code==='operation-vision-unavailable');
  let supplied;
  const vision=await createCompanionPricingContext({provider,dbSnapshot,rpc,operationV3:{...base,visionEnabled:true,createHandlers:async input=>{
    supplied=input.provider;return {prepareXiaotaoOperationV3,executeXiaotaoOperationV3,operationVisionSupported:true};
  }}});
  const policy=await vision.pricing();assert.equal(policy.config.xiaotao_online.operation_vision_chat_v3,true);
  assert.notEqual(policy.version,textPolicy.version);assert.equal(policy.version,(await companionPricingPolicy(supplied)).version);
  const closed=await createCompanionPricingContext({provider:{...provider,operationVisionChatV3:true},dbSnapshot,rpc});
  assert.equal((await closed.pricing()).config.xiaotao_online.operation_vision_chat_v3,undefined);
});
test('Foart open capability requires all four server-owned handlers and changes policy',async()=>{
  const base={enabled:true,foartOpenEnabled:true,createHandlers:async()=>({prepareXiaotaoOperationV3,executeXiaotaoOperationV3})};
  await assert.rejects(createCompanionPricingContext({provider,dbSnapshot,rpc,operationV3:base}),e=>e.code==='operation-foart-unavailable');
  const fn=async()=>({ok:true}),foart={prepare:fn,start:fn,resume:fn,cancel:fn};let supplied;
  const ctx=await createCompanionPricingContext({provider,dbSnapshot,rpc,operationV3:{...base,createHandlers:async input=>{
    supplied=input.provider;return {prepareXiaotaoOperationV3,executeXiaotaoOperationV3,foart};
  }}});
  assert.equal(ctx.foartOperation,foart);const policy=await ctx.pricing();
  assert.equal(policy.config.xiaotao_online.operation_foart_open_v3,true);assert.equal(policy.version,(await companionPricingPolicy(supplied)).version);
  const closed=await createCompanionPricingContext({provider:{...provider,operationFoartOpenV3:true},dbSnapshot,rpc});
  assert.equal((await closed.pricing()).config.xiaotao_online.operation_foart_open_v3,undefined);
});
test('art recovery capability is hashed only for a trusted per-request v3 art assembly',async()=>{
  const closed=await createCompanionPricingContext({provider:{...provider,operationArtV3:true},dbSnapshot,rpc});
  const closedPolicy=await closed.pricing();assert.equal(closedPolicy.config.xiaotao_online.operation_art_v3,undefined);
  const partial=await createCompanionPricingContext({provider,dbSnapshot,rpc,artBusiness:{enabled:true,accountingReady:true}});
  assert.equal((await partial.pricing()).config.xiaotao_online.operation_art_v3,undefined);
  const artBusiness={enabled:true,accountingReady:true,operationV3ForRequest:async()=>({enabled:false})};
  const ready=await createCompanionPricingContext({provider,dbSnapshot,rpc,artBusiness});const policy=await ready.pricing();
  assert.equal(policy.config.xiaotao_online.operation_art_v3,true);assert.notEqual(policy.version,closedPolicy.version);
});
