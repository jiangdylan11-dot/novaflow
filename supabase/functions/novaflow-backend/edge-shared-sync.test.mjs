import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const functionDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(functionDir, '../../..');
const specifierRe = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sourceFiles(path));
    else if (/\.(mjs|js|ts)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(path);
  }
  return out;
}

function allowedSpecifier(specifier) {
  if (specifier.startsWith('./')) return !specifier.includes('..');
  if (specifier.startsWith('../_art-shared/')) return !specifier.slice('../_art-shared/'.length).includes('..');
  if (specifier.startsWith('npm:') || specifier.startsWith('node:') || specifier.startsWith('https:') || specifier.startsWith('http:')) return true;
  return false;
}

test('novaflow-backend shared copies match packages/shared and stay inside the function bundle', async () => {
  execFileSync(process.execPath, ['novaflow-web/tools/sync-novaflow-backend-shared.mjs', '--check'], { cwd: repoRoot, stdio: 'pipe' });
  const outside = [];
  for (const file of await sourceFiles(functionDir)) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(specifierRe)) {
      if (!allowedSpecifier(match[1])) outside.push(file.slice(functionDir.length + 1) + ' -> ' + match[1]);
    }
  }
  assert.deepEqual(outside, []);
});
