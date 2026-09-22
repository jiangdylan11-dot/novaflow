import assert from 'node:assert/strict';
import { readFile, realpath, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(await realpath(gitDir), await realpath(join(root, '.git')), 'Git must belong to this project');
try { await access(join(gitDir, 'objects/info/alternates')); throw new Error('External Git object alternates are not allowed'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const contained = async path => {
  const actual = await realpath(path);
  assert(actual.startsWith(root + sep), 'Dependency leaves this checkout: ' + path);
};
for (const file of ['novaflow-web/admin/admin-main.js', 'novaflow-web/admin/license-admin-gui/admin-data.js', 'particle-editor-desktop/license-core.js', 'novaflow-web/worker/electron/main.cjs', 'novaflow-web/web-dist/index.html']) await contained(join(root, file));
for (const name of ['novaflow-web-warehouse.js', 'novaflow-web-runtime.js', 'novaflow-web-account.js', 'novaflow-web-capabilities.js']) {
  assert.equal(await readFile(join(root, 'novaflow-web/renderer', name), 'utf8'), await readFile(join(root, 'novaflow-web/web-dist', name), 'utf8'), 'Web runtime needs rebuild: ' + name);
}
const worker = JSON.parse(await readFile(join(root, 'novaflow-web/worker/electron-builder.json'), 'utf8'));
for (const resource of worker.extraResources) await contained(resolve(root, 'novaflow-web/worker', resource.from));
const main = await readFile(join(root, 'novaflow-web/admin/admin-main.js'), 'utf8');
assert(main.includes('novaflow-license-manager'), 'Preserve installed admin configuration identity');
console.log('PASS: independent Git, in-project admin/launcher dependencies and current Web runtime files');
