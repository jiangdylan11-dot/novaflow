import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createControlPlane} from '../packages/shared/src/control-plane.mjs';

const secret='synthetic-session-secret',path='/api/web/companion/operation/prepare';
const nonce='e120c802-75e2-412c-b110-f9c6559760ab';
const body=()=>({nonce,model:'xai/grok-4.7',intent:{text:'fixture'}});
function auth(payload={sub:'u1',sid:'s1'}) {
  const data=Buffer.from(JSON.stringify({...payload,exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
  return {authorization:'Bearer nfs_'+data+'.'+createHmac('sha256',secret).update(data).digest('base64url')};
}
function makeStore(state={}) {return {
  getUserById:async id=>id==='u1'?{id,status:state.disabled?'disabled':'active'}:null,
  getUserSession:async id=>({id,user_id:'u1',revoked_at:state.revoked?'2020-01-01T00:00:00Z':null})
};}
const invoke=(plane,headers=auth(),payload=body())=>plane.handle({method:'POST',path,headers,body:payload});

test('v3 route defaults closed after authentication without provider or ledger calls',async()=>{
  const calls=[];
  const companion={quote:async()=>calls.push('v2 quote'),reply:async()=>calls.push('v2 reply')};
  const plane=createControlPlane({store:makeStore(),secrets:{sessionSecret:secret},companion});
  assert.equal((await invoke(plane,{})).status,401);
  const result=await invoke(plane);
  assert.equal(result.status,503);assert.equal(result.body.code,'operation-billing-disabled');
  assert.deepEqual(calls,[]);
});

test('v3 handler requires live verified session and does not accept forged top-level identity or cost',async()=>{
  let called=0;
  const plane=createControlPlane({store:makeStore(),secrets:{sessionSecret:secret},companion:{prepareXiaotaoOperationV3:async()=>{called++;return {};}}});
  assert.equal((await invoke(plane,auth({sub:'u1'}))).status,401);
  for(const forged of [{userId:'u2'},{sessionId:'s2'},{cost:0},{pricingConfig:{}},{operationId:nonce},{isCurrent:true}]){
    assert.equal((await invoke(plane,auth(),{...body(),...forged})).status,400);
  }
  for(const bad of [{...body(),nonce:'not-a-uuid'},{...body(),intent:null},{...body(),intent:[]},{...body(),intent:{text:'a'.repeat(65537)}}]){
    assert.equal((await invoke(plane,auth(),bad)).status,400);
  }
  assert.equal(called,0);
});

test('handler receives verified actor and session freshness closure, not a browser-provided callback',async()=>{
  const state={}, checks=[];let observed;
  const plane=createControlPlane({store:makeStore(state),secrets:{sessionSecret:secret},companion:{prepareXiaotaoOperationV3:async input=>{
    observed=input;
    checks.push(await input.isCurrent({userId:'u1',sessionId:'s1'}));
    checks.push(await input.isCurrent({userId:'u2',sessionId:'s1'}));
    checks.push(await input.isCurrent({userId:'u1',sessionId:'s2'}));
    state.revoked=true;checks.push(await input.isCurrent({userId:'u1',sessionId:'s1'}));
    return {id:'fixture'};
  }}});
  const result=await invoke(plane);
  assert.equal(result.status,200);assert.equal(observed.user.id,'u1');assert.equal(observed.sessionId,'s1');
  assert.deepEqual(observed.payload,body());assert.deepEqual(checks,[true,false,false,false]);
  assert.equal((await invoke(plane)).status,401);
});

test('injected handler failures remain fail closed and legacy chat still uses its old route',async()=>{
  let oldCalls=0;
  const plane=createControlPlane({store:makeStore(),secrets:{sessionSecret:secret},companion:{
    prepareXiaotaoOperationV3:async()=>{throw Error('internal detail');},reply:async()=>{oldCalls++;return {answer:'legacy'};}
  }});
  const failed=await invoke(plane);
  assert.equal(failed.status,503);assert.equal(failed.body.code,'operation-billing-unavailable');
  assert.equal(JSON.stringify(failed.body).includes('internal detail'),false);
  const legacy=await plane.handle({method:'POST',path:'/api/web/companion/chat',headers:auth(),body:{text:'hi'}});
  assert.equal(legacy.status,200);assert.equal(oldCalls,1);assert.equal(legacy.body.answer,'legacy');
});

test('execute is default closed and rejects untrusted billing or identity fields',async()=>{
  const path='/api/web/companion/operation/execute';
  const payload={operationToken:'fixture.signature',intent:{message:'fixture'}};
  const invokeExecute=(plane,requestBody=payload,headers=auth())=>plane.handle({method:'POST',path,headers,body:requestBody});
  const closed=createControlPlane({store:makeStore(),secrets:{sessionSecret:secret},companion:{}});
  assert.equal((await invokeExecute(closed,payload,{})).status,401);
  assert.equal((await invokeExecute(closed)).body.code,'operation-billing-disabled');
  let called=0;
  const plane=createControlPlane({store:makeStore(),secrets:{sessionSecret:secret},companion:{executeXiaotaoOperationV3:async()=>{called++;return {}}}});
  for(const extra of [{model:'xai/grok-4.7'},{phase:'english'},{cost:0},{userId:'u2'},{operationId:nonce}])
    assert.equal((await invokeExecute(plane,{...payload,...extra})).status,400);
  for(const bad of [{...payload,operationToken:'bad'},{...payload,operationToken:'x'.repeat(8193)},{...payload,intent:null},{...payload,intent:{text:'x'.repeat(65537)}}])
    assert.equal((await invokeExecute(plane,bad)).status,400);
  assert.equal(called,0);
});

test('execute receives only verified actor, payload and revocable session closure',async()=>{
  const state={},seen=[];
  const plane=createControlPlane({store:makeStore(state),secrets:{sessionSecret:secret},companion:{executeXiaotaoOperationV3:async input=>{
    seen.push(input.user.id,input.sessionId,input.payload.operationToken);
    seen.push(await input.isCurrent({userId:'u1',sessionId:'s1'}));
    state.revoked=true;
    seen.push(await input.isCurrent({userId:'u1',sessionId:'s1'}));
    return {answer:'fixture'};
  }}});
  const res=await plane.handle({method:'POST',path:'/api/web/companion/operation/execute',headers:auth(),body:{operationToken:'fixture.signature',intent:{message:'fixture'}}});
  assert.equal(res.status,200);assert.equal(res.body.answer,'fixture');
  assert.deepEqual(seen,['u1','s1','fixture.signature',true,false]);
});

test('execute preserves the confirmed failure receipt instead of reporting success',async()=>{
  const receipt={status:'settled',outcome:'cancel',charged:1,uncollected:0};
  const plane=createControlPlane({store:makeStore(),secrets:{sessionSecret:secret},companion:{executeXiaotaoOperationV3:async()=>({ok:false,errorCode:'operation-provider-output-invalid',receipt})}});
  const res=await plane.handle({method:'POST',path:'/api/web/companion/operation/execute',headers:auth(),body:{operationToken:'fixture.signature',intent:{message:'fixture'}}});
  assert.equal(res.status,200);assert.equal(res.body.ok,false);assert.equal(res.body.errorCode,'operation-provider-output-invalid');assert.deepEqual(res.body.receipt,receipt);
});
test('operation endpoints retain text limits but allow normal-sized image data for downstream validation',async()=>{
  const calls=[];
  const plane=createControlPlane({store:makeStore(),secrets:{sessionSecret:secret},companion:{
    prepareXiaotaoOperationV3:async x=>{calls.push(x.payload.intent);return {};},executeXiaotaoOperationV3:async x=>{calls.push(x.payload.intent);return {};}
  }});
  const image='data:image/png;base64,'+'A'.repeat(150000);
  const input={message:'fixture',images:[{dataUrl:image,role:'attachment'}]};
  assert.equal((await invoke(plane,auth(),{...body(),intent:input})).status,200);
  const execute=payload=>plane.handle({method:'POST',path:'/api/web/companion/operation/execute',headers:auth(),body:{operationToken:'fixture.signature',intent:payload}});
  assert.equal((await execute(input)).status,200);assert.equal(calls.length,2);
  for(const invalid of [{...input,message:'x'.repeat(65537)},{...input,images:[{dataUrl:'A'.repeat(28*1024*1024)}]},
    {...input,images:[{dataUrl:image},{dataUrl:image},{dataUrl:image},{dataUrl:image}]}])
    assert.equal((await invoke(plane,auth(),{...body(),intent:invalid})).status,400);
  assert.equal(calls.length,2);
});
test('Foart operation routes require a verified session and a server-injected handler',async()=>{
  const route='/api/web/companion/operation/foart/prepare';
  const input={nonce,model:'xai/grok-4.7',originalIntent:{message:'fixture'},initialContext:{schema:'nf.foart.tool-plan.v1',controls:[]}};
  const request=(plane,headers=auth(),payload=input)=>plane.handle({method:'POST',path:route,headers,body:payload});
  const closed=createControlPlane({store:makeStore(),secrets:{sessionSecret:secret},companion:{}});
  assert.equal((await request(closed,{})).status,401);assert.equal((await request(closed)).body.code,'operation-billing-disabled');
  let received;
  const plane=createControlPlane({store:makeStore(),secrets:{sessionSecret:secret},companion:{foartOperation:{prepare:async value=>{received=value;return {token:'synthetic'};}}}});
  assert.equal((await request(plane,auth(),{...input,userId:'forged'})).status,400);
  assert.equal((await request(plane,auth(),{...input,initialContext:{schema:'x',text:'a'.repeat(250001)}})).status,400);
  const result=await request(plane);assert.equal(result.status,200);assert.deepEqual(received.actor,{userId:'u1',sessionId:'s1'});
  assert.equal(await received.isCurrent({userId:'u1',sessionId:'s1'}),true);assert.equal(await received.isCurrent({userId:'u2',sessionId:'s1'}),false);
});
test('Foart resume accepts only optional previous plan, not caller-supplied identity or cost',async()=>{
  let observed;const plane=createControlPlane({store:makeStore(),secrets:{sessionSecret:secret},companion:{foartOperation:{resume:async value=>{observed=value;return {ok:true};}}}});
  const route='/api/web/companion/operation/foart/resume',snapshot={schema:'nf.foart.tool-plan.v1',controls:[]};
  const payload={originalIntent:{message:'fixture'},initialContext:snapshot,previousContext:snapshot,operationToken:'fixture.signature',continuationToken:'fixture.signature',receipt:{action:'open',phase:'opened',surface:'animation'},context:snapshot};
  const call=body=>plane.handle({method:'POST',path:route,headers:auth(),body});
  assert.equal((await call(payload)).status,200);
  const previousPlan={schema:snapshot.schema,status:'act',reply:'open',operations:[{action:'open',surface:'animation'}]};
  assert.equal((await call({...payload,previousPlan})).status,200);assert.deepEqual(observed.previousPlan,previousPlan);
  assert.equal((await call({...payload,previousPlan:'forged'})).status,400);
  assert.equal((await call({...payload,previousPlan,cost:0})).status,400);
});
