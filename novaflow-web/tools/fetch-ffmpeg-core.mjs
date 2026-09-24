// Fetch ffmpeg.wasm's core for 工具 → MP4 压缩 / 视频格式转换 in the browser.
//
// A 32 MB WebAssembly binary does not belong in git, so it is downloaded here
// instead and the renderer build picks it up from renderer/vendor/ffmpeg/core
// (the page then downloads it from the site on first use). Run this once on a
// fresh clone; build-web-renderer.mjs calls it too and only warns when it
// cannot reach the registry:
//
//   node tools/fetch-ffmpeg-core.mjs
//
// It is the npm package @ffmpeg/core, taken from the npm registry as-is. The
// wrapper (renderer/vendor/ffmpeg/*.js, @ffmpeg/ffmpeg) is small and MIT, so
// that one is in git.

import { mkdir, writeFile, stat, readFile, rm, mkdtemp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FFMPEG_CORE_VERSION = '0.12.10';
export const FFMPEG_CORE_DIR = join(ROOT, 'renderer/vendor/ffmpeg/core');
const SOURCE = `https://registry.npmjs.org/@ffmpeg/core/-/core-${FFMPEG_CORE_VERSION}.tgz`;
const FILES = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];
const MIN_WASM_BYTES = 20_000_000;

export async function hasFfmpegCore() {
  try {
    const wasm = await stat(join(FFMPEG_CORE_DIR, 'ffmpeg-core.wasm'));
    await stat(join(FFMPEG_CORE_DIR, 'ffmpeg-core.js'));
    return wasm.size > MIN_WASM_BYTES;
  } catch {
    return false;
  }
}

export async function fetchFfmpegCore({ force = false } = {}) {
  if (!force && await hasFfmpegCore()) {
    const info = await stat(join(FFMPEG_CORE_DIR, 'ffmpeg-core.wasm'));
    return { dir: FFMPEG_CORE_DIR, bytes: info.size, downloaded: false };
  }

  const res = await fetch(SOURCE, { redirect: 'follow' });
  if (!res.ok) throw new Error('@ffmpeg/core download failed: ' + res.status);
  const tarball = Buffer.from(await res.arrayBuffer());

  // Windows' own tar.exe, by full path: a `tar` from Git Bash reads C:\... as a remote host.
  const tar = process.platform === 'win32'
    ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe')
    : 'tar';
  const work = await mkdtemp(join(tmpdir(), 'ffmpeg-core-'));
  try {
    const tgz = join(work, 'core.tgz');
    await writeFile(tgz, tarball);
    execFileSync(tar, ['-xzf', tgz, '-C', work, ...FILES.map((f) => 'package/dist/esm/' + f)], { stdio: 'pipe' });
    await mkdir(FFMPEG_CORE_DIR, { recursive: true });
    let bytes = 0;
    for (const file of FILES) {
      const data = await readFile(join(work, 'package/dist/esm', file));
      if (file.endsWith('.wasm') && data.length < MIN_WASM_BYTES) throw new Error('ffmpeg-core.wasm looks truncated: ' + data.length + ' bytes');
      await writeFile(join(FFMPEG_CORE_DIR, file), data);
      bytes += data.length;
    }
    return { dir: FFMPEG_CORE_DIR, bytes, downloaded: true };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (String(process.argv[1] || '').endsWith('fetch-ffmpeg-core.mjs')) {
  const out = await fetchFfmpegCore({ force: process.argv.includes('--force') });
  console.log((out.downloaded ? 'downloaded' : 'already present') + ': @ffmpeg/core ' + FFMPEG_CORE_VERSION +
    ', ' + (out.bytes / 1024 / 1024).toFixed(1) + ' MB in ' + out.dir);
}
