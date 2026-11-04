import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const helper = resolve('../tools/ai-runtime/qwen-runner-component.ps1');
const sha = data => createHash('sha256').update(data).digest('hex');
const windows = process.platform === 'win32';

function makeFixture() {
  const root=mkdtempSync(join(tmpdir(),'foart-runner-inventory-'));
  const cpu=Buffer.from('fixture-server'), gpu=Buffer.from('fixture-cuda');
  const cpuPath=join(root,'lib','ollama','llama-server.exe');
  const gpuPath=join(root,'lib','ollama','cuda_v12','ggml-cuda.dll');
  mkdirSync(join(root,'lib','ollama','cuda_v12'),{recursive:true});
  writeFileSync(cpuPath,cpu);writeFileSync(gpuPath,gpu);
  const inventory={schema:'nf.qwen-runner.official-inventory.v1',component:'ollama-v0.40.13',target:'windows-x86_64',
    sourceURL:'https://github.com/ollama/ollama/releases/download/v0.40.13/ollama-windows-amd64.zip',
    archiveSHA256:'7afa38624fa62ee5d8293422d0ab084c1bb4603134c7f4dafce11a033b57cc19',
    includesModels:false,redistributionApproved:false,gpuExecutionApproved:false,
    files:[{path:'lib/ollama/llama-server.exe',bytes:cpu.length,sha256:sha(cpu),group:'cpu'},
      {path:'lib/ollama/cuda_v12/ggml-cuda.dll',bytes:gpu.length,sha256:sha(gpu),group:'cuda12'}]};
  const file=join(root,'inventory.json');
  function save() { const bytes=Buffer.from(JSON.stringify(inventory));writeFileSync(file,bytes);return sha(bytes); }
  return {root,cpuPath,gpuPath,inventory,file,save};
}

function verify(fixture,hash,profile='cpu') {
  const script="$ErrorActionPreference='Stop'; . $env:FOART_TEST_HELPER; $r=Test-QwenRunnerOfficialInventory -Root $env:FOART_TEST_ROOT -InventoryPath $env:FOART_TEST_INVENTORY -TrustedInventorySHA256 $env:FOART_TEST_HASH -Profile $env:FOART_TEST_PROFILE; $r | ConvertTo-Json -Depth 4 -Compress";
  return spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',
    env:{...process.env,FOART_TEST_HELPER:helper,FOART_TEST_ROOT:fixture.root,FOART_TEST_INVENTORY:fixture.file,FOART_TEST_HASH:hash,FOART_TEST_PROFILE:profile}});
}

test('runner inventory verifies selected bytes but never grants approval', {skip:!windows},()=>{
  const f=makeFixture();try {
    const hash=f.save(), cpu=verify(f,hash), gpu=verify(f,hash,'cuda12');
    assert.equal(cpu.status,0,cpu.stderr);assert.equal(gpu.status,0,gpu.stderr);
    const a=JSON.parse(cpu.stdout), b=JSON.parse(gpu.stdout);
    assert.equal(a.Files.length,1);assert.equal(b.Files.length,2);
    assert.equal(a.RedistributionApproved,false);assert.equal(b.GpuExecutionApproved,false);
    writeFileSync(f.cpuPath,'tampered-server');
    assert.notEqual(verify(f,hash).status,0);
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('runner inventory rejects stale, approved, and traversal metadata', {skip:!windows},()=>{
  const f=makeFixture();try {
    const old=f.save();f.inventory.gpuExecutionApproved=true;const changed=f.save();
    assert.notEqual(verify(f,old).status,0);
    assert.notEqual(verify(f,changed).status,0);
    f.inventory.gpuExecutionApproved=false;f.inventory.files[0].path='lib/ollama/../other.exe';
    assert.notEqual(verify(f,f.save()).status,0);
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('isolated CPU candidate copies verified CPU files and pinned notices only', {skip:!windows},()=>{
  const f=makeFixture();try {
    const hash=f.save(), destination=join(f.root,'candidate');
    const script="$ErrorActionPreference='Stop'; . $env:FOART_TEST_HELPER; $r=Copy-QwenRunnerCpuCandidate -Root $env:FOART_TEST_ROOT -InventoryPath $env:FOART_TEST_INVENTORY -TrustedInventorySHA256 $env:FOART_TEST_HASH -NoticesRoot $env:FOART_TEST_NOTICES -Destination $env:FOART_TEST_DEST; $r | ConvertTo-Json -Compress";
    const args=['-NoProfile','-NonInteractive','-Command',script];
    const env={...process.env,FOART_TEST_HELPER:helper,FOART_TEST_ROOT:f.root,FOART_TEST_INVENTORY:f.file,
      FOART_TEST_HASH:hash,FOART_TEST_NOTICES:resolve('../tools/ai-runtime/notices/qwen'),FOART_TEST_DEST:destination};
    const result=spawnSync('powershell.exe',args,{encoding:'utf8',env});
    assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).RedistributionApproved,false);
    assert.equal(existsSync(join(destination,'lib','ollama','llama-server.exe')),true);
    assert.equal(existsSync(join(destination,'lib','ollama','cuda_v12','ggml-cuda.dll')),false);
    assert.equal(existsSync(join(destination,'third-party-notices','OLLAMA-MIT.txt')),true);
    assert.notEqual(spawnSync('powershell.exe',args,{encoding:'utf8',env}).status,0);
  } finally {rmSync(f.root,{recursive:true,force:true});}
});
