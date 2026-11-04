import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {validateFoartMediaOperation,foartPlanResponseFormat} from '../../packages/shared/src/foart-tool-plan.mjs';
const studio=await readFile(new URL('../../renderer/audio-studio.tool.js',import.meta.url),'utf8');
const media=await readFile(new URL('../../renderer/xiaotao-media-agent.js',import.meta.url),'utf8');
const resourceBridge=await readFile(new URL('../../renderer/ai-sequence-video-merge.resource-bridge.js',import.meta.url),'utf8');
const entry=await readFile(new URL('../../renderer/assets/index-BbIa-2NM.js',import.meta.url),'utf8');
const workspace=await readFile(new URL('../../renderer/video-editor.workspace.js',import.meta.url),'utf8');

test('the native visible-card fallback preserves an audio filename even when the shared card uses a video element',()=>{
 const root={documentRef:{querySelector:()=>({getAttribute:()=>null,querySelector:()=>({tagName:'VIDEO',src:'blob:actual-wav'}),querySelectorAll:()=>[{childElementCount:0,textContent:'audio_1_mix.wav'}]})},CSS_escape:s=>s,text:(s,f)=>String(s||f||''),isAudioName:s=>/\.wav$/i.test(s)};
 vm.createContext(root);const start=workspace.indexOf('    function cardMediaDescriptor('),end=workspace.indexOf('    function CSS_escape(',start);vm.runInContext(workspace.slice(start,end),root);
 const actual=root.cardMediaDescriptor('mix');assert.equal(actual.fileName,'audio_1_mix.wav');assert.equal(actual.mimeType,'audio/wav');assert.equal(actual.objectUrl,'blob:actual-wav');
});

test('the real resource-list API resolves its WAV cache and preserves the original video-only resolver',async()=>{
 const marker='resolveMediaResource:async',start=entry.indexOf(marker),end=entry.indexOf('resolveVideoResource:async',start);
 assert.ok(start>0&&end>start);const blob=new Blob(['real encoded WAV'],{type:'audio/wav'}),items=[{id:'mix',filename:'audio_1_mix.wav',mimeType:'audio/wav',localPath:'web-audio://1/audio_1_mix.wav',objectUrl:'blob:mix'},{id:'video',filename:'original.mp4',mimeType:'video/mp4'}];let videoReads=0;
 const sandbox={File,et:{current:items},window:{NovaFlowWebRuntime:{videoOutputs:new Map([[items[0].localPath,{blob}]])},NovaFlowAiSequenceAssetBridge:{resolveVideoResource:async id=>{videoReads++;return {resourceId:id,fileName:'original.mp4',mimeType:'video/mp4',blob:new Blob(['video'],{type:'video/mp4'})};}}}};
 vm.createContext(sandbox);vm.runInContext('globalThis.api={'+entry.slice(start,end)+'};',sandbox);
 const actual=await sandbox.api.resolveMediaResource('mix');assert.equal(actual.blob,blob);assert.equal(actual.fileName,'audio_1_mix.wav');assert.equal(actual.mimeType,'audio/wav');assert.equal(videoReads,0);
 const adapterRoot={};vm.runInNewContext(resourceBridge,adapterRoot);
 const adapter=adapterRoot.NovaFlowAiSequenceVideoMergeResourceBridge.createAdapter({allowAudio:true,assetBridge:{...sandbox.api,resolveVideoResource(){throw Error('WAV must not enter the video-only resolver')}}});
 assert.equal((await adapter.resolveResource('mix')).blob,blob);
 assert.equal((await sandbox.api.resolveMediaResource('video')).fileName,'original.mp4');assert.equal(videoReads,1);
 await assert.rejects(sandbox.api.resolveMediaResource('unknown'),/not found/);
});

