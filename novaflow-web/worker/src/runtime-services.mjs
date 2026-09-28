import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
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

// Which process listens on a port, and since when. A ComfyUI restarted by anyone else, or a new
// process that happens to get the same id, differs in one of the two.
export function probeRuntimeListener(port) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$c=Get-NetTCPConnection -LocalPort $env:NOVAFLOW_ASSISTANT_PROBE_PORT -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;" +
      // Win32_Process reads the start time of an elevated or other user's process too, where
      // Get-Process cannot.
      " if($c){ $p=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c.OwningProcess) -ErrorAction SilentlyContinue; if($p -and $p.CreationDate){ '' + $p.ProcessId + ' ' + $p.CreationDate.ToFileTimeUtc() } }"], {
      env: { ...process.env, NOVAFLOW_ASSISTANT_PROBE_PORT: String(port) }, windowsHide: true, timeout: 20000
    }, (error, stdout) => {
      const match = /^(\d+)\s+(\d+)/.exec(String(stdout || '').trim());
      resolve(!error && match ? { pid: Number(match[1]), startedAt: match[2] } : null);
    });
  });
}

// MiniMax H3 moved from its own runtime (AI-Runtime-H3, ComfyUI 0.31.1, port 8189) onto the one
// AI-Runtime (ComfyUI 0.37, port 8188) on 2026-09-26: its 4 NovaFlow nodes and SageAttention were
// installed there and the same H3 graphs ran at the same speed. Configs written before that still say
// 8189 (electron/main.cjs wrote it as the default), so 8189 or nothing means the image runtime; any
// other address is still honoured for a node that deliberately runs video elsewhere.
export const LEGACY_VIDEO_PORT = 8189;

export function videoRuntimeUrl(configured, imageUrl = 'http://127.0.0.1:8188') {
  const url = String(configured || '').trim().replace(/\/+$/, '');
  if (!url) return imageUrl;
  try { if (Number(new URL(url).port) === LEGACY_VIDEO_PORT) return imageUrl; } catch { return imageUrl; }
  return url;
}

