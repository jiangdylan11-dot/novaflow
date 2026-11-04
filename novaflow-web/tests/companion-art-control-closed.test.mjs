import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createControlPlane} from '../packages/shared/src/control-plane.mjs';
import {createCompanionPricingContext} from '../packages/shared/src/companion-pricing-context.mjs';

const secret='synthetic-session-secret',user={id:'u1',status:'active'},paths=['/api/web/companion/art/quote','/api/web/companion/art/execute'];
function auth(payload={sub:'u1',sid:'s1'}) {
  const data=Buffer.from(JSON.stringify({...payload,exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
  return {authorization:'Bearer nfs_'+data+'.'+createHmac('sha256',secret).update(data).digest('base64url')};
}
function exactAuth(payload) {
  const data=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return {authorization:'Bearer nfs_'+data+'.'+createHmac('sha256',secret).update(data).digest('base64url')};
}
function store(revoked=false){return {getUserById:async id=>id==='u1'?user:null,getUserSession:async id=>({id,user_id:'u1',revoked_at:revoked?'2020-01-01T00:00:00Z':null})};}

test('production-like context keeps both authenticated art paths closed without ledger or provider calls',async()=>{
  const calls=[];
  const companion=await createCompanionPricingContext({provider:{apiKey:'synthetic-key',baseUrl:'https://llm.runninghub.ai/v1',model:'xai/grok-4.7',configRevision:'1'},dbSnapshot:{protocol:'xiaotao-pricing-v2',config:{xiaotao_online:{message_cap_credits:80}},message_cap_credits:80},rpc:async name=>{calls.push(name);throw Error('unexpected RPC');},fetchImpl:async()=>{calls.push('provider');throw Error('unexpected provider');}});
  const plane=createControlPlane({store:store(),secrets:{sessionSecret:secret},companion});
  for(const path of paths){const r=await plane.handle({method:'POST',path,headers:auth(),body:{sid:'forged'}});assert.equal(r.status,503);assert.equal(r.body.code,'art-business-unavailable');}
  assert.deepEqual(calls,[]);
});

test('art cancellation requires authentication, a signed-stage token shape, and a server handler',async()=>{
  const path='/api/web/companion/art/cancel',calls=[];
  const plane=createControlPlane({store:store(),secrets:{sessionSecret:secret},companion:{artCancel:async input=>{calls.push(input);return {ok:true,settlement:{status:'settled'}};}}});
  assert.equal((await plane.handle({method:'POST',path,headers:{},body:{stageToken:'fixture.signature',epoch:0}})).status,401);
  for(const body of [{stageToken:'fixture.signature',epoch:0,amount:0},{stageToken:'fixture.signature',epoch:-1},{stageToken:'x'.repeat(180001),epoch:0}])
    assert.equal((await plane.handle({method:'POST',path,headers:auth(),body})).status,400);
  const result=await plane.handle({method:'POST',path,headers:auth(),body:{stageToken:'fixture.signature',epoch:0}});
  assert.equal(result.status,200);assert.equal(calls.length,1);assert.equal(calls[0].sessionId,'s1');
  assert.equal(await calls[0].isCurrent({userId:'u1',sessionId:'s1'}),true);
  const closed=createControlPlane({store:store(),secrets:{sessionSecret:secret},companion:{}});
  assert.equal((await closed.handle({method:'POST',path,headers:auth(),body:{stageToken:'fixture.signature',epoch:0}})).status,503);
});

test('art routes require a live session, reject missing or revoked sid, and use only the verified sid',async()=>{
  const received=[],companion={artQuote:async input=>{received.push(input);return {requestId:'fixture'};},artExecute:async input=>{received.push(input);return {ok:true};}};
  const plane=createControlPlane({store:store(),secrets:{sessionSecret:secret},companion});
  for(const headers of [{},auth({sub:'u1'})]){const r=await plane.handle({method:'POST',path:paths[0],headers,body:{sid:'forged'}});assert.equal(r.status,401);}
  const revoked=createControlPlane({store:store(true),secrets:{sessionSecret:secret},companion});
  assert.equal((await revoked.handle({method:'POST',path:paths[1],headers:auth(),body:{}})).status,401);
  assert.equal(received.length,0);
  const ac=new AbortController();const r=await plane.handle({method:'POST',path:paths[0],headers:auth(),body:{sid:'forged'},signal:ac.signal});
  assert.equal(r.status,200);assert.equal(received[0].user.id,'u1');assert.equal(received[0].sessionId,'s1');assert.equal(received[0].signal,ac.signal);
});

test('server-owned freshness closure rechecks the original identity and rejects revocation, account changes and store failure',async()=>{
  let revoked=false,disabled=false,wrongOwner=false,storeFails=false;
  const dynamicStore={getUserById:async id=>{if(storeFails)throw Error('unavailable');return id==='u1'?{...user,status:disabled?'disabled':'active'}:null;},
    getUserSession:async id=>({id,user_id:wrongOwner?'u2':'u1',revoked_at:revoked?'2020-01-01T00:00:00Z':null})};
  const seen=[];
  const companion={artQuote:async request=>{
    const check=request.isCurrent;
    seen.push(await check({userId:'u1',sessionId:'s1'}));
    seen.push(await check({userId:'u2',sessionId:'s1'}));
    seen.push(await check({userId:'u1',sessionId:'other'}));
    revoked=true;seen.push(await check({userId:'u1',sessionId:'s1'}));revoked=false;
    disabled=true;seen.push(await check({userId:'u1',sessionId:'s1'}));disabled=false;
    wrongOwner=true;seen.push(await check({userId:'u1',sessionId:'s1'}));wrongOwner=false;
    storeFails=true;seen.push(await check({userId:'u1',sessionId:'s1'}));
    return {requestId:'fixture'};
  }};
  const plane=createControlPlane({store:dynamicStore,secrets:{sessionSecret:secret},companion});
  const r=await plane.handle({method:'POST',path:paths[0],headers:auth(),body:{sid:'forged',isCurrent:true}});
  assert.equal(r.status,200);assert.deepEqual(seen,[true,false,false,false,false,false,false]);
});

test('art rejects a signed token with invalid expiry and detects expiry during execution',async()=>{
  let check;
  const plane=createControlPlane({store:store(),secrets:{sessionSecret:secret},companion:{artQuote:async request=>{check=request.isCurrent;return {};}}});
  for(const exp of ['not-a-number',Infinity,1.5]){
    const result=await plane.handle({method:'POST',path:paths[0],headers:exactAuth({sub:'u1',sid:'s1',exp}),body:{}});
    assert.equal(result.status,401);
  }
  const originalNow=Date.now;
  try {
    const start=originalNow(),exp=Math.floor(start/1000)+10;
    Date.now=()=>start;
    assert.equal((await plane.handle({method:'POST',path:paths[0],headers:exactAuth({sub:'u1',sid:'s1',exp}),body:{}})).status,200);
    assert.equal(await check({userId:'u1',sessionId:'s1'}),true);
    Date.now=()=>start+11000;
    assert.equal(await check({userId:'u1',sessionId:'s1'}),false);
  } finally {Date.now=originalNow;}
});
