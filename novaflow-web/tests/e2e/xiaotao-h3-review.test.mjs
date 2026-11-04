import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../../renderer/xiaotao-media-agent.js',import.meta.url),'utf8');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aS0AAAAASUVORK5CYII=';
function fixture(){
  const state={boardId:'board-a',boardRevision:0,mode:'minimax_h3_local',genType:'first_last',prompt:'旧提示词',h3:{seconds:2},references:['first','last']};
  let open=true,sub='video',writes=0,submits=0,bound=true,routeRevision=1,mediaRevision=1,boardIdentity=Symbol('board');
  const resources=[{key:'first_frame',kind:'image',sourceId:'first',occupied:true,previewUrl:png},{key:'last_frame',kind:'image',sourceId:'last',occupied:true,previewUrl:png}];
  const root={setTimeout,clearTimeout,document:{querySelectorAll:()=>[]},__NovaFlowArtGenerate:{captureContext:()=>({routeRevision})},NovaFlowAudioStudio:{isOpen:()=>open,sub:()=>sub,routeRevision:()=>mediaRevision},
    NovaFlowAiSequenceGeneration:{boardIdentity:()=>boardIdentity,capture:()=>JSON.parse(JSON.stringify(state)),optimizationContext:async()=>({modelId:'minimax_h3_local',mode:'first_last',durationSeconds:2,resources:JSON.parse(JSON.stringify(resources))}),
      setRequest:({prompt})=>{writes++;state.prompt=prompt;},submit:()=>{submits++;}}};
  vm.createContext(root);vm.runInContext(source,root);
  return {root,state,resources,binding:()=>bound,setBound:x=>bound=x,setSub:x=>sub=x,setRoute:x=>routeRevision=x,setMediaRoute:x=>mediaRevision=x,remount:()=>boardIdentity=Symbol('new board'),get writes(){return writes;},get submits(){return submits;}};
}
test('only explicit reference-image capture includes two role-bound images, with no write or generation',async()=>{
  const f=fixture(),plain=await f.root.NovaFlowMediaAgent.captureH3TextDraft({requestId:'request-1'});
  assert.equal('images' in plain.request,false);
  const visual=await f.root.NovaFlowMediaAgent.captureH3TextDraft({requestId:'request-2',includeReferenceImages:true,sourcePrompt:'对话里的提示词'});
  assert.equal(visual.request.prompt,'对话里的提示词');assert.equal(visual.request.images.length,2);
  assert.equal(visual.request.images[0].key,'first_frame');assert.equal(visual.request.images[1].key,'last_frame');
  assert.equal(f.writes,0);assert.equal(f.submits,0);
});
test('confirmed draft applies and undoes only the unchanged workspace without generation',async()=>{
  const f=fixture(),review=await f.root.NovaFlowMediaAgent.captureH3TextDraft({requestId:'request-3'});
  await assert.rejects(review.applyDraft('优化后的提示词',{bindingCurrent:f.binding}),/未应用/);
  assert.equal(f.writes,0);
  assert.equal((await review.applyDraft('优化后的提示词',{userConfirmed:true,bindingCurrent:f.binding})).phase,'applied');
  assert.equal(f.state.prompt,'优化后的提示词');assert.equal(f.submits,0);
  assert.equal((await review.undoDraft({userConfirmed:true,bindingCurrent:f.binding})).phase,'undone');
  assert.equal(f.state.prompt,'旧提示词');assert.equal(f.writes,2);assert.equal(f.submits,0);
});
test('reference, board, prompt, account or panel changes cannot apply or undo stale reviews',async()=>{
  for(const change of ['reference','board','prompt','account','panel']){
    const f=fixture(),review=await f.root.NovaFlowMediaAgent.captureH3TextDraft({requestId:'request-4'});
    if(change==='reference')f.state.references[0]='changed';if(change==='board')f.state.boardId='other';if(change==='prompt')f.state.prompt='新提示词';if(change==='account')f.setBound(false);if(change==='panel')f.setSub('audio');
    await assert.rejects(review.applyDraft('草稿',{userConfirmed:true,bindingCurrent:f.binding}));assert.equal(f.writes,0,change);
  }
  const f=fixture(),review=await f.root.NovaFlowMediaAgent.captureH3TextDraft({requestId:'request-5'});
  await review.applyDraft('草稿',{userConfirmed:true,bindingCurrent:f.binding});f.state.prompt='用户手动改了';
  await assert.rejects(review.undoDraft({userConfirmed:true,bindingCurrent:f.binding}),/未撤销/);assert.equal(f.state.prompt,'用户手动改了');
});
test('asynchronous editor setter must become observable before reporting success',async()=>{
  const f=fixture();let submits=0;
  f.root.NovaFlowAiSequenceGeneration.setRequest=({prompt})=>setTimeout(()=>{f.state.prompt=prompt;},10);
  f.root.NovaFlowAiSequenceGeneration.submit=()=>{submits++;};
  const review=await f.root.NovaFlowMediaAgent.captureH3TextDraft({requestId:'request-6'});
  assert.equal((await review.applyDraft('异步草稿',{userConfirmed:true,bindingCurrent:f.binding})).phase,'applied');
  assert.equal(f.state.prompt,'异步草稿');
  assert.equal((await review.undoDraft({userConfirmed:true,bindingCurrent:f.binding})).phase,'undone');
  assert.equal(f.state.prompt,'旧提示词');assert.equal(submits,0);
});
test('leaving and returning, board ABA or remount invalidates review even if visible values match',async()=>{
  for(const kind of ['route','media','board','remount']){
    const f=fixture(),review=await f.root.NovaFlowMediaAgent.captureH3TextDraft({requestId:'request-7'});
    if(kind==='route')f.setRoute(3);if(kind==='media')f.setMediaRoute(3);if(kind==='board')f.state.boardRevision+=2;if(kind==='remount')f.remount();
    await assert.rejects(review.applyDraft('草稿',{userConfirmed:true,bindingCurrent:f.binding}));assert.equal(f.writes,0,kind);
  }
});
test('source choice snapshot is captured before user selection and fails closed on page or board changes',()=>{
  for(const kind of ['route','media','board','remount','prompt']){
    const f=fixture(),guard=f.root.NovaFlowMediaAgent.captureH3PromptSourceGuard();
    assert.equal(guard.pagePrompt,'旧提示词');assert.equal(guard.isCurrent(),true);
    if(kind==='route')f.setRoute(3);if(kind==='media')f.setMediaRoute(3);if(kind==='board')f.state.boardRevision+=2;if(kind==='remount')f.remount();if(kind==='prompt')f.state.prompt='其他提示词';
    assert.equal(guard.isCurrent(),false,kind);assert.equal(f.writes,0);assert.equal(f.submits,0);
  }
});
