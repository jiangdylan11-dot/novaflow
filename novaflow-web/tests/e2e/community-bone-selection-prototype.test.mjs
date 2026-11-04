import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=readFileSync(new URL('../../renderer/spine-skeleton-editor.js',import.meta.url),'utf8');
function fixture(initial='body') {
  const state={json:{bones:[{name:'body'},{name:'hair'}],animations:{idle:{}}},fileName:'disposable.json',anim:'idle',mode:'animate',leftOpen:'bones',temp:new Map(),sel:initial?{kind:'bone',name:initial}:null,multi:initial?[initial]:[],multiSlots:[],multiCons:[],multiAtts:[],multiSkins:[],attachmentAnchor:null,skinAnchor:null,selHistory:[],selIdx:-1};
  let now=1000,pixels='AA==';
  const ctx={state,crypto:webcrypto,refresh(){},draw(){},rt:{skeleton:{},cam:{x:0,y:0,zoom:1},w:100,h:100,dpr:1},communityActivePointers:new Set(),Date:class extends Date{static now(){return now}},$:()=>({width:100,height:100}),document:{querySelector(){throw Error('unexpected panel access')},createElement(){return {getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=>`data:image/png;base64,${pixels}`}}}};
  ctx.window=ctx;ctx.parent=ctx;ctx.navigator={userActivation:{isActive:true}};ctx.MouseEvent=class MouseEvent{constructor(){Object.defineProperty(this,'isTrusted',{get(){return this._trusted}})}};
  vm.createContext(ctx);
  const start=source.indexOf('  function select(sel, additive, opts) {'),end=source.indexOf('  /** Spine: Page Up / Page Down',start);
  const historyStart=source.indexOf('  function pushHistory() {',end),historyEnd=source.indexOf('  function restoreSelection(',historyStart);
  const selectionStart=source.indexOf('  function selectedBones() {',historyEnd),selectionEnd=source.indexOf('  let boneClipboard = null',selectionStart);
  assert.ok(start>=0&&end>start&&historyStart>end&&historyEnd>historyStart&&selectionStart>historyEnd&&selectionEnd>selectionStart);
  const stableStart=source.indexOf('  function communityPreviewStable() {'),stableEnd=source.indexOf('  function agentPreviewCommunityKeys(',stableStart);
  assert.ok(stableStart>=0&&stableEnd>stableStart);
  vm.runInContext(source.slice(start,end)+source.slice(historyStart,historyEnd)+source.slice(selectionStart,selectionEnd)+source.slice(stableStart,stableEnd),ctx);
  vm.runInContext("function mockEvent(action){return Object.assign(new MouseEvent(),{view:window,type:'click',_trusted:true,currentTarget:{getAttribute:key=>key==='data-novaflow-community-selection-'+action?'1':null}})}",ctx);
  const event=action=>ctx.mockEvent(action);
  return {state,ctx,event,tick:ms=>now+=ms,pixels:value=>pixels=value,preview:name=>{const image=ctx.captureCommunityBoneSelectionImage();return ctx.previewCommunityBoneSelection(name,image.token)}};
}

