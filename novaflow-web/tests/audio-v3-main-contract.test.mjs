import test from 'node:test';
import assert from 'node:assert/strict';
import {createXiaotaoOperationV3Prepare} from '../packages/shared/src/xiaotao-operation-v3-prepare.mjs';
import {createXiaotaoOperationV3Chat} from '../packages/shared/src/xiaotao-operation-v3-chat.mjs';
import {canonicalizeXiaotaoV3AudioIntent} from '../packages/shared/src/xiaotao-audio-framework-v3.mjs';
import {companionPricingPolicy} from '../packages/shared/src/companion-pricing.mjs';
const models=['xai/grok-4.7','openai/gpt-6.1-sol-saver','deepseek/deepseek-v4.1-flash'];
const user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},sessionId='synthetic-session',nonce='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',secret=Buffer.alloc(32,7);
const videoIntent=()=>({mode:'audio-rewrite',requestId:'audio_test_01',kind:'music',input:'A soft instrumental loop',seconds:30,bpm:88,requirements:'no vocals'});
const videoAnswer=()=> 'Soft instrumental music with a steady groove. BPM: 88';
function ledger(){let state;const events=[];return {events,rpc:async(name,args)=>{events.push(name);if(name==='claim_xiaotao_operation_route_v3')return {route:'v3',idempotent:false};if(name==='reserve_xiaotao_operation_stage_v3'){if(state)return {status:state,idempotent:true};state='reserved';return {status:state,idempotent:false};}if(name==='mark_xiaotao_operation_stage_dispatched_v3'){state='dispatched';return {status:state,first_dispatch:true};}if(name==='record_xiaotao_operation_stage_usage_v3'){state='recorded';return {status:state};}if(name==='finalize_xiaotao_operation_v3'){state='settled';return {status:state,outcome:args.p_outcome,charged:1,uncollected:0};}throw Error(name);}};}
for(const model of models)test('Audio V3 binds selected model, preserves text-only contract and settles once: '+model,async()=>{
 const db=ledger(),provider={apiKey:'synthetic',model:'xai/grok-4.7',configRevision:'1',pricingSnapshotReady:true,operationTextChatV3:true,operationAudioRewriteV3:true,creditConfig:{xiaotao_online:{enabled_models:models}}},options={enabled:true,audioRewriteEnabled:true,secret,loadProvider:async()=>provider,rpc:db.rpc},initial=videoIntent();
 const prepared=await createXiaotaoOperationV3Prepare(options)({user,sessionId,payload:{nonce,model,intent:initial},isCurrent:async()=>true});assert.equal(prepared.outputTokens,400);assert.ok(prepared.estimatedCredits>0);
 let calls=0;const run=createXiaotaoOperationV3Chat({...options,infer:async({body,maxRetries})=>{calls++;assert.equal(body.model,model);assert.equal(body.max_output_tokens,400);assert.equal(maxRetries,0);assert.ok(!JSON.stringify(body.input).includes('data:image/'));return {data:{model,status:'completed',finish_reason:'stop',usage:{billing_token_usage_invalid:false,input_tokens:80,output_tokens:20,total_tokens:100,input_tokens_details:{cached_tokens:0}},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:videoAnswer()}]}]}};}});
 const result=await run({user,sessionId,payload:{operationToken:prepared.token,intent:initial},isCurrent:async()=>true});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.model,model);assert.equal(result.reply,videoAnswer());assert.equal(result.receipt.charged,1);assert.equal(calls,1);
 await assert.rejects(run({user,sessionId,payload:{operationToken:prepared.token,intent:initial},isCurrent:async()=>true}));assert.equal(calls,1);
});

test('audio mode default closed before ledger claim',async()=>{const db=ledger(),options={enabled:true,secret,loadProvider:async()=>({apiKey:'synthetic',model:models[0],configRevision:'1',creditConfig:{}}),rpc:db.rpc};await assert.rejects(createXiaotaoOperationV3Prepare(options)({user,sessionId,payload:{nonce,model:models[0],intent:videoIntent()},isCurrent:async()=>true}),{code:'operation-intent-unsupported'});assert.deepEqual(db.events,[]);});
test('audio pricing is opt-in and hash-bound',async()=>{const p={apiKey:'synthetic',model:models[0],configRevision:'1',operationTextChatV3:true,creditConfig:{xiaotao_online:{enabled_models:models}}},a=await companionPricingPolicy(p),b=await companionPricingPolicy({...p,operationAudioRewriteV3:true});assert.equal(a.config.xiaotao_online.operation_audio_rewrite_v3,undefined);assert.equal(b.config.xiaotao_online.operation_audio_rewrite_v3,true);assert.notEqual(a.version,b.version);});
test('audio preparation quotes sub-credit amounts only under a fully opted-in decimal snapshot',async()=>{
 const db=ledger(),model='deepseek/deepseek-v4.1-flash';
 const base={apiKey:'synthetic',model:models[0],configRevision:'1',pricingSnapshotReady:true,operationTextChatV3:true,operationAudioRewriteV3:true,
  creditConfig:{credits_per_usd:211,xiaotao_online:{markup:1.5,enabled_models:models}}};
 const options={enabled:true,audioRewriteEnabled:true,secret,rpc:db.rpc,loadProvider:async()=>base};
 const args={user,sessionId,payload:{nonce,model,intent:videoIntent()},isCurrent:async()=>true};
 const legacy=await createXiaotaoOperationV3Prepare(options)(args);assert.ok(Number.isSafeInteger(legacy.estimatedCredits));assert.ok(legacy.estimatedCredits>=1);
 const decimal=await createXiaotaoOperationV3Prepare({...options,loadProvider:async()=>({...base,operationDecimalCreditsV1:true,operationDecimalLedgerReady:true,
  creditConfig:{...base.creditConfig,xiaotao_online:{...base.creditConfig.xiaotao_online,credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0}}})})(args);
 assert.ok(decimal.estimatedCredits>0 && decimal.estimatedCredits<1);
 assert.equal(String(decimal.estimatedCredits).split('.')[1].length<=6,true);
 assert.notEqual(decimal.policyVersion,legacy.policyVersion);
});
test('audio frames bind music and sfx while rejecting media and invalid bounds',()=>{const a=videoIntent(),music=canonicalizeXiaotaoV3AudioIntent(a),sfx=canonicalizeXiaotaoV3AudioIntent({...a,kind:'sfx',seconds:3,bpm:undefined});assert.match(music.compiled.systemText,/musician/);assert.match(sfx.compiled.systemText,/sound design/);assert.notEqual(music.intentHash,sfx.intentHash);for(const bad of [{...a,input:'data:audio/wav;base64,AA=='},{...a,bpm:221},{...a,media:'audio.wav'}])assert.throws(()=>canonicalizeXiaotaoV3AudioIntent(bad),{code:'operation-intent-unsupported'});});
