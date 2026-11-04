// GENERATED COPY - source: packages/shared/src/xiaotao-operation-v3-art-adapter.mjs
// Default-closed bridge for the existing trusted art compiler. It never
// accepts billing inputs from a browser and does not itself call a provider.
// It must be supplied to createTrustedArtPhases by trusted server assembly.
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {companionPricingPolicy} from './companion-pricing.mjs';
import {createXiaotaoOperationV3Tickets} from './xiaotao-operation-v3-ticket.mjs';
import {createXiaotaoOperationV3Ports} from './xiaotao-operation-v3-ports.mjs';

const fail=(code,statusCode=503)=>{throw Object.assign(new Error(code),{code,statusCode});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rawPolicy=p=>JSON.stringify({schema:p.schema,revision:p.revision,providerRevision:p.providerRevision,defaultModel:p.defaultModel,config:p.config,models:p.models});

export async function createXiaotaoV3ArtAdapter({enabled=false,provider,rpc,secret,isCurrent}={}) {
  if(enabled!==true)return Object.freeze({enabled:false});
  if(!provider||typeof provider!=='object'||!provider.creditConfig||typeof rpc!=='function'||
     !Buffer.isBuffer(secret)||secret.length<32||typeof isCurrent!=='function')fail('invalid-server-config');
  const config=structuredClone(provider.creditConfig);
  const expected=structuredClone(provider.billingExpectedConfig??provider.creditConfig);
  const snapshotProvider={...provider,creditConfig:config};
  const policy=await companionPricingPolicy(snapshotProvider);
  const ports=createXiaotaoOperationV3Ports(rpc,{enabled:true,policyVersion:policy.version,
    roundMode:policy.config.token_billing.round,expectedCap:policy.config.xiaotao_online.message_cap_credits,
    expectedConfig:expected,policySnapshotText:rawPolicy(policy)});
  const key=Buffer.from(secret);
  return Object.freeze({enabled:true,ports,
    async begin({actor,model,nonce,pricingVersion,structureHash}) {
      if(pricingVersion!==policy.version||!policy.models.some(row=>row.id===model&&row.available===true)||
         typeof structureHash!=='string'||!/^[a-f0-9]{64}$/.test(structureHash))fail('operation-pricing-unavailable');
      // Only the already-validated compiler request and image manifest hash
      // reach this point. Client bytes/identity/cost never become DB claims.
      const intentHash=hash({schema:'nf.xiaotao.operation.art-intent.v1',structureHash,epoch:actor?.epoch});
      const tickets=createXiaotaoOperationV3Tickets({enabled:true,secret:key,isCurrent:async()=>isCurrent(actor,model)});
      const issued=await tickets.issue({actor,nonce,model,policyVersion:policy.version,intentHash});
      return {operationId:issued.operationId,intentHash};
    },
    async executePhase({actor,operationId,model,stage,imageCount,requestHash,pricingVersion,estimatedCredits,signal,run}) {
      if(pricingVersion!==policy.version||actor?.model!==model||!['structure','english'].includes(stage)||typeof run!=='function'||
         !Number.isSafeInteger(imageCount)||imageCount<0||imageCount>3)fail('invalid-art-stage');
      if(signal?.aborted)fail('cancelled-before-submit',409);
      const args={actor,operationId,phaseId:stage,hash:requestHash};
      const reserve=await ports.reserveStage({...args,sequence:stage==='structure'?1:2,phaseKind:stage,
        feature:imageCount?'xiaotao_vision':'online_chat_turn',estimatedCredits});
      if(reserve?.status!=='reserved'||reserve.idempotent!==false)fail('operation-status-unknown');
      let dispatchAttempted=false;
      const markProviderDispatched=async()=>{
        if(dispatchAttempted)fail('operation-status-unknown');
        dispatchAttempted=true;
        const mark=await ports.markDispatched(args);
        if(mark?.status!=='dispatched'||mark.first_dispatch!==true)fail('operation-status-unknown');
      };
      let result;
      try {result=await run({markProviderDispatched});}
      catch(error) {
        // An RPC timeout can happen after dispatch was committed; never infer
        // that a failed marker means the hold can be safely released.
        if(dispatchAttempted)fail('operation-status-unknown');
        const receipt=await ports.finalize({actor,operationId,outcome:'cancel'});
        if(receipt?.status!=='settled'||receipt.outcome!=='cancel')fail('operation-status-unknown');
        throw Object.assign(new Error('cancelled-before-dispatch'),{code:'cancelled-before-dispatch',statusCode:409,receipt});
      }
      if(!dispatchAttempted||result?.answer?.model!==model||!result?.answer?.usage)fail('operation-status-unknown');
      const recorded=await ports.recordAssessedUsage({...args,usageRecords:[result.answer.usage]});
      if(recorded?.status!=='recorded')fail('operation-status-unknown');
      return {status:'recorded',response:result.answer,decision:result.decision,requestHash,pricingVersion,model};
    }
  });
}
