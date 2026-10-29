import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { normalizeReverseRequest } from '../../worker/src/prompt-assistant.mjs';
import { artEditRendering } from '../../worker/src/art-edit-planner.mjs';
import { createWorkflowHost } from '../../worker/src/comfy/workflow-host.mjs';
import { prepareImageUrls } from '../../packages/shared/src/runninghub-gpt-image.mjs';
const require=createRequire(import.meta.url);
const cloud=require('../../admin/admin-server/art-direction.js');
const samples=[[0,0,180,180],[210,0,390,180],[400,0,580,180],[600,0,780,180]];
const use=(role,extra={})=>({role,detail:`observed ${role}`,target:'衣服',box:[0,0,1000,1000],samples:role==='style'?samples:[],...extra});
const plan=(refs=[])=>({schema:'nf.art.direction.v1',summary:'按图分别采用',prompt:'一名蓝衣女性，站在林间，精致的水彩画风。',preserve:['同一人物'],exclude:['辅助图人物'],clarification:'',references:refs});
function env(answer) {
  const calls=[],draws=[],storage=new Map();
  class Image {set src(value){this.url=value;this.naturalWidth=800;this.naturalHeight=1000;queueMicrotask(()=>this.onload());}}
  const document={createElement(tag){assert.equal(tag,'canvas');const c={width:0,height:0}; const ops=[];
    c.getContext=()=>({fillRect(){},drawImage(...args){ops.push(args.slice(1));draws.push(args);},getImageData:()=>({data:[80,100,120,255]}),strokeRect(){},filter:''});
    c.toDataURL=(mime)=>`data:${mime||'image/png'};base64,${Buffer.from(JSON.stringify([c.width,c.height,ops])).toString('base64')}`;return c;}};
  const sandbox={console,Image,document,TextEncoder,crypto:webcrypto,AbortController,queueMicrotask,setTimeout,clearTimeout,
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},electronAPI:{promptAssistantReverseImagePrompt:async p=>{calls.push(p);return {ok:true,data:{[p.purpose==='art-director-review'?'artReview':'artDirection']:typeof answer==='function'?await answer(p):answer}};}},NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1'})}};
  sandbox.window=sandbox;const context=createContext(sandbox);runInContext(readFileSync(new URL('../../renderer/art-direction.workflow.js',import.meta.url),'utf8'),context);
  return {api:sandbox.NovaFlowArtDirection,calls,draws,sandbox};
}
const ref=(id,role)=>({dataUrl:`data:image/png;base64,${Buffer.from(id).toString('base64')}`,drawingRole:role,name:id+'.png'});
const ctx=(state,references)=>{if(!Object.hasOwn(state,'drawingAnalysisEngine'))state.drawingAnalysisEngine='local';return {state,references,referenceLimit:10,generationSurface:'drawing'};};

test('backend validation failure cannot be bypassed by reparsing its rejected raw output',async()=>{
  const e=env();e.sandbox.electronAPI.promptAssistantReverseImagePrompt=async()=>({ok:true,data:{artDirection:null,validationError:'缺少风格区域',rawOutput:JSON.stringify(plan())}});
  await assert.rejects(e.api.prepare(ctx({prompt:'画一只猫'},[])),/缺少风格区域/);
});

test('one click analyzes a short prompt, preserves user text and uses no confirmation step',async()=>{
  const e=env(plan()),state={prompt:'冰系女剑客',negativePrompt:'不要文字',provider:'local',width:1024,height:1024};
  const result=await e.api.prepare(ctx(state,[]));
  assert.equal(state.prompt,'冰系女剑客');assert.equal(result.originalPrompt,'冰系女剑客');
  assert.equal(e.calls[0].purpose,'art-director');assert.equal(e.calls[0].currentPrompt,'冰系女剑客');
  assert.equal(result.promptSnapshot.negativePrompt,'不要文字');assert.equal(result.state.mode,'txt2img');
  assert.equal(result.state.localDrawEngine,'qwen-2.1');
});

test('local AI text-to-image optimizes once and does not call a second model review after generation',async()=>{
  const e=env(plan()),state={prompt:'冰系女剑客',provider:'local',drawingAnalysisEngine:'local'};
  const p=await e.api.prepare(ctx(state,[]));assert.equal(e.calls.length,1);
  assert.match(p.promptSnapshot.prompt,/水彩/);
  const r=await e.api.review(p,ref('result').dataUrl);assert.equal(r.skipped,true);assert.equal(e.calls.length,1);
});

test('AI writeback fills the editable boxes, keeps actual reference numbers and still rejects later changes',async()=>{
  const p=plan([{source:2,uses:[use('style')],omit:[]},{source:5,uses:[use('subject')],omit:[]}]);
  p.editEnhancer={kind:'qwen21-style-observation',version:'drawing-style-observation-v1',prompt:'将<image2>按<image1>实际画风重绘。',sourceOrder:[2,5],renderingClass:'other'};
  const e=env(p),state={provider:'local',prompt:'图5用图2画风',negativePrompt:'不要文字'},refs=[null,ref('style'),null,null,ref('photo')];
  const context=ctx(state,refs);context.getCurrentContext=()=>context;
  const result=await e.api.prepare(context);assert.equal(state.prompt,'图5用图2画风');
  assert.equal(result.applyPromptToState(),true);
  assert.match(state.prompt,/将@参考图5按@参考图2实际画风/);assert.equal(state.negativePrompt,result.promptSnapshot.negativePrompt);
  assert.equal(result.originalPrompt,'图5用图2画风');assert.doesNotThrow(result.assertCurrent);
  state.prompt+='，换成红衣';assert.throws(result.assertCurrent,/已变化/);
});

test('unchanged AI writeback retains its grounded style policy and actual slots when generated without AI',async()=>{
  const p=plan([{source:2,uses:[use('style')],omit:[]},{source:5,uses:[use('subject')],omit:[]}]);
  p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'将<image2>按<image1>的实际画风完整重绘。',sourceOrder:[2,5],renderingClass:'anime'};
  const e=env(p),state={provider:'local',mode:'img2img',prompt:'图5用图2画风',width:1280,height:960},refs=[null,ref('style'),null,null,ref('photo')];
  const first=await e.api.prepare(ctx(state,refs));first.applyPromptToState();
  state.drawingAnalysisEngine='direct';
  const repeated=await e.api.prepare(ctx(state,refs));
  assert.equal(repeated.direct,true);assert.equal(e.calls.length,1);
  assert.equal(e.api.generationOptions(repeated).styleReferencePriority,true);
  assert.deepEqual(Array.from(repeated.references,r=>[r.sourceNumber,r.role]),[[5,'subject'],[2,'style']]);
  assert.equal(repeated.references[0].dataUrl,refs[4].dataUrl);assert.equal(repeated.references[1].dataUrl,refs[1].dataUrl);
  assert.equal(repeated.promptSnapshot.prompt,first.promptSnapshot.prompt);
  assert.equal(repeated.renderingPolicy,undefined,'replay does not change sampling policy');
  const again=await e.api.prepare(ctx(state,refs));assert.equal(e.api.generationOptions(again).styleReferencePriority,true);
  const fresh=await e.api.prepare(ctx({...state},refs));
  assert.equal(e.api.generationOptions(fresh).styleReferencePriority,true,'a fresh explicit style pair derives the same contract without saved AI state');
  assert.deepEqual(Array.from(fresh.references,r=>r.sourceNumber),[5,2]);
});

test('current explicit style roles determine the contract after edits without replaying stale AI state',async()=>{
  for(const [change,stylePriority] of [
    [(state)=>{state.prompt+='，换成红衣';},true],
    [(state)=>{state.negativePrompt+='，不要耳环';},true],
    [(state,refs)=>{refs[1]=ref('replacement-style');},true],
    [(state)=>{state.prompt='图1用图2姿势';},false],
    [(state)=>{state.width=960;},true],
    [(state)=>{state.provider='google';},false],
    [(state)=>{state.nsfw=true;},false],
    [(state)=>{state.drawingTask='preserve';},false],
  ]){
    const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
    p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'将<image1>按<image2>的实际画风重绘。',sourceOrder:[1,2],renderingClass:'anime'};
    const e=env(p),state={provider:'local',mode:'img2img',prompt:'图1用图2画风',width:1280,height:960},refs=[ref('photo'),ref('style')];
    const first=await e.api.prepare(ctx(state,refs));first.applyPromptToState();state.drawingAnalysisEngine='direct';
    const oldPrompt=state.prompt,oldNegative=state.negativePrompt,oldRefs=[...refs],oldState={...state};
    change(state,refs);
    const changed=await e.api.prepare(ctx(state,refs));
    assert.equal(e.api.generationOptions(changed).styleReferencePriority,stylePriority,change.toString());
    assert.equal(e.calls.length,1,'invalidation never invokes an analyzer');
    for(const k of Object.keys(state))if(!Object.hasOwn(oldState,k))delete state[k];
    Object.assign(state,oldState,{prompt:oldPrompt,negativePrompt:oldNegative});refs.splice(0,refs.length,...oldRefs);
    const restored=await e.api.prepare(ctx(state,refs));
    assert.equal(e.api.generationOptions(restored).styleReferencePriority,true,'restored explicit roles derive the contract independently of the invalidated policy');
  }
});