test('isolated native select preview, confirm and undo keep project JSON intact',()=>{
  for(const initial of ['body',null]){
    const f=fixture(initial),{state,ctx}=f,before=JSON.stringify(state.json),p=f.preview('hair');
    assert.equal(state.sel?.name??null,initial);assert.equal(p.boneName,'hair');
    const done=ctx.confirmCommunityBoneSelection(p.token,f.event('confirm'));assert.equal(state.sel.name,'hair');assert.equal(JSON.stringify(state.json),before);assert.ok(done.undoToken);
    ctx.undoCommunityBoneSelection(done.undoToken,f.event('undo'));assert.equal(state.sel?.name??null,initial);assert.equal(JSON.stringify(state.json),before);
    assert.throws(()=>ctx.undoCommunityBoneSelection(done.undoToken,f.event('undo')));
  }
});
test('conflicting native interaction states deny selection without mutation',()=>{
  for(const [key,value] of [['pick',{want:'bone',done(){throw Error('callback')}}],['chainPick',{}],['chainRoots',['body']],['drag',{}],['creating',{}],['playing',true],['temp',new Map([['body',{}]])],['meshEdit',{}],['meshDrag',{}],['clipEdit',{}],['clipDrag',{}],['pathEdit',{}],['pathDrag',{}],['weightEdit',{binding:[1]}],['weightStroke',{}],['dopeExtra',{}],['attachmentAnchor',{}],['skinAnchor',{}],['leftOpen','sequence'],['leftOpen','sweep'],['leftOpen','loop'],['multi',['body','hair']],['multiSlots',['x']],['multiCons',[{}]],['multiAtts',[{}]],['multiSkins',['x']]]){
    const f=fixture(),{state}=f;state[key]=value;const before=JSON.stringify(state);assert.throws(()=>f.preview('hair'),key);assert.equal(JSON.stringify(state),before,key);
  }
});
test('cancel, expiry, new preview and active pointer prevent stale approvals',()=>{
  const f=fixture();let p=f.preview('hair');assert.equal(f.ctx.cancelCommunityBoneSelection(p.token),true);assert.throws(()=>f.ctx.confirmCommunityBoneSelection(p.token,f.event('confirm')));
  p=f.preview('hair');const next=f.preview('body');assert.throws(()=>f.ctx.confirmCommunityBoneSelection(p.token,f.event('confirm')));assert.throws(()=>f.ctx.confirmCommunityBoneSelection(next.token,f.event('confirm')));
  p=f.preview('hair');f.tick(120000);assert.throws(()=>f.ctx.confirmCommunityBoneSelection(p.token,f.event('confirm')));
  p=f.preview('hair');f.ctx.communityActivePointers.add(1);assert.throws(()=>f.ctx.confirmCommunityBoneSelection(p.token,f.event('confirm')));assert.equal(f.state.sel.name,'body');
});
test('target, project, selection, mode and conflict changes invalidate approval',()=>{
  for(const mutate of [s=>s.json.bones.splice(1,1),s=>s.json.bones.push({name:'hair'}),s=>s.sel={kind:'bone',name:'hair'},s=>s.mode='setup',s=>s.pick={want:'bone'},s=>s.json={...s.json}]){
    const f=fixture(),{state,ctx}=f,p=f.preview('hair');mutate(state);const after=JSON.stringify(state);assert.throws(()=>ctx.confirmCommunityBoneSelection(p.token,f.event('confirm')));assert.equal(JSON.stringify(state),after);
  }
  const f=fixture(),{ctx}=f;assert.throws(()=>f.preview('missing'));const p=f.preview('hair');assert.throws(()=>ctx.confirmCommunityBoneSelection('wrong',f.event('confirm')));assert.throws(()=>ctx.confirmCommunityBoneSelection(p.token,f.event('confirm')));
});
test('a changed project or selection prevents stale undo and refresh exceptions roll selection back',()=>{
  const f=fixture(),{state,ctx}=f;let p=f.preview('hair'),done=ctx.confirmCommunityBoneSelection(p.token,f.event('confirm'));state.json.animations.idle.changed=true;assert.throws(()=>ctx.undoCommunityBoneSelection(done.undoToken,f.event('undo')));assert.equal(state.sel.name,'hair');
  const g=fixture();g.ctx.refresh=()=>{throw Error('refresh failed')};const before=JSON.stringify(g.state);p=g.preview('hair');assert.throws(()=>g.ctx.confirmCommunityBoneSelection(p.token,g.event('confirm')),/refresh failed/);assert.equal(JSON.stringify(g.state),before);
});
test('the exact captured image and camera must remain current through preview and confirmation',()=>{
  for(const phase of ['before-preview','before-confirm']){
    const f=fixture(),image=f.ctx.captureCommunityBoneSelectionImage();assert.equal(image.dataUrl,'data:image/png;base64,AA==');
    if(phase==='before-preview'){f.pixels('AQ==');assert.throws(()=>f.ctx.previewCommunityBoneSelection('hair',image.token));}
    else {const p=f.ctx.previewCommunityBoneSelection('hair',image.token);f.pixels('AQ==');assert.throws(()=>f.ctx.confirmCommunityBoneSelection(p.token,f.event('confirm')));}
    assert.equal(f.state.sel.name,'body');
  }
  const f=fixture(),image=f.ctx.captureCommunityBoneSelectionImage();f.ctx.rt.cam.x=1;assert.throws(()=>f.ctx.previewCommunityBoneSelection('hair',image.token));assert.equal(f.state.sel.name,'body');
});
test('without a synchronous user click and activation, confirmation is rejected',()=>{
  const f=fixture(),p=f.preview('hair');assert.throws(()=>f.ctx.confirmCommunityBoneSelection(p.token));assert.throws(()=>f.ctx.confirmCommunityBoneSelection(p.token,{isTrusted:true}));
  const e=f.event('confirm');e._trusted=false;assert.throws(()=>f.ctx.confirmCommunityBoneSelection(p.token,e));f.ctx.navigator.userActivation.isActive=false;assert.throws(()=>f.ctx.confirmCommunityBoneSelection(p.token,f.event('confirm')));assert.equal(f.state.sel.name,'body');
});
