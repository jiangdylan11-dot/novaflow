import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { inspectXiaotaoV3StyleReply, canonicalizeXiaotaoV3StyleIntent, STYLE_OUTPUT_TOKENS } = await import('../packages/shared/src/xiaotao-style-framework-v3.mjs');

test('UI 拆图 recognition reads the asset list into candidate boxes (ui-layers)', () => {
  assert.equal(STYLE_OUTPUT_TOKENS['ui-layers'], 6000);
  // A real long answer: one bbox lost its comma ("[408, 816 595 907]") and the tail is fine.
  const reply = '{"assets":[{"name": "jackpot_plate", "kind": "panel", "bbox": [33, 104, 254, 148], "parent": ""},'
    + '{"name": "jackpot_text", "kind": "text", "bbox": [66, 99, 219, 147], "parent": "jackpot_plate", "text": "GRAND 5000"},'
    + '{"name": "spin_button", "kind": "element", "bbox": [408, 816 595 907], "parent": ""},'
    + '{"name": "miner", "kind": "prop", "bbox": "600,300,400,700", "parent": ""},'
    + '{"name": "whole", "kind": "panel", "bbox": [0, 0, 1000, 1000], "parent": ""},'
    + '{"name": "cut off", "kind": "element", "bbox": [1, 2';
  const { proposal } = inspectXiaotaoV3StyleReply({ kind: 'ui-layers', reply });
  assert.equal(proposal.schema, 'nf.ui.split.v1');
  assert.deepEqual(proposal.regions.map(r => [r.name, r.kind, r.box]), [
    ['jackpot_plate', 'panel', [33, 104, 254, 148]],
    ['jackpot_text', 'text', [66, 99, 219, 147]],
    ['spin_button', 'object', [408, 816, 595, 907]],
    ['miner', 'prop', [400, 300, 600, 700]],
  ]);
  assert.equal(proposal.regions[1].parentId, 'r1');
  assert.equal(proposal.regions[1].text, 'GRAND 5000');
  assert.throws(() => inspectXiaotaoV3StyleReply({ kind: 'ui-layers', reply: 'no assets here' }));
});

test('the web overlay validates what the server returns', () => {
  require('../renderer/ui-smart-split.core.js');
  const core = globalThis.NovaFlowUiSmartSplitCore;
  const { proposal } = inspectXiaotaoV3StyleReply({ kind: 'ui-layers', reply: '{"assets":[{"name":"a","kind":"element","bbox":[1,2,30,40],"parent":""}]}' });
  assert.equal(core.validate(proposal).regions[0].kind, 'object');
});

test('ui-layers intent asks with the screen as reference and the lab prompt', () => {
  const png = readFileSync(new URL('./fixtures/ui-layer-split-screen.png', import.meta.url)).toString('base64');
  const { compiled } = canonicalizeXiaotaoV3StyleIntent({ mode: 'style-analysis', requestId: 'req_ui_layers_1', kind: 'ui-layers', images: [{ role: 'reference', dataUrl: 'data:image/png;base64,' + png }] });
  assert.equal(compiled.outputTokens, 6000);
  assert.match(compiled.userText, /one entry per asset/);
  assert.equal(compiled.imageCount, 1);
});

test('edge copy matches the shared source', () => {
  const source = readFileSync(new URL('../packages/shared/src/xiaotao-style-framework-v3.mjs', import.meta.url), 'utf8');
  const edge = readFileSync(new URL('../supabase/functions/_art-shared/xiaotao-style-framework-v3.mjs', import.meta.url), 'utf8');
  assert.equal(edge, '// GENERATED COPY - source: packages/shared/src/xiaotao-style-framework-v3.mjs\n' + source);
});

test('the long box list may wait for the model longer than other reads', () => {
  const chat = readFileSync(new URL('../packages/shared/src/xiaotao-operation-v3-chat.mjs', import.meta.url), 'utf8');
  const assembly = readFileSync(new URL('../packages/shared/src/companion-operation-v3-assembly.mjs', import.meta.url), 'utf8');
  assert.match(chat, /intent\.kind==='ui-layers'\?\{long:true\}/);
  assert.match(assembly, /LONG_ONLINE_MODEL_TIMEOUT_MS=240000/);
});
