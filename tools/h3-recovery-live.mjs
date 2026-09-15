import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
const root=path.resolve(import.meta.dirname,'..');
const modeArg=process.argv.find(arg=>arg.startsWith('--mode='))?.slice(7);
const out=path.join(root,modeArg?'docs/h3-mode-matrix-validation':'docs/h3-recovery-validation'); fs.mkdirSync(out,{recursive:true});
const context={console}; context.globalThis=context;
for(const name of ['h3-prompt-format.js','ai-sequence-minimax-h3-prompt.workflow.js','ai-sequence-minimax-h3-reverse.workflow.js']) vm.runInNewContext(fs.readFileSync(path.join(root,'particle-editor',name),'utf8'),context);
const dataUrl='data:image/png;base64,'+fs.readFileSync(path.join(root,'docs/wan-vs-smoothmix-wash-validation/cyber-portrait/source.png')).toString('base64');
const current={modelId:'minimax_h3_local',mode:'first_last',durationSeconds:4,prompt:'以 <Picture 1> 为首帧，<Picture 2> 为尾帧。人物先抬眼，轻微转头，再回到起始姿态。保持面部和身份稳定。',requirements:'保持首尾帧构图，动作自然衔接。',resources:['first_frame','last_frame'].map(key=>({key,identity:key,occupied:true,kind:'image',fileName:key+'.png',mimeType:'image/png',dataUrl}))};
if(modeArg) {
  current.contentPolicy={sensitiveVisualAnalysis:true,allSubjectsConfirmedAdult:false};
  current.mode=modeArg; current.durationSeconds=3;
  current.prompt='角色保持待机状态，身体不发生位移，呼吸带动肩部轻微起伏，最后平滑回到起始姿态。';
  current.requirements='';
  if(modeArg==='text_video') current.resources=[];
  else if(modeArg==='multi_reference') current.resources=[{...current.resources[0],key:'multi_ref_image_1'}];
  else if(modeArg==='image_video') current.resources=current.resources.slice(0,1);
}
const reverse=process.argv.includes('--reverse');
const dialogue=process.argv.includes('--dialogue');
if(dialogue) {
  current.durationSeconds=10;
  current.prompt=JSON.parse(fs.readFileSync(path.join(root,'docs/h3-five-section-validation/input.json'),'utf8')).currentPrompt;
}
const workflow=reverse?context.NovaFlowAiSequenceMiniMaxH3ReverseWorkflow:context.NovaFlowAiSequenceMiniMaxH3PromptWorkflow;
const prepared=workflow.prepareRequest(current);
const payload=reverse?prepared.request:{prompt:prepared.prompt,requirements:prepared.requirements,h3Mode:prepared.context.mode,durationSeconds:prepared.context.durationSeconds,contentPolicy:prepared.context.contentPolicy,visualSchema:'nf.h3.visual.v1',purpose:'minimax-h3-prompt-enhance',surface:'animation',supportsNegativePrompt:false};
const name=(modeArg?`local-${modeArg}-${reverse?'reverse':'optimize'}`:reverse?'local-fl2v-reverse':'local-fl2v-optimize')+(dialogue?'-dialogue':'');
fs.writeFileSync(path.join(out,name+'-request.json'),JSON.stringify(payload,null,2));
if(process.argv.includes('--prepare')) process.exit(0);
const log=fs.openSync(path.join(out,name+'.log'),'w');
const child=spawn('C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe',[path.join(root,'particle-editor-desktop/prompt-assistant-service.py')],{cwd:root,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'},stdio:['pipe','pipe',log]});
const started=Date.now();
const timer=setTimeout(()=>{child.kill();process.exitCode=1;console.error('live request timeout');},420000);
child.stdin.on('error',err=>console.error(err.code));
let received=false;
for await(const line of readline.createInterface({input:child.stdout})) {
  let message;try {message=JSON.parse(line);} catch {continue;}
  if(message.type==='ready') child.stdin.write(JSON.stringify({id:1,command:reverse?'reverseImagePrompt':'optimizePrompt',...payload})+'\n');
  if(message.id!==1) continue;
  received=true;
  fs.writeFileSync(path.join(out,name+'-result.json'),JSON.stringify(message,null,2));
  try {
    if(!message.ok) throw Error(message.error);
    const data=message.data || message.result || message;
    const text=data.positivePrompt || data.prompt || data.output_text || data.text;
    const result=workflow.validateAndRestore({text,context:prepared.context,current});
    fs.writeFileSync(path.join(out,name+'-output.txt'),result.text);
    console.log(JSON.stringify({ok:true,reverse,elapsedMs:Date.now()-started,chars:result.text.length}));
  } catch(error) {console.error(error.message);process.exitCode=1;}
  child.stdin.write(JSON.stringify({id:2,command:'shutdown'})+'\n');
  break;
}
clearTimeout(timer);child.kill();fs.closeSync(log);
if(!received) throw Error('service exited before replying');
