const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('failed refresh invalidates the prior revision and prevents stale form submission', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../license-admin-gui/renderer.js'), 'utf8');
  const first = source.indexOf('let featureCreditConfigRevision = null;');
  const last = source.indexOf('\nfunction ledgerQueryPayload()', first);
  assert.ok(first >= 0 && last > first);
  let fail = false, writes = 0;
  const status = { textContent: '' }, panel = { contains: () => false };
  const context = {
    window: { adminAPI: {
      async getFeatureCreditAdmin() { return fail ? { error: 'unavailable' } : { configRevision: 'current-revision', config: {}, domesticBalance: {}, lowBalance: {} }; },
      async saveFeatureCreditAdmin() { writes++; return { ok: true }; }
    } },
    document: { activeElement: null, querySelectorAll: () => [] },
    $: id => id === 'featureCreditPanel' ? panel : id === 'featureCreditStatus' ? status : null,
    renderFeaturePriceFields() {}, renderTokenEstimateFields() {}, setIfIdle() {}, renderSettingRows() {}, renderDashboardRhCard() {},
    formatUsdAmount: value => String(value), formatDateTime: value => String(value)
  };
  vm.runInNewContext(source.slice(first, last) + '\nthis.read = renderFeatureCreditAdmin; this.save = saveFeatureCreditForm;', context);
  assert.equal(await context.read(), true);
  fail = true;
  assert.equal(await context.read(), false);
  await context.save();
  assert.equal(writes, 0);
  assert.match(status.textContent, /读取最新/);
});
