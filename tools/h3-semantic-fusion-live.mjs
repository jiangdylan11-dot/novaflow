import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {createRequire} from 'node:module';
import {buildGrokPromptOptimizeRequest, buildGrokImageReverseRequest, normalizeMiniMaxH3PromptOutput, grokResponsesPublicResult, callGrokResponseWithVisualRetry} from '../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
const root=path.resolve(import.meta.dirname,'..');
const remainingThree=process.argv.includes('--remaining-three');
const out=path.resolve(root,process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)||(remainingThree?'docs/h3-final-three-validation':'docs/h3-semantic-fusion-validation')); fs.mkdirSync(out,{recursive:true});
const grok=process.argv.includes('--grok'), reverse=process.argv.includes('--reverse');
const prefix=`${grok?'grok':'local'}-${remainingThree?(grok?'multi-reference-':'first-last-'):''}${reverse?'reverse':'optimize'}`;
const save=(name,data)=>fs.writeFileSync(path.join(out,prefix+'-'+name),typeof data==='string'?data:JSON.stringify(data,null,2));
const context={console}; context.globalThis=context;
for(const name of ['h3-prompt-format.js','ai-sequence-minimax-h3-prompt.workflow.js','ai-sequence-minimax-h3-reverse.workflow.js']) vm.runInNewContext(fs.readFileSync(path.join(root,'particle-editor',name),'utf8'),context);
const speech='系统自检完成。动力核心已上线，下一条指令——可以直接下达。';
const current={modelId:'minimax_h3_local',mode:'text_video',durationSeconds:10,
  prompt:`蓝色机器人在夜晚的仓库向前走，镜头固定。蓝色金属外壳带有细小划痕。\n<Subject 1> = (S1)，蓝色机器人。\n(S1)：“${speech}”`,
  requirements:'改为白天原地挥手，镜头缓慢拉近；保持蓝色金属外壳、细小划痕和完整原台词。',resources:[],
  contentPolicy:{sensitiveVisualAnalysis:false,allSubjectsConfirmedAdult:false}};
