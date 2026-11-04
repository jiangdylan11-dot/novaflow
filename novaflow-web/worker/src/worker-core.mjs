// NovaFlow GPU Worker - core loop.
//
// Lifecycle:
//   load/create identity -> register -> report models -> heartbeat forever
//                                                     -> claim -> run -> report
//
// Everything the worker is allowed to do is scoped to itself and to the task
// currently assigned to it (spec 8). It holds no Supabase key, no Grok key and
// no admin token; its only credential is its own worker secret.

import {assertSupportedDrawingGraph} from './retired-rapid-guard.mjs';
import { mkdir, readFile, writeFile, readdir, stat, lstat, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { freemem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createIdleComfyReclaimer } from './idle-comfy-reclaimer.mjs';
import { readComfyMemorySnapshot } from './runtime-memory-observer.mjs';
import { createGateway, sweepTaskFiles } from './gateway/gateway.mjs';
import { candidateTaskDirectory, candidateTaskIdState } from './gateway/candidate-task-path.mjs';
import { createTunnel } from './tunnel.mjs';
import { createComfyClient, collectOutputs, assertLocalOnly } from './comfy/comfy-client.mjs';
import { videoRuntimeUrl } from './runtime-services.mjs';
import { loadWorkflow, buildGraph, resolvedSeed, videoFrameLength, audioGraphExtras } from './comfy/workflow-runner.mjs';
import { cleanAudioCaption } from './comfy/audio-reprompt.mjs';
import { createWorkflowHost } from './comfy/workflow-host.mjs';
import { workflowModule, QWEN21_EDIT_LORA_CAPABILITY, QWEN21_EDIT_LORA_NAME } from '../../packages/shared/src/workflow-modules.mjs';
import { inspectAllModels, inspectViaComfy, detectQwenImage21, WORKER_MODEL_MANIFEST } from './models/model-manager.mjs';
import { createWorkerLoraCatalog } from './models/lora-catalog.mjs';
import {detectSharedImageCapabilities, RMBG_CAPABILITY, SAM_B_CAPABILITY, SAM_L_CAPABILITY, SAM_H_CAPABILITY, SAM_AUTO_CAPABILITY, QWEN_INPAINT_CAPABILITY, SEEDVR_CAPABILITY, SEETHROUGH_CAPABILITY, SEETHROUGH_LAMA_CAPABILITY, FLUX_FILL_CAPABILITY, FLUX_REMOVAL_CAPABILITY} from './models/shared-workflow-capabilities.mjs';
import { QWEN21_MODEL_ID, runtimeFor } from '../../packages/shared/src/model-manifest.mjs';
import { detectGpu, detectSystem } from './hardware.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';
import {
  HEARTBEAT_INTERVAL_SECONDS,
  MATTING_TASK_TYPE,
  PROMPT_ASSISTANT_MODEL_ID,
  PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID,
  PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY,
  PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_SCOPE,
  PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY,
  PROMPT_ASSISTANT_REQUEST_FILE,
  PROMPT_ASSISTANT_RESULT_FILE,
  PROMPT_ASSISTANT_TASK_TYPE,
  TASK_STATE,
  TTL_SECONDS,
  isSafeFilename,
  requirementsFor
} from '../../packages/shared/src/protocol.mjs';
import { runMatting, probeMatting } from './matting.mjs';

export function validateQwenUiTask(task) {
  const scoped = task?.parameters || {};
  if (scoped.ui_scope === 'qwen-ui-draft-v1' || scoped.uiScope === 'qwen-ui-draft-v1' ||
      scoped.assistant_tool_scope === 'qwen-ui-draft-v1' ||
      scoped.model_id === 'qwen3.5-9b-heretic-ui-draft-v1' ||
      scoped.modelId === 'qwen3.5-9b-heretic-ui-draft-v1' ||
      task?.model_id === 'qwen3.5-9b-heretic-ui-draft-v1')
    throw Object.assign(Error('Qwen UI owner lease unavailable.'), {code:'qwen-ui-lease-unavailable'});
  return false;
}

// This scope is reserved, not enabled: the worker cannot establish the
// actor/owner lease from its current task view or an offline upload grant.
export function validateQwenRotationCandidateTask(task, request) {
  const idState = candidateTaskIdState(task?.id);
  if (idState !== 'other')
    throw Object.assign(Error('Qwen rotation candidate owner lease unavailable.'),{code:'qwen-rotation-lease-unavailable'});
  const matches=p=>p && typeof p==='object' && (
      p.assistant_tool_scope===PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_SCOPE ||
      p.assistantToolScope===PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_SCOPE ||
      p.model_id===PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY ||
      p.modelId===PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY ||
      p.foartAnimationStage==='rotation_candidate' || p.foart_animation_stage==='rotation_candidate');
  if (matches(task?.parameters) || matches(task?.input_manifest?.parameters) || matches(request) ||
      task?.model_id===PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY ||
      task?.modelId===PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY)
    throw Object.assign(Error('Qwen rotation candidate owner lease unavailable.'),{code:'qwen-rotation-lease-unavailable'});
  return false;
}

// Route by the server-reserved identifier, not model-provided task metadata.
// Noncanonical reserved identifiers must never fall through to the legacy root.
export function workerTaskDirectory(dataDir, taskId) {
  const idState = candidateTaskIdState(taskId);
  if (idState === 'noncanonical-candidate') throw new Error('noncanonical candidate task id');
  return idState === 'candidate'
    ? dirname(candidateTaskDirectory(dataDir, taskId, 'input'))
    : join(dataDir, 'tasks', taskId);
}

// The proof is forwarded, never interpreted or minted by the node. The
// control plane authenticates the existing worker token, verifies the proof
// with its own key, and performs the live transactional ownership check.
export function createQwenCandidateOnlineVerifier({callControl, getWorkerToken, getWorkerId}) {
  return async ({taskId,workerId,op,phase,proof,sha256,bytes,signal}) => {
    const workerToken = getWorkerToken();
    const uploadFinish = op === 'upload' && phase === 'finish';
    if (candidateTaskIdState(taskId) !== 'candidate' || workerId !== getWorkerId() ||
        !['upload','download'].includes(op) || typeof proof !== 'string' || !proof || proof.length > 8192 ||
        (phase !== 'start' && !uploadFinish) ||
        (uploadFinish && (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256) ||
          !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 262144)) ||
        typeof workerToken !== 'string' || !workerToken) throw new Error('candidate verification unavailable');
    return await callControl('POST','/api/worker/tasks/'+taskId+'/qwen-rotation-verify',
      {token:workerToken,body:{proof,op,phase,...(uploadFinish ? {sha256,bytes} : {})},signal});
  };
}

export function createQwenCandidatePhaseVerifier({callControl, getWorkerToken, getWorkerId}) {
  return async ({taskId,workerId,attempt,op,signal}) => {
    const workerToken = getWorkerToken();
    if (candidateTaskIdState(taskId) !== 'candidate' || workerId !== getWorkerId() ||
        !Number.isSafeInteger(attempt) || attempt < 1 || !['wait','infer','complete'].includes(op) ||
        typeof workerToken !== 'string' || !workerToken) throw new Error('candidate verification unavailable');
    const result = await callControl('POST','/api/worker/tasks/'+taskId+'/qwen-rotation-phase',
      {token:workerToken,body:{attempt,op},signal});
    return result?.authorized === true && result.taskId === taskId && result.workerId === workerId &&
      result.attempt === attempt && result.op === op;
  };
}

// A bounded ordinary task uses the existing scheduler but is never allowed
// to fall through the ordinary file or assistant route. These values must
// come from the server-owned task manifest, not the uploaded request.
export const QWEN_FOART_PLAN_SCOPE='qwen-foart-plan-v1';
export const QWEN_FOART_PLAN_CAPABILITY='qwen3.5-9b-heretic-foart-plan-v1';
export const QWEN_FOART_PLAN_INPUT='qwen-foart-plan-request.json';
export const QWEN_IMAGE_EDIT_SCOPE='qwen21-local-image-edit-v1';
export const QWEN_IMAGE_EDIT_CAPABILITY='qwen3.5-9b-heretic-qwen21-local-image-edit-v1';
export const QWEN_IMAGE_EDIT_INPUT='qwen21-local-image-edit-request.json';
export const QWEN_IMAGE_EDIT_MAX_BYTES=16*1024*1024;
const QWEN_FOART_PLAN_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const QWEN_FOART_PLAN_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const qwenFoartPlanResultName=attempt=>`qwen-foart-plan-result-${attempt}.json`;
export const isQwenFoartPlanTask=task=>task?.parameters?.assistant_tool_scope===QWEN_FOART_PLAN_SCOPE;
export const isQwenImageEditTask=task=>task?.parameters?.assistant_tool_scope===QWEN_IMAGE_EDIT_SCOPE;
export function isClaimedQwenTextBusinessTask(task) {
  const p=task?.parameters,refs=task?.references;
  return Boolean(task && QWEN_FOART_PLAN_ID.test(String(task.id||'')) && task.status==='assigned' &&
    task.task_type===PROMPT_ASSISTANT_TASK_TYPE && task.model_id===PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY &&
    p?.model_id===PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY && ['optimize-prompt','rewrite-audio-prompt'].includes(p.action) &&
    !p.assistant_tool_scope && Array.isArray(refs) && refs.length===1 && refs[0]?.name===PROMPT_ASSISTANT_REQUEST_FILE && refs[0]?.kind==='json');
}
// A plan task may report only deliberately selected, user-facing causes.
// Never forward arbitrary exception text, paths or child-process diagnostics.
const QWEN_PLAN_SAFE_ERRORS=Object.freeze({
  'qwen-gpu-worker-busy':'本机节点正在处理其他任务，请等待完成；未修改作品。',
  'qwen-gpu-generation-busy':'生成任务正在运行或排队，请等待完成；未修改作品。',
  'runtime-generation-busy':'生成任务正在运行，请等待完成；未修改作品。',
  'qwen-gpu-queue-unverified':'无法确认生成任务队列，本次未修改作品。',
  'qwen-gpu-memory-low':'可用显存不足，本次未修改作品。',
  'qwen-gpu-memory-unverified':'无法确认显存状态，本次未修改作品。',
  'qwen-gpu-resource-probe-failed':'无法确认 GPU 资源状态，本次未修改作品。',
  'qwen-gpu-not-ready':'本地 GPU 线路尚未就绪，本次未修改作品。',
  'qwen-gpu-component-missing':'本地 GPU 运行组件缺失，本次未修改作品。',
  'qwen-gpu-component-invalid':'本地 GPU 运行组件校验失败，本次未修改作品。',
  'qwen-gpu-managed-required':'本地 GPU 需要受管运行组件，本次未修改作品。',
  'qwen-gpu-proof-unconfirmed':'GPU 执行未通过核验，本次未切换到 CPU，也未修改作品。',
  'qwen-identity-verifying':'本地模型身份正在校验，请稍后重试；未修改作品。',
  'qwen-identity-unverified':'本地模型身份未通过校验，本次未修改作品。',
  'strata-identity-mismatch':'本地模型身份与请求不匹配，本次未修改作品。',
  'qwen-rotation-owner-stale':'任务或登录会话已变化，本次未修改作品。',
  'qwen-rotation-owner-unavailable':'无法核验节点或登录会话，本次未修改作品。',
  'qwen-ownership-unconfirmed':'本地模型资源退出尚未确认，本次未修改作品。',
  'qwen-ownership-unverified':'本地模型资源归属尚未确认，本次未修改作品。',
  'qwen-ownership-verifying':'正在确认本地模型资源归属，请稍后重试；未修改作品。',
  'strata-release-unconfirmed':'本地模型资源退出尚未确认，本次未修改作品。'
});
export function qwenPlanSafeFailureMessage(reply) {
  const code=typeof reply?.errorCode==='string' ? reply.errorCode : '';
  return Object.hasOwn(QWEN_PLAN_SAFE_ERRORS,code) ? QWEN_PLAN_SAFE_ERRORS[code] : '本地模型规划未完成，本次未修改作品。';
}

export function validateQwenFoartPlanTask(task) {
  const p=task?.parameters, refs=task?.references;
  if(!task || !QWEN_FOART_PLAN_ID.test(String(task.id || '')) || task.task_type!==PROMPT_ASSISTANT_TASK_TYPE ||
    task.model_id!==QWEN_FOART_PLAN_CAPABILITY || !p || p.action!=='art-agent-chat' ||
    p.model_id!==PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID || p.assistant_tool_scope!==QWEN_FOART_PLAN_SCOPE ||
    !QWEN_FOART_PLAN_ID.test(String(p.request_id || '')) || !/^[0-9a-f]{64}$/.test(String(p.request_sha256 || '')) ||
    !Number.isSafeInteger(p.request_bytes) || p.request_bytes<1 || p.request_bytes>262144 ||
    !Number.isSafeInteger(task.attempt_count) || task.attempt_count<1 || task.attempt_count>20 ||
    !Array.isArray(refs) || refs.length!==1 || refs[0]?.name!==QWEN_FOART_PLAN_INPUT ||
    refs[0]?.kind!=='json' || refs[0]?.bytes!==p.request_bytes)
    throw new Error('Qwen plan task metadata invalid');
  return true;
}

export function validateQwenImageEditTask(task) {
  const p=task?.parameters,refs=task?.references;
  if(!task || !QWEN_FOART_PLAN_ID.test(String(task.id || '')) || task.task_type!==PROMPT_ASSISTANT_TASK_TYPE ||
    task.model_id!==QWEN_IMAGE_EDIT_CAPABILITY || !p || p.action!=='optimize-prompt' ||
    p.model_id!==PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID || p.assistant_tool_scope!==QWEN_IMAGE_EDIT_SCOPE ||
    !QWEN_FOART_PLAN_ID.test(String(p.request_id || '')) || !/^[0-9a-f]{64}$/.test(String(p.request_sha256 || '')) ||
    !Number.isSafeInteger(p.request_bytes) || p.request_bytes<1 || p.request_bytes>QWEN_IMAGE_EDIT_MAX_BYTES ||
    !Number.isSafeInteger(task.attempt_count) || task.attempt_count<1 || task.attempt_count>20 ||
    !Array.isArray(refs) || refs.length!==1 || refs[0]?.name!==QWEN_IMAGE_EDIT_INPUT || refs[0]?.kind!=='json' || refs[0]?.bytes!==p.request_bytes)
    throw new Error('Qwen image edit task metadata invalid');
  return true;
}

