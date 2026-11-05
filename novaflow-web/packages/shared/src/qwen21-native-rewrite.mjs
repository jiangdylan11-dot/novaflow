// Qwen Image 2.1 native prose, paired in one model call. This is an explicit
// opt-in contract; the older structured/double-stage requests remain valid.
export const QWEN21_NATIVE_REWRITE='qwen21-native-rewrite-v3';
export const QWEN21_NATIVE_CONTRACTS=Object.freeze(['qwen21-native-rewrite-v2',QWEN21_NATIVE_REWRITE]);
const fail=message=>{throw Object.assign(new Error(message),{code:'qwen21-rewrite-invalid'});};
const SYSTEM=`Rewrite an image prompt for Qwen Image 2.1. Return matching Chinese display_prompt and English model_prompt in one JSON object. Both describe exactly the same final image or edit; the two fields are editor/model copies, never bilingual lettering inside the image.
For text-to-image, write fluent observer prose: anchor the medium, style, subject and background first. Walk the frame in a coherent spatial order, locating each meaningful element relative to the frame and to other subjects; distinguish foreground, middle distance and background when relevant. Describe the actual material and its response to light, specific color tones, one coherent light source/direction and matching shadows/reflections. Close once on composition and mood. In display_prompt keep the user's own words for each subject, action and place (for example keep 走在海边 instead of a synonym), then add detail around them. Develop an ordinary scene to roughly 300-500 English words when that adds useful visual decisions, without imposing that length on a deliberately minimal image. Dense posters, charts or multiple panels must spell out all user content and its placement. No section labels, field inventories, checklists, analysis, vague quality boosters or repeated summary. Preserve intentional simplicity and empty space; do not invent extra subjects, readable text, logos or narrative props.
For image editing, lead with the requested operation. Describe only the targeted changes; use one concise clause to preserve the remaining content, identity, layout and medium. Do not repaint unchanged details or infer unseen features. Keep input reference tokens and their assigned roles. User-given readable text stays verbatim in its original script, including punctuation; translate descriptive prose only. Preserve the user's explicit subjects, counts, colors, positions and constraints. Apply requested changes to the final state instead of retaining conflicting old attributes.
Canvas dimensions, aspect ratio, sampling and negative prompt are owned by the application: do not change them or insert them as picture content. Return only the two complete strings; do not generate an image.`;
const EDIT_SYSTEM=`Rewrite the user's image-editing instruction for Qwen Image 2.1 using the supplied real images. Return only rewritten_prompt in JSON, as one continuous instruction paragraph. If the user instruction is Chinese, write the instruction in Chinese; otherwise use English. Text to appear inside the image is a separate language decision: exact user text first, otherwise retain the image's dominant language, otherwise the user's language. Quote only actual readable artwork text, verbatim, never bilingual glosses or descriptive attributes.
For changing this image, lead with the requested operation and make the named change strong and unmistakable. Describe only the changed attributes; preserve the untargeted content, identity, product design/count, layout, pose, accessories and rendering medium with a concise blanket clause. Do not describe the old face, clothing, background or style in detail merely to preserve it, since that invites regeneration. Do not soften the requested edit just to preserve identity.
For making a new scene from a reference subject, actively compose the requested scene and lighting while keeping the referenced identity; do not treat scene creation as a tiny local edit. Ground every visible claim in the supplied images and request; do not invent unseen details, lettering or extra edit operations.
One image: refer naturally to the image, without adding numbered tags. Preserve any reference tags or protected __NF...__ resource placeholders already supplied by the application verbatim, including for one image; these are bindings, not lettering. Multiple images: use <image1>, <image2>, etc., name each image's role, identify the base canvas when there is one, and say which specific attribute transfers from each reference. A style reference supplies style, not its objects, text or composition. For compositing, preserve identity sources and integrate scale, perspective, contact shadows and illumination coherently. For removal/outpainting, describe only the revealed/extended region needed for continuity. User-selected canvas dimensions, reference order, aspect ratio and sampling remain application parameters; do not insert them into the picture or change them.`;
export function buildQwen21NativeRewrite(input,model,referenceRoles=[]){
  const nativeEdit=input.promptContract===QWEN21_NATIVE_REWRITE&&input.qwenPromptMode==='img2img';
  if(nativeEdit){
    const instruction=input.requirements?.trim()||input.currentPrompt;
    const descriptive=instruction.replace(/[“「『][^”」』\r\n]*[”」』]|“[^”]*”|‘[^’]*’|"[^"\r\n]*"|(?<![A-Za-z0-9])'[^'\r\n]+'(?![A-Za-z0-9])|<image\d+>|@参考图\s*\d+|__NF[A-Za-z0-9_]+__/gu,'');
    const language=/[\u3400-\u9fff]/u.test(descriptive)?'zh':'en';
    return {kind:'qwen21-native',input:{...input},nativeEdit:true,referenceCount:referenceRoles.length,modelPromptLanguage:language,body:{model,store:false,temperature:0,max_output_tokens:2048,
      input:[{role:'system',content:[{type:'input_text',text:EDIT_SYSTEM}]},{role:'user',content:[{type:'input_text',text:JSON.stringify({task:'image-editing',current_instruction:input.currentPrompt,requested_changes:input.requirements||'',reference_roles:referenceRoles.map((role,index)=>({image:index+1,role})),instruction_language:language})}]}],
      text:{format:{type:'json_schema',name:'qwen21_native_edit',strict:true,schema:{type:'object',properties:{rewritten_prompt:{type:'string'}},required:['rewritten_prompt'],additionalProperties:false}}}}};
  }
  return {kind:'qwen21-native',input:{...input},body:{model,store:false,temperature:0,max_output_tokens:4096,
    input:[{role:'system',content:[{type:'input_text',text:SYSTEM}]},{role:'user',content:[{type:'input_text',text:JSON.stringify({task:input.qwenPromptMode==='img2img'?'image-editing':'text-to-image',current_prompt:input.currentPrompt,requested_changes:input.requirements||''})}]}],
    text:{format:{type:'json_schema',name:'qwen21_native_rewrite',strict:true,schema:{type:'object',properties:{display_prompt:{type:'string'},model_prompt:{type:'string'}},required:['display_prompt','model_prompt'],additionalProperties:false}}}}};
}
// "做一张图…" / "画一幅…的画" counts the picture being requested, not an object inside it.
const PICTURE='(?:图片|图像|图|画作|画|插画|照片|海报|壁纸)';
const REQUESTED_PICTURE=new RegExp('(?:一|1)\\s*(?:张|幅|个)\\s*'+PICTURE+'|(?:做|画|生成|出|来|创作|绘制|制作)\\s*(?:一|1)\\s*(?:张|幅)(?=[^，。,.\\n]{0,40}的'+PICTURE+')','gu');
export function withoutPictureRequest(text){return String(text??'').replace(REQUESTED_PICTURE,'');}
// Some providers wrap the JSON object in a Markdown fence or a short preface
// even with a JSON schema. Accept one complete object; fields are checked below.
function rewriteJson(text){
  const raw=String(text??'').trim(),candidates=[raw];
  const fenced=/^```[A-Za-z]*\s*([\s\S]*?)\s*```$/.exec(raw);if(fenced)candidates.push(fenced[1]);
  const start=raw.indexOf('{'),end=raw.lastIndexOf('}');if(start>=0&&end>start)candidates.push(raw.slice(start,end+1));
  for(const candidate of candidates){try{return JSON.parse(candidate);}catch{}}
  fail('Qwen 2.1 rewrite must be complete JSON');
}
function literals(text){return [...String(text).matchAll(/(?:“([^”\r\n]+)”|‘([^’\r\n]+)’|「([^」\r\n]+)」|『([^』\r\n]+)』|"([^"\r\n]+)"|(?<![A-Za-z0-9])'([^'\r\n]+)'(?![A-Za-z0-9]))/gu)].map(m=>m.slice(1).find(Boolean));}
function refs(text){return String(text).match(/<image\d+>|@参考图\s*\d+|__NF[A-Za-z0-9_]+__/g)||[];}
function requestedLiterals(input){
  const source=input.currentPrompt||'',changes=input.requirements||'',base=literals(source);
  const oldIn=text=>{
    const patterns=[
      /(?:从|由)\s*[“‘「『"']([^”’」』"'\r\n]+)[”’」』"']\s*(?:改为|改成|替换为|换成)/gu,
      /\bfrom\s*[“‘「『"']([^”’」』"'\r\n]+)[”’」』"']\s*(?:to|with)\b/giu,
      /\b(?:replace|change)\b[^\r\n]{0,80}?[“‘「『"']([^”’」』"'\r\n]+)[”’」』"']\s*(?:with|to)\s*[“‘「『"']/giu,
      /(?:把|将)[^\r\n]{0,40}?[“‘「『"']([^”’」』"'\r\n]+)[”’」』"']\s*(?:改为|改成|替换为|换成)\s*[“‘「『"']/gu
    ];
    return patterns.flatMap(pattern=>[...text.matchAll(pattern)].map(m=>m[1]));
  };
  const removed=new Set([...oldIn(source),...oldIn(changes)]),changed=literals(changes);
  // A single quoted string is not necessarily the title being changed: it
  // might belong to another object. Infer replacement only for a standalone,
  // uniquely identified title field; all other replacements must name the old text.
  const sourceWithoutLettering=base.reduce((text,value)=>text.split(value).join(''),source);
  const uniqueTitle=(sourceWithoutLettering.match(/标题|\btitle\b/giu)||[]).length===1;
  const sourceTitle=/^\s*(?:标题|title)\s*(?:是|为|[:：])?\s*[“‘「『"']/iu.test(source);
  const changeTitle=/^\s*(?:(?:把|将)\s*)?(?:标题\s*(?:改为|改成|替换为|换成|写成)|(?:change|replace)\s+(?:the\s+)?title\s+(?:to|with))\s*[“‘「『"']/iu.test(changes);
  if(base.length===1&&changed.length===1&&uniqueTitle&&sourceTitle&&changeTitle)removed.add(base[0]);
  return [...new Set([...base.filter(x=>!removed.has(x)),...changed.filter(x=>!removed.has(x))])];
}
function editedSide(text){
  const m=/(?:把|将)\s*(左(?:边|侧)|右(?:边|侧))(?:的)?[^，,。；;\n]{0,30}?(?:改成|改为|变成|变为|换成|替换|调整为)/u.exec(text);
  return m?(m[1].startsWith('左')?'left':'right'):null;
}

function explicitFacts(input,display,model){
  const changes=input.requirements||'',replace=/(?:改成|改为|替换|换成|删除|去掉|移除|change|replace|remove)/i.test(changes);
  const source=withoutPictureRequest(replace?changes:input.currentPrompt+'\n'+changes);
  const numbers={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
  const english=['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
  const quantities=text=>[...text.matchAll(/(\d+|[一二两三四五六七八九十])\s*(?:只|个|位|名|辆|座|张|件|本|朵|棵|把|艘|枚)/gu)].map(m=>numbers[m[1]]??Number(m[1])).concat(/一对/.test(text)?[2]:[]);
  const present=new Set(quantities(withoutPictureRequest(display)));for(const n of quantities(source)){
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
  const value=rewriteJson(response.output_text);
  const nativeEdit=prepared.nativeEdit===true,expected=nativeEdit?'rewritten_prompt':'display_prompt,model_prompt';
  if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!==expected)fail('Qwen 2.1 rewrite fields invalid');
  const display=typeof (nativeEdit?value.rewritten_prompt:value.display_prompt)==='string'?(nativeEdit?value.rewritten_prompt:value.display_prompt).trim():'',model=nativeEdit?display:typeof value.model_prompt==='string'?value.model_prompt.trim():'';
  const language=prepared.modelPromptLanguage||'en';
  if(display.length<(nativeEdit?2:8)||model.length<(nativeEdit?2:8)||display.length>16000||model.length>20000||(language==='en'&&(model.match(/[A-Za-z]+/g)||[]).length<(nativeEdit?1:8)))fail('Qwen 2.1 rewrite incomplete');
  const input=prepared.input,requirements=input.requirements||'';
  // Lexical overlap rejects equivalent image edits and cannot establish
  // semantic safety. Keep it for text-to-image; edit instructions still reach
  // the model verbatim, with exact lettering and references checked below.
  if(!nativeEdit && (typeof preserve!=='function'||preserve(withoutPictureRequest(input.currentPrompt),display,requirements)!==true))fail('Qwen 2.1 rewrite lost source constraints');
  if(!nativeEdit)explicitFacts(input,display,model);
  // Literal equality is a useful deterministic check, not a semantic proof.
  // Every quoted image string in the Chinese display must survive in English.
  const exact=[...new Set([...refs(input.currentPrompt),...refs(requirements),...requestedLiterals(input),...literals(display)])];
  for(const item of exact)if(!display.includes(item)||!model.includes(item))fail('Qwen 2.1 rewrite lost lettering or reference');
  if(nativeEdit){
    if(!Number.isSafeInteger(prepared.referenceCount)||prepared.referenceCount<0||prepared.referenceCount>3)fail('Qwen 2.1 edit reference count invalid');
    for(const match of display.matchAll(/<image(\d+)>|@参考图\s*(\d+)/giu)){
      const index=Number(match[1]||match[2]);
      if(!Number.isSafeInteger(index)||index<1||index>prepared.referenceCount)fail('Qwen 2.1 edit reference out of range');
    }
  }
  if(nativeEdit){const expectedSide=editedSide(requirements)||editedSide(input.currentPrompt),actualSide=editedSide(display);if(expectedSide&&actualSide&&expectedSide!==actualSide)fail('Qwen 2.1 rewrite changed the edit target side');}
  let prose=model;for(const item of exact)prose=prose.split(item).join('');
  if(nativeEdit)prose=prose.replace(/<image\d+>|@参考图\s*\d+/giu,'');
  if(language==='en'&&/[\u3400-\u9fff\uf900-\ufaff]/u.test(prose))fail('Qwen 2.1 model prose is not English');
  if(/^\s*\[(?:Style|Subjects|Environment|Lighting|Camera|Requirements)\]/im.test(model))fail('Qwen 2.1 model prompt must be native prose');
  const contract=input.promptContract||QWEN21_NATIVE_REWRITE;
  return {displayPrompt:display,modelPrompt:model,modelPromptLanguage:language,targetEngine:'qwen-2.1',promptContract:contract,
    modelPromptPolicy:contract,translationValidation:nativeEdit?'native-edit-and-literals':'paired-prose-and-literals',
    ...(input.supportsNegativePrompt===true?{hasNegativePrompt:true,negativePrompt:input.negativePrompt||''}:{})};
}
