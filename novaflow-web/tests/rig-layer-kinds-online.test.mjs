import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { inspectXiaotaoV3StyleReply, canonicalizeXiaotaoV3StyleIntent, STYLE_OUTPUT_TOKENS } = await import('../packages/shared/src/xiaotao-style-framework-v3.mjs');

// A minimal baseline JPEG header: SOI, SOF0 with the given size, EOI.
const jpeg = (width, height) => {
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]).toString('base64');
};
const intent = dataUrl => ({ mode: 'style-analysis', requestId: 'req_rig_layers_1', kind: 'rig-layers', images: [{ role: 'reference', dataUrl }] });

test('自动架设 layer recognition reads number → kind pairs (rig-layers)', () => {
  assert.equal(STYLE_OUTPUT_TOKENS['rig-layers'], 900);
  const { kinds } = inspectXiaotaoV3StyleReply({ kind: 'rig-layers', reply: '```json\n{"1":"hair","2":"Dangle","3":"wing","4":"body","1":"face","5":"clo' });
  assert.deepEqual(kinds, { 1: 'hair', 2: 'dangle', 4: 'body' });
  assert.throws(() => inspectXiaotaoV3StyleReply({ kind: 'rig-layers', reply: '看不出来' }));
});

test('the sheet is a JPEG up to 2048 per side, asked with the lab prompt', () => {
  const { compiled } = canonicalizeXiaotaoV3StyleIntent(intent(jpeg(1800, 1050)));
  assert.equal(compiled.outputTokens, 900);
  assert.match(compiled.userText, /每格左上角有黄色编号/);
  assert.throws(() => canonicalizeXiaotaoV3StyleIntent(intent(jpeg(2400, 1050))), /image-size/);
  const png = readFileSync(new URL('./fixtures/ui-layer-split-screen.png', import.meta.url)).toString('base64');
  assert.throws(() => canonicalizeXiaotaoV3StyleIntent(intent('data:image/png;base64,' + png)));
});

test('the page provides FoartRigLayerKinds on the online style-analysis route', () => {
  const runtime = readFileSync(new URL('../renderer/novaflow-web-runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /root\.FoartRigLayerKinds = async \(dataUrl, count\)/);
  assert.match(runtime, /purpose: 'rig-layers'/);
  assert.match(runtime, /kind==='rig-layers'\?900/);
  // the sheet must reach the server as the JPEG it validates (it was re-encoded to a 768 px PNG and refused: operation-style-invalid)
  assert.match(runtime, /kind==='rig-layers'\?await prepareOnlineStyleImage\(intent\.images\[0\]\.dataUrl,\{maxSide:2048,type:'image\/jpeg'\}\)/);
});
