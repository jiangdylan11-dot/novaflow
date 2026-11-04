import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';

// Isolated runtime contract tests: the network, session and ledger below are
// synthetic fixtures, not a real provider or production database.
const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('  // Operation-v3 can use'),source.indexOf('  const XIAOTAO_ONLINE_ART_RELEASE_ENABLED'));
const start=source.indexOf('  async function selectedOnlineBusinessPrompt('),end=source.indexOf('  async function localPromptAssistant(',start);
assert.ok(start>0&&end>start);

function fixture({decimal=true,artV3=true,textRelease=true,globalRelease=false,visionRelease=false,visionPolicy=false,model='xai/grok-4.7'}={}) {
  const selection={provider:'api',modelId:model,epoch:0},listeners=new Set(),events=[],recovery=new Map();
  const opId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',requestId='0d2aa225-e027-4d20-8ef3-7b5d1a9bbfee';
  let token='session-a',confirm=true,onQuote=null,onExecute=null;
  const controller={businessModelSnapshot:()=>({...selection}),subscribeBusinessModel(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const root={NovaFlowXiaotaoArtAgent:{panel:{controller}}};
  const terms={billing_scope:'operation',minimum_positive_credits:decimal?0:1,operation_art_v3:artV3,operation_vision_chat_v3:visionPolicy,...(decimal?{credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil'}:{})};
  const scope={root,Date,JSON,Object,String,Number,Array,Error,Promise,RegExp,AbortController,setTimeout,clearTimeout,
    CONFIG:{companionUrl:'https://example.invalid',authUrl:'https://example.invalid'},
    XIAOTAO_ONLINE_ART_RELEASE_ENABLED:globalRelease,XIAOTAO_ONLINE_TEXT_ART_RELEASE_ENABLED:textRelease,XIAOTAO_ONLINE_VISION_ART_RELEASE_ENABLED:visionRelease,foartSessionObservers:new Set(),
    companionPricing:async()=>({ok:true,policy:{version:'sha256:'+'c'.repeat(64),expiresAt:Date.now()+60000,models:[{id:model,available:true}],config:{xiaotao_online:terms}}}),
    captureFoartBillingOwner:()=>({owner:'synthetic-account',current:()=>token==='session-a'}),
    operationRecoveryId:id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||''),
    operationRecoveryRemember:(_owner,id,m,allowExisting)=>{events.push('save');if(recovery.has(id))return allowExisting===true&&recovery.get(id)===m;if(allowExisting)return false;recovery.set(id,m);return true;},
    operationRecoveryForget:(_owner,id)=>{events.push('forget');return recovery.delete(id);},
    currentSession:()=>({token}),captureFoartSessionGuard:()=>{const captured=token;return()=>token===captured;},
    companionCloudRequests:new Map(),companionCloudUsed:new Set(),stopCompanionCloud:()=>{},
    api:async(_base,_method,path,body,_timeout,signal)=>{
      if(signal?.aborted)throw Error('aborted');
      if(path.endsWith('/quote')){events.push('quote');if(onQuote)await onQuote();return {ok:true,quote:{stage:'structure',model,requestId:'a'.repeat(64),pricingVersion:'sha256:'+'c'.repeat(64),estimatedCredits:0.125,maxOutputTokens:1536,quoteToken:'synthetic-quote',imageCount:(body.images||[]).length,billingScope:'operation-v3',recoveryOperationId:opId}};}
      if(path.endsWith('/execute')){events.push('execute');if(onExecute)await onExecute();return {ok:true,releaseEligible:true,reviewRequired:true,targetEngine:'gpt-image-2.5',promptContract:'gpt-image-semantic-fusion-v1',displayPrompt:'safe draft',modelPrompt:'safe draft',settlement:{requestId:'a'.repeat(64),status:'settled',settledCredits:0.000001}};}
      throw Error('unexpected synthetic path');
    }};
  createContext(scope);runInContext(helpers+source.slice(start,end)+'\nglobalThis.invoke=selectedOnlineBusinessPrompt;',scope);
  const payload={requestId,assistantSelectionScope:'xiaotao',assistantProvider:'api',assistantModelId:model,assistantSelectionEpoch:0,currentDrawingTextOnly:true,
    surface:'art',purpose:'optimize',prompt:'synthetic landscape',currentPrompt:'synthetic landscape',requirements:'',targetEngine:'gpt-image-2.5',qwenPromptMode:'txt2img',supportsNegativePrompt:false,nsfw:false,images:[],isImageInputCurrent:()=>true,
    onPricingQuote:()=>events.push('show'),confirmPricingQuote:async()=>{events.push('confirm');return confirm;},onBillingNotice:()=>true};
  return {payload,events,recovery,invoke:()=>scope.invoke('optimize-prompt',payload,{...selection},controller),
    decline:()=>{confirm=false;},setOnQuote:fn=>{onQuote=fn;},setOnExecute:fn=>{onExecute=fn;},changeModel:()=>{selection.epoch++;for(const fn of listeners)fn();},changeSession:()=>{token='session-b';}};
}

test('scoped text uses decimal V3 quote, confirmation and one settled execution',async()=>{
  const h=fixture(),result=await h.invoke();
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.reviewRequired,true);assert.equal(result.quota.settled_credits,0.000001);
  assert.deepEqual(h.events,['quote','show','confirm','save','execute','forget']);assert.equal(h.recovery.size,0);
});

test('unscoped, disabled, image mode and visual inputs fail before provider execution',async()=>{
  for(const variant of ['unscoped','disabled','img2img','image','wrong-marker']) {
    const h=fixture({textRelease:variant!=='disabled'});
    if(variant==='unscoped')delete h.payload.currentDrawingTextOnly;
    if(variant==='wrong-marker')h.payload.currentDrawingTextOnly='true';
    if(variant==='img2img')h.payload.qwenPromptMode='img2img';
    if(variant==='image')h.payload.images=[{role:'reference',dataUrl:'data:image/png;base64,iVBORw0KGgo='}];
    const result=await h.invoke();assert.equal(result.ok,false,variant);assert.equal(h.events.includes('execute'),false,variant);assert.equal(h.events.includes('quote'),false,variant);
  }
});

test('old integer or disabled art policy cannot be used for scoped decimal operation',async()=>{
  for(const options of [{decimal:false},{artV3:false}]){
    const h=fixture(options),result=await h.invoke();assert.equal(result.ok,false);assert.equal(h.events.includes('quote'),false);assert.equal(h.events.includes('execute'),false);
  }
});

test('declining quote or changing model or session at quote prevents execution',async()=>{
  for(const variant of ['decline','model','session']){
    const h=fixture();if(variant==='decline')h.decline();else h.setOnQuote(()=>variant==='model'?h.changeModel():h.changeSession());
    const result=await h.invoke();assert.equal(result.ok,false,variant);assert.equal(h.events.filter(x=>x==='execute').length,0,variant);assert.equal(h.recovery.size,0,variant);
  }
});

test('same request cannot be submitted twice and unknown result keeps recovery record',async()=>{
  const h=fixture();assert.equal((await h.invoke()).ok,true);
  const repeated=await h.invoke();assert.equal(repeated.ok,false);assert.equal(h.events.filter(x=>x==='execute').length,1);
  const unknown=fixture();unknown.setOnExecute(()=>{throw Error('synthetic transport loss');});
  const result=await unknown.invoke();assert.equal(result.ok,false);assert.equal(result.billingUnknown,true);
  assert.equal(unknown.events.filter(x=>x==='execute').length,1);assert.equal(unknown.recovery.size,1);
});


test('scoped page vision requires both gates, explicit upload consent and decimal policy',async()=>{
  const image={role:'subject',dataUrl:'data:image/png;base64,iVBORw0KGgo='};
  for(const options of [{visionRelease:false,visionPolicy:true},{visionRelease:true,visionPolicy:false},{visionRelease:true,visionPolicy:true,decimal:false}]){
    const h=fixture(options);delete h.payload.currentDrawingTextOnly;Object.assign(h.payload,{currentDrawingVisionOnly:true,qwenPromptMode:'img2img',images:[image],confirmImageUpload:async()=>true});
    assert.equal((await h.invoke()).ok,false);assert.equal(h.events.includes('quote'),false);
  }
  const denied=fixture({visionRelease:true,visionPolicy:true});delete denied.payload.currentDrawingTextOnly;Object.assign(denied.payload,{currentDrawingVisionOnly:true,qwenPromptMode:'img2img',images:[image],confirmImageUpload:async()=>false});
  assert.equal((await denied.invoke()).ok,false);assert.equal(denied.events.includes('quote'),false);
  const ok=fixture({visionRelease:true,visionPolicy:true,model:'deepseek/deepseek-v4.1-flash'});delete ok.payload.currentDrawingTextOnly;Object.assign(ok.payload,{currentDrawingVisionOnly:true,qwenPromptMode:'img2img',images:[image],confirmImageUpload:async()=>{ok.events.push('upload-confirm');return true;}});
  const result=await ok.invoke();assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(ok.events,['upload-confirm','quote','show','confirm','save','execute','forget']);
});
