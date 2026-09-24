// LoRAs on Qwen-Image-2.1: the node finds the ones that fit its 2.1 model (tensor names and shapes
// in the file headers, a GGUF model included), the drawing panel lists only those on the 2.1 route,
// and a run puts them between the 2.1 model loader and its cache. No GPU or ComfyUI is used.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { createWorkerLoraCatalog } from '../../worker/src/models/lora-catalog.mjs';
import { startLocalServer } from '../../worker/src/local-server.mjs';

const require = createRequire(import.meta.url);
const catalogLib = require('../../../particle-editor-desktop/main/qwen-lora-catalog.js');
let checks = 0;
const check = (fn) => { fn(); checks += 1; };

// A GGUF v3 file with only a tensor table (and one metadata value to skip), dims in GGUF order.
function gguf(tensors) {
  const parts = [];
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); parts.push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); parts.push(b); };
  parts.push(Buffer.from('GGUF', 'latin1'));
  u32(3); u64(tensors.length); u64(2);
  str('general.architecture'); u32(8); str('qwen_image21');
  str('general.tags'); u32(9); u32(8); u64(2); str('a'); str('b');
  for (const [name, shape] of tensors) {
    str(name); u32(shape.length);
    [...shape].reverse().forEach((d) => u64(d));
    u32(8); u64(0);
  }
  return Buffer.concat(parts);
}

