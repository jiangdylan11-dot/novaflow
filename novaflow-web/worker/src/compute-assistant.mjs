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
  const imageUrl = options.comfyImageUrl || 'http://127.0.0.1:8188';
  const comfyUrls = [...new Set([imageUrl, videoRuntimeUrl(options.comfyVideoUrl, imageUrl)].map(url => String(url).replace(/\/+$/, '')))];
  let runtimes = [];
  let servicesRunning = false;
  let desired = false, stopping = false, reconciling = false, runtimeStarting = false, retryTimer = null;
  let runtimeError = '', nextRuntimeAttempt = 0;
  const runtimeRetryMs = options.runtimeRetryIntervalMs ?? 30000;
  let operations = Promise.resolve();
  const serial = action => {
    const next = operations.then(action);
    operations = next.catch(() => {});
    return next;
  };
  const snapshot = () => ({ ...worker.getState(), profile: 'compute-only', workbenchUrl: '', runtimes, runtimeStarting,
    environmentError: runtimeError, lastError: runtimeError || worker.getState().lastError });
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(snapshot()); } catch { /* UI listener */ } } };
  const authorized = () => {
    const { policy, sharing } = worker.getState();
    return desired && sharing && policy?.enabled === true && (policy.owner_enabled === true || policy.sharing_enabled === true);
  };
  worker.onChange(() => { emit(); scheduleReconcile(); });
  const stopServices = async () => {
    worker.setComputeReady(false);
    const errors = [];
    try { await promptAssistant?.stop(); } catch (error) { errors.push(error); }
    try { await services.stop(); servicesRunning = false; runtimes = []; } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('；'));
  };
  const stopResources = async () => {
    const errors = [];
    // A remote disconnect must not prevent locally owned processes being
    // released. Preserve a services failure so the UI cannot claim a stop.
    try { await worker.stop(); } catch (error) { errors.push(error); }
    try { await stopServices(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, '节点停止未完成：' + errors.map(error => error.message).join('；'));
  };
  async function reconcile() {
    if (!desired || stopping) return;
    if (!authorized()) {
      worker.setComputeReady(false);
      if (servicesRunning && !worker.getState().currentTaskId) {
        try { await stopServices(); await worker.reportModels(); }
        catch (error) { runtimeError = '模型环境停止失败：' + error.message; }
      }
      emit();
      return;
    }
    if (servicesRunning || Date.now() < nextRuntimeAttempt) return;
    runtimeStarting = true;
    runtimeError = '';
    emit();
    try {
      // The environment may have been installed while this machine waited for
      // approval. Read it again before each attempt, without needing a restart.
      if (!options.modelsRoot) {
        try {
          const config = JSON.parse((await readFile(options.promptAssistant?.runtimeJsonPath || join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow/AI-Runtime/runtime.json'), 'utf8')).replace(/^\uFEFF/, ''));
          worker.retargetModelsRoot(config.modelsPath || '');
        } catch { /* services.start will provide the actionable error. */ }
      }
      const prepared = await ensureFlashBrainConfiguration({
        ...(options.promptAssistant?.runtimeJsonPath || process.env.NOVAFLOW_RUNTIME_JSON ? { runtimeJsonPath: options.promptAssistant?.runtimeJsonPath || process.env.NOVAFLOW_RUNTIME_JSON } : {}),
        ...(options.promptAssistant?.strataConfigPath || process.env.NOVAFLOW_STRATA_CONFIG ? { configPath: options.promptAssistant?.strataConfigPath || process.env.NOVAFLOW_STRATA_CONFIG } : {})
      });
      if (!prepared.ok) options.logger?.('Flash local installation incomplete', { reason: prepared.reason });
      if (!promptAssistant) promptAssistant = createPromptAssistant({ worker, logger: options.logger, comfyUrls, ...(options.promptAssistant || {}) });
      runtimes = await services.start(() => emit());
      servicesRunning = true;
      const image = runtimes.find(r => r.kind === 'image')?.url;
      const video = runtimes.find(r => r.kind === 'video')?.url || image;
      if (image || video) {
        worker.retargetComfy?.({ image, video });
        comfyUrls.splice(0, comfyUrls.length, ...new Set([image || comfyUrls[0], video || comfyUrls.at(-1)]));
      }
      if (!authorized()) { await stopServices(); return; }
      worker.setComputeReady(true);
      await worker.reportModels();
      nextRuntimeAttempt = 0;
    } catch (error) {
      runtimeError = '模型环境未就绪：' + String(error.message || error);
      nextRuntimeAttempt = Date.now() + runtimeRetryMs;
      try { await stopServices(); } catch (cleanupError) { options.logger?.('compute runtime cleanup failed', { error: cleanupError.message }); }
      options.logger?.('compute environment waiting for retry', { error: runtimeError });
    } finally { runtimeStarting = false; emit(); }
  }
  function scheduleReconcile() {
    if (!desired || stopping || reconciling) return;
    reconciling = true;
    void serial(reconcile).catch(error => { runtimeError = String(error.message || error); emit(); }).finally(() => { reconciling = false; });
  }
  const start = (settings = {}) => serial(async () => {
    if (!options.controlUrl) throw new Error('请先设置控制面地址');
    desired = true;
    stopping = false;
    // Keep reentrant worker emits from scheduling a second reconciliation.
    reconciling = true;
    try {
      await worker.startSharing({ ...settings, onProgress: progress });
      await reconcile();
      if (!retryTimer) { retryTimer = setInterval(scheduleReconcile, runtimeRetryMs); retryTimer.unref?.(); }
      emit();
      return snapshot();
    } catch (error) {
      desired = false;
      await stopResources().catch(cleanupError => options.logger?.('compute startup cleanup failed', { error: cleanupError.message }));
      emit();
      throw error;
    } finally { reconciling = false; }
  });
  return {
    getState: snapshot,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start,
    startSharing: start,
    stop: () => {
      desired = false; stopping = true;
      clearInterval(retryTimer); retryTimer = null;
      return serial(async () => { await stopResources(); runtimeError = ''; await options.clearRunFiles?.(); emit(); return snapshot(); });
    },
    get worker() { return worker; },
    get promptAssistant() { return promptAssistant; }
  };
}
