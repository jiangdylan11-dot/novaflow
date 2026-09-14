import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,'..');
require('../particle-editor/h3-prompt-format.js');
require('../particle-editor/ai-sequence-minimax-h3-prompt.workflow.js');
const promptApi=globalThis.NovaFlowAiSequenceMiniMaxH3PromptWorkflow;
require('../particle-editor/ai-sequence-minimax-h3.workflow.js');
const graphApi=globalThis.NovaFlowAiSequenceMiniMaxH3Workflow;
const argValue=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1]};
const out=path.resolve(root,argValue('--out')||'docs/h3-multireference-20260914');fs.mkdirSync(out,{recursive:true});
const save=(name,value)=>fs.writeFileSync(path.join(out,name),typeof value==='string'?value:JSON.stringify(value,null,2));
const api=async(route,body)=>{const r=await fetch('http://127.0.0.1:8189'+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});if(!r.ok)throw Error(route+' HTTP '+r.status);return r.json()};
const supplied=argValue('--case')?JSON.parse(fs.readFileSync(argValue('--case'),'utf8')):null;
const image=supplied?.resources.find(r=>r.kind==='image')?.fileName||'meidaojinbi0018_1789387222546_391a79.png';
const video=supplied?.resources.find(r=>r.kind==='video')?.fileName||'kling_20260903_VIDEO_Video1__4542_0_1789387222814_cafff3.mp4';
const current=supplied||{modelId:'minimax_h3_local',mode:'multi_reference',durationSeconds:3,
  prompt:'编辑 <Video 1>，将视频中的面具图案金币完全替换为 <Picture 1> 的美元金币，保留图片的美元符号、双层金色边框和卡通金属材质。金币的自转动作、中心位置、画面占比、镜头、纯绿色背景和时间节奏沿用视频。只保留一枚金币，从第一帧开始就是美元金币，不保留或混合原视频的面具图案。3秒，保持循环衔接，无对白，无音乐。',
  resources:[{key:'multi_ref_image_1',occupied:true,kind:'image',identity:image,fileName:image,mimeType:'image/png'}, {key:'multi_ref_video_1',occupied:true,kind:'video',identity:video,fileName:video,mimeType:'video/mp4'}]};
