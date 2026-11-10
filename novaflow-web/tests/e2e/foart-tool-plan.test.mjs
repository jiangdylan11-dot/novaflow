import test from 'node:test';
import {readFoartPlan} from '../../packages/shared/src/foart-tool-plan.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {FOART_TOOL_SCHEMA,FOART_TOOL_SYSTEM,validateFoartPlan,validateFoartMediaOperation,foartPlanResponseFormat} from '../../packages/shared/src/foart-tool-plan.mjs';
import {createCompanionChat} from '../../packages/shared/src/companion-chat.mjs';
import {createFlashArtAgent} from '../../worker/src/flash-art-agent.mjs';
import {buildGrokPromptOptimizeRequest,grokResponsesPublicResult} from '../../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
const context=()=>({schema:FOART_TOOL_SCHEMA,controls:[{id:'control-1',label:'质量',kind:'select',options:[{value:'high',label:'High'}]},{id:'control-2',label:'尺寸',kind:'input',type:'number',min:64,max:4096}]});
const plan=operations=>({schema:FOART_TOOL_SCHEMA,status:operations.length?'act':'reply',reply:'准备调用 Foart 工具。',operations});
test('planner schema requires native media arguments including a zero-based trim range',()=>{
 const schema=foartPlanResponseFormat().schema.properties.operations.items.anyOf.find(s=>s.properties.action.const==='media').properties.operation.anyOf;
 const required=action=>schema.find(s=>s.properties.action.const===action).required;
 assert.ok(required('trim').includes('start'));assert.ok(required('trim').includes('end'));assert.ok(required('rate').includes('value'));assert.ok(required('track_mute').includes('enabled'));assert.ok(required('generate_sfx').includes('prompt'));
 assert.doesNotThrow(()=>validateFoartMediaOperation({action:'trim',target:'audio',start:0,end:1}));
 assert.throws(()=>validateFoartMediaOperation({action:'trim',target:'audio',seconds:1}));
});

test('planner schemas omit irrelevant media arguments and retain surface transitions during animation work',()=>{
 const full=foartPlanResponseFormat(),animation=foartPlanResponseFormat({animation:{active:true}});
 const choices=animation.schema.properties.operations.items.anyOf,actions=new Set(choices.map(s=>s.properties.action.const));
 assert.ok(actions.has('animation'));assert.ok(actions.has('open'));assert.ok(actions.has('assign_upload'));assert.ok(!actions.has('media'));
 const destinations=choices.find(s=>s.properties.action.const==='open').properties.surface.enum;assert.ok(destinations.includes('video'));assert.ok(destinations.includes('drawing'));
 const media=full.schema.properties.operations.items.anyOf.find(s=>s.properties.action.const==='media').properties.operation.anyOf;
 assert.deepEqual(Object.keys(media.find(s=>s.properties.action.const==='trim').properties).sort(),['action','target','clipId','start','end'].sort());
 assert.ok(media.find(s=>s.properties.action.const==='move').properties.trackId);assert.ok(media.find(s=>s.properties.action.const==='generate_sfx').properties.count);
 assert.ok(JSON.stringify(animation).length<JSON.stringify(full).length/2);
 assert.ok(foartPlanResponseFormat({media:{active:true},animation:{active:true}}).schema.properties.operations.items.anyOf.some(s=>s.properties.action.const==='media'));
});
test('ui_theme carries the user\'s own theme words and only runs on the open UI surface',()=>{
 const ctx={...context(),art:{surface:'ui'},uploads:[{id:'upload-1',name:'slot.png',kind:'image'},{id:'upload-2',name:'clip.mp4',kind:'video'}]};
 assert.doesNotThrow(()=>validateFoartPlan(plan([{action:'ui_theme',theme:'北欧神话，冰雪蓝金\n赛博朋克',uploadIds:['upload-1'],layout:'reskin',keepText:true,note:'人物换成女性'}]),ctx));
 assert.doesNotThrow(()=>validateFoartPlan(plan([{action:'ui_theme',theme:'蒸汽朋克'}]),ctx));
 assert.throws(()=>validateFoartPlan(plan([{action:'ui_theme',theme:'蒸汽朋克'}]),{...context(),art:{surface:'drawing'}}),/先打开UI设计/);
 assert.throws(()=>validateFoartPlan(plan([{action:'ui_theme',theme:'   '}]),ctx),/主题/);
 assert.throws(()=>validateFoartPlan(plan([{action:'ui_theme',theme:'蒸汽朋克',layout:'wild'}]),ctx));
 assert.throws(()=>validateFoartPlan(plan([{action:'ui_theme',theme:'蒸汽朋克',uploadIds:['upload-2']}]),ctx),/界面图/);
 assert.throws(()=>validateFoartPlan(plan([{action:'ui_theme',theme:'蒸汽朋克',uploadIds:['nope']}]),ctx),/界面图/);
 assert.throws(()=>validateFoartPlan(plan([{action:'ui_theme',theme:'蒸汽朋克',prompt:'x'}]),ctx));
});
test('UI layout operations preserve native module identities and reject out-of-canvas geometry',()=>{
 const ctx={...context(),uiLayout:{active:true,blocks:[{id:'title'}]}},block={id:'title',name:'设置',x:160,y:40,width:192,height:48};
 assert.doesNotThrow(()=>validateFoartPlan(plan([{action:'ui_layout',width:512,height:512,blocks:[block]}]),ctx));
 for(const patch of [{id:'unknown'},{x:500},{width:16},{requirements:'长'.repeat(1001)}])assert.throws(()=>validateFoartPlan(plan([{action:'ui_layout',width:512,height:512,blocks:[{...block,...patch}]}]),ctx));
 assert.throws(()=>validateFoartPlan(plan([{action:'ui_layout',width:512,height:512,blocks:[block]}]),context()));
});

