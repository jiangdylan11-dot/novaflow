// Reuse the desktop's safetensors compatibility checks on the compute node.
// Only catalog metadata leaves the node; model bytes and paths stay local.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
function catalogModule(name) {
  const packaged = join(process.resourcesPath || '', 'lora-catalogs', name + '.cjs');
  return require(existsSync(packaged) ? packaged : fileURLToPath(new URL('../../../../particle-editor-desktop/main/' + name + '.js', import.meta.url)));
}

export function createWorkerLoraCatalog({ modelsRoot, image, video }) {
  const qwen = catalogModule('qwen-lora-catalog').createQwenLoraCatalog({
    root: join(modelsRoot || '.', 'loras', 'qwen'),
    listRuntimeLoraNames: () => image.requestJson('', '/object_info/LoraLoaderModelOnly')
  });
  const h3 = catalogModule('minimax-h3-lora-catalog').createMiniMaxH3LoraCatalog({
    readConfig: () => ({ modelsPath: modelsRoot }),
    expectedModelsPath: () => modelsRoot,
    listRuntimeLoraNames: () => video.requestJson('', '/object_info/LoraLoaderModelOnly')
  });
  async function read(kind, input = {}) {
    if (!modelsRoot) throw new Error('请在算力节点设置 models 目录后重启节点');
    if (kind === 'h3' && !await video.isUp()) throw new Error('H3 算力服务未启动');
    const items = await (kind === 'h3' ? h3 : qwen).catalog(input);
    return { ok: true, items: [...items].slice(0, 256) };
  }
  async function report(runtime) {
    const requests = runtime === 'video'
      ? { h3: () => read('h3', { mode: 't2v', steps: 4 }), h3_ref: () => read('h3', { mode: 'r2v', steps: 4 }) }
      : { qwen: () => read('qwen'), qwen_nsfw: () => read('qwen', { nsfw: true }), qwen21: () => read('qwen', { engine: 'qwen-2.1' }) };
    const catalog = {};
    for (const [key, get] of Object.entries(requests)) {
      try { catalog[key] = await get(); }
      catch (error) { catalog[key] = { ok: false, error: String(error.message || error) }; }
    }
    return { version: 1, updated_at: new Date().toISOString(), ...catalog };
  }
  async function validateGraph(graph, parameters = {}) {
    const nodes = Object.entries(graph);
    const userQwen = nodes.filter(([id]) => /^nf_art_lora_/.test(id));
    if (userQwen.length) {
      const nsfw = nodes.some(([, n]) => /Qwen-Rapid/i.test(String(n.inputs?.ckpt_name || '')));
      // A Qwen-Image-2.1 graph (its GGUF / safetensors loader) takes only LoRAs made for 2.1.
      const qwen21 = nodes.some(([, n]) => /^(?:UnetLoaderGGUF|UNETLoader)$/.test(String(n.class_type || '')) && /qwen[-_ ]?image[-_ ]?2\.1|^Noct/i.test(String(n.inputs?.unet_name || '')));
      const { items } = await read('qwen', qwen21 ? { engine: 'qwen-2.1' } : { nsfw });
      const names = new Set(items.map(item => item.name));
      for (const [, node] of userQwen) if (!names.has(node.inputs?.lora_name)) throw new Error('Qwen LoRA 已变化或不兼容，请刷新列表重新选择');
      // A 2.1 LoRA trained on the fused MLP runs from its split copy on a split 2.1 build.
      if (qwen21) for (const [, node] of userQwen) node.inputs.lora_name = qwen.runtimeName21(node.inputs.lora_name);
    }
    for (const item of parameters.loras || []) {
      if (item.enabled === false) continue;
      const result = await h3.validate({ ...item, strength: item.strength ?? item.weight, mode: parameters.mode || 'i2v', steps: parameters.steps || 4 });
      if (!result.ok) throw new Error('H3 LoRA 已变化或不兼容：' + result.error);
    }
  }
  return { read, report, validateGraph };
}
