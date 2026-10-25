import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {createDomSandbox} from '../../worker/src/comfy/dom-shim.mjs';
const source=await readFile(new URL('../../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture(local,fetcher){
  const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,Event,
    location:{hash:local?'#local-pair='+'a'.repeat(64):'',pathname:'/',search:''},history:{replaceState(){}},
    sessionStorage:{getItem:()=>null,setItem(){}},
    NOVAFLOW_WEB_CONFIG:{localAssistant:local,localOrigin:'http://127.0.0.1:4784',controlUrl:'https://control.test'},fetch:fetcher});
  sandbox.localStorage.setItem('novaflow_web_session_v1',JSON.stringify({token:'fixture-session'}));
  runInContext(source,createContext(sandbox));return sandbox.electronAPI;
}
test('cancel bridge forwards only the exact request ID to the paired local assistant',async()=>{
  const calls=[],api=fixture(true,async(url,init)=>{calls.push({url:String(url),init});return Response.json({ok:true,cancelled:true});});
  const result=await api.promptAssistantCancelRequest({requestId:'art-direction-owned',ignored:'never forward'});
  assert.equal(result.ok,true);const cancels=calls.filter(c=>c.url.endsWith('/cancel-request'));assert.equal(cancels.length,1);
  assert.equal(cancels[0].url,'http://127.0.0.1:4784/local/prompt-assistant/cancel-request');
  assert.deepEqual(JSON.parse(cancels[0].init.body),{requestId:'art-direction-owned'});
  assert.equal(cancels[0].init.headers.Authorization,undefined);
  assert.equal((await api.promptAssistantCancelRequest({})).ok,false);assert.equal(calls.filter(c=>c.url.endsWith('/cancel-request')).length,1);
});
test('cancelling a pooled analysis while capabilities load prevents a late task from being created',async()=>{
  const entered=deferred(),gate=deferred(),calls=[];
  const api=fixture(false,async(url,init)=>{calls.push({url:String(url),init});if(String(url).endsWith('/capabilities')){entered.resolve();await gate.promise;return Response.json({taskTypes:[{task_type:'prompt_assistant',available_workers:1}]});}assert.fail('Cancelled request must not create/upload a task');});
  const pending=api.promptAssistantReverseImagePrompt({requestId:'pooled-before-create',images:[]});await entered.promise;
  assert.equal((await api.promptAssistantCancelRequest({requestId:'pooled-before-create'})).matched,true);
  gate.resolve();assert.equal((await pending).ok,false);assert.ok(calls.every(c=>c.url.endsWith('/capabilities')));
});
test('cancelling during pooled task creation cancels only that exact task and never uploads it',async()=>{
  const entered=deferred(),gate=deferred(),calls=[];
  const api=fixture(false,async(url,init)=>{const path=new URL(String(url)).pathname;calls.push({path,init});
    if(path.endsWith('/capabilities'))return Response.json({taskTypes:[{task_type:'prompt_assistant',available_workers:1}]});
    if(path==='/api/web/tasks'){entered.resolve();await gate.promise;return Response.json({task:{id:'owned-pooled-task',status:'queued'}});}
    if(path==='/api/web/tasks/owned-pooled-task/cancel')return Response.json({ok:true});
    assert.fail('Only the owned task cancellation is allowed: '+path);
  });
  const pending=api.promptAssistantReverseImagePrompt({requestId:'pooled-create-race',images:[]});await entered.promise;
  await api.promptAssistantCancelRequest({requestId:'pooled-create-race'});gate.resolve();assert.equal((await pending).ok,false);
  assert.deepEqual(calls.filter(c=>!c.path.endsWith('/capabilities')).map(c=>c.path),['/api/web/tasks','/api/web/tasks/owned-pooled-task/cancel']);
});
