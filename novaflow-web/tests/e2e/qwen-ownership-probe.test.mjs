import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {probeQwenCpuOwnership} from '../../worker/src/gemma-cpu-session.mjs';

const config={pythonPath:process.execPath,exe:process.execPath,model:process.execPath,projector:process.execPath};
function launcher(events,seen) {
  return (_exe,args)=>{
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.kill=()=>{seen.killed=true;child.emit('close',1,null);};
    child.stdin.once('data',data=>{seen.request=JSON.parse(data.toString());seen.args=args;process.nextTick(()=>{
      for(const event of events)child.stdout.write(JSON.stringify(event)+'\n');
      child.stdout.end();child.emit('close',events.some(event=>event.event==='error')?1:0,null);
    });});process.nextTick(()=>child.emit('spawn'));return child;
  };
}
test('probe requires both success and release and never sends a persistent key', {skip:process.platform!=='win32'},async()=>{
  const seen={};const result=await probeQwenCpuOwnership({config,portSupplier:async()=>12345,spawnImpl:launcher([{event:'probe-ok'},{event:'released'}],seen)});
  assert.equal(result.ok,true);assert.equal(seen.request.probe,true);assert.equal(seen.request.modelId,'qwen3.5-9b-heretic');assert.match(seen.request.apiKey,/^[a-f0-9]{64}$/);assert.ok(!seen.args.includes(seen.request.apiKey));
  const withoutRelease=await probeQwenCpuOwnership({config,portSupplier:async()=>12345,spawnImpl:launcher([{event:'probe-ok'}],{})});
  assert.equal(withoutRelease.ok,false);assert.equal(withoutRelease.errorCode,'qwen-ownership-unconfirmed');
});
test('probe reports busy or denied resources without granting capability', {skip:process.platform!=='win32'},async()=>{
  for(const code of ['resource-busy','resource-recovery-required','resource-lock-unavailable','memory-unavailable','port-unavailable','files-invalid']) {
    const result=await probeQwenCpuOwnership({config,portSupplier:async()=>12345,spawnImpl:launcher([{event:'released'},{event:'error',code}],{})});
    assert.equal(result.ok,false);assert.equal(result.errorCode,'qwen-'+code);
  }
});
test('failure diagnostics retain only allowed stage and numeric OS error', {skip:process.platform!=='win32'},async()=>{
  const result=await probeQwenCpuOwnership({config,portSupplier:async()=>12345,spawnImpl:launcher([{event:'released'},{event:'error',code:'runtime-unavailable',stage:'job-create',winError:5,path:'private-path',apiKey:'private-key'}],{})});
  assert.equal(result.ok,false);assert.deepEqual(result.diagnostic,{origin:'supervisor',stage:'job-create',winError:5});assert.doesNotMatch(JSON.stringify(result),/private-path|private-key/);
});
test('pre-cancelled probe does not spawn anything', {skip:process.platform!=='win32'},async()=>{
  const controller=new AbortController();controller.abort();let spawned=false;
  const result=await probeQwenCpuOwnership({config,signal:controller.signal,spawnImpl:()=>{spawned=true;}});
  assert.equal(result.errorCode,'qwen-preflight-cancelled');assert.equal(spawned,false);
});
test('cancelling an active probe closes only its own input and waits for release', {skip:process.platform!=='win32'},async()=>{
  const controller=new AbortController(),seen={};
  const spawnImpl=()=>{
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.kill=()=>{seen.killed=true;child.emit('close',1,null);};
    child.stdin.on('data',()=>{seen.started=true;});child.stdin.on('end',()=>{seen.closed=true;child.stdout.write(JSON.stringify({event:'released'})+'\n');child.stdout.end();child.emit('close',1,null);});
    process.nextTick(()=>child.emit('spawn'));return child;
  };
  const pending=probeQwenCpuOwnership({config,signal:controller.signal,portSupplier:async()=>12345,spawnImpl});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(seen.started,true);controller.abort();
  const result=await pending;assert.equal(seen.closed,true);assert.equal(seen.killed,undefined);assert.equal(result.errorCode,'qwen-preflight-cancelled');
});
test('actual raw pipe watcher permits probe exit and detects EOF', {skip:process.platform!=='win32' || spawnSync('python',['--version']).status!==0},async()=>{
  const source=readFileSync(new URL('../../worker/src/gemma-cpu-supervisor.py',import.meta.url),'utf8');
  const watcher=source.match(/    def watch_pipe\(\):[\s\S]*?(?=    threading\.Thread\(target=watch_pipe)/)?.[0];assert.ok(watcher);
  async function run(mode) {
    const program="import os,sys,threading,time,textwrap\npipe_closed=threading.Event()\nevent=None\ndef set_event(_): pass\nexec(textwrap.dedent("+JSON.stringify(watcher)+"))\nsys.stdin.buffer.readline()\nthreading.Thread(target=watch_pipe,daemon=True).start()\nprint('ready',flush=True)\n"+(mode==='eof'?"print('eof' if pipe_closed.wait(3) else 'timeout',flush=True)\n":"time.sleep(.1)\n");
    const child=spawn('python',['-B','-X','utf8','-u','-c',program],{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',v=>{out+=v;if(mode==='eof'&&out.includes('ready'))child.stdin.end();});child.stderr.on('data',v=>err+=v);
    const exited=new Promise(resolve=>child.once('close',code=>resolve(code)));child.stdin.write('{}\n');
    let timer;const code=await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),5000);})]);clearTimeout(timer);
    if(code===null){child.kill();await exited;throw Error('test watcher did not exit');}
    assert.equal(code,0);assert.doesNotMatch(err,/Fatal Python error/);assert.match(out,/ready/);if(mode==='eof')assert.match(out,/eof/);
  }
  await run('open');await run('eof');
});
