import {statSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {verifyManagedCpuComponent,verifyManagedCuda12Component} from './qwen-managed-integrity.mjs';

export const QWEN_MANAGED_RUNNER_VERSION = 'ollama-v0.40.13';
export const QWEN_MANAGED_CUDA_VERSION = 'ollama-v0.40.13-cuda12';
// Local GPU execution is enabled after the managed-resource hand-off and
// isolated real chain passed. This does not authorize CUDA redistribution.
const QWEN_GPU_RELEASE_READY = true;

function isFile(path) { try { return statSync(path).isFile(); } catch { return false; } }
function isDirectory(path) { try { return statSync(path).isDirectory(); } catch { return false; } }

// Preserve explicit configurations; managed selection never falls back to an
// older executable when the selected component is missing or incomplete.
export function resolveQwenManagedRuntime(config,runtimeRoot) {
  if (!config) return {config};
  const reject=(errorCode,error)=>({config:null,failure:{ok:false,errorCode,error}});
  // Never silently accept a GPU request and run a different backend. The
  // supervisor separately proves CUDA and all-layer offload before readiness.
  if (config.executionMode != null && !['cpu','gpu'].includes(config.executionMode))
    return reject('qwen-execution-mode-invalid','Qwen 执行模式无效，请选择 CPU 或 GPU。');
  if (config.executionMode === 'gpu' && !QWEN_GPU_RELEASE_READY)
    return reject('qwen-gpu-not-ready','Qwen GPU 模式尚未完成资源交接验证，请先使用 CPU 模式。');
  if (!Object.hasOwn(config,'managedRunner')) {
    if(config.executionMode==='gpu')return reject('qwen-gpu-managed-required','Qwen GPU 模式需要受管运行组件。');
    return {config};
  }
  if (config.managedRunner !== QWEN_MANAGED_RUNNER_VERSION || !isAbsolute(String(runtimeRoot || '')))
    return reject('qwen-managed-runner-invalid','Qwen 受管运行环境配置无效。');
  const component=join(runtimeRoot,'engine','llama',QWEN_MANAGED_RUNNER_VERSION);
  const exe=join(component,'lib','ollama','llama-server.exe');
  if (!isDirectory(component)) return reject('qwen-managed-runner-missing','Qwen 受管运行环境尚未安装。');
  if (!isFile(exe)) return reject('qwen-managed-runner-incomplete','Qwen 受管运行环境不完整。');
  if (!verifyManagedCpuComponent(component))
    return reject('qwen-managed-runner-unapproved','Qwen 受管 CPU 运行环境文件或许可校验失败。');
  if(config.executionMode==='gpu') {
    const cudaComponent=join(runtimeRoot,'engine','llama',QWEN_MANAGED_CUDA_VERSION);
    if(!isDirectory(cudaComponent))return reject('qwen-gpu-component-missing','Qwen GPU 运行组件未安装。');
    if(!verifyManagedCuda12Component(cudaComponent))return reject('qwen-gpu-component-invalid','Qwen GPU 运行组件完整性校验失败。');
    return {config:{...config,exe,managedComponentRoot:component,managedCudaComponentRoot:cudaComponent}};
  }
  return {config:{...config,exe,managedComponentRoot:component}};
}
