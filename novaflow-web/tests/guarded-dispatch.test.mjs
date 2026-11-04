import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineAiCharge} from '../packages/shared/src/online-ai-charge.mjs';

const base={userId:'fixture-user',feature:'xiaotao-text',usageKey:'fixture-usage',estimatedCredits:3,
 metadata:{model:'fixture/model',art_stage:'structure',art_request_hash:'fixture-hash',art_session_id:'fixture-session',pricing_version:'fixture-policy'}};
const unknown=e=>e?.code==='xiaotao_dispatch_status_unknown';
function fixture({marker,settlement}={}){
 const calls=[];let provider=0;
 const options={strictSettlement:true,guardedDispatch:true,
  reserve:async p=>{calls.push(['reserve',p]);return {status:'reserved',amount:1};},
  markDispatched:async p=>{calls.push(['mark',p]);return marker?marker(p):{status:'dispatched',first_dispatch:true};},
  settle:async p=>{calls.push(['settle',p]);return settlement?settlement(p):{status:'settled',settled_credits:1};},
  release:async p=>{calls.push(['release',p]);return {status:'released'};}};
 return {calls,options,charge:createOnlineAiCharge(options),provider:()=>provider,invoke:()=>{provider++;}};
}
test('guard requires explicit opt-in port and strict settlement before reserving',()=>{
 const {options}=fixture();assert.throws(()=>createOnlineAiCharge({...options,markDispatched:undefined}));
 assert.throws(()=>createOnlineAiCharge({...options,strictSettlement:false}));
});
test('successful guarded stage marks once, then invokes and settles with bound snapshot',async()=>{
 const f=fixture();const metadata=structuredClone(base.metadata);
 const answer=await f.charge({...base,metadata,run:async ({amount,markProviderDispatched})=>{
  metadata.model='changed-by-caller';await markProviderDispatched();f.invoke();return {amount,settledCredits:1,rhCostUsd:.001};}});
 assert.equal(answer.quota.status,'settled');assert.equal(f.provider(),1);
 assert.deepEqual(f.calls.map(c=>c[0]),['reserve','mark','settle']);
 assert.equal(f.calls[1][1].metadata.model,'fixture/model');assert.equal(Object.isFrozen(f.calls[1][1].metadata),true);
 assert.equal(f.calls[1][1].estimatedCredits,3);assert.equal(f.calls[1][1].usageKey,base.usageKey);
});
test('failure before marker releases hold and preserves original error',async()=>{
 const f=fixture();await assert.rejects(f.charge({...base,run:async()=>{throw Object.assign(Error('preflight'),{code:'fixture-preflight'});}}),e=>e.code==='fixture-preflight');
 assert.deepEqual(f.calls.map(c=>c[0]),['reserve','release']);assert.equal(f.provider(),0);
});
test('unconfirmed, thrown, duplicate and malformed markers preserve hold and never invoke provider',async()=>{
 for(const marker of [async()=>{throw Error('timeout');},async()=>({status:'dispatched',first_dispatch:false}),async()=>({status:'reserved',first_dispatch:true}),async()=>null]){
  const f=fixture({marker});await assert.rejects(f.charge({...base,run:async ({markProviderDispatched})=>{await markProviderDispatched();f.invoke();return {amount:1};}}),unknown);
  assert.deepEqual(f.calls.map(c=>c[0]),['reserve','mark']);assert.equal(f.provider(),0);
 }
});
test('duplicate local marker is rejected and taints the transaction',async()=>{
 const f=fixture();await assert.rejects(f.charge({...base,run:async ({markProviderDispatched})=>{
  await markProviderDispatched();await assert.rejects(markProviderDispatched());return {amount:1};}}),unknown);
 assert.deepEqual(f.calls.map(c=>c[0]),['reserve','mark']);assert.equal(f.provider(),0);
});
test('result without an awaited marker cannot settle; unattempted marker is released',async()=>{
 const f=fixture();await assert.rejects(f.charge({...base,run:async()=>({amount:1})}));
 assert.deepEqual(f.calls.map(c=>c[0]),['reserve','release']);
});
test('unawaited marker and late confirmation remain unknown and never release',async()=>{
 let finish;const f=fixture({marker:()=>new Promise(resolve=>{finish=resolve;})});let pending;
 await assert.rejects(f.charge({...base,run:async ({markProviderDispatched})=>{pending=markProviderDispatched().catch(()=>{});return {amount:1};}}),unknown);
 assert.deepEqual(f.calls.map(c=>c[0]),['reserve','mark']);finish({status:'dispatched',first_dispatch:true});await pending;
 assert.equal(f.provider(),0);
});
test('rejection, zero amount, missing result or throw after dispatch never auto-release',async()=>{
 for(const outcome of [{success:false},{amount:0},null,'throw']){
  const f=fixture();await assert.rejects(f.charge({...base,run:async ({markProviderDispatched})=>{
   await markProviderDispatched();f.invoke();if(outcome==='throw')throw Error('provider outcome unknown');return outcome;}}),unknown);
  assert.deepEqual(f.calls.map(c=>c[0]),['reserve','mark']);assert.equal(f.provider(),1);
 }
});
test('settlement failure after dispatch is unknown and never releases',async()=>{
 const f=fixture({settlement:async()=>{throw Error('db disconnected');}});
 await assert.rejects(f.charge({...base,run:async ({markProviderDispatched})=>{await markProviderDispatched();return {amount:1,settledCredits:1,rhCostUsd:.001};}}),e=>e?.code==='xiaotao_settlement_status_unknown');
 assert.deepEqual(f.calls.map(c=>c[0]),['reserve','mark','settle']);
});
test('ordinary disabled path retains original run contract and failure release',async()=>{
 const f=fixture();const charge=createOnlineAiCharge({...f.options,guardedDispatch:false});
 await assert.rejects(charge({...base,run:async args=>{assert.deepEqual(Object.keys(args),['amount']);throw Error('legacy failure');}}),/legacy failure/);
 assert.deepEqual(f.calls.map(c=>c[0]),['reserve','release']);
});
test('guarded requests may not bypass reservation as local or free',async()=>{
 const f=fixture();await assert.rejects(f.charge({...base,feature:'local',estimatedCredits:undefined,run:async()=>({})}));assert.equal(f.calls.length,0);
});


test('missing or inconsistent settled usage after dispatch stays unknown',async()=>{
 for(const result of [{amount:1},{amount:1,settledCredits:1,rhCostUsd:null},{amount:1,settledCredits:0,rhCostUsd:.001},{amount:1,settledCredits:1,rhCostUsd:NaN}]){
  const f=fixture();await assert.rejects(f.charge({...base,run:async ({markProviderDispatched})=>{await markProviderDispatched();return result;}}),unknown);
  assert.deepEqual(f.calls.map(c=>c[0]),['reserve','mark']);
 }
});
