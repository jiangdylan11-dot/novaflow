import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {estimateXiaotaoOnlineCredits} from '../../packages/shared/src/feature-credits.mjs';

function prices() {
  const scope = {console}; scope.window = scope;
  runInContext(readFileSync(new URL('../../renderer/feature-credit-prices.js', import.meta.url), 'utf8'), createContext(scope));
  return scope.NovaFlowFeatureCreditPrices;
}

const input = {text:'a'.repeat(10000), system:'', model:'xai/grok-4.7'};
const policy = {message_cap_credits:80,chars_per_token:2,output_tokens:2048,usd_per_million_tokens:10,file_tokens:{image:2500,video:0,audio:0}};
const sample = {model:'xai/grok-4.7',eligible:true,pricingSource:'token_usage',usdCost:0.07,inputTokens:5000,outputTokens:1000,totalTokens:6000,creditsPerUsd:211,markup:2,policy};

test('initial Grok forecast and reservation price input and output separately', () => {
  const p = prices();
  const hold = p.estimateXiaotaoOnline(input);
  const quote = p.predictXiaotaoOnline(input);
  assert.equal(quote.inputTokens, 5000);
  assert.equal(quote.outputTokens, 1024);
  assert.equal(quote.credits, Math.ceil((5000 * 1.7 + 1024 * 5.1) / 1e6 * 422));
  assert.equal(quote.reservedCredits, hold.credits);
  assert.equal(hold.credits, Math.ceil((5000 * 1.7 + 2048 * 5.1) / 1e6 * 422));
  assert.equal(hold.credits, estimateXiaotaoOnlineCredits(input).credits);
  assert.equal(p.predictXiaotaoOnline({...input,model:undefined}).credits, quote.credits);
  assert.equal(p.predictXiaotaoOnline({...input,model:undefined}).reservedCredits, hold.credits);
  assert.ok(p.predictXiaotaoOnline({...input,model:'other-model'}).credits > quote.credits);
  assert.equal(p.estimateXiaotaoOnline({...input,model:'other-model'}).credits,Math.ceil((5000 + 2048) * 10 / 1e6 * 422));
});

test('old flat-rate samples cannot train the new prediction', () => {
  const p = prices();
  const quote = p.predictXiaotaoOnline(input);
  const oldGroup = JSON.stringify(JSON.parse(quote.group).map((part, i) => {
    if (i !== 1) return part;
    const policyKey = JSON.parse(part); policyKey[0] = 1;
    return JSON.stringify(policyKey);
  }));
  const old = {model:sample.model,config:{credits_per_usd:211,token_billing:{markup:2},xiaotao_online:policy},samples:[{group:oldGroup,baseTokens:quote.baseTokens,usdCost:0.07,totalTokens:7000}]};
  assert.equal(p.predictXiaotaoOnline({...input,...old}).sampleCount, 0);
  const rejected = p.recordXiaotaoOnlineSample(input,sample,old);
  assert.equal(p.predictXiaotaoOnline({...input,...rejected}).sampleCount, 0);
  const accepted = p.recordXiaotaoOnlineSample(input,{...sample,pricingSource:'rh_consume_money',usdCost:0.02},rejected);
  assert.equal(p.predictXiaotaoOnline({...input,...accepted}).sampleCount, 1);
});

test('custom Grok prices and tier threshold drive the prediction and invalidate old samples', () => {
  const p = prices();
  const customPolicy = {...policy,grok_4_7_rates:{input:2,output:6,high_input_threshold:4000,high_input:8,high_output:12}};
  const customConfig = {credits_per_usd:211,token_billing:{markup:2},xiaotao_online:customPolicy};
  const q = p.predictXiaotaoOnline({...input,config:customConfig});
  assert.equal(q.credits, Math.ceil((5000 * 8 + 1024 * 12) / 1e6 * 422));
  assert.equal(q.reservedCredits,estimateXiaotaoOnlineCredits({...input,config:customConfig}).credits);
  const learned = p.recordXiaotaoOnlineSample(input,{...sample,policy:customPolicy,pricingSource:'token_rate_estimate',usdCost:0.02},null);
  assert.equal(p.predictXiaotaoOnline({...input,...learned}).sampleCount,1);
  const newPolicy = {...customPolicy,grok_4_7_rates:{...customPolicy.grok_4_7_rates,high_input:4}};
  const revised = p.predictXiaotaoOnline({...input,...learned,config:{...customConfig,xiaotao_online:newPolicy}});
  assert.equal(revised.sampleCount,0);
  assert.equal(revised.credits, Math.ceil((5000 * 4 + 1024 * 12) / 1e6 * 422));
  const invalid = p.predictXiaotaoOnline({...input,config:{...customConfig,xiaotao_online:{...policy,grok_4_7_rates:{input:true,output:-1}}}});
  assert.equal(invalid.credits,p.predictXiaotaoOnline(input).credits);
});
