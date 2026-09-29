import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import * as edge from '../../supabase/functions/novaflow-backend/h3-prompt-enhance.mjs';
import { buildGrokPromptOptimizeRequest, normalizeMiniMaxH3PromptOutput, callGrokResponseWithVisualRetry, grokResponsesPublicResult, miniMaxH3FailureEnvelope } from '../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
const require = createRequire(import.meta.url);
const local = require('../admin-server/h3-prompt-enhance.js');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/h3-five-sections.json', import.meta.url)));
const options = {mode:'I2VA', minimaxH3Mode:'image_video', durationSeconds:10};
const formatted = local.validateFormat(JSON.stringify(fixture), options);
const chineseFixture = {...fixture, description: fixture.description.replace(/^.*?\n\n/, '以 <Picture 1> 为精确起始帧，保持黑色编发赛博造型与紫色发光眼睛。\n\n')};

test('action phases need not contain literal camera keywords', () => {
  const text=formatted.replace(/镜头|机位|camera|framing|shot|视角/gi,'画面');
  for(const api of [local,edge]) assert.equal(api.validateFormat(text,options),text);
});

test('equivalent timestamp notation is canonicalized without altering motion',()=>{
  const variant=formatted.replace(/(\d+\.\d+)-(\d+\.\d+)s：/g,'**【$1秒～$2秒】：**');
  for(const api of [local,edge]) assert.equal(api.validateFormat(variant,options),formatted);
});

test('Grok rich visual fields can change order without changing their facts',()=>{
  const sections=['[风格设定]\n数字绘画；清晰线条；金属质感','[主体物品]\n机器人角色；蓝色眼睛；手握工具','[环境背景]\n工厂室内；背景有管线','[光线与色彩]\n冷色侧光；金属高光','[拍摄参数]\n中景；平视构图'];
  const opts={minimaxH3Prompt:true,minimaxH3Reverse:true,minimaxH3RichVisualStage:true};
  const normal=grokResponsesPublicResult({output_text:sections.join('\n\n')},opts).output_text;
  const reordered=grokResponsesPublicResult({output_text:[sections[2],sections[1],sections[4],sections[0],sections[3]].join('\n\n')},opts).output_text;
  assert.equal(reordered,normal);
  assert.throws(()=>grokResponsesPublicResult({output_text:[sections[0],sections[1],sections[1],sections[3],sections[4]].join('\n\n')},opts));
});

test('validated legacy reverse text is displayed in five sections with audio and frame bindings',()=>{
  const old='参考帧对齐：<Picture 1> = 0秒；<Picture 2> = 3秒。\n\nintegrated_multimodal_description: [Shot 1] <Picture 1> 中机器人先抬手，镜头固定，再缓慢放下，结束时回到 <Picture 2> 的尾帧姿态。\n\noverall_soundscape: 轻微机器运转声\n\nnon_diegetic_music: N/A';
  for(const api of [local,edge]) {
    const value=api.fromValidatedLegacy(old,{mode:'first_last',durationSeconds:3});
    assert.match(value,/【任务定位】/);assert.match(value,/2-3s：/);
    assert.match(value,/轻微机器运转声/);assert.match(value,/<Picture 2>/);
    assert.doesNotMatch(value,/integrated_multimodal_description|\[Shot 1\]/);
  }
});

