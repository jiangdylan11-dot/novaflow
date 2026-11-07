// All local language/vision tasks share one owned Flash session and GPU lease.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFlashBrainSession } from './flash-brain-session.mjs';
import { isFlashBrainConfigured } from './flash-brain-configuration.mjs';
import { audioFlashMessages, cleanAudioCaption } from './comfy/audio-reprompt.mjs';
import { createFlashArtAgent, runQwenRotationCandidatePreview, FLASH_ART_AGENT_TOOLS, } from './flash-art-agent.mjs';
import { createFlashChatResidency } from './flash-chat-residency.mjs';
import { FLASH_MEDIA_AGENT_TOOLS } from './flash-media-agent.mjs';
import { localModelSelectionFailure, communityTrialCapabilityFailure, communityTrialResponseFailure, businessAssistantSelection, qwenTextBusinessFailure } from './local-model-selection.mjs';
import { createGemmaCpuSession, isGemmaCpuConfigured, probeQwenCpuOwnership } from './gemma-cpu-session.mjs';
import {selectQwenConfigSource} from './qwen-auto-discovery.mjs';
import { verifyQwenCpuFiles, qwenCpuFilesUnchanged, qwenCpuFileStamp } from './qwen-cpu-verification.mjs';
import { resolveQwenManagedRuntime } from './qwen-managed-runtime.mjs';
import { checkQwenGpuResources, watchQwenGpuResources, admitQwenGpuWithRelease, QWEN_GPU_RUNNING_FREE_MIB } from './qwen-gpu-resource-guard.mjs';
import { freemem } from 'node:os';
import { foartRuntimeRoot } from './runtime-location.mjs';

export function strataConfigPath(runtimeJsonPath) {
  return process.env.NOVAFLOW_STRATA_CONFIG || join(runtimeJsonPath ? dirname(runtimeJsonPath) : foartRuntimeRoot(), 'strata-prompt.json');
}
export function readStrataConfig(path) {
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}
function controlCommand(config, configPath, command, { signal, ownerToken } = {}) {
  const helper = fileURLToPath(new URL('./strata-runtime-control.py', import.meta.url));
  return new Promise((resolve, reject) => {
    if (['load','unload'].includes(command) && !/^[A-Za-z0-9_-]{8,128}$/.test(ownerToken || '')) {
      reject(Object.assign(Error('Flash 操作缺少本次会话的资源归属标记'), {errorCode:'strata-owner-token-required'}));return;
    }
    execFile(config.pythonPath, [helper, command, '--config', configPath, ...(ownerToken ? ['--owner-token',ownerToken] : [])], {
      windowsHide:true, timeout:command === 'load' ? 240000 : command === 'resources' ? 8000 : 75000,
      maxBuffer:1024 * 1024, encoding:'utf8', ...(signal ? {signal} : {}),
      env:{...process.env,PYTHONIOENCODING:'utf-8'}
    }, (error, stdout) => {
      let reply; try { reply = JSON.parse(String(stdout || '').trim()); } catch {}
      if (error || reply?.ok !== true) return reject(Object.assign(new Error(command === 'load' ? 'Flash 本地模型加载失败，请查看本机运行记录' : command === 'resources' ? '无法确认本机内存与显存状态' : 'Flash 模型退出尚未确认，本次不会开始生成'), {errorCode:command === 'load' ? 'strata-load-failed' : command === 'resources' ? 'flash-resource-probe-failed' : 'strata-unload-failed'}));
      resolve(reply);
    });
  });
}

