import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStrataPromptAssistant} from '../../worker/src/strata-prompt-assistant.mjs';

const status=a=>a.status().localModels.find(item=>item.id==='qwen3.5-9b-heretic');
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
test('registered missing or incorrect model identity never advertises readiness',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'qwen-registration-test-'));
  const model=join(dir,'model.gguf'),projector=join(dir,'projector.gguf');
  try {
    writeFileSync(model,'bad model');writeFileSync(projector,'bad projector');
    const config={pythonPath:process.execPath,exe:process.execPath,model,projector,capability:'qwen35-chat-cpu-v1'};
    const worker={getState:()=>({currentTaskId:null})};
    const a=createStrataPromptAssistant({worker,qwenConfig:config});
    if(process.platform==='win32') {
      assert.equal(status(a).enabled,false);assert.equal(status(a).identityVerified,false);
      await settle();assert.equal(status(a).errorCode,'qwen-identity-unverified');
      // A changed file triggers a new background attempt rather than reusing
      // either the previous failure or a stale positive verification.
      writeFileSync(model,'different bad model');
      assert.equal(status(a).errorCode,'qwen-identity-verifying');
      await settle();assert.equal(status(a).errorCode,'qwen-identity-unverified');
      assert.equal(status(a).enabled,false);assert.equal(status(a).identityVerified,false);
    } else {assert.equal(status(a).enabled,false);assert.equal(status(a).configured,false);}
    const result=await a.artAgentChat({modelId:'qwen3.5-9b-heretic',mode:'chat',requestId:'qwen-verify-123',message:'你好',history:[],images:[]});
    assert.equal(result.ok,false);
  } finally {unlinkSync(model);unlinkSync(projector);rmdirSync(dir);}
});
test('injected session is not a production registration',()=>{
  const a=createStrataPromptAssistant({worker:{getState:()=>({currentTaskId:null})},qwenSession:{withSession(){}},qwenConfig:{capability:'qwen35-chat-cpu-v1'}});
  assert.equal(status(a).enabled,false);assert.equal(status(a).identityVerified,false);assert.equal(status(a).errorCode,'community-runtime-ownership-unconfirmed');
});
