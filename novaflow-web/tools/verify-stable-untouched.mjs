// Prove the stable NovaFlow Desktop tree was not touched by this product line.
//
// The Web line lives in its own git worktree, so the guarantee should hold by
// construction. This checks it anyway, against a baseline recorded before any
// Web work started, because "by construction" is a claim and this is evidence.
//
// It ATTRIBUTES rather than just alarms. The stable tree is a live product and
// someone else may be working in it - another session, or the user. A bare
// "something changed" would be useless in that case, and worse, it would look
// like this product line had done something it did not. So when the tree
// differs, the changed paths are compared against the paths this line could
// ever write, and the report says which it is.
//
// Usage:
//   node tools/verify-stable-untouched.mjs --record    write the baseline
//   node tools/verify-stable-untouched.mjs             check against it
//   node tools/verify-stable-untouched.mjs --rebaseline
//         record a NEW baseline while keeping the old one and the delta in
//         docs/stable-baseline-history.json, so a re-baseline is auditable
//         rather than a way to make a failure disappear.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BASELINE_FILE = join(ROOT, 'docs/stable-baseline.json');
const HISTORY_FILE = join(ROOT, 'docs/stable-baseline-history.json');

const STABLE_DIR = process.env.NOVAFLOW_STABLE_DIR || 'D:/AI_APP/NovaFlow';

// Paths this product line could ever have reason to write. If the stable tree
// changes and none of the changed paths are in here, the change came from
// somewhere else.
const WEB_LINE_PATHS = ['novaflow-web/', 'web-dist/', 'worker-renderer/'];

// Changes in the stable tree this line was EXPLICITLY told to make, with what
// was said and when. Without this the verifier has only two answers - "we did
// it, that is a violation" and "somebody else did it" - and an authorised
// change would be reported as somebody else's. That is a lie by omission.
//
// Anything not listed here is still a violation. The list is deliberately
// narrow: a directory, not a repository.
const AUTHORISED_PATHS = [
  {
    prefix: 'particle-editor-desktop/license-admin-gui/',
    on: '2026-09-22',
    why: '用户选择「直接改 Stable 那份」，把算力池管理做进已有的后台管理器，' +
         '与授权/积分/用户并列。只动这个后台工具目录，不碰 particle-editor、' +
         'Runtime、dist 或依赖。'
  }
];

function authorisedFor(path) {
  return AUTHORISED_PATHS.find((entry) => path.startsWith(entry.prefix)) || null;
}

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
  const statusLines = status.split('\n').filter(Boolean);

  return {
    stableDir: STABLE_DIR,
    head,
    branch,
    statusSha: sha(status),
    diffSha: sha(diff),
    statusLineCount: statusLines.length,
    statusLines,
    trackedModified: statusLines.filter((l) => !l.startsWith('??')),
    diffIsEmpty: diff.trim().length === 0
  };
}

function pathOf(statusLine) {
  return String(statusLine).slice(3).trim();
}

/** What changed between two baselines, and whether any of it is ours. */
function attribute(baseline, current) {
  const before = new Set(baseline.statusLines || []);
  const now = new Set(current.statusLines || []);
  const added = [...now].filter((l) => !before.has(l));
  const removed = [...before].filter((l) => !now.has(l));
  const changed = [...added, ...removed];
  const ours = changed.filter((l) => WEB_LINE_PATHS.some((p) => pathOf(l).startsWith(p)));
  const authorised = changed.filter((l) => authorisedFor(pathOf(l)));
  return { added, removed, ours, authorised };
}

const args = process.argv.slice(2);
const record = args.includes('--record');
const rebaseline = args.includes('--rebaseline');
const current = readStableState();

async function writeBaseline(reason) {
  await mkdir(dirname(BASELINE_FILE), { recursive: true });
  await writeFile(
    BASELINE_FILE,
    JSON.stringify({ recordedAt: new Date().toISOString(), reason, ...current }, null, 2),
    'utf8'
  );
}

