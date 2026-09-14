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
const options={mode:'multi_reference',durationSeconds:3,requirements:'Available resource labels: <Picture 1>; <Video 1>; <Audio 1>'};
const text=local.validateReference(JSON.stringify(fixture),options);

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
 const built=buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance',h3Mode:'multi_reference',durationSeconds:3,prompt:current.prompt,requirements:options.requirements,visualSchema:'nf.h3.visual.v1'});
 assert.deepEqual(built.body.text.format.schema.required,local.referenceFields);
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
 assert.equal(find(background,'NovaFlowH3PrepareReferenceImage')[1].inputs.preserve_video_layout,false);
});

test('local relationship rendering accepts lists, resolves edit retention and closes only requested loops',()=>{
 const plan={references:[{label:'<Subject 1>',sources:['<Picture 1>'],description:'the gold dollar coin',relation:'fully_preserved',keep:['dollar sign','gold rim']},{label:'<Video 1>',sources:[],description:'the rotation video',relation:'fully_preserved',keep:'rotation and green background'}],tasks:['video editing','reference generation'],summary:'Replace the mask coin with the dollar coin.',description:'The camera remains static while <Subject 1> rotates following <Video 1>.',soundscape:'N/A',music:'N/A'};
 const py=spawnSync('python',['-c',"import json,sys;sys.path.insert(0,'particle-editor-desktop');from prompt_assistant.h3_prompt_enhance import render_reference_plan;print(render_reference_plan(sys.stdin.read(),'Available resource labels: <Picture 1>; <Video 1>',3,'loop'))"],{input:JSON.stringify(plan),encoding:'utf8',cwd:new URL('../../',import.meta.url),env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.equal(py.status,0,py.stderr);
 assert.match(py.stdout,/<Video 1>: partially_preserved/);
 assert.match(py.stdout,/returns smoothly to its starting pose/);
 assert.match(py.stdout,/dollar sign; gold rim/);
});
