// 动画 on the Web: a pool task's history entry (novaflow-web-runtime.js asHistoryEntry) carries the
// node's percentage and the task status under `novaflow`. The poll loop shows the percentage (the
// page has no ComfyUI websocket, so the bar sat at its start) and reads a cancel as 任务已中止, not
// as 生成失败. ComfyUI's own entries have no `novaflow`, so the desktop path is unchanged.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const POOL_PROGRESS_TICK =
  'nfPoolProgress=typeof o?.novaflow?.progress==`number`&&e.setAiSeqComfyProgress(nfState=>({...nfState,active:!0,value:o.novaflow.progress,max:100})),';
export const POOL_CANCELLED = 'o?.novaflow?.status===`cancelled`';

export function patchAiSeqPoolTask(source) {
  const patches = [
    ['return r})(),s=S(o),c=e=>{', 'return r})(),s=S(o),' + POOL_PROGRESS_TICK + 'c=e=>{'],
    [
      'e.setAiSeqJob({state:`error`,message:f.includes(`error`)?`生成失败且未发现输出文件（请检查工作流执行日志）`',
      'e.setAiSeqJob({state:' + POOL_CANCELLED + '?`done`:`error`,message:' + POOL_CANCELLED +
        '?`任务已中止`:f.includes(`error`)?`生成失败且未发现输出文件（请检查工作流执行日志）`'
    ]
  ];
  for (const [before, after] of patches) {
    if (source.includes(after)) continue;
    if (source.indexOf(before) < 0 || source.indexOf(before) !== source.lastIndexOf(before)) {
      throw new Error('AI sequence pool task anchor missing or ambiguous: ' + before);
    }
    source = source.replace(before, () => after);
  }
  return source;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = new URL('../novaflow-web/renderer/assets/index-BbIa-2NM.js', import.meta.url);
  const before = fs.readFileSync(file, 'utf8');
  const after = patchAiSeqPoolTask(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
  console.log(after === before ? 'already patched' : 'patched');
}
