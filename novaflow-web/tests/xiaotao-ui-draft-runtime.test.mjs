import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

// Synthetic runtime harness: no production account, provider, network or DB.
const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('  // Operation-v3 can use'),source.indexOf('  const XIAOTAO_ONLINE_ART_RELEASE_ENABLED'));
const start=source.indexOf('  async function selectedOnlineUiDraft('),end=source.indexOf('  async function prepareOnlineStyleImage(',start);
assert.ok(start>0&&end>start);
const id='11111111-1111-4111-8111-111111111111',operationId='22222222-2222-4222-8222-222222222222';
const model='deepseek/deepseek-v4.1-flash',policyVersion='sha256:'+'c'.repeat(64);
const png='data:image/png;base64,iVBORw0KGgo=';

function fixture({refs=[],vision=false,uiDraft=true,allowed=true,upload=true,quote=true,mutate=false,stale=false}={}) {
  const events=[],used=new Set(),pending=new Map(),observers=new Set(),listeners=new Set(),recovery=new Map();let inputCurrent=true;
  const selection={provider:'api',modelId:model,epoch:0};
  const controller={businessModelSnapshot:()=>({...selection}),subscribeBusinessModel(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const root={crypto:webcrypto,NovaFlowXiaotaoArtAgent:{panel:{controller}}};
  const terms={billing_scope:'operation',minimum_positive_credits:0,credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',operation_ui_draft_v3:uiDraft,operation_vision_chat_v3:vision};
  const policy={version:policyVersion,expiresAt:Date.now()+60000,models:[{id:model,available:allowed}],config:{xiaotao_online:terms}};
  const guard=()=>true;guard.expiresAtMs=Date.now()+60000;
  const scope={root,structuredClone,Date,JSON,Object,String,Number,Array,Error,Promise,RegExp,BigInt,AbortController,setTimeout,clearTimeout,
    CONFIG:{companionUrl:'https://example.invalid',authUrl:'https://example.invalid'},
    validOperationId:value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||''),
    notifyAccountBalance:()=>events.push('balance'),
    onlineOperationModel:value=>value===model,companionCloudRequests:pending,companionCloudUsed:used,foartSessionObservers:observers,
    captureFoartBillingOwner:()=>({current:()=>true}),captureFoartSessionGuard:()=>guard,companionPricing:async()=>({ok:true,policy}),
    api:async(_base,_method,path,body)=>{
      if(path.endsWith('/prepare')){events.push('prepare');assert.equal(body.intent.request.references.length,refs.length);return {ok:true,operation:{model,policyVersion,operationId,token:'synthetic-ticket',intentHash:'a'.repeat(64),estimatedCredits:0.002,outputTokens:2048}};}
      if(path.endsWith('/execute')){events.push('execute');assert.equal(body.intent.request.references.length,refs.length);return {ok:true,model,receipt:{status:'settled',outcome:'success',charged:0.000539,uncollected:0},uiDraft:{status:'preview-only',applyAvailable:false,prompt:'synthetic UI draft'}};}
      throw Error('unexpected isolated route '+path);
    }};
  createContext(scope);runInContext(helpers+source.slice(start,end)+'\nglobalThis.invoke=selectedOnlineUiDraft;',scope);
  const payload={request:{requestId:id,references:refs},assistantSelectionScope:'xiaotao',assistantProvider:'api',assistantModelId:model,assistantSelectionEpoch:0,
    isInputCurrent:()=>inputCurrent,confirmImageUpload:async({images,count})=>{events.push('upload-confirm');assert.equal(count,refs.length);if(mutate)images[0].dataUrl='data:image/png;base64,AAAA';if(stale)inputCurrent=false;return upload;},
    onPricingQuote:()=>events.push('quote-shown'),confirmPricingQuote:async()=>{events.push('quote-confirm');return quote;},onBillingNotice:notice=>{events.push('billing');assert.equal(notice.quota.settled_credits,0.000539);return true;}};
  return {events,recovery,run:()=>scope.invoke(payload,{...selection},controller)};
}

test('text-only UI needs UI policy, not vision or image upload confirmation',async()=>{
  const f=fixture({vision:false}),result=await f.run();assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.quota.settled_credits,0.000539);
  assert.deepEqual(f.events,['prepare','quote-shown','quote-confirm','execute','balance','billing']);
  assert.equal((await f.run()).ok,false);assert.equal(f.events.filter(x=>x==='execute').length,1);
});

test('reference image requires model and both policies and explicit upload before prepare',async()=>{
  const refs=[{role:'subject',dataUrl:png}];
  const f=fixture({refs,vision:true}),result=await f.run();assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(f.events,['upload-confirm','prepare','quote-shown','quote-confirm','execute','balance','billing']);
  for(const options of [{refs,vision:false},{refs,vision:true,uiDraft:false},{refs,vision:true,allowed:false}]){
    const denied=fixture(options);assert.equal((await denied.run()).ok,false);assert.equal(denied.events.includes('prepare'),false);assert.equal(denied.events.includes('execute'),false);
  }
});

test('declined upload, changed image or stale workspace make zero prepare and execute requests',async()=>{
  const refs=[{role:'subject',dataUrl:png}];
  for(const options of [{upload:false},{mutate:true},{stale:true}]){
    const f=fixture({refs,vision:true,...options});assert.equal((await f.run()).ok,false,JSON.stringify(options));assert.deepEqual(f.events,['upload-confirm']);
  }
});

test('declined quote after confirmed image upload does not execute or create recovery hold',async()=>{
  const f=fixture({refs:[{role:'subject',dataUrl:png}],vision:true,quote:false});assert.equal((await f.run()).ok,false);
  assert.deepEqual(f.events,['upload-confirm','prepare','quote-shown','quote-confirm']);
});
