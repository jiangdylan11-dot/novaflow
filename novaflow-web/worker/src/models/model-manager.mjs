// Model Manager (spec 22).
//
// On startup and on a timer the worker checks each manifest model against the
// local ComfyUI models folder, verifies what it can, and reports
// ready / missing / invalid / updating. The scheduler only sends work to a
// worker that says 'ready', so a half-installed model costs nobody a task.
//
// Hash verification is opt-in per file: a manifest entry with sha256:null is
// verified by presence and minimum size, and the report says exactly that
// rather than implying a hash was checked.

import { stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { MODEL_MANIFEST } from '../../../packages/shared/src/model-manifest.mjs';
import { WORKER_MODEL_STATUS } from '../../../packages/shared/src/protocol.mjs';

async function sha256File(path) {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Resolve a manifest file path against the models root, tolerating the
 * subfolder layouts ComfyUI installs vary on (e.g. a model directly in
 * diffusion_models/ vs nested one level deeper).
 */
async function locate(modelsRoot, relativePath) {
  const direct = join(modelsRoot, relativePath);
  try {
    const info = await stat(direct);
    if (info.isFile()) return { path: direct, size: info.size };
  } catch { /* fall through to a shallow search */ }

  const [folder, ...rest] = relativePath.split('/');
  const filename = rest.join('/') || folder;
  const base = join(modelsRoot, folder);
  let entries = [];
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === filename) {
      const p = join(base, entry.name);
      const info = await stat(p);
      return { path: p, size: info.size };
    }
    if (entry.isDirectory()) {
      const p = join(base, entry.name, filename);
      try {
        const info = await stat(p);
        if (info.isFile()) return { path: p, size: info.size };
      } catch { /* keep looking */ }
    }
  }
  return null;
}

export async function inspectModel(modelsRoot, model, { verifyHashes = false } = {}) {
  const files = [];
  let status = WORKER_MODEL_STATUS.READY;

  for (const required of model.required_files) {
    const found = await locate(modelsRoot, required.path);
    if (!found) {
      files.push({ path: required.path, present: false, verified: 'missing' });
      status = WORKER_MODEL_STATUS.MISSING;
      continue;
    }
    if (required.min_bytes && found.size < required.min_bytes) {
      files.push({
        path: required.path, present: true, bytes: found.size,
        verified: 'too_small', expected_min_bytes: required.min_bytes
      });
      // A truncated file is worse than a missing one: it will load and fail.
      if (status !== WORKER_MODEL_STATUS.MISSING) status = WORKER_MODEL_STATUS.INVALID;
      continue;
    }
    if (verifyHashes && required.sha256) {
      const digest = await sha256File(found.path);
      if (digest !== required.sha256) {
        files.push({ path: required.path, present: true, bytes: found.size, verified: 'hash_mismatch' });
        status = WORKER_MODEL_STATUS.INVALID;
        continue;
      }
      files.push({ path: required.path, present: true, bytes: found.size, verified: 'sha256' });
      continue;
    }
    files.push({
      path: required.path,
      present: true,
      bytes: found.size,
      // Say plainly what was and was not checked.
      verified: required.sha256 ? 'size_only_hash_skipped' : 'size_only_no_hash_pinned'
    });
  }

  return {
    model_id: model.model_id,
    model_version: model.version,
    status,
    detail: {
      display_name: model.display_name,
      min_vram_mb: model.min_vram_mb,
      files,
      checked_at: new Date().toISOString()
    }
  };
}

export async function inspectAllModels(modelsRoot, { verifyHashes = false, manifest = MODEL_MANIFEST } = {}) {
  const out = [];
  for (const model of manifest) {
    try {
      out.push(await inspectModel(modelsRoot, model, { verifyHashes }));
    } catch (error) {
      out.push({
        model_id: model.model_id,
        model_version: model.version,
        status: WORKER_MODEL_STATUS.INVALID,
        detail: { error: String(error?.message || error) }
      });
    }
  }
  return out;
}

/**
 * Report models by asking the live ComfyUI what it can actually load, instead
 * of guessing from the filesystem. This is the more truthful signal when the
 * operator points the worker at an existing ComfyUI whose folder layout we do
 * not control, so it takes precedence when available.
 */
export async function inspectViaComfy(comfy, { manifest = MODEL_MANIFEST, timeoutMs = 5000 } = {}) {
  const known = new Set();
  for (const node of ['CheckpointLoaderSimple', 'UNETLoader', 'VAELoader', 'CLIPLoader']) {
    try {
      const res = await fetch(comfy.baseUrl + '/object_info/' + node, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) continue;
      const info = await res.json();
      const spec = Object.values(info)[0];
      for (const field of Object.values(spec?.input?.required || {})) {
        if (Array.isArray(field) && Array.isArray(field[0])) {
          for (const name of field[0]) known.add(String(name).replace(/\\/g, '/').toLowerCase());
        }
      }
    } catch { /* node type absent on this runtime */ }
  }
  if (!known.size) return null;

  return manifest.map((model) => {
    const files = model.required_files.map((f) => {
      const base = f.path.split('/').pop().toLowerCase();
      const present = [...known].some((k) => k.endsWith(base));
      return { path: f.path, present, verified: present ? 'comfy_can_load' : 'comfy_cannot_see' };
    });
    const allPresent = files.every((f) => f.present);
    return {
      model_id: model.model_id,
      model_version: model.version,
      status: allPresent ? WORKER_MODEL_STATUS.READY : WORKER_MODEL_STATUS.MISSING,
      detail: {
        display_name: model.display_name,
        min_vram_mb: model.min_vram_mb,
        source: 'comfy_object_info',
        files,
        checked_at: new Date().toISOString()
      }
    };
  });
}
