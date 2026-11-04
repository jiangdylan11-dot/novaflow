import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {createDomSandbox} from '../worker/src/comfy/dom-shim.mjs';

const version='sha256:'+'a'.repeat(64),fingerprint='sha256:'+'b'.repeat(64),model='xai/grok-4.7';
const operationId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',accountA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',accountB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const prefix='novaflow.xiaotao-operation-recovery.v1:',authKey='novaflow.client.auth.session.v1';
const token=owner=>'nfs_'+Buffer.from(JSON.stringify({sub:owner,exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.synthetic';
const decimalTerms={credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0};
const login=(storage,owner)=>storage.set(authKey,JSON.stringify({session:{token:token(owner)}}));
const payload=()=>({provider:'api',mode:'chat',requestId:'request_12345678',modelId:model,message:'PRIVATE PROMPT',history:[],artContext:{},
  pricingVersion:version,pricingExpiresAt:Date.now()+60000,expectedModelId:model,operationBillingV3:true});
function setup({storage=new Map(),owner=accountA,failStorage=false,execute,status,quote,pricing}={}){
  login(storage,owner);const calls=[];
  const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(failStorage&&key.startsWith(prefix))throw Error('synthetic storage failure');storage.set(key,value);},
    removeItem:key=>storage.delete(key),key:i=>[...storage.keys()][i]??null,get length(){return storage.size}};
  const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,AbortController,Event,
    crypto:{randomUUID:()=> 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},
    localStorage,atob:s=>Buffer.from(s,'base64').toString('binary'),NovaFlowClientAuth:{hasPersistedSessionIdentity:()=>true},
    NOVAFLOW_WEB_CONFIG:{localAssistant:false,authUrl:'https://auth.test',controlUrl:'https://control.test'},
    fetch:async(url,init)=>{const path=String(url);calls.push({path,body:init.body});
      if(path.endsWith('/pricing'))return pricing?pricing():Response.json({ok:false});
      if(path.endsWith('/quote'))return quote?quote():Response.json({ok:true,quote:{pricingVersion:version,quoteFingerprint:fingerprint,modelId:model,estimatedCredits:7}});
      if(path.endsWith('/operation/prepare'))return Response.json({ok:true,operation:{operationId,token:'SYNTHETIC.TICKET',model,policyVersion:version}});
      if(path.endsWith('/operation/execute'))return execute?execute():Response.json({ok:true,reply:'ok',model,receipt:{status:'settled',outcome:'success',charged:1,uncollected:0}});
      if(path.endsWith('/operation/status'))return status?status(init):Response.json({ok:true,operation:{operationId,status:'pending-reconciliation'}});
      return Response.json({ok:true});}});
  runInContext(readFileSync(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8'),createContext(sandbox));
  return {api:sandbox.electronAPI,calls,storage};
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('submitted unknown survives refresh with only account-bound ID, status query never redispatches',async()=>{
  const storage=new Map();let state='pending-reconciliation';
  const status=()=>Response.json({ok:true,operation:{operationId,status:state,...(state==='settled'?{outcome:'success',charged:1,uncollected:0}:{})}});
  const first=setup({storage,execute:()=>{throw Error('synthetic timeout')},status});
  const response=await first.api.artAgentChat(payload());assert.equal(response.ok,false);
  const key=prefix+accountA+':'+operationId;assert.equal(storage.get(key),JSON.stringify({operationId,modelId:model}));
  assert.doesNotMatch(storage.get(key),/PRIVATE|TICKET|token|image/i);
  const again=setup({storage,status});assert.deepEqual(plain(again.api.listCompanionOperationRecovery()),[{operationId,modelId:model}]);
  const check=await again.api.checkCompanionOperationRecovery(operationId);assert.equal(check.operation.status,'pending-reconciliation');
  state='unknown';assert.equal((await again.api.checkCompanionOperationRecovery(operationId)).operation.status,'unknown');
  assert.equal(again.calls.filter(x=>x.path.endsWith('/operation/execute')).length,0);
  assert.deepEqual(JSON.parse(again.calls.find(x=>x.path.endsWith('/operation/status')).body),{operationId});
  state='settled';assert.equal((await again.api.checkCompanionOperationRecovery(operationId)).operation.charged,1);
  state='pending-settlement';const statusCalls=again.calls.length;
  assert.equal((await again.api.dismissCompanionOperationRecovery(operationId)).ok,true);assert.equal(storage.has(key),false);assert.equal(again.calls.length,statusCalls);
});

test('fractional operation quote, receipt, and recovered status preserve six-digit amounts',async()=>{
  const storage=new Map();
  const first=setup({storage,
    quote:()=>Response.json({ok:true,quote:{pricingVersion:version,quoteFingerprint:fingerprint,modelId:model,estimatedCredits:0.125}}),
    execute:()=>Response.json({ok:true,reply:'ok',model,receipt:{status:'settled',outcome:'success',charged:0.000001,uncollected:0}})});
  const response=await first.api.artAgentChat(payload());assert.equal(response.ok,true);assert.equal(response.data.quota.settled_credits,0.000001);assert.equal(response.data.quota.quote_estimated_credits,0.125);
  const key=prefix+accountA+':'+operationId;assert.equal(storage.has(key),false);
  storage.set(key,JSON.stringify({operationId,modelId:model}));
  const second=setup({storage,status:()=>Response.json({ok:true,operation:{operationId,status:'settled',outcome:'cancel',charged:0.25,uncollected:0.000001,...decimalTerms}})});
  const recovered=await second.api.checkCompanionOperationRecovery(operationId);assert.equal(recovered.operation.charged,0.25);assert.equal(recovered.operation.uncollected,0.000001);
  assert.equal(storage.has(key),true);
});

test('recovery uses each frozen operation policy even when the current global policy changed',async()=>{
  for(const [snapshot,current,charged] of [
    [{},{...decimalTerms},1],
    [{...decimalTerms},{minimum_positive_credits:1},0.000001]
  ]){
    const storage=new Map(),key=prefix+accountA+':'+operationId;storage.set(key,JSON.stringify({operationId,modelId:model}));
    const f=setup({storage,pricing:()=>Response.json({ok:true,policy:{config:{xiaotao_online:current}}}),
      status:()=>Response.json({ok:true,operation:{operationId,status:'settled',outcome:'cancel',charged,uncollected:0,...snapshot}})});
    const result=await f.api.checkCompanionOperationRecovery(operationId);assert.equal(result.ok,true);assert.equal(result.operation.charged,charged);
    assert.equal((await f.api.dismissCompanionOperationRecovery(operationId)).ok,true);assert.equal(storage.has(key),false);
    assert.equal(f.calls.some(x=>x.path.endsWith('/pricing')),false);assert.equal(f.calls.some(x=>x.path.endsWith('/operation/execute')),false);
  }
});

test('recovery rejects fractional legacy, partial, and contradictory frozen policy and retains record',async()=>{
  const malformed=[
    {charged:0.125},
    {charged:0.125,credit_amount_policy:'decimal-v1'},
    {charged:0.125,...decimalTerms,credit_precision:5},
    {charged:0.125,...decimalTerms,minimum_positive_credits:1},
    {charged:0.125,...decimalTerms,credit_rounding:'floor'},
    {charged:0.0000001,...decimalTerms}
  ];
  for(const snapshot of malformed){
    const storage=new Map(),key=prefix+accountA+':'+operationId;storage.set(key,JSON.stringify({operationId,modelId:model}));
    const f=setup({storage,status:()=>Response.json({ok:true,operation:{operationId,status:'settled',outcome:'success',uncollected:0,...snapshot}})});
    assert.equal((await f.api.checkCompanionOperationRecovery(operationId)).ok,false);
    assert.equal(storage.has(key),true);
    assert.equal(f.calls.some(x=>x.path.endsWith('/pricing')),false);assert.equal(f.calls.some(x=>x.path.endsWith('/operation/execute')),false);
  }
});

test('invalid precision or malformed fractional operation quote cannot dispatch',async()=>{
  for(const amount of [0.0000001,-1,10000000000,'0.1',null]){
    const current=setup({quote:()=>Response.json({ok:true,quote:{pricingVersion:version,quoteFingerprint:fingerprint,modelId:model,estimatedCredits:amount}})});
    const result=await current.api.artAgentChat(payload());assert.equal(result.ok,false);assert.equal(result.providerSubmitted,false);
    assert.equal(current.calls.some(x=>x.path.endsWith('/operation/prepare')),false);
  }
});
test('missing cache usage after dispatch is clearly pending and never retried or reported as refunded',async()=>{
  const storage=new Map(),key=prefix+accountA+':'+operationId;
  const f=setup({storage,
    quote:()=>Response.json({ok:true,quote:{pricingVersion:version,quoteFingerprint:fingerprint,modelId:model,estimatedCredits:0.125}}),
    execute:()=>Response.json({ok:false,errorCode:'operation-usage-unknown',receipt:{status:'pending-reconciliation'}})});
  const result=await f.api.artAgentChat(payload());assert.equal(result.ok,false);assert.equal(result.providerSubmitted,true);assert.equal(result.billingUnknown,true);
  assert.match(result.error,/已提交.*积分状态待核对.*勿重复发送/);assert.doesNotMatch(result.error,/免费|退款|未扣/);
  assert.equal(f.calls.filter(x=>x.path.endsWith('/operation/execute')).length,1);assert.equal(storage.has(key),true);
  assert.equal(f.calls.some(x=>x.path.endsWith('/operation/status')),false);
});
test('storage failure prevents provider dispatch; quote failure is not marked as submitted',async()=>{
  const broken=setup({failStorage:true});const first=await broken.api.artAgentChat(payload());
  assert.equal(first.ok,false);assert.equal(first.providerSubmitted,false);assert.equal(first.errorCode,'operation-recovery-unavailable');
  assert.equal(broken.calls.some(x=>x.path.endsWith('/operation/execute')),false);
  const badQuote=setup({quote:()=>Response.json({error:'fixture'}, {status:503})});const second=await badQuote.api.artAgentChat(payload());
  assert.equal(second.ok,false);assert.equal(second.providerSubmitted,false);assert.equal(badQuote.calls.some(x=>x.path.endsWith('/operation/prepare')),false);
  assert.equal([...badQuote.storage.keys()].some(k=>k.startsWith(prefix)),false);
});
test('records are isolated by account and account switching during lookup hides the result',async()=>{
  const storage=new Map(),key=prefix+accountA+':'+operationId;storage.set(key,JSON.stringify({operationId,modelId:model}));
  const other=setup({storage,owner:accountB});assert.deepEqual(plain(other.api.listCompanionOperationRecovery()),[]);
  assert.equal((await other.api.checkCompanionOperationRecovery(operationId)).ok,false);assert.equal(other.calls.some(x=>x.path.endsWith('/operation/status')),false);
  let release;const current=setup({storage,owner:accountA,status:()=>new Promise(resolve=>{release=resolve;})});
  const pending=current.api.checkCompanionOperationRecovery(operationId);while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  login(storage,accountB);release(Response.json({ok:true,operation:{operationId,status:'settled',outcome:'success',charged:1,uncollected:0}}));
  const result=await pending;assert.equal(result.ok,false);assert.equal('operation' in result,false);assert.equal(storage.has(key),true);
});
