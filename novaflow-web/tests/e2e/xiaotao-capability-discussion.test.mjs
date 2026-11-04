import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {normalizeCreditConfig} from '../../packages/shared/src/feature-credits.mjs';
import {FOART_TOOL_SCHEMA,validateFoartPlan} from '../../packages/shared/src/foart-tool-plan.mjs';

const version='sha256:'+'a'.repeat(64);
function setup({ui=false,drawing=false,vision=false}={}) {
  const config=normalizeCreditConfig({credits_per_usd:211,xiaotao_online:{markup:1.5}});
  Object.assign(config.xiaotao_online,{minimum_positive_credits:1,billing_scope:'operation',operation_text_chat_v3:true,operation_vision_chat_v3:vision});
  const policy={version,expiresAt:Date.now()+60000,config,defaultModel:'deepseek/deepseek-v4.1-flash',models:[{id:'deepseek/deepseek-v4.1-flash',available:true},{id:'xai/grok-4.7',available:true},{id:'openai/gpt-6.1-sol-saver',available:true}]};
  const storage={getItem:()=>null,setItem(){}},calls={captures:0,images:0,requests:[],toolCaptures:0,executed:0};
  const root={console,crypto:webcrypto,AbortController,TextEncoder,setTimeout,clearTimeout,setInterval,clearInterval,localStorage:storage};root.window=root;
  const vm=createContext(root);
  for(const file of ['feature-credit-prices.js','xiaotao-upload.js','xiaotao-art-agent.js'])runInContext(readFileSync(new URL('../../renderer/'+file,import.meta.url),'utf8'),vm);
  root.NovaFlowUiDesignDrawing={isActive:()=>ui};
  root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA,validateFoartPlan,foartAnimationExportAllowed:()=>true,foartUnsupportedMediaAnalysis:()=>false};
  root.NovaFlowFoartTools={setUploads(){},settlePending:async()=>null,capture(){calls.toolCaptures++;return {schema:FOART_TOOL_SCHEMA,controls:[]};},images:async()=>{calls.images++;return [];},execute:async()=>{calls.executed++;}};
  const bridge={clearPrepared(){},hasResult:()=>false,async captureChat(){calls.captures++;return {artContext:{surface:drawing?'drawing':'other',prompt:'private canvas'},images:[]};},capture(){throw Error('unexpected drawing capture');}};
  const api=()=>({promptAssistantGetStatus:async()=>({ok:true,result:{features:{qwen35CpuTrial:true}}}),captureFoartSessionGuard:()=>()=>true,captureFoartBillingOwner:()=>({owner:'fixture',current:()=>true}),companionPricing:async()=>({ok:true,policy}),artAgentChat:async payload=>{calls.requests.push(payload);return payload.mode==='foart'?{ok:false,providerSubmitted:false,error:'当前操作级计费尚不支持此次工具、媒体或作品上下文，本次未提交。'}:{ok:true,data:{reply:'可以说明当前能力。',history:[],quota:{status:'settled',settled_credits:1}}};}});
  const controller=root.NovaFlowXiaotaoArtAgent.createController({bridge,storage,api});
  return {root,controller,calls,policy};
}

function mountPanel(e, pricing) {
  const nodes=[];
  class Node {
    constructor(tag,text=''){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.dataset={};this.attributes=new Map();this.hidden=false;this.className='';this.ownText=text;this.classList={add(){},remove(){}};nodes.push(this);}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
    replaceChildren(...children){this.children=[];this.ownText='';this.append(...children);}
    set textContent(value){this.children=[];this.ownText=String(value);} get textContent(){return this.ownText+this.children.map(child=>child.textContent).join('');}
    setAttribute(key,value){this.attributes.set(key,String(value));} getAttribute(key){return this.attributes.get(key)??null;}
    removeAttribute(key){this.attributes.delete(key);} addEventListener(){} focus(){} closest(){return null;}
    getBoundingClientRect(){return {left:10,top:10,right:80,bottom:80,width:70,height:70};} getClientRects(){return [this.getBoundingClientRect()];}
  }
  const doc={readyState:'complete',hidden:false,createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text),getElementById:id=>nodes.find(n=>n.id===id)||null,querySelectorAll:()=>[],addEventListener(){}};
  doc.body=new Node('body');Object.assign(e.root,{document:doc,innerWidth:900,innerHeight:700,addEventListener(){},setTimeout(){return 0;},clearTimeout(){},setInterval(){return 0;},clearInterval(){},electronAPI:{companionPricing:pricing,promptAssistantGetStatus:async()=>({ok:true,result:{features:{qwen35CpuTrial:true}}})}});
  e.root.NovaFlowXiaotaoArtAgent.mount();
  return {controller:e.root.NovaFlowXiaotaoArtAgent.panel.controller,status:()=>nodes.find(n=>n.className==='nf-xiaotao-status')};
}

