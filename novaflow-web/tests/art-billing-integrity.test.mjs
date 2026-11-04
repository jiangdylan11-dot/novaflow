import test from 'node:test';
import assert from 'node:assert/strict';
import {chatCompletionToResponses} from '../packages/shared/src/runninghub-llm.mjs';
import {createCompanionArtBusiness} from '../packages/shared/src/companion-art-business.mjs';
import {createOnlineAiCharge} from '../packages/shared/src/online-ai-charge.mjs';
import {settleXiaotaoOnlineCredits} from '../packages/shared/src/feature-credits.mjs';

const grok='xai/grok-4.7', gpt='openai/gpt-6.1-sol-saver';
const complete={prompt_tokens:10000,completion_tokens:1000,total_tokens:11000,prompt_tokens_details:{cached_tokens:4000}};
const response=(model,usage)=>({model,choices:[{finish_reason:'stop',message:{content:'A red cat sits on grass.'}}],usage});

test('raw aliases are checked before flattening for guarded art and known-rate models',()=>{
  for(const model of [grok,gpt]) {
    const valid=chatCompletionToResponses(response(model,complete),{includeBillingIntegrity:true}).usage;
    assert.equal(valid.billing_token_usage_invalid,false);
    for(const usage of [
      {...complete,input_tokens:9999}, {...complete,output_tokens:999}, {...complete,total_tokens:11001},
      {...complete,input_tokens_details:{cached_tokens:3999}}, {...complete,prompt_tokens_details:{cached_tokens:10001}},
      {...complete,prompt_tokens:-1}, {...complete,prompt_tokens:1.5}, {...complete,prompt_tokens:Number.MAX_SAFE_INTEGER+1},
      {...complete,token_usage:{prompt_tokens:1}}, {completion_tokens:1},
    ]) {
      const guarded=chatCompletionToResponses(response(model,usage),{includeBillingIntegrity:true}).usage;
      assert.equal(guarded.billing_token_usage_invalid,true,JSON.stringify(usage));
      const legacy=chatCompletionToResponses(response(model,usage)).usage;
      if(model===gpt)assert.equal(legacy.billing_token_usage_invalid,true,JSON.stringify(usage));
      else assert.equal(Object.hasOwn(legacy,'billing_token_usage_invalid'),false);
    }
    const noCache={prompt_tokens:10000,completion_tokens:1000,total_tokens:11000};
    assert.equal(chatCompletionToResponses(response(model,noCache),{includeBillingIntegrity:true}).usage.billing_token_usage_invalid,false);
  }
});

async function fixture(model,usage,hooks={}) {
  const events=[];
  const charge=createOnlineAiCharge({strictSettlement:true,guardedDispatch:true,
    reserve:async()=>{events.push('reserve');hooks.onReserve?.();return {status:'reserved',amount:1};},
    markDispatched:async()=>{events.push('mark');hooks.onMark?.();return {status:'dispatched',first_dispatch:true};},
    settle:async args=>{events.push(['settle',args]);return {status:'settled',settled_credits:args.settledCredits};},
    release:async()=>{events.push('release');return {status:'released'};}});
  const compiler={
    buildGrokPromptOptimizeRequest:(_payload,id)=>({body:{model:id,max_output_tokens:1536,input:[
      {role:'system',content:[{type:'input_text',text:'fixture'}]},
      {role:'user',content:[{type:'input_text',text:'red cat'}]}]},
      resultOptions:{artSemanticFusion:true,targetEngine:'gpt-image-2.5',completeVisualBrief:true}}),
    grokResponsesPublicResult:()=>({output_text:'A red cat sits on green grass under soft daylight.'})
  };
  const provider={apiKey:'synthetic',baseUrl:'https://example.invalid/v1',model:grok,configRevision:'1',pricingSnapshotReady:true,
    creditConfig:{xiaotao_online:{enabled_models:[gpt]}}};
  const business=await createCompanionArtBusiness({enabled:true,accountingReady:true,provider,charge,compiler,
    secret:Buffer.alloc(32,7),policyFor:()=> 'fixture',isCurrent:async()=>hooks.isCurrent?.()??true,fetchImpl:async(_url,options)=>{
      events.push('provider');hooks.onProvider?.();return Response.json(response(JSON.parse(options.body).model,usage));}});
  const user={id:'fixture-user'},sessionId='fixture-session';
  const payload={stage:'structure',modelId:model,epoch:0,intentId:'0d2aa225-e027-4d20-8ef3-7b5d1a9bbfee',
    input:{currentPrompt:'red cat',targetEngine:'gpt-image-2.5'}};
  const quote=await business.quote({user,sessionId,payload});
  return {events,run:()=>business.execute({user,sessionId,payload:{quoteToken:quote.quoteToken,epoch:0}})};
}

test('guarded art holds dispatched reservation on conflicting counters and never retries',async()=>{
  for(const model of [grok,gpt]) {
    const f=await fixture(model,{...complete,input_tokens:9999});
    await assert.rejects(f.run(),error=>error.code==='xiaotao_dispatch_status_unknown');
    assert.deepEqual(f.events,['reserve','mark','provider']);
  }
});

test('guarded art prices verified usage and holds GPT requests with unknown cache for reconciliation',async()=>{
  for(const model of [grok,gpt]) for(const usage of [complete,{prompt_tokens:10000,completion_tokens:1000,total_tokens:11000}]) {
    const f=await fixture(model,{...usage,consumeMoney:'999',thirdPartyConsumeMoney:'999'});
    if(model===gpt && !usage.prompt_tokens_details){
      await assert.rejects(f.run(),error=>error.code==='xiaotao_dispatch_status_unknown');
      assert.deepEqual(f.events,['reserve','mark','provider']);
      continue;
    }
    const result=await f.run();assert.equal(result.ok,true);
    assert.deepEqual(f.events.slice(0,3),['reserve','mark','provider']);assert.equal(f.events.length,4);
    const settle=f.events[3][1],expected=settleXiaotaoOnlineCredits({usage,model});
    assert.equal(settle.pricingSource,'token_rate_estimate');assert.equal(settle.rhCostUsd,expected.usdCost);
    assert.equal(settle.settledCredits,expected.credits);assert.ok(settle.rhCostUsd<1);
    assert.equal(expected.tokenRateEstimate.cacheKnown,Boolean(usage.prompt_tokens_details));
    assert.equal(result.settlement.pricingSource,'token_rate_estimate');
    assert.equal(result.settlement.cacheKnown,Boolean(usage.prompt_tokens_details));
  }
});

test('revocation before dispatch releases, after marking preserves hold, and after response settles without showing output',async()=>{
  for(const boundary of ['reserve','mark','provider']){
    let current=true;
    const hooks={isCurrent:()=>current};hooks['on'+boundary[0].toUpperCase()+boundary.slice(1)]=()=>{current=false;};
    const f=await fixture(grok,complete,hooks);
    if(boundary==='reserve'){
      await assert.rejects(f.run(),error=>error.code==='selection-stale');
      assert.deepEqual(f.events,['reserve','release']);
    } else if(boundary==='mark'){
      await assert.rejects(f.run(),error=>error.code==='xiaotao_dispatch_status_unknown');
      assert.deepEqual(f.events,['reserve','mark']);
    } else {
      const result=await f.run();
      assert.equal(result.ok,false);assert.equal(result.errorCode,'cancelled-after-settlement');
      assert.deepEqual(f.events.slice(0,3),['reserve','mark','provider']);
      assert.equal(f.events[3][0],'settle');assert.equal(Object.hasOwn(result,'displayPrompt'),false);
    }
  }
});