const cloudCompileOnly=process.argv.includes('--grok')&&process.argv.includes('--compile-only');
const queue=await api('/queue').catch(()=>({queue_running:[],queue_pending:[]}));if(!cloudCompileOnly&&(queue.queue_running.length||queue.queue_pending.length))throw Error('H3 busy; refusing to disrupt active generation');
let compiled;
if(process.argv.includes('--reuse'))compiled={modelText:fs.readFileSync(path.join(out,process.argv.includes('--grok')?'grok-compiled.txt':'local-compiled.txt'),'utf8')};
else {
  if(!process.argv.includes('--grok'))await api('/free',{unload_models:true,free_memory:true}).catch(()=>{});
  compiled=await promptApi.compileForGeneration(current,async payload=>{
    save('local-request.json',payload);
    if(process.argv.includes('--grok')) {
      const {buildGrokPromptOptimizeRequest,normalizeMiniMaxH3PromptOutput,callGrokResponseWithVisualRetry}=await import('../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs');
      const config=require('../particle-editor-desktop/license-admin-gui/admin-data.js').readAdminGrokEnv();
      const built=buildGrokPromptOptimizeRequest(payload,config.model);
      const result=await callGrokResponseWithVisualRetry(built.body,built.inputMeta,built.resultOptions,async body=>{
        const response=await fetch(config.baseUrl.replace(/\/$/,'')+'/responses',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});
        if(!response.ok)throw Error('Grok HTTP '+response.status);
        const r=await response.json();save('grok-response.json',r);
        const text=r.output_text||(r.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join('\n');
        return {ok:true,data:{output_text:normalizeMiniMaxH3PromptOutput(text,built.resultOptions)},providerCallCount:1};
      });
      save('grok-compiled.txt',result.data.output_text);return result.data.output_text;
    }
    const log=fs.openSync(path.join(out,'local-service.log'),'w');
    const child=spawn('C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe',[path.join(root,'particle-editor-desktop/prompt-assistant-service.py')],{cwd:root,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'},stdio:['pipe','pipe',log]});
    const timer=setTimeout(()=>child.kill(),600000);child.stdin.on('error',()=>{});
    try {
      for await(const line of readline.createInterface({input:child.stdout})) {
        let r;try{r=JSON.parse(line)}catch{continue}
        if(r.type==='ready')child.stdin.write(JSON.stringify({id:1,command:'optimizePrompt',...payload})+'\n');
        if(r.id!==1)continue;
        save('local-response.json',r);if(!r.ok)throw Error(r.error);
        const d=r.data||r.result||r;return d.positivePrompt||d.output_text||d.prompt;
      }
      throw Error('Local compiler exited without a response');
    } finally {clearTimeout(timer);child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));fs.closeSync(log)}
  });
  save(process.argv.includes('--grok')?'grok-compiled.txt':'local-compiled.txt',compiled.modelText);console.log('COMPILED',compiled.modelText.length);
}
if(process.argv.includes('--compile-only'))process.exit(0);
const lifecycle=require('../particle-editor-desktop/main/minimax-h3-runtime-lifecycle.js').createMiniMaxH3RuntimeLifecycle();
const runtime=await lifecycle.start();if(!runtime.ok)throw Error(runtime.error||'H3 startup failed');
const copyAudio=process.argv.includes('--audio');
const runName=copyAudio?'audio':'coin';
if(copyAudio) {
  compiled.modelText=compiled.modelText.replace(/\r\n/g,'\n').replace('\n\nsummary:', '\n<Audio 1> is the complete supplied electronic test soundtrack.\n\nsummary:')
    .replace('[video editing + reference generation]', '[video editing + reference generation + audio reuse]')
    .replace('\n\ndetailed_description:', '\n<Audio 1>: fully_copy - reuse this complete soundtrack without generating a replacement.\n\ndetailed_description:')
    .replace(/overall_soundscape:[\s\S]*$/, 'overall_soundscape:\nThe exact supplied electronic tones from <Audio 1>.\n\nnon_diegetic_music:\nN/A');
}
compiled=await promptApi.compileForGeneration({...current,prompt:compiled.modelText,resources:[...current.resources,...(copyAudio?[{key:'multi_ref_audio_1',kind:'audio',occupied:true,identity:'novaflow_h3_audio_acceptance.wav',fileName:'novaflow_h3_audio_acceptance.wav',mimeType:'audio/wav'}]:[])]},async()=>{throw Error('Expected an already compiled reference prompt')});
const graph=graphApi.buildWorkflow({profile:'beta5_int8',acceleration:'sage',mode:'r2v',prompt:compiled.modelText,aspectRatio:'1:1',megapixels:.4,durationSeconds:3,fps:24,steps:4,seed:1696013393,referenceImages:[image],referenceVideo:video,...(copyAudio?{referenceAudio:'novaflow_h3_audio_acceptance.wav'}:{}),outputPrefix:'video/NovaFlow_H3_'+runName+'_reference_fixed'});
save(runName+'-workflow.json',graph);
const submitted=await api('/prompt',{prompt:graph,client_id:'novaflow-h3-reference-acceptance'});save(runName+'-submission.json',submitted);console.log('SUBMITTED',submitted.prompt_id);
for(let n=0;n<300;n++) {
  await new Promise(r=>setTimeout(r,2000));
  const h=(await api('/history/'+submitted.prompt_id))[submitted.prompt_id];
  if(!h)continue;save(runName+'-history.json',h);console.log('COMPLETE',h.status.status_str,JSON.stringify(h.outputs));if(h.status.status_str!=='success')process.exitCode=1;break;
}
