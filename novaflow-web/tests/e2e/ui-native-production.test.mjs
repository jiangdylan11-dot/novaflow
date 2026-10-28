import test from 'node:test';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cpuCatalog,UI_CATALOG_MODEL} from '../../worker/src/ui-catalog-planner.mjs';
import {planNativeUiDraft,NATIVE_UI_METHOD} from '../../worker/src/native-ui-draft.mjs';
const cpu=value=>cpuCatalog({python:process.env.NOVAFLOW_TEST_PYTHON||'python',serviceScript:fileURLToPath(new URL('../../../particle-editor-desktop/prompt-assistant-service.py',import.meta.url))},value);
const image={role:'layout',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAABACAIAAAD07OL5AAAAUklEQVR4nO3RsQ3AIBAEQUwhxI7df3GUsCQElmYKuJf2n/V+46Z5dX04cMAPkkRJoiRRkihJlCRKEiWJkkRJoiRRkihJlCRKEiWJkkRJovT/RBuGOwD4Dwr4YgAAAABJRU5ErkJggg=='};
const fixture=name=>JSON.parse(readFileSync(new URL('../fixtures/ui-native-'+name+'.json',import.meta.url),'utf8'));
const response=data=>({ok:true,json:async()=>data});
function transport(record,{fail='',cancelAfter=0}={}){
 const phases=['natural','grid','controls',...(record.raws.controls_focus?['controls_focus']:[]),'art',...(record.artRetryRaw?['artRetry']:[])];let count=0,cancelled=false;
 return {get count(){return count},get cancelled(){return cancelled},fetch:async(url,init)=>{
  const path=new URL(url).pathname;
  if(path==='/queue')return response({queue_running:[],queue_pending:[]});
  if(path==='/object_info/CLIPLoader')return response({CLIPLoader:{input:{required:{clip_name:[[UI_CATALOG_MODEL]]}}}});
  if(path==='/upload/image')return response({name:'current-view-'+Math.random()+'.png'});
  if(path==='/prompt'){count++;return response({prompt_id:'test-'+count});}
  if(path.startsWith('/history/')){
   const phase=phases[count-1],raw=phase==='art'?record.artRaw:phase==='artRetry'?record.artRetryRaw:record.raws[phase];
   if(cancelAfter===count)cancelled=true;
   return response({['test-'+count]:{status:{completed:true,status_str:fail===phase?'error':'success'},outputs:{'4':{text:[raw]}}}});
  }
  throw new Error('Unexpected endpoint '+path);
 }};
}
for(const name of ['twenty','nine'])test('formal native '+name+' replays real model responses with byte-identical compiler output',async()=>{
 const record=fixture(name),wire=transport(record);
 const result=await planNativeUiDraft({baseUrl:'http://runtime.test',payload:{images:[image],currentPrompt:record.request},cpu,fetchImpl:wire.fetch,pollMs:0});
 assert.equal(result.uiCatalog.recognitionMethod,NATIVE_UI_METHOD);
 assert.equal(result.uiCatalog.promptSha256,record.promptSha256);
 assert.equal(result.uiCatalog.sourceFocusCalls,name==='nine'?1:0);
 assert.equal(result.uiCatalog.modelFieldRepairCalls,0);
 assert.equal(wire.count,name==='nine'?5:4);
 assert.equal(result.uiCatalog.analysisProvider,'local');
});
test('source-only Grok branch keeps original flat contract and never calls art or a cloud service',async()=>{
 const record=fixture('twenty'),wire=transport(record);
 const result=await planNativeUiDraft({baseUrl:'http://runtime.test',payload:{images:[image],currentPrompt:record.request,uiAnalysisStage:'source-only'},cpu,fetchImpl:wire.fetch,pollMs:0});
 assert.equal(wire.count,3);assert.equal(result.prompt,undefined);
 const cloud=await cpu({action:'native-ui-cloud',bundle:result.bundle,images:[image]});
 assert.equal(cloud.stage,'layout-style-identity');assert.equal(cloud.allowRetry,false);assert.equal(cloud.maxOutputTokens,3072);
 assert.equal(cloud.outputSchema.required.length,14);assert(cloud.outputSchema.required.includes('ROTATION_ART'));assert(cloud.outputSchema.required.includes('SHARED_STRIP'));
 assert(Object.values(cloud.outputSchema.properties).every(x=>x.type==='string'));assert.equal(cloud.images[0].role,'layout');assert(cloud.images[0].sha256);assert(cloud.images[0].ref_id);
 assert.equal(cloud.systemInstruction,result.bundle.job.systemInstruction);
});
test('cancel stops later stages without interrupting shared runtime',async()=>{
 const record=fixture('twenty'),wire=transport(record,{cancelAfter:1});
 await assert.rejects(planNativeUiDraft({baseUrl:'http://runtime.test',payload:{images:[image],currentPrompt:record.request},cpu,fetchImpl:wire.fetch,pollMs:0,isCancelled:()=>wire.cancelled}),/中止/);
 assert.equal(wire.count,1);
});
test('failed analysis cannot fall back to an identity-preserving prompt or submit art',async()=>{
 const record=fixture('twenty'),wire=transport(record,{fail:'grid'});
 await assert.rejects(planNativeUiDraft({baseUrl:'http://runtime.test',payload:{images:[image],currentPrompt:record.request},cpu,fetchImpl:wire.fetch,pollMs:0}),/分析失败/);
 assert.equal(wire.count,2);
});

test('real renderer Grok selection routes source locally then one original flat cloud request, with no fallback',async()=>{
 const record=fixture('twenty'),wire=transport(record),calls=[];
 const root={setTimeout,clearTimeout,crypto:{randomUUID},NovaFlowWebRuntime:{auth:async(method,path,body)=>{
   calls.push({method,path,body});return {ok:true,model:'xai/grok-4.7',providerCallCount:1,retryCount:0,clientRequestId:body.requestId,requestId:'mock-cloud',finishReason:'completed',rawOutputText:record.artRaw};
 }}};
 root.electronAPI={promptAssistantUiDesignCpu:async body=>({ok:true,data:body.action==='capabilities'?{localCompletePlanner:'native-catalog-v3',sourceContract:'observed-rows-v2'}:await cpu(body)}),
 promptAssistantReverseImagePrompt:async payload=>({ok:true,data:await planNativeUiDraft({baseUrl:'http://runtime.test',payload,cpu,fetchImpl:wire.fetch,pollMs:0})})};
 vm.createContext(root);for(const name of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8'),root,{filename:name});
 const input={uiCatalogEnabled:true,engine:'grok',provider:'local',targetEngine:'qwen-2.1',prompt:'参考图1布局，霓虹都市主题老虎机',preserveLayout:true,generationIntent:'redesign',references:[{...image,id:'ref1'}],structure:{}};
 const result=await root.NovaFlowUiDesignAssistantWorkflow.run(input);
 assert.equal(wire.count,3);assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/client/runninghub/ui-catalog');assert.equal(calls[0].body.outputSchema.required.length,14);assert.equal(result.uiCatalog.model,'xai/grok-4.7');
 assert.equal(result.uiCatalog.analysisProvider,'grok');assert.equal(result.uiCatalog.layoutAnalysisProvider,'local');assert.equal(result.uiCatalog.recognitionMethod,'native-grok-catalog-v3');
 const second=transport(record);root.electronAPI.promptAssistantReverseImagePrompt=async payload=>({ok:true,data:await planNativeUiDraft({baseUrl:'http://runtime.test',payload,cpu,fetchImpl:second.fetch,pollMs:0})});
 root.NovaFlowWebRuntime.auth=async()=>{throw Error('provider denied');};
 await assert.rejects(()=>root.NovaFlowUiDesignAssistantWorkflow.run(input),/provider denied/);assert.equal(wire.count,3);assert.equal(second.count,3);
});

test('actual 2.0.80 zodiac failure replays to complete source and compiler without a new model focus',async()=>{
 const record=fixture('zodiac-actual'),wire=transport(record);
 const result=await planNativeUiDraft({baseUrl:'http://runtime.test',payload:{images:[image],currentPrompt:record.request,uiAnalysisStage:'source-only'},cpu,fetchImpl:wire.fetch,pollMs:0});
 const source=result.bundle.source;
 assert.equal(wire.count,3);assert.deepEqual(source.shape,[5,6]);assert.equal(source.rows.flat().length,30);
 assert.equal(source.portraits&&Object.keys(source.portraits).length,0);assert.deepEqual(source.mains,['M1']);assert.equal(source.main_positions.M1,'top');
 assert.equal(source.displays.filter(d=>d.position==='top').length,4);assert(source.shared.purchase.includes('BUY FREE GAME'));
 assert.equal(source.readouts.filter(r=>r[2]==='wallet').length,1);assert.equal(source.readouts.filter(r=>r[3]==='WIN').length,1);
 assert.equal(source.readouts[0][2],'wallet');assert.equal(source.readouts[4][3],'WIN');
 assert.deepEqual(source.aux.map(x=>x[1]),['声音','极速','自动','菜单']);assert(source.rotation);
 assert(source.rows[2][5].startsWith('O'));assert(source.rows[4][1].startsWith('O'));assert.notEqual(source.rows[2][5],source.rows[4][1]);
 assert.equal(source.rows[0][2],source.rows[3][5]);assert.equal(source.rows[2][4],'S:SUPER SCATTER');
 assert(result.bundle.job.output_keys.includes('MAIN_CHARACTER1'));assert(!result.bundle.job.output_keys.includes('CHARACTER1'));
 // Synthetic art below checks compiler support only; no generated image is claimed.
 const art=Object.fromEntries(result.bundle.job.output_keys.map(k=>[k,k.startsWith('OBJECT')?'名称：主题物件'+k+'；造型：主题物件'+k+'以朱红漆木和青玉组成完整独立图标。':k.startsWith('MAIN_CHARACTER')?'名称：生肖主角；主体：生肖主角身穿朱红锦袍，佩金玉饰，按原区域展示。':'朱红漆木与青玉构成统一的主题外观，功能标志清楚。']));
 const compiled=await cpu({action:'native-ui-compile',bundle:result.bundle,raw:JSON.stringify(art)});
 assert(compiled.prompt.includes('严格5行6列共30格'));assert(compiled.prompt.includes('网格上方独立人物区域'));assert(compiled.prompt.includes('原图没有这些身份的格内头像'));
 assert(compiled.prompt.includes('第4块标题'));assert(compiled.prompt.includes('主旋转'));assert(compiled.prompt.includes('SUPER SCATTER'));assert(compiled.prompt.includes('X500'));
});

test('same actual request missing art fields receives at most one whole-catalog retry and no invented design',async()=>{
 const record=fixture('zodiac-actual');delete record.raws.controls_focus;const wire=transport(record);
 const result=await planNativeUiDraft({baseUrl:'http://runtime.test',payload:{images:[image],currentPrompt:record.request},cpu,fetchImpl:wire.fetch,pollMs:0});
 assert.equal(wire.count,5);assert.equal(result.uiCatalog.artRetryCalls,1);assert.deepEqual(result.uiCatalog.artRetryProof.filledFromSameRequestModelOutput,['OBJECT13']);
 assert.equal(result.uiCatalog.artRetryProof.inventedArtValues,0);assert.equal(result.uiCatalog.catalog.OBJECT1,JSON.parse('{'+record.artRaw).OBJECT1);
 assert(result.prompt.includes('严格5行6列共30格'));assert(result.prompt.includes('名称仅用于绑定'));assert(result.prompt.includes('网格上方独立人物区域'));assert(result.prompt.includes('第4块标题'));
 assert(!result.prompt.includes('减号为缺口形朱红圆点'));assert(!result.prompt.includes('附着字面“BONUS”逐字印于简面'));
 record.artRetryRaw=record.artRaw;const failed=transport(record);
 await assert.rejects(()=>planNativeUiDraft({baseUrl:'http://runtime.test',payload:{images:[image],currentPrompt:record.request},cpu,fetchImpl:failed.fetch,pollMs:0}),/一次完整目录重试后仍缺字段/);assert.equal(failed.count,5);
});
