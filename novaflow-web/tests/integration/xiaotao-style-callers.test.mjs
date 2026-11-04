import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {randomUUID} from 'node:crypto'

const aifxSource = readFileSync(new URL('../../renderer/aifx-repaint-runtime.js', import.meta.url),'utf8')
const spineSource = readFileSync(new URL('../../renderer/spine-split-runtime.js', import.meta.url),'utf8')
function setup() {
  const storage=new Map(), calls=[], notices=[], confirms=[]
  const selection={provider:'api',modelId:'xai/grok-4.7',epoch:1}
  let loggedIn=true
  const owner={owner:'user1',current:()=>loggedIn}, guard=()=>loggedIn
  const controller={businessModelSnapshot:()=>({...selection}),recordBusinessBillingNotice:(n,b)=>{notices.push({n,b});return true}}
  class Node {constructor(){this.style={setProperty(){}};this.classList={contains:()=>false,add(){},remove(){}};this.dataset={};this.children=[]} setAttribute(){} addEventListener(){} appendChild(c){this.children.push(c);return c} querySelector(){return null} querySelectorAll(){return []}}
  const document={readyState:'complete',head:new Node(),body:new Node(),documentElement:new Node(),addEventListener(){},removeEventListener(){},getElementById(){return null},querySelector(){return null},querySelectorAll(){return []},createElement(tag){const n=new Node();if(tag==='canvas'){n.getContext=()=>({fillRect(){},drawImage(){}});n.toDataURL=()=> 'data:image/jpeg;base64,QQ=='}return n}}
  const ctx={console,setTimeout,clearTimeout,URL,Blob,performance,Math,JSON,Promise,AbortController,document,crypto:{randomUUID},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},confirm(msg){confirms.push(msg);return ctx.approve!==false},NovaFlowXiaotaoArtAgent:{panel:{controller}},electronAPI:{captureFoartBillingOwner:()=>owner,captureFoartSessionGuard:()=>guard,async promptAssistantDescribeArtStyle(payload){calls.push(payload);return ctx.reply ? ctx.reply(payload): {ok:true,material:{name:'test',material:'soft',elements:'',colours:'',breakup:''},supplement:'soft glow',style:'painted'}}}}
  ctx.window=ctx;ctx.globalThis=ctx
  const instrumented=aifxSource.replace('  window.NovaFlowAifxMvp = {','  window.__aifxState = state; window.NovaFlowAifxMvp = {')
  vm.runInNewContext(instrumented,ctx)
  const image={naturalWidth:40,naturalHeight:40};const blob={};ctx.__aifxState.source={};ctx.__aifxState.reference={blob,image};ctx.NovaFlowAifxMvp.setMaterialEngine('xiaotao')
  return {ctx,controller,selection,calls,notices,confirms,image,blob,logout(){loggedIn=false}}
}

