import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';

const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const start=source.indexOf('  async function selectedBusinessPrompt('),end=source.indexOf('  async function pooledPromptStatus(',start);
assert.ok(start>0&&end>start);
const code=source.slice(start,end);
const nodeId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function harness({owner=true,available=true,leaseBound=true,accept=true,selected=nodeId,changeOnConfirm=false}={}){
  const calls=[],events=new Map(),selection={provider:'local',modelId:'qwen3.5-9b-heretic',epoch:1};
  const controller={businessModelSnapshot:()=>({...selection}),subscribeBusinessModel:()=>()=>{}};
  const root={setTimeout,clearTimeout,addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n),NovaFlowXiaotaoArtAgent:{panel:{controller}}};
  const session=()=>true;session.expiresAtMs=Date.now()+60000;
  const scope={root,structuredClone,TextEncoder,TextDecoder,Map,Set,Date,Error,JSON,String,AbortController,Number,
    NODE_ID:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    captureFoartSessionGuard:()=>session,foartSessionObservers:new Set(),computeNode:selected?{id:selected}:null,computeNodeEpoch:0,
    taskMode:()=> 'shared',qwenBusinessAvailable:()=>true,pooledPromptRequests:new Map(),pooledConversationNodes:new Map(),tasks:new Map(),
    PROMPT_ASSISTANT_TIMEOUT_MS:1000,PROMPT_ASSISTANT_REFUSAL:'unavailable',
    control:async(method,url,body)=>{calls.push({method,url,body});if(url==='/api/web/nodes')return {nodes:[{id:nodeId,name:'自有节点',is_owner:owner,can_use:true,online:true}]};
      if(url==='/api/web/capabilities')return {features:{qwen35UiDraft:available,qwen35UiOwnerLeaseBound:leaseBound}};
      if(method==='POST'&&url==='/api/web/tasks')return {task:{id:'task-1'}};
      if(url==='/api/web/tasks/task-1/cancel')return {ok:true};throw Error('unexpected request');},
    putTaskInput:async(_id,_file,bytes,_type,guard)=>{guard.assertCurrent();calls.push({method:'PUT',url:'request.json',body:JSON.parse(new TextDecoder().decode(bytes))});},
    waitForTaskEnd:async()=>({}),fetchTaskOutput:async()=>new TextEncoder().encode(JSON.stringify({ok:true,draft:{status:'preview-only',applyAvailable:false,prompt:'draft',negativePrompt:'',sourceManifest:[]}}))};
  createContext(scope);runInContext(code+'\nglobalThis.invoke=selectedBusinessPrompt;',scope);
  const payload={assistantSelectionScope:'xiaotao',assistantProvider:'local',assistantModelId:selection.modelId,assistantSelectionEpoch:1,
    request:{requestId,revision:'a'.repeat(64),references:[{id:'1',role:'layout',dataUrl:'data:image/png;base64,YQ=='}]},isInputCurrent:()=>true,
    confirmNodeUpload:async info=>{calls.push({confirm:info});if(changeOnConfirm){scope.computeNodeEpoch++;events.get('novaflow:compute-node')?.();}return accept;}};
  return {scope,calls,payload};
}
test('owned explicit target requires consent before submitting and remains free Qwen scope',async()=>{
  const h=harness(),r=await h.scope.invoke('ui-draft-prompt',h.payload);assert.equal(r.ok,true);assert.equal(r.free,true);
  const c=h.calls.findIndex(x=>x.confirm),p=h.calls.findIndex(x=>x.url==='/api/web/tasks');assert.ok(c>=0&&p>c);
  assert.equal(h.calls[c].confirm.nodeName,'自有节点');assert.equal(h.calls[c].confirm.nodeIdSuffix,nodeId.slice(-8));
  assert.equal(h.calls[p].body.parameters.ui_scope,'qwen-ui-draft-v1');assert.equal(h.calls[p].body.parameters.model_id,'qwen3.5-9b-heretic');
  assert.equal(h.calls.find(x=>x.method==='PUT').body.request.references[0].role,'layout');
});
for(const [name,opts] of [['no target',{selected:null}],['shared target',{owner:false}],['no capability',{available:false}],['owner-bound lease missing',{leaseBound:false}],['declined',{accept:false}],['node changed',{changeOnConfirm:true}]]){
  test(name+' never submits or uploads',async()=>{const h=harness(opts),r=await h.scope.invoke('ui-draft-prompt',h.payload);assert.equal(r.ok,false);assert.ok(!h.calls.some(x=>x.url==='/api/web/tasks'||x.method==='PUT'));});
}
