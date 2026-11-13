// Fetch the body-joint model that 自动架设 runs in the page (renderer/spine-auto-pose.js).
//
// A character split by clothing, or kept as one picture, has both legs or both arms in one
// layer; the joints found on the whole picture are what the limbs are built from. The model
// is 56 MB, so like ONNX Runtime Web it is downloaded here rather than committed, into
// renderer/vendor/pose (git-ignored) under a neutral name; build-web-renderer.mjs calls this
// and only warns when it cannot reach the server (自动架设 then works as before, by layer shape).
//
//   node tools/fetch-pose-model.mjs
//
// It is RTMPose-m (26 body points, 256 × 192) from OpenMMLab's MMPose, Apache-2.0, as published.

import { mkdir, writeFile, stat, readFile, rm, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const POSE_MODEL_DIR = join(ROOT, 'renderer/vendor/pose');
const FILE = 'model.bin';
const SOURCE = 'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.zip';
const MEMBER = '20230831/rtmpose_onnx/rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605/end2end.onnx';
const SHA256 = '26f3a19e61304a600dfb82d1001d41d24343b89fc70a33ffc84657e0b0bf2ecf';
const LICENSE = `Body-joint model: RTMPose-m (body, 26 points), from MMPose by OpenMMLab
(https://github.com/open-mmlab/mmpose), used as published.

Copyright 2018-2023 OpenMMLab.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`;

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function hasPoseModel() {
  try {
    return digest(await readFile(join(POSE_MODEL_DIR, FILE))) === SHA256;
  } catch {
    return false;
  }
}

export async function fetchPoseModel({ force = false } = {}) {
  if (!force && await hasPoseModel()) {
    const info = await stat(join(POSE_MODEL_DIR, FILE));
    return { dir: POSE_MODEL_DIR, bytes: info.size, downloaded: false };
  }
  const res = await fetch(SOURCE, { redirect: 'follow' });
  if (!res.ok) throw new Error('pose model download failed: ' + res.status);
  const archive = Buffer.from(await res.arrayBuffer());
  // Windows' own tar.exe (bsdtar reads zip), by full path: a `tar` from Git Bash reads C:\... as a remote host.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'bsdtar';
  const work = await mkdtemp(join(tmpdir(), 'pose-model-'));
  try {
    const zip = join(work, 'model.zip');
    await writeFile(zip, archive);
    execFileSync(tar, ['-xf', zip, '-C', work, MEMBER], { stdio: 'pipe' });
    const data = await readFile(join(work, MEMBER));
    if (digest(data) !== SHA256) throw new Error('pose model does not match the pinned digest');
    await mkdir(POSE_MODEL_DIR, { recursive: true });
    await writeFile(join(POSE_MODEL_DIR, FILE), data);
    await writeFile(join(POSE_MODEL_DIR, 'LICENSE'), LICENSE);
    return { dir: POSE_MODEL_DIR, bytes: data.length, downloaded: true };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (String(process.argv[1] || '').endsWith('fetch-pose-model.mjs')) {
  const out = await fetchPoseModel({ force: process.argv.includes('--force') });
  console.log((out.downloaded ? 'downloaded' : 'already present') + ': pose model, ' +
    (out.bytes / 1024 / 1024).toFixed(1) + ' MB in ' + out.dir);
}
