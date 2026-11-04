import assert from 'node:assert/strict';
import { readFile, realpath, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

// Existing default check is preserved. This digest must be replaced after the
// final source, site output, and manifest are reviewed and frozen. There is no
// env/CLI override: an unbound candidate can never report isolated PASS.
const FROZEN_271_MANIFEST_SHA256 = 'b6f927f81b7805ca06acfd5aeb4acc3edc1ec3cfc7188864a32134fe25ba9b14';
const FROZEN_271_DIR = 'work/qa-pilot-271-release-preflight/frozen-release';
const FROZEN_271_MANIFEST = 'runtime-manifest.json';
const RUNTIME_FILES = Object.freeze(['novaflow-web-warehouse.js', 'novaflow-web-runtime.js', 'novaflow-web-account.js', 'novaflow-web-capabilities.js', 'novaflow-web-compute-node.js']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hexHash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);

export async function runtimeFileMatches(name, source, generated) {
  if (source === generated) return true;
  try {
    const output = await minify({ [name]: source }, {
      module: false,
      compress: { passes: 2 },
      mangle: { toplevel: false },
      format: { comments: false, ascii_only: true, ecma: 2020 }
    });
    return typeof output?.code === 'string' && output.code.length > 0 && output.code === generated;
  } catch {
    return false;
  }
}

// The generic function is exported for fixture testing; the command-line
// path below always supplies the hard-coded manifest hash and fixed directory.
export async function verifyFrozenRuntime({ root, frozenDir, expectedManifestHash }) {
  assert(hexHash(expectedManifestHash), '271 runtime manifest digest not locked');
  const realRoot = await realpath(root);
  const fixedDir = await realpath(frozenDir);
  assert(fixedDir.startsWith(realRoot + sep), 'Frozen directory leaves checkout');
  const manifestPath = await realpath(join(fixedDir, FROZEN_271_MANIFEST));
  assert(manifestPath.startsWith(fixedDir + sep), 'Manifest leaves frozen directory');
  const manifestBytes = await readFile(manifestPath);
  assert.equal(sha256(manifestBytes), expectedManifestHash, 'Frozen manifest hash mismatch');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['files', 'version']);
  assert.equal(manifest.version, '2.0.271');
  assert(Array.isArray(manifest.files) && manifest.files.length === RUNTIME_FILES.length, 'Expected exactly five runtime files');
  const names = manifest.files.map(x => x?.name);
  assert.deepEqual([...names].sort(), [...RUNTIME_FILES].sort(), 'Runtime names mismatch or duplicate');
  const seenPaths = new Set();
  const checkedFile = async (relative, expected) => {
    assert(typeof relative === 'string' && relative.length > 0 && !isAbsolute(relative), 'Invalid frozen relative path');
    assert(hexHash(expected), 'Invalid frozen content hash');
    const resolved = await realpath(resolve(fixedDir, relative));
    assert(resolved.startsWith(fixedDir + sep), 'Runtime path leaves frozen directory');
    assert(!seenPaths.has(resolved), 'Duplicate frozen content path');
    seenPaths.add(resolved);
    const content = await readFile(resolved);
    assert.equal(sha256(content), expected, 'Frozen content hash mismatch: ' + relative);
    return content.toString('utf8');
  };
  for (const file of manifest.files) {
    assert.deepEqual(Object.keys(file).sort(), ['generated', 'generatedSha256', 'name', 'source', 'sourceSha256']);
    const source = await checkedFile(file.source, file.sourceSha256);
    const generated = await checkedFile(file.generated, file.generatedSha256);
    assert(await runtimeFileMatches(file.name, source, generated), 'Frozen runtime needs rebuild: ' + file.name);
  }
}

async function checkWorkspace(mode) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const gitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  const checkoutRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(await realpath(checkoutRoot), await realpath(root), 'Git checkout must belong to this project');
  try { await access(join(gitDir, 'objects/info/alternates')); throw new Error('External Git object alternates are not allowed'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const contained = async path => {
    const actual = await realpath(path);
    assert(actual.startsWith(root + sep), 'Dependency leaves this checkout: ' + path);
  };
  for (const file of ['novaflow-web/admin/admin-main.js', 'novaflow-web/admin/license-admin-gui/admin-data.js', 'particle-editor-desktop/license-core.js', 'novaflow-web/worker/electron/compute-main.cjs', 'novaflow-web/web-dist/index.html']) await contained(join(root, file));
  if (mode === '--isolated-frozen-271') {
    await verifyFrozenRuntime({ root, frozenDir: join(root, FROZEN_271_DIR), expectedManifestHash: FROZEN_271_MANIFEST_SHA256 });
  } else {
    for (const name of RUNTIME_FILES) {
      const source = await readFile(join(root, 'novaflow-web/renderer', name), 'utf8');
      const generated = await readFile(join(root, 'novaflow-web/web-dist', name), 'utf8');
      assert(await runtimeFileMatches(name, source, generated), 'Web runtime needs rebuild: ' + name);
    }
  }
  const worker = JSON.parse(await readFile(join(root, 'novaflow-web/worker/electron-builder-compute.json'), 'utf8'));
  for (const resource of worker.extraResources) await contained(resolve(root, 'novaflow-web/worker', resource.from));
  const main = await readFile(join(root, 'novaflow-web/admin/admin-main.js'), 'utf8');
  assert(main.includes('novaflow-license-manager'), 'Preserve installed admin configuration identity');
  console.log(mode === '--isolated-frozen-271'
    ? 'PASS: independent Git and in-project dependencies; isolated frozen 271 runtime'
    : 'PASS: independent Git, in-project admin/launcher dependencies and current Web runtime files');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === '--isolated-frozen-271'), 'Unexpected checker arguments');
  await checkWorkspace(args[0]);
}
