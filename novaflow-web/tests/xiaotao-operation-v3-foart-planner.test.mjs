import test from 'node:test';
import assert from 'node:assert/strict';
import {createXiaotaoV3FoartPlanner as create} from '../packages/shared/src/xiaotao-operation-v3-foart-planner.mjs';
import {ceilXiaotaoLedgerCredit} from '../packages/shared/src/xiaotao-decimal-usage.mjs';

const actor={userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId:'session'},nonce='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',model='xai/grok-4.7';
const schema='nf.foart.tool-plan.v1',secret=Buffer.alloc(32,7),context=()=>({schema,controls:[],projectName:'SYNTHETIC PRIVATE PROJECT'});
const intent=()=>({message:'Open the animation workspace, then report the state.',history:[],promptLanguage:'zh-CN'});
const planOpen=()=>({schema,status:'act',reply:'Opening animation.',operations:[{action:'open',surface:'animation'}]});
const planDone=()=>({schema,status:'done',reply:'The animation workspace is open.',operations:[]});
const provider=()=>({apiKey:'fixture',model,configRevision:'1',pricingSnapshotReady:true,creditConfig:{},operationTextChatV3:true,operationFoartOpenV3:true,operationFoartGeneralV3:true});
function ledger(){
  const operations=new Map(),calls=[];
  const rpc=async(name,args)=>{
    calls.push({name,args:structuredClone(args)});const id=args.p_operation_id;
    if(name==='claim_xiaotao_operation_route_v3')return {route:'v3',idempotent:false};
    if(name==='reserve_xiaotao_operation_stage_v3'){
      if(operations.has(id))return {status:'reserved',idempotent:true};
      operations.set(id,{status:'open',snapshot:{status:'open',policy_version:args.p_policy_version,policy_snapshot_text:args.p_policy_snapshot_text,
        expected_config:args.p_expected_config,phase_cap:args.p_expected_cap,round_mode:args.p_round_mode},stages:new Map([[args.p_phase_id,{status:'reserved'}]])});
      return {status:'reserved',idempotent:false};
    }
    const operation=operations.get(id);if(!operation)throw Error('missing operation');
    if(name==='get_xiaotao_operation_snapshot_v3')return operation.snapshot;
    if(name==='mark_xiaotao_operation_stage_dispatched_v3'){
      const stage=operation.stages.get(args.p_phase_id);if(stage.status!=='reserved')return {status:stage.status,first_dispatch:false};
      stage.status='dispatched';return {status:'dispatched',first_dispatch:true};
    }
    if(name==='record_xiaotao_operation_stage_usage_v3'){
      const stage=operation.stages.get(args.p_phase_id);if(stage.status!=='dispatched')throw Error('not dispatched');
      stage.status='recorded';stage.raw=args.p_raw_credits;return {status:'recorded'};
    }
    if(name==='record_xiaotao_foart_plan_v3'){
      const stage=operation.stages.get(args.p_phase_id);if(stage?.status!=='recorded')throw Error('not recorded');
      operation.journal={recorded:true,sequence:args.p_sequence,userId:args.p_user_id,sessionId:args.p_session_id,operationId:id,
        model:args.p_model,policyVersion:args.p_policy_version,intentHash:args.p_intent_hash,planHash:args.p_plan_hash,contextHash:args.p_context_hash,surface:args.p_surface};
      return {status:'recorded',planHash:args.p_plan_hash,idempotent:false};
    }
    if(name==='load_xiaotao_foart_plan_v3')return operation.journal;
    if(name==='claim_xiaotao_foart_next_v3'){
      if(operation.stages.has(args.p_phase_id))return {status:'reserved',first:false,phaseId:args.p_phase_id,estimatedCredits:args.p_estimated_credits};
      operation.stages.set(args.p_phase_id,{status:'reserved'});return {status:'reserved',first:true,phaseId:args.p_phase_id,estimatedCredits:args.p_estimated_credits};
    }
    if(name==='finalize_xiaotao_operation_v3_refund'){args={...args,p_outcome:'cancel',refund:true};name='finalize_xiaotao_operation_v3';}if(name==='finalize_xiaotao_operation_v3'){
      if(operation.status==='settled')return {...operation.receipt,idempotent:true};
      if([...operation.stages.values()].some(s=>s.status==='dispatched'))return {status:'pending-reconciliation'};
      const raw=[...operation.stages.values()].reduce((sum,s)=>sum+(s.raw||0),0);operation.status='settled';
      const decimal=JSON.parse(operation.snapshot.policy_snapshot_text).config.xiaotao_online.credit_amount_policy==='decimal-v1';
      operation.snapshot.status='settled';operation.receipt={status:'settled',outcome:args.p_outcome,charged:args.refund?0:raw>0?(decimal?ceilXiaotaoLedgerCredit(String(raw)):Math.max(1,Math.ceil(raw))):0,uncollected:0};return operation.receipt;
    }
    throw Error('unexpected RPC '+name);
  };
  return {rpc,calls,operations};
}
function result(plan,selectedModel=model){return {data:{model:selectedModel,status:'completed',finish_reason:'stop',usage:{billing_token_usage_invalid:false,input_tokens:80,output_tokens:20,total_tokens:100,input_tokens_details:{cached_tokens:0}},
  output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(plan)}]}]}};}
