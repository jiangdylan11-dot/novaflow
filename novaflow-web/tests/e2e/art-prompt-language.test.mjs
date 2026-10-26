import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {artPromptLanguageSystem,artPromptLanguageTools} from '../../packages/shared/src/art-prompt-language.mjs';
import {companionInput} from '../../packages/shared/src/companion-chat.mjs';
import {createFlashArtAgent,computeArtAgentFingerprint,FLASH_ART_AGENT_SYSTEM,FLASH_ART_AGENT_SYSTEM_SHA256,FLASH_ART_AGENT_TOOLS} from '../../worker/src/flash-art-agent.mjs';
import {planFlashArtDirection,FLASH_ART_SYSTEM} from '../../worker/src/flash-art-direction.mjs';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const prompt='以<image1>为内容原图、<image2>为画法参考，保留人物眨眼、闭嘴微笑、服装和杯子，用参考的线条与明暗重新绘制。招牌上的字保持“OPEN”。';
const sourceContent='一位女子眨眼、闭嘴微笑，手持杯子坐在候机区。';
const sha=s=>createHash('sha256').update(s).digest('hex');
function request(extra={}){const p={requestId:'chinese-prompt-fixture',mode:'drawing',promptLanguage:'zh-CN',message:'只给中文提示词，不生图',history:[],artContext:{provider:'local',engine:'qwen-2.1',mode:'img2img',nsfw:false,prompt:'原需求',negativePrompt:'  literal negative\n',cfg:3,steps:8,seed:54792256,referenceRoles:['subject','style']},images:[{role:'subject',dataUrl:PNG},{role:'style',dataUrl:PNG}],...extra};p.contextFingerprint=computeArtAgentFingerprint(p);return p;}

test('an explicit Chinese preference changes only a per-request language suffix and cloned field descriptions',()=>{
  assert.equal(artPromptLanguageSystem(FLASH_ART_AGENT_SYSTEM,undefined),FLASH_ART_AGENT_SYSTEM);
  assert.equal(artPromptLanguageSystem(FLASH_ART_AGENT_SYSTEM,'en'),FLASH_ART_AGENT_SYSTEM);
  assert.strictEqual(artPromptLanguageTools(FLASH_ART_AGENT_TOOLS,undefined),FLASH_ART_AGENT_TOOLS);
  assert(artPromptLanguageSystem(FLASH_ART_AGENT_SYSTEM,'zh-CN').startsWith(FLASH_ART_AGENT_SYSTEM+'\n\n'));
  const localized=artPromptLanguageTools(FLASH_ART_AGENT_TOOLS,'zh-CN');
  assert.match(localized[1].function.parameters.properties.prompt.description,/Simplified Chinese/);
  assert.match(FLASH_ART_AGENT_TOOLS[1].function.parameters.properties.sourceContent.description,/English/);
  assert.equal(sha(FLASH_ART_AGENT_SYSTEM),FLASH_ART_AGENT_SYSTEM_SHA256);
});

