import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import vm from 'node:vm';
import {createControlPlane} from '../supabase/functions/_art-shared/control-plane.mjs';
import {createCompanionPricingContext,parseCompanionOnlineOverlay} from '../supabase/functions/_art-shared/companion-pricing-context.mjs';
import {mergeCapabilityOverrides,OPT_IN_KEYS} from '../supabase/functions/novaflow-companion/capability-overrides.mjs';
import {createRecoveryOnly} from '../supabase/functions/novaflow-companion/recovery-only.mjs';
import {createCompanionOperationV3Assembly} from '../supabase/functions/_art-shared/companion-operation-v3-assembly.mjs';
import {createXiaotaoV3ArtAdapter} from '../supabase/functions/_art-shared/xiaotao-operation-v3-art-adapter.mjs';
import {createXiaotaoOperationV3Status} from '../supabase/functions/_art-shared/xiaotao-operation-v3-status.mjs';
import {createOnlineAiCharge} from '../supabase/functions/_art-shared/online-ai-charge.mjs';
import {createFeatureCreditPorts} from '../supabase/functions/_art-shared/feature-credits.mjs';

const secret='synthetic-session-secret-0123456789';
function auth(){const p=Buffer.from(JSON.stringify({sub:'u1',sid:'s1',exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
  return 'Bearer nfs_'+p+'.'+createHmac('sha256',secret).update(p).digest('base64url');}
async function entry({artOnly=false,v3WithoutRecovery=false}={}){
  let handler;const calls=[];
  const client={rpc:async name=>{calls.push(name);return {data:null,error:null};},from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:table==='users'?{id:'u1',status:'active'}:{id:'s1',user_id:'u1',revoked_at:null},error:null})})})})};
  const Deno={env:{get:key=>key==='NOVAFLOW_SESSION_SECRET'?secret:''},serve:fn=>{handler=fn;}};
  const file=await readFile(new URL('../supabase/functions/novaflow-companion/index.ts',import.meta.url),'utf8');
  // Execute the actual entry with Deno/network dependencies replaced by
  // isolated fakes. Its only TypeScript annotations are erased here.
  const withArt=artOnly?file.replace('const operationV3ArtEnabled=false;','const operationV3ArtEnabled=true;'):file;
  const source=(v3WithoutRecovery?withArt.replace('const operationV3Enabled=false;','const operationV3Enabled=true;'):withArt)
    .replace(/^import .*;\s*$/gm,'').replace(/:(?:string|number|any)\b/g,'');
  vm.runInNewContext(source,{Deno,createClient:()=>client,createControlPlane,createCompanionPricingContext,parseCompanionOnlineOverlay,mergeCapabilityOverrides,OPT_IN_KEYS,createRecoveryOnly,createCompanionOperationV3Assembly,createXiaotaoV3ArtAdapter,createXiaotaoOperationV3Status,createOnlineAiCharge,createFeatureCreditPorts,
    RELEASE_VERSION:'test',createRunningHubServerConfig:()=>({refresh:async()=>({model:'xai/grok-4.7',configured:false}),status:()=>({})}),
    artBusinessDependencies:()=>({enabled:false,accountingReady:false}),Buffer,Response,Request,URL,TextEncoder,console});
  assert.equal(typeof handler,'function');return {handler,calls};
}
const payloads={
  '/api/web/companion/operation/prepare':{nonce:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',model:'xai/grok-4.7',intent:{message:'fixture'}},
  '/api/web/companion/operation/execute':{operationToken:'fixture.signature',intent:{message:'fixture'}},
  '/api/web/companion/operation/status':{operationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
  '/api/web/companion/art/cancel':{stageToken:'fixture.signature',epoch:0}
};
test('companion entry forwards exactly the new POST paths through auth and default-closed handlers',async()=>{
  const {handler,calls}=await entry();
  for(const [path,payload] of Object.entries(payloads)){
    const url='http://localhost/functions/v1/novaflow-companion'+path;
    const request=headers=>new Request(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(payload)});
    const before=calls.length;assert.equal((await handler(request({}))).status,401);assert.equal(calls.length,before);
    const closed=await handler(request({authorization:auth()}));const body=await closed.json();
    assert.deepEqual([closed.status,body.code],path.endsWith('/art/cancel')?[400,'operation-billing-disabled']:path.endsWith('/status')?[503,'operation-billing-disabled']:[503,'operation-billing-unavailable'],path);
    assert.equal((await handler(new Request(url,{method:'GET',headers:{authorization:auth()}}))).status,404);
  }
  assert.ok(calls.every(name=>name==='get_xiaotao_pricing_cap_v2'));
});
test('entry still rejects unknown routes without touching the provider or ledger',async()=>{
  const {handler,calls}=await entry();
  const response=await handler(new Request('http://localhost/functions/v1/novaflow-companion/api/web/companion/operation/unrelated',{method:'POST',headers:{authorization:auth()},body:'{}'}));
  assert.equal(response.status,404);assert.deepEqual(calls,[]);
});
test('art-only v3 configuration fails closed before requesting pricing or provider',async()=>{
  const {handler,calls}=await entry({artOnly:true});
  const response=await handler(new Request('http://localhost/functions/v1/novaflow-companion/api/web/companion/chat',
    {method:'POST',headers:{authorization:auth(),'content-type':'application/json'},body:'{}'}));
  assert.equal(response.status,503);assert.deepEqual(calls,[]);
});
test('v3 without recovery fails closed before requesting pricing or provider',async()=>{
  const {handler,calls}=await entry({v3WithoutRecovery:true});
  const response=await handler(new Request('http://localhost/functions/v1/novaflow-companion/api/web/companion/chat',
    {method:'POST',headers:{authorization:auth(),'content-type':'application/json'},body:'{}'}));
  assert.equal(response.status,503);assert.deepEqual(calls,[]);
});
