import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createDomSandbox} from '../worker/src/comfy/dom-shim.mjs';
const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const model='deepseek/deepseek-v4.1-flash',version='sha256:'+'a'.repeat(64),fingerprint='sha256:'+'b'.repeat(64),operationId='7f4664c1-4e01-41cc-8b5e-c74dc61232a4';
const token='nfs_'+Buffer.from(JSON.stringify({sub:'synthetic-user',exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.fixture';
function fixture({available=true,open=true}={}) {
 const calls=[],events=new Map(),policy={version,expiresAt:Date.now()+120000,models:[{id:model,available}],config:{xiaotao_online:{billing_scope:'operation',minimum_positive_credits:1,operation_text_chat_v3:true,operation_foart_open_v3:open,operation_foart_general_v3:open}}};
 const root=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,Event,TextEncoder,TextDecoder,crypto:webcrypto,NOVAFLOW_LIGHT_HOME:true,NOVAFLOW_WEB_CONFIG:{authUrl:'https://fixture.invalid/novaflow-backend',companionUrl:'https://fixture.invalid/novaflow-companion'},addEventListener:(n,f)=>{if(!events.has(n))events.set(n,new Set());events.get(n).add(f)},removeEventListener:(n,f)=>events.get(n)?.delete(f),dispatchEvent:()=>true,
  fetch:async(url,init={})=>{const target=String(url);assert(target.startsWith('https://fixture.invalid/'));const body=init.body?JSON.parse(init.body):null;calls.push({target,body});if(target.endsWith('/pricing'))return Response.json({ok:true,policy});if(target.endsWith('/quote'))return Response.json({ok:true,quote:{modelId:model,pricingVersion:version,quoteFingerprint:fingerprint,estimatedCredits:1}});if(target.endsWith('/foart/prepare'))return Response.json({ok:true,model,policyVersion:version,operationId,token:'fixture-operation'});if(target.endsWith('/foart/start'))return Response.json({ok:true,toolPlan:{schema:'nf.foart.tool-plan.v1',status:'done',reply:'synthetic',operations:[]},receipt:{status:'settled',outcome:'success',charged:1,uncollected:0}});throw Error('unexpected route');}});
 root.localStorage.setItem('novaflow_web_session_v1',JSON.stringify({token,user:{id:'synthetic-user'}}));root.NovaFlowClientAuth={hasPersistedSessionIdentity:()=>true};runInContext(source,createContext(root));
 const payload={provider:'api',requestId:'synthetic_1',mode:'foart',message:'synthetic',history:[],modelId:model,expectedModelId:model,pricingVersion:version,pricingExpiresAt:policy.expiresAt,operationBillingV3:true,foartContext:{schema:'nf.foart.tool-plan.v1',controls:[]}};
 return {root,calls,payload};
}
test('DeepSeek FOART preserves chosen model through quote, prepare and execute',async()=>{const f=fixture(),r=await f.root.electronAPI.foartOperationStart(f.payload);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(f.calls.find(x=>x.target.endsWith('/quote')).body.modelId,model);assert.equal(f.calls.find(x=>x.target.endsWith('/foart/prepare')).body.model,model);assert.equal(f.calls.filter(x=>x.target.endsWith('/foart/start')).length,1);assert.equal(r.data.quota.settled_credits,1);});
for(const opts of [{available:false},{open:false}])test('DeepSeek closed policy stops without dispatch '+JSON.stringify(opts),async()=>{const f=fixture(opts),r=await f.root.electronAPI.foartOperationStart(f.payload);assert.equal(r.ok,false);assert.equal(r.providerSubmitted,false);assert.ok(!f.calls.some(x=>x.target.endsWith('/foart/start')));});
