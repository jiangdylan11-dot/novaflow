'use strict';

const fs = require('node:fs');
const path = require('node:path');
const QWEN_ROOT = 'E:\\NovaFlow\\models\\loras\\qwen';
const BASE_MODELS = Object.freeze({
  edit: 'diffusion_models/qwen_image_edit_2511_bf16.safetensors',
  rapid: 'checkpoints/Qwen-Rapid-AIO-NSFW-v20.safetensors',
});
const widths = { BOOL: 1, U8: 1, I8: 1, F8_E4M3: 1, F8_E5M2: 1, F8_E4M3FN: 1, F16: 2, BF16: 2, I16: 2, U16: 2, F32: 4, I32: 4, U32: 4, F64: 8, I64: 8, U64: 8 };
const normalize = name => String(name).replace(/\\/g, '/').toLowerCase();
const inside = (root, file) => { const rel = path.relative(root, file); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); };
const managed = /lightning|turbo|(?:^|[\\/_-])(?:4|8)steps?/i;

function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const prefix = Buffer.alloc(8);
    if (fs.readSync(fd, prefix, 0, 8, 0) !== 8) throw new Error('invalid_safetensors');
    const length = Number(prefix.readBigUInt64LE());
    if (!Number.isSafeInteger(length) || length < 2 || length > 16 * 1024 * 1024 || length + 8 > size) throw new Error('invalid_header');
    const data = Buffer.alloc(length);
    if (fs.readSync(fd, data, 0, length, 8) !== length) throw new Error('incomplete_header');
    const header = JSON.parse(data.toString('utf8'));
    const spans = [];
    for (const [key, tensor] of Object.entries(header)) {
      if (key === '__metadata__') continue;
      const shape = tensor?.shape, offsets = tensor?.data_offsets;
      if (!Array.isArray(shape) || !shape.every(n => Number.isSafeInteger(n) && n >= 0) || !Array.isArray(offsets) || offsets.length !== 2 || !offsets.every(Number.isSafeInteger)) throw new Error('invalid_tensor');
      const bytes = shape.reduce((a, b) => a * b, 1) * widths[tensor.dtype];
      if (!Number.isSafeInteger(bytes) || offsets[0] < 0 || offsets[1] - offsets[0] !== bytes || offsets[1] > size - length - 8) throw new Error('invalid_tensor_size');
      spans.push(offsets);
    }
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let end = 0;
    for (const span of spans) { if (span[0] !== end) throw new Error('invalid_tensor_offsets'); end = span[1]; }
    if (end !== size - length - 8) throw new Error('invalid_payload_size');
    return header;
  } finally { fs.closeSync(fd); }
}

// Mirrors the direct Qwen mappings in Runtime comfy/lora.py. Never trust model metadata labels.
function compatible(lora, base) {
  const weights = new Map(Object.entries(base).filter(([k]) => k.endsWith('.weight')).map(([k, v]) => [k.replace(/^(?:model\.)?diffusion_model\./, ''), v.shape]));
  let pairs = 0;
  const consumed = new Set(['__metadata__']);
  for (const [name, tensor] of Object.entries(lora)) {
    const match = name.match(/^(.*)\.(lora_A|lora_down)\.weight$/);
    if (!match) continue;
    const prefix = match[1];
    const other = `${prefix}.${match[2] === 'lora_A' ? 'lora_B' : 'lora_up'}.weight`;
    const up = lora[other]?.shape, down = tensor.shape;
    const canonical = prefix.replace(/^(diffusion_model|transformer)\./, '') + '.weight';
    const target = weights.get(canonical);
    if (!/^transformer_blocks\./.test(canonical) || !target || target.length !== 2 || down.length !== 2 || up?.length !== 2 || down[0] <= 0 || down[0] !== up[1] || down[1] !== target[1] || up[0] !== target[0]) return false;
    consumed.add(name); consumed.add(other);
    if (lora[`${prefix}.alpha`]) {
      if (lora[`${prefix}.alpha`].shape.reduce((a, b) => a * b, 1) !== 1) return false;
      consumed.add(`${prefix}.alpha`);
    }
    pairs++;
  }
  return pairs > 0 && Object.keys(lora).every(k => consumed.has(k));
}

function createQwenLoraCatalog(options = {}) {
  const root = path.resolve(options.root || QWEN_ROOT);
  const models = path.resolve(root, '../..');
  const cache = new Map();
  function header(file) {
    const stat = fs.statSync(file);
    const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (cache.get(file)?.stamp === stamp) return cache.get(file).data;
    const data = readHeader(file);
    cache.set(file, { stamp, data });
    return data;
  }
  async function catalog({ nsfw = false } = {}) {
    if (!fs.existsSync(root)) return [];
    // Reject a junction replacing the requested directory, and links escaping it.
    const realRoot = fs.realpathSync(root);
    if (normalize(realRoot) !== normalize(root)) throw new Error('Qwen LoRA 目录不能指向其他目录');
    const base = header(path.join(models, BASE_MODELS[nsfw ? 'rapid' : 'edit']));
    const info = await options.listRuntimeLoraNames();
    const field = info?.LoraLoaderModelOnly?.input?.required?.lora_name;
    const names = Array.isArray(field?.[0]) ? field[0] : field?.[1]?.options;
    if (!Array.isArray(names)) throw new Error('Runtime 未返回 LoRA 列表');
    const items = [], seen = new Set();
    for (const name of names) {
      if (typeof name !== 'string' || !/^qwen[\\/]/i.test(name) || !/\.safetensors$/i.test(name) || managed.test(name)) continue;
      const relative = name.split(/[\\/]/).slice(1);
      if (relative.some(part => !part || part === '.' || part === '..' || part.includes(':'))) continue;
      const file = path.resolve(root, ...relative);
      try {
        if (!inside(realRoot, fs.realpathSync(file)) || !fs.statSync(file).isFile() || !compatible(header(file), base)) continue;
        if (!seen.has(normalize(name))) items.push({ name });
        seen.add(normalize(name));
      } catch { /* Missing, partial, corrupt, and unsupported files are not selectable. */ }
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }
  return Object.freeze({ catalog });
}

module.exports = { createQwenLoraCatalog, compatible, readHeader, QWEN_ROOT, BASE_MODELS };
