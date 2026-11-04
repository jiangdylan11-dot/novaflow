import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const ops=await readFile(new URL('../../renderer/spine-structure.ops.js',import.meta.url),'utf8');
const editor=await readFile(new URL('../../renderer/spine-skeleton-editor.js',import.meta.url),'utf8');
function fixture(extra={}){
  const state={json:{skeleton:{spine:'3.8.99'},bones:[{name:'root'},{name:'hair',parent:'root',x:20,y:10},{name:'body',parent:'root'}],slots:[],skins:[{name:'default',attachments:{}}],animations:{idle:{bones:{hair:{translate:[{time:0,x:1,y:4},{time:1,x:2,y:3}]},body:{rotate:[{time:0,angle:5}]}}}}},anim:'idle',mode:'animate',frame:0,temp:new Map(),history:[],future:[],dope:{}};
  const box={state,FPS:30,rt:{data:{findAnimation:()=>({duration:2})}},readData:()=>({findAnimation:()=>({duration:2})}),crypto:webcrypto,selectedBones:()=>['hair'],
    setMode:mode=>state.mode=mode,audioPlayer:{stop(){}},applyJson:json=>{state.json=json},validateSelection(){},status(){},refresh(){},...extra};
  vm.createContext(box);vm.runInContext(ops,box);box.Ops=box.NovaFlowSpineStructureOps;
  vm.runInContext(editor.slice(editor.indexOf('  function snapshot()'),editor.indexOf('  function undo()')),box);
  const start=editor.indexOf('  const agentJsonIds ='),end=editor.indexOf('  const tickedOf =',start);
  vm.runInContext(editor.slice(start,end),box);return box;
}
const operation={operation:'key_bones',name:'idle',keys:[{boneName:'hair',frame:0,values:{x:21}}]};
const baseline=box=>box.agentInspectBones({name:'idle',boneNames:['hair']});

test('preview uses the real native operation, exposing an implicit paired-axis reset without editing',()=>{
  const box=fixture(),before=JSON.stringify(box.state.json),preview=box.agentPreviewCommunityKeys(operation,baseline(box));
  assert.equal(JSON.stringify(box.state.json),before);assert.equal(box.state.history.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(preview.targets)),['hair']);
  const track=preview.changes.find(change=>change.channel==='translate');
  assert.equal(track.before[0].y,4);assert.equal(track.after[0].y,0);
  assert.match(preview.warning,/视觉联动/);
  assert.throws(()=>box.agentCommitCommunityKeys(preview.token,[]),/未修改作品/);
  assert.equal(JSON.stringify(box.state.json),before);
});

test('confirmed preview applies once only while the entire project remains unchanged',()=>{
  const box=fixture(),body=JSON.stringify(box.state.json.animations.idle.bones.body);
  const preview=box.agentPreviewCommunityKeys(operation,baseline(box));
  box.agentCommitCommunityKeys(preview.token,['hair']);
  assert.equal(box.state.history.length,1);assert.equal(box.state.json.animations.idle.bones.hair.translate[0].y,0);
  assert.equal(JSON.stringify(box.state.json.animations.idle.bones.body),body);
  assert.throws(()=>box.agentCommitCommunityKeys(preview.token,['hair']),/未修改作品/);
});

test('missing, stale, incomplete or out-of-duration baselines fail closed',()=>{
  for(const kind of ['missing','stale','incomplete','duration']){
    const box=fixture(),good=baseline(box),before=JSON.stringify(box.state.json);
    if(kind==='stale')box.state.json.animations.idle.bones.hair.translate[0].y=7;
    const candidate=kind==='duration'?{...operation,keys:[{boneName:'hair',frame:90,values:{x:21}}]}:operation;
    const selected=kind==='missing'?null:kind==='incomplete'?{...good,complete:false}:good;
    assert.throws(()=>box.agentPreviewCommunityKeys(candidate,selected),/未修改作品/);
    assert.equal(box.state.history.length,0);
    if(kind!=='stale')assert.equal(JSON.stringify(box.state.json),before);
  }
});

