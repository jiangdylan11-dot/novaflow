// CLI companion for the same assistant used by Electron; no development
// license, fabricated login or auto-sharing path exists here.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalAssistant } from './local-assistant.mjs';
const dataDir = process.env.NOVAFLOW_ASSISTANT_DATA_DIR || join(process.env.APPDATA, 'NovaFlow Worker', 'data');
await mkdir(dataDir, { recursive: true });
let config = {};
try { config = JSON.parse(await readFile(join(dataDir, 'worker.config.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const root = fileURLToPath(new URL('../../', import.meta.url));
const assistant = await createLocalAssistant({ ...config, dataDir, configPath: join(dataDir, 'identity.json'),
  workerName: config.workerName || 'novaflow-local', workflowDir: join(root, 'worker/workflows'),
  rendererDir: join(root, 'worker-renderer'), webRoot: join(root, 'web-dist'),
  localPort: Number(process.env.NOVAFLOW_ASSISTANT_PORT || config.localPort) || 4784,
  gatewayPort: Number(config.gatewayPort) || 8790,
  controlUrl: config.controlUrl || 'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web'
});
const state = await assistant.start();
// URL shortcut keeps the ephemeral pairing secret out of logs.
const shortcut = resolve(dataDir, '打开 NovaFlow.url');
await writeFile(shortcut, '[InternetShortcut]\r\nURL=' + assistant.openUrl + '\r\n');
console.log('本地工作台已启动：' + state.workbenchUrl + '（未分享）');
console.log('使用本机快捷方式连接：' + shortcut);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (stopping) return; stopping = true;
  await assistant.stop(); process.exit(0);
});
