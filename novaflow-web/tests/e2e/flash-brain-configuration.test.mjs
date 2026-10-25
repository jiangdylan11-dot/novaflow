import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm,mkdir,readdir,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildFlashBrainConfiguration,ensureFlashBrainConfiguration } from '../../worker/src/flash-brain-configuration.mjs';
test('configuration follows the environment and models folders, preserving tested engine controls',()=>{
 const {config,server,required}=buildFlashBrainConfiguration({installPath:'X:/Portable/env',modelsPath:'Y:/Models',configPath:'X:/Portable/state/strata-prompt.json'});
 assert.ok(config.pythonPath.startsWith('X:'));assert.ok(config.modelFiles.every(f=>f.path.startsWith('Y:')));assert.ok(server.tokenizer.startsWith('Y:'));
 assert.equal(server.args[server.args.indexOf('--resident-budget-gib')+1],'20');assert.equal(server.args[server.args.indexOf('--prefill')+1],'2048');
 assert.equal(server.args[server.args.indexOf('--vram-reserve-mib')+1],'4096');
 assert.deepEqual(server.runtimeProfile,{schema:'nf.strata.resource-profile.v1',id:'flash-headroom-v2',version:2});
 assert.equal(server.args[server.args.indexOf('--max-context')+1],'12288');assert.equal(server.args.includes('--mmap-experts'),false);
 assert.equal(server.vision.max_tokens,2048);assert.equal(config.reasoningBudgetTokens,1024);assert.ok(required.some(p=>p.endsWith('experts.bin')));assert.ok(required.some(p=>p.endsWith('draft_vocab.bin')));
 assert.equal(JSON.stringify({config,server}).includes('E:/NovaFlow'),false);assert.equal(config.analysisBackend,'strata');
});

const hash=value=>createHash('sha256').update(value).digest('hex');
async function legacyFixture(){
 const dir=await mkdtemp(join(tmpdir(),'nf-flash-profile-')),runtimeJsonPath=join(dir,'runtime.json'),configPath=join(dir,'strata-prompt.json');
 const runtime={installPath:join(dir,'env'),modelsPath:join(dir,'models')};
 const built=buildFlashBrainConfiguration({...runtime,configPath}),server=structuredClone(built.server);
 delete server.runtimeProfile;
 for(const [arg,value] of [['--resident-budget-gib','24'],['--prefill','4096'],['--vram-reserve-mib','3072']])server.args[server.args.indexOf(arg)+1]=value;
 await writeFile(runtimeJsonPath,JSON.stringify(runtime));await mkdir(join(dir,'flash-local-brain-runtime','state'),{recursive:true});
 const configText=JSON.stringify(built.config,null,2)+'\r\n',serverText='\uFEFF'+JSON.stringify(server,null,2)+'\r\n';
 await writeFile(configPath,configText);await writeFile(built.config.serverConfigPath,serverText);
 await writeFile(built.config.receiptPath,JSON.stringify({schemaVersion:1,state:'released'}));
 return {dir,runtimeJsonPath,configPath,config:built.config,server,configText,serverText,target:built.server};
}
// Unit seam: the production runner uses the real control module's owner/lock;
// this fixture only imitates its successful atomic write, inside the temp tree.
async function successfulMigration({input}){
 const config=JSON.parse(await readFile(input.configPath,'utf8'));
 assert.equal(hash(await readFile(input.configPath)),input.configSHA256);
 const original=await readFile(config.serverConfigPath);assert.equal(hash(original),input.serverSHA256);
 const backupPath=config.serverConfigPath+'.flash-profile-v1.'+randomUUID()+'.bak';
 await writeFile(backupPath+'.tmp',original);await rename(backupPath+'.tmp',backupPath);
 await writeFile(config.serverConfigPath+'.tmp',input.targetServerText);await rename(config.serverConfigPath+'.tmp',config.serverConfigPath);
 return {status:'migrated',ownershipVerified:true,backupPath,backupSHA256:hash(original),serverSHA256:hash(input.targetServerText)};
}

