import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import { buildNaturalDraftGraph, planNaturalUiDraft, parseNaturalDraft, naturalDraftDesignInput } from '../../worker/src/natural-ui-draft.mjs';

const model='qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors';
const payload={currentPrompt:'参考布局，白雪公主主题',images:[{role:'layout',dataUrl:'data:image/png;base64,YWJj'}]};
function runtime({busy=false,bad=false}={}){
 const graphs=[];let uploads=0;
 return {graphs,get uploads(){return uploads;},fetch:async(url,init={})=>{
  const u=new URL(url);let result;
  if(u.pathname==='/queue')result={queue_running:busy?[[0,'other-task']]:[],queue_pending:[]};
  else if(u.pathname==='/object_info/CLIPLoader')result={CLIPLoader:{input:{required:{clip_name:[[model]]}}}};
  else if(u.pathname==='/upload/image'){uploads++;result={name:'fresh.png'};}
  else if(u.pathname==='/prompt'){graphs.push(JSON.parse(init.body).prompt);result={prompt_id:'fresh-'+graphs.length};}
  else if(u.pathname.startsWith('/history/')){const id=u.pathname.split('/').at(-1);result={[id]:{status:{completed:true,status_str:'success'},outputs:{'4':{text:[graphs.length===1?'区域关系：上方主角，中部玩法网格。\n网格：五行六列。':bad?'unterminated':'完整的新主题设计稿。"}']}}}};}
  else throw Error('Unexpected route '+u.pathname);
  return {ok:true,json:async()=>result};
 }};
}
const cpu=async value=>{
 if(value.action==='natural-draft-image')return {dataUrl:'data:image/png;base64,YWJj',proof:{originalSha256:'source',recognitionSize:[672,1456]}};
 if(value.action==='natural-draft-project')return {design_layout_zh:value.raw,warnings:[],source_receipts:[]};
 throw Error('Unexpected CPU action');
};

test('design retains the accepted identity/per-cell task, dynamic theme/style and every original requirement',()=>{
 const p={design_layout_zh:'真实结构',warnings:['不确定']};
 for(const [request,theme,style]of[
  ['参考图1布局，创作奇幻森林主题的老虎机，手绘厚涂游戏美术。','奇幻森林','手绘厚涂游戏美术'],
  ['@参考图1参考布局。换成迪士尼风格，白雪公主主题的老虎机','白雪公主','迪士尼风格'],
  ['参考@参考图1布局，做一个白雪公主主题的老虎机','白雪公主','手绘厚涂游戏美术']]){
  const x=naturalDraftDesignInput(request,p);
  assert.equal(x.context.theme,theme);assert.equal(x.context.style_request,style);
  assert.equal(x.context.layout_zh,p.design_layout_zh);
  assert.ok(x.context.task.includes('每对头像/格外全身共享各自一个身份锚点'));
  assert.ok(x.system.includes('并逐格安排在给定网格内'));
  assert.ok(!x.system.includes('本组主题与全部用户要求'));
 }
 const extra=naturalDraftDesignInput('参考图1布局，冰雪主题，水彩风格，不要武器，角色穿长裙',p);
 assert.ok(extra.context.user_requirements.includes('不要武器'));assert.ok(extra.context.user_requirements.includes('角色穿长裙'));
});

test('restored graph uses the tested short budgets, closed thinking and a text-only single-field design',()=>{
 const read=buildNaturalDraftGraph({system:'observe',user:'read',image:'L.png'});
 assert.equal(read['3'].inputs.max_length,768);assert.equal(read['3'].inputs.thinking,false);
 assert.ok(read['3'].inputs.prompt.endsWith('<think>\n\n</think>\n\n'));
 const design=buildNaturalDraftGraph({system:'design',user:'neutral',design:true});
 assert.equal(design['3'].inputs.max_length,1536);assert.equal(design['3'].inputs.thinking,false);
 assert.ok(design['3'].inputs.prompt.endsWith('{"rewritten_prompt":"'));
 assert.equal(design['3'].inputs.image,undefined);assert.equal(design['10'],undefined);
 assert.equal(read['1'].inputs.clip_name,model);
});

