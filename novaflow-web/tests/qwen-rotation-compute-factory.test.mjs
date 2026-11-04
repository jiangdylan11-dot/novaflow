// No model is launched: this tests only trusted construction and the real
// prompt-assistant factory's status / fail-closed request boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {computePromptAssistantOptions} from '../worker/src/compute-assistant.mjs';
import {createPromptAssistant} from '../worker/src/prompt-assistant.mjs';

const worker={getState:()=>({sharing:true,runtimeReady:true,currentTaskId:'test-task'})};
const urls=['http://127.0.0.1:8188'];
const impossibleConfig=join(tmpdir(),'foart-absent-rotation-config-for-factory-test.json');
function opts(options={}) {
  return computePromptAssistantOptions({promptAssistant:{strataConfigPath:impossibleConfig},...options},worker,urls);
}
test('only two explicit top-level trusted true switches enable candidate in actual Strata factory',async()=>{
  for(const [candidate,verification,expected] of [[undefined,undefined,false],[true,undefined,false],[undefined,true,false],[true,true,true],['true',true,false],[true,1,false]]){
    const options=opts({qwenRotationCandidateEnabled:candidate,qwenRotationVerificationEnabled:verification});
    assert.equal(options.qwenRotationCandidateEnabled,expected);
    const assistant=createPromptAssistant(options);
    try {assert.equal(assistant.status().qwenRotationCandidateEnabled,expected);} finally {await assistant.stop();}
  }
});
test('nested config cannot turn candidate on, and ordinary trusted settings are preserved',async()=>{
  const logger=()=>{},otherWorker={getState:()=>({})};
  const options=computePromptAssistantOptions({logger,enableQwenBusinessBridge:true,qwenBusinessTextOnly:true,
    promptAssistant:{strataConfigPath:impossibleConfig,qwenRotationCandidateEnabled:true,qwenRotationVerificationEnabled:true,artLearning:{fixture:true}}},otherWorker,urls);
  assert.equal(options.qwenRotationCandidateEnabled,false);assert.equal(options.worker,otherWorker);assert.equal(options.logger,logger);
  assert.equal(options.comfyUrls,urls);assert.equal(options.qwenBusinessBridge,true);assert.equal(options.qwenBusinessTextOnly,true);
  assert.deepEqual(options.artLearning,{fixture:true});
  const assistant=createPromptAssistant(options);try{assert.equal(assistant.status().qwenRotationCandidateEnabled,false);}finally{await assistant.stop();}
});
test('request payload cannot enable candidate or supply trusted verifier',async()=>{
  const assistant=createPromptAssistant(opts());
  try {
    const payload={mode:'foart',modelId:'qwen3.5-9b-heretic',qwenRotationCandidateEnabled:true,qwenRotationVerificationEnabled:true,
      rotationActor:{taskId:'test-task',workerId:'fake',scope:'qwen-foart-rotation-candidate-v1',attempt:1},rotationPhaseVerifier:()=>true};
    const result=await assistant.runForTask('test-task','qwenRotationCandidate',payload);
    assert.equal(result.ok,false);assert.equal(assistant.status().qwenRotationCandidateEnabled,false);
  }finally{await assistant.stop();}
});
