const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createQwenLoraCatalog, BASE_MODELS } = require('../main/qwen-lora-catalog');

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
  assert.equal(BASE_MODELS.edit, BASE_MODELS.rapid);
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
