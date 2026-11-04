import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';

const source=await readFile(new URL('../renderer/novaflow-smart-ai.js',import.meta.url),'utf8');
const begin=source.indexOf('  function verifiedAgentPromptHandoff('),end=source.indexOf('  // H3 prompts kept in the prompt history',begin);
assert.ok(begin>0&&end>begin);
function setup({v3=true}={}){
 let request;const reply={ok:true,data:{analysisBackend:'qwen-cpu',resourcesReleased:true,generationReady:true,
   modelIdentity:{id:'qwen35-heretic',verification:'server-weight-path'},modelPromptPolicy:'qwen21-native-rewrite-v3',
   promptContract:'qwen21-native-rewrite-v3',translationValidation:'paired-prose-and-literals',
   positivePrompt:'森林中一座木屋，暖色灯光从窗户透出，水彩画面层次自然。',displayPrompt:'森林中一座木屋，暖色灯光从窗户透出，水彩画面层次自然。',
   modelPrompt:'A watercolor cabin in a forest, with warm light glowing through the windows.',modelPromptLanguage:'en',negativePrompt:'水印'}};
 const sandbox={window:{crypto:{randomUUID:()=> 'synthetic-request'},NovaFlowXiaotaoArtAgent:{panel:{controller:{businessModelSnapshot:()=>({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:1})}}},electronAPI:{qwenBusinessAvailableSync:()=>true,...(v3?{qwen21NativeRewriteV3AvailableSync:()=>true}:{}),promptAssistantOptimizePrompt:async payload=>{request=payload;return reply;}}},
   shouldUseStructuredArtPromptContract:()=>false,protectSmartAiResourceMentions:text=>({text}),buildSmartAiRequirements:()=>{if(v3)throw Error('old wrapper must not be used');return 'legacy requirements';},artHighQualityCgNegativeGuardInstruction:()=>'',mergeSmartAiNegativePrompt:value=>value,
   readSmartAiResult:r=>({prompt:r.data.positivePrompt,negativePrompt:r.data.negativePrompt,hasNegativePrompt:true}),restoreSmartAiResourceMentions:text=>({ok:true,text}),validateSmartAiArtPromptPreservation:()=>({ok:true})};
 createContext(sandbox);runInContext(source.slice(begin,end)+'\nglobalThis.run=optimizeForAgent;',sandbox);
 const options={assistantSelectionScope:'xiaotao',surface:'art',generationMode:'txt2img',prompt:'森林木屋，暖色灯光',requirements:'保持水彩风格',negativePrompt:'水印',supportsNegativePrompt:true};
 return {run:()=>sandbox.run(options),reply,get request(){return request;}};
}
test('local text optimization sends v3 once and returns paired prose without changing the negative prompt',async()=>{
 const f=setup(),result=await f.run();assert.equal(f.request.promptContract,'qwen21-native-rewrite-v3');assert.equal(f.request.requirements,'保持水彩风格');assert.equal(f.request.promptSchema,undefined);
 assert.equal(result.displayPrompt,f.reply.data.displayPrompt);assert.equal(result.prompt,f.reply.data.modelPrompt);assert.equal(result.negativePrompt,'水印');assert.equal(result.optimization.framework,'qwen21-native-rewrite');assert.equal(result.analysisBackend,'qwen-cpu');
});
test('old node, altered negative prompt, mismatched display and unreleased or incorrect identity are rejected',async()=>{
 for(const change of ['old','negative','display','released','identity']){const f=setup();
  if(change==='old'){f.reply.data.modelPromptPolicy='qwen21-task-policy-v1';delete f.reply.data.promptContract;}
  if(change==='negative')f.reply.data.negativePrompt='other';if(change==='display')f.reply.data.displayPrompt='different';
  if(change==='released')f.reply.data.resourcesReleased=false;if(change==='identity')f.reply.data.modelIdentity.id='wrong';
  await assert.rejects(f.run(),undefined,change);
 }
});
test('without verified v3 capability, existing v1 nodes retain their old path and receive no v3 contract',async()=>{
 const f=setup({v3:false});f.reply.data.modelPromptPolicy='qwen21-task-policy-v1';delete f.reply.data.promptContract;delete f.reply.data.translationValidation;
 const result=await f.run();assert.equal(f.request.promptContract,undefined);assert.equal(f.request.requirements,'legacy requirements');assert.equal(result.optimization.modelPromptPolicy,'qwen21-task-policy-v1');
});
