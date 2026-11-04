import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createCompanionPricingContext} from '../packages/shared/src/companion-pricing-context.mjs';
import {createControlPlane} from '../packages/shared/src/control-plane.mjs';

const model='xai/grok-4.7',intentId='0d2aa225-e027-4d20-8ef3-7b5d1a9bbfee';
const compiler={
  buildGrokPromptOptimizeRequest(_payload,selected){return {body:{model:selected,max_output_tokens:1536,input:[{role:'system',content:[{type:'input_text',text:'system'}]},{role:'user',content:[{type:'input_text',text:'safe prompt'}]}]},resultOptions:{artSemanticFusion:true,targetEngine:'gpt-image-2.5',completeVisualBrief:true}};},
  grokResponsesPublicResult(){return {output_text:'A red kitten sits on the green grass.',has_negative_prompt:false};}
};
const payload={stage:'structure',modelId:model,intentId,epoch:0,input:{currentPrompt:'A red kitten sits on grass.',targetEngine:'gpt-image-2.5',supportsNegativePrompt:false,nsfw:false}};

async function fixture({ready=true,enabled=false,envOnline,hooks={},operationV3,operationV3ForRequest}={}) {
  const events=[],seen=new Set();
  const provider={apiKey:'synthetic-test-key',baseUrl:'https://llm.runninghub.ai/v1',model,configRevision:'1'};
  const rpc=async(name,args)=>{
    events.push(name);
    if(name==='reserve_xiaotao_credits_v2'){
      await hooks.onReserve?.();
      if(seen.has(args.p_usage_key))return {status:'duplicate',idempotent:true};
      seen.add(args.p_usage_key);return {status:'reserved',idempotent:false,units:1,estimated_credits:args.p_estimated_credits,message_cap_credits:80,policy_version:args.p_policy_version};
    }
    if(name==='mark_xiaotao_art_dispatched_v2'){hooks.onMark?.();return {status:'dispatched',first_dispatch:true};}
    if(name==='settle_xiaotao_credits_v2')return {status:'settled',settled_credits:args.p_settled_credits};
    if(name==='release_feature_credits')return {status:'released'};
    throw Error('unexpected test RPC '+name);
  };
  const fetchImpl=async(_url,options)=>{events.push('synthetic-provider');hooks.onProvider?.();const body=JSON.parse(options.body);return Response.json({id:'fixture',model:body.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'safe fixture'}}],usage:{prompt_tokens:50,completion_tokens:10,total_tokens:60,prompt_tokens_details:{cached_tokens:0},thirdPartyConsumeMoney:'0.001'}});};
  const ctx=await createCompanionPricingContext({provider,dbSnapshot:ready?{protocol:'xiaotao-pricing-v2',config:{xiaotao_online:{message_cap_credits:80}},message_cap_credits:80}:null,envOnline,rpc,fetchImpl,
    ...(enabled?{artBusiness:{enabled:true,accountingReady:true,secret:Buffer.alloc(32,9),compiler,policyFor:()=> 'synthetic policy',...(operationV3ForRequest?{operationV3ForRequest}:operationV3?{operationV3ForRequest:async()=>operationV3}:{})}}:{})});
  const request={user:{id:'u1'},sessionId:'s1',payload,isCurrent:async()=>true};
  return {ctx,events,request};
}