test('formal Qwen builders retain reference budgets and sampling geometry after AI writeback switches to direct',async()=>{
  const info={NovaFlowGGUFBF16Loader:{input:{required:{unet_name:[['qwen-image-2.1-UC-BF16.gguf','Qwen-Image-2.1-Turbo-BF16.gguf']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_bf16_heretic.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},TextEncodeQwenImage21:{},QwenImage21Cache:{},KSampler:{},VAEDecode:{},SaveImage:{},ImageScale:{}};
  const host=await createWorkflowHost({rendererDir:new URL('../../worker-renderer/',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),objectInfo:info});
  for(const [localQwen21Variant,manualCfg] of [['standard',undefined],['standard',3],['turbo',undefined],['turbo',3]])for(const preserve of ['','保持原有光感','保持原配色','保持原取景']){
    const p=plan([{source:2,uses:[use('style')],omit:[]},{source:5,uses:[use('subject')],omit:[]}]);
    p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'将<image2>按<image1>的实际动漫画风整体重绘。'+preserve,sourceOrder:[2,5],renderingClass:'anime'};
    const e=env(p),state={provider:'local',mode:'img2img',prompt:'图5用图2画风'+(preserve?'，'+preserve:''),negativePrompt:'不要文字',drawingAnalysisEngine:'local',localQwen21Variant,localDrawEngine:'qwen-2.1',width:1280,height:960,seed:324423870,randomSeed:false,nsfw:false,samplingOverrides:manualCfg?{[`${localQwen21Variant==='turbo'?'qwen-2.1-turbo':'qwen-2.1'}:img2img`]:{steps:25,cfg:manualCfg}}:{}},refs=[null,ref('cg'),null,null,ref('photo')];
    const first=await e.api.prepare(ctx(state,refs));first.applyPromptToState();state.drawingAnalysisEngine='direct';
    const repeated=await e.api.prepare(ctx(state,refs)),graphs=[];
    assert.equal(first.state.uiPreserveLayout,false);assert.equal(repeated.state.uiPreserveLayout,false);
    assert.equal(e.api.generationOptions(first).styleReferencePriority,true);
    assert.equal(e.api.generationOptions(repeated).styleReferencePriority,true);
    assert.deepEqual(Array.from(repeated.references,r=>[r.sourceNumber,r.role]),[[5,'subject'],[2,'style']]);
    if(preserve){assert.match(first.promptSnapshot.prompt,new RegExp(preserve));assert.match(repeated.promptSnapshot.prompt,new RegExp(preserve));}
    for(const prepared of [first,repeated])graphs.push(JSON.parse(JSON.stringify(await host.buildGraph({module:'novaflow-brand-runtime',method:'buildArtGenerateRunWorkflow',options:{__args:['local','img2img',['photo.jpg','cg.jpg'],'NF_replay',prepared.promptSnapshot.prompt,prepared.promptSnapshot.negativePrompt,'test',[{width:1280,height:960},{width:768,height:1344}],prepared.state,10,e.api.generationOptions(prepared)]}}))));
    const comparable=structuredClone(graphs);
    if(localQwen21Variant==='turbo'){
      assert.equal(graphs[0]['7'].inputs.cfg,manualCfg||3);assert.equal(graphs[1]['7'].inputs.cfg,manualCfg||3);
    }else{
      assert.equal(graphs[0]['7'].inputs.cfg,3);assert.equal(graphs[1]['7'].inputs.cfg,3);
      assert.equal(graphs[0]['7'].inputs.steps,25);assert.equal(graphs[1]['7'].inputs.steps,25);
    }
    assert.deepEqual(comparable[1],comparable[0],localQwen21Variant+' '+preserve+' must retain effective guidance and reference geometry');
    // Already true on feature/novaflow-web: a style transfer whose content photo
    // matches the requested aspect (alignStyleContent) samples that photo in place.
    // It does not insert the 0.5 MP ImageScale (node 200, 800x608) or a fresh
    // EmptyLatent (node 6). Those nodes are for a different aspect. The style
    // image still has to fit the 1 MP budget, and the photographic framing lock
    // stays off. This PR does not change that local path.
    assert.equal(graphs[1]['200'],undefined,'matching aspect keeps the content photo at the sampling size');
    assert.equal(graphs[1]['201'],undefined,'the complete CG reference fits its 1 MP budget even when original light/color/framing is requested');
    assert.deepEqual(graphs[1]['5'].inputs['images.image_1'],['100',0]);
    assert.deepEqual(graphs[1]['5'].inputs['images.image_2'],['101',0]);
    assert.deepEqual(graphs[1]['7'].inputs.latent_image,['5',2]);
    assert.equal(graphs[1]['6'],undefined);
    assert.doesNotMatch(graphs[1]['5'].inputs.prompt,/未要求改变构图、姿势或取景时，保持图1中主体的位置、大小和画面取景不变/);
    assert.equal(e.calls.length,1);
  }
});

test('AI writeback retains the effective ordinary Qwen guidance while manual values and Turbo keep precedence',async()=>{
  for(const [variant,manualCfg] of [['standard',undefined],['standard',4],['turbo',undefined]]){
    const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
    p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'将<image1>按<image2>的实际动漫画风重绘。',sourceOrder:[1,2],renderingClass:'anime'};
    const e=env(p),state={provider:'local',mode:'img2img',prompt:'图1用图2画风',drawingAnalysisEngine:'local',localQwen21Variant:variant,samplingOverrides:{'rapid:img2img':{steps:6,cfg:1},...(manualCfg?{'qwen-2.1:img2img':{steps:25,cfg:manualCfg}}:{})}};
    const first=await e.api.prepare(ctx(state,[ref('photo'),ref('style')]));
    assert.equal(state.samplingOverrides['qwen-2.1:img2img']?.cfg,manualCfg,'preparation alone leaves editable settings untouched');
    first.applyPromptToState();
    assert.deepEqual(state.samplingOverrides['rapid:img2img'],{steps:6,cfg:1});
    if(variant==='standard'){
      assert.equal(state.samplingOverrides['qwen-2.1:img2img'].cfg,manualCfg||3);
      assert.equal(state.samplingOverrides['qwen-2.1:img2img'].cfg,first.state.samplingOverrides['qwen-2.1:img2img'].cfg);
      if(manualCfg)assert.equal(state.samplingOverrides['qwen-2.1:img2img'].steps,25);
    }else assert.equal(state.samplingOverrides['qwen-2.1:img2img'],undefined,'Turbo does not acquire ordinary guidance overrides');
  }
});

test('a newly edited manual CFG wins at writeback and also updates the prepared generation settings',async()=>{
  for(const nextCfg of [5,undefined]){
    const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
    p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'将<image1>按<image2>的实际动漫画风重绘。',sourceOrder:[1,2],renderingClass:'anime'};
    const e=env(p);
    const state={provider:'local',mode:'img2img',prompt:'图1用图2画风',drawingAnalysisEngine:'local',samplingOverrides:{'qwen-2.1:img2img':{steps:25,cfg:4}}};
    const first=await e.api.prepare(ctx(state,[ref('photo'),ref('style')]));assert.equal(first.state.samplingOverrides['qwen-2.1:img2img'].cfg,4);
    state.samplingOverrides['qwen-2.1:img2img'].cfg=nextCfg;
    first.applyPromptToState();
    const expected=nextCfg===undefined?4:nextCfg;
    assert.equal(state.samplingOverrides['qwen-2.1:img2img'].cfg,expected);
    assert.equal(first.state.samplingOverrides['qwen-2.1:img2img'].cfg,expected,'the value shown and the value sampled must agree');
    assert.equal(state.samplingOverrides['qwen-2.1:img2img'].steps,25);
  }
});

test('direct editing bypasses every analyzer and reviewer and preserves original pixels and user constraints',async()=>{
  const e=env(()=>assert.fail('direct generation must not call an analyzer'));
  const original={...ref('original-jpeg'),dataUrl:'data:image/jpeg;base64,eA=='};
  const state={prompt:'换成白色衬衫，背景和姿势不变',negativePrompt:'不要文字',provider:'local',drawingAnalysisEngine:'direct',seed:7};
  const prepared=await e.api.prepare(ctx(state,[original]));
  assert.equal(e.calls.length,0);assert.equal(e.draws.length,0);
  assert.equal(prepared.promptSnapshot.prompt,state.prompt);assert.equal(prepared.promptSnapshot.negativePrompt,'不要文字');
  assert.equal(prepared.references[0].dataUrl,original.dataUrl);assert.equal(prepared.references[0].mimeType,'image/jpeg');
  assert.equal(prepared.state.seed,7);assert.equal(prepared.direct,true);assert.equal(prepared.renderingPolicy,undefined);
  const review=await e.api.review(prepared,ref('output').dataUrl);
  assert.equal(review.skipped,true);assert.equal(e.calls.length,0);
  assert.equal(e.api.analysisControl(()=>assert.fail('direct mode has no analysis panel'),state),null);
});

test('direct multi-reference edits only translate source labels to actual input slots without crops or omissions',async()=>{
  const e=env(()=>assert.fail('unexpected analysis'));
  const refs=[null,ref('pose'),null,null,ref('subject')],state={prompt:'@参考图5人物换成@参考图2姿势，保留衣服',drawingAnalysisEngine:'direct'};
  const p=await e.api.prepare(ctx(state,refs));
  assert.equal(p.promptSnapshot.prompt,'<image2>人物换成<image1>姿势，保留衣服');
  assert.deepEqual(Array.from(p.references,r=>r.sourceNumber),[2,5]);
  assert.equal(p.references[0].dataUrl,refs[1].dataUrl);assert.equal(p.references[1].dataUrl,refs[4].dataUrl);
  assert.equal(e.draws.length,0);assert.equal(e.calls.length,0);
  await assert.rejects(e.api.prepare(ctx({...state,prompt:'图3人物'},refs)),/图3尚未添加/);
});

test('direct text generation, remembered selection and explicit analysis mode remain independent',async()=>{
  const e=env(plan());
  const p=await e.api.prepare(ctx({drawingAnalysisEngine:'direct',prompt:'冰系女剑客',provider:'local'},[]));
  assert.equal(p.state.mode,'txt2img');assert.equal(p.promptSnapshot.prompt,'冰系女剑客');assert.equal(e.calls.length,0);
  await assert.rejects(e.api.prepare(ctx({drawingAnalysisEngine:'direct',prompt:''},[ref('photo')])),/写一句要求/);
  e.sandbox.localStorage.setItem('novaflow.drawing.analysis.v2','direct');
  assert.equal(e.api.input({state:{prompt:'换衣服'},references:[]}).engine,'direct');
  assert.equal(e.api.input(ctx({prompt:'换衣服',drawingAnalysisEngine:'local'},[])).engine,'local');
});
test('selected task and reference can generate with an empty prompt',async()=>{
  const e=env(plan([{source:1,uses:[use('subject')],omit:[]}])),state={prompt:'',drawingTask:'anime',provider:'local'};
  const original=ref('subject');const result=await e.api.prepare(ctx(state,[original]));
  assert.equal(e.calls[0].artContext.task,'anime');assert.equal(result.references[0].dataUrl,original.dataUrl);
  assert.equal(state.prompt,'');assert.equal(result.state.mode,'img2img');
});
test('a short style word keeps the first uploaded photo as content without requiring a restated instruction',()=>{
  const e=env(),request=e.api.input(ctx({prompt:'水彩画'},[ref('photo')]));
  assert.deepEqual(Array.from(request.references[0].roles),['subject']);
  const explicit=e.api.input(ctx({prompt:'用图1的风格画一位剑客'},[ref('style')]));
  assert.deepEqual(Array.from(explicit.references[0].roles),['style']);
});
test('preservation, possessive style wording and negative donor references never request an extra donor subject',()=>{
  const e=env(),refs=[ref('base'),ref('style')];
  for(const prompt of ['图1换成图2风格，人物背景姿势不变','图1人物参考图2人物的画风','图1人物不要改变，不要把图2人物带进来，只参考风格','保留图1人物不要把图2人物带进来只参考风格','图1人物，不要用图2背景，只参考图2风格','把图1转为图2风格，不改变图1的人物姿势和衣服']){
    const r=e.api.input(ctx({prompt},refs));
    assert.deepEqual(Array.from(r.references[0].roles),['subject'],prompt);
    assert.deepEqual(Array.from(r.references[1].roles),['style'],prompt);
  }
  const ignored=e.api.input(ctx({prompt:'图1人物，不要用图2'},refs));assert.deepEqual(Array.from(ignored.references[1].roles),['none']);
});
test('an untouched JPEG subject retains its actual encoding and upload MIME',async()=>{
  const e=env(plan([{source:1,uses:[use('subject')],omit:[]}])),photo={...ref('jpeg'),dataUrl:'data:image/jpeg;base64,eA=='};
  const r=await e.api.prepare(ctx({prompt:'水彩画'},[photo]));assert.equal(r.references[0].mimeType,'image/jpeg');
  assert.match(r.references[0].name,/\.jpg$/);assert.equal(r.references[0].dataUrl,photo.dataUrl);
});

