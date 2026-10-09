// AI 抠图's preview frames share one memory budget, split evenly over the clip's frames; a frame
// over its share is scaled down. At 128 MB a 117-frame 1080x1920 clip previewed at about 401x714
// (37%) and looked blocky next to the saved video. 384 MB gives that clip about 694x1235 (64%) and
// a ~70-frame 736x1280 clip its full size. The decoded frames and masks the AI path also holds are
// unchanged; the non-AI budget (440 MB) is untouched.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function patchCutoutPreviewBudget(source) {
  const before = 'l=Math.max(1,Math.floor((R===`ai`?134217728:536870912*.86)/Math.max(1,c)/4))';
  const after = 'l=Math.max(1,Math.floor((R===`ai`?402653184:536870912*.86)/Math.max(1,c)/4))';
  if (source.includes(after)) return source;
  const at = source.indexOf(before);
  if (at < 0 || at !== source.lastIndexOf(before)) throw new Error('Cutout preview budget anchor missing or ambiguous');
  return source.replace(before, () => after);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = new URL('../novaflow-web/renderer/assets/index-BbIa-2NM.js', import.meta.url);
  const before = fs.readFileSync(file, 'utf8');
  const after = patchCutoutPreviewBudget(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
  console.log(after === before ? 'already patched' : 'patched');
}
