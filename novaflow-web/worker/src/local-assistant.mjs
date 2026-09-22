import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createWorker } from './worker-core.mjs';
import { createLocalTasks } from './local-tasks.mjs';
import { startLocalServer } from './local-server.mjs';
import { createLocalLicense } from './local-license.mjs';
import { createRuntimeServices } from './runtime-services.mjs';

export async function createLocalAssistant(options) {
  if (!options.modelsRoot) {
    try {
      const config = JSON.parse((await readFile(join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow/AI-Runtime/runtime.json'), 'utf8')).replace(/^\uFEFF/, ''));
      options = { ...options, modelsRoot: config.modelsPath || '' };
    } catch { /* Missing environments are reported by services.start(). */ }
  }
  const tasks = await createLocalTasks(options.dataDir);
  const license = options.license || createLocalLicense(options.licenseDataDir || join(process.env.APPDATA, 'NovaFlow'));
  const services = options.services || createRuntimeServices({ imageUrl: options.comfyImageUrl, videoUrl: options.comfyVideoUrl, logger: options.logger });
  const worker = createWorker({ ...options, localTasks: tasks });
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
    if (!servicesRunning) { runtimes = await services.start(); servicesRunning = true; }
  };
  const releaseUnused = async () => {
    const s = worker.getState();
    if (!s.localRunning && !s.sharing && !s.draining && !s.currentTaskId) {
      await services.stop(); servicesRunning = false; runtimes = [];
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
        await worker.startLocal();
        server = await startLocalServer({ worker, tasks, license, dataDir: options.dataDir,
          webRoot: options.webRoot, port: options.localPort ?? 4784, controlUrl: options.controlUrl });
        emit();
        return snapshot();
      } catch (error) {
        await worker.stopLocal();
        await releaseUnused();
        throw error;
      }
    }),
    stopLocal: () => serial(async () => {
      await worker.stopLocal();
      if (server) await server.close();
      server = null;
      await releaseUnused();
      emit();
      return snapshot();
    }),
    startSharing: (settings = {}) => serial(async () => {
      if (!options.controlUrl) throw new Error('请先设置控制面地址');
      // Sharing uses the node registration, not the local editor license.
      try {
        await ensureServices();
        await worker.startSharing(settings);
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
      await worker.stop();
      if (server) await server.close();
      server = null;
      await services.stop(); servicesRunning = false; runtimes = [];
      emit();
      return snapshot();
    }),
    get openUrl() { if (!server) throw new Error('请先启动本地服务'); return server.openUrl; },
    get license() { return license; },
    get tasks() { return tasks; },
    get worker() { return worker; }
  };
}
