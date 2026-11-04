import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolveQwenManagedRuntime } from '../../worker/src/qwen-managed-runtime.mjs';
import { verifyManagedCpuComponent } from '../../worker/src/qwen-managed-integrity.mjs';
import { qwenCpuFileStamp } from '../../worker/src/qwen-cpu-verification.mjs';

// This read-only fixture uses the user's already-downloaded, verified official
// runner if present. It copies only 42 MB of CPU files to its own temp folder;
// it never runs a model, installs a package, or changes the source runtime.
const source='E:/Foart/runtimes/ollama-v0.40.13';
const available=process.platform==='win32' && existsSync(join(source,'lib/ollama/llama-server.exe'));
test('official CPU component stages, resolves and rejects injected files in both verifiers', {skip:!available},()=>{
  const root=mkdtempSync(join(tmpdir(),'foart-qwen-managed-'));
  try {
    const component=join(root,'engine','llama','ollama-v0.40.13');
    mkdirSync(join(root,'engine','llama'),{recursive:true});
    const script="$ErrorActionPreference='Stop'; . $env:FOART_TEST_HELPER; Copy-QwenRunnerCpuCandidate -Root $env:FOART_TEST_SOURCE -InventoryPath $env:FOART_TEST_INVENTORY -TrustedInventorySHA256 $env:FOART_TEST_HASH -NoticesRoot $env:FOART_TEST_NOTICES -Destination $env:FOART_TEST_DEST | Out-Null";
    const env={...process.env,FOART_TEST_HELPER:resolve('../tools/ai-runtime/qwen-runner-component.ps1'),FOART_TEST_SOURCE:source,
      FOART_TEST_INVENTORY:resolve('../tools/ai-runtime/manifests/qwen-ollama-v0.40.13.inventory.json'),
      FOART_TEST_HASH:'b6f573fbd0a7487610b345e1b390f3629fb9d482f9c4a3ac651bca6f7c52d26e',
      FOART_TEST_NOTICES:resolve('../tools/ai-runtime/notices/qwen'),FOART_TEST_DEST:component};
    const copy=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env,encoding:'utf8'});
    assert.equal(copy.status,0,copy.stderr);
    const model=join(root,'original.gguf'),projector=join(root,'original-mmproj.gguf');
    writeFileSync(model,'fixture');writeFileSync(projector,'fixture');
    const config={managedRunner:'ollama-v0.40.13',executionMode:'cpu',model,projector};
    const result=resolveQwenManagedRuntime(config,root);
    assert.equal(result.config.exe,join(component,'lib','ollama','llama-server.exe'));
    assert.equal(result.config.model,config.model);assert.equal(result.config.projector,config.projector);
    assert.equal(verifyManagedCpuComponent(component),true);
    assert.ok(qwenCpuFileStamp(result.config));
    const py="import sys;sys.path.insert(0,sys.argv[1]);from qwen_managed_component import verify_managed_cpu_component,verify_windows_ucrt;verify_managed_cpu_component(sys.argv[2],sys.argv[3]);verify_windows_ucrt()";
    const args=['-B','-c',py,resolve('worker/src'),component,result.config.exe];
    const verified=spawnSync('python',args,{encoding:'utf8'});assert.equal(verified.status,0,verified.stderr);
    // Version probing starts only the verified CPU executable with no model,
    // no CUDA/Vulkan backend and no inherited user PATH or credentials.
    const systemRoot=process.env.SystemRoot || 'C:/Windows';
    const probe=spawnSync(result.config.exe,['--version'],{encoding:'utf8',timeout:15000,windowsHide:true,
      env:{SystemRoot:systemRoot,WINDIR:systemRoot,PATH:join(systemRoot,'System32'),CUDA_VISIBLE_DEVICES:'-1',GGML_VK_VISIBLE_DEVICES:'-1'}});
    assert.equal(probe.status,0,probe.error?.message || probe.stderr);
    writeFileSync(join(component,'lib','ollama','unexpected.dll'),'fixture');
    assert.equal(verifyManagedCpuComponent(component),false);
    assert.equal(qwenCpuFileStamp(result.config),null);
    assert.notEqual(spawnSync('python',args,{encoding:'utf8'}).status,0);
    assert.equal(resolveQwenManagedRuntime(config,root).failure.errorCode,'qwen-managed-runner-unapproved');
  } finally {rmSync(root,{recursive:true,force:true});}
});
