// Inspect extracted installer resources, not source build configuration alone.
import assert from 'node:assert/strict';
import { readFile, readdir, access, writeFile } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { WORKFLOW_MODULES } from '../packages/shared/src/workflow-modules.mjs';
import { COMPUTE_RENDERER_FILES } from './prepare-compute-renderer.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resources = resolve(process.argv[2] || join(root, 'worker/dist-compute/win-unpacked/resources'));
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(full); else files.push(relative(resources, full).replaceAll('\\', '/'));
  }
}
await walk(resources);
const forbidden = files.filter(name => /(?:^|\/)(?:web-dist|worker-renderer|\.secrets)(?:\/|$)|spine-(?:auto|skeleton|bones|mesh-edit|binary|structure)|(?:local-(?:assistant|server|license|tasks)|control-plane|pricing)\.(?:mjs|js)$/.test(name));
assert.deepEqual(forbidden, [], 'public package must not contain local editor or server control source');
const packageJson = JSON.parse(await readFile(join(resources, 'app/package.json'), 'utf8'));
assert.equal(packageJson.main, 'electron/compute-main.cjs');
assert.equal(packageJson.computeOnly, true);
const manifest = JSON.parse(await readFile(join(resources, 'compute-renderer/compute-manifest.json'), 'utf8'));
assert.equal(manifest.version, packageJson.version);
assert.deepEqual((await readdir(join(resources, 'compute-renderer'))).sort(), [...COMPUTE_RENDERER_FILES, 'compute-manifest.json'].sort());
assert.deepEqual(manifest.files.map(item => item.file).sort(), [...COMPUTE_RENDERER_FILES].sort());
for (const item of manifest.files) {
  const code = await readFile(join(resources, 'compute-renderer', item.file));
  assert.equal(createHash('sha256').update(code).digest('hex'), item.sha256, item.file);
}
// Check actual shipped static relative imports. Built-ins and dynamic resource
// paths are intentionally not treated as source modules.
for (const name of files.filter(name => /\.(?:mjs|cjs)$/.test(name))) {
  const full = join(resources, name), code = await readFile(full, 'utf8');
  for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\(\s*)['"](\.[^'"]+\.(?:mjs|cjs|json))['"]/g)) {
    await access(resolve(dirname(full), match[1]));
  }
}
const { createWorkflowHost } = await import(pathToFileURL(join(resources, 'app/src/comfy/workflow-host.mjs')).href);
const host = await createWorkflowHost({ rendererDir: join(resources, 'compute-renderer') });
for (const [module, specification] of Object.entries(WORKFLOW_MODULES)) {
  const available = new Set([...host.buildersFor(module), ...(host.describe(module)?.functions || [])]);
  for (const method of specification.methods) assert(available.has(method), module + '.' + method);
}
const report = { version: packageJson.version, profile: 'compute-only', files: files.length,
  workflowFiles: manifest.files.length, builders: host.builderCount, forbidden, residualBuilderClosures: manifest.residualBuilderClosures,
  encrypted: false, checkedResources: resources };
if (process.argv[3]) await writeFile(resolve(process.argv[3]), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