test('reverse facts stay in the overall description; the middle time range only gets the motion',()=>{
  const i2v='参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒\n\nintegrated_multimodal_description: [Shot 1] 主体1：数量：一名；身份：少女；外观：黑色短发、橙色衬衫；姿态：站立。\n\n主体2：数量：一只；身份：橘色长毛猫；姿态：坐在路边。\n\n关系：少女与猫并排。\n\n场景：乡村公路。\n\n画面：中景，平视。\n\n光色材质：动漫风格，阳光明亮。\n\n画面从首帧状态自然延续，动作连贯。镜头保持构图。\n\noverall_soundscape: 风声。\n\nnon_diegetic_music: N/A';
  const fl2v='参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒；<Picture 2> 对应 [Shot 1] = 5.00 秒\n\nintegrated_multimodal_description: [Shot 1]\n<Picture 1> 与 <Picture 2> 共同：\n主体1：数量：一名；身份：紫发女性角色。\n场景：大理石台阶。\n\n<Picture 1> 首帧：\n主体2：数量：一只；身份：橘色长毛猫；姿态：坐在台阶上。\n\n<Picture 2> 尾帧：\n主体2：数量：一只；身份：橘色长毛猫；姿态：趴在台阶上。\n\n画面从首帧状态自然延续，动作连贯。镜头保持构图。动作在 5.00 秒连续抵达尾帧状态。\n\noverall_soundscape: 风声。\n\nnon_diegetic_music: N/A';
  // The prompt workflow reflows a legacy narrative into space-joined sentences before the conversion.
  const reflowed=text=>text.replace(/(integrated_multimodal_description: )([\s\S]*?)(\n\noverall_soundscape)/,(_,head,body,tail)=>head+body.replace(/\s*\n\s*/g,' ')+tail);
  for(const api of [local,edge]) {
    for(const [text,mode] of [[i2v,'image_video'],[fl2v,'first_last'],[reflowed(i2v),'image_video'],[reflowed(fl2v),'first_last']]) {
      const value=api.fromValidatedLegacy(text,{mode,durationSeconds:5});
      const middle=value.match(/^1\.667-3\.333s：(.*)$/m)[1];
      assert.match(middle,/^画面从首帧状态自然延续，动作连贯。镜头保持构图。/);
      assert.doesNotMatch(middle,/主体\d|关系：|场景：|画面：|光色材质：|<Picture/);
      assert.doesNotMatch(value,/[。！？] /);
      assert.match(value,/主体1：数量：一名；身份：/);
    }
    const grouped=api.fromValidatedLegacy(reflowed(fl2v),{mode:'first_last',durationSeconds:5});
    assert.match(grouped,/\n<Picture 1> 与 <Picture 2> 共同：\n主体1：[^\n]+\n场景：大理石台阶。\n\n<Picture 1> 首帧：\n主体2：[^\n]+\n\n<Picture 2> 尾帧：\n主体2：[^\n]+\n\n画面从首帧状态/);
    const separate=api.fromValidatedLegacy(reflowed(i2v),{mode:'image_video',durationSeconds:5});
    assert.match(separate,/姿态：站立。\n\n主体2：[^\n]+\n\n关系：少女与猫并排。\n\n场景：乡村公路。/);
  }
});

test('多参 display joins Chinese sentences without spaces and starts each subject sentence on its own line',()=>{
  const display=[
    'subject_definitions:\n<Subject 1>：黑短发女性 素材来源：<Picture 1>。\n<Subject 2>：铜绿色机器人。',
    'summary:\n[reference generation] <Subject 1> 走向 <Subject 2>。',
    'retention_analysis:\n<Subject 1>: fully_preserved - 黑短发\n<Subject 2>: fully_preserved - 铜绿色',
    'detailed_description: [Shot 1] 动漫插画风格。 场景是乡村公路。 <Subject 1> 向右侧行走。 <Subject 2> 转头望向来者。 镜头跟拍 <Subject 1>。 <Subject 1> 说：“出发。 等等！”',
    'overall_soundscape: 风声。',
    'non_diegetic_music: N/A',
  ].join('\n\n');
  for(const api of [local,edge]) {
    const shown=api.toReferenceDisplay(display);
    // Each subject's sentence and the camera sentence start their own line, so the camera never reads as part of a subject.
    assert.match(shown,/【画面与动作】\n【镜头 1】动漫插画风格。场景是乡村公路。\n<主体 1> 向右侧行走。\n<主体 2> 转头望向来者。\n镜头跟拍 <主体 1>。\n<主体 1> 说：“出发。 等等！”\n/);    // The definition ends its sentence before 素材来源 instead of a bare space.
    assert.match(shown,/\n<主体 1>：黑短发女性。素材来源：<Picture 1>。\n/);
    // Quoted dialogue keeps its own spacing.
    assert.doesNotMatch(shown.replace(/“[^”]*”/g,''),/[。！？] /);
    assert.match(api.fromReferenceDisplay(shown),/detailed_description:\n+\[Shot 1\] 动漫插画风格。场景是乡村公路。\n<Subject 1> 向右侧行走。/);
    // A later shot shows its cut time in Chinese and reads back as the official marker.
    const timed=display.replace('镜头跟拍 <Subject 1>。','[Shot 2] At 00:02.000 镜头跟拍 <Subject 1>。');
    assert.match(api.toReferenceDisplay(timed),/【镜头 2】（第 2 秒）镜头跟拍/);
    assert.match(api.fromReferenceDisplay(api.toReferenceDisplay(timed)),/\[Shot 2\] At 00:02\.000 镜头跟拍/);
  }
});

