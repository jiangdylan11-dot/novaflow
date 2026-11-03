import test from 'node:test';
import assert from 'node:assert/strict';
import '../renderer/xiaotao-prompt-source.js';
import {responsesToChatCompletions} from '../packages/shared/src/runninghub-llm.mjs';
import {xiaotaoVideoResponseFormat} from '../packages/shared/src/xiaotao-video-response-format.mjs';

const intent=globalThis.NovaFlowXiaotaoPromptSource;
for(const message of ['为什么连简单的提示词优化都做不到','怎么优化提示词？','提示词优化一直报错','普通对话都无法完成','现在无法正常对话，反馈极慢']) {
  test('feedback is conversation, never a rewrite: '+message,()=>{
    assert.equal(intent.isPromptConversation(message),true);
    assert.equal(intent.classifyPromptAction(message),'none');
  });
}
for(const message of ['优化提示词','帮我优化当前美工提示词','优化音频提示词','优化视频提示词','优化提示词：为什么月亮会发光','改成夜景']) {
  test('explicit rewrite remains actionable: '+message,()=>assert.equal(intent.classifyPromptAction(message),'optimize'));
}
for(const effort of [undefined,'low','none']) {
  test('DeepSeek ordinary chat/rewrite returns a final answer within its budget: '+effort,()=>{
    const wire=responsesToChatCompletions({input:[{role:'user',content:'fixture'}],max_output_tokens:400,...(effort?{reasoning:{effort}}:{})},'deepseek/deepseek-v4.1-flash');
    assert.deepEqual(wire.thinking,{type:'disabled'});
    assert.equal(wire.reasoning_effort,undefined);
    assert.equal(wire.max_tokens,400);
  });
}
test('explicit higher DeepSeek effort and other providers retain their settings',()=>{
  for(const model of ['deepseek/deepseek-v4.1-flash','xai/grok-4.7','openai/gpt-6.1-sol-saver']) {
    const wire=responsesToChatCompletions({input:[{role:'user',content:'fixture'}],reasoning:{effort:'high'}},model);
    assert.equal(wire.thinking,undefined);assert.equal(wire.reasoning_effort,'high');
  }
});
test('video JSON contains both language halves and the mode-specific fields',()=>{
  for(const mode of ['text_video','image_video','first_last','multi_reference']) {
    const format=xiaotaoVideoResponseFormat(mode),wire=responsesToChatCompletions({input:[{role:'user',content:'fixture'}],text:{format}},'deepseek/deepseek-v4.1-flash');
    assert.deepEqual(wire.response_format.json_schema.schema,format.schema);
    assert.equal(format.schema.properties.modelPrompt.required.length,mode==='multi_reference'?6:3);
    assert.ok(format.schema.required.includes('displayPrompt'));
    assert.equal(format.schema.required.includes('editPolicy'),mode==='multi_reference');
  }
});