test('only the exact old managed configuration migrates, preserving config bytes and a complete atomic backup',async()=>{
 const f=await legacyFixture();let calls=0;
 try{
  const result=await ensureFlashBrainConfiguration({...f,profileMigrationRunner:async input=>{calls++;return successfulMigration(input);}});
  assert.equal(result.migration.status,'migrated');assert.equal(calls,1);
  assert.equal(await readFile(f.configPath,'utf8'),f.configText);
  assert.equal(await readFile(result.migration.backupPath,'utf8'),f.serverText);
  assert.deepEqual(JSON.parse(await readFile(f.config.serverConfigPath,'utf8')),f.target);
  const again=await ensureFlashBrainConfiguration({...f,profileMigrationRunner:async()=>{assert.fail('current profile must not probe or rewrite');}});
  assert.equal(again.migration.status,'current');
  assert.equal((await readdir(join(f.dir,'flash-local-brain-runtime'))).filter(name=>name.endsWith('.bak')).length,1);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('unknown, partial, custom settings and explicit external config paths retain their exact files',async()=>{
 for(const kind of ['server-extra','config-extra','partial-profile','external-path']){
  const f=await legacyFixture();
  try{
   if(kind==='server-extra'){f.server.tool_call_recovery=true;await writeFile(f.config.serverConfigPath,JSON.stringify(f.server));}
   if(kind==='config-extra'){f.config.repetitionPenalty=1.1;await writeFile(f.configPath,JSON.stringify(f.config));}
   if(kind==='partial-profile'){f.server.args[f.server.args.indexOf('--prefill')+1]='2048';await writeFile(f.config.serverConfigPath,JSON.stringify(f.server));}
   if(kind==='external-path'){const external=join(f.dir,'custom-strata.json');await rename(f.configPath,external);f.configPath=external;}
   const configBefore=await readFile(f.configPath),serverBefore=await readFile(f.config.serverConfigPath);
   const result=await ensureFlashBrainConfiguration({...f,profileMigrationRunner:async()=>{assert.fail('custom configuration cannot invoke an ownership probe');}});
   assert.equal(result.migration.status,'preserved');
   assert.deepEqual(await readFile(f.configPath),configBefore);assert.deepEqual(await readFile(f.config.serverConfigPath),serverBefore);
   assert.equal((await readdir(join(f.dir,'flash-local-brain-runtime'))).some(name=>name.endsWith('.bak')),false);
  }finally{await rm(f.dir,{recursive:true,force:true});}
 }
});

test('active, missing or unknown owner receipts defer migration before creating any backup or process',async()=>{
 for(const receipt of [{schemaVersion:1,state:'loaded'},{schemaVersion:1,state:'loading'},{schemaVersion:2,state:'released'},null]){
  const f=await legacyFixture();let calls=0;
  try{
   if(receipt)await writeFile(f.config.receiptPath,JSON.stringify(receipt));else await rm(f.config.receiptPath);
   const before=await readdir(join(f.dir,'flash-local-brain-runtime'),{recursive:true});
   const result=await ensureFlashBrainConfiguration({...f,profileMigrationRunner:async()=>{calls++;throw Error('must not run');}});
   assert.equal(result.migration.status,'pending');assert.equal(calls,0);
   assert.equal(await readFile(f.configPath,'utf8'),f.configText);assert.equal(await readFile(f.config.serverConfigPath,'utf8'),f.serverText);
   assert.deepEqual(await readdir(join(f.dir,'flash-local-brain-runtime'),{recursive:true}),before);
  }finally{await rm(f.dir,{recursive:true,force:true});}
 }
});

test('an unavailable or uncertain owner/lock probe preserves the old profile and does not fail startup',async()=>{
 for(const runner of [async()=>{throw Error('unknown ownership API');},async()=>({status:'pending',reason:'runtime-busy'})]){
  const f=await legacyFixture();
  try{
   const result=await ensureFlashBrainConfiguration({...f,profileMigrationRunner:runner});
   assert.equal(result.ok,true);assert.equal(result.migration.status,'pending');
   assert.equal(await readFile(f.config.serverConfigPath,'utf8'),f.serverText);
   assert.equal((await readdir(join(f.dir,'flash-local-brain-runtime'))).some(name=>name.endsWith('.bak')),false);
  }finally{await rm(f.dir,{recursive:true,force:true});}
 }
});

const bundledPython=join(process.env.ProgramData || 'C:/ProgramData','NovaFlow','AI-Runtime','engine','strata','control-0.1.49.2','python','python.exe');
const cpuControlStub=trace=>`import contextlib,json\nfrom pathlib import Path\nTRACE=Path(${JSON.stringify(trace)})\ndef record(x):\n with TRACE.open('a') as f:f.write(x+'\\n')\nclass Settings:\n def __init__(self,path):\n  self.path=path;self.raw=json.loads(Path(path).read_text());self.server_path=self.raw['serverConfigPath'];self.receipt=self.raw['receiptPath']\nclass Owner:\n @classmethod\n def read(cls,s):\n  record('owner');o=cls();o.receipt=json.loads(Path(s.receipt).read_text());return o\n def parent(self):return None\ndef remaining_released_identities(o):return []\ndef port_open(s):return False\ndef exact_heavy_processes(s):return []\n@contextlib.contextmanager\ndef operation_lock(s):\n record('lock-enter')\n try:yield\n finally:record('lock-exit')\n`;
const cpuMigrationRunner=stub=>async({script,input})=>JSON.parse(execFileSync(bundledPython,['-B','-c',script],
 {input:JSON.stringify({...input,controlModulePath:stub}),encoding:'utf8',windowsHide:true,timeout:5000}));
test('the actual CPU migration script requires owner proof twice and holds the lifecycle lock for its write',
 {skip:!existsSync(bundledPython)},async()=>{
 const f=await legacyFixture(),stub=join(f.dir,'control-stub.py'),trace=join(f.dir,'probe-trace.txt');
 try{
  // Execute the exact production Python script, but import ONLY this temporary
  // CPU stub. Never inspect the running machine's processes, port or config.
  await writeFile(stub,cpuControlStub(trace));
  const result=await ensureFlashBrainConfiguration({...f,profileMigrationRunner:cpuMigrationRunner(stub)});
  assert.equal(result.migration.status,'migrated');assert.deepEqual((await readFile(trace,'utf8')).trim().split(/\r?\n/),['owner','lock-enter','owner','lock-exit']);
  assert.equal(await readFile(result.migration.backupPath,'utf8'),f.serverText);
  assert.equal(await readFile(f.configPath,'utf8'),f.configText);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('the actual migration script refuses unknown owner APIs, lock types and probe return types without touching configuration',
 {skip:!existsSync(bundledPython)},async()=>{
 for(const override of ['operation_lock=None','operation_lock=lambda s: None','remaining_released_identities=lambda o: None','port_open=lambda s: None','port_open=lambda s: True']){
  const f=await legacyFixture(),stub=join(f.dir,'control-stub.py');
  try{
   await writeFile(stub,cpuControlStub(join(f.dir,'probe-trace.txt'))+'\n'+override+'\n');
   const result=await ensureFlashBrainConfiguration({...f,profileMigrationRunner:cpuMigrationRunner(stub)});
   assert.equal(result.ok,true);assert.equal(result.migration.status,'pending');
   assert.equal(await readFile(f.configPath,'utf8'),f.configText);assert.equal(await readFile(f.config.serverConfigPath,'utf8'),f.serverText);
   assert.equal((await readdir(join(f.dir,'flash-local-brain-runtime'))).some(name=>name.endsWith('.bak')),false);
  }finally{await rm(f.dir,{recursive:true,force:true});}
 }
});
test('existing explicit configuration is preserved and incomplete installs never write a misleading configuration',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nf-flash-config-'));
 try {const runtimeJsonPath=join(dir,'runtime.json'),configPath=join(dir,'strata-prompt.json');
 await writeFile(runtimeJsonPath,JSON.stringify({installPath:join(dir,'env'),modelsPath:join(dir,'models')}));
 const missing=await ensureFlashBrainConfiguration({runtimeJsonPath,configPath});assert.equal(missing.ok,false);assert.equal(missing.reason,'flash-installation-incomplete');
 await assert.rejects(readFile(configPath));await writeFile(configPath,'{"custom":true}');
 assert.equal((await ensureFlashBrainConfiguration({runtimeJsonPath,configPath})).created,false);assert.equal(await readFile(configPath,'utf8'),'{"custom":true}');
 }finally{await rm(dir,{recursive:true,force:true});}
});
