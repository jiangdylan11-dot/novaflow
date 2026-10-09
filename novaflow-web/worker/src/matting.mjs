// Execute Web video matting on the connected compute machine using the
// existing BiRefNet runner. The browser uploads its captured PNG snapshots;
// the helper validates frame packs and returns native-resolution alpha.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The runner that does the inference, in the desktop app it is shipped with. */
export function birefnetRunnerPath() {
  const candidates = [
    // Packaged: electron-builder copies it under desktop-license, keeping its
    // original main/ path, next to the other desktop modules the worker
    // already borrows (license-core, the LoRA catalogues).
    join(process.resourcesPath || '', 'desktop-license', 'main', 'birefnet-runner.py'),
    join(process.resourcesPath || '', 'desktop-license', 'birefnet-runner.py'),
    // From source.
    fileURLToPath(new URL('../../../particle-editor-desktop/main/birefnet-runner.py', import.meta.url))
  ];
  for (const path of candidates) {
    if (path && existsSync(path)) return path;
  }
  return '';
}

export function mattingRunnerPath() {
  const packaged = join(process.resourcesPath || '', 'matting', 'matting-runner.py');
  return existsSync(packaged) ? packaged : join(HERE, 'matting', 'matting-runner.py');
}

const PYTHON_CANDIDATES = () => [
  { exe: join(process.env.APPDATA || '', 'NovaFlow', 'birefnet-env', 'venv', 'Scripts', 'python.exe'), source: 'desktop-birefnet-env' },
  { exe: join(process.env.NOVAFLOW_AI_RUNTIME_DIR || '', 'engine', 'python', 'python.exe'), source: 'ai-runtime-env' },
  { exe: join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow', 'AI-Runtime', 'engine', 'python', 'python.exe'), source: 'ai-runtime' },
  { exe: 'python', source: 'path' },
  { exe: 'py', args: ['-3'], source: 'path' }
];

const PROBE_DECODE = 'import PIL; print("ok")';
// Any transformers: on 5.x (the AI Runtime's) from_pretrained may not finish BiRefNet's remote
// code, and birefnet-runner.py then builds the model from the local BiRefNet_lite folder - which
// is also what makes birefnet-matting ready at all (model-manifest), so it is always there.
const PROBE_INFERENCE = 'import torch, torchvision, PIL, transformers, safetensors; print("ok")';

async function probeInterpreter(candidate, code) {
  if (!candidate.exe) return false;
  if (candidate.exe.includes('\\') || candidate.exe.includes('/')) {
    if (!existsSync(candidate.exe)) return false;
  }
  const out = await runCapture(candidate.exe, [...(candidate.args || []), '-c', code]);
  return out.ok && out.stdout.includes('ok');
}

/** An interpreter that can validate PNG frames: Pillow. */
export async function pickDriverPython() {
  for (const candidate of PYTHON_CANDIDATES()) {
    if (await probeInterpreter(candidate, PROBE_DECODE)) {
      return { exe: candidate.exe, args: candidate.args || [], source: candidate.source };
    }
  }
  return null;
}

/** An interpreter that can run BiRefNet: torch, torchvision, Pillow, transformers and safetensors. */
export async function pickInferencePython() {
  for (const candidate of PYTHON_CANDIDATES()) {
    if (await probeInterpreter(candidate, PROBE_INFERENCE)) {
      return { exe: candidate.exe, args: candidate.args || [], source: candidate.source };
    }
  }
  return null;
}

function runCapture(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    const timeout = setTimeout(() => child.kill(), 30000);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', () => { /* import noise is not the answer we want */ });
    child.once('error', () => { clearTimeout(timeout); resolve({ ok: false, stdout: '' }); });
    child.once('close', (code) => { clearTimeout(timeout); resolve({ ok: code === 0, stdout }); });
  });
}

/**
 * Where the BiRefNet weights are. Video matting runs BiRefNet_lite (MIT): behind the page's chroma
 * matte it matched RMBG-2.0 on green-screen clips (0.03% alpha difference) at a third of the time,
 * and RMBG-2.0 (CC BY-NC) is no longer used. The folder is ZhengPeng7/BiRefNet_lite as published.
 */
export function resolveModel(modelsRoot) {
  const roots = [modelsRoot, process.env.NOVAFLOW_BIREFNET_MODEL_DIR || ''].filter(Boolean);
  for (const root of roots) {
    if (existsSync(join(root, 'config.json'))) return { modelId: root, localFilesOnly: true };
    for (const rel of [join('RMBG', 'BiRefNet_lite'), 'BiRefNet_lite']) {
      const dir = join(root, rel);
      if (existsSync(join(dir, 'config.json'))) return { modelId: dir, localFilesOnly: true };
    }
  }
  // Nothing local: BiRefNet fetches its own weights on first use, exactly as
  // it does on the desktop. Slow once, then cached.
  return { modelId: 'ZhengPeng7/BiRefNet_lite', localFilesOnly: false };
}

