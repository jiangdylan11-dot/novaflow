// Headless worker entry point.
//
// The same core the Electron UI drives, runnable as a plain process for
// servers, CI and the E2E suite. Configuration comes from the environment or
// from worker.config.json next to the data directory.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker } from './worker-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_ROOT = resolve(HERE, '..');

export async function loadConfig(overrides = {}) {
  const dataDir = overrides.dataDir
    || process.env.NOVAFLOW_WORKER_DATA_DIR
    || join(WORKER_ROOT, 'data');

  let fileConfig = {};
  const configFile = overrides.configFile
    || process.env.NOVAFLOW_WORKER_CONFIG
    || join(dataDir, 'worker.config.json');
  try {
    fileConfig = JSON.parse(await readFile(configFile, 'utf8'));
  } catch { /* first run, or configured entirely from the environment */ }

  return {
    controlUrl: (overrides.controlUrl || process.env.NOVAFLOW_WEB_CONTROL_URL || fileConfig.controlUrl || '').replace(/\/+$/, ''),
    workerName: overrides.workerName || process.env.NOVAFLOW_WORKER_NAME || fileConfig.workerName || 'novaflow-worker',
    registrationCode: overrides.registrationCode || process.env.NOVAFLOW_WORKER_REGISTRATION_CODE || fileConfig.registrationCode || '',
    ownerSessionToken: overrides.ownerSessionToken || process.env.NOVAFLOW_OWNER_SESSION_TOKEN || '',
    comfyImageUrl: overrides.comfyImageUrl || process.env.NOVAFLOW_COMFY_IMAGE_URL || fileConfig.comfyImageUrl || 'http://127.0.0.1:8188',
    comfyVideoUrl: overrides.comfyVideoUrl || process.env.NOVAFLOW_COMFY_VIDEO_URL || fileConfig.comfyVideoUrl || 'http://127.0.0.1:8189',
    modelsRoot: overrides.modelsRoot || process.env.NOVAFLOW_MODELS_ROOT || fileConfig.modelsRoot || '',
    gatewayPort: Number(overrides.gatewayPort || process.env.NOVAFLOW_GATEWAY_PORT || fileConfig.gatewayPort || 8790),
    gatewayHost: overrides.gatewayHost || process.env.NOVAFLOW_GATEWAY_HOST || fileConfig.gatewayHost || '0.0.0.0',
    publicEndpoint: overrides.publicEndpoint || process.env.NOVAFLOW_PUBLIC_ENDPOINT || fileConfig.publicEndpoint || '',
    dataDir,
    workflowDir: overrides.workflowDir || join(WORKER_ROOT, 'workflows'),
    configPath: overrides.configPath || join(dataDir, 'identity.json'),
    pollIntervalMs: Number(overrides.pollIntervalMs || fileConfig.pollIntervalMs || 2000)
  };
}

export async function startHeadlessWorker(overrides = {}) {
  const config = await loadConfig(overrides);
  if (!config.controlUrl) {
    throw new Error('NOVAFLOW_WEB_CONTROL_URL is required (the control plane the worker registers with)');
  }
  const worker = createWorker({ ...config, logger: overrides.logger });
  await worker.start();
  return worker;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === new URL('file://' + process.argv[1].replace(/\\/g, '/')).href;

if (invokedDirectly) {
  startHeadlessWorker()
    .then((worker) => {
      const s = worker.getState();
      console.log('NovaFlow Compute Node online');
      console.log('  worker id : ' + s.workerId);
      console.log('  gpu       : ' + (s.gpu?.name || 'not detected') + ' ' + (s.gpu?.vramMb || 0) + 'MB');
      console.log('  gateway   : ' + s.endpointUrl);
      console.log('  models    : ' + s.models.map((m) => m.model_id + '=' + m.status).join(', '));
      const shutdown = async () => { await worker.stop(); process.exit(0); };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((error) => {
      console.error('worker failed to start:', error?.message || error);
      process.exit(1);
    });
}
