import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPromptAssistant } from '../../worker/src/prompt-assistant.mjs';

test('real factory exposes the opt-in state only for an explicit isolated worker and rejects media and tools before launch', async t => {
  if (process.platform !== 'win32') return t.skip('CPU trial is Windows-only');
  const dir=mkdtempSync(join(tmpdir(),'foart-community-trial-'));
  const old=process.env.NOVAFLOW_QWEN_CPU_CONFIG;
  let assistant;
  try {
    const files={};
    for(const key of ['pythonPath','exe','model','projector']) {
      files[key]=join(dir,key);writeFileSync(files[key],'test placeholder, never executed');
    }
    const config=join(dir,'qwen.json');writeFileSync(config,JSON.stringify(files));
    process.env.NOVAFLOW_QWEN_CPU_CONFIG=config;
    let currentTaskId=null;
    const options={worker:{getState:()=>({currentTaskId})},comfyUrls:['http://127.0.0.1:8188'],
      strataConfigPath:join(dir,'no-next-config.json')};
    const disabled=createPromptAssistant(options);
    const disabledModel=disabled.status().localModels.find(model=>model.id==='qwen3.5-9b-heretic');
    assert.equal(disabledModel.enabled,false);assert.equal(disabledModel.trial,undefined);
    await disabled.stop();
    assistant=createPromptAssistant({...options,communityCpuTrialForDevelopment:true});
    const enabled=assistant.status().localModels.find(model=>model.id==='qwen3.5-9b-heretic');
    assert.equal(enabled.enabled,true);assert.equal(enabled.trial.backend,'cpu');
    assert.equal(enabled.trial.exclusive,false);assert.equal(enabled.trial.chat,true);assert.equal(enabled.trial.images,true);
    assert.equal(enabled.trial.tools,false);assert.equal(enabled.trial.audio,false);assert.equal(enabled.trial.video,false);
    currentTaskId='isolated-task-123';
    const base={modelId:'qwen3.5-9b-heretic',requestId:'isolated-request-123',message:'test',history:[],images:[]};
    for(const payload of [{...base,mode:'foart'},{...base,mode:'chat',uploads:[{kind:'video',name:'test.mp4'}]},
      {...base,mode:'chat',uploads:[{kind:'audio',name:'test.wav'}]}]) {
      const reply=await assistant.runForTask(currentTaskId,'artAgentChat',payload);
      assert.equal(reply.ok,false);assert.equal(reply.errorCode,'community-trial-capability-unavailable');
    }
    currentTaskId='other-task';
    const blocked=await assistant.runForTask('isolated-task-123','artAgentChat',{...base,mode:'chat'});
    assert.equal(blocked.errorCode,'community-runtime-ownership-unconfirmed');
  } finally {
    await assistant?.stop();
    if(old===undefined)delete process.env.NOVAFLOW_QWEN_CPU_CONFIG;else process.env.NOVAFLOW_QWEN_CPU_CONFIG=old;
    rmSync(dir,{recursive:true,force:true});
  }
});
