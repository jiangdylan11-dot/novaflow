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
import { isFlashArtDirectionRequest, planFlashArtDirection } from './flash-art-direction.mjs';

export function strataConfigPath(runtimeJsonPath) {
  return process.env.NOVAFLOW_STRATA_CONFIG || join(runtimeJsonPath ? dirname(runtimeJsonPath) : join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow', 'AI-Runtime'), 'strata-prompt.json');
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
  sessionFactory=createFlashBrainSession,lifecycle:suppliedLifecycle,resourceProbe,
  fetchImpl=fetch,logger=()=>{},legacyApi=null}={}) {
  const path=configPath || strataConfigPath(), config=suppliedConfig || readStrataConfig(path);
  const runtimeLifecycle=suppliedLifecycle || {load:options=>controlCommand(config,path,'load',options),unload:options=>controlCommand(config,path,'unload',options)};
  // A failed/partial load still needs cleanup, but only for its own operation.
  // Never use the shared config receipt as permission to unload another client.
  const ownedOperations=new Set();
  const lifecycle={
    load(options){
      const token=options?.ownerToken;
      if(!/^[A-Za-z0-9_-]{8,128}$/.test(token || ''))throw Object.assign(Error('Flash 会话缺少资源归属标记'),{errorCode:'strata-owner-token-required'});
      ownedOperations.add(token);return runtimeLifecycle.load(options);
    },
    async unload(options){
      const token=options?.ownerToken;
      if(!ownedOperations.has(token))return {ok:true,released:true,notOwned:true};
      const result=await runtimeLifecycle.unload(options);
      if(result?.released===true && result?.ok!==false)ownedOperations.delete(token);
      return result;
    }
  };
  const trace = config?.traceDirectory ? async event => {
    if(!isAbsolute(config.traceDirectory) || /^(?:\\\\|\/\/)/.test(config.traceDirectory))throw Error('本机审计目录必须是本地绝对路径');
    await mkdir(config.traceDirectory,{recursive:true});
    await writeFile(join(config.traceDirectory,randomUUID()+'.json'),JSON.stringify(event,null,2)+'\n',{flag:'wx'});
  } : undefined;
  let lease=null,inFlight=null,activeAbort=null,lastError='',lastTiming=null,cleanupFault=false,stopping=false,stopPromise=null,generationTaskId='';
  const configured=()=>Boolean(config && (suppliedLifecycle || isFlashBrainConfigured(config)));
  const makeSession=()=>sessionFactory({baseUrl:config?.baseUrl || 'http://127.0.0.1:8198',expectedModel:config?.expectedModel,
    fetchImpl,lifecycle,onInference:trace,timeoutMs:config?.workflowTimeoutMs || 900000,releaseTimeoutMs:config?.releaseTimeoutMs || 75000,
    config:{...config,maxTokens:config?.maxTokens || 4096}});
  let session=null;try {if(config)session=makeSession();} catch {lastError='Flash 本地配置无效';}
  const unavailable=()=>({ok:false,error:'Flash 本地模型尚未安装完整',errorCode:'strata-not-configured'});
  function status(){return {ok:true,enabled:configured() && Boolean(session) && !cleanupFault && !stopping,
    analysisBackend:'strata',drawingBackend:'strata',otherBackend:'strata',supportsOriginalImages:true,supportsStructuredPromptIR:true,
    supportedSurfaces:['art','animation','video','ui-design','audio','aifx'],modelType:'swift15_qwen38_flash_next_iq2_xs',
    modelPath:config?.modelFiles?.[0]?.path || config?.modelFiles?.[0] || '',runtimeStatus:cleanupFault?'模型释放失败':stopping?'释放中':lease?'推理中':configured()?'模型可用':'未配置模型',error:lastError,timing:lastTiming};}
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
  async function run(method,payload={},context={}) {
    if(stopping || cleanupFault)return blocked();
    if(!configured() || !session)return unavailable();
    if(method==='rewriteAudioPrompt' && !String(payload.input || '').trim())return {ok:false,error:'请先输入音频描述',errorCode:'invalid-request'};
    if(lease || (generationTaskId && generationTaskId!==context.taskId))return {ok:false,errorCode:'prompt-assistant-busy',error:'本地 AI 或生成任务正在执行，请等待完成'};
    lease={method,startedAt:Date.now()};const abort=new AbortController();activeAbort=abort;
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
      const answer=await session.withSession(async flash=>{
        if(method==='reverseImagePrompt' && isFlashArtDirectionRequest(payload)) {
          return {ok:true,data:await planFlashArtDirection({payload,flash})};
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
        beforeGenerationMs:Date.now()-lease.startedAt};lastError=result?.ok===false?result.error || '分析失败':'';
      logger('flash local brain finished',{method,ms:lastTiming.beforeGenerationMs,resourcesReleased:true});
      // These credentials are attached only after withSession has independently
      // proved the owned model processes exited. The producer cannot grant them.
      const released={analysisBackend:'strata',modelIdentity:answer.identity,resourcesReleased:true,generationReady:result?.ok===true};
      const data=result?.data ? {...result.data,...released,timing:lastTiming} : undefined;
      if(data?.artDirection?.editEnhancer?.kind==='qwen21-strata-native') {
        data.artDirection={...data.artDirection,editEnhancer:{...data.artDirection.editEnhancer,...released}};
      }
      return {...result,...released,...(data ? {data} : {}),timing:lastTiming};
    }catch(error){lastError=String(error.message || error);const code=error.errorCode || error.code || 'strata-analysis-failed';
      if(['strata-release-unconfirmed','strata-unload-failed'].includes(code))cleanupFault=true;
      return {ok:false,error:lastError,errorCode:code,analysisBackend:'strata'};
    }finally{clearInterval(cancelTimer);stopGuard();abort.signal.removeEventListener('abort',stopCpu);activeAbort=null;lease=null;}
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
    const previous=lease,operation=run(method,payload,context);
    if(!previous && lease){inFlight=operation;void operation.finally(()=>{if(inFlight===operation)inFlight=null;}).catch(()=>{});}
    return operation;
  }
  const api={get running(){return Boolean(lease);},get busy(){return Boolean(lease);},status,
    optimizePrompt:payload=>execute('optimizePrompt',payload),reverseImagePrompt:payload=>execute('reverseImagePrompt',payload),
    describeArtStyle:payload=>execute('describeArtStyle',payload),rewriteAudioPrompt:payload=>execute('rewriteAudioPrompt',payload),
    // Pure CPU UI tools require no model or GPU lease.
    uiDesignCpu:payload=>legacyApi?.uiDesignCpu(payload) || Promise.resolve({ok:false,error:'缺少 UI CPU 编译器'}),
    runForTask(taskId,method,payload,context={}) {
      if(!['optimizePrompt','reverseImagePrompt','describeArtStyle','uiDesignCpu','rewriteAudioPrompt'].includes(method))return Promise.resolve({ok:false,error:'未知本地 AI 操作',errorCode:'invalid-request'});
      if(method==='uiDesignCpu')return api.uiDesignCpu(payload);
      return execute(method,payload,{...context,taskId:String(taskId || '')});
    },
    async acquireGeneration(taskId,{isCancelled=()=>false}={}) {
      while(lease){if(isCancelled())throw Error('任务已取消');await Promise.race([inFlight || new Promise(r=>setTimeout(r,100)),new Promise(r=>setTimeout(r,150))]);}
      if(stopping || cleanupFault)throw Object.assign(Error(blocked().error),{errorCode:blocked().errorCode});
      if(generationTaskId && generationTaskId!==taskId)throw Error('另一个生成任务正在执行');
      generationTaskId=taskId;return ()=>{if(generationTaskId===taskId)generationTaskId='';};
    },
    async releaseRuntimes(){await api.stop();return releaseRuntimes();},
    stop(){if(stopPromise)return stopPromise;stopping=true;activeAbort?.abort();
      stopPromise=(async()=>{await Promise.all([inFlight?.catch(()=>{}),Promise.resolve(legacyApi?.stop?.())]);
        for(const ownerToken of [...ownedOperations]){const result=await lifecycle.unload({ownerToken});if(result?.released!==true || result?.ok===false)throw Error('Flash 进程退出尚未确认');}
        cleanupFault=false;lastError='';if(config)session=makeSession();return {released:true};
      })().catch(error=>{cleanupFault=true;lastError='Flash 资源尚未确认释放';throw error;}).finally(()=>{stopping=false;stopPromise=null;});return stopPromise;
    }
  };
  return api;
}
