import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {createDomSandbox} from '../../worker/src/comfy/dom-shim.mjs';

const version='sha256:'+'a'.repeat(64), fingerprint='sha256:'+'b'.repeat(64);
function setup(quoteVersion=version,{model='glm/glm-5.3-flash',operationResult}={}) {
  const token='nfs_'+Buffer.from(JSON.stringify({sub:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.synthetic';
  const requests=[],storage=new Map([['novaflow.client.auth.session.v1',JSON.stringify({session:{token}})]]);
  const sandbox=createDomSandbox({setTimeout:(fn,ms)=>setTimeout(fn,ms<=10000?1:ms),clearTimeout,Image:undefined,Response,Request,Blob,FormData,AbortSignal,AbortController,Event,
    crypto:{randomUUID:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key),key:i=>[...storage.keys()][i]??null,get length(){return storage.size}},
    atob:s=>Buffer.from(s,'base64').toString('binary'),NovaFlowClientAuth:{hasPersistedSessionIdentity:()=>true},
    NOVAFLOW_WEB_CONFIG:{localAssistant:false,authUrl:'https://auth.test',controlUrl:'https://control.test'},
    fetch:async(url,init)=>{const path=String(url);requests.push({path,init});
      if(path.endsWith('/pricing'))return Response.json({ok:true,policy:{version,expiresAt:Date.now()+60000,models:[],config:{}}});
      if(path.endsWith('/quote'))return Response.json({ok:true,quote:{pricingVersion:quoteVersion,quoteFingerprint:fingerprint,modelId:model,estimatedCredits:7}});
      if(path.endsWith('/operation/prepare'))return Response.json({ok:true,operation:{operationId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',token:'fixture.signature',model,policyVersion:version}});
      if(path.endsWith('/operation/execute'))return Response.json(operationResult||{ok:true,reply:'收到',model,receipt:{status:'settled',outcome:'success',charged:1,uncollected:0}});
      if(path.endsWith('/chat'))return Response.json({ok:true,reply:'收到',model:'glm/glm-5.3-flash',quota:{settled_credits:2}});
      return Response.json({ok:true});}});
  runInContext(readFileSync(new URL('../../renderer/novaflow-web-runtime.js',import.meta.url),'utf8'),createContext(sandbox));
  return {api:sandbox.electronAPI,requests,companion:()=>requests.filter(request=>/\/api\/web\/companion\/(pricing|quote|chat)$/.test(request.path))};
}
const payload=()=>({provider:'api',mode:'chat',requestId:'request-12345678',modelId:'glm/glm-5.3-flash',message:'只发给已选模型',history:[],artContext:{surface:'other'},pricingVersion:version,pricingExpiresAt:Date.now()+60000,expectedModelId:'glm/glm-5.3-flash'});

test('explicit online request quotes its exact payload before one version-bound chat',async()=>{
  const {api,companion}=setup();assert.equal((await api.companionPricing()).ok,true);let requests=companion();
  assert.equal(requests[0].init.method,'GET');assert.equal(requests[0].init.body,undefined);
  let quoteEvent;const result=await api.artAgentChat({...payload(),onPricingQuote:value=>{quoteEvent=value;}});assert.equal(result.ok,true);requests=companion();
  assert.equal(quoteEvent.estimatedCredits,7);assert.equal(result.data.quota.quote_estimated_credits,7);assert.equal(result.data.quota.settled_credits,2);
  const quote=JSON.parse(requests[1].init.body),chat=JSON.parse(requests[2].init.body);
  assert.match(requests[1].path,/\/quote$/);assert.match(requests[2].path,/\/chat$/);
  assert.deepEqual({...chat,pricingVersion:undefined,quoteFingerprint:undefined},{...quote,pricingVersion:undefined,quoteFingerprint:undefined});
  assert.equal(chat.pricingVersion,version);assert.equal(chat.quoteFingerprint,fingerprint);
});

test('explicit operation billing uses quote, signed prepare and execute with actual receipt',async()=>{
  const {api,requests}=setup(version,{model:'xai/grok-4.7'});
  const result=await api.artAgentChat({...payload(),modelId:'xai/grok-4.7',expectedModelId:'xai/grok-4.7',artContext:{},operationBillingV3:true});
  assert.equal(result.ok,true);assert.equal(result.data.quota.settled_credits,1);assert.equal(result.data.quota.quote_estimated_credits,7);
  const sent=requests.filter(row=>row.path.includes('/api/web/companion/'));
  assert.deepEqual(sent.map(row=>row.path.split('/').slice(-2).join('/')),['companion/quote','operation/prepare','operation/execute']);
  const prepare=JSON.parse(sent[1].init.body),execute=JSON.parse(sent[2].init.body);
  assert.equal(prepare.model,'xai/grok-4.7');assert.equal(execute.operationToken,'fixture.signature');assert.deepEqual(execute.intent,prepare.intent);
  assert.equal('pricingVersion' in execute,false);assert.equal('model' in execute,false);
});
test('operation billing rejects tools, media and context without fallback',async()=>{
  for(const changed of [{mode:'foart'},{images:[{dataUrl:'data:image/png;base64,AAAA'}]},{artContext:{surface:'drawing'}},{uploads:[{kind:'video',name:'x.mp4'}]}]){
    const {api,requests}=setup(version,{model:'xai/grok-4.7'});
    const result=await api.artAgentChat({...payload(),modelId:'xai/grok-4.7',expectedModelId:'xai/grok-4.7',artContext:{},operationBillingV3:true,...changed});
    assert.equal(result.ok,false);assert.equal(result.providerSubmitted,false);assert.equal(requests.filter(x=>x.path.includes('/api/web/companion/')).length,0);
  }
});
test('separately enabled vision requires consent and binds the same image to prepare and execute',async()=>{
  const {api,requests}=setup(version,{model:'xai/grok-4.7'});
  const image={dataUrl:'data:image/png;base64,aGVsbG8=',role:'style',source:2,name:'local.png',width:4};
  let asks=0;
  const result=await api.artAgentChat({...payload(),modelId:'xai/grok-4.7',expectedModelId:'xai/grok-4.7',artContext:{},operationBillingV3:true,
    operationVisionBillingV3:true,images:[image],uploads:[{kind:'image',name:'local.png'}],
    imageSessionGuard:()=>true,confirmImageUpload:async({count})=>{asks++;assert.equal(count,1);return true;}});
  assert.equal(result.ok,true);assert.equal(result.data.quota.settled_credits,1);assert.equal(asks,1);
  const sent=requests.filter(row=>row.path.includes('/api/web/companion/'));
  assert.deepEqual(sent.map(row=>row.path.split('/').slice(-2).join('/')),['companion/quote','operation/prepare','operation/execute']);
  const prepare=JSON.parse(sent[1].init.body),execute=JSON.parse(sent[2].init.body);
  assert.deepEqual(prepare.intent.images,[{dataUrl:image.dataUrl,role:'style',source:2}]);assert.deepEqual(execute.intent,prepare.intent);
  assert.equal(sent.some(row=>row.path.endsWith('/chat')),false);
});
test('vision consent or stale session fails before upload and without a legacy fallback',async()=>{
  for(const extra of [{},{imageSessionGuard:()=>false,confirmImageUpload:async()=>true},{imageSessionGuard:()=>true,confirmImageUpload:async()=>false}]){
    const {api,requests}=setup(version,{model:'xai/grok-4.7'});
    const result=await api.artAgentChat({...payload(),modelId:'xai/grok-4.7',expectedModelId:'xai/grok-4.7',artContext:{},operationBillingV3:true,
      operationVisionBillingV3:true,images:[{dataUrl:'data:image/png;base64,aGVsbG8='}],...extra});
    assert.equal(result.ok,false);assert.equal(result.providerSubmitted,false);
    assert.equal(requests.filter(x=>x.path.includes('/api/web/companion/')).length,0);
  }
});
test('session changing during vision confirmation prevents even a quote upload',async()=>{
  const {api,requests}=setup(version,{model:'xai/grok-4.7'});let current=true;
  const result=await api.artAgentChat({...payload(),modelId:'xai/grok-4.7',expectedModelId:'xai/grok-4.7',artContext:{},operationBillingV3:true,
    operationVisionBillingV3:true,images:[{dataUrl:'data:image/png;base64,aGVsbG8='}],imageSessionGuard:()=>current,
    confirmImageUpload:async()=>{current=false;return true;}});
  assert.equal(result.ok,false);assert.equal(result.providerSubmitted,false);assert.equal(result.errorCode,'assistant-selection-changed');
  assert.equal(requests.filter(x=>x.path.includes('/api/web/companion/')).length,0);
});
test('known operation cancellation reports its confirmed charge and does not retry',async()=>{
  const operationResult={ok:false,errorCode:'operation-provider-output-invalid',receipt:{status:'settled',outcome:'cancel',charged:1,uncollected:0}};
  const {api,requests}=setup(version,{model:'xai/grok-4.7',operationResult});
  const result=await api.artAgentChat({...payload(),modelId:'xai/grok-4.7',expectedModelId:'xai/grok-4.7',artContext:{},operationBillingV3:true});
  assert.equal(result.ok,false);assert.equal(result.billingConfirmed,true);assert.equal(result.data.quota.settled_credits,1);
  assert.equal(requests.filter(x=>x.path.endsWith('/operation/execute')).length,1);assert.equal(requests.some(x=>x.path.endsWith('/chat')),false);
});
test('invalid operation receipt remains unknown without legacy fallback',async()=>{
  const {api,requests}=setup(version,{model:'xai/grok-4.7',operationResult:{ok:true,reply:'收到',receipt:{status:'pending'}}});
  const result=await api.artAgentChat({...payload(),modelId:'xai/grok-4.7',expectedModelId:'xai/grok-4.7',artContext:{},operationBillingV3:true});
  assert.equal(result.ok,false);assert.equal(result.errorCode,'operation-status-unknown');
  assert.equal(requests.filter(x=>x.path.endsWith('/operation/execute')).length,1);assert.equal(requests.some(x=>x.path.endsWith('/chat')),false);
});

test('missing or expired version blocks explicit models before any request',async()=>{
  for(const changed of [{pricingVersion:undefined},{pricingExpiresAt:Date.now()-1}]){
    const {api,companion}=setup();const result=await api.artAgentChat({...payload(),...changed});
    assert.equal(result.ok,false);assert.equal(companion().length,0);
  }
});

test('changed quote version fails without chat or automatic retry',async()=>{
  const {api,companion}=setup('sha256:'+'c'.repeat(64));const result=await api.artAgentChat(payload());const requests=companion();
  assert.equal(result.ok,false);assert.equal(result.errorCode,'companion-pricing-changed');assert.equal(requests.length,1);assert.match(requests[0].path,/\/quote$/);
});