test('tool plans reject invented controls, unauthorized fields and invalid native values',()=>{
  assert.equal(validateFoartPlan(plan([{action:'set_control',controlId:'control-1',value:'high'}]),context()).status,'act');
  for(const op of [{action:'set_control',controlId:'invented',value:'high'},{action:'set_control',controlId:'control-1',value:'unlisted'},{action:'set_control',controlId:'control-2',value:8192},{action:'open',surface:'account'},{action:'art_action',name:'shell'}])assert.throws(()=>validateFoartPlan(plan([op]),context()));
  // Since bac740ae an image step does not block on a stray field: it is dropped, never forwarded.
  const stray=validateFoartPlan(plan([{action:'image_generate',prompt:'x',generationMode:'txt2img',useResult:false,url:'https://outside.test'}]),context());
  assert.equal(stray.status,'act');assert.equal(Object.hasOwn(stray.operations[0],'url'),false);
  assert.throws(()=>validateFoartPlan(plan([{action:'image_generate',prompt:'x',generationMode:'txt2img',useResult:false},{action:'art_action',name:'split'}]),context()));
  assert.throws(()=>validateFoartPlan(plan([{action:'set_control',controlId:'control-3',value:'自行改写'}]),{...context(),controls:[{id:'control-3',kind:'textarea',purpose:'image_prompt'}]}),/优化工具/);
  assert.equal(validateFoartPlan(plan([{action:'media',operation:{action:'volume',target:'audio',clipId:'clip-1',value:.5}},{action:'media',operation:{action:'loops',target:'audio',clipId:'clip-1',value:3}}]),context()).operations.length,2);
});
test('extended media parameters retain native bounds and cannot become arbitrary commands',()=>{
  for(const operation of [{action:'loops',target:'audio',clipId:'clip-1',value:3},{action:'track_mute',target:'video',trackId:'track-1',enabled:true},{action:'clip_transform',target:'video',clipId:'clip-1',transform:{centerX:512,scale:1.2}}])assert.equal(validateFoartMediaOperation(operation),operation);
  for(const operation of [{action:'loops',target:'video',value:3},{action:'rate',target:'video',value:9},{action:'clip_transform',target:'video',transform:{file:'private'}},{action:'generate_music',target:'audio',prompt:'x',seconds:1},{action:'volume',target:'audio',value:NaN}])assert.throws(()=>validateFoartMediaOperation(operation));
});
test('GPT retains the original semantic preservation checks without the local model five-section expansion',()=>{
  const payload={surface:'art',purpose:'optimize',prompt:'纯绿色背景，一个红色圆头机器人，正面站立，全身，无文字。',currentPrompt:'纯绿色背景，一个红色圆头机器人，正面站立，全身，无文字。',requirements:'只优化描述，保留数量和颜色',supportsNegativePrompt:false};
  const gpt=buildGrokPromptOptimizeRequest({...payload,targetEngine:'gpt-image-2.5'},'fixture');
  const local=buildGrokPromptOptimizeRequest(payload,'fixture');
  assert.equal(gpt.resultOptions.artSemanticFusion,true);assert.equal(gpt.resultOptions.artFiveSectionPrompt,false);
  assert.equal(local.resultOptions.artFiveSectionPrompt,true);assert.equal(gpt.body.max_output_tokens,1536);
  assert.doesNotMatch(JSON.stringify(gpt.body),/必须按 \[风格设定\]|每段至少两个句号/);
  const text='纯绿色背景，一个红色圆头机器人，正面站立，全身，无文字。机器人居中，双脚完整入画，红色金属表面有柔和的体积明暗，轮廓清楚，游戏图标风格。';
  const parsed=grokResponsesPublicResult({output_text:JSON.stringify({prompt:text})},{...gpt.resultOptions,supportsNegativePrompt:false});
  assert.equal(parsed.output_text,text);
  assert.throws(()=>grokResponsesPublicResult({output_text:JSON.stringify({prompt:'两个蓝色机器人，白色背景。'})},{...gpt.resultOptions,supportsNegativePrompt:false}));
});
test('a complete GPT brief can remain unchanged, while an unapplied native edit still fails',()=>{
 const prompt='纯白背景，一个蓝色圆头机器人，正面站立全身，两个白色圆眼，无文字。';
 const input={surface:'art',purpose:'optimize',targetEngine:'gpt-image-2.5',prompt,currentPrompt:prompt,requirements:'保留机器人数量和颜色，优化模型表达',supportsNegativePrompt:false};
 const normal=buildGrokPromptOptimizeRequest(input,'fixture'),complete=buildGrokPromptOptimizeRequest({...input,completeVisualBrief:true},'fixture');
 assert.throws(()=>grokResponsesPublicResult({output_text:JSON.stringify({prompt})},normal.resultOptions),/未实际融合/);
 assert.equal(grokResponsesPublicResult({output_text:JSON.stringify({prompt})},complete.resultOptions).output_text,prompt);
 assert.throws(()=>grokResponsesPublicResult({output_text:JSON.stringify({prompt:'两个红色机器人，绿色背景。'})},complete.resultOptions));
});
test('online Foart planning is metered and returns only a validated plan, without executing a tool',async()=>{
  let request,calls=0,charged=0;
  const service=createCompanionChat({provider:{apiKey:'fixture',baseUrl:'https://llm.runninghub.ai/v1',model:'fixture'},charge:async input=>{charged++;const outcome=await input.run();return {...outcome,quota:{settled_credits:outcome.settledCredits}};},fetchImpl:async(url,init)=>{calls++;request=JSON.parse(init.body);return Response.json({model:'fixture',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(plan([{action:'open',surface:'drawing'}]))}}],usage:{prompt_tokens:200,completion_tokens:30,total_tokens:230}});}});
  const response=await service.reply({user:{id:'fixture'},payload:{requestId:'foart-online-123',mode:'foart',message:'打开绘图',history:[],foartContext:context()}});
  assert.equal(charged,1);assert.equal(calls,1);assert.deepEqual(response.toolPlan.operations,[{action:'open',surface:'drawing'}]);
  assert.equal(request.tools,undefined);assert.ok(request.messages[0].content.includes(FOART_TOOL_SYSTEM));assert.doesNotMatch(JSON.stringify(request.messages[0]),/write the prompt itself in English by default/);assert.match(JSON.stringify(request.messages.at(-1)),/control-1/);
});
test('one malformed planner response is repaired before execution and both provider usages are accounted',async()=>{
 let calls=0,charges=0,metadata;const service=createCompanionChat({provider:{apiKey:'fixture',baseUrl:'https://llm.runninghub.ai/v1',model:'fixture'},charge:async input=>{charges++;const value=await input.run();metadata=value.metadata;return value;},fetchImpl:async(_url,init)=>{
  const request=JSON.parse(init.body);assert.equal(request.response_format.type,'json_schema');calls++;
  const imageOp={action:'image_generate',prompt:'蓝色机器人',generationMode:'txt2img',...(calls===1?{}:{useResult:false})};
  if(calls===2)assert.match(JSON.stringify(request.messages),/failed validation BEFORE execution/);
  return Response.json({model:'fixture',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(plan([imageOp]))}}],usage:{prompt_tokens:200,completion_tokens:30,total_tokens:230,consumeMoney:0.001}});
 }});
 const response=await service.reply({user:{id:'fixture'},payload:{requestId:'foart-repair-123',mode:'foart',message:'生成蓝色机器人',history:[],foartContext:context()}});
 assert.equal(calls,2);assert.equal(charges,1);assert.equal(response.toolPlan.operations[0].useResult,false);assert.equal(metadata.planningRepairUsed,true);assert.equal(metadata.usage.input_tokens,400);assert.equal(metadata.usage.output_tokens,60);assert.equal(metadata.usage.consumeMoney,0.002);
});
test('local Foart planning receives the identical role and cannot replace the tool schema',async()=>{
  let observed;
  const response=await createFlashArtAgent().run({payload:{requestId:'foart-local-123',provider:'local',mode:'foart',message:'打开绘图',history:[],foartContext:context(),images:[]},flash:{identity:{id:'fixture'},inferConversation:async request=>{observed=request;return {model:'fixture',requestId:'model-123',finishReason:'stop',message:{role:'assistant',content:JSON.stringify(plan([{action:'open',surface:'drawing'}]))}};}}});
  assert.equal(observed.messages[0].content,FOART_TOOL_SYSTEM);assert.equal(observed.reasoningBudgetTokens,0);assert.equal(response.toolPlan.operations[0].surface,'drawing');
});

