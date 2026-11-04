import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../renderer/video-frame-edit.tool.js',import.meta.url),'utf8');

test('the native agent entry expands its original toolbar and returns decoder failures without blocking the page with an alert',async()=>{
 class Element{};let collapsed=true,failed=false,opened=0;
 const section=new Element();section.getAttribute=()=>collapsed?'1':'0';section.querySelector=()=>({click(){collapsed=false;}});
 const root={HTMLElement:Element,document:{querySelector:()=>section},agentContext:()=>({frames:40}),open:async options=>{opened++;assert.equal(collapsed,false);assert.equal(options.postSection,section);if(failed){options.onError('实际解码失败');return false;}return true;}};
 vm.createContext(root);const start=source.indexOf('  async function openForAgent()'),end=source.indexOf('  function agentContext()',start);assert.ok(start>0&&end>start);vm.runInContext(source.slice(start,end),root);
 assert.equal((await root.openForAgent()).frames,40);failed=true;await assert.rejects(root.openForAgent(),/实际解码失败/);assert.equal(opened,2);
});

test('native preview identity follows the actual video bytes even when a different resource card is still highlighted',()=>{
 const old={getAttribute:()=> 'old',querySelectorAll:()=>[{src:'blob:old'}]},actual={getAttribute:()=> 'new-result',querySelectorAll:()=>[{src:'blob:new'}]},root={window:{},document:{querySelectorAll:()=>[old,actual]},findViewport:()=>({}),findStageVideo:()=>({currentSrc:'blob:new',src:'blob:new',readyState:4,videoWidth:256,videoHeight:256}),findSourceName:()=> 'actual-new.mp4'};
 vm.createContext(root);const start=source.indexOf('  function previewContext()'),end=source.indexOf('  function readDockFps()',start);vm.runInContext(source.slice(start,end),root);
 const current=root.previewContext();assert.equal(current.resourceId,'new-result');assert.equal(current.sourceName,'actual-new.mp4');assert.equal(current.ready,true);
});

test('frame-edit receipt describes the actual encoded order and is committed only after native resource import',async()=>{
 const writes=[],encoded=[],files=[];let accepted=true,closes=0;
 const state={model:{order:[1,0,1]},frames:[new Uint8Array([10]),new Uint8Array([20])],busy:false,fps:15,width:256,height:256,alpha:false,sourceName:'original.mp4',open:true};
 const api={exportCreateTempDir:async()=>({ok:true,dir:'test-native-dir'}),writeBinaryFile:async r=>{writes.push(r.bytes[0]);return {ok:true}},exportEncodeFramesToVideo:async options=>{encoded.push(options);return {ok:true,base64:btoa('encoded video'),mimeType:'video/mp4'}},exportCleanupDir:async()=>{}};
 const root={File,Uint8Array,atob,state,api:()=>api,core:()=>({outputFileName:()=> 'original_edit.mp4'}),renderPanel(){},emitState(){},setStatus(){},addToResourceList:file=>{files.push(file);return accepted},close:()=>{closes++;state.open=false},lastAppliedResult:null};
 vm.createContext(root);const start=source.indexOf('  async function apply()'),end=source.indexOf('  // 保存选中帧:',start);vm.runInContext(source.slice(start,end),root);
 assert.equal(await root.apply(),true);assert.deepEqual(writes,[20,10,20]);assert.equal(encoded[0].fps,15);assert.equal(closes,1);
 assert.deepEqual(JSON.parse(JSON.stringify(root.lastAppliedResult)),{fileName:'original_edit.mp4',sourceName:'original.mp4',sourceFrames:2,frames:3,fps:15,width:256,height:256,bytes:files[0].size});
 const previous=root.lastAppliedResult;accepted=false;state.open=true;state.model.order=[0];assert.equal(await root.apply(),false);assert.equal(root.lastAppliedResult,previous);assert.equal(closes,1);assert.equal(state.busy,false);
});
