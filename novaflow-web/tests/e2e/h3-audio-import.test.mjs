import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
const root=new URL('../../renderer/',import.meta.url);
const c=createContext({console,Blob,crypto:{randomUUID},setTimeout,clearTimeout});c.window=c;c.globalThis=c;
for(const f of ['ai-sequence-minimax-h3.resource.js','ai-sequence-minimax-h3.workflow.js','ai-sequence-h3-media.js'])runInContext(await readFile(new URL(f,root),'utf8'),c,{filename:f});
const M=c.NovaFlowH3Media;
const wav=(seconds=2)=>{const bytes=Buffer.alloc(44+24000*2*seconds);bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(24000,24);bytes.writeUInt32LE(48000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return new Blob([bytes],{type:'audio/wav'});};
const file=(name,kind='audio',seconds=2)=>new File([kind==='audio'?wav(seconds):new Uint8Array([1,2,3])],name,{type:kind+'/'+(kind==='audio'?'wav':'mp4'),lastModified:1});
const read=async b=>'data:'+b.type+';base64,'+Buffer.from(await b.arrayBuffer()).toString('base64');
const duration=async x=>{const bytes=Buffer.from(x.dataUrl.split(',')[1],'base64');return (bytes.length-44)/48000;};
const extracted=async f=>/silent/.test(f.name)?{ok:false,error:'这个视频没有音轨'}:/broken/.test(f.name)?{ok:false,error:'视频解码失败'}:{ok:true,blob:wav(),fileName:f.name.replace(/\.mp4$/,'.wav')};
function setup(extract=extracted){const db=new Map();const storage={get:async k=>db.get(k),put:async(k,v)=>db.set(k,structuredClone(v))};const store=M.createStore(storage),importer=M.createImporter(store,{extractAudio:extract,readFile:read,duration});return {store,importer,storage};}
let checks=0;
{
 const {store,importer,storage}=setup();await store.load('a');const source=file('motion.mp4','video');const result=await importer.importFiles('audio',[source,file('voice.wav')]);assert.equal(result.errors.length,0);assert.equal(store.get().length,2);assert(store.get().every(x=>x.kind==='audio'&&x.dataUrl.startsWith('data:audio/wav;')));assert.equal(store.get()[0].originalFileName,'motion.mp4');assert.equal(store.get()[0].derivedFromVideo,true);assert.equal(source.name,'motion.mp4');
 const reopened=M.createStore(storage);await reopened.load('a');assert.deepEqual(JSON.parse(JSON.stringify(reopened.get())),JSON.parse(JSON.stringify(store.get())));
 for(const profile of ['beta5_int8']){const resources=store.getResources();const compiled=c.NovaFlowAiSequenceMiniMaxH3Resource.compileMentions('@参考音频 2',resources);assert.equal(compiled.mentions[0].sourceId,resources[1].sourceId);const graph=c.NovaFlowAiSequenceMiniMaxH3Workflow.buildWorkflow({profile,mode:'r2v',prompt:compiled.text,referenceAudios:['motion.wav','voice.wav'],referenceImages:[],referenceVideos:[],width:256,height:256,durationSeconds:1,fps:24,seed:3});const cond=Object.values(graph).find(x=>x.class_type==='MiniMaxH3ReferenceToVideo');assert.equal(Object.keys(cond.inputs).filter(x=>x.startsWith('ref_audios.')).length,2);assert.equal(Object.keys(cond.inputs).filter(x=>x.startsWith('ref_videos.')).length,0);assert.equal(Object.values(graph).filter(x=>x.class_type==='LoadVideo').length,0);}
 checks++;console.log('PASS normal/audio-track import, original bytes untouched, persisted WAV identities and audio-only graphs on beta5');
}
{
 const {store,importer}=setup();await store.load('a');const result=await importer.importFiles('audio',[file('silent.mp4','video'),file('valid.wav'),file('broken.mp4','video')]);assert.equal(result.errors.length,2);assert.equal(store.get().length,1);assert.equal(store.get()[0].fileName,'valid.wav');const notices=importer.takeNotices('a');assert.equal(notices.length,1);assert.equal(notices[0].errors.length,2);assert.equal(importer.takeNotices('a').length,0);checks++;console.log('PASS mixed batch saves valid inputs and aggregates failures once, no fake cards');
}
{
 const {store,importer}=setup();await store.load('a');const result=await importer.importFiles('audio',Array.from({length:5},(_,i)=>file('v'+i+'.mp4','video')));assert.equal(result.imported.length,3);assert.equal(result.errors.length,2);assert.equal(store.get().length,3);assert.equal(importer.pending('a'),0);checks++;console.log('PASS three-audio reservations and full capacity');
}
{
 let release,started=false;const gate=new Promise(ok=>release=ok);const {store,importer}=setup(async f=>{started=true;await gate;return extracted(f)});await store.load('a');await importer.importFiles('audio',[file('existing.wav')]);const existing=store.get()[0];const clip=file('pending.mp4','video');const first=importer.importFiles('audio',[clip]);for(let i=0;i<30&&!started;i++)await new Promise(ok=>setTimeout(ok,1));assert(started);
 const duplicate=importer.importFiles('audio',[clip],{boardId:'a'});await store.load('b');await store.remove(existing.sourceId); // operates on b; a must remain intact
 assert.equal(store.get('a').length,1);await store.add([{...existing,sourceId:'b-audio'}],'b');await store.remove('b-audio');release();await first;const second=await duplicate;assert.equal(second.errors.length,1);assert.equal(store.activeBoard(),'b');assert.equal(store.get('b').length,0);assert.equal(store.get('a').length,2);assert.equal(importer.takeNotices('a').flatMap(x=>x.errors).length,1);checks++;console.log('PASS duplicate drop, background board switch and deletion cannot redirect the extracted source');
}
{
 const {store,importer}=setup();await store.load('a');await importer.importFiles('audio',[file('long.wav','audio',12)]);const result=await importer.importFiles('audio',[file('over-total.wav','audio',4),file('short.wav','audio',1)]);assert.equal(result.errors.length,2);assert.equal(store.get().length,1);assert.equal(store.get()[0].durationSec,12);checks++;console.log('PASS individual 2–15 seconds and aggregate 15-second limits preserve existing audio');
}
{
 let release,started=false;const gate=new Promise(ok=>release=ok);const {store,importer}=setup(async f=>{started=true;await gate;return extracted(f)});await store.load('a');await importer.importFiles('audio',[file('remove.wav')]);const old=store.get()[0];const pending=importer.importFiles('audio',[file('new.mp4','video')]);for(let i=0;i<30&&!started;i++)await new Promise(ok=>setTimeout(ok,1));await store.remove(old.sourceId);release();await pending;const resource=store.getResources()[0];assert.equal(resource.label,'参考音频 1');assert.notEqual(resource.sourceId,old.sourceId);assert.equal(resource.originalFileName,'new.mp4');checks++;console.log('PASS deletion during extraction and sourceId renumbering');
}
console.log('PASS '+checks+' importer scenarios');