export function validateQwenImageEditPayload(request,requestId) {
  if(!request || typeof request!=='object' || Array.isArray(request) ||
    Object.keys(request).sort().join(',')!=='currentPrompt,images,mode,negativePrompt,promptContract,requestId,requirements' ||
    request.requestId!==requestId || request.mode!=='image-edit' || request.promptContract!=='qwen21-native-rewrite-v3' ||
    typeof request.currentPrompt!=='string' || !request.currentPrompt.trim() || request.currentPrompt.length>4000 ||
    typeof request.requirements!=='string' || request.requirements.length>2000 ||
    typeof request.negativePrompt!=='string' || request.negativePrompt.length>12000 ||
    !Array.isArray(request.images) || request.images.length<1 || request.images.length>3 ||
    /data:(?:image|audio|video)\/|__NOVAFLOW_RESOURCE_MENTION_/i.test(request.currentPrompt+'\n'+request.requirements+'\n'+request.negativePrompt))
    throw new Error('Qwen image edit request invalid');
  const roles=new Set(['subject','style','pose','background','material','color','composition','lighting','object','result','output','attachment','reference']);
  let total=0;
  for(const image of request.images){
    if(!image || typeof image!=='object' || Array.isArray(image) || Object.keys(image).sort().join(',')!=='dataUrl,role' ||
      !roles.has(image.role) || typeof image.dataUrl!=='string' || image.dataUrl.length>QWEN_IMAGE_EDIT_MAX_BYTES)
      throw new Error('Qwen image edit reference invalid');
    const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
    if(!match || match[2].length%4!==0)throw new Error('Qwen image edit reference invalid');
    const bytes=Buffer.from(match[2],'base64');total+=bytes.length;
    const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
      match[1]==='jpeg'?bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
      bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!valid || bytes.toString('base64')!==match[2] || total>12*1024*1024)throw new Error('Qwen image edit reference invalid');
  }
  return true;
}

// Gateway and model calls both re-check the authoritative task/session through
// the control plane. `untrustedGrantUser` is never forwarded as an authority.
export function createQwenFoartPlanOnlineVerifier({callControl,getWorkerToken,getWorkerId}) {
  return async ({taskId,workerId,op,phase,attempt,sha256,bytes,signal,scope=QWEN_FOART_PLAN_SCOPE})=>{
    const token=getWorkerToken();
    if(![QWEN_FOART_PLAN_SCOPE,QWEN_IMAGE_EDIT_SCOPE].includes(scope) || !QWEN_FOART_PLAN_ID.test(String(taskId || '')) || workerId!==getWorkerId() ||
      !['upload','download','wait','infer','complete'].includes(op) || !['start','finish'].includes(phase) ||
      (phase==='finish' && !['upload','infer'].includes(op)) ||
      (attempt!==undefined && (!Number.isSafeInteger(attempt)||attempt<1||attempt>20)) ||
      (op!=='upload' && attempt===undefined) ||
      (op==='upload' && phase==='finish' && (!Number.isSafeInteger(attempt)||attempt<1||attempt>20 ||
        !/^[0-9a-f]{64}$/.test(String(sha256 || '')) || !Number.isSafeInteger(bytes)||bytes<1||bytes>(scope===QWEN_IMAGE_EDIT_SCOPE?QWEN_IMAGE_EDIT_MAX_BYTES:262144))) ||
      typeof token!=='string' || !token) throw new Error('Qwen plan verification unavailable');
    const body={op,phase,...(attempt===undefined?{}:{attempt}),...(sha256===undefined?{}:{sha256}),...(bytes===undefined?{}:{bytes})};
    const result=await callControl('POST','/api/worker/tasks/'+taskId+'/qwen-foart-plan-verify',{token,body,signal});
    if(result?.authorized!==true || result.taskId!==taskId || result.workerId!==workerId ||
      result.scope!==scope || result.op!==op ||
      !QWEN_FOART_PLAN_UUID.test(String(result.userId || '')) || !QWEN_FOART_PLAN_UUID.test(String(result.sessionId || '')) ||
      !Number.isSafeInteger(result.attempt) || result.attempt<1 || result.attempt>20 ||
      (attempt!==undefined && result.attempt!==attempt)) throw new Error('Qwen plan verification denied');
    if(op==='upload' && phase==='finish' &&
      (result.digestBound!==true || result.sha256!==sha256 || result.bytes!==bytes))
      throw new Error('Qwen plan upload verification denied');
    return result;
  };
}

// Read from package.json, which is also what electron-builder stamps into the
// installer. Two hand-maintained version constants had already drifted apart
// (0.2.0 here, 0.1.0 there) and neither moved when the gateway was fixed - so
// "is this the build with the fix?" had no answer you could see.
export const WORKER_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return String(JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version || '0.0.0');
  } catch {
    return '0.0.0';
  }
})();

// The scheduling metadata and subsequently uploaded request are independent
// inputs. Require them to agree before entering any assistant/model code.
export const UI_CPU_CAPABILITY = 'foart-ui-cpu-compiler-v1';
export const UI_PE_SOURCE_CAPABILITY = 'foart-ui-pe-source-v1';
export const QWEN21_NATIVE_REWRITE_V3_CAPABILITY = 'qwen3.5-9b-heretic-qwen21-native-rewrite-v3';
export function validatePromptAssistantModelRoute(task, request) {
  validateQwenRotationCandidateTask(task,request);
  const parameters = task?.parameters || {};
  if (parameters.action !== 'art-agent-chat') {
    const selected=request && (Object.hasOwn(request,'assistantModelId') || Object.hasOwn(request,'assistantProvider'));
    const qwen=parameters.model_id===PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY && task?.model_id===PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY
      && request?.assistantProvider==='local' && request?.assistantModelId===PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID;
    if(qwen)return;
    // The UI design compiler is a CPU-only protocol, not a brain request. Its
    // existing unscoped reverse-image action must remain available.
    const uiCpu=parameters.action==='reverse-image-prompt' && !selected
      && parameters.ui_scope==='cpu-v1' && parameters.model_id===UI_CPU_CAPABILITY && task?.model_id===UI_CPU_CAPABILITY
      && request?.surface==='ui-design' && request?.uiPlanner==='grok-vision-cpu-v1'
      && ['capabilities','grok-vision-job','compile-grok-vision','native-ui-cloud','native-ui-compile'].includes(request?.action);
    if(uiCpu)return;
    const uiPe=parameters.action==='reverse-image-prompt' && !selected && parameters.ui_scope==='pe-source-v1'
      && parameters.model_id===UI_PE_SOURCE_CAPABILITY && task?.model_id===UI_PE_SOURCE_CAPABILITY
      && request?.surface==='ui-design' && request?.uiPlanner==='native-catalog-v3' && request?.uiAnalysisStage==='source-only'
      && request?.targetEngine==='qwen-2.1' && request?.uiDesignIntent==='redesign' && request?.uiPreserveLayout===true;
    if(uiPe)return;
    throw new Error('请先选择小桃 AI 模型并重新提交，未加载模型或扣除积分。');
  }
  const routed = parameters.model_id == null ? '' : parameters.model_id;
  const hasRequested = request != null && Object.hasOwn(request, 'modelId');
  const requested = hasRequested ? request.modelId : '';
  if (hasRequested && requested !== 'next' && requested !== PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID)
    throw new Error('提示词助手模型无效，请重新选择模型。');
  const qwen = routed === PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID
    && requested === PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID
    && task?.model_id === PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID
    && parameters.action === 'art-agent-chat';
  if (!qwen) throw new Error('请先选择小桃 AI 模型并重新提交，未加载模型或扣除积分。');
}

// Leave one polling tick for the timer to notice that an empty-queue delay
// has elapsed. The normal 2s poll therefore revisits the queue within about
// 5s instead of waiting for the failure backoff's 30s ceiling.
export function emptyClaimDelayMs(delayMs, pollMs) {
  return Math.min(delayMs, Math.max(0, 5000 - pollMs));
}

export function qwenCpuAdvertisable(status, currentTaskId = null) {
  const qwen = Array.isArray(status?.localModels)
    ? status.localModels.find(model => model?.id === PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID) : null;
  // Busy is a temporary scheduling state; the control plane already prevents
  // busy workers claiming work. It does not invalidate a verified model.
  const available = qwen?.enabled === true || Boolean(currentTaskId && qwen?.errorCode === 'community-runtime-ownership-unconfirmed');
  return Boolean(available && qwen?.configured === true && qwen?.identityVerified === true
    && qwen?.trial?.backend === 'cpu' && qwen?.trial?.chat === true
    && qwen?.trial?.images === true && qwen?.trial?.tools === false);
}

export function qwenBusinessAdvertisable(status,currentTaskId=null) {
  const qwen=Array.isArray(status?.localModels)?status.localModels.find(model=>model?.id===PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID):null;
  const ownedBusy=Boolean(currentTaskId && status?.qwenOwnedTaskId===currentTaskId && qwen?.errorCode==='community-runtime-ownership-unconfirmed');
  return qwenCpuAdvertisable(status,currentTaskId) && (qwen?.enabled===true || ownedBusy) && qwen?.trial?.business===true;
}

export function qwen21NativeRewriteV3Advertisable(status,currentTaskId=null) {
  return status?.qwen21NativeRewriteV3Enabled===true && qwenBusinessAdvertisable(status,currentTaskId);
}

export function qwenReportSignature(status,currentTaskId=null) {
  return `${qwenCpuAdvertisable(status,currentTaskId)?1:0}:${qwenBusinessAdvertisable(status,currentTaskId)?1:0}`;
}

// Preserve the existing boolean heartbeat contract until the business bridge
// is explicitly enabled; old nodes must not report a new missing model.
function qwenBusinessOptedIn(status) {
  const qwen=Array.isArray(status?.localModels)?status.localModels.find(model=>model?.id===PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID):null;
  return status?.qwenBusinessBridgeEnabled===true || Boolean(qwen?.trial && Object.hasOwn(qwen.trial,'business'));
}
function qwenReportKey(status,currentTaskId=null,{rotationEnabled=false,planEnabled=false,imageEditEnabled=false}={}) {
  const qwen=qwenCpuAdvertisable(status,currentTaskId),business=qwenBusinessAdvertisable(status,currentTaskId);
  const rotation=rotationEnabled===true && status?.qwenRotationCandidateEnabled===true;
  const plan=planEnabled===true && status?.qwenPlanEnabled===true;
  let key;
  if(plan)key=`${qwen?1:0}:${business?1:0}:${rotation&&qwen?1:0}:${qwen?1:0}`;
  else if(rotation)key=`${qwen?1:0}:${business?1:0}:${qwen?1:0}`;
  else key=qwenBusinessOptedIn(status) ? qwenReportSignature(status,currentTaskId) : qwen;
  if(Object.hasOwn(status||{},'qwen21NativeRewriteV3Enabled'))key=`${key}:${qwen21NativeRewriteV3Advertisable(status,currentTaskId)?1:0}`;
  if(imageEditEnabled===true)key=`${key}:${status?.qwenImageEditEnabled===true && qwenBusinessAdvertisable(status,currentTaskId)?1:0}`;
  return key;
}

export function createQwenReportTracker() {
  let acknowledged = null;
  return {
    needsReport: ready => acknowledged !== ready,
    async publish(ready, send) { await send(); acknowledged = ready; },
    reset() { acknowledged = null; }
  };
}

/**
 * Point the renderer's recorded options at the files that actually landed in
 * ComfyUI's input folder. The renderer named them before upload; the worker
 * renamed them to keep one task's inputs out of another's way.
 *
 * A positional builder names its inputs wherever its signature puts them: a
 * bare argument (inpaint image and mask), an object of named uploads (万物迁移),
 * an array (the art builder). Every string equal to a reference name is
 * replaced, wherever it sits; assertGraphLoadsTaskInputs then checks the graph
 * itself reads nothing but this task's files.
 */
export async function qwenEditLoraAvailable(turboReady, catalog) {
  if (!turboReady) return false;
  try {
    const result = await catalog.read('qwen', { engine: 'qwen-2.1', modelName: 'Qwen-Image-2.1-Turbo-BF16.gguf' });
    const target = QWEN21_EDIT_LORA_NAME.toLowerCase();
    return result.ok === true && Array.isArray(result.items) && result.items.some(item => String(item.name || '').replace(/\\/g, '/').toLowerCase() === target);
  } catch (_) { return false; }
}

export function withReferences(parameters, filenames, references = [], method = '') {
  const rename = (value) => {
    if (typeof value === 'string') {
      const found = references.findIndex((ref) => ref.name === value);
      return found >= 0 && filenames[found] ? filenames[found] : value;
    }
    if (Array.isArray(value)) return value.map(rename);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = rename(item);
      return out;
    }
    return value;
  };
  if (Array.isArray(parameters.__args)) {
    const args = structuredClone(parameters.__args);
    if (method === 'buildArtGenerateRunWorkflow') {
      args[2] = (args[2] || []).map((name) => {
        const found = references.findIndex((ref) => ref.name === name);
        if (found < 0 || !filenames[found]) throw new Error('workflow input is not an uploaded task reference');
        return filenames[found];
      });
      return { ...parameters, __args: args };
    }
    if (method === 'defaultQwenInpaintWorkflow' || method === 'defaultQwenLoraInpaintWorkflow' || method === 'defaultRemovalInpaintWorkflow') {
      for (const index of [1, 2]) {
        const found = references.findIndex((ref) => ref.name === args[index]);
        if (found < 0 || !filenames[found]) throw new Error('workflow input is not an uploaded task reference');
      }
    }
    // 局部编辑 and 智能补全 both run on 2.1 and read the undug crop to see what they change or
    // continue. The engine choice is the node's, never the task's, so it is dropped; the undug crop is
    // kept only when this task uploaded it.
    const inpaintOptions = ['defaultQwenInpaintWorkflow', 'defaultQwenLoraInpaintWorkflow'].includes(method) ? args[5] : null;
    if (inpaintOptions && typeof inpaintOptions === 'object') {
      const { inpaintEngine, latentInputName, ...rest } = inpaintOptions;
      const keepLatent = references.some((ref, index) => ref.name === latentInputName && filenames[index]);
      if (inpaintEngine !== undefined || latentInputName !== undefined) args[5] = keepLatent ? { ...rest, latentInputName } : rest;
    }
    return { ...parameters, __args: rename(args) };
  }
  if (!filenames || !filenames.length) return parameters;
  // Option objects name their uploads under their own keys (H3's referenceImages / referenceVideo /
  // referenceAudio, the AI-effects sourceVideo / referenceImage): every string equal to a staged name
  // becomes the worker's name for that file, wherever it sits.
  const next = rename(parameters);
  next.__novaflowReferenceFiles = filenames;
  if (Array.isArray(next.references)) {
    next.references = next.references.map((r, i) => (
      filenames[i] ? { ...r, name: filenames[i], uploadedName: filenames[i] } : r
    ));
  }
  // The H3 builders read these two directly.
  if (filenames[0]) { next.firstFrame = filenames[0]; next.first_frame = filenames[0]; }
  if (filenames[1]) { next.lastFrame = filenames[1]; next.last_frame = filenames[1]; }
  return next;
}

/**
 * A replayed graph may load only the files this task uploaded. Without this a page could name any
 * file in the node's input folder and have it read into a result.
 */
export function assertGraphLoadsTaskInputs(graph, filenames) {
  const allowed = new Set((filenames || []).filter(Boolean));
  for (const [id, node] of Object.entries(graph && typeof graph === 'object' ? graph : {})) {
    const type = String(node && node.class_type || '');
    if (!/^(LoadImage|LoadImageMask|LoadVideo|LoadAudio)$/.test(type)) continue;
    const inputs = node && node.inputs && typeof node.inputs === 'object' ? node.inputs : {};
    for (const key of ['image', 'video', 'audio', 'file', 'filename']) {
      const value = inputs[key];
      if (typeof value === 'string' && !allowed.has(value)) {
        throw new Error(type + ' node ' + id + ' names a file this task did not upload: ' + value);
      }
    }
  }
}

