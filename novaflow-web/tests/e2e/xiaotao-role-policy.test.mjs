import test from 'node:test';
import assert from 'node:assert/strict';
import {XIAOTAO_FOART_ROLE_SYSTEM,withXiaotaoFoartRole} from '../../packages/shared/src/xiaotao-role-policy.mjs';
import {XIAOTAO_TEXT_SYSTEM,XIAOTAO_VISION_SYSTEM,xiaotaoOnlineSystemPrompt} from '../../packages/shared/src/feature-credits.mjs';
import {companionInput} from '../../packages/shared/src/companion-chat.mjs';
import {FLASH_CHAT_AGENT_SYSTEM,FLASH_CREATION_AGENT_SYSTEM,FLASH_ART_AGENT_SYSTEM,createFlashArtAgent} from '../../worker/src/flash-art-agent.mjs';
import {FLASH_MEDIA_AGENT_SYSTEM} from '../../worker/src/flash-media-agent.mjs';

test('local ordinary chat sends the product role without granting execution tools',async()=>{
  let observed;
  const result=await createFlashArtAgent().run({payload:{requestId:'role-chat-123',mode:'chat',provider:'local',message:'Foart里怎么设置循环动画？',history:[],images:[]},flash:{identity:{id:'fixture'},inferConversation:async request=>{
    observed=request;return {model:'fixture',requestId:'role-response-123',finishReason:'stop',message:{role:'assistant',content:'请在音视版块设置循环动画。'}};
  }}});
  assert.ok(observed.messages[0].content.includes(XIAOTAO_FOART_ROLE_SYSTEM));
  assert.deepEqual(observed.tools||[],[]);
  assert.equal(result.proposal,undefined);
  assert.equal(result.mediaPlan,undefined);
});
