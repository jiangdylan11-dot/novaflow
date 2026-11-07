import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {normalizeCreditConfig} from '../packages/shared/src/feature-credits.mjs';
import {FOART_TOOL_SCHEMA,validateFoartPlan} from '../packages/shared/src/foart-tool-plan.mjs';

// What 小桃 says about money must match what the turn settled (live 2.0.338: "本次未扣费" over a settled
// 0.425809 planner fee, and "账单状态待核对" over a planner the edge worker lost). Synthetic data only.
const read=name=>readFileSync(new URL('../renderer/'+name,import.meta.url),'utf8');
const MODEL='bytedance/doubao-seed-2.1-lite',BACKUP='deepseek/deepseek-v4.1-flash',OP='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOT_ALLOWED=/待核|核对账单|请勿重复|勿重复/;
const NO_ANSWER='在线模型这次没有返回结果，本次未扣费，可以再试一次。';
const png=name=>'data:image/png;base64,'+Buffer.from(name).toString('base64');

// ---- the turn: planner fee + a writing step that failed
async function turn({cancelled,toolError=NO_ANSWER,start,before}) {
  const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,btoa:value=>Buffer.from(value,'binary').toString('base64')};
  root.window=root;createContext(root);
  runInContext(read('xiaotao-prompt-source.js'),root);runInContext(read('xiaotao-upload.js'),root);runInContext(read('xiaotao-art-agent.js'),root);
  const refs=[{drawingRole:'subject',dataUrl:png('a'),name:'a.png'}],rtState={active:true,prompt:'',mode:'img2img'};
  root.__NovaFlowArtGenerate={state:rtState,capturePrompt(){},references:()=>refs,capturePromptSourceGuard:()=>({isCurrent:()=>true}),
    captureContext:()=>({generationSurface:'drawing',state:rtState,routeRevision:1,references:refs})};
  root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA,validateFoartPlan,foartAnimationExportAllowed:()=>true,foartUnsupportedMediaAnalysis:()=>false};
  root.NovaFlowFoartTools={setUploads(){},capture:()=>({schema:FOART_TOOL_SCHEMA,controls:[]}),settlePending:async()=>null,images:async()=>[],execute:async()=>{throw Error(toolError);}};
  const config=normalizeCreditConfig({});
  Object.assign(config.xiaotao_online,{billing_scope:'operation',credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0,operation_text_chat_v3:true,operation_vision_chat_v3:true,operation_foart_open_v3:true});
  const policy={version:'sha256:'+'a'.repeat(64),expiresAt:Date.now()+60000,defaultModel:'xai/grok-4.7',config,models:[{id:'xai/grok-4.7',available:true},{id:BACKUP,available:true}]};
  let pricingReads=0;
  const plan={ok:true,data:{toolPlan:{schema:FOART_TOOL_SCHEMA,status:'act',reply:'开始',operations:[{action:'open',surface:'drawing'}]},foartOperationSession:{opaque:true}}};
  const api=()=>({captureFoartBillingOwner:()=>({owner:'test-user',current:()=>true}),captureFoartSessionGuard:()=>()=>true,
    onlineBusinessAvailableSync:()=>true,artAgentStop:async()=>({ok:true}),artAgentStatus:async()=>({ok:true}),
    companionPricing:async()=>{pricingReads++;return {ok:true,policy};},foartOperationStart:async payload=>start?start(payload):plan,foartOperationCancel:cancelled});
  const bridge={clearPrepared(){},hasResult:()=>false,async captureChat({drawingPreview,includeDrawingReferences}={}){
    return {artContext:{surface:'drawing'},images:includeDrawingReferences?refs.map((ref,i)=>({source:i+1,role:ref.drawingRole,dataUrl:ref.dataUrl,name:ref.name})):[],drawingPreview};}};
  const c=root.NovaFlowXiaotaoArtAgent.createController({bridge,api});
  assert.equal(c.setModel('xai/grok-4.7'),true);await c.refreshPricingPolicy();
  before?.(c);const readsBefore=pricingReads;
  await c.send('把图1高清放大');
  return {state:c.state,pricingReads:pricingReads-readsBefore};
}
const settledCancel=charged=>async()=>({ok:true,billingConfirmed:true,data:{quota:{status:'settled',settled_credits:charged,billing_mode:'token'}}});

