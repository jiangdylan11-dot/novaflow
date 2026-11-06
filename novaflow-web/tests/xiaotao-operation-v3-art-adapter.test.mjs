import test from 'node:test';
import assert from 'node:assert/strict';
import {createXiaotaoV3ArtAdapter} from '../packages/shared/src/xiaotao-operation-v3-art-adapter.mjs';
import {companionPricingPolicy} from '../packages/shared/src/companion-pricing.mjs';

const model='xai/grok-4.7', actor={userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId:'s1',epoch:0};
const nonce='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',hash='a'.repeat(64);
const provider={apiKey:'synthetic',model,configRevision:'1',pricingSnapshotReady:true,creditConfig:{xiaotao_online:{message_cap_credits:80}},billingExpectedConfig:{xiaotao_online:{markup:1.2}}};
const usage={billing_token_usage_invalid:false,input_tokens:50,output_tokens:10,total_tokens:60};
const answer={model,usage};
async function fixture(hook=()=>undefined) {
  const calls=[];
  const rpc=async(name,args)=>{calls.push({name,args});const override=await hook(name,args);if(override!==undefined)return override;
    if(name==='reserve_xiaotao_operation_stage_v3')return {status:'reserved',idempotent:false};
    if(name==='mark_xiaotao_operation_stage_dispatched_v3')return {status:'dispatched',first_dispatch:true};
    if(name==='record_xiaotao_operation_stage_usage_v3')return {status:'recorded'};
    if(name==='finalize_xiaotao_operation_v3')return {status:'settled',outcome:'cancel',charged:0};
    return {status:'bound'};};
  const policy=await companionPricingPolicy(provider);
  const adapter=await createXiaotaoV3ArtAdapter({enabled:true,provider,rpc,secret:Buffer.alloc(32,7),isCurrent:async()=>true});
  const op=await adapter.begin({actor,model,nonce,pricingVersion:policy.version,structureHash:hash});
  const trustedActor={...actor,...op,model,policyVersion:policy.version};
  const args={actor:trustedActor,operationId:op.operationId,model,stage:'structure',imageCount:1,requestHash:hash,
    pricingVersion:policy.version,estimatedCredits:2};
  return {adapter,calls,args};
}
test('art adapter defaults closed',async()=>{
  assert.deepEqual(await createXiaotaoV3ArtAdapter(),{enabled:false});
});
test('art phase reserves, marks and records trusted usage without settling early',async()=>{
  const f=await fixture();let sends=0;
  const result=await f.adapter.executePhase({...f.args,run:async({markProviderDispatched})=>{await markProviderDispatched();sends++;return {answer,decision:{usageMissing:false}};}});
  assert.equal(sends,1);assert.equal(result.status,'recorded');
  assert.deepEqual(f.calls.map(x=>x.name),['reserve_xiaotao_operation_stage_v3','mark_xiaotao_operation_stage_dispatched_v3','record_xiaotao_operation_stage_usage_v3']);
  assert.equal(f.calls[0].args.p_expected_config.xiaotao_online.markup,1.2);
  assert.equal(f.calls[0].args.p_phase_kind,'structure');assert.equal(f.calls[0].args.p_feature,'xiaotao_vision');
});
test('duplicate reservation or uncertain dispatch never invokes provider again or releases hold',async()=>{
  let sends=0;const duplicate=await fixture(name=>name==='reserve_xiaotao_operation_stage_v3'?{status:'reserved',idempotent:true}:undefined);
  await assert.rejects(duplicate.adapter.executePhase({...duplicate.args,run:async()=>{sends++;}}),e=>e.code==='operation-status-unknown');
  assert.equal(sends,0);
  const uncertain=await fixture(name=>{if(name==='mark_xiaotao_operation_stage_dispatched_v3')throw Error('timeout');});
  await assert.rejects(uncertain.adapter.executePhase({...uncertain.args,run:async({markProviderDispatched})=>{await markProviderDispatched();sends++;}}),e=>e.code==='operation-status-unknown');
  assert.equal(sends,0);assert.equal(uncertain.calls.some(x=>x.name==='finalize_xiaotao_operation_v3'),false);
});
test('a failure before dispatch settles cancellation instead of leaving a reservation',async()=>{
  const f=await fixture();
  await assert.rejects(f.adapter.executePhase({...f.args,run:async()=>{throw Error('cancelled');}}),e=>e.code==='cancelled-before-dispatch'&&e.receipt.status==='settled');
  assert.deepEqual(f.calls.map(x=>x.name),['reserve_xiaotao_operation_stage_v3','finalize_xiaotao_operation_v3']);
});
test('a model failure after dispatch releases the hold and closes the operation at 0',async()=>{
  const f=await fixture(name=>name==='reject_xiaotao_operation_stage_v3'?{status:'rejected',idempotent:false}:
    name==='finalize_xiaotao_operation_v3_refund'?{status:'settled',outcome:'cancel',charged:0,uncollected:0,refunded:true}:undefined);
  await assert.rejects(f.adapter.executePhase({...f.args,run:async({markProviderDispatched})=>{await markProviderDispatched();
    throw Object.assign(Error('在线模型响应超时'),{statusCode:504,code:'ETIMEDOUT'});}}),
    e=>e.code==='provider-failed'&&e.receipt.status==='settled'&&e.receipt.charged===0);
  assert.deepEqual(f.calls.map(x=>x.name),['reserve_xiaotao_operation_stage_v3','mark_xiaotao_operation_stage_dispatched_v3','reject_xiaotao_operation_stage_v3','finalize_xiaotao_operation_v3_refund']);
  const reject=f.calls[2].args;assert.equal(reject.p_phase_id,'structure');assert.equal(reject.p_request_hash,hash);assert.equal(reject.p_no_charge_evidence.reason,'ETIMEDOUT');
});
test('usage that cannot be recorded is refunded too; an unclear rejection keeps the hold',async()=>{
  const f=await fixture(name=>name==='record_xiaotao_operation_stage_usage_v3'?Promise.reject(Error('invalid usage')):
    name==='reject_xiaotao_operation_stage_v3'?{status:'rejected',idempotent:false}:
    name==='finalize_xiaotao_operation_v3_refund'?{status:'settled',outcome:'cancel',charged:0,uncollected:0}:undefined);
  await assert.rejects(f.adapter.executePhase({...f.args,run:async({markProviderDispatched})=>{await markProviderDispatched();return {answer,decision:{usageMissing:false}};}}),e=>e.code==='provider-failed');
  const held=await fixture(name=>{if(name==='reject_xiaotao_operation_stage_v3')throw Error('timeout');});
  await assert.rejects(held.adapter.executePhase({...held.args,run:async({markProviderDispatched})=>{await markProviderDispatched();throw Error('provider down');}}),e=>e.code==='operation-status-unknown');
  assert.equal(held.calls.some(x=>x.name.startsWith('finalize_')),false);
});
