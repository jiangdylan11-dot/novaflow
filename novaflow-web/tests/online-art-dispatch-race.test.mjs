import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrustedArtPhases} from '../packages/shared/src/companion-art-business.mjs';
import * as compiler from '../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';

const model='xai/grok-4.7',intentId='0d2aa225-e027-4d20-8ef3-7b5d1a9bbfee';
async function scenario(change){
 let entered,release;const started=new Promise(r=>{entered=r}),gate=new Promise(r=>{release=r});
 let current=true,inferences=0,marked=false;
 const actor={userId:'u1',sessionId:'s1',epoch:0},abort=new AbortController();
 const phases=createTrustedArtPhases({secret:Buffer.alloc(32,4),models:[model],compiler,
  policyFor:()=> 'fixed test policy',quote:async()=>({pricingVersion:'test-v1',estimatedCredits:1}),
  assessUsage:async()=>{throw Error('unexpected usage');},isCurrent:async()=>{
   if(marked&&change==='cancel-recheck'){entered();await gate;}
   return current;
  },
  infer:async()=>{inferences++;throw Error('must not infer');},
  executeAtomic:async({run})=>run({markProviderDispatched:async()=>{
   if(change==='cancel-recheck'){marked=true;return;}
   entered();await gate;
  }})});
 const quote=await phases.quoteStructure({actor,model,intentId,input:{currentPrompt:'A safe synthetic image prompt',
  requirements:'',supportsNegativePrompt:false,nsfw:false,qwenPromptMode:'txt2img'}});
 const pending=phases.submit({actor,quoteToken:quote.quoteToken,signal:abort.signal});
 await started;
 if(change==='selection')current=false;
 if(change==='identity')actor.sessionId='s2';
 if(change==='cancel'||change==='cancel-recheck')abort.abort();
 release();await assert.rejects(pending);assert.equal(inferences,0);
}
test('model selection, session identity, and cancellation during dispatch marker never reach inference',async()=>{
 for(const change of ['selection','identity','cancel','cancel-recheck'])await scenario(change);
});