test('a vision-selected subject crop cannot discard the original framing during style transfer',async()=>{
  const original=ref('complete-photo');
  const e=env(plan([{source:1,uses:[use('subject',{box:[240,320,820,920]})],omit:[]},{source:2,uses:[use('style')],omit:[]}]));
  const r=await e.api.prepare(ctx({prompt:'图1用图2画风'},[original,ref('style')]));
  assert.deepEqual(Array.from(r.plan.references[0].uses[0].box),[0,0,1000,1000]);
  assert.equal(r.references[0].dataUrl,original.dataUrl);assert.equal(r.references[0].treatment,'subject-original');
});
test('generation parameters contain settings, not cached pixels, histories, progress or inherited UI constraints',async()=>{
  const e=env(plan()),state={prompt:'水彩人像',provider:'local',seed:7,randomSeed:false,samplingOverrides:{qwen:{steps:40}},references:[ref('huge-pixels')],results:[ref('old-output')],promptHistory:Array(300).fill('x'.repeat(2000)),progressLabel:'old-status',uiPreserveLayout:true};
  const r=await e.api.prepare(ctx(state,[]));assert.equal(r.state.seed,7);assert.equal(r.state.prompt,'水彩人像');
  assert.ok(JSON.stringify(r.state).length<1000);assert.equal(r.state.uiPreserveLayout,undefined);assert.equal(r.state.results,undefined);assert.equal(r.state.promptHistory,undefined);
});
test('the complete style image retains facial construction and global light with an explicit scoped role',async()=>{
  const e=env(plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[[0,600,250,950]]}]));
  const refs=[ref('subject'),ref('style')],r=await e.api.prepare(ctx({prompt:'图1人物用图2画风'},refs));
  assert.equal(r.references[0].dataUrl,refs[0].dataUrl);assert.equal(r.references[1].dataUrl,refs[1].dataUrl);
  assert.equal(r.references[1].treatment,'complete-style-reference');assert.equal(r.state.uiPreserveLayout,false);
  assert.match(r.promptSnapshot.prompt,/以<image1>为内容参考，用<image2>的完整画风整体重新绘画/);
  assert.match(r.promptSnapshot.prompt,/参考人物和场景物件不作为新增内容/);
});
test('each uploaded source survives past three images and gaps keep their original numbers',async()=>{
  const refs=[ref('a'),null,ref('b'),ref('c'),ref('d')];
  const e=env(plan([1,3,4,5].map(source=>({source,uses:[use('subject')],omit:[]}))));
  const r=await e.api.prepare(ctx({prompt:'四个人分别来自这些图'},refs));
  assert.deepEqual(Array.from(e.calls[0].images,i=>i.label),['图1','图3','图4','图5']);
  assert.deepEqual(Array.from(r.references,r=>r.sourceNumber),[1,3,4,5]);
});
test('a later uploaded subject is first in model inputs; multi-use sources produce separate controls',async()=>{
  const e=env(plan([{source:1,uses:[use('style'),use('material')],omit:[]},{source:2,uses:[use('subject')],omit:[]}]));
  const r=await e.api.prepare(ctx({prompt:'图2主体，图1画风和衣服材质'},[ref('style'),ref('subject')]));
  assert.equal(r.references[0].sourceNumber,2);assert.equal(r.references.length,3);
  assert.match(r.promptSnapshot.prompt,/<image1>（原图2，主体/);assert.match(r.promptSnapshot.prompt,/只向指定目标应用表面材质/);
});

test('thumbnail mentions bind original slots to encoded Qwen tags after gaps and subject reordering',async()=>{
  const p=plan([{source:2,uses:[use('style')],omit:[]},{source:5,uses:[use('subject')],omit:[]}]);
  const e=env(p),state={prompt:'@参考图5用@参考图2画风',provider:'local'};
  const r=await e.api.prepare(ctx(state,[null,ref('style'),null,null,ref('subject')]));
  assert.deepEqual(Array.from(r.references,x=>x.sourceNumber),[5,2]);
  assert.match(r.promptSnapshot.prompt,/用户要求：<image1>用<image2>画风/);
  assert.match(r.promptSnapshot.prompt,/<image1>（原图5，主体/);
  assert.match(r.promptSnapshot.prompt,/<image2>（原图2，风格/);
  assert.equal(r.originalPrompt,'@参考图5用@参考图2画风');
  assert.doesNotMatch(r.promptSnapshot.prompt,/@参考图|<image5>/);
});
test('style analysis no longer requires arbitrary crop regions and missing references still fail',async()=>{
  const e=env(),source={prompt:'',references:[{source:1,role:'auto'}]};
  const scoped=e.api.validate(plan([{source:1,uses:[use('style',{samples:[]})],omit:[]}]),source);
  const original=ref('style');const processed=await e.api.renderReference({source:1,...original},scoped.references[0].uses[0],[],()=>{});
  assert.equal(processed.dataUrl,original.dataUrl);assert.equal(processed.treatment,'complete-style-reference');
  assert.throws(()=>e.api.validate(plan([]),source),/遗漏/);
});
test('role or request changes during analysis invalidate the result instead of applying it',async()=>{
  let complete;const e=env(()=>new Promise(resolve=>{complete=resolve;}));
  const state={prompt:'原要求'},context=ctx(state,[]);context.getCurrentContext=()=>context;
  const pending=e.api.prepare(context);
  while(!complete)await new Promise(r=>setTimeout(r,1));state.prompt='新要求';complete(plan());
  await assert.rejects(pending,/已变化/);assert.equal(state.prompt,'新要求');
});

test('leaving drawing during analysis stops submission but browsing after preparation permits the existing run',async()=>{
  let complete;
  const e=env(()=>new Promise(resolve=>{complete=resolve;})),context=ctx({prompt:'冰系女剑客'},[]);
  context.getCurrentContext=()=>context;
  const pending=e.api.prepare(context);
  while(!complete)await new Promise(r=>setTimeout(r,1));
  context.generationSurface='ui';complete(plan());await assert.rejects(pending,/页面已切换/);
  const ready=env(plan()),next=ctx({prompt:'冰系女剑客'},[]);next.getCurrentContext=()=>next;
  const prepared=await ready.api.prepare(next);next.generationSurface='other';assert.doesNotThrow(()=>prepared.assertCurrent());
});

test('reference style reconstructs the whole picture and only explicit framing requests lock it',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
  const e=env(p),refs=[ref('photo'),ref('style')];
  const r=await e.api.prepare(ctx({prompt:'图1用图2画风'},refs));
  assert.match(r.promptSnapshot.prompt,/不锁死摄影轮廓和写实五官比例/);
  assert.doesNotMatch(r.promptSnapshot.prompt,/保持主体的相对位置|主体配饰必须保留|保持主体身份|原有取景/);
  const locked=await e.api.prepare(ctx({prompt:'图1用图2画风，保持原构图'},refs));
  assert.match(locked.promptSnapshot.prompt,/保持主体的相对位置/);
});
test('cancel during analysis returns promptly and discards a later result',async()=>{
  let complete;const e=env(()=>new Promise(resolve=>{complete=resolve;}));const pending=e.api.prepare(ctx({prompt:'剑客'},[]));
  while(!complete)await new Promise(r=>setTimeout(r,1));assert.equal(e.api.cancelPreparation(),true);
  await assert.rejects(pending,/中止/);complete(plan());assert.equal(e.api.cancelPreparation(),false);
});
test('repeated unchanged generation reuses analysis; a role change invalidates the cache',async()=>{
  const e=env(plan([{source:1,uses:[use('subject')],omit:[]}]));const state={prompt:'精修'},refs=[ref('a')];
  await e.api.prepare(ctx(state,refs));await e.api.prepare(ctx(state,refs));assert.equal(e.calls.length,1);
  refs[0].drawingRole='style';await assert.rejects(e.api.prepare(ctx(state,refs)),/遗漏了指定用途/);assert.equal(e.calls.length,2);
});
test('local transport preserves schema, numbers, all images, task and negative requirements',()=>{
  const payload={surface:'art',purpose:'art-director',visualSchema:'nf.art.direction.v1',currentPrompt:'图3为主体',negativePrompt:'不要文字',artContext:{task:'game_cg',references:[{source:1,role:'style'},{source:3,role:'subject'}]},images:[ref('a'),ref('b')]};
  const r=normalizeReverseRequest(payload).request;
  assert.equal(r.visualSchema,payload.visualSchema);assert.deepEqual(r.artContext.references,payload.artContext.references);assert.equal(r.images.length,2);assert.equal(r.negativePrompt,'不要文字');
  assert.throws(()=>normalizeReverseRequest({...payload,artContext:{references:[{source:1},{source:1}]}}),/编号/);
  const excluded=normalizeReverseRequest({...payload,artContext:{...payload.artContext,references:[{source:1,role:'auto',roles:['style'],excludedRoles:['subject','background']},{source:3,role:'subject'}]}}).request;
  assert.deepEqual(excluded.artContext.references[0].excludedRoles,['subject','background']);
  const independent=normalizeReverseRequest({...payload,artContext:{...payload.artContext,editEnhancer:'qwen21-pe-i2i',styleObservation:'reference-only-v1'}}).request;
  assert.equal(independent.artContext.styleObservation,'reference-only-v1');
  assert.equal(normalizeReverseRequest({...payload,artContext:{...payload.artContext,peStyleClass:'anime'}}).request.artContext.peStyleClass,'anime');
  assert.equal(normalizeReverseRequest({...payload,artContext:{...payload.artContext,peStyleClass:'arbitrary'}}).request.artContext.peStyleClass,undefined);
  assert.equal(normalizeReverseRequest({...payload,artContext:{...payload.artContext,styleObservation:'routing-first-v1'}}).request.artContext.styleObservation,'routing-first-v1');
  assert.equal(normalizeReverseRequest({...payload,artContext:{...payload.artContext,styleObservation:'arbitrary'}}).request.artContext.styleObservation,undefined);
});
test('Grok uses the same structured contract for pictures and text-only requests',()=>{
  for(const count of [0,4]){
    const payload={visualSchema:'nf.art.direction.v1',currentPrompt:'按图组合',artContext:{task:'auto',references:Array.from({length:count},(_,i)=>({source:i+1,role:'auto'}))},images:Array.from({length:count},(_,i)=>ref(String(i)))};
    const request=cloud.build(payload,'grok-test');assert.equal(request.resultOptions.artDirection,true);
    assert.equal(request.body.input[1].content.filter(x=>x.type==='input_image').length,count);
    assert.equal(request.body.text.format.schema.properties.art_direction.properties.schema.enum[0],'nf.art.direction.v1');
  }
});
test('review sees result plus original donors and produces an actionable bounded correction',async()=>{
  const e=env(p=>p.purpose==='art-director-review'?{schema:'nf.art.review.v1',pass:false,issues:['混入风格图的长弓'],repair:'去掉长弓，保留原有法杖'}:plan([{source:1,uses:[use('subject')],omit:[]}]));
  const r=await e.api.prepare(ctx({prompt:'保留人物和法杖'},[ref('subject')]));
  const reviewed=await e.api.review(r,ref('generated').dataUrl);
  assert.equal(reviewed.pass,false);assert.match(reviewed.repair,/长弓/);
  assert.equal(e.calls[1].images.length,2);assert.deepEqual(Array.from(e.calls[1].artContext.references,r=>r.source),[0,1]);
  const request=normalizeReverseRequest(e.calls[1]).request;assert.equal(request.visualSchema,'nf.art.review.v1');assert.equal(request.artContext.plan.references[0].uses[0].role,'subject');
  assert.equal(request.artContext.plan.references[0].uses[0].detail,undefined,'model captions cannot redefine the review contract');
  const cloudRequest=cloud.buildReview(e.calls[1],'grok-test');assert.equal(cloudRequest.resultOptions.artReview,true);
  assert.throws(()=>cloud.validateReview({schema:'nf.art.review.v1',pass:false,issues:[],repair:''}),/有效结论/);
});
test('explicit role relations exclude unrequested dimensions and unused uploads',async()=>{
  const reply=plan([{source:1,uses:[use('subject'),use('background'),use('material')],omit:[]},{source:2,uses:[use('style'),use('pose'),use('object')],omit:[]},{source:3,uses:[use('subject')],omit:[]}]);
  reply.prompt='擅自换背景，加一把弓';
  const e=env(reply);const r=await e.api.prepare(ctx({prompt:'图1换成图2的画风'},[ref('base'),ref('style'),ref('unused')]));
  assert.deepEqual(Array.from(r.references,r=>r.role),['subject','style']);assert.equal(r.references.length,2);
  assert.equal(r.promptSnapshot.prompt.includes('擅自换背景'),false);assert.equal(r.promptSnapshot.prompt.includes('加一把弓'),false);
  assert.match(r.promptSnapshot.prompt,/用户要求：<image1>换成<image2>的画风/);
});
test('a style caption cannot import depicted energy effects into the executable brief or review contract',async()=>{
  const reply=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{detail:'粗犷水墨笔触，绿色能量漩涡，天空传送门，弓箭'})],omit:[]}]);
  const e=env(p=>p.purpose==='art-director-review'?{schema:'nf.art.review.v1',pass:true,issues:[],repair:''}:reply);
  const r=await e.api.prepare(ctx({prompt:'图1换成图2的画风'},[ref('base'),ref('style')]));
  assert.doesNotMatch(r.promptSnapshot.prompt,/绿色能量漩涡|天空传送门|弓箭/);
  assert.equal(r.references[1].treatment,'complete-style-reference','actual original pixels carry the style, never a guessed genre keyword');
  await e.api.review(r,ref('generated').dataUrl);
  assert.doesNotMatch(JSON.stringify(e.calls[1].artContext.plan),/绿色能量漩涡|天空传送门|弓箭/);
});

