// A style run places its subject picture again with its size already known; the
// "size still loading" flag must still clear, or 小桃 stops with 参考图尺寸仍在读取.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../renderer/novaflow-brand-runtime.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const pick = (name) => {
  const start = source.indexOf(`\n  function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  }\n', start);
  return source.slice(start, end + 4);
};
const build = () => new Function('ctx', `
  let ART_GENERATE_REFERENCE_REVISION = 0; const ART_GENERATE_MAX_REFERENCES = 3, ART_GENERATE_REFERENCE_SIZE_PENDING = new Set();
  const ART_GENERATE_STATE = ctx.state;
  const artGenerateReferences = () => ART_GENERATE_STATE.references;
  const releaseArtReferenceObjectUrl = () => {};
  const artGenerateImg2imgCapability = () => ({ engine: 'qwen-2.1' });
  const artGenerateReferenceSizeToken = (i, d) => i + ':' + d;
  const measureArtGenerateReferenceSize = ctx.measure;
  const applyArtGenerateReferenceResolution = (i) => { const r = ART_GENERATE_STATE.references[i]; ART_GENERATE_STATE.width = r.width; ART_GENERATE_STATE.height = r.height; return true; };
  const renderArtGenerateSurfaces = () => {};
  ${['setArtGenerateReference', 'settleArtGenerateReferenceSizeFill', 'readArtGenerateReferenceSize', 'ensureArtGenerateReferenceSize'].map(pick).join('\n')}
  return { setArtGenerateReference, ensureArtGenerateReferenceSize };
`);
const tick = () => new Promise((r) => setTimeout(r, 0));

{ // re-placing a measured reference clears the flag by itself and fills W/H
  const state = { references: [null, null, null], width: 512, height: 512 };
  const rt = build()({ state, measure: async () => null });
  rt.setArtGenerateReference(0, { dataUrl: 'blob:new', width: 720, height: 1280 });
  assert.equal(state.referenceSizeFillPending, 'blob:new');
  await tick();
  assert.equal(state.referenceSizeFillPending, '');
  assert.deepEqual([state.width, state.height], [720, 1280]);
}
{ // a caller that resets the flag in the same step keeps its own value (upload transaction)
  const state = { references: [null, null, null], width: 512, height: 512 };
  const rt = build()({ state, measure: async () => null });
  rt.setArtGenerateReference(0, { dataUrl: 'data:a', width: 720, height: 1280 });
  state.referenceSizeFillPending = '';
  await tick();
  assert.deepEqual([state.width, state.height], [512, 512]);
}
{ // a new picture is measured, then the flag clears
  const state = { references: [null, null, null], width: 512, height: 512 };
  const rt = build()({ state, measure: async () => ({ width: 600, height: 800 }) });
  rt.setArtGenerateReference(0, { dataUrl: 'blob:fresh' });
  assert.equal(rt.ensureArtGenerateReferenceSize(0, state.references[0]), null);
  await tick(); await tick();
  assert.equal(state.referenceSizeFillPending, '');
  assert.deepEqual([state.width, state.height], [600, 800]);
}
{ // a picture that fails to decode ends the wait instead of blocking forever
  const state = { references: [null, null, null], width: 512, height: 512 };
  const rt = build()({ state, measure: async () => null });
  rt.setArtGenerateReference(0, { dataUrl: 'blob:broken' });
  rt.ensureArtGenerateReferenceSize(0, state.references[0]);
  await tick(); await tick();
  assert.equal(state.referenceSizeFillPending, '');
}
console.log('art-reference-size-fill-settle ok');
