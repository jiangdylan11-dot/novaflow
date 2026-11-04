import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {mergeCapabilityOverrides,OPT_IN_KEYS} from '../supabase/functions/novaflow-companion/capability-overrides.mjs';
const source=readFileSync(new URL('../supabase/functions/novaflow-companion/index.ts',import.meta.url),'utf8');
const begin=source.indexOf('const envOnline=',source.indexOf('const createRequestPlane=')),end=source.indexOf('const operationV3Status=',begin);
assert.ok(begin>0&&end>begin);
function options(values){const sandbox={Deno:{env:{get:key=>values[key]}},parseCompanionOnlineOverlay:()=>undefined,mergeCapabilityOverrides,OPT_IN_KEYS,env:key=>key==='NOVAFLOW_SESSION_SECRET'?'synthetic-secret-only':String(values[key]||''),Buffer,createCompanionOperationV3Assembly:arg=>arg};return runInNewContext(`(()=>{${source.slice(begin,end)};return {v3Capabilities,operationV3};})()`,sandbox);}
test('actual companion request assembly applies trusted opt-ins but preserves explicit false and independent art/vision',()=>{
 const result=options({NOVAFLOW_XIAOTAO_V3_CAPABILITIES:JSON.stringify({operation:true,recovery:true,vision:true,art:false,videoRewrite:false}),NOVAFLOW_XIAOTAO_DECIMAL_V1:'true',NOVAFLOW_XIAOTAO_AUDIO_REWRITE_V1:'true',NOVAFLOW_XIAOTAO_VIDEO_REWRITE_V1:'true',NOVAFLOW_XIAOTAO_UI_DRAFT_V1:'true'});
 assert.equal(result.operationV3.enabled,true);assert.equal(result.operationV3.decimalCreditsEnabled,true);assert.equal(result.operationV3.visionEnabled,true);assert.equal(result.operationV3.audioRewriteEnabled,true);assert.equal(result.operationV3.videoRewriteEnabled,false);assert.equal(result.operationV3.uiDraftEnabled,true);assert.equal(result.v3Capabilities.art,false);
});
test('malformed or incomplete original configuration cannot be enabled by individual opt-in',()=>{
 for(const raw of ['{"operation":true,"operation":false}','{"operation":true,"recovery":false}','{}']){
  const result=options({NOVAFLOW_XIAOTAO_V3_CAPABILITIES:raw,NOVAFLOW_XIAOTAO_AUDIO_REWRITE_V1:'true'});assert.equal(result.operationV3.enabled,false);
 }
});
