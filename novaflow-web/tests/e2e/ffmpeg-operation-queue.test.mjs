import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../renderer/novaflow-web-capabilities.js',import.meta.url),'utf8');

test('a resource probe cannot overwrite a frame decoder log, and a failed job releases the shared ffmpeg queue',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const events=[];let log=null;
 const api={aiSeqProbeVideoMeta:async()=>{events.push('probe');log={text:'probe metadata'};await gate;assert.equal(log.text,'probe metadata');log=null;throw Error('probe rejected');},exportDecodeVideoFrames:async()=>{events.push('decode');log={text:'decoded frames'};await Promise.resolve();assert.equal(log.text,'decoded frames');log=null;return {frames:40};}};
 const root={api};vm.createContext(root);const start=source.indexOf('  let ffmpegOperationTail=Promise.resolve();'),end=source.indexOf('  runtime.capabilities =',start);assert.ok(start>0&&end>start);vm.runInContext(source.slice(start,end),root);
 const first=api.aiSeqProbeVideoMeta(),second=api.exportDecodeVideoFrames();await Promise.resolve();assert.deepEqual(events,['probe']);release();await assert.rejects(first,/probe rejected/);assert.equal((await second).frames,40);assert.deepEqual(events,['probe','decode']);
});
