import test from 'node:test';

import assert from 'node:assert/strict';

import vm from 'node:vm';

import { readFileSync } from 'node:fs';

import { createServer } from 'node:http';

import { fileURLToPath } from 'node:url';

import { planUiCatalog, buildUiCatalogGraph, parseCatalogObject, parseCatalogFields, UI_CATALOG_MODEL, cpuCatalog } from '../../worker/src/ui-catalog-planner.mjs';

import { createPromptAssistant } from '../../worker/src/prompt-assistant.mjs';



const source = { schema:'nf.ui.recognition.v2', grid:{ rows:1,columns:2,row_lengths:[2], cells:[{row:1,column:1,symbol_id:'o1',category:'o',literal:''},{row:1,column:2,symbol_id:'g1',category:'g',literal:'B'}] }, main_character_displays:{count:0,items:[]}, regions:{order:['play'],items:[{id:'play',kind:'grid',label:'玩法网格',container_ids:[]}],numeric_proportions:null},components:[],containers:[] };

const observedGrid={rows:1,columns:2,matrix:[['o|stone','g|B']]};
const observedBusiness={regions:['grid']};
const catalog = { ENVIRONMENT_ART:'清晨森林柔光。', OBJECT1:'名称：松果；造型：松果棕色鳞片层叠。', GLYPH_FAMILY:'木质字形清楚。' };

const images = [{ role:'layout', dataUrl:'data:image/png;base64,YWJj' }];

const payload = { surface:'ui-design',targetEngine:'qwen-2.1',uiPlanner:'structure-catalog-v1',uiDesignIntent:'redesign',uiPreserveLayout:true,currentPrompt:'更换为森林主题，保留布局',images };



