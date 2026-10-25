import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildFlashBrainConfiguration,ensureFlashBrainConfiguration } from '../../worker/src/flash-brain-configuration.mjs';
test('configuration follows the environment and models folders, preserving tested engine controls',()=>{
 const {config,server,required}=buildFlashBrainConfiguration({installPath:'X:/Portable/env',modelsPath:'Y:/Models',configPath:'X:/Portable/state/strata-prompt.json'});
 assert.ok(config.pythonPath.startsWith('X:'));assert.ok(config.modelFiles.every(f=>f.path.startsWith('Y:')));assert.ok(server.tokenizer.startsWith('Y:'));
 assert.equal(server.args[server.args.indexOf('--resident-budget-gib')+1],'24');assert.equal(server.args[server.args.indexOf('--max-context')+1],'12288');assert.equal(server.args.includes('--mmap-experts'),false);
 assert.equal(server.vision.max_tokens,2048);assert.equal(config.reasoningBudgetTokens,1024);assert.ok(required.some(p=>p.endsWith('experts.bin')));assert.ok(required.some(p=>p.endsWith('draft_vocab.bin')));
 assert.equal(JSON.stringify({config,server}).includes('E:/NovaFlow'),false);assert.equal(config.analysisBackend,'strata');
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