test('English drawing restores the exact existing director/tool contract, while chat and creation keep Chinese explanations',async()=>{
  const payload=request({promptLanguage:'en',message:'只给我提示词，说明用中文'});let observed;
  const result=await createFlashArtAgent().run({payload,flash:{identity:{id:'fixture'},inferConversation:async input=>{
    observed=input;return {model:'fixture',requestId:'english-default-response',finishReason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'english-tool',type:'function',function:{name:'propose_art_direction',arguments:JSON.stringify({contextFingerprint:payload.contextFingerprint,prompt:'Redraw <image1> using the painting language of <image2>.',sourceContent:'A woman holds a cup.',renderingClass:'anime',explanation:'保留人物与道具，按参考重绘。'})}}]}};
  }}});
  assert.equal(observed.messages[0].content,FLASH_ART_AGENT_SYSTEM);assert.deepEqual(observed.tools,FLASH_ART_AGENT_TOOLS);assert.equal(result.proposal.styleProtocol.systemSHA256,FLASH_ART_AGENT_SYSTEM_SHA256);assert.match(result.reply,/按参考重绘/);
  const online=companionInput({...request({promptLanguage:'en'}),mode:'chat'});assert.match(online.input[0].content[0].text,/Converse and explain your choices in Simplified Chinese/);assert.match(online.input[0].content[0].text,/prompt itself in English by default/);
  const creation=request({requestId:'english-creation-default',mode:'creation',promptLanguage:'en',images:[],artContext:{task:'creation',provider:'local',engine:'qwen-2.1',mode:'txt2img',nsfw:false,prompt:'花园插画',negativePrompt:'',cfg:3,steps:8}});
  await createFlashArtAgent().run({payload:creation,flash:{identity:{id:'fixture'},inferConversation:async input=>{
    assert.match(input.messages[0].content,/Converse and explain your choices in Simplified Chinese/);assert.match(input.messages[0].content,/prompt itself in English by default/);
    return {model:'fixture',requestId:'creation-language-response',finishReason:'stop',message:{role:'assistant',content:'会用英文整理绘图提示词，说明继续用中文。'}};
  }}});
});

test('one native Chinese proposal keeps exact Unicode, lettering, slots, negative and CFG without translation calls',async()=>{
  const payload=request();let calls=0;
  const result=await createFlashArtAgent().run({payload,flash:{identity:{id:'fixture'},inferConversation:async input=>{
    calls++;assert(input.messages[0].content.startsWith(FLASH_ART_AGENT_SYSTEM));assert.match(input.messages[0].content,/OUTPUT LANGUAGE FOR THIS REQUEST/);
    assert.match(input.tools[1].function.parameters.properties.sourceContent.description,/Simplified Chinese/);
    return {model:'fixture',requestId:'zh-native-response',finishReason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'zh-native-tool',type:'function',function:{name:'propose_art_direction',arguments:JSON.stringify({contextFingerprint:payload.contextFingerprint,prompt,sourceContent,renderingClass:'anime',explanation:'保留内容，按参考绘画。'})}}]}};
  }}});
  assert.equal(calls,1);assert.equal(result.proposal.prompt,prompt);assert.equal(result.proposal.negativePrompt,payload.artContext.negativePrompt);assert.equal(result.proposal.cfg,3);assert.deepEqual(result.proposal.sourceOrder,[1,2]);assert.equal(result.proposal.sourceContent,sourceContent);
  assert.equal(result.proposal.styleProtocol.systemSHA256,sha(artPromptLanguageSystem(FLASH_ART_AGENT_SYSTEM,'zh-CN')));
  assert.throws(()=>createFlashArtAgent().preflight(request({promptLanguage:'invalid'})),/语言/);
});

test('whole-image direct analysis and online conversation receive the same explicit locale with their original roles and authority',async()=>{
  let calls=0,observed;
  const payload={...request(),surface:'art',purpose:'art-director',visualSchema:'nf.art.direction.v1',artContext:{task:'style',references:[{source:1,roles:['subject']},{source:2,roles:['style']}]}};
  const result=await planFlashArtDirection({payload,flash:{identity:{id:'fixture'},infer:async input=>{calls++;observed=input;return {model:'fixture',requestId:'zh-direct-response',text:JSON.stringify({prompt,sourceContent,renderingClass:'anime'})};}}});
  assert.equal(calls,1);assert(observed.system.startsWith(FLASH_ART_SYSTEM));assert.equal(result.artDirection.prompt,prompt);assert.equal(result.nativeAnalysis.systemSHA256,sha(observed.system));assert.deepEqual(observed.images.map(i=>i.dataUrl),[PNG,PNG]);
  const online=companionInput({...request(),mode:'chat'});assert.match(online.input[0].content[0].text,/Simplified Chinese by default/);assert.equal(online.imageCount,2);assert(!JSON.stringify(online).includes('generate_art_image'));
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
