import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const control='--control-url=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web';
const auth='--auth-url=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend';
function rejected(args, expected){
  const result=spawnSync(process.execPath,['tools/package-site.mjs',...args],{cwd:root,encoding:'utf8',timeout:10000});
  assert.equal(result.status,1,result.stderr);
  assert.match(result.stderr,expected);
  assert.doesNotMatch(result.stdout,/web renderer built|Foart tool contract synced/);
}

test('malformed isolation option cannot fall through to the shared builder',()=>{
  rejected(['--frozen-265-session','--check',control,auth],/Invalid frozen session package option/);
});
test('frozen session packaging requires explicit checking',()=>{
  rejected(['--frozen-265-session=example',control,auth],/Invalid frozen session package options/);
});
test('frozen session packaging refuses a different control plane',()=>{
  rejected(['--frozen-265-session=example','--check','--control-url=http://127.0.0.1:4890',auth],/approved production control and auth URLs/);
});
test('frozen session and full-stage options cannot be combined',()=>{
  rejected(['--frozen-265-session=example','--isolated-full-stage=example','--check',control,auth],/Invalid frozen session package options/);
});
