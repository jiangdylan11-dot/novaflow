import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {estimateXiaotaoOnlineCredits,settleXiaotaoOnlineCredits,XIAOTAO_TEXT_SYSTEM,XIAOTAO_VISION_SYSTEM} from '../packages/shared/src/feature-credits.mjs';
import {companionPricingPolicy} from '../packages/shared/src/companion-pricing.mjs';

// Expectations come from the reviewed 2.0.289 self-contained companion
// artifact, exercised with synthetic input; no external service is called.
const config={xiaotao_online:{credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0,enabled_models:['deepseek/deepseek-v4.1-flash']}};
const sha=text=>createHash('sha256').update(text).digest('hex');

test('289 DeepSeek estimates and settled usage retain the frozen rate policy',()=>{
 const estimate=estimateXiaotaoOnlineCredits({text:'hello',outputTokens:2048,model:'deepseek/deepseek-v4.1-flash'});
 assert.deepEqual(estimate,{tokens:2826,usd:0.0015840036,rawCredits:1,credits:1,counts:{image:0,video:0,audio:0},cap:80});
 const usage={input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:40}};
 const settled=settleXiaotaoOnlineCredits({usage,reservedCredits:2,config,model:'deepseek/deepseek-v4.1-flash'});
 assert.equal(settled.pricingSource,'token_rate_estimate');assert.equal(settled.usdCost,0.000017826000000000002);
 assert.equal(settled.credits,1);assert.equal(settled.refund,1);assert.equal(settled.usageMissing,false);
});

test('289 pricing snapshot retains its fixed revision and excludes unreleased capabilities',async()=>{
 const provider={apiKey:'fixture',model:'xai/grok-4.7',pricingSnapshotReady:true,configRevision:'12',operationTextChatV3:true,operationDecimalCreditsV1:true,operationDecimalLedgerReady:true,operationFoartOpenV3:true,operationFoartIdleDraftV3:true,operationFoartAudioMusicV3:true,creditConfig:config};
 const price=await companionPricingPolicy(provider);
 assert.equal(price.revision,'2.0.265');assert.equal(price.version,'sha256:e6362efa5898c999dda454ee0f9416a37f193c0e4ac66a648d65864340cdaf84');
 assert.equal(price.config.xiaotao_online.operation_foart_open_v3,true);
 assert.equal(price.config.xiaotao_online.operation_foart_idle_draft_v3,undefined);
 assert.equal(price.config.xiaotao_online.operation_foart_audio_music_v3,undefined);
});

test('289 text and vision system prompts retain their deployed wording',()=>{
 assert.equal(sha(XIAOTAO_TEXT_SYSTEM),'5932377746bc0b5409496c7c9d927ec4d352abc3ce8a56e0bcb7d1d73edc6b19');
 assert.equal(sha(XIAOTAO_VISION_SYSTEM),'b76a87ac4a7f70bd224cd072701b241dbf0cf0982b06ca6c2523af92705c4a73');
});
