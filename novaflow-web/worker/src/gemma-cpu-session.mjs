import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createFlashBrainSession } from './flash-brain-session.mjs';
import { QWEN_CPU_MODEL } from './qwen-cpu-model.mjs';

const supervisor=fileURLToPath(new URL('./gemma-cpu-supervisor.py',import.meta.url));
export function isGemmaCpuConfigured(config) {
  try {return process.platform==='win32' && ['pythonPath','exe','model','projector'].every(key=>
    typeof config?.[key]==='string' && isAbsolute(config[key]) && statSync(config[key]).isFile());}
  catch{return false;}
}
function unusedPort() {
  return new Promise((resolve,reject)=>{
    const server=createServer();server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});
  });
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Keep the child environment allowlisted: NVIDIA's Windows runtime requires
// ProgramFiles to locate its system components, but must not inherit the
// application's credentials, proxy settings, or arbitrary executable PATH.
export function supervisorEnvironment(config,env=process.env) {
  const systemRoot=env.SystemRoot || 'C:/Windows';
  const programFiles=env.ProgramFiles;
  return {SystemRoot:systemRoot,WINDIR:systemRoot,PATH:join(systemRoot,'System32'),
    ...(env.TEMP?{TEMP:env.TEMP}:{}),...(env.TMP?{TMP:env.TMP}:{}),PYTHONIOENCODING:'utf-8',
    ...(config?.executionMode==='gpu' && typeof programFiles==='string' && /^[A-Za-z]:[\\/]/.test(programFiles) && isAbsolute(programFiles)
      ?{ProgramFiles:programFiles}:{})};
}
// No caller-controlled DLL path is forwarded: the runtime resolver provides
// the independently verified managed component. The supervisor still has its
// own closed GPU release gate and repeats validation before process creation.
function managedGpuFields(config) {
  return config?.executionMode==='gpu'
    ? {executionMode:'gpu',managedCudaComponentRoot:config.managedCudaComponentRoot}
    : {};
}

// The supervisor's GPU ready event is emitted only after the owned pinned
// server reports CUDA0 and full model-layer offload. Configured intent alone
// never serves as evidence of actual GPU execution.
export function confirmedExecutionDevice(config,item) {
  if(item?.event!=='ready')return null;
  if(config?.executionMode==='gpu')return item.executionMode==='gpu'?'gpu':null;
  return item.executionMode===undefined || item.executionMode==='cpu'?'cpu':null;
}

