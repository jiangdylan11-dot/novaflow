const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createQwenLoraCatalog, BASE_MODELS, compatible } = require('../main/qwen-lora-catalog');

function write(file, shapes, dtype = 'BF16') {
  let offset = 0;
  const header = { __metadata__: { ss_base_model_version: 'sd1.5' } };
  for (const [name, shape] of Object.entries(shapes)) {
    const bytes = shape.reduce((a, b) => a * b, 1) * (dtype === 'F8_E4M3' ? 1 : 2);
    header[name] = { dtype, shape, data_offsets: [offset, offset + bytes] }; offset += bytes;
  }
  const data = Buffer.from(JSON.stringify(header));
  const prefix = Buffer.alloc(8); prefix.writeBigUInt64LE(BigInt(data.length));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([prefix, data, Buffer.alloc(offset)]));
}

test('catalog enforces exact root, all tensor pairs, payload integrity and actual route base', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-qwen-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'models/loras/qwen');
  const baseKey = 'transformer_blocks.0.attn.add_k_proj';
  write(path.join(temp, 'models', BASE_MODELS.rapid), { [`model.diffusion_model.${baseKey}.weight`]: [4, 6], [`model.diffusion_model.${baseKey}.weight_scale`]: [] }, 'F8_E4M3');
  write(path.join(temp, 'models', BASE_MODELS.edit), { [`model.diffusion_model.${baseKey}.weight`]: [4, 6] }, 'BF16');
  const pair = (out = 4, prefix = 'diffusion_model', a = 'lora_A', b = 'lora_B') => ({ [`${prefix}.${baseKey}.${a}.weight`]: [2, 6], [`${prefix}.${baseKey}.${b}.weight`]: [out, 2] });
  write(path.join(root, 'valid.safetensors'), pair());
  write(path.join(root, 'sub/alternate.safetensors'), { ...pair(4, 'transformer', 'lora_down', 'lora_up'), [`transformer.${baseKey}.alpha`]: [] });
  write(path.join(root, 'rapid.safetensors'), pair(5));
  write(path.join(root, 'wrong.safetensors'), pair(7));
  write(path.join(root, 'partial.safetensors'), { ...pair(), 'unknown.weight': [2, 2] });
  write(path.join(root, 'broken.safetensors'), pair());
  fs.truncateSync(path.join(root, 'broken.safetensors'), 10);
  write(path.join(root, '../outside.safetensors'), pair());
  const names = ['qwen/valid.safetensors', 'qwen/sub/alternate.safetensors', 'qwen/rapid.safetensors', 'qwen/wrong.safetensors', 'qwen/partial.safetensors', 'qwen/broken.safetensors', 'qwen/../outside.safetensors', 'outside.safetensors', 'other/qwen/valid.safetensors'];
  const catalog = createQwenLoraCatalog({ root, listRuntimeLoraNames: async () => ({ LoraLoaderModelOnly: { input: { required: { lora_name: [names] } } } }) });
  assert.deepEqual((await catalog.catalog()).map(x => x.name).sort(), ['qwen/sub/alternate.safetensors', 'qwen/valid.safetensors']);
  assert.equal(BASE_MODELS.edit, 'diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors');
  assert.equal(BASE_MODELS.rapid, 'checkpoints/Qwen-Rapid-AIO-NSFW-v20.safetensors');
  assert.deepEqual((await catalog.catalog({ nsfw: true })).map(x => x.name).sort(), ['qwen/sub/alternate.safetensors', 'qwen/valid.safetensors']);
  // A changed file is re-read instead of trusting an earlier compatibility verdict.
  write(path.join(root, 'valid.safetensors'), pair(7));
  assert.equal((await catalog.catalog()).some(x => x.name === 'qwen/valid.safetensors'), false);
  fs.mkdirSync(path.join(root, 'escape'));
  fs.rmdirSync(path.join(root, 'escape'));
  fs.symlinkSync(path.join(root, '..'), path.join(root, 'escape'), 'junction');
  names.push('qwen/escape/outside.safetensors');
  assert.equal((await catalog.catalog()).some(x => x.name.includes('escape')), false);
});

