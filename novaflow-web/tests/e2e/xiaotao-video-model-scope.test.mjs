import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const mediaSource=await readFile(new URL('../../renderer/xiaotao-media-agent.js',import.meta.url),'utf8');
const smartSource=await readFile(new URL('../../renderer/novaflow-smart-ai.js',import.meta.url),'utf8');

function optimizerFixture(selection,available=true,changed=false) {
  let calls=0;
  const controller={businessModelSnapshot:()=>({...selection})};
  const window={crypto:{randomUUID:()=> 'test-id'},NovaFlowXiaotaoArtAgent:{panel:{controller}},electronAPI:{
    qwenBusinessAvailableSync:()=>available,
    promptAssistantOptimizePrompt:async()=>{calls++;if(changed)selection.epoch++;return {ok:true,modelPromptPolicy:'qwen21-task-policy-v1',data:{analysisBackend:'qwen-cpu',resourcesReleased:true,generationReady:true,modelIdentity:{id:'qwen35-heretic',verification:'server-weight-path'},modelPromptLanguage:'en',modelPrompt:'red ball'}};},
    smartAiPromptOptimize:async()=>{throw Error('legacy online route must not be used');}
  }};
  const ctx={window,shouldUseStructuredArtPromptContract:()=>false,protectSmartAiResourceMentions:text=>({text}),buildSmartAiRequirements:()=>'',readSmartAiResult:()=>({prompt:'red ball',hasNegativePrompt:false}),restoreSmartAiResourceMentions:text=>({ok:true,text}),validateSmartAiArtPromptPreservation:()=>({ok:true})};
  const a=smartSource.indexOf('  function verifiedAgentPromptHandoff('),b=smartSource.indexOf('  // H3 prompts kept in the prompt history',a);
  assert.ok(a>0&&b>a);vm.createContext(ctx);vm.runInContext(smartSource.slice(a,b)+'\nglobalThis.invoke=optimizeForAgent;',ctx);
  return {invoke:options=>ctx.invoke({surface:'art',prompt:'red ball',supportsNegativePrompt:false,assistantSelectionScope:'xiaotao',...options}),calls:()=>calls};
}

test('selected Qwen uses verified scoped optimization; missing capability, online, stale result never fall back',async()=>{
  const f=optimizerFixture({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:1});
  assert.equal((await f.invoke()).analysisBackend,'qwen-cpu');assert.equal(f.calls(),1);
  for(const x of [optimizerFixture(null),optimizerFixture({provider:'api',modelId:'xai/grok-4.7',epoch:1}),optimizerFixture({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:1},false),optimizerFixture({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:1},true,true)]){
    await assert.rejects(x.invoke());
  }
});

test('unscoped online video with a local Xiaotao selection fails closed without charging',async()=>{
  const calls=[];
  const controller={businessModelSnapshot:()=>({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:1})};
  const window={crypto:{randomUUID:()=> 'legacy-id'},NovaFlowXiaotaoArtAgent:{panel:{controller}},electronAPI:{
    qwenBusinessAvailableSync:()=>false,
    promptAssistantOptimizePrompt:async()=>{calls.push('local');throw Error('unexpected local');},
    smartAiPromptOptimize:async()=>{calls.push('legacy-online');throw Error('legacy-online-reached');}
  }};
  const workflow={prepareRequest:()=>({prompt:'synthetic',requirements:'',context:{},protocol:{references:[]}}),toModelReferences:()=>''};
  const ctx={window,MINIMAX_H3_MODEL_ID:'h3',MINIMAX_H3_PROMPT_PURPOSE:'video',MINIMAX_H3_VISUAL_SCHEMA:{},
    getMiniMaxH3PromptWorkflow:()=>workflow,captureH3ReferenceFrames:async()=>[]};
  const a=smartSource.indexOf('  function verifiedAgentPromptHandoff('),b=smartSource.indexOf('  // H3 prompts kept in the prompt history',a);
  assert.ok(a>0&&b>a);vm.createContext(ctx);vm.runInContext(smartSource.slice(a,b)+'\nglobalThis.invoke=optimizeForAgent;',ctx);
  await assert.rejects(ctx.invoke({surface:'animation',analysisProvider:'api',prompt:'synthetic',videoContext:{modelId:'h3',mode:'image_video',durationSeconds:2}}),/模型选择来源不明确/);
  assert.deepEqual(calls,[]);
  delete window.NovaFlowXiaotaoArtAgent;
  await assert.rejects(ctx.invoke({surface:'animation',analysisProvider:'api',prompt:'synthetic',videoContext:{modelId:'h3',mode:'image_video',durationSeconds:2}}),/legacy-online-reached/);
  assert.deepEqual(calls,['legacy-online']);
});

test('video executor propagates scope, checks before writing, and does not reuse another model cache',async()=>{
  const ctx={setTimeout:fn=>fn()},calls=[];vm.createContext(ctx);vm.runInContext(mediaSource,ctx);
  let prompt='initial',valid=true;
  ctx.NovaFlowAudioStudio={sub:()=> 'video',open(){},resources:()=>[]};
  ctx.NovaFlowAiSequenceGeneration={capture:()=>({mode:'local',genType:'image_video',prompt}),optimizationContext:async()=>({modelId:'minimax_h3_local',mode:'image_video',durationSeconds:2,resources:[]}),status:()=>({state:'idle'}),resources:()=>[],setRequest(op){prompt=op.prompt;}};
  ctx.__NovaFlowSmartAI={optimizeForAgent:async options=>{calls.push(options);return {prompt:'english',displayPrompt:'draft'};}};
  const media=ctx.NovaFlowMediaAgent,fingerprint=async()=>'same';
  const run=async id=>{const snapshot=media.capture();return media.execute({planId:id,contextFingerprint:'same',operations:[{action:'optimize_video_prompt',target:'video'}]},{snapshot,fingerprint,assistantSelectionScope:'xiaotao',selectionStillCurrent:()=>valid,reuseOptimizedPrompt:true});};
  await run('first');await run('second');assert.equal(calls.length,2);assert.equal(calls[0].assistantSelectionScope,'xiaotao');
  ctx.__NovaFlowSmartAI.optimizeForAgent=async()=>{valid=false;return {prompt:'old',displayPrompt:'old'};};
  await assert.rejects(run('changed'),/模型选择已变化/);assert.equal(prompt,'draft');
});
