// First-run discovery is read-only. Explicit user settings always win, even
// when invalid; discovery never repairs, downloads, or changes configuration.
import {existsSync,readFileSync,statSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {QWEN_CPU_MODEL} from './qwen-cpu-model.mjs';
import {QWEN_MANAGED_RUNNER_VERSION} from './qwen-managed-runtime.mjs';

export const QWEN_EXECUTION_PREFERENCE_SCHEMA='nf.qwen-execution.v1';

export function selectQwenConfigSource({runtimeRoot,suppliedConfig,envSpecified=false,envPath='',readJson,exists=existsSync,stat=statSync}={}) {
  const load=readJson || (file=>{try{const value=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));return value && typeof value==='object' && !Array.isArray(value) ? value : null;}catch{return null;}});
  const fail=(errorCode,error)=>({config:null,failure:{ok:false,errorCode,error}});
  if (suppliedConfig !== undefined) return {config:suppliedConfig};
  if (envSpecified) {
    if(typeof envPath!=='string' || !envPath.trim()) return fail('qwen-config-invalid','Qwen 显式配置路径为空，请检查配置。');
    const config=load(envPath);return config?{config}:fail('qwen-config-invalid','Qwen 显式配置文件缺失或无效，请检查配置。');
  }
  if (!isAbsolute(String(runtimeRoot || '')) || /^(?:\\\\|\/\/)/.test(runtimeRoot)) return fail('qwen-runtime-metadata-invalid','Foart 运行环境路径不可用。');
  // The legacy CPU configuration remains byte-for-byte untouched so the
  // already installed 2.0.250 node can continue to read it. A new managed
  // release may separately select the execution device; an explicitly passed
  // config or environment override always wins before this branch.
  const withPreference=(config,extra={})=>{
    const preferencePath=join(runtimeRoot,'qwen35-execution.json');
    // New releases default only the known managed runner to GPU. Preserve the
    // legacy on-disk CPU file for older releases and leave other explicitly
    // configured runtimes untouched. A missing GPU component is an explicit
    // resolver error, never an implicit CPU fallback.
    if(!exists(preferencePath))return config.managedRunner===QWEN_MANAGED_RUNNER_VERSION
      ? {config:{...config,executionMode:'gpu'},...extra,executionPreference:'gpu-default'}
      : {config,...extra};
    const preference=load(preferencePath);
    if(!preference || Object.keys(preference).sort().join(',')!=='mode,schema'
      || preference.schema!==QWEN_EXECUTION_PREFERENCE_SCHEMA || !['cpu','gpu'].includes(preference.mode))
      return fail('qwen-execution-preference-invalid','Qwen 执行设备配置无效，请在算力助手中检查。');
    return {config:{...config,executionMode:preference.mode},...extra,executionPreference:preference.mode};
  };
  const configPath=join(runtimeRoot,'qwen35-cpu.json');
  if(exists(configPath)) {const config=load(configPath);return config?withPreference(config):fail('qwen-config-invalid','已有 Qwen 配置无效，请检查配置。');}
  const metadata=load(join(runtimeRoot,'runtime.json'));
  const sameRoot=typeof metadata?.installPath==='string' && isAbsolute(metadata.installPath)
    && resolve(metadata.installPath).toLowerCase()===resolve(runtimeRoot).toLowerCase();
  const modelsPath=metadata?.modelsPath;
  if(!sameRoot || typeof modelsPath!=='string' || !isAbsolute(modelsPath) || /^(?:\\\\|\/\/)/.test(modelsPath))
    return fail('qwen-runtime-metadata-invalid','Foart 运行环境模型目录缺失或无效。');
  const pythonPath=join(runtimeRoot,'engine','python','python.exe');
  const modelDir=join(modelsPath,'LLM','qwen35_9b_ultra_heretic');
  const model=join(modelDir,QWEN_CPU_MODEL.modelFilename),projector=join(modelDir,QWEN_CPU_MODEL.projectorFilename);
  const file=(path,size)=>{try{const s=stat(path);return s.isFile() && (size==null || s.size===size);}catch{return false;}};
  if(!file(pythonPath,null))return fail('qwen-managed-python-missing','Foart 运行环境缺少 Python。');
  if(!file(model,QWEN_CPU_MODEL.modelBytes) || !file(projector,QWEN_CPU_MODEL.projectorBytes))
    return fail('qwen-autodiscovery-model-missing','Foart 模型目录缺少完整的 Qwen 9B 主模型或视觉投影。');
  // The existing managed-runner verifier and asynchronous QWEN_CPU_MODEL SHA
  // verification still run before advertising or executing this candidate.
  return withPreference({pythonPath,model,projector,capability:'qwen35-chat-cpu-v1',managedRunner:QWEN_MANAGED_RUNNER_VERSION,executionMode:'cpu'},{discovered:true});
}
