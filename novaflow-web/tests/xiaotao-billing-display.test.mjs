import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {webcrypto} from 'node:crypto';import vm from 'node:vm';
const source=await readFile(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
function fixture(){const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem(){}}};root.window=root;
 const needle='  root.NovaFlowXiaotaoArtAgent = {';assert.ok(source.includes(needle));vm.createContext(root);vm.runInContext(source.replace(needle,'  root.__billingForTest={billingNoticeForView,billingNoticeText,billingByTurn,appendBillingNotice};\n'+needle),root);
 const api=()=>({captureFoartBillingOwner:()=>({owner:'owner-a',current:()=>true})}),bridge={clearPrepared(){}};
 const c=root.NovaFlowXiaotaoArtAgent.createController({api,bridge});return {root,c,choose:root.__billingForTest.billingNoticeForView,text:root.__billingForTest.billingNoticeText,byTurn:root.__billingForTest.billingByTurn,append:root.__billingForTest.appendBillingNotice};}
const paid={id:'paid-last',modelId:'xai/grok-4.7',owner:'owner-a',confirmed:0.013434,unknown:false};
const pending={id:'unresolved',modelId:'xai/grok-4.7',owner:'owner-a',confirmed:null,unknown:true};
test('local 9B hides the prior settled online charge without deleting its ledger',()=>{
 const f=fixture();f.c.state.billingNotices=[paid];assert.equal(f.choose('api',f.c.visibleBillingNotices(),[]).confirmed,0.013434);
 assert.equal(f.text(f.choose('api',f.c.visibleBillingNotices(),[])),'本次扣费 0.013434 积分');
 assert.equal(f.choose('local',f.c.visibleBillingNotices(),[]),null);assert.equal(f.c.state.billingNotices.length,1);
});
test('another account’s known and unresolved notices are not shown',()=>{
 const f=fixture();f.c.state.billingNotices=[{...pending,owner:'owner-b'},{...paid,owner:'owner-b'}];
 assert.equal(f.choose('local',f.c.visibleBillingNotices(),[]),null);assert.equal(f.choose('api',f.c.visibleBillingNotices(),[]),null);
});
test('only a confirmed charge shows, and only on an online model',()=>{
 const f=fixture();
 assert.equal(f.choose('local',[pending,paid]),null);assert.equal(f.choose('api',[paid,pending]).id,'paid-last');assert.equal(f.choose('api',[pending]),null);
});
test('each turn keeps its own settled charge, summed, and an update keeps its first turn',()=>{
 const f=fixture();let rows=f.append([],{...paid,id:'turn-1-a'},1);rows=f.append(rows,{...paid,id:'turn-2-a',confirmed:0.5},2);rows=f.append(rows,{...paid,id:'turn-2-b',confirmed:0.25},2);
 rows=f.append(rows,{...paid,id:'turn-1-a',confirmed:0.02},3);rows=f.append(rows,{...pending,id:'turn-2-c'},2);
 assert.equal(rows.find(r=>r.id==='turn-1-a').turn,1);const totals=f.byTurn(rows);
 assert.equal(totals.get(1),0.02);assert.equal(totals.get(2),0.75);assert.equal(totals.size,2);
});
test('a new user message no longer wipes earlier charges',()=>{
 const f=fixture();f.c.state.billingNotices=[{...paid,turn:1}];f.c.state.messages.push({role:'user',content:'x',turn:1});
 assert.equal(f.byTurn(f.c.visibleBillingNotices()).get(1),0.013434);
});
