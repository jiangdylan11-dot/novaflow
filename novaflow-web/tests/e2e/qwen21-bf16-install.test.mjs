import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installQwen21Bf16Node} from '../../worker/src/comfy/install-qwen21-bf16.mjs';

test('BF16 loader installation is isolated, idempotent and repairs only its own node',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nf-bf16-install-'));
 try{
  assert.equal(await installQwen21Bf16Node(root),false);
  const nodes=join(root,'custom_nodes'),unrelated=join(nodes,'existing_plugin');
  await mkdir(unrelated,{recursive:true});await writeFile(join(unrelated,'__init__.py'),'keep-existing-plugin');
  await writeFile(join(root,'runtime.json'),'\uFEFF'+JSON.stringify({customNodesPath:nodes}));
  assert.equal(await installQwen21Bf16Node(root),true);
  const target=join(nodes,'novaflow_qwen_bf16_loader','__init__.py');
  assert.deepEqual(await readFile(target),await readFile(new URL('../../worker/src/comfy/qwen21-bf16-loader.py',import.meta.url)));
  assert.equal(await installQwen21Bf16Node(root),false);
  await writeFile(target,'old-loader');assert.equal(await installQwen21Bf16Node(root),true);
  assert.equal(await readFile(join(unrelated,'__init__.py'),'utf8'),'keep-existing-plugin');
 }finally{await rm(root,{recursive:true,force:true});}
});
