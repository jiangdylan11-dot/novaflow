import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {buildGrokPromptOptimizeRequest, normalizeMiniMaxH3PromptOutput} from '../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
import * as edge from '../../supabase/functions/novaflow-backend/h3-prompt-enhance.mjs';
const require=createRequire(import.meta.url);
const local=require('../admin-server/h3-prompt-enhance.js');
const context={console};context.globalThis=context;context.window=context;
for(const f of ['h3-prompt-format.js','ai-sequence-minimax-h3-prompt.workflow.js','ai-sequence-minimax-h3.workflow.js']) vm.runInNewContext(fs.readFileSync(new URL('../../particle-editor/'+f,import.meta.url),'utf8'),context);
const prompt=context.NovaFlowAiSequenceMiniMaxH3PromptWorkflow;
const workflow=context.NovaFlowAiSequenceMiniMaxH3Workflow;
const fixture={
 subject_definitions:'<Subject 1> is the dollar coin from <Picture 1>, with its engraved dollar sign and gold rim; its rotation follows <Video 1>.\n<Video 1> is the source video containing the mask-emblem coin to replace.\n<Audio 1> supplies the complete target soundtrack.',
 summary:'[video editing + reference generation + audio reuse] The target video is an edited version of <Video 1>. Replace the mask coin with <Subject 1> and reuse <Audio 1>.',
 retention_analysis:'<Subject 1> (appears in [Shot 1]): fully_preserved - dollar sign and gold rim from the image remain.\n<Video 1> (source edit): partially_preserved - retain rotation and framing; remove the mask design.\n<Audio 1>: fully_copy - the supplied track is the target soundtrack.',
 detailed_description:'A stylized gold coin animation. [Shot 1] <Subject 1> begins at the center of the green frame. The camera remains static. The coin then rotates around its vertical axis following <Video 1>, revealing its rim before returning to its initial pose at 3 seconds. Its dollar sign remains unchanged. <Audio 1> plays throughout; there is no dialogue.',
 overall_soundscape:'N/A',non_diegetic_music:'The complete music track from <Audio 1>.'
};
const resources=['image','video','audio'].map((kind,i)=>({key:'multi_ref_'+kind+'_1',kind,identity:kind,occupied:true,fileName:kind+['.png','.mp4','.wav'][i],mimeType:kind+'/'+['png','mp4','wav'][i]}));
const current={modelId:'minimax_h3_local',mode:'multi_reference',durationSeconds:3,prompt:'Replace the mask coin with the dollar coin; reuse the audio.',resources};
const options={mode:'multi_reference',durationSeconds:3,requirements:'Available resource labels: <Picture 1>; <Video 1>; <Audio 1>\nH3 response format: bilingual-v1'};
const text=local.validateReference(JSON.stringify(fixture),options);

test('video editing may preserve its camera in the source-video retention rule',()=>{
 const prepared=prompt.prepareRequest(current);
 const candidate={...fixture,
  detailed_description:fixture.detailed_description.replace('The camera remains static. ',''),
  retention_analysis:fixture.retention_analysis.replace('retain rotation and framing','retain rotation, camera and framing')};
 assert.doesNotThrow(()=>prompt.validateAndRestore({text:JSON.stringify(candidate),context:prepared.context,current}));
 candidate.retention_analysis=fixture.retention_analysis.replace('dollar sign and gold rim from the image remain','preserve the camera and dollar sign');
 assert.doesNotThrow(()=>prompt.validateAndRestore({text:JSON.stringify(candidate),context:prepared.context,current}));
});

