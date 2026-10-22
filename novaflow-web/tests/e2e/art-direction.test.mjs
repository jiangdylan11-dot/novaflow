import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { normalizeReverseRequest } from '../../worker/src/prompt-assistant.mjs';
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
const ctx=(state,references)=>({state,references,referenceLimit:10,generationSurface:'drawing'});

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
test('generation parameters contain settings, not cached pixels, histories, progress or inherited UI constraints',async()=>{
  const e=env(plan()),state={prompt:'水彩人像',provider:'local',seed:7,randomSeed:false,samplingOverrides:{qwen:{steps:40}},references:[ref('huge-pixels')],results:[ref('old-output')],promptHistory:Array(300).fill('x'.repeat(2000)),progressLabel:'old-status',uiPreserveLayout:true};
  const r=await e.api.prepare(ctx(state,[]));assert.equal(r.state.seed,7);assert.equal(r.state.prompt,'水彩人像');
  assert.ok(JSON.stringify(r.state).length<1000);assert.equal(r.state.uiPreserveLayout,undefined);assert.equal(r.state.results,undefined);assert.equal(r.state.promptHistory,undefined);
});
test('style pixels become scoped samples, never the complete donor; subject preserves its pixels',async()=>{
  const e=env(plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style')],omit:[[0,600,250,950]]}]));
  const refs=[ref('subject'),ref('style')],r=await e.api.prepare(ctx({prompt:'图1人物用图2画风'},refs));
  assert.equal(r.references[0].dataUrl,refs[0].dataUrl);assert.notEqual(r.references[1].dataUrl,refs[1].dataUrl);
  assert.equal(r.references[1].treatment,'isolated-style-samples');assert.match(r.promptSnapshot.prompt,/不复制样本排列/);
  assert.ok(e.draws.some(d=>d.length===9),'samples are actually cropped');
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
  assert.match(r.promptSnapshot.prompt,/输入图片1（原图2，主体/);assert.match(r.promptSnapshot.prompt,/只向指定目标应用表面材质/);
});
test('unsafe full-image style samples and missing references stop before generation',async()=>{
  const e=env();const source={prompt:'',references:[{source:1,role:'auto'}]};
  const scoped=e.api.validate(plan([{source:1,uses:[use('style',{samples:[[0,0,1000,1000]]})],omit:[]}]),source);
  const processed=await e.api.renderReference({source:1,...ref('style')},scoped.references[0].uses[0],[],()=>{});
  assert.ok(processed.samples.every(b=>b[2]-b[0]<=125&&b[3]-b[1]<=125),'oversized proposals are physically subdivided, never passed whole');
  assert.throws(()=>e.api.validate(plan([]),source),/遗漏/);
  await assert.rejects(e.api.compile(plan([{source:1,uses:[use('style')],omit:[[0,0,1000,1000]]}]),{references:[{source:1,...ref('x')}]},()=>{},()=>{},10),/风格样本/);
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

test('a pure style conversion explicitly preserves original framing and visible hands and feet',async()=>{
  const e=env(plan([{source:1,uses:[use('subject')],omit:[]}]));
  const r=await e.api.prepare(ctx({prompt:'水彩画'},[ref('photo')]));
  assert.match(r.promptSnapshot.prompt,/不裁掉原图已显示的头、手或脚/);
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
  assert.match(r.promptSnapshot.prompt,/用户要求：原始参考1换成原始参考2的画风/);
});
test('a style caption cannot import depicted energy effects into the executable brief or review contract',async()=>{
  const reply=plan([{source:1,uses:[use('subject')],omit:[]},{source:2,uses:[use('style',{detail:'粗犷水墨笔触，绿色能量漩涡，天空传送门，弓箭'})],omit:[]}]);
  const e=env(p=>p.purpose==='art-director-review'?{schema:'nf.art.review.v1',pass:true,issues:[],repair:''}:reply);
  const r=await e.api.prepare(ctx({prompt:'图1换成图2的画风'},[ref('base'),ref('style')]));
  assert.doesNotMatch(r.promptSnapshot.prompt,/绿色能量漩涡|天空传送门|弓箭/);
  assert.match(r.promptSnapshot.prompt,/水墨浓淡/,'drawing technique survives through a closed vocabulary');
  await e.api.review(r,ref('generated').dataUrl);
  assert.doesNotMatch(JSON.stringify(e.calls[1].artContext.plan),/绿色能量漩涡|天空传送门|弓箭/);
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
  const state={provider:'local',mode:'img2img',prompt:'',drawingTask:'anime',negativePrompt:'',width:768,height:1024,count:1,randomSeed:false,seed:17,loras:[],samplingOverrides:{},results:[]};
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
  return {e,state,refs,builds,uploads,statuses,run:()=>e.sandbox.runArtGenerate()};
}
test('real generation entry accepts an empty prompt with references, preserves original input and records review',async()=>{
  const p=plan([{source:1,uses:[use('subject')],omit:[]}]);const d=drawingRun(p);
  await d.run();assert.equal(d.state.results.length,1);assert.equal(d.builds.length,1);assert.equal(d.state.prompt,'');
  assert.equal(d.builds[0][10].taskProfile,'art-direction');assert.deepEqual(Array.from(d.builds[0][10].referenceRoles),['subject']);
  assert.equal(d.state.results[0].artDirection.review.pass,true);assert.equal(d.state.running,false);
  assert.equal(d.statuses.some(s=>s.error),false);assert.equal(d.e.calls.filter(c=>c.purpose==='art-director').length,1);
});
test('real generation entry limits correction to one and stages inputs for each attempt',async()=>{
  const failed={schema:'nf.art.review.v1',pass:false,issues:['姿势不符'],repair:'双腿改为站立，人物身份保持'};
  const d=drawingRun(plan([{source:1,uses:[use('subject')],omit:[]}]),[failed,failed]);
  await d.run();assert.equal(d.builds.length,2);assert.equal(d.uploads.length,2);assert.equal(d.state.results.length,1);
  assert.match(d.builds[1][4],/本次纠正：双腿改为站立/);assert.equal(d.state.results[0].artDirection.corrections,1);
  assert.equal(d.state.results[0].artDirection.review.pass,false);assert.match(d.statuses.at(-1).s,/检查有待确认/);
});
test('a failed review cannot silently submit a second paid cloud generation',async()=>{
  const failed={schema:'nf.art.review.v1',pass:false,issues:['画风不足'],repair:'改为水彩笔触'};
  const d=drawingRun(plan([{source:1,uses:[use('subject')],omit:[]}]),[failed]);
  d.state.provider='gpt';d.e.sandbox.NovaFlowArtGenerateModels.normalizeProvider=value=>value;d.e.sandbox.electronAPI.runtimeProviderUsageSettlement='web-control-plane-v1';
  await d.run();assert.equal(d.builds.length,1);assert.equal(d.state.results.length,1);
  assert.equal(d.state.results[0].artDirection.corrections,0);assert.equal(d.state.results[0].artDirection.review.pass,false);
});
