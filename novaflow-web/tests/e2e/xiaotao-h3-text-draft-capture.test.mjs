import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../../renderer/xiaotao-media-agent.js',import.meta.url),'utf8');

function fixture(mode='text_video') {
  let sub='video',open=true,writes=0,submits=0,snapshots=0;
  const state={boardId:'board-a',boardRevision:0,mode:'minimax_h3_local',genType:mode,prompt:'镜头缓慢推近',h3:{seconds:4},h3References:[]};
  const resources=[];
  const boardIdentity=Symbol('board');
  const root={setTimeout,clearTimeout,__NovaFlowArtGenerate:{captureContext:()=>({routeRevision:0})},
    document:{querySelectorAll:()=>[]},
    NovaFlowAudioStudio:{isOpen:()=>open,sub:()=>sub,routeRevision:()=>0},
    NovaFlowH3Media:{snapshot:async()=>{snapshots++;}},
    NovaFlowAiSequenceGeneration:{boardIdentity:()=>boardIdentity,capture:()=>JSON.parse(JSON.stringify(state)),
      optimizationContext:async()=>({modelId:'minimax_h3_local',mode:state.genType,durationSeconds:4,resources:JSON.parse(JSON.stringify(resources))}),
      setRequest:()=>{writes++;},submit:()=>{submits++;}}
  };
  vm.createContext(root);vm.runInContext(source,root);
  return {root,state,resources,setSub:value=>sub=value,setOpen:value=>open=value,
    get writes(){return writes;},get submits(){return submits;},get snapshots(){return snapshots;}};
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('all H3 modes capture text and reference identities only, without editor writes',async()=>{
  for(const mode of ['text_video','image_video','first_last','multi_reference']) {
    const f=fixture(mode);
    if(mode!=='text_video') {
      f.resources.push({key:'first_frame',kind:'image',sourceId:'image-1',occupied:true,dataUrl:'data:image/png;base64,SECRET'});
      f.state.h3References=[{sourceId:'image-1'}];
    }
    const result=await f.root.NovaFlowMediaAgent.captureH3TextDraft({requestId:'request-1',requirements:'动作柔和'});
    assert.equal(result.request.mode,'video-rewrite');assert.equal(result.request.h3Mode,mode);
    assert.equal(result.request.durationSeconds,4);assert.equal(result.request.prompt,'镜头缓慢推近');
    assert.deepEqual(plain(result.request.references),mode==='text_video'?[]:[{key:'first_frame',kind:'image',sourceId:'image-1'}]);
    assert.doesNotMatch(JSON.stringify(result.request),/SECRET|data:image/);assert.equal(result.isCurrent(),true);
    assert.equal(f.writes,0);assert.equal(f.submits,0);assert.equal(f.snapshots,mode==='multi_reference'?1:0);
  }
});

test('closing, switching panels, boards or references invalidates a captured draft',async()=>{
  for(const change of ['close','panel','board','reference','prompt']) {
    const f=fixture('multi_reference');f.resources.push({key:'image_1',kind:'image',sourceId:'one',occupied:true});f.state.h3References=[{sourceId:'one'}];
    const result=await f.root.NovaFlowMediaAgent.captureH3TextDraft({requestId:'request-2'});
    if(change==='close')f.setOpen(false);if(change==='panel')f.setSub('audio');if(change==='board')f.state.boardId='board-b';
    if(change==='reference')f.state.h3References[0].sourceId='two';if(change==='prompt')f.state.prompt='用户后续修改';
    assert.equal(result.isCurrent(),false,change);assert.equal(f.writes,0);assert.equal(f.submits,0);
  }
});

test('changes during asynchronous capture and missing references fail before submission',async()=>{
  const f=fixture('image_video');f.resources.push({key:'first_frame',kind:'image',sourceId:'one',occupied:true});
  const original=f.root.NovaFlowAiSequenceGeneration.optimizationContext;
  f.root.NovaFlowAiSequenceGeneration.optimizationContext=async()=>{const ctx=await original();f.state.boardId='board-b';return ctx;};
  await assert.rejects(f.root.NovaFlowMediaAgent.captureH3TextDraft({requestId:'request-3'}),/视频上下文已变化/);
  const missing=fixture('first_last');missing.resources.push({key:'first_frame',kind:'image',sourceId:'',occupied:false});
  await assert.rejects(missing.root.NovaFlowMediaAgent.captureH3TextDraft({requestId:'request-4'}),/补齐参考素材/);
  assert.equal(f.writes+missing.writes,0);assert.equal(f.submits+missing.submits,0);
});
