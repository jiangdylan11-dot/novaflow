import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function syncButtonTheme({ check = false } = {}) {
  for (const file of ['foart-button-theme.css', 'foart-button-theme.js']) {
    const source = await readFile(resolve(root, 'renderer', file));
    for (const dir of ['worker/electron', 'admin/license-admin-gui']) {
      const target = resolve(root, dir, file);
      let current;
      try { current = await readFile(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (current?.equals(source)) continue;
      if (check) throw Error(`Button theme drift: ${dir}/${file}`);
      await writeFile(target, source);
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await syncButtonTheme({ check: process.argv.includes('--check') });
