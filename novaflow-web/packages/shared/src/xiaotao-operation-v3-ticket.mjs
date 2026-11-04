// Server-only capability prototype for the default-closed operation contract.
// A caller must authenticate the actor and compute the intent digest and
// pricing version from trusted server state. No production route uses this.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';

const DOMAIN='nf.xiaotao.operation.v3';
const ALLOWED_MODELS=new Set(['xai/grok-4.7','openai/gpt-6.1-sol-saver','deepseek/deepseek-v4.1-flash']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/i;
const POLICY=/^sha256:[a-f0-9]{64}$/i;
const fail=code=>{throw Object.assign(new Error(code),{code,statusCode:400});};
function actorFields(actor) {
  if(!actor || !UUID.test(actor.userId || '') || typeof actor.sessionId!=='string'
    || !actor.sessionId || actor.sessionId.length>128) fail('invalid-server-actor');
  return {userId:actor.userId.toLowerCase(),sessionId:actor.sessionId};
}
function operationUuid(secret,userId,nonce) {
  const bytes=createHmac('sha256',secret).update(DOMAIN+'\0id\0').update(JSON.stringify([userId,nonce.toLowerCase()])).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function createXiaotaoOperationV3Tickets({enabled=false,secret,isCurrent,now=()=>Date.now()}={}) {
  if(enabled===true && (!Buffer.isBuffer(secret)||secret.length<32||typeof isCurrent!=='function'||typeof now!=='function')) fail('invalid-server-config');
  const signingKey=enabled===true ? Buffer.from(secret) : null;
  const ready=()=>{if(enabled!==true)throw Object.assign(new Error('operation-billing-disabled'),{code:'operation-billing-disabled',statusCode:503});};
  const mac=value=>createHmac('sha256',signingKey).update(DOMAIN+'\0ticket\0'+value).digest('base64url');
  return Object.freeze({
    async issue({actor,nonce,model,policyVersion,intentHash,ttlMs=300000}={}) {
      ready();const a=actorFields(actor);
      if(!UUID.test(nonce || '')||!ALLOWED_MODELS.has(model)||!POLICY.test(policyVersion || '')||!HASH.test(intentHash || '')
        || !Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>300000)fail('invalid-operation-terms');
      const currentTime=now();if(!Number.isSafeInteger(currentTime)||currentTime<0||!Number.isSafeInteger(currentTime+ttlMs))fail('invalid-server-clock');
      if(await isCurrent(a,model)!==true)fail('selection-stale');
      const payload={v:DOMAIN,operationId:operationUuid(signingKey,a.userId,nonce),...a,model,
        policyVersion:policyVersion.toLowerCase(),intentHash:intentHash.toLowerCase(),expiresAt:currentTime+ttlMs};
      const value=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');
      return {operationId:payload.operationId,token:value+'.'+mac(value),expiresAt:payload.expiresAt};
    },
    async verify({actor,token,model,policyVersion,intentHash,allowExpiredForCancellation=false}={}) {
      ready();const a=actorFields(actor);
      if(typeof token!=='string'||token.length>4096)fail('invalid-operation-ticket');
      const parts=token.split('.');if(parts.length!==2)fail('invalid-operation-ticket');
      const expected=Buffer.from(mac(parts[0]),'ascii'),actual=Buffer.from(parts[1],'ascii');
      if(actual.length!==expected.length||!timingSafeEqual(actual,expected))fail('invalid-operation-ticket');
      let p;try{p=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{fail('invalid-operation-ticket');}
      const keys=['v','operationId','userId','sessionId','model','policyVersion','intentHash','expiresAt'];
      const currentTime=now();
      if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==keys.length||keys.some(k=>!(k in p))
        ||p.v!==DOMAIN||!UUID.test(p.operationId||'')||p.userId!==a.userId||p.sessionId!==a.sessionId
        ||!ALLOWED_MODELS.has(model)||p.model!==model||!POLICY.test(policyVersion||'')||p.policyVersion!==policyVersion.toLowerCase()
        ||!HASH.test(intentHash||'')||p.intentHash!==intentHash.toLowerCase()||!Number.isSafeInteger(p.expiresAt)
        ||!Number.isSafeInteger(currentTime)||currentTime<0||(p.expiresAt<=currentTime&&allowExpiredForCancellation!==true))fail('invalid-operation-ticket');
      if(await isCurrent(a,model)!==true)fail('selection-stale');
      return Object.freeze({...p});
    }
  });
}