test('fresh automatic path submits exactly two calls and never sends original visuals to design',async()=>{
 const r=runtime();const result=await planNaturalUiDraft({baseUrl:'http://127.0.0.1:1',payload,cpu,fetchImpl:r.fetch,pollMs:1});
 assert.equal(r.graphs.length,2);assert.equal(r.uploads,1);assert.equal(result.prompt,'完整的新主题设计稿。');
 assert.equal(result.uiDraft.providerCallCount,2);assert.equal(result.uiDraft.method,'natural-structure-draft-v1');
 assert.equal(result.uiDraft.extraction.artWordEdits,0);assert.equal(result.uiCatalog,undefined);
 assert.ok(r.graphs[1]['3'].inputs.prompt.includes('白雪公主'));assert.equal(result.uiDraft.originalRequirements,payload.currentPrompt);
 assert.ok(!r.graphs[1]['3'].inputs.prompt.includes('<|vision_start|>'));
 assert.deepEqual(result.uiPlan.references,[{index:1,role:'layout'}]);
});

test('busy queues, old-answer injection and invalid projection never reach a design call',async()=>{
 const busy=runtime({busy:true});await assert.rejects(()=>planNaturalUiDraft({baseUrl:'http://127.0.0.1:1',payload,cpu,fetchImpl:busy.fetch}),/其他任务/);assert.equal(busy.graphs.length,0);
 const resumed=runtime();await assert.rejects(()=>planNaturalUiDraft({baseUrl:'http://127.0.0.1:1',payload:{...payload,uiCatalogResume:{}},cpu,fetchImpl:resumed.fetch}),/旧分析答案/);assert.equal(resumed.graphs.length,0);
 const failed=runtime();await assert.rejects(()=>planNaturalUiDraft({baseUrl:'http://127.0.0.1:1',payload,cpu:async v=>v.action==='natural-draft-image'?cpu(v):Promise.reject(Error('invalid source')),fetchImpl:failed.fetch}),e=>e.uiDraftDiagnostics.stage==='neutral-projection'&&e.uiDraftDiagnostics.promptIds.length===1);assert.equal(failed.graphs.length,1);
});

test('truncated design stops after two calls; complete text is retained verbatim',async()=>{
 const r=runtime({bad:true});await assert.rejects(()=>planNaturalUiDraft({baseUrl:'http://127.0.0.1:1',payload,cpu,fetchImpl:r.fetch,pollMs:1}),/不完整/);assert.equal(r.graphs.length,2);
 const parsed=parseNaturalDraft('原文\\n第二行。"} ignored suffix');assert.equal(parsed.prompt,'原文\n第二行。');assert.equal(parsed.extraction.artWordEdits,0);
 assert.throws(()=>parseNaturalDraft('text </think> draft'),/完整设计稿/);
});

test('fast compilation keeps layout first and preserves all other image roles without rewriting the design',()=>{
 const root={console};root.window=root;vm.createContext(root);
 vm.runInContext(readFileSync(new URL('../../renderer/ui-design-prompt.pipeline.js',import.meta.url),'utf8'),root);
 const refs=[{id:'style',role:'style',dataUrl:'style-bytes'},{id:'layout',role:'layout',dataUrl:'layout-bytes'},{id:'content',role:'content',dataUrl:'asset-bytes'}];
 const plan={version:1,layoutMode:'preserve',layoutReference:2,visualMode:'theme-redesign',references:[{index:1,role:'style'},{index:2,role:'layout'},{index:3,role:'content'}],layoutChanges:[],preserve:[],grids:[]};
 const result=root.NovaFlowUiDesignPromptPipeline.compileQwenPlan({prompt:'原始设计稿不改字。',uiDraft:{method:'natural-structure-draft-v1'},uiPlan:plan},{engine:'local',generationIntent:'redesign',preserveLayout:true,references:refs});
 assert.equal(result.prompt,'原始设计稿不改字。');assert.equal(result.references[0].id,'layout');assert.equal(result.references[1].id,'style');assert.equal(result.references[2].id,'content');
 assert.equal(result.plan.layoutReference,1);assert.equal(result.analysisPlan.layoutReference,2);assert.equal(result.plan.references[1].role,'style');
});