test('reference style includes facial construction and lighting without copying the donor person',async()=>{
  const reply=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{detail:'二次元，夸张大眼，简化鼻口，面部体块，暖光，柔光，逆光，戴银色耳环的女性站在树林中'})],omit:[]}]);
  const e=env(reply),r=await e.api.prepare(ctx({prompt:'图1用图2画风'},[ref('male-photo'),ref('anime-style')]));
  assert.match(r.promptSnapshot.prompt,/五官比例、面部体积/);
  assert.match(r.promptSnapshot.prompt,/皮肤与发丝质感/);
  assert.match(r.promptSnapshot.prompt,/全画面光感均由目标画风重新构建/);
  assert.match(r.promptSnapshot.prompt,/不锁死摄影轮廓和写实五官比例/);
  assert.doesNotMatch(r.promptSnapshot.prompt,/银色耳环|女性站在树林/);
});

test('scoped observed drawing attributes reach the generator without donor content captions',async()=>{
  const profile={medium:'明亮二维动漫',facialStyle:'大眼睛，简化鼻口',markMaking:'有粗细变化的线稿；金发女仆手持雨伞',shading:'硬边赛璐璐阴影',surface:'平滑无摄影纹理',lightingStyle:'蓝色环境补光'};
  const reply=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{detail:'金发女仆站在森林',renderingProfile:profile})],omit:[]}]);
  const e=env(reply),r=await e.api.prepare(ctx({prompt:'图1用图2画风'},[ref('photo'),ref('style')]));
  assert.match(r.promptSnapshot.prompt,/<image2>的实际视觉属性/);
  for(const expected of ['明亮二维动漫','大眼睛，简化鼻口','硬边赛璐璐阴影','蓝色环境补光'])assert.ok(r.promptSnapshot.prompt.includes(expected));
  assert.doesNotMatch(r.promptSnapshot.prompt,/金发|女仆|雨伞|森林/);
  assert.match(r.promptSnapshot.prompt,/主体辨识特征、主要动作、服饰类别、持有物和场景类型取自主体参考/);
  assert.match(r.promptSnapshot.prompt,/成图质量与协调氛围优先，无需逐处复现照片/);
  assert.equal(r.references.length,2);assert.equal(r.references[0].dataUrl,ref('photo').dataUrl);
});

test('measured dark reference values override a mistaken high-key caption but respect separate lighting',async()=>{
  const reply=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{renderingProfile:{medium:'二维动漫',lightingStyle:'高调冷色侧光'}})],omit:[]}]);
  const e=env(reply),make=e.sandbox.document.createElement;
  e.sandbox.document.createElement=tag=>{const c=make(tag),get=c.getContext;c.getContext=()=>({...get(),getImageData:()=>({data:[8,12,20,255]})});return c;};
  const r=await e.api.prepare(ctx({prompt:'图1用图2画风'},[ref('photo'),ref('dark-style')]));
  assert.equal(r.references[1].valueProfile.key,'low');
  assert.match(r.promptSnapshot.prompt,/整体低调/);assert.doesNotMatch(r.promptSnapshot.prompt,/高调/);
  assert.equal(r.references[1].dataUrl,ref('dark-style').dataUrl);
  const locked=await e.api.prepare(ctx({prompt:'图1用图2画风，保持原光感'},[ref('photo'),ref('dark-style')]));
  assert.doesNotMatch(locked.promptSnapshot.prompt,/整体低调|高调冷色侧光/);
});
test('observed source expression survives a repaint without locking facial proportions or overriding user edits',async()=>{
  const p=plan([{source:1,uses:[use('subject',{sourceExpression:{faces:1,eyes:'one-closed',mouth:'closed-smile',extra:'wear a crown'}})],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
  const e=env(p),refs=[ref('photo'),ref('style')];
  const r=await e.api.prepare(ctx({prompt:'图1用图2画风'},refs));
  assert.match(r.promptSnapshot.prompt,/一只眼闭合眨眼、另一只眼睁开、闭口微笑/);
  assert.match(r.promptSnapshot.prompt,/五官比例仍按目标画风重绘/);
  assert.doesNotMatch(r.promptSnapshot.prompt,/crown/);
  const changed=await e.api.prepare(ctx({prompt:'图1用图2画风，表情改为大笑'},refs));
  assert.doesNotMatch(changed.promptSnapshot.prompt,/一只眼闭合眨眼|闭口微笑/);
});
test('actual anime drawing attributes activate real negative guidance without changing user boxes or manual settings',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{renderingProfile:{medium:'二维动漫插画',markMaking:'头发分组成块状',surface:'无明显笔触或纸纹'}})],omit:[]}]);
  const e=env(p),refs=[ref('photo'),ref('anime')],state={provider:'local',prompt:'图1用图2画风',negativePrompt:'不要水印',samplingOverrides:{}};
  const r=await e.api.prepare(ctx(state,refs));
  assert.match(r.promptSnapshot.prompt,/^将<image1>整幅重绘成<image2>的二维动漫插画/);
  assert.match(r.promptSnapshot.negativePrompt,/不要水印.*photorealistic facial proportions/);
  assert.match(r.promptSnapshot.negativePrompt,/dense individually rendered hair strands.*paper grain/);
  assert.equal(r.state.samplingOverrides['qwen-2.1:img2img'].cfg,3);
  assert.equal(state.negativePrompt,'不要水印');assert.deepEqual(state.samplingOverrides,{});
  state.samplingOverrides={'qwen-2.1:img2img':{cfg:1,steps:25}};
  const manual=await e.api.prepare(ctx(state,refs));assert.equal(manual.state.samplingOverrides['qwen-2.1:img2img'].cfg,1);assert.equal(manual.state.samplingOverrides['qwen-2.1:img2img'].steps,25);
  const locked=await e.api.prepare(ctx({...state,prompt:'图1用图2画风，保留写实五官'},refs));assert.equal(locked.renderingPolicy,undefined);
  const cloud=await e.api.prepare(ctx({...state,provider:'gpt'},refs));assert.equal(cloud.renderingPolicy,undefined);
});
test('source content anchors preserve only unedited content and style observations cannot request donor scenery',async()=>{
  const p=plan([{source:1,uses:[use('subject',{sourceContent:{scene:'机场候机厅',clothing:'条纹露肩上衣',objects:'透明饮料杯',action:'持杯自拍'}})],omit:[]},{source:2,uses:[use('style',{renderingProfile:{medium:'水墨设色人物画',markMaking:'轮廓线自然，建筑与树木以块面概括',shading:'淡墨渲染，屋檐与花丛有明暗过渡'}})],omit:[]},{source:3,uses:[use('background',{detail:'沙漠沙丘'})],omit:[]}]);
  const e=env(p),refs=[ref('photo'),ref('ink'),ref('desert')];
  const r=await e.api.prepare(ctx({prompt:'图1用图2画风，背景用图3'},refs));
  assert.match(r.promptSnapshot.prompt,/条纹露肩上衣/);assert.match(r.promptSnapshot.prompt,/透明饮料杯/);
  assert.doesNotMatch(r.promptSnapshot.prompt,/机场候机厅|建筑|树木|屋檐|花丛/);
  assert.match(r.promptSnapshot.prompt,/沙漠/);assert.equal(r.renderingPolicy,undefined);
});
test('actual skin color and palette guide the repaint while explicit original colors remain authoritative',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{renderingProfile:{medium:'二维动漫',palette:'蓝白主调，肤色米白偏粉，暗部蓝灰'}})],omit:[]}]);
  const e=env(p),refs=[ref('photo'),ref('style')],r=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风'},refs));
  assert.match(r.promptSnapshot.prompt,/整体配色与肤色色层：蓝白主调，肤色米白偏粉，暗部蓝灰/);
  assert.match(r.promptSnapshot.negativePrompt,/yellow-orange skin color cast/);
  const locked=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风，保留原配色'},refs));
  assert.doesNotMatch(locked.promptSnapshot.prompt,/蓝白主调/);
  assert.doesNotMatch(locked.promptSnapshot.negativePrompt,/yellow-orange skin color cast/);
  const skinLocked=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风，保留原肤色'},refs));
  assert.doesNotMatch(skinLocked.promptSnapshot.prompt,/肤色米白偏粉/);
  assert.match(skinLocked.promptSnapshot.prompt,/蓝白主调/);
  assert.doesNotMatch(skinLocked.promptSnapshot.negativePrompt,/yellow-orange skin color cast/);
});
test('visually compared donor contents enter only negative guidance and enable scoped style priority',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{renderingProfile:{medium:'二维动漫'},donorExclusions:['女仆裙装','红色蝴蝶结','户外街灯']})],omit:[]}]);
  const e=env(p),refs=[ref('photo'),ref('style')],r=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风'},refs));
  assert.doesNotMatch(r.promptSnapshot.prompt,/女仆裙装|红色蝴蝶结|户外街灯/);
  assert.match(r.promptSnapshot.negativePrompt,/女仆裙装.*红色蝴蝶结.*户外街灯/);
  assert.equal(e.api.generationOptions(r).styleReferencePriority,true);
  const locked=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风，保持原构图'},refs));
  assert.equal(e.api.generationOptions(locked).styleReferencePriority,true);
  const colorsLocked=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风，保留原配色'},refs));
  assert.equal(e.api.generationOptions(colorsLocked).styleReferencePriority,true);
  p.references[1].uses[0].donorExclusions=['人物'];
  assert.throws(()=>e.api.validate(p,e.api.input(ctx({provider:'local',prompt:'图1用图2画风'},refs))),/超出内容职责/);
});
test('review uses the executed palette after pixel correction rather than the rejected vision caption',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{renderingProfile:{medium:'二维动漫',palette:'暖橙肤色'}})],omit:[]}]);
  const e=env(payload=>payload.purpose==='art-director-review'?{schema:'nf.art.review.v1',pass:true,issues:[],repair:''}:p);
  const r=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风'},[ref('photo'),ref('style')]));
  r.references[1].renderingProfile.palette='脸部实测明亮低饱和粉色肤色中间调';
  await e.api.review(r,ref('output').dataUrl);
  const contract=JSON.stringify(e.calls[1].artContext.plan);
  assert.match(contract,/实测明亮低饱和粉色/);assert.doesNotMatch(contract,/暖橙肤色/);
});
test('pose and background replacements cannot inherit a subject caption that reintroduces the original pose and setting',async()=>{
  const reply=plan([{source:1,uses:[use('subject',{detail:'原来坐在大理石台阶上'})],omit:[]},{source:2,uses:[use('background',{detail:'雪山田野'})],omit:[]}]);
  const e=env(reply),r=await e.api.prepare(ctx({prompt:'图1人物，换成图2背景'},[ref('base'),ref('background')]));
  assert.doesNotMatch(r.promptSnapshot.prompt,/原来坐在大理石台阶上/);assert.match(r.promptSnapshot.prompt,/原背景不再出现/);
});