// The shipped renderer no longer asks for or shows five sections: an old five-section answer or a
// prompt kept from before becomes the base display, and generation sends the official English text.
const rendererContext = () => {
  const context = {module:{exports:{}}, console}; context.globalThis=context; context.window=context;
  for (const file of ['h3-prompt-format.js','ai-sequence-minimax-h3-prompt.workflow.js','ai-sequence-minimax-h3.workflow.js']) vm.runInNewContext(fs.readFileSync(new URL('../../novaflow-web/renderer/'+file,import.meta.url),'utf8'), context);
  return context;
};
const fiveCurrent={modelId:'minimax_h3_local', mode:'image_video', durationSeconds:10, prompt:'机械女性先抬眼，再抬手，说话时镜头拉近。',resources:[{key:'first_frame',identity:'first',occupied:true,kind:'image',fileName:'first.png',mimeType:'image/png'}]};

test('an old five-section answer or prompt becomes the base display and fields in the renderer', () => {
  assert.equal(local.formatInstruction, edge.formatInstruction);
  assert.equal(edge.validateFormat(formatted, options), formatted);
  const workflow = rendererContext().NovaFlowAiSequenceMiniMaxH3PromptWorkflow;
  const request=workflow.prepareRequest(fiveCurrent);
  assert.doesNotMatch(request.requirements,/【任务定位】|Return exactly these five sections/);
  assert.ok(request.requirements.includes(local.baseInstruction));
  const restored=workflow.validateAndRestore({text:formatted, context:request.context,current:fiveCurrent});
  assert.match(restored.text,/^【参考帧对齐】\n@参考图 是视频第 0\.00 秒的起始画面，完整参考。\n\n【画面与动作】\n【镜头 1】Use @参考图 as the exact starting frame\./);
  // The editor shows the line as quoted speech; the fields keep its <d> block.
  assert.match(restored.text,/\(S1\) 说：“系统自检完成。动力核心已上线，下一条指令——可以直接下达。”/);
  assert.match(restored.modelText,/\(S1\) 说：<d>\[Chinese\] 系统自检完成。动力核心已上线，下一条指令——可以直接下达。<\/d>/);
  assert.doesNotMatch(restored.text,/【任务定位】|【说话者】|【台词】|【连续性与约束】|\d-\d+(?:\.\d+)?s：|<Subject/);
  assert.match(restored.modelText,/^integrated_multimodal_description: \[Shot 1\] Use <Picture 1> as the exact starting frame\./);
  assert.equal(workflow.prepareRequest({...fiveCurrent,prompt:formatted.replaceAll('<Picture 1>','@参考图')}).prompt,local.fromBaseDisplay(local.toBaseDisplay(formatted)));
  assert.throws(()=>workflow.validateAndRestore({text:formatted, context:request.context,current:{...fiveCurrent,durationSeconds:5}}),/stale/);
});

