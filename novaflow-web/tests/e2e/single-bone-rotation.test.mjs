import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {webcrypto} from 'node:crypto'
import vm from 'node:vm'

const ops=await readFile(new URL('../../renderer/spine-structure.ops.js',import.meta.url),'utf8')
const editor=await readFile(new URL('../../renderer/spine-skeleton-editor.js',import.meta.url),'utf8')
const operation={action:'animation',operation:'key_bones',name:'idle',keys:[{boneName:'hair',frame:15,values:{rotation:17}}]}
function fixture() {
  const state={json:{skeleton:{spine:'3.8.99'},bones:[{name:'root'},{name:'hair',parent:'root',rotation:5},{name:'body',parent:'root'}],slots:[],skins:[{name:'default',attachments:{}}],animations:{idle:{bones:{hair:{rotate:[{time:0.5,angle:10,curve:'stepped'},{time:1,angle:0}],translate:[{time:0,x:1,y:4}]},body:{rotate:[{time:0,angle:5}]}}}}},fileName:'fixture',anim:'idle',mode:'animate',skin:'default',frame:0,temp:new Map(),history:[],future:[],dope:{},audio:new Map([['sound',{}]]),audioVersions:new Map(),atlasText:'atlas',atlasChanged:false}
  let audioStops=0
  const trusted=new WeakSet(),buttons={}
  class MouseEvent {constructor(type){this.type=type;Object.defineProperty(this,'isTrusted',{get(){return trusted.has(this)}})}}
  const document={addEventListener(){},querySelectorAll(selector){return buttons[selector]?[buttons[selector]]:[]}}
  const window={document,MouseEvent,navigator:{userActivation:{isActive:true}},addEventListener(){}};window.parent=window
  function click(action,valid=true) {
    const attr='data-novaflow-single-rotation-'+action,selector='['+attr+'="1"]'
    const button={isConnected:true,ownerDocument:document,getAttribute:name=>name===attr?'1':null,contains:target=>target===button}
    buttons[selector]=button
    const event=new MouseEvent('click');Object.assign(event,{view:window,currentTarget:button,target:button});if(valid)trusted.add(event)
    return event
  }
  const box={state,window,document,Map,FPS:30,rt:{data:{findAnimation:()=>({duration:2})}},readData:()=>({findAnimation:()=>({duration:2})}),crypto:webcrypto,selectedBones:()=>['hair'],setMode:mode=>state.mode=mode,audioPlayer:{stop(){audioStops++}},applyJson:json=>{state.json=json},validateSelection(){},status(){},refresh(){}}
  vm.createContext(box);vm.runInContext(ops,box);box.Ops=box.NovaFlowSpineStructureOps
  vm.runInContext(editor.slice(editor.indexOf('  function snapshot()'),editor.indexOf('  function undo()')),box)
  vm.runInContext(editor.slice(editor.indexOf('  const agentJsonIds ='),editor.indexOf('  const tickedOf =')),box)
  return {box,state,click,get audioStops(){return audioStops}}
}
const prepare=f=>f.box.agentPrepareSingleBoneRotation(operation,f.box.agentInspectBones({name:'idle',boneNames:['hair']}))
test('preview and trusted commit/undo affect only the existing key and do not stop audio',()=>{
  const f=fixture(),before=JSON.stringify(f.state.json),p=prepare(f)
  assert.equal(p.fromRotation,15);assert.equal(p.toRotation,17);assert.equal(p.frame,15)
  assert.equal(JSON.stringify(f.state.json),before);assert.equal(f.box.agentValidateSingleBoneRotation(p.token),true)
  assert.throws(()=>f.box.agentCommitSingleBoneRotation(p.token,f.click('confirm',false)),e=>e.code==='single-rotation-trusted-click-required')
  assert.equal(f.box.agentValidateSingleBoneRotation(p.token),true)
  const receipt=f.box.agentCommitSingleBoneRotation(p.token,f.click('confirm'))
  assert.equal(receipt.phase,'applied');assert.equal(receipt.operation,'key_bones');assert.equal(f.state.json.animations.idle.bones.hair.rotate[0].angle,12)
  assert.equal(f.state.json.animations.idle.bones.hair.rotate[0].curve,'stepped')
  assert.equal(f.state.json.animations.idle.bones.body.rotate[0].angle,5)
  assert.throws(()=>f.box.agentCommitSingleBoneRotation(p.token,f.click('confirm')))
  assert.throws(()=>f.box.agentUndoSingleBoneRotation(receipt.undoToken,f.click('undo',false)),e=>e.code==='single-rotation-trusted-click-required')
  const undo=f.box.agentUndoSingleBoneRotation(receipt.undoToken,f.click('undo'))
  assert.equal(undo.phase,'undone');assert.equal(JSON.stringify(f.state.json),before)
  assert.equal(f.state.history.length,0);assert.equal(f.state.future.length,1);assert.equal(f.audioStops,0)
  assert.throws(()=>f.box.agentUndoSingleBoneRotation(receipt.undoToken,f.click('undo')))
})
test('cancel, programmatic discard, stale preview and invalid operations never change the project',()=>{
  for(const how of ['cancel','discard','selection','history','missing-key','multiple-properties']) {
    const f=fixture(),before=JSON.stringify(f.state.json)
    if(how==='missing-key'||how==='multiple-properties'){
      const op=JSON.parse(JSON.stringify(operation));if(how==='missing-key')op.keys[0].frame=2;else op.keys[0].values.x=2
      assert.throws(()=>f.box.agentPrepareSingleBoneRotation(op,f.box.agentInspectBones({name:'idle',boneNames:['hair']})))
    } else {
      const p=prepare(f)
      if(how==='cancel'){assert.throws(()=>f.box.agentCancelSingleBoneRotation(p.token,f.click('cancel',false)),e=>e.code==='single-rotation-trusted-click-required');assert.equal(f.box.agentCancelSingleBoneRotation(p.token,f.click('cancel')).phase,'cancelled')}
      if(how==='discard')assert.equal(f.box.agentDiscardSingleBoneRotation(p.token),true)
      if(how==='selection')f.box.selectedBones=()=>['body']
      if(how==='history')f.state.history.push({other:true})
      assert.throws(()=>f.box.agentCommitSingleBoneRotation(p.token,f.click('confirm')))
    }
    assert.equal(JSON.stringify(f.state.json),before,how);assert.equal(f.audioStops,0)
  }
})
test('undo rejects later project, stack, selection, or audio changes without rolling them back',()=>{
  for(const change of ['json','history','selection','audio']) {
    const f=fixture(),p=prepare(f),r=f.box.agentCommitSingleBoneRotation(p.token,f.click('confirm'))
    if(change==='json')f.state.json.animations.idle.bones.body.rotate[0].angle=99
    if(change==='history')f.state.history.push({other:true})
    if(change==='selection')f.box.selectedBones=()=>['body']
    if(change==='audio')f.state.audio.set('new-sound',{})
    const before=JSON.stringify(f.state.json)
    assert.throws(()=>f.box.agentUndoSingleBoneRotation(r.undoToken,f.click('undo')),change)
    assert.equal(JSON.stringify(f.state.json),before);assert.equal(f.audioStops,0)
  }
})
test('failed native apply rolls back the project and preserves the audio player',()=>{
  const f=fixture(),before=JSON.stringify(f.state.json),p=prepare(f);let first=true
  f.box.applyJson=json=>{f.state.json=json;if(first){first=false;throw Error('failed once')}}
  assert.throws(()=>f.box.agentCommitSingleBoneRotation(p.token,f.click('confirm')),/已恢复作品数据/)
  assert.equal(JSON.stringify(f.state.json),before);assert.equal(f.state.history.length,0);assert.equal(f.audioStops,0)
})
