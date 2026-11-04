import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFlashArtAgent,FLASH_CHAT_AGENT_SYSTEM} from '../../worker/src/flash-art-agent.mjs';
import {QWEN_CPU_MODEL} from '../../worker/src/qwen-cpu-model.mjs';

async function run(model) {
  let system,tools;
  const flash={identity:{id:model},inferConversation:async options=>{
    system=options.messages[0].content;tools=options.tools;
    return {model,requestId:'model-reply',finishReason:'stop',message:{role:'assistant',content:'这是模型自己的回答。'}};
  }};
  const result=await createFlashArtAgent().run({payload:{requestId:randomUUID(),mode:'chat',message:'你是谁？',history:[],images:[]},flash});
  return {system,tools,result};
}
test('verified Qwen uses its own model identity and text/image-only chat instruction',async()=>{
  const qwen=await run(QWEN_CPU_MODEL.alias);
  assert.match(qwen.system,/Qwen3\.5 9B 社区模型/);assert.match(qwen.system,/只提供文字和图片对话/);
  assert.doesNotMatch(qwen.system,/NovaFlow 的本地 Flash 助手/);assert.match(qwen.system,/没有工具调用或操作软件的能力/);assert.equal(qwen.tools,undefined);
  assert.equal(qwen.result.reply,'这是模型自己的回答。');assert.deepEqual(qwen.result.toolTrace,[]);
});
test('existing Next chat system remains byte-for-byte unchanged',async()=>{
  const next=await run('swift-agent-fixture');assert.equal(next.system,FLASH_CHAT_AGENT_SYSTEM);assert.equal(next.tools,undefined);
});
