import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {normalizeCreditConfig} from '../packages/shared/src/feature-credits.mjs';
import {FOART_TOOL_SCHEMA,validateFoartPlan} from '../packages/shared/src/foart-tool-plan.mjs';

// Controller and storage integration with synthetic data; no browser profile,
// production account, model request or network access is used by this test.
const source=readFileSync(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
const CHAT_KEY='novaflow.xiaotao-art.chat.v1';
const plain=value=>JSON.parse(JSON.stringify(value));
function memoryStorage(initial=[]) {
  const values=new Map(initial);
  return {
    values,
    get length(){return values.size;},
    key:index=>[...values.keys()][index] ?? null,
    getItem:key=>values.get(key) ?? null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key)
  };
}
function fixture({local=memoryStorage(),session=memoryStorage(),respond,captureChat,extraApi={}}={}) {
  let surface='other',stopCalls=0;
  const payloads=[];
  const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,
    localStorage:local,sessionStorage:session,btoa:value=>Buffer.from(value,'binary').toString('base64')};
  root.window=root;
  root.NovaFlowXiaotaoUpload={inspectUpload:()=>({ok:true,kind:'image',mimeType:'image/png'}),
    inferTask:()=>null,planRoutes:()=>({place:[],reject:[]})};
  runInContext(source,createContext(root));
  const bridge={clearPrepared(){},async captureChat(options){return captureChat ? captureChat(options) : {artContext:{surface},images:[]};},capture(){throw Error('unexpected drawing capture');}};
  const owner={owner:'test-user',current:()=>true};
  const api=()=>({
    captureFoartBillingOwner:()=>owner,
    captureFoartSessionGuard:()=>()=>true,
    promptAssistantGetStatus:async()=>({ok:true,result:{features:{qwen35CpuTrial:true}}}),
    artAgentStop:async()=>{stopCalls++;return {ok:true};},
    artAgentChat:async payload=>{
      payloads.push(plain(payload));
      if(respond)return respond(payload);
      return {ok:true,data:{reply:'fixture reply',conversationId:'fixture-session',history:[...(payload.history||[]),{role:'user',content:payload.message},{role:'assistant',content:'fixture reply'}]}};
    },
    ...extraApi
  });
  const create=()=>root.NovaFlowXiaotaoArtAgent.createController({bridge,api});
  return {root,local,session,payloads,owner,create,get stopCalls(){return stopCalls;},setSurface:value=>{surface=value;}};
}
async function localReady(controller) {await controller.calibrateLocalStatus();}

test('one live controller keeps conversational context across surface and model changes',async()=>{
  const e=fixture(),controller=e.create();await localReady(controller);
  assert.equal(await controller.send('first-turn-marker'),true);
  e.setSurface('video');
  assert.equal(await controller.send('second-turn-marker'),true);
  assert.equal(e.payloads.at(-1).history.some(row=>row.content==='first-turn-marker'),true);
  assert.equal(controller.setModel('xai/grok-4.7'),true);
  assert.equal(controller.setModel('qwen3.5-9b-heretic'),true);
  assert.equal(controller.state.history.some(row=>row.content==='first-turn-marker'),true);
  assert.equal(controller.state.history.some(row=>row.content==='second-turn-marker'),true);
});

test('staged attachment stays in its current controller and does not enter a reopened session',async()=>{
  const e=fixture(),first=e.create();
  const file={name:'private-fixture.png',type:'image/png',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};
  assert.equal(await first.stageUploads([file]),true);
  assert.equal(first.state.staged.length,1);
  const reopened=e.create();assert.deepEqual(plain(reopened.state.staged),[]);
  await localReady(reopened);assert.equal(await reopened.send('fresh-turn-marker'),true);
  assert.deepEqual(e.payloads.at(-1).images,[]);
  assert.equal(JSON.stringify(e.payloads.at(-1)).includes('private-fixture.png'),false);
});

test('a late response in an old controller cannot become history for a newly opened one',async()=>{
  let resolveReply,called;
  const calledPromise=new Promise(resolve=>{called=resolve;});
  const response=new Promise(resolve=>{resolveReply=resolve;});
  const e=fixture({respond:()=>{called();return response;}}),first=e.create();await localReady(first);
  const pending=first.send('old-inflight-marker');await calledPromise;
  const reopened=e.create();
  try {assert.deepEqual(plain(reopened.state.messages),[]);}
  finally {
    resolveReply({ok:true,data:{reply:'late-private-reply',history:[{role:'assistant',content:'late-private-reply'}]}});
    await pending;
  }
  assert.deepEqual(plain(reopened.state.messages),[]);
  const next=e.create();assert.deepEqual(plain(next.state.messages),[]);assert.deepEqual(plain(next.state.history),[]);
  assert.equal([...e.local.values.values(),...e.session.values.values()].some(value=>String(value).includes('late-private-reply')),false);
});