test('any project or animation state change after preview invalidates confirmation',()=>{
  const box=fixture(),preview=box.agentPreviewCommunityKeys(operation,baseline(box));
  box.state.json.animations.idle.bones.body.rotate[0].angle=6;
  assert.throws(()=>box.agentCommitCommunityKeys(preview.token,['hair']),/未修改作品/);
  assert.equal(box.state.history.length,0);
});

test('replacing the project with identical data or changing selection invalidates confirmation',()=>{
  for(const change of ['project','selection']){
    const box=fixture(),preview=box.agentPreviewCommunityKeys(operation,baseline(box));
    if(change==='project')box.state.json=JSON.parse(JSON.stringify(box.state.json));
    else box.selectedBones=()=>['body'];
    assert.throws(()=>box.agentCommitCommunityKeys(preview.token,['hair']),/未修改作品/);
    assert.equal(box.state.history.length,0);
  }
});

test('runtime preview duration must match a fresh native parse before and after the operation',()=>{
  for(const change of ['before','after','commit']){
    const box=fixture();let calls=0;
    box.readData=()=>({findAnimation:()=>({duration:((change==='before'&&++calls===1)||(change==='after'&&++calls===2))?3:2})});
    if(change==='commit'){
      const preview=box.agentPreviewCommunityKeys(operation,baseline(box));
      box.readData=()=>({findAnimation:()=>({duration:3})});
      assert.throws(()=>box.agentCommitCommunityKeys(preview.token,['hair']),/未修改作品/);
    }else assert.throws(()=>box.agentPreviewCommunityKeys(operation,baseline(box)),/未修改作品/);
    assert.equal(box.state.history.length,0);
  }
});

test('native edit or reader failure cannot be reported as a successful write',()=>{
  const box=fixture(),preview=box.agentPreviewCommunityKeys(operation,baseline(box)),before=JSON.stringify(box.state.json);
  box.edit=()=>null;
  assert.throws(()=>box.agentCommitCommunityKeys(preview.token,['hair']),/写入失败，已恢复作品数据/);
  assert.equal(JSON.stringify(box.state.json),before);assert.equal(box.state.history.length,0);
  const other=fixture(),second=other.agentPreviewCommunityKeys(operation,baseline(other));
  other.readData=()=>{throw Error('reader failed')};
  assert.throws(()=>other.agentCommitCommunityKeys(second.token,['hair']),/未修改作品/);
  assert.equal(other.state.history.length,0);
  const uncertain=fixture(),third=uncertain.agentPreviewCommunityKeys(operation,baseline(uncertain));
  uncertain.edit=()=>{uncertain.state.json.animations.idle.bones.hair.translate[0].x=99;return null};
  assert.throws(()=>uncertain.agentCommitCommunityKeys(third.token,['hair']),/已恢复作品数据/);
});

test('native edit failure, refresh exception, and unexpected applied data restore project and undo stacks',()=>{
  for(const failure of ['apply','refresh','postcondition']){
    const box=fixture(),before=JSON.stringify(box.state.json);
    const oldHistory=[{marker:'undo'}],oldFuture=[{marker:'redo'}];
    box.state.history=oldHistory.slice();box.state.future=oldFuture.slice();
    const preview=box.agentPreviewCommunityKeys(operation,baseline(box));
    let first=true;
    box.applyJson=json=>{
      if(failure==='apply' && first){first=false;throw Error('apply failed')}
      box.state.json=json;
      if(failure==='postcondition' && first){first=false;box.state.json.animations.idle.bones.body.rotate[0].angle=99}
    };
    if(failure==='refresh')box.refresh=()=>{throw Error('refresh failed')};
    assert.throws(()=>box.agentCommitCommunityKeys(preview.token,['hair']),/已恢复作品数据/,failure);
    assert.equal(JSON.stringify(box.state.json),before,failure);
    assert.deepEqual(Array.from(box.state.history),oldHistory,failure);
    assert.deepEqual(Array.from(box.state.future),oldFuture,failure);
  }
});

