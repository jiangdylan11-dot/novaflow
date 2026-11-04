// Server-only cancellation adapters. They never accept a provider or invoke one.
// The existing authenticated route supplies actor/session freshness and the
// existing signed tokens bind ownership and the original operation terms.
import {Buffer} from 'node:buffer';
import {createTrustedArtPhases} from '../_art-shared/companion-art-business.mjs';
import {createXiaotaoV3FoartPlanner} from '../_art-shared/xiaotao-operation-v3-foart-planner.mjs';
import {createXiaotaoV3FoartJournal} from '../_art-shared/xiaotao-operation-v3-foart-journal.mjs';
import {createXiaotaoOperationV3Ports} from '../_art-shared/xiaotao-operation-v3-ports.mjs';
import {XIAOTAO_ONLINE_MODEL_IDS} from '../_art-shared/xiaotao-online-models.mjs';

const prohibited=()=>{throw Object.assign(new Error('recovery path cannot dispatch'),{code:'recovery-dispatch-forbidden',statusCode:503});};
const bad=()=>{throw Object.assign(new Error('operation status unavailable'),{code:'operation-status-unknown',statusCode:503});};
const models=XIAOTAO_ONLINE_MODEL_IDS;

export function createRecoveryOnly({secret,rpc}={}){
  if(!Buffer.isBuffer(secret)||secret.length<32||typeof rpc!=='function')bad();
  const journal=createXiaotaoV3FoartJournal({enabled:true,rpc});
  const foart=createXiaotaoV3FoartPlanner({enabled:true,secret,rpc,loadProvider:prohibited,infer:prohibited});
  return Object.freeze({
    async foartCancel(request){return foart.cancel(request);},
    async artCancel({user,sessionId,payload,isCurrent}){
      // Only cancelPending is returned/called. Stubs guarantee this recovery
      // construction cannot quote, reserve, assess or invoke any provider.
      const ports={bindArtPlan:prohibited,acceptArtStructure:prohibited,registerArtEnglish:prohibited,acceptArtEnglish:prohibited,
        async finalize({actor,operationId,outcome}){
          if(outcome!=='cancel')bad();
          // actor/operationId come exclusively from a verified signed parent.
          const snapshot=await journal.loadPolicySnapshot(actor);
          if(!snapshot||!['open','settled'].includes(snapshot.status)||snapshot.policy_version!==actor.policyVersion||typeof snapshot.policy_snapshot_text!=='string')bad();
          const original=createXiaotaoOperationV3Ports(rpc,{enabled:true,policyVersion:snapshot.policy_version,
            roundMode:snapshot.round_mode,expectedCap:snapshot.phase_cap,expectedConfig:snapshot.expected_config,policySnapshotText:snapshot.policy_snapshot_text});
          return original.finalize({actor,operationId,outcome:'cancel'});
        }};
      const phases=createTrustedArtPhases({secret,models,compiler:{buildGrokPromptOptimizeRequest:prohibited,grokResponsesPublicResult:prohibited},
        policyFor:prohibited,quote:prohibited,assessUsage:prohibited,executeAtomic:prohibited,infer:prohibited,isCurrent,
        operationV3:{enabled:true,begin:prohibited,executePhase:prohibited,ports}});
      const actor={userId:String(user?.id||''),sessionId:String(sessionId||''),epoch:payload?.epoch};
      return phases.cancelPending({actor,stageToken:payload?.stageToken});
    }
  });
}