test('retiring while an attachment is being read cannot stage it in a new session',async()=>{
  let releaseRead,readStarted;
  const reading=new Promise(resolve=>{releaseRead=resolve;});
  const started=new Promise(resolve=>{readStarted=resolve;});
  const e=fixture(),old=e.create();await localReady(old);
  const file={name:'old-session-attachment.png',type:'image/png',size:3,arrayBuffer:()=>{readStarted();return reading;}};
  const pending=old.stageUploads([file]);await started;
  let fresh;
  try {
    assert.equal(typeof old.retire,'function');
    await old.retire();fresh=e.create();
  } finally {
    releaseRead(new Uint8Array([1,2,3]).buffer);
    await pending;
  }
  assert.deepEqual(plain(fresh.state.staged),[]);
  assert.deepEqual(plain(fresh.state.messages),[]);
  assert.equal(await old.send('retired-attachment-send-marker'),false);
  assert.equal(e.payloads.length,0);
  assert.equal([...e.local.values.values(),...e.session.values.values()].some(value=>String(value).includes('old-session-attachment.png')),false);
});

test('retiring during context capture prevents a not-yet-sent provider request',async()=>{
  let releaseCapture,captureStarted;
  const waiting=new Promise(resolve=>{releaseCapture=resolve;});
  const started=new Promise(resolve=>{captureStarted=resolve;});
  const e=fixture({captureChat:()=>{captureStarted();return waiting;}}),old=e.create();await localReady(old);
  const pending=old.send('pre-dispatch-context-marker');await started;
  let fresh;
  try {
    assert.equal(typeof old.retire,'function');
    await old.retire();fresh=e.create();
  } finally {
    releaseCapture({artContext:{surface:'other'},images:[]});
    await pending;
  }
  assert.equal(e.payloads.length,0);
  assert.deepEqual(plain(fresh.state.messages),[]);
  assert.deepEqual(plain(fresh.state.history),[]);
});

test('retiring after dispatch does not cancel submitted work or contaminate the new session',async()=>{
  let releaseReply,dispatchStarted;
  const waiting=new Promise(resolve=>{releaseReply=resolve;});
  const started=new Promise(resolve=>{dispatchStarted=resolve;});
  const e=fixture({respond:()=>{dispatchStarted();return waiting;}}),old=e.create();await localReady(old);
  const pending=old.send('already-dispatched-marker');await started;
  let fresh;
  try {
    assert.equal(typeof old.retire,'function');
    await old.retire();fresh=e.create();
    assert.equal(e.stopCalls,0);
  } finally {
    releaseReply({ok:true,data:{reply:'late-completion-marker',history:[{role:'assistant',content:'late-completion-marker'}]}});
    await pending;
  }
  assert.equal(e.stopCalls,0);
  assert.deepEqual(plain(fresh.state.messages),[]);
  assert.deepEqual(plain(fresh.state.history),[]);
  assert.equal([...e.local.values.values(),...e.session.values.values()].some(value=>String(value).includes('late-completion-marker')),false);
});