export const SEE_THROUGH_SPLIT_METHOD = 'buildSeeThroughSplitWorkflow';

/**
 * One 一键拆图 run's files, read out of ComfyUI's output folder by name.
 *
 * See-through does not report its layers through the prompt history: SavePSD writes the layer PNGs
 * and `<prefix>_<ts>_<uid>_layers.json` and points the shared `seethrough_psd_info.log` at that json;
 * NovaFlow's head node adds `<prefix>_head.json` (+ its PNG) when it ran. The page fetches each of
 * these by exactly these names, so they are kept, and the log is written per task so a later run
 * cannot repoint it.
 */
export async function collectSeeThroughOutputs(comfy, prefix) {
  const safePrefix = String(prefix || '');
  if (!safePrefix || !isSafeFilename(safePrefix)) throw new Error('拆图任务缺少有效的输出前缀');
  const view = (filename) => comfy.viewFile({ filename, subfolder: '', type: 'output' });
  let infoName = '';
  try { infoName = String(await view('seethrough_psd_info.log')).trim(); } catch { throw new Error('See-through 未写入图层信息'); }
  if (!infoName.startsWith(safePrefix) || !isSafeFilename(infoName)) throw new Error('See-through 图层信息不是本次任务输出');
  const infoBytes = await view(infoName);
  let info = null;
  try { info = JSON.parse(String(infoBytes)); } catch { throw new Error('See-through 图层信息无法解析'); }
  const infoFile = { name: infoName, kind: 'file', bytes: infoBytes };
  const files = [{ name: 'seethrough_psd_info.log', kind: 'file', bytes: Buffer.from(infoName) }, infoFile];
  const served = new Set();
  for (const layer of Array.isArray(info?.layers) ? info.layers : []) {
    const original = String(layer?.filename || '');
    if (!original.startsWith(safePrefix)) continue;
    // See-through names a layer file after its tag, spaces included ("back hair"). The gateway serves
    // safe names only, so the file is stored, and listed in the json the page reads, under one.
    const name = original.replace(/[^A-Za-z0-9._-]+/g, '_');
    if (!isSafeFilename(name) || served.has(name)) continue;
    served.add(name);
    layer.filename = name;
    files.push({ name, kind: 'image', bytes: await view(original) });
  }
  infoFile.bytes = Buffer.from(JSON.stringify(info));
  const headName = safePrefix + '_head.json';
  let head = null;
  try { head = JSON.parse(String(await view(headName))); } catch { head = null; }
  if (head && typeof head === 'object') {
    files.push({ name: headName, kind: 'file', bytes: Buffer.from(JSON.stringify(head)) });
    const png = String(head.layer?.filename || '');
    if (head.ok === true && png.startsWith(safePrefix) && isSafeFilename(png)) files.push({ name: png, kind: 'image', bytes: await view(png) });
  }
  return files;
}

function nowIso() {
  return new Date().toISOString();
}

