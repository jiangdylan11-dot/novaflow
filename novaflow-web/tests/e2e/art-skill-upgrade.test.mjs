import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createArtSkillService,readArtSkill} from '../../worker/src/art-skill-service.mjs';

async function fixture(t,version='1.0.1') {
  const directory=await mkdtemp(join(tmpdir(),'nf-skill-upgrade-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const legacy=JSON.parse(await readFile(new URL('../fixtures/art-skill-1.0.1.json',import.meta.url),'utf8'));
  const value={...legacy,version};
  await writeFile(join(directory,`style-transfer.${version}.json`),JSON.stringify(value));
  await writeFile(join(directory,'active.json'),JSON.stringify({version,sha256:value.systemSHA256}));
  return {directory,legacy,service:createArtSkillService(directory)};
}
test('legacy baseline upgrades to the frozen framework and an explicit rollback survives restart',async t=>{
  const {directory,legacy,service}=await fixture(t);
  const before=await readFile(join(directory,'style-transfer.1.0.1.json'),'utf8');
  const approved=await readArtSkill();
  assert.equal(approved.version,'1.0.11');
  assert.deepEqual(await service.active(),approved);
  assert.equal(await readFile(join(directory,'style-transfer.1.0.1.json'),'utf8'),before);
  await writeFile(join(directory,'active.json'),JSON.stringify({version:legacy.version,sha256:legacy.systemSHA256}));
  assert.deepEqual(await createArtSkillService(directory).active(),legacy);
});
test('a separately selected skill is preserved and fresh installations use the frozen framework',async t=>{
  const {service}=await fixture(t,'1.0.12');
  assert.equal((await service.active()).version,'1.0.12');
  const directory=await mkdtemp(join(tmpdir(),'nf-skill-fresh-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const fresh=createArtSkillService(directory);
  assert.equal((await fresh.active()).version,'1.0.11');
  assert.equal((await fresh.active()).version,'1.0.11');
});
