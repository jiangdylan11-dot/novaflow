// Replay saved real provider responses through the final packaged renderer.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {buildGrokImageReverseRequest,grokResponsesPublicResult,callGrokResponseWithVisualRetry} from '../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'docs/h3-mode-matrix-validation');
const renderer=path.join(root,'particle-editor-desktop/dist/win-unpacked/resources/app/renderer');
const context={console};context.globalThis=context;
for(const f of ['h3-prompt-format.js','ai-sequence-minimax-h3-prompt.workflow.js','ai-sequence-minimax-h3-reverse.workflow.js']) vm.runInNewContext(fs.readFileSync(path.join(renderer,f),'utf8'),context);
const rows=[];
const read=f=>JSON.parse(fs.readFileSync(path.join(out,f),'utf8'));
function restore(request,text,reverse) {
  const keys=request.h3Mode==='text_video'?[]:request.h3Mode==='first_last'?['first_frame','last_frame']:request.h3Mode==='multi_reference'?['multi_ref_image_1']:['first_frame'];
  const resources=reverse?request.images.map(i=>({key:i.role,identity:i.role,occupied:true,kind:'image',fileName:i.name,mimeType:'image/png',dataUrl:i.dataUrl})):keys.map(key=>({key,identity:key,occupied:true,kind:'image',fileName:key+'.png',mimeType:'image/png'}));
  const current={modelId:'minimax_h3_local',mode:request.h3Mode,durationSeconds:request.durationSeconds,prompt:reverse?request.userPrompt:request.prompt,requirements:reverse?request.userRequirements:'',contentPolicy:request.contentPolicy,resources};
  const workflow=reverse?context.NovaFlowAiSequenceMiniMaxH3ReverseWorkflow:context.NovaFlowAiSequenceMiniMaxH3PromptWorkflow;
  const prepared=workflow.prepareRequest(current);
  const restored=workflow.validateAndRestore({text,context:prepared.context,current});
  if(!restored.text.startsWith('【任务定位】') || /integrated_multimodal_description:/.test(restored.text)) throw Error('legacy display leaked');
  return restored.text;
}
for(const file of fs.readdirSync(out).filter(f=>/^local-.*-result.json$/.test(f))) {
  const name=file.replace(/-result.json$/,'');const result=read(file);const request=read(name+'-request.json');
  if(!result.ok) throw Error(name+' failed');
  const text=restore(request,result.data.positivePrompt || result.data.output_text,name.includes('-reverse'));
  fs.writeFileSync(path.join(out,name+'-output.txt'),text);
  rows.push({name,ok:true,seconds:result.elapsedSeconds,chars:text.length});
}
for(const mode of ['image_video','first_last']) {
  const name=`grok-${mode}-reverse`; const request=read(`local-${mode}-reverse-request.json`);
  const built=buildGrokImageReverseRequest(request);let calls=0;
  const result=await callGrokResponseWithVisualRetry(built.body,built.inputMeta,built.resultOptions,async()=>({ok:true,data:grokResponsesPublicResult(read(`${name}-attempt-${++calls}.json`),built.resultOptions),providerCallCount:1}));
  const text=restore(request,result.data.output_text,true);fs.writeFileSync(path.join(out,name+'-output.txt'),text);
  rows.push({name,ok:true,seconds:read(name+'-result.json').elapsedMs/1000,calls,chars:text.length});
}
fs.writeFileSync(path.join(out,'matrix.json'),JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows));
