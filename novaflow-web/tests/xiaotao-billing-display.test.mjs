import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {webcrypto} from 'node:crypto';import vm from 'node:vm';
const source=await readFile(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
function fixture(){const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem(){}}};root.window=root;
 const needle='  root.NovaFlowXiaotaoArtAgent = {';assert.ok(source.includes(needle));vm.createContext(root);vm.runInContext(source.replace(needle,'  root.__billingForTest={billingNoticeForView,billingNoticeText};\n'+needle),root);
 const api=()=>({captureFoartBillingOwner:()=>({owner:'owner-a',current:()=>true})}),bridge={clearPrepared(){}};
 const c=root.NovaFlowXiaotaoArtAgent.createController({api,bridge,storage:{getItem:()=>null,setItem(){}}});return {root,c,choose:root.__billingForTest.billingNoticeForView,text:root.__billingForTest.billingNoticeText};}
const paid={id:'paid-last',modelId:'xai/grok-4.7',owner:'owner-a',confirmed:0.013434,unknown:false};
const pending={id:'unresolved',modelId:'xai/grok-4.7',owner:'owner-a',confirmed:null,unknown:true};
test('local 9B hides the prior settled online charge without deleting its ledger',()=>{
 const f=fixture();f.c.state.billingNotices=[paid];assert.equal(f.choose('api',f.c.visibleBillingNotices(),[]).confirmed,0.013434);
 assert.equal(f.text(f.choose('api',f.c.visibleBillingNotices(),[])),'本次扣费 0.013434 积分');
 assert.equal(f.choose('local',f.c.visibleBillingNotices(),[]),null);assert.equal(f.c.state.billingNotices.length,1);
 assert.equal(f.choose('local',[],[paid]),null);assert.equal(f.choose('api',[],[paid]).confirmed,0.013434);
});
test('the local model never shows online billing, unresolved rows stay on online models',()=>{
 const f=fixture();f.c.state.billingNotices=[pending,paid];
 assert.equal(f.choose('local',f.c.visibleBillingNotices(),[]),null);assert.equal(f.c.state.billingNotices.length,2);
 assert.equal(f.choose('local',[],[pending]),null);assert.equal(f.choose('api',[pending,paid],[]).id,'unresolved');
});
test('another account’s known and unresolved notices are not shown',()=>{
 const f=fixture();f.c.state.billingNotices=[{...pending,owner:'owner-b'},{...paid,owner:'owner-b'}];
 assert.equal(f.choose('local',f.c.visibleBillingNotices(),[]),null);assert.equal(f.choose('api',f.c.visibleBillingNotices(),[]),null);
});
