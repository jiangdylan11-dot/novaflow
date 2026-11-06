import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';

const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const creditHelpers=source.slice(source.indexOf('  // Operation-v3 can use'),source.indexOf('  const XIAOTAO_ONLINE_ART_RELEASE_ENABLED'));
const start=source.indexOf('  async function selectedOnlineBusinessPrompt('),end=source.indexOf('  async function localPromptAssistant(',start);
assert.ok(start>0&&end>start);
function harness({artEnabled=true,settlementFailure=false,confirmSecond=true,serverSuccess=false,unknownSecond=false,gptResult=false,pricingSource='token_rate_estimate',cacheKnown=false,operationV3=true,mutateQuote=null,storageFail=false,decimal=true,status=null,failStructure=null}={}){
 const selection={provider:'api',modelId:'xai/grok-4.7',epoch:0},listeners=new Set(),events=[],pending=new Set(),recovery=new Map();
 const operationId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 let token='session-a',calls=0,onExecute=null;
 const controller={businessModelSnapshot:()=>({...selection}),subscribeBusinessModel(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
 const root={NovaFlowXiaotaoArtAgent:{panel:{controller}}},requestId='0d2aa225-e027-4d20-8ef3-7b5d1a9bbfee';
 const scope={root,Date,JSON,Object,String,Number,Array,Error,Promise,RegExp,AbortController,setTimeout,clearTimeout,crypto:globalThis.crypto,
  CONFIG:{companionUrl:'https://example.invalid',authUrl:'https://example.invalid'},
  XIAOTAO_ONLINE_ART_RELEASE_ENABLED:artEnabled,foartSessionObservers:new Set(),
  companionPricing:async()=>({ok:true,policy:{version:'sha256:'+'c'.repeat(64),expiresAt:Date.now()+60000,...(decimal?{models:[{id:selection.modelId,available:true}]}:{}),config:{xiaotao_online:{...(operationV3?{operation_art_v3:true}:{}),...(decimal?{billing_scope:'operation',minimum_positive_credits:0,credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil'}:{})}}}}),
  captureFoartBillingOwner:()=>({owner:'synthetic-account',current:()=>token==='session-a'}),
  validOperationId:id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||''),
  currentSession:()=>({token}),captureFoartSessionGuard:()=>{const captured=token;return ()=>token===captured;},companionCloudRequests:new Map(),companionCloudUsed:new Set(),
  stopCompanionCloud:()=>{},api:async(_base,_method,path,body,_timeout,signal)=>{
   calls++;events.push({kind:path.endsWith('/quote')?'quote':path.endsWith('/cancel')?'cancel':path.endsWith('/operation/status')?'status':'execute',body});
   if(signal?.aborted)throw Error('aborted');
   if(path.endsWith('/quote')){const quote={stage:body.stage,model:selection.modelId,requestId:body.stage==='structure'?'a'.repeat(64):'b'.repeat(64),
    pricingVersion:'sha256:'+'c'.repeat(64),estimatedCredits:decimal?0.125:3,maxOutputTokens:body.stage==='structure'&&body.input?.targetEngine!=='gpt-image-2.5'?6144:1536,quoteToken:'synthetic-'+body.stage,...(body.images?{imageCount:body.images.length}:{}),...(operationV3?{billingScope:'operation-v3',recoveryOperationId:operationId}:{})};mutateQuote?.(quote,body.stage);return {ok:true,quote};}
   if(path.endsWith('/cancel'))return {ok:false,errorCode:'operation-cancelled',settlement:{requestId:'a'.repeat(64),status:'settled',settledCredits:0.000002}};
   if(path.endsWith('/operation/status'))return status?status(body):{ok:true,operation:{operationId,status:'pending-reconciliation'}};
   if(body.quoteToken==='synthetic-structure'&&failStructure){const outcome=failStructure(events.filter(e=>e.kind==='execute').length);if(outcome)return outcome;}
   if(onExecute)await onExecute(body);
   if(unknownSecond&&body.quoteToken==='synthetic-english')throw Error('synthetic transport lost');
   const id=body.quoteToken==='synthetic-structure'?'a'.repeat(64):'b'.repeat(64);
   const settlement=operationV3?{requestId:id,status:'settled',settledCredits:decimal?0.000001:1}:{requestId:id,settledCredits:2,pricingSource,cacheKnown};
   if(body.quoteToken==='synthetic-structure'&&gptResult)return {ok:true,releaseEligible:true,reviewRequired:true,targetEngine:'gpt-image-2.5',promptContract:'gpt-image-semantic-fusion-v1',displayPrompt:'safe draft',modelPrompt:'safe draft',settlement};
   if(body.quoteToken==='synthetic-structure')return {ok:true,stage:'structure',stageToken:'signed-stage',settlement:operationV3?{requestId:id,status:'pending'}:settlement};
   if(serverSuccess==='valid')return {ok:true,releaseEligible:true,reviewRequired:true,translationValidation:'structure-and-literals',
    modelPromptPolicy:'qwen21-task-policy-v1',editContract:'structured-recompile-v1',promptSchema:'nf.art.prompt.v1',
    displayPrompt:'review draft',modelPrompt:'[Style]\nA safe synthetic example.',modelPromptLanguage:'en',settlement};
   return serverSuccess?{ok:true,modelPrompt:'untrusted english',settlement}:{ok:false,errorCode:'semantic-verification-pending',settlement};
  }};
 createContext(scope);runInContext(creditHelpers+source.slice(start,end)+'\nglobalThis.invoke=selectedOnlineBusinessPrompt;',scope);
 const payload={requestId,assistantSelectionScope:'xiaotao',assistantProvider:'api',assistantModelId:selection.modelId,
  assistantSelectionEpoch:0,surface:'art',purpose:'optimize',prompt:'safe text',currentPrompt:'safe text',requirements:'',
  targetEngine:'qwen-2.1',qwenPromptMode:'txt2img',agentModelLanguage:'en',supportsNegativePrompt:false,promptSchema:'nf.art.prompt.v1',nsfw:false,
  isImageInputCurrent:()=>true,
  onPricingQuote:q=>events.push({kind:'show',stage:q.stage,exposedToken:q.quoteToken}),
  confirmPricingQuote:async q=>{events.push({kind:'confirm',stage:q.stage});return q.stage!=='english'||confirmSecond;},
  onBillingNotice:r=>{events.push({kind:r.unknown?'pending':'settled',row:r});if(r.unknown){if(pending.has(r.requestId))return false;pending.add(r.requestId);return true;}return !settlementFailure;}};
 return {scope,controller,selection,payload,events,recovery,operationId,get calls(){return calls;},
  invoke:()=>scope.invoke('optimize-prompt',payload,{...selection},controller),
  changeModel:()=>{selection.epoch++;for(const fn of listeners)fn();},
  changeSession:()=>{token='session-b';},setOnExecute:fn=>onExecute=fn};
}
test('art gate remains closed before quote or billing',async()=>{
 const h=harness({artEnabled:false}),result=await h.invoke();
 assert.equal(result.errorCode,'online-business-unavailable');assert.equal(h.calls,0);
});
test('decimal art quote is confirmed and settled once with six-digit fractional charge',async()=>{
 const h=harness({operationV3:true,gptResult:true,decimal:true});h.payload.targetEngine='gpt-image-2.5';h.payload.supportsNegativePrompt=false;
 delete h.payload.promptSchema;delete h.payload.agentModelLanguage;
 const result=await h.invoke();assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.quota.settled_credits,0.000001);
 assert.equal(h.events.filter(e=>e.kind==='confirm').length,1);assert.equal(h.events.filter(e=>e.kind==='execute').length,1);
});
test('decimal art rejects more than six places before confirmation or dispatch',async()=>{
 const h=harness({operationV3:true,gptResult:true,decimal:true,mutateQuote:q=>{q.estimatedCredits=0.0000001;}});h.payload.targetEngine='gpt-image-2.5';h.payload.supportsNegativePrompt=false;
 delete h.payload.promptSchema;delete h.payload.agentModelLanguage;
 const result=await h.invoke();assert.equal(result.ok,false);assert.equal(result.errorCode,'assistant-business-quote-unavailable');
 assert.equal(h.events.filter(e=>e.kind==='confirm').length,0);assert.equal(h.events.filter(e=>e.kind==='execute').length,0);
});
test('decimal two-stage art retains one operation recovery and one final fractional receipt',async()=>{
 const h=harness({operationV3:true,serverSuccess:'valid',decimal:true});
 const result=await h.invoke();assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.quota.settled_credits,0.000001);
 assert.equal(h.events.filter(e=>e.kind==='execute').length,2);
});
test('GPT Image optimization uses one separately confirmed 1536-token stage without Qwen policy',async()=>{
 const h=harness({gptResult:true});h.payload.targetEngine='gpt-image-2.5';h.payload.supportsNegativePrompt=false;
 delete h.payload.promptSchema;delete h.payload.agentModelLanguage;
 const result=await h.invoke();assert.equal(result.ok,true);assert.equal(result.targetEngine,'gpt-image-2.5');
 assert.equal(result.promptContract,'gpt-image-semantic-fusion-v1');assert.equal(result.modelPromptPolicy,undefined);
 assert.deepEqual(h.events.map(e=>e.kind),['quote','show','confirm','execute','settled']);
 assert.equal(h.events[0].body.input.targetEngine,'gpt-image-2.5');
});
test('actual renderer branch confirms and records each mock phase separately',async()=>{
 for(const model of ['xai/grok-4.7','openai/gpt-6.1-sol-saver']){
  const h=harness();h.selection.modelId=model;h.payload.assistantModelId=model;
  const result=await h.invoke();assert.equal(result.errorCode,'semantic-verification-pending');assert.equal(result.quota.settled_credits,0.000001);
  assert.deepEqual(h.events.map(e=>e.kind),['quote','show','confirm','execute','quote','show','confirm','execute','settled']);
  const [first,second]=h.events.filter(e=>e.kind==='quote');
  assert.equal(first.body.modelId,model);assert.equal(first.body.intentId,h.payload.requestId);assert.equal(second.body.stageToken,'signed-stage');
  assert.ok(h.events.filter(e=>e.kind==='show').every(e=>e.exposedToken===undefined));
 }
});
test('valid two-stage response remains marked for review and carries actual settlement',async()=>{
 const h=harness({serverSuccess:'valid'}),result=await h.invoke();
 assert.equal(result.ok,true);assert.equal(result.reviewRequired,true);
 assert.equal(result.translationValidation,'structure-and-literals');assert.equal(result.quota.settled_credits,0.000001);
 assert.equal(h.events.filter(e=>e.kind==='execute').length,2);
});
test('v3 missing, partial or mismatched quote identity fails closed before dispatch',async()=>{
 for(const mutate of [q=>{delete q.billingScope;delete q.recoveryOperationId;},q=>{delete q.billingScope;},q=>{delete q.recoveryOperationId;},q=>{q.recoveryOperationId='not-a-uuid';},q=>{q.pricingVersion='sha256:'+'f'.repeat(64);}]){
  const h=harness({operationV3:true,mutateQuote:mutate}),result=await h.invoke();assert.equal(result.ok,false);assert.equal(result.errorCode,'assistant-business-quote-unavailable');
  assert.equal(h.events.filter(e=>e.kind==='execute').length,0);
 }
 const changed=harness({operationV3:true,mutateQuote:(q,stage)=>{if(stage==='english')q.recoveryOperationId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';}});
 const result=await changed.invoke();assert.equal(result.ok,false);assert.equal(result.quota.settled_credits,0.000002);assert.equal(changed.events.filter(e=>e.kind==='execute').length,1);assert.equal(changed.events.filter(e=>e.kind==='cancel').length,1);
});
test('declining the second quote preserves the first receipt and sends no second request',async()=>{
 const h=harness({confirmSecond:false}),result=await h.invoke();
 assert.equal(result.errorCode,'assistant-business-quote-declined');assert.equal(result.quota.settled_credits,0.000002);
 assert.equal(h.events.filter(e=>e.kind==='execute').length,1);assert.equal(h.events.filter(e=>e.kind==='cancel').length,1);
});
test('a settlement that cannot be recorded is reported, with the actual charge',async()=>{
 const h=harness({settlementFailure:true}),result=await h.invoke();assert.equal(result.errorCode,'billing-record-unavailable');
 assert.equal(result.quota.settled_credits,0.000001);assert.equal(h.events.filter(e=>e.kind==='execute').length,2);
});
test('model or session change while confirming prevents paid dispatch',async()=>{
 for(const change of ['model','session']){
  const h=harness();h.payload.confirmPricingQuote=async()=>{change==='model'?h.changeModel():h.changeSession();return true;};
  const result=await h.invoke();assert.equal(result.errorCode,'assistant-selection-changed');
  assert.equal(h.events.filter(e=>e.kind==='execute').length,0);
 }
});
test('selection change while showing quote does not display a stale confirmation',async()=>{
 const h=harness();let confirmed=0;h.payload.onPricingQuote=()=>h.changeModel();
 h.payload.confirmPricingQuote=async()=>{confirmed++;return true;};
 const result=await h.invoke();assert.equal(result.errorCode,'assistant-selection-changed');
 assert.equal(confirmed,0);assert.equal(h.events.filter(e=>e.kind==='execute').length,0);
});
test('in-flight selection change does not start phase two',async()=>{
 const h=harness();h.setOnExecute(async()=>h.changeModel());
 const result=await h.invoke();assert.equal(result.errorCode,'assistant-selection-changed');
 assert.equal(h.events.filter(e=>e.kind==='quote').length,1);assert.equal(h.events.filter(e=>e.kind==='execute').length,1);
});
test('a lost second response marks the bill unknown and is never cancelled',async()=>{
 const h=harness({unknownSecond:true}),result=await h.invoke();
 assert.equal(result.billingUnknown,true);assert.equal(h.events.filter(e=>e.kind==='execute').length,2);assert.equal(h.events.filter(e=>e.kind==='cancel').length,0);
});
test('forged successful second stage lacks trusted contract and is never returned as a prompt',async()=>{
 const h=harness({serverSuccess:true}),result=await h.invoke();
 assert.equal(result.errorCode,'assistant-business-invalid-result');assert.equal(result.modelPrompt,undefined);
});

test('a model that answered nothing is refunded by the server and the structure stage is retried once',async()=>{
 const h=harness({gptResult:true,failStructure:n=>n===1?{ok:false,errorCode:'provider-failed',settlement:{requestId:'a'.repeat(64),status:'settled',settledCredits:0}}:null});
 h.payload.targetEngine='gpt-image-2.5';delete h.payload.promptSchema;delete h.payload.agentModelLanguage;
 const result=await h.invoke();
 assert.equal(result.ok,true);assert.equal(result.prompt,'safe draft');
 assert.equal(h.events.filter(e=>e.kind==='execute').length,2);assert.equal(h.events.filter(e=>e.kind==='quote').length,2);
 assert.equal(h.events.filter(e=>e.kind==='cancel').length,0);
 const intents=h.events.filter(e=>e.kind==='quote').map(e=>e.body.intentId);
 assert.ok(intents[0]&&intents[1]&&intents[0]!==intents[1],'the retry is a new intent, so the server opens a new operation instead of the refunded one');
 const twice=harness({gptResult:true,failStructure:()=>({ok:false,errorCode:'provider-failed',settlement:{requestId:'a'.repeat(64),status:'settled',settledCredits:0}})});
 twice.payload.targetEngine='gpt-image-2.5';delete twice.payload.promptSchema;delete twice.payload.agentModelLanguage;
 const failed=await twice.invoke();
 assert.equal(failed.ok,false);assert.equal(failed.errorCode,'provider-failed');assert.match(failed.error,/没有返回结果.*未扣费/);assert.doesNotMatch(failed.error,/核对/);
 assert.equal(twice.events.filter(e=>e.kind==='execute').length,2);
});
test('a request lost in flight reads the server settlement instead of guessing',async()=>{
 const lost=()=>{throw Object.assign(Error('request failed 504'),{status:504});};
 const refunded=harness({gptResult:true,status:body=>({ok:true,operation:{operationId:body.operationId,status:'settled',outcome:'cancel',charged:0,uncollected:0}}),failStructure:lost});
 refunded.payload.targetEngine='gpt-image-2.5';delete refunded.payload.promptSchema;delete refunded.payload.agentModelLanguage;
 const a=await refunded.invoke();
 assert.equal(a.errorCode,'provider-failed');assert.match(a.error,/未扣费/);assert.equal(a.billingUnknown,undefined);assert.equal(a.quota.settled_credits,0);
 assert.equal(refunded.events.filter(e=>e.kind==='settled').length,1);
 const charged=harness({gptResult:true,status:body=>({ok:true,operation:{operationId:body.operationId,status:'settled',outcome:'cancel',charged:0.25,uncollected:0}}),failStructure:lost});
 charged.payload.targetEngine='gpt-image-2.5';delete charged.payload.promptSchema;delete charged.payload.agentModelLanguage;
 const b=await charged.invoke();
 assert.equal(b.errorCode,'assistant-business-interrupted');assert.equal(b.quota.settled_credits,0.25);assert.doesNotMatch(b.error,/核对/);
 const open=harness({gptResult:true,failStructure:lost});
 open.payload.targetEngine='gpt-image-2.5';delete open.payload.promptSchema;delete open.payload.agentModelLanguage;
 const c=await open.invoke();
 assert.equal(c.billingUnknown,true);assert.match(c.error,/在线请求中断/);assert.doesNotMatch(c.error,/核对/);
});
const syntheticRefs=[
 {role:'subject',dataUrl:'data:image/png;base64,iVBORw0KGgo='},
 {role:'style',dataUrl:'data:image/jpeg;base64,/9j/2Q=='},
 {role:'reference',dataUrl:'data:image/webp;base64,UklGRgAAAAA='}
];
test('a style redraw asks for DeepSeek, and falls back to the picked model when DeepSeek is off the list',async()=>{
 const run=async listed=>{
  const h=harness({decimal:true}),pricing=h.scope.companionPricing;h.scope.XIAOTAO_ONLINE_VISION_ART_RELEASE_ENABLED=true;h.scope.STYLE_REDRAW_BRAIN_MODEL='deepseek/deepseek-v4.1-flash';
  h.scope.companionPricing=async()=>{const result=await pricing();if(listed)result.policy.models=[...result.policy.models,{id:'deepseek/deepseek-v4.1-flash',available:true}];return result;};
  Object.assign(h.payload,{qwenPromptMode:'img2img',promptContract:'qwen21-native-rewrite-v3',promptSchema:undefined,agentModelLanguage:'en',images:syntheticRefs.slice(0,2).map((image,index)=>({...image,role:index?'style':'subject'})),confirmImageUpload:async()=>true});
  await h.invoke();return h.events.find(event=>event.kind==='quote')?.body.modelId;
 };
 assert.equal(await run(true),'deepseek/deepseek-v4.1-flash');
 assert.equal(await run(false),'xai/grok-4.7');
});
test('selected images require consent before quote; structure submits exact roles and order twice only',async()=>{
 const h=harness(),events=h.events;h.payload.images=syntheticRefs;
 h.payload.confirmImageUpload=async ({count})=>{events.push({kind:'upload-consent',count});return true;};
 await h.invoke();assert.equal(events[0].kind,'upload-consent');assert.equal(events[0].count,3);
 const q=events.filter(e=>e.kind==='quote'),e=events.filter(e=>e.kind==='execute');
 assert.deepEqual(JSON.parse(JSON.stringify(q[0].body.images)),syntheticRefs);
 assert.deepEqual(JSON.parse(JSON.stringify(e[0].body.images)),syntheticRefs);
 assert.equal(q[1].body.images,undefined);assert.equal(e[1].body.images,undefined);
});
test('declined or interrupted image consent sends no request',async()=>{
 for(const kind of ['missing','deny','model','session','abort']){
  const h=harness(),abort=new AbortController();h.payload.signal=abort.signal;h.payload.images=syntheticRefs.slice(0,1);
  if(kind!=='missing')h.payload.confirmImageUpload=async()=>{if(kind==='model')h.changeModel();if(kind==='session')h.changeSession();if(kind==='abort')abort.abort();return kind!=='deny';};
  const result=await h.invoke();assert.equal(h.calls,0,kind);assert.equal(result.ok,false,kind);
 }
});
test('invalid image roles, encoding and over-limit inputs fail before consent or network',async()=>{
 const bad=[[...syntheticRefs,syntheticRefs[0]],[{role:'system',dataUrl:syntheticRefs[0].dataUrl}],[{role:'style',dataUrl:'data:image/png;base64,a'}],[{role:'style',dataUrl:'data:image/png;base64,'+'A'.repeat(28*1024*1024)}]];
 for(const images of bad){const h=harness();let asked=0;h.payload.images=images;h.payload.confirmImageUpload=async()=>{asked++;return true};const result=await h.invoke();assert.equal(result.errorCode,'invalid-request');assert.equal(h.calls,0);assert.equal(asked,0)}
});
test('selection change during quote cannot dispatch image or create a billing record',async()=>{
 const h=harness();h.payload.images=syntheticRefs;h.payload.confirmImageUpload=async()=>true;
 h.payload.onPricingQuote=()=>h.changeModel();const result=await h.invoke();
 assert.equal(result.errorCode,'assistant-selection-changed');assert.equal(h.events.filter(e=>e.kind==='execute').length,0);assert.equal(h.events.filter(e=>e.kind==='pending').length,0);
});

test('changing the drawing reference during upload confirmation or quote stops the next request',async()=>{
 for(const phase of ['consent','quote']){
  const h=harness();let current=true;h.payload.images=syntheticRefs;h.payload.isImageInputCurrent=()=>current;
  h.payload.confirmImageUpload=async()=>{if(phase==='consent')current=false;return true};
  if(phase==='quote')h.payload.onPricingQuote=()=>{current=false};
  const result=await h.invoke();assert.equal(result.errorCode,'assistant-selection-changed');
  assert.equal(h.calls,phase==='consent'?0:1);assert.equal(h.events.filter(e=>e.kind==='execute').length,0);
 }
});

test('all supported drawing roles survive both structure requests',async()=>{
 for(const role of ['subject','style','pose','background','material','color','composition','lighting','object']){
  const h=harness();h.payload.images=[{role,dataUrl:'data:image/png;base64,iVBORw0KGgo='}];h.payload.confirmImageUpload=async()=>true;
  await h.invoke();const q=h.events.find(e=>e.kind==='quote'),e=h.events.find(e=>e.kind==='execute');
  assert.equal(q.body.images[0].role,role);assert.equal(e.body.images[0].role,role);
 }
});
