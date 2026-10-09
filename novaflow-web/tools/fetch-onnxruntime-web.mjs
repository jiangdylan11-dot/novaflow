// Fetch ONNX Runtime Web for 视频抠图 in the browser (no compute node online).
//
// The WebGPU build is a 25 MB WebAssembly binary, so like ffmpeg's core it is
// downloaded here rather than committed, into renderer/vendor/onnxruntime-web
// (git-ignored). build-web-renderer.mjs calls this and only warns when it
// cannot reach the registry:
//
//   node tools/fetch-onnxruntime-web.mjs
//
// It is the npm package onnxruntime-web (MIT), taken from the registry as-is.
// Only the WebGPU entry and the WebAssembly build it loads are kept.

import { mkdir, writeFile, stat, readFile, rm, mkdtemp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ORT_WEB_VERSION = '1.29.0';
export const ORT_WEB_DIR = join(ROOT, 'renderer/vendor/onnxruntime-web');
const SOURCE = `https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-${ORT_WEB_VERSION}.tgz`;
const FILES = ['dist/ort.webgpu.min.mjs', 'dist/ort-wasm-simd-threaded.asyncify.mjs', 'dist/ort-wasm-simd-threaded.asyncify.wasm'];
const WASM = 'ort-wasm-simd-threaded.asyncify.wasm';
const MIN_WASM_BYTES = 20_000_000;
// The package carries its licence only in package.json ("MIT"); the shipped copy needs the text.
const LICENSE = `MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

export async function hasOnnxRuntimeWeb() {
  try {
    const wasm = await stat(join(ORT_WEB_DIR, WASM));
    const stamp = await readFile(join(ORT_WEB_DIR, 'VERSION'), 'utf8');
    return wasm.size > MIN_WASM_BYTES && stamp.trim() === ORT_WEB_VERSION;
  } catch {
    return false;
  }
}

export async function fetchOnnxRuntimeWeb({ force = false } = {}) {
  if (!force && await hasOnnxRuntimeWeb()) {
    const info = await stat(join(ORT_WEB_DIR, WASM));
    return { dir: ORT_WEB_DIR, bytes: info.size, downloaded: false };
  }
  const res = await fetch(SOURCE, { redirect: 'follow' });
  if (!res.ok) throw new Error('onnxruntime-web download failed: ' + res.status);
  const tarball = Buffer.from(await res.arrayBuffer());
  // Windows' own tar.exe, by full path: a `tar` from Git Bash reads C:\... as a remote host.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar';
  const work = await mkdtemp(join(tmpdir(), 'ort-web-'));
  try {
    const tgz = join(work, 'ort.tgz');
    await writeFile(tgz, tarball);
    execFileSync(tar, ['-xzf', tgz, '-C', work, 'package/package.json', ...FILES.map((f) => 'package/' + f)], { stdio: 'pipe' });
    await mkdir(ORT_WEB_DIR, { recursive: true });
    let bytes = 0;
    for (const file of FILES) {
      const data = await readFile(join(work, 'package', file));
      const name = file.split('/').pop();
      if (name === WASM && data.length < MIN_WASM_BYTES) throw new Error(WASM + ' looks truncated: ' + data.length + ' bytes');
      await writeFile(join(ORT_WEB_DIR, name), data);
      bytes += data.length;
    }
    const manifest = JSON.parse(await readFile(join(work, 'package/package.json'), 'utf8'));
    if (manifest.license !== 'MIT') throw new Error('onnxruntime-web licence changed: ' + manifest.license);
    await writeFile(join(ORT_WEB_DIR, 'LICENSE'), LICENSE);
    await writeFile(join(ORT_WEB_DIR, 'VERSION'), ORT_WEB_VERSION + '\n');
    return { dir: ORT_WEB_DIR, bytes, downloaded: true };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (String(process.argv[1] || '').endsWith('fetch-onnxruntime-web.mjs')) {
  const out = await fetchOnnxRuntimeWeb({ force: process.argv.includes('--force') });
  console.log((out.downloaded ? 'downloaded' : 'already present') + ': onnxruntime-web ' + ORT_WEB_VERSION +
    ', ' + (out.bytes / 1024 / 1024).toFixed(1) + ' MB in ' + out.dir);
}
