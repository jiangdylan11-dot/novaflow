import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

// Isolated runtime tests only: no real account, provider, network or ledger.
const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('  // Operation-v3 can use'),source.indexOf('  const XIAOTAO_ONLINE_ART_RELEASE_ENABLED'));
const start=source.indexOf('  async function selectedOnlineVideoDraft('),end=source.indexOf('  async function selectedOnlineUiDraft(',start);
assert.ok(start>0&&end>start);
const id='11111111-1111-4111-8111-111111111111',operationId='22222222-2222-4222-8222-222222222222';
const model='deepseek/deepseek-v4.1-flash',policyVersion='sha256:'+'c'.repeat(64);
const png='data:image/png;base64,iVBORw0KGgo=';

function fixture({release=true,vision=true,video=true,upload=true,quote=true,mutate=false}={}) {
  const events=[],used=new Set(),pending=new Map(),observers=new Set(),listeners=new Set(),recovery=new Map();
  const selection={provider:'api',modelId:model,epoch:0};
  const controller={businessModelSnapshot:()=>({...selection}),subscribeBusinessModel(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const root={crypto:webcrypto,NovaFlowXiaotaoArtAgent:{panel:{controller}}};
  const terms={billing_scope:'operation',minimum_positive_credits:0,credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',operation_video_rewrite_v3:video,operation_vision_chat_v3:vision};
  const policy={version:policyVersion,expiresAt:Date.now()+60000,models:[{id:model,available:true}],config:{xiaotao_online:terms}};
  const guard=()=>true;guard.expiresAtMs=Date.now()+60000;
  const scope={root,structuredClone,Date,JSON,Object,String,Number,Array,Error,Promise,RegExp,BigInt,AbortController,setTimeout,clearTimeout,
    XIAOTAO_H3_VISION_RELEASE_ENABLED:release,CONFIG:{companionUrl:'https://example.invalid',authUrl:'https://example.invalid'},
    validOperationId:value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||''),
    notifyAccountBalance:()=>events.push('balance'),
    onlineOperationModel:value=>value===model,companionCloudRequests:pending,companionCloudUsed:used,foartSessionObservers:observers,
    captureFoartBillingOwner:()=>({current:()=>true}),captureFoartSessionGuard:()=>guard,companionPricing:async()=>({ok:true,policy}),
    api:async(_base,_method,path,body)=>{
      if(path.endsWith('/prepare')){events.push('prepare');assert.equal(body.intent.images.length,2);return {ok:true,operation:{model,policyVersion,operationId,token:'synthetic-ticket',intentHash:'a'.repeat(64),estimatedCredits:0.002,outputTokens:1200}};}
      if(path.endsWith('/execute')){events.push('execute');assert.equal(body.intent.images.length,2);return {ok:true,model,receipt:{status:'settled',outcome:'success',charged:0.000539,uncollected:0},videoDraft:{textOnly:false,h3Mode:'first_last',durationSeconds:2,displayPrompt:'synthetic video draft',modelPrompt:'synthetic model draft'}};}
      throw Error('unexpected isolated route '+path);
    }};
  createContext(scope);runInContext(helpers+source.slice(start,end)+'\nglobalThis.invoke=selectedOnlineVideoDraft;',scope);
  const payload={request:{mode:'video-rewrite',requestId:id,h3Mode:'first_last',durationSeconds:2,prompt:'A quiet turn',requirements:'',references:[{key:'first_frame',kind:'image',sourceId:'first'},{key:'last_frame',kind:'image',sourceId:'last'}],images:[{key:'first_frame',dataUrl:png},{key:'last_frame',dataUrl:png}]},
    assistantSelectionScope:'xiaotao',assistantProvider:'api',assistantModelId:model,assistantSelectionEpoch:0,
    isInputCurrent:()=>true,confirmImageUpload:async({images,count})=>{events.push('upload-confirm');assert.equal(count,2);if(mutate)images[0].dataUrl='data:image/png;base64,AAAA';return upload;},
    onPricingQuote:()=>events.push('quote-shown'),confirmPricingQuote:async()=>{events.push('quote-confirm');return quote;},onBillingNotice:notice=>{events.push('billing');assert.equal(notice.quota.settled_credits,0.000539);return true;}};
  return {events,recovery,run:()=>scope.invoke(payload,{...selection},controller)};
}

test('two frames require explicit consent before prepare and settle one decimal operation',async()=>{
  const f=fixture(),result=await f.run();assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.quota.settled_credits,0.000539);
  assert.deepEqual(f.events,['upload-confirm','prepare','quote-shown','quote-confirm','execute','balance','billing']);
  assert.equal((await f.run()).ok,false);assert.equal(f.events.filter(x=>x==='execute').length,1);
});

test('disabled gates, declined upload and mutation during consent make zero prepare requests',async()=>{
  for(const options of [{release:false},{vision:false},{video:false},{upload:false},{mutate:true}]) {
    const f=fixture(options),result=await f.run();assert.equal(result.ok,false,JSON.stringify(options));assert.equal(f.events.includes('prepare'),false,JSON.stringify(options));assert.equal(f.events.includes('execute'),false,JSON.stringify(options));
  }
});

test('declining quote after image upload does not execute or create a billing recovery hold',async()=>{
  const f=fixture({quote:false}),result=await f.run();assert.equal(result.ok,false);assert.deepEqual(f.events,['upload-confirm','prepare','quote-shown','quote-confirm']);
});