test('generation turns a five-section prompt into the official English I2V text before conditioning', async () => {
  const context = rendererContext();
  // A faithful translation of the converted prompt: every sentence arrives, so the coverage check passes.
  const english='integrated_multimodal_description: [Shot 1] Use <Picture 1> as the exact starting frame. Preserve the black braided cyber aesthetic and luminous violet eyes. S1 slowly raises her eyes toward the camera as the violet light in her eyes pulses faintly, and the camera holds a medium close-up. S1 begins to speak, her head slowly turns forward and the mechanical structure of her shoulders and neck moves slightly in sync, while the camera pushes in at slow speed. The violet-eyed cyber-bionic woman (S1) says: <d>[Chinese] 系统自检完成。动力核心已上线，下一条指令——可以直接下达。</d> S1 slowly passes her right hand in front of her chest and lowers it again, her lips staying in sync with the line as the violet-blue lights grow brighter. S1 speaks the second half of the line and leans slightly forward as the cables sway in a controlled way, while the camera pulls out slightly. After S1 finishes speaking she holds her gaze on the camera, the violet light in her eyes brightens and then fades, the background light strips dim in sync, and she stays calm.\n\noverall_soundscape: Soft servo whirs accompany her movements.\n\nnon_diegetic_music: N/A';
  const compiled=await context.NovaFlowAiSequenceMiniMaxH3PromptWorkflow.compileForGeneration({...fiveCurrent,prompt:formatted.replaceAll('<Picture 1>','@参考图')},async payload=>{
    assert.match(payload.requirements,/^H3 compile: translate-only$/m);
    assert.match(payload.prompt,/^integrated_multimodal_description: \[Shot 1\] Use <Picture 1> as the exact starting frame\./);
    return JSON.stringify({modelPrompt:english,displayPrompt:payload.prompt});
  });
  const graph=context.NovaFlowAiSequenceMiniMaxH3Workflow.buildWorkflow({mode:'i2v',params:{prompt:compiled.modelText,images:['first.png'],duration:10,seed:1}});
  const conditioning=Object.values(graph).find(node=>node.class_type==='MiniMaxH3ImageToVideo');
  assert.equal(conditioning.inputs.prompt,'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\n'+english);
  assert.equal(conditioning.inputs.last_frame,undefined);
});

test('new format rejects truncated output, timeline errors, missing references and undefined speakers', () => {
  for(const api of [local,edge]) {
    for(const broken of [formatted.split('【台词】')[0], formatted.replace('2.0-4.0s','2.5-4.0s'),formatted.replace('8.5-10.0s','8.5-11.0s'), formatted.replaceAll('<Picture 1>','<Picture 2>'), formatted.replace('<Subject 1> = (S1)','S1'),formatted.replace('时长10秒','时长5秒')]) assert.throws(()=>api.validateFormat(broken,options));
    assert.throws(()=>api.validateFormat(formatted,{...options,currentPrompt:'(S1)："必须保留的台词"'}),/台词/);
    assert.throws(()=>api.validateFormat(formatted,{...options,mode:'FL2VA',minimaxH3Mode:'first_last'}),/参考/);
  }
});

test('Python canonical base fields match the shared JS module', () => {
  const cases=[
    ['image_video',5,'integrated_multimodal_description: [Shot 1] 写实电影风格，<Picture 1> 中的女孩转身挥手，(S1) 说：<d>出发吧。</d>\n[Shot 2] 镜头切到站台近景。\n\noverall_soundscape: 站台广播声。\n\nnon_diegetic_music: 无'],
    ['first_last',6,'integrated_multimodal_description: [Shot 1] 女孩从 <Picture 1> 的门口走到沙发前坐下，落定为 <Picture 2> 的构图。镜头固定。\n\noverall_soundscape: 脚步声。\n\nnon_diegetic_music: N/A'],
    ['text_video',8,'integrated_multimodal_description: [Shot 1] 雨夜街头，一只橘猫跳上垃圾桶。\n[Shot 2] At 00:04.000 镜头切到猫的特写。\n\noverall_soundscape: 雨声。\n\nnon_diegetic_music: N/A'],
    // A single English word is only refused in the Chinese half of an optimize pair, not by the fields check both sides share.
    ['text_video',5,'integrated_multimodal_description: [Shot 1] 城市夜景，远处有 faint 的霓虹光。镜头固定。\n\noverall_soundscape: 车流声。\n\nnon_diegetic_music: N/A'],
  ];
  const script=`import sys,json\nsys.path.insert(0,'particle-editor-desktop')\nfrom prompt_assistant.h3_prompt_enhance import validate_base_fields\ncases=json.loads(sys.stdin.read())\nprint(json.dumps([validate_base_fields(t,m,d,'zh') for m,d,t in cases],ensure_ascii=False))\ntry: validate_base_fields(cases[2][2].replace('00:04.000','00:09.000'),'text_video',8,'zh')\nexcept ValueError: pass\nelse: raise AssertionError('cut after the duration accepted')`;
  const result=spawnSync('python',['-c',script],{encoding:'utf8',input:JSON.stringify(cases),env:{...process.env,PYTHONIOENCODING:'utf-8'}}); assert.equal(result.status,0,result.stderr);
  const python=JSON.parse(result.stdout);
  cases.forEach(([mode,durationSeconds,text],i)=>assert.equal(python[i],local.validateBaseFields(text,{mode,durationSeconds,language:'zh'})));
});

