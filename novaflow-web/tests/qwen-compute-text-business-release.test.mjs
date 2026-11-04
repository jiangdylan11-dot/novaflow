import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPromptAssistant} from '../worker/src/prompt-assistant.mjs';
import {createStrataPromptAssistant} from '../worker/src/strata-prompt-assistant.mjs';
import {computePromptAssistantOptions} from '../worker/src/compute-assistant.mjs';
import {qwenTextBusinessFailure} from '../worker/src/local-model-selection.mjs';
import {validateQwenUiTask} from '../worker/src/worker-core.mjs';

const source=await readFile(new URL('../worker/electron/compute-main.cjs',import.meta.url),'utf8');
const match=source.match(/assistant\s*=\s*await\s+assistantFactory\(\{([\s\S]*?)\}\);/);
assert.ok(match,'packaged assistant construction is present');
const run=new Function('assistantFactory','config','defaults','CONTROL','dataDir','path','__dirname','resource','QWEN_ROTATION_RELEASE_POLICY','log','operation','emit',`return assistantFactory({${match[1]}});`);
const opts=run(x=>x,{modelsRoot:''},()=>({workerName:'fixture'}),'https://example.invalid','fixture',{join:(...p)=>p.join('/')},'fixture',()=>'',{verificationEnabled:false,candidateEnabled:false,planVerificationEnabled:false,planEnabled:false},()=>{},null,()=>{});

test('packaged node opts in to text bridge without changing GPU or opening UI/animation scopes',()=>{
 assert.equal(opts.enableQwenBusinessBridge,true);assert.equal(opts.qwenBusinessTextOnly,true);
 assert.equal(opts.qwenRotationCandidateEnabled,false);assert.equal(opts.qwenPlanEnabled,false);
 assert.equal(Object.hasOwn(opts,'executionMode'),false);assert.equal(Object.hasOwn(opts,'qwenUiDraftEnabled'),false);
 const actual=computePromptAssistantOptions(opts,{},[]);assert.equal(actual.qwenBusinessBridge,true);assert.equal(actual.qwenBusinessTextOnly,true);
});
test('only text art/audio are admitted; image, audio/video bytes and UI scope stay rejected',()=>{
 const selected={assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic'};
 assert.equal(qwenTextBusinessFailure('optimizePrompt',{...selected,surface:'art',purpose:'optimize',targetEngine:'qwen-2.1',qwenPromptMode:'txt2img',prompt:'cat',images:[]}),null);
 assert.equal(qwenTextBusinessFailure('rewriteAudioPrompt',{...selected,input:'soft wind'}),null);
 for(const [method,payload] of [['reverseImagePrompt',{...selected,images:[{dataUrl:'data:image/png;base64,AA=='}]}],['rewriteAudioPrompt',{...selected,input:'wind',audio:'data:audio/wav;base64,AA=='}],['optimizePrompt',{...selected,surface:'art',purpose:'optimize',targetEngine:'qwen-2.1',qwenPromptMode:'img2img',prompt:'cat',video:'data:video/mp4;base64,AA=='}]])
   assert.equal(qwenTextBusinessFailure(method,payload)?.errorCode,'qwen-business-text-only');
 assert.throws(()=>validateQwenUiTask({parameters:{ui_scope:'qwen-ui-draft-v1'}}),{code:'qwen-ui-lease-unavailable'});
});
test('enabling bridge with missing helper files does not report business ready',async()=>{
 const assistant=createPromptAssistant({worker:{getState:()=>({currentTaskId:null})},pythonPath:'missing/engine/python.exe',serviceScript:'missing/prompt-assistant-service.py',runtimeJsonPath:'missing/runtime.json',qwenSession:{withSession:async()=>{throw Error('must not load model');}},communityCpuTrialForDevelopment:true,qwenBusinessBridge:true,qwenBusinessTextOnly:true});
 try{const status=assistant.status(),qwen=status.localModels.find(x=>x.id==='qwen3.5-9b-heretic');assert.equal(status.qwenBusinessBridgeEnabled,true);assert.equal(qwen?.configured,true);assert.notEqual(qwen?.trial?.business,true);}
 finally{await assistant.stop();}
});

test('bounded business opt-in does not block existing Qwen text or image chat',async()=>{
  const png='data:image/png;base64,iVBORw0KGgo=';
  for(const enabled of [false,true]){
    const sent=[];
    const qwenSession={async withSession(callback){
      const flash={identity:{id:'qwen35-heretic'},async inferConversation(request){sent.push(request);return {model:'qwen35-heretic',requestId:'fixture-reply',finishReason:'stop',message:{role:'assistant',content:'synthetic answer'}};}};
      return {value:await callback(flash,new AbortController().signal),identity:flash.identity,timing:{},resourcesReleased:true};
    }};
    const assistant=createStrataPromptAssistant({worker:{getState:()=>({currentTaskId:null})},qwenSession,communityCpuTrialForDevelopment:true,qwenBusinessBridge:enabled,qwenBusinessTextOnly:enabled,qwenBusinessReady:()=>true});
    try {
      const model=assistant.status().localModels.find(x=>x.id==='qwen3.5-9b-heretic');assert.equal(model.trial.chat,true);assert.equal(model.trial.images,true);
      for(const [kind,images] of [['text',[]],['image',[{role:'attachment',dataUrl:png}]]]){
        const result=await assistant.artAgentChat({requestId:'fixture-'+enabled+'-'+kind,modelId:'qwen3.5-9b-heretic',mode:'chat',message:'describe',history:[],images});
        assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.data.reply,'synthetic answer');
        assert.equal(JSON.stringify(sent.at(-1)).includes(png),kind==='image');assert.equal(sent.at(-1).tools,undefined);
      }
    } finally {await assistant.stop();}
  }
});
