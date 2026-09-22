import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertLocalOnly } from './comfy/comfy-client.mjs';
const exec = promisify(execFile);

export function createRuntimeServices({ imageUrl = 'http://127.0.0.1:8188', videoUrl = 'http://127.0.0.1:8189', logger = () => {} } = {}) {
  const entries = [
    { kind: 'image', url: assertLocalOnly(imageUrl), root: join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow', 'AI-Runtime') },
    { kind: 'video', url: assertLocalOnly(videoUrl), root: join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow', 'AI-Runtime-H3') }
  ];
  const owned = new Set();
  async function up(url) {
    try { return (await fetch(url + '/system_stats', { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; }
  }
  async function script(entry, name) {
    const file = join(entry.root, 'scripts', name + '-runtime.bat');
    await access(file);
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& $env:NOVAFLOW_ASSISTANT_RUNTIME_SCRIPT; exit $LASTEXITCODE'], {
      env: { ...process.env, NOVAFLOW_ASSISTANT_RUNTIME_SCRIPT: file }, windowsHide: true, timeout: 150000, maxBuffer: 1024 * 1024
    });
  }
  return {
    async start() {
      const results = await Promise.all(entries.map(async entry => {
        if (await up(entry.url)) return { kind: entry.kind, running: true, reused: true };
        try {
          const config = JSON.parse((await readFile(join(entry.root, 'runtime.json'), 'utf8')).replace(/^\uFEFF/, ''));
          if (Number(config.port) !== Number(new URL(entry.url).port)) throw new Error('运行环境端口与设置不一致');
          await script(entry, 'start');
          owned.add(entry);
          const deadline = Date.now() + 120000;
          while (Date.now() < deadline) {
            if (await up(entry.url)) return { kind: entry.kind, running: true, reused: false };
            await new Promise(r => setTimeout(r, 1000));
          }
          throw new Error('运行环境启动超时');
        } catch (error) {
          const message = entry.kind + '：' + String(error.message || error);
          logger(message);
          return { kind: entry.kind, running: false, error: message };
        }
      }));
      if (!results.some(r => r.running)) throw new Error(results.map(r => r.error).join('\n'));
      return results;
    },
    async stop() {
      // A runtime already running before this assistant started belongs to
      // its original launcher. Never kill a desktop session we merely reused.
      for (const entry of owned) { await script(entry, 'stop'); owned.delete(entry); }
    }
  };
}