test('art is closed without server opt-in or a valid pricing snapshot and never calls provider or ledger',async()=>{
  for(const args of [{},{ready:false,enabled:true}]){
    const f=await fixture(args);await assert.rejects(Promise.resolve().then(()=>f.ctx.artQuote(f.request)),e=>e.code==='art-business-unavailable');
    await assert.rejects(Promise.resolve().then(()=>f.ctx.artExecute(f.request)),e=>e.code==='art-business-unavailable');
    await assert.rejects(Promise.resolve().then(()=>f.ctx.artCancel(f.request)),e=>e.code==='art-business-unavailable');assert.deepEqual(f.events,[]);
  }
});
test('art operation adapter factory receives a fresh session verifier and raw DB snapshot per request',async()=>{
  const seen=[];
  const f=await fixture({enabled:true,envOnline:{markup:2},operationV3ForRequest:async args=>{seen.push(args);return undefined;}});
  const first=async()=>true,second=async()=>false;
  await f.ctx.artQuote({...f.request,isCurrent:first});
  await assert.rejects(f.ctx.artQuote({...f.request,isCurrent:second}));
  assert.equal(seen.length,2);assert.equal(seen[0].isCurrent,first);assert.equal(seen[1].isCurrent,second);
  assert.equal(seen[0].provider.creditConfig.xiaotao_online.markup,2);
  assert.equal(seen[0].provider.billingExpectedConfig.xiaotao_online.markup,undefined);
  seen[0].provider.billingExpectedConfig.xiaotao_online.message_cap_credits=1;
  assert.equal(seen[1].provider.billingExpectedConfig.xiaotao_online.message_cap_credits,80);
});
test('trusted opt-in operation adapter reaches the existing art factory; request fields cannot enable it',async()=>{
  const events=[],ports={
    bindArtPlan:async()=>{events.push('bind');return {status:'bound'};},acceptArtStructure:async()=>{events.push('accept-structure');return {status:'accepted'};},
    registerArtEnglish:async()=>({status:'bound'}),acceptArtEnglish:async()=>({status:'accepted'}),
    finalize:async({outcome})=>{events.push('finalize');return {status:'settled',outcome,charged:1,uncollected:0};}
  };
  const operationV3={enabled:true,ports,begin:async()=>({operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',intentHash:'d'.repeat(64)}),
    executePhase:async({run,requestHash,pricingVersion,model})=>{
      const {answer,decision}=await run({markProviderDispatched:async()=>events.push('dispatch')});events.push('record');
      return {status:'recorded',response:answer,decision,requestHash,pricingVersion,model};
    }};
  const f=await fixture({enabled:true,operationV3});
  const quote=await f.ctx.artQuote(f.request),result=await f.ctx.artExecute({...f.request,payload:{epoch:0,quoteToken:quote.quoteToken}});
  assert.equal(result.ok,true);assert.equal(result.settlement.settledCredits,1);
  assert.deepEqual(events,['bind','dispatch','record','accept-structure','finalize']);assert.deepEqual(f.events,['synthetic-provider']);
  const legacy=await fixture({enabled:true});
  const legacyQuote=await legacy.ctx.artQuote({...legacy.request,payload:{...payload,operationV3:{enabled:true}}});
  await legacy.ctx.artExecute({...legacy.request,payload:{epoch:0,quoteToken:legacyQuote.quoteToken,operationV3:{enabled:true}}});
  assert.ok(legacy.events.includes('settle_xiaotao_credits_v2'));assert.ok(!legacy.events.includes('bind_xiaotao_art_plan_v3'));
});

test('art cannot be enabled without a trusted live session verifier',async()=>{
  const provider={apiKey:'synthetic-test-key',baseUrl:'https://llm.runninghub.ai/v1',model,configRevision:'1'};
  const rpc=async()=>{throw Error('ledger must not run');};
  const ctx=await createCompanionPricingContext({provider,dbSnapshot:{protocol:'xiaotao-pricing-v2',config:{xiaotao_online:{message_cap_credits:80}},message_cap_credits:80},rpc,
    artBusiness:{enabled:true,accountingReady:true,secret:Buffer.alloc(32,9),compiler,policyFor:()=> 'synthetic policy',isCurrent:async()=>true}});
  await assert.rejects(ctx.artQuote({user:{id:'u1'},sessionId:'s1',payload}),error=>error.code==='accounting-unavailable');
});
test('v2-only art rejects v3 pending cancellation as unavailable',async()=>{
  const f=await fixture({enabled:true});
  await assert.rejects(f.ctx.artCancel({...f.request,payload:{epoch:0,stageToken:'fixture'}}),e=>e.code==='operation-billing-disabled'&&e.status===503);
  assert.deepEqual(f.events,[]);
});

test('synthetic opt-in uses one versioned quote, reserve, dispatch and settlement; replay never sends twice',async()=>{
  const f=await fixture({enabled:true});
  const quote=await f.ctx.artQuote(f.request);assert.equal(quote.model,model);assert.equal(quote.maxOutputTokens,1536);assert.deepEqual(f.events,[]);
  const request={...f.request,payload:{epoch:0,quoteToken:quote.quoteToken}};
  const result=await f.ctx.artExecute(request);assert.equal(result.ok,true);assert.equal(result.reviewRequired,true);
  assert.deepEqual(f.events,['reserve_xiaotao_credits_v2','mark_xiaotao_art_dispatched_v2','synthetic-provider','settle_xiaotao_credits_v2']);
  await assert.rejects(f.ctx.artExecute(request));assert.equal(f.events.filter(x=>x==='synthetic-provider').length,1);
});

test('context retains the existing explicit allowlist; art injection cannot authorize an unlisted paid model',async()=>{
  const f=await fixture({enabled:true,envOnline:{enabled_models:[]}});
  await assert.rejects(f.ctx.artQuote({...f.request,payload:{...payload,modelId:'openai/gpt-6.1-sol-saver'}}));
  assert.deepEqual(f.events,[]);
});

test('control plane propagates each verified session closure through pricing context to the dispatch guard',async()=>{
  const secret='synthetic-session-secret';
  const encoded=Buffer.from(JSON.stringify({sub:'u1',sid:'s1',exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
  const headers={authorization:'Bearer nfs_'+encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url')};
  for(const boundary of ['reserve','mark','provider']){
    let live=true;
    const hooks={};hooks['on'+boundary[0].toUpperCase()+boundary.slice(1)]=()=>{live=false;};
    const f=await fixture({enabled:true,hooks});
    const store={getUserById:async id=>id==='u1'?{id,status:'active'}:null,
      getUserSession:async id=>({id,user_id:'u1',revoked_at:live?null:'2020-01-01T00:00:00Z'})};
    const plane=createControlPlane({store,secrets:{sessionSecret:secret},companion:f.ctx});
    const quoted=await plane.handle({method:'POST',path:'/api/web/companion/art/quote',headers,body:payload});
    assert.equal(quoted.status,200);assert.deepEqual(f.events,[]);
    const result=await plane.handle({method:'POST',path:'/api/web/companion/art/execute',headers,
      body:{quoteToken:quoted.body.quote.quoteToken,epoch:0,isCurrent:true}});
    if(boundary==='reserve'){
      assert.equal(result.body.code,'selection-stale');
      assert.deepEqual(f.events,['reserve_xiaotao_credits_v2','release_feature_credits']);
    }else if(boundary==='mark'){
      assert.equal(result.body.code,'xiaotao_dispatch_status_unknown');
      assert.deepEqual(f.events,['reserve_xiaotao_credits_v2','mark_xiaotao_art_dispatched_v2']);
    }else{
      assert.equal(result.body.ok,false);assert.equal(result.body.errorCode,'cancelled-after-settlement');
      assert.deepEqual(f.events,['reserve_xiaotao_credits_v2','mark_xiaotao_art_dispatched_v2','synthetic-provider','settle_xiaotao_credits_v2']);
      assert.equal(Object.hasOwn(result.body,'displayPrompt'),false);
    }
  }
});

test('a shared context keeps concurrent sessions bound to their own freshness checks',async()=>{
  const secret='synthetic-session-secret';
  const headersFor=sid=>{
    const encoded=Buffer.from(JSON.stringify({sub:'u1',sid,exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
    return {authorization:'Bearer nfs_'+encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url')};
  };
  let firstEntered,unblockFirst,revokedFirst=false,reserves=0;
  const entered=new Promise(resolve=>{firstEntered=resolve;}),barrier=new Promise(resolve=>{unblockFirst=resolve;});
  const f=await fixture({enabled:true,hooks:{onReserve:async()=>{if(++reserves===1){firstEntered();await barrier;}}}});
  const store={getUserById:async id=>({id,status:'active'}),getUserSession:async id=>({id,user_id:'u1',revoked_at:id==='s1'&&revokedFirst?'2020-01-01T00:00:00Z':null})};
  const plane=createControlPlane({store,secrets:{sessionSecret:secret},companion:f.ctx});
  const quote=async(sid,intentId)=>plane.handle({method:'POST',path:'/api/web/companion/art/quote',headers:headersFor(sid),body:{...payload,intentId}});
  const a=await quote('s1',intentId),b=await quote('s2','4fbdc5f7-80d4-49a5-9d15-a5ba9e33b4bf');
  assert.equal(a.status,200);assert.equal(b.status,200);
  const execute=(sid,q)=>plane.handle({method:'POST',path:'/api/web/companion/art/execute',headers:headersFor(sid),body:{epoch:0,quoteToken:q.body.quote.quoteToken}});
  const first=execute('s1',a);await entered;
  const second=await execute('s2',b);assert.equal(second.body.ok,true);
  revokedFirst=true;unblockFirst();const result=await first;
  assert.equal(result.body.code,'selection-stale');
  assert.equal(f.events.filter(x=>x==='synthetic-provider').length,1);
  assert.equal(f.events.filter(x=>x==='settle_xiaotao_credits_v2').length,1);
  assert.equal(f.events.filter(x=>x==='release_feature_credits').length,1);
});
