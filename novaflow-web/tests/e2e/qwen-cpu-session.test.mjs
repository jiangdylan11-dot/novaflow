import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createGemmaCpuSession } from '../../worker/src/gemma-cpu-session.mjs';

test('failed supervisor spawn releases the gate without claiming a process was started', {skip:process.platform!=='win32'}, async()=>{
  const file=process.execPath;
  const spawnImpl=()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();
    process.nextTick(()=>child.emit('error',Object.assign(new Error('spawn failed'),{code:'ENOENT'})));
    return child;
  };
  const session=createGemmaCpuSession({modelId:'qwen3.5-9b-heretic',spawnImpl,
    config:{pythonPath:file,exe:file,model:file,projector:file}});
  await assert.rejects(session.withSession(()=>{throw Error('callback must not run');}),error=>error.resourcesReleased===true);
});
test('unknown CPU model cannot be selected',()=>{
  assert.throws(()=>createGemmaCpuSession({modelId:'other'}),/Unsupported local model/);
});
