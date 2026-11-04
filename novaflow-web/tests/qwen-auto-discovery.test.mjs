import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectQwenConfigSource} from '../worker/src/qwen-auto-discovery.mjs';
import {resolveQwenManagedRuntime} from '../worker/src/qwen-managed-runtime.mjs';
import {verifyQwenCpuFiles} from '../worker/src/qwen-cpu-verification.mjs';
import {QWEN_CPU_MODEL} from '../worker/src/qwen-cpu-model.mjs';

test('first-run derives only the fixed model pair from validated runtime metadata',async()=>{
 const root=await mkdtemp(join(tmpdir(),'foart-qwen-discover-')),models=join(root,'Foart','models');
 try {
  await writeFile(join(root,'runtime.json'),JSON.stringify({installPath:root,modelsPath:models}));
  const stat=p=>({isFile:()=>true,size:p.endsWith(QWEN_CPU_MODEL.modelFilename)?QWEN_CPU_MODEL.modelBytes:p.endsWith(QWEN_CPU_MODEL.projectorFilename)?QWEN_CPU_MODEL.projectorBytes:1});
  const first=selectQwenConfigSource({runtimeRoot:root,stat});
  assert.equal(first.discovered,true);assert.equal(first.config.model,join(models,'LLM','qwen35_9b_ultra_heretic',QWEN_CPU_MODEL.modelFilename));
  assert.equal(first.config.projector,join(models,'LLM','qwen35_9b_ultra_heretic',QWEN_CPU_MODEL.projectorFilename));
  assert.equal(first.config.executionMode,'gpu');assert.equal(first.executionPreference,'gpu-default');assert.equal(first.config.managedRunner,'ollama-v0.40.13');
  assert.deepEqual(selectQwenConfigSource({runtimeRoot:root,stat}),first,'restart discovery is deterministic and does not write configuration');
  assert.equal(resolveQwenManagedRuntime(first.config,root).failure.errorCode,'qwen-managed-runner-missing');
  const missing=selectQwenConfigSource({runtimeRoot:root,stat:p=>{if(p.endsWith(QWEN_CPU_MODEL.projectorFilename))throw Error('missing');return stat(p);}});
  assert.equal(missing.failure.errorCode,'qwen-autodiscovery-model-missing');
  const truncated=selectQwenConfigSource({runtimeRoot:root,stat:p=>({isFile:()=>true,size:p.endsWith(QWEN_CPU_MODEL.modelFilename)?1:stat(p).size})});
  assert.equal(truncated.failure.errorCode,'qwen-autodiscovery-model-missing');
  await writeFile(join(root,'qwen35-execution.json'),JSON.stringify({schema:'nf.qwen-execution.v1',mode:'gpu'}));
  const preferred=selectQwenConfigSource({runtimeRoot:root,stat});
  assert.equal(preferred.discovered,true);assert.equal(preferred.config.executionMode,'gpu');
  assert.equal(preferred.config.model,first.config.model);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('explicit settings never fall back and metadata cannot point to a different environment',async()=>{
 const root=await mkdtemp(join(tmpdir(),'foart-qwen-explicit-'));
 try {
  await writeFile(join(root,'runtime.json'),JSON.stringify({installPath:root,modelsPath:join(root,'models')}));
  assert.equal(selectQwenConfigSource({runtimeRoot:root,envSpecified:true,envPath:''}).failure.errorCode,'qwen-config-invalid');
  assert.equal(selectQwenConfigSource({runtimeRoot:root,envSpecified:true,envPath:join(root,'absent.json')}).failure.errorCode,'qwen-config-invalid');
  const explicit={executionMode:'gpu'};assert.equal(selectQwenConfigSource({runtimeRoot:root,suppliedConfig:explicit}).config,explicit);
  await writeFile(join(root,'qwen35-cpu.json'),'{broken');assert.equal(selectQwenConfigSource({runtimeRoot:root}).failure.errorCode,'qwen-config-invalid');
  await rm(join(root,'qwen35-cpu.json'));await writeFile(join(root,'runtime.json'),JSON.stringify({installPath:join(root,'elsewhere'),modelsPath:join(root,'models')}));
  assert.equal(selectQwenConfigSource({runtimeRoot:root}).failure.errorCode,'qwen-runtime-metadata-invalid');
 } finally {await rm(root,{recursive:true,force:true});}
});

test('existing identity verification rejects tampered artifacts before any ready state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'foart-qwen-tampered-'));
 try {const file=join(root,'tiny');await writeFile(file,'not a model');assert.equal(await verifyQwenCpuFiles({exe:file,model:file,projector:file}),null);}
 finally {await rm(root,{recursive:true,force:true});}
});

test('device preference is independent of legacy CPU configuration and never silently falls back',async()=>{
 const root=await mkdtemp(join(tmpdir(),'foart-qwen-device-'));
 try {
  const legacy={pythonPath:'unchanged',executionMode:'cpu',managedRunner:'ollama-v0.40.13'};
  const cpuPath=join(root,'qwen35-cpu.json'),devicePath=join(root,'qwen35-execution.json');
  const original=JSON.stringify(legacy);await writeFile(cpuPath,original);
  const defaultManaged=selectQwenConfigSource({runtimeRoot:root});
  assert.equal(defaultManaged.config.executionMode,'gpu');assert.equal(defaultManaged.executionPreference,'gpu-default');
  assert.equal(await readFile(cpuPath,'utf8'),original,'default GPU must not rewrite legacy configuration');
  assert.equal(resolveQwenManagedRuntime(defaultManaged.config,root).failure.errorCode,'qwen-managed-runner-missing');
  await writeFile(devicePath,JSON.stringify({schema:'nf.qwen-execution.v1',mode:'gpu'}));
  const selected=selectQwenConfigSource({runtimeRoot:root});
  assert.equal(selected.config.executionMode,'gpu');assert.equal(selected.executionPreference,'gpu');
  assert.equal(resolveQwenManagedRuntime(selected.config,root).failure.errorCode,'qwen-managed-runner-missing');
  assert.equal(await readFile(cpuPath,'utf8'),original);
  const explicit={executionMode:'cpu'};assert.equal(selectQwenConfigSource({runtimeRoot:root,suppliedConfig:explicit}).config,explicit);
  const overridePath=join(root,'override.json');await writeFile(overridePath,JSON.stringify(explicit));
  assert.equal(selectQwenConfigSource({runtimeRoot:root,envSpecified:true,envPath:overridePath}).config.executionMode,'cpu');
  await writeFile(devicePath,JSON.stringify({schema:'nf.qwen-execution.v1',mode:'cpu'}));
  assert.equal(selectQwenConfigSource({runtimeRoot:root}).config.executionMode,'cpu');
  for(const value of ['{',JSON.stringify({schema:'nf.qwen-execution.v1',mode:'automatic'}),JSON.stringify({schema:'nf.qwen-execution.v1',mode:'gpu',extra:true})]) {
   await writeFile(devicePath,value);
   assert.equal(selectQwenConfigSource({runtimeRoot:root}).failure.errorCode,'qwen-execution-preference-invalid');
  }
  await rm(devicePath);await writeFile(cpuPath,JSON.stringify({executionMode:'cpu',exe:'custom-user-runtime'}));
  assert.equal(selectQwenConfigSource({runtimeRoot:root}).config.executionMode,'cpu','non-managed custom runtimes are not changed');
 } finally {await rm(root,{recursive:true,force:true});}
});
