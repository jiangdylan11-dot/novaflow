// Server-owned professional rules copied literally from prompt-assistant-service.py.
import {createHash} from "node:crypto";
import {Buffer} from "node:buffer";
import {inflateSync} from "node:zlib";
import {companionInput} from "./companion-chat.mjs";
const ART_STYLE_QUESTION = "Look at this picture and write ONE English instruction, at most 40 words, telling an artist how to render ANY object in exactly this picture's style. Begin with the medium name followed by a colon, then the two or three marks that make it recognisable at a glance: what the strokes, washes, blocks, pixels, lines or edges actually look like, and the paper, canvas or print grain only where it is clearly visible. Format: \"<medium>: <mark>, <mark>, <mark>.\" Be concrete and executable: say what each mark looks like, not vague words such as \"soft outlines, continuous blends\". For a photograph or a realistic render, one mark is \"true-to-life fine surface detail\"; never call its surfaces flat or uniform. CRITICAL: describe only how marks are made, never what carries them and never the shapes or motifs drawn in the picture. Do not write skin, hair, fabric, cloth, metal, marble, stone, sky, water, particles, sparkles, glow, light effects, or any other thing that appears in this picture. Never name a colour, the subject, the people, the place, the mood or the lighting. Write only what is there, never what is absent.";
const ART_STYLE_SYSTEM_TEXT = "You describe how pictures are rendered, for an artist who will redraw other objects in the same style. Start with the medium, for example photograph, photorealistic 3D render, digital painting, oil painting, watercolour, ink wash, ink-and-watercolour illustration, cartoon, pixel art or cel-shaded illustration. Reply with exactly one plain English instruction of at most 40 words: no preamble, quotes, lists or JSON.";
const EFFECT_MATERIAL_SYSTEM_TEXT = "You write material descriptions for 2D game VFX artists, who build glowing effects on a black background out of the material you describe. Reply with one JSON object only: no preamble, no markdown.";
const EFFECT_MATERIAL_QUESTION = "This picture is a reference for a 2D game VFX element: the effect must clearly look like it is made from what this picture shows. Say what it is made of. Reply exactly as {\"name\": \"...\", \"elements\": \"...\", \"colours\": \"...\", \"breakup\": \"...\"} where name is the thing's common name in capitals, 1-3 English words; elements starts with \"made of\" and says, in at most 45 words, which elements the effect is built from - small whole copies of the thing mixed with many loose pieces of it - always calling the thing by its common name, with the two or three features that make it recognisable at a glance, their real shape and colours, and that they glow softly with short light trails; then NO items for OTHER materials it could be confused with, never what the picture shows. Never a count, and nothing about where the elements are or how they are arranged; colours is the two to four main colours of the thing itself, never the background, as plain English colour words separated by commas; breakup is one sentence starting with \"It\" and a verb in capitals, saying how it breaks apart or disperses.";
const EFFECT_MATERIAL_DEFAULT_ARRANGEMENT = "A bright main stroke of light runs along the effect, and the elements are in mixed sizes (a few large, many medium and tiny), packed densely close along it in uneven clusters, only a few drifting a short way off, turned at different angles and overlapping, with fine sparkles and soft glow in between. Varied in size and angle, NOT a row of identical evenly spaced elements, NOT one big picture behind the effect.";
const EFFECT_SUPPLEMENT_SYSTEM_TEXT = "You translate short Chinese requests from VFX artists into plain English. Reply with the English only.";
const EFFECT_SUPPLEMENT_QUESTION = "Translate this request about a game VFX element into one plain English phrase, every word in English. Keep its meaning exactly: every object, amount, place and motion it names, and nothing added. Colours: 彩带, 彩色 or 五彩 means multicoloured (red, blue, green and purple); 彩虹 is a rainbow (red, orange, yellow, green, blue and purple); a named colour stays that colour; when no colour is named, name none. Examples: 绕一圈星星 -> a ring of stars circling around it; 多点火星飞溅 -> more sparks flying out; 拖出彩虹光尾 -> trailing a rainbow (red, orange, yellow, green, blue and purple) light tail; 多点彩带飘落 -> more multicoloured (red, blue, green and purple) ribbons falling. Request: ";

