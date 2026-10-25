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
import { isFlashArtDirectionRequest, planFlashArtDirection, FLASH_ART_SYSTEM_SHA256 } from './flash-art-direction.mjs';
import { createFlashArtAgent, FLASH_ART_AGENT_TOOLS, FLASH_ART_AGENT_STYLE_VERSION, FLASH_ART_AGENT_PARENT_SYSTEM_SHA256, FLASH_ART_AGENT_SYSTEM_SHA256 } from './flash-art-agent.mjs';
import { createFlashChatResidency } from './flash-chat-residency.mjs';

export function strataConfigPath(runtimeJsonPath) {
  return process.env.NOVAFLOW_STRATA_CONFIG || join(runtimeJsonPath ? dirname(runtimeJsonPath) : join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow', 'AI-Runtime'), 'strata-prompt.json');
}
export function readStrataConfig(path) {
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}
// The drawing UI may assign the whole source photograph both subject and
// background/composition duties. They still belong to that ONE content image;
// this is not a separate background/pose donor. Keep the frozen v1 producer
// unchanged and canonicalize only that exact whole-source + style pair.
function wholeSourceArtPair(payload) {
  if (isFlashArtDirectionRequest(payload)) return payload;
  const refs = payload?.artContext?.references;
  if (!Array.isArray(refs) || refs.length !== 2) return payload;
  const roles = ref => Array.isArray(ref?.roles) ? ref.roles : [ref?.role];
  const source = refs.find(ref => roles(ref).includes('subject')
    && roles(ref).every(role => ['subject', 'background', 'composition'].includes(role))
    && !ref.excludedRoles?.some(role => roles(ref).includes(role)));
  const style = refs.find(ref => roles(ref).length === 1 && roles(ref)[0] === 'style');
  if (!source || !style || source === style) return payload;
  const normalized = { ...payload, artContext: { ...payload.artContext,
    references: refs.map(ref => ref === source ? { ...ref, role: 'subject', roles: ['subject'] } : ref) } };
  return isFlashArtDirectionRequest(normalized) ? normalized : payload;
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
  sessionFactory=createFlashBrainSession,lifecycle:suppliedLifecycle,resourceProbe,
  fetchImpl=fetch,logger=()=>{},legacyApi=null,chatIdleTimeoutMs=120000,artLearning=null}={}) {
  const path=configPath || strataConfigPath(), config=suppliedConfig || readStrataConfig(path);
  const runtimeLifecycle=suppliedLifecycle || {load:options=>controlCommand(config,path,'load',options),unload:options=>controlCommand(config,path,'unload',options)};
  // A failed/partial load still needs cleanup, but only for its own operation.
  // Never use the shared config receipt as permission to unload another client.
  const ownedOperations=new Set();
  const operationOwners=new Map();
  let operation=null,operationTicket=null;
  function setOperationPhase(ticket,phase) {
    if(!ticket || operationTicket!==ticket || !operation || operation.phase===phase)return;
    operation={...operation,phase,phaseStartedAt:Date.now()};
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
  const cancellablePromptMethods=new Set(['optimizePrompt','reverseImagePrompt','describeArtStyle']);
  const promptRequestId=payload=>typeof payload?.requestId==='string' && payload.requestId.length<=160 ? payload.requestId : '';
  function promptRequestCancelled(payload) {
    const now=Date.now();for(const [id,until] of cancelledPromptRequests)if(until<now)cancelledPromptRequests.delete(id);
    return cancelledPromptRequests.has(promptRequestId(payload));
  }
  const cancelledPromptReply=()=>({ok:false,errorCode:'prompt-assistant-cancelled',error:'本次提示词分析已取消'});
  let chatResidency;
  const configured=()=>Boolean(config && (suppliedLifecycle || isFlashBrainConfigured(config)));
  const makeSession=()=>sessionFactory({baseUrl:config?.baseUrl || 'http://127.0.0.1:8198',expectedModel:config?.expectedModel,
    fetchImpl,lifecycle,onInference:trace,timeoutMs:config?.workflowTimeoutMs || 900000,releaseTimeoutMs:config?.releaseTimeoutMs || 75000,
    config:{...config,maxTokens:config?.maxTokens || 4096}});
  let session=null;try {if(config)session=makeSession();} catch {lastError='Flash 本地配置无效';}
  const unavailable=()=>({ok:false,error:'Flash 本地模型尚未安装完整',errorCode:'strata-not-configured'});
  function status(){const chatSession=chatResidency.getStatus();return {ok:true,enabled:configured() && Boolean(session) && !cleanupFault && !stopping,
    analysisBackend:'strata',drawingBackend:'strata',otherBackend:'strata',supportsOriginalImages:true,supportsStructuredPromptIR:true,
    supportedSurfaces:['art','animation','video','ui-design','audio','aifx'],modelType:'swift15_qwen38_flash_next_iq2_xs',
    artDirectionProtocol:{version:'art-direction-v1',systemSHA256:FLASH_ART_SYSTEM_SHA256},
    artAgent:{version:'xiaotao-art-agent-v2',localOnly:true,maxModelRounds:3,modes:['chat','drawing','creation'],tools:FLASH_ART_AGENT_TOOLS.map(tool=>tool.function.name),supportsFeedbackImages:true,
      styleProtocol:{version:FLASH_ART_AGENT_STYLE_VERSION,parentSystemSHA256:FLASH_ART_AGENT_PARENT_SYSTEM_SHA256,systemSHA256:FLASH_ART_AGENT_SYSTEM_SHA256}},
    chatSession,modelLoaded:chatSession.modelLoaded,operation:operation?{...operation}:null,
    modelPath:config?.modelFiles?.[0]?.path || config?.modelFiles?.[0] || '',runtimeStatus:cleanupFault?'模型释放失败':stopping || operation?.phase==='releasing' || chatSession.state==='releasing'?'释放中':operation?.phase==='loading'?'加载中':operation?.phase==='analyzing'?'分析中':lease?'推理中':chatSession.state==='warm'?'聊天模型已加载，待机中':configured()?'模型可用':'未配置模型',error:lastError,timing:lastTiming};}
  const blocked=()=>({ok:false,errorCode:cleanupFault?'strata-release-unconfirmed':'prompt-assistant-stopping',error:cleanupFault?'Flash 资源尚未确认释放，请先释放显存后重试':'本地 AI 正在释放资源'});
  async function releaseRuntimes(ownTaskId='') {
    const state=worker?.getState?.() || {};
    if(state.currentTaskId && state.currentTaskId!==ownTaskId)return {ok:false,errorCode:'runtime-generation-busy',error:'本地模型正在生成或排队，请等待完成'};
    for(const raw of new Set(comfyUrls)) {
      const base=String(raw).replace(/\/+$/,'');
      const queue=async()=>{
        try {const r=await fetchImpl(base+'/queue',{signal:AbortSignal.timeout(5000)}),q=await r.json();
          if(!r.ok || !Array.isArray(q.queue_running) || !Array.isArray(q.queue_pending))throw Error('无法核对生成队列');
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
  function startGuard(abort) {
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
  function claimLease(method,payload={},residentChat=false){let resolve;const finished=new Promise(done=>{resolve=done;});
    const ticket={method,startedAt:Date.now(),requestId:payload.requestId,residentChat,finished,resolve};
    lease=ticket;inFlight=finished;return ticket;
  }
  function finishLease(ticket){if(lease===ticket)lease=null;if(inFlight===ticket.finished)inFlight=null;ticket.resolve();}
  async function closeChatForHandoff(){handoffPending++;try{return await chatResidency.close();}finally{handoffPending--;}}
  async function runResidentChat(payload,context={}) {
    if(stopping || cleanupFault)return blocked();
    if(!configured() || !session)return unavailable();
    try{artAgent.preflight(payload);}catch(error){return {ok:false,error:String(error.message || error),errorCode:error.errorCode || error.code || 'flash-agent-invalid-input',analysisBackend:'strata'};}
    if(lease || generationTaskId || handoffPending || chatResidency.getStatus().state==='releasing')
      return {ok:false,errorCode:'prompt-assistant-busy',error:'本地 AI 或生成任务正在执行或交接，请等待完成'};
    const ticket=claimLease('artAgentChat',payload,true);
    const cancelTimer=setInterval(()=>{if(context.isCancelled?.())void chatResidency.cancel(payload.requestId).catch(()=>{});},150);cancelTimer.unref?.();
    try{
      if(context.isCancelled?.())throw Object.assign(Error('任务已取消'),{errorCode:'task-cancelled'});
      const answer=await chatResidency.run({requestId:payload.requestId,
        task:(flash,signal)=>artAgent.run({payload,flash,signal})});
      lastError='';lastTiming={...answer.timing,beforeGenerationMs:Date.now()-ticket.startedAt};
      const credentials={analysisBackend:'strata',modelIdentity:answer.identity,resourcesReleased:false,generationReady:false};
      const data={...answer.value,...credentials,chatSession:answer.chatSession,timing:lastTiming};
      // A warm answer is usable text, never proof of a model/GPU handoff.
      return {ok:true,...credentials,data,chatSession:answer.chatSession,timing:lastTiming};
    }catch(error){lastError=String(error.message || error);const code=error.errorCode || error.code || 'strata-analysis-failed';
      if(['strata-release-unconfirmed','strata-unload-failed'].includes(code))cleanupFault=true;
      return {ok:false,error:lastError,errorCode:code,analysisBackend:'strata',resourcesReleased:error.resourcesReleased===true,
        generationReady:false,chatSession:chatResidency.getStatus()};
    }finally{clearInterval(cancelTimer);finishLease(ticket);}
  }
  async function run(method,payload={},context={}) {
    if(cancellablePromptMethods.has(method) && promptRequestCancelled(payload))return cancelledPromptReply();
    if(stopping || cleanupFault)return blocked();
    if(!configured() || !session)return unavailable();
    if(method==='rewriteAudioPrompt' && !String(payload.input || '').trim())return {ok:false,error:'请先输入音频描述',errorCode:'invalid-request'};
    if((lease && !lease.residentChat) || (generationTaskId && generationTaskId!==context.taskId))return {ok:false,errorCode:'prompt-assistant-busy',error:'本地 AI 或生成任务正在执行，请等待完成'};
    if(method==='artAgentChat') {
      try { artAgent.preflight(payload); }
      catch(error) { return {ok:false,error:String(error.message || error),errorCode:error.errorCode || error.code || 'flash-agent-invalid-input',analysisBackend:'strata'}; }
    }
    try{await closeChatForHandoff();}catch(error){lastError=String(error.message || error);cleanupFault=true;return blocked();}
    if(cancellablePromptMethods.has(method) && promptRequestCancelled(payload))return cancelledPromptReply();
    if(stopping || cleanupFault)return blocked();
    if(lease || (generationTaskId && generationTaskId!==context.taskId))return {ok:false,errorCode:'prompt-assistant-busy',error:'本地 AI 或生成任务正在执行，请等待完成'};
    const ticket=claimLease(method,payload);const abort=new AbortController();activeAbort=abort;
    logger('flash local brain started',{method,requestId:promptRequestId(payload),surface:payload.surface || '',purpose:payload.purpose || ''});
    const cancelTimer=setInterval(()=>{if(context.isCancelled?.())abort.abort();},150);cancelTimer.unref?.();
    let stopGuard=()=>{};
    // Cancel the CPU client too: an abandoned protocol process must never send
    // a late HTTP request into the next model session on the same loopback port.
    const stopCpu=()=>{Promise.resolve(legacyApi?.stop?.()).catch(()=>{});};
    abort.signal.addEventListener('abort',stopCpu,{once:true});
    try {
      if(context.isCancelled?.())throw Object.assign(Error('任务已取消'),{errorCode:'task-cancelled'});
      const handoff=await releaseRuntimes(context.taskId);if(!handoff.ok)return handoff;
      stopGuard=startGuard(abort);
      if(method==='artAgentChat' && ['drawing','creation'].includes(payload.mode || 'drawing')) {
        const now=Date.now();operationTicket=ticket;
        operation={requestId:ticket.requestId,mode:payload.mode || 'drawing',phase:'loading',startedAt:ticket.startedAt,phaseStartedAt:now};
      }
      const answer=await session.withSession(async flash=>{
        if(method==='artAgentChat') {
          // Native drawing owns a separate session from warm ordinary chat. Its
          // progress follows this request's real inference and owned cleanup,
          // without inventing token-level progress or another model request.
          const trackedFlash=operationTicket===ticket?{...flash,
            infer:(...args)=>{setOperationPhase(ticket,'analyzing');return flash.infer(...args);},
            inferConversation:(...args)=>{setOperationPhase(ticket,'analyzing');return flash.inferConversation(...args);}
          }:flash;
          return {ok:true,data:await artAgent.run({payload,flash:trackedFlash,signal:abort.signal,knowledge:context.knowledge})};
        }
        const nativeArtPayload=method==='reverseImagePrompt' ? wholeSourceArtPair(payload) : payload;
        if(method==='reverseImagePrompt' && isFlashArtDirectionRequest(nativeArtPayload)) {
          const data=await planFlashArtDirection({payload:nativeArtPayload,flash});
          if(nativeArtPayload!==payload)data.nativeAnalysis.inputRoleNormalization={
            kind:'whole-source-scene-roles',references:payload.artContext.references.map(ref=>({source:ref.source,roles:ref.roles || [ref.role]}))};
          return {ok:true,data};
        }
        if(method==='rewriteAudioPrompt') {
          const input=String(payload.input || '').trim();if(!input)throw Error('请先输入音频描述');
          const result=await flash.infer({...audioFlashMessages(payload.kind,input,payload.seconds),maxTokens:1536,temperature:.4,stage:'audio-caption'});
          return {ok:true,prompt:cleanAudioCaption(result.text),model:result.model};
        }
        if(typeof legacyApi?.runWithFlashSession!=='function')throw Error('本地任务协议模块尚未配置');
        return legacyApi.runWithFlashSession(flash,method,payload,context);
      },{signal:abort.signal});
      const result=answer.value;
      const external=result?.data?.localInference || result?.localInference;
      lastTiming={...answer.timing,
        ...(external?.analysisBackend==='strata' ? {requestMs:external.requestMs,requests:external.requests,
          requestTimingScope:'python-business-request',protocolCpuMs:Math.max(0,answer.timing.callbackMs-external.requestMs)} : {}),
        beforeGenerationMs:Date.now()-ticket.startedAt};lastError=result?.ok===false?result.error || '分析失败':'';
      logger('flash local brain finished',{method,ms:lastTiming.beforeGenerationMs,resourcesReleased:true});
      // These credentials are attached only after withSession has independently
      // proved the owned model processes exited. The producer cannot grant them.
      const released={analysisBackend:'strata',modelIdentity:answer.identity,resourcesReleased:true,generationReady:result?.ok===true && (method!=='artAgentChat' || Boolean(result.data?.proposal))};
      const data=result?.data ? {...result.data,...released,timing:lastTiming} : undefined;
      if(data?.artDirection?.editEnhancer?.kind==='qwen21-strata-native') {
        data.artDirection={...data.artDirection,editEnhancer:{...data.artDirection.editEnhancer,...released}};
      }
      if(method==='artAgentChat' && data?.proposal)data.proposal={...data.proposal,...released};
      return {...result,...released,...(data ? {data} : {}),timing:lastTiming};
    }catch(error){lastError=String(error.message || error);const code=error.errorCode || error.code || 'strata-analysis-failed';
      if(['strata-release-unconfirmed','strata-unload-failed'].includes(code))cleanupFault=true;
      return {ok:false,error:lastError,errorCode:code,analysisBackend:'strata'};
    }finally{clearInterval(cancelTimer);stopGuard();abort.signal.removeEventListener('abort',stopCpu);if(activeAbort===abort)activeAbort=null;
      if(operationTicket===ticket){operation=null;operationTicket=null;}finishLease(ticket);}
  }
  const uiCpuActions=new Set(['capabilities','grok-vision-job','compile-grok-vision','native-ui-cloud','native-ui-compile']);
  async function runUiCpu(payload,context={}) {
    if(!uiCpuActions.has(payload.action))return {ok:false,error:'未知的 UI CPU 操作',errorCode:'invalid-request'};
    if(context.isCancelled?.())return {ok:false,error:'任务已取消',errorCode:'task-cancelled'};
    if(typeof legacyApi?.reverseImagePrompt!=='function')return {ok:false,error:'缺少 UI CPU 编译器',errorCode:'ui-design-cpu-unavailable'};
    try {return await legacyApi.reverseImagePrompt(payload);}
    catch(error){return {ok:false,error:String(error?.message || error),errorCode:'ui-design-cpu-failed'};}
  }
  function execute(method,payload,context) {
    // The browser's UI CPU bridge uses reverse-image-prompt for its capability
    // handshake and CPU job/compile actions. Dispatch before model configuration,
    // the shared lease, or Comfy hand-over; this route never runs inference.
    if(method==='reverseImagePrompt' && payload?.surface==='ui-design' && payload?.uiPlanner==='grok-vision-cpu-v1')return runUiCpu(payload,context);
    if(method==='artAgentChat' && payload?.mode==='chat')return runResidentChat(payload,context);
    return run(method,payload,context);
  }
  const api={get running(){return Boolean(lease) || chatResidency.getStatus().state==='releasing';},get busy(){return Boolean(lease) || chatResidency.getStatus().state==='releasing';},status,
    optimizePrompt:payload=>execute('optimizePrompt',payload),reverseImagePrompt:payload=>execute('reverseImagePrompt',payload),
    describeArtStyle:payload=>execute('describeArtStyle',payload),rewriteAudioPrompt:payload=>execute('rewriteAudioPrompt',payload),
    async artAgentChat(payload,{learningAllowed=true}={}) {
      if (!artLearning || !learningAllowed || !['drawing','creation'].includes(payload?.mode || 'drawing')) return execute('artAgentChat',payload);
      // Validate on CPU before touching persistence or acquiring model ownership.
      try { artAgent.preflight(payload); }
      catch (error) { return {ok:false,error:String(error.message || error),errorCode:error.errorCode || error.code || 'flash-agent-invalid-input'}; }
      let knowledge, warning;
      const learningStarted = Date.now();
      try { knowledge = await artLearning.begin(payload,config?.expectedModel?.ids?.[0] || 'local'); }
      catch { warning = '任务反馈暂不可用，本次使用原有稳定流程；本地文件已保留'; }
      const learningReadMs = Date.now() - learningStarted;
      const response = await execute('artAgentChat',payload,{knowledge});
      const learningWriteStarted = Date.now();
      if (knowledge) {
        try {
          const learning = await artLearning.planned(knowledge,response);
          if (response?.data) response.data.learning = learning;
        } catch { warning = '本次任务记录未完成，生成结果与原有流程不受影响'; }
      }
      if (response.timing) {
        response.timing = {...response.timing,learningReadMs,learningWriteMs:Date.now()-learningWriteStarted,
          endToEndMs:Date.now()-learningStarted};
        if (response.data) response.data.timing = response.timing;
      }
      if (warning) response.learningWarning = warning;
      return response;
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
      if(lease?.residentChat || !lease && chatResidency.getStatus().state!=='cold')return chatResidency.cancel(payload.requestId)
        .then(async result=>{if(result.released)await inFlight;return {ok:result.ok!==false,...result};});
      if(!lease)return Promise.resolve({ok:true,released:true,idle:true});
      if(lease.method!=='artAgentChat' || typeof payload.requestId!=='string' || lease.requestId!==payload.requestId)
        return Promise.resolve({ok:false,errorCode:'art-agent-not-current',error:'这次小桃对话已经结束，未停止其他任务'});
      return api.stop().then(result=>({ok:true,...result}));
    },
    // Pure CPU UI tools require no model or GPU lease.
    uiDesignCpu:payload=>legacyApi?.uiDesignCpu(payload) || Promise.resolve({ok:false,error:'缺少 UI CPU 编译器'}),
    runForTask(taskId,method,payload,context={}) {
      if(!['optimizePrompt','reverseImagePrompt','describeArtStyle','uiDesignCpu','rewriteAudioPrompt'].includes(method))return Promise.resolve({ok:false,error:'未知本地 AI 操作',errorCode:'invalid-request'});
      if(method==='uiDesignCpu')return api.uiDesignCpu(payload);
      return execute(method,payload,{...context,taskId:String(taskId || '')});
    },
    async acquireGeneration(taskId,{isCancelled=()=>false}={}) {
      handoffPending++;
      try{
      if(isCancelled())throw Error('任务已取消');
      await chatResidency.close();
      while(lease){if(isCancelled())throw Error('任务已取消');await Promise.race([inFlight || new Promise(r=>setTimeout(r,100)),new Promise(r=>setTimeout(r,150))]);}
      if(isCancelled())throw Error('任务已取消');
      if(stopping || cleanupFault)throw Object.assign(Error(blocked().error),{errorCode:blocked().errorCode});
      if(generationTaskId && generationTaskId!==taskId)throw Error('另一个生成任务正在执行');
      generationTaskId=taskId;return ()=>{if(generationTaskId===taskId)generationTaskId='';};
      }finally{handoffPending--;}
    },
    async releaseRuntimes(){await api.stop();return releaseRuntimes();},
    stop(){if(stopPromise)return stopPromise;stopping=true;activeAbort?.abort();
      stopPromise=(async()=>{await chatResidency.close({cancel:true}).catch(()=>{});
        await Promise.all([inFlight?.catch(()=>{}),Promise.resolve(legacyApi?.stop?.())]);
        for(const ownerToken of [...ownedOperations]){const result=await lifecycle.unload({ownerToken});if(result?.released!==true || result?.ok===false)throw Error('Flash 进程退出尚未确认');}
        chatResidency.resetAfterRelease();cleanupFault=false;lastError='';if(config)session=makeSession();return {released:true,resourcesReleased:true};
      })().catch(error=>{cleanupFault=true;lastError='Flash 资源尚未确认释放';throw error;}).finally(()=>{stopping=false;stopPromise=null;});return stopPromise;
    }
  };
  return api;
}
