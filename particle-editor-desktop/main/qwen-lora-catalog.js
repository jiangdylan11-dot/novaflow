'use strict';

const fs = require('node:fs');
const path = require('node:path');
const QWEN_ROOT = 'E:\\NovaFlow\\models\\loras\\qwen';
const BASE_MODELS = Object.freeze({
  edit: 'diffusion_models/qwen_image_edit_2511_bf16.safetensors',
  rapid: 'checkpoints/Qwen-Rapid-AIO-NSFW-v20.safetensors',
});
// Qwen-Image-2.1 is found by name (the node may carry a GGUF or a safetensors build); its LoRAs are
// checked against that file's own tensor names and shapes.
const QWEN21_MODEL = /^qwen[-_ ]?image[-_ ]?2\.1.*\.(?:gguf|safetensors)$/i;
const QWEN21_DIRS = ['diffusion_models', 'unet'];
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

// GGUF (v2/v3) tensor table in the safetensors header's shape: { name: { shape } }, dims reversed to
// torch order. Only the header is read; metadata values are skipped.
function readGgufHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    for (let span = 1 << 20; ; span *= 4) {
      const length = Math.min(size, span);
      const data = Buffer.alloc(length);
      fs.readSync(fd, data, 0, length, 0);
      try {
        return parseGguf(data);
      } catch (error) {
        if (error.message !== 'gguf_truncated' || length >= size || span >= 256 << 20) throw error;
      }
    }
  } finally { fs.closeSync(fd); }
}

