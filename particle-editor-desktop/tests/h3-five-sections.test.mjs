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

test('example format accepted by desktop, Edge and renderer and preserves speaker and dialogue', () => {
  assert.equal(local.formatInstruction, edge.formatInstruction);
  assert.equal(edge.validateFormat(formatted, options), formatted);
  const context = {module:{exports:{}}, console}; context.globalThis=context;
  for (const file of ['h3-prompt-format.js','ai-sequence-minimax-h3-prompt.workflow.js']) vm.runInNewContext(fs.readFileSync(new URL('../../particle-editor/'+file,import.meta.url),'utf8'), context);
  const workflow = context.NovaFlowAiSequenceMiniMaxH3PromptWorkflow;
  const current={modelId:'minimax_h3_local', mode:'image_video', durationSeconds:10, prompt:'机械女性先抬眼，再抬手，说话时镜头拉近。',resources:[{key:'first_frame',identity:'first',occupied:true,kind:'image',fileName:'first.png',mimeType:'image/png'}]};
  const request=workflow.prepareRequest(current);
  assert.match(request.requirements,/【任务定位】/);
  assert.equal(workflow.validateAndRestore({text:formatted, context:request.context,current}).text,formatted);
  assert.equal(workflow.prepareRequest({...current,prompt:formatted}).prompt,formatted);
  assert.throws(()=>workflow.validateAndRestore({text:formatted, context:request.context,current:{...current,durationSeconds:5}}),/stale/);
});

test('five-section text reaches I2V conditioning unchanged with only the supplied first frame', () => {
  const context={console};context.window=context;context.globalThis=context;
  vm.runInNewContext(fs.readFileSync(new URL('../../particle-editor/ai-sequence-minimax-h3.workflow.js',import.meta.url),'utf8'),context);
  const graph=context.NovaFlowAiSequenceMiniMaxH3Workflow.buildWorkflow({mode:'i2v',params:{prompt:formatted,images:['first.png'],duration:10,seed:1}});
  const conditioning=Object.values(graph).find(node=>node.class_type==='MiniMaxH3ImageToVideo');
  assert.equal(conditioning.inputs.prompt,formatted);
  assert.equal(conditioning.inputs.last_frame,undefined);
});

test('new format rejects truncated output, timeline errors, missing references and undefined speakers', () => {
  for(const api of [local,edge]) {
    for(const broken of [formatted.split('【台词】')[0], formatted.replace('2.0-4.0s','2.5-4.0s'),formatted.replace('8.5-10.0s','8.5-11.0s'), formatted.replaceAll('<Picture 1>','<Picture 2>'), formatted.replace('<Subject 1> = (S1)','S1'),formatted.replace('时长10秒','时长5秒')]) assert.throws(()=>api.validateFormat(broken,options));
    assert.throws(()=>api.validateFormat(formatted,{...options,currentPrompt:'(S1)："必须保留的台词"'}),/台词/);
    assert.throws(()=>api.validateFormat(formatted,{...options,mode:'FL2VA',minimaxH3Mode:'first_last'}),/参考/);
  }
});

test('Python accepts the same fixture and rejects invalid ranges', () => {
  const script=`import sys,json\nsys.path.insert(0,'particle-editor-desktop')\nfrom prompt_assistant.h3_prompt_enhance import validate_format\nf=json.load(open('particle-editor-desktop/tests/fixtures/h3-five-sections.json',encoding='utf-8'))\ntext=validate_format(json.dumps(f,ensure_ascii=False),'I2VA',10)\nassert '<Subject 1> = (S1)' in text\ntry: validate_format(text.replace('2.0-4.0s','2.5-4.0s'),'I2VA',10)\nexcept ValueError: pass\nelse: raise AssertionError('timeline accepted')\nprint('ok')`;
  const result=spawnSync('python',['-c',script],{encoding:'utf8'}); assert.equal(result.status,0,result.stderr);
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

test('seconds abbreviation in the task is equivalent, mismatched duration remains invalid',()=>{
  for(const api of [local,edge]) {
    assert.match(api.validateFormat(formatted.replace('时长10秒','时长10s'),options),/时长10s/);
    assert.throws(()=>api.validateFormat(formatted.replace('时长10秒','时长3s'),options),/时长/);
  }
});
