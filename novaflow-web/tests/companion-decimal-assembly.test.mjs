import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanionOperationV3Assembly} from '../packages/shared/src/companion-operation-v3-assembly.mjs';
import {createCompanionPricingContext} from '../packages/shared/src/companion-pricing-context.mjs';
import {ceilXiaotaoLedgerCredit} from '../packages/shared/src/xiaotao-decimal-usage.mjs';

const amount={credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0};
const ds='deepseek/deepseek-v4.1-flash';
const user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},sessionId='fixture-session';
const nonce='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const intent={mode:'chat',requestId:'decimal-assembly-1',message:'hello',history:[],promptLanguage:'en'};
const provider={apiKey:'synthetic-only',baseUrl:'https://llm.runninghub.ai/v1',model:'xai/grok-4.7',configRevision:'1'};
const dbSnapshot={protocol:'xiaotao-pricing-v2',config:{credits_per_usd:211,xiaotao_online:{markup:1.5,message_cap_credits:80,...amount}},message_cap_credits:80};

function harness({readiness={ready:true,protocol:'nf.xiaotao.decimal.v1',credit_precision:6},decimal=true,snapshot=dbSnapshot,envOnline={enabled_models:[ds]}}={}) {
  const calls=[],seen={provider:0};let raw='0',stage;
  const rpc=async(name,args)=>{
    calls.push({name,args});
    if(name==='get_xiaotao_operation_v3_gate_state')return {enforced:true};
    if(name==='get_xiaotao_decimal_v1_readiness') {if(readiness instanceof Error)throw readiness;return readiness;}
    if(name==='claim_xiaotao_operation_route_v3')return {route:'v3',idempotent:false};
    if(name==='reserve_xiaotao_operation_stage_v3'){stage='reserved';return {status:'reserved',idempotent:false};}
    if(name==='mark_xiaotao_operation_stage_dispatched_v3'){assert.equal(stage,'reserved');stage='dispatched';return {status:'dispatched',first_dispatch:true};}
    if(name==='record_xiaotao_operation_stage_usage_v3'){assert.equal(stage,'dispatched');raw=args.p_raw_credits;stage='recorded';return {status:'recorded'};}
    if(name==='finalize_xiaotao_operation_v3'){assert.equal(stage,'recorded');return {status:'settled',outcome:args.p_outcome,charged:ceilXiaotaoLedgerCredit(raw),...amount};}
    throw Error('unexpected RPC '+name);
  };
  const fetchImpl=async(_url,options)=>{seen.provider++;assert.equal(JSON.parse(options.body).model,ds);
    return new Response(JSON.stringify({model:ds,choices:[{finish_reason:'stop',message:{role:'assistant',content:'ok'}}],
      usage:{prompt_tokens:1,completion_tokens:0,total_tokens:1,prompt_tokens_details:{cached_tokens:1}}}),{status:200});};
  const operationV3=createCompanionOperationV3Assembly({enabled:true,decimalCreditsEnabled:decimal,secret:Buffer.alloc(32,7),fetchImpl});
  return {calls,seen,rpc,operationV3,async context(){return createCompanionPricingContext({provider,dbSnapshot:snapshot,envOnline,rpc,operationV3});}};
}

test('real provider assembly uses verified DB readiness for matching decimal quote and stage hold',async()=>{
  const h=harness(),ctx=await h.context(),policy=await ctx.pricing();
  assert.equal(policy.config.xiaotao_online.credit_amount_policy,'decimal-v1');
  assert.equal(policy.config.xiaotao_online.minimum_positive_credits,0);
  const quoted=await ctx.quote({payload:{...intent,modelId:ds}});
  assert.ok(quoted.estimatedCredits>0&&quoted.estimatedCredits<1);
  const common={user,sessionId,isCurrent:async()=>true};
  const op=await ctx.prepareXiaotaoOperationV3({...common,payload:{nonce,model:ds,intent}});
  const result=await ctx.executeXiaotaoOperationV3({...common,payload:{operationToken:op.token,intent}});
  const hold=h.calls.find(call=>call.name==='reserve_xiaotao_operation_stage_v3');
  const recorded=h.calls.find(call=>call.name==='record_xiaotao_operation_stage_usage_v3');
  assert.equal(hold.args.p_estimated_credits,quoted.estimatedCredits);
  assert.equal(recorded.args.p_usd_cost,'0.0000000036');
  assert.equal(recorded.args.p_raw_credits,'0.0000011394');
  assert.equal(result.receipt.charged,0.000002);assert.equal(h.seen.provider,1);
});

test('missing or mismatched DB readiness never publishes a chargeable decimal model',async()=>{
  for(const opts of [{readiness:new Error('missing function')},{readiness:{ready:false,protocol:'nf.xiaotao.decimal.v1',credit_precision:6}},
    {readiness:{ready:true,protocol:'other',credit_precision:6}},{decimal:false},
    {envOnline:{enabled_models:[ds],credit_precision:5}}]) {
    const h=harness(opts),ctx=await h.context(),policy=await ctx.pricing();
    assert.equal(policy.models.find(row=>row.id===ds).available,false);
    await assert.rejects(ctx.quote({payload:{...intent,modelId:ds}}));
    assert.equal(h.seen.provider,0);
  }
});

test('legacy assembly does not query decimal readiness or change old policy',async()=>{
  const snapshot={protocol:'xiaotao-pricing-v2',config:{xiaotao_online:{message_cap_credits:80}},message_cap_credits:80};
  const h=harness({decimal:false,snapshot}),ctx=await h.context(),policy=await ctx.pricing();
  assert.equal(policy.config.xiaotao_online.minimum_positive_credits,1);
  assert.equal(policy.config.xiaotao_online.credit_amount_policy,undefined);
  assert.equal(h.calls.some(call=>call.name==='get_xiaotao_decimal_v1_readiness'),false);
});