test('AIFX selected model sends snapshot and separates image consent, quote and durable receipt',async()=>{
 const p=setup();p.ctx.reply=async x=>{assert.equal(x.assistantSelectionScope,'xiaotao');assert.equal(x.assistantModelId,'xai/grok-4.7');assert.equal(await x.confirmImageUpload({count:1}),true);assert.equal(await x.confirmPricingQuote({estimatedCredits:2}),true);assert.equal(x.onBillingNotice({requestId:x.requestId,modelId:x.assistantModelId,submitted:true,quota:{status:'settled',settled_credits:2},unknown:false}),true);return {ok:true,material:{name:'test',material:'soft',elements:'',colours:'',breakup:''}}};const r=await p.ctx.NovaFlowAifxMvp.recognizeMaterial(p.blob,p.image);assert.equal(r.read.material,'soft');assert.equal(p.confirms.length,2);assert.match(p.confirms[1],/预估不是上限/);assert.equal(p.notices.length,1);assert.equal(p.notices[0].b.selection.modelId,'xai/grok-4.7')
})
test('AIFX quote states a one-credit minimum only for the legacy policy',async()=>{
 for(const legacy of [true,false]){
  const p=setup();p.controller.onlineOperationMinimumConfirmed=()=>legacy;
  p.ctx.reply=async x=>{assert.equal(await x.confirmPricingQuote({estimatedCredits:legacy?1:0.125}),true);return {ok:true,material:{name:'test',material:'soft',elements:'',colours:'',breakup:''}}};
  await p.ctx.NovaFlowAifxMvp.recognizeMaterial(p.blob,p.image);
  assert.equal(/最低 1 积分/.test(p.confirms[0]),legacy);
  assert.match(p.confirms[0],legacy?/预估 1 积分/:/预估 0\.125 积分/);
 }
})
test('AIFX cancelled image consent never turns into a successful material',async()=>{const p=setup();p.ctx.approve=false;p.ctx.reply=async x=>{assert.equal(await x.confirmImageUpload({count:1}),false);return {ok:false,error:'已取消上传'}};const r=await p.ctx.NovaFlowAifxMvp.recognizeMaterial(p.blob,p.image);assert.equal(r.read,null);assert.match(r.error,/取消/);assert.equal(p.notices.length,0)})
test('AIFX model or source change discards pending result',async()=>{const p=setup();p.ctx.reply=async()=>{p.selection.epoch++;return {ok:true,material:{material:'stale'}}};const r=await p.ctx.NovaFlowAifxMvp.recognizeMaterial(p.blob,p.image);assert.equal(r.read,null);assert.match(r.error,/变化/);assert.equal(p.calls.length,1)})
test('AIFX local image confirmation discloses node storage and possible delay',async()=>{const p=setup();p.selection.provider='local';p.selection.modelId='qwen3.5-9b-heretic';p.ctx.reply=async x=>{assert.equal(x.onBillingNotice,undefined);assert.equal(await x.confirmNodeUpload({count:1,nodeName:'mine',nodeIdSuffix:'123',retentionHours:24}),true);return {ok:true,material:{name:'test',material:'soft',elements:'',colours:'',breakup:''}}};await p.ctx.NovaFlowAifxMvp.recognizeMaterial(p.blob,p.image);assert.match(p.confirms[0],/24.*延后/);assert.equal(p.notices.length,0)})
test('AIFX unknown billing stops repeated scoped requests',async()=>{const p=setup();p.ctx.reply=async()=>({ok:false,billingUnknown:true,error:'账单待核对'});await p.ctx.NovaFlowAifxMvp.recognizeMaterial(p.blob,p.image);const r=await p.ctx.NovaFlowAifxMvp.recognizeMaterial(p.blob,p.image);assert.equal(p.calls.length,1);assert.match(r.error,/勿重复/)})

test('Spine selected style failure stops generation, legacy failure requires explicit confirmation',async()=>{
 const start=spineSource.indexOf('  let objectTransferXiaotaoOutcomeUnknown = false'),end=spineSource.indexOf('\n  // Scene styles that',start)
 const code=spineSource.slice(start,end)+'\nthis.call=objectTransferSceneArtStyleText'
 const p=setup(),tool={useXiaotaoStyle:true,referenceCutoutDataUrl:'cut',x:0,y:0,scale:1},state={source:{},busy:true,busyAction:'objectTransfer'}
 Object.assign(p.ctx,{state,objectTransferState:()=>tool,setSplitBusyDetail(){}});vm.runInNewContext(code,p.ctx)
 p.ctx.reply=async()=>({ok:false,error:'未开通'});await assert.rejects(p.ctx.call({toDataURL:()=> 'data:image/png;base64,QQ=='}),/未开通/)
 tool.useXiaotaoStyle=false;p.ctx.approve=false;p.ctx.reply=async()=>({ok:false});await assert.rejects(p.ctx.call({toDataURL:()=> 'data:image/png;base64,QQ=='}),/取消/)
 p.ctx.approve=true;assert.equal(await p.ctx.call({toDataURL:()=> 'data:image/png;base64,QQ=='}),'')
})

