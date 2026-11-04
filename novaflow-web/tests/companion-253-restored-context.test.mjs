import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanionPricingContext,parseCompanionOnlineOverlay} from '../packages/shared/src/companion-pricing-context.mjs';
import {createCompanionOperationV3Assembly} from '../packages/shared/src/companion-operation-v3-assembly.mjs';

const provider={apiKey:'synthetic-only',baseUrl:'https://llm.runninghub.ai/v1',model:'xai/grok-4.7',configRevision:'1'};
const dbSnapshot={protocol:'xiaotao-pricing-v2',config:{xiaotao_online:{message_cap_credits:80}},message_cap_credits:80};
const secret=Buffer.alloc(32,7),ds='deepseek/deepseek-v4.1-flash',gpt='openai/gpt-6.1-sol-saver';

async function context({operation=true,envOnline,config=dbSnapshot.config}={}) {
  let providerCalls=0;
  const rpc=async(name)=>{if(name==='get_xiaotao_operation_v3_gate_state')return {enforced:true};throw Error('unexpected RPC '+name);};
  const operationV3=createCompanionOperationV3Assembly({enabled:operation,secret,fetchImpl:async()=>{providerCalls++;throw Error('unexpected provider call');}});
  const result=await createCompanionPricingContext({provider,dbSnapshot:{...dbSnapshot,config},envOnline,rpc,operationV3});
  return {result,get providerCalls(){return providerCalls;}};
}

test('253 model defaults are retained only for absent server overlay',async()=>{
  const active=await context(),policy=await active.result.pricing();
  assert.equal(policy.models.find(row=>row.id===gpt).available,true);
  assert.equal(policy.models.find(row=>row.id===ds).available,true);
  assert.equal(policy.config.xiaotao_online.minimum_positive_credits,1);
  const v2=await context({operation:false}),v2Policy=await v2.result.pricing();
  assert.equal(v2Policy.models.find(row=>row.id===gpt).available,true);
  assert.equal(v2Policy.models.find(row=>row.id===ds).available,false);
  const restricted=await context({envOnline:parseCompanionOnlineOverlay('{}')}),restrictedPolicy=await restricted.result.pricing();
  assert.equal(restrictedPolicy.models.find(row=>row.id===gpt).available,false);
  assert.equal(restrictedPolicy.models.find(row=>row.id===ds).available,false);
  assert.equal(active.providerCalls+v2.providerCalls+restricted.providerCalls,0);
});

test('malformed overlay and invalid configured rates remain fail-closed',async()=>{
  for(const raw of ['{','null','[]','true'])
    await assert.rejects(context({envOnline:parseCompanionOnlineOverlay(raw)}),e=>e.code==='operation-billing-unavailable');
  for(const online of [{markup:-1},{model_rates:{[ds]:{input:-0.01}}},{grok_4_7_rates:{output:'nonsense'}}])
    await assert.rejects(context({config:{xiaotao_online:{message_cap_credits:80,...online}}}),e=>e.code==='operation-billing-unavailable');
});