export function createStrataPromptAssistant({worker,comfyUrls=[],configPath,config:suppliedConfig,
  sessionFactory=createFlashBrainSession,lifecycle:suppliedLifecycle,resourceProbe,qwenGpuMemoryProbe,
  fetchImpl=fetch,logger=()=>{},legacyApi=null,chatIdleTimeoutMs=120000,gemmaConfig:suppliedGemmaConfig,gemmaSession:suppliedGemmaSession,
  qwenConfig:suppliedQwenConfig,qwenSession:suppliedQwenSession,isolatedCommunityRuntimeForTest=false,communityCpuTrialForDevelopment=false,qwenBusinessBridge=false,qwenBusinessTextOnly=false,qwenBusinessReady=()=>false,qwenNativeReady=()=>false,qwenImageReady=()=>false,qwenRotationCandidateEnabled=false,qwenPlanEnabled=false,qwenPlanVerificationEnabled=false,qwenImageEditEnabled=false}={}) {
  const path=configPath || strataConfigPath(), config=suppliedConfig || readStrataConfig(path);
  const gemmaConfig=suppliedGemmaConfig || readStrataConfig(process.env.NOVAFLOW_GEMMA_CPU_CONFIG || join(dirname(path),'gemma-cpu.json'));
  const gemmaAvailable=()=>Boolean(suppliedGemmaSession || isGemmaCpuConfigured(gemmaConfig));
  const gemmaSession=suppliedGemmaSession || (gemmaConfig ? createGemmaCpuSession({config:gemmaConfig,fetchImpl}) : null);
  const qwenSource=selectQwenConfigSource({runtimeRoot:dirname(path),suppliedConfig:suppliedQwenConfig===undefined && suppliedQwenSession ? null : suppliedQwenConfig,
    envSpecified:Object.hasOwn(process.env,'NOVAFLOW_QWEN_CPU_CONFIG'),envPath:process.env.NOVAFLOW_QWEN_CPU_CONFIG});
  const qwenManaged=qwenSource.failure ? {config:null,failure:qwenSource.failure} : resolveQwenManagedRuntime(qwenSource.config,dirname(path));
  const qwenConfig=qwenManaged.config;
  const qwenAvailable=()=>Boolean(suppliedQwenSession || isGemmaCpuConfigured(qwenConfig));
  // Explicit node-local registration; only the built-in CPU supervisor may
  // provide this capability. The supervisor verifies artifacts on each load.
  const qwenCpuCandidate=()=>!suppliedQwenSession && qwenConfig?.capability==='qwen35-chat-cpu-v1' && isGemmaCpuConfigured(qwenConfig);
  let qwenVerified=null, qwenVerification='unconfigured', qwenAttemptStamp=null, qwenVerificationPending=false;
  let qwenProbeState='unverified',qwenProbeStamp=null,qwenProbePending=null,qwenProbeAbort=null,qwenProbeResult=null,qwenProbeRetryAt=0,qwenProbeFault=false;
  function refreshQwenVerification() {
    if(!qwenCpuCandidate())return;
    const stamp=qwenCpuFileStamp(qwenConfig);
    if(!stamp || stamp===qwenAttemptStamp || qwenVerificationPending)return;
    qwenAttemptStamp=stamp;qwenVerified=null;qwenVerification='verifying';qwenVerificationPending=true;
    void verifyQwenCpuFiles(qwenConfig).then(value=>{qwenVerified=value;qwenVerification=value?'verified':'failed';}).catch(()=>{qwenVerified=null;qwenVerification='failed';}).finally(()=>{qwenVerificationPending=false;refreshQwenOwnership();});
  }
  refreshQwenVerification();
  const qwenIdentityValid=()=>{refreshQwenVerification();return qwenCpuCandidate() && qwenVerification==='verified' && qwenCpuFilesUnchanged(qwenConfig,qwenVerified);};
  function qwenNodeReadyForProbe() {
    try {const state=worker?.getState?.();return state?.sharing===true && state.runtimeReady===true;}
    catch{return false;}
  }
  function refreshQwenOwnership() {
    if(!qwenIdentityValid()) {qwenProbeState='unverified';return;}
    const stamp=qwenAttemptStamp;
    if(qwenProbeState==='verified' && qwenProbeStamp===stamp)return;
    if(qwenProbeFault || qwenProbePending || stopping || !qwenNodeReadyForProbe() || Date.now()<qwenProbeRetryAt)return;
    qwenProbeState='verifying';qwenProbeStamp=stamp;qwenProbeAbort=new AbortController();
    qwenProbePending=probeQwenCpuOwnership({config:qwenConfig,signal:qwenProbeAbort.signal}).then(result=>{
      if(qwenAttemptStamp!==stamp || !qwenIdentityValid()) {qwenProbeState='unverified';return;}
      qwenProbeResult=result;
      if(result.ok)qwenProbeState='verified';
      else {qwenProbeState='failed';qwenProbeRetryAt=Date.now()+30000;if(result.errorCode==='qwen-ownership-unconfirmed')qwenProbeFault=true;}
    }).catch(()=>{qwenProbeState='failed';qwenProbeResult={ok:false,errorCode:'qwen-preflight-failed',error:'Qwen 本机资源预检失败。'};qwenProbeRetryAt=Date.now()+30000;}).finally(()=>{qwenProbePending=null;qwenProbeAbort=null;});
  }
  const qwenCpuRegistered=()=>{refreshQwenOwnership();return qwenIdentityValid() && qwenProbeState==='verified' && qwenProbeStamp===qwenAttemptStamp;};
  const qwenOwnershipFailure=()=>qwenProbeFault ? {ok:false,errorCode:'qwen-ownership-unconfirmed',error:'本地模型预检退出尚未确认，请确认旧任务已退出并重启节点。',...(qwenProbeResult?.diagnostic?{diagnostic:qwenProbeResult.diagnostic}:{})} : qwenProbeState==='verifying' ? {ok:false,errorCode:'qwen-ownership-verifying',error:'正在确认本机模型资源归属，请稍后重试。'} : qwenProbeResult || {ok:false,errorCode:'qwen-ownership-unverified',error:'本机模型资源归属尚未确认，未启动模型。'};
  const qwenIdentityFailure=()=>({ok:false,errorCode:qwenVerification==='verifying'?'qwen-identity-verifying':'qwen-identity-unverified',
    error:qwenVerification==='verifying'?'正在校验本地模型和运行器，请稍后重试。':'本地模型身份校验失败或文件已变化，请检查文件并重启节点。'});
  const qwenSession=suppliedQwenSession || (qwenConfig ? createGemmaCpuSession({config:qwenConfig,fetchImpl,modelId:'qwen3.5-9b-heretic'}) : null);
  const selectedModel=payload=>payload?.modelId==='gemma-4-12b-it' ? 'gemma' : payload?.modelId==='qwen3.5-9b-heretic' ? 'qwen' : 'next';
  const selectionFailure=(payload,ownTaskId='')=>{
    if(payload?.modelId==='qwen3.5-9b-heretic' && qwenManaged.failure)return qwenManaged.failure;
    const failure=localModelSelectionFailure(payload,{gemmaAvailable:gemmaAvailable(),qwenAvailable:qwenAvailable()});
    if(failure)return failure;
    const capabilityFailure=communityTrialCapabilityFailure(payload,{isolatedTest:isolatedCommunityRuntimeForTest===true});
    if(capabilityFailure)return capabilityFailure;
    const model=selectedModel(payload);
    if(model==='qwen' && qwenCpuCandidate() && !qwenIdentityValid())return qwenIdentityFailure();
    if(model==='qwen' && qwenCpuCandidate() && !qwenCpuRegistered())return qwenOwnershipFailure();
    return model==='next' ? null : communityRuntimeGuard(ownTaskId,model);
  };
  const runtimeLifecycle=suppliedLifecycle || {load:options=>controlCommand(config,path,'load',options),unload:options=>controlCommand(config,path,'unload',options)};
  // A failed/partial load still needs cleanup, but only for its own operation.
  // Never use the shared config receipt as permission to unload another client.
  const ownedOperations=new Set();
  const operationOwners=new Map();
  let operation=null,operationTicket=null,operationReporter=null;
  function reportOperation(){try{operationReporter?.({...operation});}catch{}}
  function setOperationPhase(ticket,phase) {
    if(!ticket || operationTicket!==ticket || !operation || operation.phase===phase)return;
    operation={...operation,phase,phaseStartedAt:Date.now()};
    reportOperation();
  }
  const lifecycle={
    load(options){
      const token=options?.ownerToken;
      if(!/^[A-Za-z0-9_-]{8,128}$/.test(token || ''))throw Object.assign(Error('Flash 会话缺少资源归属标记'),{errorCode:'strata-owner-token-required'});
      ownedOperations.add(token);
      if(operationTicket)operationOwners.set(token,operationTicket);
      return runtimeLifecycle.load(options);
    },
    async unload(options){
      const token=options?.ownerToken;
      if(!ownedOperations.has(token))return {ok:true,released:true,notOwned:true};
      setOperationPhase(operationOwners.get(token),'releasing');
      const result=await runtimeLifecycle.unload(options);
      if(result?.released===true && result?.ok!==false){ownedOperations.delete(token);operationOwners.delete(token);}
      return result;
    }
  };
  const trace = config?.traceDirectory ? async event => {
    if(!isAbsolute(config.traceDirectory) || /^(?:\\\\|\/\/)/.test(config.traceDirectory))throw Error('本机审计目录必须是本地绝对路径');
    await mkdir(config.traceDirectory,{recursive:true});
    await writeFile(join(config.traceDirectory,randomUUID()+'.json'),JSON.stringify(event,null,2)+'\n',{flag:'wx'});
  } : undefined;
  const artAgent=createFlashArtAgent();
  let lease=null,inFlight=null,activeAbort=null,lastError='',lastTiming=null,cleanupFault=false,stopping=false,stopPromise=null,generationTaskId='',handoffPending=0;
  const cancelledPromptRequests=new Map();
  const cancelledAgentRequests=new Set();
  const cancellablePromptMethods=new Set(['optimizePrompt','reverseImagePrompt','describeArtStyle']);
  const promptRequestId=payload=>typeof payload?.requestId==='string' && payload.requestId.length<=160 ? payload.requestId : '';
  function promptRequestCancelled(payload) {
    const now=Date.now();for(const [id,until] of cancelledPromptRequests)if(until<now)cancelledPromptRequests.delete(id);
    return cancelledPromptRequests.has(promptRequestId(payload));
  }
  const cancelledPromptReply=()=>({ok:false,errorCode:'prompt-assistant-cancelled',error:'本次提示词分析已取消'});
  let chatResidency,gemmaResidency,qwenResidency,qwenLastExecutionDevice=null;
  const verifiedExecutionDevice=value=>['cpu','gpu'].includes(value)?value:null;
  const qwenUsesGpu=()=>qwenConfig?.executionMode==='gpu';
  const checkQwenGpu=(ownTaskId='',warm=false,checkWorker=true)=>checkQwenGpuResources({worker,ownTaskId,comfyUrls,fetchImpl,
    checkWorker,...(qwenGpuMemoryProbe?{queryGpu:qwenGpuMemoryProbe}:{}),...(warm?{minFreeMiB:QWEN_GPU_RUNNING_FREE_MIB}:{})});
  // Admission before loading Qwen on the GPU: unload idle Comfy caches when
  // they are what leaves too little VRAM (e.g. right after a generation).
  const admitQwenGpu=(ownTaskId='',warm=false)=>admitQwenGpuWithRelease({warm,
    check:()=>checkQwenGpu(ownTaskId,warm),release:()=>releaseRuntimes(ownTaskId)});
  const configured=()=>Boolean(config && (suppliedLifecycle || isFlashBrainConfigured(config)));
  const makeSession=()=>sessionFactory({baseUrl:config?.baseUrl || 'http://127.0.0.1:8198',expectedModel:config?.expectedModel,
    fetchImpl,lifecycle,onInference:trace,timeoutMs:config?.workflowTimeoutMs || 900000,releaseTimeoutMs:config?.releaseTimeoutMs || 75000,
    config:{...config,maxTokens:config?.maxTokens || 4096}});
  let session=null;try {if(config)session=makeSession();} catch {lastError='Flash 本地配置无效';}
  const unavailable=()=>({ok:false,error:'本地 Flash 模型不可用，请安装本地 Flash 模型后重试',errorCode:'flash-model-missing'});
  const businessBridgeReady=()=>{try{return qwenBusinessBridge===true && qwenBusinessReady()===true;}catch{return false;}};
  const ownedQwenTask=()=>{try{const current=worker?.getState?.()?.currentTaskId;
    if(lease?.model==='qwen' && lease.taskId && current===lease.taskId)return lease.taskId;
    const verified=worker?.verifiedQwenTaskId?.();return verified && verified===current?verified:'';
  }catch{return '';}};
  function status(){const chatSession=chatResidency.getStatus();
    const communityStatus=(id,isConfigured,residency)=>{
      const isQwen=id==='qwen3.5-9b-heretic';
      const reason=isQwen && qwenManaged.failure ? qwenManaged.failure : !isConfigured ? {errorCode:'local-model-unavailable',error:'社区模型运行文件尚未配置'}
        : cleanupFault || stopping ? blocked() : isQwen && qwenCpuCandidate() && !qwenIdentityValid() ? qwenIdentityFailure() : isQwen && qwenCpuCandidate() && !qwenCpuRegistered() ? qwenOwnershipFailure() : communityRuntimeGuard('',isQwen?'qwen':'gemma');
      const chatSession=residency?.getStatus();
      return {id,configured:isConfigured,enabled:!reason,modelLoaded:Boolean(chatSession?.modelLoaded),chatSession,...(isQwen?{
        identityVerified:qwenIdentityValid(),
        selectedExecutionDevice:qwenConfig ? (qwenUsesGpu()?'gpu':'cpu') : null,
        executionDevice:verifiedExecutionDevice(chatSession?.executionDevice) || qwenLastExecutionDevice
      }:{}),
        ...(communityCpuTrialForDevelopment===true || isQwen && qwenCpuCandidate() ? {trial:{backend:'cpu',exclusive:false,chat:true,images:true,tools:false,audio:false,video:false,...(isQwen&&businessBridgeReady()?{business:true,...(qwenBusinessTextOnly===true?{businessScope:'text-only'}:{})}:{}),
          notice:isQwen && qwenUsesGpu() ? '本地 GPU 模型按资源状态运行，不分析音视频。'
            : isQwen && qwenPlanEnabled===true && qwenPlanVerificationEnabled===true
              ? '本地 CPU 运行不独占系统资源；基础操作需要确认，不分析音视频。'
              : '本地 CPU 试用不独占系统资源；仅文字和图片对话，不执行工具，也不分析音视频。'}} : {}),
        ...(reason ? {errorCode:reason.errorCode,error:reason.error,...(reason.diagnostic?{diagnostic:reason.diagnostic}:{})} : {})};
    };
    return {ok:true,enabled:configured() && Boolean(session) && !cleanupFault && !stopping,
    qwenRotationCandidateEnabled:qwenRotationCandidateEnabled===true,
    qwenPlanEnabled:qwenPlanEnabled===true && qwenPlanVerificationEnabled===true,
    qwenImageEditEnabled:qwenImageEditEnabled===true && businessBridgeReady() && qwenAvailable() && (()=>{try{return qwenImageReady()===true;}catch{return false;}})(),
    ...(ownedQwenTask()?{qwenOwnedTaskId:ownedQwenTask()}:{}),
    ...(qwenBusinessBridge===true?{qwenBusinessBridgeEnabled:true}:{}),
    qwen21NativeRewriteV3Enabled:businessBridgeReady() && qwenAvailable() && (()=>{try{return qwenNativeReady()===true;}catch{return false;}})(),
    localModels:[{id:'next',enabled:configured() && Boolean(session),chatSession},
      communityStatus('gemma-4-12b-it',gemmaAvailable(),gemmaResidency),
      communityStatus('qwen3.5-9b-heretic',qwenAvailable(),qwenResidency)],
    analysisBackend:'strata',drawingBackend:'strata',otherBackend:'strata',supportsOriginalImages:true,supportsStructuredPromptIR:true,
    supportedSurfaces:['art','animation','video','ui-design','audio','aifx'],modelType:'swift15_qwen38_flash_next_iq2_xs',
    artAgent:{version:'xiaotao-foart-tools-v1',localOnly:false,maxModelRounds:3,modes:['chat','creation','media','foart'],tools:[...FLASH_ART_AGENT_TOOLS,...FLASH_MEDIA_AGENT_TOOLS].map(tool=>tool.function.name),supportsFeedbackImages:true},
    chatSession,modelLoaded:chatSession.modelLoaded,operation:operation?{...operation}:null,
    modelPath:config?.modelFiles?.[0]?.path || config?.modelFiles?.[0] || '',runtimeStatus:cleanupFault?'模型释放失败':stopping || operation?.phase==='releasing' || chatSession.state==='releasing'?'释放中':operation?.phase==='loading'?'加载中':operation?.phase==='analyzing'?'分析中':lease?'推理中':chatSession.state==='warm'?'聊天模型已加载，待机中':configured()?'模型可用':'未配置模型',error:lastError,timing:lastTiming};}
  const blocked=()=>({ok:false,errorCode:cleanupFault?'strata-release-unconfirmed':'prompt-assistant-stopping',error:cleanupFault?'Flash 资源尚未确认释放，请先释放显存后重试':'本地 AI 正在释放资源'});
  // Community sessions do not own any configured Comfy runtime. An idle queue
  // does not prove that another session's loaded models may be unloaded.
  // Until ownership can be established, do not probe or release that runtime.
  function communityRuntimeGuard(ownTaskId='',model='') {
    const denied=()=>({ok:false,errorCode:'community-runtime-ownership-unconfirmed',error:'无法确认现有生成服务的资源归属，社区模型暂不能启动；未释放其他模型'});
    // Development CPU trial is explicit opt-in and nonexclusive. It never
    // probes or releases Comfy. The owned Job independently enforces RAM
    // limits and only the existing same-worker lease arbitrates local work.
    // Normal production callers continue to fail closed.
    const registered=model==='qwen' && qwenCpuRegistered();
    if(isolatedCommunityRuntimeForTest!==true && communityCpuTrialForDevelopment!==true && !registered)return denied();
    if(isolatedCommunityRuntimeForTest===true && (!Array.isArray(comfyUrls) || comfyUrls.some(raw=>String(raw || '').trim())))return denied();
    if(!worker)return isolatedCommunityRuntimeForTest===true ? null : denied();
    try {
      if(typeof worker.getState!=='function')return denied();
      const state=worker.getState();
      if(!state || typeof state!=='object' || Array.isArray(state)
        || !Object.hasOwn(state,'currentTaskId') || (state.currentTaskId!==null && state.currentTaskId!==''
          && !((communityCpuTrialForDevelopment===true || registered) && typeof ownTaskId==='string' && ownTaskId && state.currentTaskId===ownTaskId)))return denied();
      return null;
    } catch {return denied();}
  }
  async function releaseRuntimes(ownTaskId='') {
    const state=worker?.getState?.() || {};
    if(state.currentTaskId && state.currentTaskId!==ownTaskId)return {ok:false,errorCode:'runtime-generation-busy',error:'本地模型正在生成或排队，请等待完成'};
    for(const raw of new Set(comfyUrls)) {
      const base=String(raw).replace(/\/+$/,'');
      const queue=async()=>{
        try {const r=await fetchImpl(base+'/queue',{signal:AbortSignal.timeout(5000)}),q=await r.json();
          if(!r.ok || !Array.isArray(q.queue_running) || !Array.isArray(q.queue_pending))throw Error('无法确认生成队列');
          return {idle:q.queue_running.length+q.queue_pending.length===0};
        }catch(error){if(String(error?.cause?.code || error?.code)==='ECONNREFUSED')return {offline:true};throw error;}
      };
      try {const q=await queue();if(q.offline)continue;if(!q.idle)return {ok:false,errorCode:'runtime-generation-busy',error:'本地模型正在生成，请等待完成'};
        const options={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({unload_models:true,free_memory:true}),signal:AbortSignal.timeout(20000)};
        let r=await fetchImpl(base+'/free',options);if(r.status===404)r=await fetchImpl(base+'/api/free',options);
        if(!r.ok || !(await queue()).idle)throw Error('生成模型资源释放或队列确认失败');
      }catch(error){return {ok:false,errorCode:'runtime-memory-release-failed',error:String(error.message || error)};}
    }
    return {ok:true};
  }
  function startGuard(abort,model='next') {
    if(model==='gemma' || model==='qwen') {
      let lowSince=0;
      const label=model==='qwen'?'Qwen 3.5 9B':'Gemma',prefix=model==='qwen'?'qwen':'gemma';
      const timer=setInterval(()=>{try{if(freemem()<6*1024**3){lowSince ||= Date.now();if(Date.now()-lowSince>=2000)abort.abort(Object.assign(Error(`本机可用内存不足，已停止 ${label}`),{errorCode:`${prefix}-resource-floor`}));}else lowSince=0;}
        catch{abort.abort(Object.assign(Error(`本机内存检查失败，已停止 ${label}`),{errorCode:`${prefix}-resource-probe-failed`}));}},1000);
      timer.unref?.();
      // Running GPU checks only observe; they never free shared models or stop
      // another process (cold admission may unload idle Comfy caches). During handoff the existing lease waits for this owned model
      // to exit before starting generation, so do not abort it merely because
      // the next worker task has been claimed.
      const stopGpu=model==='qwen' && qwenUsesGpu()
        ? watchQwenGpuResources({check:()=>checkQwenGpu('',true,false),abort}) : ()=>{};
      return ()=>{clearInterval(timer);stopGpu();};
    }
    const probe=resourceProbe || (!suppliedLifecycle ? ()=>controlCommand(config,path,'resources') : null);
    if(!probe)return ()=>{};
    let ended=false,pending=false,lowSince=0;
    const timer=setInterval(async()=>{
      if(ended || pending)return;pending=true;
      try {const r=await probe();if(ended)return;
        if(!Number.isFinite(r.availableRamBytes) || !Number.isFinite(r.freeVramMiB))throw Error('资源检测返回无效');
        const low=r.availableRamBytes < 4*1024**3 || r.freeVramMiB < 768;
        if(low){lowSince ||= Date.now();if(Date.now()-lowSince>=2000)abort.abort(Object.assign(Error('本机内存或显存低于运行余量，已停止 Flash 并释放资源'),{errorCode:'flash-resource-floor'}));}else lowSince=0;
      }catch(error){if(!ended)abort.abort(Object.assign(Error('本机资源检测失败，已停止 Flash 以确认资源交接'),{errorCode:'flash-resource-probe-failed'}));}
      finally {pending=false;}
    },1000);timer.unref?.();
    return ()=>{ended=true;clearInterval(timer);};
  }
  chatResidency=createFlashChatResidency({idleTimeoutMs:chatIdleTimeoutMs,
    withSession:(callback,options)=>session.withSession(callback,options),startGuard,
    beforeOpen:async()=>{const result=await releaseRuntimes();if(!result.ok)throw Object.assign(Error(result.error),{errorCode:result.errorCode});},
    onSettled:outcome=>{if(outcome?.error)lastError=String(outcome.error.message || outcome.error);
      if(outcome?.resourcesReleased===false)cleanupFault=true;}
  });
  gemmaResidency=createFlashChatResidency({idleTimeoutMs:chatIdleTimeoutMs,
    withSession:(callback,options)=>gemmaSession.withSession(callback,options),startGuard:abort=>startGuard(abort,'gemma'),
    beforeOpen:async()=>{const failure=communityRuntimeGuard('','gemma');if(failure)throw Object.assign(Error(failure.error),{errorCode:failure.errorCode});},
    onSettled:outcome=>{if(outcome?.error)lastError=String(outcome.error.message || outcome.error);if(outcome?.resourcesReleased===false)cleanupFault=true;}
  });
  qwenResidency=createFlashChatResidency({idleTimeoutMs:chatIdleTimeoutMs,
    withSession:(callback,options)=>qwenSession.withSession(callback,options),startGuard:abort=>startGuard(abort,'qwen'),
    beforeOpen:async()=>{const failure=communityRuntimeGuard('','qwen');if(failure)throw Object.assign(Error(failure.error),{errorCode:failure.errorCode});},
    onSettled:outcome=>{if(outcome?.error)lastError=String(outcome.error.message || outcome.error);if(outcome?.resourcesReleased===false)cleanupFault=true;}
  });
  const residencyFor=model=>model==='gemma'?gemmaResidency:model==='qwen'?qwenResidency:chatResidency;
  const sessionFor=model=>model==='gemma'?gemmaSession:model==='qwen'?qwenSession:session;
  const availableFor=model=>model==='gemma'?gemmaAvailable():model==='qwen'?qwenAvailable():configured();
  const backendFor=model=>model==='gemma'?'gemma-cpu':model==='qwen'?'qwen-cpu':'strata';
  const allResidencies=()=>[chatResidency,gemmaResidency,qwenResidency];
  function claimLease(method,payload={},residentChat=false,model=selectedModel(payload)){let resolve;const finished=new Promise(done=>{resolve=done;});
    const ticket={method,startedAt:Date.now(),requestId:payload.requestId,residentChat,model,finished,resolve};
    lease=ticket;inFlight=finished;return ticket;
  }
  function finishLease(ticket){if(lease===ticket)lease=null;if(inFlight===ticket.finished)inFlight=null;ticket.resolve();}
  async function closeChatForHandoff(){handoffPending++;try{for(const residency of allResidencies())await residency.close();}finally{handoffPending--;}}
  async function runResidentChat(payload,context={}) {
    if(stopping || cleanupFault)return blocked();
    const model=selectedModel(payload), residency=residencyFor(model), others=allResidencies().filter(item=>item!==residency);
    if(!availableFor(model) || !sessionFor(model))return unavailable();
    try{artAgent.preflight(payload);}catch(error){return {ok:false,error:String(error.message || error),errorCode:error.errorCode || error.code || 'flash-agent-invalid-input',analysisBackend:'strata'};}
    if(lease || generationTaskId || handoffPending || allResidencies().some(item=>item.getStatus().state==='releasing'))
      return {ok:false,errorCode:'prompt-assistant-busy',error:'本地 AI 或生成任务正在执行或交接，请等待完成'};
    const ticket=claimLease('artAgentChat',payload,true);
    const cancelTimer=setInterval(()=>{if(context.isCancelled?.())void residency.cancel(payload.requestId).catch(()=>{});},150);cancelTimer.unref?.();
    try{
      for(const other of others)await other.close();
      if(cancelledAgentRequests.has(payload.requestId))throw Object.assign(Error('请求已取消'),{errorCode:'task-cancelled'});
      if(handoffPending || generationTaskId || stopping || cleanupFault)
        throw Object.assign(Error('模型正在交接，请稍后重试'),{errorCode:'prompt-assistant-busy'});
      if(context.isCancelled?.())throw Object.assign(Error('任务已取消'),{errorCode:'task-cancelled'});
      if(model==='qwen' && qwenUsesGpu()) {
        const resources=await admitQwenGpu(String(context.taskId || ''),residency.getStatus().modelLoaded);
        if(!resources.ok)throw Object.assign(Error(resources.error),{errorCode:resources.errorCode});
        if(handoffPending || generationTaskId || stopping || cleanupFault || context.isCancelled?.())
          throw Object.assign(Error('模型正在交接，请稍后重试'),{errorCode:'prompt-assistant-busy'});
      }
      const answer=await residency.run({requestId:payload.requestId,
        task:(flash,signal)=>artAgent.run({payload,flash,signal})});
      const trialFailure=communityTrialResponseFailure(payload,answer.value,{isolatedTest:isolatedCommunityRuntimeForTest===true});
      if(trialFailure)throw Object.assign(Error(trialFailure.error),{errorCode:trialFailure.errorCode});
      const executionDevice=model==='qwen' ? verifiedExecutionDevice(answer.executionDevice) : null;
      if(executionDevice)qwenLastExecutionDevice=executionDevice;
      lastError='';lastTiming={...answer.timing,beforeGenerationMs:Date.now()-ticket.startedAt};
      const credentials={analysisBackend:backendFor(model),modelIdentity:answer.identity,resourcesReleased:false,generationReady:false};
      const data={...answer.value,...credentials,chatSession:answer.chatSession,timing:lastTiming};
      // A warm answer is usable text, never proof of a model/GPU handoff.
      return {ok:true,...credentials,...(executionDevice?{executionDevice}:{}),data,chatSession:answer.chatSession,timing:lastTiming};
    }catch(error){lastError=String(error.message || error);const code=error.errorCode || error.code || 'strata-analysis-failed';
      if(['strata-release-unconfirmed','strata-unload-failed'].includes(code))cleanupFault=true;
      return {ok:false,error:lastError,errorCode:code,analysisBackend:backendFor(model),resourcesReleased:error.resourcesReleased===true,
        generationReady:false,chatSession:residency.getStatus()};
    }finally{clearInterval(cancelTimer);cancelledAgentRequests.delete(payload.requestId);finishLease(ticket);}
  }
  async function run(method,payload={},context={}) {
    if(cancellablePromptMethods.has(method) && promptRequestCancelled(payload))return cancelledPromptReply();
    if(stopping || cleanupFault)return blocked();
    const rotation=method==='qwenRotationCandidate',imageEdit=method==='qwenImageEdit',restricted=rotation||imageEdit;
    let rotationActor=null,rotationVerifier=null;
    if(imageEdit){
      const actor=context.imageEditActor;let nativeReady=false;try{nativeReady=qwenImageReady()===true;}catch{}
      if(qwenImageEditEnabled!==true || !businessBridgeReady() || !nativeReady || !actor || actor.scope!=='qwen21-local-image-edit-v1' ||
        actor.taskId!==context.taskId || typeof actor.workerId!=='string' || !actor.workerId || !Number.isSafeInteger(actor.attempt) || actor.attempt<1 ||
        typeof context.imageEditPhaseVerifier!=='function' || typeof context.isCancelled!=='function')
        return {ok:false,errorCode:'qwen-image-edit-unavailable',error:'参考图编辑需要已验证的本人节点任务'};
      rotationActor=Object.freeze({taskId:actor.taskId,workerId:actor.workerId,scope:actor.scope,attempt:actor.attempt});
      rotationVerifier=context.imageEditPhaseVerifier;
    }
    if(rotation) {
      const actor=context.rotationActor;
      if(typeof context.rotationPhaseVerifier!=='function' || typeof context.isCancelled!=='function' ||
         !actor || typeof actor!=='object' || Array.isArray(actor) ||
         Object.keys(actor).some(key=>!['taskId','workerId','scope','attempt'].includes(key)) ||
         typeof actor.taskId!=='string' || !actor.taskId || actor.taskId.length>200 || actor.taskId!==context.taskId ||
         typeof actor.workerId!=='string' || !actor.workerId || actor.workerId.length>200 ||
         !((actor.scope==='qwen-foart-rotation-candidate-v1' && qwenRotationCandidateEnabled===true) ||
           (actor.scope==='qwen-foart-plan-v1' && qwenPlanEnabled===true && qwenPlanVerificationEnabled===true)) ||
         !Number.isSafeInteger(actor.attempt) || actor.attempt<1 ||
         !payload || typeof payload!=='object' || Array.isArray(payload) ||
         Object.keys(payload).some(key=>!['requestId','provider','modelId','mode','foartAnimationStage','foartContext','rotationBaseline','message','history','images'].includes(key)) ||
         typeof payload.requestId!=='string' || !/^[A-Za-z0-9_-]{8,128}$/.test(payload.requestId) ||
         typeof payload.message!=='string' || !payload.message.trim() || payload.message.length>12000 ||
         !Array.isArray(payload.history) || payload.history.length!==0 || !Array.isArray(payload.images) || payload.images.length!==0 ||
         payload.provider!=='local' || payload.modelId!=='qwen3.5-9b-heretic' || payload.mode!=='foart' ||
         payload.foartAnimationStage!=='rotation_candidate')
        return {ok:false,errorCode:'qwen-rotation-owner-unavailable',error:'旋转候选需要已验证的本人节点任务，未提交'};
      rotationActor=Object.freeze({taskId:actor.taskId,workerId:actor.workerId,scope:actor.scope,attempt:actor.attempt});
      rotationVerifier=context.rotationPhaseVerifier;
      const failure=localModelSelectionFailure(payload,{gemmaAvailable:gemmaAvailable(),qwenAvailable:qwenAvailable()});
      if(failure)return failure;
      if(qwenManaged.failure)return qwenManaged.failure;
      if(qwenCpuCandidate() && !qwenIdentityValid())return qwenIdentityFailure();
      if(qwenCpuCandidate() && !qwenCpuRegistered())return qwenOwnershipFailure();
      const guard=communityRuntimeGuard(context.taskId,'qwen');if(guard)return guard;
    }
    const business=['optimizePrompt','reverseImagePrompt','describeArtStyle','rewriteAudioPrompt'].includes(method);
    const selection=business?businessAssistantSelection(payload,{qwenBridgeEnabled:businessBridgeReady()}):{kind:'legacy'};
    if(selection.kind==='rejected')return {ok:false,errorCode:selection.errorCode,error:selection.error};
    const migrateBusiness=selection.kind==='qwen';
    if(!imageEdit && payload.promptContract==='qwen21-native-rewrite-v3'){
      let ready=false;try{ready=migrateBusiness && qwenNativeReady()===true;}catch{}
      if(!ready)return {ok:false,errorCode:'qwen-native-contract-unavailable',error:'本地模型提示词优化版本尚未就绪，本次未提交'};
    }
    if((migrateBusiness||imageEdit) && qwenManaged.failure)return qwenManaged.failure;
    if(migrateBusiness && qwenBusinessTextOnly===true){const failure=qwenTextBusinessFailure(method,payload);if(failure)return failure;}
    const model=restricted?'qwen':method==='artAgentChat'?selectedModel(payload):migrateBusiness?'qwen':'next', activeSession=sessionFor(model);
    if(!availableFor(model) || !activeSession)return migrateBusiness
      ? {ok:false,error:'本地 Qwen 3.5 9B 模型或运行器不可用，本次未提交任务',errorCode:'qwen-runtime-missing'} : unavailable();
    if((migrateBusiness||imageEdit) && qwenCpuCandidate() && !qwenIdentityValid())return qwenIdentityFailure();
    if((migrateBusiness||imageEdit) && qwenCpuCandidate() && !qwenCpuRegistered())return qwenOwnershipFailure();
    if(method==='rewriteAudioPrompt' && !String(payload.input || '').trim())return {ok:false,error:'请先输入音频描述',errorCode:'invalid-request'};
    if(method==='rewriteAudioPrompt' && payload.kind==='music' && payload.bpm!==undefined && (!Number.isSafeInteger(payload.bpm)||payload.bpm<40||payload.bpm>220))return {ok:false,error:'音乐节拍超出范围',errorCode:'invalid-request'};
    if((lease && !lease.residentChat) || (generationTaskId && generationTaskId!==context.taskId))return {ok:false,errorCode:'prompt-assistant-busy',error:'本地 AI 或生成任务正在执行，请等待完成'};
    if(method==='artAgentChat') {
      try { artAgent.preflight(payload); }
      catch(error) { return {ok:false,error:String(error.message || error),errorCode:error.errorCode || error.code || 'flash-agent-invalid-input',analysisBackend:'strata'}; }
    }
    try{await closeChatForHandoff();}catch(error){lastError=String(error.message || error);cleanupFault=true;return blocked();}
    if(cancellablePromptMethods.has(method) && promptRequestCancelled(payload))return cancelledPromptReply();
    if(stopping || cleanupFault)return blocked();
    if(lease || (generationTaskId && generationTaskId!==context.taskId))return {ok:false,errorCode:'prompt-assistant-busy',error:'本地 AI 或生成任务正在执行，请等待完成'};
    const ticket=migrateBusiness||imageEdit?claimLease(method,payload,false,model):claimLease(method,payload);ticket.taskId=String(context.taskId||'');const abort=new AbortController();activeAbort=abort;
    operationTicket=ticket;operationReporter=context.onProgress;
    operation={requestId:ticket.requestId,mode:payload.mode || '',stage:method==='artAgentChat'?'analysis':/H3 compile: translate-only/.test(payload.requirements || '')?'compile':'optimize',phase:'preparing',startedAt:ticket.startedAt,phaseStartedAt:Date.now()};reportOperation();
    logger('flash local brain started',{method,requestId:promptRequestId(payload),surface:payload.surface || '',purpose:payload.purpose || ''});
    const cancelTimer=setInterval(()=>{if(context.isCancelled?.())abort.abort();},150);cancelTimer.unref?.();
    let stopGuard=()=>{},rotationMonitor=null,rotationPending=null,rotationFailure=null;
    const rotationCancelled=()=>{try{return abort.signal.aborted || context.isCancelled()!==false;}catch{return true;}};
    const checkRotation=async phase=>{
      if(rotationCancelled())return false;
      let state;try{state=worker?.getState?.();}catch{return false;}
      if(!state || state.workerId!==rotationActor.workerId || state.currentTaskId!==rotationActor.taskId)return false;
      let timer;
      try {
        const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);timer.unref?.();});
        const valid=await Promise.race([Promise.resolve().then(()=>rotationVerifier(rotationActor,phase)),deadline]);
        if(rotationCancelled())return false;
        try{state=worker?.getState?.();}catch{return false;}
        return valid===true && state?.workerId===rotationActor.workerId && state?.currentTaskId===rotationActor.taskId;
      }catch{return false;}finally{clearTimeout(timer);}
    };
    // Cancel the CPU client too: an abandoned protocol process must never send
    // a late HTTP request into the next model session on the same loopback port.
    const stopCpu=()=>{Promise.resolve(legacyApi?.stop?.()).catch(()=>{});};
    abort.signal.addEventListener('abort',stopCpu,{once:true});
    try {
      if(context.isCancelled?.())throw Object.assign(Error('任务已取消'),{errorCode:'task-cancelled'});
      if(restricted && !(await checkRotation('before')))throw Object.assign(Error('节点任务或会话已变化，未修改作品'),{errorCode:'qwen-rotation-owner-stale'});
      const handoff=model==='next' ? await releaseRuntimes(context.taskId) : communityRuntimeGuard(context.taskId,model);
      if(handoff && !handoff.ok)return handoff;
      if(model==='qwen' && qwenUsesGpu()) {
        const resources=await admitQwenGpu(String(context.taskId || ''));
        if(!resources.ok)return resources;
        if(handoffPending || (generationTaskId && generationTaskId!==context.taskId) || stopping || cleanupFault || context.isCancelled?.())
          throw Object.assign(Error('模型正在交接，请稍后重试'),{errorCode:'prompt-assistant-busy'});
      }
      stopGuard=startGuard(abort,model);
      if(restricted){rotationMonitor=setInterval(()=>{
        if(rotationPending || abort.signal.aborted)return;
        rotationPending=checkRotation('before').then(valid=>{
          if(!valid){rotationFailure=Object.assign(Error('节点任务或会话已变化，未修改作品'),{errorCode:'qwen-rotation-owner-stale'});abort.abort(rotationFailure);}
        }).catch(()=>{rotationFailure=Object.assign(Error('节点任务核验失败，未修改作品'),{errorCode:'qwen-rotation-owner-stale'});abort.abort(rotationFailure);}).finally(()=>{rotationPending=null;});
      },3000);rotationMonitor.unref?.();}
      setOperationPhase(ticket,'loading');
      const answer=await activeSession.withSession(async flash=>{
        const trackedFlash={...flash,infer:(...args)=>{setOperationPhase(ticket,'analyzing');return flash.infer(...args);},inferConversation:(...args)=>{setOperationPhase(ticket,'analyzing');return flash.inferConversation(...args);}};
        if(rotation)return {ok:true,data:await runQwenRotationCandidatePreview({enabled:true,payload,flash:trackedFlash,signal:abort.signal,
          actor:rotationActor,isCurrent:(_actor,phase)=>checkRotation(phase)})};
        if(method==='artAgentChat') {
          // Native drawing owns a separate session from warm ordinary chat. Its
          // progress follows this request's real inference and owned cleanup,
          // without inventing token-level progress or another model request.
          return {ok:true,data:await artAgent.run({payload,flash:trackedFlash,signal:abort.signal})};
        }
        if(method==='rewriteAudioPrompt') {
          const input=String(payload.input || '').trim();if(!input)throw Error('请先输入音频描述');
          const messages=audioFlashMessages(payload.kind,input,payload.seconds,payload.bpm);
          const requirements=String(payload.requirements || '').trim().slice(0,1000);
          if(requirements){
            messages.system+='\nApply the user’s requested changes to the final sound description while respecting the fixed audio settings.';
            messages.user+='\nRequested changes: '+requirements;
          }
          const result=await flash.infer({...messages,maxTokens:1536,temperature:.4,stage:'audio-caption'});
          return {ok:true,prompt:cleanAudioCaption(result.text),model:result.model};
        }
        if(typeof legacyApi?.runWithFlashSession!=='function')throw Error('本地任务协议模块尚未配置');
        // The Python protocol calls the owned HTTP model directly, so its
        // inference does not pass through trackedFlash.infer.
        setOperationPhase(ticket,'analyzing');
        return legacyApi.runWithFlashSession(trackedFlash,method,payload,context);
      },{signal:abort.signal});
      if(restricted){clearInterval(rotationMonitor);rotationMonitor=null;if(rotationPending)await rotationPending;
        if(answer.resourcesReleased!==true)throw Object.assign(Error('本地模型资源退出尚未确认，未返回旋转候选'),{errorCode:'strata-release-unconfirmed'});
        if(rotationFailure || rotationCancelled() || !(await checkRotation('after')))
          throw rotationFailure || Object.assign(Error('节点任务或会话已变化，未修改作品'),{errorCode:'qwen-rotation-owner-stale'});}
      const result=answer.value;
      if(method==='artAgentChat') {
        const trialFailure=communityTrialResponseFailure(payload,result?.data,{isolatedTest:isolatedCommunityRuntimeForTest===true});
        if(trialFailure)throw Object.assign(Error(trialFailure.error),{errorCode:trialFailure.errorCode});
      }
      const external=result?.data?.localInference || result?.localInference;
      lastTiming={...answer.timing,
        ...(['strata','qwen-cpu'].includes(external?.analysisBackend) ? {requestMs:external.requestMs,requests:external.requests,
          requestTimingScope:'python-business-request',protocolCpuMs:Math.max(0,answer.timing.callbackMs-external.requestMs)} : {}),
        beforeGenerationMs:Date.now()-ticket.startedAt};lastError=result?.ok===false?result.error || '分析失败':'';
      logger('flash local brain finished',{method,ms:lastTiming.beforeGenerationMs,resourcesReleased:true});
      const executionDevice=model==='qwen' ? verifiedExecutionDevice(answer.executionDevice) : null;
      if(executionDevice)qwenLastExecutionDevice=executionDevice;
      // These credentials are attached only after withSession has independently
      // proved the owned model processes exited. The producer cannot grant them.
      const released={analysisBackend:backendFor(model),modelIdentity:answer.identity,resourcesReleased:true,generationReady:!rotation && result?.ok===true && (method!=='artAgentChat' || Boolean(result.data?.proposal || result.data?.mediaPlan || result.data?.toolPlan))};
      const data=result?.data ? {...result.data,...released,timing:lastTiming} : undefined;
      if(method==='artAgentChat' && data?.proposal)data.proposal={...data.proposal,...released};
      return {...result,...released,...(executionDevice?{executionDevice}:{}),...(data ? {data} : {}),timing:lastTiming,
};
    }catch(error){lastError=String(error.message || error);const code=error.errorCode || error.code || 'strata-analysis-failed';
      if(['strata-release-unconfirmed','strata-unload-failed'].includes(code))cleanupFault=true;
      return {ok:false,error:lastError,errorCode:code,analysisBackend:backendFor(model)};
    }finally{clearInterval(cancelTimer);if(rotationMonitor)clearInterval(rotationMonitor);stopGuard();abort.signal.removeEventListener('abort',stopCpu);if(activeAbort===abort)activeAbort=null;
      if(operationTicket===ticket){operation=null;operationTicket=null;operationReporter=null;}finishLease(ticket);}
  }
  const uiCpuActions=new Set(['capabilities','grok-vision-job','compile-grok-vision','native-ui-cloud','native-ui-compile']);
  async function runUiCpu(payload,context={}) {
    if(!uiCpuActions.has(payload.action))return {ok:false,error:'未知的 UI CPU 操作',errorCode:'invalid-request'};
    if(context.isCancelled?.())return {ok:false,error:'任务已取消',errorCode:'task-cancelled'};
    if(typeof legacyApi?.reverseImagePrompt!=='function')return {ok:false,error:'缺少 UI CPU 编译器',errorCode:'ui-design-cpu-unavailable'};
    try {return await legacyApi.reverseImagePrompt(payload);}
    catch(error){return {ok:false,error:String(error?.message || error),errorCode:'ui-design-cpu-failed'};}
  }
  async function runUiPeSource(payload,context={}) {
    if(context.uiScope!=='pe-source-v1' || payload?.surface!=='ui-design' || payload?.uiPlanner!=='native-catalog-v3' || payload?.uiAnalysisStage!=='source-only')return {ok:false,errorCode:'invalid-request',error:'Invalid UI PE source scope'};
    if(context.uiPeVerified!==true)return {ok:false,errorCode:'ui-pe-source-unavailable',error:'UI PE source has not been verified on this node'};
    if(stopping || cleanupFault || lease || generationTaskId || handoffPending)return {ok:false,errorCode:'prompt-assistant-busy',error:'Local model is busy'};
    if(typeof legacyApi?.uiPeSource!=='function')return {ok:false,errorCode:'ui-pe-source-unavailable',error:'UI PE source bridge unavailable'};
    const state=worker?.getState?.();
    if(!state || (state.currentTaskId && state.currentTaskId!==context.taskId))return {ok:false,errorCode:'runtime-generation-busy',error:'Compute node is busy'};
    try {if(freemem()<6*1024**3)return {ok:false,errorCode:'ui-pe-resource-floor',error:'Insufficient available memory for UI analysis'};} catch {return {ok:false,errorCode:'ui-pe-resource-probe-failed',error:'Unable to check available memory'};}
    try {await closeChatForHandoff();} catch {return {ok:false,errorCode:'ui-pe-handoff-failed',error:'Unable to release local assistant resources'};}
    if(stopping || cleanupFault || lease || generationTaskId || handoffPending)return {ok:false,errorCode:'prompt-assistant-busy',error:'Local model is busy'};
    const ticket=claimLease('uiPeSource',payload,false,'qwen');
    try {return await legacyApi.uiPeSource(payload,context);} finally {finishLease(ticket);}
  }
  function execute(method,payload,context) {
    if(method==='artAgentChat') {
      const failure=selectionFailure(payload);
      if(failure)return Promise.resolve(failure);
    }
    // The browser's UI CPU bridge uses reverse-image-prompt for its capability
    // handshake and CPU job/compile actions. Dispatch before model configuration,
    // the shared lease, or Comfy hand-over; this route never runs inference.
    if(method==='reverseImagePrompt' && payload?.surface==='ui-design' && payload?.uiPlanner==='grok-vision-cpu-v1')return runUiCpu(payload,context);
    if(method==='reverseImagePrompt' && context?.uiScope==='pe-source-v1')return runUiPeSource(payload,context);
    if(method==='artAgentChat' && payload?.mode==='chat')return runResidentChat(payload,context);
    return run(method,payload,context);
  }
  const api={get running(){return Boolean(lease) || allResidencies().some(item=>item.getStatus().state==='releasing');},get busy(){return Boolean(lease) || allResidencies().some(item=>item.getStatus().state==='releasing');},status,
    optimizePrompt:payload=>execute('optimizePrompt',payload),reverseImagePrompt:payload=>execute('reverseImagePrompt',payload),
    describeArtStyle:payload=>execute('describeArtStyle',payload),rewriteAudioPrompt:payload=>execute('rewriteAudioPrompt',payload),
    async artAgentChat(payload) {
      const failure=selectionFailure(payload);
      if(failure)return failure;
      return execute('artAgentChat',payload);
    },
    cancelRequest(payload={}) {
      const requestId=promptRequestId(payload);
      if(!requestId)return Promise.resolve({ok:false,errorCode:'invalid-request',error:'缺少要取消的提示词分析请求'});
      if(lease?.requestId===requestId && !cancellablePromptMethods.has(lease.method))return Promise.resolve({ok:false,errorCode:'prompt-request-not-current',error:'未停止其他任务'});
      // A cancellation may overtake the original HTTP request. Remember this
      // exact ID so a delayed request cannot load Flash after switching to 无AI.
      cancelledPromptRequests.set(requestId,Date.now()+16*60*1000);
      while(cancelledPromptRequests.size>256)cancelledPromptRequests.delete(cancelledPromptRequests.keys().next().value);
      if(!lease || lease.requestId!==requestId)return Promise.resolve({ok:true,cancelled:true,matched:false});
      return api.stop().then(result=>({ok:true,cancelled:true,matched:true,...result}));
    },
    artAgentStop(payload={}) {
      const residency=lease ? residencyFor(lease.model) : allResidencies().find(item=>item.getStatus().state!=='cold') || chatResidency;
      if(lease?.residentChat && lease.requestId===payload.requestId)cancelledAgentRequests.add(payload.requestId);
      if(lease?.residentChat || !lease && residency.getStatus().state!=='cold')return residency.cancel(payload.requestId)
        .then(async result=>{if(result.released)await inFlight;return {ok:result.ok!==false,...result};});
      if(!lease)return Promise.resolve({ok:true,released:true,idle:true});
      if(lease.method!=='artAgentChat' || typeof payload.requestId!=='string' || lease.requestId!==payload.requestId)
        return Promise.resolve({ok:false,errorCode:'art-agent-not-current',error:'这次小桃对话已经结束，未停止其他任务'});
      return api.stop().then(result=>({ok:true,...result}));
    },
    // Pure CPU UI tools require no model or GPU lease.
    probeUiCpu:()=>legacyApi?.probeUiCpu?.() || Promise.resolve(false),
    uiDesignCpu:payload=>legacyApi?.uiDesignCpu(payload) || Promise.resolve({ok:false,error:'缺少 UI CPU 编译器'}),
    runForTask(taskId,method,payload,context={}) {
      // A pooled chat owns this worker task and must release its model before
      // completing. Do not retain a local warm chat or read local account memory.
      if(method==='artAgentChat') {
        const failure=selectionFailure(payload,String(taskId || ''));
        return failure ? Promise.resolve(failure) : run(method,payload,{...context,taskId:String(taskId || '')});
      }
      if(method==='qwenRotationCandidate'||method==='qwenImageEdit')return run(method,payload,{...context,taskId:String(taskId || '')});
      if(!['optimizePrompt','reverseImagePrompt','describeArtStyle','uiDesignCpu','rewriteAudioPrompt'].includes(method))return Promise.resolve({ok:false,error:'未知本地 AI 操作',errorCode:'invalid-request'});
      if(method==='uiDesignCpu')return api.uiDesignCpu(payload);
      return execute(method,payload,{...context,taskId:String(taskId || '')});
    },
    async acquireGeneration(taskId,{isCancelled=()=>false}={}) {
      handoffPending++;
      try{
      if(isCancelled())throw Error('任务已取消');
      for(const residency of allResidencies())await residency.close();
      while(lease){if(isCancelled())throw Error('任务已取消');await Promise.race([inFlight || new Promise(r=>setTimeout(r,100)),new Promise(r=>setTimeout(r,150))]);}
      if(isCancelled())throw Error('任务已取消');
      if(stopping || cleanupFault)throw Object.assign(Error(blocked().error),{errorCode:blocked().errorCode});
      if(generationTaskId && generationTaskId!==taskId)throw Error('另一个生成任务正在执行');
      generationTaskId=taskId;return ()=>{if(generationTaskId===taskId)generationTaskId='';};
      }finally{handoffPending--;}
    },
    async releaseRuntimes(){await api.stop();return releaseRuntimes();},
    stop(){if(stopPromise)return stopPromise;stopping=true;activeAbort?.abort();qwenProbeAbort?.abort();qwenProbeState='unverified';qwenProbeStamp=null;qwenProbeResult=null;qwenProbeRetryAt=0;
      stopPromise=(async()=>{await qwenProbePending;await chatResidency.close({cancel:true}).catch(()=>{});await gemmaResidency.close({cancel:true});await qwenResidency.close({cancel:true});
        await Promise.all([inFlight?.catch(()=>{}),Promise.resolve(legacyApi?.stop?.())]);
        for(const ownerToken of [...ownedOperations]){const result=await lifecycle.unload({ownerToken});if(result?.released!==true || result?.ok===false)throw Error('Flash 进程退出尚未确认');}
        for(const residency of allResidencies())residency.resetAfterRelease();cleanupFault=false;lastError='';if(config)session=makeSession();return {released:true,resourcesReleased:true};
      })().catch(error=>{cleanupFault=true;lastError='Flash 资源尚未确认释放';throw error;}).finally(()=>{stopping=false;stopPromise=null;});return stopPromise;
    }
  };
  return api;
}