/**
 * Can this machine cut out at all? Answered before a job is accepted so the
 * user reads one true sentence instead of a Python traceback.
 */
export async function probeMatting(modelsRoot) {
  if (!birefnetRunnerPath()) return { ok: false, error: '算力节点缺少 birefnet-runner.py，请重新安装启动助手' };

  const driver = await pickDriverPython();
  if (!driver) return { ok: false, error: '算力节点上找不到带 Pillow 的 Python，无法读取视频帧' };

  const inference = await pickInferencePython();
  if (!inference) {
    return {
      ok: false,
      error: '算力节点上找不到可运行 BiRefNet 的 Python（需要 torch、torchvision、transformers）。' +
        '请在算力节点配置 BiRefNet 推理环境后重启启动助手'
    };
  }

  return {
    ok: true,
    driver: driver.source,
    inference: inference.source,
    model: resolveModel(modelsRoot).modelId
  };
}

/**
 * Run one matting job.
 *
 * Returns the output filenames written into `outDir`, which the caller reports
 * to the control plane. `mask-*.bin` is mandatory - the browser panel refuses
 * the result without it - and `cutout-*.webm` is produced when the composite
 * succeeds, letting 保存进资源列表 skip re-encoding in the browser.
 */
export async function runMatting({
  sourcePath,
  framePacks = [],
  workDir,
  outDir,
  parameters = {},
  modelsRoot = '',
  onProgress = () => {},
  isCancelled = () => false,
  log = () => {}
} = {}) {
  const runner = birefnetRunnerPath();
  if (!runner) throw new Error('算力节点缺少 birefnet-runner.py，请重新安装启动助手');

  const python = await pickDriverPython();
  if (!python) throw new Error('算力节点上找不到带 Pillow 的 Python，无法读取视频帧');

  const inference = await pickInferencePython();
  if (!inference) {
    throw new Error('算力节点上找不到可运行 BiRefNet 的 Python（需要 torch、torchvision、transformers）。' +
      '请在算力节点配置 BiRefNet 推理环境后重启启动助手');
  }

  await access(sourcePath);
  await mkdir(workDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const model = resolveModel(modelsRoot);
  const jobPath = join(workDir, 'matting-job.json');
  await writeFile(jobPath, JSON.stringify({
    source: sourcePath,
    frame_packs: framePacks,
    input_encoding: parameters.input_encoding,
    work_dir: workDir,
    out_dir: outDir,
    runner,
    // Inference may use a separate environment with compatible transformers.
    inference_python: inference.exe,
    inference_python_args: inference.args,
    model_id: model.modelId,
    local_files_only: model.localFilesOnly,
    width: Number(parameters.width) || 0,
    height: Number(parameters.height) || 0,
    fps: Number(parameters.fps) || 0,
    frame_count: Number(parameters.frame_count) || 0,
    frame_times_f32: String(parameters.frame_times_f32 || ''),
    return_mask_only: parameters.return_mask_only !== false
  }), 'utf8');

  const script = mattingRunnerPath();
  const result = await runPython(python, [script, '--job', jobPath], { onProgress, isCancelled, log });

  if (!result.ok) throw new Error(result.error || 'AI 抠图失败');
  const manifest = JSON.parse(await readFile(join(outDir, 'matting-result.json'), 'utf8'));
  return manifest.files || [];
}

function runPython(python, args, { onProgress, isCancelled, log }) {
  return new Promise((resolve, reject) => {
    const child = spawn(python.exe, [...python.args, '-W', 'ignore::FutureWarning', ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let settled = null;
    let stdout = '';
    let stderr = '';

    // Queue cancellation and stopping the assistant must stop GPU work too.
    const watch = setInterval(() => {
      if (!isCancelled()) return;
      clearInterval(watch);
      // On Windows killing only the driver leaves its inference process on
      // the GPU. Terminate this job's process tree, never all Python workers.
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else { try { child.kill(); } catch (_) { /* already gone */ } }
    }, 1000);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      // The runner speaks one JSON object per line, the same convention
      // birefnet-runner.py already uses for its own events.
      let newline;
      while ((newline = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch (_) { log('matting stdout', { line }); continue; }
        if (event.event === 'progress') onProgress(clampPercent(event.percent), String(event.note || 'AI 抠图中…'));
        else if (event.event === 'result') settled = event;
        else log('matting', event);
      }
    });

    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-4096); });
    child.once('error', (error) => { clearInterval(watch); reject(error); });

    child.once('close', (code, signal) => {
      clearInterval(watch);
      if (isCancelled()) return reject(new Error('任务已取消'));
      if (settled) return resolve(settled);
      if (code === 0) return resolve({ ok: true });
      reject(new Error('AI 抠图进程退出码 ' + (signal || code) + (stderr ? '：' + stderr.slice(-520) : '')));
    });
  });
}

function clampPercent(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 10;
  return Math.min(99, Math.max(8, n));
}