test('retiring a dispatched operation does not invoke the provider cancellation path',async()=>{
  let releaseStart,dispatchStarted,cancels=0,signal;
  const waiting=new Promise(resolve=>{releaseStart=resolve;});
  const started=new Promise(resolve=>{dispatchStarted=resolve;});
  const config=normalizeCreditConfig({});
  Object.assign(config.xiaotao_online,{billing_scope:'operation',minimum_positive_credits:1,operation_text_chat_v3:true,operation_foart_open_v3:true});
  const policy={version:'sha256:'+'a'.repeat(64),expiresAt:Date.now()+60000,defaultModel:'xai/grok-4.7',config,models:[{id:'xai/grok-4.7',available:true}]};
  const e=fixture({extraApi:{
    companionPricing:async()=>({ok:true,policy}),
    foartOperationStart:async payload=>{signal=payload.signal;dispatchStarted();return waiting;},
    foartOperationCancel:async()=>{cancels++;return {ok:true};}
  }});
  e.root.NovaFlowXiaotaoUpload.inferTask=()=>({surface:'animation',discussion:false,revision:false,named:[]});
  e.root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA,validateFoartPlan,foartAnimationExportAllowed:()=>true,foartUnsupportedMediaAnalysis:()=>false};
  e.root.NovaFlowFoartTools={setUploads(){},capture:()=>({schema:FOART_TOOL_SCHEMA,controls:[]}),settlePending:async()=>null,images:async()=>[],execute:async()=>{throw Error('retired operation must not execute a new tool');}};
  const old=e.create();assert.equal(old.setModel('xai/grok-4.7'),true);await old.refreshPricingPolicy();
  const pending=old.send('\u6253\u5f00\u52a8\u753b\u6a21\u5757');
  const outcome=await Promise.race([started.then(()=>({started:true})),pending.then(result=>({started:false,result}))]);
  assert.equal(outcome.started,true,'the test must reach an actual operation dispatch');
  let fresh;
  try {
    assert.equal(typeof old.retire,'function');await old.retire();fresh=e.create();
    assert.equal(signal?.aborted,false);assert.equal(cancels,0);
  } finally {
    releaseStart({ok:true,data:{toolPlan:{schema:FOART_TOOL_SCHEMA,status:'act',reply:'open',operations:[{action:'open',surface:'animation'}]},foartOperationSession:{opaque:true}}});
    await pending;
  }
  assert.equal(cancels,0,'retiring must not cancel an already dispatched operation');
  assert.equal(signal?.aborted,false);
  assert.deepEqual(plain(fresh.state.messages),[]);
});

test('retiring during an already-started tool does not cancel its operation session',async()=>{
  let releaseExecute,executeStarted,cancels=0,resumes=0,signal;
  const waiting=new Promise(resolve=>{releaseExecute=resolve;});
  const started=new Promise(resolve=>{executeStarted=resolve;});
  const config=normalizeCreditConfig({});
  Object.assign(config.xiaotao_online,{billing_scope:'operation',minimum_positive_credits:1,operation_text_chat_v3:true,operation_foart_open_v3:true});
  const policy={version:'sha256:'+'a'.repeat(64),expiresAt:Date.now()+60000,defaultModel:'xai/grok-4.7',config,models:[{id:'xai/grok-4.7',available:true}]};
  const e=fixture({extraApi:{
    companionPricing:async()=>({ok:true,policy}),
    foartOperationStart:async()=>({ok:true,data:{toolPlan:{schema:FOART_TOOL_SCHEMA,status:'act',reply:'open',operations:[{action:'open',surface:'animation'}]},foartOperationSession:{opaque:true}}}),
    foartOperationCancel:async()=>{cancels++;return {ok:true};},
    foartOperationResume:async()=>{resumes++;return {ok:false};}
  }});
  e.root.NovaFlowXiaotaoUpload.inferTask=()=>({surface:'animation',discussion:false,revision:false,named:[]});
  e.root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA,validateFoartPlan,foartAnimationExportAllowed:()=>true,foartUnsupportedMediaAnalysis:()=>false};
  e.root.NovaFlowFoartTools={setUploads(){},capture:()=>({schema:FOART_TOOL_SCHEMA,controls:[]}),settlePending:async()=>null,images:async()=>[],execute:async(_operation,context)=>{signal=context.signal;executeStarted();return waiting;}};
  const old=e.create();assert.equal(old.setModel('xai/grok-4.7'),true);await old.refreshPricingPolicy();
  const pending=old.send('\u6253\u5f00\u52a8\u753b\u6a21\u5757');
  const outcome=await Promise.race([started.then(()=>({started:true})),pending.then(result=>({started:false,result}))]);
  assert.equal(outcome.started,true,'the test must reach an actual tool execution');
  let fresh;
  try {
    await old.retire();fresh=e.create();
    assert.equal(signal?.aborted,false);assert.equal(cancels,0);
  } finally {
    releaseExecute({action:'open',phase:'opened',surface:'animation',message:'opened'});
    await pending;
  }
  assert.equal(cancels,0,'retiring must not cancel an already-started operation session');
  assert.equal(signal?.aborted,false);
  assert.equal(resumes,0,'retired controller must not start a follow-up provider request');
  assert.deepEqual(plain(fresh.state.messages),[]);
});
test('a reopened controller starts empty and nothing is written to browser storage',async()=>{
  const e=fixture();const first=e.create();await localReady(first);await first.send('hello');
  assert.equal(first.state.messages.length>0,true);
  assert.equal(Array.from({length:e.local.length},(_,i)=>e.local.key(i)).some(key=>key.includes('xiaotao')),false);
  const reopened=e.create();assert.deepEqual([...reopened.state.messages],[]);assert.deepEqual([...reopened.state.billingNotices||[]],[]);
});
