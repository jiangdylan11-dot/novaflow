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
  let starting = null;
  let stopping = null;
  let runtimes = [];
  return {
    getState: () => ({ ...worker.getState(), workbenchUrl: server?.origin || '', runtimes }),
    onChange: fn => worker.onChange(fn),
    async start() {
      if (stopping) await stopping;
      if (server) return this.getState();
      if (starting) return starting;
      starting = (async () => {
        runtimes = await services.start();
        await worker.startLocal();
        server = await startLocalServer({ worker, tasks, license, dataDir: options.dataDir,
          webRoot: options.webRoot, port: options.localPort ?? 4784, controlUrl: options.controlUrl });
        return this.getState();
      })().catch(async e => { await worker.stop(); await services.stop(); throw e; });
      try { return await starting; } finally { starting = null; }
    },
    async startSharing() {
      if (!server) throw new Error('请先启动本地服务');
      if (!options.controlUrl) throw new Error('请先设置控制面地址');
      await license.assertAllowed();
      return worker.startSharing();
    },
    stopSharing: () => worker.stopSharing(),
    async stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        if (starting) await starting.catch(() => {});
        await worker.stop();
        if (server) await server.close();
        server = null;
        await services.stop();
      })();
      try { await stopping; } finally { stopping = null; }
      return this.getState();
    },
    get openUrl() { if (!server) throw new Error('请先启动本地服务'); return server.openUrl; },
    get license() { return license; },
    get tasks() { return tasks; },
    get worker() { return worker; }
  };
}
