const test=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {guardStdio}=require('../main/stdio-guard');
const {spawn}=require('node:child_process');
test('closed launcher output cannot crash Electron; unrelated errors still surface',()=>{
  const stream=new PassThrough(); guardStdio(stream); guardStdio(stream);
  assert.equal(stream.listenerCount('error'),1);
  assert.doesNotThrow(()=>stream.emit('error',Object.assign(new Error('broken pipe'),{code:'EPIPE'})));
  assert.throws(()=>stream.emit('error',Object.assign(new Error('unexpected I/O'),{code:'EIO'})),/unexpected I\/O/);
});
test('process survives a real stdout reader disconnect',async()=>{
  const helper=require.resolve('../main/stdio-guard');
  const script=`require(${JSON.stringify(helper)}).installStdioGuards(); process.on('message',()=>{console.log('closed pipe');setTimeout(()=>{process.send('survived');process.disconnect();},50);});process.send('ready');`;
  const child=spawn(process.execPath,['-e',script],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  const messages=[];
  child.on('message',message=>{messages.push(message);if(message==='ready'){child.stdout.destroy();child.send('write');}});
  const timer=setTimeout(()=>child.kill(),5000);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  clearTimeout(timer);
  assert.equal(code,0);assert.deepEqual(messages,['ready','survived']);
});
