import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createXiaotaoV3FoartJournal as create} from '../packages/shared/src/xiaotao-operation-v3-foart-journal.mjs';
const hash=x=>createHash('sha256').update(x,'utf8').digest('hex');
const policyText=JSON.stringify({schema:'nf.xiaotao.pricing.v1',config:{},models:[]});
const actor={userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId:'session',operationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  model:'xai/grok-4.7',policyVersion:'sha256:'+hash(policyText),intentHash:'c'.repeat(64)};
const context=()=>({schema:'nf.foart.tool-plan.v1',controls:[],projectName:'PRIVATE FIXTURE'});
const plan=()=>({schema:'nf.foart.tool-plan.v1',status:'act',reply:'PRIVATE MODEL REPLY',operations:[{action:'open',surface:'animation'}]});
function fixture(){const calls=[];const rpc=async(name,args)=>{calls.push({name,args});if(name==='record_xiaotao_foart_plan_v3')return {status:'recorded',planHash:args.p_plan_hash,idempotent:false};return {ok:true};};return {calls,api:create({enabled:true,rpc})};}
test('journal defaults closed and only server-validated plans may be registered',async()=>{
  await assert.rejects(create().recordPlan({}),e=>e.code==='operation-billing-disabled');
  const f=fixture();
  for(const bad of [{...plan(),operations:[{action:'open',surface:'unknown'}]},
    {...plan(),operations:[{action:'open',surface:'animation'},{action:'open',surface:'drawing'}]},
    {...plan(),status:'reply',operations:[]}])
    await assert.rejects(f.api.recordPlan({actor,sequence:1,phaseId:'foart_1',requestHash:'a'.repeat(64),plan:bad,context:context()}));
  assert.equal(f.calls.length,0);
});
test('only a plan hash, context hash, and validated target reach the database',async()=>{
  const f=fixture(),result=await f.api.recordPlan({actor,sequence:1,phaseId:'foart_1',requestHash:'a'.repeat(64),plan:plan(),context:context()});
  const call=f.calls[0];assert.equal(result.planHash,hash(JSON.stringify(plan())));assert.equal(result.contextHash,hash(JSON.stringify(context())));
  assert.equal(call.args.p_surface,'animation');assert.equal(call.args.p_plan_hash,result.planHash);assert.equal(call.args.p_context_hash,result.contextHash);
  assert.ok(!JSON.stringify(call).includes('PRIVATE'));assert.ok(!Object.hasOwn(call.args,'p_context_text'));assert.ok(!Object.hasOwn(call.args,'p_plan_text'));
  await assert.rejects(f.api.recordPlan({actor,sequence:1,phaseId:'foart_1',requestHash:'a'.repeat(64),plan:plan(),context:{...context(),imageUrl:'data:image/png;base64,AAAA'}}),e=>e.code==='foart-media-consent-required');
  assert.equal(f.calls.length,1);
});
test('snapshot, recorded phase and atomic next phase retain actor and server-derived terms',async()=>{
  const f=fixture();await f.api.loadPolicySnapshot(actor);await f.api.loadRecordedPhase({...actor,sequence:1});
  await f.api.claimNext({...actor,sequence:2,phaseId:'foart_2',phaseKind:'planner',feature:'online_chat_turn',requestHash:'a'.repeat(64),
    previousPlanHash:'b'.repeat(64),estimatedCredits:3,phaseCap:80,roundMode:'ceil',expectedConfig:{},policySnapshotText:policyText});
  assert.deepEqual(f.calls.map(c=>c.name),['get_xiaotao_operation_snapshot_v3','load_xiaotao_foart_plan_v3','claim_xiaotao_foart_next_v3']);
  const args=f.calls.at(-1).args;assert.equal(args.p_previous_sequence,1);assert.equal(args.p_estimated_credits,3);
  assert.equal(args.p_usage_key,`xiaotao-v3:${actor.operationId}:foart_2`);
  await assert.rejects(f.api.claimNext({...actor,sequence:2,phaseId:'foart_2',phaseKind:'planner',feature:'online_chat_turn',requestHash:'a'.repeat(64),
    previousPlanHash:'b'.repeat(64),estimatedCredits:81,phaseCap:80,roundMode:'ceil',expectedConfig:{},policySnapshotText:policyText}),e=>e.code==='invalid-foart-stage');
  assert.equal(f.calls.length,3);
});
test('journal accepts fractional holds only when the frozen snapshot and config agree',async()=>{
 const amount={credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0};
 const text=JSON.stringify({schema:'nf.xiaotao.pricing.v1',config:{xiaotao_online:amount},models:[]});
 const decimalActor={...actor,policyVersion:'sha256:'+hash(text)};
 const base={...decimalActor,sequence:2,phaseId:'foart_2',phaseKind:'planner',feature:'online_chat_turn',requestHash:'a'.repeat(64),
  previousPlanHash:'b'.repeat(64),estimatedCredits:0.000001,phaseCap:80,roundMode:'ceil',expectedConfig:{xiaotao_online:amount},policySnapshotText:text};
 const f=fixture();await f.api.claimNext(base);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.p_estimated_credits,0.000001);
 for(const changes of [{estimatedCredits:0.0000001},{expectedConfig:{xiaotao_online:{...amount,credit_precision:5}}},
   {expectedConfig:{}},{estimatedCredits:81}]) {
   await assert.rejects(f.api.claimNext({...base,...changes}),e=>e.code==='invalid-foart-stage');
 }
 assert.equal(f.calls.length,1);
});
