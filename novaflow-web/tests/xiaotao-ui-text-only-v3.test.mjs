import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalizeXiaotaoV3UiIntent,inspectXiaotaoV3UiReply} from '../packages/shared/src/xiaotao-ui-framework-v3.mjs';

const actor={userId:'synthetic-user',sessionId:'synthetic-session'};
const request={requestId:'synthetic_request_01',revision:'synthetic-revision',prompt:'Design a music player with a play button',requirements:'Use a dark background',negativePrompt:'No advertising',generationIntent:'redesign',preserveLayout:false,size:{width:768,height:512},structure:{name:'UI',width:768,height:512,regions:[]},references:[]};
const plan={version:1,layoutMode:'reflow',layoutReference:0,visualMode:'create',references:[],layoutChanges:[],preserve:['play button']};
const reply={prompt:'Dark music player with an accessible play button',negativePrompt:'No advertising',uiPlan:plan};

test('text-only UI uses selected model, actual professional text rules and zero images',async()=>{
  for(const model of ['deepseek/deepseek-v4.1-flash','xai/grok-4.7','openai/gpt-6.1-sol-saver','qwen3.5-9b-heretic']){
    const result=await canonicalizeXiaotaoV3UiIntent({mode:'ui-draft',epoch:1,request},{actor,model,isCurrent:async()=>true});
    assert.equal(result.uiPrepared.model,model);assert.equal(result.compiled.textOnly,true);assert.equal(result.compiled.imageCount,0);
    assert.match(result.compiled.systemText,/UI 视觉设计助手/);assert.match(result.compiled.systemText,/没有输入图片|没有图片|没有参考图|No image was supplied/);
    assert.equal(result.uiPrepared.canonical.anchor,0);assert.deepEqual(result.uiPrepared.canonical.manifest,[]);
    const preview=await inspectXiaotaoV3UiReply({uiPrepared:result.uiPrepared,uiAdapter:result.uiAdapter,reply:JSON.stringify(reply)});
    assert.equal(preview.status,'preview-only');assert.equal(preview.layoutAnchor,0);assert.deepEqual(preview.sourceManifest,[]);
  }
});
test('text-only UI rejects invented image references and incomplete outputs',async()=>{
  const model='deepseek/deepseek-v4.1-flash';
  const compile=async r=>canonicalizeXiaotaoV3UiIntent({mode:'ui-draft',epoch:1,request:r},{actor,model,isCurrent:async()=>true});
  await assert.rejects(()=>compile({...request,prompt:'follow 参考图1'}),{code:'ui-reference-out-of-range'});
  const result=await compile(request),inspect=r=>inspectXiaotaoV3UiReply({uiPrepared:result.uiPrepared,uiAdapter:result.uiAdapter,reply:JSON.stringify(r)});
  await assert.rejects(()=>inspect({...reply,prompt:'根据参考图中的布局绘制'}),{code:'ui-unprovided-image-claim'});
  await assert.rejects(()=>inspect({...reply,uiPlan:{...plan,layoutReference:1}}),{code:'ui-invalid-result'});
  await assert.rejects(()=>inspect({...reply,uiPlan:{...plan,references:[{index:1,role:'layout'}]}}),{code:'ui-invalid-result'});
  await assert.rejects(()=>inspect({...reply,negativePrompt:''}),{code:'ui-negative-constraints-missing'});
});

test('UI operation assembly permits text without vision but rejects images without vision before billing',async()=>{
 const {canonicalizeXiaotaoV3OperationIntent}=await import('../packages/shared/src/xiaotao-operation-v3-prepare.mjs');
 const model='deepseek/deepseek-v4.1-flash',intent={mode:'ui-draft',epoch:1,request};
 const compiled=await canonicalizeXiaotaoV3OperationIntent(intent,{actor,model,isCurrent:async()=>true,uiDraftEnabled:true,visionEnabled:false});
 assert.equal(compiled.compiled.textOnly,true);assert.equal(compiled.compiled.imageCount,0);
 await assert.rejects(()=>canonicalizeXiaotaoV3OperationIntent({...intent,request:{...request,references:[{id:'synthetic'}]}},{actor,model,isCurrent:async()=>true,uiDraftEnabled:true,visionEnabled:false}),{code:'model-vision-unavailable'});
});
