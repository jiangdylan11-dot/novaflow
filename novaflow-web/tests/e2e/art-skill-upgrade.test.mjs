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
  assert.equal(approved.version,'1.0.14');
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
  assert.equal((await fresh.active()).version,'1.0.14');
  assert.equal((await fresh.active()).version,'1.0.14');
});

test('the shipped 1.0.11 baseline upgrades once; its bytes and later owner rollback are preserved',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'nf-skill-approved-upgrade-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const bytes=await readFile(new URL('../../worker/src/art-skills/style-transfer.1.0.11.json',import.meta.url),'utf8'),previous=JSON.parse(bytes);
  await writeFile(join(directory,'style-transfer.1.0.11.json'),bytes);
  const pointer={version:previous.version,sha256:previous.systemSHA256};
  await writeFile(join(directory,'active.json'),JSON.stringify(pointer));
  assert.equal((await createArtSkillService(directory).active()).version,'1.0.14');
  assert.equal(await readFile(join(directory,'style-transfer.1.0.11.json'),'utf8'),bytes);
  await writeFile(join(directory,'active.json'),JSON.stringify(pointer));
  assert.deepEqual(await createArtSkillService(directory).active(),previous);
});

test('fresh installations include a usable previous version for explicit rollback',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'nf-skill-bundled-rollback-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await createArtSkillService(directory).active();
  const previous=JSON.parse(await readFile(join(directory,'style-transfer.1.0.11.json'),'utf8'));
  await writeFile(join(directory,'active.json'),JSON.stringify({version:previous.version,sha256:previous.systemSHA256}));
  assert.deepEqual(await createArtSkillService(directory).active(),previous);
});

test('matching a baseline version number alone never overwrites a separately selected skill',async t=>{
  const {service}=await fixture(t,'1.0.11');
  assert.equal((await service.active()).version,'1.0.11');
  assert.equal((await service.active()).systemSHA256,'fac8d2aad6988ed1feffa0234ceef61a6269402c68b52f614098e894901ea4be');
});
