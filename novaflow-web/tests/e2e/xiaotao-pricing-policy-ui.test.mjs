import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {normalizeCreditConfig,estimateXiaotaoOnlineCredits,settleXiaotaoOnlineCredits} from '../../packages/shared/src/feature-credits.mjs';
import {FOART_TOOL_SCHEMA,validateFoartPlan} from '../../packages/shared/src/foart-tool-plan.mjs';

const version='sha256:'+'a'.repeat(64);
function policy(overrides={}) {
  const config=normalizeCreditConfig({credits_per_usd:211,xiaotao_online:{markup:1.5}});
  Object.assign(config.xiaotao_online,{minimum_positive_credits:1,billing_scope:'operation'});
  return {version,expiresAt:Date.now()+60000,config,defaultModel:'xai/grok-4.7',models:[
    {id:'xai/grok-4.7',available:true},{id:'bytedance/doubao-seed-2.1-lite',available:true},
    {id:'openai/gpt-6.1-sol-saver',available:true},{id:'legacy-online',available:true},
    {id:'deepseek/deepseek-v4.1-flash',available:false}],...overrides};
}
function setup(getPolicy=()=>policy(),respond=()=>({ok:true,data:{reply:'收到',history:[]}}),extraApi={}) {
  const map=new Map(),storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
  const sandbox={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:storage};sandbox.window=sandbox;
  const vm=createContext(sandbox);
  for(const file of ['feature-credit-prices.js','xiaotao-art-agent.js'])runInContext(readFileSync(new URL('../../renderer/'+file,import.meta.url),'utf8'),vm);
  const requests=[],statuses=[];let pricingCalls=0;
  const bridge={clearPrepared(){},async captureChat(){return {artContext:{surface:'other'},images:[]};},capture(){throw Error('unexpected drawing capture');}};
  const api=()=>({promptAssistantGetStatus:async()=>({ok:true,result:{features:{qwen35CpuTrial:true}}}),captureFoartSessionGuard:()=>()=>true,captureFoartBillingOwner:()=>({owner:'fixture',current:()=>true}),companionPricing:async()=>{pricingCalls++;return {ok:true,policy:getPolicy()};},artAgentChat:async payload=>{requests.push(payload);return respond(payload);},...extraApi});
  const controller=sandbox.NovaFlowXiaotaoArtAgent.createController({bridge,storage,api,onChange:state=>statuses.push(state.status)});
  return {sandbox,controller,requests,statuses,get pricingCalls(){return pricingCalls;}};
}

