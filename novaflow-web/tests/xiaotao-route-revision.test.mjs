import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');
const match=source.match(/captureContext:\s*(\(\)\s*=>\s*\(\{[\s\S]*?generationSurface:[\s\S]*?\}\))/);
assert.ok(match,'real captureContext implementation must be available');
test('captureContext provides a value snapshot of the primary switch token',()=>{
  const ctx={ART_GENERATE_REFERENCE_REVISION:0,PRIMARY_SWITCH_TOKEN:7,ART_GENERATE_STATE:{prompt:'keep'},artGenerateReferences:()=>[],artGenerateReferenceLimit:()=>3,
    document:{body:{classList:{contains:()=>true}}},window:{NovaFlowUiDesignDrawing:{isActive:()=>false}}};
  const capture=vm.runInNewContext(match[1],ctx);const original=capture();assert.equal(original.routeRevision,7);assert.equal(original.generationSurface,'drawing');
  ctx.PRIMARY_SWITCH_TOKEN++;const next=capture();assert.equal(next.routeRevision,8);assert.equal(original.routeRevision,7);
  ctx.window.NovaFlowUiDesignDrawing.isActive=()=>true;ctx.PRIMARY_SWITCH_TOKEN++;assert.equal(capture().generationSurface,'ui');assert.equal(capture().routeRevision,9);
});
test('real primary and secondary routes advance the same token',()=>{
  const hits=[...source.matchAll(/PRIMARY_SWITCH_TOKEN\s*\+=\s*1/g)].length;
  assert.ok(hits>=2,`expected primary and secondary switch updates, got ${hits}`);
});
