import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../../renderer/novaflow-smart-ai.js',import.meta.url),'utf8');
const a=source.indexOf('  function verifiedAgentPromptHandoff('),b=source.indexOf('  // H3 prompts kept in the prompt history',a);assert.ok(a>0&&b>a);
const onlineModels=source.match(/\/\/ BEGIN GENERATED xiaotao-online-models[\s\S]*?\/\/ END GENERATED xiaotao-online-models/)[0];
function fixture({enabled=true,changed=false,gpt=false,failure=null,model='openai/gpt-6.1-sol-saver',useImages=true}={}){
  let calls=0,captured;const selected={provider:'api',modelId:model,epoch:1};
  const controller={businessModelSnapshot:()=>({...selected})};
  const response={ok:true,analysisBackend:'runninghub',modelIdentity:{id:selected.modelId},releaseEligible:true,reviewRequired:true,displayPrompt:'red ball',modelPrompt:'a red ball on grass',modelPromptLanguage:'en',modelPromptPolicy:'qwen21-native-rewrite-v3',promptContract:'qwen21-native-rewrite-v3',translationValidation:'native-edit-and-literals',promptSchema:'nf.art.prompt.v1',quota:{pricing_source:'token_rate_estimate',cache_known:false}};
  if(gpt)Object.assign(response,{targetEngine:'gpt-image-2.5',promptContract:'gpt-image-semantic-fusion-v1',modelPrompt:response.displayPrompt});
  const api={onlineBusinessAvailableSync:()=>enabled,promptAssistantOptimizePrompt:async payload=>{calls++;captured=payload;if(changed)selected.epoch++;return failure||response;}};
  const ctx={window:{electronAPI:api,crypto:{randomUUID:()=> 'request-1234'},NovaFlowXiaotaoArtAgent:{panel:{controller}}},ORDINARY_ART_PROMPT_SCHEMA:'nf.art.prompt.v1',validateSmartAiArtPromptPreservation:()=>({ok:true}),protectSmartAiResourceMentions:text=>({text}),restoreSmartAiResourceMentions:text=>({ok:true,text})};
  vm.createContext(ctx);vm.runInContext(onlineModels+'\n'+source.slice(a,b)+'\nglobalThis.invoke=optimizeForAgent;',ctx);
  const quote=()=>{},confirm=async()=>true,billing=()=>true,images=[{role:'subject',dataUrl:'data:image/png;base64,iVBORw0KGgo='}];
  return {run:()=>ctx.invoke({assistantSelectionScope:'xiaotao',surface:'art',prompt:'red ball',negativePrompt:'keep existing',generationMode:'img2img',engine:gpt?'gpt-image-2.5':'qwen-2.1',supportsNegativePrompt:false,onPricingQuote:quote,confirmPricingQuote:confirm,onBillingNotice:billing,...(useImages?{images}:{})}),get calls(){return calls;},get captured(){return captured;},quote,confirm,billing,images};
}
test('all three online selections retain their exact model identity and a closed gate makes no call',async()=>{
  for(const model of ['xai/grok-4.7','openai/gpt-6.1-sol-saver','deepseek/deepseek-v4.1-flash','deepseek/deepseek-v4.1-flash','bytedance/doubao-seed-2.1-lite']){
    const f=fixture({model,useImages:false}),result=await f.run();assert.equal(f.calls,1);assert.equal(f.captured.assistantModelId,model);assert.equal(result.optimization.modelIdentity.id,model);
    const closed=fixture({model,enabled:false,useImages:false});await assert.rejects(closed.run());assert.equal(closed.calls,0);
  }
});
test('selected online optimizer passes exact model, phases and references to the guarded business route',async()=>{
  for(const gpt of [false,true]){const f=fixture({gpt}),r=await f.run();assert.equal(f.calls,1);assert.equal(f.captured.assistantModelId,'openai/gpt-6.1-sol-saver');assert.equal(f.captured.onPricingQuote,f.quote);assert.equal(f.captured.confirmPricingQuote,f.confirm);assert.equal(f.captured.onBillingNotice,f.billing);assert.deepEqual(JSON.parse(JSON.stringify(f.captured.images)),f.images);assert.equal(r.optimization.reviewRequired,true);assert.equal(r.optimization.quota.cache_known,false);assert.equal(r.negativePrompt,'keep existing');if(gpt)assert.equal(f.captured.negativePrompt,'');}
});
test('closed gate and changed selection fail without fallback or application',async()=>{
  const closed=fixture({enabled:false});await assert.rejects(closed.run(),/尚未开放/);assert.equal(closed.calls,0);
  const stale=fixture({changed:true});await assert.rejects(stale.run(),/模型选择或会话已变化/);assert.equal(stale.calls,1);
});
test('settled failures retain safe diagnostics without forwarding arbitrary response fields',async()=>{
  for(const code of ['billing-mismatch','cancelled-after-settlement','provider-incomplete','structure-invalid']){
    const f=fixture({gpt:true,failure:{ok:false,errorCode:code,error:'本阶段未完成，请查看实际扣费。',billingUnknown:false,
      quota:{status:'settled',settled_credits:1,pricing_source:'token_rate_estimate',cache_known:true,secret:'must-not-propagate'},secret:'must-not-propagate'}});
    await assert.rejects(f.run(),error=>{
      assert.equal(error.message,'本阶段未完成，请查看实际扣费。');assert.equal(error.code,code);assert.equal(error.billingUnknown,false);
      assert.deepEqual(JSON.parse(JSON.stringify(error.quota)),{status:'settled',settled_credits:1,pricing_source:'token_rate_estimate',cache_known:true});
      assert.equal(Object.hasOwn(error,'secret'),false);assert.equal(Object.hasOwn(error.quota,'secret'),false);return true;
    });assert.equal(f.calls,1);
  }
});
test('unknown billing survives while invalid diagnostic fields are not propagated',async()=>{
  const f=fixture({gpt:true,failure:{ok:false,errorCode:'UNSAFE SECRET',error:'账单状态待核对。',billingUnknown:true,
    quota:{status:'settled',settled_credits:-1,pricing_source:'unknown',cache_known:'no',secret:'must-not-propagate'}}});
  await assert.rejects(f.run(),error=>{assert.equal(error.message,'账单状态待核对。');assert.equal(error.code,undefined);
    assert.equal(error.billingUnknown,true);assert.equal(error.quota,undefined);return true;});assert.equal(f.calls,1);
});
test('safe transport error codes are retained for unknown outcomes',async()=>{
  const f=fixture({gpt:true,failure:{ok:false,errorCode:'ETIMEDOUT',error:'账单状态待核对。',billingUnknown:true}});
  await assert.rejects(f.run(),error=>error.code==='ETIMEDOUT'&&error.billingUnknown===true);
});
test('a verified settlement retains the local estimate note and shortfall',async()=>{
  const note='按接口用量和目录费率计算；缓存用量未知，非供应商实账';
  const f=fixture({gpt:true,failure:{ok:false,errorCode:'billing-mismatch',error:'本阶段未完成，请查看实际扣费。',billingUnknown:false,
    quota:{status:'settled',settled_credits:1,pricing_source:'token_rate_estimate',cache_known:false,pricing_note:note,balance_short:true,uncollected_credits:0.5}}});
  await assert.rejects(f.run(),error=>{assert.equal(error.quota.pricing_note,note);assert.equal(error.quota.balance_short,true);
    assert.equal(error.quota.uncollected_credits,0.5);return true;});
});