test('decimal operation policy accepts and displays a subcredit receipt without a one-credit minimum',async()=>{
  const current=policy();
  Object.assign(current.config.xiaotao_online,{billing_scope:'operation',minimum_positive_credits:0,credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',operation_text_chat_v3:true});
  const deepseek=current.models.find(row=>row.id==='deepseek/deepseek-v4.1-flash');deepseek.available=true;
  const e=setup(()=>current,()=>({ok:true,data:{reply:'收到',history:[],quota:{status:'settled',billing_mode:'token',settled_credits:0.000001,quote_estimated_credits:0.003456}}}));
  e.sandbox.NovaFlowXiaotaoUpload={inferTask:()=>({surface:'chat',discussion:true,revision:false,named:[]}),planRoutes:()=>({place:[],reject:[]})};
  e.controller.setModel('deepseek/deepseek-v4.1-flash');await e.controller.refreshPricingPolicy();
  assert.equal(e.controller.modelAvailable('deepseek/deepseek-v4.1-flash'),true);
  assert.equal(e.controller.onlineOperationDecimalConfirmed(),true);assert.equal(e.controller.onlineOperationMinimumConfirmed(),false);
  assert.match(e.controller.onlinePriceDetails(),/小数点后6位/);assert.doesNotMatch(e.controller.onlinePriceDetails(),/最低\s*1\s*积分/);
  assert.equal(await e.controller.send('你好'),true);assert.equal(e.requests[0].modelId,'deepseek/deepseek-v4.1-flash');
  assert.match(e.controller.state.messages.at(-1).receipt,/实扣 0\.000001 分/);
  assert.match(e.controller.state.messages.at(-1).receipt,/提交时估算预留 0\.003456/);
  for(const mutate of [p=>delete p.credit_rounding,p=>{p.minimum_positive_credits=1;},p=>{p.credit_precision=4;},p=>{delete p.credit_amount_policy;delete p.credit_precision;delete p.credit_rounding;}]){
    const p=policy();Object.assign(p.config.xiaotao_online,{billing_scope:'operation',minimum_positive_credits:0,credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',operation_text_chat_v3:true});mutate(p.config.xiaotao_online);
    p.models.find(row=>row.id==='deepseek/deepseek-v4.1-flash').available=true;
    const closed=setup(()=>p);closed.controller.setModel('deepseek/deepseek-v4.1-flash');await closed.controller.refreshPricingPolicy();
    assert.equal(closed.controller.modelAvailable('deepseek/deepseek-v4.1-flash'),false);assert.equal(await closed.controller.send('你好'),false);assert.equal(closed.requests.length,0);
  }
});

test('separate vision capability forwards explicit image discussion with an account-bound consent callback',async()=>{
  const current=policy();Object.assign(current.config.xiaotao_online,{operation_text_chat_v3:true,operation_vision_chat_v3:true});
  const e=setup(()=>current,()=>({ok:true,data:{reply:'A shape.',history:[],quota:{status:'settled',settled_credits:1}}}));
  e.sandbox.NovaFlowXiaotaoUpload={inferTask:()=>({surface:'chat',discussion:true,revision:false,named:[]}),planRoutes:()=>({place:[],reject:[]})};
  e.sandbox.confirm=()=>true;
  e.controller.setModel('xai/grok-4.7');await e.controller.refreshPricingPolicy();
  e.controller.state.staged=[{id:'fixture',kind:'image',name:'test.png',status:'ready',previewUrl:'data:image/png;base64,aGVsbG8='}];
  assert.equal(await e.controller.send('请描述图中形状'),true);assert.equal(e.requests.length,1);
  const request=e.requests[0];assert.equal(request.operationBillingV3,true);assert.equal(request.operationVisionBillingV3,true);
  assert.equal(request.images.length,1);assert.equal(request.images[0].role,'attachment');
  assert.equal(typeof request.imageSessionGuard,'function');assert.equal(typeof request.confirmImageUpload,'function');
  assert.equal(await request.confirmImageUpload({count:1}),true);
});
test('operation Foart open uses one pending operation through actual tool receipt and final charge',async()=>{
  const current=policy();Object.assign(current.config.xiaotao_online,{operation_text_chat_v3:true,operation_foart_open_v3:true});
  const calls=[],session={opaque:true};
  const e=setup(()=>current,()=>{throw Error('legacy route must not run');},{
    foartOperationStart:async payload=>{calls.push(['start',payload]);return {ok:true,data:{toolPlan:{schema:FOART_TOOL_SCHEMA,status:'act',reply:'打开动画',operations:[{action:'open',surface:'animation'}]},foartOperationSession:session}};},
    foartOperationResume:async payload=>{calls.push(['resume',payload]);assert.equal(payload.session,session);return {ok:true,data:{toolPlan:{schema:FOART_TOOL_SCHEMA,status:'done',reply:'动画已打开',operations:[]},quota:{status:'settled',settled_credits:1}}};},
    foartOperationCancel:async()=>{calls.push(['cancel']);return {ok:false};}
  });
  e.sandbox.NovaFlowXiaotaoUpload={inferTask:()=>({surface:'animation',discussion:false,revision:false,named:[]})};
  e.sandbox.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA,validateFoartPlan,foartAnimationExportAllowed:()=>true,foartUnsupportedMediaAnalysis:()=>false};
  e.sandbox.NovaFlowFoartTools={setUploads(){},capture:()=>({schema:FOART_TOOL_SCHEMA,controls:[]}),settlePending:async()=>null,
    images:async()=>{throw Error('no image should be read');},open:async()=>{throw Error('must not pre-open before planning');},
    execute:async op=>{calls.push(['execute',op]);return {action:'open',phase:'opened',surface:op.surface,message:'动画模块已打开'};}};
  e.controller.setModel('xai/grok-4.7');await e.controller.refreshPricingPolicy();
  assert.equal(await e.controller.send('打开动画模块'),true);
  assert.deepEqual(calls.map(x=>x[0]),['start','execute','resume']);assert.equal(e.requests.length,0);
  assert.equal(calls[2][1].receipt.phase,'opened');assert.match(e.controller.state.messages.at(-1).receipt,/实扣 1/);
});
test('failed native open cancels the pending operation and displays its known charge',async()=>{
  const current=policy();Object.assign(current.config.xiaotao_online,{operation_text_chat_v3:true,operation_foart_open_v3:true});
  let cancels=0,resumes=0;
  const e=setup(()=>current,()=>{throw Error('legacy route must not run');},{
    foartOperationStart:async()=>({ok:true,data:{toolPlan:{schema:FOART_TOOL_SCHEMA,status:'act',reply:'打开动画',operations:[{action:'open',surface:'animation'}]},foartOperationSession:{opaque:true}}}),
    foartOperationResume:async()=>{resumes++;throw Error('not expected');},
    foartOperationCancel:async()=>{cancels++;return {ok:false,billingConfirmed:true,providerSubmitted:true,data:{quota:{status:'settled',settled_credits:1}}};}
  });
  e.sandbox.NovaFlowXiaotaoUpload={inferTask:()=>({surface:'animation',discussion:false,revision:false,named:[]})};
  e.sandbox.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA,validateFoartPlan,foartAnimationExportAllowed:()=>true,foartUnsupportedMediaAnalysis:()=>false};
  e.sandbox.NovaFlowFoartTools={setUploads(){},capture:()=>({schema:FOART_TOOL_SCHEMA,controls:[]}),settlePending:async()=>null,
    execute:async()=>{throw Error('native open failed');}};
  e.controller.setModel('xai/grok-4.7');await e.controller.refreshPricingPolicy();
  assert.equal(await e.controller.send('打开动画模块'),false);assert.equal(cancels,1);assert.equal(resumes,0);
  assert.ok(e.controller.state.billingNotices.some(row=>row.confirmed===1&&row.unknown===false));
});
test('confirmed cancellation preserves the actual receipt instead of claiming no submission',async()=>{
  const current=policy();current.config.xiaotao_online.operation_text_chat_v3=true;
  const e=setup(()=>current,()=>({ok:false,billingConfirmed:true,providerSubmitted:true,error:'回复未完成',data:{quota:{status:'settled',settled_credits:1}}}));
  e.sandbox.NovaFlowXiaotaoUpload={inferTask:()=>({surface:'chat',discussion:false,revision:false,named:[]})};
  e.controller.setModel('xai/grok-4.7');await e.controller.refreshPricingPolicy();
  assert.equal(await e.controller.send('你好'),false);
  assert.match(e.controller.state.status,/已按实际用量结算/);
  assert.ok(e.controller.state.billingNotices.some(row=>row.confirmed===1 && row.unknown===false));
});
test('missing rounding or minimum policy never presents a rate or submits a priced request',async()=>{
  for(const key of ['round','min_credits_per_image']){
    const current=policy();delete current.config.token_billing[key];const e=setup(()=>current);e.controller.setModel('xai/grok-4.7');await e.controller.refreshPricingPolicy();
    assert.equal(e.controller.modelRateSummary('xai/grok-4.7'),'');assert.equal(await e.controller.send('你好'),false);assert.equal(e.requests.length,0);
  }
});

test('missing, expired, disabled and unknown policies never send an explicit online request',async()=>{
  for(const get of [()=>null,()=>policy({expiresAt:Date.now()-1}),()=>policy({models:[{id:'xai/grok-4.7',available:false}]})]){
    const e=setup(get);e.controller.setModel('xai/grok-4.7');await e.controller.refreshPricingPolicy();
    assert.equal(await e.controller.send('测试'),false);assert.equal(e.requests.length,0);
  }
  const e=setup();e.controller.setModel('deepseek/deepseek-v4.1-flash');await e.controller.refreshPricingPolicy();
  assert.match(e.controller.state.status,/尚未开通.*不扣积分/);
  assert.equal(await e.controller.send('测试'),false);assert.equal(e.requests.length,0);
});

test('disabled paid models explain their unavailable state without inventing a price or sending',async()=>{
  const e=setup(()=>policy({models:[{id:'qwen/qwen3.8-flash-next',available:false},{id:'bytedance/doubao-seed-2.1-lite',available:false},{id:'openai/gpt-6.1-sol-saver',available:false}]}));
  for(const id of ['qwen/qwen3.8-flash-next','bytedance/doubao-seed-2.1-lite']){
    e.controller.setModel(id);await e.controller.refreshPricingPolicy();
    assert.match(e.controller.state.status,/线路或积分价格尚未开通验证/);
    assert.equal(e.controller.onlinePriceDetails(),'');assert.equal(await e.controller.send('你好'),false);
  }
  for(const id of ['openai/gpt-6.1-sol-saver']){
    e.controller.setModel(id);await e.controller.refreshPricingPolicy();
    assert.match(e.controller.state.status,/线路或积分价格尚未开通验证/);
    assert.equal(e.controller.modelRateSummary(id),'1M 输入约 221.55 / 输出约 1107.75 积分');
    assert.equal(e.controller.onlinePriceDetails(),'');assert.equal(await e.controller.send('你好'),false);
  }
  assert.equal(e.requests.length,0);
});

test('legacy selection cannot bypass an unavailable versioned policy',async()=>{
  const e=setup(()=>null);assert.equal(e.controller.setModel('legacy-online'),false);e.controller.setModel('xai/grok-4.7');await e.controller.refreshPricingPolicy();
  assert.equal(await e.controller.send('旧线路'),false);assert.equal(e.requests.length,0);
});

test('legacy option stays hidden for all price states and never migrates an active legacy session',async()=>{
  let current=policy();const e=setup(()=>current),c=e.controller;
  assert.equal(c.hideLegacyOnlineOption(),true);
  c.setModel('xai/grok-4.7');await c.refreshPricingPolicy();assert.equal(c.hideLegacyOnlineOption(),true);
  assert.match(c.onlinePriceDetails(),/缓存命中约 134\.5125 积分/);
  assert.equal(c.setModel('legacy-online'),false);assert.equal(c.hideLegacyOnlineOption(),true);assert.equal(e.requests.length,0);
  c.setModel('qwen3.5-9b-heretic');assert.equal(c.hideLegacyOnlineOption(),true);
  current=policy({models:[{id:'xai/grok-4.7',available:false}]});await c.refreshPricingPolicy();assert.equal(c.hideLegacyOnlineOption(),true);
  current=policy({defaultModel:'bytedance/doubao-seed-2.1-lite'});await c.refreshPricingPolicy();assert.equal(c.hideLegacyOnlineOption(),true);
  current=policy({expiresAt:Date.now()-1});await c.refreshPricingPolicy();assert.equal(c.hideLegacyOnlineOption(),true);
});

test('browser model rates use the normalized companion configuration and never use generic fallback',()=>{
  const e=setup(), p=policy(), prices=e.sandbox.NovaFlowFeatureCreditPrices;
  for(const model of ['qwen/qwen3.8-flash-next','bytedance/doubao-seed-2.1-lite','deepseek/deepseek-v4.1-flash','openai/gpt-6.1-sol-saver']){
    const input={text:'中文测试',history:'',system:'system',files:[],outputTokens:2048,model,config:p.config};
    assert.equal(prices.estimateXiaotaoOnline(input).credits,estimateXiaotaoOnlineCredits(input).credits);
    assert.equal(prices.estimateXiaotaoOnline({...input,config:{credits_per_usd:211,xiaotao_online:{}}}),null);
  }
});
