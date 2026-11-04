import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {qwenTextBusinessFailure} from '../worker/src/local-model-selection.mjs';

const smart=await readFile(new URL('../renderer/novaflow-smart-ai.js',import.meta.url),'utf8');
const agent=await readFile(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
const modes=['text_video','image_video','first_last','multi_reference'];
const request=mode=>({surface:'animation',purpose:'minimax-h3-prompt-enhance',h3Mode:mode,prompt:'角色向前走',requirements:'保留动作',h3ReferenceFrames:[]});

test('worker permits only the four H3 text modes and keeps all media and placeholder guards',()=>{
  for(const mode of modes)for(const requirements of ['保留动作','H3 compile: translate-only'])
    assert.equal(qwenTextBusinessFailure('optimizePrompt',{...request(mode),requirements}),null);
  for(const bad of [{h3Mode:'unknown'},{purpose:'other'},{h3ReferenceFrames:[{dataUrl:'data:image/png;base64,YQ=='}]},
    {nested:{audio:'data:audio/wav;base64,YQ=='}},{prompt:'<image1>'},{prompt:'__NOVAFLOW_RESOURCE_MENTION_1__'}])
    assert.equal(qwenTextBusinessFailure('optimizePrompt',{...request('first_last'),...bad})?.errorCode,'qwen-business-text-only');
  assert.equal(qwenTextBusinessFailure('rewriteAudioPrompt',{kind:'sfx',input:'轻风',seconds:2}),null);
  assert.equal(qwenTextBusinessFailure('rewriteAudioPrompt',{kind:'sfx',input:'data:audio/wav;base64,YQ==',seconds:2})?.errorCode,'qwen-business-text-only');
});

test('H3 optimizer never captures images during either local inference, and rejects explicit vision requests',async()=>{
  for(const mode of modes){
    const sent=[];let captures=0;
    const selection={provider:'local',modelId:'qwen3.5-9b-heretic',epoch:1};
    const controller={businessModelSnapshot:()=>selection};
    const window={crypto:webcrypto,NovaFlowXiaotaoArtAgent:{panel:{controller}},electronAPI:{qwenBusinessAvailableSync:()=>true,
      promptAssistantOptimizePrompt:async p=>{sent.push(p);return {ok:true,data:{prompt:'中文动作',analysisBackend:'qwen-cpu',resourcesReleased:true,generationReady:true,modelIdentity:{id:'qwen35-heretic',verification:'server-weight-path'}}};}}};
    const workflow={prepareRequest:()=>({prompt:'角色向前走',requirements:'动作',context:{contentPolicy:{}},protocol:{protocolName:'H3',fieldOrder:[],references:{references:[]}}}),
      toModelReferences:()=>'',validateAndRestore:()=>({text:'中文动作',modelText:'action'}),
      compileForGeneration:async(_ctx,compile)=>{await compile({...request(mode),requirements:'H3 compile: translate-only'});return {text:'中文动作',modelText:'action',asWritten:false};}};
    const scope={window,MINIMAX_H3_MODEL_ID:'minimax_h3_local',MINIMAX_H3_PROMPT_PURPOSE:'minimax-h3-prompt-enhance',MINIMAX_H3_VISUAL_SCHEMA:'v1',
      getMiniMaxH3PromptWorkflow:()=>workflow,captureH3ReferenceFrames:async()=>{captures++;throw Error('must not read frames');},readSmartAiResult:r=>({prompt:r.data.prompt})};
    const a=smart.indexOf('  function verifiedAgentPromptHandoff('),b=smart.indexOf('  // H3 prompts kept in the prompt history',a);assert.ok(a>0&&b>a);
    vm.createContext(scope);vm.runInContext(smart.slice(a,b)+'\nglobalThis.optimize=optimizeForAgent;',scope);
    const opts={surface:'animation',analysisProvider:'local',assistantSelectionScope:'xiaotao',prompt:'角色向前走',videoContext:{modelId:'minimax_h3_local',mode,durationSeconds:2}};
    const result=await scope.optimize(opts);assert.equal(result.displayPrompt,'中文动作');assert.equal(sent.length,2);assert.equal(captures,0);
    for(const payload of sent){assert.deepEqual(Array.from(payload.h3ReferenceFrames),[]);assert.equal(qwenTextBusinessFailure('optimizePrompt',payload),null);}
    await assert.rejects(scope.optimize({...opts,requirements:'请分析参考图的内容'}),/只处理文字/);assert.equal(sent.length,2);
  }
});

test('Xiaotao applies local H3 result without reading reference frames, or ignores a stale result',async()=>{
  for(const mode of modes)for(const stale of [false,true]){
    let valid=true,applied='',captureArgs,modelArgs;
    const ctx=vm.createContext({crypto:webcrypto,TextEncoder,Uint8Array,atob,console,setTimeout,clearTimeout,setInterval,clearInterval,AbortController});
    const marker='return Object.freeze({state, retire, businessModelSnapshot,';assert.equal(agent.split(marker).length,2);
    vm.runInContext(agent.replace(marker,'return Object.freeze({prepareSelectedH3TextDraft, state, retire, businessModelSnapshot,'),ctx);
    ctx.NovaFlowAiSequenceGeneration={capture:()=>({genType:mode}),optimizationContext:async()=>({modelId:'minimax_h3_local',mode,durationSeconds:2})};
    ctx.NovaFlowMediaAgent={captureH3TextDraft:async options=>{captureArgs=options;return {request:{h3Mode:mode,durationSeconds:2,prompt:'角色向前走',requirements:'优化'},isCurrent:()=>valid,applyDraft:async text=>{applied=text;return {phase:'applied'}}};}};
    ctx.__NovaFlowSmartAI={optimizeForAgent:async options=>{modelArgs=options;if(stale)valid=false;return {analysisBackend:'qwen-cpu',modelIdentity:{id:'qwen35-heretic'},resourcesReleased:true,generationReady:true,displayPrompt:'优化后的动作'};}};
    const api={qwenBusinessAvailableSync:()=>true,qwen21NativeRewriteV3AvailableSync:()=>true,captureFoartSessionGuard:()=>()=>true};
    const controller=ctx.NovaFlowXiaotaoArtAgent.createController({bridge:{clearPrepared(){}},storage:{getItem(){return null},setItem(){}},api:()=>api});
    assert.equal(await controller.prepareSelectedH3TextDraft('优化提示词',{recordMessage:false}),!stale,controller.state.error);
    assert.equal(captureArgs.includeReferenceImages,false);assert.equal(modelArgs.assistantSelectionScope,'xiaotao');assert.equal(applied,stale?'':'优化后的动作');
  }
});