test('Grok defaults to Chinese and repairs English prose without changing literal dialogue',async()=>{
  const built=buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance',h3Mode:'I2VA',durationSeconds:10,currentPrompt:'角色缓慢抬起右手后放下。'});
  assert.equal(built.resultOptions.requireChineseOutput,true);
  for(const api of [local,edge]) {
    assert.equal(api.requiresChineseOutput('不要使用英文输出'),true);
    assert.equal(api.requiresChineseOutput('请用英文输出'),false);
    assert.equal(api.requiresChineseOutput(''),true);
  }
  const english={...fixture,description:'A silver robot stands quietly in a neon laboratory and slowly raises one hand.\n0-10s：The robot slowly lowers its right hand and returns to the opening pose.'};
  let calls=0;
  await callGrokResponseWithVisualRetry(built.body,built.inputMeta,built.resultOptions,async()=>{
    calls++;
    const prompt=normalizeMiniMaxH3PromptOutput(JSON.stringify(calls===1?english:chineseFixture),built.resultOptions);
    return {ok:true,data:{output_text:prompt},providerCallCount:1};
  });
  assert.equal(calls,2);
});

test('long source retains appended supplementary requirements in the Grok request',()=>{
  const source='蓝色机器人站立。'.repeat(1600);
  const requirement='镜头缓慢拉近，机器人抬起右手再放下。';
  const built=buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance',h3Mode:'T2VA',durationSeconds:3,currentPrompt:source,requirements:'Source prompt:\n'+source+'\n\n'+requirement});
  assert.ok(built.body.input[1].content[0].text.includes('requirements:\n'+requirement));
});

test('cloud schema and repair preserve five sections and real content checks',async()=>{
  const built=buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance',h3Mode:'I2VA',durationSeconds:10,currentPrompt:'机械女性抬眼后抬起右手，镜头推进。',visualSchema:'nf.h3.visual.v1',contentPolicy:{sensitiveVisualAnalysis:false,allSubjectsConfirmedAdult:false}});
  assert.deepEqual(built.body.text.format.schema.required,local.sectionFields);
  let calls=0;
  const result=await callGrokResponseWithVisualRetry(built.body,built.inputMeta,built.resultOptions,async body=>{
    calls++;
    if(calls===2) {assert.match(JSON.stringify(body),/【任务定位】/); assert.deepEqual(body.text.format.schema.required,local.sectionFields);}
    const prompt=normalizeMiniMaxH3PromptOutput(calls===1?'【任务定位】\n不完整':JSON.stringify(chineseFixture),built.resultOptions);
    return {ok:true,data:{output_text:prompt},providerCallCount:1};
  });
  const chineseFormatted=local.validateFormat(JSON.stringify(chineseFixture),options);
  assert.equal(calls,2); assert.equal(result.data.output_text,chineseFormatted);
  assert.throws(()=>normalizeMiniMaxH3PromptOutput(chineseFormatted,{...built.resultOptions,currentPrompt:chineseFormatted}),/复述/);
});