test('combined references keep independent roles including a role before the image number',()=>{
  const e=env();
  const request=e.api.input(ctx({prompt:'图1人物，用图2姿势，上衣用图3材质，背景用图4，保持原配色'},[ref('base'),ref('pose'),ref('fabric'),ref('desert')]));
  assert.deepEqual(Array.from(request.references,r=>Array.from(r.roles)),[['subject'],['pose'],['material'],['background']]);
});

test('a sentence after an explicit style reference is an overall edit, not another donor subject role',()=>{
  const e=env(),prompt='图1人物，用图2画风。保留机场自拍、眨眼表情、条纹上衣和手持咖啡，让人物、头发与鼻子的造型跟随参考的日系动漫绘制，冷暗环境光有层次。';
  const request=e.api.input(ctx({prompt},[ref('photo'),ref('style')]));
  assert.deepEqual(Array.from(request.references,r=>Array.from(r.roles)),[['subject'],['style']]);
  assert.equal(request.prompt,prompt,'the full artistic request still reaches the analyzer unchanged');
});

test('same-sentence mixed roles and a later explicitly named reference retain their independent assignments',()=>{
  const e=env();
  for(const prompt of ['图1人物，用图2画风和人物。','图1人物，用图2画风，参考人物长相。','图1人物，用图2画风。图2人物长相也参考。']){
    const request=e.api.input(ctx({prompt},[ref('photo'),ref('style')]));
    assert.deepEqual(Array.from(request.references,r=>Array.from(r.roles)),[['subject'],['style','subject']],prompt);
  }
  const excluded=e.api.input(ctx({prompt:'图1人物，用图2画风。不要图2人物长相。'},[ref('photo'),ref('style')]));
  assert.deepEqual(Array.from(excluded.references,r=>Array.from(r.roles)),[['subject'],['style']]);
  assert.deepEqual(Array.from(excluded.references[1].excludedRoles),['subject']);
});
test('material sampling remains inside the requested surface and never falls back to the whole donor',async()=>{
  const e=env(),region=[200,300,600,650];
  const r=await e.api.renderReference({source:1,...ref('material')},use('material',{box:region}),[],()=>{});
  assert.equal(r.treatment,'isolated-material-samples');
  assert.ok(r.samples.every(b=>b[0]>=200&&b[1]>=300&&b[2]<=600&&b[3]<=650));
});
test('auxiliary captions and invented application targets never become new generation requirements',async()=>{
  const e=env(plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('material',{detail:'银色短裙女性手持长弓，金色帽子',target:'脸部和背景'})],omit:[]}]));
  const r=await e.api.prepare(ctx({prompt:'图1上衣用图2材质，保持黑色'},[ref('base'),ref('material')]));
  assert.doesNotMatch(r.promptSnapshot.prompt,/银色短裙女性|长弓|金色帽子|用于脸部和背景/);
  assert.equal(r.references[1].target,'上衣');assert.match(r.promptSnapshot.prompt,/上衣/);
});

test('positive scoped actions retain only body geometry, surface finish or environment nouns',()=>{
  const e=env();
  assert.equal(e.api.roleRendering('pose','单腿站立，双手合十于胸前，手持长弓，金色帽子，表情平静专注'),'单腿站立，双手合十于胸前');
  assert.equal(e.api.roleRendering('material','银色短裙女性，丝缎材质，长弓'),'丝缎的柔和反光与垂坠褶皱');
  assert.equal(e.api.roleRendering('background','沙漠沙丘，少女手持法杖，金色魔法阵'),'沙丘与沙纹，沙漠环境');
  assert.equal(e.api.roleRendering('subject','男性，佩戴项链，旧姿势坐在台阶上，持杖，没有耳环'),'项链');
  assert.equal(e.api.roleRendering('pose','头部正对前方'),'头部正对镜头');
});
test('palette extraction preserves separate dominant colors instead of averaging the whole image to one color',async()=>{
  const e=env(),create=e.sandbox.document.createElement;
  e.sandbox.document.createElement=tag=>{const c=create(tag),context=c.getContext();context.getImageData=()=>({data:[240,20,20,255,240,20,20,255,20,230,20,255,20,20,240,255]});c.getContext=()=>context;return c;};
  const r=await e.api.renderReference({source:1,...ref('palette')},use('color'),[],()=>{});
  assert.equal(r.treatment,'palette-only');assert.equal(r.colors.length,3);
  assert.deepEqual(Array.from(r.colors,color=>Array.from(color)),[[240,20,20],[20,230,20],[20,20,240]]);
});
test('text-to-image ignores cached hidden reference uploads and a mode switch invalidates preparation',async()=>{
  const e=env(plan()),state={prompt:'画一只猫',mode:'txt2img'},refs=[ref('old')];
  const result=await e.api.prepare(ctx(state,refs));assert.equal(e.calls[0].images.length,0);assert.equal(result.references.length,0);
  state.mode='img2img';assert.throws(()=>result.assertCurrent(),/已变化/);
});

function drawingRun(answers, reviewAnswers=[{schema:'nf.art.review.v1',pass:true,issues:[],repair:''}]) {
  const e=env(payload=>payload.purpose==='art-director-review'?reviewAnswers.shift():answers);
  const state={provider:'local',mode:'img2img',prompt:'',drawingTask:'anime',drawingAnalysisEngine:'local',negativePrompt:'',width:768,height:1024,count:1,randomSeed:false,seed:17,loras:[],samplingOverrides:{},results:[]};
  const refs=[ref('base')],builds=[],uploads=[],statuses=[];const noop=()=>{};
  Object.assign(e.sandbox,{URLSearchParams,ART_GENERATE_STATE:state,NovaFlowUiDesignDrawing:{shouldPrepare:()=>false,isActive:()=>false},NovaFlowWebRuntime:{},
    captureArtGeneratePromptSnapshot:()=>({prompt:state.prompt,negativePrompt:state.negativePrompt}),artGenerateReferences:()=>refs,artGenerateReferenceLimit:()=>10,artGenerateProviderTitle:p=>p,
    resetArtGenerateProgress:noop,setArtGenerateProgress:noop,setArtGenerateStatus:(s,error)=>statuses.push({s,error}),compileArtGeneratePromptMentions:(_refs,text)=>({text,invalidTokens:[]}),addArtGeneratePromptHistory:noop,
    beginArtGenerateRun:()=>1,isArtGenerateRunCurrent:()=>true,detectArtGenerateBaseUrl:async()=> 'http://test',artDataUrlMime:()=> 'image/png',artUploadDataUrl:async(_base,name,dataUrl)=>{uploads.push({name,dataUrl});return name;},
    loadNovaflowArtExportImage:async()=>({naturalWidth:768,naturalHeight:1024}),normalizeArtGenerateCount:n=>n,buildArtGenerateWorkflowWithSeed:(_seed,build)=>build(),
    buildArtGenerateRunWorkflow:(...args)=>{builds.push(args);return {workflow:{},modelKey:'drawing'};},applyArtReferenceControlNet:()=>({applied:0}),validateArtWorkflowNodes:async()=>{},withArtGenerateTimeout:task=>task(),
    artRequestJson:async(_base,path)=>({ok:true,data:path==='/prompt'?{prompt_id:'test'}:{test:{}}}),artHistoryErrorMessage:()=>'',extractArtGenerateFiles:()=>[{filename:'result.png'}],artFetchBlob:async()=>({}),artBlobToDataUrl:async()=>ref('result').dataUrl,artWorkflowKey:()=> 'drawing',
    placeArtGenerateResultIntoSource:async()=>true,renderArtGenerateSurfaces:noop,clearArtGenerateBatch:noop,clearArtGenerateRunIfCurrent:noop,artGenerateBatchProgress:label=>({label,pct:0}),addEventListener:noop,removeEventListener:noop,
    ART_GENERATE_WEB_PROMPT_TIMEOUT_MS:1,ART_GENERATE_WORKFLOW_TIMEOUT_MS:1,ART_GENERATE_PROMPT_TIMEOUT_MS:1,ART_GENERATE_HISTORY_TIMEOUT_MS:1,ART_GENERATE_DOWNLOAD_TIMEOUT_MS:1});
  e.sandbox.document.body={classList:{contains:name=>name==='novaflow-primary-target-art'}};
  const source=readFileSync(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');
  runInContext(source.slice(source.indexOf('  function resolveArtGenerateReferenceInputs('),source.indexOf('  async function runArtGenerate(')),e.sandbox);
  runInContext(source.slice(source.indexOf('  async function runArtGenerate('),source.indexOf('  function createArtGenerateExecutionBridge()')),e.sandbox);
  return {e,state,refs,builds,uploads,statuses,run:options=>e.sandbox.runArtGenerate(options)};
}

test('ordinary generation entry uses the typed prompt without hidden analysis or review',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]}]);const d=drawingRun(p);
  d.state.prompt='将图1绘制为水彩';
  await d.run();assert.equal(d.state.results.length,1);assert.equal(d.builds.length,1);assert.equal(d.state.prompt,'将图1绘制为水彩');
  assert.equal(d.state.results[0].artDirection.originalPrompt,'将图1绘制为水彩');
  assert.equal(d.builds[0][10].taskProfile,'art-direction');assert.deepEqual(Array.from(d.builds[0][10].referenceRoles),['subject']);
  assert.equal(d.state.results[0].artDirection.review.skipped,true);assert.equal(d.state.running,false);
  assert.equal(d.statuses.some(s=>s.error),false);assert.equal(d.e.calls.length,0);
});