test('AIFX material and supplement share a single selected-model operation',async()=>{
 const p=setup();p.ctx.addEventListener=()=>{};p.ctx.removeEventListener=()=>{};p.ctx.NovaFlowAifxRestyleWorkflow={getPreset:()=>null,splitSupplement:()=>({additions:'轻轻飘动'}),referenceMaterial:()=> 'soft'};p.ctx.NovaFlowAifxRestyleClient={ensureRuntime:async()=>{throw Error('fixture: stop before generation')}};p.ctx.__aifxState.supplement='轻轻飘动';p.ctx.__aifxState.reference.materialState='failed';
 p.ctx.reply=async x=>{assert.equal(x.purpose,'aifx-material-supplement');assert.equal(x.supplement,'轻轻飘动');assert.equal(await x.confirmImageUpload({count:1}),true);assert.equal(await x.confirmPricingQuote({estimatedCredits:1}),true);assert(x.onBillingNotice({requestId:x.requestId,modelId:x.assistantModelId,submitted:true,quota:{status:'settled',settled_credits:1},unknown:false}));return {ok:true,material:{name:'test',material:'soft',elements:'',colours:'',breakup:''},supplement:'move softly'}};
 await assert.rejects(p.ctx.NovaFlowAifxMvp.runProductionPipeline(),/fixture: stop/);assert.equal(p.calls.length,1);assert.equal(p.notices.length,1);assert.equal(p.confirms.length,2)
})
test('Spine selected online passes consent, snapshot and persistent receipt',async()=>{
 const start=spineSource.indexOf('  let objectTransferXiaotaoOutcomeUnknown = false'),end=spineSource.indexOf('\n  // Scene styles that',start),p=setup(),tool={useXiaotaoStyle:true,referenceCutoutDataUrl:'cut',x:0,y:0,scale:1}
 Object.assign(p.ctx,{state:{source:{},busy:true,busyAction:'objectTransfer'},objectTransferState:()=>tool,setSplitBusyDetail(){}});vm.runInNewContext(spineSource.slice(start,end)+'\nthis.call=objectTransferSceneArtStyleText',p.ctx)
 p.ctx.reply=async x=>{assert.equal(x.assistantSelectionScope,'xiaotao');assert.equal(await x.confirmImageUpload({count:1}),true);assert.equal(await x.confirmPricingQuote({estimatedCredits:1}),true);assert(x.onBillingNotice({requestId:x.requestId,modelId:x.assistantModelId,submitted:true,quota:{status:'settled',settled_credits:1},unknown:false}));return {ok:true,style:'painted'}}
 assert.equal(await p.ctx.call({toDataURL:()=> 'data:image/png;base64,QQ=='}),'painted');assert.equal(p.notices.length,1);assert.equal(p.confirms.length,2)
})

test('AIFX combined image denial stops before runtime and billing',async()=>{
 const p=setup();p.ctx.addEventListener=()=>{};p.ctx.removeEventListener=()=>{};let runtimeCalls=0;p.ctx.NovaFlowAifxRestyleWorkflow={getPreset:()=>null,splitSupplement:()=>({additions:'慢慢飘动'}),referenceMaterial:()=> 'soft'};p.ctx.NovaFlowAifxRestyleClient={ensureRuntime:async()=>{runtimeCalls++}};p.ctx.__aifxState.supplement='慢慢飘动';p.ctx.__aifxState.reference.materialState='failed';p.ctx.approve=false;
 p.ctx.reply=async x=>{assert.equal(x.purpose,'aifx-material-supplement');assert.equal(await x.confirmImageUpload({count:1}),false);return {ok:false,error:'已取消上传'}};
 await assert.rejects(p.ctx.NovaFlowAifxMvp.runProductionPipeline(),/取消/);assert.equal(p.calls.length,1);assert.equal(runtimeCalls,0);assert.equal(p.notices.length,0)
})
test('AIFX changing model in combined operation prevents runtime and generation',async()=>{
 const p=setup();p.ctx.addEventListener=()=>{};p.ctx.removeEventListener=()=>{};let runtimeCalls=0;p.ctx.NovaFlowAifxRestyleWorkflow={getPreset:()=>null,splitSupplement:()=>({additions:'慢慢飘动'}),referenceMaterial:()=> 'soft'};p.ctx.NovaFlowAifxRestyleClient={ensureRuntime:async()=>{runtimeCalls++}};p.ctx.__aifxState.supplement='慢慢飘动';p.ctx.__aifxState.reference.materialState='failed';
 p.ctx.reply=async()=>{p.selection.epoch++;return {ok:true,material:{name:'x',material:'soft',elements:'',colours:'',breakup:''},supplement:'float'}};
 await assert.rejects(p.ctx.NovaFlowAifxMvp.runProductionPipeline(),/变化|未完成/);assert.equal(runtimeCalls,0);assert.equal(p.calls.length,1)
})

test('Spine changing scene during the selected-model request discards the output',async()=>{
 const start=spineSource.indexOf('  let objectTransferXiaotaoOutcomeUnknown = false'),end=spineSource.indexOf('\n  // Scene styles that',start),p=setup(),tool={useXiaotaoStyle:true,referenceCutoutDataUrl:'cut',x:0,y:0,scale:1},state={source:{},busy:true,busyAction:'objectTransfer'}
 Object.assign(p.ctx,{state,objectTransferState:()=>tool,setSplitBusyDetail(){}});vm.runInNewContext(spineSource.slice(start,end)+'\nthis.call=objectTransferSceneArtStyleText',p.ctx)
 p.ctx.reply=async()=>{state.source={};return {ok:true,style:'painted'}};await assert.rejects(p.ctx.call({toDataURL:()=> 'data:image/png;base64,QQ=='}),/变化/);assert.equal(p.calls.length,1)
})
