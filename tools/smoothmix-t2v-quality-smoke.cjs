'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/smoothmix-t2v-v4-quality-validation');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'docs/smoothmix-t2v-v4-multistyle-validation/fixtures.json'), 'utf8')).filter(f => ['anime-fan', 'cyber-portrait'].includes(f.id));
const cases = [
  { id: 'mid-strength', steps: 7, shift: 8, change: 'New 0.35 strength reference; all other settings and prompt match the previous matrix.' },
  { id: 'more-steps', steps: 12, shift: 8, change: 'Only step count changed from 7 to 12 against mid-strength.' },
  { id: 'lower-shift', steps: 12, shift: 3, change: 'Only sampling shift changed from 8 to 3 against more-steps; lower starting sigma at equal denoise.' },
];
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify({ fixtures, cases, strength: 0.35, source: 'Existing sources reused; only new parameter combinations generated.', productionDefaultChanged: false }, null, 2));
for (const fixture of fixtures) {
  for (const test of cases) {
    const folder = path.join(out, fixture.id, test.id);
    fs.mkdirSync(folder, { recursive: true });
    const input = path.join(folder, 'input-definition.json');
    fs.writeFileSync(input, JSON.stringify(fixture, null, 2));
    console.log('Starting', fixture.id, test.id);
    const result = spawnSync(process.execPath, [path.join(__dirname, 'smoothmix-t2v-image-wash-smoke.cjs')], {
      cwd: root, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, NF_SMOOTH_T2V_FIXTURE: input, NF_SMOOTH_T2V_OUTPUT: folder,
        NF_SMOOTH_T2V_CASES: 'medium', NF_SMOOTH_T2V_STRENGTH: '0.35', NF_SMOOTH_T2V_SCHEDULER: 'beta',
        NF_SMOOTH_T2V_STEPS: String(test.steps), NF_SMOOTH_T2V_CFG: '1', NF_SMOOTH_T2V_SHIFT: String(test.shift),
        NF_SMOOTH_T2V_PROMPT: 'baseline', NF_SMOOTH_T2V_NOTE: test.change },
    });
    if (result.error || result.status !== 0) {
      console.error(result.error || `Fixture ${fixture.id}/${test.id} exited ${result.status}`);
      process.exitCode = result.status || 1;
      break;
    }
  }
  if (process.exitCode) break;
}
