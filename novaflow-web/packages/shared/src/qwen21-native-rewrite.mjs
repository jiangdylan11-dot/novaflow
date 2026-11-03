// Qwen Image 2.1 native prose, paired in one model call. This is an explicit
// opt-in contract; the older structured/double-stage requests remain valid.
export const QWEN21_NATIVE_REWRITE='qwen21-native-rewrite-v2';
const fail=message=>{throw Object.assign(new Error(message),{code:'qwen21-rewrite-invalid'});};
const SYSTEM=`Rewrite an image prompt for Qwen Image 2.1. Return matching Chinese display_prompt and English model_prompt in one JSON object. Both describe exactly the same final image or edit; the two fields are editor/model copies, never bilingual lettering inside the image.
For text-to-image, write fluent observer prose: medium/style and main subject first, spatial composition and background next, then visible materials, lighting and overall palette. A normal scene needs roughly 250-450 English words; use less for a deliberately simple image and more only when explicit content requires it. No section labels, field inventories, checklists, analysis, vague quality boosters or repeated summary. Preserve intentional simplicity and empty space; do not invent extra subjects, readable text, logos or narrative props.
For image editing, lead with the requested operation. Describe only the targeted changes; use one concise clause to preserve the remaining content, identity, layout and medium. Do not repaint unchanged details or infer unseen features. Keep input reference tokens and their assigned roles. User-given readable text stays verbatim in its original script, including punctuation; translate descriptive prose only. Preserve the user's explicit subjects, counts, colors, positions and constraints. Apply requested changes to the final state instead of retaining conflicting old attributes.
Canvas dimensions, aspect ratio, sampling and negative prompt are owned by the application: do not change them or insert them as picture content. Return only the two complete strings; do not generate an image.`;
export function buildQwen21NativeRewrite(input,model){
  return {kind:'qwen21-native',input:{...input},body:{model,store:false,temperature:0,max_output_tokens:4096,
    input:[{role:'system',content:[{type:'input_text',text:SYSTEM}]},{role:'user',content:[{type:'input_text',text:JSON.stringify({task:input.qwenPromptMode==='img2img'?'image-editing':'text-to-image',current_prompt:input.currentPrompt,requested_changes:input.requirements||''})}]}],
    text:{format:{type:'json_schema',name:'qwen21_native_rewrite',strict:true,schema:{type:'object',properties:{display_prompt:{type:'string'},model_prompt:{type:'string'}},required:['display_prompt','model_prompt'],additionalProperties:false}}}}};
}
function literals(text){return [...String(text).matchAll(/[“「『"]([^”」』"\r\n]+)[”」』"]/gu)].map(m=>m[1]);}
function refs(text){return String(text).match(/<image\d+>|@参考图\s*\d+|__NF[A-Za-z0-9_]+__/g)||[];}
function explicitFacts(input,display,model){
  const changes=input.requirements||'',replace=/(?:改成|改为|替换|换成|删除|去掉|移除|change|replace|remove)/i.test(changes);
  const source=replace?changes:input.currentPrompt+'\n'+changes;
  const numbers={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
  const english=['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
  const quantities=text=>[...text.matchAll(/(\d+|[一二两三四五六七八九十])\s*(?:只|个|位|名|辆|座|张|件|本|朵|棵|把|艘|枚)/gu)].map(m=>numbers[m[1]]??Number(m[1])).concat(/一对/.test(text)?[2]:[]);
  const present=new Set(quantities(display));for(const n of quantities(source)){
    const alternatives=n===1?'|a|an':n===2?'|a pair of':'';
    if(!present.has(n)||!new RegExp('\\b(?:'+n+(english[n]?'|'+english[n]:'')+alternatives+')\\b','i').test(model))fail('Qwen 2.1 rewrite lost an explicit quantity');
  }
  for(const[color,word]of [['红色','red'],['蓝色','blue'],['绿色','green'],['白色','white'],['黑色','black'],['黄色','yellow'],['紫色','purple'],['橙色','orange'],['粉色','pink'],['灰色','gr[ae]y']]){
    if(source.includes(color)&&(!display.includes(color[0])||!new RegExp('\\b'+word+'\\b','i').test(model)))fail('Qwen 2.1 rewrite lost an explicit color');
  }
  for(const[place,word]of [['左下角','(?:lower|bottom)[ -]left'],['右下角','(?:lower|bottom)[ -]right'],['左上角','(?:upper|top)[ -]left'],['右上角','(?:upper|top)[ -]right']]){
    if(source.includes(place)&&(!display.includes(place)||!new RegExp(word,'i').test(model)))fail('Qwen 2.1 rewrite lost an explicit position');
  }
}
export function compileQwen21NativeRewrite(response,prepared,preserve){
  let value;try{value=JSON.parse(response.output_text);}catch{fail('Qwen 2.1 rewrite must be complete JSON');}
  if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='display_prompt,model_prompt')fail('Qwen 2.1 rewrite fields invalid');
  const display=typeof value.display_prompt==='string'?value.display_prompt.trim():'',model=typeof value.model_prompt==='string'?value.model_prompt.trim():'';
  if(display.length<8||model.length<20||display.length>16000||model.length>20000||(model.match(/[A-Za-z]+/g)||[]).length<8)fail('Qwen 2.1 rewrite incomplete');
  const input=prepared.input,requirements=input.requirements||'';
  if(typeof preserve!=='function'||preserve(input.currentPrompt,display,requirements)!==true)fail('Qwen 2.1 rewrite lost source constraints');
  explicitFacts(input,display,model);
  // Literal equality is a useful deterministic check, not a semantic proof.
  // Every quoted image string in the Chinese display must survive in English.
  const exact=[...new Set([...refs(input.currentPrompt),...refs(requirements),...literals(display)])];
  for(const item of exact)if(!display.includes(item)||!model.includes(item))fail('Qwen 2.1 rewrite lost lettering or reference');
  let prose=model;for(const item of exact)prose=prose.split(item).join('');
  if(/[\u3400-\u9fff\uf900-\ufaff]/u.test(prose))fail('Qwen 2.1 model prose is not English');
  if(/^\s*\[(?:Style|Subjects|Environment|Lighting|Camera|Requirements)\]/im.test(model))fail('Qwen 2.1 model prompt must be native prose');
  return {displayPrompt:display,modelPrompt:model,modelPromptLanguage:'en',targetEngine:'qwen-2.1',promptContract:QWEN21_NATIVE_REWRITE,
    modelPromptPolicy:QWEN21_NATIVE_REWRITE,translationValidation:'paired-prose-and-literals',
    ...(input.supportsNegativePrompt===true?{hasNegativePrompt:true,negativePrompt:input.negativePrompt||''}:{})};
}
