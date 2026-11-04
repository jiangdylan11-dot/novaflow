import {validateQwenReadonlyFoartPlan,validateQwenSeekCandidate,QWEN_SEEK_CANDIDATE_SCHEMA} from '../../packages/shared/src/foart-tool-plan.mjs';

// Requests without a selection must not silently load the retired Next model.
// Never substitute another local model or send paid model IDs locally.
export function localModelSelectionFailure(payload, { gemmaAvailable = false, qwenAvailable = false } = {}) {
  const id = payload?.modelId;
  if (id === undefined) return {ok:false,errorCode:'local-model-selection-required',error:'请先选择小桃 AI 模型；本次未加载模型或扣除积分。'};
  if (id === 'next') return {ok:false,errorCode:'local-model-retired',error:'此前本地模型已移除，请主动选择其他模型；未提交、不扣积分。'};
  if (id === 'gemma-4-12b-it' && gemmaAvailable) return null;
  if (id === 'qwen3.5-9b-heretic' && qwenAvailable) return null;
  return {
    ok: false,
    errorCode: 'local-model-unavailable',
    error: id === 'gemma-4-12b-it'
      ? 'Gemma 4 12B 本地运行环境尚未就绪，当前无法使用。'
      : id === 'qwen3.5-9b-heretic'
        ? 'Qwen 3.5 9B 本地模型、视觉投影或运行器尚未配置完整，当前无法使用。'
        : '所选模型不能通过当前本地模型运行。',
  };
}