test('local planning repairs an invalid plan once before returning any executable work',async()=>{
 let calls=0;
 const flash={identity:{id:'fixture'},inferConversation:async input=>{
  calls++;if(calls===2){assert.equal(input.stage,'foart-tools-repair');assert.match(JSON.stringify(input.messages.at(-1)),/BEFORE execution/);}
  return {model:'fixture',requestId:'local-'+calls,finishReason:'stop',message:{content:JSON.stringify(plan([{action:'open',surface:'video',...(calls===1?{prompt:'invalid-top-level'}:{})}]))}};
 }};
 const payload={requestId:'foart-local-repair',provider:'local',mode:'foart',message:'打开视频工具',history:[],foartContext:context(),images:[]};
 const result=await createFlashArtAgent().run({payload,flash});assert.equal(calls,2);assert.equal(result.toolPlan.operations[0].surface,'video');assert.deepEqual(result.promptIds,['local-1','local-2']);
 calls=0;flash.inferConversation=async()=>{calls++;return {model:'fixture',requestId:'bad-'+calls,finishReason:'stop',message:{content:JSON.stringify(plan([{action:'open',surface:'account'}]))}};};
 await assert.rejects(createFlashArtAgent().run({payload:{...payload,requestId:'foart-local-repair-bad'},flash}),/版块无效/);assert.equal(calls,2);
});