if(reverse) {
  current.mode='image_video'; current.durationSeconds=6;
  current.prompt='角色原地站立，镜头固定。';
  current.requirements='保持银灰色头发、蓝色护目镜、黑色夹克和雨夜街道；右手轻轻抬起再放下，镜头缓慢拉近，身体不位移。';
  current.resources=[{key:'first_frame',identity:'neutral-cyber-portrait',occupied:true,kind:'image',fileName:'portrait.png',mimeType:'image/png',dataUrl:'data:image/png;base64,'+fs.readFileSync(path.join(root,'docs/wan-vs-smoothmix-wash-validation/cyber-portrait/source.png')).toString('base64')}];
}
if(remainingThree) {
  current.mode=grok?'multi_reference':'first_last'; current.durationSeconds=3;
  current.prompt=grok?'<Picture 1> 提供人物外观，<Picture 2> 提供背景风格。角色在雨夜街道原地站立待机，仅胸肩有呼吸微动。':'银发角色穿黑色夹克在雨夜街道原地站立。以 <Picture 1> 为首帧，<Picture 2> 为尾帧，镜头固定，身体不位移。';
  current.requirements='只允许轻微呼吸，其余姿态保持不变，不走动、不转身、不挥手。';
  const dataUrl='data:image/png;base64,'+fs.readFileSync(path.join(root,'docs/wan-vs-smoothmix-wash-validation/cyber-portrait/source.png')).toString('base64');
  current.resources=(grok?['multi_ref_image_1','multi_ref_image_2']:['first_frame','last_frame']).map(key=>({key,identity:key,occupied:true,kind:'image',fileName:key+'.png',mimeType:'image/png',dataUrl}));
}
save('input.json',current);
const workflow=reverse?context.NovaFlowAiSequenceMiniMaxH3ReverseWorkflow:context.NovaFlowAiSequenceMiniMaxH3PromptWorkflow;
const prepared=workflow.prepareRequest(current);
const payload=reverse?prepared.request:{prompt:prepared.prompt,requirements:prepared.requirements+'\n\n'+current.requirements,h3Mode:prepared.context.mode,durationSeconds:prepared.context.durationSeconds,contentPolicy:prepared.context.contentPolicy,visualSchema:'nf.h3.visual.v1',purpose:'minimax-h3-prompt-enhance',surface:'animation',supportsNegativePrompt:false};
let providerCalls=0;
async function localCall(command,payload,stage) {
  const log=fs.openSync(path.join(out,prefix+'-'+stage+'.log'),'w');
  const child=spawn('C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe',[path.join(root,'particle-editor-desktop/prompt-assistant-service.py')],{cwd:root,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'},stdio:['pipe','pipe',log]});
  const timer=setTimeout(()=>child.kill(),420000);
  child.stdin.on('error',()=>{});
  try {
    for await(const line of readline.createInterface({input:child.stdout})) {
      let result; try {result=JSON.parse(line);}catch{continue;}
      if(result.type==='ready') child.stdin.write(JSON.stringify({id:1,command,...payload})+'\n');
      if(result.id!==1) continue;
      save(stage+'-response.json',result); providerCalls++;
      if(!result.ok) throw Error(result.error||'local request failed');
      return result.data||result.result||result;
    }
    throw Error('local service exited before reply');
  } finally {clearTimeout(timer);child.kill(); await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));fs.closeSync(log);}
}
async function grokCall(command,payload,stage) {
  const require=createRequire(import.meta.url);
  const config=require('../particle-editor-desktop/license-admin-gui/admin-data.js').readAdminGrokEnv();
  if(!config.apiKey) throw Error('Grok provider not configured');
  const built=(command==='reverseImagePrompt'?buildGrokImageReverseRequest:buildGrokPromptOptimizeRequest)(payload,config.model);
  const result=await callGrokResponseWithVisualRetry(built.body,built.inputMeta,built.resultOptions,async body=>{
    providerCalls++;
    const response=await fetch(config.baseUrl.replace(/\/$/,'')+'/responses',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});
    const raw=await response.json();
    if(!response.ok) throw Error('Grok HTTP '+response.status);
    save(stage+'-attempt-'+providerCalls+'.json',raw);
    if(command==='reverseImagePrompt') return {ok:true,data:grokResponsesPublicResult(raw,built.resultOptions),providerCallCount:1};
    const text=raw.output_text||(raw.output||[]).flatMap(item=>item.content||[]).map(item=>item.text||'').join('\n');
    return {ok:true,data:{output_text:normalizeMiniMaxH3PromptOutput(text,built.resultOptions)},providerCallCount:1};
  });
  save(stage+'-response.json',result);return result.data;
}
const call=grok?grokCall:localCall;
const read=data=>data.positivePrompt||data.prompt||data.output_text||data.text;
const started=Date.now();
try {
  save('stage1-request.json',payload);
  const cached=process.argv.includes('--reuse-stage1')?JSON.parse(fs.readFileSync(path.join(out,prefix+'-stage1-response.json'),'utf8')):null;
  const initial=cached?(cached.data||cached.result):await call(reverse?'reverseImagePrompt':'optimizePrompt',payload,'stage1');
  let validated=workflow.validateAndRestore({text:read(initial),context:prepared.context,current});
  save('stage1-output.txt',validated.text);
  if(reverse) {
    const refinement=workflow.prepareRefinement({text:validated.text,context:prepared.context});
    save('stage2-request.json',refinement);
    const refined=await call('optimizePrompt',refinement,'stage2');
    validated=workflow.validateAndRestore({text:read(refined),context:prepared.context,current});
  }
  save('output.txt',validated.text);
  if(remainingThree) {
    if(!/呼吸/.test(validated.text)) throw Error('breathing requirement missing');
    if(!/(?:<Picture 1>|@参考图1)/.test(validated.text)||!/(?:<Picture 2>|@参考图2)/.test(validated.text)) throw Error('missing reference binding');
  }
  if(reverse && !remainingThree) {
    const narrative=validated.text.split('【递进式详细提示词】')[1].split('【台词】')[0];
    if(!/拉近|推近|推进|push|zoom/i.test(narrative)||!/抬|rais|lift/i.test(narrative)) throw Error('reverse supplementary motion was not fused into narrative');
    // A stable opening or settled final frame is compatible with a push-in during the clip.
    const task=validated.text.split('【说话者】')[0];
    if(/全程.{0,5}(?:固定|静止)|始终.{0,5}固定/.test(task+narrative)) throw Error('reverse kept an all-clip locked camera');
  }
  if(!reverse && !remainingThree) {
    if(!validated.text.includes(speech)) throw Error('original dialogue was not preserved');
    const description=validated.text.split('【递进式详细提示词】')[1].split('【台词】')[0];
    if(!/白天|日间|日光|daytime/i.test(description)||!/挥|摆|wav/i.test(description)||!/蓝色|blue/i.test(description)) throw Error('required changes or preserved identity are absent');
    if(/夜晚|向前走|镜头固定/.test(description)) throw Error('superseded original setting still present');
  }
  const result={ok:true,providerCalls,reusedStageOne:!!cached,elapsedMs:Date.now()-started,chars:validated.text.length,realRendererValidated:true};
  save('result.json',result);console.log(prefix,JSON.stringify(result));
} catch(error) {save('result.json',{ok:false,providerCalls,elapsedMs:Date.now()-started,error:error.message});throw error;}
