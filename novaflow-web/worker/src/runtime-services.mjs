import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { assertLocalOnly } from './comfy/comfy-client.mjs';
// The batch file starts a long-lived Python process. execFile waits for its
// inherited output pipes to close, even after the launcher itself has exited.
// Runtime logs already go to files; wait for the launcher's exit, not Python.
export function runRuntimeLauncher(command, args, { env = process.env, timeoutMs = 150000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('运行环境启动脚本超时')); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('运行环境脚本退出码：' + code + '，请查看运行环境日志'));
    });
  });
}

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
    await runRuntimeLauncher('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& $env:NOVAFLOW_ASSISTANT_RUNTIME_SCRIPT; exit $LASTEXITCODE'], {
      env: { ...process.env, NOVAFLOW_ASSISTANT_RUNTIME_SCRIPT: file }
    });
  }
  return {
    async start(onProgress = () => {}) {
      const results = await Promise.all(entries.map(async entry => {
        if (await up(entry.url)) return { kind: entry.kind, running: true, reused: true };
        onProgress('正在启动' + (entry.kind === 'image' ? '图像' : '视频') + '运行环境，首次加载可能需要几分钟');
        try {
          const config = JSON.parse((await readFile(join(entry.root, 'runtime.json'), 'utf8')).replace(/^\uFEFF/, ''));
          if (Number(config.port) !== Number(new URL(entry.url).port)) throw new Error('运行环境端口与设置不一致');
          await script(entry, 'start');
          onProgress('正在等待' + (entry.kind === 'image' ? '图像' : '视频') + '服务就绪');
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
