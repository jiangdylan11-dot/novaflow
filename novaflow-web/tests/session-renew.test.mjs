import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';

// A login token lasts 24 h. A page in use renews it past half its life on the
// same login seat instead of dropping the user back to the login screen.
const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const start=source.indexOf('  let session = null, foartSessionEpoch = 0;'),end=source.indexOf('  function authHeaders(',start);
assert.ok(start>0&&end>start);
const DAY=24*3600;
function fixture({reply}={}){
  const store=new Map(),events=[],calls=[];let now=2_000_000_000_000;
  const root={localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    atob:t=>Buffer.from(t,'base64').toString('binary'),addEventListener(){},Event:class{constructor(type){this.type=type;}},
    dispatchEvent:e=>events.push(e.type)};
  const DateStub=class extends Date{static now(){return now;}};
  const scope={root,Date:DateStub,JSON,Object,String,Number,Math,Promise,Error,SESSION_KEY:'primary',CLIENT_AUTH_KEY:'client',
    auth:async(method,path)=>{calls.push(method+' '+path);if(reply instanceof Error)throw reply;return reply;}};
  createContext(scope);
  runInContext(source.slice(start,end)+'\nglobalThis.renew=renewSessionIfDue;globalThis.current=currentSession;globalThis.stored=storedLoginSession;',scope);
  const token=(name,ageSeconds,sid=true)=>{const iat=Math.floor(now/1000)-ageSeconds;
    return 'nfs_'+Buffer.from(JSON.stringify({sub:'u',...(sid?{sid:'s1'}:{}),iat,exp:iat+DAY,name})).toString('base64url')+'.sig';};
  const login=(tok)=>{store.set('client',JSON.stringify({session:{token:tok,expiresAt:'x'},user:{id:'u'}}));store.set('primary',JSON.stringify({token:tok,user:{id:'u'}}));};
  return {scope,store,events,calls,token,login,advance:ms=>{now+=ms;}};
}

test('a fresh token is left alone',async()=>{
  const f=fixture({reply:{ok:true,session:{token:'nfs_new.sig',expiresAt:'later'}}});
  f.login(f.token('A',3600));await f.scope.renew();
  assert.deepEqual(f.calls,[]);
});

test('past half its life the token is renewed and both stores take it',async()=>{
  const f=fixture({reply:{ok:true,session:{token:'nfs_new.sig',expiresAt:'later',ttlSeconds:DAY}}});
  f.login(f.token('A',13*3600));await f.scope.renew();
  assert.deepEqual(f.calls,['POST /api/auth/renew']);
  assert.equal(f.scope.current().token,'nfs_new.sig');
  assert.equal(JSON.parse(f.store.get('client')).session.token,'nfs_new.sig');
  assert.equal(JSON.parse(f.store.get('client')).session.expiresAt,'later');
  assert.equal(JSON.parse(f.store.get('primary')).token,'nfs_new.sig');
  assert.deepEqual(f.events,['foart-session-renewed']);
  assert.equal(f.scope.stored().token,'nfs_new.sig');
});

test('a failed renewal keeps the session and waits a minute before trying again',async()=>{
  const f=fixture({reply:new Error('offline')});
  const tok=f.token('A',13*3600);f.login(tok);await f.scope.renew();
  assert.equal(f.scope.current().token,tok);
  await f.scope.renew();assert.equal(f.calls.length,1);
  f.advance(61000);await f.scope.renew();assert.equal(f.calls.length,2);
});

test('expired and seatless tokens are not renewed',async()=>{
  const f=fixture({reply:{ok:true,session:{token:'nfs_new.sig'}}});
  f.login(f.token('A',DAY+10));await f.scope.renew();
  f.login(f.token('A',13*3600,false));await f.scope.renew();
  assert.deepEqual(f.calls,[]);
});
