import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {estimateXiaotaoOnlineCredits,xiaotaoOnlinePolicy,creditsFromUsd} from '../../packages/shared/src/feature-credits.mjs';

function prices() {
  const scope = {console}; scope.window = scope;
  runInContext(readFileSync(new URL('../../renderer/feature-credit-prices.js',import.meta.url),'utf8'),createContext(scope));
  return scope.NovaFlowFeatureCreditPrices;
}
const question = '把附图放到图生图参考图；只用一句中文描述图片主色，不要生成或修改图片。';
const input = {text:question,history:'',files:[{kind:'image',width:96,height:96}],model:'xai/grok-4.7'};
const config = {credits_per_usd:211,token_billing:{markup:2},xiaotao_online:xiaotaoOnlinePolicy()};
const sample = {model:'metered-model',eligible:true,pricingSource:'token_usage',usdCost:0.02,inputTokens:1500,outputTokens:500,totalTokens:2000,creditsPerUsd:211,markup:1.5,policy:xiaotaoOnlinePolicy()};

test('decimal online estimates retain subcredit amounts only for the fully versioned policy',()=>{
  const p=prices(), rates={input:0.177,output:0.7062,cached:0.0036};
  const decimal={credits_per_usd:211,token_billing:{round:'ceil',min_credits_per_image:1},xiaotao_online:{
    billing_scope:'operation',credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0,markup:1.5,
    model_rates:{'deepseek/deepseek-v4.1-flash':rates}}};
  const input={text:'a',system:'',outputTokens:0,model:'deepseek/deepseek-v4.1-flash',config:decimal};
  assert.equal(p.estimateXiaotaoOnline(input).credits,0.000057);
  assert.equal(p.estimateXiaotaoOnline({...input,text:''}).credits,0);
  const tiny=structuredClone(decimal);tiny.xiaotao_online.model_rates['deepseek/deepseek-v4.1-flash'].input=1e-12;
  assert.equal(p.estimateXiaotaoOnline({...input,config:tiny}).credits,0.000001);
  const incomplete=structuredClone(decimal);delete incomplete.xiaotao_online.credit_rounding;
  assert.equal(p.estimateXiaotaoOnline({...input,config:incomplete}),null);
  const contradictory=structuredClone(decimal);contradictory.xiaotao_online.minimum_positive_credits=1;
  assert.equal(p.estimateXiaotaoOnline({...input,config:contradictory}),null);
  const missing=structuredClone(decimal);for(const key of ['credit_amount_policy','credit_precision','credit_rounding'])delete missing.xiaotao_online[key];
  assert.equal(p.estimateXiaotaoOnline({...input,config:missing}),null);
});

test('a brief image question forecasts less than the full-output reservation without changing it',()=>{
  const p=prices(), hold=p.estimateXiaotaoOnline(input), forecast=p.predictXiaotaoOnline(input);
  assert.equal(hold.credits,estimateXiaotaoOnlineCredits(input).credits);
  assert.equal(forecast.reservedCredits,hold.credits);
  assert.ok(forecast.credits<hold.credits);
  assert.ok(forecast.low<=forecast.credits && forecast.credits<=forecast.high);
  assert.equal(forecast.confidence,'initial');
  assert.equal(forecast.sampleCount,0);
  assert.equal(p.estimateXiaotaoOnline(input).credits,hold.credits);
  assert.equal(p.predictXiaotaoOnline({text:''}).credits,0);
  const withPage=p.predictXiaotaoOnline({...input,contextText:'页面中的长提示词'.repeat(300)});
  assert.ok(withPage.credits>forecast.credits,'actual page text contributes to the forecast');
  assert.equal(withPage.reservedCredits,hold.credits,'forecast context must not silently change the reservation contract');
});

