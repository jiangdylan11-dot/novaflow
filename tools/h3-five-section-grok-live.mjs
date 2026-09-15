import fs from 'node:fs';
import {createRequire} from 'node:module';
import {buildGrokPromptOptimizeRequest, normalizeMiniMaxH3PromptOutput, callGrokResponseWithVisualRetry} from '../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
const require=createRequire(import.meta.url);
const config=require('../particle-editor-desktop/license-admin-gui/admin-data.js').readAdminGrokEnv();
if(!config.apiKey) throw new Error('Grok provider is not configured');
const recovery=process.argv.includes('--recovery');
const out=new URL(recovery?'../docs/h3-recovery-validation/':'../docs/h3-five-section-validation/',import.meta.url);
const payload=JSON.parse(fs.readFileSync(new URL(recovery?'local-fl2v-optimize-request.json':'input.json',out),'utf8'));
if(!recovery) {
  payload.visualSchema='nf.h3.visual.v1';
  payload.contentPolicy={sensitiveVisualAnalysis:false,allSubjectsConfirmedAdult:false};
}
const built=buildGrokPromptOptimizeRequest(payload,config.model);
const started=Date.now(); let calls=0;
const result=await callGrokResponseWithVisualRetry(built.body,built.inputMeta,built.resultOptions,async body=>{
  calls++;
  const response=await fetch(config.baseUrl.replace(/\/$/,'')+'/responses',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});
  const data=await response.json();
  if(!response.ok) throw new Error('Grok HTTP '+response.status+': '+String(data.error?.message||'provider error'));
  const raw=data.output_text || (data.output||[]).flatMap(item=>item.content||[]).map(item=>item.text||'').join('\n');
  fs.writeFileSync(new URL(`grok-attempt-${calls}.txt`,out),raw);
  const prompt=normalizeMiniMaxH3PromptOutput(raw,built.resultOptions);
  return {ok:true,data:{output_text:prompt},providerCallCount:1};
});
fs.writeFileSync(new URL('grok-output.txt',out),result.data.output_text);
fs.writeFileSync(new URL('grok-result.json',out),JSON.stringify({ok:true,calls,elapsedMs:Date.now()-started,model:config.model},null,2));
console.log(JSON.stringify({ok:true,calls,elapsedMs:Date.now()-started,chars:result.data.output_text.length}));