// 主题切换 reads a game screen as a function list so each theme can be designed from zero.
const UI_INVENTORY_SYSTEM_TEXT = "你是游戏 UI 分析师，只读图，不做设计。用简体中文回答，只输出清单正文，不要前言、标题符号、Markdown 或 JSON。";
const UI_INVENTORY_QUESTION = "读这张游戏界面截图，写出它的功能清单，供美术按新主题从零重新设计。按从上到下的顺序逐区写，每区一行，格式为：区域名［左,上,宽,高］：内容。方括号里是这个区域在截图上的位置，按整张截图宽高的百分比写四个整数（左边距、上边距、宽度、高度，例如［4,2,92,40］），要量准。必须写清：第一行写界面类型和横竖屏；符号盘或网格写成“横向每行N个、纵向共M行、共K格”（数清楚，不要写几列几行）以及里面出现的符号种类，人物头像类符号写“人物头像符号”；角色区写有几个角色、占多大；每一个按钮、信息条、数值框的功能和上面的原文文字与数字（原文照抄，加引号）；同一行有几个按钮写清从左到右的顺序；没有文字的图标按钮写出它的功能，例如“旋转按钮（图标，无文字）”。不要描述颜色、材质、画风、人物长相和背景，不要写建议。";
const fail=()=>{throw Object.assign(new Error('operation-style-invalid'),{code:'operation-style-invalid',statusCode:400});};
const flat=value=>String(value||'').replace(/\s+/g,' ').trim();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Only static 8-bit RGB/RGBA PNGs are accepted. The browser must decode and
// scale to <=768 before quoting. Verify all chunks and CRCs, then inflate with
// a hard size cap and check every scanline; malformed images fail before charge.
function validateStyleImageSize(dataUrl) {
  const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl||'');if(!match)fail();
  const b=Buffer.from(match[1],'base64');const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  if(b.length>4*1024*1024||b.length<57||!b.subarray(0,8).equals(signature))fail();
  const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
  let pos=8,w=0,h=0,channels=0,seenHeader=false,seenData=false,dataFinished=false,ended=false;const ancillary=new Set(),compressed=[];let compressedBytes=0;
  while(pos<b.length){
    if(pos+12>b.length)fail();const n=b.readUInt32BE(pos);if(n>4*1024*1024||pos+12+n>b.length)fail();
    const typeBytes=b.subarray(pos+4,pos+8);if([...typeBytes].some(x=>!((x>=65&&x<=90)||(x>=97&&x<=122))))fail();
    const type=typeBytes.toString('ascii');if(type[2]!==type[2].toUpperCase())fail();
    const data=b.subarray(pos+8,pos+8+n);if(crc32(b.subarray(pos+4,pos+8+n))!==b.readUInt32BE(pos+8+n))fail();
    if(!seenHeader&&type!=='IHDR')fail();
    if(type==='IHDR'){
      if(seenHeader||n!==13)fail();seenHeader=true;w=data.readUInt32BE(0);h=data.readUInt32BE(4);
      if(!w||!h||w>768||h>768)throw Object.assign(new Error('operation-style-image-size'),{code:'operation-style-image-size',statusCode:400});
      if(data[8]!==8||![2,6].includes(data[9])||data[10]!==0||data[11]!==0||data[12]!==0)fail();channels=data[9]===6?4:3;
    } else if(type==='IDAT'){
      if(dataFinished||ended)fail();seenData=true;compressedBytes+=n;if(compressedBytes>4*1024*1024)fail();compressed.push(data);
    } else if(type==='IEND'){
      if(!seenData||ended||n!==0||pos+12!==b.length)fail();ended=true;
    } else {
      // Canvas needs no untrusted compressed text, ICC profiles, animations,
      // palettes or extension chunks. Only fixed-size rendering metadata is
      // accepted; this also prevents ancillary decompression bombs.
      const lengths={sRGB:1,gAMA:4,cHRM:32,pHYs:9};
      if(seenData||!Object.hasOwn(lengths,type)||ancillary.has(type)||n!==lengths[type])fail();
      if(type==='sRGB'&&data[0]>3)fail();if(type==='gAMA'&&data.readUInt32BE(0)===0)fail();if(type==='pHYs'&&data[8]>1)fail();
      ancillary.add(type);
    }
    pos+=12+n;if(ended)break;
  }
  if(!seenHeader||!seenData||!ended||!compressedBytes)fail();
  // The edge runtime's zlib ignores info and returns the bytes themselves, with no engine to read.
  const expected=h*(1+w*channels),input=Buffer.concat(compressed,compressedBytes);let result;
  try{result=inflateSync(input,{maxOutputLength:expected+1,info:true});}catch{fail();}
  const pixels=result instanceof Uint8Array?result:result?.buffer;
  if(!pixels||pixels.length!==expected||(result.engine&&result.engine.bytesWritten!==input.length))fail();
  for(let row=0;row<h;row++)if(pixels[row*(1+w*channels)]>4)fail();
}
export const STYLE_OUTPUT_TOKENS=Object.freeze({style:120,'aifx-material':300,'aifx-supplement':120,'ui-inventory':700});
const codepoints=(value,max)=>Array.from(value).slice(0,max).join('');
const cleanText=value=>String(value||'').trim().replace(/^```(?:json|text)?/i,'').trim().replace(/```$/,'').trim();
const quoteStrip=value=>value.replace(/^[\s\"'“”]+|[\s\"'“”]+$/g,'');
export function canonicalizeXiaotaoV3StyleIntent(raw) {
  if(raw?.kind==='aifx-material-supplement') {
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['mode','requestId','kind','images','supplement'].includes(k))||raw.mode!=='style-analysis')fail();
    const material=canonicalizeXiaotaoV3StyleIntent({mode:raw.mode,requestId:raw.requestId,kind:'aifx-material',images:raw.images});
    const supplement=canonicalizeXiaotaoV3StyleIntent({mode:raw.mode,requestId:raw.requestId,kind:'aifx-supplement',supplement:raw.supplement});
    const intent={mode:raw.mode,requestId:raw.requestId,kind:raw.kind,images:material.intent.images,supplement:supplement.intent.supplement};
    const stages=[material.compiled,supplement.compiled];
    const intentHash=hash({schema:'nf.xiaotao.operation.style-material-supplement.v1',materialIntentHash:material.intentHash,supplementIntentHash:supplement.intentHash});
    return {intent,intentHash,compiled:{stages,imageCount:1,textOnly:false,outputTokens:stages[0].outputTokens+stages[1].outputTokens}};
  }
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['mode','requestId','kind','images','supplement'].includes(k))||raw.mode!=='style-analysis'||!/^[A-Za-z0-9_-]{8,128}$/.test(raw.requestId||'')||!['style','aifx-material','aifx-supplement','ui-inventory'].includes(raw.kind))fail();
  const imageRole=raw.kind==='style'?'style':raw.kind==='ui-inventory'?'reference':'material';
  const textOnly=raw.kind==='aifx-supplement';
  if(textOnly ? (Object.hasOwn(raw,'images')||typeof raw.supplement!=='string'||!flat(raw.supplement)||raw.supplement.length>12000) :
    (Object.hasOwn(raw,'supplement')||!Array.isArray(raw.images)||raw.images.length!==1||!raw.images[0]||Object.keys(raw.images[0]).some(k=>!['role','dataUrl'].includes(k))||raw.images[0].role!==imageRole))fail();
  const intent=textOnly?{mode:raw.mode,requestId:raw.requestId,kind:raw.kind,supplement:codepoints(flat(raw.supplement),400)}:{mode:raw.mode,requestId:raw.requestId,kind:raw.kind,images:[{role:raw.images[0].role,dataUrl:raw.images[0].dataUrl}]};
  const systemText=textOnly?EFFECT_SUPPLEMENT_SYSTEM_TEXT:raw.kind==='style'?ART_STYLE_SYSTEM_TEXT:raw.kind==='ui-inventory'?UI_INVENTORY_SYSTEM_TEXT:EFFECT_MATERIAL_SYSTEM_TEXT;
  const userText=textOnly?EFFECT_SUPPLEMENT_QUESTION+'「'+intent.supplement+'」':raw.kind==='style'?ART_STYLE_QUESTION:raw.kind==='ui-inventory'?UI_INVENTORY_QUESTION:EFFECT_MATERIAL_QUESTION;
  let content=[{type:'input_text',text:userText}];
  if(!textOnly) {
    // Reuse native bounded image and magic-byte validation. The validated original
    // bytes and role are bound by the intent hash, not stored in the ledger.
    const validated=companionInput({mode:'chat',requestId:raw.requestId,message:userText,images:[{role:raw.kind==='style'?'style':'reference',dataUrl:intent.images[0].dataUrl}]});
    content=validated.input.at(-1).content;
    // The purpose is assigned by the client, not inferred or renamed by the model.
    content[1]={type:'input_text',text:raw.kind==='style'?'Image 1: style reference.':raw.kind==='ui-inventory'?'Image 1: game UI screen to read.':'Image 1: effect material reference.'};
    validateStyleImageSize(intent.images[0].dataUrl);
  }
  const compiled={input:[{role:'system',content:[{type:'input_text',text:systemText}]},{role:'user',content}],imageCount:textOnly?0:1,textOnly,systemText,userText,outputTokens:STYLE_OUTPUT_TOKENS[raw.kind]};
  return {intent,compiled,intentHash:hash({schema:'nf.xiaotao.operation.style.v1',intent,systemText,userText,outputTokens:STYLE_OUTPUT_TOKENS[raw.kind]})};
}
export function inspectXiaotaoV3StyleReply({kind,reply}) {
  if(typeof reply!=='string'||!reply.trim()||reply.length>12000)fail();
  if(kind==='style') {
    const rawStyle=codepoints(flat(reply),800);
    let value=flat(cleanText(reply));if(value.startsWith('{')){try {const obj=JSON.parse(value);if(obj&&!Array.isArray(obj)&&typeof obj==='object')value=Object.values(obj).find(x=>typeof x==='string'&&x.trim())?.trim()||value;}catch{}}
    value=quoteStrip(value).replace(/^(?:instruction|style|answer)\s*:\s*/i,'');value=quoteStrip(value);
    let [medium,...rest]=value.split(':');
    if(rest.length) {let marks=rest.join(':').replace(/\b(?:red|orange|yellow|gold|golden|green|blue|purple|violet|pink|brown|beige|grey|gray|silver|white|black|cyan|teal|crimson|scarlet)(?:\s+and\s+(?:red|orange|yellow|gold|golden|green|blue|purple|violet|pink|brown|beige|grey|gray|silver|white|black|cyan|teal|crimson|scarlet))?\s+(?=[a-z])/ig,'');value=medium+':'+marks;}
    value=value.replace(/\s+(?:without|with no)\s+[^,;.]+/ig,'');
    const clauses=value.replace(/[.\s]+$/,'').split(/[,;]/).map(x=>x.trim());
    const kept=clauses.filter(x=>x&&!/^(?:(?:and|but|with)\s+)?(?:no|not|without|avoid|avoiding|never|free of)\b/i.test(x));
    if(kept.length&&kept.length<clauses.length)value=kept.join(', ')+'.';
    [medium,...rest]=value.split(':');
    if(rest.length&&/\b(?:photo\w*|hyper-?realistic|realistic\s+(?:3d|cg))/i.test(medium)) {const marks=[...new Set(rest.join(':').replace(/[.\s]+$/,'').split(/[,;]/).map(x=>/\b(?:flat|uniform)\b/i.test(x)?'true-to-life fine surface detail':x.trim()).filter(Boolean))];if(marks.length)value=medium+': '+marks.join(', ')+'.';}
    value=flat(value);if(!value||/[\u3400-\u9fff]/.test(value))fail();return {style:codepoints(value[0].toUpperCase()+value.slice(1),400),rawStyle};
  }
  if(kind==='ui-inventory') {const inventory=cleanText(reply).split(/\r?\n/).map(flat).filter(Boolean).join('\n');if(!/[\u3400-\u9fff]/.test(inventory))fail();return {inventory:codepoints(inventory,1500),rawInventory:codepoints(flat(reply),2000)};}
  if(kind==='aifx-supplement') {const supplement=flat(reply).replace(/^[\s"'“”]+|[\s"'“”]+$/g,'');if(!supplement||/[\u3400-\u9fff]/.test(supplement))fail();return {supplement:codepoints(supplement,600)};}
  if(kind!=='aifx-material')fail();
  let parsed;try {const match=reply.match(/\{[\s\S]*\}/);parsed=JSON.parse(match?.[0]);}catch{fail();}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail();
  const candidate=parsed.elements??parsed.material;
  const english=value=>typeof value==='string'&&/[A-Za-z]/.test(value)&&Array.from(value).every(ch=>!/\p{L}/u.test(ch)||/\p{Script=Latin}/u.test(ch));
  if(!english(candidate)||!flat(candidate))fail();
  for(const key of ['name','colours','colors','breakup'])if(parsed[key]!=null && (typeof parsed[key]!=='string'||(flat(parsed[key])&&!english(parsed[key]))))fail();
  const name=codepoints(flat(parsed.name).toUpperCase(),40)||'REFERENCE';let elements=flat(candidate);
  if(!/^made of\b/i.test(elements))elements='made of '+elements;
  elements=elements.replace(/^(made of\s+)(?:(?:a\s+)?(?:single|pair of|couple of)|one|two|three|four|five|several)\s+/i,'$1');
  const exclusions=[];
  for(const [key,value] of Object.entries(parsed)) {
    if(['name','elements','material','colours','breakup'].includes(key)||!/^\s*NO\b/i.test(String(value||'')))continue;
    // Only validated English strings may be appended to the executable prompt.
    // Require words after NO, not merely the prefix or punctuation.
    if(typeof value!=='string'||!english(value)||!english(flat(value).replace(/^NO\b/i,'').trim()))fail();
    exclusions.push(flat(value).replace(/[ .]+$/,'')+'.');
  }
  elements=codepoints([elements.replace(/[ .]+$/,'')+'.',...exclusions].join(' '),500);
  const colours=codepoints(flat(parsed.colours||parsed.colors).split(/,|;|\band\b/i).map(flat).filter(c=>c&&!['black','dark','background'].includes(c.toLowerCase())).join(', '),120);
  let breakup=flat(parsed.breakup);if(!breakup.startsWith('It '))breakup='';
  const material=codepoints([elements,colours?'Main colours: '+colours+'.':'',EFFECT_MATERIAL_DEFAULT_ARRANGEMENT].filter(Boolean).join(' '),900);
  return {material:{name,material,elements,colours,breakup:codepoints(breakup,200)},rawMaterial:codepoints(flat(reply),1200)};
}
