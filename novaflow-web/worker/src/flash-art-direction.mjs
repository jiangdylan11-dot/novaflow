import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateArtSkill } from './art-skill-service.mjs';

export const FLASH_ART_KIND = 'qwen21-strata-native';
export const FLASH_ART_VERSION = 'flash-native-v1';
export const FLASH_ART_SYSTEM_SHA256 = 'fac8d2aad6988ed1feffa0234ceef61a6269402c68b52f614098e894901ea4be';
export const FLASH_ART_BASE_SKILL = validateArtSkill(JSON.parse(readFileSync(new URL('./art-skills/style-transfer.v1.json', import.meta.url), 'utf8')));
export const FLASH_ART_SYSTEM = FLASH_ART_BASE_SKILL.systemPrompt;
const SCHEMA = 'nf.art.direction.v1';
const MAX_IMAGE_BYTES = 24 * 1024 * 1024, MAX_TOTAL_BYTES = 48 * 1024 * 1024;
const classes = new Set(['anime', 'animated-3d', 'painterly', 'other']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code, message) { throw Object.assign(new Error(message), { code, errorCode: code }); }
function requireValue(condition, code, message) { if (!condition) fail(code, message); }
const roles = ref => Array.isArray(ref?.roles) ? ref.roles : typeof ref?.role === 'string' ? [ref.role] : [];

/** Other image roles, text-only requests and other business protocols keep their
 * existing Flash-backed planners. This is only the explicit whole-image pair. */
export function isFlashArtDirectionRequest(payload) {
  const refs = payload?.artContext?.references;
  return payload?.surface === 'art' && payload.purpose === 'art-director' && payload.nsfw !== true
    && payload.visualSchema === SCHEMA && ['', 'auto', 'style'].includes(payload.artContext?.task || '')
    && Array.isArray(payload.images) && payload.images.length === 2 && Array.isArray(refs) && refs.length === 2
    && refs.every(ref => roles(ref).length === 1)
    && refs.map(ref => roles(ref)[0]).sort().join(',') === 'style,subject';
}

function imageInput(image, ref, index) {
  requireValue(object(image) && Number.isInteger(ref.source) && ref.source >= 1 && ref.source <= 16,
    'strata-art-invalid-input', '完整参考图或原始编号无效');
  const role = roles(ref)[0];
  requireValue(!ref.excludedRoles?.includes(role), 'strata-art-invalid-input', '参考图职责与排除用途冲突');
  const match = typeof image.dataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
  requireValue(match && match[2].length % 4 === 0 && match[2].length <= Math.ceil(MAX_IMAGE_BYTES / 3) * 4,
    'strata-art-invalid-input', '参考图必须是完整且有界的 PNG、JPEG 或 WebP 原图');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  requireValue(valid && bytes.length <= MAX_IMAGE_BYTES && bytes.toString('base64') === match[2],
    'strata-art-invalid-input', '参考图类型或完整编码无效；未缩放或截断');
  requireValue(image.name === undefined || typeof image.name === 'string' && image.name.length <= 240 && !/[\u0000-\u001f]/.test(image.name),
    'strata-art-invalid-input', '参考图名称无效');
  return { source:ref.source, role, originalIndex:index, mime:'image/'+match[1], bytes:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex'), dataUrl:image.dataUrl,
    name:image.name || `reference_${ref.source}_${role}.${match[1] === 'jpeg' ? 'jpg' : match[1]}` };
}

