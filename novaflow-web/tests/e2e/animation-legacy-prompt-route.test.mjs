import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizeOptimizeRequest, normalizeReverseRequest } from '../../worker/src/prompt-assistant.mjs';

// Execute the real legacy video callbacks, without mounting the full renderer
// or contacting a model. The shared modern H3 assistant is outside this change.
const source=readFileSync(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');
const from=source.indexOf('  async function runAiAnimationPromptOptimize(promptFrames) {');
const to=source.indexOf('  function armAiAnimationPromptHistoryGuardFromEvent(',from);
assert.ok(from>0&&to>from);
function harness({images=[],api={}}={}) {
  const positive={value:'保持 __NOVAFLOW_VIDEO_REF_1__，镜头缓缓推进'},negative={value:'闪烁'};
  const writes=[],errors=[];
  const root={AI_ANIMATION_PROMPT_ASSISTANT_RUNNING:'',AI_ANIMATION_PROMPT_ASSISTANT_TOKEN:0,AI_ANIMATION_PROMPT_ASSISTANT_TIMEOUT_MS:900000,
    getPromptAssistantApi:()=>api,getAiAnimationPromptTextarea:(_frames,kind)=>kind==='positive'?positive:negative,
    protectAiAnimationResourceMentions:text=>({text,tokens:[]}),restoreAiAnimationResourceMentions:text=>({ok:true,text}),
    armAiAnimationPromptAssistantGuard(){},ensureAiAnimationPromptAssistantButtons(){},clearAiAnimationPromptAssistantMessage(){},
    showAiAnimationPromptAssistantMessage:(_frames,error)=>errors.push(error),
    withAiAnimationPromptAssistantTimeout:job=>job(),isAiAnimationPromptTextControl:control=>control===positive||control===negative,
    setPromptAssistantTextareaValue:(control,value)=>{writes.push({control,value});control.value=value;},
    mergePromptAssistantNegativePrompt:(old,next)=>old+', '+next,
    collectAiAnimationPromptAssistantImages:async()=>images};
  vm.createContext(root);vm.runInContext(source.slice(from,to),root);
  return {root,positive,negative,writes,errors};
}

test('legacy video optimization explicitly routes as animation and keeps prompt/resource tokens',async()=>{
  const calls=[],h=harness({api:{promptAssistantOptimizePrompt:async payload=>{calls.push(payload);return {ok:true,data:{positivePrompt:'优化 __NOVAFLOW_VIDEO_REF_1__ 镜头推进',negativePrompt:'抖动'}};}}});
  await h.root.runAiAnimationPromptOptimize([]);
  assert.equal(calls.length,1);assert.equal(calls[0].surface,'animation');assert.equal(calls[0].purpose,'animation-prompt-optimize');
  assert.equal(calls[0].prompt,'保持 __NOVAFLOW_VIDEO_REF_1__，镜头缓缓推进');assert.equal(calls[0].negativePrompt,'闪烁');
  const normalized=normalizeOptimizeRequest(calls[0]).request;
  assert.equal(normalized.surface,'animation');assert.equal(normalized.purpose,'animation-prompt-optimize');assert.equal(normalized.promptSchema,undefined);
  assert.equal(h.positive.value,'优化 __NOVAFLOW_VIDEO_REF_1__ 镜头推进');assert.equal(h.negative.value,'闪烁, 抖动');
  assert.equal(h.root.AI_ANIMATION_PROMPT_ASSISTANT_RUNNING,'');assert.deepEqual(h.errors,[]);
});

test('legacy frame reverse preserves ordered first/last images and reaches normalization with animation scope',async()=>{
  const images=[{slotType:'first_frame',role:'first_frame',name:'start.png',dataUrl:'data:image/png;base64,YQ=='},{slotType:'last_frame',role:'last_frame',name:'end.png',dataUrl:'data:image/png;base64,Yg=='}];
  const calls=[],h=harness({images,api:{promptAssistantReverseImagePrompt:async payload=>{calls.push(payload);return {ok:true,data:{prompt:'角色由首帧姿态过渡到尾帧，连续自然。'}};}}});
  const before=h.positive.value;await h.root.runAiAnimationReversePrompt([]);
  assert.equal(calls.length,1);assert.equal(calls[0].surface,'animation');assert.equal(calls[0].purpose,'animation-frame-reverse');
  assert.equal(calls[0].images,images,'image order/bytes are not reconstructed');
  const normalized=normalizeReverseRequest(calls[0]).request;
  assert.equal(normalized.surface,'animation');assert.equal(normalized.purpose,'animation-frame-reverse');
  assert.deepEqual(normalized.images.map(x=>[x.role,x.dataUrl]),images.map(x=>[x.role,x.dataUrl]));
  assert.equal(h.positive.value,before+'\n角色由首帧姿态过渡到尾帧，连续自然。');assert.deepEqual(h.errors,[]);
});

test('legacy video callbacks keep duplicate, empty and late-result guards',async()=>{
  let count=0;const h=harness({api:{promptAssistantOptimizePrompt:async()=>{count++;h.root.AI_ANIMATION_PROMPT_ASSISTANT_TOKEN++;return {ok:true,data:{positivePrompt:'stale'}};}}});
  h.root.AI_ANIMATION_PROMPT_ASSISTANT_RUNNING='other';await h.root.runAiAnimationPromptOptimize([]);assert.equal(count,0);
  h.root.AI_ANIMATION_PROMPT_ASSISTANT_RUNNING='';const before=h.positive.value;
  await h.root.runAiAnimationPromptOptimize([]);assert.equal(count,1);assert.equal(h.positive.value,before);assert.equal(h.writes.length,0);
  const empty=harness({api:{promptAssistantReverseImagePrompt:async()=>{throw Error('must not call');}}});
  await empty.root.runAiAnimationReversePrompt([]);assert.equal(empty.errors.length,1);assert.equal(empty.writes.length,0);
});

test('drawing callbacks retain their existing art purpose/surface and static reverse contract',()=>{
  const optimize=source.slice(source.indexOf('  async function runArtGeneratePromptOptimize() {'),source.indexOf('  async function runArtGeneratePromptOptimize() {')+6000);
  assert.match(optimize,/purpose: "art-quality-optimize",\s*surface: "art"/);assert.doesNotMatch(optimize,/purpose: "animation-/);
  const reverse=source.slice(source.indexOf('  async function runArtGenerateReverseImagePrompt(sources) {'),source.indexOf('  async function runArtGenerateReverseImagePrompt(sources) {')+5500);
  assert.match(reverse,/purpose: "static-image-reverse"/);assert.match(reverse,/visualSchema: "nf\.visual\.v2"/);assert.doesNotMatch(reverse,/surface: "animation"/);
});
