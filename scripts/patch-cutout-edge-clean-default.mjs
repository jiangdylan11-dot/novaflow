// 视频抠图 边缘净化 starts off every time the tool opens and is not remembered (2026-10-09, user's
// call): it is a per-clip choice. The persisted preference (first default on, then a v2 key default
// off) becomes plain component state starting off, and pressing 视频抠图 turns it off again (the
// component stays mounted while the tool is closed, so state alone survived a close and reopen).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const STORED = [
  'Tt(`nf_cutout_clean_edges`,!0,{parse:e=>e!==`false`,serialize:e=>String(!!e)})',
  'Tt(`nf_cutout_clean_edges_v2`,!1,{parse:e=>e===`true`,serialize:e=>String(!!e)})',
];
const AFTER = '[nfCleanEdges,nfSetCleanEdges]=(0,_.useState)(!1)';
const START = '"data-novaflow-video-cutout":`1`,onClick:()=>{Vn&&(async()=>{';
const START_AFTER = '"data-novaflow-video-cutout":`1`,onClick:()=>{Vn&&(nfSetCleanEdges(!1),async()=>{';

export function patchCutoutEdgeCleanDefault(source) {
  if (!source.includes(AFTER)) {
    const stored = STORED.map(text => '[nfCleanEdges,nfSetCleanEdges]=' + text).find(before => source.includes(before));
    if (!stored || source.indexOf(stored) !== source.lastIndexOf(stored)) throw new Error('Cutout edge-clean state anchor missing or ambiguous');
    source = source.replace(stored, () => AFTER);
  }
  if (!source.includes(START_AFTER)) {
    if (source.indexOf(START) < 0 || source.indexOf(START) !== source.lastIndexOf(START)) throw new Error('Cutout start anchor missing or ambiguous');
    source = source.replace(START, () => START_AFTER);
  }
  return source;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = new URL('../novaflow-web/renderer/assets/index-BbIa-2NM.js', import.meta.url);
  const before = fs.readFileSync(file, 'utf8');
  const after = patchCutoutEdgeCleanDefault(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
  console.log(after === before ? 'already patched' : 'patched');
}