test('real generation entry submits direct edits once without analysis, review or automatic correction',async()=>{
  const d=drawingRun(()=>assert.fail('direct run must not analyze'));
  d.state.prompt='换成白色衬衫，保持背景';d.state.drawingAnalysisEngine='direct';
  await d.run();
  assert.equal(d.e.calls.length,0);assert.equal(d.builds.length,1);assert.equal(d.uploads.length,1);
  assert.equal(d.builds[0][4],d.state.prompt);assert.equal(d.uploads[0].dataUrl,d.refs[0].dataUrl);
  assert.equal(d.state.results[0].artDirection.review.skipped,true);
  assert.equal(d.state.results[0].artDirection.corrections,0);
});

test('ordinary short text generates directly even when the previous analysis selection was local',async()=>{
  const d=drawingRun(plan());d.refs.length=0;d.state.mode='txt2img';d.state.prompt='冰系女剑客';
  await d.run();assert.equal(d.builds.length,1);assert.equal(d.state.prompt,'冰系女剑客');
  assert.equal(d.builds[0][4],d.state.prompt);assert.equal(d.e.calls.length,0);
  assert.equal(d.state.results[0].artDirection.originalPrompt,'冰系女剑客');
  assert.equal(d.state.drawingAnalysisEngine,'direct');
  await d.run();assert.equal(d.builds.length,2);assert.equal(d.e.calls.length,0,'the next generation also avoids AI analysis');
});
test('real generation entry limits correction to one and stages inputs for each attempt',async()=>{
  const failed={schema:'nf.art.review.v1',pass:false,issues:['姿势不符'],repair:'双腿改为站立，人物身份保持'};
  const d=drawingRun(plan([{source:1,uses:[use('subject')],omit:[]}]),[failed,failed]);
  const prepared=await d.e.api.prepare(ctx(d.state,d.refs));prepared.applyPromptToState();
  await d.run({drawingPrepared:prepared});assert.equal(d.builds.length,2);assert.equal(d.uploads.length,2);assert.equal(d.state.results.length,1);
  assert.match(d.builds[1][4],/本次纠正：双腿改为站立/);assert.equal(d.state.results[0].artDirection.corrections,1);
  assert.equal(d.state.results[0].artDirection.review.pass,false);assert.match(d.statuses.at(-1).s,/自动检查发现偏差/);
});
function uploadedReference(name = 'upload.png') {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const file = new File([bytes], name, { type: 'image/png' });
  return { name, dataUrl: 'blob:test/' + name, mimeType: 'image/png', file, drawingRole: 'subject', bytes };
}

test('local img2img submit turns an uploaded blob reference into base64 before upload', async () => {
  const d = drawingRun(() => assert.fail('uploaded reference must not be analyzed'));
  const reference = uploadedReference();
  d.refs[0] = reference;
  d.state.prompt = '按这张参考图生成';
  d.state.drawingAnalysisEngine = 'direct';
  await d.run();
  assert.equal(d.uploads.length, 1);
  assert.match(d.uploads[0].dataUrl, /^data:image\/png;base64,/);
  assert.equal(d.uploads[0].dataUrl.includes('blob:'), false);
  assert.deepEqual(Buffer.from(d.uploads[0].dataUrl.slice(d.uploads[0].dataUrl.indexOf(',') + 1), 'base64'), Buffer.from(reference.bytes));
  assert.equal(d.refs[0].dataUrl, 'blob:test/upload.png');
});

test('cloud img2img submit sends base64 for an uploaded reference and rejects a bare blob url', async () => {
  const d = drawingRun(() => assert.fail('uploaded reference must not be analyzed'));
  const reference = uploadedReference('cloud.png');
  d.refs[0] = reference;
  d.state.prompt = '按这张参考图生成';
  d.state.drawingAnalysisEngine = 'direct';
  d.state.provider = 'gpt';
  d.e.sandbox.NovaFlowArtGenerateModels.normalizeProvider = value => value;
  const sent = [];
  d.e.sandbox.electronAPI.runtimeProviderUsageSettlement = 'web-control-plane-v1';
  d.e.sandbox.electronAPI.runningHubGptImage = async (payload) => {
    sent.push(payload);
    return { ok: true, result: { ok: true, charged: 8, remaining: 90, images: [{ imageDataUrl: 'data:image/png;base64,result', taskId: 'rh-upload' }] } };
  };
  await d.run();
  assert.equal(d.builds.length, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0].images[0].dataUrl, /^data:image\/png;base64,/);
  assert.equal(sent[0].images[0].dataUrl.includes('blob:'), false);
  assert.deepEqual(Buffer.from(sent[0].images[0].dataUrl.slice(sent[0].images[0].dataUrl.indexOf(',') + 1), 'base64'), Buffer.from(reference.bytes));
  assert.equal(d.refs[0].dataUrl, 'blob:test/cloud.png');
  const uploaded = [];
  const urls = await prepareImageUrls({
    config: { apiKey: 'fixture', baseUrl: 'https://rh.example' },
    images: sent[0].images,
    fetchImpl: async () => ({ ok: true, json: async () => ({ code: 0, data: { downloadUrl: 'https://cdn.example/ref.png' } }) })
  });
  uploaded.push(...urls);
  assert.deepEqual(uploaded, ['https://cdn.example/ref.png']);
  await assert.rejects(
    prepareImageUrls({
      config: { apiKey: 'fixture', baseUrl: 'https://rh.example' },
      images: [{ dataUrl: 'blob:test/cloud.png', filename: 'cloud.png' }],
      fetchImpl: async () => { throw new Error('blob url must not be fetched'); }
    }),
    /参考图格式不受支持/
  );
});

test('a failed review cannot silently submit a second paid cloud generation',async()=>{
  const failed={schema:'nf.art.review.v1',pass:false,issues:['画风不足'],repair:'改为水彩笔触'};
  const d=drawingRun(plan([{source:1,uses:[use('subject')],omit:[]}]),[failed]);
  d.state.provider='gpt';d.e.sandbox.NovaFlowArtGenerateModels.normalizeProvider=value=>value;const cloud=[];
  d.e.sandbox.electronAPI=d.e.sandbox.electronAPI||{};
  d.e.sandbox.electronAPI.runtimeProviderUsageSettlement='web-control-plane-v1';
  d.e.sandbox.electronAPI.runningHubGptImage=async()=>{cloud.push(1);return {ok:true,result:{ok:true,charged:22,remaining:8,images:[{imageDataUrl:'data:image/png;base64,result',taskId:'rh'}]}};};
  const prepared=await d.e.api.prepare(ctx(d.state,d.refs));prepared.applyPromptToState();
  await d.run({drawingPrepared:prepared});assert.equal(d.builds.length,0);assert.deepEqual(cloud,[1]);assert.equal(d.state.results.length,1);
  assert.equal(d.state.results[0].artDirection.corrections,0);assert.equal(d.state.results[0].artDirection.review.pass,false);
});

test('ordinary drawing leaves all AI interaction in Xiaotao without the three legacy buttons',()=>{
  const e=env(),state={};let refreshed=0;
  const create=(tag,props={})=>({tag,...props,children:[],appendChild(node){this.children.push(node);return node;}});
  const row=e.api.controls(create,state,()=>refreshed++);
  assert.deepEqual(row.children,[]);assert.equal(refreshed,0);assert.equal(row.className,'nf-art-direction-controls');
});

test('drawing references show their source numbers without asking for manual roles',()=>{
  const e=env(),node=e.api.referenceControl((tag,props)=>({tag,...props}),{},3,()=>assert.fail('no manual selector'));
  assert.equal(node.tag,'span');assert.equal(node.text,'图3');assert.equal(e.api.analysisControl(()=>assert.fail('no analysis until prepared'),{}),null);
});

test('a legacy Grok prose response reports an unsupported contract instead of pretending analysis succeeded',async()=>{
  const e=env();e.sandbox.electronAPI.smartAiImageReverse=async()=>({ok:true,data:{prompt:'一位长发女子'}});
  await assert.rejects(e.api.prepare(ctx({prompt:'图1用图2画风',drawingAnalysisEngine:'grok'},[ref('photo'),ref('style')])),/Grok 服务未返回绘图参考分析协议/);
});

test('a style review cannot turn donor ears, ornaments or clothing into an executable correction',async()=>{
  const e=env(p=>p.purpose==='art-director-review'?{schema:'nf.art.review.v1',pass:false,issues:['应添加精灵耳和叶饰'],repair:'改成精灵耳，穿上叶片服饰，移到森林'}:plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]));
  const r=await e.api.prepare(ctx({prompt:'图1用图2画风'},[ref('photo'),ref('elf')]));
  const verdict=await e.api.review(r,ref('output').dataUrl);
  assert.equal(verdict.repairOrigin,'reference-contract');assert.doesNotMatch(verdict.repair,/精灵耳|叶饰|叶片|森林/);
  assert.match(verdict.repair,/重构五官比例、轮廓概括/);
  assert.equal(e.calls[1].artContext.references[1].role,'subject');assert.equal(e.calls[1].artContext.references[2].role,'style');
});

test('content review receives only retained source categories after user and reference replacements',async()=>{
  const facts={scene:'机场',clothing:'条纹上衣',objects:'饮料杯',action:'持杯'};
  const e=env(p=>p.purpose==='art-director-review'?{schema:'nf.art.review.v1',pass:true,issues:[],repair:''}:plan([{source:1,uses:[use('subject',{sourceContent:facts})],omit:[]},{source:2,uses:[use('style')],omit:[]},{source:3,uses:[use('background')],omit:[]}]));
  const r=await e.api.prepare(ctx({prompt:'图1用图2画风，图3背景，换成连衣裙'},[ref('photo'),ref('style'),ref('scene')]));
  await e.api.review(r,ref('output').dataUrl);
  const retained=e.calls[1].artContext.plan.references.find(r=>r.source===1).uses[0].retainedContent;
  assert.equal(retained.scene,undefined);assert.equal(retained.clothing,undefined);
  assert.equal(retained.objects,'饮料杯');assert.equal(retained.action,'持杯');
});

