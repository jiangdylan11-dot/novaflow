// Prove the stable NovaFlow Desktop tree was not touched by this product line.
//
// The Web line lives in its own git worktree, so the guarantee should hold by
// construction. This script checks it anyway, against a baseline recorded
// before any Web work started, because "by construction" is a claim and this
// is evidence.
//
// Usage:
//   node tools/verify-stable-untouched.mjs --record   (write the baseline)
//   node tools/verify-stable-untouched.mjs            (check against it)

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BASELINE_FILE = join(ROOT, 'docs/stable-baseline.json');

const STABLE_DIR = process.env.NOVAFLOW_STABLE_DIR || 'D:/AI_APP/NovaFlow';

function git(args, cwd = STABLE_DIR) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function sha(text) {
  return createHash('sha256').update(text).digest('hex');
}

function readStableState() {
  const head = git(['rev-parse', 'HEAD']).trim();
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const status = git(['status', '--porcelain=v1']);
  // The tracked-content diff. On this repo several files show as modified for
  // CRLF reasons while their content is identical, so the diff hash is the
  // honest measure of "did anything actually change".
  const diff = git(['diff']);
  const trackedModified = status.split('\n').filter((l) => l && !l.startsWith('??'));

  return {
    stableDir: STABLE_DIR,
    head,
    branch,
    statusSha: sha(status),
    diffSha: sha(diff),
    statusLineCount: status.split('\n').filter(Boolean).length,
    trackedModified,
    diffIsEmpty: diff.trim().length === 0
  };
}

const record = process.argv.includes('--record');
const current = readStableState();

if (record) {
  await mkdir(dirname(BASELINE_FILE), { recursive: true });
  await writeFile(
    BASELINE_FILE,
    JSON.stringify({ recordedAt: new Date().toISOString(), ...current }, null, 2),
    'utf8'
  );
  console.log('baseline recorded to docs/stable-baseline.json');
  console.log('  HEAD   : ' + current.head);
  console.log('  branch : ' + current.branch);
  console.log('  status : ' + current.statusLineCount + ' entries, sha ' + current.statusSha.slice(0, 16));
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(await readFile(BASELINE_FILE, 'utf8'));
} catch {
  console.error('no baseline found. Run: node tools/verify-stable-untouched.mjs --record');
  process.exit(1);
}

const checks = [
  ['stable HEAD is unchanged', baseline.head === current.head, { was: baseline.head, now: current.head }],
  ['stable branch is unchanged', baseline.branch === current.branch, { was: baseline.branch, now: current.branch }],
  ['stable git status is byte-identical', baseline.statusSha === current.statusSha,
    { wasEntries: baseline.statusLineCount, nowEntries: current.statusLineCount }],
  ['stable tracked content diff is unchanged', baseline.diffSha === current.diffSha, null],
  ['no tracked file has modified content', current.diffIsEmpty, { trackedModified: current.trackedModified }],
  ['the same tracked files are flagged as before',
    JSON.stringify(baseline.trackedModified) === JSON.stringify(current.trackedModified),
    { was: baseline.trackedModified, now: current.trackedModified }]
];

// The Web worktree must be a separate directory, not inside the stable tree.
const worktrees = git(['worktree', 'list']).trim().split('\n');
const webWorktree = worktrees.find((l) => l.includes('feature/novaflow-web'));
checks.push(['a separate Web worktree exists', Boolean(webWorktree), worktrees]);
if (webWorktree) {
  const webPath = webWorktree.split(/\s+/)[0].replace(/\\/g, '/');
  const stablePath = STABLE_DIR.replace(/\\/g, '/').replace(/\/+$/, '');
  checks.push([
    'the Web worktree is OUTSIDE the stable working tree',
    !webPath.toLowerCase().startsWith(stablePath.toLowerCase() + '/'),
    { webPath, stablePath }
  ]);
}

console.log('Stable protection check');
console.log('  stable dir : ' + STABLE_DIR);
console.log('  baseline   : ' + baseline.recordedAt);
console.log('');

let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) {
    failed += 1;
    if (detail) console.log('        ' + JSON.stringify(detail).slice(0, 600));
  }
}

console.log('');
console.log(failed === 0
  ? 'Stable NovaFlow is untouched.'
  : failed + ' check(s) failed - the stable tree changed.');
process.exit(failed === 0 ? 0 : 1);
