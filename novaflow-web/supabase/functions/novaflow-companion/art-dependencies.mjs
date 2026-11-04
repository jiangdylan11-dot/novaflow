// Server-owned dependencies for the default-closed art route. The policy JSON
// is generated from the same Python source as the local Qwen 2.1 compiler.
import * as compiler from '../../../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
import policies from './qwen21-art-policy.json' with { type: 'json' };
import {Buffer} from 'node:buffer';

// This factory is invoked only by a server-owned, default-false switch. It
// reuses the bundled compiler; it does not create credentials or call HTTP.

export function policyFor(mode) {
  return mode === 'txt2img' || mode === 'img2img' ? policies[mode] : '';
}

export function artBusinessDependencies(secret,{operationV3Enabled=false,createOperationV3Adapter}={}) {
  // Trusted server assembly only; a request or database setting cannot enable
  // this. Create the adapter per request so session verification is never
  // retained or reused across different users.
  if(operationV3Enabled!==true)return {enabled:false, accountingReady:false, compiler, policyFor, secret};
  if(!Buffer.isBuffer(secret)||secret.length<32||typeof createOperationV3Adapter!=='function')throw Object.assign(new Error('operation-billing-unavailable'),{code:'operation-billing-unavailable',statusCode:503});
  return {enabled:true,accountingReady:true,compiler,policyFor,secret,
    operationV3ForRequest:({provider,rpc,isCurrent})=>createOperationV3Adapter({enabled:true,provider,rpc,secret,isCurrent})};
}