test('a planner fee already settled shows the real amount, never 未扣费',async()=>{
  const c=await turn({cancelled:settledCancel(0.425809)});
  assert.match(c.state.error,/本次已扣 0\.425809 积分（规划费）/);
  assert.doesNotMatch(c.state.error,/未扣费/);assert.doesNotMatch(c.state.error,NOT_ALLOWED);
  assert.match(c.state.error,/可以再试一次/);
});
test('a turn that settled nothing keeps 未扣费',async()=>{
  const c=await turn({cancelled:settledCancel(0)});
  assert.equal(c.state.error,NO_ANSWER);
});
test('a closed turn at zero says so even when the failing step did not',async()=>{
  const c=await turn({cancelled:settledCancel(0),toolError:'提示词已写入，但生成没有完成'});
  assert.match(c.state.error,/本次未扣费/);
});
test('when the close is unconfirmed no amount and no 未扣费 is claimed',async()=>{
  const c=await turn({cancelled:async()=>({ok:false,billingUnknown:true,error:'x'})});
  assert.doesNotMatch(c.state.error,/未扣费|本次已扣/);assert.doesNotMatch(c.state.error,NOT_ALLOWED);
  assert.match(c.state.error,/没有返回结果/);
});

// ---- the price at the first send
const refused={ok:false,providerSubmitted:false,errorCode:'operation-billing-disabled',error:'操作级计费尚未开通或报价已变化，未提交。'};
const answered={ok:true,data:{toolPlan:{schema:FOART_TOOL_SCHEMA,status:'reply',reply:'好的',operations:[]},quota:{status:'settled',settled_credits:0.2,billing_mode:'token'}}};
test('a first send refused on price takes the current price and goes through once',async()=>{
  const answers=[refused,answered],seen=[];
  const c=await turn({cancelled:settledCancel(0),start:payload=>{seen.push(payload.pricingVersion);return answers.shift();}});
  assert.equal(seen.length,2);assert.equal(c.pricingReads,1);assert.equal(c.state.error,'');
});
test('a turn that really is not open says so after the one retry',async()=>{
  let starts=0;
  const c=await turn({cancelled:settledCancel(0),start:()=>{starts++;return refused;}});
  assert.equal(starts,2);assert.match(c.state.error,/尚未开通/);
});
test('a price about to lapse is renewed before the turn starts',async()=>{
  const seen=[];
  const c=await turn({cancelled:settledCancel(0),before:c=>{c.state.pricingPolicy.expiresAt=Date.now()+3000;},start:payload=>{seen.push(payload.pricingExpiresAt);return answered;}});
  assert.equal(c.pricingReads,1);assert.ok(seen[0]>Date.now()+30000,'the turn carries the fresh price');assert.equal(c.state.error,'');
});