function frontend() {

  const root = {setTimeout,clearTimeout}; vm.createContext(root);

  for (const file of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js']) vm.runInContext(readFileSync(new URL('../../renderer/'+file,import.meta.url),'utf8'),root);

  return root;

}

function mockRuntime({busy=false,fail=false}={}) {

  let posts=0, uploads=0;

  return {get posts(){return posts},get uploads(){return uploads},async fetch(url,init={}){

    const path=new URL(url).pathname;

    let value;

    if(path==='/queue') value={queue_running:busy?[[0,'other-video']]:[],queue_pending:[]};

    else if(path==='/object_info/CLIPLoader') value={CLIPLoader:{input:{required:{clip_name:[[UI_CATALOG_MODEL]]}}}};

    else if(path==='/upload/image') {uploads++;value={name:'original.png'};}

    else if(path==='/prompt') {posts++;const graph=JSON.parse(init.body).prompt;assert.equal(graph['1'].inputs.clip_name,UI_CATALOG_MODEL);assert.equal(graph['3'].inputs.max_length,posts<3?4096:6144);assert.equal(graph['3'].inputs.prompt.includes(payload.currentPrompt),posts===3);value={prompt_id:'pe-'+posts};}

    else if(path.startsWith('/history/')) value={[path.split('/').pop()]:{status:{completed:true,status_str:fail?'error':'success'},outputs:{4:{text:[JSON.stringify(posts===1?observedGrid:posts===2?observedBusiness:catalog)]}}}};

    else throw new Error('Unexpected runtime path '+path);

    return {ok:true,status:200,json:async()=>value};

  }};

}

const cpuConfig={python:process.env.NOVAFLOW_TEST_PYTHON || 'python',serviceScript:fileURLToPath(new URL('../../../particle-editor-desktop/prompt-assistant-service.py',import.meta.url))};



test('normal local catalog uses exact PE model, three analysis calls, dynamic source counts and CPU compilation',async()=>{

  const runtime=mockRuntime();

  const result=await planUiCatalog({baseUrl:'http://127.0.0.1:1',payload,cpu:value=>cpuCatalog(cpuConfig,value),fetchImpl:runtime.fetch,pollMs:1});

  assert.equal(runtime.posts,3);assert.equal(runtime.uploads,1);

  assert.match(result.prompt,/1行2列共2格/);assert.doesNotMatch(result.prompt,/BUY FREE GAMES|¥1000|三位/);

  assert.equal(result.uiCatalog.inventory.cells,2);assert.deepEqual(result.uiCatalog.promptIds,['pe-1','pe-2','pe-3']);

  assert.equal(result.uiCatalog.sources[0].sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

});

test('busy GPU and failed analysis never retry or start the next stage',async()=>{

  for(const options of [{busy:true},{fail:true}]){

    const runtime=mockRuntime(options);

    await assert.rejects(()=>planUiCatalog({baseUrl:'http://127.0.0.1:1',payload,cpu:async()=>({gridRules:'recognize',gridTask:'read the grid'}),fetchImpl:runtime.fetch,pollMs:1}));

    assert.equal(runtime.posts,options.busy?0:1);

  }

});

test('PE object extraction handles brace continuation without including trailing repeated prose',()=>{

  assert.deepEqual(parseCatalogObject('"name":"x"} extra'),{name:'x'});

  assert.deepEqual(parseCatalogObject('{"name":"{quoted}"} extra'),{name:'{quoted}'});

  assert.deepEqual(parseCatalogObject('"grid":{"shape":[1,2]},"components":[]}'),{grid:{shape:[1,2]},components:[]});

  assert.throws(()=>parseCatalogObject('unfinished'));

  const graph=buildUiCatalogGraph({system:'s',context:{},images:['a.png','b.png']});

  assert.equal(graph['13'].class_type,'ImageBatch');assert.deepEqual(graph['3'].inputs.image,['13',0]);

  assert.equal(graph['3'].inputs.prompt.split('<|image_pad|>').length-1,2);

});

test('UI entry preserves the exact compiled prompt and original reference bytes; cancel ignores a late result',async()=>{

  const root=frontend(),refs=[{id:'layout',role:'layout',dataUrl:images[0].dataUrl}],input={uiCatalogEnabled:true,provider:'local',engine:'local',targetEngine:'qwen-2.1',prompt:payload.currentPrompt,preserveLayout:true,generationIntent:'redesign',references:refs,structure:{},size:{width:960,height:2080}};

  let calls=0, release;

  const data={prompt:'已经编译的完整原文。',uiCatalog:{schema:'nf.ui.structure-catalog.v1',recognitionMethod:'staged-observation-v1'},uiPlan:{version:1,layoutMode:'preserve',layoutReference:1,visualMode:'theme-redesign',references:[{index:1,role:'layout'}],layoutChanges:[],preserve:[]}};

  const electronAPI={promptAssistantReverseImagePrompt:async req=>{calls++;assert.equal(req.uiPlanner,'structure-catalog-v1');return {ok:true,data};}};

  const result=await root.NovaFlowUiDesignAssistantWorkflow.run({...input,electronAPI});

  const compiled=root.NovaFlowUiDesignPromptPipeline.compileQwenPlan(result,input);

  assert.equal(compiled.prompt,data.prompt);assert.equal(compiled.references[0].dataUrl,refs[0].dataUrl);assert.equal(calls,1);

  const controller=new AbortController();

  const pending=root.NovaFlowUiDesignPromptPipeline.run({id:'cancel-catalog',input,signal:controller.signal,assistant:{run:()=>new Promise(resolve=>{release=resolve})}});

  await new Promise(resolve=>setTimeout(resolve,0));controller.abort();await assert.rejects(pending,{name:'AbortError'});release(data);

  let fresh=0;await root.NovaFlowUiDesignPromptPipeline.run({id:'cancel-catalog',input,assistant:{run:async()=>{fresh++;return data}}});assert.equal(fresh,1);

});

test('worker local lease rejects duplicate clicks while an analysis is pending',async()=>{

  let freeCalls=0, release;

  const server=createServer(async(req,res)=>{if(req.url==='/queue'){res.end(JSON.stringify({queue_running:[],queue_pending:[]}));return;}if(req.url==='/free'){freeCalls++;await new Promise(resolve=>{release=resolve});res.end('{}');return;}res.writeHead(404);res.end('{}');});

  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));

  try{

    const api=createPromptAssistant({worker:{getState:()=>({})},comfyUrls:['http://127.0.0.1:'+server.address().port]});

    const first=api.reverseImagePrompt(payload);while(!release)await new Promise(resolve=>setTimeout(resolve,1));

    const duplicate=await api.reverseImagePrompt(payload);assert.equal(duplicate.errorCode,'prompt-assistant-busy');assert.equal(freeCalls,1);

    release();await first;

  }finally{await new Promise(resolve=>server.close(resolve));}

});