function literalText(value, label, max) {
  requireValue(value === undefined || typeof value === 'string', 'strata-art-invalid-input', `${label}格式无效`);
  const text = value || '';
  requireValue(text.length <= max && !/data:image\//i.test(text), 'strata-art-invalid-input', `${label}过长或包含图片编码`);
  return text;
}

/** Returns a pre-release producer envelope. The caller MUST append trusted
 * analysisBackend/modelIdentity/resourcesReleased/generationReady to data and
 * editEnhancer only after its outer owned session has successfully released. */
export async function planFlashArtDirection({ payload, flash } = {}) {
  requireValue(isFlashArtDirectionRequest(payload), 'strata-art-unsupported-task', '此原生线路仅接受明确的主体与画风完整双图');
  requireValue(typeof flash?.infer === 'function' && typeof flash?.identity?.id === 'string' && flash.identity.id,
    'strata-art-session-required', '缺少已核验的 Flash 会话');
  requireValue(createHash('sha256').update(FLASH_ART_SYSTEM,'utf8').digest('hex') === FLASH_ART_SYSTEM_SHA256,
    'strata-art-protocol-invalid', '原生画风协议与冻结系统不一致');
  const context = payload.artContext;
  const inputs = payload.images.map((image,index)=>imageInput(image,context.references[index],index))
    .sort((a,b)=>Number(b.role === 'subject')-Number(a.role === 'subject'));
  requireValue(new Set(inputs.map(image=>image.source)).size === 2 && inputs.reduce((sum,image)=>sum+image.bytes,0) <= MAX_TOTAL_BYTES,
    'strata-art-invalid-input', '参考编号重复或完整图片总大小超过上限');
  const prompt = literalText(payload.currentPrompt ?? payload.prompt, '用户提示词', 20000);
  const requirements = literalText(payload.requirements, '补充要求', 20000);
  const negativePrompt = literalText(payload.negativePrompt, '用户反向提示词', 12000);
  const hasNegativePrompt = negativePrompt.trim().length > 0;
  const canvas = {};
  for (const key of ['width','height']) {
    const value = context[key];
    requireValue(value === undefined || Number.isInteger(value) && value >= 32 && value <= 8192,
      'strata-art-invalid-input', '输出画布尺寸无效');
    if (value !== undefined) canvas[key] = value;
  }
  const inputSources = inputs.map(image=>image.source);
  const remap = text => text.replace(/<image(\d+)>|(?:@?参考图|图片|图|image)\s*(\d+)/gi,(all,marker,number)=>{
    const index = inputSources.indexOf(Number(marker || number)); return index < 0 ? all : `<image${index+1}>`;
  });
  const negativeContext = hasNegativePrompt ? remap(negativePrompt) : '';
  const user = 'Use the two complete images actually supplied in this order: <image1> is the original content source; <image2> is only the artistic rendering reference.\n'
    + JSON.stringify({ userRequest:remap(prompt), requirements:remap(requirements), canvas,
      actualInputRoles:inputs.map((image,index)=>({image:`<image${index+1}>`,originalSource:image.source,role:image.role})),
      ...(hasNegativePrompt ? { currentNegativePrompt:negativeContext,negativePromptSource:'unknown',
        negativePromptUsage:'These are the current image-generation exclusions, not objects to draw. Their origin is unknown; do not claim the user personally wrote them. Do not clear or rewrite them. Use this context to keep the positive execution brief consistent with the current exclusions.' } : {}) });
  const result = await flash.infer({ system:FLASH_ART_SYSTEM,user,images:inputs.map(image=>({dataUrl:image.dataUrl,name:image.name})),
    maxTokens:4096,temperature:.4,stage:'art-style-native-art-direction-v1' });
  requireValue(result?.model === flash.identity.id && typeof result.requestId === 'string' && result.requestId && result.requestId.length <= 240,
    'strata-art-identity-mismatch', '原生绘图回答的模型或请求身份无效');
  requireValue(typeof result.text === 'string', 'strata-art-invalid-response', 'Flash 未返回完整原生 JSON');
  let answer;
  try { answer = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*|\s*```$/g,'')); }
  catch { fail('strata-art-invalid-response', 'Flash 原生绘图回答不是有效 JSON；本次未重试'); }
  const renderingClass = answer?.renderingClass === undefined ? 'other' : answer.renderingClass;
  requireValue(object(answer) && typeof answer.prompt === 'string' && answer.prompt.trim() && answer.prompt.length <= 12000
    && typeof answer.sourceContent === 'string' && answer.sourceContent.trim() && answer.sourceContent.length <= 3000
    && classes.has(renderingClass), 'strata-art-invalid-response', 'Flash 原生绘图回答缺少完整正文或有效类型');
  const slots = [...answer.prompt.matchAll(/<image(\d+)>/g)].map(match=>Number(match[1]));
  requireValue(slots.includes(1) && slots.includes(2) && slots.every(slot=>slot === 1 || slot === 2),
    'strata-art-invalid-response', '原生正文没有使用本次实际双图编号');
  // sourceContent is retained as native evidence only. No exact-phrase include
  // gate, concatenation, color cleanup, second model call or shortened rewrite.
  const enhancer = { kind:FLASH_ART_KIND,version:FLASH_ART_VERSION,model:result.model,prompt:answer.prompt,
    renderingClass,sourceOrder:inputSources,promptIds:[result.requestId],
    providerPolicy:{schema:'nf.qwen21-native-provider.v1',cfg:3} };
  return { visualSchema:SCHEMA,rawOutput:result.text,
    artDirection:{schema:SCHEMA,summary:'Flash 单轮完整画风重绘',prompt:answer.prompt,
      references:inputs.map(image=>({source:image.source,uses:[{role:image.role,detail:image.role === 'subject'
        ? '完整内容原图，提供实际主体、主要关系与原场景' : '完整画风原图，仅提供实际绘画技法与光色关系',box:[0,0,1000,1000],samples:[]}],omit:[]})),
      preserve:[],exclude:[],clarification:'',editEnhancer:enhancer},
    nativeAnalysis:{schema:'nf.flash.art-native-analysis.v1',systemSHA256:FLASH_ART_SYSTEM_SHA256,requestId:result.requestId,
      model:result.model,sourceContent:answer.sourceContent,inputSources,
      renderingClassMetadata:{value:renderingClass,source:answer.renderingClass===undefined?'program-default-missing':'model'},
      ...(hasNegativePrompt ? { negativePromptContext:{provided:true,source:'unknown',
        inputSHA256:createHash('sha256').update(negativePrompt,'utf8').digest('hex'),
        modelContextSHA256:createHash('sha256').update(negativeContext,'utf8').digest('hex')} } : {}),
      images:inputs.map(({dataUrl,name,...evidence})=>({...evidence,name})),
      requestedSampling:{maxTokens:4096,temperature:.4},usage:result.usage || null,timing:result.timing || null} };
}
