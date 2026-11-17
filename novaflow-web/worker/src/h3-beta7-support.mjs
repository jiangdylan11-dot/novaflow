import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {foartRuntimeRoot} from './runtime-location.mjs';

// The Beta7 video line stores 103 layers as w6a8_int8. The environment loads
// them only after the comfy-w6a8 patch (ComfyUI quant entry + comfy-kitchen
// 0.2.41). Fail the one task with a clear message instead of a loader crash.
const isBeta7 = name => /8stepTURBO_beta7_activation_learned_compact_w4w6int8/i.test(String(name || ''));

const kitchenAtLeast = (version, min = [0, 2, 41]) => {
  const parts = String(version).split('.').map(Number);
  for (let i = 0; i < min.length; i++) {
    if ((parts[i] || 0) !== min[i]) return (parts[i] || 0) > min[i];
  }
  return true;
};

// null = not a Foart environment we can read (leave the decision to ComfyUI).
export function runtimeSupportsW6a8({root = foartRuntimeRoot()} = {}) {
  let quant;
  try { quant = readFileSync(join(root, 'engine', 'ComfyUI', 'comfy', 'quant_ops.py'), 'utf8'); } catch { return null; }
  if (!quant.includes('"w6a8_int8"')) return false;
  try {
    const site = join(root, 'engine', 'python', 'Lib', 'site-packages');
    return readdirSync(site).some(name => {
      const match = /^comfy_kitchen-(\d+\.\d+\.\d+)\.dist-info$/i.exec(name);
      return match && kitchenAtLeast(match[1]);
    });
  } catch { return false; }
}

export function assertH3Beta7Runnable(graph, {supports = runtimeSupportsW6a8} = {}) {
  const usesBeta7 = Object.values(graph || {}).some(node => node?.class_type === 'UNETLoader' && isBeta7(node.inputs?.unet_name));
  if (usesBeta7 && supports() === false) {
    throw Object.assign(new Error('这台算力节点的运行环境还不支持 Beta7 线路，请在模型方式里换回默认线路，或更新运行环境后重试'), {code: 'H3_BETA7_RUNTIME_UNSUPPORTED'});
  }
}
