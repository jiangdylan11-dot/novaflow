import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createXiaotaoOperationV3Ports as create} from '../packages/shared/src/xiaotao-operation-v3-ports.mjs';
import {companionPricingPolicy} from '../packages/shared/src/companion-pricing.mjs';

const operationId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', hash='a'.repeat(64);
const snapshotText=JSON.stringify({schema:'nf.xiaotao.pricing.v1',revision:'fixture',providerRevision:'1',defaultModel:'xai/grok-4.7',config:{credits_per_usd:211,token_billing:{round:'ceil',settle_cap_credits:40},xiaotao_online:{markup:1.5,message_cap_credits:80}},models:[]});
const policyVersion='sha256:'+createHash('sha256').update(snapshotText).digest('hex');
const actor={userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId:'session',model:'xai/grok-4.7',intentHash:'d'.repeat(64),operationId,policyVersion};
const config=()=>({enabled:true,policyVersion,roundMode:'ceil',expectedCap:80,expectedConfig:{xiaotao_online:{markup:1.5}},policySnapshotText:snapshotText});
test('default closed before any RPC',async()=>{
  let calls=0;const p=create(async()=>{calls++;});
  await assert.rejects(p.claimRoute({actor,operationId,route:'v3'}),e=>e.code==='operation-billing-disabled');
  assert.equal(calls,0);
});
test('decimal snapshot binds fractional hold and records exact token-derived cost',async()=>{
  const amount={credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0};
  const snapshot=JSON.parse(snapshotText);Object.assign(snapshot.config.xiaotao_online,amount);
  const text=JSON.stringify(snapshot),version='sha256:'+createHash('sha256').update(text).digest('hex');
  const selected={...actor,model:'deepseek/deepseek-v4.1-flash',policyVersion:version};
  const opts={...config(),policyVersion:version,expectedConfig:{xiaotao_online:amount},policySnapshotText:text};
  const calls=[],p=create(async(name,args)=>{calls.push({name,args});return {status:'recorded'};},opts);
  await p.reserveStage({actor:selected,operationId,phaseId:'x',sequence:1,phaseKind:'planner',feature:'online_chat_turn',hash,estimatedCredits:0.000002});
  assert.equal(calls[0].args.p_estimated_credits,0.000002);
  await p.recordAssessedUsage({actor:selected,operationId,phaseId:'x',hash,usageRecords:[{
    billing_token_usage_invalid:false,input_tokens:1,output_tokens:0,input_tokens_details:{cached_tokens:1}}]});
  assert.equal(calls[1].args.p_usd_cost,'0.0000000036');
  assert.equal(calls[1].args.p_raw_credits,'0.0000011394');
  await assert.rejects(p.reserveStage({actor:selected,operationId,phaseId:'x',sequence:1,phaseKind:'planner',feature:'online_chat_turn',hash,estimatedCredits:0.0000001}));
  assert.throws(()=>create(async()=>{}, {...opts,expectedConfig:{xiaotao_online:{...amount,minimum_positive_credits:1}}}),e=>e.code==='invalid-policy-snapshot');
  assert.equal(calls.length,2);
});
test('decimal Grok never guesses that missing cache usage means zero cached tokens',async()=>{
  const amount={credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0};
  const snapshot=JSON.parse(snapshotText);Object.assign(snapshot.config.xiaotao_online,amount);
  const text=JSON.stringify(snapshot),version='sha256:'+createHash('sha256').update(text).digest('hex');
  const selected={...actor,policyVersion:version},calls=[];
  const p=create(async(name,args)=>{calls.push({name,args});return {status:'recorded'};},
    {...config(),policyVersion:version,expectedConfig:{xiaotao_online:amount},policySnapshotText:text});
  const usage={billing_token_usage_invalid:false,input_tokens:10,output_tokens:1};
  await assert.rejects(p.recordAssessedUsage({actor:selected,operationId,phaseId:'x',hash,usageRecords:[usage]}),e=>e.code==='invalid-assessed-usage');
  assert.equal(calls.length,0);
  await p.recordAssessedUsage({actor:selected,operationId,phaseId:'x',hash,usageRecords:[{...usage,input_tokens_details:{cached_tokens:0}}]});
  assert.equal(calls.length,1);
});
test('server snapshot is cloned and reserve binds actor, operation and phase',async()=>{
  const calls=[],opts=config(),p=create(async(name,args)=>{calls.push({name,args});return {status:'reserved'};},opts);
  opts.expectedConfig.xiaotao_online.markup=999;
  await p.reserveStage({actor,operationId,phaseId:'phase-1',sequence:1,phaseKind:'structure',feature:'xiaotao_vision',hash,estimatedCredits:3});
  assert.equal(calls.length,1);assert.equal(calls[0].name,'reserve_xiaotao_operation_stage_v3');
  assert.equal(calls[0].args.p_expected_config.xiaotao_online.markup,1.5);
  assert.equal(calls[0].args.p_operation_id,operationId);assert.equal(calls[0].args.p_user_id,actor.userId);
  assert.equal(calls[0].args.p_sequence,1);assert.equal(calls[0].args.p_feature,'xiaotao_vision');
  assert.equal(calls[0].args.p_usage_key,`xiaotao-v3:${operationId}:phase-1`);
  assert.equal(calls[0].args.p_policy_version,policyVersion);assert.equal(calls[0].args.p_request_hash,hash);
  assert.equal(calls[0].args.p_policy_snapshot_text,snapshotText);
  assert.equal(calls[0].args.p_intent_hash,actor.intentHash);
});
test('a planner can claim round 14 without lifting the finite operation bound',async()=>{
  let received;
  const p=create(async(_name,args)=>{received=args;return {status:'reserved'};},config());
  await p.reserveStage({actor,operationId,phaseId:'round14',sequence:14,phaseKind:'planner',feature:'online_chat_turn',hash,estimatedCredits:1});
  assert.equal(received.p_sequence,14);
});
test('art RPC wrappers bind the verified actor and reject invalid mode or hashes',async()=>{
  const calls=[];const p=create(async(name,args)=>{calls.push({name,args});return {status:'bound'};},config());
  await p.bindArtPlan({actor,operationId,artMode:'art_dual',structureHash:hash});
  await p.acceptArtStructure({actor,operationId,structureHash:hash,parentHash:hash});
  await p.registerArtEnglish({actor,operationId,parentHash:hash,englishHash:hash});
  await p.acceptArtEnglish({actor,operationId,parentHash:hash,englishHash:hash});
  assert.deepEqual(calls.map(x=>x.name),['bind_xiaotao_art_plan_v3','accept_xiaotao_art_structure_v3','register_xiaotao_art_english_v3','accept_xiaotao_art_english_v3']);
  assert.ok(calls.every(x=>x.args.p_user_id===actor.userId && x.args.p_intent_hash===actor.intentHash));
  await assert.rejects(p.bindArtPlan({actor,operationId,artMode:'other',structureHash:hash}));
  await assert.rejects(p.registerArtEnglish({actor,operationId,parentHash:'bad',englishHash:hash}));
  assert.equal(calls.length,4);
});
test('invalid identities, stage terms and unassessed usage never reach RPC',async()=>{
  let calls=0;const p=create(async()=>{calls++;},config());
  await assert.rejects(p.claimRoute({actor:{...actor,userId:'bad'},operationId,route:'v3'}));
  await assert.rejects(p.claimRoute({actor:{...actor,operationId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},operationId,route:'v3'}));
  await assert.rejects(p.claimRoute({actor:{...actor,policyVersion:'sha256:other'},operationId,route:'v3'}));
  await assert.rejects(p.reserveStage({actor,operationId,phaseId:'x',sequence:1,phaseKind:'planner',feature:'online_chat_turn',hash,estimatedCredits:0}));
  await assert.rejects(p.reserveStage({actor,operationId,phaseId:'x',sequence:0,phaseKind:'planner',feature:'online_chat_turn',hash,estimatedCredits:1}));
  await assert.rejects(p.reserveStage({actor,operationId,phaseId:'x',sequence:15,phaseKind:'planner',feature:'online_chat_turn',hash,estimatedCredits:1}));
  await assert.rejects(p.reserveStage({actor,operationId,phaseId:'x',sequence:1,phaseKind:'planner',feature:'local',hash,estimatedCredits:1}));
  await assert.rejects(p.recordAssessedUsage({actor,operationId,phaseId:'x',hash,usageRecords:[{}]}));
  await assert.rejects(p.recordAssessedUsage({actor,operationId,phaseId:'x',hash,usageRecords:[{billing_token_usage_invalid:true,input_tokens:1,output_tokens:1}]}));
  await assert.rejects(p.recordAssessedUsage({actor,operationId,phaseId:'x',hash,usageRecords:[{billing_token_usage_invalid:false,input_tokens:1,prompt_tokens:2,output_tokens:1}]}));
  assert.equal(calls,0);
});
test('assessed usage prices each request using the frozen snapshot and ignores unknown money',async()=>{
  const calls=[],opts=config(),p=create(async(name,args)=>{calls.push({name,args});return {status:'recorded'};},opts);
  opts.policySnapshotText='mutated after construction';
  await p.recordAssessedUsage({actor,operationId,phaseId:'x',hash,usageRecords:[
    {billing_token_usage_invalid:false,input_tokens:100,output_tokens:10,consumeMoney:'999'},
    {billing_token_usage_invalid:false,input_tokens:50,output_tokens:5,input_tokens_details:{cached_tokens:10}}
  ]});
  const args=calls[0].args, usd=((100*1.7+10*5.1)+(40*1.7+10*0.425+5*5.1))/1e6;
  assert.equal(calls[0].name,'record_xiaotao_operation_stage_usage_v3');
  assert.ok(Math.abs(args.p_usd_cost-usd)<1e-12);
  assert.ok(Math.abs(args.p_raw_credits-usd*211*1.5)<1e-12);
  assert.equal(args.p_usage.records[0].consumeMoney,undefined);
  assert.equal(args.p_usage.records[0].input_tokens_details,undefined);
  assert.equal(args.p_usage.records[1].input_tokens_details.cached_tokens,10);
});
test('direct assessed usage preserves top-level cache counts and rejects contradictions',async()=>{
  const calls=[],p=create(async(name,args)=>{calls.push({name,args});return {status:'recorded'};},config());
  const ds={...actor,model:'deepseek/deepseek-v4.1-flash'};
  const usage={billing_token_usage_invalid:false,input_tokens:100,output_tokens:10,
    prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20};
  await p.recordAssessedUsage({actor:ds,operationId,phaseId:'x',hash,usageRecords:[usage]});
  const args=calls[0].args,usd=(20*.177+80*.0036+10*.7062)/1e6;
  assert.ok(Math.abs(args.p_usd_cost-usd)<1e-12);
  assert.equal(args.p_usage.records[0].input_tokens_details.cached_tokens,80);
  for (const bad of [{...usage,input_tokens_details:{cached_tokens:79}},
    {...usage,prompt_cache_miss_tokens:19},{...usage,prompt_cache_hit_tokens:undefined}]) {
    await assert.rejects(p.recordAssessedUsage({actor:ds,operationId,phaseId:'x',hash,usageRecords:[bad]}),e=>e.code==='invalid-assessed-usage');
  }
  assert.equal(calls.length,1);
});
test('GPT and DeepSeek missing cache counters cannot record or settle a dispatched stage',async()=>{
  const calls=[],p=create(async(name,args)=>{calls.push({name,args});return {status:'recorded'};},config());
  for(const model of ['openai/gpt-6.1-sol-saver','deepseek/deepseek-v4.1-flash']){
    const selected={...actor,model},base={billing_token_usage_invalid:false,input_tokens:100,output_tokens:10};
    await assert.rejects(p.recordAssessedUsage({actor:selected,operationId,phaseId:'x',hash,usageRecords:[base]}),e=>e.code==='invalid-assessed-usage');
    assert.equal(calls.length,model==='openai/gpt-6.1-sol-saver'?0:1);
    await p.recordAssessedUsage({actor:selected,operationId,phaseId:'x',hash,usageRecords:[{...base,input_tokens_details:{cached_tokens:0}}]});
    assert.equal(calls.at(-1).name,'record_xiaotao_operation_stage_usage_v3');
  }
  assert.equal(calls.length,2);
});
test('policy snapshot digest and per-stage cap are verified before any RPC',()=>{
  assert.throws(()=>create(async()=>{}, {...config(),policySnapshotText:snapshotText+' '}),e=>e.code==='invalid-policy-snapshot');
  assert.throws(()=>create(async()=>{}, {...config(),expectedCap:79}),e=>e.code==='invalid-policy-snapshot');
  assert.throws(()=>create(async()=>{}, {...config(),roundMode:'floor'}),e=>e.code==='invalid-policy-snapshot');
});
test('the existing published policy hashes the exact persisted snapshot text',async()=>{
  const policy=await companionPricingPolicy({apiKey:'test-only',model:'xai/grok-4.7',configRevision:'1',pricingSnapshotReady:true});
  const {schema,revision,providerRevision,defaultModel,config:effectiveConfig,models,version}=policy;
  const text=JSON.stringify({schema,revision,providerRevision,defaultModel,config:effectiveConfig,models});
  assert.equal('sha256:'+createHash('sha256').update(text).digest('hex'),version);
  assert.doesNotThrow(()=>create(async()=>{}, {enabled:true,policyVersion:version,roundMode:effectiveConfig.token_billing.round,
    expectedCap:effectiveConfig.xiaotao_online.message_cap_credits,expectedConfig:{},policySnapshotText:text}));
});
test('ambiguous RPC failure is never retried and remains unknown',async()=>{
  let calls=0;const p=create(async()=>{calls++;throw Error('timeout');},config());
  await assert.rejects(p.finalize({actor,operationId,outcome:'success'}),e=>e.code==='operation-status-unknown');
  assert.equal(calls,1);
});
test('only exact trusted database reservation rejections become known failures',async()=>{
  const reserve={actor,operationId,phaseId:'x',sequence:1,phaseKind:'planner',feature:'online_chat_turn',hash,estimatedCredits:1};
  for(const [error,expected,status] of [
    [{code:'P0001',message:'积分不足'},'insufficient_credits',402],
    [{code:'P0001',message:'云服务余额不足，请联系管理员'},'provider-pool-insufficient',503],
    [{code:'08006',message:'积分不足'},'operation-status-unknown',503],
    [{code:'P0001',message:'积分不足：可能已提交'},'operation-status-unknown',503],
    [{message:'积分不足'},'operation-status-unknown',503]
  ]){
    let calls=0;const p=create(async()=>{calls++;throw error;},config());
    await assert.rejects(p.reserveStage(reserve),e=>e.code===expected&&e.statusCode===status);assert.equal(calls,1);
  }
  const p=create(async()=>{throw {code:'P0001',message:'积分不足'};},config());
  await assert.rejects(p.finalize({actor,operationId,outcome:'success'}),e=>e.code==='operation-status-unknown');
});

test('stale sweep is scoped to one account, needs a sane age, and surfaces the RPC result as is',async()=>{
  const calls=[],p=create(async(name,args)=>{calls.push({name,args});return {status:'swept',refunded:[],skipped:0};},config());
  assert.deepEqual(await p.sweepStale({userId:actor.userId}),{status:'swept',refunded:[],skipped:0});
  assert.deepEqual(calls,[{name:'sweep_xiaotao_stale_dispatched_v3',args:{p_user_id:actor.userId,p_min_age_seconds:120}}]);
  await assert.rejects(p.sweepStale({userId:'not-a-uuid'}),e=>e.code==='invalid-sweep');
  await assert.rejects(p.sweepStale({userId:actor.userId,minAgeSeconds:5}),e=>e.code==='invalid-sweep');
  const missing=create(async()=>{throw Object.assign(Error('function does not exist'),{code:'42883'});},config());
  await assert.rejects(missing.sweepStale({userId:actor.userId}),e=>e.code==='42883');
  assert.equal(calls.length,1);
});
