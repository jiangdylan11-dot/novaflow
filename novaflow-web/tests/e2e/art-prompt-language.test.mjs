import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {artPromptLanguageSystem,artPromptLanguageTools} from '../../packages/shared/src/art-prompt-language.mjs';
import {companionInput} from '../../packages/shared/src/companion-chat.mjs';
import {createFlashArtAgent,computeArtAgentFingerprint,FLASH_CREATION_AGENT_SYSTEM,FLASH_CREATION_AGENT_TOOLS} from '../../worker/src/flash-art-agent.mjs';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const prompt='以<image1>为内容原图，保留人物眨眼、闭嘴微笑、服装和杯子，用干净的线条与明暗重新绘制。招牌上的字保持“OPEN”。';
function request(extra={}){const p={requestId:'chinese-prompt-fixture',mode:'creation',promptLanguage:'zh-CN',message:'只给中文提示词，不生图',history:[],artContext:{task:'creation',provider:'local',engine:'qwen-2.1',mode:'img2img',nsfw:false,prompt:'原提示词',negativePrompt:'  精确负向\n保持  ',cfg:1,steps:8},images:[{dataUrl:PNG,role:'subject'}],...extra};p.contextFingerprint=computeArtAgentFingerprint(p);return createFlashArtAgent().preflight(p);}
const propose=(input,id)=>({model:'fixture',requestId:id,finishReason:'tool_calls',message:{role:'assistant',tool_calls:[{id,type:'function',function:{name:'propose_art_direction',arguments:JSON.stringify({contextFingerprint:input.messages[1].content[0].text.match(/"contextFingerprint":"([a-f0-9]{64})"/)[1],prompt,explanation:'已写好提示词。'})}}]}});

test('an explicit Chinese preference changes only a per-request language suffix and cloned field descriptions',()=>{
  assert.equal(artPromptLanguageSystem(FLASH_CREATION_AGENT_SYSTEM,undefined),FLASH_CREATION_AGENT_SYSTEM);
  assert.equal(artPromptLanguageSystem(FLASH_CREATION_AGENT_SYSTEM,'en'),FLASH_CREATION_AGENT_SYSTEM);
  assert.strictEqual(artPromptLanguageTools(FLASH_CREATION_AGENT_TOOLS,undefined),FLASH_CREATION_AGENT_TOOLS);
  assert(artPromptLanguageSystem(FLASH_CREATION_AGENT_SYSTEM,'zh-CN').startsWith(FLASH_CREATION_AGENT_SYSTEM+'\n\n'));
  const localized=artPromptLanguageTools(FLASH_CREATION_AGENT_TOOLS,'zh-CN'),withPrompt=localized.find(tool=>tool.function.parameters.properties?.prompt);
  assert.match(withPrompt.function.parameters.properties.prompt.description,/Simplified Chinese/);
  assert.doesNotMatch(FLASH_CREATION_AGENT_TOOLS.find(tool=>tool.function.parameters.properties?.prompt).function.parameters.properties.prompt.description,/Simplified Chinese/);
});

test('one native Chinese proposal keeps exact Unicode, lettering, slots and negative without translation calls',async()=>{
  const payload=request();let calls=0;
  const result=await createFlashArtAgent().run({payload,flash:{identity:{id:'fixture'},inferConversation:async input=>{
    calls++;assert(input.messages[0].content.startsWith(FLASH_CREATION_AGENT_SYSTEM));assert.match(input.messages[0].content,/OUTPUT LANGUAGE FOR THIS REQUEST/);
    return propose(input,'zh-native-response');
  }}});
  assert.equal(calls,1);assert.equal(result.proposal.prompt,prompt);assert.equal(result.proposal.negativePrompt,payload.artContext.negativePrompt);assert.deepEqual(result.proposal.sourceOrder,[1]);
  assert.throws(()=>createFlashArtAgent().preflight({...payload,promptLanguage:'invalid'}),/语言/);
});

test('English creation and online chat keep Chinese explanations',async()=>{
  const online=companionInput({requestId:'chinese-prompt-fixture',promptLanguage:'en',mode:'chat',message:'只给我提示词，说明用中文',history:[],images:[]});assert.match(online.input[0].content[0].text,/Converse and explain your choices in Simplified Chinese/);
  await createFlashArtAgent().run({payload:request({promptLanguage:'en'}),flash:{identity:{id:'fixture'},inferConversation:async input=>{
    assert.match(input.messages[0].content,/Converse and explain your choices in Simplified Chinese/);assert.match(input.messages[0].content,/prompt itself in English by default/);
    return {model:'fixture',requestId:'creation-language-response',finishReason:'stop',message:{role:'assistant',content:'会用英文整理绘图提示词，说明继续用中文。'}};
  }}});
});

test('manual prompt input preserves Chinese and clears a stale staged Agent action without changing sampling',()=>{
  const source=readFileSync(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8'),a=source.indexOf('  function renderArtGeneratePromptBox('),z=source.indexOf('  function readMountedArtGeneratePromptValue(',a);
  const state={prompt:'旧提示词',negativePrompt:'原负向',samplingOverrides:{'qwen-2.1-turbo:img2img':{cfg:3,steps:8}}};let clears=0;
  const context={ART_GENERATE_STATE:state,window:{__NovaFlowArtGenerate:{clearAgentPrepared:()=>clears++}},createArtEl:(tag,attrs,children=[])=>({tag,attrs,children}),focusArtGeneratePromptTextarea(){},syncArtGenerateSamplingFields(){},addArtGeneratePromptHistoryValue(){},mountArtGenerateResourceMentionTextarea(){},renderArtGeneratePromptHistory:()=>({})};
  vm.runInNewContext(source.slice(a,z),context);
  const textarea=context.renderArtGeneratePromptBox('prompt','提示词','').children[1];
  textarea.attrs.oninput({currentTarget:{value:'保留暖色肤色，背景稍暗，招牌写 OPEN。'}});
  assert.equal(state.prompt,'保留暖色肤色，背景稍暗，招牌写 OPEN。');assert.equal(clears,1);assert.equal(state.negativePrompt,'原负向');assert.equal(state.samplingOverrides['qwen-2.1-turbo:img2img'].cfg,3);
});