function parseGguf(data) {
  let at = 0;
  const need = n => { if (at + n > data.length) throw new Error('gguf_truncated'); };
  const u32 = () => { need(4); const v = data.readUInt32LE(at); at += 4; return v; };
  const u64 = () => { need(8); const v = data.readBigUInt64LE(at); at += 8; if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid_gguf'); return Number(v); };
  const str = () => { const n = u64(); if (n > 1 << 20) throw new Error('invalid_gguf'); need(n); const v = data.toString('utf8', at, at + n); at += n; return v; };
  const fixed = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
  const skip = type => {
    if (fixed[type]) { need(fixed[type]); at += fixed[type]; return; }
    if (type === 8) { str(); return; }
    if (type === 9) { const inner = u32(); const count = u64(); for (let i = 0; i < count; i++) skip(inner); return; }
    throw new Error('invalid_gguf');
  };
  need(4);
  if (data.toString('latin1', 0, 4) !== 'GGUF') throw new Error('invalid_gguf');
  at = 4;
  const version = u32();
  if (version < 2 || version > 3) throw new Error('unsupported_gguf');
  const tensors = u64(), kvs = u64();
  if (tensors > 100000 || kvs > 100000) throw new Error('invalid_gguf');
  for (let i = 0; i < kvs; i++) { str(); skip(u32()); }
  const header = {};
  for (let i = 0; i < tensors; i++) {
    const name = str();
    const dims = u32();
    if (dims > 8) throw new Error('invalid_gguf');
    const shape = [];
    for (let d = 0; d < dims; d++) shape.push(u64());
    u32(); u64();
    header[name] = { shape: shape.reverse() };
  }
  return header;
}

// Mirrors the Qwen key map in Runtime comfy/lora.py: every 2-D weight B of the diffusion model is a
// target under B, diffusion_model.B, transformer.B, lora_unet_<B with _> and lycoris_<B with _>.
// Never trust model metadata labels: a LoRA fits only when every module lands on a target of exactly
// its shape (ComfyUI would reshape a same-sized delta onto the wrong layout without a word), no two
// modules hit one weight (the later one would silently replace the earlier), and nothing else is in
// the file. Modules are plain LoRA pairs or LoKr (ComfyUI's LoKrAdapter: delta = kron(w1, w2), each
// factor whole or as w_a @ w_b). Text-encoder keys, LoHa, DoRA scales and Tucker (lokr_t2) parts are
// left unconsumed, so a file with them is not listed.
const PAIR_SUFFIXES = Object.freeze([
  ['.lora_down.weight', '.lora_up.weight'],
  ['.lora_A.weight', '.lora_B.weight'],
  ['.lora_A.default.weight', '.lora_B.default.weight'],
  ['.lora_linear_layer.down.weight', '.lora_linear_layer.up.weight'],
  ['.lora.down.weight', '.lora.up.weight'],
  ['_lora.down.weight', '_lora.up.weight'],
  ['.lora_A', '.lora_B'],
]);
const LORA_DTYPES = new Set(['F16', 'BF16', 'F32']);
const LOKR_KEY = /\.(?:lokr_w1|lokr_w2|lokr_w1_a|lokr_w1_b|lokr_w2_a|lokr_w2_b|lokr_t2)$/;

function loraTargets(base) {
  const entries = Object.entries(base).filter(([k, v]) => k !== '__metadata__' && k.endsWith('.weight') && Array.isArray(v?.shape) && v.shape.length === 2);
  // A checkpoint carries the text encoder and VAE too; only its diffusion model takes these LoRAs.
  const checkpoint = entries.some(([k]) => k.startsWith('model.diffusion_model.'));
  const targets = new Map();
  for (const [key, value] of entries) {
    if (checkpoint && !key.startsWith('model.diffusion_model.')) continue;
    const name = key.replace(/^(?:model\.)?diffusion_model\./, '').slice(0, -'.weight'.length);
    const target = { name, shape: value.shape };
    const flat = name.replace(/\./g, '_');
    for (const alias of [name, 'diffusion_model.' + name, 'transformer.' + name, 'lora_unet_' + flat, 'lycoris_' + flat]) targets.set(alias, target);
  }
  return targets;
}

const is2d = tensor => Array.isArray(tensor?.shape) && tensor.shape.length === 2 && tensor.shape.every(n => n >= 1);
const loraDtype = tensor => !tensor.dtype || LORA_DTYPES.has(tensor.dtype);

// One Kronecker factor of a LoKr module: the whole matrix, or w_a @ w_b; never both (ComfyUI would
// drop the pair) and never half (it would fail).
function lokrFactor(lora, prefix, n) {
  const whole = lora[`${prefix}.lokr_w${n}`], a = lora[`${prefix}.lokr_w${n}_a`], b = lora[`${prefix}.lokr_w${n}_b`];
  if (whole) return !a && !b && is2d(whole) && loraDtype(whole) ? { shape: whole.shape, keys: [`${prefix}.lokr_w${n}`] } : null;
  if (!a || !b || !is2d(a) || !is2d(b) || a.shape[1] !== b.shape[0] || !loraDtype(a) || !loraDtype(b)) return null;
  return { shape: [a.shape[0], b.shape[1]], keys: [`${prefix}.lokr_w${n}_a`, `${prefix}.lokr_w${n}_b`] };
}

function compatible(lora, base) {
  const targets = loraTargets(base);
  const consumed = new Set(['__metadata__']);
  const hit = new Set();
  let modules = 0;
  const alphaOk = prefix => {
    const alpha = lora[prefix + '.alpha'];
    if (!alpha) return true;
    if (alpha.shape.reduce((a, b) => a * b, 1) !== 1) return false;
    consumed.add(prefix + '.alpha');
    return true;
  };
  for (const name of Object.keys(lora)) {
    if (consumed.has(name)) continue;
    const suffix = PAIR_SUFFIXES.find(([down]) => name.endsWith(down));
    if (suffix) {
      const prefix = name.slice(0, -suffix[0].length);
      const upName = prefix + suffix[1];
      const down = lora[name], up = lora[upName];
      const target = targets.get(prefix);
      if (!up || !target || hit.has(target.name)) return false;
      const [out, inner] = target.shape;
      if (down.shape?.length !== 2 || up.shape?.length !== 2 || down.shape[0] < 1 || down.shape[0] !== up.shape[1] || down.shape[1] !== inner || up.shape[0] !== out) return false;
      if (!loraDtype(down) || !loraDtype(up)) return false;
      hit.add(target.name);
      consumed.add(name); consumed.add(upName);
      if (!alphaOk(prefix)) return false;
      modules++;
      continue;
    }
    const lokr = name.match(LOKR_KEY);
    if (!lokr) continue;
    const prefix = name.slice(0, -lokr[0].length);
    const target = targets.get(prefix);
    if (!target || hit.has(target.name) || lora[prefix + '.lokr_t2'] || lora[prefix + '.dora_scale']) return false;
    const w1 = lokrFactor(lora, prefix, 1), w2 = lokrFactor(lora, prefix, 2);
    if (!w1 || !w2) return false;
    const [out, inner] = target.shape;
    if (w1.shape[0] * w2.shape[0] !== out || w1.shape[1] * w2.shape[1] !== inner) return false;
    hit.add(target.name);
    for (const key of [...w1.keys, ...w2.keys]) consumed.add(key);
    if (!alphaOk(prefix)) return false;
    modules++;
  }
  return modules > 0 && Object.keys(lora).every(k => consumed.has(k));
}

function createQwenLoraCatalog(options = {}) {
  const root = path.resolve(options.root || QWEN_ROOT);
  const models = path.resolve(root, '../..');
  const cache = new Map();
  function header(file) {
    const stat = fs.statSync(file);
    const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (cache.get(file)?.stamp === stamp) return cache.get(file).data;
    const data = /\.gguf$/i.test(file) ? readGgufHeader(file) : readHeader(file);
    cache.set(file, { stamp, data });
    return data;
  }
  function qwen21Model() {
    for (const dir of QWEN21_DIRS) {
      const folder = path.join(models, dir);
      if (!fs.existsSync(folder)) continue;
      const name = fs.readdirSync(folder).filter(file => QWEN21_MODEL.test(file)).sort()[0];
      if (name) return path.join(folder, name);
    }
    throw new Error('算力节点没有 Qwen-Image-2.1 模型，无法检查 2.1 LoRA');
  }
  // engine 'qwen-2.1' checks against the Qwen-Image-2.1 model; otherwise NSFW checks against Rapid
  // AIO and the rest against the 2511 edit model.
  async function catalog({ nsfw = false, engine = '' } = {}) {
    if (!fs.existsSync(root)) return [];
    // Reject a junction replacing the requested directory, and links escaping it.
    const realRoot = fs.realpathSync(root);
    if (normalize(realRoot) !== normalize(root)) throw new Error('Qwen LoRA 目录不能指向其他目录');
    const base = header(engine === 'qwen-2.1' ? qwen21Model() : path.join(models, BASE_MODELS[nsfw ? 'rapid' : 'edit']));
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

module.exports = { createQwenLoraCatalog, compatible, readHeader, readGgufHeader, QWEN_ROOT, BASE_MODELS, QWEN21_MODEL };
