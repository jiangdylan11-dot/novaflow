import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createWorker } from './worker-core.mjs';
import { createLocalTasks } from './local-tasks.mjs';
import { startLocalServer } from './local-server.mjs';
import { createLocalLicense } from './local-license.mjs';
import { createRuntimeServices, videoRuntimeUrl } from './runtime-services.mjs';
import { createPromptAssistant } from './prompt-assistant.mjs';
import { createBorrowedRuntimeServices } from './borrowed-runtime-services.mjs';
import { ensureFlashBrainConfiguration } from './flash-brain-configuration.mjs';
import { createArtLearning } from './art-learning.mjs';
import { createArtKnowledgeCache } from './art-knowledge-cache.mjs';
import { createArtTaskIdentity } from './art-task-identity.mjs';

export async function createLocalAssistant(options) {
  if (!options.modelsRoot) {
    try {
      const config = JSON.parse((await readFile(join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow/AI-Runtime/runtime.json'), 'utf8')).replace(/^\uFEFF/, ''));
      options = { ...options, modelsRoot: config.modelsPath || '' };
    } catch { /* Missing environments are reported by services.start(). */ }
  }
  const tasks = await createLocalTasks(options.dataDir);
  const license = options.license || createLocalLicense(options.licenseDataDir || join(process.env.APPDATA, 'NovaFlow'));
  const progress = options.onProgress || (() => {});
  const runtimeFactory = options.runtimePolicy === 'existing-only' ? createBorrowedRuntimeServices : createRuntimeServices;
  const services = options.services || runtimeFactory({ imageUrl: options.comfyImageUrl, videoUrl: options.comfyVideoUrl, logger: options.logger,
    stateFile: options.dataDir ? join(options.dataDir, 'owned-runtimes.json') : '' });
  let promptAssistant = null;
  const worker = createWorker({ ...options, localTasks: tasks, promptAssistant: () => promptAssistant });
  const artActor = createArtTaskIdentity({identifyUser:token=>worker.identifyArtUser(token),
    fallbackOwner:()=>worker.getState().boundAccount?.id||`local-device:${worker.identity.workerId}`,
    onSession:()=>{if(options.artKnowledge?.enabled===true)void knowledgeCache.sync();}});
  const knowledgeCache = createArtKnowledgeCache({directory:join(options.dataDir,'art-knowledge-cache'),
    fetchPacket:scope=>worker.readArtKnowledge({...scope,sessionToken:artActor.session()?.token})});
  const artLearning = createArtLearning({ directory: join(options.dataDir, 'art-learning'),
    getOwner: artActor.owner,
    getKnowledge:scope=>knowledgeCache.read(scope)});
  const requestedBackend = String(options.promptAssistant?.analysisBackend || process.env.NOVAFLOW_PROMPT_ASSISTANT_BACKEND || 'strata').trim().toLowerCase() || 'strata';
  const legacyDiagnostics = process.env.NOVAFLOW_LEGACY_PROMPT_ASSISTANT === '1' && requestedBackend !== 'strata';
  if (requestedBackend !== 'strata' && !legacyDiagnostics) {
    options.logger?.('ignored non-strata prompt assistant backend; production stays on Flash', { requested: requestedBackend });
  }
  if (!legacyDiagnostics) {
    const prepared = await ensureFlashBrainConfiguration({
      ...(options.promptAssistant?.runtimeJsonPath || process.env.NOVAFLOW_RUNTIME_JSON ? {runtimeJsonPath:options.promptAssistant?.runtimeJsonPath || process.env.NOVAFLOW_RUNTIME_JSON} : {}),
      ...(options.promptAssistant?.strataConfigPath || process.env.NOVAFLOW_STRATA_CONFIG ? {configPath:options.promptAssistant?.strataConfigPath || process.env.NOVAFLOW_STRATA_CONFIG} : {})
    });
    if(!prepared.ok)options.logger?.('Flash local installation incomplete',{reason:prepared.reason});
  }
  // 提示词助手 shares the GPU with these runtimes, so it needs their addresses
  // to ask for the memory back before it loads its own model.
  const comfyUrls = [...new Set([options.comfyImageUrl || 'http://127.0.0.1:8188', videoRuntimeUrl(options.comfyVideoUrl, options.comfyImageUrl || 'http://127.0.0.1:8188')].map(url => String(url).replace(/\/+$/, '')))];
  promptAssistant = createPromptAssistant({
    worker, logger: options.logger, comfyUrls, artLearning,
    ...(options.promptAssistant || {})
  });
  // A runtime started on another port (its own was held by somebody else's ComfyUI): the worker
  // and 提示词助手 follow it. Video shares the image runtime unless it has one of its own.
  const followRuntimes = () => {
    const image = runtimes.find(r => r.kind === 'image')?.url;
    const ownVideo = runtimes.find(r => r.kind === 'video');
    const video = ownVideo ? ownVideo.url : image;
    if (!image && !video) return;
    worker.retargetComfy?.({ image, video });
    comfyUrls.splice(0, comfyUrls.length, ...new Set([image || comfyUrls[0], video || comfyUrls[comfyUrls.length - 1]]));
  };
  let server = null;
  let runtimes = [];
  let servicesRunning = false;
  // Both controls share a runtime, but never change each other's intent.
  let operations = Promise.resolve();
  const serial = action => {
    const next = operations.then(action);
    operations = next.catch(() => {});
    return next;
  };
  const snapshot = () => ({ ...worker.getState(), workbenchUrl: server?.origin || '', runtimes });
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(snapshot()); };
  const ensureServices = async () => {
    progress(20, '正在检查图像和视频运行环境');
    if (!servicesRunning) { runtimes = await services.start(message => progress(25, message)); servicesRunning = true; followRuntimes(); }
    progress(40, '运行环境已就绪');
  };
  const releaseUnused = async () => {
    const s = worker.getState();
    if (!s.localRunning && !s.sharing && !s.draining && !s.currentTaskId) {
      const hadServices = servicesRunning;
      await services.stop(); servicesRunning = false; runtimes = [];
      if (hadServices) await options.clearRunFiles?.();
    }
  };
  worker.onChange(() => {
    emit();
    // A stopped share may still be finishing its last task.
    serial(releaseUnused).catch(error => options.logger?.('runtime cleanup failed', { error: error.message }));
  });
  return {
    getState: snapshot,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start: () => serial(async () => {
      if (server) return snapshot();
      await license.assertAllowed();
      try {
        await ensureServices();
        await worker.startLocal({ onProgress: progress });
        progress(90, '正在启动本地网页服务');
        server = await startLocalServer({ worker, tasks, license, dataDir: options.dataDir, promptAssistant, artLearning, artActor, artKnowledgeEnabled: options.artKnowledge?.enabled === true, artKnowledgeUrl: options.artKnowledge?.baseUrl || options.controlUrl,
          webRoot: options.webRoot, port: options.localPort ?? 4784, controlUrl: options.controlUrl });
        // Deliberately off until the new cloud service passes deployment gates.
        // Startup never waits for Supabase and every task reads local files only.
        if(options.artKnowledge?.enabled===true)knowledgeCache.start();
        emit();
        return snapshot();
      } catch (error) {
        await worker.stopLocal();
        await releaseUnused();
        throw error;
      }
    }),
    stopLocal: () => serial(async () => {
      knowledgeCache.stop();
      await worker.stopLocal();
      if (server) await server.close();
      server = null;
      await promptAssistant.stop();
      await releaseUnused();
      emit();
      return snapshot();
    }),
    startSharing: (settings = {}) => serial(async () => {
      if (!options.controlUrl) throw new Error('请先设置控制面地址');
      // Sharing uses the node registration, not the local editor license.
      try {
        await ensureServices();
        await worker.startSharing({ ...settings, onProgress: progress });
        emit();
        return snapshot();
      } catch (error) { await releaseUnused(); throw error; }
    }),
    stopSharing: () => serial(async () => {
      await worker.stopSharing();
      await releaseUnused();
      emit();
      return snapshot();
    }),
    stop: () => serial(async () => {
      knowledgeCache.stop();
      await worker.stop();
      if (server) await server.close();
      server = null;
      await promptAssistant.stop();
      await services.stop(); servicesRunning = false; runtimes = [];
      emit();
      return snapshot();
    }),
    get openUrl() { if (!server) throw new Error('请先启动本地服务'); return server.openUrl; },
    get license() { return license; },
    get tasks() { return tasks; },
    get worker() { return worker; },
    get promptAssistant() { return promptAssistant; }
  };
}