test('reference contract preserves a silent object, video edit and separate audio reuse across JS and Python',()=>{
 for(const api of [local,edge,context.NovaFlowH3PromptFormat])assert.equal(api.validateReference(text,options),text);
 const py=spawnSync('python',['-c',"import json,sys;sys.path.insert(0,'particle-editor-desktop');from prompt_assistant.h3_prompt_enhance import validate_reference;d=json.load(sys.stdin);print(validate_reference(d['text'],d['requirements'],3))"],{input:JSON.stringify({text,requirements:options.requirements}),encoding:'utf8',cwd:new URL('../../',import.meta.url),env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.equal(py.status,0,py.stderr);assert.equal(py.stdout.replace(/\r\n/g,'\n').trim(),text);
});
test('multireference optimizer uses official fields, including explicit audio and video roles',()=>{
 const prepared=prompt.prepareRequest(current);
 assert.match(prepared.requirements,/video editing \+ reference generation/);
 assert.doesNotMatch(prepared.requirements,/Return exactly these five sections/);
 const restored=prompt.validateAndRestore({text,context:prepared.context,current});
 assert.match(restored.text,/@参考图1/);assert.match(restored.modelText,/<Subject 1>/);
 assert.doesNotMatch(restored.modelText,/无说话者/);
 const built=buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance',h3Mode:'multi_reference',durationSeconds:3,prompt:current.prompt,requirements:options.requirements+'\nWrite in English.',visualSchema:'nf.h3.visual.v1'});
 assert.deepEqual(built.body.text.format.schema.required,['modelPrompt','displayPrompt']);
 assert.deepEqual(built.body.text.format.schema.properties.modelPrompt.required,local.referenceFields);
 const legacy=buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance',h3Mode:'multi_reference',durationSeconds:3,prompt:current.prompt,requirements:options.requirements.replace('\nH3 response format: bilingual-v1',''),visualSchema:'nf.h3.visual.v1'});
 assert.deepEqual(legacy.body.text.format.schema.required,local.referenceFields);
 assert.equal(legacy.resultOptions.requireChineseOutput,false);
 assert.equal(normalizeMiniMaxH3PromptOutput(JSON.stringify(fixture),built.resultOptions),text);
});
test('missing media, invented speaker identities and invalid retention fail before sampling',()=>{
 for(const api of [local,edge]){
  for(const bad of [text.replaceAll('<Picture 1>','<Picture 2>'),text.replace('<Subject 1> is','<Subject 2> is'),text.replace('fully_copy','fully_preserved'),text.replace('The target video is an edited version of <Video 1>.','Copy the video.')])assert.throws(()=>api.validateReference(bad,options));
 }
});
test('generation compiles old/free text once and preserves valid reference prompts without another provider call',async()=>{
 let calls=0;const result=await prompt.compileForGeneration(current,async payload=>{calls++;assert.equal(payload.h3Mode,'multi_reference');return text});
 assert.equal(result.modelText.replace(/\s+/g,' '),text.replace(/\s+/g,' '));assert.equal(calls,1);
 await prompt.compileForGeneration({...current,prompt:text},async()=>{throw Error('must not recompile')});
 await assert.rejects(prompt.compileForGeneration(current,async()=> '【任务定位】\nold output'),/六个参考字段/);
});
test('full audio reuse really connects the input track; timbre/style references use generated audio',()=>{
 const params={mode:'r2v',prompt:text,referenceImages:['coin.png'],referenceVideo:'spin.mp4',referenceAudio:'music.wav',durationSeconds:3,seed:1};
 const copy=workflow.buildWorkflow(params);
 const find=(g,klass)=>Object.entries(g).find(([,n])=>n.class_type===klass);
 assert.deepEqual(Array.from(find(copy,'CreateVideo')[1].inputs.audio),[find(copy,'TrimAudioDuration')[0],0]);
 assert.deepEqual(Array.from(find(copy,'TrimAudioDuration')[1].inputs.audio),[find(copy,'LoadAudio')[0],0]);
 assert.equal(find(copy,'TrimAudioDuration')[1].inputs.duration,73/24);
 assert.equal(find(copy,'VAEDecodeAudio'),undefined);
 assert.equal(workflow.validateWorkflow(copy),true);
 const style=workflow.buildWorkflow({...params,prompt:text.replace('audio reuse','audio reference').replace('fully_copy','reference')});
 assert.deepEqual(Array.from(find(style,'CreateVideo')[1].inputs.audio),[find(style,'VAEDecodeAudio')[0],0]);
 assert.ok(find(style,'MiniMaxH3ReferenceToVideo')[1].inputs['ref_audios.ref_audio_0']);
 const repatched=workflow.patchWorkflow(copy,{...params,prompt:style[find(style,'MiniMaxH3ReferenceToVideo')[0]].inputs.prompt});
 assert.equal(find(repatched,'TrimAudioDuration'),undefined);
 assert.equal(workflow.validateWorkflow(repatched),true);
 assert.throws(()=>workflow.buildWorkflow({...params,referenceAudio:undefined}),/声音参考/);
 const background=workflow.buildWorkflow({...params,prompt:text.replace('Replace the mask coin with <Subject 1>', 'Replace the background with a forest behind <Subject 1>')});
 assert.equal(find(background,'NovaFlowH3PrepareMotionReference'),undefined);
 assert.equal(find(background,'NovaFlowH3MatchReferenceLayout'),undefined);
 const layout=find(copy,'NovaFlowH3MatchReferenceLayout');
 assert.deepEqual(Array.from(find(copy,'CreateVideo')[1].inputs.images),[layout[0],0]);
 assert.deepEqual(Array.from(layout[1].inputs.images),[find(copy,'VAEDecode')[0],0]);
 const changed=workflow.patchWorkflow(copy,{...params,prompt:text.replace('Replace the mask coin with <Subject 1>', 'Replace the background with a forest behind <Subject 1>')});
 assert.equal(find(changed,'NovaFlowH3MatchReferenceLayout'),undefined);
 assert.deepEqual(Array.from(find(changed,'CreateVideo')[1].inputs.images),[find(changed,'VAEDecode')[0],0]);
 assert.equal(find(background,'NovaFlowH3PrepareReferenceImage')[1].inputs.preserve_video_layout,false);
});

test('real video frames reach Grok with labels and timestamps rather than becoming extra references',()=>{
 const media=[{label:'<Picture 1>',dataUrl:'data:image/png;base64,YQ=='},{label:'<Video 1>',timeSeconds:0,dataUrl:'data:image/jpeg;base64,Yg=='},{label:'<Video 1>',timeSeconds:1.5,dataUrl:'data:image/jpeg;base64,Yw=='}];
 const built=buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance',h3Mode:'multi_reference',durationSeconds:3,prompt:current.prompt,requirements:options.requirements,h3ReferenceFrames:media});
 assert.equal(built.inputMeta.imageCount,3);
 assert.equal(built.body.input[1].content.filter(x=>x.type==='input_image').length,3);
 assert.match(JSON.stringify(built.body.input[1]),/<Video 1> video frame at 1.500 seconds/);
 assert.throws(()=>local.referenceFrames([...media,media[1]],options.requirements),/帧时间/);
 assert.throws(()=>local.referenceFrames([{...media[0],label:'<Picture 2>'}],options.requirements),/素材不匹配/);
 assert.throws(()=>local.referenceFrames([{...media[0],dataUrl:'https://example.org/secret.png'}],options.requirements),/素材不匹配/);
});

test('editor and generator bind translations to the same media bytes, independent of DOM IDs',()=>{
 const a={...current,resources:resources.slice(0,2).map((r,i)=>({...r,identity:'dom-'+i,previewUrl:'data:media,'+i}))};
 const b={...current,resources:a.resources.map((r,i)=>({...r,identity:'runtime-'+i,fileName:'uploaded-'+i}))};
 assert.equal(prompt.createPromptSnapshot(a).fingerprint,prompt.createPromptSnapshot(b).fingerprint);
 b.resources[0].previewUrl+='changed';
 assert.notEqual(prompt.createPromptSnapshot(a).fingerprint,prompt.createPromptSnapshot(b).fingerprint);
});

test('local relationship rendering accepts lists, resolves edit retention and closes only requested loops',()=>{
 const plan={references:[{label:'<Subject 1>',sources:['<Picture 1>'],description:'the gold dollar coin',relation:'fully_preserved',keep:['dollar sign','gold rim']},{label:'<Video 1>',sources:[],description:'the rotation video',relation:'fully_preserved',keep:'rotation and green background'}],tasks:['video editing','reference generation'],summary:'Replace the mask coin with the dollar coin.',description:'The camera remains static while <Subject 1> rotates following <Video 1>.',soundscape:'N/A',music:'N/A'};
 const py=spawnSync('python',['-c',"import json,sys;sys.path.insert(0,'particle-editor-desktop');from prompt_assistant.h3_prompt_enhance import render_reference_plan;print(render_reference_plan(sys.stdin.read(),'Available resource labels: <Picture 1>; <Video 1>',3,'loop'))"],{input:JSON.stringify(plan),encoding:'utf8',cwd:new URL('../../',import.meta.url),env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.equal(py.status,0,py.stderr);
 assert.match(py.stdout,/<Video 1>: partially_preserved/);
 assert.match(py.stdout,/回到起始姿态与运动相位/);
 assert.match(py.stdout,/dollar sign; gold rim/);
});

const chinese = {
 subject_definitions:'<Subject 1>：参考图中的完整主体，外观来自 <Picture 1>，运动来自 <Video 1>。\n<Video 1>：需要替换金币的源视频。',
 summary:'[video editing + reference generation] 目标视频是 <Video 1> 的编辑版本。把原视频中的金币换成 <Subject 1>。',
 retention_analysis:'<Subject 1>: attribute_transfer - 保留参考图的完整外观。\n<Video 1>: partially_preserved - 保留背景、构图、动作速度及方向。',
 detailed_description:'[Shot 1] 0秒起，<Subject 1> 按照原金币轨迹在画面中运动，3秒结束时保持原相机构图和相位。',
 overall_soundscape:'N/A',non_diegetic_music:'N/A'
};
const chineseOptions={...options,requirements:'Available resource labels: <Picture 1>; <Video 1>',requireChineseOutput:true};
const english={
 subject_definitions:'<Subject 1> is the complete replacement from <Picture 1>, with motion from <Video 1>.\n<Video 1> is the source video containing the coin to replace.',
 summary:'[video editing + reference generation] The target video is an edited version of <Video 1>. Replace the original coin with <Subject 1>.',
 retention_analysis:'<Subject 1>: attribute_transfer - Keep the complete image appearance.\n<Video 1>: partially_preserved - Keep background, framing, motion speed and direction.',
 detailed_description:'[Shot 1] At zero seconds <Subject 1> follows the original coin trajectory. The camera follows the source camera and reaches its original composition and phase at 3 seconds.',
 overall_soundscape:'N/A',non_diegetic_music:'N/A'
};
test('bilingual results reject stale roles and untranslated model prose',()=>{
 assert.throws(()=>local.validateReferenceResult(JSON.stringify({modelPrompt:chinese,displayPrompt:chinese}),chineseOptions),/模型侧.*英文/);
 assert.throws(()=>local.validateReferenceResult(JSON.stringify({modelPrompt:english,displayPrompt:{...chinese,retention_analysis:chinese.retention_analysis.replace('attribute_transfer','weak_reference')}}),chineseOptions),/素材关系不一致/);
 assert.throws(()=>local.validateReferenceResult(JSON.stringify({modelPrompt:english,displayPrompt:{...chinese,subject_definitions:chinese.subject_definitions.replace('，运动来自 <Video 1>','')}}),chineseOptions),/素材关系不一致/);
});
test('Chinese editor uses English generation text and recompiles changed instructions',async()=>{
 const c={...current,prompt:'把参考视频中的金币换成参考图1',resources:resources.slice(0,2)};
 const r=await prompt.compileForGeneration(c,async()=>local.validateReferenceResult(JSON.stringify({modelPrompt:english,displayPrompt:chinese}),chineseOptions));
 assert.match(r.text,/【主体定义】/);assert.match(r.text,/@参考图1/);assert.match(r.text,/部分保留/);
 assert.doesNotMatch(r.text,/subject_definitions|attribute_transfer|The target video/);
 await prompt.compileForGeneration({...c,prompt:r.text},()=>{throw Error('unchanged translation should be reused')});
 let translated=0;
 const again=await prompt.compileForGeneration({...c,prompt:r.text.replace('原金币轨迹','原金币轨迹和旋转方向')},()=>{translated++;return JSON.stringify({modelPrompt:{...english,detailed_description:english.detailed_description.replace('original coin trajectory','original coin trajectory and rotation direction')},displayPrompt:{...chinese,detailed_description:chinese.detailed_description.replace('原金币轨迹','原金币轨迹和旋转方向')}})});
 assert.equal(translated,1);assert.match(again.modelText,/trajectory and rotation direction/);assert.doesNotMatch(again.modelText,/[\u3400-\u9fff]/);assert.match(again.text,/轨迹和旋转方向/);
 assert.throws(()=>local.validateReference(text,{...options,requireChineseOutput:true}),/简体中文/);
 const built=buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance',h3Mode:'multi_reference',durationSeconds:3,prompt:c.prompt,requirements:chineseOptions.requirements,visualSchema:'nf.h3.visual.v1'});
 assert.doesNotMatch(JSON.stringify(built.body),/胸肩随呼吸/);
});
test('replacement syntax cannot erase direction cues from the source video',()=>{
 for(const summary of [
  '[video editing + reference generation] The target video is an edited version of <Video 1>. Gold coins are replaced throughout by <Subject 1>.',
  '[video editing + reference generation] The target video is an edited version of <Video 1>. 把原视频中的金币换成 <Subject 1>。'
 ]) {
  const modelText=local.validateReference(JSON.stringify({...chinese,summary}),chineseOptions);
  const g=workflow.buildWorkflow({mode:'r2v',prompt:modelText,referenceImages:['cat.png'],referenceVideo:'spin.mp4',durationSeconds:3,seed:1});
  const find=klass=>Object.entries(g).find(([,n])=>n.class_type===klass);
  assert.deepEqual(Array.from(find('NovaFlowH3PrepareMotionReference')[1].inputs.images),[find('GetVideoComponents')[0],0]);
  assert.deepEqual(Array.from(find('MiniMaxH3ReferenceToVideo')[1].inputs['ref_videos.ref_video_0']),[find('NovaFlowH3PrepareMotionReference')[0],0]);
  assert.equal(find('NovaFlowH3PrepareReferenceImage')[1].inputs.preserve_video_layout,false);
 }
});
test('local source labels normalize common spellings and reject invented sources',()=>{
 const py=spawnSync('python',['-c',`import sys;sys.path.insert(0,'particle-editor-desktop')
from prompt_assistant.h3_prompt_enhance import reference_label
for label in ['Picture1','<Image 1>','@参考图1','参考视频','multi_ref_image_1']:
 print(reference_label(label))
try: reference_label('coin.png')
except ValueError: pass
else: raise AssertionError('filename is not an asset label')`],{encoding:'utf8',cwd:new URL('../../',import.meta.url),env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.equal(py.status,0,py.stderr);assert.equal(py.stdout.replace(/\r/g,'').trim(),'<Picture 1>\n<Picture 1>\n<Picture 1>\n<Video 1>\n<Picture 1>');
});

test('a real wardrobe-edit response inherits source action without matching a motion keyword list',()=>{
 const input={...current,prompt:'给视频中的人物换成深蓝色长袖牛仔外套和长裤，脸、头发、动作和背景保持原样。',durationSeconds:4,resources:resources.filter(r=>r.kind==='video')};
 const prepared=prompt.prepareRequest(input);
 const response=fs.readFileSync(new URL('./fixtures/h3-wardrobe-response.json',import.meta.url),'utf8');
 const result=prompt.validateAndRestore({text:response,context:prepared.context,current:input});
 assert.match(result.text,/深蓝色.*牛仔/);
 assert.match(result.modelText,/deep blue.*denim/);
 assert.match(result.modelText,/<Video 1>/);
});

test('compiler merges a model subject repeated for appearance and motion without changing its meaning',()=>{
 const duplicated={...english,
  subject_definitions:'<Subject 1> appearance from <Picture 1>\n<Subject 1> motion from <Video 1>\n<Video 1> source clip',
  retention_analysis:'<Picture 1>: attribute_transfer - apply the image design to <Subject 1>.\n<Video 1>: partially_preserved - preserve source background, camera and motion.'};
 const zh={...chinese,
  subject_definitions:'<Subject 1> 外观来自 <Picture 1>\n<Subject 1> 动作来自 <Video 1>\n<Video 1> 源视频',
  retention_analysis:'<Picture 1>: attribute_transfer - 将图片外观应用于 <Subject 1>。\n<Video 1>: partially_preserved - 保留原视频背景、镜头和动作。'};
 for(const api of [local,edge,context.NovaFlowH3PromptFormat]) {
  const pair=JSON.parse(api.validateReferenceResult('```json\n'+JSON.stringify({modelPrompt:duplicated,displayPrompt:zh})+'\n```',chineseOptions));
  assert.equal((pair.modelPrompt.split('summary:')[0].match(/^<Subject 1>/gm)||[]).length,1);
  assert.match(pair.modelPrompt,/<Subject 1>: attribute_transfer/);
  assert.match(pair.modelPrompt,/motion from <Video 1>/);
 }
});

test('blank unrequested audio and an omitted source-video row compile without inventing content',()=>{
 const model={...english,overall_soundscape:'',non_diegetic_music:''};
 const display={...chinese,overall_soundscape:'',non_diegetic_music:''};
 model.subject_definitions=model.subject_definitions.split('\n')[0];
 display.subject_definitions=display.subject_definitions.split('\n')[0];
 for(const api of [local,edge,context.NovaFlowH3PromptFormat]) {
  const result=JSON.parse(api.validateReferenceResult(JSON.stringify({modelPrompt:model,displayPrompt:display}),chineseOptions));
  assert.match(result.modelPrompt,/overall_soundscape:\nN\/A/);
  assert.match(result.displayPrompt,/<Video 1> [：:]本次编辑的源视频/);
  assert.throws(()=>api.validateReferenceResult(JSON.stringify({modelPrompt:model,displayPrompt:display}),{...chineseOptions,currentPrompt:'保留原有音乐'}),/六个参考字段/);
  assert.throws(()=>api.validateReferenceResult(JSON.stringify({modelPrompt:{...model,summary:''},displayPrompt:display}),chineseOptions),/六个参考字段/);
 }
});

test('local model owns intent while Python compiles omitted relation enums and source-video bindings',()=>{
 const plan={references:[{label:'<Subject 1>',sources:['<Picture 1>'],description:'参考图的猫脸金币',keep:'图片外观'}],tasks:['video editing'],summary:'将 <Video 1> 中的旋转金币外观替换成参考图的样式，背景和轨迹保持原样。',description:'从第一帧起 <Subject 1> 已使用图片样式，持续沿用 <Video 1> 原金币方向、速度和运动轨迹，镜头和背景保持不变。',soundscape:'N/A',music:'N/A'};
 const py=spawnSync('python',['-c',`import json,sys;sys.path.insert(0,'particle-editor-desktop')
from prompt_assistant.h3_prompt_enhance import render_reference_plan
p=json.load(sys.stdin)
r='Available resource labels: <Picture 1>; <Video 1>'
out=render_reference_plan(json.dumps(p,ensure_ascii=False),r,3)
assert '<Subject 1>: attribute_transfer' in out
assert '<Video 1>: partially_preserved' in out
assert '[video editing + reference generation]' in out
assert p['description'] in out
p['summary']=p['summary'].replace('<Video 1>', '原视频')
p['description']=p['description'].replace('<Video 1>', '原视频')
assert '<Video 1>: partially_preserved' in render_reference_plan(json.dumps(p),r,3)
p['references'][0]['sources']=['<Picture 2>']
try: render_reference_plan(json.dumps(p),r,3)
except ValueError: pass
else: raise AssertionError('invented reference was accepted')
print(out)`],{input:JSON.stringify(plan),encoding:'utf8',cwd:new URL('../../',import.meta.url),env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.equal(py.status,0,py.stderr);
 assert.doesNotThrow(()=>local.validateReference(py.stdout,chineseOptions));
 const service=fs.readFileSync(new URL('../prompt-assistant-service.py',import.meta.url),'utf8');
 assert.doesNotMatch(service,/compile_h3_explicit_replacement|explicit-reference-edit/);
});
