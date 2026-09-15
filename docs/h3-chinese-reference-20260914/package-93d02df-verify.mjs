import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '../..');
const desktop = path.join(root, 'particle-editor-desktop');
const require = createRequire(path.join(desktop, 'package.json'));
const installer = path.join(desktop, 'dist/NovaFlow Setup 2.3.214.exe');
const extracted = path.join(import.meta.dirname, 'package-93d02df-extracted');
const files = [
  'package.json', 'main.js', 'preload.js',
  'main/h3-reference-nodes.py', 'main/minimax-h3-runtime-lifecycle.js',
  'prompt-assistant-service.py', 'prompt_assistant/h3_prompt_enhance.py',
  'prompt_assistant/h3_reference_vision.py', 'prompt_assistant/h3_prompt_enhance_policy.json',
  'admin-server/h3-prompt-enhance.js', 'admin-server/server.js',
  'renderer/h3-prompt-format.js', 'renderer/ai-sequence-minimax-h3-prompt.workflow.js',
  'renderer/ai-sequence-minimax-h3.workflow.js', 'renderer/novaflow-smart-ai.js',
  'renderer/assets/index-BbIa-2NM.js', 'renderer/index.html'
];
assert.ok(!fs.existsSync(extracted), 'Use a fresh extraction directory');
const extraction = spawnSync(require('7zip-bin').path7za, [
  'x', installer, '-o' + extracted, '-y', ...files.map(f => 'resources/app/' + f)
], { encoding: 'utf8' });
fs.writeFileSync(path.join(import.meta.dirname, 'package-93d02df-extraction.log'), extraction.stdout + extraction.stderr);
assert.equal(extraction.status, 0, 'Installer extraction failed');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const results = files.map(file => {
  const source = file.startsWith('renderer/') ? path.join(root, 'particle-editor', file.slice(9)) : path.join(desktop, file);
  const packed = path.join(extracted, 'resources/app', file);
  const unpacked = path.join(desktop, 'dist/win-unpacked/resources/app', file);
  const sourceHash = hash(source);
  if (file === 'package.json') {
    // electron-builder normalizes package metadata; verify the runtime contract.
    const sourcePackage = JSON.parse(fs.readFileSync(source, 'utf8'));
    const packedPackage = JSON.parse(fs.readFileSync(packed, 'utf8'));
    assert.equal(packedPackage.version, '2.3.214');
    assert.equal(packedPackage.main, sourcePackage.main);
    assert.equal(hash(packed), hash(unpacked));
    return { file, version: packedPackage.version, sha256: hash(packed), match: true };
  }
  assert.equal(hash(packed), sourceHash, file + ' installer/source mismatch');
  assert.equal(hash(unpacked), sourceHash, file + ' unpacked/source mismatch');
  return { file, sha256: sourceHash, match: true };
});
const stat = fs.statSync(installer);
const report = {
  ok: true, sourceCommit: '93d02df', installer, version: '2.3.214', bytes: stat.size,
  modified: stat.mtime.toISOString(), sha256: hash(installer), files: results,
  runtimeCheck: 'PASS', desktopEntry: 'Not revalidated; prior 4783 startup was blocked by policy'
};
fs.writeFileSync(path.join(import.meta.dirname, 'package-93d02df-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, files: results.length }, null, 2));
