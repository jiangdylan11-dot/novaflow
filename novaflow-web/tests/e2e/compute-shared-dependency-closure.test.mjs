import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {relativeImports} from '../../tools/sync-edge-function.mjs';

const shared=new URL('../../packages/shared/src/',import.meta.url);
const config=JSON.parse(await readFile(new URL('../../worker/electron-builder-compute.json',import.meta.url),'utf8'));
const resource=config.extraResources.find(item=>item.from==='../packages/shared/src'&&item.to==='packages/shared/src');
// The compute assistant ships every worker/src file its builder config does not exclude. Every
// packages/shared/src module those files reach must be on the explicit shared allowlist, and every
// allowlisted module's own imports must be too, or the installed assistant fails to load it.
// (The UI framework left the compute side with the v3 server move; it is not packaged any more.)
const workerRoot=new URL('../../worker/',import.meta.url);
const excluded=new Set(config.files.filter(item=>item.startsWith('!src/')).map(item=>item.slice(1)));
const importPattern=/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;
async function sharedClosure(){
  const pending=[new URL('electron/compute-main.cjs',workerRoot)];
  for(const entry of await readdir(new URL('src/',workerRoot),{recursive:true,withFileTypes:true})){
    if(!entry.isFile()||!/\.(?:mjs|cjs|js)$/.test(entry.name))continue;
    const file=join(entry.parentPath||entry.path,entry.name),rel=relative(fileURLToPath(workerRoot),file).split(sep).join('/');
    if(!excluded.has(rel))pending.push(pathToFileURL(file));
  }
  const seen=new Set(),reached=new Set(),sharedPath=fileURLToPath(shared);
  while(pending.length){
    const url=pending.shift(),path=fileURLToPath(url);if(seen.has(path))continue;seen.add(path);
    if(path.startsWith(sharedPath))reached.add(relative(sharedPath,path).split(sep).join('/'));
    if(!/\.(?:mjs|cjs|js)$/.test(path))continue;
    let source;try{source=await readFile(url,'utf8');}catch{continue;}
    for(const match of source.matchAll(importPattern))pending.push(new URL(match[1],url));
  }
  return reached;
}

test('compute package shared resources are an explicit allowlist',()=>{
  assert.ok(resource,'missing compute shared resources');
  assert.ok(Array.isArray(resource.filter));
  assert.ok(!resource.filter.some(item=>/[?*]/.test(item)),'shared resources must remain an explicit allowlist');
});

test('every shared module the shipped worker reaches is packaged, and so are their imports',async()=>{
  const reached=await sharedClosure();
  assert.ok(reached.has('protocol.mjs'),'the closure walk must reach the worker protocol');
  for(const name of reached)assert.ok(resource.filter.includes(name),`missing package allowlist entry: ${name}`);
  for(const name of resource.filter){
    const source=await readFile(new URL(name,shared),'utf8');
    assert.doesNotMatch(source,/\b(?:from\s*|import\s*\(\s*)['"]\.\.\//,'shared import escapes its resource directory');
    for(const dependency of relativeImports(source))assert.ok(resource.filter.includes(dependency),`${name} imports ${dependency}, which is not packaged`);
  }
});

test('generated UI rules match the current renderer sources',async()=>{
  const {sourceHashes}=await import(new URL('xiaotao-ui-professional.generated.mjs',shared));
  for(const name of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js']){
    const content=(await readFile(new URL(`../../renderer/${name}`,import.meta.url),'utf8')).replace(/\r\n/g, '\n');
    const sha=createHash('sha256').update(content).digest('hex');
    assert.equal(sha,sourceHashes[name],`generated UI rule is stale: ${name}`);
  }
});