// ---- foart operation in the runtime: the answer was lost
const runtimeSource=read('novaflow-web-runtime.js');
const between=(from,to)=>{const a=runtimeSource.indexOf(from),b=runtimeSource.indexOf(to,a);assert.ok(a>0&&b>a,from);return runtimeSource.slice(a,b);};
const creditHelpers=between('  // Operation-v3 can use','  const XIAOTAO_ONLINE_ART_RELEASE_ENABLED');
const statusHelpers=between('  // Said when a request may have reached','  // Standalone text rewrite only.');
const version='sha256:'+'a'.repeat(64);
const terms={billing_scope:'operation',credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0,operation_text_chat_v3:true,operation_foart_general_v3:true,operation_art_v3:true,operation_vision_chat_v3:true};
const policy=()=>({version,expiresAt:Date.now()+60000,models:[{id:MODEL,available:true},{id:BACKUP,available:true}],config:{xiaotao_online:terms}});
const instant=(fn,wait)=>wait<=10000?(fn(),0):0;
function runtimeScope(handlers) {
  const calls=[],guard=()=>true;
  const api=async(base,method,path,body,timeout,signal)=>{calls.push({path,body});const answer=handlers[path];if(!answer)throw Object.assign(Error('no route'),{status:404});return answer(body,signal);};
  const scope={root:{crypto:webcrypto},CONFIG:{companionUrl:'https://fixture.invalid'},AbortController,setTimeout:instant,clearTimeout(){},Date,Number,Object,JSON,Error,Set,Map,WeakMap,Promise,console,
    foartSessionObservers:new Set(),companionCloudRequests:new Map(),companionCloudUsed:new Set(),api,
    companionPricing:async()=>({ok:true,policy:policy()}),captureFoartSessionGuard:()=>guard,captureFoartBillingOwner:()=>({owner:'u',current:guard}),
    validOperationId:id=>id===OP,notifyAccountBalance(){},isXiaotaoOnlineModel:()=>true};
  createContext(scope);
  return {scope,calls};
}
function foartRuntime(start,status) {
  const f=runtimeScope({
    '/api/web/companion/quote':()=>({ok:true,quote:{pricingVersion:version,modelId:MODEL,quoteFingerprint:'sha256:'+'b'.repeat(64),estimatedCredits:1.5}}),
    '/api/web/companion/operation/foart/prepare':()=>({ok:true,model:MODEL,policyVersion:version,operationId:OP,token:'opaque'}),
    '/api/web/companion/operation/foart/start':start,'/api/web/companion/operation/status':status});
  const begin=runtimeSource.indexOf('  // Foart operation-level billing is default closed'),end=runtimeSource.indexOf('  // ------------------------------------------------------- workflow intents',begin);
  runInContext(creditHelpers+statusHelpers+'function incompleteSettlementMessage(r){return "partial";}\n'+runtimeSource.slice(begin,end)+'\nglobalThis.start=foartOperationStart;',f.scope);
  return f;
}
const startPayload=()=>({requestId:'request_123',modelId:MODEL,pricingVersion:version,pricingExpiresAt:Date.now()+60000,message:'x',history:[],foartContext:{schema:'nf.foart.tool-plan.v1',controls:[]}});
const lost=()=>{throw Object.assign(Error('在线服务达到运行限制，本次未完成，请稍后重试'),{status:546});};

test('status unknown at first, settled on a later look: the amount is reported, nothing to check',async()=>{
  let looks=0;
  const f=foartRuntime(lost,()=>++looks<3?{ok:true,operation:{operationId:OP,status:'in-progress'}}:{ok:true,operation:{operationId:OP,status:'settled',outcome:'cancel',charged:0.3,uncollected:0}});
  const r=await f.scope.start(startPayload());
  assert.equal(looks,3);assert.equal(r.billingConfirmed,true);assert.equal(r.data.quota.settled_credits,0.3);assert.equal(r.billingUnknown,undefined);
  assert.doesNotMatch(r.error,NOT_ALLOWED);assert.doesNotMatch(r.error,/未扣费/);
});
test('settled at zero says 未扣费',async()=>{
  const f=foartRuntime(lost,()=>({ok:true,operation:{operationId:OP,status:'settled',outcome:'cancel',charged:0,uncollected:0}}));
  const r=await f.scope.start(startPayload());
  assert.equal(r.error,NO_ANSWER);assert.equal(r.data.quota.settled_credits,0);
});
test('still unknown after the looks: a neutral line, the session stays for the close',async()=>{
  const f=foartRuntime(lost,()=>({ok:true,operation:{operationId:OP,status:'in-progress'}}));
  const r=await f.scope.start(startPayload());
  assert.equal(f.calls.filter(x=>x.path.endsWith('/operation/status')).length,3);
  assert.equal(r.billingUnknown,true);assert.ok(r.session);
  assert.doesNotMatch(r.error,NOT_ALLOWED);assert.doesNotMatch(r.error,/未扣费|本次已扣/);
});
test('a provider failure the server closed is told from its receipt',async()=>{
  const f=foartRuntime(()=>({ok:false,errorCode:'provider-failed',receipt:{status:'settled',outcome:'cancel',charged:0,uncollected:0}}),()=>{throw Error('must not be read');});
  const r=await f.scope.start(startPayload());
  assert.equal(r.error,NO_ANSWER);assert.equal(r.errorCode,'provider-failed');assert.equal(r.billingConfirmed,true);
});