// A runtime this assistant starts is its own: it is stopped when the assistant stops. One that was
// already running is borrowed: the assistant never ends it, but hands its GPU memory back (models
// unloaded) when it stops. stateFile remembers which process the assistant started, so a runtime a
// previous run left behind (the assistant was killed, or crashed) is still recognised as its own.
export function createRuntimeServices({
  imageUrl = 'http://127.0.0.1:8188', videoUrl = '', logger = () => {}, stateFile = '',
  probeListener = probeRuntimeListener, runScript = null
} = {}) {
  const video = videoRuntimeUrl(videoUrl, imageUrl);
  const entries = [
    { kind: 'image', url: assertLocalOnly(imageUrl), root: join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow', 'AI-Runtime') }
  ];
  // Only a node that points video at a runtime of its own still has a second one to start.
  if (video !== imageUrl) entries.push({ kind: 'video', url: assertLocalOnly(video), root: join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow', 'AI-Runtime-H3') });
  const owned = new Set();
  const borrowed = new Set();
  const portOf = entry => new URL(entry.url).port;
  const keyOf = entry => entry.kind + ':' + portOf(entry);
  async function up(url) {
    try { return (await fetch(url + '/system_stats', { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; }
  }
  // The record of started runtimes: read and written one change at a time (image and video start
  // side by side).
  let stateChain = Promise.resolve();
  const readState = async () => {
    if (!stateFile) return {};
    try { return JSON.parse(await readFile(stateFile, 'utf8')) || {}; } catch { return {}; }
  };
  const changeState = change => {
    const next = stateChain.then(async () => {
      if (!stateFile) return;
      const state = await readState();
      if (!change(state)) return;
      await mkdir(dirname(stateFile), { recursive: true });
      await writeFile(stateFile, JSON.stringify(state, null, 2));
    }).catch(error => logger('runtime record failed: ' + String(error.message || error)));
    stateChain = next;
    return next;
  };
  async function remember(entry) {
    const who = await probeListener(portOf(entry));
    if (!who) { logger(entry.kind + ' runtime started, but its process could not be identified'); return; }
    await changeState(state => { state[keyOf(entry)] = who; return true; });
  }
  const forget = entry => changeState(state => {
    if (!(keyOf(entry) in state)) return false;
    delete state[keyOf(entry)];
    return true;
  });
  // The same process the last run started: same id, same start time.
  async function leftByUs(entry) {
    if (!stateFile) return false;
    await stateChain;
    const saved = (await readState())[keyOf(entry)];
    if (!saved) return false;
    const who = await probeListener(portOf(entry));
    if (who && who.pid === saved.pid && String(who.startedAt) === String(saved.startedAt)) return true;
    // Someone else's runtime on that port now: the record is stale.
    if (who) await forget(entry);
    return false;
  }
  async function releaseMemory(entry) {
    try {
      const res = await fetch(entry.url + '/free', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: AbortSignal.timeout(10000)
      });
      logger(entry.kind + ' borrowed runtime asked to unload its models' + (res.ok ? '' : ' (HTTP ' + res.status + ')'));
    } catch (error) { logger(entry.kind + ' borrowed runtime memory release failed: ' + String(error.message || error)); }
  }
  // One reset connection during accept makes asyncio on Windows close ComfyUI's listening socket.
  // The process lives on with the GPU and its log files, so a new one cannot even open its logs and
  // the start script's check (a listener) never sees it. Clear such a runtime before starting;
  // five minutes keeps one that is still booting for another launcher.
  async function reap(entry) {
    try {
      await runRuntimeLauncher('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "$main=$env:NOVAFLOW_ASSISTANT_RUNTIME_MAIN.ToLowerInvariant(); $port=$env:NOVAFLOW_ASSISTANT_RUNTIME_PORT;" +
        " $listening=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object OwningProcess);" +
        " Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $c=([string]$_.CommandLine).ToLowerInvariant().Replace('/','\\');" +
        " $c.Contains($main) -and $c -match ('--port\\s+' + $port + '(\\s|$)') -and $listening -notcontains $_.ProcessId -and $_.CreationDate -lt (Get-Date).AddMinutes(-5) }" +
        " | ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }; exit 0"], {
        env: { ...process.env, NOVAFLOW_ASSISTANT_RUNTIME_MAIN: join(entry.root, 'engine', 'ComfyUI', 'main.py'), NOVAFLOW_ASSISTANT_RUNTIME_PORT: portOf(entry) },
        timeoutMs: 30000
      });
    } catch (error) { logger(entry.kind + ' stale runtime check failed: ' + String(error.message || error)); }
  }
  async function script(entry, name) {
    if (runScript) return runScript(entry, name);
    const file = join(entry.root, 'scripts', name + '-runtime.bat');
    await access(file);
    await runRuntimeLauncher('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& $env:NOVAFLOW_ASSISTANT_RUNTIME_SCRIPT; exit $LASTEXITCODE'], {
      env: { ...process.env, NOVAFLOW_ASSISTANT_RUNTIME_SCRIPT: file }
    });
  }
  return {
    async start(onProgress = () => {}) {
      const results = await Promise.all(entries.map(async entry => {
        if (await up(entry.url)) {
          if (await leftByUs(entry)) {
            owned.add(entry);
            logger(entry.kind + ' runtime left running by the last assistant run: taken back as its own');
            return { kind: entry.kind, running: true, reused: false, adopted: true };
          }
          borrowed.add(entry);
          return { kind: entry.kind, running: true, reused: true };
        }
        onProgress('正在启动' + (entry.kind === 'image' ? '图像' : '视频') + '运行环境，首次加载可能需要几分钟');
        try {
          const config = JSON.parse((await readFile(join(entry.root, 'runtime.json'), 'utf8')).replace(/^\uFEFF/, ''));
          if (Number(config.port) !== Number(portOf(entry))) throw new Error('运行环境端口与设置不一致');
          await reap(entry);
          await script(entry, 'start');
          onProgress('正在等待' + (entry.kind === 'image' ? '图像' : '视频') + '服务就绪');
          owned.add(entry);
          const deadline = Date.now() + 120000;
          while (Date.now() < deadline) {
            if (await up(entry.url)) { await remember(entry); return { kind: entry.kind, running: true, reused: false }; }
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
      // Our own runtimes end; a borrowed one (a desktop session, another launcher) keeps running
      // but gives its GPU memory back.
      for (const entry of owned) { await script(entry, 'stop'); owned.delete(entry); await forget(entry); }
      for (const entry of borrowed) { borrowed.delete(entry); await releaseMemory(entry); }
    }
  };
}