test('capability questions in active UI use pure chat without capturing project',async()=>{
  const e=setup({ui:true});e.controller.setModel('deepseek/deepseek-v4.1-flash');await e.controller.refreshPricingPolicy();
  e.controller.state.activeTask={surface:'image',mode:'old',executor:'foart'};
  e.controller.state.history=[{role:'user',content:'旧作品信息'}];
  assert.equal(await e.controller.send('你可以控制软件了吗'),true,e.controller.state.error);
  assert.equal(e.calls.requests.length,1);assert.equal(e.calls.requests[0].mode,'chat');
  assert.equal(e.calls.requests[0].modelId,'deepseek/deepseek-v4.1-flash');assert.equal(e.calls.requests[0].operationBillingV3,true);
  assert.deepEqual(JSON.parse(JSON.stringify(e.calls.requests[0].artContext)),{});
  assert.deepEqual(JSON.parse(JSON.stringify(e.calls.requests[0].history)),[]);
  assert.deepEqual(JSON.parse(JSON.stringify(e.calls.requests[0].images)),[]);
  assert.deepEqual(JSON.parse(JSON.stringify(e.calls.requests[0].uploads)),[]);
  assert.equal(e.calls.requests[0].conversationId,undefined);
  assert.equal(e.calls.captures,0);assert.equal(e.calls.toolCaptures,0);assert.equal(e.calls.images,0);assert.equal(e.calls.executed,0);
});

test('local capability question does not silently switch models or execute tools',async()=>{
  const e=setup({ui:true});await e.controller.calibrateLocalStatus();
  assert.equal(await e.controller.send('你可以控制软件了吗'),true);
  assert.equal(e.controller.state.modelId,'qwen3.5-9b-heretic');assert.equal(e.controller.state.provider,'local');
  assert.equal(e.calls.requests.length,0);assert.equal(e.calls.toolCaptures,0);assert.equal(e.calls.executed,0);
});

test('an explicitly attached image remains on the vision route',async()=>{
  const e=setup({vision:true});e.controller.setModel('deepseek/deepseek-v4.1-flash');await e.controller.refreshPricingPolicy();
  e.controller.state.staged=[{id:'fixture',kind:'image',name:'test.png',status:'ready',previewUrl:'data:image/png;base64,aGVsbG8='}];
  assert.equal(await e.controller.send('请描述这张图'),true,e.controller.state.error);
  assert.equal(e.calls.requests.length,1);assert.equal(e.calls.requests[0].modelId,'deepseek/deepseek-v4.1-flash');
  assert.equal(e.calls.requests[0].mode,'chat');assert.equal(e.calls.requests[0].images.length,1);
});

test('capability questions in drawing do not collect current canvas',async()=>{
  const e=setup({drawing:true});e.controller.setModel('deepseek/deepseek-v4.1-flash');await e.controller.refreshPricingPolicy();
  assert.equal(await e.controller.send('你现在能控制这个软件吗？'),true,e.controller.state.error);
  assert.equal(e.calls.requests[0].mode,'chat');assert.equal(e.calls.captures,0);assert.equal(e.calls.images,0);
});

test('preview estimates use text only for capability questions but retain explicit images',async()=>{
  const e=setup({drawing:true,vision:true});e.controller.setModel('deepseek/deepseek-v4.1-flash');await e.controller.refreshPricingPolicy();
  const pure=e.controller.onlineEstimateInput('你可以控制软件了吗');
  assert.equal(e.calls.captures,0);assert.equal(e.calls.toolCaptures,0);assert.equal(pure.contextText,'');
  assert.deepEqual(JSON.parse(JSON.stringify(pure.files)),[]);assert.equal(pure.history,'');
  e.controller.onlineEstimateInput('你可以控制软件了吗',{includeResult:true});assert.equal(e.calls.captures,1);
  e.controller.state.staged=[{id:'fixture',kind:'image',name:'test.png',status:'ready',previewUrl:'data:image/png;base64,aGVsbG8='}];
  const withImage=e.controller.onlineEstimateInput('你可以控制软件了吗');assert.equal(e.calls.captures,2);
  assert.equal(withImage.files.filter(item=>item.kind==='image').length,1);
});

test('several general capability questions do not invoke tools or read the canvas',async()=>{
  for(const message of ['你可以调用工具吗？','小桃现在能做什么？','你现在能操作哪些功能？']) {
    const e=setup({ui:true,drawing:true});e.controller.setModel('deepseek/deepseek-v4.1-flash');await e.controller.refreshPricingPolicy();
    assert.equal(await e.controller.send(message),true,message);assert.equal(e.calls.requests[0].mode,'chat');
    assert.equal(e.calls.requests[0].modelId,'deepseek/deepseek-v4.1-flash');assert.equal(e.calls.captures,0);assert.equal(e.calls.toolCaptures,0);
  }
});

test('late pricing refresh uses the current model rather than previously selected GPT',async()=>{
  const e=setup();let resolve;const gate=new Promise(r=>{resolve=r;});
  const panel=mountPanel(e,()=>gate);const c=panel.controller;
  c.setModel('openai/gpt-6.1-sol-saver');c.setModel('deepseek/deepseek-v4.1-flash');
  resolve({ok:true,policy:e.policy});await c.refreshPricingPolicy();
  assert.equal(c.state.modelId,'deepseek/deepseek-v4.1-flash');assert.equal(c.modelAvailable(c.state.modelId),true);
  assert.doesNotMatch(panel.status().textContent,/尚未开通验证/);
});