test('LoKr modules count when kron(w1, w2) lands exactly on the weight, as ComfyUI applies them', () => {
  const base = {
    'transformer_blocks.0.attn.to_q.weight': { shape: [3072, 3072] },
    'transformer_blocks.0.attn.to_k.weight': { shape: [3072, 3072] },
    'transformer_blocks.0.img_mlp.net.2.weight': { shape: [3072, 12288] },
    'transformer_blocks.0.attn.norm_q.weight': { shape: [128] },
  };
  const t = (shape, dtype = 'BF16') => ({ shape, dtype });
  const q = 'lycoris_transformer_blocks_0_attn_to_q';
  const mlp = 'lycoris_transformer_blocks_0_img_mlp_net_2';
  const whole = { [`${q}.lokr_w1`]: t([6, 6]), [`${q}.lokr_w2`]: t([512, 512]), [`${q}.alpha`]: t([]) };
  // Whole factors with alpha, as the ai-toolkit export on disk.
  assert.equal(compatible({ ...whole, [`${mlp}.lokr_w1`]: t([6, 6]), [`${mlp}.lokr_w2`]: t([512, 2048]) }, base), true);
  // A factor as w_a @ w_b.
  assert.equal(compatible({ [`${q}.lokr_w1`]: t([6, 6]), [`${q}.lokr_w2_a`]: t([512, 8]), [`${q}.lokr_w2_b`]: t([8, 512]) }, base), true);
  // A LoKr module and a LoRA pair on different weights.
  assert.equal(compatible({ ...whole, 'transformer.transformer_blocks.0.attn.to_k.lora_A.weight': t([2, 3072]), 'transformer.transformer_blocks.0.attn.to_k.lora_B.weight': t([3072, 2]) }, base), true);
  // Same element count, transposed layout: ComfyUI would reshape it onto the weight silently.
  assert.equal(compatible({ [`${mlp}.lokr_w1`]: t([6, 6]), [`${mlp}.lokr_w2`]: t([2048, 512]) }, base), false);
  // Half a decomposed factor, or whole plus decomposed.
  assert.equal(compatible({ [`${q}.lokr_w1`]: t([6, 6]), [`${q}.lokr_w2_a`]: t([512, 8]) }, base), false);
  assert.equal(compatible({ ...whole, [`${q}.lokr_w2_a`]: t([512, 8]), [`${q}.lokr_w2_b`]: t([8, 512]) }, base), false);
  // Tucker, DoRA, fp8 factors, an alpha that is not a scalar.
  assert.equal(compatible({ ...whole, [`${q}.lokr_t2`]: t([8, 8, 1, 1]) }, base), false);
  assert.equal(compatible({ ...whole, [`${q}.dora_scale`]: t([3072, 1]) }, base), false);
  assert.equal(compatible({ [`${q}.lokr_w1`]: t([6, 6], 'F8_E4M3'), [`${q}.lokr_w2`]: t([512, 512]) }, base), false);
  assert.equal(compatible({ ...whole, [`${q}.alpha`]: t([2]) }, base), false);
  // A LoKr module and a LoRA pair on one weight: ComfyUI keeps only one of them.
  assert.equal(compatible({ ...whole, 'transformer.transformer_blocks.0.attn.to_q.lora_A.weight': t([2, 3072]), 'transformer.transformer_blocks.0.attn.to_q.lora_B.weight': t([3072, 2]) }, base), false);
  // A 1-D weight is not a target.
  assert.equal(compatible({ 'lycoris_transformer_blocks_0_attn_norm_q.lokr_w1': t([2, 1]), 'lycoris_transformer_blocks_0_attn_norm_q.lokr_w2': t([64, 1]) }, base), false);
});

test('the ordinary list reads fp8mixed, and the bf16 release only where fp8mixed is not on disk', async t => {
  const { EDIT_MODEL_FALLBACKS } = require('../main/qwen-lora-catalog');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-qwen-fallback-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'models/loras/qwen');
  const baseKey = 'transformer_blocks.0.attn.to_q';
  write(path.join(root, 'fits.safetensors'), { [`diffusion_model.${baseKey}.lora_A.weight`]: [2, 6], [`diffusion_model.${baseKey}.lora_B.weight`]: [4, 2] });
  const catalog = createQwenLoraCatalog({ root, listRuntimeLoraNames: async () => ({ LoraLoaderModelOnly: { input: { required: { lora_name: [['qwen/fits.safetensors']] } } } }) });
  // Neither file: the list is an error, never a silent empty list.
  await assert.rejects(catalog.catalog(), /2511/);
  assert.deepEqual(EDIT_MODEL_FALLBACKS, ['diffusion_models/qwen_image_edit_2511_bf16.safetensors']);
  write(path.join(temp, 'models', EDIT_MODEL_FALLBACKS[0]), { [`${baseKey}.weight`]: [4, 6] }, 'BF16');
  assert.deepEqual((await catalog.catalog()).map(x => x.name), ['qwen/fits.safetensors']);
  // fp8mixed present: it is the one read (its differently shaped weight flips the verdict).
  write(path.join(temp, 'models', BASE_MODELS.edit), { [`${baseKey}.weight`]: [5, 6], [`${baseKey}.weight_scale`]: [] }, 'F8_E4M3');
  assert.deepEqual(await catalog.catalog(), []);
});
