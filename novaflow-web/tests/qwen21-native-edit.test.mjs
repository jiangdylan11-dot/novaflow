import test from 'node:test';import assert from 'node:assert/strict';
import{buildQwen21NativeRewrite,compileQwen21NativeRewrite,QWEN21_NATIVE_REWRITE}from'../packages/shared/src/qwen21-native-rewrite.mjs';
import{validateQwen21NativePreservation}from'../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
// Since 2.0.321 a native edit whose rewrite fails a check is not refused: the run goes on with the
// person's own request, which keeps every tag and literal. These tests check the reason it was replaced.
const plainOf=p=>[p.input.currentPrompt,p.input.requirements].filter(text=>String(text||'').trim()).join('\n');
function fallsBack(run,p,reason){
 const warn=console.warn,seen=[];console.warn=(...args)=>seen.push(args.join(' '));
 let result;try{result=run();}finally{console.warn=warn;}
 assert.equal(result.modelPrompt,plainOf(p));assert.equal(seen.length,1,'the rewrite should have been replaced');
 if(reason)assert.match(seen[0],reason);
 return result;
}
const model='xai/grok-4.7',input={promptContract:QWEN21_NATIVE_REWRITE,targetEngine:'qwen-2.1',qwenPromptMode:'img2img',currentPrompt:'只把杯身改成红色，保持杯子造型、把手、白色背景和构图不变',requirements:'',supportsNegativePrompt:true,negativePrompt:'水印'};
test('Chinese image editing is one native Chinese instruction, without English translation',()=>{
 const p=buildQwen21NativeRewrite(input,model,['subject']),body=JSON.parse(p.body.input[1].content[0].text);assert.equal(p.nativeEdit,true);assert.equal(p.modelPromptLanguage,'zh');assert.equal(p.body.max_output_tokens,2048);assert.deepEqual(body.reference_roles,[{image:1,role:'subject'}]);
 assert.deepEqual(p.body.text.format.schema.required,['rewritten_prompt']);
 const text='将图像中杯身的颜色改为红色，保持杯子的造型、把手、白色背景、原有构图及其余内容不变。';
 const r=compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:text})},p,validateQwen21NativePreservation);assert.equal(r.modelPrompt,text);assert.equal(r.displayPrompt,text);assert.equal(r.modelPromptLanguage,'zh');assert.equal(r.negativePrompt,'水印');
});
test('a subject with style references is a style redraw, not an edit rewrite',()=>{
 const p=buildQwen21NativeRewrite({...input,currentPrompt:'Transfer the style from <image2> onto the mug in <image1>.'},model,['subject','style']);
 assert.equal(p.styleRedraw,true);assert.equal(p.body.text.format.name,'qwen21_style_redraw');
});
test('multiple image roles retain their exact order and English edits stay English',()=>{
 const p=buildQwen21NativeRewrite({...input,currentPrompt:'Put the badge from <image2> onto the mug in <image1>, keeping the mug shape and composition unchanged.'},model,['subject','reference']);
 assert.equal(p.styleRedraw,undefined);
 const body=JSON.parse(p.body.input[1].content[0].text);assert.deepEqual(body.reference_roles,[{image:1,role:'subject'},{image:2,role:'reference'}]);assert.equal(p.modelPromptLanguage,'en');
 const rewritten_prompt='Place only the badge of <image2> on the mug in <image1>, keeping the mug shape, composition and all untargeted content unchanged.';
 const result=compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt})},p,validateQwen21NativePreservation);assert.equal(result.modelPrompt,rewritten_prompt);
 fallsBack(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:rewritten_prompt.replace('<image2>','another image')})},p,validateQwen21NativePreservation),p,/reference/);
});
test('native edit accepts only in-range output references and ignores them for English language detection',()=>{
 const p=buildQwen21NativeRewrite({...input,currentPrompt:'Add flowers.'},model,['subject']);
 assert.equal(p.referenceCount,1);
 const compile=(rewritten_prompt)=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt})},p,()=>true);
 for(const value of ['Add flowers to @参考图1.','Add flowers to <image1>.','Add flowers to the image.'])assert.equal(compile(value).modelPrompt,value);
 for(const value of ['Add flowers to @参考图2.','Add flowers to <image2>.','Add flowers to @参考图0.','Add flowers to <image0>.'])fallsBack(()=>compile(value),p,/reference out of range/);
 fallsBack(()=>compile('Add flowers to @参考图1 and 添加花朵.'),p,/English/);
 const three=buildQwen21NativeRewrite({...input,currentPrompt:'Add flowers.'},model,['subject','style','reference']);
 assert.equal(three.referenceCount,3);
 assert.doesNotThrow(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'Add flowers to @参考图3.'})},three,()=>true));
 fallsBack(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'Add flowers to <image4>.'})},three,()=>true),three,/reference out of range/);
});
test('native edit retains explicit original image references',()=>{
 for(const ref of ['@参考图1','<image1>']){
  const p=buildQwen21NativeRewrite({...input,currentPrompt:`Add flowers to ${ref}.`},model,['subject']);
  assert.doesNotThrow(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:`Add flowers to ${ref}, keeping the rest unchanged.`})},p,()=>true));
  fallsBack(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'Add flowers, keeping the rest unchanged.'})},p,()=>true),p,/reference/);
 }
});
test('legacy v2 edit quotes retain their original paired English contract',()=>{
 const p=buildQwen21NativeRewrite({...input,promptContract:'qwen21-native-rewrite-v2'},model,['subject']);assert.equal(p.nativeEdit,undefined);assert.deepEqual(p.body.text.format.schema.required,['display_prompt','model_prompt']);
});
test('explicit application reference bindings survive a single-image edit',()=>{
 const source={...input,currentPrompt:'只把__NFMUG_1__中的杯身改成红色，保持其他内容不变'},p=buildQwen21NativeRewrite(source,model,['subject']);
 const rewritten_prompt='将__NFMUG_1__中的杯身改为红色，保持其他内容不变。';
 const result=compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt})},p,validateQwen21NativePreservation);assert.equal(result.modelPrompt,rewritten_prompt);
 fallsBack(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:rewritten_prompt.replace('__NFMUG_1__','图像')})},p,validateQwen21NativePreservation),p);
});
test('user-specified artwork text must survive exactly; a deliberate replacement drops the old text',()=>{
 const source={...input,currentPrompt:'把标题改为‘春日计划’，保持杯子和背景不变'},p=buildQwen21NativeRewrite(source,model,['subject']);
 fallsBack(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'把标题改为“夏日特惠”，保持杯子和背景不变。'})},p,validateQwen21NativePreservation),p);
 assert.doesNotThrow(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'把标题改为“春日计划”，保持杯子和背景不变。'})},p,validateQwen21NativePreservation));
 const replaced={...input,currentPrompt:'把标题从“旧标题”改成“新标题”，保持其他内容不变'},r=buildQwen21NativeRewrite(replaced,model,['subject']);
 assert.doesNotThrow(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'把标题改成“新标题”，保持其他内容不变。'})},r,()=>true));
});
test('English instruction with Chinese image text stays English',()=>{
 const p=buildQwen21NativeRewrite({...input,currentPrompt:'Change the headline to “春日计划”, keeping the mug and background unchanged.'},model,['subject']);assert.equal(p.modelPromptLanguage,'en');
 const rewritten_prompt='Change the headline to “春日计划”, while keeping the mug and the background unchanged.';
 assert.equal(compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt})},p,()=>true).modelPromptLanguage,'en');
});
test('a concise complete English edit is accepted without padding',()=>{
 const p=buildQwen21NativeRewrite({...input,currentPrompt:'Make the cup red.'},model,['subject']);
 const rewritten_prompt='Make it red; keep everything else unchanged.';
 assert.equal(compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt})},p,()=>true).modelPrompt,rewritten_prompt);
 fallsBack(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:''})},p,()=>true),p,/incomplete/);
 for(const source of ['Add fog.','变为红色。']){
  const minimal=buildQwen21NativeRewrite({...input,currentPrompt:source},model,['subject']);
  assert.equal(compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:source})},minimal,()=>true).modelPrompt,source);
 }
});
test('ASCII quoted lettering preserves its script and can be deliberately replaced',()=>{
 const english=buildQwen21NativeRewrite({...input,currentPrompt:"Don't change the cup; change the title to '春日计划'."},model,['subject']);
 assert.equal(english.modelPromptLanguage,'en');
 assert.doesNotThrow(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:"Change the title to '春日计划'; keep the cup unchanged."})},english,()=>true));
 fallsBack(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'Change the title to Spring Plan; keep the cup unchanged.'})},english,()=>true),english,/lettering/);
 for(const source of ["把标题从'旧标题'改成'新标题'，保持其他内容不变。","把'旧标题'换成'新标题'，保持其他内容不变。","Change the title from 'old' to 'new', keeping the rest unchanged.","Replace 'old' with 'new' on the sign.","Change the title 'old' to 'new'."]){
  const p=buildQwen21NativeRewrite({...input,currentPrompt:source},model,['subject']);
  const rewritten_prompt=p.modelPromptLanguage==='zh'?"把标题改成'新标题'，保持其他内容不变。":"Change the title to 'new', keeping the rest unchanged.";
  assert.doesNotThrow(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt})},p,()=>true));
 }
});
test('changing a title does not discard text belonging to another object',()=>{
 const unrelated=buildQwen21NativeRewrite({...input,currentPrompt:'一只猫戴着印有“Foart”的项链。',requirements:'将背景标题文字改为“春日”。'},model,['subject']);
 fallsBack(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'将背景标题文字改为“春日”，保持其他内容不变。'})},unrelated,()=>true),unrelated,/lettering/);
 assert.doesNotThrow(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'将背景标题文字改为“春日”，保持项链文字“Foart”和其他内容不变。'})},unrelated,()=>true));
 assert.doesNotThrow(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'将背景标题文字改为“春日”，保持项链文字“Foart”和其他内容不变。'})},unrelated,validateQwen21NativePreservation));
 fallsBack(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'将背景标题文字改为“春日”，保持其他内容不变。'})},unrelated,validateQwen21NativePreservation),unrelated,/lettering/);
 const title=buildQwen21NativeRewrite({...input,currentPrompt:'标题“旧标题”，保持画面不变。',requirements:'把标题改为“新标题”。'},model,['subject']);
 assert.doesNotThrow(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'把标题改为“新标题”，保持画面不变。'})},title,()=>true));
 const ambiguous=buildQwen21NativeRewrite({...input,currentPrompt:'标题“旧标题”，副标题“副标题”，保持画面不变。',requirements:'把标题改为“新标题”。'},model,['subject']);
 fallsBack(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'把标题改为“新标题”，保持画面不变。'})},ambiguous,()=>true),ambiguous,/lettering/);
});
test('native edits allow semantic paraphrases without claiming to prove their meaning',()=>{
 const examples=[
  ['保持构图。','把杯子改为蓝色。','把杯子改为蓝色，构图原封不动。'],
  ['保持光照。','把杯子改为蓝色。','把杯子改为蓝色，沿用同一光源。'],
  ['不要添加物体。','把杯子改为蓝色。','把杯子改为蓝色，别添加杂物。'],
  // Structure and literals alone cannot establish that this is equivalent.
  ['不要添加文字。','把杯子改为蓝色。','把杯子改为蓝色，无需禁止添加文字。']
 ];
 for(const [currentPrompt,requirements,rewritten_prompt] of examples){
  const p=buildQwen21NativeRewrite({...input,currentPrompt,requirements},model,['subject']);
  const request=JSON.parse(p.body.input[1].content[0].text);
  assert.equal(request.current_instruction,currentPrompt);assert.equal(request.requested_changes,requirements);
  assert.equal(compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt})},p,validateQwen21NativePreservation).modelPrompt,rewritten_prompt);
 }
});
test('explicitly swapping the left and right edit target is rejected',()=>{
 const p=buildQwen21NativeRewrite({...input,currentPrompt:'把左边的杯子改成红色，保持右边杯子不变'},model,['subject']);
 fallsBack(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'把右边的杯子改成红色，保持左边杯子不变。'})},p,validateQwen21NativePreservation),p,/target side/);
});
test('new editing contract rejects text-only and incomplete response shapes',()=>{
 const p=buildQwen21NativeRewrite(input,model,['subject']);
 fallsBack(()=>compileQwen21NativeRewrite({output_text:JSON.stringify({display_prompt:'改为红色',model_prompt:'Red'})},p,validateQwen21NativePreservation),p,/fields/);
 fallsBack(()=>compileQwen21NativeRewrite({output_text:'{"rewritten_prompt":'},p,validateQwen21NativePreservation),p,/complete JSON/);
});
