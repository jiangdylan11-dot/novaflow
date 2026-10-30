// Public compute companion. No editor server, local UI license or private task
// queue is created here: account access and task routing belong to the website.
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createWorker } from './worker-core.mjs';
import { createRuntimeServices, videoRuntimeUrl } from './runtime-services.mjs';
import { createBorrowedRuntimeServices } from './borrowed-runtime-services.mjs';
import { createPromptAssistant } from './prompt-assistant.mjs';
import { ensureFlashBrainConfiguration } from './flash-brain-configuration.mjs';

export async function createComputeAssistant(options) {
  if (!options.modelsRoot) {
    try {
      const config = JSON.parse((await readFile(join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow/AI-Runtime/runtime.json'), 'utf8')).replace(/^\uFEFF/, ''));
      options = { ...options, modelsRoot: config.modelsPath || '' };
    } catch { /* services.start reports a missing environment. */ }
  }
  const progress = options.onProgress || (() => {});
  const runtimeFactory = options.runtimePolicy === 'existing-only' ? createBorrowedRuntimeServices : createRuntimeServices;
  const services = options.services || runtimeFactory({ imageUrl: options.comfyImageUrl, videoUrl: options.comfyVideoUrl,
    logger: options.logger, stateFile: join(options.dataDir, 'owned-runtimes.json') });
  let promptAssistant = null;
  const worker = createWorker({ ...options, registrationProfile: 'compute-only', localTasks: null, promptAssistant: () => promptAssistant });
  const prepared = await ensureFlashBrainConfiguration({
    ...(options.promptAssistant?.runtimeJsonPath || process.env.NOVAFLOW_RUNTIME_JSON ? { runtimeJsonPath: options.promptAssistant?.runtimeJsonPath || process.env.NOVAFLOW_RUNTIME_JSON } : {}),
    ...(options.promptAssistant?.strataConfigPath || process.env.NOVAFLOW_STRATA_CONFIG ? { configPath: options.promptAssistant?.strataConfigPath || process.env.NOVAFLOW_STRATA_CONFIG } : {})
  });
  if (!prepared.ok) options.logger?.('Flash local installation incomplete', { reason: prepared.reason });
  const imageUrl = options.comfyImageUrl || 'http://127.0.0.1:8188';
  const comfyUrls = [...new Set([imageUrl, videoRuntimeUrl(options.comfyVideoUrl, imageUrl)].map(url => String(url).replace(/\/+$/, '')))];
  promptAssistant = createPromptAssistant({ worker, logger: options.logger, comfyUrls, ...(options.promptAssistant || {}) });
  let runtimes = [];
  let servicesRunning = false;
  let operations = Promise.resolve();
  const serial = action => {
    const next = operations.then(action);
    operations = next.catch(() => {});
    return next;
  };
  const snapshot = () => ({ ...worker.getState(), profile: 'compute-only', workbenchUrl: '', runtimes });
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(snapshot()); } catch { /* UI listener */ } } };
  worker.onChange(emit);
  const stopResources = async () => {
    const errors = [];
    // A remote disconnect must not prevent locally owned processes being
    // released. Preserve a services failure so the UI cannot claim a stop.
    try { await worker.stop(); } catch (error) { errors.push(error); }
    try { await promptAssistant.stop(); } catch (error) { errors.push(error); }
    try { await services.stop(); servicesRunning = false; runtimes = []; } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, '节点停止未完成：' + errors.map(error => error.message).join('；'));
  };
  const start = (settings = {}) => serial(async () => {
    if (!options.controlUrl) throw new Error('请先设置控制面地址');
    try {
      progress(20, '正在检查模型运行环境');
      if (!servicesRunning) {
        runtimes = await services.start(message => progress(25, message));
        servicesRunning = true;
        const image = runtimes.find(r => r.kind === 'image')?.url;
        const video = runtimes.find(r => r.kind === 'video')?.url || image;
        if (image || video) {
          worker.retargetComfy?.({ image, video });
          comfyUrls.splice(0, comfyUrls.length, ...new Set([image || comfyUrls[0], video || comfyUrls.at(-1)]));
        }
      }
      await worker.startSharing({ ...settings, onProgress: progress });
      emit();
      return snapshot();
    } catch (error) {
      await stopResources().catch(cleanupError => options.logger?.('compute startup cleanup failed', { error: cleanupError.message }));
      emit();
      throw error;
    }
  });
  return {
    getState: snapshot,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start,
    startSharing: start,
    stop: () => serial(async () => { await stopResources(); await options.clearRunFiles?.(); emit(); return snapshot(); }),
    get worker() { return worker; },
    get promptAssistant() { return promptAssistant; }
  };
}