test('layout reference clause does not turn the following whole-theme clause into a layout change',()=>{

  const root=frontend();root.window=root;root.document={body:{classList:{contains:()=>true}},querySelector:()=>null};

  for(const file of ['art-generate-model.resource.js','ui-design.drawing.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+file,import.meta.url),'utf8'),root);

  for(const separator of ['，','。','；',',',';','\n']) {

    const input=root.NovaFlowUiDesignDrawing.inputFor({state:{provider:'local',mode:'img2img',nsfw:false,prompt:'参考图1的布局'+separator+'完整重做为霓虹都市主题，重新设计业务组件'},references:[{id:'L',role:'layout',dataUrl:images[0].dataUrl}],referenceLimit:10});

    assert.equal(input.preserveLayout,true,separator);assert.equal(input.targetEngine,'qwen-2.1');assert.equal(input.uiCatalogEnabled,true);

  }

  const changed=root.NovaFlowUiDesignDrawing.inputFor({state:{provider:'local',mode:'img2img',nsfw:false,prompt:'将布局重新排版，完整重做为霓虹都市主题'},references:[{id:'L',role:'layout',dataUrl:images[0].dataUrl}],referenceLimit:10});

  assert.equal(changed.preserveLayout,false);

});





test('retained grid and business observations resume only after exact graph and original bytes checks',async()=>{
 const gridId='11111111-1111-4111-8111-111111111111',businessId='22222222-2222-4222-8222-222222222222';
 const rules=await cpuCatalog(cpuConfig,{action:'recognition-rules'});
 const graphs={
  [gridId]:buildUiCatalogGraph({system:rules.gridRules,context:rules.gridTask,images:['prior.png'],observation:true,maxLength:4096}),
  [businessId]:buildUiCatalogGraph({system:rules.businessRules,context:rules.businessTask,images:['prior.png'],observation:true,maxLength:4096})};
 let posts=0;
 const fetchImpl=async(url,init={})=>{
  const path=new URL(url).pathname;let value;
  if(path==='/view')return{ok:true,arrayBuffer:async()=>Buffer.from('abc')};
  if(path==='/queue')value={queue_running:[],queue_pending:[]};
  else if(path==='/object_info/CLIPLoader')value={CLIPLoader:{input:{required:{clip_name:[[UI_CATALOG_MODEL]]}}}};
  else if(path==='/upload/image')value={name:'new.png'};
  else if(path==='/prompt'){posts++;value={prompt_id:'art-only'};}
  else if(path==='/history/art-only')value={'art-only':{status:{completed:true,status_str:'success'},outputs:{4:{text:[JSON.stringify(catalog)]}}}};
  else if(path.startsWith('/history/')){const id=path.split('/').pop();value={[id]:{prompt:[0,id,graphs[id]],status:{completed:true,status_str:'success'},outputs:{4:{text:[JSON.stringify(id===gridId?observedGrid:observedBusiness)]}}}};}
  else throw Error(path);
  return{ok:true,status:200,json:async()=>value};
 };
 const resume={gridPromptId:gridId,businessPromptId:businessId};
 const result=await planUiCatalog({baseUrl:'http://127.0.0.1:1',payload:{...payload,uiCatalogResume:resume},cpu:value=>cpuCatalog(cpuConfig,value),fetchImpl,pollMs:1});
 assert.equal(posts,1);assert.deepEqual(result.uiCatalog.promptIds,[gridId,businessId,'art-only']);
 // Theme-independent source recognition is intentionally reusable for a new theme.
 await planUiCatalog({baseUrl:'http://127.0.0.1:1',payload:{...payload,currentPrompt:'a different theme request',uiCatalogResume:resume},cpu:value=>cpuCatalog(cpuConfig,value),fetchImpl,pollMs:1});assert.equal(posts,2);
 await assert.rejects(()=>planUiCatalog({baseUrl:'http://127.0.0.1:1',payload:{...payload,images:[{role:'layout',dataUrl:'data:image/png;base64,eHl6'}],uiCatalogResume:resume},cpu:value=>cpuCatalog(cpuConfig,value),fetchImpl,pollMs:1}),/原图字节不一致/);assert.equal(posts,2);
});

test('first complete catalog fields survive a repeated truncated suffix without art edits',()=>{

  const result=parseCatalogFields('"A":"one","B":"two","A":"replacement that never closes',['A','B']);

  assert.deepEqual(result.value,{A:'one',B:'two'});assert.equal(result.proof.artWordEdits,0);assert.ok(result.proof.suffixQuarantinedChars>0);

  assert.throws(()=>parseCatalogFields('"A":"one","B":"unfinished',['A','B']),/截断/);

});

test('typed main reference and exact glyph literals normalize without inventing text',async()=>{

  const recognized={grid:{shape:[1,2],cells:[{row:1,column:1,symbol_id:'g1',category:'g',literal:'J'},{row:1,column:2,symbol_id:'g2',category:'g',literal:'J'}]},main_character_displays:{count:0},regions:{order:['grid','controls']},components:[],containers:[{id:'controls',type:'main_control_and_auxiliary_group',main:'rotation',main_anchor:'center',auxiliary_order:[]}]};

  const job=await cpuCatalog(cpuConfig,{action:'design-job',source:recognized,request:'forest'});

  assert.equal(job.case.skeleton.grid.cells[0].symbol_id,job.case.skeleton.grid.cells[1].symbol_id);

  assert.equal(job.case.skeleton.components.length,1);assert.equal(job.case.skeleton.components[0].literal,'');assert.equal(job.case.skeleton.components[0].function,'rotation');

  const paired=structuredClone(source);paired.grid={shape:[1,1],cells:[{row:1,column:1,symbol_id:'p1',category:'p',literal:''}]};delete paired.schema;paired.regions={order:['grid','characters']};paired.main_character_displays={count:1};

  const identity=await cpuCatalog(cpuConfig,{action:'design-job',source:paired,request:'forest'});

  const compiled=await cpuCatalog(cpuConfig,{action:'compile',case:identity.case,catalog:{ENVIRONMENT_ART:'清晨树林。',CHARACTER1:'名称：行者；头像：黑发绿眼，面部清楚；全身：穿旅行外衣，站立完整。'}});

  assert.match(compiled.prompt,/行者/);assert.match(compiled.prompt,/黑发绿眼/);assert.match(compiled.prompt,/穿旅行外衣/);

});



test('only a complete final recognition JSON is usable; a reasoning draft cannot rescue a truncated final',()=>{
  assert.deepEqual(parseCatalogObject('{"draft":true}\n</think>\n{"final":true}'),{final:true});
  assert.throws(()=>parseCatalogObject('{"draft":true}\n</think>\n{"final":'),/完整 JSON/);
});

test('failed recognition retains its actual stage and task ID and never reaches art analysis',async()=>{
  const runtime=mockRuntime({fail:true});
  await assert.rejects(()=>planUiCatalog({baseUrl:'http://127.0.0.1:1',payload,cpu:async()=>({gridRules:'recognize',gridTask:'read the grid'}),fetchImpl:runtime.fetch,pollMs:1}),error=>{
    assert.equal(error.uiCatalogDiagnostics.stage,'grid-recognition');assert.deepEqual(error.uiCatalogDiagnostics.promptIds,['pe-1']);assert.equal(error.uiCatalogDiagnostics.samplingSubmitted,false);return true;
  });
  assert.equal(runtime.posts,1);
});

function sequenceRuntime(replies) {
 let posts=0;const graphs=[];
 return{graphs,get posts(){return posts;},async fetch(url,init={}){
  const path=new URL(url).pathname;let value;
  if(path==='/queue')value={queue_running:[],queue_pending:[]};
  else if(path==='/object_info/CLIPLoader')value={CLIPLoader:{input:{required:{clip_name:[[UI_CATALOG_MODEL]]}}}};
  else if(path==='/upload/image')value={name:'original.png'};
  else if(path==='/prompt'){graphs.push(JSON.parse(init.body).prompt);posts++;if(posts>replies.length)throw Error('Unexpected extra model call');value={prompt_id:'phase-'+posts};}
  else if(path.startsWith('/history/')){const id=path.split('/').pop(),reply=replies[Number(id.split('-').pop())-1];value={[id]:{status:{completed:true,status_str:'success'},outputs:{4:{text:[reply.raw||'']},5:{text:[reply.thinking||'']}}}};}
  else throw Error(path);
  return{ok:true,status:200,json:async()=>value};
 }};
}

test('fresh automatic pipeline bounds real-reasoning finalization and source-field repair to seven calls',async()=>{
 const business={regions:['panels|A;10|B;20','characters|half-body figure','shared_strip|purchase=BUY|information_readout=rule','readouts|numeric_readout=1|adjust_minus=-|numeric_readout=2|adjust_plus=+|numeric_readout=3','controls@bottom|sound=声音|speed=极速|rotation=|auto=自动|menu=菜单']};
 const anchors={before_grid:'characters',after_grid:'shared_strip',character_framing:'half',rotation_anchor:'center'};
 const job=await cpuCatalog(cpuConfig,{action:'merge-observed-job',grid:observedGrid,business,anchors,request:payload.currentPrompt});
 const art=Object.fromEntries(job.output_keys.map(key=>[key,key.startsWith('OBJECT')?'名称：松果'+key+'；造型：木色松果。':key.startsWith('MAIN_CHARACTER')?'名称：旅人；展示：原区域裁切和旅行服装。':key==='ENVIRONMENT_ART'?'童话森林环境。':'清楚的功能图形和字形。']));
 const runtime=sequenceRuntime([{thinking:'actual grid reasoning'},{raw:JSON.stringify(observedGrid).slice(1)},{thinking:'actual business reasoning'},{raw:JSON.stringify(business).slice(1)},{thinking:'actual anchor reasoning'},{raw:JSON.stringify(anchors).slice(1)},{raw:JSON.stringify(art)}]);
 const result=await planUiCatalog({baseUrl:'http://127.0.0.1:1',payload,cpu:value=>cpuCatalog(cpuConfig,value),fetchImpl:runtime.fetch,pollMs:1});
 assert.equal(runtime.posts,7);assert.equal(result.uiCatalog.anchorRepaired,true);assert.equal(result.uiCatalog.inventory.main_count,1);
 for(const [index,reasoning]of[[1,'actual grid reasoning'],[3,'actual business reasoning'],[5,'actual anchor reasoning']]){
  const input=runtime.graphs[index]['3'].inputs;assert.equal(input.max_length,1024);assert.equal(input.thinking,false);assert.ok(input.prompt.endsWith(reasoning+'\n</think>\n\n{'));
 }
 assert.ok(runtime.graphs.slice(0,6).every(g=>!g['3'].inputs.prompt.includes(payload.currentPrompt)));
 assert.ok(runtime.graphs[6]['3'].inputs.prompt.includes(payload.currentPrompt));
});

test('failed finalization stops at two calls and never reaches business, theme or image submission',async()=>{
 const runtime=sequenceRuntime([{thinking:'actual partial observation'},{raw:'"rows":'}]);
 await assert.rejects(()=>planUiCatalog({baseUrl:'http://127.0.0.1:1',payload,cpu:value=>cpuCatalog(cpuConfig,value),fetchImpl:runtime.fetch,pollMs:1}),/完整 JSON/);
 assert.equal(runtime.posts,2);
});

test('art extraction accepts field order without editing values and quarantines only unused art keys',()=>{
 const parsed=parseCatalogFields('"B":"two","OBJECT12":"unused","A":"one","A":"truncated',['A','B']);
 assert.deepEqual(parsed.value,{B:'two',A:'one'});assert.equal(parsed.proof.artWordEdits,0);assert.deepEqual(parsed.proof.ignoredFields,['OBJECT12']);
 assert.throws(()=>parseCatalogFields('"A":"one","A":"changed","B":"two"}',['A','B']),/重复/);
 assert.throws(()=>parseCatalogFields('"A":"one","rows":"5","B":"two"}',['A','B']),/未支持字段/);
});

test('an old node cannot silently return the former catalog implementation to the new UI',async()=>{
 const root=frontend();
 await assert.rejects(()=>root.NovaFlowUiDesignAssistantWorkflow.run({uiCatalogEnabled:true,provider:'local',engine:'local',targetEngine:'qwen-2.1',prompt:payload.currentPrompt,preserveLayout:true,generationIntent:'redesign',references:[{id:'L',role:'layout',dataUrl:images[0].dataUrl}],structure:{},electronAPI:{promptAssistantReverseImagePrompt:async()=>({ok:true,data:{prompt:'old result',uiCatalog:{schema:'nf.ui.structure-catalog.v1'}}})}}),/需要更新/);
});
