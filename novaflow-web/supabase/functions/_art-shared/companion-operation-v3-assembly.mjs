// GENERATED COPY - source: packages/shared/src/companion-operation-v3-assembly.mjs
// Server-only assembly for the candidate operation ledger. The production
// entry must keep this disabled until its RPC migration, reconciliation and
// policy semantics have been independently verified.
import {Buffer} from 'node:buffer';
import {postRunningHubResponses,normalizeRunningHubLlmBaseUrl} from './runninghub-llm.mjs';
import {createXiaotaoOperationV3Prepare} from './xiaotao-operation-v3-prepare.mjs';
import {createXiaotaoOperationV3Chat} from './xiaotao-operation-v3-chat.mjs';
import {createXiaotaoV3FoartPlanner} from './xiaotao-operation-v3-foart-planner.mjs';

const MODELS=new Set(['xai/grok-4.7','openai/gpt-6.1-sol-saver','deepseek/deepseek-v4.1-flash']);
const unavailable=()=>{throw Object.assign(new Error('operation-billing-unavailable'),{code:'operation-billing-unavailable',statusCode:503});};

// Only the server constructs this object; no request or database field can
// turn it on. The transport override exists for isolated, non-network tests.
export function createCompanionOperationV3Assembly({foartGeneralEnabled=false,enabled=false,decimalCreditsEnabled=false,visionEnabled=false,styleEnabled=false,styleVisionModels=[],videoRewriteEnabled=false,uiDraftEnabled=false,audioRewriteEnabled=false,foartOpenEnabled=false,secret,fetchImpl}={}) {
  if(enabled!==true)return Object.freeze({enabled:false});
  if(!Buffer.isBuffer(secret)||secret.length<32||(foartGeneralEnabled===true&&foartOpenEnabled!==true))unavailable();
  if(!Array.isArray(styleVisionModels)||styleVisionModels.some(model=>!MODELS.has(model))||new Set(styleVisionModels).size!==styleVisionModels.length||(styleVisionModels.length>0&&visionEnabled!==true))unavailable();
  const trustedStyleVisionModels=Object.freeze([...styleVisionModels].sort());
  const key=Buffer.from(secret);
  return Object.freeze({enabled:true,...(decimalCreditsEnabled===true?{decimalCreditsEnabled:true}:{}),visionEnabled:visionEnabled===true,styleEnabled:styleEnabled===true,styleVisionModels:trustedStyleVisionModels,videoRewriteEnabled:videoRewriteEnabled===true,uiDraftEnabled:uiDraftEnabled===true,audioRewriteEnabled:audioRewriteEnabled===true,foartOpenEnabled:foartOpenEnabled===true,
    foartGeneralEnabled:foartGeneralEnabled===true,
    async createHandlers({provider,rpc}={}) {
      if(!provider||typeof provider!=='object'||!provider.apiKey||typeof rpc!=='function')unavailable();
      const baseUrl=normalizeRunningHubLlmBaseUrl(provider.baseUrl);
      const snapshot=structuredClone(provider);
      const options={enabled:true,visionEnabled:visionEnabled===true,styleEnabled:styleEnabled===true,styleVisionModels:trustedStyleVisionModels,videoRewriteEnabled:videoRewriteEnabled===true,uiDraftEnabled:uiDraftEnabled===true,audioRewriteEnabled:audioRewriteEnabled===true,secret:key,loadProvider:async()=>structuredClone(snapshot),rpc};
      // The selected model is verified again by the ticket, policy and ports.
      // Never accept a provider/config/usage supplied by the browser and never
      // automatically replay a request that may already have been charged.
      const infer=({body,model,signal})=>{
        if(!MODELS.has(model)||body?.model!==model)unavailable();
        return postRunningHubResponses({body,config:{apiKey:snapshot.apiKey,baseUrl,model},
          ...(fetchImpl?{fetchImpl}:{}),signal,maxRetries:0,includeBillingIntegrity:true});
      };
      const foart=foartOpenEnabled===true?createXiaotaoV3FoartPlanner({...options,infer,foartGeneralEnabled:foartGeneralEnabled===true}):undefined;
      return Object.freeze({prepareXiaotaoOperationV3:createXiaotaoOperationV3Prepare(options),
        executeXiaotaoOperationV3:createXiaotaoOperationV3Chat({...options,infer}),
        ...(decimalCreditsEnabled===true?{operationDecimalCreditsSupported:true}:{}),
        ...(visionEnabled===true?{operationVisionSupported:true}:{}),
        ...(styleEnabled===true?{operationStyleSupported:true}:{}),
        ...(videoRewriteEnabled===true?{operationVideoRewriteSupported:true}:{}),
        ...(uiDraftEnabled===true?{operationUiDraftSupported:true}:{}),
        ...(audioRewriteEnabled===true?{operationAudioRewriteSupported:true}:{}),
        ...(foart?{foart}:{})});
    }
  });
}
