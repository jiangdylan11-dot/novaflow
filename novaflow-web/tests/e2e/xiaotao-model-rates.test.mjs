import test from 'node:test';
import assert from 'node:assert/strict';
import { hasXiaotaoModelRate, estimateXiaotaoModelUsage } from '../../packages/shared/src/xiaotao-model-rates.mjs';
import { estimateXiaotaoOnlineCredits, settleXiaotaoOnlineCredits, xiaotaoOnlinePolicy } from '../../packages/shared/src/feature-credits.mjs';
import { createCompanionChat } from '../../packages/shared/src/companion-chat.mjs';
import { FOART_TOOL_SCHEMA } from '../../packages/shared/src/foart-tool-plan.mjs';
import { createOnlineAiCharge } from '../../packages/shared/src/online-ai-charge.mjs';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
test('GLM uses input, output and cache rates separately', () => {
  const row = estimateXiaotaoModelUsage('glm/glm-5.3-flash', {prompt_tokens:10000, completion_tokens:1000,
    total_tokens:11000, prompt_tokens_details:{cached_tokens:4000}});
  near(row.usd, (6000*.15 + 4000*.024 + 1000*.5)/1e6);
  assert.equal(row.cacheKnown,true);
});
test('GPT input threshold is strictly greater than 272000, per request', () => {
  const model='openai/gpt-6.1-sol-saver';
  const normal=estimateXiaotaoModelUsage(model,{input_tokens:272000,output_tokens:1000});
  const high=estimateXiaotaoModelUsage(model,{input_tokens:272001,output_tokens:1000});
  near(normal.usd,(272000*.7+1000*3.5)/1e6);
  near(high.usd,(272001*1.4+1000*5.25)/1e6);
  assert.equal(normal.cacheKnown,false);
});
test('invalid or incomplete usage cannot be priced', () => {
  const m='glm/glm-5.3-flash';
  for (const u of [{}, {total_tokens:20}, {input_tokens:20,output_tokens:5,total_tokens:24},
    {input_tokens:20,output_tokens:5,input_tokens_details:{cached_tokens:21}},
    {input_tokens:20.5,output_tokens:5}]) assert.equal(estimateXiaotaoModelUsage(m,u),null);
});
test('DeepSeek uses approved fixed peak input, output and cached prices', () => {
  const model='deepseek/deepseek-v4.1-flash';
  const usage={prompt_tokens:10000,completion_tokens:1000,total_tokens:11000,prompt_tokens_details:{cached_tokens:4000}};
  assert.equal(hasXiaotaoModelRate(model),true);
  const result=estimateXiaotaoModelUsage(model,usage);
  near(result.usd,(6000*.177+4000*.0036+1000*.7062)/1e6);
  assert.equal(result.rateSnapshot,'runninghub-fixed-peak-2026-11-01');
});
test('DeepSeek preserves known top-level cache hits and rejects conflicting counters', () => {
  const model='deepseek/deepseek-v4.1-flash';
  const base={prompt_tokens:10000,completion_tokens:1000,prompt_cache_hit_tokens:4000,prompt_cache_miss_tokens:6000};
  const top=estimateXiaotaoModelUsage(model,base);
  near(top.usd,(6000*.177+4000*.0036+1000*.7062)/1e6);
  assert.equal(top.cacheKnown,true);assert.equal(top.cachedTokens,4000);
  near(estimateXiaotaoModelUsage(model,{...base,prompt_tokens_details:{cached_tokens:4000}}).usd,top.usd);
  assert.equal(estimateXiaotaoModelUsage(model,{...base,prompt_tokens_details:{cached_tokens:3999}}),null);
  assert.equal(estimateXiaotaoModelUsage(model,{...base,prompt_cache_miss_tokens:5999}),null);
  assert.equal(estimateXiaotaoModelUsage(model,{...base,input_tokens:9999}),null);
  assert.equal(estimateXiaotaoModelUsage(model,{prompt_tokens:10000,completion_tokens:1000,prompt_cache_miss_tokens:6000}),null);
});
test('direct settlement retains provider top-level cache and fails closed on conflicts', () => {
  const usage={prompt_tokens:10000,completion_tokens:1000,prompt_cache_hit_tokens:4000,prompt_cache_miss_tokens:6000};
  const ds=settleXiaotaoOnlineCredits({model:'deepseek/deepseek-v4.1-flash',usage});
  near(ds.usdCost,(6000*.177+4000*.0036+1000*.7062)/1e6);
  const withUnverifiedMoney=settleXiaotaoOnlineCredits({model:'deepseek/deepseek-v4.1-flash',usage:{...usage,consumeMoney:'999'}});
  near(withUnverifiedMoney.usdCost,ds.usdCost);assert.equal(withUnverifiedMoney.moneySource,null);
  const grok=settleXiaotaoOnlineCredits({model:'xai/grok-4.7',usage});
  near(grok.usdCost,(6000*1.7+4000*.425+1000*5.1)/1e6);
  for (const model of ['deepseek/deepseek-v4.1-flash','xai/grok-4.7']) {
    const bad=settleXiaotaoOnlineCredits({model,usage:{...usage,prompt_tokens_details:{cached_tokens:3999}}});
    assert.equal(bad.usageMissing,true);assert.equal(bad.credits,0);
  }
  assert.equal(settleXiaotaoOnlineCredits({model:'deepseek/deepseek-v4.1-flash',usage:{prompt_tokens:10000,completion_tokens:1000}}).usageMissing,true);
});
test('reservation and settlement use the same existing credit rule and cap', () => {
  const model='glm/glm-5.3-flash';
  const quote=estimateXiaotaoOnlineCredits({model,text:'x'.repeat(20000),system:'',outputTokens:1000});
  near(quote.usd,(10000*.15+1000*.5)/1e6);
  assert.equal(quote.credits,1);
  const decision=settleXiaotaoOnlineCredits({model,usage:{input_tokens:10000,output_tokens:1000,prompt_tokens_details:{cached_tokens:0}},reservedCredits:10});
  near(decision.usdCost,(10000*.15+1000*.5)/1e6);
  assert.equal(decision.credits,1);assert.equal(decision.refund,9);
  assert.equal(decision.pricingSource,'token_rate_estimate');
  const unpriced=settleXiaotaoOnlineCredits({model,usage:{total_tokens:11000},reservedCredits:10});
  assert.equal(unpriced.credits,0);assert.equal(unpriced.pricingSource,'unpriced_usage');
  const oneRecord=settleXiaotaoOnlineCredits({model,usageRecords:[{input_tokens:10000,output_tokens:1000,prompt_tokens_details:{cached_tokens:0}}],reservedCredits:10});
  near(oneRecord.usdCost,decision.usdCost);assert.equal(oneRecord.tokenRateEstimate.inputTokens,10000);
});
test('GPT settlement ignores unverified money and refuses missing or conflicting cache usage', () => {
  const model='openai/gpt-6.1-sol-saver';
  const usage={prompt_tokens:10000,completion_tokens:1000,prompt_tokens_details:{cached_tokens:0},consumeMoney:'999'};
  const priced=settleXiaotaoOnlineCredits({model,usage});
  near(priced.usdCost,.0105);assert.equal(priced.credits,4);assert.equal(priced.moneySource,null);
  for(const invalid of [
    {prompt_tokens:10000,completion_tokens:1000,consumeMoney:'999'},
    {...usage,input_tokens:9999},
    {...usage,prompt_cache_hit_tokens:4},
    {prompt_tokens:10000,completion_tokens:1000,prompt_cache_miss_tokens:10000}
  ]) {
    const result=settleXiaotaoOnlineCredits({model,usage:invalid,reservedCredits:10});
    assert.equal(result.usageMissing,true);assert.equal(result.usdCost,null);
  }
});
test('GPT legacy reply refuses incomplete or contradictory usage without a settlement', async () => {
  const model='openai/gpt-6.1-sol-saver';
  const provider={apiKey:'fixture',baseUrl:'https://llm.runninghub.ai/v1',model:'xai/grok-4.7',pricingSnapshotReady:true,configRevision:'1',creditConfig:{xiaotao_online:{enabled_models:[model]}}};
  for(const usage of [
    {prompt_tokens:10000,completion_tokens:1000},
    {prompt_tokens:10000,input_tokens:9999,completion_tokens:1000,prompt_tokens_details:{cached_tokens:0}}
  ]) {
    let calls=0,settled=0;
    const service=createCompanionChat({provider,charge:async args=>{const result=await args.run();settled++;return result;},fetchImpl:async()=>{calls++;return Response.json({model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'hello'}}],usage});}});
    const payload={requestId:'invalid-usage-fixture',modelId:model,mode:'chat',message:'hello',history:[]};
    const quote=await service.quote({payload});
    await assert.rejects(service.reply({user:{id:'u'},payload:{...payload,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}}),/用量或费用无法核实/);
    assert.equal(calls,1);assert.equal(settled,0);
  }
});
test('GPT plan correction rejects missing usage on the second provider request', async () => {
  const model='openai/gpt-6.1-sol-saver',ctx={schema:FOART_TOOL_SCHEMA,controls:[]};
  const provider={apiKey:'fixture',baseUrl:'https://llm.runninghub.ai/v1',model:'xai/grok-4.7',pricingSnapshotReady:true,configRevision:'1',creditConfig:{xiaotao_online:{enabled_models:[model]}}};
  let calls=0,settled=0;
  const service=createCompanionChat({provider,charge:async args=>{const result=await args.run();settled++;return result;},fetchImpl:async()=>{
    calls++;
    const operation={action:'image_generate',prompt:'test',generationMode:'txt2img',...(calls===1?{}:{useResult:false})};
    const reply={schema:FOART_TOOL_SCHEMA,status:'act',reply:'OK',operations:[operation]};
    return Response.json({model,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(reply)}}],usage:{prompt_tokens:100,completion_tokens:20,...(calls===1?{prompt_tokens_details:{cached_tokens:0}}:{})}});
  }});
  const payload={requestId:'invalid-second-usage',modelId:model,mode:'foart',message:'draw',history:[],foartContext:ctx};
  const quote=await service.quote({payload});
  await assert.rejects(service.reply({user:{id:'u'},payload:{...payload,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}}),/用量或费用无法核实/);
  assert.equal(calls,2);assert.equal(settled,0);
});
test('multiple provider requests each use their own GPT tier before one message cap', () => {
  const model='openai/gpt-6.1-sol-saver';
  const one={input_tokens:200000,output_tokens:1000,prompt_tokens_details:{cached_tokens:0}};
  const two={input_tokens:100000,output_tokens:1000,prompt_tokens_details:{cached_tokens:0}};
  const decision=settleXiaotaoOnlineCredits({model,usageRecords:[one,two],reservedCredits:10});
  near(decision.usdCost,(300000*.7+2000*3.5)/1e6);
  assert.equal(decision.credits,69);
  const missing=settleXiaotaoOnlineCredits({model,usageRecords:[one,{total_tokens:20}],reservedCredits:10});
  assert.equal(missing.credits,0);assert.equal(missing.usageMissing,true);
  const mixed=settleXiaotaoOnlineCredits({model,usageRecords:[{consumeMoney:'0.10'},two],reservedCredits:10});
  assert.equal(mixed.usdCost,null);assert.equal(mixed.usageMissing,true);
});
test('validated configured rates survive policy normalization for browser estimates', () => {
  const model='glm/glm-5.3-flash';
  const config={xiaotao_online:{model_rates:{[model]:{input:.2,output:.5,cached:.03,snapshot:'operator-1'}}}};
  const policy=xiaotaoOnlinePolicy(config);
  const usage={input_tokens:10000,output_tokens:1000,prompt_tokens_details:{cached_tokens:0}};
  const server=settleXiaotaoOnlineCredits({model,usage,config});
  const client=settleXiaotaoOnlineCredits({model,usage,config:{xiaotao_online:policy}});
  near(server.usdCost,(10000*.2+1000*.5)/1e6);
  near(client.usdCost,server.usdCost);
  assert.equal(server.tokenRateEstimate.rateSnapshot,'operator-1');
});
test('repaired Grok plan prices each upstream request without combining context tiers', async () => {
  let calls=0, outcome;
  const model='xai/grok-4.7';
  const ctx={schema:FOART_TOOL_SCHEMA,controls:[]};
  const service=createCompanionChat({provider:{apiKey:'fixture',baseUrl:'https://llm.runninghub.ai/v1',model},
    charge:async args=>{outcome=await args.run();return outcome;},fetchImpl:async()=>{
      calls++;
      const op={action:'image_generate',prompt:'test',generationMode:'txt2img',...(calls===1?{}:{useResult:false})};
      const reply={schema:FOART_TOOL_SCHEMA,status:'act',reply:'OK',operations:[op]};
      return Response.json({...(calls===1?{id:'request-1'}:{}),model,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(reply)}}],
        usage:{prompt_tokens:calls===1?120000:100000,completion_tokens:1000,total_tokens:calls===1?121000:101000}},
        {headers:{'x-request-id':'request-2'}});
    }});
  await service.reply({user:{id:'u'},payload:{requestId:'repair-tier-fixture',mode:'foart',message:'draw',history:[],foartContext:ctx}});
  assert.equal(calls,2);
  near(outcome.rhCostUsd,(220000*1.7+2000*5.1)/1e6);
  assert.equal(outcome.metadata.token_rate_estimate.requests.length,2);
  assert.deepEqual(outcome.metadata.provider_request_ids,['request-1','request-2']);
  assert.equal(outcome.metadata.usage.prompt_tokens_details,undefined);
  assert.equal(outcome.metadata.request_usage.length,2);
});
test('new model route stays closed by default; explicit server allowlist uses exact model and rate', async () => {
  for(const model of ['openai/gpt-6.1-sol-saver']) {
    let count=0, outcome;
    const provider={apiKey:'fixture',baseUrl:'https://llm.runninghub.ai/v1',model:'xai/grok-4.7'};
    const charge=async args=>{outcome=await args.run();return outcome;};
    const fetchImpl=async (_url,init)=>{count++;assert.equal(JSON.parse(init.body).model,model);return Response.json({model,
      choices:[{finish_reason:'stop',message:{role:'assistant',content:'hello'}}],usage:{prompt_tokens:10000,completion_tokens:1000,prompt_tokens_details:{cached_tokens:0}}});};
    const payload={requestId:'extra-model-fixture',modelId:model,mode:'chat',message:'hello',history:[]};
    await assert.rejects(createCompanionChat({provider,charge,fetchImpl}).reply({user:{id:'u'},payload}));
    assert.equal(count,0);
    provider.creditConfig={xiaotao_online:{enabled_models:[model]}};provider.pricingSnapshotReady=true;provider.configRevision='1';
    const service=createCompanionChat({provider,charge,fetchImpl});const quote=await service.quote({payload});
    await service.reply({user:{id:'u'},payload:{...payload,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}});
    assert.equal(count,1);assert.equal(outcome.model,model);assert.equal(outcome.pricingSource,'token_rate_estimate');
    const expected=(10000*.7+1000*3.5)/1e6;
    near(outcome.rhCostUsd,expected);
  }
});
test('a truncated new-model response releases the reservation and does not settle or retry', async () => {
  const model='openai/gpt-6.1-sol-saver';let calls=0,settled=0,released=0;
  const provider={apiKey:'fixture',baseUrl:'https://llm.runninghub.ai/v1',model:'xai/grok-4.7',
    creditConfig:{xiaotao_online:{enabled_models:[model]}},pricingSnapshotReady:true,configRevision:'1'};
  const charge=createOnlineAiCharge({reserve:async()=>({status:'reserved',idempotent:false,amount:1}),
    settle:async()=>settled++,release:async()=>released++});
  const fetchImpl=async()=>{calls++;return Response.json({model,choices:[{finish_reason:'length',message:{role:'assistant',content:'partial'}}],
    usage:{prompt_tokens:100,completion_tokens:50}});};
  const service=createCompanionChat({provider,charge,fetchImpl});const payload={requestId:'truncated-fixture',modelId:model,mode:'chat',message:'hello',history:[]};const quote=await service.quote({payload});
  await assert.rejects(service.reply({user:{id:'u'},payload:{...payload,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}}),/截断/);
  assert.equal(calls,1);assert.equal(settled,0);assert.equal(released,1);
});
test('a new-model response with missing or different identity releases before charging', async () => {
  for (const returned of ['', 'xai/grok-4.7']) {
    const model='openai/gpt-6.1-sol-saver';let calls=0,settled=0,released=0;
    const provider={apiKey:'fixture',baseUrl:'https://llm.runninghub.ai/v1',model:'xai/grok-4.7',
      creditConfig:{xiaotao_online:{enabled_models:[model]}},pricingSnapshotReady:true,configRevision:'1'};
    const charge=createOnlineAiCharge({reserve:async()=>({status:'reserved',idempotent:false,amount:1}),
      settle:async()=>settled++,release:async()=>released++});
    const fetchImpl=async()=>{calls++;return Response.json({model:returned,choices:[{finish_reason:'stop',message:{role:'assistant',content:'hello'}}],usage:{prompt_tokens:100,completion_tokens:5}});};
    const service=createCompanionChat({provider,charge,fetchImpl});const payload={requestId:'bad-identity-fixture',modelId:model,mode:'chat',message:'hello',history:[]};const quote=await service.quote({payload});
    await assert.rejects(service.reply({user:{id:'u'},payload:{...payload,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}}));
    assert.equal(calls,1);assert.equal(settled,0);assert.equal(released,1);
  }
});
test('an idempotent new-model reservation never calls the provider or settles again', async () => {
  const model='openai/gpt-6.1-sol-saver';let calls=0,settled=0,released=0;
  const provider={apiKey:'fixture',baseUrl:'https://llm.runninghub.ai/v1',model:'xai/grok-4.7',
    creditConfig:{xiaotao_online:{enabled_models:[model]}},pricingSnapshotReady:true,configRevision:'1'};
  const charge=createOnlineAiCharge({reserve:async()=>({status:'reserved',idempotent:true,amount:1}),
    settle:async()=>settled++,release:async()=>released++});
  const fetchImpl=async()=>{calls++;throw Error('must not call');};
  const service=createCompanionChat({provider,charge,fetchImpl});const payload={requestId:'replayed-fixture',modelId:model,mode:'chat',message:'hello',history:[]};const quote=await service.quote({payload});
  await assert.rejects(service.reply({user:{id:'u'},payload:{...payload,pricingVersion:quote.pricingVersion,quoteFingerprint:quote.quoteFingerprint}}), error=>error.status===409);
  assert.equal(calls,0);assert.equal(settled,0);assert.equal(released,0);
});
test('legacy provider set to a flat-rate model cannot silently use generic token pricing', async () => {
  for(const model of ['deepseek/deepseek-v4.1-flash','deepseek/deepseek-v4.1-flash','bytedance/doubao-seed-2.1-lite']){
    let charged=0,calls=0;
    const provider={apiKey:'fixture',baseUrl:'https://llm.runninghub.ai/v1',model};
    const service=createCompanionChat({provider,charge:async()=>charged++,fetchImpl:async()=>calls++});
    await assert.rejects(service.reply({user:{id:'u'},payload:{requestId:'legacy-flat-fixture',mode:'chat',message:'hello',history:[]}}),/只支持按操作计费/);
    assert.equal(charged,0);assert.equal(calls,0);
  }
});
test('Qwen uses its own input, output and cache rates', () => {
  const row = estimateXiaotaoModelUsage('qwen/qwen3.8-flash-next', {prompt_tokens:10000, completion_tokens:1000,
    total_tokens:11000, prompt_tokens_details:{cached_tokens:4000}});
  near(row.usd, (6000*.118 + 4000*.015 + 1000*.398)/1e6);
  assert.equal(row.rateSnapshot,'runninghub-2026-11-04');
});