test('Grok retry receives the exact safe failed gate and final error retains reason and retry count',async()=>{
  const built=buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance',h3Mode:'FL2VA',durationSeconds:10,currentPrompt:'人物原地站立。',requirements:'Available resource labels: <Picture 1>, <Picture 2>',visualSchema:'nf.h3.visual.v1'});
  let calls=0;
  await assert.rejects(callGrokResponseWithVisualRetry(built.body,built.inputMeta,built.resultOptions,async body=>{
    calls++;
    if(calls===2) assert.ok(JSON.stringify(body).includes('参考媒体标签缺失或引用了未提供的媒体'));
    return normalizeMiniMaxH3PromptOutput(JSON.stringify(chineseFixture),built.resultOptions);
  }),error=>{
    const envelope=miniMaxH3FailureEnvelope(error);
    assert.equal(envelope.failureReason,'references');
    assert.equal(envelope.retryCount,1);
    assert.match(envelope.message,/参考媒体标签/);
    return true;
  });
  assert.equal(calls,2);
  const privateMessage='PRIVATE SOURCE '+JSON.stringify(chineseFixture);
  assert.equal(local.validationIssue(new Error(privateMessage)).reason,'contract_invalid');
  assert.ok(!JSON.stringify(miniMaxH3FailureEnvelope({errorCode:'h3_contract_five_sections',message:privateMessage})).includes('PRIVATE SOURCE'));
});

test('I2V/FL2V optimize sends the first/last frames to the local model and to Grok (768 px); T2V stays text-only', async()=>{
  const renderer=new URL('../../novaflow-web/renderer/',import.meta.url);
  const source=fs.readFileSync(new URL('novaflow-smart-ai.js',renderer),'utf8').replace(/\r\n/g,'\n');
  // One capture for both engines, and no fallback that swallows a failed capture.
  assert.match(source,/await captureH3ReferenceFrames\(state\.context\?\.miniMaxH3, miniMaxH3Prepared\)\n/);
  const start=source.indexOf('  async function captureH3ReferenceFrames(');
  const capture=source.slice(start,source.indexOf('\n  }\n',start)+4);
  const h3={console};h3.globalThis=h3;
  for(const file of ['h3-prompt-format.js','ai-sequence-minimax-h3-prompt.workflow.js']) vm.runInNewContext(fs.readFileSync(new URL(file,renderer),'utf8'),h3);
  const context=vm.createContext({
    Image:class{naturalWidth=1024;naturalHeight=512;async decode(){}},
    document:{createElement:()=>({getContext:()=>({fillRect(){},drawImage(){}}),toDataURL(){return `data:image/jpeg;base64,${this.width}x${this.height}`;}})},
    miniMaxH3ImageDataUrl:async src=>src,
    getMiniMaxH3PromptWorkflow:()=>h3.NovaFlowAiSequenceMiniMaxH3PromptWorkflow,
  });
  const captureH3ReferenceFrames=vm.runInContext(`(${capture.trim()})`,context);
  const slot=(key,name)=>({key,identity:name,occupied:true,kind:'image',fileName:name+'.png',mimeType:'image/png',previewUrl:'data:image/png;base64,'+name});
  const i2v={mode:'image_video',resources:[slot('first_frame','first')]};
  const fl2v={mode:'first_last',resources:[slot('first_frame','first'),slot('last_frame','last')]};
  const frames=async(...args)=>JSON.parse(JSON.stringify(await captureH3ReferenceFrames(...args)));
  assert.deepEqual(await frames(i2v,null),[{label:'<Picture 1>',dataUrl:'data:image/jpeg;base64,768x384'}]);
  // Grok and the local model see the same 768 px frames; the edge takes request bodies up to 10 MB.
  assert.deepEqual(await frames(fl2v,null),[{label:'<Picture 1>',dataUrl:'data:image/jpeg;base64,768x384'},{label:'<Picture 2>',dataUrl:'data:image/jpeg;base64,768x384'}]);
  assert.deepEqual(await frames({mode:'text_video',resources:[]},null),[]);
});

test('seconds abbreviation in the task is equivalent, mismatched duration remains invalid',()=>{
  for(const api of [local,edge]) {
    assert.match(api.validateFormat(formatted.replace('时长10秒','时长10s'),options),/时长10s/);
    assert.throws(()=>api.validateFormat(formatted.replace('时长10秒','时长3s'),options),/时长/);
  }
});
