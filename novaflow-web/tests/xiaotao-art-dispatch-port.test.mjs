import test from 'node:test';
import assert from 'node:assert/strict';
import {createXiaotaoV2CreditPorts} from '../packages/shared/src/xiaotao-v2-credit-ports.mjs';

test('guarded art dispatch binds the exact reserved user, stage, hash, model, policy and estimate',async()=>{
  const calls=[];
  const ports=createXiaotaoV2CreditPorts(async(name,parameters)=>{calls.push({name,parameters});return {status:'dispatched',first_dispatch:true};},{policyVersion:'policy-1'});
  const meta={model:'xai/grok-4.7',art_stage:'structure',art_request_hash:'a'.repeat(64),art_session_id:'session-1',pricing_version:'policy-1'};
  await ports.markDispatched({userId:'user-1',feature:'xiaotao-text',usageKey:'usage-1',metadata:meta,estimatedCredits:5});
  assert.deepEqual(calls,[{name:'mark_xiaotao_art_dispatched_v2',parameters:{p_user_id:'user-1',p_usage_key:'usage-1',p_feature:'xiaotao-text',p_model:meta.model,p_stage:meta.art_stage,p_request_hash:meta.art_request_hash,p_session_id:meta.art_session_id,p_policy_version:meta.pricing_version,p_estimated_credits:5}}]);
});
