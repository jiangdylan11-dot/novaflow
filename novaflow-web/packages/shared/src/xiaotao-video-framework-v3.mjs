// Server-owned, text-only H3 draft contract. It does not analyse media, apply
// a prompt, or start generation. Each request receives an isolated H3 factory.
import {createHash} from 'node:crypto';
import {createH3Workflow} from './xiaotao-h3-factory-v3.mjs';
import {companionInput} from './companion-chat.mjs';

const FIELDS=new Set(['mode','requestId','h3Mode','durationSeconds','prompt','requirements','references','images']);
const REF_FIELDS=new Set(['key','kind','sourceId']);
const MODES=new Set(['text_video','image_video','first_last','multi_reference']);
const KINDS=new Set(['image','video','audio']);
const invalid=()=>{throw Object.assign(new Error('video-intent-unsupported'),{code:'video-intent-unsupported',statusCode:400});};
const plain=x=>x && typeof x==='object' && !Array.isArray(x);
const digest=x=>createHash('sha256').update(JSON.stringify(x),'utf8').digest('hex');

export function createServerOwnedH3Intent({workflow}={}) {
  if(!workflow || typeof workflow.prepareRequest!=='function' || typeof workflow.toModelReferences!=='function' || typeof workflow.validateAndRestore!=='function')
    throw new TypeError('trusted H3 workflow is required');
  function canonicalize(raw,{visionEnabled=false}={}) {
    if(!plain(raw)||Object.keys(raw).some(k=>!FIELDS.has(k))||raw.mode!=='video-rewrite'||
      typeof raw.requestId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(raw.requestId)||!MODES.has(raw.h3Mode)||
      typeof raw.durationSeconds!=='number'||!Number.isFinite(raw.durationSeconds)||raw.durationSeconds<1||raw.durationSeconds>30||
      typeof raw.prompt!=='string'||!raw.prompt.trim()||raw.prompt.length>1500||
      (raw.requirements!==undefined&&(typeof raw.requirements!=='string'||raw.requirements.length>1000))||
      !Array.isArray(raw.references)||raw.references.length>15) invalid();
    // Reference slots are text bindings only: this prototype accepts no image,
    // audio, video bytes or URLs and must not claim to have analysed media.
    const refs=raw.references.map(ref=>{
      if(!plain(ref)||Object.keys(ref).some(k=>!REF_FIELDS.has(k))||
        typeof ref.key!=='string'||!ref.key||ref.key.length>80||!KINDS.has(ref.kind)||
        typeof ref.sourceId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(ref.sourceId))invalid();
      return {key:ref.key,kind:ref.kind,sourceId:ref.sourceId};
    });
    const prompt=raw.prompt.trim(),requirements=(raw.requirements||'').trim();
    if(/data:(?:image|audio|video)\//i.test(prompt+' '+requirements))invalid();
    let images,validatedImages;
    if(Object.hasOwn(raw,'images')){
      const frames=raw.h3Mode==='first_last'?['first_frame','last_frame']:raw.h3Mode==='image_video'?['first_frame']:null;
      if(visionEnabled!==true||!frames||!Array.isArray(raw.images)||raw.images.length!==frames.length||refs.filter(ref=>ref.kind==='image').length!==frames.length)invalid();
      images=frames.map(key=>{
        const slots=refs.filter(ref=>ref.key===key&&ref.kind==='image');
        const input=raw.images.filter(image=>plain(image)&&image.key===key);
        if(slots.length!==1||input.length!==1||Object.keys(input[0]).some(k=>!['key','dataUrl'].includes(k))||typeof input[0].dataUrl!=='string')invalid();
        return {key,dataUrl:input[0].dataUrl};
      });
      // Reuse the established image byte/MIME/20 MiB validation; the resulting
      // image parts, not caller-supplied metadata, are sent to the provider.
      try {validatedImages=companionInput({mode:'chat',requestId:raw.requestId,message:'Validate H3 reference images.',promptLanguage:'en',images:images.map(image=>({role:'reference',dataUrl:image.dataUrl}))});}
      catch {invalid();}
      if(validatedImages.imageCount!==images.length||validatedImages.textOnly!==false)invalid();
    }
    const intent={mode:'video-rewrite',requestId:raw.requestId,h3Mode:raw.h3Mode,durationSeconds:raw.durationSeconds,prompt,requirements,references:refs,...(images?{images}:{})};
    const current={modelId:workflow.MINIMAX_H3_MODEL_ID,mode:intent.h3Mode,durationSeconds:intent.durationSeconds,
      prompt:intent.prompt,requirements:intent.requirements,resources:intent.references,contentPolicy:{}};
    let prepared;
    try {prepared=workflow.prepareRequest(current);} catch {invalid();}
    // Source is untrusted user input, so do not put it inside system text.
    const suffix='Source prompt:\n'+prepared.prompt;
    if(!prepared.requirements.endsWith(suffix))invalid();
    const systemText=prepared.requirements.slice(0,-suffix.length).trim()+(images?
      (images.length===2?'\nThe first supplied image is the first frame and the second is the last frame. Preserve their distinct roles.':'\nThe supplied image is the opening frame.')+' Describe only visible details; do not claim to hear audio.' :
      '\nReference labels identify slots only; no reference media has been analysed. Never invent unseen visual or audio facts.');
    let additional;
    try {additional=workflow.toModelReferences(requirements,prepared.protocol.references);} catch {invalid();}
    const userText='Source prompt:\n'+prepared.prompt+(additional?'\n\nUser requirements:\n'+additional:'');
    const imageParts=images?validatedImages.input.at(-1).content.filter(part=>part.type==='input_image'):[];
    const userContent=[{type:'input_text',text:userText},...(images?[
      {type:'input_text',text:'First frame image:'},imageParts[0],...(imageParts[1]?[{type:'input_text',text:'Last frame image:'},imageParts[1]]:[])
    ]:[])];
    const compiled={input:[{role:'system',content:[{type:'input_text',text:systemText}]},
      {role:'user',content:userContent}],imageCount:images?images.length:0,textOnly:!images,systemText,userText,
      // A draft is written twice (English and Chinese); 1200 tokens cut wordier models off and it failed its checks.
      outputTokens:3000};
    const intentHash=digest({schema:images?'nf.xiaotao.operation.video-h3-vision.v1':'nf.xiaotao.operation.video-h3-text.v1',intent});
    return {intent,compiled,intentHash,validation:{context:prepared.context,current}};
  }
  function validateResult(text, rawIntent, expectedIntentHash) {
    if(typeof text!=='string'||!text.trim()||text.length>12000||typeof expectedIntentHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedIntentHash))invalid();
    // Reconstruct from the signed request; never trust a client-supplied
    // validation context. The caller must verify the ticket before passing
    // its expected hash here. A live editor must independently check staleness
    // and obtain user confirmation before applying the returned draft.
    const trusted=canonicalize(rawIntent,{visionEnabled:true});if(trusted.intentHash!==expectedIntentHash)invalid();
    // Some providers wrap an otherwise valid response in one Markdown JSON
    // fence. Unwrap only a complete, standalone fence; never extract JSON from
    // surrounding prose or relax the H3 schema and semantic validation.
    const fence=text.trim().match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
    const content=fence?fence[1]:text;
    let pair;try{pair=JSON.parse(content);}catch{invalid();}
    if(!plain(pair)||!Object.hasOwn(pair,'modelPrompt')||!Object.hasOwn(pair,'displayPrompt')||
      Object.keys(pair).some(key=>!['modelPrompt','displayPrompt','editPolicy'].includes(key)))invalid();
    try {return workflow.validateAndRestore({text:content,context:trusted.validation.context,current:trusted.validation.current});} catch {invalid();}
  }
  return Object.freeze({canonicalize,validateResult});
}

export function canonicalizeXiaotaoV3VideoIntent(raw,options) {
  return createServerOwnedH3Intent({workflow:createH3Workflow()}).canonicalize(raw,options);
}

export function inspectXiaotaoV3VideoReply({intent,intentHash,reply}={}) {
  const adapter=createServerOwnedH3Intent({workflow:createH3Workflow()});
  const result=adapter.validateResult(reply,intent,intentHash);
  const display=String(result?.text||'').trim(),model=String(result?.modelText||'').trim();
  if(!display||!model||display.length>12000||model.length>12000)invalid();
  // H3 permits Chinese only in literal dialogue/onscreen text. Never claim
  // successful English compilation when untranslated prose remains.
  if(/[\u3400-\u9fff]/.test(model.replace(/<d>[\s\S]*?<\/d>|"([^"\n]*)"|“([^”\n]*)”/g,'')))invalid();
  return {displayPrompt:display,modelPrompt:model,h3Mode:intent.h3Mode,durationSeconds:intent.durationSeconds,textOnly:!Array.isArray(intent.images)};
}
