import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {createDomSandbox} from '../../worker/src/comfy/dom-shim.mjs';

const source=await readFile(new URL('../../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const modelId='qwen3.5-9b-heretic', node='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function page(options={}) {
  const requests=[],uploads=[];let currentFeature=Object.hasOwn(options,'feature')?options.feature:true;
  const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,Event,TextEncoder,TextDecoder,
    NOVAFLOW_WEB_CONFIG:{controlUrl:'https://control.test'},
    fetch:async(url,init={})=>{
      const target=String(url),method=init.method || 'GET';requests.push({target,method,body:init.body});
      if(target.includes('/api/web/capabilities'))return Response.json({taskTypes:[{task_type:'prompt_assistant',available_workers:options.nextWorkers ?? 1}],features:currentFeature===undefined?{}:{qwen35CpuTrial:currentFeature}});
      if(target.endsWith('/api/web/tasks') && method==='POST')return Response.json({task:{id:'task-1',status:'queued'}});
      if(target.endsWith('/api/web/tasks/task-1') && method==='GET')return Response.json({task:{id:'task-1',status:'completed',assigned_worker_id:node}});
      if(target.endsWith('/api/web/tasks/task-1/grant'))return Response.json({grant:{endpoint:'https://gateway.test',token:'fixture',expiresAt:new Date(Date.now()+120000).toISOString()}});
      if(target.includes('/input/request.json')){uploads.push(JSON.parse(new TextDecoder().decode(init.body)));return new Response('ok');}
      if(target.includes('/output/result.json'))return Response.json({ok:true,data:{reply:'ok',conversationId:'conversation-1',history:[]}});
      throw Error('unexpected fixture request: '+target);
    }});
  sandbox.localStorage.setItem('novaflow_web_session_v1',JSON.stringify({token:'fixture'}));runInContext(source,createContext(sandbox));
  return {sandbox,requests,uploads,setFeature:value=>{currentFeature=value;}};
}
const payload={provider:'local',mode:'chat',modelId,message:'你好',requestId:'qwen-request'};

test('missing or false Qwen capability stops before task creation, without switching routes',async()=>{
  for(const feature of [false,undefined]) {
    const p=page({feature}),result=await p.sandbox.electronAPI.artAgentChat(payload);
    assert.equal(result.ok,false);assert.match(result.error,/没有可用/);
    assert.equal(p.requests.filter(r=>r.target.endsWith('/api/web/tasks')).length,0);assert.equal(p.uploads.length,0);
  }
});
test('Qwen task and uploaded request carry matching IDs; Next retains its old task parameters',async()=>{
  const p=page();assert.equal((await p.sandbox.electronAPI.artAgentChat(payload)).ok,true);
  const post=p.requests.find(r=>r.target.endsWith('/api/web/tasks'));assert.deepEqual(JSON.parse(post.body).parameters,{action:'art-agent-chat',model_id:modelId});
  assert.equal(p.uploads[0].modelId,modelId);
  assert.equal((await p.sandbox.electronAPI.artAgentChat({provider:'local',mode:'chat',message:'Next'})).ok,true);
  const posts=p.requests.filter(r=>r.target.endsWith('/api/web/tasks'));assert.deepEqual(JSON.parse(posts[1].body).parameters,{action:'art-agent-chat'});
  assert.equal(p.uploads[1].modelId,undefined);
});
test('Qwen-only nodes accept Qwen without enabling the Next route',async()=>{
  const p=page({feature:true,nextWorkers:0});
  const status=await p.sandbox.electronAPI.promptAssistantGetStatus();assert.equal(status.result.available,false);assert.equal(status.result.features.qwen35CpuTrial,true);
  assert.equal((await p.sandbox.electronAPI.artAgentChat(payload)).ok,true);
  const post=p.requests.find(r=>r.target.endsWith('/api/web/tasks'));assert.equal(JSON.parse(post.body).parameters.model_id,modelId);
  const next=await p.sandbox.electronAPI.artAgentChat({provider:'local',mode:'chat',message:'Next'});
  assert.equal(next.ok,false);assert.equal(p.requests.filter(r=>r.target.endsWith('/api/web/tasks')).length,1);
});
test('Qwen conversation affinity checks its assigned node and refuses when that node loses capability',async()=>{
  const p=page();await p.sandbox.electronAPI.artAgentChat(payload);p.setFeature(false);
  const before=p.requests.length,result=await p.sandbox.electronAPI.artAgentChat({...payload,conversationId:'conversation-1'});
  assert.equal(result.ok,false);const next=p.requests.slice(before);
  assert.ok(next.some(r=>r.target.includes('/api/web/capabilities?worker='+node)));
  assert.equal(next.some(r=>r.target.endsWith('/api/web/tasks')),false);
});
test('capability status exposes only a strict true; a pinned node scopes the query',async()=>{
  const p=page();p.sandbox.NovaFlowWebRuntime.setComputeNode({id:node,name:'test'});
  const status=await p.sandbox.electronAPI.promptAssistantGetStatus();
  assert.equal(status.result.features.qwen35CpuTrial,true);assert.ok(p.requests.at(-1).target.endsWith('?worker='+node));
  p.setFeature(undefined);assert.equal((await p.sandbox.electronAPI.promptAssistantGetStatus()).result.features.qwen35CpuTrial,false);
});
test('a pinned Qwen node is checked and named on the submitted task',async()=>{
  const p=page();p.sandbox.NovaFlowWebRuntime.setComputeNode({id:node,name:'test'});
  assert.equal((await p.sandbox.electronAPI.artAgentChat(payload)).ok,true);
  assert.ok(p.requests.some(r=>r.target.endsWith('/api/web/capabilities?worker='+node)));
  const post=p.requests.find(r=>r.target.endsWith('/api/web/tasks'));
  assert.equal(JSON.parse(post.body).target_worker_id,node);assert.equal(JSON.parse(post.body).parameters.model_id,modelId);
});
test('switching the pinned node during preflight stops before creating a task',async()=>{
  let resolveCapabilities,posts=0;
  const pending=new Promise(resolve=>{resolveCapabilities=resolve;});
  const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,Event,TextEncoder,TextDecoder,
    NOVAFLOW_WEB_CONFIG:{controlUrl:'https://control.test'},fetch:async(url,init={})=>{
      if(String(url).includes('/api/web/capabilities'))return (await pending).clone();
      if(String(url).endsWith('/api/web/tasks') && init.method==='POST')posts++;
      throw Error('unexpected request');
    }});
  sandbox.localStorage.setItem('novaflow_web_session_v1',JSON.stringify({token:'fixture'}));runInContext(source,createContext(sandbox));
  sandbox.NovaFlowWebRuntime.setComputeNode({id:node,name:'first'});const request=sandbox.electronAPI.artAgentChat(payload);
  sandbox.NovaFlowWebRuntime.setComputeNode({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'second'});
  resolveCapabilities(Response.json({taskTypes:[{task_type:'prompt_assistant',available_workers:1}],features:{qwen35CpuTrial:true}}));
  const result=await request;assert.equal(result.ok,false);assert.match(result.error,/节点已切换/);assert.equal(posts,0);
});
