// Copy the shared control-plane modules into the edge function folder.
//
// Supabase bundles a function from its own directory, so the shared sources
// must physically live there at deploy time. Copying (rather than maintaining
// a second implementation) is what keeps the deployed function and the locally
// tested one byte-identical; this script is run before every deploy and the
// test suite asserts the copies are in sync.
//
// The file list is DERIVED by following imports from index.ts, not written by
// hand. A hand-written list silently lost workflow-modules.mjs: every local
// test passed, `--check` reported "in sync", and the deploy would have died on
// a module Deno could not resolve. A list that is computed cannot drift from
// what the code actually imports.

import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = join(ROOT, 'packages/shared/src');
const DEST = join(ROOT, 'supabase/functions/novaflow-web');
const ENTRY = 'index.ts';

const BANNER = `// GENERATED COPY - do not edit here.
// Source: packages/shared/src/%NAME%
// Regenerate with: npm run sync:edge
`;

/** Every relative specifier a file imports or re-exports. */
export function relativeImports(source) {
  const out = new Set();
  const patterns = [
    /\bfrom\s+['"](\.\/[^'"]+)['"]/g,
    /\bimport\s+['"](\.\/[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.\/[^'"]+)['"]\s*\)/g
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) out.add(m[1].replace(/^\.\//, ''));
  }
  return [...out];
}

/**
 * Walk the import graph from the entry point.
 *
 * The entry lives in the function folder and is not a copy of anything; every
 * module it reaches is.
 */
export async function resolveSharedFiles() {
  const entry = await readFile(join(DEST, ENTRY), 'utf8');
  const seen = new Set();
  const queue = relativeImports(entry);
  const missing = [];

  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    let source;
    try {
      source = await readFile(join(SRC, name), 'utf8');
    } catch {
      missing.push(name);
      continue;
    }
    for (const next of relativeImports(source)) queue.push(next);
  }

  return { files: [...seen].filter((f) => !missing.includes(f)).sort(), missing };
}

export async function syncEdgeFunction({ check = false } = {}) {
  const { files, missing } = await resolveSharedFiles();
  const drift = [];

  // An import that resolves to nothing in packages/shared is not a copy
  // problem, it is a broken graph - report it rather than quietly skipping.
  for (const name of missing) {
    drift.push({ file: name, reason: 'imported but not found in packages/shared/src' });
  }

  for (const name of files) {
    const source = await readFile(join(SRC, name), 'utf8');
    const wanted = BANNER.replace('%NAME%', name) + source;
    let current = '';
    try { current = await readFile(join(DEST, name), 'utf8'); } catch { current = ''; }
    if (current !== wanted) {
      if (check) {
        drift.push({ file: name, sourceSha: sha(source), copySha: current ? sha(current) : null });
      } else {
        await writeFile(join(DEST, name), wanted, 'utf8');
      }
    }
  }

  // A copy nothing imports any more is dead weight in the deployed bundle.
  const present = (await readdir(DEST)).filter((f) => f !== ENTRY && /\.(mjs|ts|js)$/.test(f));
  const stale = present.filter((f) => !files.includes(f));
  for (const name of stale) {
    if (check) drift.push({ file: name, reason: 'nothing imports this any more' });
    else await unlink(join(DEST, name));
  }

  return drift;
}

function sha(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('sync-edge-function.mjs');
if (invokedDirectly) {
  const check = process.argv.includes('--check');
  const drift = await syncEdgeFunction({ check });
  if (check && drift.length) {
    console.error('edge function copies are out of date:');
    for (const d of drift) {
      console.error('  ' + d.file + '  ' + (d.reason || ('source=' + d.sourceSha + ' copy=' + (d.copySha || 'missing'))));
    }
    console.error('run: npm run sync:edge');
    process.exit(1);
  }
  const { files, missing } = await resolveSharedFiles();
  if (missing.length) {
    console.error('these imports do not resolve in packages/shared/src: ' + missing.join(', '));
    process.exit(1);
  }
  console.log(check
    ? 'edge function copies are in sync (' + files.length + ' modules reached from ' + ENTRY + ')'
    : 'edge function synced: ' + files.join(', '));
}
