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
for(const f of ['h3-prompt-format.js','ai-sequence-minimax-h3-prompt.workflow.js','ai-sequence-minimax-h3.workflow.js']) vm.runInNewContext(fs.readFileSync(new URL('../../novaflow-web/renderer/'+f,import.meta.url),'utf8'),context);
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
 assert.match(prepared.requirements,/For video editing/);
 assert.doesNotMatch(prepared.requirements,/Return exactly these five sections/);
 const restored=prompt.validateAndRestore({text,context:prepared.context,current});
 assert.match(restored.text,/@参考图1/);assert.match(restored.modelText,/<Subject 1>/);
 assert.doesNotMatch(restored.modelText,/无说话者/);
 const built=buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance',h3Mode:'multi_reference',durationSeconds:3,prompt:current.prompt,requirements:options.requirements+'\nWrite in English.',visualSchema:'nf.h3.visual.v1'});
 assert.deepEqual(built.body.text.format.schema.required,['modelPrompt','displayPrompt','editPolicy']);
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
test('uploads decide the task list: a picture-only inventory never demands a source video',()=>{
 const pictureOnly={
  subject_definitions:'<Subject 1> is the character from <Picture 1>, keeping her face and hairstyle.',
  summary:'[video editing + reference generation + audio reuse] The character repeats a quick back-and-forth motion for 3 seconds.',
  retention_analysis:'<Subject 1>: fully_preserved - face and hairstyle from the image remain.',
  detailed_description:'[Shot 1] <Subject 1> stands at the center and repeats the motion, returning to the starting pose at 3 seconds. The camera remains static.',
  overall_soundscape:'N/A',non_diegetic_music:'N/A'};
 const pictureOptions={mode:'multi_reference',durationSeconds:3,requirements:'Available resource labels: <Picture 1>'};
 for(const api of [local,edge,context.NovaFlowH3PromptFormat]){
  const compiled=api.validateReference(JSON.stringify(pictureOnly),pictureOptions);
  assert.match(compiled,/\nsummary:\n\[reference generation\] The character/);
 }
 // With a video uploaded the edit stays available and still needs its source binding.
 assert.throws(()=>local.validateReference(JSON.stringify(pictureOnly),{...pictureOptions,requirements:'Available resource labels: <Picture 1>; <Video 1>'}),/源视频/);
});
test('a bound editor alias echoed in a multi-reference result binds to its protocol token instead of failing generation',async()=>{
 const echoed=text.replace('<Subject 1> is the dollar coin from <Picture 1>','<Subject 1> is the dollar coin from @参考图1');
 const result=await prompt.compileForGeneration(current,async()=>echoed);
 assert.match(result.modelText,/from <Picture 1>/);assert.doesNotMatch(result.modelText,/@参考图/);
 // An answer that cannot be bound never reaches H3; the prompt goes out as written.
 const unbound=await prompt.compileForGeneration(current,async()=>text.replace('<Picture 1>','@参考图3'));
 assert.equal(unbound.asWritten,true);assert.doesNotMatch(unbound.modelText,/@参考图3/);
});
test('generation compiles free text and upgrades legacy video edits with missing processing controls',async()=>{
 let calls=0;const result=await prompt.compileForGeneration(current,async payload=>{calls++;assert.equal(payload.h3Mode,'multi_reference');assert.doesNotMatch(payload.requirements,/H3 compile: translate-only/);return text});
 assert.equal(result.modelText.replace(/\s+/g,' '),text.replace(/\s+/g,' '));assert.equal(calls,1);
 // An English legacy video edit is a creative compile (it fills the edit controls from the frames), never translate-only.
 await prompt.compileForGeneration({...current,prompt:text},async payload=>{calls++;assert.match(payload.prompt,/subject_definitions:/);assert.doesNotMatch(payload.requirements,/H3 compile: translate-only/);return text});
 assert.equal(calls,2);
 const old=await prompt.compileForGeneration(current,async()=> '【任务定位】\nold output');
 assert.equal(old.asWritten,true);assert.doesNotMatch(old.modelText,/【任务定位】|old output/);
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
 assert.equal(find(copy,'NovaFlowH3MatchReferenceLayout'),undefined);
 const explicit=workflow.buildWorkflow({...params,referencePreprocessing:'isolated_sprite_motion'});
 const layout=find(explicit,'NovaFlowH3MatchReferenceLayout');
 assert.deepEqual(Array.from(find(explicit,'CreateVideo')[1].inputs.images),[layout[0],0]);
 assert.deepEqual(Array.from(layout[1].inputs.images),[find(copy,'VAEDecode')[0],0]);
 const changed=workflow.patchWorkflow(explicit,{...params,prompt:text.replace('Replace the mask coin with <Subject 1>', 'Replace the background with a forest behind <Subject 1>')});
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

test('local relationship rendering retains role fidelity and closes only requested loops',()=>{
 const plan={references:[{label:'<Subject 1>',sources:['<Picture 1>'],description:'the gold dollar coin',relation:'fully_preserved',keep:['dollar sign','gold rim']},{label:'<Video 1>',sources:[],description:'the rotation video',relation:'fully_preserved',keep:'rotation and green background'}],tasks:['video editing','reference generation'],summary:'Replace the mask coin with the dollar coin.',description:'The camera remains static while <Subject 1> rotates following <Video 1>.',soundscape:'N/A',music:'N/A'};
 const py=spawnSync('python',['-c',"import json,sys;sys.path.insert(0,'particle-editor-desktop');from prompt_assistant.h3_prompt_enhance import render_reference_plan;print(render_reference_plan(sys.stdin.read(),'Available resource labels: <Picture 1>; <Video 1>',3,'loop'))"],{input:JSON.stringify(plan),encoding:'utf8',cwd:new URL('../../',import.meta.url),env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.equal(py.status,0,py.stderr);
 assert.match(py.stdout,/<Video 1>: fully_preserved/);
 assert.match(py.stdout,/<Subject 1>: fully_preserved/);
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
 // The generator compiles the mentions first (@参考图1 -> <Picture 1>); the cache is keyed on that model-token text.
 await prompt.compileForGeneration({...c,prompt:r.text.replace(/@参考图1/g,'<Picture 1>')},()=>{throw Error('compiled mentions should reuse the translation')});
 let translated=0;
 const again=await prompt.compileForGeneration({...c,prompt:r.text.replace('原金币轨迹','原金币轨迹和旋转方向')},payload=>{translated++;assert.match(payload.requirements,/\nH3 compile: translate-only\nSource prompt:\n/);return JSON.stringify({modelPrompt:{...english,detailed_description:english.detailed_description.replace('original coin trajectory','original coin trajectory and rotation direction')},displayPrompt:{...chinese,detailed_description:chinese.detailed_description.replace('原金币轨迹','原金币轨迹和旋转方向')}})});
 assert.equal(translated,1);assert.match(again.modelText,/trajectory and rotation direction/);assert.doesNotMatch(again.modelText,/[\u3400-\u9fff]/);assert.match(again.text,/轨迹和旋转方向/);
 assert.throws(()=>local.validateReference(text,{...options,requireChineseOutput:true}),/简体中文/);
 const built=buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance',h3Mode:'multi_reference',durationSeconds:3,prompt:c.prompt,requirements:chineseOptions.requirements,visualSchema:'nf.h3.visual.v1'});
 assert.doesNotMatch(JSON.stringify(built.body),/胸肩随呼吸/);
});
test('natural-language edits preserve native source pixels and decoded output regardless of replacement wording',()=>{
 for(const summary of [
  '[video editing + reference generation] The target video is an edited version of <Video 1>. Gold coins are replaced throughout by <Subject 1>.',
  '[video editing + reference generation] The target video is an edited version of <Video 1>. 把原视频中的金币换成 <Subject 1>。',
  '[video editing + reference generation] The target video is an edited version of <Video 1>. Replace the white dress with a red dress on <Subject 1>.',
  '[video editing + reference generation] The target video is an edited version of <Video 1>. Replace the flames with icy frost around <Subject 1>.'
 ]) {
  const modelText=local.validateReference(JSON.stringify({...chinese,summary}),{...chineseOptions,requireChineseOutput:false});
  const g=workflow.buildWorkflow({mode:'r2v',prompt:modelText,referenceImages:['cat.png'],referenceVideo:'spin.mp4',durationSeconds:3,seed:1});
  const find=klass=>Object.entries(g).find(([,n])=>n.class_type===klass);
  assert.equal(find('NovaFlowH3PrepareMotionReference'),undefined);
  assert.equal(find('NovaFlowH3MatchReferenceLayout'),undefined);
  assert.deepEqual(Array.from(find('MiniMaxH3ReferenceToVideo')[1].inputs['ref_videos.ref_video_0']),[find('NovaFlowH3ReferenceVideoFrames')[0],0]);
  assert.deepEqual(Array.from(find('NovaFlowH3ReferenceVideoFrames')[1].inputs.source_fps),[find('GetVideoComponents')[0],2]);
  assert.deepEqual(Array.from(find('CreateVideo')[1].inputs.images),[find('VAEDecode')[0],0]);
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
test('a source-only edit binds the model-authored target when its Subject bookkeeping row is omitted',()=>{
 const plan={references:[{label:'<Video 1>',sources:[],description:'金币在原始绿色背景上旋转',keep:'保留金币外观和运动，只改背景为紫色'}],tasks:['video editing'],summary:'将原视频背景改为紫色，金币外观和动作不变',description:'<Subject 1>在紫色背景中央沿用原视频的动作旋转。',soundscape:'N/A',music:'N/A'};
 const py=spawnSync('python',['-c',"import sys,json;sys.path.insert(0,'particle-editor-desktop');from prompt_assistant.h3_prompt_enhance import render_reference_plan;print(render_reference_plan(sys.stdin.read(),'Available resource labels: <Video 1>',3))"],{input:JSON.stringify(plan),encoding:'utf8',cwd:new URL('../../',import.meta.url),env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.equal(py.status,0,py.stderr);
 assert.match(py.stdout,/<Subject 1>[^\n]*紫色[^\n]*<Video 1>/);
 assert.doesNotMatch(py.stdout,/<Picture/);
 assert.doesNotThrow(()=>local.validateReference(py.stdout,{...options,requirements:'Available resource labels: <Video 1>'}));
});
test('unused uploads do not reject an edit or condition it; selected picture IDs stay bound',()=>{
 const videoOnly=Object.fromEntries(Object.entries(fixture).map(([k,v])=>[k,v.replaceAll('<Picture 1>','<Video 1>').replaceAll('<Audio 1>','<Video 1>').replaceAll('audio reuse','video editing').replaceAll('fully_copy','fully_preserved')]));
 videoOnly.subject_definitions='<Subject 1> is the original coin from <Video 1>.';
 videoOnly.retention_analysis='<Subject 1>: fully_preserved - coin artwork remains.';
 const edited=local.validateReference(JSON.stringify(videoOnly),options);
 const prepared=prompt.prepareRequest(current);
 assert.doesNotThrow(()=>prompt.validateAndRestore({text:edited,context:prepared.context,current}));
 const params={mode:'r2v',prompt:edited,referenceImages:['unused.png'],referenceVideo:'source.mp4',referenceAudio:'unused.wav',durationSeconds:3};
 const g=workflow.buildWorkflow(params);
 assert.equal(Object.values(g).some(n=>n.class_type==='LoadImage'||n.class_type==='LoadAudio'),false);
 assert.equal(workflow.validateWorkflow(g),true);
 const picture2=text.replaceAll('<Picture 1>','<Picture 2>');
 const selected=workflow.buildWorkflow({...params,prompt:picture2,referenceImages:['unused.png','selected.png'],referenceAudio:'music.wav'});
 assert.deepEqual(Array.from(Object.values(selected).filter(n=>n.class_type==='LoadImage').map(n=>n.inputs.image)),['selected.png']);
 const c=Object.values(selected).find(n=>n.class_type==='MiniMaxH3ReferenceToVideo').inputs;
 assert.match(c.prompt,/<Picture 1>/);assert.doesNotMatch(c.prompt,/<Picture 2>/);
 assert.equal(workflow.validateWorkflow(selected),true);
 const py=spawnSync('python',['-c',"import sys,json;sys.path.insert(0,'particle-editor-desktop');from prompt_assistant.h3_prompt_enhance import validate_reference;d=json.load(sys.stdin);validate_reference(d['text'],d['requirements'],3)"],{input:JSON.stringify({text:edited,requirements:options.requirements}),encoding:'utf8',cwd:new URL('../../',import.meta.url)});
 assert.equal(py.status,0,py.stderr);
});

test('AI edit controls survive Chinese writeback and cache, and govern preprocessing independently of prose',async()=>{
 const input={...current,prompt:'把金币样式换成参考图，背景和旋转照原片。',resources:resources.slice(0,2)};
 const editPolicy={preserveBackground:true,preserveMotion:true,sameShapeAppearanceOnly:true};
 const result=await prompt.compileForGeneration(input,async()=>JSON.stringify({modelPrompt:english,displayPrompt:chinese,editPolicy}));
 assert.equal(result.referenceEditPolicy.preserveBackground,true);
 assert.doesNotMatch(result.text,/editPolicy|sameShapeAppearanceOnly/);
 const cached=await prompt.compileForGeneration({...input,prompt:result.text},()=>{throw Error('same media and text should retain controls')});
 const originalCached=await prompt.compileForGeneration(input,()=>{throw Error('unchanged original request should also retain controls')});
 assert.deepEqual({...originalCached.referenceEditPolicy},editPolicy);
 assert.equal(cached.referenceEditPolicy.sameShapeAppearanceOnly,true);
 const params={mode:'r2v',prompt:result.modelText,referenceImages:['coin.png'],referenceVideo:'spin.mp4',durationSeconds:3,seed:1};
 const has=(g,klass)=>Object.values(g).some(n=>n.class_type===klass);
 const whole=workflow.buildWorkflow({...params,referenceEditPolicy:cached.referenceEditPolicy});
 assert.equal(has(whole,'NovaFlowH3PrepareMotionReference'),true);
 assert.equal(has(whole,'NovaFlowH3RestoreReferenceBackground'),true);
 const clothes=workflow.buildWorkflow({...params,referenceEditPolicy:{...editPolicy,sameShapeAppearanceOnly:false}});
 assert.equal(has(clothes,'NovaFlowH3PrepareMotionReference'),false);
 assert.equal(has(clothes,'NovaFlowH3MatchReferenceLayout'),false);
 assert.equal(has(clothes,'NovaFlowH3RestoreReferenceBackground'),true);
 const background=workflow.buildWorkflow({...params,referenceEditPolicy:{...editPolicy,preserveBackground:false}});
 assert.equal(has(background,'NovaFlowH3PrepareMotionReference'),false);
 assert.equal(has(background,'NovaFlowH3RestoreReferenceBackground'),false);
 const legacy=JSON.parse(local.validateReferenceResult(JSON.stringify({modelPrompt:english,displayPrompt:chinese}),chineseOptions));
 assert.equal(legacy.editPolicy,undefined);
 const invalid=JSON.parse(local.validateReferenceResult(JSON.stringify({modelPrompt:english,displayPrompt:chinese,editPolicy:{preserveBackground:'true'}}),chineseOptions));
 assert.equal(invalid.editPolicy.preserveBackground,false);
});

test('16fps reference exports retain the 24fps model timeline and copied audio timing',()=>{
 const params={mode:'r2v',prompt:text,referenceVideo:'spin.mp4',referenceImages:['coin.png'],referenceAudio:'music.wav',durationSeconds:3,seed:1};
 const normal=workflow.buildWorkflow({...params,fps:24});
 const low=workflow.buildWorkflow({...params,fps:16});
 const find=(g,klass)=>Object.entries(g).find(([,n])=>n.class_type===klass);
 assert.equal(find(low,'MiniMaxH3ReferenceToVideo')[1].inputs.length,find(normal,'MiniMaxH3ReferenceToVideo')[1].inputs.length);
 assert.equal(find(low,'MiniMaxH3ReferenceToVideo')[1].inputs.length,73);
 assert.equal(find(low,'TrimAudioDuration')[1].inputs.duration,73/24);
 const frames=find(low,'NovaFlowH3OutputVideoFrames');
 assert.equal(frames[1].inputs.fps,16);
 assert.deepEqual(Array.from(frames[1].inputs.images),[find(low,'VAEDecode')[0],0]);
 assert.deepEqual(Array.from(find(low,'CreateVideo')[1].inputs.images),[frames[0],0]);
 const restored=workflow.patchWorkflow(low,{...params,fps:24});
 assert.equal(find(restored,'NovaFlowH3OutputVideoFrames'),undefined);
 assert.equal(workflow.validateWorkflow(restored),true);
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
  assert.match(result.displayPrompt,/<Video 1>\s*[：:]\s*本次编辑的源视频/);
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
test('多参 cuts read like the official guide: each shot on its own display line, a named cut and one line per shot for H3',async()=>{
 const asText=fields=>local.referenceFields.map(k=>k+':\n'+fields[k]).join('\n\n');
 // Round 1 mr_cut: the local English half had "<Subject 1>：", blank lines and a cut without its verb.
 const english=asText({subject_definitions:'<Subject 1>：young woman with short dark hair, from <Picture 1>\n<Subject 2>：small teal robot, from <Picture 2>',summary:'[reference generation] <Subject 1> walks toward <Subject 2>; at the 3-second mark the camera cuts to a close-up of both.',retention_analysis:'<Subject 1>: fully_preserved - short dark hair\n<Subject 2>: fully_preserved - teal body',detailed_description:'In a vibrant anime illustration style.\n\n[Shot 1] <Subject 1> walks along a rural road toward <Subject 2> in a garden.\n\nThe camera remains static.\n\n[Shot 2] At 00:03.000 close-up of <Subject 1> and <Subject 2> facing each other.',overall_soundscape:'Footsteps on the path and soft garden ambience.',non_diegetic_music:'N/A'});
 const chinese=asText({subject_definitions:'<Subject 1>: 短黑发年轻女性，来自 <Picture 1>\n<Subject 2>: 青绿色小机器人，来自 <Picture 2>',summary:'[reference generation] <Subject 1> 走向 <Subject 2>，第3秒切到两人的近景。',retention_analysis:'<Subject 1>: fully_preserved - 短黑发\n<Subject 2>: fully_preserved - 青绿色机身',detailed_description:'采用鲜艳的动漫插画风格。 [Shot 1] <Subject 1> 沿着乡村道路走向花园中的 <Subject 2>。镜头固定。 [Shot 2] At 00:03.000 <Subject 1> 与 <Subject 2> 面对面的近景。',overall_soundscape:'小径上的脚步声与柔和的花园环境音。',non_diegetic_music:'N/A'});
 const two=[{key:'multi_ref_image_1',kind:'image',identity:'woman',occupied:true,fileName:'woman.png',mimeType:'image/png'},{key:'multi_ref_image_2',kind:'image',identity:'robot',occupied:true,fileName:'robot.png',mimeType:'image/png'}];
 const c={modelId:'minimax_h3_local',mode:'multi_reference',durationSeconds:5,prompt:'@参考图1 中的角色走向 @参考图2 中的角色，第3秒切到两人的近景',resources:two};
 const restored=prompt.validateAndRestore({text:JSON.stringify({modelPrompt:english,displayPrompt:chinese}),context:prompt.prepareRequest(c).context,current:c});
 assert.match(restored.text,/\n【镜头 1】<主体 1> 沿着乡村道路走向花园中的 <主体 2>。镜头固定。\n【镜头 2】 At 00:03\.000 <主体 1> 与 <主体 2> 面对面的近景。\n/);
 const narrative=restored.modelText.split('detailed_description:')[1].split('overall_soundscape:')[0].trim();
 assert.equal(narrative,'In a vibrant anime illustration style.\n[Shot 1] <Subject 1> walks along a rural road toward <Subject 2> in a garden. The camera holds a static shot.\n[Shot 2] At 00:03.000, the shot cuts to close-up of <Subject 1> and <Subject 2> facing each other.');
 assert.match(restored.modelText,/^<Subject 1>: young woman[^\n]*\n<Subject 2>: small teal robot/m);
 // The compile of the same display reuses the translation and shows the same text.
 const compiled=await prompt.compileForGeneration({...c,prompt:restored.text},()=>{throw Error('the optimize pair is cached')});
 assert.equal(compiled.text,restored.text);assert.equal(compiled.modelText,restored.modelText);
 // The Chinese half and a display keep their own wording.
 for(const api of [local,edge]) assert.match(api.validateReference(chinese,{mode:'multi_reference',durationSeconds:5,requirements:'Available resource labels: <Picture 1>; <Picture 2>'}),/\[Shot 2\] At 00:03\.000 <Subject 1> 与/);
 assert.match(local.toReferenceDisplay(chinese),/<主体 2>。镜头固定。\n【镜头 2】 At 00:03\.000 /);
 // A short Chinese half full of subject tags stays Chinese: tags, shot markers and times are no English words.
 const tagged=chinese.replace(/detailed_description:\n[^\n]*/,'detailed_description:\n[Shot 1] <Subject 1> 走向 <Subject 2>，镜头跟随。\n[Shot 2] At 00:03.000 <Subject 1> 与 <Subject 2> 的近景。');
 for(const api of [local,edge]) assert.match(api.validateReference(tagged,{mode:'multi_reference',durationSeconds:5,requirements:'Available resource labels: <Picture 1>; <Picture 2>'}),/\n\[Shot 2\] At 00:03\.000 <Subject 1> 与 <Subject 2> 的近景。\n/);
 assert.match(prompt.validateAndRestore({text:JSON.stringify({modelPrompt:english,displayPrompt:tagged}),context:prompt.prepareRequest(c).context,current:c}).text,/\n【镜头 2】 At 00:03\.000 <主体 1> 与 <主体 2> 的近景。\n/);
});
