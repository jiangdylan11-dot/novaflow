// GPU admission is read-only: never unload a shared Comfy instance or stop an
// unrelated process. The worker's existing generation lease provides the
// hand-off for work it owns; a queue recheck also catches external activity.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const QWEN_GPU_COLD_FREE_MIB = 10240;
export const QWEN_GPU_RUNNING_FREE_MIB = 768;
// Use the protected Windows system directory, never PATH or the working
// directory: those can contain an unrelated executable named nvidia-smi.
// Nonstandard Windows installations fail closed until explicitly supported.
const SYSTEM_NVIDIA_SMI = 'C:\\Windows\\System32\\nvidia-smi.exe';

export async function queryQwenGpuMemory() {
  const { stdout } = await execFileAsync(SYSTEM_NVIDIA_SMI,
    ['--query-gpu=index,memory.free,memory.total', '--format=csv,noheader,nounits'],
    { windowsHide: true, timeout: 4000, maxBuffer: 16384 });
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  // The runtime selects CUDA device 0. Without an unambiguous single device,
  // nvidia-smi ordering cannot prove it is checking the same GPU as CUDA.
  if (lines.length !== 1) throw Error('GPU device selection is ambiguous');
  const match = /^\s*0\s*,\s*(\d+)\s*,\s*(\d+)\s*$/.exec(lines[0]);
  if (!match) throw Error('GPU memory response is invalid');
  const freeMiB = Number(match[1]), totalMiB = Number(match[2]);
  if (!Number.isSafeInteger(freeMiB) || !Number.isSafeInteger(totalMiB) || totalMiB < 1 || freeMiB > totalMiB)
    throw Error('GPU memory response is invalid');
  return { freeMiB, totalMiB };
}

export async function checkQwenGpuResources({ worker, ownTaskId = '', comfyUrls, fetchImpl = fetch,
  queryGpu = queryQwenGpuMemory, minFreeMiB = QWEN_GPU_COLD_FREE_MIB, checkWorker = true } = {}) {
  const result = (errorCode, error) => ({ ok: false, errorCode, error });
  const idleWorker = () => {
    try {
      const state = worker?.getState?.();
      return state && Object.hasOwn(state, 'currentTaskId') &&
        (!state.currentTaskId || (ownTaskId && state.currentTaskId === ownTaskId));
    } catch { return false; }
  };
  if (checkWorker && !idleWorker()) return result('qwen-gpu-worker-busy', '计算节点正在执行其他任务，未启动本地 GPU 模型。');
  if (!Array.isArray(comfyUrls) || !comfyUrls.length)
    return result('qwen-gpu-queue-unverified', '无法确认生成服务的任务队列，未启动本地 GPU 模型。');
  for (const raw of new Set(comfyUrls)) {
    let base;
    try {
      const url = new URL(String(raw));
      if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.search || url.hash) throw Error('invalid URL');
      base = url.toString().replace(/\/+$/, '');
    } catch { return result('qwen-gpu-queue-unverified', '无法确认本机生成服务的任务队列，未启动本地 GPU 模型。'); }
    try {
      const response = await fetchImpl(base + '/queue', { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw Error('queue request failed');
      const queue = await response.json();
      if (!Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending)) throw Error('invalid queue');
      if (queue.queue_running.length || queue.queue_pending.length)
        return result('qwen-gpu-generation-busy', '生成任务正在运行或排队，请等待任务结束后再使用本地 GPU 模型。');
    } catch (error) {
      // A local port that is closed has no running Comfy queue. Timeouts,
      // authorization failures and malformed responses remain unverified.
      if (error?.cause?.code !== 'ECONNREFUSED' && error?.code !== 'ECONNREFUSED')
        return result('qwen-gpu-queue-unverified', '无法确认生成服务的任务队列，未启动本地 GPU 模型。');
    }
  }
  try {
    const gpu = await queryGpu();
    if (!Number.isSafeInteger(gpu?.freeMiB) || !Number.isSafeInteger(gpu?.totalMiB)
      || gpu.freeMiB < 0 || gpu.totalMiB < 1 || gpu.freeMiB > gpu.totalMiB) throw Error('invalid GPU memory');
    if (gpu.freeMiB < minFreeMiB)
      return result('qwen-gpu-memory-low', '可用显存不足，本地 GPU 模型未启动或正在安全退出。');
  } catch { return result('qwen-gpu-memory-unverified', '无法确认显存状态，本地 GPU 模型未启动或正在安全退出。'); }
  if (checkWorker && !idleWorker()) return result('qwen-gpu-worker-busy', '计算节点正在执行其他任务，未启动本地 GPU 模型。');
  return { ok: true };
}

// One bounded observer per owned session, including its short idle residency.
// Closing the session stops future probes; an in-flight probe cannot abort it
// after closure. Only the supplied model AbortController is affected.
export function watchQwenGpuResources({check,abort,intervalMs=5000,setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}={}) {
  if(typeof check!=='function' || typeof abort?.abort!=='function') throw Error('Invalid GPU watch configuration');
  let ended=false,pending=false;
  const timer=setIntervalImpl(async()=>{
    if(ended || pending)return;pending=true;
    try {
      const result=await check();
      if(!ended && !result?.ok)abort.abort(Object.assign(Error(result?.error || 'GPU resource check failed'),{errorCode:result?.errorCode || 'qwen-gpu-resource-probe-failed'}));
    } catch {
      if(!ended)abort.abort(Object.assign(Error('无法确认 GPU 资源状态，正在安全退出本地模型。'),{errorCode:'qwen-gpu-resource-probe-failed'}));
    } finally {pending=false;}
  },intervalMs);
  timer?.unref?.();
  return ()=>{ended=true;clearIntervalImpl(timer);};
}
