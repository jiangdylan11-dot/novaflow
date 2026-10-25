import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('portable Flash environment includes verified engine dependencies and excludes model/state payloads', {skip:process.platform !== 'win32'}, () => {
  const script=fileURLToPath(new URL('../helpers/test-flash-runtime-package.ps1',import.meta.url));
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const receipt=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(receipt.ok,true);
  assert.ok(receipt.checks >= 20);
});
