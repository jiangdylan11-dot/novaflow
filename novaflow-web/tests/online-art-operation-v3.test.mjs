import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrustedArtPhases} from '../packages/shared/src/companion-art-business.mjs';
import {createXiaotaoV3ArtAdapter} from '../packages/shared/src/xiaotao-operation-v3-art-adapter.mjs';
import {companionPricingPolicy} from '../packages/shared/src/companion-pricing.mjs';

const model='xai/grok-4.7',actor={userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId:'session',epoch:0};
const intentId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',operationId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',intentHash='d'.repeat(64),pricingVersion='sha256:'+'a'.repeat(64);
const sections='[Style]\nsoft watercolor painting style\n[Subjects]\none small bright red bird\n[Environment]\na quiet leafy garden\n[Lighting]\nwarm early morning sunlight\n[Camera]\na gentle front facing view\n[Requirements]\nkeep the background clean';
const png='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64');
function setup({badStructure=false,badEnglish=false,englishOutput,failInfer=false,single=false,failBeforeEnglish=false,isCurrent=async()=>true,onInfer=()=>{},onFinalize=()=>{},pendingFinalize=false,now=()=>Date.now(),decimal=false,badDecimalReceipt=false}={}){
  const events=[],stages=[],calls=[];
  const amount={credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0};
  const compiler={buildGrokPromptOptimizeRequest(p,m){return {body:{model:m,input:[{role:'system',content:[{type:'input_text',text:'system'}]},{role:'user',content:[{type:'input_text',text:'prompt'}]}],max_output_tokens:p.targetEngine==='gpt-image-2.5'?1536:6144},
    resultOptions:p.targetEngine==='gpt-image-2.5'?{artSemanticFusion:true,targetEngine:'gpt-image-2.5',completeVisualBrief:true}:{ordinaryArtStructuredPrompt:true}};},
    grokResponsesPublicResult(){if(badStructure)throw Error('bad');return single?{output_text:sections,has_negative_prompt:false}:{output_text:sections,editContract:'structured-recompile-v1',promptSchema:'nf.art.prompt.v1'};}};
  const ports={bindArtPlan:async args=>{events.push(['bind',args]);return {status:'bound'};},
    acceptArtStructure:async args=>{events.push(['accept-structure',args]);return {status:'accepted'};},
    registerArtEnglish:async args=>{events.push(['register-english',args]);return {status:'bound'};},
    acceptArtEnglish:async args=>{events.push(['accept-english',args]);return {status:'accepted'};},
    finalize:async args=>{events.push(['finalize',args]);onFinalize();return pendingFinalize?{status:'pending-reconciliation'}:{status:'settled',outcome:args.outcome,charged:stages.length?(decimal?0.000002:1):0,uncollected:0,...(decimal?{...amount,...(badDecimalReceipt?{credit_precision:5}:{})}:{})};}};
  const operationV3={enabled:true,ports,begin:async args=>{events.push(['begin',args]);return {operationId,intentHash};},
    executePhase:async args=>{events.push(['reserve',args.stage]);if(failBeforeEnglish&&args.stage==='english')throw Object.assign(Error('cancelled'),{code:'cancelled-before-dispatch',receipt:{status:'settled',outcome:'cancel',charged:1,uncollected:0}});
      const {answer,decision}=await args.run({markProviderDispatched:async()=>events.push(['dispatch',args.stage])});
      stages.push(args.stage);events.push(['record',args.stage]);return {status:'recorded',response:answer,decision,requestHash:args.requestHash,pricingVersion:args.pricingVersion,model:args.model};}};
  const phases=createTrustedArtPhases({secret:Buffer.alloc(32,9),models:[model],visionModels:[model],compiler,policyFor:()=> 'policy',operationV3,pricingConfig:decimal?{xiaotao_online:amount}:{},
    quote:async()=>({pricingVersion,estimatedCredits:decimal?0.000003:2}),assessUsage:async()=>({pricingVersion,usageMissing:false,credits:1,usdCost:.001,pricingSource:'token_rate_estimate'}),
    isCurrent,now,infer:async args=>{calls.push(args.body);if(failInfer)throw Error('timeout');onInfer();const output_text=badEnglish?'bad':englishOutput??sections;
      return {model,usage:{input_tokens:10,output_tokens:10},status:'completed',finish_reason:'stop',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:output_text}]}],output_text};},
    executeAtomic:async()=>{throw Error('legacy must not run');}});
  return {phases,events,calls};
}
const qinput=()=>({currentPrompt:'synthetic prompt',requirements:'',qwenPromptMode:'txt2img'});
for(const [label,englishOutput,ok] of [
  ['equivalent translated headings',sections.replace('[Lighting]','[Lighting and Color]').replace('[Requirements]','[User Additional Requirements]'),true],
  ['short equivalent headings',sections.replace('[Lighting]','[Lighting & Colour]').replace('[Requirements]','[Additional Requirements]'),true],
  ['missing section',sections.replace('[Camera]\na gentle front facing view\n',''),false],
  ['unknown section',sections.replace('[Lighting]','[Unrelated]'),false],
  ['reordered sections',sections.replace('[Camera]','[Requirements]').replace(/\[Requirements\](?=\nkeep)/,'[Camera]'),false]
])test('English section validation: '+label,async()=>{
  const f=setup({englishOutput}),q=await f.phases.quoteStructure({actor,model,input:qinput(),intentId});
  const structure=await f.phases.submit({actor,quoteToken:q.quoteToken});
  const english=await f.phases.quoteEnglish({actor,stageToken:structure.stageToken});
  const result=await f.phases.submit({actor,quoteToken:english.quoteToken});assert.equal(result.ok,ok);
  if(ok){assert.match(result.modelPrompt,/\[Lighting\]/);assert.match(result.modelPrompt,/\[Requirements\]/);}
  else assert.equal(result.errorCode,'english-invalid');
});
test('two art phases hold once then finalize one operation after validated English',async()=>{
  const f=setup(),images=[{role:'style',dataUrl:png}];
  const q=await f.phases.quoteStructure({actor,model,input:qinput(),intentId,images});
  assert.equal(q.billingScope,'operation-v3');assert.equal(q.recoveryOperationId,operationId);
  assert.equal(Buffer.from(q.quoteToken.split('.')[0],'base64url').toString().includes(png),false);
  const structure=await f.phases.submit({actor,quoteToken:q.quoteToken,images});
  assert.equal(structure.ok,true);assert.equal(structure.settlement.status,'pending');assert.equal(f.events.some(([name])=>name==='finalize'),false);
  assert.equal(Buffer.from(structure.stageToken.split('.')[0],'base64url').toString().includes(png),false);
  const english=await f.phases.quoteEnglish({actor,stageToken:structure.stageToken});
  assert.equal(english.billingScope,'operation-v3');assert.equal(english.recoveryOperationId,operationId);
  const result=await f.phases.submit({actor,quoteToken:english.quoteToken});
  assert.equal(result.ok,true);assert.equal(result.stage,'english');assert.equal(result.settlement.settledCredits,1);
  assert.deepEqual(f.events.map(([name])=>name),['begin','bind','reserve','dispatch','record','accept-structure','register-english','reserve','dispatch','record','accept-english','finalize']);
  assert.equal(f.events.at(-1)[1].outcome,'success');assert.equal(f.calls.length,2);
  const bound=f.events.find(([name])=>name==='bind')[1],accepted=f.events.find(([name])=>name==='accept-structure')[1];
  assert.equal(bound.artMode,'art_dual');assert.equal(bound.structureHash,accepted.structureHash);assert.equal(accepted.operationId,operationId);
  assert.equal(f.events.find(([name])=>name==='register-english')[1].parentHash,accepted.parentHash);
});
test('single phase validates structure and finalizes once',async()=>{
  const f=setup({single:true}),q=await f.phases.quoteStructure({actor,model,intentId,input:{...qinput(),targetEngine:'gpt-image-2.5'}});
  const result=await f.phases.submit({actor,quoteToken:q.quoteToken});
  assert.equal(result.ok,true);assert.equal(result.settlement.settledCredits,1);
  assert.equal(f.events.find(([name])=>name==='bind')[1].artMode,'art_single');
  assert.equal(f.events.filter(([name])=>name==='finalize').length,1);
});
test('decimal art quote and final receipt preserve the frozen policy',async()=>{
  const f=setup({single:true,decimal:true}),q=await f.phases.quoteStructure({actor,model,intentId,input:{...qinput(),targetEngine:'gpt-image-2.5'}});
  assert.equal(q.estimatedCredits,0.000003);
  const result=await f.phases.submit({actor,quoteToken:q.quoteToken});
  assert.equal(result.ok,true);assert.equal(result.settlement.settledCredits,0.000002);
  assert.equal(result.settlement.credit_amount_policy,'decimal-v1');
  const bad=setup({single:true,decimal:true,badDecimalReceipt:true}),bq=await bad.phases.quoteStructure({actor,model,intentId,input:{...qinput(),targetEngine:'gpt-image-2.5'}});
  await assert.rejects(bad.phases.submit({actor,quoteToken:bq.quoteToken}),e=>e.code==='billing-unconfirmed');
});
test('known used but invalid structure or English finalizes cancellation, never releases a draft',async()=>{
  const a=setup({badStructure:true}),q=await a.phases.quoteStructure({actor,model,intentId,input:qinput()});
  const bad=await a.phases.submit({actor,quoteToken:q.quoteToken});assert.equal(bad.ok,false);assert.equal(bad.errorCode,'structure-invalid');
  assert.equal(bad.settlement.settledCredits,1);assert.equal(a.events.at(-1)[1].outcome,'cancel');
  const b=setup({badEnglish:true}),q2=await b.phases.quoteStructure({actor,model,intentId,input:qinput()});
  const s=await b.phases.submit({actor,quoteToken:q2.quoteToken}),e=await b.phases.quoteEnglish({actor,stageToken:s.stageToken});
  const failed=await b.phases.submit({actor,quoteToken:e.quoteToken});assert.equal(failed.errorCode,'english-invalid');assert.equal(b.events.at(-1)[1].outcome,'cancel');
});
test('unknown provider result never auto-finalizes or produces a stage token',async()=>{
  const f=setup({failInfer:true}),q=await f.phases.quoteStructure({actor,model,intentId,input:qinput()});
  await assert.rejects(f.phases.submit({actor,quoteToken:q.quoteToken}));
  assert.ok(!f.events.some(([name])=>name==='finalize'));assert.ok(!f.events.some(([name])=>name==='accept-structure'));
});
test('known cancellation before English dispatch returns the already settled structure receipt',async()=>{
  const f=setup({failBeforeEnglish:true}),q=await f.phases.quoteStructure({actor,model,intentId,input:qinput()});
  const s=await f.phases.submit({actor,quoteToken:q.quoteToken}),e=await f.phases.quoteEnglish({actor,stageToken:s.stageToken});
  const result=await f.phases.submit({actor,quoteToken:e.quoteToken});
  assert.equal(result.ok,false);assert.equal(result.errorCode,'cancelled-before-dispatch');assert.equal(result.settlement.settledCredits,1);
  assert.equal(f.calls.length,1);assert.equal(f.events.filter(([name])=>name==='finalize').length,0);
});
test('revoked session never receives the settled art receipt or output',async()=>{
  let active=true;const f=setup({isCurrent:async()=>active,onInfer:()=>{active=false;}});
  const q=await f.phases.quoteStructure({actor,model,intentId,input:qinput()});
  await assert.rejects(f.phases.submit({actor,quoteToken:q.quoteToken}),e=>e.code==='selection-stale'&&!('settlement' in e)&&!('receipt' in e));
  assert.equal(f.events.at(-1)[0],'finalize');assert.equal(f.events.at(-1)[1].outcome,'cancel');
});
test('authenticated pending structure cancellation is repeatable, including after quote expiry',async()=>{
  let time=1000;const f=setup({now:()=>time}),q=await f.phases.quoteStructure({actor,model,intentId,input:qinput()});
  const s=await f.phases.submit({actor,quoteToken:q.quoteToken});time+=600000;
  const cancelled=await f.phases.cancelPending({actor,stageToken:s.stageToken});
  assert.equal(cancelled.ok,false);assert.equal(cancelled.errorCode,'operation-cancelled');assert.equal(cancelled.settlement.settledCredits,1);
  assert.deepEqual(await f.phases.cancelPending({actor,stageToken:s.stageToken}),cancelled);
  await assert.rejects(f.phases.cancelPending({actor:{...actor,sessionId:'other'},stageToken:s.stageToken}),e=>e.code==='invalid-stage');
  await assert.rejects(f.phases.cancelPending({actor,stageToken:s.stageToken+'x'}),e=>e.code==='invalid-token');
  assert.equal(f.calls.length,1);
});
test('pending unknown remains held and revoked cancellation does not disclose a receipt',async()=>{
  const pending=setup({pendingFinalize:true}),q=await pending.phases.quoteStructure({actor,model,intentId,input:qinput()}),s=await pending.phases.submit({actor,quoteToken:q.quoteToken});
  assert.deepEqual(await pending.phases.cancelPending({actor,stageToken:s.stageToken}),{ok:false,errorCode:'operation-status-unknown'});
  let active=true;const revoked=setup({isCurrent:async()=>active,onFinalize:()=>{active=false;}});
  const q2=await revoked.phases.quoteStructure({actor,model,intentId,input:qinput()}),s2=await revoked.phases.submit({actor,quoteToken:q2.quoteToken});
  await assert.rejects(revoked.phases.cancelPending({actor,stageToken:s2.stageToken}),e=>e.code==='selection-stale'&&!('settlement' in e));
});
test('real v3 adapter and business contract bind, price and settle two synthetic phases',async()=>{
  const calls=[],stages=new Map(),provider={apiKey:'test-only',model,pricingSnapshotReady:true,configRevision:'1',creditConfig:{}};
  const policy=await companionPricingPolicy(provider),secret=Buffer.alloc(32,9);
  let parentHash,structureHash,englishHash;
  const rpc=async(name,args)=>{
    calls.push({name,args});
    if(name==='bind_xiaotao_art_plan_v3'){structureHash=args.p_structure_hash;assert.equal(args.p_art_mode,'art_dual');return {status:'bound',idempotent:false};}
    if(name==='reserve_xiaotao_operation_stage_v3'){stages.set(args.p_phase_id,{status:'reserved',hash:args.p_request_hash});return {status:'reserved',idempotent:false};}
    if(name==='mark_xiaotao_operation_stage_dispatched_v3'){stages.get(args.p_phase_id).status='dispatched';return {status:'dispatched',first_dispatch:true};}
    if(name==='record_xiaotao_operation_stage_usage_v3'){const phase=stages.get(args.p_phase_id);phase.status='recorded';phase.raw=args.p_raw_credits;assert.ok(phase.raw>0);return {status:'recorded'};}
    if(name==='accept_xiaotao_art_structure_v3'){assert.equal(args.p_structure_hash,structureHash);parentHash=args.p_parent_hash;return {status:'accepted'};}
    if(name==='register_xiaotao_art_english_v3'){assert.equal(args.p_parent_hash,parentHash);englishHash=args.p_english_hash;return {status:'bound'};}
    if(name==='accept_xiaotao_art_english_v3'){assert.equal(args.p_parent_hash,parentHash);assert.equal(args.p_english_hash,englishHash);return {status:'accepted'};}
    if(name==='finalize_xiaotao_operation_v3'){const raw=[...stages.values()].reduce((sum,row)=>sum+row.raw,0);return {status:'settled',outcome:args.p_outcome,charged:Math.max(1,Math.ceil(raw-1e-9)),uncollected:0};}
    throw Error('unexpected rpc '+name);
  };
  const operationV3=await createXiaotaoV3ArtAdapter({enabled:true,provider,rpc,secret,isCurrent:async()=>true});
  const compiler={buildGrokPromptOptimizeRequest(_p,m){return {body:{model:m,input:[{role:'system',content:[{type:'input_text',text:'system'}]},{role:'user',content:[{type:'input_text',text:'prompt'}]}],max_output_tokens:6144},resultOptions:{ordinaryArtStructuredPrompt:true}};},
    grokResponsesPublicResult(){return {output_text:sections,editContract:'structured-recompile-v1',promptSchema:'nf.art.prompt.v1'};}};
  const phases=createTrustedArtPhases({secret,models:[model],compiler,policyFor:()=> 'policy',operationV3,
    quote:async()=>({pricingVersion:policy.version,estimatedCredits:2}),assessUsage:async()=>({pricingVersion:policy.version,usageMissing:false,credits:1,usdCost:.001}),isCurrent:async()=>true,
    infer:async()=>({model,usage:{billing_token_usage_invalid:false,input_tokens:80,output_tokens:20},status:'completed',finish_reason:'stop',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:sections}]}],output_text:sections}),
    executeAtomic:async()=>{throw Error('legacy route was called');}});
  const q=await phases.quoteStructure({actor,model,intentId,input:qinput()}),s=await phases.submit({actor,quoteToken:q.quoteToken});
  assert.equal(s.settlement.status,'pending');
  const e=await phases.quoteEnglish({actor,stageToken:s.stageToken}),done=await phases.submit({actor,quoteToken:e.quoteToken});
  assert.equal(done.ok,true);assert.equal(done.settlement.settledCredits,1);assert.equal(stages.size,2);
  assert.equal(calls.filter(call=>call.name==='finalize_xiaotao_operation_v3').length,1);
  assert.equal(calls.filter(call=>call.name==='record_xiaotao_operation_stage_usage_v3').length,2);
});
