import test from 'node:test';
import assert from 'node:assert/strict';
import {settleXiaotaoOnlineCredits} from '../packages/shared/src/feature-credits.mjs';

const config={credits_per_usd:211,xiaotao_online:{markup:1.5,message_cap_credits:80}};
const badTokenUsage={input_tokens:10,prompt_tokens:10,output_tokens:5,completion_tokens:5,total_tokens:15,
  prompt_tokens_details:{cached_tokens:20},thirdPartyConsumeMoney:'0.1'};

test('deployed 253 legacy Grok keeps valid money priority on conflicting token detail',()=>{
  const result=settleXiaotaoOnlineCredits({usage:badTokenUsage,reservedCredits:10,config,model:'xai/grok-4.7'});
  assert.equal(result.pricingSource,'rh_consume_money');
  assert.equal(result.usageMissing,false);
  assert.equal(result.credits,32);
  assert.equal(result.refund,0);
});

test('legacy Grok repairs price valid money per request before operation aggregation',()=>{
  const result=settleXiaotaoOnlineCredits({usageRecords:[badTokenUsage,badTokenUsage],reservedCredits:10,config,model:'xai/grok-4.7'});
  assert.equal(result.pricingSource,'rh_consume_money');
  assert.equal(result.usageMissing,false);
  assert.equal(result.credits,64);
});