// Verify node-local ownership in the SAME supervisor and Windows identity used
// for a real launch. The probe hashes the artifacts, checks memory and port
// ownership, acquires the real mutex/Job, and exits without starting a model.
export async function probeQwenCpuOwnership({config,signal,spawnImpl=spawn,portSupplier=unusedPort}={}) {
  if(!isGemmaCpuConfigured(config))return {ok:false,errorCode:'qwen-runtime-missing',error:'Qwen 本地模型或运行器尚未配置完整。'};
  if(signal?.aborted)return {ok:false,errorCode:'qwen-preflight-cancelled',error:'本地模型预检已取消。'};
  let child,exited,spawned=false,exitResult=null,output='',probeOk=false,released=false,code='',stage='port',diagnostic=null;
  const abort=()=>{try{child?.stdin?.end();}catch{}};
  try {
    const port=await portSupplier(),apiKey=randomBytes(32).toString('hex');
    if(signal?.aborted)return {ok:false,errorCode:'qwen-preflight-cancelled',error:'本地模型预检已取消。'};
    stage='spawn';child=spawnImpl(config.pythonPath,['-B',supervisor],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:supervisorEnvironment(config)});
    child.once('spawn',()=>{spawned=true;});
    exited=new Promise(resolve=>{child.once('error',error=>{exitResult={error};resolve();});child.once('close',(value,signal)=>{exitResult={code:value,signal};resolve();});});
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
      output+=chunk;if(output.length>8192){code='runtime-unavailable';return;}
      let end;while((end=output.indexOf('\n'))>=0){const line=output.slice(0,end);output=output.slice(end+1);
        try {const event=JSON.parse(line);if(event.event==='probe-ok')probeOk=true;else if(event.event==='released')released=true;else if(event.event==='error'){
          code=String(event.code||'runtime-unavailable');
          const safeStage=['request','parent','ownership','artifacts','memory','listener','job-create','job-limits','cleanup'].includes(event.stage)?event.stage:'unknown';
          diagnostic={origin:'supervisor',stage:safeStage,...(Number.isSafeInteger(event.winError)&&event.winError>0&&event.winError<100000?{winError:event.winError}:{})};
        }}catch{code='runtime-unavailable';}}
    });
    child.stdin.on('error',()=>{});
    stage='request';child.stdin.write(JSON.stringify({parentPid:process.pid,port,apiKey,exe:config.exe,model:config.model,projector:config.projector,modelId:QWEN_CPU_MODEL.modelId,probe:true,...(config.managedComponentRoot?{managedComponentRoot:config.managedComponentRoot}:{}),...managedGpuFields(config)})+'\n');
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    stage='wait';let timeout;await Promise.race([exited,new Promise(resolve=>{timeout=setTimeout(resolve,240000);timeout.unref?.();})]);clearTimeout(timeout);
    if(!exitResult){child.stdin.end();let cleanup;await Promise.race([exited,new Promise(resolve=>{cleanup=setTimeout(resolve,20000);cleanup.unref?.();})]);clearTimeout(cleanup);}
    if(!exitResult){child.kill();await exited;return {ok:false,errorCode:'qwen-ownership-unconfirmed',error:'本地模型预检超时，资源退出尚未确认。'};}
    if(exitResult.error && !spawned){const safeCode=/^[A-Z0-9_]{1,40}$/.test(exitResult.error.code||'')?exitResult.error.code:'';return {ok:false,errorCode:'qwen-runtime-missing',error:'Qwen 本地运行器无法启动。',diagnostic:{origin:'node',stage:'spawn',...(safeCode?{code:safeCode}:{})}};}
    if(!released)return {ok:false,errorCode:'qwen-ownership-unconfirmed',error:'本地模型预检资源退出尚未确认。',...(diagnostic?{diagnostic}:{})};
    if(signal?.aborted)return {ok:false,errorCode:'qwen-preflight-cancelled',error:'本地模型预检已取消。'};
    if(exitResult.code===0 && probeOk && !code)return {ok:true};
    const messages={'system-ucrt-unavailable':'Windows 通用运行库不可用，无法启动 Qwen CPU 运行环境。',
      'resource-busy':'另一个 Foart 本地模型正在使用 CPU 运行器，请稍后重试。',
      'resource-recovery-required':'上次本地模型资源尚未完全释放，请稍后重试。',
      'resource-lock-unavailable':'无法确认本地模型资源归属。','memory-unavailable':'本机可用内存不足或无法检查。',
      'port-unavailable':'无法确认本机回环端口或其归属。','files-invalid':'Qwen 模型或运行器文件校验失败。'};
    return {ok:false,errorCode:'qwen-'+(Object.hasOwn(messages,code)?code:'preflight-failed'),error:messages[code]||'Qwen 本机资源预检失败。',...(diagnostic?{diagnostic}:{})};
  } catch(error) {
    if(child && !exitResult){try{child.stdin.end();}catch{}if(exited){let timeout;await Promise.race([exited,new Promise(resolve=>{timeout=setTimeout(resolve,20000);timeout.unref?.();})]);clearTimeout(timeout);if(!exitResult){child.kill();await exited;}}}
    if(spawned && !released)return {ok:false,errorCode:'qwen-ownership-unconfirmed',error:'本地模型预检资源退出尚未确认。'};
    const safeCode=typeof error?.code==='string' && /^[A-Z0-9_]{1,40}$/.test(error.code)?error.code:'';
    return {ok:false,errorCode:'qwen-preflight-failed',error:'Qwen 本机资源预检失败，未启动模型。',diagnostic:{origin:'node',stage,...(safeCode?{code:safeCode}:{})}};
  } finally {signal?.removeEventListener('abort',abort);}
}

