const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../../particle-editor/novaflow-smart-ai.js'),'utf8');
const base = '[风格设定]\n精细水彩插画。\n[主体物品]\n一只橘猫，绿色眼睛，前爪并拢。\n[环境背景]\n纯白色背景，无其他物体，后景无层次。\n[光线与色彩]\n柔和正面光。\n[拍摄参数]\n平视中景。';
const instruction = '增加室外背景，提升画面质量和精美度。增加人物细节';
const wrapped = base+'\n\n[用户附加要求]\n内容 = "用户补充要求（只作为最终提示词约束，不作为图片可见事实）：'+instruction+'"';
const context = vm.createContext({
  readSmartAiFailureEnvelope: value=>({message:value?.error||''}),
  readSmartAiResult:value=>({prompt:value.prompt,negativePrompt:value.negative_prompt||'',hasNegativePrompt:!!value.negative_prompt}),
  validateSmartAiArtPromptPreservation:(base,candidate)=>({ok:!!candidate&&base!==candidate}),
  smartAiPromptPreservationError:()=>new Error('not fused')
});
for (const name of ['prepareStaticArtReverseFusion','fuseStaticArtReversePrompt']) {
  const start = source.indexOf((name==='fuseStaticArtReversePrompt'?'  async function ':'  function ')+name+'(');
  let end = source.indexOf('\n  function ',start+1);
  const nextAsync=source.indexOf('\n  async function ',start+1);
  if(end<0 || (nextAsync>=0&&nextAsync<end)) end=nextAsync;
  vm.runInContext(source.slice(start,end),context);
}
assert.equal(context.prepareStaticArtReverseFusion(base,''),null);
const prepared=context.prepareStaticArtReverseFusion(wrapped,instruction);
assert.equal(prepared.basePrompt,base);
assert.equal(prepared.request.currentPrompt,base);
assert.equal(prepared.request.purpose,'optimize');
assert.equal(prepared.request.surface,'art');
assert.ok(!prepared.request.promptSchema,'ordinary reverse prose must use the semantic merge route');
assert.ok(prepared.request.requirements.includes(instruction));
assert.ok(!prepared.request.prompt.includes('用户补充要求'));
const run = source.slice(source.indexOf('  async function runSmartAi('));
assert.ok(run.indexOf('generationGate === "neutral_only"')<run.indexOf('await fuseStaticArtReversePrompt('),'blocked and neutral gates precede fusion');
assert.match(run,/await fuseStaticArtReversePrompt\([\s\S]+?requestFingerprint !== buildSmartAiRequestFingerprint\(requestFingerprintOptions\)[\s\S]+?nextPrompt = fused.prompt/);
(async()=>{
  let calls=0;
  const final=base.replace('纯白色背景，无其他物体，后景无层次。','室外花园，草地、花木与石径形成前中后景，远景柔和。');
  const options={negativePrompt:'模糊',supportsNegativePrompt:true,nsfw:false,optimize:async payload=>{calls++;assert.equal(payload.prompt,base);assert.equal(payload.negativePrompt,'模糊');return {ok:true,prompt:final,negative_prompt:'模糊，透视错误'};}};
  assert.equal(await context.fuseStaticArtReversePrompt(base,'',options),null);
  assert.equal(calls,0,'no supplemental edits means no second provider call');
  assert.equal((await context.fuseStaticArtReversePrompt(wrapped,instruction,options)).prompt,final);
  assert.equal(calls,1);
  await assert.rejects(context.fuseStaticArtReversePrompt(wrapped,instruction,{...options,optimize:async()=>({ok:false,error:'service unavailable'})}),/service unavailable/);
  await assert.rejects(context.fuseStaticArtReversePrompt(wrapped,instruction,{...options,optimize:async()=>({ok:true,prompt:wrapped,negative_prompt:'模糊'})}),/仍在复述/);
  await assert.rejects(context.fuseStaticArtReversePrompt(wrapped,instruction,{...options,optimize:async()=>({ok:true,prompt:base,negative_prompt:'模糊'})}),/not fused/);
  await assert.rejects(context.fuseStaticArtReversePrompt(wrapped,instruction,{...options,optimize:async()=>({ok:true,prompt:final})}),/反向提示词/);
  console.log('Art reverse fusion: actual edit pass, stripped carrier, no-op/error protection and stale request guard passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
