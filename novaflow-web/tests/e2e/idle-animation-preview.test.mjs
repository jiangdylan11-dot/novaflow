import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const ops=await readFile(new URL('../../renderer/spine-structure.ops.js',import.meta.url),'utf8');
const editor=await readFile(new URL('../../renderer/spine-skeleton-editor.js',import.meta.url),'utf8');
const draft=()=>({action:'animation',operation:'create_idle',name:'idle_new',durationSeconds:2,keys:[
  {boneName:'hair',frame:0,values:{rotation:5}},{boneName:'hair',frame:30,values:{rotation:12}},{boneName:'hair',frame:60,values:{rotation:5}}
]});
function fixture() {
  const state={json:{skeleton:{spine:'3.8.99'},bones:[{name:'root'},{name:'hair',parent:'root',rotation:5},{name:'body',parent:'root'}],slots:[],skins:[{name:'default',attachments:{}}],animations:{existing:{bones:{body:{rotate:[{time:0,angle:3}]}}}}},fileName:'fixture',anim:'existing',mode:'animate',axes:'parent',skin:'default',frame:8,temp:new Map(),history:[],future:[],dope:{},audio:new Map([['sound',{}]]),audioVersions:new Map(),atlasText:'atlas',atlasChanged:false};
  let audioStops=0;const trusted=new WeakSet(),buttons={};
  class MouseEvent {constructor(type){this.type=type;Object.defineProperty(this,'isTrusted',{get(){return trusted.has(this)}})}}
  const document={addEventListener(){},querySelectorAll(selector){return buttons[selector]?[buttons[selector]]:[]}};
  const window={document,MouseEvent,navigator:{userActivation:{isActive:true}},addEventListener(){}};window.parent=window;
  function click(action,valid=true) {
    const attr='data-novaflow-idle-'+action,selector='['+attr+'="1"]';
    const button={isConnected:true,ownerDocument:document,getAttribute:name=>name===attr?'1':null,contains:target=>target===button};buttons[selector]=button;
    const event=new MouseEvent('click');Object.assign(event,{view:window,currentTarget:button,target:button});if(valid)trusted.add(event);return event;
  }
  const readData=json=>({findAnimation(name){const animation=json.animations?.[name];if(!animation)return null;const values=[];for(const tracks of Object.values(animation.bones||{}))for(const keys of Object.values(tracks))for(const k of keys)values.push(k.time||0);return {duration:Math.max(0,...values)}}});
  const box={state,window,document,Map,FPS:30,rt:{},readData,crypto:webcrypto,selectedBones:()=>['hair'],setMode:mode=>state.mode=mode,
    audioPlayer:{stop(){audioStops++}},applyJson:json=>{state.json=json},validateSelection(){},status(){},refresh(){}};
  vm.createContext(box);vm.runInContext(ops,box);box.Ops=box.NovaFlowSpineStructureOps;
  vm.runInContext(editor.slice(editor.indexOf('  function snapshot()'),editor.indexOf('  function undo()')),box);
  vm.runInContext(editor.slice(editor.indexOf('  const agentJsonIds ='),editor.indexOf('  const tickedOf =')),box);
  return {box,state,click,get audioStops(){return audioStops}};
}

