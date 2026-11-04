import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {createRecoveryOnly} from '../supabase/functions/novaflow-companion/recovery-only.mjs';
import {companionPricingPolicy} from '../supabase/functions/_art-shared/companion-pricing.mjs';
import {createXiaotaoOperationV3Tickets} from '../supabase/functions/_art-shared/xiaotao-operation-v3-ticket.mjs';
import {canonicalizeXiaotaoV3FoartIntent} from '../supabase/functions/_art-shared/xiaotao-operation-v3-foart-continuation.mjs';
const secret=Buffer.alloc(32,7),model='xai/grok-4.7',userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId='session',epoch=4;
const operationId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',intentHash='d'.repeat(64),actor={userId,sessionId,epoch};
const user={id:userId},isCurrent=async()=>true;
const provider={apiKey:'synthetic',model,configRevision:'1',pricingSnapshotReady:true,creditConfig:{}};
const policy=await companionPricingPolicy(provider);
const snapshotText=JSON.stringify({schema:policy.schema,revision:policy.revision,providerRevision:policy.providerRevision,defaultModel:policy.defaultModel,config:policy.config,models:policy.models});
assert.equal('sha256:'+createHash('sha256').update(snapshotText).digest('hex'),policy.version);
const snapshot={status:'open',policy_version:policy.version,round_mode:policy.config.token_billing.round,
  phase_cap:policy.config.xiaotao_online.message_cap_credits,expected_config:{},policy_snapshot_text:snapshotText};
function fakeDb({badSnapshot=false,unknown=false}={}){
 const calls=[];return {calls,rpc:async(name,args)=>{calls.push({name,args});
   if(name==='get_xiaotao_operation_snapshot_v3')return badSnapshot?{...snapshot,policy_snapshot_text:snapshotText+' '}:snapshot;
   if(name==='finalize_xiaotao_operation_v3')return unknown?{status:'pending-reconciliation'}:{status:'settled',outcome:'cancel',charged:1,uncollected:0};
   throw Error('unexpected RPC '+name);
 }};
}
function artToken(fields={}){
 const p={v:'foart-art-phases-prototype-v1',kind:'validated-structure',actor,model,operation:{operationId,intentHash},parentHash:'e'.repeat(64),pricingVersion:policy.version,parentRequestId:'synthetic-request',expiresAt:1,...fields};
 const value=Buffer.from(JSON.stringify(p)).toString('base64url');return value+'.'+createHmac('sha256',secret).update('foart-art-phases-prototype-v1\0'+value).digest('base64url');
}
const request=stageToken=>({user,sessionId,payload:{epoch,stageToken},isCurrent});
test('recovery art validates signed actor then finalizes with original stored policy; expired token accepted',async()=>{
 const db=fakeDb(),rec=createRecoveryOnly({secret,rpc:db.rpc});
 const result=await rec.artCancel(request(artToken()));assert.equal(result.errorCode,'operation-cancelled');assert.equal(result.settlement.settledCredits,1);
 assert.deepEqual(db.calls.map(x=>x.name),['get_xiaotao_operation_snapshot_v3','finalize_xiaotao_operation_v3']);
 assert.equal(db.calls[1].args.p_operation_id,operationId);assert.equal(db.calls[1].args.p_policy_version,policy.version);assert.equal(db.calls[1].args.p_outcome,'cancel');
});
test('art forged/foreign/stale session never reads snapshot or finalizes',async()=>{
 const db=fakeDb(),rec=createRecoveryOnly({secret,rpc:db.rpc});
 await assert.rejects(rec.artCancel(request(artToken()+'x')));
 await assert.rejects(rec.artCancel({...request(artToken()),sessionId:'other'}));
 await assert.rejects(rec.artCancel({...request(artToken()),isCurrent:async()=>false}));
 assert.equal(db.calls.length,0);
});
test('art mismatched stored policy and unknown settlement fail closed',async()=>{
 const badDb=fakeDb({badSnapshot:true}),bad=createRecoveryOnly({secret,rpc:badDb.rpc});
 await assert.rejects(bad.artCancel(request(artToken())));assert.equal(badDb.calls.length,1);
 const pendingDb=fakeDb({unknown:true}),pending=createRecoveryOnly({secret,rpc:pendingDb.rpc});
 assert.equal((await pending.artCancel(request(artToken()))).errorCode,'operation-status-unknown');
});
test('Foart recovery uses verified ticket and stored snapshot without invoking provider',async()=>{
 const db=fakeDb(),rec=createRecoveryOnly({secret,rpc:db.rpc});
 const baseActor={userId,sessionId},originalIntent={message:'Open animation',history:[],promptLanguage:'zh-CN'},initialContext={schema:'nf.foart.tool-plan.v1',controls:[]};
 const canonical=canonicalizeXiaotaoV3FoartIntent(originalIntent,initialContext);
 const tickets=createXiaotaoOperationV3Tickets({enabled:true,secret,isCurrent});
 const issued=await tickets.issue({actor:baseActor,nonce:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',model,policyVersion:policy.version,intentHash:canonical.intentHash});
 const input={actor:baseActor,operationToken:issued.token,originalIntent,initialContext,isCurrent};
 const receipt=await rec.foartCancel(input);assert.equal(receipt.outcome,'cancel');
 assert.deepEqual(db.calls.map(x=>x.name),['get_xiaotao_operation_snapshot_v3','finalize_xiaotao_operation_v3']);
 await assert.rejects(rec.foartCancel({...input,operationToken:issued.token+'x'}));
 await assert.rejects(rec.foartCancel({...input,originalIntent:{...originalIntent,message:'changed'}}));
 assert.equal(db.calls.length,2);
});
