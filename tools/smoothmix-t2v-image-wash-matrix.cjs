'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/smoothmix-t2v-v4-multistyle-validation');
const fixtures = JSON.parse(fs.readFileSync(path.join(output, 'fixtures.json'), 'utf8'));
for (const fixture of fixtures) {
  const folder = path.join(output, fixture.id);
  fs.mkdirSync(folder, { recursive: true });
  const definition = path.join(folder, 'input-definition.json');
  fs.writeFileSync(definition, JSON.stringify(fixture, null, 2));
  console.log('Starting', fixture.id);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'smoothmix-t2v-image-wash-smoke.cjs')], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, NF_SMOOTH_T2V_FIXTURE: definition, NF_SMOOTH_T2V_OUTPUT: folder,
      NF_SMOOTH_T2V_CASES: 'low,medium,high', NF_SMOOTH_T2V_SCHEDULER: 'beta', NF_SMOOTH_T2V_STEPS: '7',
      NF_SMOOTH_T2V_CFG: '1', NF_SMOOTH_T2V_SHIFT: '8', NF_SMOOTH_T2V_PROMPT: 'baseline' },
  });
  if (result.error || result.status !== 0) {
    console.error(result.error || `Fixture ${fixture.id} exited ${result.status}`);
    process.exitCode = result.status || 1;
    break;
  }
}
