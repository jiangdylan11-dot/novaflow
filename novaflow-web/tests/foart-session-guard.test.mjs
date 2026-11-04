import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const start=source.indexOf('  let session = null, foartSessionEpoch = 0;'),end=source.indexOf('  function authHeaders(',start);
assert.ok(start>0&&end>start);
function fixture(){
 const store=new Map(),listeners=new Map();let now=2_000_000_000_000,unreadable=false,persisted=true;
 const root={localStorage:{getItem:key=>{if(unreadable)throw Error('unavailable');return store.get(key)||null;},setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  atob:text=>Buffer.from(text,'base64').toString('binary'),addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)},
  removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn),NovaFlowClientAuth:{hasPersistedSessionIdentity:()=>persisted}};
 const DateStub=class extends Date{static now(){return now;}};
 const scope={root,Date:DateStub,JSON,Object,String,Number,Math,SESSION_KEY:'primary',CLIENT_AUTH_KEY:'client'};
 createContext(scope);runInContext(source.slice(start,end)+'\nglobalThis.capture=captureFoartSessionGuard;globalThis.owner=captureFoartBillingOwner;globalThis.save=saveSession;globalThis.observe=fn=>foartSessionObservers.add(fn);',scope);
 const token=(name,seconds=60)=>'nfs_'+Buffer.from(JSON.stringify({sub:name,exp:Math.floor(now/1000)+seconds})).toString('base64url')+'.signature';
 const set=(name,extra={})=>store.set('client',JSON.stringify({session:{token:token(name),...extra}}));
 return {scope,set,emit:(name,key='client')=>{for(const fn of listeners.get(name)||[])fn({type:name,key});},advance:ms=>{now+=ms;},clock:()=>now,deny:()=>{unreadable=true;},unpersist:()=>{persisted=false;}};
}
test('same-tab A to B to A and cross-tab changes invalidate captured guard without exposing identity',()=>{
 const f=fixture();f.set('A');let guard=f.scope.capture();assert.equal(guard(),true);assert.deepEqual(Object.keys(guard),[]);
 f.set('B');f.emit('novaflow-client-auth-changed');f.set('A');f.emit('novaflow-client-auth-changed');assert.equal(guard(),false);
 guard=f.scope.capture();f.emit('storage','unrelated');assert.equal(guard(),true);f.emit('storage','client');assert.equal(guard(),false);
});
test('both stored expiry and signed-token expiry are checked at capture and after time passes',()=>{
 const f=fixture();f.set('A',{expiresAt:f.clock()-1});assert.equal(f.scope.capture(),null);
 f.set('A',{expiresAt:f.clock()+10_000});const guard=f.scope.capture();assert.equal(guard(),true);f.advance(10_000);assert.equal(guard(),false);assert.equal(f.scope.capture(),null);
 const g=fixture();g.set('A');const tokenGuard=g.scope.capture();g.advance(60_000);assert.equal(tokenGuard(),false);assert.equal(g.scope.capture(),null);
});
test('same token with expiry or refresh changes, invalid expiry and unreadable storage fail closed',()=>{
 const f=fixture();f.set('A',{refreshToken:'one',expiresAt:f.clock()+50_000});let guard=f.scope.capture();
 f.set('A',{refreshToken:'two',expiresAt:f.clock()+50_000});assert.equal(guard(),false);
 guard=f.scope.capture();f.set('A',{refreshToken:'two',expiresAt:f.clock()+40_000});assert.equal(guard(),false);
 f.set('A',{expiresAt:'not-a-date'});assert.equal(f.scope.capture(),null);
 f.set('A');guard=f.scope.capture();f.deny();assert.equal(guard(),false);assert.equal(f.scope.capture(),null);
 const g=fixture();g.set('A');const persisted=g.scope.capture();g.unpersist();assert.equal(persisted(),false);assert.equal(g.scope.capture(),null);
});
test('direct same-tab session replacement advances the guard revision',()=>{
 const f=fixture();f.set('A');const guard=f.scope.capture();f.scope.observe(()=>{throw Error('observer failed')});assert.doesNotThrow(()=>f.scope.save(null));assert.equal(guard(),false);
});
test('billing owner is a non-secret account id bound to the existing persisted-session guard',()=>{
 const f=fixture();
 assert.equal(f.scope.owner(),null);
 f.set('account-A');const binding=f.scope.owner();assert.equal(binding.owner,'account-A');assert.equal(binding.current(),true);
 assert.equal(JSON.stringify(binding).includes('nfs_'),false);
 f.set('account-B');f.emit('novaflow-client-auth-changed');assert.equal(binding.current(),false);assert.equal(f.scope.owner().owner,'account-B');
 f.deny();assert.equal(f.scope.owner(),null);
});
