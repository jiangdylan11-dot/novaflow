// Copy the shared modules novaflow-backend imports into supabase/functions/_art-shared.
//
// Supabase bundles each Edge function from supabase/functions. A relative import
// that reaches novaflow-web/packages/shared is outside that bundle and the
// function cannot deploy. Directories whose names start with "_" are not
// deployed as their own functions, which is the same layout companion uses.
//
// The file list is derived from ../_art-shared/ imports under
// supabase/functions/novaflow-backend, then from relative imports inside those
// shared sources. Copies stay byte-identical to packages/shared/src.
//
// Before deploying novaflow-backend:
//   node novaflow-web/tools/sync-novaflow-backend-shared.mjs
//   node novaflow-web/tools/sync-novaflow-backend-shared.mjs --check

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relativeImports } from './sync-edge-function.mjs';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webRoot, '..');
const src = join(webRoot, 'packages/shared/src');
const dest = join(repoRoot, 'supabase/functions/_art-shared');
const functionDir = join(repoRoot, 'supabase/functions/novaflow-backend');
const check = process.argv.includes('--check');
const sharedImport = /['"]\.\.\/_art-shared\/([^'"]+)['"]/g;

async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sourceFiles(path));
    else if (/\.(mjs|js|ts)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(path);
  }
  return out;
}

const queue = [];
for (const file of await sourceFiles(functionDir)) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(sharedImport)) queue.push(match[1]);
}
if (!queue.length) throw new Error('novaflow-backend imports no ../_art-shared modules');

const seen = new Set();
await mkdir(dest, { recursive: true });
while (queue.length) {
  const name = queue.shift();
  if (seen.has(name) || name.includes('..') || name.startsWith('/')) continue;
  seen.add(name);
  let source;
  try {
    source = await readFile(join(src, name), 'utf8');
  } catch {
    throw new Error('novaflow-backend shared source missing: packages/shared/src/' + name);
  }
  const wanted = '// GENERATED COPY - source: packages/shared/src/' + name + '\n' + source;
  const copyPath = join(dest, name);
  if (check) {
    let current = '';
    try { current = await readFile(copyPath, 'utf8'); }
    catch { throw new Error('novaflow-backend shared copy missing: ' + name + '. Run: node novaflow-web/tools/sync-novaflow-backend-shared.mjs'); }
    // Git may check generated copies out as CRLF on Windows; compare their source
    // content without treating that checkout conversion as an implementation drift.
    if (current.replace(/\r\n/g, '\n') !== wanted.replace(/\r\n/g, '\n')) throw new Error('novaflow-backend shared copy drift: ' + name + '. Run: node novaflow-web/tools/sync-novaflow-backend-shared.mjs');
  } else {
    await mkdir(dirname(copyPath), { recursive: true });
    await writeFile(copyPath, wanted);
  }
  for (const dep of relativeImports(source)) queue.push(dep);
}

console.log('novaflow-backend shared copies ' + (check ? 'verified' : 'synced') + ': ' + [...seen].sort().join(', '));