// One supervisor per lease; its Windows Job contains only the child it created.
// A random key lives only in memory and the private stdin/environment channel.
export function createGemmaCpuSession({config,fetchImpl=fetch,modelId='gemma-4-12b-it',spawnImpl=spawn}={}) {
  if(!['gemma-4-12b-it',QWEN_CPU_MODEL.modelId].includes(modelId))throw Error('Unsupported local model');
  const qwen=modelId===QWEN_CPU_MODEL.modelId, alias=qwen?QWEN_CPU_MODEL.alias:'gemma4-heretic';
  const label=qwen?'Qwen 3.5 9B':'Gemma', codePrefix=qwen?'qwen':'gemma';
  return {
    async withSession(callback,options={}) {
      if(!isGemmaCpuConfigured(config))throw Object.assign(Error(`${label} 本地运行环境尚未就绪`),{errorCode:`${codePrefix}-runtime-missing`});
      const port=await unusedPort(),apiKey=randomBytes(32).toString('hex'),baseUrl=`http://127.0.0.1:${port}`;
      let child=null,spawned=false,released=false,exited=null,exitResult=null,lastFailure='',contextExceeded=false,executionDevice=null;
      const modelFetch=async(url,init)=>{
        // Qwen's own chat template defaults to thinking mode. The endpoint's
        // reasoning budget alone does not change its template. Do not apply
        // this backend-specific option to Next or Gemma requests.
        if(qwen && String(url).endsWith('/v1/chat/completions') && typeof init?.body==='string') {
          const body=JSON.parse(init.body);body.chat_template_kwargs={enable_thinking:false};
          init={...init,body:JSON.stringify(body)};
        }
        const response=await fetchImpl(url,init);
        if(response.status===400 && String(url).endsWith('/v1/chat/completions'))try {
          const data=await response.clone().json();contextExceeded=data?.error?.type==='exceed_context_size_error';
        }catch{}
        return response;};
      const lifecycle={
        async load({signal}={}) {
          if(child)throw Error('Gemma 运行器已启动');
          child=spawnImpl(config.pythonPath,['-B',supervisor],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:supervisorEnvironment(config)});
          child.once('spawn',()=>{spawned=true;});
          exited=new Promise(resolve=>{child.once('error',error=>{exitResult={error};resolve(exitResult);});
            child.once('close',(code,signal)=>{exitResult={code,signal};resolve(exitResult);});});
          let buffer='',ready=false,lastError='';
          child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
            buffer+=chunk;if(buffer.length>8192){lastError='Gemma 运行器响应异常';return;}
            let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
              try {const item=JSON.parse(line);if(item.event==='ready'){
                  executionDevice=confirmedExecutionDevice(config,item);
                  if(!executionDevice){lastFailure='gpu-proof-unconfirmed';lastError='本地运行设备未通过核验';}else ready=true;
                }else if(item.event==='released')released=true;
                else if(item.event==='error'){lastFailure=item.code;lastError='Gemma 运行器启动或资源检查失败';}}catch{lastError='Gemma 运行器响应异常';}}
          });
          child.stdin.on('error',()=>{});
          child.stdin.write(JSON.stringify({parentPid:process.pid,port,apiKey,exe:config.exe,model:config.model,projector:config.projector,modelId,...(qwen && config.managedComponentRoot?{managedComponentRoot:config.managedComponentRoot}:{}),...(qwen?managedGpuFields(config):{})})+'\n');
          const start=Date.now();
          while(Date.now()-start<240000) {
            if(signal?.aborted)throw signal.reason || Error('Gemma 加载已取消');
            if(exitResult || lastError)throw Error(lastError || 'Gemma 运行器提前退出');
            if(ready) {
              try {const r=await fetchImpl(baseUrl+'/health',{headers:{authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(2000)});
                if(r.ok && (await r.json())?.status==='ok')return {ok:true,modelLoadMs:Date.now()-start,executionDevice};
              }catch{}
            }
            await pause(100);
          }
          throw Error('Gemma 运行器加载超时');
        },
        async unload() {
          if(!child)return {ok:true,released:true};
          // A spawn error before the spawn event proves no supervisor (and so
          // no owned server) was created. Once spawned, require its receipt.
          if(exitResult?.error && !spawned)return {ok:true,released:true};
          if(!exitResult)child.stdin.end();
          if(!exitResult)await new Promise(resolve=>{const timer=setTimeout(resolve,20000);exited.then(()=>{clearTimeout(timer);resolve();});});
          // Do not assume that an HTTP error or a request abort released memory.
          // A release receipt follows a wait for the owned Job's process handle.
          if(!exitResult || !released)return {ok:false,released:false};
          return {ok:true,released:true};
        }
      };
      const session=createFlashBrainSession({baseUrl,apiKey,fetchImpl:modelFetch,lifecycle,
        expectedModel:{ids:[alias],paths:[config.model]},timeoutMs:900000,releaseTimeoutMs:30000,
        config:{maxTokens:1024,reasoningEffort:'none',reasoningBudgetTokens:0}});
      // This capability is specific to the verified llama.cpp route. Next's
      // existing Strata conversation contract remains unchanged.
      try {
        const result=await session.withSession(flash=>callback({...flash,supportsFoartJsonSchema:true,executionDevice}),options);
        return {...result,executionDevice};
      }
      catch(error) {
        if(error?.errorCode==='strata-load-failed' && lastFailure) {
          const messages={'system-ucrt-unavailable':'Windows 通用运行库不可用，无法启动 Gemma CPU 运行环境。',
            'files-invalid':'Gemma 模型或运行器文件校验失败，请检查安装文件。',
            'memory-unavailable':'本机可用内存不足或无法检查，请释放内存后重试。',
            'port-unavailable':'Gemma 本地服务端口不可用，请稍后重试。',
            'resource-busy':'本机另一个 Foart 本地模型正在使用 CPU 运行器，请稍后重试。',
            'resource-recovery-required':'上次本地模型退出状态尚未确认，请等待旧任务完全退出后重试。',
            'resource-lock-unavailable':'无法确认本地模型资源归属，未启动模型。',
            'cancelled':'Gemma 加载已取消。','gpu-proof-unconfirmed':'Gemma GPU 执行未通过核验，未切换至 CPU。',
            'runtime-unavailable':'Gemma 本地运行器启动失败。'};
          error.errorCode='gemma-'+(Object.hasOwn(messages,lastFailure)?lastFailure:'runtime-unavailable');
          error.message=messages[lastFailure] || messages['runtime-unavailable'];
        } else if(error?.errorCode==='strata-http-error' && contextExceeded) {
          error.errorCode='gemma-context-too-long';error.message='当前请求超出 Gemma 的上下文长度，请缩短内容或减少附件后重试。';
        }
        if(qwen) {
          error.message=String(error.message || '').replaceAll('Gemma',label);
          if(typeof error.errorCode==='string' && error.errorCode.startsWith('gemma-'))error.errorCode='qwen-'+error.errorCode.slice(6);
        }
        throw error;
      }
    }
  };
}