test('preview does not edit; trusted commit and one undo preserve original project/audio',()=>{
  const f=fixture(),before=JSON.stringify(f.state.json),p=f.box.agentPrepareIdleAnimation(draft());
  assert.equal(JSON.stringify(f.state.json),before);assert.equal(f.state.anim,'existing');assert.equal(f.box.agentValidateIdleAnimation(p.token),true);
  assert.throws(()=>f.box.agentCommitIdleAnimation(p.token,f.click('confirm',false)),e=>e.code==='idle-animation-trusted-click-required');
  const r=f.box.agentCommitIdleAnimation(p.token,f.click('confirm'));
  assert.equal(r.phase,'applied');assert.equal(r.name,'idle_new');assert.equal(r.keyCount,3);assert.equal(f.state.history.length,1);assert.equal(f.state.anim,'idle_new');
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.json.animations.idle_new.bones.hair.rotate)),[{angle:0},{time:1,angle:7},{time:2,angle:0}]);
  assert.throws(()=>f.box.agentCommitIdleAnimation(p.token,f.click('confirm')));
  assert.throws(()=>f.box.agentUndoIdleAnimation(r.undoToken,f.click('undo',false)),e=>e.code==='idle-animation-trusted-click-required');
  assert.equal(f.box.agentUndoIdleAnimation(r.undoToken,f.click('undo')).phase,'undone');
  assert.equal(JSON.stringify(f.state.json),before);assert.equal(f.state.anim,'existing');assert.equal(f.state.frame,8);assert.equal(f.state.history.length,0);assert.equal(f.state.future.length,1);assert.equal(f.audioStops,0);
  assert.throws(()=>f.box.agentUndoIdleAnimation(r.undoToken,f.click('undo')));
});
test('stale project, selection, history, metadata and cancellation fail closed',()=>{
  for(const mode of ['project','selection','editor-selection','history','metadata','cancel','discard']){
    const f=fixture(),p=f.box.agentPrepareIdleAnimation(draft());
    if(mode==='project')f.state.json.animations.existing.bones.body.rotate[0].angle=7;
    if(mode==='selection')f.box.selectedBones=()=>['body'];
    if(mode==='editor-selection')f.state.sel={kind:'bone',name:'hair'};
    if(mode==='history')f.state.history.push({});
    if(mode==='metadata')f.state.audio.set('other',{});
    if(mode==='cancel'){assert.throws(()=>f.box.agentCancelIdleAnimation(p.token,f.click('cancel',false)));f.box.agentCancelIdleAnimation(p.token,f.click('cancel'));}
    if(mode==='discard')assert.equal(f.box.agentDiscardIdleAnimation(p.token),true);
    const before=JSON.stringify(f.state.json);assert.throws(()=>f.box.agentCommitIdleAnimation(p.token,f.click('confirm')),mode);assert.equal(JSON.stringify(f.state.json),before);assert.equal(f.audioStops,0);
  }
});
test('two selected bones are written together and undo together',()=>{
  const f=fixture();f.box.selectedBones=()=>['hair','body'];const d=draft();
  d.keys.push({boneName:'body',frame:0,values:{rotation:0}},{boneName:'body',frame:30,values:{rotation:4}},{boneName:'body',frame:60,values:{rotation:0}});
  const before=JSON.stringify(f.state.json),p=f.box.agentPrepareIdleAnimation(d),r=f.box.agentCommitIdleAnimation(p.token,f.click('confirm'));
  assert.equal(r.keyCount,6);assert.deepEqual(Object.keys(f.state.json.animations.idle_new.bones).sort(),['body','hair']);assert.equal(f.state.history.length,1);
  f.box.agentUndoIdleAnimation(r.undoToken,f.click('undo'));assert.equal(JSON.stringify(f.state.json),before);
});
test('target/name/length/key/channel bounds and an actual cyclic motion are required',()=>{
  for(const mode of ['name','prototype','prototype-case','prototype-bone','seconds','keycount','frame','angle','channel','loop','static','bone','fps']){
    const f=fixture(),d=draft();
    if(mode==='name')d.name='existing';if(mode==='prototype')d.name='__proto__';if(mode==='prototype-case')d.name='Constructor';if(mode==='seconds')d.durationSeconds=3;
    if(mode==='keycount')d.keys.pop();if(mode==='frame')d.keys[1].frame=29;if(mode==='angle')d.keys[1].values.rotation=181;
    if(mode==='channel')d.keys[1].values.x=3;if(mode==='loop')d.keys[2].values.rotation=6;if(mode==='static')d.keys[1].values.rotation=5;
    if(mode==='bone')d.keys.forEach(k=>k.boneName='body');if(mode==='prototype-bone'){f.state.json.bones.push({name:'Constructor'});f.box.selectedBones=()=>['Constructor'];d.keys.forEach(k=>k.boneName='Constructor')};if(mode==='fps')f.box.FPS=29.97;
    const before=JSON.stringify(f.state.json);assert.throws(()=>f.box.agentPrepareIdleAnimation(d),mode);assert.equal(JSON.stringify(f.state.json),before);assert.equal(f.state.history.length,0);
  }
});
test('failed native write restores project, history, selection and audio',()=>{
  const f=fixture(),before=JSON.stringify(f.state.json),p=f.box.agentPrepareIdleAnimation(draft());let first=true;
  f.box.applyJson=json=>{f.state.json=json;if(first){first=false;throw Error('synthetic apply failed')}};
  assert.throws(()=>f.box.agentCommitIdleAnimation(p.token,f.click('confirm')),/已恢复作品数据/);
  assert.equal(JSON.stringify(f.state.json),before);assert.equal(f.state.anim,'existing');assert.equal(f.state.frame,8);assert.equal(f.state.history.length,0);assert.equal(f.audioStops,0);
});
test('undo never rolls back later project, selection, history or metadata changes',()=>{
  for(const mode of ['project','selection','history','metadata']){
    const f=fixture(),p=f.box.agentPrepareIdleAnimation(draft()),r=f.box.agentCommitIdleAnimation(p.token,f.click('confirm'));
    if(mode==='project')f.state.json.animations.existing.bones.body.rotate[0].angle=8;
    if(mode==='selection')f.box.selectedBones=()=>['body'];if(mode==='history')f.state.history.push({});if(mode==='metadata')f.state.audio.set('later',{});
    const before=JSON.stringify(f.state.json);assert.throws(()=>f.box.agentUndoIdleAnimation(r.undoToken,f.click('undo')),mode);assert.equal(JSON.stringify(f.state.json),before);assert.equal(f.audioStops,0);
  }
});
