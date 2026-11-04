import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {createHmac} from 'node:crypto';
import {createDomSandbox} from '../../worker/src/comfy/dom-shim.mjs';
import {createControlPlane} from '../../packages/shared/src/control-plane.mjs';
import {createCompanionPricingContext} from '../../packages/shared/src/companion-pricing-context.mjs';

async function setup({changeAfterQuote=false,providerRevision='1'}={}) {
  const provider={apiKey:'fixture-secret',baseUrl:'https://provider.invalid/v1',model:'xai/grok-4.7',configRevision:providerRevision};
  let reserve=0,upstream=0,hold=null,quoted=null;
  const rpc=async(name,args)=>{
    if(name==='reserve_xiaotao_credits_v2'){reserve++;hold=args.p_estimated_credits;return {status:'reserved',units:1,estimated_credits:hold,message_cap_credits:args.p_expected_cap,policy_version:args.p_policy_version};}
    if(name==='settle_xiaotao_credits_v2')return {status:'settled',settled_credits:args.p_settled_credits};
    assert.fail('unexpected RPC '+name);
  };
  async function service(perUsd) {return createCompanionPricingContext({provider,dbSnapshot:{protocol:'xiaotao-pricing-v2',config:{credits_per_usd:perUsd,xiaotao_online:{message_cap_credits:80}},message_cap_credits:80},
    envOnline:{enabled_models:['xai/grok-4.7']},rpc,legacyCharge:async()=>assert.fail('legacy not expected'),
    fetchImpl:async(_url,init)=>{upstream++;return Response.json({model:JSON.parse(init.body).model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'收到'}}],usage:{prompt_tokens:1000,completion_tokens:50,total_tokens:1050}});}});}
  let companion=await service(211), changed=await service(212);
  const store={getUserById:async()=>({id:'u',status:'active'}),getUserSession:async()=>({id:'s',user_id:'u',revoked_at:null})};
  const encoded=Buffer.from(JSON.stringify({sub:'u',sid:'s',exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
  const token='nfs_'+encoded+'.'+createHmac('sha256','fixture-secret').update(encoded).digest('base64url');
  const storage=new Map([['novaflow.client.auth.session.v1',JSON.stringify({session:{token}})]]);
  const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,AbortController,Event,
    crypto:{randomUUID:()=> 'cloud-conversation-1234'},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    NOVAFLOW_WEB_CONFIG:{localAssistant:false,authUrl:'https://auth.test',controlUrl:'https://control.test'},
    fetch:async(url,init)=>{
      const path=new URL(String(url)).pathname;
      if(!path.startsWith('/api/web/companion/'))return Response.json({ok:true});
      const plane=createControlPlane({store,secrets:{sessionSecret:'fixture-secret'},companion});
      const body=init.body?JSON.parse(init.body):undefined;
      const response=await plane.handle({method:init.method,path,headers:init.headers,body});
      if(path.endsWith('/quote') && response.status===200){quoted=response.body.quote;if(changeAfterQuote)companion=changed;}
      return Response.json(response.body,{status:response.status});
    }});
  runInContext(readFileSync(new URL('../../renderer/novaflow-web-runtime.js',import.meta.url),'utf8'),createContext(sandbox));
  return {api:sandbox.electronAPI,stats:()=>({reserve,upstream,hold,quoted})};
}

test('browser policy, quote and server reserve share one snapshot without a real provider',async()=>{
  const e=await setup(), policy=(await e.api.companionPricing()).policy;
  assert.equal(policy.models.find(model=>model.id==='xai/grok-4.7').available,true);
  const result=await e.api.artAgentChat({provider:'api',mode:'chat',requestId:'browser-quote-1234',modelId:'xai/grok-4.7',message:'测试',history:[],artContext:{surface:'other'},
    pricingVersion:policy.version,pricingExpiresAt:policy.expiresAt,expectedModelId:'xai/grok-4.7'});
  assert.equal(result.ok,true,result.error);assert.equal(e.stats().upstream,1);assert.equal(e.stats().reserve,1);assert.equal(e.stats().hold,e.stats().quoted.estimatedCredits);
});

test('policy change between quote and charge fails before reserve or upstream',async()=>{
  const e=await setup({changeAfterQuote:true}),policy=(await e.api.companionPricing()).policy;
  const result=await e.api.artAgentChat({provider:'api',mode:'chat',requestId:'browser-quote-5678',modelId:'xai/grok-4.7',message:'测试',history:[],artContext:{surface:'other'},
    pricingVersion:policy.version,pricingExpiresAt:policy.expiresAt,expectedModelId:'xai/grok-4.7'});
  assert.equal(result.ok,false);assert.equal(result.errorCode,'companion-pricing-changed');assert.equal(e.stats().reserve,0);assert.equal(e.stats().upstream,0);
});

test('missing provider configuration revision fails closed before reserve or upstream',async()=>{
  const e=await setup({providerRevision:null}),policy=(await e.api.companionPricing()).policy;
  assert.equal(policy.models.find(model=>model.id==='xai/grok-4.7').available,false);
  const result=await e.api.artAgentChat({provider:'api',mode:'chat',requestId:'browser-quote-9012',modelId:'xai/grok-4.7',message:'测试',history:[],artContext:{surface:'other'},
    pricingVersion:policy.version,pricingExpiresAt:policy.expiresAt,expectedModelId:'xai/grok-4.7'});
  assert.equal(result.ok,false);assert.equal(e.stats().reserve,0);assert.equal(e.stats().upstream,0);
});
