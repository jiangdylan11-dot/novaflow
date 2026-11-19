// UI 拆图 on a compute node: confirmed boxes in, complete layers out.
//
// Recognition has already produced the confirmed regions. The Python worker uses the local image
// service for transparent atlases and background reconstruction, independently of the brain service.
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const UI_LAYER_SPLIT_CAPABILITY = 'foart-ui-layer-atlas-v1';
export const UI_LAYER_SPLIT_SCOPE = 'layer-split-v1';
const CLI_MODULE = 'prompt_assistant.ui_layer_split_cli';
const size = path => { try { return statSync(path).size; } catch { return -1; } };

/** What the split needs on disk. Nothing is loaded; a missing piece is named so the report can say why. */
export function uiLayerSplitFiles({ python, serviceScript, runtimeJson }) {
  let runtime = {};
  try { runtime = JSON.parse(readFileSync(runtimeJson, 'utf8').replace(/^﻿/, '')); } catch { return { ok: false, missing: 'runtime' }; }
  const models = String(runtime.modelsPath || (runtime.assetsPath ? join(runtime.assetsPath, 'models') : ''));
  const scripts = dirname(String(serviceScript || ''));
  const needs = [
    ['python', size(python) > 0],
    ['split-script', size(join(scripts, 'prompt_assistant', 'ui_layer_split.py')) > 0 && size(join(scripts, 'prompt_assistant', 'ui_layer_split_cli.py')) > 0],
    ['atlas-script', size(join(scripts, 'prompt_assistant', 'ui_split_atlas.py')) > 0],
    ['atlas-workflow', size(join(scripts, 'prompt_assistant', 'ui_split_qwen21.json')) > 0],
    ['image-model', ['diffusion_models', 'unet'].some(dir => models && size(join(models, dir, 'Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors')) > 1024 ** 3)],
    ['image-encoder', ['text_encoders', 'clip'].some(dir => models && size(join(models, dir, 'qwen3vl_8b_bf16_heretic.safetensors')) > 1024 ** 3)],
    ['image-vae', models && size(join(models, 'vae', 'qwen_image_2.1_vae_bf16.safetensors')) > 1024 ** 2]
  ];
  const missing = needs.find(([, present]) => !present);
  return missing ? { ok: false, missing: missing[0] } : { ok: true };
}

/** Runs one split. Resolves with the service-shaped answer: { ok, data } or { ok:false, error, errorCode }. */
export async function runUiLayerSplit({ python, serviceScript, runtimeJson, payload, isCancelled = () => false, onProgress = () => {}, timeoutMs = 15 * 60 * 1000, spawnProcess = spawn }) {
  const folder = await mkdtemp(join(tmpdir(), 'foart-ui-split-'));
  const result = join(folder, 'result.json');
  try {
    const exit = await new Promise((resolve, reject) => {
      const child = spawnProcess(python, ['-B', '-m', CLI_MODULE], { cwd: dirname(serviceScript), windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
      let tail = '', pending = '', ended = false;
      const stop = reason => { if (ended) return; ended = true; clearTimeout(timer); clearInterval(watch); try { child.kill(); } catch { /* gone */ } reject(Object.assign(new Error(reason.message), { code: reason.code })); };
      const timer = setTimeout(() => stop({ message: '拆图超时，本次没有结果', code: 'ui-layer-split-timeout' }), timeoutMs);
      const watch = setInterval(() => { if (isCancelled()) stop({ message: '拆图已取消', code: 'ui-layer-split-cancelled' }); }, 500);
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => {
        tail = (tail + chunk).slice(-2000); pending += chunk;
        const lines = pending.split(/\r?\n/); pending = lines.pop();
        for (const line of lines) if (line.startsWith('progress ')) { try { onProgress(line.slice(9).trim()); } catch { /* listener */ } }
      });
      child.once('error', error => stop({ message: '拆图进程无法启动：' + error.message, code: 'ui-layer-split-failed' }));
      child.once('exit', code => { if (ended) return; ended = true; clearTimeout(timer); clearInterval(watch); resolve({ code, tail }); });
      child.stdin.on('error', () => { /* the exit handler reports it */ });
      child.stdin.end(JSON.stringify({ payload, runtimeJson, result }));
    });
    let answer = null;
    try { answer = JSON.parse(await readFile(result, 'utf8')); } catch { /* no answer file */ }
    if (answer?.ok === true && answer.data?.visualSchema === 'nf.ui.layers.v1' && Array.isArray(answer.data.layers)) return { ok: true, data: answer.data };
    const reason = answer?.ok === false && answer.error ? String(answer.error) : '拆图进程异常结束（' + exit.code + '）' + (exit.tail ? '：' + exit.tail.split(/\r?\n/).filter(Boolean).slice(-2).join(' | ').slice(-300) : '');
    return { ok: false, error: '拆图失败：' + reason, errorCode: 'ui-layer-split-failed' };
  } catch (error) {
    return { ok: false, error: String(error.message || error), errorCode: error.code || 'ui-layer-split-failed' };
  } finally { await rm(folder, { recursive: true, force: true }).catch(() => {}); }
}