// ---- the writing stage: a cut-off style redraw goes to the backup line once
function artRuntime({execute,status}) {
  const seen=[],controller={businessModelSnapshot:()=>({provider:'api',modelId:MODEL,epoch:1}),subscribeBusinessModel:()=>()=>{}};
  const f=runtimeScope({
    '/api/web/companion/art/quote':body=>{seen.push(body.modelId);return {ok:true,quote:{stage:'structure',model:body.modelId,requestId:'request_'+seen.length,pricingVersion:version,estimatedCredits:0.4,maxOutputTokens:2048,quoteToken:'t',imageCount:2,billingScope:'operation-v3',recoveryOperationId:OP}};},
    '/api/web/companion/art/execute':execute,'/api/web/companion/operation/status':status});
  Object.assign(f.scope,{currentSession:()=>({token:'t'}),onlineVisionImage:async url=>url,operationCreditPolicy:()=>true,validOperationQuote:()=>true,flatRateOnlineModel:()=>false,onlineOperationModel:()=>true});
  f.scope.root.NovaFlowXiaotaoArtAgent={panel:{controller}};
  const begin=runtimeSource.indexOf('  // The person picks the model.'),end=runtimeSource.indexOf('  async function localPromptAssistant');
  runInContext(creditHelpers+statusHelpers+'function incompleteSettlementMessage(r){return "partial";}\n'+runtimeSource.slice(begin,end)+'\nglobalThis.art=selectedOnlineArtBusiness;',f.scope);
  const run=confirm=>f.scope.art({requestId:webcrypto.randomUUID(),currentDrawingVisionOnly:true,currentPrompt:'x',requirements:'',targetEngine:'qwen-2.1',promptContract:'qwen21-native-rewrite-v3',qwenPromptMode:'img2img',
    images:[{role:'subject',dataUrl:png('a')},{role:'style',dataUrl:png('b')}],confirmImageUpload:async()=>true,isImageInputCurrent:()=>true,onPricingQuote(){},confirmPricingQuote:async()=>confirm,onBillingNotice:()=>true},{provider:'api',modelId:MODEL,epoch:1},controller);
  return {...f,seen,run};
}
test('a cut-off style redraw is resent straight on the backup line, once',async()=>{
  const f=artRuntime({execute:lost,status:()=>({ok:true,operation:{operationId:OP,status:'in-progress'}})});
  const first=await f.run(true);
  assert.equal(first.errorCode,'assistant-business-interrupted');assert.doesNotMatch(first.error,NOT_ALLOWED);
  await f.run(false);await f.run(false);
  assert.deepEqual(f.seen,[MODEL,BACKUP,MODEL],'the backup line is used for the one resend only');
});
test('an interrupted stage the server settled at zero reads the status and says 未扣费',async()=>{
  let looks=0;
  const f=artRuntime({execute:lost,status:()=>++looks<2?{ok:true,operation:{operationId:OP,status:'in-progress'}}:{ok:true,operation:{operationId:OP,status:'settled',outcome:'cancel',charged:0,uncollected:0}}});
  const r=await f.run(true);
  assert.equal(r.errorCode,'provider-failed');assert.equal(r.error,NO_ANSWER);assert.equal(looks,2);
});

// ---- no leftover wording
test('no user-facing 待核对 / 核对账单 text remains',()=>{
  const files=['renderer/novaflow-web-runtime.js','renderer/xiaotao-art-agent.js','renderer/audio-studio.tool.js','renderer/novaflow-brand-runtime.js',
    'packages/shared/src/online-ai-charge.mjs','packages/shared/src/backend-legacy-v249-online-ai-charge.mjs','packages/shared/src/companion-pricing-context.mjs','packages/shared/src/xiaotao-v2-credit-ports.mjs'];
  for(const file of files){
    const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/(?<!等)待核|核对账单/,file);
  }
});
