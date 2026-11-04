import test from 'node:test';
import assert from 'node:assert/strict';
import {qwenTextBusinessFailure} from '../worker/src/local-model-selection.mjs';
import {createStrataPromptAssistant} from '../worker/src/strata-prompt-assistant.mjs';
import {computePromptAssistantOptions} from '../worker/src/compute-assistant.mjs';

const selected={assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic'};
const art={...selected,surface:'art',purpose:'optimize',targetEngine:'qwen-2.1',qwenPromptMode:'txt2img',prompt:'一只小猫',images:[]};
test('text trial only accepts the two specifically verified business modes',()=>{
  assert.equal(qwenTextBusinessFailure('optimizePrompt',art),null);
  assert.equal(qwenTextBusinessFailure('rewriteAudioPrompt',{...selected,input:'轻柔的雨声'}),null);
  for(const [method,value] of [['reverseImagePrompt',art],['describeArtStyle',art],
    ['optimizePrompt',{...art,qwenPromptMode:'img2img'}],['optimizePrompt',{...art,qwenPromptMode:'unknown'}],['optimizePrompt',{...art,surface:'animation'}],
    ['optimizePrompt',{...art,targetEngine:'gpt-image-2.5'}]])
    assert.equal(qwenTextBusinessFailure(method,value).errorCode,'qwen-business-text-only');
});
test('raw attachments, nested references and disguised media fail before normalization',()=>{
  for(const extra of [{images:[{dataUrl:'data:image/png;base64,AA=='}]},
    {references:[{role:'style',url:'https://fixture.invalid/img.png'}]},
    {artContext:{references:[{role:'subject',source:'image1'}]}},
    {h3ReferenceFrames:[{label:'Picture 1'}]},{reference_image_urls:['https://fixture.invalid/img.png']},{uploads:[{name:'voice.wav',type:'audio/wav'}]},
    {nested:{type:'video/mp4'}},{requirements:'请看 @参考图1'},
    {prompt:'<image1> test'},{other:{data:'data:image/png;base64,AA=='}}])
    assert.equal(qwenTextBusinessFailure('optimizePrompt',{...art,...extra}).errorCode,'qwen-business-text-only');
  const cyclic={...art};cyclic.self=cyclic;
  assert.equal(qwenTextBusinessFailure('optimizePrompt',cyclic).errorCode,'qwen-business-text-only');
});
test('trial boundary rejects unsupported requests before a model session opens',async()=>{
  let calls=0;
  const qwenSession={async withSession(){calls++;throw Error('must not run')}};
  const assistant=createStrataPromptAssistant({config:{},qwenConfig:{},qwenSession,qwenBusinessBridge:true,qwenBusinessTextOnly:true,
    qwenBusinessReady:()=>true,sessionFactory:()=>({}),lifecycle:{load:async()=>{},unload:async()=>({ok:true,released:true})}});
  try {
    for(const [method,payload] of [['reverseImagePrompt',{...selected}],['describeArtStyle',{...selected}],
      ['optimizePrompt',{...art,images:[{type:'image/png'}]}],['optimizePrompt',{...art,qwenPromptMode:'img2img'}]]){
      const result=await assistant[method](payload);
      assert.equal(result.ok,false);assert.equal(result.errorCode,'qwen-business-text-only');
    }
    assert.equal(calls,0);
  } finally {await assistant.stop();}
});
test('text-only scope requires explicit opt-in and leaves the production default closed',()=>{
  const base=computePromptAssistantOptions({}, {}, []);
  assert.equal(base.qwenBusinessBridge,false);assert.equal(base.qwenBusinessTextOnly,false);
  const trial=computePromptAssistantOptions({enableQwenBusinessBridge:true,qwenBusinessTextOnly:true},{},[]);
  assert.equal(trial.qwenBusinessBridge,true);assert.equal(trial.qwenBusinessTextOnly,true);
  const invalid=computePromptAssistantOptions({enableQwenBusinessBridge:'true',qwenBusinessTextOnly:'true'},{},[]);
  assert.equal(invalid.qwenBusinessBridge,false);assert.equal(invalid.qwenBusinessTextOnly,false);
});
