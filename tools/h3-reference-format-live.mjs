import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {buildGrokPromptOptimizeRequest, normalizeMiniMaxH3PromptOutput, callGrokResponseWithVisualRetry} from '../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
const require=createRequire(import.meta.url);
require('../particle-editor/h3-prompt-format.js');
require('../particle-editor/ai-sequence-minimax-h3-prompt.workflow.js');
const api=globalThis.NovaFlowAiSequenceMiniMaxH3PromptWorkflow;
const out=path.resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||'docs/h3-reference-format-20260915');
fs.mkdirSync(out,{recursive:true});
const current=JSON.parse(fs.readFileSync(process.argv.find(a=>a.startsWith('--case='))?.slice(7)||'docs/h3-chinese-reference-20260914/current.json','utf8'));
current.prompt=process.argv.find(a=>a.startsWith('--prompt='))?.slice(9)||(process.argv.some(a=>a.startsWith('--case='))?current.prompt:'把@视频参考中的旋转的金币样式替换成@参考图1的样式，保持视频的背景和金币运动轨迹');
const prepared=api.prepareRequest(current);
const frames=JSON.parse(fs.readFileSync(process.argv.find(a=>a.startsWith('--frames='))?.slice(9)||'docs/h3-chinese-reference-20260914/vision-grok/frames.json','utf8'));
const payload={prompt:prepared.prompt,requirements:prepared.requirements,h3Mode:'multi_reference',durationSeconds:current.durationSeconds,purpose:'minimax-h3-prompt-enhance',surface:'animation',visualSchema:'nf.h3.visual.v1',supportsNegativePrompt:false,h3ReferenceFrames:frames};
fs.writeFileSync(path.join(out,'current.json'),JSON.stringify(current,null,2));
fs.writeFileSync(path.join(out,'local-request.json'),JSON.stringify(payload));
if(process.argv.includes('--prepare-only')) {console.log('Prepared exact user request with '+frames.length+' real images');process.exit(0);}
if(process.argv.includes('--check-local')) {
 const result=api.validateAndRestore({text:fs.readFileSync(path.join(out,'local-compiled.txt'),'utf8'),context:prepared.context,current});
 fs.writeFileSync(path.join(out,'local-display.txt'),result.text);fs.writeFileSync(path.join(out,'local-model.txt'),result.modelText);
 console.log(JSON.stringify({ok:true,provider:'local',displayChars:result.text.length,modelChars:result.modelText.length}));process.exit(0);
}
if(process.argv.includes('--check-grok')) {
 const result=api.validateAndRestore({text:fs.readFileSync(path.join(out,'grok-raw-1.txt'),'utf8'),context:prepared.context,current});
 fs.writeFileSync(path.join(out,'grok-display.txt'),result.text);fs.writeFileSync(path.join(out,'grok-model.txt'),result.modelText);
 fs.writeFileSync(path.join(out,'grok-replay.json'),JSON.stringify({ok:true,replayed:true,providerCalls:0}));
 console.log(JSON.stringify({ok:true,provider:'grok',replayed:true}));process.exit(0);
}
const config=require('../particle-editor-desktop/license-admin-gui/admin-data.js').readAdminGrokEnv();
const built=buildGrokPromptOptimizeRequest(payload,config.model);
let calls=0;
try {
 const result=await callGrokResponseWithVisualRetry(built.body,built.inputMeta,built.resultOptions,async body=>{
  calls++;
  const response=await fetch(config.baseUrl.replace(/\/$/,'')+'/responses',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});
  if(!response.ok)throw Error('Grok HTTP '+response.status);
  const raw=await response.json();
  fs.writeFileSync(path.join(out,'grok-raw-'+calls+'.json'),JSON.stringify(raw,null,2));
  const text=raw.output_text||(raw.output||[]).flatMap(item=>item.content||[]).map(item=>item.text||'').join('\n');
  fs.writeFileSync(path.join(out,'grok-raw-'+calls+'.txt'),text);
  return {ok:true,data:{output_text:normalizeMiniMaxH3PromptOutput(text,built.resultOptions)},providerCallCount:1};
 });
 const validated=api.validateAndRestore({text:result.data.output_text,context:prepared.context,current});
 fs.writeFileSync(path.join(out,'grok-display.txt'),validated.text);fs.writeFileSync(path.join(out,'grok-model.txt'),validated.modelText);
 fs.writeFileSync(path.join(out,'grok-result.json'),JSON.stringify({ok:true,calls,displayChars:validated.text.length,modelChars:validated.modelText.length},null,2));
 console.log(JSON.stringify({ok:true,calls}));
} catch(error) {
 fs.writeFileSync(path.join(out,'grok-result.json'),JSON.stringify({ok:false,calls,error:error.message},null,2));throw error;
}
