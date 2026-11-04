import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanionOperationV3Assembly} from '../packages/shared/src/companion-operation-v3-assembly.mjs';
import {createCompanionPricingContext} from '../packages/shared/src/companion-pricing-context.mjs';

const secret=Buffer.alloc(32,7),user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},sessionId='fixture-session';
const nonce='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',model='xai/grok-4.7';
const intent={mode:'chat',requestId:'request_123',message:'整理提示词',history:[],promptLanguage:'zh-CN'};
const provider={apiKey:'synthetic-only',baseUrl:'https://llm.runninghub.ai/v1',model,configRevision:'1'};
const dbSnapshot={protocol:'xiaotao-pricing-v2',config:{xiaotao_online:{message_cap_credits:80}},message_cap_credits:80};
function ledger(){
  let status,raw=0;const events=[],assessments=[];
  return {events,assessments,rpc:async(name,args)=>{
    if(name==='get_xiaotao_operation_v3_gate_state')return {enforced:true};
    events.push(name);
    if(name==='claim_xiaotao_operation_route_v3')return {route:'v3',idempotent:false};
    if(name==='reserve_xiaotao_operation_stage_v3'){
      if(status)return {status,idempotent:true};status='reserved';return {status,idempotent:false};
    }
    if(name==='mark_xiaotao_operation_stage_dispatched_v3'){assert.equal(status,'reserved');status='dispatched';return {status,first_dispatch:true};}
    if(name==='record_xiaotao_operation_stage_usage_v3'){assert.equal(status,'dispatched');raw=args.p_raw_credits;assessments.push(args);status='recorded';return {status,idempotent:false};}
    if(name==='finalize_xiaotao_operation_v3'){const charged=status==='recorded'?Math.max(1,Math.ceil(raw)):0;status='settled';return {status,outcome:args.p_outcome,charged};}
    throw Error('unexpected RPC '+name);
  }};
}
async function setup(fetchImpl){
  const db=ledger(),operationV3=createCompanionOperationV3Assembly({enabled:true,secret,fetchImpl});
  const ctx=await createCompanionPricingContext({provider,dbSnapshot,rpc:db.rpc,operationV3});
  const common={user,sessionId,isCurrent:async()=>true};
  const prepared=await ctx.prepareXiaotaoOperationV3({...common,payload:{nonce,model,intent}});
  return {db,ctx,prepared,execute:()=>ctx.executeXiaotaoOperationV3({...common,payload:{operationToken:prepared.token,intent}})};
}
test('assembly stays closed unless trusted server explicitly opts in',async()=>{
  assert.deepEqual(createCompanionOperationV3Assembly(),{enabled:false});
  assert.throws(()=>createCompanionOperationV3Assembly({enabled:true,secret:Buffer.alloc(4)}),e=>e.code==='operation-billing-unavailable');
  assert.throws(()=>createCompanionOperationV3Assembly({enabled:true,secret,foartGeneralEnabled:true}),e=>e.code==='operation-billing-unavailable');
});
test('trusted assembly routes a prepared request to the selected model and records assessed usage once',async()=>{
  let calls=0,wire;
  const f=await setup(async(url,options)=>{calls++;assert.equal(url,'https://llm.runninghub.ai/v1/chat/completions');
    wire=JSON.parse(options.body);return new Response(JSON.stringify({model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'整理完成'}}],
      usage:{prompt_tokens:80,completion_tokens:20,total_tokens:100}}),{status:200,headers:{'content-type':'application/json'}});
  });
  const policy=await f.ctx.pricing();assert.equal(policy.config.xiaotao_online.operation_text_chat_v3,true);
  const result=await f.execute();assert.equal(result.reply,'整理完成');assert.equal(result.receipt.charged,1);
  assert.equal(wire.model,model);assert.equal(calls,1);
  assert.deepEqual(f.db.events,['claim_xiaotao_operation_route_v3','reserve_xiaotao_operation_stage_v3',
    'mark_xiaotao_operation_stage_dispatched_v3','record_xiaotao_operation_stage_usage_v3','finalize_xiaotao_operation_v3']);
  await assert.rejects(f.execute(),e=>e.code==='operation-status-unknown');assert.equal(calls,1);
});
test('DeepSeek v3 requires the explicit server allowlist and settles one exact-model request',async()=>{
  const ds='deepseek/deepseek-v4.1-flash';let calls=0;
  const fetchImpl=async(_url,options)=>{calls++;assert.equal(JSON.parse(options.body).model,ds);
    return new Response(JSON.stringify({model:ds,choices:[{finish_reason:'stop',message:{role:'assistant',content:'fixture'}}],
      usage:{prompt_tokens:80,completion_tokens:20,total_tokens:100,prompt_cache_hit_tokens:60,prompt_cache_miss_tokens:20}}),{status:200,headers:{'content-type':'application/json'}});};
  const db=ledger(),operationV3=createCompanionOperationV3Assembly({enabled:true,secret,fetchImpl});
  const common={user,sessionId,isCurrent:async()=>true};
  // An explicit empty server allowlist closes DeepSeek. An absent overlay
  // instead keeps the already-deployed 253 defaults.
  const closed=await createCompanionPricingContext({provider,dbSnapshot,rpc:db.rpc,operationV3,envOnline:{enabled_models:[]}});
  assert.equal((await closed.pricing()).models.find(x=>x.id===ds).available,false);
  await assert.rejects(closed.prepareXiaotaoOperationV3({...common,payload:{nonce,model:ds,intent}}),e=>e.code==='operation-model-unavailable');
  assert.equal(calls,0);assert.deepEqual(db.events,[]);
  const ctx=await createCompanionPricingContext({provider,dbSnapshot,rpc:db.rpc,operationV3,envOnline:{enabled_models:[ds]}});
  assert.equal((await ctx.pricing()).models.find(x=>x.id===ds).available,true);
  const prepared=await ctx.prepareXiaotaoOperationV3({...common,payload:{nonce,model:ds,intent}});
  const payload={operationToken:prepared.token,intent};
  const result=await ctx.executeXiaotaoOperationV3({...common,payload});
  assert.equal(result.model,ds);assert.equal(result.receipt.charged,1);assert.equal(calls,1);
  const expectedUsd=(20*.177+60*.0036+20*.7062)/1e6;
  assert.ok(Math.abs(db.assessments[0].p_usd_cost-expectedUsd)<1e-12);
  assert.equal(db.assessments[0].p_usage.records[0].input_tokens_details.cached_tokens,60);
  await assert.rejects(ctx.executeXiaotaoOperationV3({...common,payload}),e=>e.code==='operation-status-unknown');
  assert.equal(calls,1);
});
test('DeepSeek conflicting cache usage stays pending and cannot call the provider twice',async()=>{
  const ds='deepseek/deepseek-v4.1-flash';let calls=0;
  const fetchImpl=async()=>{calls++;return new Response(JSON.stringify({model:ds,
    choices:[{finish_reason:'stop',message:{role:'assistant',content:'fixture'}}],
    usage:{prompt_tokens:80,completion_tokens:20,total_tokens:100,prompt_tokens_details:{cached_tokens:59},prompt_cache_hit_tokens:60,prompt_cache_miss_tokens:20}}),
    {status:200,headers:{'content-type':'application/json'}});};
  const db=ledger(),operationV3=createCompanionOperationV3Assembly({enabled:true,secret,fetchImpl});
  const ctx=await createCompanionPricingContext({provider,dbSnapshot,rpc:db.rpc,operationV3,envOnline:{enabled_models:[ds]}});
  const common={user,sessionId,isCurrent:async()=>true};
  const prepared=await ctx.prepareXiaotaoOperationV3({...common,payload:{nonce,model:ds,intent}});
  const payload={operationToken:prepared.token,intent};
  await assert.rejects(ctx.executeXiaotaoOperationV3({...common,payload}),e=>e.code==='operation-status-unknown');
  assert.equal(calls,1);assert.deepEqual(db.events,['claim_xiaotao_operation_route_v3','reserve_xiaotao_operation_stage_v3','mark_xiaotao_operation_stage_dispatched_v3']);
  await assert.rejects(ctx.executeXiaotaoOperationV3({...common,payload}),e=>e.code==='operation-status-unknown');
  assert.equal(calls,1);assert.deepEqual(db.assessments,[]);
});
test('a retryable provider error after dispatch stays unknown and is never retried',async()=>{
  let calls=0;const f=await setup(async()=>{calls++;return new Response(JSON.stringify({code:421}),{status:503});});
  await assert.rejects(f.execute(),e=>e.code==='operation-status-unknown');assert.equal(calls,1);
  await assert.rejects(f.execute(),e=>e.code==='operation-status-unknown');assert.equal(calls,1);
  assert.deepEqual(f.db.events.slice(0,3),['claim_xiaotao_operation_route_v3','reserve_xiaotao_operation_stage_v3','mark_xiaotao_operation_stage_dispatched_v3']);
});
test('unsafe provider host is rejected before any RPC or network request',async()=>{
  let calls=0;const factory=createCompanionOperationV3Assembly({enabled:true,secret,fetchImpl:async()=>{calls++;throw Error();}});
  await assert.rejects(factory.createHandlers({provider:{...provider,baseUrl:'https://example.invalid/v1'},rpc:async()=>{calls++;}}));
  assert.equal(calls,0);
});
test('vision and the narrow Foart planner are advertised only by trusted server opt-in',async()=>{
  const rpc=async(name)=>{if(name==='get_xiaotao_operation_v3_gate_state')return {enforced:true};throw Error('unexpected RPC');};
  const factory=createCompanionOperationV3Assembly({enabled:true,secret,visionEnabled:true,foartOpenEnabled:true,foartGeneralEnabled:true});
  const ctx=await createCompanionPricingContext({provider,dbSnapshot,rpc,operationV3:factory});
  const policy=await ctx.pricing();
  assert.equal(policy.config.xiaotao_online.operation_vision_chat_v3,true);
  assert.equal(policy.config.xiaotao_online.operation_foart_open_v3,true);
  assert.equal(policy.config.xiaotao_online.operation_foart_general_v3,true);
  for(const name of ['prepare','start','resume','cancel'])assert.equal(typeof ctx.foartOperation[name],'function');
  const closed=await createCompanionPricingContext({provider,dbSnapshot,rpc,operationV3:createCompanionOperationV3Assembly()});
  assert.equal((await closed.pricing()).config.xiaotao_online.operation_text_chat_v3,undefined);
  assert.equal(closed.foartOperation,undefined);
});
