import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../renderer/xiaotao-prompt-source.js';
const { resolvePromptSource: resolve } = globalThis.NovaFlowXiaotaoPromptSource;
const { classifyPromptAction: classify } = globalThis.NovaFlowXiaotaoPromptSource;

test('different complete page and current-turn prompts ask before any action', () => {
  assert.equal(resolve({pagePrompt:'白天的公园',conversationPrompt:'海边黄昏',instruction:'帮我优化'}).reason,'different-prompts');
});
test('pure optimization uses page and does not add the command as scene content', () => {
  assert.deepEqual(resolve({pagePrompt:'角色站在原地',instruction:'优化首尾帧视频的提示词'}),
    {status:'ready',source:'page',prompt:'角色站在原地',requirements:''});
});
test('empty page uses explicit conversational content; both empty ask', () => {
  assert.equal(resolve({conversationPrompt:'镜头缓慢推进'}).source,'conversation');
  assert.equal(resolve({instruction:'优化提示词'}).reason,'both-prompts-empty');
});
test('equal content does not ask and explicit page/conversation is respected', () => {
  assert.equal(resolve({pagePrompt:'  相同  内容 ',conversationPrompt:'相同 内容',instruction:'优化'}).source,'page');
  assert.equal(resolve({pagePrompt:'页面内容',conversationPrompt:'对话内容',instruction:'优化下面的提示词'}).source,'page');
  assert.equal(resolve({pagePrompt:'页面内容',conversationPrompt:'对话内容',instruction:'优化对话里的提示词'}).source,'conversation');
  assert.equal(resolve({conversationPrompt:'对话内容',instruction:'优化页面提示词'}).reason,'page-prompt-empty');
});
test('revision remains a requirement, not a competing complete prompt', () => {
  assert.deepEqual(resolve({pagePrompt:'角色坐在桌前',conversationPrompt:'改成夜景',instruction:'改成夜景'}),
    {status:'ready',source:'page',prompt:'角色坐在桌前',requirements:'改成夜景'});
});
test('only explicit same-turn content after a colon is extracted', () => {
  assert.equal(resolve({pagePrompt:'白天的公园',instruction:'优化提示词：海边黄昏'}).reason,'different-prompts');
  assert.equal(resolve({instruction:'优化提示词：海边黄昏'}).prompt,'海边黄昏');
  assert.equal(resolve({instruction:'优化提示词：海边黄昏'}).requirements,'');
  assert.deepEqual(resolve({pagePrompt:'角色坐在桌前',instruction:'优化提示词：改成夜景'}),
    {status:'ready',source:'page',prompt:'角色坐在桌前',requirements:'改成夜景'});
});
test('colloquial commands stay instructions and explicit quoted below text is conversation', () => {
  for (const instruction of ['优化这个提示词','帮我优化下']) {
    assert.deepEqual(resolve({pagePrompt:'角色在房间',instruction}),
      {status:'ready',source:'page',prompt:'角色在房间',requirements:''});
  }
  assert.deepEqual(resolve({pagePrompt:'角色在房间',conversationPrompt:'把它改成夜景',instruction:'把它改成夜景'}),
    {status:'ready',source:'page',prompt:'角色在房间',requirements:'把它改成夜景'});
  assert.equal(resolve({pagePrompt:'页面原有内容',instruction:'页面已有，但我说下面这段：海边黄昏'}).prompt,'海边黄昏');
  assert.equal(resolve({pagePrompt:'页面原有内容',instruction:'页面已有，但我说下面这段：海边黄昏'}).source,'conversation');
});
test('prompt optimization intent does not turn refusals, questions or mixed generation into an optimization', () => {
  assert.equal(classify('优化提示词：一只猫'),'optimize');
  assert.equal(classify('帮我优化下'),'optimize');
  assert.equal(classify('不要优化提示词'),'none');
  assert.equal(classify('解释提示词是什么'),'none');
  assert.equal(classify('优化提示词并生成图片'),'compound');
  assert.equal(classify('优化提示词，不要生成图片'),'optimize');
  assert.equal(classify('改成夜景'),'optimize');
  assert.equal(classify('把它改成夜景'),'optimize');
  assert.equal(classify('删除图层'),'none');
});