export function createWorker(options) {
  const {
    controlUrl,
    dataDir,
    workflowDir,
    configPath,
    comfyImageUrl = 'http://127.0.0.1:8188',
    comfyVideoUrl: configuredVideoUrl = '',
    modelsRoot: configuredModelsRoot = '',
    gatewayPort = 8790,
    gatewayHost = '0.0.0.0',
    publicEndpoint = '',
    tunnel: tunnelEnabled = true,
    workerName = 'novaflow-worker',
    rendererDir = '',
    registrationCode = '',
    registrationProfile = '',
    ownerSessionToken = '',
    pollIntervalMs = 2000,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_SECONDS * 1000,
    localTasks = null,
    qwenRotationVerificationEnabled = false,
    qwenRotationCandidateEnabled = false,
    qwenPlanVerificationEnabled = false,
    qwenPlanEnabled = false,
    qwenImageEditEnabled = false,
    // The node's 提示词助手 (a function, because the assistant is created after
    // the worker it shares the GPU with). Absent on a node without one.
    promptAssistant = null,
    logger
  } = options;
  let modelsRoot = configuredModelsRoot;
  const promptAssistantRef = () => (typeof promptAssistant === 'function' ? promptAssistant() : promptAssistant) || null;
  const hasComputePolicy = policy => policy && ['enabled', 'owner_enabled', 'sharing_enabled'].every(key => typeof policy[key] === 'boolean')
    && ['pool', 'selected'].includes(policy.sharing_scope) && Array.isArray(policy.allowed_user_ids);
  function requireComputePolicy(policy) {
    if (registrationProfile === 'compute-only' && !hasComputePolicy(policy)) {
      throw new Error('平台算力机器权限服务需要升级；本节点尚未开始接收任务，请联系管理员');
    }
  }
  // Video (MiniMax H3) runs on the image runtime since 2026-09-26; see videoRuntimeUrl.
  const comfyVideoUrl = videoRuntimeUrl(configuredVideoUrl, comfyImageUrl);

  // Refuse to run if ComfyUI is configured off loopback (spec 9).
  assertLocalOnly(comfyImageUrl);
  assertLocalOnly(comfyVideoUrl);

  const log = logger || ((msg, meta) => console.log('[worker] ' + msg, meta ? JSON.stringify(meta) : ''));
  const listeners = new Set();
  let activeRegistrationCode = registrationCode;
  let activeTask = null;
  let shareEpoch = 0;
  function checkCancelled(taskId) {
    if ((activeTask?.id === taskId && activeTask.controller.signal.aborted) || localTasks?.get(taskId)?.status === 'cancelled') {
      throw new Error('任务已被停止操作取消');
    }
  }
  async function cancelActiveTask() {
    const task = activeTask;
    if (!task) return;
    task.controller.abort();
    if (task.promptId) await task.comfy.cancelPrompt(task.promptId);
  }

  const state = {
    workerId: '',
    workerSecret: '',
    workerToken: '',
    grantKey: '',
    status: 'offline',
    currentTaskId: null,
    gpu: null,
    system: null,
    models: [],
    endpointUrl: publicEndpoint,
    localEndpointUrl: '',
    transport: 'direct',
    lastError: '',
    lastHeartbeatAt: null,
    platformOnline: false,
    platformWorkerName: '',
    pendingApproval: null,
    runtimeReady: registrationProfile !== 'compute-only',
    startedAt: nowIso(),
    comfy: { image: false, video: false },
    features: { qwenImage21: false },
    stats: { completed: 0, failed: 0 }
  };

  function emit() {
    const snapshot = snapshotState();
    for (const fn of listeners) {
      try { fn(snapshot); } catch { /* a UI listener must not break the loop */ }
    }
  }

  function snapshotState() {
    return {
      workerId: state.workerId,
      workerName: state.platformWorkerName || workerName,
      status: state.status,
      currentTaskId: state.currentTaskId,
      gpu: state.gpu,
      system: state.system,
      models: state.models.map((m) => ({ model_id: m.model_id, status: m.status })),
      endpointUrl: state.endpointUrl,
      localEndpointUrl: state.localEndpointUrl,
      transport: state.transport,
      comfy: state.comfy,
      features: { ...state.features },
      lastError: state.lastError,
      lastHeartbeatAt: state.lastHeartbeatAt,
      startedAt: state.startedAt,
      stats: { ...state.stats },
      version: WORKER_VERSION,
      boundAccount: state.boundAccount || null,
      policy: state.policy ? structuredClone(state.policy) : null,
      pendingApproval: state.pendingApproval,
      runtimeReady: state.runtimeReady,
      localRunning, sharing, draining, claimsPaused, claimBusy, manualReleaseBusy,
      claimOutcomeUnknown, queuedLocal: localTasks?.pendingCount() || 0,
      connected: sharing && state.platformOnline && Boolean(state.endpointUrl)
    };
  }

  // The renderer's own graph builders, running here instead of in a browser.
  // Loaded lazily: a worker that only ever runs fixed task types never pays
  // for it, and a renderer directory that is missing is not fatal.
  const workflowHosts = new Map();
  function workflowHost(runtime) {
    if (!rendererDir) return null;
    if (!workflowHosts.has(runtime)) {
      const promise = createWorkflowHost({ rendererDir, logger: log, comfy: comfyFor(runtime) })
        .catch((error) => {
          log('workflow host unavailable', { error: String(error?.message || error) });
          return null;
        });
      workflowHosts.set(runtime, promise);
    }
    return workflowHosts.get(runtime);
  }
  // The runtime may have started on another port (runtime-services: its own was held by somebody
  // else's ComfyUI). The clients follow it, and the graph builders read the node catalogue anew.
  function retargetComfy({ image, video } = {}) {
    const moved = [[comfyImage, image], [comfyVideo, video]].filter(([client, url]) => url && client.baseUrl !== url);
    for (const [client, url] of moved) client.retarget(url);
    if (moved.length) { workflowHosts.clear(); log('ComfyUI address', { image: comfyImage.baseUrl, video: comfyVideo.baseUrl }); }
  }

  const comfyImage = createComfyClient({ baseUrl: comfyImageUrl, logger: log });
  const comfyVideo = createComfyClient({ baseUrl: comfyVideoUrl, logger: log });

  let loraCatalog = createWorkerLoraCatalog({ modelsRoot, image: comfyImage, video: comfyVideo });
  let lastModelReportAt = 0;
  // Track the last acknowledged report, not the local snapshot: a failed
  // withdrawal must be retried before a normal heartbeat can keep stale
  // server-side capability alive.
  const qwenReport = createQwenReportTracker();
  let modelReportInFlight = null;
  let lastFeatureProbeAt = 0;

  let lastRuntimeKind = '';

  function comfyFor(runtime) {
    return runtime === 'video' ? comfyVideo : comfyImage;
  }

  // 音频 AI 助手 (本地): the same text model and the same frame the audio
  // pipeline rewrites with, run on their own so the page can show the caption
  // before generation. The shared Flash coordinator owns inference and proves
  // resource release before the audio model can load.
  async function rewriteAudioPrompt({ kind, text, requirements, seconds, bpm, loop } = {}, context = {}) {
    const which = kind === 'sfx' ? 'sfx' : 'music';
    const tempo = which === 'music' ? Math.round(Number(bpm) || 0) : 0;
    const input = [
      String(text || '').trim(),
      String(requirements || '').trim() ? 'Additional request: ' + String(requirements || '').trim() : '',
      which === 'music' && loop ? 'This track loops seamlessly.' : '',
      tempo ? 'BPM: ' + tempo : ''
    ].filter(Boolean).join('\n');
    if (!input) return { ok: false, error: '请先输入描述或补充要求' };
    const length = Math.max(1, Math.round(Number(seconds) || (which === 'music' ? 30 : 2)));
    try {
      const assistant = promptAssistantRef();
      if (!assistant?.rewriteAudioPrompt) throw new Error('本机 Flash 音频助手尚未配置');
      const request = {kind:which,input,seconds:length};
      const reply = context.taskId ? await assistant.runForTask(context.taskId,'rewriteAudioPrompt',request,context) : await assistant.rewriteAudioPrompt(request);
      if (!reply?.ok) return reply || {ok:false,error:'Flash 没有返回结果'};
      if (reply.resourcesReleased !== true || reply.generationReady !== true) throw new Error('Flash 资源释放尚未确认，本次未提交音频生成');
      return {...reply,prompt:cleanAudioCaption(reply.prompt)};
    } catch (error) {
      log('audio rewrite failed', { error: String(error?.message || error) });
      return { ok: false, error: '本地优化失败：' + String(error?.message || error).slice(0, 200) };
    }
  }

  // -------------------------------------------------------------------------
  // Identity: generated once, kept in the worker's own config file.
  // -------------------------------------------------------------------------
  async function loadIdentity() {
    try {
      const raw = JSON.parse(await readFile(configPath, 'utf8'));
      if (raw.workerId && raw.workerSecret) {
        state.workerId = String(raw.workerId);
        state.workerSecret = String(raw.workerSecret);
        state.boundAccount = raw.boundAccount || null;
        if (registrationProfile === 'compute-only') state.platformWorkerName = String(raw.workerName || '');
        return true;
      }
    } catch { /* first run */ }
    state.workerId = randomUUID();
    state.workerSecret = generateWorkerSecret();
    await saveIdentity();
    return false;
  }

  async function saveIdentity() {
    await mkdir(join(configPath, '..'), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      workerId: state.workerId,
      workerSecret: state.workerSecret,
      workerName: state.platformWorkerName || workerName,
      boundAccount: state.boundAccount || null,
      controlUrl,
      savedAt: nowIso()
    }, null, 2), 'utf8');
  }

  // -------------------------------------------------------------------------
  // Control-plane calls
  // -------------------------------------------------------------------------
  async function callControl(method, path, { body, token, signal } = {}) {
    const localId = /^\/api\/worker\/tasks\/([^/]+)\//.exec(path)?.[1];
    const candidateControl = /\/qwen-rotation-(?:verify|phase|start|complete|fail)$/.test(path) ||
      /\/qwen-foart-plan-verify$/.test(path) || path === '/api/worker/qwen-rotation/claim';
    if (localId && localTasks?.has(localId)) {
      if (candidateControl) throw new Error('candidate verification unavailable');
      return localTasks.report(localId, path.split('/').pop(), body);
    }
    const res = await fetch(controlUrl + path, {
      method,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      ...(candidateControl ? {redirect:'error'} : {}),
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    if (!res.ok) {
      const err = new Error(String(parsed?.error || ('control plane ' + res.status)));
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return parsed;
  }

  async function register({ sessionToken = ownerSessionToken } = {}) {
    state.gpu = await detectGpu();
    state.system = await detectSystem();
    state.comfy.image = await comfyImage.isUp();
    state.comfy.video = await comfyVideo.isUp();

    const hardware = {
      gpu_name: state.gpu.name,
      vram_mb: state.gpu.vramMb,
      ram_mb: state.system.ramMb,
      driver_version: state.gpu.driverVersion,
      cuda_version: state.gpu.cudaVersion,
      worker_version: WORKER_VERSION,
      comfy_version: state.comfy.video
        ? (await comfyVideo.systemStats().catch(() => null))?.system?.comfyui_version || ''
        : (await comfyImage.systemStats().catch(() => null))?.system?.comfyui_version || '',
      endpoint_url: state.endpointUrl,
      transport: state.transport || 'direct'
    };

    const body = {
      worker_id: state.workerId,
      worker_name: state.platformWorkerName || workerName,
      worker_secret: state.workerSecret,
      ...(registrationProfile ? { profile: registrationProfile } : {}),
      hardware
    };
    if (activeRegistrationCode && !sessionToken) body.registration_code = activeRegistrationCode;

    const res = await callControl('POST', '/api/worker/register', {
      body,
      token: sessionToken || undefined
    });
    state.workerToken = res.workerToken;
    state.grantKey = res.grantKey;
    state.policy = res.policy || res.worker?.policy || null;
    requireComputePolicy(state.policy);
    state.pendingApproval = res.worker?.pending_approval ?? state.policy?.pending_approval ?? null;
    if (res.worker?.worker_name) state.platformWorkerName = String(res.worker.worker_name);
    await saveIdentity();
    state.platformOnline = true;
    state.status = 'idle';
    log('registered', { workerId: state.workerId, gpu: state.gpu.name, vramMb: state.gpu.vramMb });
    emit();
    return res;
  }

  async function reportModels(onProgress = () => {}) {
    if(activeTask?.qwenOwnerVerificationPending===true && activeTask.id===state.currentTaskId)return state.models;
    if (modelReportInFlight) return modelReportInFlight;
    modelReportInFlight = performModelReport(onProgress);
    try { return await modelReportInFlight; } finally { modelReportInFlight = null; }
  }
  async function performModelReport(onProgress = () => {}) {
    // Pending/unready public nodes remain visible to the administrator without
    // advertising somebody else's already-running ComfyUI or prompt runtime.
    if (registrationProfile === 'compute-only' && !state.runtimeReady) {
      state.models = [];
      state.features.qwenImage21 = false;
      if (state.workerToken) {
        await qwenReport.publish(false, () => callControl('POST', '/api/worker/models', { body: { models: [] }, token: state.workerToken }));
      }
      lastModelReportAt = Date.now();
      emit();
      return [];
    }
    onProgress(75, '正在检测可用模型');
    const byId = new Map();
    for (const runtime of ['image', 'video']) {
      if (!state.comfy[runtime]) continue;
      const found = await inspectViaComfy(comfyFor(runtime)).catch(() => null);
      for (const model of found || []) {
        // Advertise a model only through the runtime runTask will select for it (both are the same
        // ComfyUI unless a node configured video elsewhere).
        if (runtimeFor(model.model_id) === runtime) byId.set(model.model_id, model);
      }
    }
    const diskModels = modelsRoot ? await inspectAllModels(modelsRoot).catch(() => []) : [];
    const qwen21 = state.comfy.image ? await detectQwenImage21(comfyImage).catch(() => false) : false;
    const qwen21Turbo=state.comfy.image?await detectQwenImage21(comfyImage,{variant:'turbo'}).catch(()=>false):false;
    // Only a worker with this versioned builder and the compatible target
    // adapter advertises the capability; an old Turbo worker cannot claim it.
    const qwenEditLoraReady = await qwenEditLoraAvailable(qwen21Turbo, loraCatalog);
    const sharedImage = state.comfy.image ? await detectSharedImageCapabilities(comfyImage, modelsRoot) : {rmbg:false,samB:false,qwenInpaintNodes:false};
    const models = WORKER_MODEL_MANIFEST.map((spec) => {
      const found = byId.get(spec.model_id) || diskModels.find(m => m.model_id === spec.model_id);
      // Qwen-Image-2.1 is ready when this node can build its graph: the builder's own check, which
      // also covers the other quantisations and text encoders it accepts.
      if (spec.model_id === QWEN21_MODEL_ID || spec.model_id==='qwen-image-2.1-turbo') {
        const ready=spec.model_id==='qwen-image-2.1-turbo'?qwen21Turbo:qwen21;
        return { ...(found || {}), model_id: spec.model_id, model_version: spec.version, status: ready ? 'ready' : 'missing',
          detail: { ...(found?.detail || {}), ...(ready ? {} : { reason: 'qwen_image_21_unavailable' }) } };
      }
      // A 'local' model is not loaded by ComfyUI, so no node catalogue can
      // vouch for it. The loop above only ever asks the 'image' and 'video'
      // runtimes, which left state.comfy['local'] undefined and every such
      // model permanently 'missing' - and the claim SQL matches on
      // status = 'ready', so the task could never be assigned to anybody.
      // Disk inspection is the whole answer here, exactly as it is the
      // fallback for the ComfyUI-served models.
      if (spec.runtime === 'local') {
        return found || { model_id: spec.model_id, model_version: spec.version, status: 'missing',
          detail: { reason: 'model_files_not_found' } };
      }
      if (state.comfy[spec.runtime] && byId.has(spec.model_id)) return found;
      return { ...(found || {}), model_id: spec.model_id, model_version: spec.version, status: 'missing',
        detail: { ...(found?.detail || {}), reason: state.comfy[spec.runtime] ? 'runtime_model_catalog_unavailable' : 'runtime_offline' } };
    });
    models.push({ model_id: QWEN21_EDIT_LORA_CAPABILITY, model_version: '1', status: qwenEditLoraReady ? 'ready' : 'missing',
      detail: qwenEditLoraReady ? {} : { reason: 'qwen_21_turbo_edit_lora_unavailable' } });
    for (const [model_id,ready] of [[RMBG_CAPABILITY,sharedImage.rmbg],[SAM_B_CAPABILITY,sharedImage.samB],[SAM_L_CAPABILITY,sharedImage.samL],[SAM_H_CAPABILITY,sharedImage.samH],[SAM_AUTO_CAPABILITY,sharedImage.samAuto],[QWEN_INPAINT_CAPABILITY,qwen21Turbo && sharedImage.qwenInpaintNodes],[SEEDVR_CAPABILITY,sharedImage.seedvr],[SEETHROUGH_CAPABILITY,sharedImage.seeThrough],[SEETHROUGH_LAMA_CAPABILITY,sharedImage.seeThroughLama],[FLUX_FILL_CAPABILITY,sharedImage.fluxFill],[FLUX_REMOVAL_CAPABILITY,sharedImage.fluxRemoval]]) {
      models.push({model_id,model_version:'1',status:ready?'ready':'missing',detail:ready?{}:{reason:'required_workflow_nodes_or_models_unavailable'}});
    }
    const matting = models.find(model => model.model_id === 'birefnet-matting');
    if (matting?.status === 'ready') {
      const capability = await probeMatting(modelsRoot);
      matting.detail = { ...matting.detail, matting: capability };
      if (!capability.ok) matting.status = 'missing';
    }
    // Qwen readiness is independent of the retired Next catalogue entry.
    {
      const assistant = promptAssistantRef();
      let status = null;
      try { status = assistant && typeof assistant.status === 'function' ? assistant.status() : null; } catch (_) { status = null; }
      // The node must explicitly enable this bounded trial; file presence alone
      // is insufficient. Preserve the rest of the capability set on report.
      let uiCpuReady=false;
      try { uiCpuReady=await assistant?.probeUiCpu?.()===true; } catch { /* fail closed */ }
      models.push({model_id:UI_CPU_CAPABILITY,model_version:'1',status:uiCpuReady?'ready':'missing',detail:uiCpuReady?{}:{reason:'ui_cpu_components_unavailable'}});
      models.push({model_id:UI_PE_SOURCE_CAPABILITY,model_version:'1',status:'missing',detail:{reason:'ui_pe_source_runtime_not_verified'}});
      const qwenReady = qwenCpuAdvertisable(status, state.currentTaskId);
      models.push({ model_id: PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID, model_version: '1',
        status: qwenReady ? 'ready' : 'missing', detail: { trial: 'cpu-chat-images' } });
      if(qwenBusinessOptedIn(status)) models.push({ model_id:PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY,model_version:'1',
        status:qwenBusinessAdvertisable(status,state.currentTaskId)?'ready':'missing',detail:{trial:'cpu-business'} });
      if(Object.hasOwn(status||{},'qwen21NativeRewriteV3Enabled')) models.push({model_id:QWEN21_NATIVE_REWRITE_V3_CAPABILITY,model_version:'1',
        status:qwen21NativeRewriteV3Advertisable(status,state.currentTaskId)?'ready':'missing',detail:{trial:'cpu-qwen21-native-rewrite-v3'}});
      if(qwenImageEditEnabled===true) models.push({model_id:QWEN_IMAGE_EDIT_CAPABILITY,model_version:'1',
        status:status?.qwenImageEditEnabled===true && qwenBusinessAdvertisable(status,state.currentTaskId)?'ready':'missing',detail:{trial:'cpu-owned-single-image-edit'}});
      if(qwenRotationCandidateEnabled===true && qwenRotationVerificationEnabled===true && status?.qwenRotationCandidateEnabled===true)
        models.push({model_id:PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY,model_version:'1',
          status:qwenReady?'ready':'missing',detail:{trial:'cpu-rotation-candidate'}});
      if(qwenPlanEnabled===true && qwenPlanVerificationEnabled===true && status?.qwenPlanEnabled===true)
        models.push({model_id:QWEN_FOART_PLAN_CAPABILITY,model_version:'1',
          status:qwenReady?'ready':'missing',detail:{trial:'cpu-foart-plan'}});
    }
    onProgress(82, '正在检测 LoRA 兼容性');
    for (const model of models) {
      if ([PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID,PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY,QWEN21_NATIVE_REWRITE_V3_CAPABILITY,QWEN_IMAGE_EDIT_CAPABILITY,PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY,QWEN_FOART_PLAN_CAPABILITY,QWEN21_EDIT_LORA_CAPABILITY,RMBG_CAPABILITY,SAM_B_CAPABILITY,SAM_L_CAPABILITY,SAM_H_CAPABILITY,SAM_AUTO_CAPABILITY,QWEN_INPAINT_CAPABILITY,SEEDVR_CAPABILITY,SEETHROUGH_CAPABILITY,SEETHROUGH_LAMA_CAPABILITY,FLUX_FILL_CAPABILITY,FLUX_REMOVAL_CAPABILITY].includes(model.model_id)) continue;
      // LoRA catalogues come from ComfyUI, so a model that is not served by
      // ComfyUI has none to report. Asking anyway sends a pointless
      // /object_info query and files a failed lookup under a model that was
      // never going to have one.
      const runtime = runtimeFor(model.model_id);
      if (model.status === 'ready' && runtime !== 'local') {
        model.detail = { ...(model.detail || {}), lora_catalog: await loraCatalog.report(runtime) };
      }
    }
    if(activeTask?.qwenOwnerVerificationPending===true && activeTask.id===state.currentTaskId)return state.models;
    state.models = models;
    state.features.qwenImage21 = qwen21;
    lastFeatureProbeAt = Date.now();
    if (state.workerToken) {
      const qwenReady = models.some(model => model.model_id === PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID && model.status === 'ready');
      const businessReport = models.some(model => model.model_id === PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY);
      const businessReady = models.some(model => model.model_id === PROMPT_ASSISTANT_QWEN_BUSINESS_CAPABILITY && model.status === 'ready');
      const rotationReport=models.some(model=>model.model_id===PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY);
      const rotationReady=models.some(model=>model.model_id===PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY && model.status==='ready');
      const planReport=models.some(model=>model.model_id===QWEN_FOART_PLAN_CAPABILITY);
      const planReady=models.some(model=>model.model_id===QWEN_FOART_PLAN_CAPABILITY && model.status==='ready');
      let reportKey=planReport?`${qwenReady?1:0}:${businessReady?1:0}:${rotationReady?1:0}:${planReady?1:0}`:
        rotationReport?`${qwenReady?1:0}:${businessReady?1:0}:${rotationReady?1:0}`:(businessReport?`${qwenReady?1:0}:${businessReady?1:0}`:qwenReady);
      if(models.some(model=>model.model_id===QWEN21_NATIVE_REWRITE_V3_CAPABILITY))
        reportKey=`${reportKey}:${models.some(model=>model.model_id===QWEN21_NATIVE_REWRITE_V3_CAPABILITY && model.status==='ready')?1:0}`;
      if(models.some(model=>model.model_id===QWEN_IMAGE_EDIT_CAPABILITY))
        reportKey=`${reportKey}:${models.some(model=>model.model_id===QWEN_IMAGE_EDIT_CAPABILITY && model.status==='ready')?1:0}`;
      await qwenReport.publish(reportKey, () => callControl('POST', '/api/worker/models', { body: { models }, token: state.workerToken }));
    }
    lastModelReportAt = Date.now();
    log('models reported', { ready: models.filter((m) => m.status === 'ready').map((m) => m.model_id) });
    emit();
    return models;
  }

  // An accepted heartbeat is not proof that this client can accept work. The
  // compute-only appliance must also have an acknowledged policy and a ready
  // runtime. Other worker profiles retain their existing behavior.
  function mayAdvertiseCompute() {
    return registrationProfile !== 'compute-only' || (state.platformOnline && hasComputePolicy(state.policy)
      && state.policy.enabled && (state.policy.owner_enabled || state.policy.sharing_enabled)
      && !state.pendingApproval && state.runtimeReady);
  }
  async function withdrawAdvertisedStatus() {
    try {
      await callControl('POST', '/api/worker/heartbeat', {
        token: state.workerToken,
        body: { status: 'maintenance', current_task_id: localTasks?.has(state.currentTaskId) ? null : state.currentTaskId }
      });
    } catch { /* No connection: the server's heartbeat timeout remains the fallback. */ }
  }

  let heartbeatInFlight = null;
  async function heartbeat() {
    if (heartbeatInFlight) return heartbeatInFlight;
    heartbeatInFlight = performHeartbeat().finally(() => { heartbeatInFlight = null; });
    return heartbeatInFlight;
  }
  async function performHeartbeat() {
    let sentStatus = 'maintenance';
    try {
      if (tunnel) state.endpointUrl = tunnel.url || '';
      const previous = { ...state.comfy };
      state.comfy.image = await comfyImage.isUp();
      state.comfy.video = await comfyVideo.isUp();
      let qwenSignature = false;
      try { qwenSignature = qwenReportKey(promptAssistantRef()?.status?.(), state.currentTaskId,{
        rotationEnabled:qwenRotationCandidateEnabled===true && qwenRotationVerificationEnabled===true,
        planEnabled:qwenPlanEnabled===true && qwenPlanVerificationEnabled===true,imageEditEnabled:qwenImageEditEnabled===true
      }); } catch { /* fail closed */ }
      // Keep the last model report during the initial authoritative check;
      // never advertise a new capability until that check succeeds.
      const pendingQwenScope=activeTask?.qwenOwnerVerificationPending===true && activeTask.id===state.currentTaskId;
      if (!pendingQwenScope && (previous.image !== state.comfy.image || previous.video !== state.comfy.video
          || qwenReport.needsReport(qwenSignature) || Date.now() - lastModelReportAt > 120000)) await reportModels();
      sentStatus = sharing && !claimsPaused && (!tunnel || tunnel.url) && !localTasks?.has(state.currentTaskId) && mayAdvertiseCompute()
        ? state.status : 'maintenance';
      const reply = await callControl('POST', '/api/worker/heartbeat', {
        token: state.workerToken,
        body: {
          status: sentStatus,
          current_task_id: localTasks?.has(state.currentTaskId) ? null : state.currentTaskId,
          hardware: {
            vram_mb: state.gpu?.vramMb,
            ram_mb: state.system?.ramMb,
            worker_version: WORKER_VERSION,
            endpoint_url: state.endpointUrl
          }
        }
      });
      if (registrationProfile === 'compute-only') {
        state.policy = reply.policy || reply.worker?.policy || null;
        requireComputePolicy(state.policy);
      } else if (reply.policy || reply.worker?.policy) state.policy = reply.policy || reply.worker.policy;
      if (reply.worker) {
        state.pendingApproval = reply.worker.pending_approval ?? state.policy?.pending_approval ?? null;
        if (reply.worker.worker_name) state.platformWorkerName = String(reply.worker.worker_name);
      }
      state.platformOnline = true;
      state.lastHeartbeatAt = nowIso();
      state.lastError = '';
      // The policy may have changed in this response after the server already
      // stored an idle heartbeat; withdraw that advertisement immediately.
      if (sentStatus !== 'maintenance' && (claimsPaused || (registrationProfile === 'compute-only' && !mayAdvertiseCompute()))) {
        await withdrawAdvertisedStatus();
      }
    } catch (error) {
      state.platformOnline = false;
      // A 401 means our token aged out; re-register rather than going quiet.
      if (error.status === 401) {
        log('worker token rejected, re-registering');
        await register().catch((e) => { state.lastError = String(e?.message || e); });
      } else {
        state.lastError = String(error?.message || error);
      }
      // An old/malformed server can accept the heartbeat and omit policy from
      // its response. Remove the false idle status while the connection works.
      if (registrationProfile === 'compute-only' && sentStatus !== 'maintenance' && error.status !== 401) {
        emit();
        await withdrawAdvertisedStatus();
      }
    }
    emit();
  }

  // -------------------------------------------------------------------------
  // Task execution
  // -------------------------------------------------------------------------
  // 任务中止 on the page cancels the task in the control plane (or in the local task list). The
  // progress report is where this node learns it, and then the GPU job stops at once instead of
  // running to its end unseen.
  async function stopCancelledTask(taskId) {
    if (activeTask?.id !== taskId || activeTask.controller.signal.aborted) return;
    log('task cancelled by its owner, interrupting ComfyUI', { taskId });
    await cancelActiveTask().catch((error) => log('interrupt failed', { taskId, error: String(error?.message || error) }));
  }

  async function reportProgress(taskId, status, progress, note, promptId) {
    if (localTasks?.get(taskId)?.status === 'cancelled') await stopCancelledTask(taskId);
    checkCancelled(taskId);
    try {
      await callControl('POST', '/api/worker/tasks/' + taskId + '/progress', {
        token: state.workerToken,
        body: { status, progress, note, prompt_id: promptId }
      });
    } catch (error) {
      const message = String(error?.message || error);
      log('progress report failed', { taskId, error: message });
      if (/already cancelled/i.test(message)) {
        await stopCancelledTask(taskId);
        checkCancelled(taskId);
      }
    }
  }

  // Two minutes covers the usual one to three references; a multi-reference UI
  // run (up to 16) gets ten more seconds per extra file.
  async function waitForInputs(taskId, expected, { timeoutMs = 120000 + Math.max(0, expected.length - 3) * 10000 } = {}) {
    if (!expected.length) return [];
    const dir = join(workerTaskDirectory(dataDir, taskId), 'input');
    const started = Date.now();
    let lastCancelProbe = started;
    for (;;) {
      checkCancelled(taskId);
      let present = [];
      try {
        present = (await readdir(dir)).filter((n) => expected.some((e) => e.name === n));
      } catch { present = []; }
      if (present.length >= expected.length) return present;
      // The browser can cancel after a failed upload. During this wait there
      // is no GPU progress callback to deliver that cancellation to the node.
      if (Date.now() - lastCancelProbe >= 2000) {
        lastCancelProbe = Date.now();
        await reportProgress(taskId, TASK_STATE.UPLOADING, 2, '等待浏览器上传素材');
        checkCancelled(taskId);
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error('timed out waiting for the browser to upload ' + expected.length + ' input file(s)');
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function runTask(task) {
    if(isQwenImageEditTask(task)) {
      if(qwenImageEditEnabled!==true)throw new Error('Qwen image edit is not enabled');
      return runQwenFoartPlanTask(task,true);
    }
    if(task?.model_id===QWEN_IMAGE_EDIT_CAPABILITY)throw new Error('Qwen image edit scope missing');
    if(isQwenFoartPlanTask(task)) {
      if(qwenPlanEnabled!==true || qwenPlanVerificationEnabled!==true) throw new Error('Qwen plan is not enabled');
      return runQwenFoartPlanTask(task);
    }
    if(task?.model_id===QWEN_FOART_PLAN_CAPABILITY) throw new Error('Qwen plan scope missing');
    if (candidateTaskIdState(task?.id)==='candidate' && qwenRotationCandidateEnabled===true && qwenRotationVerificationEnabled===true)
      return runQwenRotationCandidateTask(task);
    validateQwenRotationCandidateTask(task);
    if (task.task_type === PROMPT_ASSISTANT_TASK_TYPE) return runTaskUnlocked(task);
    const release = await promptAssistantRef()?.acquireGeneration?.(task.id,{isCancelled:()=>{try{checkCancelled(task.id);return false;}catch{return true;}}});
    try { return await runTaskUnlocked(task); } finally { release?.(); }
  }

  async function runTaskUnlocked(task) {
    checkCancelled(task.id);

    // AI 抠图 is the one task that is not a ComfyUI graph: it runs BiRefNet in
    // a Python process. Everything below this line belongs to ComfyUI -
    // loadWorkflow throws outright for a type that names no graph file, and
    // comfy.isUp() would refuse a job on a machine that can cut out perfectly
    // well without a generation runtime running. So the branch goes first.
    if (task.task_type === MATTING_TASK_TYPE) return runMattingTask(task);
    if (task.task_type === PROMPT_ASSISTANT_TASK_TYPE) return runPromptAssistantTask(task);

    // Two shapes of task. A renderer workflow names one of NovaFlow's own
    // builders and we run it here; a fixed task type uses a template file.
    const intent = task.workflow && task.workflow.module ? task.workflow : null;
    const moduleSpec = intent ? workflowModule(intent.module) : null;

    const req = intent
      ? { kind: moduleSpec?.kind || 'image', modelId: moduleSpec?.modelId }
      : requirementsFor(task.task_type);
    const template = intent ? null : await loadWorkflow(workflowDir, task.task_type);
    const runtime = intent
      ? (moduleSpec?.runtime || 'image')
      : (template.comfy === 'video' ? 'video' : 'image');
    const comfy = comfyFor(runtime);
    let parameters = task.parameters || {};

    if (!await comfy.isUp()) {
      state.comfy[runtime] = false;
      await reportModels();
      throw new Error((runtime === 'video' ? '视频' : '图像') + '算力服务未启动或已断开：' + comfy.baseUrl + '，请启动本地算力服务后重试');
    }

    checkCancelled(task.id);
    state.currentTaskId = task.id;
    state.status = 'busy';
    emit();

    const outDir = join(workerTaskDirectory(dataDir, task.id), 'output');
    await mkdir(outDir, { recursive: true });

    // 1. Inputs. The browser uploads straight to this worker's gateway -
    //    through the tunnel when it is somebody else's browser. Nothing about
    //    a task's files goes through storage in either direction.
    const expectedRefs = Array.isArray(task.references) && task.references.length
      ? task.references
      : (Array.isArray(parameters.references) ? parameters.references : []);
    const referenceFilenames = [];
    if (expectedRefs.length) {
      await reportProgress(task.id, TASK_STATE.UPLOADING, 2, 'waiting for reference upload');
      const names = await waitForInputs(task.id, expectedRefs);
      for (let i = 0; i < expectedRefs.length; i += 1) {
        checkCancelled(task.id);
        const name = names.find((n) => n === expectedRefs[i].name) || names[i];
        if (!name) continue;
        const bytes = await readFile(join(workerTaskDirectory(dataDir, task.id), 'input', name));
        const target = 'nfweb-' + task.id.slice(0, 8) + '-' + i + '-' + name;
        await comfy.uploadImage(target, bytes);
        referenceFilenames[i] = target;
      }
    }

    // Image and video share one ComfyUI (H3 moved onto the 0.37 runtime). Its own eviction only makes
    // room in VRAM and keeps the evicted weights in RAM, and H3 (32B text encoder) next to Qwen-Image-2.1
    // does not fit a 16 GB card either way: unload everything whenever the task kind changes, and keep
    // the models loaded between tasks of the same kind. Only after the references are in: a task still
    // waiting for its upload must stay 'uploading', or the control plane refuses the browser's grant.
    if (lastRuntimeKind && lastRuntimeKind !== runtime) {
      await reportProgress(task.id, TASK_STATE.PROCESSING, 4, 'freeing memory for the ' + runtime + ' models');
      await comfy.freeMemory().catch((error) => log('free failed', { error: String(error?.message || error) }));
    }
    lastRuntimeKind = runtime;

    await reportProgress(task.id, TASK_STATE.PROCESSING, 8, 'submitting to ComfyUI');

    // 2. Build the graph. The browser never saw or supplied any of this.
    let graph;
    let seed = null;
    if (intent) {
      const host = await workflowHost(runtime);
      if (!host) throw new Error('this worker has no renderer workflow host configured');
      // The browser recorded WHICH builder and WHAT options; the builder
      // itself has never left this machine.
      //
      // This MUST be awaited: buildGraph reads the ComfyUI node catalogue
      // before it emits, so it is async. Without the await `graph` is a
      // promise - and a rejected one takes the whole node down instead of
      // failing the one task.
      graph = await host.buildGraph({
        module: intent.module,
        method: intent.method,
        options: withReferences(parameters, referenceFilenames, expectedRefs, intent.method)
      });
      assertGraphLoadsTaskInputs(graph, referenceFilenames);
    } else {
      const extra = { referenceFilenames };
      if (req?.kind === 'video') {
        extra.length = videoFrameLength(parameters.duration_seconds, parameters.fps);
      }
      if (req?.kind === 'audio') {
        const audio = audioGraphExtras(task.task_type,parameters);
        if (parameters.reprompt !== false) {
          await reportProgress(task.id,TASK_STATE.PROCESSING,6,'Flash 正在整理音频描述');
          const reply = await rewriteAudioPrompt({kind:task.task_type==='audio_music'?'music':'sfx',text:parameters.prompt,
            seconds:audio.generate_seconds,bpm:parameters.bpm,loop:parameters.loop},{taskId:task.id,isCancelled:()=>{try{checkCancelled(task.id);return false;}catch{return true;}}});
          if(!reply?.ok)throw new Error(reply?.error || 'Flash 音频描述分析失败');
          parameters={...parameters,prompt:reply.prompt,reprompt:false};
        }
        Object.assign(extra,audioGraphExtras(task.task_type,parameters));
      }
      graph = buildGraph(template, parameters, extra);
      seed = resolvedSeed(template, graph);
    }

    assertSupportedDrawingGraph(intent, graph, task);
    await loraCatalog.validateGraph(graph, parameters);

    // 3. Run.
    const startedAt = Date.now();
    checkCancelled(task.id);
    const promptId = await comfy.queuePrompt(graph);
    idleReclaimer.noteGraph(comfy);
    activeTask.comfy = comfy; activeTask.promptId = promptId;
    if (activeTask.controller.signal.aborted || localTasks?.get(task.id)?.status === 'cancelled') await comfy.cancelPrompt(promptId);
    checkCancelled(task.id);
    await reportProgress(task.id, TASK_STATE.PROCESSING, 12, 'queued in ComfyUI', promptId);

    // ComfyUI reports progress only when it changes, which can be minutes apart; the same report
    // every few seconds is how a cancel from the page reaches a long render.
    let lastReport = [12, 'queued in ComfyUI'];
    const cancelWatch = setInterval(() => {
      reportProgress(task.id, TASK_STATE.PROCESSING, lastReport[0], lastReport[1], promptId).catch(() => {});
    }, 5000);
    let history;
    try {
      history = await comfy.waitForPrompt(promptId, {
        signal: activeTask.controller.signal,
        onProgress: async (pct, note) => {
          lastReport = [pct, note];
          await reportProgress(task.id, TASK_STATE.PROCESSING, pct, note, promptId);
        }
      });
    } finally {
      clearInterval(cancelWatch);
    }

    // 4. Pull results out of ComfyUI and into this task's folder, so the
    //    browser fetches them from the gateway and never touches ComfyUI.
    checkCancelled(task.id);
    const produced = collectOutputs(history);
    if (!produced.length) throw new Error('ComfyUI finished without producing a file');

    const outputs = [];
    for (let i = 0; i < produced.length; i += 1) {
      checkCancelled(task.id);
      const item = produced[i];
      const bytes = await comfy.viewFile(item);
      const ext = (item.filename.match(/\.[A-Za-z0-9]+$/) || ['.png'])[0];
      // The art editor matches history outputs by its request prefix. Renaming
      // every result to out_0001 makes a completed task look empty forever.
      // Add task identity as a suffix so simultaneous tasks cannot collide.
      const stem = item.filename.replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 90);
      const safeName = stem + '-' + task.id.slice(0, 8) + '-' + (i + 1) + ext;
      await writeFile(join(outDir, safeName), bytes);
      const info = await stat(join(outDir, safeName));
      outputs.push({
        name: safeName,
        kind: /\.(mp4|webm)$/i.test(ext) ? 'video' : /\.(wav|flac|mp3|ogg)$/i.test(ext) ? 'audio' : 'image',
        bytes: info.size,
        width: Number(parameters.width) || 0,
        height: Number(parameters.height) || 0,
        duration_seconds: req?.kind === 'video' || req?.kind === 'audio' ? Number(parameters.duration_seconds) || 0 : 0,
        ...(item.caption ? { caption: item.caption } : {})
      });
    }

    // 一键拆图 keeps its layers outside the prompt history; copy them by name (collectSeeThroughOutputs).
    if (intent && intent.method === SEE_THROUGH_SPLIT_METHOD) {
      const prefix = String(parameters.__args?.[2]?.prefix || '');
      for (const file of await collectSeeThroughOutputs(comfy, prefix)) {
        checkCancelled(task.id);
        await writeFile(join(outDir, file.name), file.bytes);
        outputs.push({ name: file.name, kind: file.kind, bytes: file.bytes.length, width: 0, height: 0, duration_seconds: 0 });
      }
    }

    // 5. Report. The worker reports success and execution metadata; the
    //    control plane decides what it costs (spec 17).
    const comfyVersion = (await comfy.systemStats().catch(() => null))?.system?.comfyui_version || '';
    checkCancelled(task.id);
    const result = await callControl('POST', '/api/worker/tasks/' + task.id + '/complete', {
      token: state.workerToken,
      body: {
        prompt_id: promptId,
        outputs,
        execution: {
          elapsed_ms: Date.now() - startedAt,
          comfy_version: comfyVersion,
          seed
        }
      }
    });

    state.stats.completed += 1;
    log('task completed', { taskId: task.id, outputs: outputs.length, ms: Date.now() - startedAt });
    return result;
  }

  /**
   * AI 抠图 - the only task type that never touches ComfyUI.
   *
   * It reuses every part of the pipeline that is not ComfyUI's: the same
   * cancellation token, the same wait for the browser's upload, the same
   * progress reports, the same completion POST. Only the middle step differs,
   * and that step is BiRefNet driven by the same birefnet-runner.py the
   * desktop app has shipped all along - so the mattes a Web user gets are
   * produced by the identical model and transform as the desktop's.
   */
  async function runMattingTask(task) {
    const startedAt = Date.now();
    checkCancelled(task.id);
    idleReclaimer.noteActivity();
    state.currentTaskId = task.id;
    state.status = 'busy';
    emit();

    const parameters = task.parameters || {};
    const taskDir = workerTaskDirectory(dataDir, task.id);
    const outDir = join(taskDir, 'output');
    await mkdir(outDir, { recursive: true });

    const expectedRefs = Array.isArray(task.references) && task.references.length
      ? task.references
      : (Array.isArray(parameters.references) ? parameters.references : []);
    if (!expectedRefs.length) throw new Error('抠图任务没有声明源视频');

    await reportProgress(task.id, TASK_STATE.UPLOADING, 2, '等待浏览器上传源视频');
    const names = await waitForInputs(task.id, expectedRefs);
    checkCancelled(task.id);

    const sourceName = names.find((n) => n === expectedRefs[0].name) || names[0];
    if (!sourceName) throw new Error('源视频没有送达');

    await reportProgress(task.id, TASK_STATE.PROCESSING, 8, '正在解码帧');
    let progressReports = Promise.resolve();
    const produced = await runMatting({
      sourcePath: join(taskDir, 'input', sourceName),
      framePacks: expectedRefs.map(ref => join(taskDir, 'input', ref.name)),
      workDir: taskDir,
      outDir,
      parameters,
      modelsRoot,
      log,
      onProgress: (percent, note) => {
        progressReports = progressReports.then(() => reportProgress(task.id, TASK_STATE.PROCESSING, percent, note))
          .catch(error => log('matting progress failed', { error: error.message }));
      },
      isCancelled: () => {
        try { checkCancelled(task.id); return false; } catch (_) { return true; }
      }
    });
    // Completion must not overtake the final progress request on a slow link.
    await progressReports;

    const outputs = [];
    for (const name of produced) {
      const info = await stat(join(outDir, name));
      outputs.push({
        name,
        kind: /\.(mp4|webm)$/i.test(name) ? 'video' : 'mask',
        bytes: info.size,
        width: Number(parameters.width) || 0,
        height: Number(parameters.height) || 0,
        duration_seconds: 0
      });
    }

    checkCancelled(task.id);
    const result = await callControl('POST', '/api/worker/tasks/' + task.id + '/complete', {
      token: state.workerToken,
      body: {
        // The control plane requires a prompt_id and there is no ComfyUI
        // prompt behind this task, so it carries the job's own identity.
        prompt_id: 'matting-' + task.id,
        outputs,
        execution: { elapsed_ms: Date.now() - startedAt, comfy_version: '', seed: null }
      }
    });

    state.stats.completed += 1;
    log('matting completed', { taskId: task.id, outputs: outputs.length, ms: Date.now() - startedAt });
    return result;
  }

  /**
   * 提示词助手 for the pool: the same Python service the local page talks to,
   * asked by a task. The request is the one uploaded JSON file, the reply is
   * the one output file - ok:false replies included, so the page shows the
   * assistant's own message exactly as the local route would.
   */
  const PROMPT_ASSISTANT_METHODS = {
    'optimize-prompt': 'optimizePrompt',
    'reverse-image-prompt': 'reverseImagePrompt',
    'describe-art-style': 'describeArtStyle',
    'rewrite-audio-prompt': 'rewriteAudioPrompt',
    'art-agent-chat': 'artAgentChat'
  };

  async function qwenPlanDirectories(taskId) {
    if(!QWEN_FOART_PLAN_ID.test(String(taskId || '')))throw new Error('invalid Qwen plan task');
    const paths=[dataDir,join(dataDir,'tasks'),join(dataDir,'tasks',taskId),
      join(dataDir,'tasks',taskId,'input'),join(dataDir,'tasks',taskId,'output')];
    for(let i=0;i<paths.length;i++) {
      let info;
      try {info=await lstat(paths[i]);}
      catch(error) {
        if(error?.code!=='ENOENT' || i<2)throw error;
        try {await mkdir(paths[i]);} catch(createError) {if(createError?.code!=='EEXIST')throw createError;}
        info=await lstat(paths[i]);
      }
      if(info.isSymbolicLink() || !info.isDirectory())throw new Error('unsafe Qwen plan task directory');
    }
    return {input:paths[3],output:paths[4]};
  }

  async function runQwenFoartPlanTask(task,imageEdit=false) {
    if(imageEdit)validateQwenImageEditTask(task);else validateQwenFoartPlanTask(task);
    const assistant=promptAssistantRef();
    if(!assistant || typeof assistant.runForTask!=='function' || (imageEdit?assistant.status?.()?.qwenImageEditEnabled!==true:assistant.status?.()?.qwenPlanEnabled!==true))
      throw new Error('Qwen plan assistant unavailable');
    const actor=Object.freeze({taskId:task.id,workerId:state.workerId,scope:imageEdit?QWEN_IMAGE_EDIT_SCOPE:QWEN_FOART_PLAN_SCOPE,attempt:task.attempt_count});
    const verifier=createQwenFoartPlanOnlineVerifier({callControl,getWorkerToken:()=>state.workerToken,getWorkerId:()=>state.workerId});
    const cancelled=()=>{try{checkCancelled(task.id);return false;}catch{return true;}};
    let owner=null;
    const check=async (op,phase='start')=>{
      try {
        if(cancelled())throw new Error('Qwen plan task cancelled');
        const result=await verifier({...actor,op,phase,signal:activeTask?.controller.signal});
        if(!owner)owner={userId:result.userId,sessionId:result.sessionId};
        if(cancelled() || owner.userId!==result.userId || owner.sessionId!==result.sessionId)
          throw new Error('Qwen plan session changed');
        return result;
      } catch(error) {if(imageEdit && activeTask?.id===task.id)activeTask.qwenOwnerVerified=false;throw error;}
    };
    const progress=async (status,percent,note)=>{
      checkCancelled(task.id);
      const result=await callControl('POST','/api/worker/tasks/'+task.id+'/progress',{
        token:state.workerToken,signal:activeTask?.controller.signal,
        body:{status,progress:percent,note,attempt:actor.attempt}
      });
      const row=result?.task;
      if(result?.ok!==true || row?.id!==task.id || row.status!==status ||
         row.assigned_worker_id!==state.workerId || row.attempt_count!==actor.attempt)
        throw new Error('Qwen plan progress unconfirmed');
      checkCancelled(task.id);
    };
    const dirs=await qwenPlanDirectories(task.id),input=join(dirs.input,imageEdit?QWEN_IMAGE_EDIT_INPUT:QWEN_FOART_PLAN_INPUT);
    try {await check('wait');if(imageEdit && activeTask?.id===task.id){activeTask.qwenOwnerVerified=true;activeTask.qwenOwnerVerificationPending=false;}}
    catch(error){if(imageEdit && activeTask?.id===task.id){activeTask.qwenOwnerVerified=false;activeTask.qwenOwnerVerificationPending=false;}throw error;}
    await progress(TASK_STATE.UPLOADING,2,'等待浏览器上传请求');
    const started=Date.now();let lastProbe=0;
    for(;;) {
      checkCancelled(task.id);
      try {
        const info=await lstat(input);
        if(info.isSymbolicLink() || !info.isFile())throw new Error('unsafe Qwen plan input');
        break;
      } catch(error) {if(error?.code!=='ENOENT')throw error;}
      if(Date.now()-lastProbe>=2000) {lastProbe=Date.now();await check('wait');}
      if(Date.now()-started>120000)throw new Error('Qwen plan input timed out');
      await new Promise(resolve=>setTimeout(resolve,300));
    }
    // Gateway publishes the approved request atomically. Recheck both its
    // actual bytes and the original, server-bound digest before using it.
    const inputBytes=await readFile(input),p=task.parameters;
    if(inputBytes.length!==p.request_bytes || createHash('sha256').update(inputBytes).digest('hex')!==p.request_sha256)
      throw new Error('Qwen plan input digest mismatch');
    let request;try {request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(inputBytes));}
    catch {throw new Error('Qwen plan request invalid');}
    if(!request || request.requestId!==p.request_id)throw new Error('Qwen plan request binding mismatch');
    if(imageEdit)validateQwenImageEditPayload(request,p.request_id);
    await progress(TASK_STATE.PROCESSING,10,'本地模型规划中');
    const verify=async (candidate,phase)=>{
      if(cancelled() || !candidate || candidate.taskId!==actor.taskId || candidate.workerId!==actor.workerId ||
        candidate.scope!==actor.scope || candidate.attempt!==actor.attempt || !['before','after'].includes(phase))return false;
      try {await check('infer',phase==='before'?'start':'finish');return !cancelled();} catch {return false;}
    };
    const reply=await assistant.runForTask(task.id,imageEdit?'qwenImageEdit':'qwenRotationCandidate',request,{
      ...(imageEdit?{imageEditActor:actor,imageEditPhaseVerifier:verify}:{rotationActor:actor,rotationPhaseVerifier:verify}),isCancelled:cancelled
    });
    if(reply?.ok!==true || !reply.data)throw new Error(qwenPlanSafeFailureMessage(reply));
    const editInstruction=imageEdit?(request.requirements.trim()||request.currentPrompt).replace(/[“「『][^”」』\r\n]*[”」』]|“[^”]*”|‘[^’]*’|"[^"\r\n]*"|(?<![A-Za-z0-9])'[^'\r\n]+'(?![A-Za-z0-9])|<image\d+>|@参考图\s*\d+|__NF[A-Za-z0-9_]+__/g,''):'';
    const editLanguage=/[\u3400-\u9fff]/u.test(editInstruction)?'zh':'en';
    if(imageEdit && (reply.data.analysisBackend!=='qwen-cpu' || reply.data.modelIdentity?.id!=='qwen35-heretic' ||
      reply.data.modelIdentity?.verification!=='server-weight-path' || reply.data.resourcesReleased!==true || reply.data.generationReady!==true ||
      reply.data.promptContract!=='qwen21-native-rewrite-v3' || reply.data.modelPromptPolicy!=='qwen21-native-rewrite-v3' ||
      reply.data.translationValidation!=='native-edit-and-literals' || reply.data.modelPromptLanguage!==editLanguage ||
      typeof reply.data.displayPrompt!=='string' || reply.data.displayPrompt.trim().length<2 || typeof reply.data.modelPrompt!=='string' ||
      reply.data.modelPrompt!==reply.data.displayPrompt || reply.data.negativePrompt!==request.negativePrompt))
      throw new Error('Qwen image edit result unverified');
    if(imageEdit && request.images.length>1){
      const referenced=new Set([...reply.data.modelPrompt.matchAll(/<image(\d+)>/gi)].map(match=>Number(match[1])));
      if(referenced.size!==request.images.length || request.images.some((_,index)=>!referenced.has(index+1)))
        throw new Error('Qwen image edit reference binding unverified');
    }
    if(await verify(actor,'after')!==true)throw new Error('Qwen plan authorization expired');
    const resultName=imageEdit?`qwen21-local-image-edit-result-${actor.attempt}.json`:qwenFoartPlanResultName(actor.attempt),output=join(dirs.output,resultName);
    const binding={taskId:task.id,workerId:state.workerId,
      attempt:actor.attempt,requestId:p.request_id,requestSha256:p.request_sha256};
    const bytes=Buffer.from(JSON.stringify({...reply,...(imageEdit?{imageEditBinding:binding}:{planBinding:binding})}));
    if(bytes.length<1 || bytes.length>65536)throw new Error('Qwen plan result size invalid');
    let written=false,completionAttempted=false,completed=false,completionDenied=false;
    try {
      await writeFile(output,bytes,{flag:'wx'});written=true;
      await check('complete');
      completionAttempted=true;
      let result;
      try {result=await callControl('POST','/api/worker/tasks/'+task.id+'/complete',{
        token:state.workerToken,signal:activeTask?.controller.signal,
        body:{attempt:actor.attempt,prompt_id:'prompt-'+task.id,
          outputs:[{name:resultName,kind:'json',bytes:bytes.length,width:0,height:0,duration_seconds:0}],
          execution:{elapsed_ms:Date.now()-started,comfy_version:'',seed:null}}
      });} catch(error) {
        completionDenied=Number(error?.status)===403;
        if(!completionDenied)throw Object.assign(new Error('Qwen plan completion unconfirmed',{cause:error}),{code:'qwen-plan-completion-unknown'});
        throw error;
      }
      const row=result?.task;
      if(result?.ok!==true || row?.id!==task.id || row.status!==TASK_STATE.COMPLETED ||
        row.assigned_worker_id!==state.workerId || row.attempt_count!==actor.attempt)
        throw Object.assign(new Error('Qwen plan completion unconfirmed'),{code:'qwen-plan-completion-unknown'});
      completed=true;state.stats.completed+=1;return result;
    } finally {
      if(written && !completed && (!completionAttempted || completionDenied))await rm(output,{force:true}).catch(()=>{});
    }
  }

  async function runQwenRotationCandidateTask(task) {
    const p=task?.parameters || {}, refs=task?.references;
    if(candidateTaskIdState(task?.id)!=='candidate' || task.task_type!==PROMPT_ASSISTANT_TASK_TYPE ||
       task.model_id!==PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY ||
       p.action!=='art-agent-chat' || p.model_id!==PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_CAPABILITY ||
       p.assistant_tool_scope!==PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_SCOPE ||
       p.foartAnimationStage!=='rotation_candidate' || !Number.isSafeInteger(task.attempt_count) || task.attempt_count<1 ||
       !Array.isArray(refs) || refs.length!==1 || refs[0]?.name!==PROMPT_ASSISTANT_REQUEST_FILE ||
       !Number.isSafeInteger(refs[0]?.bytes) || refs[0].bytes<1 || refs[0].bytes>262144)
      throw new Error('candidate task metadata invalid');
    const assistant=promptAssistantRef();
    if(!assistant || typeof assistant.runForTask!=='function')throw new Error('candidate assistant unavailable');
    const actor=Object.freeze({taskId:task.id,workerId:state.workerId,scope:PROMPT_ASSISTANT_QWEN_ROTATION_CANDIDATE_SCOPE,attempt:task.attempt_count});
    const phase=createQwenCandidatePhaseVerifier({callControl,getWorkerToken:()=>state.workerToken,getWorkerId:()=>state.workerId});
    const cancelled=()=>{try{checkCancelled(task.id);return false;}catch{return true;}};
    const verify=async (candidate,step)=>{
      if(cancelled() || !candidate || candidate.taskId!==actor.taskId || candidate.workerId!==actor.workerId ||
         candidate.scope!==actor.scope || candidate.attempt!==actor.attempt)return false;
      const op=step==='before'?'infer':step==='after'?'complete':'';
      if(!op)return false;
      const valid=await phase({...actor,op,signal:activeTask?.controller.signal});
      return valid===true && !cancelled();
    };
    const dir=workerTaskDirectory(dataDir,task.id), input=join(dir,'input',PROMPT_ASSISTANT_REQUEST_FILE);
    const output=join(dir,'output',PROMPT_ASSISTANT_RESULT_FILE), started=Date.now();
    let lastProbe=0;
    for(;;){
      checkCancelled(task.id);
      try {await stat(input);break;} catch(error){if(error?.code!=='ENOENT')throw error;}
      if(Date.now()-lastProbe>=2000){
        lastProbe=Date.now();
        if(await phase({...actor,op:'wait',signal:activeTask?.controller.signal})!==true || cancelled())
          throw new Error('candidate task no longer authorized');
      }
      if(Date.now()-started>120000)throw new Error('candidate input timed out');
      await new Promise(resolve=>setTimeout(resolve,300));
    }
    const inputBytes=await readFile(input);
    if(inputBytes.length!==refs[0].bytes || inputBytes.length<1 || inputBytes.length>262144)throw new Error('candidate input size mismatch');
    const sha256=createHash('sha256').update(inputBytes).digest('hex');
    let request;
    try {request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(inputBytes));}
    catch {throw new Error('candidate request invalid');}
    checkCancelled(task.id);
    const start=await callControl('POST','/api/worker/tasks/'+task.id+'/qwen-rotation-start',{
      token:state.workerToken,signal:activeTask?.controller.signal,body:{attempt:actor.attempt,sha256,bytes:inputBytes.length}
    });
    if(start?.ok!==true || start.taskId!==task.id || start.workerId!==state.workerId || start.attempt!==actor.attempt || start.action!=='start')
      throw new Error('candidate start unconfirmed');
    checkCancelled(task.id);
    const reply=await assistant.runForTask(task.id,'qwenRotationCandidate',request,{
      rotationActor:actor,rotationPhaseVerifier:verify,isCancelled:cancelled
    });
    if(reply?.ok!==true || !reply.data)throw new Error('candidate model did not produce a valid response');
    if(await verify(actor,'after')!==true)throw new Error('candidate task no longer authorized');
    const bytes=Buffer.from(JSON.stringify(reply));
    if(bytes.length<1 || bytes.length>65536)throw new Error('candidate result size invalid');
    let written=false,completed=false,completionAttempted=false,completionDenied=false;
    try {
      await mkdir(join(dir,'output'),{recursive:true});
      await writeFile(output,bytes,{flag:'wx'});written=true;
      checkCancelled(task.id);
      completionAttempted=true;
      let finish;
      try {finish=await callControl('POST','/api/worker/tasks/'+task.id+'/qwen-rotation-complete',{
        token:state.workerToken,signal:activeTask?.controller.signal,body:{attempt:actor.attempt,bytes:bytes.length}
      });} catch(error) {
        // A timeout or conflict can be returned by an intermediary after the
        // server committed. Only this endpoint's explicit 403 means the
        // transaction rejected completion; all other errors remain unknown.
        completionDenied=Number(error?.status)===403;
        if(!completionDenied)throw Object.assign(new Error('candidate completion unconfirmed',{cause:error}),{code:'candidate-completion-unknown'});
        throw error;
      }
      if(finish?.ok!==true || finish.taskId!==task.id || finish.workerId!==state.workerId || finish.attempt!==actor.attempt || finish.action!=='complete')
        throw Object.assign(new Error('candidate completion unconfirmed'),{code:'candidate-completion-unknown'});
      completed=true;state.stats.completed+=1;
    } finally {if(written && !completed && (!completionAttempted || completionDenied))await rm(output,{force:true}).catch(()=>{});}
    return {ok:true};
  }
  async function runPromptAssistantTask(task) {
    validateQwenRotationCandidateTask(task);
    validateQwenUiTask(task);
    const startedAt = Date.now();
    checkCancelled(task.id);
    state.currentTaskId = task.id;
    state.status = 'busy';
    emit();

    const assistant = promptAssistantRef();
    if (!assistant || typeof assistant.runForTask !== 'function') throw new Error('此算力节点没有提示词助手');
    const parameters = task.parameters || {};
    const method = PROMPT_ASSISTANT_METHODS[String(parameters.action || '')];
    if (!method) throw new Error('未知的提示词助手操作：' + String(parameters.action || ''));
    const taskDir = workerTaskDirectory(dataDir, task.id);
    const outDir = join(taskDir, 'output');
    await mkdir(outDir, { recursive: true });

    const expectedRefs = Array.isArray(task.references) && task.references.length
      ? task.references
      : (Array.isArray(parameters.references) ? parameters.references : []);
    if (!expectedRefs.length) throw new Error('提示词任务没有声明请求文件');
    await reportProgress(task.id, TASK_STATE.UPLOADING, 2, '等待浏览器上传请求');
    const names = await waitForInputs(task.id, expectedRefs);
    checkCancelled(task.id);
    const requestName = names.find((n) => n === PROMPT_ASSISTANT_REQUEST_FILE) || names[0];
    if (!requestName) throw new Error('提示词请求没有送达');
    let request;
    try { request = JSON.parse(await readFile(join(taskDir, 'input', requestName), 'utf8')); }
    catch (error) { throw new Error('提示词请求不是有效的 JSON：' + String(error.message || error)); }

    await reportProgress(task.id, TASK_STATE.PROCESSING, 10, '本地模型推理中');
    validatePromptAssistantModelRoute(task, request);
    let progressReports=Promise.resolve();
    const onProgress=event=>{
      if(!['preparing','loading','analyzing','releasing'].includes(event?.phase)||!['analysis','optimize','compile'].includes(event?.stage))return;
      progressReports=progressReports.then(()=>reportProgress(task.id,TASK_STATE.PROCESSING,10,'NFPA1:'+event.phase+':'+event.stage)).catch(()=>{});
    };
    let reply;
    try{reply=await assistant.runForTask(task.id, method, request && typeof request === 'object' ? request : {}, {onProgress,taskId:task.id,uiScope:parameters.ui_scope,isCancelled: () => { try { checkCancelled(task.id); return false; } catch { return true; } }});}
    finally{await progressReports.catch(()=>{});}
    checkCancelled(task.id);
    const bytes = Buffer.from(JSON.stringify(reply ?? { ok: false, error: '提示词助手没有返回结果' }));
    await writeFile(join(outDir, PROMPT_ASSISTANT_RESULT_FILE), bytes);

    const result = await callControl('POST', '/api/worker/tasks/' + task.id + '/complete', {
      token: state.workerToken,
      body: {
        prompt_id: 'prompt-' + task.id,
        outputs: [{ name: PROMPT_ASSISTANT_RESULT_FILE, kind: 'json', bytes: bytes.length, width: 0, height: 0, duration_seconds: 0 }],
        execution: { elapsed_ms: Date.now() - startedAt, comfy_version: '', seed: null }
      }
    });

    state.stats.completed += 1;
    log('prompt assistant completed', { taskId: task.id, action: parameters.action, ok: reply?.ok !== false, ms: Date.now() - startedAt });
    return result;
  }

  async function claimAndRun({ throttleCloud = false } = {}) {
    if (claimsPaused || claimBusy || state.currentTaskId) return false;
    claimBusy = true;
    try { return await claimAndRunLocked({ throttleCloud }); }
    finally {
      claimBusy = false;
      // A stop may arrive during an empty cloud claim, before a task exists.
      if (draining && !state.currentTaskId) draining = false;
      emit();
    }
  }

  async function claimAndRunLocked({ throttleCloud = false } = {}) {
    const epoch = shareEpoch;
    let claim;
    const local = localRunning && localTasks?.next();
    if (local) claim = { task: local };
    else if (!sharing || !running || (tunnel && !tunnel.url)) return false;
    if (!local && registrationProfile === 'compute-only' && (!hasComputePolicy(state.policy) || !state.policy.enabled
      || !(state.policy.owner_enabled || state.policy.sharing_enabled) || !state.runtimeReady)) return false;
    // Both existing polling timers share this gate. A private local task and
    // an explicit claimAndRun() call retain their immediate behavior.
    if (!local && throttleCloud && performance.now() < nextCloudClaimAt) return false;
    const backoffEpoch = cloudClaimBackoffEpoch;
    try {
      if (!claim) claim = await callControl('POST', '/api/worker/claim', { token: state.workerToken });
      if (!local && claim && claim.task===null && qwenRotationCandidateEnabled===true && qwenRotationVerificationEnabled===true) {
        if(claimsPaused || !sharing || !running || epoch!==shareEpoch)return false;
        let candidateStatus;
        try {candidateStatus=promptAssistantRef()?.status?.();} catch {deferCloudClaim(backoffEpoch);return false;}
        if(!candidateStatus || typeof candidateStatus!=='object' || candidateStatus.ok===false){deferCloudClaim(backoffEpoch);return false;}
        if(candidateStatus.qwenRotationCandidateEnabled!==true){deferCloudClaim(backoffEpoch,true);return false;}
        if(!qwenCpuAdvertisable(candidateStatus,state.currentTaskId)){deferCloudClaim(backoffEpoch);return false;}
        claim=await callControl('POST','/api/worker/qwen-rotation/claim',{token:state.workerToken,body:{}});
      }
    } catch (error) {
      // A failed claim response cannot prove that the server did not reserve a
      // task. Preserve that uncertainty for later maintenance checks; normal
      // sharing still follows the existing retry behavior.
      claimOutcomeUnknown = true;
      if (!local) deferCloudClaim(backoffEpoch);
      if (registrationProfile === 'compute-only') {
        state.platformOnline = false;
        state.lastError = String(error.message || error);
        emit();
      }
      if (error.status === 401) await register().catch(() => {});
      return false;
    }
    if (!claim || typeof claim !== 'object' || !Object.hasOwn(claim, 'task') ||
        (claim.task !== null && (typeof claim.task !== 'object' || !claim.task.id))) {
      // A malformed response is no proof that the server did not reserve work.
      claimOutcomeUnknown = true;
      if (!local) deferCloudClaim(backoffEpoch);
      return false;
    }
    if (!claim.task) { if (!local) deferCloudClaim(backoffEpoch,true); return false; }
    if (!local) resetCloudClaimBackoff();
    if (claim.grantKey) state.grantKey = claim.grantKey;

    const task = claim.task;
    activeTask = { id: task.id, controller: new AbortController(), promptId: '', comfy: null,
      qwenTextBusinessClaimed:isClaimedQwenTextBusinessTask(task),
      ...(isQwenImageEditTask(task)?{qwenOwnerVerificationPending:true,qwenOwnerVerified:false}:{}) };
    if (!local && (!sharing || epoch !== shareEpoch)) activeTask.controller.abort();
    // Mark the reservation before async model/health checks so closing the
    // local editor cannot tear down a task that is still preparing.
    state.currentTaskId = task.id;
    state.status = 'busy';
    emit();
    try {
      await runTask(task);
    } catch (error) {
      const message = String(error?.message || error);
      log('task failed', { taskId: task.id, error: message });
      const cancelled = activeTask?.controller.signal.aborted;
      if (!cancelled) state.stats.failed += 1;
      try {
        if(candidateTaskIdState(task.id)==='candidate') {
          if(error?.code!=='candidate-completion-unknown')
            await callControl('POST','/api/worker/tasks/'+task.id+'/qwen-rotation-fail',{
              token:state.workerToken,body:{attempt:task.attempt_count}
            });
        } else if((isQwenFoartPlanTask(task)||isQwenImageEditTask(task)) && error?.code==='qwen-plan-completion-unknown') {
          // Completion may have committed before a lost response; do not mark
          // it failed or delete its result until authoritative reconciliation.
        } else await callControl('POST', '/api/worker/tasks/' + task.id + '/fail', {
          token: state.workerToken,
          body: {
            ...((isQwenFoartPlanTask(task)||isQwenImageEditTask(task))?{attempt:task.attempt_count}:{}),
            error_code: cancelled ? 'worker_stopped' : /timed out/i.test(message) ? 'timeout' : 'worker_error',
            error_message: message.slice(0, 500)
          }
        });
      } catch (reportError) {
        // If we cannot even report the failure, the control plane's heartbeat
        // sweeper will requeue the task. Nothing is charged either way.
        log('failure report failed', { taskId: task.id, error: String(reportError?.message || reportError) });
      }
    } finally {
      activeTask = null;
      idleReclaimer.noteActivity();
      state.currentTaskId = null;
      state.status = 'idle';
      draining = false;
      resetCloudClaimBackoff();
      if (state.workerToken) await heartbeat();
      emit();
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // TTL cleanup (spec 13)
  // -------------------------------------------------------------------------
  async function sweepFiles(ttl = TTL_SECONDS) {
    // The task this worker is running right now has an empty output folder
    // until ComfyUI finishes. Tell the sweeper, or it will delete it.
    const active = [state.currentTaskId, ...(localTasks?.list().map(t => t.id) || [])].filter(Boolean);
    const legacy = await sweepTaskFiles({ dataDir, ttlSeconds: ttl, activeTaskIds: active });
    let candidate = { expiredTasks: [], removedFiles: 0, removedBytes: 0 };
    try {
      candidate = await sweepTaskFiles({ dataDir, ttlSeconds: ttl, activeTaskIds: active, taskSpace: 'candidate' });
    } catch (error) {
      // Keep ordinary tasks operational, but never hide a failed private-root sweep.
      log('candidate ttl sweep failed', { error: String(error?.message || error) });
    }
    const result = {
      expiredTasks: [...new Set([...(legacy.expiredTasks || []), ...(candidate.expiredTasks || [])])],
      removedFiles: legacy.removedFiles + candidate.removedFiles,
      removedBytes: legacy.removedBytes + candidate.removedBytes
    };
    if (result.removedFiles) {
      log('ttl sweep', { files: result.removedFiles, bytes: result.removedBytes });
    }
    // Tell the control plane, so the task is marked expired and its copies in
    // the object store go too. Without this the local files vanish and the
    // remote ones stay forever, which is the worst of both.
    if (result.expiredTasks && result.expiredTasks.length && state.workerToken) {
      try {
        await callControl('POST', '/api/worker/expire', {
          token: state.workerToken,
          body: { taskIds: result.expiredTasks }
        });
      } catch (error) {
        log('could not report expired tasks', { error: String(error.message || error) });
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  let gateway = null;
  let tunnel = null;
  let timers = [];
  let running = false;
  let starting = null;
  let localRunning = false;
  let localTimer = null;
  let localHealthTimer = null;
  let idleReclaimTimer = null;
  let checkingHealth = false;
  let sharing = false;
  let draining = false;
  let claimBusy = false;
  // Separate from draining: this remains set after in-flight work completes.
  let claimsPaused = false;
  let claimPauseRevision = 0;
  let claimOutcomeUnknown = false;
  let manualReleaseBusy = false;
  const claimBaseMs = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 2000;
  const claimMaxMs = Math.max(claimBaseMs, Math.min(30000, claimBaseMs * 15));
  let claimDelayMs = claimBaseMs;
  let nextCloudClaimAt = 0;
  let cloudClaimBackoffEpoch = 0;
  function resetCloudClaimBackoff() {
    claimDelayMs = claimBaseMs;
    nextCloudClaimAt = 0;
    cloudClaimBackoffEpoch++;
  }
  function deferCloudClaim(epoch, emptyQueue=false) {
    // A stale empty reply cannot undo an intervening pause/resume or restart.
    if (epoch !== cloudClaimBackoffEpoch) return;
    nextCloudClaimAt = performance.now() + (emptyQueue ? emptyClaimDelayMs(claimDelayMs,claimBaseMs) : claimDelayMs);
    claimDelayMs = Math.min(claimMaxMs, claimDelayMs * 2);
  }

  function pauseClaims({ timeoutMs = 30000 } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000)
      throw new RangeError('Invalid claim pause timeout');
    if (!claimsPaused) { claimsPaused = true; claimPauseRevision++; emit(); }
    const revision = claimPauseRevision;
    // A heartbeat already in flight may have sent an idle state. Send a fresh
    // heartbeat after it settles; its failure cannot undo the local pause.
    if (state.workerToken) void heartbeat().then(() => {
      if (claimsPaused && claimPauseRevision === revision && state.workerToken) return heartbeat();
    }).catch(() => {});
    return new Promise(resolve => {
      let timer;
      const finish = result => { clearTimeout(timer); listeners.delete(check); resolve(result); };
      const check = () => {
        if (!claimsPaused || revision !== claimPauseRevision)
          return finish({ok:false, paused:false, reason:'pause-resumed'});
        if (claimBusy || activeTask || state.currentTaskId) return;
        if (claimOutcomeUnknown)
          return finish({ok:false, paused:true, locallyIdle:true, reason:'claim-outcome-unknown'});
        finish({ok:true, paused:true, locallyIdle:true});
      };
      listeners.add(check);
      timer = setTimeout(() => finish({ok:false, paused:claimsPaused, reason:'pause-timeout'}), timeoutMs);
      check();
    });
  }
  function resumeClaims() {
    if (manualReleaseBusy) throw new Error('模型资源释放请求进行中，请完成后再恢复接单');
    if (claimsPaused) { claimsPaused = false; claimPauseRevision++; resetCloudClaimBackoff(); emit(); }
    if (state.workerToken) void heartbeat().catch(() => {});
    return snapshotState();
  }
  const idleReclaimer = createIdleComfyReclaimer({
    freeBytes: freemem, measure: readComfyMemorySnapshot, log,
    isIdle(reserved = false, manual = false) {
      const computeReady = registrationProfile === 'compute-only' && running && sharing && state.runtimeReady === true;
      if ((!localRunning && !computeReady) || draining || (claimsPaused && !manual) || state.currentTaskId || activeTask || (claimBusy && !reserved)) return false;
      try {
        if (localTasks === null && registrationProfile === 'compute-only') return true;
        const tasks = localTasks?.list?.();
        return Array.isArray(tasks) && tasks.every(task => ['completed','failed','cancelled','expired'].includes(task.status));
      } catch { return false; }
    },
    reserve(manual = false) { if (claimBusy || state.currentTaskId || activeTask) return false; claimBusy = true; manualReleaseBusy = manual === true; emit(); return true; },
    release() { claimBusy = false; manualReleaseBusy = false; emit(); }
  });
  function startIdleReclaimer() {
    if (idleReclaimTimer) return;
    const tick = () => {
      if (state.comfy.image) idleReclaimer.watch(comfyImage);
      if (state.comfy.video) idleReclaimer.watch(comfyVideo);
      idleReclaimer.poll().catch(e => log('idle memory check failed', {error:String(e.message)}));
    };
    if (state.comfy.image) idleReclaimer.watch(comfyImage);
    if (state.comfy.video) idleReclaimer.watch(comfyVideo);
    idleReclaimTimer=setInterval(tick,30000);
    idleReclaimTimer.unref?.();
  }
  function stopIdleReclaimer() {
    clearInterval(idleReclaimTimer);
    idleReclaimer.cancelObservations();
    idleReclaimTimer=null;
  }

  async function startLocal({ onProgress = () => {} } = {}) {
    if (localRunning) return snapshotState();
    await mkdir(join(dataDir, 'tasks'), { recursive: true });
    await loadIdentity();
    onProgress(45, '正在检测显卡和系统');
    state.gpu = await detectGpu();
    state.system = await detectSystem();
    onProgress(60, '正在连接图像和视频服务');
    state.comfy.image = await comfyImage.isUp();
    state.comfy.video = await comfyVideo.isUp();
    await reportModels(onProgress);
    localRunning = true;
    if (state.comfy.image) idleReclaimer.watch(comfyImage);
    if (state.comfy.video) idleReclaimer.watch(comfyVideo);
    state.status = state.currentTaskId ? 'busy' : 'idle';
    localTimer = setInterval(() => { claimAndRun({throttleCloud:true}).catch(e => log('local task error', { error: String(e.message) })); }, 500);
    startIdleReclaimer();
    localHealthTimer = setInterval(async () => {
      if (checkingHealth || !localRunning) return;
      checkingHealth = true;
      try {
        const previous = JSON.stringify(state.comfy);
        state.comfy.image = await comfyImage.isUp();
        state.comfy.video = await comfyVideo.isUp();
        const priorComfy = JSON.parse(previous);
        if (state.comfy.image && !priorComfy.image) idleReclaimer.watch(comfyImage);
        if (state.comfy.video && !priorComfy.video) idleReclaimer.watch(comfyVideo);
        if (previous !== JSON.stringify(state.comfy)) await reportModels();
        else if (state.comfy.image && !state.features.qwenImage21 && Date.now() - lastFeatureProbeAt > 60000) {
          // A probe that timed out at start, or weights added later, should not need a restart.
          lastFeatureProbeAt = Date.now();
          state.features.qwenImage21 = await detectQwenImage21(comfyImage).catch(() => false);
        }
        emit();
      } catch (e) { log('local health check failed', { error: String(e.message) }); }
      finally { checkingHealth = false; }
    }, 15000);
    emit();
    return snapshotState();
  }

  async function stopSharing() {
    sharing = false;
    resetCloudClaimBackoff();
    shareEpoch++;
    draining = false;
    if (activeTask && !localTasks?.has(activeTask.id)) await cancelActiveTask();
    if (state.workerToken) heartbeat().catch(() => {});
    // Keep the authenticated file gateway alive: completed tasks still need
    // to download their results. Only stop() closes it.
    emit();
    return snapshotState();
  }

  async function stopLocal() {
    localRunning = false;
    clearInterval(localTimer);
    clearInterval(localHealthTimer);
    stopIdleReclaimer();
    localTimer = null;
    localHealthTimer = null;
    // Each switch cancels only its own jobs, including private queued tasks.
    for (const task of localTasks?.list() || []) {
      if (!['completed', 'failed', 'cancelled', 'expired'].includes(task.status)) await cancelLocalTask(task.id);
    }
    state.status = state.currentTaskId ? 'busy' : sharing ? 'idle' : 'offline';
    emit();
    return snapshotState();
  }

  async function bindAccount(sessionToken) {
    if (!localRunning || sharing || claimBusy) throw new Error('请在本地服务空闲且未分享时绑定账号');
    if (!controlUrl || !sessionToken) throw new Error('请先配置控制面地址并登录 Foart 账号');
    const me = await callControl('GET', '/api/web/me', { token: sessionToken });
    if (!me.user?.id) throw new Error('账号验证失败');
    if (state.boundAccount?.id && state.boundAccount.id !== me.user.id) throw new Error('此设备已绑定其他账号，请先由原账号处理解绑');
    await register({ sessionToken });
    await heartbeat();
    const mine = await callControl('GET', '/api/web/workers', { token: sessionToken });
    if (!mine.workers?.some(w => w.id === state.workerId)) throw new Error('此算力节点已属于其他账号，不能转移绑定');
    state.boundAccount = { id: me.user.id, account: me.user.email || me.user.account || me.user.id };
    await saveIdentity();
    emit();
    return { account: state.boundAccount };
  }

  async function cancelLocalTask(id) {
    const task = localTasks?.get(id);
    if (!task) throw new Error('本机任务不存在');
    await localTasks.cancel(id);
    if (activeTask?.id === id) await cancelActiveTask();
    emit();
    return task;
  }

  async function start({ registrationCode: code, onProgress = () => {} } = {}) {
    if (code !== undefined) activeRegistrationCode = String(code);
    if (starting) return starting;
    if (running) { sharing = true; draining = false; resetCloudClaimBackoff(); await heartbeat(); emit(); return snapshotState(); }
    starting = startResources(onProgress).catch(async (error) => {
      await closeSharing().catch(() => {});
      if (error.message === 'missing session token' || error.message === 'unknown worker') {
        error.message = registrationProfile === 'compute-only'
          ? '平台自动接入服务需要升级，请联系管理员'
          : '云端没有此节点的注册记录，请在设置中填写新的注册码，保存后重新启动';
      } else if (error.message === 'registration code is invalid or used up') {
        error.message = '注册码无效、已过期或已使用，请填写新的注册码，保存后重新启动';
      }
      state.lastError = String(error.message || error);
      emit();
      throw error;
    });
    try { return await starting; }
    finally { starting = null; }
  }

  async function startResources(onProgress = () => {}) {
    running = true;
    state.lastError = '';

    await mkdir(join(dataDir, 'tasks'), { recursive: true });
    await loadIdentity();

    onProgress(45, '正在启动算力网关');
    gateway = createGateway({
      workerId: state.workerId,
      dataDir,
      getGrantKey: () => state.grantKey,
      ...(qwenRotationVerificationEnabled === true ? {verifyCandidateAccess:createQwenCandidateOnlineVerifier({
        callControl,getWorkerToken:()=>state.workerToken,getWorkerId:()=>state.workerId
      })} : {}),
      ...(qwenImageEditEnabled===true || (qwenPlanEnabled === true && qwenPlanVerificationEnabled === true) ? {verifyQwenFoartPlanAccess:createQwenFoartPlanOnlineVerifier({
        callControl,getWorkerToken:()=>state.workerToken,getWorkerId:()=>state.workerId
      })} : {}),
      logger: log
    });
    const port = await gateway.listen(gatewayPort, gatewayHost);
    state.localEndpointUrl = 'http://127.0.0.1:' + port;
    log('gateway listening', { port, endpoint: state.localEndpointUrl });

    // A public address for a machine that has none. Without one this node can
    // only serve a browser running on this very machine - which is the owner
    // and nobody else. See tunnel.mjs.
    // Tests turn this off: a suite that reaches the internet to pass is a
    // suite that fails for reasons that have nothing to do with the code.
    // `npm run verify:tunnel` opens a real one and fetches a real file
    // through it.
    if (!state.endpointUrl && tunnelEnabled !== false) {
      onProgress(55, '正在建立外网共享连接');
      tunnel = createTunnel({ port, logger: log });
      const publicUrl = await tunnel.start();
      if (!publicUrl) throw new Error('外网共享连接未能建立，请检查网络后重试；本地使用不受影响');
      state.endpointUrl = publicUrl || state.localEndpointUrl;
      state.transport = publicUrl ? 'tunnel' : 'direct';
      if (!publicUrl) {
        log('no public address: only a browser on this machine can fetch results');
      }
    } else if (!state.endpointUrl) {
      state.endpointUrl = state.localEndpointUrl;
    }

    onProgress(65, '正在检测硬件并注册算力节点');
    await register();
    await reportModels(onProgress);
    if (state.currentTaskId) state.status = 'busy';
    sharing = true;
    draining = false;
    resetCloudClaimBackoff();

    timers.push(setInterval(() => { heartbeat().catch(() => {}); }, heartbeatIntervalMs));
    timers.push(setInterval(() => { claimAndRun({throttleCloud:true}).catch(() => {}); }, pollIntervalMs));
    timers.push(setInterval(() => { reportModels().catch(() => {}); }, 10 * 60 * 1000));
    timers.push(setInterval(() => { sweepFiles().catch(() => {}); }, 15 * 60 * 1000));

    emit();
    return snapshotState();
  }

  async function stop() {
    await stopSharing();
    await stopLocal();
    while (claimBusy) await new Promise(resolve => setTimeout(resolve, 100));
    await closeSharing();
    state.status = 'offline';
    emit();
  }

  async function closeSharing() {
    running = false;
    sharing = false;
    draining = false;
    for (const t of timers) clearInterval(t);
    timers = [];
    state.status = state.currentTaskId ? 'busy' : localRunning ? 'idle' : 'offline';
    try {
      if (state.workerToken) {
        await callControl('POST', '/api/worker/heartbeat', {
          token: state.workerToken,
          body: { status: 'offline', current_task_id: null }
        });
      }
    } catch { /* going offline quietly is acceptable */ }
    if (tunnel) tunnel.stop();
    tunnel = null;
    if (gateway) await gateway.close();
    gateway = null;
    state.workerToken = '';
    qwenReport.reset();
    state.grantKey = '';
    state.endpointUrl = publicEndpoint;
    state.localEndpointUrl = '';
    state.transport = 'direct';
    emit();
  }

  return {
    start,
    startLocal,
    stopLocal,
    bindAccount,
    cancelLocalTask,
    startSharing: start,
    stopSharing,
    pauseClaims,
    resumeClaims,
    readLoraCatalog: (kind, input) => loraCatalog.read(kind, input),
    async identifyArtUser(token) {
      if(typeof token!=='string'||token.length>16384)throw Error('invalid browser session');
      const response=await fetch(controlUrl+'/api/web/me',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('browser session could not be verified');const value=await response.json();if(!value.user?.id)throw Error('missing verified user');return value.user;
    },
    async readArtKnowledge({skillId,knownVersion,sessionToken}) {
      const token=sessionToken||state.workerToken;
      if(!controlUrl || !token)throw Error('共享知识同步尚未连接控制面');
      const query=new URLSearchParams({skillId,knownVersion});
      const response=await fetch((options.artKnowledge?.baseUrl||controlUrl)+'/api/web/art-knowledge?'+query,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('共享知识同步暂不可用');return response.json();
    },
    rewriteAudioPrompt,
    stop,
    heartbeat,
    reportModels,
    claimAndRun,
    async releaseIdleModels() {
      // Do not re-arm a completed endpoint while another release is still iterating.
      if (claimBusy || manualReleaseBusy || state.currentTaskId || activeTask)
        return {ok:false,code:'runtime-busy',requested:0};
      if (state.comfy.image) idleReclaimer.watch(comfyImage, {manual:true});
      if (state.comfy.video) idleReclaimer.watch(comfyVideo, {manual:true});
      return idleReclaimer.releaseNow();
    },
    sweepFiles,
    register,
    retargetComfy,
    retargetModelsRoot(value) {
      if (registrationProfile !== 'compute-only' || state.currentTaskId || !value || value === modelsRoot) return;
      modelsRoot = String(value);
      loraCatalog = createWorkerLoraCatalog({ modelsRoot, image: comfyImage, video: comfyVideo });
    },
    setComputeReady(ready) {
      if (registrationProfile !== 'compute-only') return;
      const next = ready === true;
      if (state.runtimeReady === next) return;
      state.runtimeReady = next;
      if (next) startIdleReclaimer();
      else if (!localRunning) stopIdleReclaimer();
      emit();
      if (!next && sharing && state.workerToken) void withdrawAdvertisedStatus();
    },
    getState: snapshotState,
    verifiedQwenTaskId() {return (activeTask?.qwenOwnerVerified===true || activeTask?.qwenTextBusinessClaimed===true) && activeTask.id===state.currentTaskId && !activeTask.controller.signal.aborted?activeTask.id:'';},
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get identity() { return { workerId: state.workerId, workerName: state.platformWorkerName || workerName }; },
    get gatewayEndpoint() { return state.endpointUrl; },
    get localEndpoint() { return state.localEndpointUrl; },
    get transport() { return state.transport; }
  };
}
