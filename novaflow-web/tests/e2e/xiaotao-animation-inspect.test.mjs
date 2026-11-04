import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {FOART_TOOL_SCHEMA,validateFoartPlan,foartPlanResponseFormat} from '../../packages/shared/src/foart-tool-plan.mjs';

const source=await readFile(new URL('../../renderer/spine-skeleton-editor.js',import.meta.url),'utf8');
const bridgeSource=await readFile(new URL('../../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8');
const controllerSource=await readFile(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
function editor() {
  const state={json:{bones:[{name:'body'},{name:'hair'}],animations:{idle:{bones:{body:{rotate:[{time:0,angle:3}]},hair:{rotate:[{time:0,angle:-5},{time:1,angle:7}],translate:[{time:0,x:1,y:2}]}}},walk:{bones:{}}}},anim:'idle',sel:{kind:'bone',name:'body'},multi:[],frame:0,history:[]};
  const ctx={state,FPS:30,rt:{data:{findAnimation:name=>name==='idle'?{duration:1}:null}},selectedBones:()=>[state.sel.name],
    document:{addEventListener(){}},window:{addEventListener(){}}};
  vm.createContext(ctx);
  const start=source.indexOf('  const agentJsonIds ='),end=source.indexOf('  function agentAction(op)',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext(source.slice(start,end),ctx);
  return {state,api:ctx};
}
const operation=(patch={})=>({action:'animation',operation:'inspect_bones',name:'idle',boneNames:['hair'],...patch});
const wire=operations=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'读取当前关键帧',operations});
const context=()=>({schema:FOART_TOOL_SCHEMA,controls:[],animation:{active:true,loaded:true,animation:'idle',animations:['idle','walk'],bones:[{name:'body'},{name:'hair'}]}});

test('inspect reads unselected tracks and duration without mutating selection or project',()=>{
  const {state,api}=editor(),before=JSON.stringify(state),result=api.agentInspectBones(operation({boneNames:['hair','body']}));
  assert.equal(JSON.stringify(state),before);assert.equal(result.name,'idle');assert.equal(result.durationSeconds,1);assert.equal(result.durationAvailable,true);assert.equal(result.complete,true);assert.equal(result.truncated,false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.bones[0].tracks.rotate)),[{time:0,angle:-5},{time:1,angle:7}]);
  result.bones[0].tracks.rotate[0].angle=999;assert.equal(state.json.animations.idle.bones.hair.rotate[0].angle,-5);
});
test('inspection uses authored duration and tracks even while a different animation preview is active',()=>{
  const {state,api}=editor();
  const preview={json:state.json,name:'idle',animation:{duration:4}};
  api.rt.animationPreview=preview;
  const before=JSON.stringify(state),result=api.agentInspectBones(operation());
  assert.equal(result.durationSeconds,1);assert.equal(result.durationAvailable,true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.bones[0].tracks.rotate)),[{time:0,angle:-5},{time:1,angle:7}]);
  assert.equal(JSON.stringify(state),before);assert.equal(api.rt.animationPreview,preview);
  api.rt.data=null;
  const unavailable=api.agentInspectBones(operation());
  assert.equal(unavailable.durationSeconds,null);assert.equal(unavailable.durationAvailable,false);
  assert.equal(api.rt.animationPreview,preview);assert.equal(JSON.stringify(state),before);
});
test('inspect can read when nothing is selected and keeps that selection unchanged',()=>{
  const {state,api}=editor();state.sel=null;const before=JSON.stringify(state),result=api.agentInspectBones(operation());
  assert.equal(result.complete,true);assert.equal(JSON.stringify(state),before);assert.equal(state.sel,null);
});
test('native tool bridge returns the read-only baseline and the next-round receipt retains it',async()=>{
  const {state,api}=editor(),before=JSON.stringify(state),root={NovaFlowSkeletonEditor:{active:()=>true,api:()=>({agentAction(){throw Error('write attempted')},agentInspectBones:api.agentInspectBones})}};
  vm.runInNewContext(bridgeSource,{window:root});const receipt=await root.NovaFlowFoartTools.execute(operation());
  assert.equal(receipt.phase,'observed');assert.equal(receipt.inspection.complete,true);assert.equal(JSON.stringify(state),before);
  const start=controllerSource.indexOf('  function compactFoartReceipt(row)'),end=controllerSource.indexOf('  function createController(',start);assert.ok(start>=0&&end>start);
  const compact=vm.runInNewContext(controllerSource.slice(start,end)+'\ncompactFoartReceipt');
  assert.deepEqual(JSON.parse(JSON.stringify(compact(receipt).inspection)),JSON.parse(JSON.stringify(receipt.inspection)));
});
test('inspect rejects missing animation, invalid names, duplicates and too many bones',()=>{
  const {api}=editor();for(const op of [operation({name:'walk'}),operation({boneNames:[]}),operation({boneNames:['missing']}),operation({boneNames:['hair','hair']}),operation({boneNames:['a','b','c','d','e']})])assert.throws(()=>api.agentInspectBones(op));
  assert.throws(()=>validateFoartPlan(wire([operation({name:'walk'})]),context()));
  assert.throws(()=>validateFoartPlan(wire([operation({boneNames:['missing']})]),context()));
  assert.throws(()=>validateFoartPlan(wire([operation(),{action:'animation',operation:'key_bones',name:'idle',keys:[{boneName:'hair',frame:0,values:{rotation:1}}]}]),context()));
});
test('oversized or unsupported tracks are visibly incomplete and never represented as full baseline',()=>{
  const {state,api}=editor();state.json.animations.idle.bones.hair.rotate=Array.from({length:500},(_,i)=>({time:i/30,angle:i}));
  const result=api.agentInspectBones(operation());assert.equal(result.complete,false);assert.equal(result.truncated,true);assert.equal(result.bones[0].complete,false);assert.ok(JSON.stringify(result).length<3200);assert.ok(result.bones[0].tracks.rotate.length<500);
  state.json.animations.idle.bones.hair.rotate=[{time:0,angle:2,unknown:{nested:true}}];const invalid=api.agentInspectBones(operation());assert.equal(invalid.complete,false);assert.equal(invalid.bones[0].tracks.rotate.length,0);
});
test('community schema advertises read operation without changing existing default schemas',()=>{
  const entries=schema=>schema.schema.properties.operations.items.anyOf.filter(x=>x.properties.action.const==='animation');
  const hasInspect=schema=>entries(schema).some(x=>x.properties.operation?.const==='inspect_bones');
  assert.equal(hasInspect(foartPlanResponseFormat(context())),false);assert.equal(hasInspect(foartPlanResponseFormat(context(),{communityAnimationInspection:true})),true);
  assert.doesNotThrow(()=>validateFoartPlan(wire([operation()]),context()));
  const selectedBeyondSummary=context();selectedBeyondSummary.animation.bones=[{name:'body'}];selectedBeyondSummary.animation.selectedBones=['hair'];
  assert.doesNotThrow(()=>validateFoartPlan(wire([operation()]),selectedBeyondSummary));
});
test('community animation generation starts with inspection and only then offers keyframe plans',()=>{
  const options=stage=>foartPlanResponseFormat(context(),{communityAnimationInspection:true,communityAnimationStage:stage}).schema.properties;
  const names=properties=>properties.operations.items.anyOf.map(item=>item.properties.operation.const);
  assert.deepEqual(names(options('inspect')),['inspect_bones']);
  assert.deepEqual(names(options('plan')),['key_bones','inspect_bones']);
  const inspection=options('inspect').operations.items.anyOf[0];
  assert.deepEqual(inspection.properties.name,{const:'idle'});
  assert.deepEqual(inspection.properties.boneNames.items,{type:'string',enum:['body','hair']});
  const unnamed=context();unnamed.animation.animation=null;
  const noName=foartPlanResponseFormat(unnamed,{communityAnimationInspection:true,communityAnimationStage:'inspect'}).schema.properties.operations.items.anyOf[0];
  assert.deepEqual(noName.properties.name,{type:'string'});
  const selected=context();selected.animation.selectedBones=['hair','selected-only','hair','',null];
  const selectedItems=foartPlanResponseFormat(selected,{communityAnimationInspection:true,communityAnimationStage:'inspect'}).schema.properties.operations.items.anyOf[0].properties.boneNames.items;
  assert.deepEqual(selectedItems,{type:'string',enum:['hair','selected-only','body']});
  const empty=context();empty.animation.bones=[];empty.animation.selectedBones=[];
  const emptyItems=foartPlanResponseFormat(empty,{communityAnimationInspection:true,communityAnimationStage:'inspect'}).schema.properties.operations.items.anyOf[0].properties.boneNames.items;
  assert.deepEqual(emptyItems,{type:'string'});
  assert.equal(options('inspect').operations.maxItems,1);
  assert.deepEqual(options('inspect').status.enum,['act','reply','clarify']);
  const other=context();other.animation.active=false;
  assert.ok(foartPlanResponseFormat(other,{communityAnimationInspection:true,communityAnimationStage:'inspect'}).schema.properties.operations.items.anyOf.length>2);
  assert.ok(foartPlanResponseFormat(context(),{communityAnimationStage:'inspect'}).schema.properties.operations.items.anyOf.length>2);
});