test('drawing sends one complete letterboxed pair to PE and remaps reordered slots',async()=>{
  const p=plan([{source:2,uses:[use('style')],omit:[]},{source:5,uses:[use('subject')],omit:[]}]);
  p.editEnhancer={kind:'qwen21-pe-i2i',model:'qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors',version:'drawing-style-v1',prompt:'将<image2>按<image1>画风完整重绘，造型与配色按目标参考重构。',renderingClass:'anime',sourceOrder:[2,5],promptIds:['proof']};
  const e=env(p),state={prompt:'@参考图5用@参考图2画风',provider:'local'};
  const r=await e.api.prepare(ctx(state,[null,ref('style'),null,null,ref('photo')]));
  assert.equal(e.calls[0].artContext.editEnhancer,'qwen21-pe-i2i',JSON.stringify(e.calls[0].artContext.references));
  assert.equal(e.calls[0].artContext.styleObservation,undefined);
  for(const im of e.calls[0].images){const [w,h,ops]=JSON.parse(Buffer.from(im.dataUrl.split(',')[1],'base64'));assert.equal(w,h);assert.equal(w,1024);assert.deepEqual(ops[0],[112,12,800,1000]);}
  assert.match(r.promptSnapshot.prompt,/将<image1>按<image2>画风完整重绘/);
  assert.doesNotMatch(r.promptSnapshot.prompt,/<image0>|<image3>/);assert.equal(state.prompt,'@参考图5用@参考图2画风');
  assert.equal(r.referencePolicy.stylePriority,true);assert.equal(r.plan.editEnhancer.promptIds[0],'proof');
  assert.match(r.promptSnapshot.negativePrompt,/photorealistic facial proportions/);
  assert.equal(r.state.samplingOverrides['qwen-2.1:img2img'].cfg,3);
});

test('the actual PE Q8 anime rewrite reaches existing rendering guidance and keeps the style-priority contract',async()=>{
  const {rewritten_prompt}=JSON.parse(readFileSync(new URL('../fixtures/art-pe-bright-q8-rewrite.json',import.meta.url),'utf8'));
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
  p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:rewritten_prompt,renderingClass:artEditRendering(rewritten_prompt),sourceOrder:[1,2]};
  const e=env(p),state={prompt:'图1用图2画风',provider:'local',width:1280,height:960,negativePrompt:''};
  const r=await e.api.prepare(ctx(state,[ref('photo'),ref('style')]));
  assert.equal(r.plan.editEnhancer.renderingClass,'anime');
  assert.ok(r.promptSnapshot.prompt.startsWith(rewritten_prompt),'the PE directive is not rewritten by the classification fix');
  assert.match(r.promptSnapshot.negativePrompt,/photographic skin texture/);
  assert.equal(r.state.samplingOverrides['qwen-2.1:img2img'].cfg,3);
  assert.equal(r.state.uiPreserveLayout,false);
  assert.equal(e.api.generationOptions(r).styleReferencePriority,true);
  assert.deepEqual([r.state.width,r.state.height],[1280,960]);
});

test('independent style fields preserve source expression without forcing source face geometry',async()=>{
  const p=plan([{source:1,uses:[use('subject',{sourceExpression:{faces:1,eyes:'one-closed',mouth:'closed-smile'},sourceContent:{action:'眨眼持杯'}})],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
  p.editEnhancer={kind:'qwen21-style-observation',version:'drawing-style-observation-v1',model:'qwen3.5_9b_bf16.safetensors',prompt:'将<image1>按完整<image2>重新绘制。暗面采用实际冷色层次。',sourceOrder:[1,2]};
  const e=env(request=>request.purpose==='art-director-review'?{schema:'nf.art.review.v1',pass:true,issues:[],repair:''}:p),r=await e.api.prepare(ctx({prompt:'图1用图2画风'},[ref('photo'),ref('style')]));
  assert.match(r.promptSnapshot.prompt,/保持<image1>原有的一只眼闭合眨眼、另一只眼睁开/);
  assert.match(r.promptSnapshot.prompt,/五官比例仍按目标画风重绘/);
  assert.doesNotMatch(r.promptSnapshot.negativePrompt,/photographic skin texture|realistic nose/);
  await e.api.review(r,ref('output').dataUrl);
  assert.equal(e.calls[1].artContext.plan.references.find(ref=>ref.source===1).uses[0].retainedExpression.eyes,'one-closed');
  const changed=env(p),c=await changed.api.prepare(ctx({prompt:'图1用图2画风，改成睁眼'},[ref('photo'),ref('style')]));
  assert.doesNotMatch(c.promptSnapshot.prompt,/保持<image1>原有的一只眼闭合/);
});
test('invalid PE slots cannot bypass reference-role validation',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
  p.editEnhancer={kind:'qwen21-pe-i2i',model:'qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors',version:'drawing-style-v1',prompt:'将<image1>按<image3>重绘',sourceOrder:[1,2]};
  const e=env(p);await assert.rejects(e.api.prepare(ctx({prompt:'图1用图2画风'},[ref('a'),ref('b')])),/本地AI编辑指令或参考编号无效/);
});

test('PE retains distinct drawing methods within anime and does not force ink or CG into anime',async()=>{
  const methods=[['bright','anime','硬边色块、简洁轮廓、通透明亮的日光'],['dark','anime','狭长眼部与克制高光、冷灰紫暗部、低对比暗色皮肤'],['ink','other','宣纸吸水纹理、干湿笔锋、淡墨渗化、少量矿物设色'],['cg','other','半写实体块、绘画性厚涂、笔触转折与材质反光']];
  for(const [id,renderingClass,method]of methods){
    const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
    p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:`按<image2>的${method}整体重绘<image1>。`,sourceOrder:[1,2],renderingClass};
    const e=env(p),r=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风'},[ref('photo'),ref(id)]));
    assert.ok(r.promptSnapshot.prompt.includes(method));
    for(const [other,,otherMethod]of methods)if(other!==id)assert.ok(!r.promptSnapshot.prompt.includes(otherMethod));
    if(renderingClass==='other'){assert.equal(r.renderingPolicy,undefined);assert.equal(r.promptSnapshot.negativePrompt,'');assert.doesNotMatch(r.promptSnapshot.prompt,/大眼睛|赛璐璐|动漫脸/);}
  }
});

test('PE uses measured dark reference values without overriding explicitly preserved illumination',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
  p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'用<image2>的高调动漫画风重绘<image1>。',sourceOrder:[1,2],renderingClass:'anime'};
  const e=env(p),make=e.sandbox.document.createElement;
  e.sandbox.document.createElement=tag=>{const c=make(tag),get=c.getContext;c.getContext=()=>({...get(),getImageData:()=>({data:[8,12,20,255]})});return c;};
  const r=await e.api.prepare(ctx({prompt:'图1用图2画风'},[ref('photo'),ref('dark')]));
  assert.match(r.promptSnapshot.prompt,/整体明暗校验：整体低调/);assert.match(r.promptSnapshot.prompt,/该校验优先于文字分析中不一致/);
  const locked=await e.api.prepare(ctx({prompt:'图1用图2画风，保持原光感'},[ref('photo'),ref('dark')]));
  assert.doesNotMatch(locked.promptSnapshot.prompt,/整体明暗校验/);
});

test('PE donor-content exclusions execute even without legacy observer medium fields and never suppress CG realism',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{donorExclusions:['花纹吊带裙','酒瓶','户外木椅']})],omit:[]}]);
  p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'按<image2>的半写实CG体积与材质重绘<image1>。',sourceOrder:[1,2],renderingClass:'other'};
  const e=env(p),r=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风'},[ref('photo'),ref('cg')]));
  assert.equal(r.promptSnapshot.negativePrompt,'花纹吊带裙, 酒瓶, 户外木椅');
  assert.equal(r.state.samplingOverrides['qwen-2.1:img2img'].cfg,3);
  assert.doesNotMatch(r.promptSnapshot.negativePrompt,/photograph|photorealistic|skin texture/);
  assert.equal(r.references.find(r=>r.role==='style').renderingProfile,undefined);
});

test('an upstream isolation mistake cannot compile target media or techniques into negative guidance',async()=>{
  for(const technique of ['水墨晕染','油画厚涂','纸纹质感','赛璐璐平涂','watercolor','CG rendering','月夜雨景','纯红色背景','蓝紫色背景']){
    const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{donorExclusions:['茅草屋',technique]})],omit:[]}]);
    p.editEnhancer={kind:'qwen21-style-observation',version:'drawing-style-observation-v1',prompt:'将<image1>按<image2>画法重绘。',sourceOrder:[1,2]};
    const e=env(p);
    const r=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风',negativePrompt:'用户指定不要暖光'},[ref('photo'),ref('style')]));
    assert.equal(r.promptSnapshot.negativePrompt,'用户指定不要暖光, 茅草屋');
  }
});

test('explicit semi-real 3D material intent wins over an erroneous flat-anime observation without changing the original request',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{renderingProfile:{medium:'二维动漫插画',facialStyle:'简洁眼睑',markMaking:'分组发丝',shading:'平涂',surface:'无纸纹或笔触',lightingStyle:'日光',palette:'暖色'}})],omit:[]}]);
  const e=env(p),state={provider:'local',prompt:'图1用图2画风，半写实3D质感'};
  const r=await e.api.prepare(ctx(state,[ref('photo'),ref('cg')]));
  assert.doesNotMatch(r.promptSnapshot.negativePrompt,/photorealistic|photographic skin|realistic nose/);
  assert.doesNotMatch(r.promptSnapshot.prompt,/二维动漫插画|上色明暗：平涂/);
  assert.ok(r.promptSnapshot.prompt.includes(state.prompt.replace('图1','<image1>').replace('图2','<image2>')));
  assert.equal(state.prompt,'图1用图2画风，半写实3D质感');
});

test('animated 3D separates facial stylization from realistic skin and materials and respects an explicit face lock',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
  p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'采用<image2>的半写实3D动画角色造型与立体材质，重建<image1>。',sourceOrder:[1,2],renderingClass:'animated-3d'};
  const e=env(p),r=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风'},[ref('photo'),ref('cg')]));
  assert.equal(r.promptSnapshot.negativePrompt,'photographic facial proportions, live action human face');
  assert.doesNotMatch(r.promptSnapshot.negativePrompt,/photographic skin|realistic nose|photograph,/);
  assert.equal(r.state.samplingOverrides['qwen-2.1:img2img'].cfg,3);
  for(const lock of ['保持真实五官','保持脸型','不要改变面部轮廓']){
    const locked=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风，'+lock},[ref('photo'),ref('cg')]));
    assert.equal(locked.promptSnapshot.negativePrompt,'');
  }
});