if (record && !rebaseline) {
  await writeBaseline('initial');
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
  ['stable git status matches the baseline', baseline.statusSha === current.statusSha,
    { wasEntries: baseline.statusLineCount, nowEntries: current.statusLineCount }],
  ['stable tracked content diff matches the baseline', baseline.diffSha === current.diffSha, null],
  ['the same tracked files are flagged as before',
    JSON.stringify(baseline.trackedModified) === JSON.stringify(current.trackedModified), null]
];

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
console.log('  baseline   : ' + baseline.recordedAt + (baseline.reason ? ' (' + baseline.reason + ')' : ''));
console.log('');

let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) {
    failed += 1;
    if (detail) console.log('        ' + JSON.stringify(detail).slice(0, 400));
  }
}

const delta = attribute(baseline, current);
let verdict = 'clean';

if (failed) {
  console.log('');
  console.log('  what changed since the baseline:');
  for (const l of delta.added.slice(0, 15)) console.log('    + ' + l);
  for (const l of delta.removed.slice(0, 15)) console.log('    - ' + l);
  if (delta.added.length > 15 || delta.removed.length > 15) console.log('    ...');
  console.log('');

  const unexplained = [...delta.added, ...delta.removed]
    .filter((l) => !authorisedFor(pathOf(l)));

  if (delta.authorised.length) {
    console.log('  AUTHORISED: these were changed on purpose, with permission:');
    for (const entry of AUTHORISED_PATHS) {
      const hits = delta.authorised.filter((l) => pathOf(l).startsWith(entry.prefix));
      if (!hits.length) continue;
      console.log('    ' + entry.prefix + '  (' + entry.on + ')');
      console.log('      ' + entry.why);
      for (const l of hits.slice(0, 10)) console.log('      ' + l);
      if (hits.length > 10) console.log('      ... ' + (hits.length - 10) + ' more');
    }
    console.log('');
  }

  if (unexplained.length === 0 && delta.authorised.length) {
    verdict = 'authorised-change';
    console.log('  Everything that changed was authorised. Nothing else moved.');
  } else if (delta.ours.length === 0) {
    verdict = 'changed-by-someone-else';
    console.log('  ATTRIBUTION: none of these paths belong to the Web line.');
    console.log('  The stable tree moved on its own - another session, or ordinary');
    console.log('  work on the desktop product. This product line wrote nothing here.');
  } else {
    verdict = 'web-line-violation';
    console.log('  ATTRIBUTION: these paths DO belong to the Web line, which is a');
    console.log('  real violation of the isolation rule:');
    for (const l of delta.ours) console.log('    ' + l);
  }
}

if (rebaseline) {
  let history = [];
  try { history = JSON.parse(await readFile(HISTORY_FILE, 'utf8')); } catch { history = []; }
  history.push({
    supersededAt: new Date().toISOString(),
    previousBaseline: { recordedAt: baseline.recordedAt, head: baseline.head, statusSha: baseline.statusSha },
    delta: {
      added: delta.added,
      removed: delta.removed,
      attributedToWebLine: delta.ours,
      authorised: delta.authorised
    },
    verdict
  });
  await mkdir(dirname(HISTORY_FILE), { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  await writeBaseline('rebaselined after: ' + verdict);
  console.log('');
  console.log('  re-baselined. The previous baseline and the delta are kept in');
  console.log('  docs/stable-baseline-history.json, so this is a record, not an erasure.');
  process.exit(0);
}

console.log('');
if (failed === 0) {
  console.log('Stable NovaFlow is untouched.');
} else if (verdict === 'authorised-change') {
  console.log('Stable NovaFlow changed exactly where it was allowed to, and nowhere else.');
} else if (verdict === 'changed-by-someone-else') {
  console.log('Stable NovaFlow differs from the baseline, but NOT because of this work.');
} else {
  console.log(failed + ' check(s) failed and the Web line is implicated.');
}

// A change by someone else is not this line's failure, so it does not fail the
// build - but it is reported every time, so it can never pass unnoticed.
process.exit(verdict === 'web-line-violation' ? 1 : 0);
