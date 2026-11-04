import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOptimizeRequest,createPromptAssistant} from '../worker/src/prompt-assistant.mjs';
import {createStrataPromptAssistant} from '../worker/src/strata-prompt-assistant.mjs';

const valid={assistantSelectionScope:'xiaotao',assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic',
  surface:'art',purpose:'optimize',targetEngine:'qwen-2.1',qwenPromptMode:'txt2img',
  currentPrompt:'一只猫',negativePrompt:'模糊',promptContract:'qwen21-native-rewrite-v3'};

test('native contract is scoped to local Qwen text-to-image and legacy remains opt-in',()=>{
  const {request}=normalizeOptimizeRequest(valid);
  assert.equal(request.promptContract,valid.promptContract);
  assert.equal(request.negativePrompt,'模糊');
  const {assistantSelectionScope,...transported}=valid;
  assert.equal(normalizeOptimizeRequest(transported).request.promptContract,valid.promptContract);
  for(const change of [{assistantProvider:'api'},{assistantModelId:'other'},{assistantSelectionScope:'other'},
    {surface:'audio'},{purpose:'chat'},{qwenPromptMode:'img2img'},{nsfw:true},{promptContract:'unknown'}])
    assert.throws(()=>normalizeOptimizeRequest({...valid,...change}));
  const {promptContract,...legacy}=valid;
  assert.equal(normalizeOptimizeRequest(legacy).request.promptContract,undefined);
});

test('local audio rewriting forwards requested changes in the owned session',async()=>{
  let inference, released=false;
  const flash={identity:{id:'qwen35-heretic'},infer:async request=>{inference=request;return {text:'A gentle piano melody.',model:'qwen35-heretic'};}};
  const qwenSession={withSession:async callback=>{const value=await callback(flash);released=true;return {value,identity:flash.identity,timing:{callbackMs:1}};}};
  const assistant=createStrataPromptAssistant({worker:{getState:()=>({currentTaskId:null})},qwenSession,
    communityCpuTrialForDevelopment:true,qwenBusinessBridge:true,qwenBusinessTextOnly:true,qwenBusinessReady:()=>true});
  try {
    const result=await assistant.rewriteAudioPrompt({requestId:'audio-requirements-test',assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic',kind:'music',input:'钢琴旋律',seconds:30,bpm:80,requirements:'节奏放慢，增加空间感'});
    assert.equal(result.ok,true); assert.equal(result.resourcesReleased,true); assert.equal(released,true);
    assert.match(inference.user,/Requested changes: 节奏放慢，增加空间感/); assert.match(inference.user,/Required tempo: 80 BPM/);
  } finally {await assistant.stop();}
});

test('native capability requires the exact packaged service, adapter and policy',async()=>{
  const {mkdtemp,mkdir,copyFile,appendFile,rm}=await import('node:fs/promises');
  const {join}=await import('node:path'); const {tmpdir}=await import('node:os'); const {fileURLToPath}=await import('node:url');
  const dir=await mkdtemp(join(tmpdir(),'qwen-native-')); const moduleDir=join(dir,'prompt_assistant');
  await mkdir(moduleDir);
  const source=rel=>fileURLToPath(new URL('../../particle-editor-desktop/'+rel,import.meta.url));
  const service=join(dir,'prompt-assistant-service.py');
  await copyFile(source('prompt-assistant-service.py'),service);
  for(const name of ['flash_adapter.py','qwen21_prompt_policy.py'])
    await copyFile(source('prompt_assistant/'+name),join(moduleDir,name));
  const assistant=createPromptAssistant({qwenBusinessBridge:true,qwenBusinessReady:()=>true,
    pythonPath:process.execPath,serviceScript:service,qwenSession:{withSession:async()=>{throw Error('unexpected inference');}}});
  try {
    assert.equal(assistant.status().qwen21NativeRewriteV3Enabled,true);
    await appendFile(join(moduleDir,'qwen21_prompt_policy.py'),'\n# changed\n');
    assert.equal(assistant.status().qwen21NativeRewriteV3Enabled,false);
  } finally { await assistant.stop(); await rm(dir,{recursive:true,force:true}); }
});
