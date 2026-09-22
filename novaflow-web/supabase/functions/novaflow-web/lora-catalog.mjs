// GENERATED COPY - do not edit here.
// Source: packages/shared/src/lora-catalog.mjs
// Regenerate with: npm run sync:edge
// Advertise only selections supported by every node the scheduler can choose.
// Older nodes and failed scans are unavailable, never an empty success.
export function commonLoraCatalog(rows, { kind, nsfw = false, mode = 'i2v', steps = 4 }) {
  if (!rows.length) throw new Error('暂无在线算力可读取 LoRA');
  const key = kind === 'qwen' ? (nsfw ? 'qwen_nsfw' : 'qwen') : (mode === 'r2v' ? 'h3_ref' : 'h3');
  const lists = rows.map(row => {
    const report = row.detail?.lora_catalog;
    if (report?.version !== 1) throw new Error('算力节点需要更新到 0.4.4 才能读取 LoRA');
    if (Date.now() - Date.parse(report.updated_at) > 300000 || !Number.isFinite(Date.parse(report.updated_at))) throw new Error('LoRA 列表已过期，等待节点更新后重试');
    const value = report[key];
    if (!value?.ok || !Array.isArray(value.items)) throw new Error('算力节点读取 LoRA 失败，请检查节点的 models 目录与模型文件');
    return value.items.filter(item => {
      const name = String(item?.name || '');
      if (!/\.safetensors$/i.test(name) || name.split(/[\\/]/).some(p => !p || p === '.' || p === '..' || p.includes(':'))) return false;
      if (kind === 'qwen') return /^qwen[\\/]/i.test(name);
      const family = mode === 'r2v' ? 'ref2va' : 'fl2va';
      return item.kind === 'standard' && ['h3', family].includes(item.modelFamily) &&
        (!item.supportedSteps || item.supportedSteps.includes(steps)) && typeof item.fingerprint === 'string';
    }).map(item => kind === 'qwen' ? { name: item.name } : {
      name: item.name, fingerprint: item.fingerprint, modelFamily: item.modelFamily,
      kind: item.kind, supportedSteps: item.supportedSteps, strengthRange: item.strengthRange
    });
  });
  return lists[0].filter(item => lists.slice(1).every(list => list.some(other =>
    other.name === item.name && (kind !== 'h3' || other.fingerprint === item.fingerprint))));
}
