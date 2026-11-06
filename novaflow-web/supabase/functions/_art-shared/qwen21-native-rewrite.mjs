// GENERATED COPY - source: packages/shared/src/qwen21-native-rewrite.mjs
// Qwen Image 2.1 native prose, paired in one model call. This is an explicit
// opt-in contract; the older structured/double-stage requests remain valid.
export const QWEN21_NATIVE_REWRITE='qwen21-native-rewrite-v3';
export const QWEN21_NATIVE_CONTRACTS=Object.freeze(['qwen21-native-rewrite-v2',QWEN21_NATIVE_REWRITE]);
// One subject first, then style images: Qwen ignores a style picture but follows
// a concrete style description, so the online model writes those words.
export const QWEN21_STYLE_REDRAW_POLICY='qwen21-style-redraw-v1';
export const STYLE_NEGATIVE='photograph, photo, photorealistic skin texture, skin pores, realistic facial proportions, 3d render, cgi, blurry, extra person, text, watermark, grainy, noise, color cast, monochrome tint, uniform color wash, low contrast, flat lighting, haze, washed out, yellow skin, orange skin, warm orange cast, amber tint, sepia, golden filter, yellow tint';
export const isStyleRedrawRoles=roles=>Array.isArray(roles)&&roles.length>=2&&roles[0]==='subject'&&roles.slice(1).every(role=>role==='style');
const fail=message=>{throw Object.assign(new Error(message),{code:'qwen21-rewrite-invalid'});};
const SYSTEM=`Rewrite an image prompt for Qwen Image 2.1. Return matching Chinese display_prompt and English model_prompt in one JSON object. Both describe exactly the same final image or edit; the two fields are editor/model copies, never bilingual lettering inside the image.
For text-to-image, write fluent observer prose: anchor the medium, style, subject and background first. Walk the frame in a coherent spatial order, locating each meaningful element relative to the frame and to other subjects; distinguish foreground, middle distance and background when relevant. Describe the actual material and its response to light, specific color tones, one coherent light source/direction and matching shadows/reflections. Close once on composition and mood. In display_prompt keep the user's own words for each subject, action and place (for example keep 走在海边 instead of a synonym), then add detail around them. Develop an ordinary scene to roughly 300-500 English words when that adds useful visual decisions, without imposing that length on a deliberately minimal image. Dense posters, charts or multiple panels must spell out all user content and its placement. No section labels, field inventories, checklists, analysis, vague quality boosters or repeated summary. Preserve intentional simplicity and empty space; do not invent extra subjects, readable text, logos or narrative props.
For image editing, lead with the requested operation. Describe only the targeted changes; use one concise clause to preserve the remaining content, identity, layout and medium. Do not repaint unchanged details or infer unseen features. Keep input reference tokens and their assigned roles. User-given readable text stays verbatim in its original script, including punctuation; translate descriptive prose only. Preserve the user's explicit subjects, counts, colors, positions and constraints. Apply requested changes to the final state instead of retaining conflicting old attributes.
Canvas dimensions, aspect ratio, sampling and negative prompt are owned by the application: do not change them or insert them as picture content. Return only the two complete strings; do not generate an image.`;
const EDIT_SYSTEM=`Rewrite the user's image-editing instruction for Qwen Image 2.1 using the supplied real images. Return only rewritten_prompt in JSON, as one continuous instruction paragraph. If the user instruction is Chinese, write the instruction in Chinese; otherwise use English. Text to appear inside the image is a separate language decision: exact user text first, otherwise retain the image's dominant language, otherwise the user's language. Quote only actual readable artwork text, verbatim, never bilingual glosses or descriptive attributes.
For changing this image, lead with the requested operation and make the named change strong and unmistakable. Describe only the changed attributes; preserve the untargeted content, identity, product design/count, layout, pose, accessories and rendering medium with a concise blanket clause. Do not describe the old face, clothing, background or style in detail merely to preserve it, since that invites regeneration. Do not soften the requested edit just to preserve identity.
For making a new scene from a reference subject, actively compose the requested scene and lighting while keeping the referenced identity; do not treat scene creation as a tiny local edit. Ground every visible claim in the supplied images and request; do not invent unseen details, lettering or extra edit operations.
One image: refer naturally to the image, without adding numbered tags. Preserve any reference tags or protected __NF...__ resource placeholders already supplied by the application verbatim, including for one image; these are bindings, not lettering. Multiple images: use <image1>, <image2>, etc., name each image's role, identify the base canvas when there is one, and say which specific attribute transfers from each reference. A style reference supplies style, not its objects, text or composition. For compositing, preserve identity sources and integrate scale, perspective, contact shadows and illumination coherently. For removal/outpainting, describe only the revealed/extended region needed for continuity. User-selected canvas dimensions, reference order, aspect ratio and sampling remain application parameters; do not insert them into the picture or change them.`;
const STYLE_SYSTEM=`You prepare a style redraw for Qwen Image 2.1. <image1> is the subject; every later image is a style reference. Return only JSON with drawing, light, style_description, mood_description, content_description, time_of_day, sun_visible and sky_visible, all in English.
drawing: look at how the style image(s) are drawn and pick the one closest value for each field, deciding in this order. Paint on paper with wet edges and no ink outline is watercolour. Flat colour areas with hard-edged shadows is flat_cel, even in a bright picture. Visible brushwork with no outlines is painterly. Thin lines with blurred shadows and glow is soft. Only smooth glossy airbrushed work is glossy.
genre: flat_cel, painterly, glossy, soft or watercolour. line: none, thin_uniform, tapered, sketchy or pencil. shading: soft_gradient, two_step, three_step, brush, hatching or wash. highlight: none, hard_band, angular, specular, bloom or paper. hair: solid, ribbon, fine, brushed or washed. colour_layout: flat, gradient, impasto or wash. surface: smooth, grain, textured or paper. For example:
- flat colour fills, one thin even outline, hard shadow shapes: flat_cel, thin_uniform, two_step, angular, ribbon, flat, smooth
- no outlines, volume built with soft brushwork: painterly, none, brush, specular, brushed, gradient, textured
- fine lines that swell and taper, glossy airbrushed shadows: glossy, tapered, soft_gradient, specular, ribbon, gradient, smooth
- thin delicate lines, blurred shadow edges, glowing highlights: soft, thin_uniform, soft_gradient, bloom, fine, gradient, smooth
- pigment bleeding on rough paper, white paper showing: watercolour, pencil, wash, paper, washed, wash, paper
style_description: under 20 words on anything special about the drawing the choices above miss, or an empty string. No colour words, and no character, object or scenery from the style image(s).
light: how the style image(s) are lit, one closest value each. key: hard, soft or diffuse. direction: above, side, back or front. contrast: high, medium or low. shadow: cool, warm or neutral. skin: matte, satin, glossy or translucent. hair_depth: flat, two or layered. Large areas falling into deep shadow mean high contrast; a clear lit side and dark side mean a hard key.
mood_description: under 15 words: the time of day, then any sky shown with its colours. Short hard shadows mean midday; golden hour only if a low sun is actually visible. Name no object or scenery from the style image(s).
content_description: 40-80 words describing <image1>: the person, the exact hair colour in a plain word such as brown, dark brown, black or blonde (never auburn or copper) and the hair style, expression including any wink, facial marks and where they are, clothing, held objects, pose and framing, and the place with its structure and objects. Never state its time of day, sky, lighting or what shows through its windows: the style image(s) decide those. Ground every claim in <image1>. Carry through any request in current_instruction and requested_changes, such as a new pose or background, by describing the requested result; leave out what only asks for this style change. Refer to the pictures by what they show, never by tags or __NF...__ placeholders.
time_of_day: one of midday, afternoon, golden_hour, dusk, night, overcast. sun_visible and sky_visible: true only if a low sun or open sky actually appears in the style image(s).`;
// Only the lighting design comes from the reference. Colours stay the source's own: tinting the whole
// picture is what reads as a colour filter.
export function buildStyleRelight(moodDescription,style='<image2>',facts={}){
  const decided=decideStyleTime(styleSlot(moodDescription),facts);
  return `${decided?decided.line+' ':''}Lighting: take only the lighting design from ${style}: ${styleSlot(decided?.mood||moodDescription)}. Colour appears only where light actually falls: on lit edges, highlights, glass and the light sources themselves; only the light sources, their reflections and the background atmosphere take their colours from ${style}. Everything else keeps its own true colour: natural rosy skin tone with a soft pink undertone, never yellow or orange skin; the hair keeps exactly the colour named in the content description, deep and rich, never shifted to orange or yellow; the clothing's own rich colours and the scene's own materials, so whites stay white and greys stay grey. The whole scene, interior and exterior, exists at that single time of day: it decides the sky in the windows, how much daylight enters and from where, and the overall brightness of the room. Artificial lights may be on at any time of day. In daytime, daylight is the dominant light, the room is bright overall and lamps and signage are secondary accents; at golden hour the sky stays bright and warm; only when that time is dusk or night is the sky dark, with practical lights as the main light. Never mix a daytime sky with a night-dark room or the reverse. Every window shows that same sky across all its panes, from edge to edge; no pane stays dark in daytime or bright at night. The key light colours only the surfaces it actually hits; the shadow side and unlit areas take a cooler, neutral or complementary colour, never the same hue as the light. The background keeps its own varied local colours (seats, signage, screens, glass, sky) under that light; a scene is never a single hue. Lamps and signage keep their own real colours. Never a uniform colour cast, tint, wash, filter or haze over the whole picture.`;
}
// The finish every style redraw is held to, whatever the reference.
export const STYLE_POLISH='Keep the face proportions and facial marks of <image1>. The whole picture, person and background alike, is rendered in this same drawing technique.';
const styleSlot=text=>String(text).trim().replace(/[.\s]+$/u,'');
// The brain picks how the picture is drawn and the program words it: picking is what a small model does reliably, and the wording stays at the level of the hand-written trials.
const STYLE_DRAWING=Object.freeze({
  genre:{flat_cel:'bright flat cel anime illustration',painterly:'painterly semi-realistic anime illustration',glossy:'glossy digital anime illustration',soft:'soft anime illustration',watercolour:'transparent watercolour painting on rough paper'},
  line:{none:'no outlines, forms defined by tone alone',thin_uniform:'uniform thin clean ink outline',tapered:'crisp fine lines with tapered weight',sketchy:'loose sketchy linework',pencil:'faint pencil under-drawing'},
  shading:{soft_gradient:'gentle gradient cel shading with blurred shadow edges',two_step:'strictly two-step hard-edged shadow shapes with no gradients',three_step:'three clear flat steps of shadow',brush:'forms built from soft-edged brush modelling with layered volumetric shading',hatching:'shading built from hatching or screentone',wash:'wet-on-wet washes with soft pigment blooms and bleeding edges, no hard cel shadows'},
  highlight:{none:'few distinct highlights',hard_band:'one hard highlight band on the hair',angular:'highlights as small crisp shapes',specular:'tight specular highlights on eyes and lips',bloom:'soft bloom around highlights',paper:'highlights left as unpainted paper'},
  hair:{solid:'hair in simple solid masses',ribbon:'sleek hair in long simple masses with a narrow sheen',fine:'fluffy hair in fine soft strands',brushed:'hair painted in soft grouped masses with fine flyaway strands',washed:'hair laid in as soft wet washes of pigment'},
  colour_layout:{flat:'few flat colour areas',gradient:'smooth airbrushed gradients in the shadows',impasto:'thick painted strokes',wash:'thin transparent washes that let the paper show'},
  surface:{smooth:'smooth skin',grain:'a subtle paper grain',textured:'visible painted texture',paper:'rough paper grain with uneven painted edges'}
});
const STYLE_LIGHT=Object.freeze({
  key:{hard:'a hard direct key light',soft:'a soft key light',diffuse:'soft diffused light'},
  direction:{above:'from above',side:'from the side',back:'from behind as a rim light',front:'from the front'},
  contrast:{high:'very high contrast with deep shadow masses',medium:'moderate contrast',low:'low contrast with open shadows'},
  shadow:{cool:'cool blue-violet shadows',warm:'warm brown shadows',neutral:'neutral grey shadows'},
  skin:{matte:'matte skin',satin:'softly lit satin skin',glossy:'glossy skin with bright sheen',translucent:'translucent glowing skin'},
  hair_depth:{flat:'hair kept to one flat tone',two:'hair in two clear tones',layered:'hair in many layered strands with deep darks between them'}
});
const STYLE_DRAWING_MIN=3;
// Picked light comes before the brain's mood text, which then only adds what the choices cannot say.
export function buildStyleLight(light,mood=''){
  const key=STYLE_LIGHT.key[light?.key],direction=STYLE_LIGHT.direction[light?.direction];
  const picked=[key&&direction?`${key} ${direction}`:key,...['contrast','shadow','skin','hair_depth'].map(field=>STYLE_LIGHT[field][light?.[field]])].filter(Boolean);
  return picked.length<STYLE_DRAWING_MIN?styleSlot(mood):[styleSlot(mood),...picked].filter(Boolean).join(', ');
}
export function buildStyleDrawing(drawing,notes=''){
  const picked=Object.entries(STYLE_DRAWING).map(([field,values])=>values[drawing?.[field]]).filter(Boolean);
  if(picked.length<STYLE_DRAWING_MIN)return styleSlot(notes);
  return [...picked,styleSlot(notes)].filter(Boolean).join(', ');
}
// The brain reads the picture; the program decides the time. It called a midday picture with no sky in view golden hour every
// time, however the instruction was worded, and once called dark corners a night sky, so only a low sun seen in the picture counts.
// Naming sky here paints sky over walls and ceilings, so the program's line speaks only of the light and the layout.
const STYLE_TIMES={midday:'bright midday daylight',afternoon:'afternoon daylight',golden_hour:'golden hour',dusk:'dusk',night:'night',overcast:'overcast daylight'};
const STYLE_TIME_WORDS=[['golden_hour',/golden[- ]hour|sunset|sunrise/iu],['night',/\bnight|moonlit|moonlight/iu],['dusk',/\bdusk|twilight|evening/iu],['overcast',/overcast/iu],['afternoon',/afternoon/iu],['midday',/midday|noon|morning|daylight|sunlight/iu]];
const STYLE_NOT_DAY=/\b(?:late afternoon\s+)?(?:golden[- ]hour|sunset|sunrise|dusk|twilight|evening|night(?:time)?)\b\s*/giu;
const STYLE_LOW_SUN=[[/\b(?:golden|honey(?:-gold)?|amber)\b/giu,'white-gold'],[/\blow(?:[- ]side)?[- ]angle\b/giu,'high'],[/\bfrom the side\b/giu,'from above'],[/\b(?:elongated|long)\b/giu,'short']];
const STYLE_NO_SKY=/\bno sky\b[^.]*\.?|(?:,\s*)?(?:and\s+)?(?:the\s+)?\bsky\b[^.;]*/giu;
const STYLE_LAYOUT='The layout, walls, ceiling and openings of <image1> stay exactly as they are.';
export function decideStyleTime(mood,facts={}){
  const said=STYLE_TIMES[facts.time_of_day]?facts.time_of_day:STYLE_TIME_WORDS.find(([,words])=>words.test(mood))?.[0];
  if(!said)return null;
  const noSun=facts.sun_visible===false,time=said==='golden_hour'&&noSun||said==='dusk'&&noSun&&facts.sky_visible===false?'midday':said,noSky=facts.sky_visible===false||time!==said;
  const day=time==='midday'||time==='afternoon'||time==='overcast';
  let text=String(mood);
  if(day)text=text.replace(STYLE_NOT_DAY,'').replace(/^[\s,.;]+|[\s,;]+$/gu,'').replace(/^./u,letter=>letter.toUpperCase());
  // Any sky wording left in a daytime text with no sky in view brings back the photo's dark windows.
  if(day&&noSky)text=text.replace(STYLE_NO_SKY,'').replace(/[\s,;]+$/u,'');
  if(time!==said)text=STYLE_LOW_SUN.reduce((value,[words,next])=>value.replace(words,next),text);
  const light=day?(noSky?'Every existing window and opening of <image1> is filled with bright pale daylight.':'Daylight enters through the existing windows and openings of <image1>.'):time==='golden_hour'?'':'Lamps are the main light.';
  return {time,mood:text||STYLE_DEFAULT_MOOD,line:[`Time of day: ${STYLE_TIMES[time]}.`,light,STYLE_LAYOUT].filter(Boolean).join(' ')};
}
// The brain's three texts are only slots in a fixed prompt, so a loose answer is cleaned rather than refused.
const STYLE_DEFAULT_MOOD='neutral key light from above, soft neutral shadows, a clean atmosphere, medium contrast';
const STYLE_COLOUR_WORDS=/(?<![-\w])(?:warm-toned|cool-toned|warm|cool|golden|palette|tone|dark|dim|low-key|moody|desaturated|muted|high-key|daylight|pale)(?![-\w])/giu;
const styleText=value=>typeof value==='string'?value.replace(/<image\d+>|__NF[A-Za-z0-9_]+__/g,'the picture').replace(/\s+/g,' ').trim().slice(0,1500):'';
const styleTechnique=text=>text.replace(STYLE_COLOUR_WORDS,'').replace(/\s+([,.;])/g,'$1').replace(/([,;]\s*){2,}/g,', ').replace(/^[\s,.;]+|[\s,;]+$/g,'').replace(/\s{2,}/g,' ');
export function buildStyleRedrawPrompt(styleDescription,moodDescription,contentDescription,referenceCount=2,facts={}){
  const style=Array.from({length:Math.max(1,referenceCount-1)},(_,index)=>`<image${index+2}>`).join(' and ');
  return `Loosely based on <image1> (use it only for the person, pose and scene; do not keep its photographic rendering). An illustration in this style: ${styleSlot(styleDescription)}. ${styleSlot(contentDescription)}. ${buildStyleRelight(moodDescription,style,facts)} ${STYLE_POLISH}`;
}
export function buildQwen21NativeRewrite(input,model,referenceRoles=[]){
  const nativeEdit=input.promptContract===QWEN21_NATIVE_REWRITE&&input.qwenPromptMode==='img2img';
  if(nativeEdit&&isStyleRedrawRoles(referenceRoles)){
    // The page prompt and the planner's brief still hold the last picture's lighting, so the brain gets only the person's own words.
    const ownWords=input.requirements?.trim()||input.currentPrompt;
    return {kind:'qwen21-native',input:{...input},nativeEdit:true,styleRedraw:true,referenceCount:referenceRoles.length,modelPromptLanguage:'en',body:{model,store:false,temperature:0,max_output_tokens:2048,
      input:[{role:'system',content:[{type:'input_text',text:STYLE_SYSTEM}]},{role:'user',content:[{type:'input_text',text:JSON.stringify({task:'style-redraw',current_instruction:ownWords,requested_changes:'',reference_roles:referenceRoles.map((role,index)=>({image:index+1,role}))})}]}],
      text:{format:{type:'json_schema',name:'qwen21_style_redraw',strict:true,schema:{type:'object',properties:{drawing:{type:'object',properties:Object.fromEntries(Object.entries(STYLE_DRAWING).map(([field,values])=>[field,{type:'string',enum:Object.keys(values)}])),required:Object.keys(STYLE_DRAWING),additionalProperties:false},light:{type:'object',properties:{...Object.fromEntries(Object.entries(STYLE_LIGHT).map(([field,values])=>[field,{type:'string',enum:Object.keys(values)}]))},required:Object.keys(STYLE_LIGHT),additionalProperties:false},style_description:{type:'string'},mood_description:{type:'string'},content_description:{type:'string'},time_of_day:{type:'string',enum:Object.keys(STYLE_TIMES)},sun_visible:{type:'boolean'},sky_visible:{type:'boolean'}},required:['drawing','light','style_description','mood_description','content_description','time_of_day','sun_visible','sky_visible'],additionalProperties:false}}}}};
  }
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
// An edit whose rewrite fails the checks still has the request itself, which keeps every tag: use that
// rather than stop a paid run. Style redraws have their own tolerance.
export function compileQwen21NativeRewrite(response,prepared,preserve){
  try{return compileQwen21Rewrite(response,prepared,preserve);}
  catch(error){
    const plain=[prepared.input?.currentPrompt,prepared.input?.requirements].filter(text=>String(text||'').trim()).join('\n');
    if(error?.code!=='qwen21-rewrite-invalid'||prepared.nativeEdit!==true||prepared.styleRedraw===true||!plain)throw error;
    console.warn('[art] edit rewrite replaced by the request',error.message);
    return compileQwen21Rewrite({output_text:JSON.stringify({rewritten_prompt:plain})},prepared,preserve);
  }
}
function compileQwen21Rewrite(response,prepared,preserve){
  const value=rewriteJson(response.output_text);
  const nativeEdit=prepared.nativeEdit===true,styleRedraw=prepared.styleRedraw===true,expected=styleRedraw?'content_description,mood_description,style_description':nativeEdit?'rewritten_prompt':'display_prompt,model_prompt';
  if(!value||typeof value!=='object'||Array.isArray(value)||!styleRedraw&&Object.keys(value).sort().join(',')!==expected)fail('Qwen 2.1 rewrite fields invalid');
  const styleDescription=styleRedraw?buildStyleDrawing(value.drawing,styleTechnique(styleText(value.style_description))):'',contentDescription=styleRedraw?styleText(value.content_description):'',moodDescription=styleRedraw?buildStyleLight(value.light,styleText(value.mood_description))||STYLE_DEFAULT_MOOD:'';
  if(styleRedraw&&!styleDescription)fail('Qwen 2.1 style description missing');
  if(styleRedraw&&!contentDescription)fail('Qwen 2.1 content description missing');
  const written=styleRedraw?buildStyleRedrawPrompt(styleDescription,moodDescription,contentDescription,prepared.referenceCount,value):nativeEdit?value.rewritten_prompt:value.display_prompt;
  const display=typeof written==='string'?written.trim():'',model=nativeEdit?display:typeof value.model_prompt==='string'?value.model_prompt.trim():'';
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
  // A style redraw's prompt is assembled here: the request's tags and lettering are not expected in it.
  const exact=styleRedraw?[]:[...new Set([...refs(input.currentPrompt),...refs(requirements),...requestedLiterals(input),...literals(display)])];
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
  if(language==='en'&&!styleRedraw&&/[\u3400-\u9fff\uf900-\ufaff]/u.test(prose))fail('Qwen 2.1 model prose is not English');
  if(/^\s*\[(?:Style|Subjects|Environment|Lighting|Camera|Requirements)\]/im.test(model))fail('Qwen 2.1 model prompt must be native prose');
  const contract=input.promptContract||QWEN21_NATIVE_REWRITE,userNegative=input.negativePrompt||'';
  // Rerunning a draft sends its own negative back; it must not grow each time.
  const negativePrompt=styleRedraw&&!userNegative.includes(STYLE_NEGATIVE)?[userNegative,STYLE_NEGATIVE].filter(Boolean).join(', '):userNegative;
  return {displayPrompt:display,modelPrompt:model,modelPromptLanguage:language,targetEngine:'qwen-2.1',promptContract:contract,
    modelPromptPolicy:styleRedraw?QWEN21_STYLE_REDRAW_POLICY:contract,translationValidation:nativeEdit?'native-edit-and-literals':'paired-prose-and-literals',
    ...(styleRedraw?{styleDescription,moodDescription,contentDescription}:{}),
    ...(input.supportsNegativePrompt===true?{hasNegativePrompt:true,negativePrompt}:{})};
}