async function imageFixture(){
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  let selected=null,optimizations=0;const runs=[],references=[];
  class Event{constructor(type,init){this.type=type;Object.assign(this,init);}}
  const nav={textContent:'美工',getAttribute:()=>null,getBoundingClientRect:()=>({left:0,top:0,width:40,height:20}),dispatchEvent(){}};
  const state={active:true,provider:'gpt',mode:'txt2img',prompt:'',negativePrompt:'keep',gptSize:'1024x1024',gptQualityTxt2img:'medium',count:7};
  const rt={state,selectedResult:()=>selected,references:()=>references,setMode:m=>state.mode=m,setReference:(i,r)=>references[i]=r,refreshReferences(){},render(){},activate(){},captureContext:()=>({state,generationSurface:'drawing'}),run:async options=>{options.drawingPrepared.assertCurrent();runs.push(options.drawingPrepared);selected={id:'result-'+runs.length,name:'generated-'+runs.length+'.png',imageUrl:png+'fixture'+runs.length};}};
  const root={crypto:webcrypto,setTimeout:(fn)=>setTimeout(fn,0),PointerEvent:Event,MouseEvent:Event,Event,document:{getElementById:id=>id==='novaflow-art-generate-workspace'?{}:null,querySelectorAll:selector=>selector.includes('primary-entry')?[nav]:[]},__NovaFlowArtGenerate:rt,NovaFlowArtGenerateModels:{workflowSettings:s=>({quality:s.gptQualityTxt2img,size:s.gptSize})},electronAPI:{smartAiPromptOptimize:async input=>{optimizations++;return {ok:true,result:{prompt:'原有优化器：'+input.prompt}};}}};
  const ctx=vm.createContext(root);vm.runInContext(await readFile(new URL('../../renderer/foart-tool-contract.js',import.meta.url),'utf8'),ctx);vm.runInContext(await readFile(new URL('../../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8'),ctx);
  return {root:ctx,state,runs,references,get selected(){return selected;},get optimizations(){return optimizations;}};
}
test('explicit PNG export wins over the model default and frame selection remains bounded',async()=>{
  const f=await imageFixture(),calls=[];f.root.document.querySelector=()=>null;
  f.root.NovaFlowSpineSplitBridge={getState:()=>({}),agentAction:async(name,options)=>{calls.push({name,...options});return {phase:'completed',fileName:'robot.png'};}};
  await f.root.NovaFlowFoartTools.execute({action:'art_action',name:'export'},{requirements:'把抠图结果导出为透明PNG，不要生成新图'});
  const receipt=await f.root.NovaFlowFoartTools.settlePending();
  assert.equal(calls[0].format,'png');assert.equal(receipt.fileName,'robot.png');
  assert.throws(()=>validateFoartMediaOperation({action:'loops',target:'audio',value:51}),/循环次数/);
  const frames={...context(),frameEditor:{frames:12,busy:false}};
  assert.equal(validateFoartPlan(plan([{action:'frame_select',startFrame:0,endFrame:11}]),frames).operations.length,1);
  assert.throws(()=>validateFoartPlan(plan([{action:'frame_select',startFrame:0,endFrame:12}]),frames),/超出/);
});

test('selected-layer PNG export keeps its layer scope and reports only an initiated download',async()=>{
 const f=await imageFixture();let format;f.root.document.querySelector=()=>null;
 f.root.NovaFlowSpineSplitBridge={getState:()=>({}),agentAction:async(_name,options)=>{format=options.format;return {phase:'completed',fileName:'矩形验收.png',output:{name:'矩形验收.png',bytes:214713,downloadInitiated:true,saved:false}};}};
 await f.root.NovaFlowFoartTools.execute({action:'art_action',name:'export',format:'layer'},{requirements:'只将矩形验收图层导出为透明PNG，其他不变'});
 const result=await f.root.NovaFlowFoartTools.settlePending();assert.equal(format,'layer');assert.equal(result.outputs[0].name,'矩形验收.png');assert.equal(result.outputs[0].bytes,214713);assert.equal(result.outputs[0].downloadInitiated,true);assert.equal(result.outputs[0].saved,false);
});

test('native prompt optimization receives user requirements without internal quoted execution records',async()=>{
  const f=await imageFixture();let received,active=false;
  f.root.NovaFlowAudioStudio={open:()=>{active=true;},isOpen:()=>active,sub:()=>active?'video':''};
  f.root.NovaFlowMediaAgent={capture:()=>({artContext:{surface:'media',active}}),execute:async(_plan,options)=>{assert.equal(options.snapshot.artContext.active,true);received=options.requirements;return {results:[]};}};
  await f.root.NovaFlowFoartTools.execute({action:'media',operation:{action:'generate_video',target:'video',prompt:'蓝色机器人轻轻点头，无对白'}},{fingerprint:async()=> 'current',requirements:'上次实际执行信息：{"mode":"image_video","outputs":["old.mp4"]}',optimizerRequirements:'首尾帧循环，点头后恢复原姿态，无音乐无对白'});
  assert.equal(received,'首尾帧循环，点头后恢复原姿态，无音乐无对白');assert.doesNotMatch(received,/old\.mp4|outputs|image_video/);
  assert.throws(()=>validateFoartMediaOperation({action:'generate_music',target:'audio',prompt:'音乐',bpm:300}),/节拍/);
  assert.throws(()=>validateFoartMediaOperation({action:'generate_sfx',target:'audio',prompt:'音效',count:5}),/数量/);
});

test('pose joint selection is limited to joints of the current native mannequin',async()=>{
  const ctx={...context(),pose:{bones:[{name:'head',label:'头部'}]}};
  assert.equal(validateFoartPlan(plan([{action:'pose_select',boneName:'head'}]),ctx).operations.length,1);
  assert.throws(()=>validateFoartPlan(plan([{action:'pose_select',boneName:'invented'}]),ctx),/关节不存在/);
  const f=await imageFixture();let selected;
  f.root.NovaFlowPoseReferenceTool={agentSelectBone:name=>(selected=name,{boneName:name,label:'头部'})};
  assert.equal((await f.root.NovaFlowFoartTools.execute({action:'pose_select',boneName:'head'})).message,'已选中姿势关节：头部');assert.equal(selected,'head');
});
test('native page transitions execute a valid prefix before reading newly enabled controls',()=>{
  const ctx={...context(),controls:[{id:'load',label:'加载视频',kind:'button'},{id:'frames',label:'帧编辑',kind:'button',disabled:true}]};
  const parsed=readFoartPlan(JSON.stringify(plan([{action:'activate_control',controlId:'load'},{action:'activate_control',controlId:'frames'}])),ctx);
  assert.deepEqual(parsed.operations,[{action:'activate_control',controlId:'load'}]);
  assert.throws(()=>readFoartPlan(JSON.stringify(plan([{action:'activate_control',controlId:'frames'}])),ctx),/不可用/);
});
test('one art action schema exposes every native name while runtime validation keeps dimensions and optimized prompts specific',()=>{
 const operations=foartPlanResponseFormat().schema.properties.operations.items.anyOf;
 const art=operations.filter(s=>s.properties.action?.const==='art_action');assert.equal(art.length,1);
 assert.ok(art[0].properties.name.enum.includes('canvasResize'));assert.ok(!art[0].properties.name.enum.includes('imageOutpaint'));assert.ok(art[0].properties.name.enum.includes('cutout'));
 const outpaint=operations.find(s=>s.properties.action.const==='art_outpaint');assert.deepEqual(outpaint.required,['action','width','height','prompt']);
 assert.equal(art[0].properties.width.maximum,8192);assert.ok(outpaint.properties.prompt.description);
 assert.throws(()=>validateFoartPlan(plan([{action:'art_action',name:'canvasResize'}]),context()));
 assert.throws(()=>validateFoartPlan(plan([{action:'art_action',name:'imageOutpaint',width:640,height:512}]),context()));
 assert.throws(()=>validateFoartPlan(plan([{action:'art_action',name:'cutout',width:640,height:512}]),context()));
});
test('explicit canvas size reaches the original art action without a second planning dialog',async()=>{
 const op={action:'art_action',name:'canvasResize',width:640,height:512,anchor:'center'};validateFoartPlan(plan([op]),context());
 assert.throws(()=>validateFoartPlan(plan([{...op,name:'cutout'}]),context()));assert.throws(()=>validateFoartPlan(plan([{...op,width:8193}]),context()));
 const f=await imageFixture();let received;f.root.document.querySelector=()=>null;f.root.NovaFlowSpineSplitBridge={getState:()=>({}),agentAction:async(name,options)=>{received={name,...options};return {phase:'completed'};}};
 await f.root.NovaFlowFoartTools.execute(op,{requirements:'将画布扩展至640×512居中'});await f.root.NovaFlowFoartTools.settlePending();
 assert.equal(received.name,'canvasResize');assert.deepEqual(JSON.parse(JSON.stringify(received.canvasResize)),{width:640,height:512,anchor:'center'});
});

test('an empty native art editor uses its single uploaded image without a position question and preserves an existing edited source',async()=>{
 const f=await imageFixture(),imports=[],state={source:null},bytes=new Uint8Array([1,2,3]);f.root.File=File;
 f.root.resolveReferenceDataUrl=async({file})=>'data:image/png;base64,'+Buffer.from(await file.arrayBuffer()).toString('base64');
 f.root.document.querySelector=()=>null;f.root.NovaFlowSpineSplitBridge={getState:()=>state,importSourceDataUrl:async(name,dataUrl)=>{imports.push({name,dataUrl});state.source={fileName:name,dataUrl};},agentAction:async()=>({phase:'completed'})};
 f.root.NovaFlowFoartTools.setUploads([{kind:'image',name:'source.png',file:new File([bytes],'source.png',{type:'image/png'})}]);
 const operation={action:'art_action',name:'imageOutpaint',width:640,height:512,prompt:'延续原图背景'};
 await f.root.NovaFlowFoartTools.execute(operation,{requirements:'用无限扩图扩展上传图片'});await f.root.NovaFlowFoartTools.settlePending();assert.deepEqual(imports,[{name:'source.png',dataUrl:'data:image/png;base64,AQID'}]);
 state.source={fileName:'edited.png',dataUrl:'data:image/png;base64,actual'};await f.root.NovaFlowFoartTools.execute(operation,{requirements:'接着实际结果扩图'});await f.root.NovaFlowFoartTools.settlePending();assert.equal(imports.length,1);assert.equal(state.source.fileName,'edited.png');
});

test('the unambiguous outpaint wire action requires the full visual brief and normalizes only to the original native tool',()=>{
 const operation={action:'art_outpaint',width:640,height:512,prompt:'把新增左右区域延伸为纯白背景，原有机器人不变',anchor:'center'};
 const actual=readFoartPlan(JSON.stringify(plan([operation])),context());assert.deepEqual(actual.operations,[{action:'art_action',name:'imageOutpaint',width:640,height:512,prompt:operation.prompt,anchor:'center'}]);
 for(const bad of [{...operation,prompt:undefined},{...operation,width:undefined},{...operation,name:'imageUpscale'},{...operation,url:'https://other.example'}])assert.throws(()=>readFoartPlan(JSON.stringify(plan([bad])),context()));
});

test('art layer continuation calls the native layer bridge and reports its actual name',async()=>{
 const f=await imageFixture();let received;
 f.root.NovaFlowSpineSplitBridge={agentLayerAction:async op=>{received=op;return {phase:'applied',layerId:op.layerId,name:'矩形验收',visible:true};}};
 const result=await f.root.NovaFlowFoartTools.execute({action:'art_layer',operation:'rename',layerId:'inside',name:'矩形验收'});
 assert.equal(received.layerId,'inside');assert.equal(result.name,'矩形验收');assert.match(result.message,/实际图层命名/);assert.equal(f.runs.length,0);
});

test('UI region selection requires an actual layout module',()=>{
 const context={schema:FOART_TOOL_SCHEMA,controls:[],uiLayout:{active:true,blocks:[{id:'close',name:'关闭'}]}};
 assert.doesNotThrow(()=>validateFoartPlan(plan([{action:'ui_select',blockId:'close'}]),context));
 assert.throws(()=>validateFoartPlan(plan([{action:'ui_select',blockId:'invented'}]),context));
});

