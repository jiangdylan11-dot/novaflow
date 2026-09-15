'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/wan-vs-smoothmix-wash-validation');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'docs/smoothmix-t2v-v4-multistyle-validation/fixtures.json'), 'utf8'));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'fixtures.json'), JSON.stringify(fixtures, null, 2));
for (const fixture of fixtures) {
  const folder = path.join(output, fixture.id);
  fs.mkdirSync(folder, { recursive: true });
  const input = path.join(folder, 'input-definition.json');
  fs.writeFileSync(input, JSON.stringify(fixture, null, 2));
  const pending = ['low', 'medium', 'high'].filter(level => {
    const record = path.join(folder, `original-wan-${fixture.id}-beta-7-cfg1-shift8-${level}-run.json`);
    return !fs.existsSync(record) || JSON.parse(fs.readFileSync(record, 'utf8')).status !== 'success';
  });
  if (!pending.length) { console.log('Already completed', fixture.id); continue; }
  const env = { ...process.env, NF_WASH_MODEL_FAMILY: 'original-wan', NF_SMOOTH_T2V_FIXTURE: input,
    NF_SMOOTH_T2V_OUTPUT: folder, NF_SMOOTH_T2V_CASES: pending.join(','), NF_SMOOTH_T2V_SCHEDULER: 'beta',
    NF_SMOOTH_T2V_STEPS: '7', NF_SMOOTH_T2V_CFG: '1', NF_SMOOTH_T2V_SHIFT: '8', NF_SMOOTH_T2V_PROMPT: 'baseline',
    NF_SMOOTH_T2V_NOTE: 'Original NovaFlow Wan recipe including its external acceleration LoRA. Matches SmoothMix source, base caption, seed, size and sampler settings; anime-only SmoothMix trigger omitted for original Wan.' };
  delete env.NF_SMOOTH_T2V_STRENGTH;
  console.log('Starting original Wan', fixture.id, pending.join(','));
  const result = spawnSync(process.execPath, [path.join(__dirname, 'smoothmix-t2v-image-wash-smoke.cjs')], { cwd: root, stdio: 'inherit', windowsHide: true, env });
  if (result.error || result.status !== 0) { console.error(result.error || `Original Wan ${fixture.id} exited ${result.status}`); process.exitCode = result.status || 1; break; }
}
