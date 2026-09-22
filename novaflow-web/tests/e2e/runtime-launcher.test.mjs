import assert from 'node:assert/strict';
import { runRuntimeLauncher } from '../../worker/src/runtime-services.mjs';
const started = Date.now();
// A launcher can exit while its child still owns inherited output handles.
await runRuntimeLauncher(process.execPath, ['-e', `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setTimeout(()=>{},2500)'],{stdio:'inherit',windowsHide:true});c.unref();`]);
assert.ok(Date.now()-started < 1800, 'startup must not wait for long-lived child output');
await assert.rejects(runRuntimeLauncher(process.execPath, ['-e', 'process.exit(7)']), /7/);
await assert.rejects(runRuntimeLauncher(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], {timeoutMs:100}), /超时/);
console.log('3 passed, 0 failed: launcher exit, failure and timeout');