async function fixture(plans=[planOpen(),planDone()],initialContext=context(),options={}){
  const db=ledger();let providerCalls=0;
  const selectedModel=options.model||model;
  const configured=options.provider||provider();
  const service=create({enabled:true,foartGeneralEnabled:options.general!==false,secret,loadProvider:async()=>configured,rpc:db.rpc,infer:async request=>{
    assert.equal(request.maxRetries,0);assert.equal(request.model,selectedModel);options.onInfer?.(request);const next=plans[providerCalls++];if(next instanceof Error)throw next;return result(next,selectedModel);}});
  const shared={actor,originalIntent:options.intent||intent(),initialContext,isCurrent:async()=>true};
  const prepared=await service.prepare({...shared,nonce,model:selectedModel});
  return {db,service,shared,prepared,get providerCalls(){return providerCalls;}};
}
test('operation planner remains closed without trusted server assembly',async()=>{
  await assert.rejects(create().prepare({}),e=>e.code==='operation-billing-disabled');
});
test('first planner stage reserves using its frozen decimal policy, while legacy remains integer',async()=>{
  const deepseek='deepseek/deepseek-v4.1-flash';
  // Use a small synthetic multiplier: the Foart system prompt is deliberately
  // long, so the real-rate estimate may legitimately exceed one credit.
  const config={credits_per_usd:1,xiaotao_online:{markup:1.5,enabled_models:[deepseek],credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0}};
  const decimalProvider={...provider(),model:deepseek,operationTextChatV3:true,operationFoartOpenV3:true,operationDecimalCreditsV1:true,operationDecimalLedgerReady:true,creditConfig:config};
  const f=await fixture([planOpen()],context(),{model:deepseek,provider:decimalProvider});
  assert.equal((await f.service.start({...f.shared,operationToken:f.prepared.token})).ok,true);
  const reserve=f.db.calls.find(row=>row.name==='reserve_xiaotao_operation_stage_v3');
  assert.equal(JSON.parse(reserve.args.p_policy_snapshot_text).config.xiaotao_online.credit_amount_policy,'decimal-v1');
  assert.ok(reserve.args.p_estimated_credits>0 && reserve.args.p_estimated_credits<1);
  const legacy=await fixture([planOpen()]);
  assert.equal((await legacy.service.start({...legacy.shared,operationToken:legacy.prepared.token})).ok,true);
  const legacyHold=legacy.db.calls.find(row=>row.name==='reserve_xiaotao_operation_stage_v3').args.p_estimated_credits;
  assert.ok(Number.isSafeInteger(legacyHold) && legacyHold>=1);
});
test('one open plus one completed plan is one operation, with no project prose in journal',async()=>{
  const f=await fixture(),first=await f.service.start({...f.shared,operationToken:f.prepared.token});
  assert.equal(first.ok,true);assert.equal(first.toolPlan.operations[0].action,'open');assert.equal(first.billing.status,'pending');
  const journal=f.db.calls.find(x=>x.name==='record_xiaotao_foart_plan_v3');assert.ok(journal);assert.ok(!JSON.stringify(journal).includes('PRIVATE'));
  const args={...f.shared,operationToken:f.prepared.token,previousContext:context(),continuationToken:first.continuationToken,
    receipt:{action:'open',phase:'opened',surface:'animation'},context:context()};
  const done=await f.service.resume(args);assert.equal(done.ok,true);assert.equal(done.toolPlan.status,'done');assert.equal(done.receipt.charged,1);assert.equal(f.providerCalls,2);
  await assert.rejects(f.service.resume(args));assert.equal(f.providerCalls,2);
});
test('changed previous project context fails before another provider call',async()=>{
  const f=await fixture(),first=await f.service.start({...f.shared,operationToken:f.prepared.token});
  await assert.rejects(f.service.resume({...f.shared,operationToken:f.prepared.token,previousContext:{...context(),projectName:'other'},
    continuationToken:first.continuationToken,receipt:{action:'open',phase:'opened',surface:'animation'},context:context()}));
  assert.equal(f.providerCalls,1);
});
test('changing the initial context after prepare fails before provider dispatch',async()=>{
  const f=await fixture();
  const original=f.shared.initialContext;original.controls=[{id:'b',kind:'button',label:'Synthetic',enabled:true}];
  // The signed intent binds the initial context; a post-prepare change must fail.
  await assert.rejects(f.service.start({...f.shared,operationToken:f.prepared.token}));assert.equal(f.providerCalls,0);
});
test('explicit cancellation after the first known stage settles without another provider',async()=>{
  const f=await fixture(),first=await f.service.start({...f.shared,operationToken:f.prepared.token});assert.equal(first.ok,true);
  const receipt=await f.service.cancel({...f.shared,operationToken:f.prepared.token});assert.equal(receipt.outcome,'cancel');assert.equal(receipt.charged,1);assert.equal(f.providerCalls,1);
  const again=await f.service.cancel({...f.shared,operationToken:f.prepared.token});assert.equal(again.idempotent,true);assert.equal(again.charged,1);assert.equal(f.providerCalls,1);
});
test('a browser cancel cannot ask for a refund: the known stage is still charged',async()=>{
  const f=await fixture(),first=await f.service.start({...f.shared,operationToken:f.prepared.token});assert.equal(first.ok,true);
  const receipt=await f.service.cancel({...f.shared,operationToken:f.prepared.token,refund:true});assert.equal(receipt.outcome,'cancel');assert.equal(receipt.charged,1);
});
test('unknown provider outcome holds reservation and cannot be dispatched again',async()=>{
  const f=await fixture([new Error('synthetic timeout')]);
  await assert.rejects(f.service.start({...f.shared,operationToken:f.prepared.token}),e=>e.code==='operation-status-unknown');
  await assert.rejects(f.service.start({...f.shared,operationToken:f.prepared.token}),e=>e.code==='operation-status-unknown');
  assert.equal(f.providerCalls,1);assert.equal([...f.db.operations.values()][0].stages.get('foart_1').status,'dispatched');
  const pending=await f.service.cancel({...f.shared,operationToken:f.prepared.token});assert.equal(pending.status,'pending-reconciliation');assert.equal(f.providerCalls,1);
});
test('general operation runs any validated tool one step at a time and settles once',async()=>{
  const initial={...context(),controls:[{id:'fixture-input',kind:'input'},{id:'fixture-other',kind:'input'}]};
  const write={schema,status:'act',reply:'Change fields.',operations:[{action:'set_control',controlId:'fixture-input',value:'a'},{action:'set_control',controlId:'fixture-other',value:'b'}]};
  const f=await fixture([write,planDone()],initial,{general:true,provider:{...provider(),operationTextChatV3:true,operationFoartOpenV3:true,operationFoartGeneralV3:true}});
  const first=await f.service.start({...f.shared,operationToken:f.prepared.token});
  assert.equal(first.ok,true);assert.equal(first.toolPlan.operations.length,1);assert.equal(first.toolPlan.operations[0].controlId,'fixture-input');
  assert.equal(f.db.calls.find(x=>x.name==='record_xiaotao_foart_plan_v3').args.p_surface,'tools');
  const args={...f.shared,operationToken:f.prepared.token,previousContext:initial,continuationToken:first.continuationToken,context:initial};
  await assert.rejects(f.service.resume({...args,receipt:{action:'set_control',previewUrl:'data:image/png;base64,AAAA'}}),e=>e.code==='foart-media-consent-required');
  const done=await f.service.resume({...args,receipt:{action:'set_control',phase:'applied'}});
  assert.equal(done.ok,true);assert.equal(done.toolPlan.status,'done');assert.equal(done.receipt.outcome,'success');assert.equal(f.providerCalls,2);
});
test('general operation stays closed unless both the server switch and the policy opt in',async()=>{
  const initial={...context(),controls:[{id:'fixture-input',kind:'input'}]};
  const write={schema,status:'act',reply:'Change a field.',operations:[{action:'set_control',controlId:'fixture-input',value:'changed'}]};
  for(const options of [{general:false},{provider:{...provider(),operationFoartGeneralV3:false}}]){
    const f=await fixture([write],initial,options),result=await f.service.start({...f.shared,operationToken:f.prepared.token});
    assert.equal(result.ok,false);assert.equal(result.errorCode,'foart-operation-unsupported');assert.equal(result.toolPlan,undefined);
  }
});
