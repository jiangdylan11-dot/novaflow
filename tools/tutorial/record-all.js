/* Record several tutorials back to back, then rebuild the hub.
 *
 *   node tools/tutorial/record-all.js                 # every scenario
 *   node tools/tutorial/record-all.js cutout upscale  # just these
 *   node tools/tutorial/record-all.js --keep-frames   # keep frames for re-encoding
 *
 * They run one at a time on purpose: each one drives the same runtime and the
 * same GPU, so overlapping them would fight for both.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ELECTRON = path.join(__dirname, '..', '..', 'particle-editor-desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
const SCEN_DIR = path.join(__dirname, 'scenarios');

const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const all = fs.readdirSync(SCEN_DIR)
  .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
  .map((f) => f.replace(/\.js$/, ''));

const list = named.length ? named : all;
const missing = list.filter((id) => !all.includes(id));
if (missing.length) {
  console.error('[batch] no such scenario:', missing.join(', '));
  process.exit(2);
}

console.log('[batch]', list.length, 'scenario(s):', list.join(', '));

const results = [];
for (const id of list) {
  const started = Date.now();
  process.stdout.write('\n[batch] ==> ' + id + '\n');
  const res = spawnSync(ELECTRON, [__dirname, '--scenario=' + id].concat(flags), {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..', '..')
  });
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  results.push({ id, ok: res.status === 0, secs });
}

console.log('\n[batch] done');
results.forEach((r) => console.log('  ' + (r.ok ? 'ok  ' : 'FAIL') + '  ' + r.id + '  ' + r.secs + 's'));

spawnSync(process.execPath, [path.join(__dirname, 'build-index.js')], {
  stdio: 'inherit',
  env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' })
});

const failed = results.filter((r) => !r.ok);
if (failed.length) process.exitCode = 1;