test('mixed-media editors resolve published WAV bytes without misclassifying them through a video card fallback',async()=>{
 const sandbox={};vm.runInNewContext(resourceBridge,sandbox);const bridge=sandbox.NovaFlowAiSequenceVideoMergeResourceBridge;
 const blob=new Blob(['real WAV bytes'],{type:'audio/wav'}),descriptor={resourceId:'mix',fileName:'actual_mix.wav',blob,objectUrl:'blob:mix',mimeType:'audio/wav'};
 const assetBridge={resolveVideoResource:async()=>descriptor};
 await assert.rejects(bridge.createAdapter({assetBridge}).resolveResource('mix'),/unsupported_video/);
 const actual=await bridge.createAdapter({assetBridge,allowAudio:true}).resolveResource('mix');
 assert.equal(actual.fileName,'actual_mix.wav');assert.equal(actual.mimeType,'audio/wav');assert.equal(actual.blob,blob);
 const image={...descriptor,fileName:'source.png',mimeType:'image/png',blob:new Blob(['PNG'],{type:'image/png'})};
 const images={resolveVideoResource:async()=>image};await assert.rejects(bridge.createAdapter({assetBridge:images,allowAudio:true}).resolveResource('mix'),/unsupported_video/);
 assert.equal((await bridge.createAdapter({assetBridge:images,allowImages:true}).resolveResource('mix')).fileName,'source.png');
});
test('native audio Save to resources returns its actual mix and publication without starting a download',async()=>{
 const blob=new Blob(['native mix bytes'],{type:'audio/wav'}),saved=[];
 const sandbox={Blob,URL,saving:false,state:{resources:[],counter:{import:0},refPreview:{enabled:false}},ui:{statusErr:{},saveNote:{}},mixdown:async()=>({blob,name:'actual_mix'}),decode:async()=>({duration:2}),renderList(){},busy(){},publishAudio:async r=>r.publishedId='actual-video-resource',window:{NovaFlowWebWarehouse:{save:async f=>saved.push(f)}},document:{createElement(){throw Error('Resource save must not download')}}};
 vm.createContext(sandbox);const start=studio.indexOf('  async function saveMix('),end=studio.indexOf('  let saving =',start);vm.runInContext(studio.slice(start,end),sandbox);
 const receipt=await sandbox.saveMix({fromAgent:true});assert.equal(receipt.action,'save_mix');assert.equal(receipt.name,'actual_mix.wav');assert.equal(receipt.bytes,blob.size);assert.equal(receipt.publishedId,'actual-video-resource');assert.equal(receipt.seconds,2);assert.equal(saved[0].blob,blob);assert.equal(sandbox.state.resources.length,1);assert.equal(sandbox.saving,false);
 URL.revokeObjectURL(sandbox.state.resources[0].url);
 sandbox.decode=async()=>{throw Error('native audio decode failed')};await assert.rejects(sandbox.saveMix({fromAgent:true}),/native audio decode failed/);assert.equal(sandbox.saving,false);assert.equal(sandbox.state.resources.length,1);
});
test('video volume/repetition cannot create silent unused properties; native audio actions remain available',()=>{
 const ctx={};vm.runInNewContext(media,ctx);const clip={id:'clip'},track={id:'track',clips:[clip]},editor={state:{tracks:[track]}};
 for(const action of ['volume','loops','track_gain','track_solo']){
  const operation={action,target:'video',clipId:'clip',trackId:'track',value:1,enabled:true};assert.throws(()=>ctx.NovaFlowMediaAgent.edit(editor,operation),/音频编辑器/);assert.throws(()=>validateFoartMediaOperation(operation));
 }
 assert.equal(clip.gain,undefined);assert.equal(clip.loops,undefined);assert.equal(track.gain,undefined);assert.equal(track.solo,undefined);
 assert.doesNotThrow(()=>validateFoartMediaOperation({action:'save_mix',target:'audio'}));assert.doesNotThrow(()=>validateFoartMediaOperation({action:'volume',target:'audio',value:.4}));
 const schemas=foartPlanResponseFormat().schema.properties.operations.items.anyOf.find(s=>s.properties.action.const==='media').properties.operation.anyOf;
 for(const action of ['volume','loops','track_gain','track_solo','save_mix'])assert.equal(schemas.find(s=>s.properties.action.const===action).properties.target.const,'audio');
});