test('measured reference contrast is preserved independently of global exposure',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
  p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'按<image2>半写实3D动画质感重构<image1>。',sourceOrder:[1,2],renderingClass:'animated-3d'};
  const e=env(p),make=e.sandbox.document.createElement;
  e.sandbox.document.createElement=tag=>{const c=make(tag),get=c.getContext;c.getContext=()=>({...get(),getImageData:()=>({data:[12,12,12,255,50,50,50,255,115,115,115,255,230,230,230,255]})});return c;};
  const r=await e.api.prepare(ctx({prompt:'图1用图2画风'},[ref('photo'),ref('cg')]));
  const v=r.references.find(r=>r.role==='style').valueProfile;
  assert.equal(v.key,'mid');assert.equal(v.strongContrast,true);
  assert.match(r.promptSnapshot.prompt,/亮暗跨度较大.*不把暗面均匀填亮/);
  const separate=await e.api.prepare(ctx({prompt:'图1用图2画风，保持原照明'},[ref('photo'),ref('cg')]));
  assert.doesNotMatch(separate.promptSnapshot.prompt,/亮暗跨度较大/);
});

test('local review tolerates the completed generation handoff race without submitting another image',async()=>{
  const e=env(plan([{source:1,uses:[use('subject')],omit:[]}])),prepared=await e.api.prepare(ctx({prompt:'精修图1'},[ref('photo')]));
  let calls=0;
  e.sandbox.setTimeout=fn=>{queueMicrotask(fn);return 1;};
  e.sandbox.electronAPI.promptAssistantReverseImagePrompt=async p=>{assert.equal(p.purpose,'art-director-review');calls++;return calls===1?{ok:false,errorCode:'runtime-generation-busy',error:'运行时交接中'}:{ok:true,data:{artReview:{schema:'nf.art.review.v1',pass:true,issues:[],repair:''}}};};
  assert.equal((await e.api.review(prepared,ref('output').dataUrl)).pass,true);
  assert.equal(calls,2);
  e.sandbox.electronAPI.promptAssistantReverseImagePrompt=async()=>{calls++;return {ok:false,errorCode:'model-failed',error:'模型失败'};};
  await assert.rejects(e.api.review(prepared,ref('output').dataUrl),/模型失败/);
  assert.equal(calls,3);
});

test('every paired style class uses one PE call and never invokes another observer or reviewer',async()=>{
  for(const renderingClass of ['anime','painterly','other','animated-3d']){
    const paired={...plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]),editEnhancer:{kind:'qwen21-pe-i2i',model:'PE',version:'drawing-style-v1',prompt:'将<image1>按<image2>实际画风重绘',renderingClass,sourceOrder:[1,2],promptIds:['one-pe']}};
    const e=env(p=>{assert.equal(p.artContext.styleObservation,undefined);return paired;});
    const r=await e.api.prepare(ctx({prompt:'图1用图2画风',provider:'local',width:1280,height:960},[ref('photo'),ref('style')]));
    assert.equal(e.calls.length,1);assert.equal(r.plan.editEnhancer.renderingClass,renderingClass);
    const reviewed=await e.api.review(r,ref('output').dataUrl);
    assert.equal(reviewed.pass,null);assert.equal(reviewed.skipped,true);assert.equal(e.calls.length,1,'no additional model review');
    assert.equal(r.state.width,1280);assert.equal(r.state.height,960);
  }
  const e=env(()=>{throw Error('PE 失败');});
  await assert.rejects(e.api.prepare(ctx({prompt:'图1用图2画风'},[ref('photo'),ref('style')])),/PE 失败/);
  assert.equal(e.calls.length,1,'failure never invokes another model');
});

test('approved PE anime keeps its rendering negative without layering donor nouns or redundant exposure grading',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{donorExclusions:['女仆装','飞鸟群']})],omit:[]}]);
  p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'按<image2>的明亮细腻动漫画风重绘<image1>。',renderingClass:'anime',sourceOrder:[1,2]};
  const e=env(p),r=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风',negativePrompt:'不要文字'},[ref('photo'),ref('bright-style')]));
  assert.doesNotMatch(r.promptSnapshot.prompt,/整体明暗校验/);
  assert.match(r.promptSnapshot.negativePrompt,/不要文字.*photograph/);
  assert.doesNotMatch(r.promptSnapshot.negativePrompt,/女仆装|飞鸟群/);
  assert.deepEqual(Array.from(r.references.find(x=>x.role==='style').donorExclusions),['女仆装','飞鸟群'],'physical contents remain review evidence');
  assert.equal(r.renderingPolicy.cfg,3);
});

test('local Qwen sends user exclusions only to negative conditioning for standard and Turbo AI paths',async()=>{
  const negative='真人CG，3D渲染，游戏建模，测试排除词';
  for(const variant of ['standard','turbo'])for(const enhanced of [false,true]){
    const p=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]);
    if(enhanced)p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'将<image1>按<image2>的实际材质和分层光色整体重绘。',renderingClass:'other',sourceOrder:[1,2]};
    const e=env(p),r=await e.api.prepare(ctx({provider:'local',prompt:'图1用图2画风',negativePrompt:negative,localQwen21Variant:variant},[ref('photo'),ref('style')]));
    assert.equal(e.calls.length,1);assert.equal(e.calls[0].negativePrompt,negative,'the analyzer may read the exclusion intent');
    assert.ok(r.promptSnapshot.negativePrompt.startsWith(negative));
    assert.doesNotMatch(r.promptSnapshot.prompt,/真人CG|3D渲染|游戏建模|测试排除词|必须避免/);
  }
  const e=env(plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[]}]));
  const cloud=await e.api.prepare(ctx({provider:'gpt',prompt:'图1用图2画风',negativePrompt:negative},[ref('photo'),ref('style')]));
  assert.ok(cloud.promptSnapshot.prompt.includes('必须避免：'+negative),'providers without native negative conditioning keep the textual request');
});

test('direct style requests canonicalize reversed image slots without analyzing or applying style policy to other edits',async()=>{
  for(const suffix of ['', '，保留原配色', '，保持原光感', '，保持原构图']){
    const e=env(()=>{throw Error('无AI不应执行分析');});
    const r=await e.api.prepare(ctx({provider:'local',drawingAnalysisEngine:'direct',prompt:'图5按图2画风'+suffix,width:1280,height:960},[null,ref('style'),null,null,ref('photo')]));
    assert.equal(e.calls.length,0);assert.equal(e.api.generationOptions(r).styleReferencePriority,true);
    assert.deepEqual(Array.from(r.references,x=>[x.sourceNumber,x.role]),[[5,'subject'],[2,'style']]);
    assert.equal(r.promptSnapshot.prompt,'<image1>按<image2>画风'+suffix);assert.equal(r.state.uiPreserveLayout,false);
    assert.equal(r.state.width,1280);assert.equal(r.state.height,960);
  }
  for(const [state,prompt] of [[{},'图1用图2姿势'],[{},'图1用图2画风和姿势'],[{},'图1用图2姿势和画风'],[{},'图1用图2画风和背景'],[{},'图1的衣服款式用图2'],[{provider:'google'},'图1用图2画风'],[{nsfw:true},'图1用图2画风'],[{drawingTask:'preserve'},'图1用图2画风']]){
    const e=env(()=>{throw Error('无AI不应执行分析');});
    const r=await e.api.prepare(ctx({provider:'local',drawingAnalysisEngine:'direct',...state,prompt},[ref('photo'),ref('control')]));
    assert.equal(e.api.generationOptions(r).styleReferencePriority,false,JSON.stringify(state)+' '+prompt);
    assert.equal(e.calls.length,0);
  }
});

test('formal normal and Turbo graphs keep the same complete style geometry after prompt edits and in a fresh NoAI state',async()=>{
  const info={NovaFlowGGUFBF16Loader:{input:{required:{unet_name:[['qwen-image-2.1-UC-BF16.gguf','Qwen-Image-2.1-Turbo-BF16.gguf']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_bf16_heretic.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},TextEncodeQwenImage21:{},QwenImage21Cache:{},KSampler:{},VAEDecode:{},SaveImage:{},ImageScale:{}};
  const host=await createWorkflowHost({rendererDir:new URL('../../worker-renderer/',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),objectInfo:info});
  for(const variant of ['standard','turbo']){
    const p=plan([{source:2,uses:[use('style')],omit:[]},{source:5,uses:[use('subject')],omit:[]}]);
    p.editEnhancer={kind:'qwen21-pe-i2i',version:'drawing-style-v1',prompt:'将<image2>按<image1>的实际画风整体重绘。',sourceOrder:[2,5],renderingClass:'other'};
    const e=env(p),refs=[null,ref('cg'),null,null,ref('photo')],state={provider:'local',mode:'img2img',prompt:'图5用图2画风',negativePrompt:'不要文字',drawingAnalysisEngine:'local',localQwen21Variant:variant,width:1280,height:960,seed:324423870,randomSeed:false,samplingOverrides:{'qwen-2.1:img2img':{steps:25,cfg:2.5}}};
    const first=await e.api.prepare(ctx(state,refs));first.applyPromptToState();state.drawingAnalysisEngine='direct';
    const unchanged=await e.api.prepare(ctx(state,refs));state.prompt+='，上衣改为红色';state.negativePrompt+='，不要耳环';
    const edited=await e.api.prepare(ctx(state,refs));
    const fresh=await e.api.prepare(ctx({...state,prompt:'图5按图2画风，上衣改为红色'},refs));
    const geometry=[];
    for(const prepared of [first,unchanged,edited,fresh]){
      assert.equal(e.api.generationOptions(prepared).styleReferencePriority,true);
      assert.deepEqual(Array.from(prepared.references,r=>[r.sourceNumber,r.role]),[[5,'subject'],[2,'style']]);
      const graph=JSON.parse(JSON.stringify(await host.buildGraph({module:'novaflow-brand-runtime',method:'buildArtGenerateRunWorkflow',options:{__args:['local','img2img',['photo.jpg','cg.jpg'],'NF_contract',prepared.promptSnapshot.prompt,prepared.promptSnapshot.negativePrompt,'test',[{width:1280,height:960},{width:768,height:1344}],prepared.state,10,e.api.generationOptions(prepared)]}})));
      // Same matching-aspect contract as the budget test above: content stays on
      // LoadImage 100, style on 101, and sampling uses the encoder latent.
      geometry.push({image1:graph['5'].inputs['images.image_1'],image2:graph['5'].inputs['images.image_2'],latent:graph['7'].inputs.latent_image,contentScale:graph['200']||null,styleScale:graph['201']||null});
      assert.deepEqual(graph['5'].inputs['images.image_1'],['100',0]);assert.deepEqual(graph['5'].inputs['images.image_2'],['101',0]);
      assert.equal(graph['200'],undefined);assert.equal(graph['201'],undefined);
      assert.deepEqual(graph['7'].inputs.latent_image,['5',2]);assert.equal(graph['6'],undefined);
      assert.doesNotMatch(graph['5'].inputs.prompt,/主体的位置、大小和画面取景不变|必须避免/);
      assert.equal(graph['5'].inputs.negative_prompt,prepared.promptSnapshot.negativePrompt);
      assert.equal(graph['7'].inputs.cfg,variant==='turbo'?1:2.5);
      if(variant==='standard')assert.equal(graph['7'].inputs.steps,25);
    }
    for(const g of geometry.slice(1))assert.deepEqual(g,geometry[0],'reference processing cannot depend on AI provenance or prompt/negative edits');
    assert.equal(e.calls.length,1,'only the first AI request analyzes images');
  }
});
