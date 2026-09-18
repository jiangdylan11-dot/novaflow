const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSpine } = require('../../tools/qwen-rapid-migration-smoke.cjs');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('retired wash has no UI action, workflow, debug entry or dedicated service branch', () => {
  for (const file of ['particle-editor/spine-split-runtime.js', 'particle-editor-desktop/main.js', 'particle-editor-desktop/prompt-assistant-service.py', 'tools/preview_runtime_server.py', 'scripts/sync-runtime.mjs', 'scripts/check-runtime-sync.mjs']) {
    assert.doesNotMatch(read(file), /imageWash|IMAGE_WASH|image.wash.style|usesWashStyleAnalysis|wanWashRuntimeFiles|buildWanSourceRedraw|洗图/, file);
  }
  for (const file of ['main/wan-wash-runtime.js', 'main/wan-wash-node/__init__.py', 'main/wan-wash-node/sampler.py']) {
    assert.equal(fs.existsSync(path.join(root, 'particle-editor-desktop', file)), false, file);
  }
  const s = loadSpine('particle-editor/spine-split-runtime.js');
  for (const name of ['showImageWashDialog','runImageWash','executeImageWashTool','buildWanImageWashWorkflow','buildWanSourceRedrawWorkflow']) assert.equal(s[name], undefined);
});

