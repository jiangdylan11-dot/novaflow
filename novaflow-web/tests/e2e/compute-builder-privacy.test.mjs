import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const require=createRequire(import.meta.url);
const {FileMatcher}=require('app-builder-lib/out/fileMatcher');
const config=require('../../worker/electron-builder-compute.json');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../worker');
const stat={isDirectory:()=>false};

test('compute package retains its node entry while excluding secrets, weights and Python caches',()=>{
  assert.equal(config.extraMetadata.main,'electron/compute-main.cjs');
  assert.equal(config.extraMetadata.computeOnly,true);
  const filter=new FileMatcher(root,root,x=>x,config.files).createFilter();
  for(const p of ['electron/compute-main.cjs','src/qwen-cpu-model.mjs','src/compute-assistant.mjs'])
    assert.equal(filter(path.join(root,p),stat),true,p);
  for(const p of ['src/.env','src/.env.local','src/.secrets/key.txt','src/license-private-key.dat',
    'src/client.pem','src/client.key','src/client.p12','src/client.pfx','src/model.gguf',
    'src/model.safetensors','src/__pycache__/module.pyc'])
    assert.equal(filter(path.join(root,p),stat),false,p);
});

test('vendor filter keeps the tunnel binary but excludes secrets and model weights',()=>{
  const entry=config.extraResources.find(item=>item.to==='vendor');
  assert(entry && Array.isArray(entry.filter));
  const vendor=path.join(root,'vendor');
  const filter=new FileMatcher(vendor,vendor,x=>x,entry.filter).createFilter();
  assert.equal(filter(path.join(vendor,'cloudflared.exe'),stat),true);
  for(const p of ['.env','nested/.secrets/token.txt','nested/license-private-key.pem','nested/model.gguf','nested/model.safetensors','nested/__pycache__/module.pyc'])
    assert.equal(filter(path.join(vendor,p),stat),false,p);
});
