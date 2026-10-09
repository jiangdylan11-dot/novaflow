// 视频抠图 边缘净化 starts off (2026-10-09, user's call): it trims along the AI mask's outline and,
// with the lighter video mask, bit notches into subjects. The setting moves to a new storage key so
// browsers that stored the old default (on) start from off once; a choice made after that is kept.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function patchCutoutEdgeCleanDefault(source) {
  const before = 'Tt(`nf_cutout_clean_edges`,!0,{parse:e=>e!==`false`,serialize:e=>String(!!e)';
  const after = 'Tt(`nf_cutout_clean_edges_v2`,!1,{parse:e=>e===`true`,serialize:e=>String(!!e)';
  if (source.includes(after)) return source;
  const at = source.indexOf(before);
  if (at < 0 || at !== source.lastIndexOf(before)) throw new Error('Cutout edge-clean default anchor missing or ambiguous');
  return source.replace(before, () => after);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = new URL('../novaflow-web/renderer/assets/index-BbIa-2NM.js', import.meta.url);
  const before = fs.readFileSync(file, 'utf8');
  const after = patchCutoutEdgeCleanDefault(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
  console.log(after === before ? 'already patched' : 'patched');
}
