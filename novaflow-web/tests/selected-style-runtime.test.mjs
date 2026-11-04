import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createDomSandbox} from '../worker/src/comfy/dom-shim.mjs';
import {canonicalizeXiaotaoV3StyleIntent,inspectXiaotaoV3StyleReply} from '../packages/shared/src/xiaotao-style-framework-v3.mjs';

const source=await readFile(process.env.FOART_STYLE_RUNTIME||new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const models=['deepseek/deepseek-v4.1-flash','xai/grok-4.7','openai/gpt-6.1-sol-saver'];
const version='sha256:'+'a'.repeat(64),id='7f4664c1-4e01-41cc-8b5e-c74dc61232a4';
const token='nfs_'+Buffer.from(JSON.stringify({sub:'synthetic-user',exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.fixture';
const png='data:image/png;base64,'+(await readFile(new URL('./style-canvas-synthetic.png',import.meta.url))).toString('base64');

function fixture({model=models[0],vision=true,enabled=true,uncollected=0,wrongModel=false,upload=true,confirm=true,decimal=false,estimatedCredits,charged=1}={}) {
  const calls=[],events=new Map(),policy={version,expiresAt:Date.now()+120000,models:models.map(id=>({id,available:true})),config:{xiaotao_online:{billing_scope:'operation',minimum_positive_credits:decimal?0:1,...(decimal?{credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil'}:{}),operation_style_v3:enabled,operation_vision_chat_v3:true,operation_style_vision_models:vision?models:[]}}};
  const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,Event,TextEncoder,TextDecoder,crypto:webcrypto,
    NOVAFLOW_LIGHT_HOME:true,NOVAFLOW_WEB_CONFIG:{authUrl:'https://fixture.invalid/novaflow-backend',companionUrl:'https://fixture.invalid/novaflow-companion'},
    addEventListener:(n,f)=>{if(!events.has(n))events.set(n,new Set());events.get(n).add(f)},removeEventListener:(n,f)=>events.get(n)?.delete(f),dispatchEvent:()=>true,
    fetch:async(url,init={})=>{const target=String(url);assert(target.startsWith('https://fixture.invalid/'));const body=init.body?JSON.parse(init.body):null;calls.push({target,body});
      if(target.endsWith('/pricing'))return Response.json({ok:true,policy});
      if(target.endsWith('/operation/prepare')){const parsed=canonicalizeXiaotaoV3StyleIntent(body.intent);return Response.json({ok:true,operation:{model,policyVersion:version,operationId:id,token:'fixture-operation',intentHash:parsed.intentHash,estimatedCredits:estimatedCredits??(parsed.intent.kind==='aifx-material-supplement'?2:1),outputTokens:parsed.compiled.outputTokens}})}
      if(target.endsWith('/operation/execute')){const parsed=canonicalizeXiaotaoV3StyleIntent(body.intent),kind=parsed.intent.kind,reply=kind==='style'?'Ink: thin lines.':kind==='aifx-supplement'?'more sparks':'{"name":"STAR","elements":"made of stars","colours":"blue","breakup":"It disperses"}',styleResult=kind==='aifx-material-supplement'?{...inspectXiaotaoV3StyleReply({kind:'aifx-material',reply}),...inspectXiaotaoV3StyleReply({kind:'aifx-supplement',reply:'more sparks'})}:inspectXiaotaoV3StyleReply({kind,reply});return Response.json({ok:true,model:wrongModel?models[1]:model,styleResult,receipt:{status:'settled',outcome:'success',charged,uncollected}})}
      throw Error('unexpected '+target);
    }});
  sandbox.localStorage.setItem('novaflow_web_session_v1',JSON.stringify({token,user:{id:'synthetic-user'}}));
  sandbox.Image=class {constructor(){this.naturalWidth=1;this.naturalHeight=1;}set src(_value){queueMicrotask(()=>this.onload());}};
  const createElement=sandbox.document.createElement.bind(sandbox.document);
  sandbox.document.createElement=(tag)=>tag==='canvas'?{width:0,height:0,getContext:()=>({drawImage:()=>{}}),toDataURL:()=>png}:createElement(tag);
  sandbox.NovaFlowClientAuth={hasPersistedSessionIdentity:()=>true};
  const selected={provider:'api',modelId:model,epoch:3};
  sandbox.NovaFlowXiaotaoArtAgent={panel:{controller:{businessModelSnapshot:()=>selected,subscribeBusinessModel:()=>()=>{}}}};
  runInContext(source,createContext(sandbox));
  const common={requestId:id,assistantSelectionScope:'xiaotao',assistantProvider:'api',assistantModelId:model,assistantSelectionEpoch:3,onPricingQuote:()=>{},confirmPricingQuote:async()=>confirm,onBillingNotice:()=>true,isInputCurrent:()=>true,confirmImageUpload:async()=>upload};
  return {sandbox,calls,common};
}
for(const model of models)for(const kind of ['style','aifx-material','aifx-supplement'])test(`${model} ${kind} uses exact model and V3 receipt`,async()=>{
  const f=fixture({model}),payload={...f.common,...(kind==='aifx-supplement'?{purpose:kind,supplement:'more sparks'}:{purpose:kind,name:'fixture.png',dataUrl:png})};
  const result=await f.sandbox.electronAPI.promptAssistantDescribeArtStyle(payload);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.model,model);assert.equal(result.quota.settled_credits,1);
  const prep=f.calls.find(x=>x.target.endsWith('/operation/prepare'));assert.equal(prep.body.model,model);assert.equal(prep.body.intent.kind,kind);
  const exec=f.calls.find(x=>x.target.endsWith('/operation/execute'));assert.deepEqual(exec.body.intent,prep.body.intent);
  if(kind==='style')assert.equal(prep.body.intent.images[0].role,'style');if(kind==='aifx-material')assert.equal(prep.body.intent.images[0].role,'material');
  if(kind==='aifx-supplement')assert.equal('images' in prep.body.intent,false);
});
for(const [options,label] of [[{vision:false},'no vision'],[{enabled:false},'disabled'],[{upload:false},'upload denied'],[{confirm:false},'quote denied']])test(label+' never submits',async()=>{
  const f=fixture(options),result=await f.sandbox.electronAPI.promptAssistantDescribeArtStyle({...f.common,purpose:'style',name:'fixture.png',dataUrl:png});
  assert.equal(result.ok,false,JSON.stringify(result));assert.equal(f.calls.filter(x=>x.target.endsWith('/operation/execute')).length,0);
});
test('decimal style operation preserves fractional quote and settled charge',async()=>{
  const f=fixture({decimal:true,estimatedCredits:0.125,charged:0.000001});
  const result=await f.sandbox.electronAPI.promptAssistantDescribeArtStyle({...f.common,purpose:'aifx-supplement',supplement:'more sparks'});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.quota.quote_estimated_credits,0.125);assert.equal(result.quota.settled_credits,0.000001);
  assert.equal(f.calls.filter(x=>x.target.endsWith('/operation/execute')).length,1);
});
test('decimal style rejects an over-precision quote before dispatch',async()=>{
  const f=fixture({decimal:true,estimatedCredits:0.0000001});
  const result=await f.sandbox.electronAPI.promptAssistantDescribeArtStyle({...f.common,purpose:'aifx-supplement',supplement:'more sparks'});
  assert.equal(result.ok,false);assert.equal(result.providerSubmitted,false);assert.equal(f.calls.filter(x=>x.target.endsWith('/operation/execute')).length,0);
});
test('decimal style marks a malformed post-dispatch amount unknown rather than freeing it',async()=>{
  const f=fixture({decimal:true,estimatedCredits:0.125,charged:0.0000001});
  const result=await f.sandbox.electronAPI.promptAssistantDescribeArtStyle({...f.common,purpose:'aifx-supplement',supplement:'more sparks'});
  assert.equal(result.ok,false);assert.equal(result.providerSubmitted,true);assert.equal(result.billingUnknown,true);
});
for(const options of [{uncollected:1},{wrongModel:true}])test('partial receipt or wrong model cannot succeed '+JSON.stringify(options),async()=>{
  const f=fixture(options),result=await f.sandbox.electronAPI.promptAssistantDescribeArtStyle({...f.common,purpose:'aifx-supplement',supplement:'more sparks'});
  assert.equal(result.ok,false,JSON.stringify(result));assert.equal(f.calls.filter(x=>x.target.endsWith('/operation/execute')).length,1);
  if(options.uncollected)assert.equal(result.quota.uncollected_credits,1);
});
test('supplement collapses whitespace before truncating by Unicode code point',async()=>{
  const f=fixture(),input='小'+' '.repeat(500)+'星'+'✨'.repeat(500),result=await f.sandbox.electronAPI.promptAssistantDescribeArtStyle({...f.common,purpose:'aifx-supplement',supplement:input});
  assert.equal(result.ok,true,JSON.stringify(result));const sent=f.calls.find(x=>x.target.endsWith('/operation/prepare')).body.intent.supplement;
  assert.ok(sent.startsWith('小 星'));assert.equal(Array.from(sent).length,400);assert.ok(!sent.includes('\ud800'));
});
test('combined material and supplement makes one quote and one billed operation',async()=>{
  const f=fixture(),result=await f.sandbox.electronAPI.promptAssistantDescribeArtStyle({...f.common,purpose:'aifx-material-supplement',name:'fixture.png',dataUrl:png,supplement:'more sparks'});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.supplement,'more sparks');assert.equal(result.quota.settled_credits,1);assert.equal(result.quota.quote_estimated_credits,2);
  const prep=f.calls.filter(x=>x.target.endsWith('/operation/prepare')),exec=f.calls.filter(x=>x.target.endsWith('/operation/execute'));
  assert.equal(prep.length,1);assert.equal(exec.length,1);assert.equal(prep[0].body.intent.images[0].role,'material');assert.equal(prep[0].body.intent.supplement,'more sparks');assert.deepEqual(exec[0].body.intent,prep[0].body.intent);
});
test('combined material and supplement cancellation does not dispatch',async()=>{
  const f=fixture({confirm:false}),result=await f.sandbox.electronAPI.promptAssistantDescribeArtStyle({...f.common,purpose:'aifx-material-supplement',name:'fixture.png',dataUrl:png,supplement:'more sparks'});
  assert.equal(result.ok,false);assert.equal(result.providerSubmitted,false);assert.equal(f.calls.filter(x=>x.target.endsWith('/operation/prepare')).length,1);assert.equal(f.calls.filter(x=>x.target.endsWith('/operation/execute')).length,0);
});
