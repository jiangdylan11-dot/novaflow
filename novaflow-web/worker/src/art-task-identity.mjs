import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
// Browser login and compute-node ownership are different identities. Verify
// the browser session once, then scope concurrent task calls independently.
// Only token digests and verified IDs live in memory; tokens never enter logs.
export function createArtTaskIdentity({identifyUser,fallbackOwner,now=Date.now,ttlMs=15*60*1000}) {
  const context=new AsyncLocalStorage(),cache=new Map(),pending=new Map();
  const fail=()=>{throw Object.assign(Error('当前登录身份无法核验，本次未读写账号任务记录'),{code:'art-identity-invalid',status:403});};
  async function identify(body={}) {
    if(!body.accountToken){const fallback=fallbackOwner();if(body.accountId&&body.accountId!==fallback)fail();return fallback;}
    if(typeof body.accountToken!=='string'||body.accountToken.length>16384||!body.accountToken.startsWith('nfs_'))fail();
    const key=createHash('sha256').update(body.accountToken).digest('hex');let value=cache.get(key);
    if(!value||value.until<=now()){
      let operation=pending.get(key);
      if(!operation){operation=(async()=>{const user=await identifyUser(body.accountToken);if(!user?.id||user.status&&user.status!=='active')fail();
        let expires=now()+ttlMs;try{expires=Math.min(expires,JSON.parse(Buffer.from(body.accountToken.slice(4).split('.')[0],'base64url')).exp*1000);}catch{}
        if(!Number.isFinite(expires)||expires<=now())fail();const verified={id:user.id,until:expires};cache.set(key,verified);while(cache.size>16)cache.delete(cache.keys().next().value);return verified;
      })().catch(()=>fail()).finally(()=>pending.delete(key));pending.set(key,operation);}
      value=await operation;
    }
    if(body.accountId&&body.accountId!==value.id)fail();return value.id;
  }
  return {identify,owner:()=>context.getStore()?.ownerId||fallbackOwner(),runAs:(ownerId,fn)=>context.run({ownerId},fn)};
}
