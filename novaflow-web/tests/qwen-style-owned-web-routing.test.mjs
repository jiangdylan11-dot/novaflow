import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
const source=await readFile(process.env.FOART_STYLE_RUNTIME||new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const start=source.indexOf('  async function selectedBusinessPrompt('),end=source.indexOf('  async function pooledPromptStatus(',start);
assert.ok(start>0&&end>start);const code=source.slice(start,end);
const nodeId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function harness({owner=true,available=true,leaseBound=true,kinds,accept=true,selected=nodeId,changeOnConfirm=false,kind='style'}={}){
  const calls=[],events=new Map(),selection={provider:'local',modelId:'qwen3.5-9b-heretic',epoch:1};
  const controller={businessModelSnapshot:()=>({...selection}),subscribeBusinessModel:()=>()=>{}};
  const root={setTimeout,clearTimeout,addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n),NovaFlowXiaotaoArtAgent:{panel:{controller}}};
  const session=()=>true;session.expiresAtMs=Date.now()+60000;
  const scope={root,structuredClone,TextEncoder,TextDecoder,Map,Set,Date,Error,JSON,String,Array,AbortController,Number,
    NODE_ID:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    captureFoartSessionGuard:()=>session,foartSessionObservers:new Set(),computeNode:selected?{id:selected}:null,computeNodeEpoch:0,
    taskMode:()=> 'shared',qwenBusinessAvailable:()=>true,pooledPromptRequests:new Map(),pooledConversationNodes:new Map(),tasks:new Map(),
    PROMPT_ASSISTANT_TIMEOUT_MS:1000,PROMPT_ASSISTANT_REFUSAL:'unavailable',
    control:async(method,url,body)=>{calls.push({method,url,body});if(url==='/api/web/nodes')return {nodes:[{id:nodeId,name:'test node',is_owner:owner,can_use:true,online:true}]};
      if(url==='/api/web/capabilities')return {features:{qwen35StyleOwnerLeaseBound:leaseBound,qwen35StyleAnalysisKinds:kinds||{style:available,'aifx-material':available,'aifx-supplement':available}}};if(method==='POST'&&url==='/api/web/tasks')return {task:{id:'task-1'}};
      if(url==='/api/web/tasks/task-1/cancel')return {ok:true};throw Error('unexpected request');},
    putTaskInput:async(_id,_file,bytes,_type,guard)=>{guard.assertCurrent();calls.push({method:'PUT',url:'request.json',body:JSON.parse(new TextDecoder().decode(bytes))});},
    waitForTaskEnd:async()=>({}),fetchTaskOutput:async()=>new TextEncoder().encode(JSON.stringify({ok:true,model:'qwen35-heretic',modelIdentity:{id:'qwen35-heretic',verification:'server-weight-path'},resourcesReleased:true,...(kind==='style'?{style:'Ink: fine lines.'}:kind==='aifx-material'?{material:{name:'STAR',material:'made of stars'}}:{supplement:'more sparks'})}))};
  createContext(scope);runInContext(code+'\nglobalThis.invoke=selectedBusinessPrompt;',scope);
  const payload={requestId,assistantSelectionScope:'xiaotao',assistantProvider:'local',assistantModelId:selection.modelId,assistantSelectionEpoch:1,purpose:kind,
    ...(kind==='aifx-supplement'?{supplement:'more sparks'}:{name:'fixture.png',dataUrl:'data:image/png;base64,YQ=='}),isInputCurrent:()=>true,
    confirmNodeUpload:async info=>{calls.push({confirm:info});if(changeOnConfirm){scope.computeNodeEpoch++;events.get('novaflow:compute-node')?.();}return accept;}};
  return {scope,calls,payload};
}
for(const kind of ['style','aifx-material','aifx-supplement'])test('owned Qwen '+kind+' uses scoped task and exact payload',async()=>{
  const h=harness({kind}),r=await h.scope.invoke('describe-art-style',h.payload);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.free,true);
  const p=h.calls.find(x=>x.url==='/api/web/tasks'),upload=h.calls.find(x=>x.method==='PUT');assert.equal(p.body.parameters.style_scope,'qwen-style-analysis-v1');assert.equal(p.body.parameters.style_kind,kind);assert.equal(p.body.parameters.model_id,'qwen3.5-9b-heretic');assert.equal(upload.body.kind,kind);
  if(kind==='aifx-supplement'){assert.equal('image_upload_confirmed' in p.body.parameters,false);assert.equal('image' in upload.body,false);assert.ok(!h.calls.some(x=>x.confirm));}
  else {assert.equal(p.body.parameters.image_upload_confirmed,true);assert.equal(upload.body.image.role,kind==='style'?'style':'material');assert.equal(h.calls.find(x=>x.confirm).confirm.retentionHours,24);assert.equal(h.calls.find(x=>x.confirm).confirm.retentionGuarantee,false);assert.equal(h.calls.find(x=>x.confirm).confirm.storage,'owned-node-task-directory');assert.ok(h.calls.findIndex(x=>x.confirm)<h.calls.findIndex(x=>x.url==='/api/web/tasks'));}
});
for(const [name,options] of [['no target',{selected:null}],['other owner',{owner:false}],['no capability',{available:false}],['declined',{accept:false}],['node changed',{changeOnConfirm:true}]])test(name+' never creates or uploads',async()=>{
  const h=harness(options),result=await h.scope.invoke('describe-art-style',h.payload);assert.equal(result.ok,false);assert.ok(!h.calls.some(x=>x.url==='/api/web/tasks'||x.method==='PUT'));
});
test('missing owner-bound lease capability closes all image and text kinds',async()=>{
  for(const kind of ['style','aifx-material','aifx-supplement']){const h=harness({kind,leaseBound:false}),r=await h.scope.invoke('describe-art-style',h.payload);assert.equal(r.ok,false);assert.ok(!h.calls.some(x=>x.url==='/api/web/tasks'||x.method==='PUT'));}
});
test('Qwen supplement collapses whitespace before codepoint truncation',async()=>{
  const h=harness({kind:'aifx-supplement'});h.payload.supplement='小'+' '.repeat(500)+'星'+'😀'.repeat(500);
  const r=await h.scope.invoke('describe-art-style',h.payload);assert.equal(r.ok,true,JSON.stringify(r));const sent=h.calls.find(x=>x.method==='PUT').body.supplement;assert.ok(sent.startsWith('小 星'));assert.equal(Array.from(sent).length,400);
});
test('supplement capability cannot enable material or style',async()=>{
  for(const kind of ['style','aifx-material']){const h=harness({kind,kinds:{style:false,'aifx-material':false,'aifx-supplement':true}}),r=await h.scope.invoke('describe-art-style',h.payload);assert.equal(r.ok,false);assert.ok(!h.calls.some(x=>x.url==='/api/web/tasks'||x.method==='PUT'));}
});
