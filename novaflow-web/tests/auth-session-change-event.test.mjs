import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../renderer/novaflow-client-auth.js', import.meta.url), 'utf8');
const part=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i);return source.slice(i,j);};
const helpers=part('  function authSessionIdentity(', '  function loadStoredSession(');
const save=part('  function saveStoredSession(', '  function sessionExpiryMs(');
const expiry=part('  function sessionExpiryMs(', '  function clearSessionRefreshTimer(');
const clear=part('  function clearStoredSession(', '  function setMessage(');

function fixture() {
  let now=1_800_000_000_000, id=0, failWrite=false;
  const items=new Map(), events=[], timers=new Map();
  class SafeEvent {constructor(type){this.type=type;}}
  const storage={getItem:k=>items.get(k)??null,setItem(k,v){if(failWrite)throw Error('storage unavailable');items.set(k,v);},removeItem(k){if(failWrite)throw Error('storage unavailable');items.delete(k);}};
  const window={Event:SafeEvent,dispatchEvent:event=>{events.push({type:event.type,keys:Object.keys(event)});},
    setTimeout(fn,delay){const key=++id;timers.set(key,{fn,at:now+delay});return key;},clearTimeout:key=>timers.delete(key)};
  const state={session:null,user:null,credits:null,providerQuotas:{}};
  const box={window,localStorage:storage,state,Date:{now:()=>now,parse:Date.parse},events};
  createContext(box);
  runInContext(`const STORAGE_KEY='novaflow.client.auth.session.v1';let sessionExpiryTimer=0,sessionIdentityRevision=0,expiredNoticeRevision=-1,sessionRevision=0;function clearSessionRefreshTimer(){};${helpers}${save}${expiry}${clear}
   globalThis.save=saveStoredSession;globalThis.clear=clearStoredSession;globalThis.scheduleExpiry=scheduleSessionExpiryNotice;globalThis.persisted=hasPersistedSessionIdentity;`,box);
  return {box,state,events,items,setFailWrite:v=>{failWrite=v;},advance(ms){now+=ms;for(const [key,t] of [...timers])if(t.at<=now){timers.delete(key);t.fn();}}};
}

test('same-tab A to B to A is synchronously signalled without token or account payload',()=>{
  const f=fixture();for(const [index,token] of ['synthetic-A','synthetic-B','synthetic-A'].entries()){f.state.session={token,expiresAt:1_800_000_100_000};f.box.save();assert.equal(f.events.length,index+1);}
  assert.equal(f.events.length,3);for(const e of f.events){assert.equal(e.type,'novaflow-client-auth-changed');assert.deepEqual(e.keys,['type']);assert.ok(!JSON.stringify(e).includes('synthetic'));}
});

test('credits-only persistence is quiet; changed expiry and refresh identity signal',()=>{
  const f=fixture();f.state.session={token:'synthetic',refreshToken:'one',expiresAt:1_800_000_100_000};f.box.save();
  f.state.credits={balance:123};f.box.save();assert.equal(f.events.length,1);
  f.state.session={...f.state.session,expiresAt:1_800_000_200_000};f.box.save();assert.equal(f.events.length,2);
  f.state.session={...f.state.session,refreshToken:'two'};f.box.save();assert.equal(f.events.length,3);
});

test('clear and authentication rejection invalidate once; failed persistence fails closed',()=>{
  const f=fixture();f.state.session={token:'synthetic'};f.box.save();f.box.clear();assert.equal(f.events.length,2);assert.equal(f.state.session,null);f.box.clear();assert.equal(f.events.length,2);
  f.state.session={token:'other'};f.setFailWrite(true);f.box.save();assert.equal(f.events.length,3);
  assert.match(source,/status === 401 \|\| status === 403\)\s*\{\s*clearStoredSession\(\)/);
});
test('persisted identity check fails after a failed or silently lost account update',()=>{
 const f=fixture();f.state.session={token:'A'};f.box.save();assert.equal(f.box.persisted(),true);
 f.state.session={token:'B'};f.setFailWrite(true);f.box.save();assert.equal(f.box.persisted(),false);
 f.setFailWrite(false);f.box.save();assert.equal(f.box.persisted(),true);
 f.state.session={token:'C'};assert.equal(f.box.persisted(),false);
});

test('natural expiry emits one payload-free event and stale timers cannot signal a refreshed identity',()=>{
  const f=fixture();f.state.session={token:'A',expiresAt:1_800_000_001_000};f.box.save();f.box.scheduleExpiry();f.advance(999);assert.equal(f.events.length,1);
  f.state.session={token:'B',expiresAt:1_800_000_005_000};f.box.save();f.box.scheduleExpiry();f.advance(1);assert.equal(f.events.length,2);f.advance(4000);assert.equal(f.events.length,3);
  assert.deepEqual(f.events[2],{type:'novaflow-client-auth-changed',keys:['type']});f.box.scheduleExpiry();f.advance(0);assert.equal(f.events.length,3);
});
