import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';

const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const creditHelpers=source.slice(source.indexOf('  // Operation-v3 can use'),source.indexOf('  const XIAOTAO_ONLINE_ART_RELEASE_ENABLED'));
const begin=source.indexOf('  // Foart operation-level billing is default closed'),end=source.indexOf('  // ------------------------------------------------------- workflow intents',begin);
assert.ok(begin>0&&end>begin);
const plain=value=>JSON.parse(JSON.stringify(value));
const version='sha256:'+'a'.repeat(64),model='xai/grok-4.7',fingerprint='sha256:'+'b'.repeat(64);
const context=()=>({schema:'nf.foart.tool-plan.v1',controls:[],projectName:'synthetic-project'});
const open=()=>({schema:'nf.foart.tool-plan.v1',status:'act',reply:'Opening',operations:[{action:'open',surface:'animation'}]});
const done=()=>({schema:'nf.foart.tool-plan.v1',status:'done',reply:'Opened',operations:[]});
const policy=()=>({version,expiresAt:Date.now()+60000,models:[{id:model,available:true}],config:{xiaotao_online:{billing_scope:'operation',minimum_positive_credits:1,operation_text_chat_v3:true,operation_foart_open_v3:true}}});
function fixture(override={}) {
 let valid=true,uuid=0,currentPolicy=policy(),events=[],calls=[];
 const guard=()=>valid;Object.defineProperty(guard,'expiresAtMs',{value:Date.now()+60000});
 const root={crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`}};
 const defaults={
  '/api/web/companion/quote':()=>({ok:true,quote:{pricingVersion:version,modelId:model,quoteFingerprint:fingerprint,estimatedCredits:4}}),
  '/api/web/companion/operation/foart/prepare':()=>({ok:true,model,policyVersion:version,operationId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',token:'opaque.operation'}),
  '/api/web/companion/operation/foart/start':()=>({ok:true,toolPlan:open(),billing:{status:'pending'},continuationToken:'opaque.continuation',sequence:1}),
  '/api/web/companion/operation/foart/resume':()=>({ok:true,toolPlan:done(),receipt:{status:'settled',outcome:'success',charged:1,uncollected:0}}),
  '/api/web/companion/operation/foart/cancel':()=>({ok:true,status:'settled',outcome:'cancel',charged:1,uncollected:0})
 };
 const api=async(base,method,path,body,timeout,signal)=>{calls.push({base,method,path,body:plain(body)});assert.equal(method,'POST');assert.ok(signal);return (override[path]||defaults[path])(body,signal)};
 const scope={root,CONFIG:{companionUrl:'https://fixture.invalid'},AbortController,setTimeout,clearTimeout,Date,Number,Object,JSON,Error,Set,Map,WeakMap,
  foartSessionObservers:new Set(),companionCloudRequests:new Map(),companionCloudUsed:new Set(),api,
  companionPricing:async()=>({ok:true,policy:currentPolicy}),captureFoartSessionGuard:()=>guard,captureFoartBillingOwner:()=>({owner:'synthetic-user',current:guard}),
  operationRecoveryId:id=>id==='cccccccc-cccc-4ccc-8ccc-cccccccccccc',operationRecoveryRemember:()=>true,operationRecoveryForget:()=>true,notifyAccountBalance:(...args)=>events.push(args)};
 createContext(scope);runInContext(creditHelpers+source.slice(begin,end)+'\nglobalThis.start=foartOperationStart;globalThis.resume=foartOperationResume;globalThis.cancel=foartOperationCancel;',scope);
 const startPayload=()=>({requestId:'request_123',modelId:model,pricingVersion:version,pricingExpiresAt:Date.now()+60000,message:'Open animation',history:[],promptLanguage:'zh-CN',foartContext:context()});
 return {scope,calls,events,startPayload,deny:()=>{valid=false},setPolicy:p=>{currentPolicy=p}};
}

test('server policy must explicitly enable operation-scoped foart before any quote',async()=>{
 for(const mutate of [p=>delete p.config.xiaotao_online.operation_foart_open_v3,p=>p.config.xiaotao_online.billing_scope='request',p=>p.models[0].available=false]){
  const f=fixture(),p=policy();mutate(p);f.setPolicy(p);const r=await f.scope.start(f.startPayload());assert.equal(r.ok,false);assert.equal(r.providerSubmitted,false);assert.equal(f.calls.length,0);
 }
});
test('one open and terminal reply reuse an opaque bound operation and settle once',async()=>{
 const f=fixture();let displayed;const first=await f.scope.start({...f.startPayload(),onPricingQuote:q=>{displayed=plain(q)}});
 assert.equal(first.ok,true);assert.equal(first.data.toolPlan.status,'act');assert.equal(displayed.estimatedCredits,4);const handle=first.data.foartOperationSession;
 assert.equal(Object.isFrozen(handle),true);assert.equal(JSON.stringify(handle),'{}');assert.equal(f.events.length,0);
 assert.deepEqual(f.calls.map(x=>x.path),['/api/web/companion/quote','/api/web/companion/operation/foart/prepare','/api/web/companion/operation/foart/start']);
 assert.equal(f.calls[0].body.mode,'foart');assert.deepEqual(f.calls[0].body.images,[]);
 const input={requestId:'request_456',session:handle,previousContext:context(),receipt:{action:'open',phase:'opened',surface:'animation',message:'untrusted',context:{secret:'do-not-send'}},context:context()};
 const changed=await f.scope.resume({...input,previousContext:{...context(),projectName:'different'}});assert.equal(changed.ok,false);assert.equal(changed.providerSubmitted,false);assert.equal(changed.billingUnknown,true);assert.equal(changed.session,handle);assert.equal(f.calls.length,3);
 const result=await f.scope.resume(input);assert.equal(result.ok,true);assert.equal(result.data.toolPlan.status,'done');assert.equal(result.data.quota.settled_credits,1);assert.equal(result.data.quota.quote_estimated_credits,4);assert.equal(f.events.length,1);
 assert.deepEqual(f.calls[3].body.previousContext,context());assert.deepEqual(f.calls[3].body.receipt,{action:'open',phase:'opened',surface:'animation'});
 assert.equal((await f.scope.resume({...input,requestId:'request_789'})).ok,false);assert.equal(f.calls.length,4);
});
test('quote mismatch, unauthorized handle, media, and account changes fail closed',async()=>{
 const f=fixture({'/api/web/companion/quote':()=>({ok:true,quote:{pricingVersion:'sha256:'+'c'.repeat(64),modelId:model,quoteFingerprint:fingerprint,estimatedCredits:4}})});
 let r=await f.scope.start(f.startPayload());assert.equal(r.ok,false);assert.equal(r.providerSubmitted,false);assert.equal(f.calls.length,1);
 const g=fixture();r=await g.scope.resume({requestId:'request_456',session:{},previousContext:context(),context:context(),receipt:{action:'open',phase:'opened',surface:'animation'}});assert.equal(r.ok,false);assert.equal(g.calls.length,0);
 r=await g.scope.start({...g.startPayload(),foartContext:{...context(),imageUrl:'https://example.invalid/private.png'}});assert.equal(r.ok,false);assert.equal(g.calls.length,0);
 r=await g.scope.start({...g.startPayload(),images:[{dataUrl:'data:image/png;base64,abcd'}]});assert.equal(r.ok,false);assert.equal(g.calls.length,0);
 const h=fixture(),started=await h.scope.start(h.startPayload());h.deny();r=await h.scope.cancel({session:started.data.foartOperationSession});assert.equal(r.ok,false);assert.equal(r.billingUnknown,true);assert.equal(h.calls.length,3);
});
test('uncertain dispatch is not replayed and an explicit cancel reports its known settlement',async()=>{
 let attempts=0;const f=fixture({'/api/web/companion/operation/foart/start':()=>{attempts++;throw Error('synthetic timeout')}});
 const first=await f.scope.start(f.startPayload());assert.equal(first.ok,false);assert.equal(first.providerSubmitted,true);assert.equal(first.billingUnknown,true);assert.ok(first.session);assert.equal(attempts,1);
 assert.equal((await f.scope.resume({requestId:'request_456',session:first.session,previousContext:context(),context:context(),receipt:{action:'open',phase:'opened',surface:'animation'}})).ok,false);
 const cancel=await f.scope.cancel({session:first.session});assert.equal(cancel.ok,true);assert.equal(cancel.data.quota.settled_credits,1);assert.equal(attempts,1);
 assert.equal((await f.scope.cancel({session:first.session})).ok,false);
});
test('aborted in-flight operation is marked unknown, never retried or routed to legacy',async()=>{
 const f=fixture({'/api/web/companion/operation/foart/start':(_body,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});
 const abort=new AbortController(),pending=f.scope.start({...f.startPayload(),signal:abort.signal});while(!f.calls.some(x=>x.path.endsWith('/foart/start')))await new Promise(r=>setTimeout(r,0));
 abort.abort();const r=await pending;assert.equal(r.ok,false);assert.equal(r.billingUnknown,true);assert.equal(r.providerSubmitted,true);assert.ok(r.session);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/foart/start')).length,1);assert.equal(f.calls.some(x=>x.path==='/api/web/companion/chat'),false);
});
test('one-bone rotation needs separately advertised capability and preserves prior plan only in memory',async()=>{
 const inspect={schema:'nf.foart.tool-plan.v1',status:'act',reply:'Inspect',operations:[{action:'animation',operation:'inspect_bones',name:'idle',boneNames:['hair']}]};
 const key={schema:'nf.foart.tool-plan.v1',status:'act',reply:'Preview',operations:[{action:'animation',operation:'key_bones',name:'idle',keys:[{boneName:'hair',frame:15,values:{rotation:12}}]}]};
 let resumes=0;const f=fixture({
  '/api/web/companion/operation/foart/start':()=>({ok:true,toolPlan:plain(inspect),billing:{status:'pending'},continuationToken:'inspect.ticket',sequence:1}),
  '/api/web/companion/operation/foart/resume':()=>++resumes===1?({ok:true,toolPlan:plain(key),billing:{status:'pending'},continuationToken:'key.ticket',sequence:2}):({ok:true,toolPlan:done(),receipt:{status:'settled',outcome:'success',charged:1,uncollected:0}})
 });
 const p=policy();p.config.xiaotao_online.operation_foart_rotation_v3=true;f.setPolicy(p);
 const first=await f.scope.start(f.startPayload());assert.equal(first.ok,true);assert.equal(JSON.stringify(first.data.foartOperationSession),'{}');
 first.data.toolPlan.operations[0].boneNames[0]='mutated-client-copy';
 const inspection={name:'idle',complete:true,bones:[{name:'hair',complete:true,rotate:[{time:0,angle:0}]}]};
 const second=await f.scope.resume({requestId:'request_456',session:first.data.foartOperationSession,previousContext:context(),context:context(),
  receipt:{action:'animation',operation:'inspect_bones',phase:'observed',inspection,message:'do not forward',context:{secret:'not used'}}});
 assert.equal(second.ok,true);assert.equal(second.data.toolPlan.operations[0].operation,'key_bones');
 assert.deepEqual(f.calls[3].body.previousPlan,inspect);assert.deepEqual(f.calls[3].body.receipt,{action:'animation',operation:'inspect_bones',phase:'observed',inspection});
 const final=await f.scope.resume({requestId:'request_789',session:second.data.foartOperationSession,previousContext:context(),context:context(),
  receipt:{action:'animation',operation:'key_bones',phase:'applied',confirmed:true,context:{secret:'not used'}}});
 assert.equal(final.ok,true);assert.equal(final.data.quota.settled_credits,1);assert.deepEqual(f.calls[4].body.previousPlan,key);
 assert.deepEqual(f.calls[4].body.receipt,{action:'animation',operation:'key_bones',phase:'applied'});
 assert.equal(JSON.stringify(f.calls).includes('not used'),false);
});
test('bone plans stay closed without opt-in and refuse additional bones or channels',async()=>{
 for(const [enabled,operation] of [
  [false,{action:'animation',operation:'inspect_bones',name:'idle',boneNames:['hair']}],
  [true,{action:'animation',operation:'inspect_bones',name:'idle',boneNames:['hair','body']}],
  [true,{action:'animation',operation:'key_bones',name:'idle',keys:[{boneName:'hair',frame:15,values:{rotation:12,x:1}}]}]
 ]){
  const f=fixture({'/api/web/companion/operation/foart/start':()=>({ok:true,toolPlan:{schema:'nf.foart.tool-plan.v1',status:'act',reply:'Plan',operations:[operation]},billing:{status:'pending'},continuationToken:'ticket',sequence:1})});
  const p=policy();p.config.xiaotao_online.operation_foart_rotation_v3=enabled;f.setPolicy(p);const r=await f.scope.start(f.startPayload());
  assert.equal(r.ok,false);assert.equal(r.billingUnknown,true);assert.ok(r.session);assert.equal(f.calls.length,3);
 }
});

test('decimal operation accepts fractional quote and one settled charge without replay',async()=>{
 const f=fixture({
  '/api/web/companion/quote':()=>({ok:true,quote:{pricingVersion:version,modelId:model,quoteFingerprint:fingerprint,estimatedCredits:0.125}}),
  '/api/web/companion/operation/foart/resume':()=>({ok:true,toolPlan:done(),receipt:{status:'settled',outcome:'success',charged:0.000001,uncollected:0}})
 });
 const p=policy();Object.assign(p.config.xiaotao_online,{minimum_positive_credits:0,credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil'});f.setPolicy(p);
 const start=await f.scope.start(f.startPayload());assert.equal(start.ok,true);
 const input={requestId:'request_456',session:start.data.foartOperationSession,previousContext:context(),receipt:{action:'open',phase:'opened',surface:'animation'},context:context()};
 const result=await f.scope.resume(input);assert.equal(result.ok,true);assert.equal(result.data.quota.settled_credits,0.000001);assert.equal(result.data.quota.quote_estimated_credits,0.125);
 assert.equal((await f.scope.resume({...input,requestId:'request_789'})).ok,false);assert.equal(f.calls.filter(x=>x.path.endsWith('/foart/resume')).length,1);
});

test('decimal policy requires all three markers and rejects malformed fractional quotes',async()=>{
 for(const missing of ['credit_amount_policy','credit_precision','credit_rounding']){
  const f=fixture(),p=policy();Object.assign(p.config.xiaotao_online,{minimum_positive_credits:0,credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil'});delete p.config.xiaotao_online[missing];f.setPolicy(p);
  const result=await f.scope.start(f.startPayload());assert.equal(result.ok,false);assert.equal(result.providerSubmitted,false);assert.equal(f.calls.length,0);
 }
 for(const mutate of [
  p=>{p.minimum_positive_credits=1;},p=>{p.credit_rounding='floor';},p=>{p.credit_precision=5;},
  p=>{p.minimum_positive_credits=1;delete p.credit_rounding;}
 ]){
  const f=fixture(),p=policy();Object.assign(p.config.xiaotao_online,{minimum_positive_credits:0,credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil'});mutate(p.config.xiaotao_online);f.setPolicy(p);
  const result=await f.scope.start(f.startPayload());assert.equal(result.ok,false);assert.equal(result.providerSubmitted,false);assert.equal(f.calls.length,0);
 }
 for(const amount of [0.0000001,-1,Infinity,NaN,10000000000,'0.1']){
  const f=fixture({'/api/web/companion/quote':()=>({ok:true,quote:{pricingVersion:version,modelId:model,quoteFingerprint:fingerprint,estimatedCredits:amount}})});
  const p=policy();Object.assign(p.config.xiaotao_online,{minimum_positive_credits:0,credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil'});f.setPolicy(p);
  const result=await f.scope.start(f.startPayload());assert.equal(result.ok,false);assert.equal(result.providerSubmitted,false);assert.equal(f.calls.length,1);
 }
 const legacy=fixture({'/api/web/companion/quote':()=>({ok:true,quote:{pricingVersion:version,modelId:model,quoteFingerprint:fingerprint,estimatedCredits:0.5}})});
 const result=await legacy.scope.start(legacy.startPayload());assert.equal(result.ok,false);assert.equal(result.providerSubmitted,false);
});

test('decimal operation invalid settlement stays unknown and a known cancellation is not retried',async()=>{
 const f=fixture({
  '/api/web/companion/quote':()=>({ok:true,quote:{pricingVersion:version,modelId:model,quoteFingerprint:fingerprint,estimatedCredits:0.25}}),
  '/api/web/companion/operation/foart/resume':()=>({ok:true,toolPlan:done(),receipt:{status:'settled',outcome:'success',charged:0.0000001,uncollected:0}}),
  '/api/web/companion/operation/foart/cancel':()=>({ok:true,status:'settled',outcome:'cancel',charged:0.125,uncollected:0})
 });
 const p=policy();Object.assign(p.config.xiaotao_online,{minimum_positive_credits:0,credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil'});f.setPolicy(p);
 const first=await f.scope.start(f.startPayload());const input={requestId:'request_456',session:first.data.foartOperationSession,previousContext:context(),receipt:{action:'open',phase:'opened',surface:'animation'},context:context()};
 const unknown=await f.scope.resume(input);assert.equal(unknown.ok,false);assert.equal(unknown.billingUnknown,true);assert.ok(unknown.session);
 const cancelled=await f.scope.cancel({session:unknown.session});assert.equal(cancelled.ok,true);assert.equal(cancelled.data.quota.settled_credits,0.125);
 assert.equal((await f.scope.cancel({session:unknown.session})).ok,false);assert.equal(f.calls.filter(x=>x.path.endsWith('/foart/cancel')).length,1);
});

const idleContext=()=>({schema:'nf.foart.tool-plan.v1',controls:[],projectName:'synthetic-project',animation:{
 active:true,loaded:true,mode:'animate',playing:false,revision:'synthetic-revision',fps:30,
 animations:['run'],selectedBones:['hair'],bones:[{name:'hair'},{name:'body'}]}});
const idleDraft=()=>({action:'animation',operation:'create_idle',name:'thinking_idle',durationSeconds:2,keys:[
 {boneName:'hair',frame:0,values:{rotation:0}},
 {boneName:'hair',frame:30,values:{rotation:8}},
 {boneName:'hair',frame:60,values:{rotation:0}}]});
function idlePolicy(){const p=policy();Object.assign(p.config.xiaotao_online,{minimum_positive_credits:0,credit_amount_policy:'decimal-v1',
 credit_precision:6,credit_rounding:'ceil',operation_foart_idle_draft_v3:true});return p;}
function idleFixture(draft=idleDraft()){
 const f=fixture({
  '/api/web/companion/quote':()=>({ok:true,quote:{pricingVersion:version,modelId:model,quoteFingerprint:fingerprint,estimatedCredits:0.125}}),
  '/api/web/companion/operation/foart/start':()=>({ok:true,idleDraft:plain(draft),receipt:{status:'settled',outcome:'success',charged:0.000002,uncollected:0}})
 });f.setPolicy(idlePolicy());return f;
}
test('settled idle draft requires explicit request and decimal capability; it never edits or redispatches',async()=>{
 const f=idleFixture();const payload={...f.startPayload(),message:'2秒待机动画，深度思考的感觉',foartContext:idleContext(),idleDraftRequested:true};
 const result=await f.scope.start(payload);assert.equal(result.ok,true);assert.deepEqual(plain(result.data.idleDraft),idleDraft());
 assert.equal(result.data.quota.settled_credits,0.000002);assert.equal(result.data.quota.quote_estimated_credits,0.125);
 assert.equal(f.calls.filter(row=>row.path.endsWith('/foart/start')).length,1);
 assert.equal(f.calls[0].body.idleDraftRequested,true);
 assert.equal(f.calls[1].body.originalIntent.idleDraftRequested,true);
 assert.equal(f.calls[2].body.originalIntent.idleDraftRequested,true);
 assert.equal((await f.scope.start(payload)).ok,false);assert.equal(f.calls.filter(row=>row.path.endsWith('/foart/start')).length,1);
});
test('a bounded multi-bone draft is tied to every selected bone and retains one settled receipt',async()=>{
 const draft=idleDraft(),context=idleContext();context.animation.selectedBones.push('body');
 draft.keys.push({boneName:'body',frame:0,values:{rotation:3}},
  {boneName:'body',frame:30,values:{rotation:6}},{boneName:'body',frame:60,values:{rotation:3}});
 const f=idleFixture(draft);const result=await f.scope.start({...f.startPayload(),message:'2秒待机动画，深度思考的感觉',foartContext:context,idleDraftRequested:true});
 assert.equal(result.ok,true);assert.deepEqual(plain(result.data.idleDraft),draft);assert.equal(result.data.quota.settled_credits,0.000002);
 assert.equal(f.events.length,1);assert.equal(f.calls.filter(row=>row.path.endsWith('/foart/start')).length,1);
});
test('idle draft capability is default closed before quote; unsolicited result is rejected after known settlement',async()=>{
 for(const mutate of [p=>delete p.config.xiaotao_online.operation_foart_idle_draft_v3,p=>{p.config.xiaotao_online.operation_foart_idle_draft_v3=false;},
  p=>{p.config.xiaotao_online.minimum_positive_credits=1;delete p.config.xiaotao_online.credit_amount_policy;delete p.config.xiaotao_online.credit_precision;delete p.config.xiaotao_online.credit_rounding;}]){
  const f=idleFixture(),p=idlePolicy();mutate(p);f.setPolicy(p);
  const result=await f.scope.start({...f.startPayload(),message:'2秒待机动画，深度思考的感觉',foartContext:idleContext(),idleDraftRequested:true});
  assert.equal(result.ok,false);assert.equal(result.providerSubmitted,false);assert.equal(f.calls.length,0);
 }
 const f=idleFixture();const result=await f.scope.start({...f.startPayload(),foartContext:idleContext()});
 assert.equal(result.ok,false);assert.equal(result.billingConfirmed,true);assert.equal(result.data.quota.settled_credits,0.000002);
});
test('idle drafts reject stale targets, unrelated bones, invalid frames, unexpected fields and non-looping poses',async()=>{
 const cases=[
  {editDraft:d=>{d.name='run';}},
  {editDraft:d=>{d.name='__proto__';}},
  {editDraft:d=>{d.name='constructor';}},
  {editDraft:d=>{d.name='prototype';}},
  {editDraft:d=>{d.keys[0].boneName='body';}},
  {editDraft:d=>{d.keys[1].frame=31;}},
  {editDraft:d=>{d.keys[1].frame=0;}},
  {editDraft:d=>{d.keys[2].values.rotation=1;}},
  {editDraft:d=>{d.keys[1].values.rotation=0;}},
  {editDraft:d=>{d.keys[1].values.rotation=181;}},
  {editDraft:d=>{d.keys[1].values.x=1;}},
  {editDraft:d=>{d.unexpected=true;}},
  {editContext:c=>{c.animation.fps=24;}}
 ];
 for(const {editDraft,editContext} of cases){const draft=idleDraft(),context=idleContext();editDraft?.(draft);editContext?.(context);
  const f=idleFixture(draft);const result=await f.scope.start({...f.startPayload(),message:'2秒待机动画，深度思考的感觉',foartContext:context,idleDraftRequested:true});
  assert.equal(result.ok,false);assert.equal(result.billingConfirmed,true);assert.equal(result.errorCode,'operation-invalid-result');
  assert.equal(result.data.quota.settled_credits,0.000002);assert.equal(f.calls.filter(row=>row.path.endsWith('/foart/start')).length,1);
 }
});
test('invalid idle intent or incomplete selection is rejected before any quote or provider call',async()=>{
 for(const change of [p=>{p.message='Open animation';},p=>{p.message='12秒待机动画';},p=>{p.message='不要做2秒待机动画';},
  p=>{p.message='2秒待机动画怎么做？';},p=>{p.message='2秒待机动画暂时不做';},p=>{p.foartContext.animation.selectedBones=[];},
  p=>{p.foartContext.animation.revision='';},p=>{p.foartContext.animation.playing=true;},
  p=>{p.foartContext.animation.selectedBones=['__proto__'];p.foartContext.animation.bones=[{name:'__proto__'}];}]){
  const f=idleFixture(),payload={...f.startPayload(),message:'2秒待机动画，深度思考的感觉',foartContext:idleContext(),idleDraftRequested:true};
  change(payload);const result=await f.scope.start(payload);
  assert.equal(result.ok,false);assert.equal(result.providerSubmitted,false);assert.equal(f.calls.length,0);
 }
});
test('general tools need the advertised policy, strip media and carry earlier steps',async()=>{
 const tool=()=>({schema:'nf.foart.tool-plan.v1',status:'act',reply:'Set',operations:[{action:'set_control',controlId:'x',value:1}]});
 let resumes=0;const routes={
  '/api/web/companion/operation/foart/start':()=>({ok:true,toolPlan:tool(),billing:{status:'pending'},continuationToken:'tool.ticket',sequence:1}),
  '/api/web/companion/operation/foart/resume':()=>++resumes===1?({ok:true,toolPlan:tool(),billing:{status:'pending'},continuationToken:'tool.ticket2',sequence:2}):({ok:true,toolPlan:done(),receipt:{status:'settled',outcome:'success',charged:1,uncollected:0}})};
 const closed=fixture(routes);assert.equal((await closed.scope.start(closed.startPayload())).ok,false);
 const f=fixture(routes),p=policy();p.config.xiaotao_online.operation_foart_general_v3=true;f.setPolicy(p);
 const first=await f.scope.start(f.startPayload());assert.equal(first.ok,true);
 const second=await f.scope.resume({requestId:'request_456',session:first.data.foartOperationSession,previousContext:context(),context:context(),
  receipt:{action:'set_control',phase:'applied',message:'done',previewUrl:'blob:x',image:'data:image/png;base64,AA'}});
 assert.equal(second.ok,true);assert.deepEqual(f.calls.at(-1).body.receipt,{action:'set_control',phase:'applied',message:'done',earlierSteps:[]});
 const final=await f.scope.resume({requestId:'request_789',session:second.data.foartOperationSession,previousContext:context(),context:context(),receipt:{action:'set_control',phase:'applied'}});
 assert.equal(final.ok,true);assert.deepEqual(f.calls.at(-1).body.receipt.earlierSteps,[{action:'set_control',phase:'applied',message:'done'}]);
});