test('rollback failure is explicitly reported as an unconfirmed state',()=>{
  const box=fixture(),preview=box.agentPreviewCommunityKeys(operation,baseline(box));
  box.applyJson=json=>{box.state.json=json;throw Error('cannot apply or restore')};
  assert.throws(()=>box.agentCommitCommunityKeys(preview.token,['hair']),/状态未确认/);
});

test('real applyJson and edit restore project after runtime skin setup failure or unexpected mutation',()=>{
  for(const failure of ['skin','mutation']){
    const box=fixture(),before=JSON.stringify(box.state.json);
    box.state.skin='default';
    box.readData=()=>({findAnimation:()=>({duration:2}),findSkin:()=>true});
    box.spine={Skeleton:class Skeleton {}};
    box.computeRoles=()=>{};
    let first=true;
    box.setSkin=()=>{
      if(!first)return;
      first=false;
      if(failure==='skin')throw Error('skin setup failed');
      box.state.json.animations.idle.bones.body.rotate[0].angle=99;
    };
    vm.runInContext(editor.slice(editor.indexOf('  function applyJson('),editor.indexOf('  /** 控制骨',editor.indexOf('  function applyJson('))),box);
    const preview=box.agentPreviewCommunityKeys(operation,baseline(box));
    assert.throws(()=>box.agentCommitCommunityKeys(preview.token,['hair']),/已恢复作品数据/,failure);
    assert.equal(JSON.stringify(box.state.json),before,failure);
    assert.equal(box.state.history.length,0,failure);
    assert.equal(box.state.future.length,0,failure);
  }
});

test('active editing, playback, temporary pose or preview cannot be silently cleared',()=>{
  for(const field of ['playing','pick','drag','creating','curveDrag','meshEdit','weightEdit','clipEdit','pathEdit','temp','animationPreview']){
    const box=fixture();
    if(field==='temp')box.state.temp.set('hair',{x:42});
    else if(field==='animationPreview')box.rt.animationPreview={json:box.state.json,name:'idle',animation:{duration:2}};
    else if(field==='curveDrag')box.state.dope.curveDrag={active:true};
    else box.state[field]={active:true};
    assert.throws(()=>box.agentPreviewCommunityKeys(operation,baseline(box)),/未修改作品/,field);
    assert.equal(box.state.history.length,0);
  }
});

test('model may not choose targets outside the user selection',()=>{
  const box=fixture();box.selectedBones=()=>['body'];
  assert.throws(()=>box.agentPreviewCommunityKeys(operation,baseline(box)),/未修改作品/);
  assert.equal(box.state.history.length,0);
});

test('confirmed write does not change existing edit mode or axes',()=>{
  const box=fixture();box.state.axes='local';const preview=box.agentPreviewCommunityKeys(operation,baseline(box));
  box.agentCommitCommunityKeys(preview.token,['hair']);
  assert.equal(box.state.mode,'animate');assert.equal(box.state.axes,'local');
});

test('active pointer and expired preview prevent confirmation',()=>{
  const listeners={};let now=0;
  class Clock extends Date {static now(){return now;}}
  const add=(kind,fn)=>{listeners[kind]=fn};
  const box=fixture({document:{addEventListener:add},window:{addEventListener:add},Date:Clock});
  const first=box.agentPreviewCommunityKeys(operation,baseline(box));
  listeners.pointerdown({pointerId:1});
  assert.throws(()=>box.agentCommitCommunityKeys(first.token,['hair']),/未修改作品/);
  listeners.pointerup({pointerId:1});
  const second=box.agentPreviewCommunityKeys(operation,baseline(box));now=120001;
  assert.throws(()=>box.agentCommitCommunityKeys(second.token,['hair']),/未修改作品/);
  assert.equal(box.state.history.length,0);
});
