import test from 'node:test';
import {readFoartPlan} from '../../packages/shared/src/foart-tool-plan.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {FOART_TOOL_SCHEMA,FOART_TOOL_SYSTEM,validateFoartPlan,validateFoartMediaOperation} from '../../packages/shared/src/foart-tool-plan.mjs';
import {createCompanionChat} from '../../packages/shared/src/companion-chat.mjs';
import {createFlashArtAgent} from '../../worker/src/flash-art-agent.mjs';
import {buildGrokPromptOptimizeRequest,grokResponsesPublicResult} from '../../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
const context=()=>({schema:FOART_TOOL_SCHEMA,controls:[{id:'control-1',label:'质量',kind:'select',options:[{value:'high',label:'High'}]},{id:'control-2',label:'尺寸',kind:'input',type:'number',min:64,max:4096}]});
const plan=operations=>({schema:FOART_TOOL_SCHEMA,status:operations.length?'act':'reply',reply:'准备调用 Foart 工具。',operations});

test('tool plans reject invented controls, unauthorized fields and invalid native values',()=>{
  assert.equal(validateFoartPlan(plan([{action:'set_control',controlId:'control-1',value:'high'}]),context()).status,'act');
  for(const op of [{action:'set_control',controlId:'invented',value:'high'},{action:'set_control',controlId:'control-1',value:'unlisted'},{action:'set_control',controlId:'control-2',value:8192},{action:'open',surface:'account'},{action:'art_action',name:'shell'},{action:'image_generate',prompt:'x',generationMode:'txt2img',useResult:false,url:'https://outside.test'}])assert.throws(()=>validateFoartPlan(plan([op]),context()));
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
test('online Foart planning is metered and returns only a validated plan, without executing a tool',async()=>{
  let request,calls=0,charged=0;
  const service=createCompanionChat({provider:{apiKey:'fixture',baseUrl:'https://llm.runninghub.ai/v1',model:'fixture'},charge:async input=>{charged++;const outcome=await input.run();return {...outcome,quota:{settled_credits:outcome.settledCredits}};},fetchImpl:async(url,init)=>{calls++;request=JSON.parse(init.body);return Response.json({model:'fixture',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(plan([{action:'open',surface:'drawing'}]))}}],usage:{prompt_tokens:200,completion_tokens:30,total_tokens:230}});}});
  const response=await service.reply({user:{id:'fixture'},payload:{requestId:'foart-online-123',mode:'foart',message:'打开绘图',history:[],foartContext:context()}});
  assert.equal(charged,1);assert.equal(calls,1);assert.deepEqual(response.toolPlan.operations,[{action:'open',surface:'drawing'}]);
  assert.equal(request.tools,undefined);assert.ok(request.messages[0].content.includes(FOART_TOOL_SYSTEM));assert.doesNotMatch(JSON.stringify(request.messages[0]),/write the prompt itself in English by default/);assert.match(JSON.stringify(request.messages.at(-1)),/control-1/);
});
test('local Foart planning receives the identical role and cannot replace the tool schema',async()=>{
  let observed;
  const response=await createFlashArtAgent().run({payload:{requestId:'foart-local-123',provider:'local',mode:'foart',message:'打开绘图',history:[],foartContext:context(),images:[]},flash:{identity:{id:'fixture'},inferConversation:async request=>{observed=request;return {model:'fixture',requestId:'model-123',finishReason:'stop',message:{role:'assistant',content:JSON.stringify(plan([{action:'open',surface:'drawing'}]))}};}}});
  assert.equal(observed.messages[0].content,FOART_TOOL_SYSTEM);assert.equal(observed.reasoningBudgetTokens,0);assert.equal(response.toolPlan.operations[0].surface,'drawing');
});

async function imageFixture(){
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  let selected=null,optimizations=0;const runs=[],references=[];
  class Event{constructor(type,init){this.type=type;Object.assign(this,init);}}
  const nav={textContent:'美工',getAttribute:()=>null,getBoundingClientRect:()=>({left:0,top:0,width:40,height:20}),dispatchEvent(){}};
  const state={provider:'gpt',mode:'txt2img',prompt:'',negativePrompt:'keep',gptSize:'1024x1024',gptQualityTxt2img:'medium',count:7};
  const rt={state,selectedResult:()=>selected,references:()=>references,setMode:m=>state.mode=m,setReference:(i,r)=>references[i]=r,refreshReferences(){},render(){},activate(){},captureContext:()=>({state,generationSurface:'drawing'}),run:async options=>{options.drawingPrepared.assertCurrent();runs.push(options.drawingPrepared);selected={id:'result-'+runs.length,name:'generated-'+runs.length+'.png',imageUrl:png+'fixture'+runs.length};}};
  const root={crypto:webcrypto,setTimeout:(fn)=>setTimeout(fn,0),PointerEvent:Event,MouseEvent:Event,Event,document:{querySelectorAll:selector=>selector.includes('primary-entry')?[nav]:[]},__NovaFlowArtGenerate:rt,NovaFlowArtGenerateModels:{workflowSettings:s=>({quality:s.gptQualityTxt2img,size:s.gptSize})},electronAPI:{smartAiPromptOptimize:async input=>{optimizations++;return {ok:true,result:{prompt:'原有优化器：'+input.prompt}};}}};
  const ctx=vm.createContext(root);vm.runInContext(await readFile(new URL('../../renderer/foart-tool-contract.js',import.meta.url),'utf8'),ctx);vm.runInContext(await readFile(new URL('../../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8'),ctx);
  return {root:ctx,state,runs,references,get selected(){return selected;},get optimizations(){return optimizations;}};
}
test('GPT native generation preserves its model settings and a revision binds the actual previous output',async()=>{
  const f=await imageFixture(),tool=f.root.NovaFlowFoartTools;
  Object.defineProperty(f.state,'fullProjectCache',{enumerable:true,get(){throw Error('must not serialize image history or full project state');}});
  const first=await tool.execute({action:'image_generate',prompt:'红色机器人，绿背景',generationMode:'txt2img',useResult:false},{requirements:'保持构图',onStatus(){}});
  const prior=f.selected;
  const second=await tool.execute({action:'image_generate',prompt:'只把机器人改为蓝色，绿背景和构图不变',generationMode:'img2img',useResult:true},{requirements:'只改颜色',onStatus(){}});
  assert.equal(f.optimizations,2);assert.equal(first.id,prior.id);assert.equal(second.sourceResultId,first.id);assert.notEqual(second.id,first.id);
  assert.equal(f.runs[1].references[0].dataUrl,prior.imageUrl);assert.equal(f.runs[1].promptSnapshot.prompt,'原有优化器：只把机器人改为蓝色，绿背景和构图不变');
  assert.equal(f.state.provider,'gpt');assert.equal(f.state.gptSize,'1024x1024');assert.equal(f.state.gptQualityTxt2img,'medium');assert.equal(f.state.count,7);assert.equal(f.runs[1].state.count,7);
  assert.equal(Object.hasOwn(f.runs[1].state,'fullProjectCache'),false);
});
test('a stale image result during optimization stops before native generation',async()=>{
  const f=await imageFixture();f.root.electronAPI.smartAiPromptOptimize=async()=>{f.state.gptSize='2048x2048';return {ok:true,result:{prompt:'不能应用的旧结果'}};};
  await assert.rejects(f.root.NovaFlowFoartTools.execute({action:'image_generate',prompt:'机器人',generationMode:'txt2img',useResult:false},{onStatus(){}}),/变化/);assert.equal(f.runs.length,0);
});

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
