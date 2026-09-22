// Copy the shared control-plane modules into the edge function folder.
//
// Supabase bundles a function from its own directory, so the shared sources
// must physically live there at deploy time. Copying (rather than maintaining
// a second implementation) is what keeps the deployed function and the locally
// tested one byte-identical; this script is run before every deploy and the
// test suite asserts the copies are in sync.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = join(ROOT, 'packages/shared/src');
const DEST = join(ROOT, 'supabase/functions/novaflow-web');

const SHARED_FILES = [
  'protocol.mjs',
  'tokens.mjs',
  'pricing.mjs',
  'model-manifest.mjs',
  'control-plane.mjs'
];

const BANNER = `// GENERATED COPY - do not edit here.
// Source: packages/shared/src/%NAME%
// Regenerate with: npm run sync:edge
`;

export async function syncEdgeFunction({ check = false } = {}) {
  const drift = [];
  for (const name of SHARED_FILES) {
    const source = await readFile(join(SRC, name), 'utf8');
    const wanted = BANNER.replace('%NAME%', name) + source;
    let current = '';
    try { current = await readFile(join(DEST, name), 'utf8'); } catch { current = ''; }
    if (current !== wanted) {
      if (check) {
        drift.push({
          file: name,
          sourceSha: sha(source),
          copySha: current ? sha(current) : null
        });
      } else {
        await writeFile(join(DEST, name), wanted, 'utf8');
      }
    }
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
    for (const d of drift) console.error('  ' + d.file + '  source=' + d.sourceSha + ' copy=' + (d.copySha || 'missing'));
    console.error('run: npm run sync:edge');
    process.exit(1);
  }
  const files = await readdir(DEST);
  console.log(check ? 'edge function copies are in sync' : 'edge function synced: ' + files.join(', '));
}
