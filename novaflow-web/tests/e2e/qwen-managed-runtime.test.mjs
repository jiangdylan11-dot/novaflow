import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveQwenManagedRuntime} from '../../worker/src/qwen-managed-runtime.mjs';
import {createStrataPromptAssistant} from '../../worker/src/strata-prompt-assistant.mjs';

test('legacy explicit runner and model configuration remain unchanged',()=>{
  const config={capability:'qwen35-chat-cpu-v1',exe:'existing.exe',model:'existing.gguf',projector:'vision.gguf'};
  assert.equal(resolveQwenManagedRuntime(config,'unused').config,config);
});

test('managed runner reports missing, incomplete and not approved without fallback',async()=>{
  const root=mkdtempSync(join(tmpdir(),'foart-managed-qwen-'));
  try {
    const config={capability:'qwen35-chat-cpu-v1',managedRunner:'ollama-v0.40.13',
      exe:join(root,'old','llama-server.exe'),pythonPath:join(root,'python.exe'),
      model:join(root,'external-model.gguf'),projector:join(root,'external-vision.gguf')};
    const lookup=()=>resolveQwenManagedRuntime(config,root);
    assert.equal(lookup().failure.errorCode,'qwen-managed-runner-missing');
    const component=join(root,'engine','llama','ollama-v0.40.13');
    mkdirSync(component,{recursive:true});
    assert.equal(lookup().failure.errorCode,'qwen-managed-runner-incomplete');
    const server=join(component,'lib','ollama','llama-server.exe');
    mkdirSync(join(component,'lib','ollama'),{recursive:true});writeFileSync(server,'fixture');
    assert.equal(lookup().failure.errorCode,'qwen-managed-runner-unapproved');
    assert.equal(lookup().config,null);
    assert.equal(config.model,join(root,'external-model.gguf'));
    assert.equal(config.projector,join(root,'external-vision.gguf'));
    const assistant=createStrataPromptAssistant({configPath:join(root,'strata-prompt.json'),qwenConfig:config,worker:{getState:()=>({currentTaskId:null})}});
    const status=assistant.status().localModels.find(item=>item.id==='qwen3.5-9b-heretic');
    assert.equal(status.enabled,false);assert.equal(status.identityVerified,false);
    assert.equal(status.errorCode,'qwen-managed-runner-unapproved');
    const result=await assistant.artAgentChat({modelId:'qwen3.5-9b-heretic',mode:'chat',requestId:'qwen-managed-123',message:'你好',history:[],images:[]});
    assert.equal(result.ok,false);assert.equal(result.errorCode,'qwen-managed-runner-unapproved');
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('unknown managed versions are rejected',()=>{
  assert.equal(resolveQwenManagedRuntime({managedRunner:'other'},tmpdir()).failure.errorCode,'qwen-managed-runner-invalid');
});

test('explicit GPU mode cannot silently launch the CPU-only supervisor',()=>{
  const config={capability:'qwen35-chat-cpu-v1',exe:'existing.exe',executionMode:'gpu'};
  const result=resolveQwenManagedRuntime(config,tmpdir());
  assert.equal(result.config,null);
  assert.equal(result.failure.errorCode,'qwen-gpu-managed-required');
  assert.equal(config.exe,'existing.exe');
  assert.equal(resolveQwenManagedRuntime({...config,executionMode:'cpu'},tmpdir()).config.executionMode,'cpu');
  assert.equal(resolveQwenManagedRuntime({...config,executionMode:'auto'},tmpdir()).failure.errorCode,'qwen-execution-mode-invalid');
});