// Dedicated assistant selection must never reuse modelId, which legacy drawing
// requests may use for their generation model. Absence must not select Next.
export function businessAssistantSelection(payload,{qwenBridgeEnabled=false}={}) {
  const selected=Object.hasOwn(payload || {},'assistantModelId') || Object.hasOwn(payload || {},'assistantProvider');
  if(!selected)return {kind:'rejected',errorCode:'assistant-model-selection-required',error:'请先选择小桃 AI 模型；本次未加载模型或扣除积分。'};
  if(payload.assistantProvider!=='local' || payload.assistantModelId!=='qwen3.5-9b-heretic')
    return {kind:'rejected',errorCode:'assistant-business-model-unavailable',error:'所选大脑尚未接入此业务，本次未调用模型或扣积分。'};
  if(!qwenBridgeEnabled)return {kind:'rejected',errorCode:'qwen-business-unavailable',error:'本地 Qwen 此业务尚未启用，本次未调用模型。'};
  // Account-scoped experience is currently authorized only by the drawing
  // agent. Do not silently drop it or borrow another model's identity.
  if([payload,payload.artContext].some(source=>source && typeof source==='object'
      && ['experienceContext','experiences','knowledge','knowledgeVersion','learningContext'].some(key=>Object.hasOwn(source,key))))
    return {kind:'rejected',errorCode:'assistant-business-experience-unavailable',error:'此业务的账号经验上下文尚未接入，本次未调用模型。'};
  const files=['uploads','attachments','images','files','references'].flatMap(key=>Array.isArray(payload[key])?payload[key]:[]);
  const timeMedia=files.some(file=>/^(audio|video)(?:\/|$)/i.test(String(file?.kind || file?.type || ''))
    || /^data:(audio|video)\//i.test(String(file?.dataUrl || ''))
    || /\.(?:mp4|m4v|mov|webm|avi|mkv|mp3|wav|m4a|aac|ogg|flac|opus)(?:$|[?#])/i.test(String(file?.name || '')));
  const embeddedTimeMedia=['input','text','prompt','requirements','message'].some(key=>/(?:^|\s)data:(?:audio|video)\//i.test(String(payload[key] || '')));
  if(timeMedia || embeddedTimeMedia || payload.audioDataUrl || payload.videoDataUrl)
    return {kind:'rejected',errorCode:'qwen-business-modality-unavailable',error:'本地 Qwen 此线路暂不支持分析音频或视频附件，未调用模型。'};
  return {kind:'qwen'};
}

// The packaged trial may opt into only the two locally verified text tasks.
// Inspect the original request before any normalizer can discard attachments.
export function qwenTextBusinessFailure(method,payload={}) {
  const unavailable={ok:false,errorCode:'qwen-business-text-only',error:'当前 Qwen 仅支持纯文字绘图、视频提示词优化和音频文字改写；图片或音视频素材分析尚未开放，本次未提交。'};
  if(method!=='optimizePrompt' && method!=='rewriteAudioPrompt')return unavailable;
  const artText=payload.surface==='art' && payload.purpose==='optimize' && payload.targetEngine==='qwen-2.1' && payload.qwenPromptMode==='txt2img';
  const h3Text=payload.surface==='animation' && payload.purpose==='minimax-h3-prompt-enhance' &&
    ['text_video','image_video','first_last','multi_reference'].includes(payload.h3Mode);
  if(method==='optimizePrompt' && !artText && !h3Text)return unavailable;
  const mediaKeys=new Set(['uploads','attachments','files','images','image','imageurl','imageurls','imagedata','imagedataurl','imagedataurls',
    'photo','photos','picture','pictures','references','referenceimages','referenceimage','referenceimageurl','referenceimageurls',
    'referenceframes','h3referenceframes','videoframes','audio','video','audiodataurl','videodataurl','media','mediadataurl']);
  const stack=[[payload,0]],seen=new Set();let nodes=0;
  while(stack.length){
    const [value,depth]=stack.pop();if(++nodes>1000 || depth>16)return unavailable;
    if(typeof value==='string'){
      if(/data:(?:image|audio|video)\//i.test(value) || /<image\s*\d+>|@(?:参考图|reference\s*image)\s*\d+|__NOVAFLOW_RESOURCE_MENTION_[A-Z0-9_:-]+__/i.test(value))return unavailable;
      continue;
    }
    if(!value || typeof value!=='object')continue;
    if(seen.has(value))return unavailable;seen.add(value);
    if(Array.isArray(value)){for(const item of value)stack.push([item,depth+1]);continue;}
    for(const [key,item] of Object.entries(value)){
      const normalized=key.toLowerCase().replace(/[_-]/g,'');
      if(mediaKeys.has(normalized) && item!=null && item!=='' && (!Array.isArray(item)||item.length>0))return unavailable;
      if((normalized==='type'||normalized==='kind') && typeof item==='string' && /^(?:image|audio|video)(?:\/|$)/i.test(item))return unavailable;
      stack.push([item,depth+1]);
    }
  }
  return null;
}

// The animation-only planner does not receive image, audio, video or file
// payloads. Check the original object before a normalizer can discard them.
export function qwenFoartHasMedia(payload) {
  if(Object.hasOwn(payload||{},'images')&&!Array.isArray(payload.images))return true;
  const mediaKeys=new Set(['images','image','imageurl','imageurls','imagedata','imagedataurl','previewimage','photo','photos',
    'picture','pictures','uploads','attachments','files','references','referenceimages','referenceimage','referenceimageurl',
    'referenceframes','h3referenceframes','videoframes','audio','video','audiodataurl','videodataurl','dataurl']);
  const stack=[[payload,0]],seen=new Set();let nodes=0;
  while(stack.length){
    const [value,depth]=stack.pop();if(++nodes>10000||depth>20)return true;
    if(typeof value==='string'){if(/data:(?:image|audio|video)\/|blob:/i.test(value))return true;continue;}
    if(!value||typeof value!=='object')continue;
    if(seen.has(value))return true;seen.add(value);
    if(Array.isArray(value)){for(const item of value)stack.push([item,depth+1]);continue;}
    for(const [key,item] of Object.entries(value)){
      const normalized=key.toLowerCase().replace(/[_-]/g,'');
      if(mediaKeys.has(normalized)&&item!=null&&item!==''&&(!Array.isArray(item)||item.length>0))return true;
      if((normalized==='type'||normalized==='kind')&&typeof item==='string'&&/^(?:image|audio|video)(?:\/|$)/i.test(item))return true;
      stack.push([item,depth+1]);
    }
  }
  return false;
}

// The following strict Qwen-only read/candidate boundary does not authorize edits.
// This is independent of the resource ownership guard: passing either guard
// never implies that the other one has passed.
export function communityTrialCapabilityFailure(payload, { isolatedTest = false } = {}) {
  if (isolatedTest || !['gemma-4-12b-it', 'qwen3.5-9b-heretic'].includes(payload?.modelId)) return null;
  const hasUnsupportedMedia = Array.isArray(payload?.uploads) && payload.uploads.some(file => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) return true;
    const kind = String(file.kind || ''), type = String(file.type || ''), name = String(file.name || '');
    if (/^(audio|video)(?:\/|$)/i.test(kind) || /^(audio|video)\//i.test(type)
        || /\.(?:mp4|m4v|mov|webm|avi|mkv|gif|mp3|wav|m4a|aac|ogg|flac|opus|aiff?)(?:$|[?#])/i.test(name)) return true;
    return !(/^image$/i.test(kind) || /^image\/(?:png|jpe?g|webp)$/i.test(type)
      || /\.(?:png|jpe?g|webp)(?:$|[?#])/i.test(name));
  });
  if (payload?.mode === 'chat' && !hasUnsupportedMedia) return null;
  if(payload?.modelId==='qwen3.5-9b-heretic'&&payload?.mode==='foart'&&!hasUnsupportedMedia&&!qwenFoartHasMedia(payload)
    &&(payload?.foartAnimationStage===undefined||payload.foartAnimationStage==='seek_candidate')
    &&payload?.foartContext?.animation?.active===true&&payload?.foartContext?.animation?.loaded===true
    &&!payload?.foartContext?.media?.active)return null;
  return { ok: false, errorCode: 'community-trial-capability-unavailable',
    error: payload?.modelId==='qwen3.5-9b-heretic'
      ? '当前本地模型仅支持文字和图片对话、动画工程只读查询及时间轴候选；骨骼选择、其他操作和音视频分析尚未开放。'
      : '当前社区模型仅可用于文字和图片对话，工具操作及音视频分析尚未开放。' };
}

export function communityTrialResponseFailure(payload, data, { isolatedTest = false } = {}) {
  if (isolatedTest || !['gemma-4-12b-it', 'qwen3.5-9b-heretic'].includes(payload?.modelId)) return null;
  if (payload?.mode === 'chat' && data && typeof data === 'object'
      && !data.proposal && !data.mediaPlan && !data.toolPlan && !Object.hasOwn(data,'seekCandidate') && !data.selectionCandidate
      && Array.isArray(data.toolTrace) && data.toolTrace.length === 0) return null;
  if(payload?.modelId==='qwen3.5-9b-heretic'&&payload?.mode==='foart'&&payload?.foartAnimationStage==='seek_candidate'
    &&data&&typeof data==='object'&&!Array.isArray(data)&&data.mode==='foart'
    &&Object.keys(data).every(k=>['mode','reply','seekCandidateStatus','seekCandidate','model','toolTrace','history'].includes(k))
    &&data.model==='qwen35-heretic'&&Array.isArray(data.toolTrace)&&data.toolTrace.length===0
    &&data.reply===(data.seekCandidateStatus==='candidate'?'已提出时间轴候选，请预览并由你确认；尚未移动。':'请明确说明要跳转到第几帧；尚未移动时间轴。')){
    try{validateQwenSeekCandidate({schema:QWEN_SEEK_CANDIDATE_SCHEMA,status:data.seekCandidateStatus,reply:data.reply,seekCandidate:data.seekCandidate},payload.foartContext,payload.message);return null;}catch{}
  }
  if(payload?.modelId==='qwen3.5-9b-heretic'&&payload?.mode==='foart'&&payload?.foartAnimationStage===undefined
    &&data&&typeof data==='object'&&!Array.isArray(data)&&data.mode==='foart'&&!data.proposal&&!data.mediaPlan&&!data.selectionCandidate
    &&!Object.hasOwn(data,'seekCandidate')&&Array.isArray(data.toolTrace)&&data.toolTrace.length===0){
    try{validateQwenReadonlyFoartPlan(data.toolPlan,payload.foartContext);return null;}catch{}
  }
  return { ok: false, errorCode: 'community-trial-response-rejected',
    error: '当前社区模型只允许返回对话内容，未执行任何工具操作。' };
}