test('task intent affects the forecast, with a broad range until measured usage exists',()=>{
  const p=prices();
  const brief=p.predictXiaotaoOnline({...input,text:'请简短描述主色'});
  const normal=p.predictXiaotaoOnline({...input,text:'请描述这张图片'});
  const detailed=p.predictXiaotaoOnline({...input,text:'请详细分析这张图片，给完整方案'});
  assert.ok(brief.credits<normal.credits && normal.credits<detailed.credits);
  assert.ok(brief.high>=brief.reservedCredits);
  assert.equal(brief.confidence,'initial');
  const contradicted=p.predictXiaotaoOnline({...input,text:'每点一句话，给我详细完整方案'});
  assert.equal(contradicted.credits,detailed.credits);
});

test('recorded server USD learns hidden reasoning cost and improves a held-out nearby workload',()=>{
  const p=prices(); let learned=null;
  for (const [n,usd] of [0.019,0.021,0.020,0.0205,0.0195,0.020].entries()) {
    learned=p.recordXiaotaoOnlineSample({...input,text:question+' '.repeat(n)}, {...sample,usdCost:usd,totalTokens:Math.round(usd*1e5)},learned);
  }
  const unseen={...input,text:question+' 请回答。'};
  const before=p.predictXiaotaoOnline({...unseen,model:sample.model,config});
  const after=p.predictXiaotaoOnline({...unseen,...learned});
  const observed=Math.ceil(0.0202*211*1.5);
  assert.equal(after.confidence,'calibrated');
  assert.equal(after.sampleCount,6);
  assert.ok(Math.abs(after.credits-observed)<Math.abs(before.credits-observed));
  assert.ok(Math.abs(after.credits-observed)<Math.abs(after.reservedCredits-observed));
  assert.equal(after.reservedCredits,before.reservedCredits);
  const stored=JSON.stringify(learned);
  assert.ok(!stored.includes(question) && !stored.includes('data:image') && !stored.includes('inputTokens'));
});

test('different models, prices, task types and image size classes do not borrow calibration',()=>{
  const p=prices(); const learned=p.recordXiaotaoOnlineSample(input,sample,null);
  assert.equal(p.predictXiaotaoOnline({...input,...learned}).sampleCount,1);
  for (const changes of [
    {model:'different-model'},
    {config:{...config,xiaotao_online:{...config.xiaotao_online,markup:3}}},
    {text:'请详细分析这张图'},
    {files:[{kind:'image',width:2048,height:2048}]},
    {files:[{kind:'image'}]},
    {files:[{kind:'image',width:96,height:96},{kind:'image',width:96,height:96}]}
  ]) assert.equal(p.predictXiaotaoOnline({...input,...learned,...changes}).sampleCount,0);
  // Nearby image dimensions share measurements, without inventing a token formula.
  assert.equal(p.predictXiaotaoOnline({...input,...learned,files:[{kind:'image',width:128,height:128}]}).sampleCount,1);
});

test('missing, ineligible and invalid usage cannot train the prediction; storage remains bounded',()=>{
  const p=prices(); let learned=p.recordXiaotaoOnlineSample(input,sample,null);
  for (const bad of [{eligible:false},{usdCost:0},{usdCost:Infinity},{totalTokens:0},{totalTokens:Infinity},{model:''},{policy:null}]) {
    assert.equal(p.recordXiaotaoOnlineSample(input,{...sample,...bad},learned),learned);
  }
  for(let i=0;i<100;i++)learned=p.recordXiaotaoOnlineSample(input,sample,learned);
  assert.equal(learned.samples.length,24);
  assert.equal(p.predictXiaotaoOnline({...input,...learned}).sampleCount,24);
  const outlier={...learned,samples:[{...learned.samples[0],baseTokens:Infinity}]};
  assert.equal(p.predictXiaotaoOnline({...input,...outlier}).sampleCount,0);
  const changed=p.recordXiaotaoOnlineSample(input,{...sample,eligible:false,model:'new-model'},learned);
  assert.equal(changed.samples.length,24);
  assert.equal(p.predictXiaotaoOnline({...input,...changed}).sampleCount,0,'ineligible usage cannot keep old model confidence alive');
});
