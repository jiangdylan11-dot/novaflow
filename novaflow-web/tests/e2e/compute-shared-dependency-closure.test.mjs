import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {relativeImports} from '../../tools/sync-edge-function.mjs';

const shared=new URL('../../packages/shared/src/',import.meta.url);
const config=JSON.parse(await readFile(new URL('../../worker/electron-builder-compute.json',import.meta.url),'utf8'));
const resource=config.extraResources.find(item=>item.from==='../packages/shared/src'&&item.to==='packages/shared/src');
const entry='xiaotao-ui-framework-v3.mjs';
const generated='xiaotao-ui-professional.generated.mjs';

test('compute package explicitly includes the UI framework and generated rules',()=>{
  assert.ok(resource,'missing compute shared resources');
  assert.ok(Array.isArray(resource.filter));
  assert.ok(resource.filter.includes(entry));
  assert.ok(resource.filter.includes(generated));
  assert.ok(!resource.filter.some(item=>/[?*]/.test(item)),'shared resources must remain an explicit allowlist');
});

test('UI framework relative import closure exists and is in the compute allowlist',async()=>{
  const pending=[entry],seen=new Set();
  while(pending.length){
    const name=pending.shift();if(seen.has(name))continue;
    assert.ok(resource.filter.includes(name),`missing package allowlist entry: ${name}`);
    const source=await readFile(new URL(name,shared),'utf8');seen.add(name);
    assert.doesNotMatch(source,/\b(?:from\s*|import\s*\(\s*)['"]\.\.\//,'shared import escapes its resource directory');
    pending.push(...relativeImports(source));
  }
  assert.deepEqual([...seen].sort(),[entry,generated].sort());
  const actual=await import(new URL(entry,shared));
  assert.equal(typeof actual.canonicalizeXiaotaoV3UiIntent,'function');
  assert.equal(typeof actual.inspectXiaotaoV3UiReply,'function');
});

test('generated UI rules match the current renderer sources',async()=>{
  const {sourceHashes}=await import(new URL(generated,shared));
  for(const name of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js']){
    const content=await readFile(new URL(`../../renderer/${name}`,import.meta.url));
    const sha=createHash('sha256').update(content).digest('hex');
    assert.equal(sha,sourceHashes[name],`generated UI rule is stale: ${name}`);
  }
});
