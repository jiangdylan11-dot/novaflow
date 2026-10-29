// Reword messages in the prebuilt bundle that only make sense on the desktop.
//
// A friend opened the site, switched to AI 序列, and was told:
//
//   未找到 MiniMax H3 Runtime（8189），请确认已安装并启动
//
// On the desktop that is good advice. On the Web it is advice about software
// the reader is not supposed to install, about a port on their own machine
// that is never going to have a runtime on it. The compute is somebody else's
// machine, and whether it is there is not something the reader can fix by
// installing anything.
//
// The probe behind it is already answered from the worker pool (see
// novaflow-web-runtime.js). This is the wording that goes with it, for the
// case where the pool really is empty.
//
// A string swap, not a code transform: same length rules do not apply, but the
// file must still parse afterwards and every replacement must actually have
// been found, or the edit reverts. Minified code has broken careless edits on
// this bundle three separate ways already.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const REWORDS = [
  {
    from: '未找到 MiniMax H3 Runtime（8189），请确认已安装并启动',
    to: '暂无可用算力节点（AI 序列），请等待算力上线'
  },
  {
    from: '未找到Foart AI Runtime，请确认已启动',
    to: '暂无可用算力节点，请等待算力上线'
  },
  {
    from: 'Foart AI Runtime 地址为空',
    to: '算力池地址未配置'
  }
];

export function rewordBundle(file, { rewords = REWORDS } = {}) {
  const before = readFileSync(file, 'utf8');
  let after = before;
  const applied = [];
  const missing = [];

  for (const { from, to } of rewords) {
    if (!after.includes(from)) {
      missing.push(from);
      continue;
    }
    const count = after.split(from).length - 1;
    after = after.split(from).join(to);
    applied.push({ from, to, count });
  }

  if (!applied.length) return { applied, missing, changed: false };

  writeFileSync(file, after, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    // Put it back rather than ship something that does not parse.
    writeFileSync(file, before, 'utf8');
    return { applied: [], missing, changed: false, revertedBecause: String(error.stderr || error.message).slice(0, 200) };
  }

  return { applied, missing, changed: true };
}
