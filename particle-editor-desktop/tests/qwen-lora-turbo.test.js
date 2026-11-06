const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compatible, createQwenLoraCatalog } = require('../main/qwen-lora-catalog.js');
const vm = require('node:vm');
const browser = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../novaflow-web/renderer/art-generate-lora.js'), 'utf8'), browser);
const art = browser.NovaFlowArtGenerateLora;
const stem = 'transformer_blocks.0.img_mlp.';
const tensor = shape => ({ dtype: 'BF16', shape });
const pair = (name, out = 6) => ({ [name + '.lora_A.default.weight']: tensor([2, 4]), [name + '.lora_B.default.weight']: tensor([out, 2]) });
const fused = { ['model.diffusion_model.' + stem + 'gate_up.weight']: tensor([12, 4]) };
const halves = { ...pair(stem + 'gate_layer'), ...pair(stem + 'proj') };

test('split MLP LoRAs fit fused Turbo without admitting overlap or wrong shapes', () => {
  assert.equal(compatible(halves, fused), true);
  assert.equal(compatible({ ...pair(stem + 'gate_layer', 7), ...pair(stem + 'proj') }, fused), false);
  assert.equal(compatible({ ...halves, ...pair(stem + 'gate_up', 12) }, fused), false);
  assert.equal(compatible({ ...halves, ...pair('transformer.' + stem + 'gate_layer') }, fused), false);
});

function save(file, tensors) {
  const header = {}; let offset = 0;
  for (const [key, { shape }] of Object.entries(tensors)) {
    const size = shape.reduce((a, b) => a * b, 1) * 2;
    header[key] = { dtype: 'BF16', shape, data_offsets: [offset, offset + size] }; offset += size;
  }
  const json = Buffer.from(JSON.stringify(header)); const size = Buffer.alloc(8); size.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(file, Buffer.concat([size, json, Buffer.alloc(offset)]));
}

test('shared catalogue checks both models; task validation uses its named model', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foart-turbo-lora-'));
  try {
    const models = path.join(root, 'diffusion_models'), loras = path.join(root, 'loras/qwen');
    fs.mkdirSync(models, { recursive: true }); fs.mkdirSync(loras, { recursive: true });
    const turbo = 'Qwen-Image-2.1-Turbo.safetensors', standard = 'qwen-image-2.1-standard.safetensors';
    save(path.join(models, turbo), fused);
    save(path.join(models, standard), { [stem + 'gate_layer.weight']: tensor([6, 4]), [stem + 'proj.weight']: tensor([6, 4]) });
    const names = ['fusal-qwen-image-2.1-turbo-style.safetensors', 'Qwen-Image-2.1-Turbo.safetensors', 'Qwen-Lightning.safetensors'];
    for (const name of names) save(path.join(loras, name), halves);
    const c = createQwenLoraCatalog({ root: loras, listRuntimeLoraNames: async () => ({ LoraLoaderModelOnly: { input: { required: { lora_name: [names.map(n => 'qwen/' + n)] } } } }) });
    assert.equal((await c.catalog({ engine: 'qwen-2.1' })).length, 1);
    // An incompatible Turbo must not determine the standard task's catalogue by sort order.
    save(path.join(models, turbo), { ['model.diffusion_model.' + stem + 'gate_up.weight']: tensor([16, 4]) });
    assert.equal((await c.catalog({ engine: 'qwen-2.1' })).length, 0);
    assert.equal((await c.catalog({ engine: 'qwen-2.1', modelName: standard })).length, 1);
    assert.equal((await c.catalog({ engine: 'qwen-2.1', modelName: turbo })).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('browser accepts Turbo style adapters and inserts them after the native BF16 loader', () => {
  const name = 'qwen/fusal-qwen-image-2.1-turbo-style.safetensors';
  assert.deepEqual(Array.from(art.catalogFromInfo({ ok: true, items: [{ name }, { name: 'qwen/Qwen-Image-2.1-Turbo.safetensors' }] })), [name]);
  const graph = { 1: { class_type: 'NovaFlowGGUFBF16Loader', inputs: { unet_name: 'Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors' } }, 2: { class_type: 'KSampler', inputs: { model: ['1', 0] } } };
  assert.equal(art.isQwen21Graph(graph), true);
  art.apply(graph, { provider: 'local', mode: 'txt2img', loras: [{ name, strength: 0.8 }] });
  assert.equal(graph.nf_art_lora_1.inputs.lora_name, name);
  assert.deepEqual(Array.from(graph['2'].inputs.model), ['nf_art_lora_1', 0]);
});
