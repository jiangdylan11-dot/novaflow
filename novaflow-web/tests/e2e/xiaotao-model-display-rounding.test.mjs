import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {normalizeCreditConfig} from '../../packages/shared/src/feature-credits.mjs';

function fixture({decimal=true,settled=0.000001}={}) {
  const config=normalizeCreditConfig({credits_per_usd:211,xiaotao_online:{markup:1.5}});
  Object.assign(config.xiaotao_online,decimal
    ? {billing_scope:'operation',minimum_positive_credits:0,credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',operation_text_chat_v3:true}
    : {billing_scope:'operation',minimum_positive_credits:1});
  const policy={version:'sha256:'+'a'.repeat(64),expiresAt:Date.now()+60000,config,defaultModel:'xai/grok-4.7',models:[
    {id:'deepseek/deepseek-v4.1-flash',available:true},
    {id:'xai/grok-4.7',available:true},
    {id:'openai/gpt-6.1-sol-saver',available:true}
  ]};
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const sandbox={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:storage};sandbox.window=sandbox;
  const vm=createContext(sandbox);
  for(const file of ['feature-credit-prices.js','xiaotao-art-agent.js'])runInContext(readFileSync(new URL('../../renderer/'+file,import.meta.url),'utf8'),vm);
  sandbox.NovaFlowXiaotaoUpload={inferTask:()=>({surface:'chat',discussion:true,revision:false,named:[]}),planRoutes:()=>({place:[],reject:[]})};
  const requests=[];
  const bridge={clearPrepared(){},async captureChat(){return {artContext:{surface:'other'},images:[]};},capture(){throw Error('unexpected drawing capture');}};
  const api=()=>({captureFoartSessionGuard:()=>()=>true,captureFoartBillingOwner:()=>({owner:'fixture',current:()=>true}),companionPricing:async()=>({ok:true,policy}),artAgentChat:async payload=>{requests.push(payload);return {ok:true,data:{reply:'ok',history:[],quota:{status:'settled',billing_mode:'token',settled_credits:settled,quote_estimated_credits:0.501338}}};}});
  return {config,policy,requests,controller:sandbox.NovaFlowXiaotaoArtAgent.createController({bridge,storage,api})};
}

test('model picker rounds policy rates under decimal and legacy operation policies',async()=>{
  for(const decimal of [true,false]) {
    const {controller,config}=fixture({decimal});await controller.refreshPricingPolicy();
    for(const [id,input,output] of [['deepseek/deepseek-v4.1-flash',56,224],['xai/grok-4.7',538,1614],['openai/gpt-6.1-sol-saver',222,1108]]) {
      const label=controller.modelRateSummary(id,true);
      assert.match(label,new RegExp('^1M .*\\u7ea6 '+input+' / .*\\u7ea6 '+output+' '));
      assert.doesNotMatch(label,/\d+\.\d+/);
    }
    // The label comes from the current policy, not hard-coded example prices.
    config.credits_per_usd=100;config.xiaotao_online.markup=2;
    await controller.refreshPricingPolicy();
    assert.match(controller.modelRateSummary('deepseek/deepseek-v4.1-flash',true),/35 \/ .* 141 /);
  }
});

test('detailed rate and successful receipts retain decimal precision',async()=>{
  for(const settled of [0.000001,0.066829]) {
    const {controller,requests}=fixture({settled});controller.setModel('deepseek/deepseek-v4.1-flash');await controller.refreshPricingPolicy();
    assert.match(controller.modelRateSummary('deepseek/deepseek-v4.1-flash'),/56\.0205 \/ .* 223\.5123 /);
    assert.equal(await controller.send('hello'),true);
    assert.equal(requests.length,1);assert.equal(requests[0].modelId,'deepseek/deepseek-v4.1-flash');
    const receipt=controller.state.messages.at(-1).receipt;
    assert.ok(receipt.includes(String(settled)),receipt);
    assert.ok(receipt.includes('0.501338'),receipt);
  }
});
