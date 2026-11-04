import test from 'node:test';
import assert from 'node:assert/strict';
import { localModelSelectionFailure } from '../../worker/src/local-model-selection.mjs';
import { createStrataPromptAssistant } from '../../worker/src/strata-prompt-assistant.mjs';

test('missing selection and retired Next are both rejected', () => {
  assert.equal(localModelSelectionFailure({}).errorCode,'local-model-selection-required');
  const retired=localModelSelectionFailure({modelId:'next'});
  assert.equal(retired.ok,false);
  assert.equal(retired.errorCode,'local-model-retired');
});

test('unselected chat and shared business cannot load Next or release Comfy',async()=>{
  const touched=[];
  const assistant=createStrataPromptAssistant({worker:{getState:()=>({currentTaskId:null})},
    comfyUrls:['http://127.0.0.1:8188'],config:{expectedModel:{ids:['next']}},
    lifecycle:{load:async()=>touched.push('load'),unload:async()=>touched.push('unload')},
    sessionFactory:()=>({withSession:async()=>touched.push('session')}),
    fetchImpl:async()=>{touched.push('comfy');throw Error('unexpected');},
    artLearning:{begin:async()=>touched.push('learning')}});
  const chat=await assistant.artAgentChat({mode:'drawing',message:'fixture'});
  assert.equal(chat.errorCode,'local-model-selection-required');
  assert.equal((await assistant.runForTask('task-1','artAgentChat',{mode:'chat',message:'fixture'})).errorCode,'local-model-selection-required');
  for(const method of ['optimizePrompt','reverseImagePrompt','describeArtStyle','rewriteAudioPrompt']) {
    const result=await assistant[method]({modelId:'qwen-image-2511',input:'fixture'});
    assert.equal(result.errorCode,'assistant-model-selection-required');
    assert.equal((await assistant.runForTask('task-1',method,{modelId:'qwen-image-2511',input:'fixture'})).errorCode,'assistant-model-selection-required');
  }
  assert.deepEqual(touched,[]);await assistant.stop();
});

test('explicit UI design CPU protocol still works without selecting a model',async()=>{
  let seen;
  const assistant=createStrataPromptAssistant({legacyApi:{reverseImagePrompt:async payload=>{seen=payload;return {ok:true};}}});
  const result=await assistant.reverseImagePrompt({surface:'ui-design',uiPlanner:'grok-vision-cpu-v1',action:'capabilities'});
  assert.equal(result.ok,true);assert.equal(seen.action,'capabilities');await assistant.stop();
});

test('unavailable selection is rejected before learning or model acquisition on both entry paths', async () => {
  let touched = false;
  const assistant = createStrataPromptAssistant({
    config: {expectedModel:{ids:['next']}},
    lifecycle: {load:async()=>{ touched=true; }, unload:async()=>{ touched=true; }},
    sessionFactory:()=>({withSession:async()=>{ touched=true; }}),
    artLearning:{begin:async()=>{ touched=true; }},
  });
  const payload={modelId:'gemma-4-12b-it',mode:'drawing'};
  assert.equal((await assistant.artAgentChat(payload)).errorCode,'local-model-unavailable');
  assert.equal((await assistant.runForTask('task','artAgentChat',payload)).errorCode,'local-model-unavailable');
  assert.equal(touched,false);
});

test('Gemma and unknown selections cannot silently run Next', () => {
  for (const modelId of ['gemma-4-12b-it', 'grok-4.7', '', null, 12]) {
    const result = localModelSelectionFailure({modelId});
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'local-model-unavailable');
  }
});