// A valid safetensors file (zeroed F16 data) with the given tensor shapes.
function safetensors(tensors) {
  const header = {};
  let offset = 0;
  for (const [name, shape] of Object.entries(tensors)) {
    const bytes = shape.reduce((a, b) => a * b, 1) * 2;
    header[name] = { dtype: 'F16', shape, data_offsets: [offset, offset + bytes] };
    offset += bytes;
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([len, json, Buffer.alloc(offset)]);
}

const WIDTH = 64;
const q21Tensors = [];
for (let b = 0; b < 2; b += 1) {
  for (const m of ['to_q', 'to_k', 'to_v', 'to_out.0']) q21Tensors.push([`transformer_blocks.${b}.attn.${m}.weight`, [WIDTH, WIDTH]]);
  q21Tensors.push([`transformer_blocks.${b}.img_mlp.gate_layer.weight`, [WIDTH * 3, WIDTH]]);
}
q21Tensors.push(['img_in.weight', [WIDTH, 16]], ['norm_out.norm.weight', [WIDTH]]);
// The older 20B layout: a different width, and modules 2.1 does not have.
const oldTensors = [];
for (let b = 0; b < 2; b += 1) {
  for (const m of ['to_q', 'to_k', 'to_v', 'add_q_proj']) oldTensors.push([`transformer_blocks.${b}.attn.${m}.weight`, [48, 48]]);
}
const lora = (tensors, style = 'diffusers', rank = 2) => {
  const out = {};
  for (const [name, [o, i]] of tensors.filter(([n]) => /attn\.to_[qkv]\.weight$/.test(n))) {
    const mod = name.slice(0, -'.weight'.length);
    if (style === 'kohya') {
      const p = 'lora_unet_' + mod.replace(/\./g, '_');
      out[p + '.lora_down.weight'] = [rank, i]; out[p + '.lora_up.weight'] = [o, rank]; out[p + '.alpha'] = [];
    } else {
      const p = (style === 'diffusers' ? 'transformer.' : 'diffusion_model.') + mod;
      out[p + '.lora_A.weight'] = [rank, i]; out[p + '.lora_B.weight'] = [o, rank];
    }
  }
  return out;
};

const root = await mkdtemp(join(tmpdir(), 'nf-lora21-'));
try {
  const models = join(root, 'models');
  await mkdir(join(models, 'diffusion_models'), { recursive: true });
  await mkdir(join(models, 'checkpoints'), { recursive: true });
  await mkdir(join(models, 'loras', 'qwen'), { recursive: true });
  await writeFile(join(models, 'diffusion_models', 'qwen-image-2.1-test-Q8_0.gguf'), gguf(q21Tensors));
  const oldBase = Object.fromEntries(oldTensors.map(([n, s]) => [n, s]));
  await writeFile(join(models, 'diffusion_models', 'qwen_image_edit_2511_fp8mixed.safetensors'), safetensors(oldBase));
  await writeFile(join(models, 'checkpoints', 'Qwen-Rapid-AIO-NSFW-v20.safetensors'), safetensors(Object.fromEntries(oldTensors.map(([n, s]) => ['model.diffusion_model.' + n, s]))));
  const files = {
    'for21.safetensors': lora(q21Tensors),
    'for21_comfy.safetensors': lora(q21Tensors, 'comfy'),
    'for21_kohya.safetensors': lora(q21Tensors, 'kohya'),
    'for2511.safetensors': lora(oldTensors),
    'for2511_kohya.safetensors': lora(oldTensors, 'kohya'),
  };
  for (const [name, tensors] of Object.entries(files)) await writeFile(join(models, 'loras', 'qwen', name), safetensors(tensors));
  // Right names, one pair of the wrong shape.
  const broken = lora(q21Tensors);
  broken[Object.keys(broken)[1]] = [WIDTH + 8, 2];
  await writeFile(join(models, 'loras', 'qwen', 'for21_broken.safetensors'), safetensors(broken));
  // Outside the blocks (img_in) is a target too.
  await writeFile(join(models, 'loras', 'qwen', 'for21_img_in.safetensors'), safetensors({
    ...lora(q21Tensors), 'transformer.img_in.lora_A.weight': [2, 16], 'transformer.img_in.lora_B.weight': [WIDTH, 2]
  }));
  // Two spellings of one weight: ComfyUI would silently keep only the later one.
  await writeFile(join(models, 'loras', 'qwen', 'for21_twice.safetensors'), safetensors({
    ...lora(q21Tensors), 'diffusion_model.transformer_blocks.0.attn.to_q.lora_A.weight': [2, WIDTH], 'diffusion_model.transformer_blocks.0.attn.to_q.lora_B.weight': [WIDTH, 2]
  }));
  // Text-encoder parts are not loaded by LoraLoaderModelOnly.
  await writeFile(join(models, 'loras', 'qwen', 'for21_te.safetensors'), safetensors({
    ...lora(q21Tensors), 'lora_te_text_model_encoder_layers_0_mlp_fc1.lora_down.weight': [2, 8], 'lora_te_text_model_encoder_layers_0_mlp_fc1.lora_up.weight': [8, 2]
  }));

  // The GGUF tensor table comes back in torch order.
  const header = catalogLib.readGgufHeader(join(models, 'diffusion_models', 'qwen-image-2.1-test-Q8_0.gguf'));
  check(() => assert.deepEqual(header['transformer_blocks.0.img_mlp.gate_layer.weight'].shape, [WIDTH * 3, WIDTH]));
  check(() => assert.equal(Object.keys(header).length, q21Tensors.length));
  check(() => assert.deepEqual(header['norm_out.norm.weight'].shape, [WIDTH]));
  check(() => assert.ok(catalogLib.QWEN21_MODEL.test('qwen-image-2.1-UC-Q8_0.gguf')));

  const names = [...Object.keys(files), 'for21_broken.safetensors', 'for21_img_in.safetensors', 'for21_twice.safetensors', 'for21_te.safetensors'].map((n) => 'qwen/' + n);
  const objectInfo = { LoraLoaderModelOnly: { input: { required: { lora_name: [names] } } } };
  const catalog = catalogLib.createQwenLoraCatalog({ root: join(models, 'loras', 'qwen'), listRuntimeLoraNames: async () => objectInfo });
  const listed = async (input) => (await catalog.catalog(input)).map((item) => item.name).sort();
  // Each list holds only the LoRAs that fit its model: 2.1 ones for 2.1 (in any of the naming
  // styles ComfyUI maps), 20B ones for 2511 and Rapid AIO; a file with one wrong shape in none.
  const for21 = await listed({ engine: 'qwen-2.1' });
  check(() => assert.deepEqual(for21, ['qwen/for21.safetensors', 'qwen/for21_comfy.safetensors', 'qwen/for21_img_in.safetensors', 'qwen/for21_kohya.safetensors']));
  const for2511 = await listed({});
  check(() => assert.deepEqual(for2511, ['qwen/for2511.safetensors', 'qwen/for2511_kohya.safetensors']));
  const forRapid = await listed({ nsfw: true });
  check(() => assert.deepEqual(forRapid, ['qwen/for2511.safetensors', 'qwen/for2511_kohya.safetensors']));

  // The worker reports a qwen21 list and checks a 2.1 graph's LoRAs against it.
  const workerCatalog = createWorkerLoraCatalog({
    modelsRoot: models,
    image: { requestJson: async () => objectInfo, isUp: async () => true },
    video: { requestJson: async () => ({}), isUp: async () => false }
  });
  const report = await workerCatalog.report('image');
  check(() => assert.deepEqual(report.qwen21.items.map((i) => i.name).sort(), for21));
  check(() => assert.deepEqual(report.qwen.items.map((i) => i.name).sort(), for2511));
  const graph21 = (loraName) => ({
    1: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'qwen-image-2.1-test-Q8_0.gguf' } },
    nf_art_lora_1: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: loraName, strength_model: 1 } }
  });
  await workerCatalog.validateGraph(graph21('qwen/for21.safetensors'));
  checks += 1;
  await assert.rejects(workerCatalog.validateGraph(graph21('qwen/for2511.safetensors')), /不兼容/);
  checks += 1;

  // A node without a 2.1 model reports why instead of an empty success.
  await rm(join(models, 'diffusion_models', 'qwen-image-2.1-test-Q8_0.gguf'));
  await assert.rejects(catalog.catalog({ engine: 'qwen-2.1' }), /没有 Qwen-Image-2.1 模型/);
  checks += 1;

  // The page: on the 2.1 route the list is asked for 2.1 LoRAs (txt2img too); a run puts them
  // between the GGUF loader and the 2.1 cache.
  const context = createContext({ console, globalThis: undefined });
  context.globalThis = context;
  runInContext(await readFile(new URL('../../renderer/art-generate-lora.js', import.meta.url), 'utf8'), context);
  const art = context.NovaFlowArtGenerateLora;
  context.electronAPI = { runtimeFeaturesSync: () => ({ qwenImage21: true }) };
  check(() => assert.equal(art.supports({ provider: 'local', mode: 'txt2img' }), true));
  check(() => assert.equal(art.qwen21Route({ provider: 'local', mode: 'img2img', nsfw: true }), false));
  context.electronAPI = { runtimeFeaturesSync: () => ({}) };
  check(() => assert.equal(art.supports({ provider: 'local', mode: 'txt2img' }), false));
  const drawGraph = () => ({
    1: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'qwen-image-2.1-UC-Q8_0.gguf' } },
    4: { class_type: 'QwenImage21Cache', inputs: { model: ['1', 0], device: 'auto', dtype: 'default' } },
    7: { class_type: 'KSampler', inputs: { model: ['4', 0] } }
  });
  // The worker has no page features: the graph itself says it is 2.1.
  check(() => assert.equal(art.isQwen21Graph(drawGraph()), true));
  // (The vm context has its own Object / Array, so the graph is compared as plain JSON.)
  const withLora = JSON.parse(JSON.stringify(art.apply(drawGraph(), { provider: 'local', mode: 'txt2img', loras: [{ name: 'qwen/for21.safetensors', strength: 0.8 }] })));
  check(() => assert.deepEqual(withLora.nf_art_lora_1.inputs, { model: ['1', 0], lora_name: 'qwen/for21.safetensors', strength_model: 0.8 }));
  check(() => assert.deepEqual(withLora['4'].inputs.model, ['nf_art_lora_1', 0]));
  check(() => assert.deepEqual(withLora['7'].inputs.model, ['4', 0]));
  // Animation: the local assistant answers the page's H3 LoRA check as the control plane does.
  const h3Item = { name: 'minimax_h3/motion.safetensors', fingerprint: 'f1', modelFamily: 'fl2va', kind: 'standard', supportedSteps: null, strengthRange: { min: 0, max: 2 } };
  const webRoot = join(root, 'web');
  await mkdir(webRoot, { recursive: true });
  await writeFile(join(webRoot, 'index.html'), '<html><head></head></html>');
  const seen = [];
  const local = await startLocalServer({
    worker: { identity: { workerId: 'w1' }, getState: () => ({ workerId: 'w1', comfy: {}, models: [] }), readLoraCatalog: async (kind, input) => { seen.push([kind, input]); return { ok: true, items: [h3Item] }; } },
    tasks: { has: () => false, get: () => null, list: () => [] }, license: {}, dataDir: join(root, 'data'), webRoot, port: 0
  });
  try {
    const secret = new URL(local.openUrl).hash.split('=')[1];
    const validate = async (body) => {
      const res = await fetch(local.origin + '/api/web/loras/h3/validate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-novaflow-local': secret }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    const good = await validate({ name: h3Item.name, fingerprint: 'f1', mode: 'fl2v', steps: 4, strength: 0.7 });
    check(() => assert.deepEqual([good.status, good.body.ok, good.body.item.name, good.body.strength], [200, true, h3Item.name, 0.7]));
    check(() => assert.deepEqual(seen.at(-1), ['h3', { mode: 'fl2v', steps: 4 }]));
    const changed = await validate({ name: h3Item.name, fingerprint: 'other', mode: 'fl2v', steps: 4, strength: 0.7 });
    check(() => assert.equal(changed.status, 400));
    const badMode = await validate({ name: h3Item.name, fingerprint: 'f1', mode: 'x', steps: 4, strength: 0.7 });
    check(() => assert.equal(badMode.status, 400));
  } finally {
    await local.close();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(checks + ' passed, 0 failed: LoRA validity (Qwen-Image-2.1 detection, listing, graph wiring; local H3 check)');
