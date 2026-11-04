import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {FOART_TOOL_SCHEMA,validateFoartPlan,foartPlanResponseFormat} from '../../packages/shared/src/foart-tool-plan.mjs';
const opsSource=await readFile(new URL('../../renderer/spine-structure.ops.js',import.meta.url),'utf8');
const editorSource=await readFile(new URL('../../renderer/spine-skeleton-editor.js',import.meta.url),'utf8');
function native(){
 const state={json:{skeleton:{spine:'3.8.99'},bones:[{name:'root',x:4,rotation:10},{name:'arm',parent:'root',x:20}],slots:[],skins:[{name:'default',attachments:{}}],animations:{idle:{bones:{root:{translate:[{time:0,x:3,y:2}]},arm:{rotate:[{time:0,angle:5}]}}},walk:{bones:{arm:{translate:[{time:0,x:1,y:0}]}}}}},anim:'idle',frame:0,mode:'setup',fileName:'existing.json',history:[]};
 const sandbox={state,FPS:30,selectedBones:()=>['root'],select:sel=>{state.selected=sel.name},setMode:m=>state.mode=m,gotoFrame:f=>state.frame=f,togglePlay:()=>state.playing=!state.playing,refresh(){},edit:(_label,fn,after)=>{const old=state.json,result=fn(old);state.history.push(old);state.json=result.json;after?.(result)},undo:()=>state.json=state.history.pop(),redo(){}};
 vm.createContext(sandbox);vm.runInContext(opsSource,sandbox);sandbox.Ops=sandbox.NovaFlowSpineStructureOps;
 sandbox.withOrder=result=>({...result,json:sandbox.Ops.autoOrderConstraints(result.json).json});
 const start=editorSource.indexOf('  const agentJsonIds ='),end=editorSource.indexOf('  const tickedOf =',start);
 vm.runInContext(editorSource.slice(start,end),sandbox);return {state,api:sandbox};
}
const wire=op=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'按现有动画修改',operations:[{action:'animation',...op}]});
test('manual edit context exposes projected viewport vertex positions and current weights without mutating the mesh',()=>{
 const f=native();f.api.rt={w:1000,h:500};f.state.weightEdit={skin:'default',slot:'body',name:'robot',bone:1};
 const points=[{x:320,y:390,w:[[0,.5],[1,.5]]},{x:500,y:250,w:[[1,1]]},{x:-20,y:0,w:[[0,1]]}];
 f.api.weightContext=()=>({model:{points}});f.api.weScreen=(_ctx,p)=>[p.x,p.y];
 const before=JSON.stringify(points),context=f.api.agentContext();assert.equal(context.editingVertices.length,2);assert.equal(context.editingVertices[0].index,1);
 const vertex=context.editingVertices.find(v=>v.index===0);assert.equal(vertex.x,.32);assert.equal(vertex.y,.78);assert.deepEqual(JSON.parse(JSON.stringify(vertex.weights)),[[0,.5],[1,.5]]);assert.equal(JSON.stringify(points),before);
});
test('native preview redraws the current skeleton and composites its exact overlay in matching viewport coordinates',()=>{
 const calls=[],gl={width:2000,height:1000},overlay={},canvas={getContext:()=>({fillRect(){},drawImage:(...args)=>calls.push(args)}),toDataURL:()=> 'data:image/png;base64,current'};
 const sandbox={rt:{skeleton:{}},draw:()=>calls.push('draw'),$:selector=>selector==='#gl'?gl:overlay,document:{createElement:()=>canvas}};
 const start=editorSource.indexOf('  function agentPreviewImage() {'),end=editorSource.indexOf('  function communitySelectionReady()',start);
 assert.ok(start>=0&&end>start);
 vm.runInNewContext(editorSource.slice(start,end)+';this.api={agentPreview:agentPreviewImage};',sandbox);
 assert.equal(sandbox.api.agentPreview(),'data:image/png;base64,current');assert.equal(canvas.width,1280);assert.equal(canvas.height,640);assert.equal(calls[0],'draw');assert.equal(calls[1][0],gl);assert.equal(calls[2][0],overlay);assert.deepEqual(calls[1].slice(1),[0,0,1280,640]);
});
test('transform mix percentages accept signed values beyond 100 in planner and native edits without changing IK limits',()=>{
 const f=native();f.api.setupMatrices=()=>({});
 const values={rotateMix:-.5,translateMix:2.5,scaleMix:-1.25,shearMix:100001};
 const create={operation:'create_constraint',constraintKind:'transform',name:'arm_follow',boneNames:['arm'],targetName:'root',values};
 const context=()=>({schema:FOART_TOOL_SCHEMA,controls:[],animation:f.api.agentContext()});
 validateFoartPlan(wire(create),context());const made=f.api.agentAction(create);
 for(const [key,value] of Object.entries(values))assert.equal(made.constraint[key],value);
 const update={operation:'update_constraint',constraintKind:'transform',name:'arm_follow',values:{rotateMix:3,translateMix:-2,scaleMix:4,shearMix:-3}};
 validateFoartPlan(wire(update),context());const changed=f.api.agentAction(update);
 for(const [key,value] of Object.entries(update.values))assert.equal(changed.constraint[key],value);
 for(const bad of [NaN,Infinity,-Infinity]){const op={...update,values:{scaleMix:bad}};assert.throws(()=>validateFoartPlan(wire(op),context()));assert.throws(()=>f.api.agentAction(op));}
 f.api.agentAction({operation:'undo'});for(const [key,value] of Object.entries(values))assert.equal(f.state.json.transform[0][key],value);
 f.api.edit=()=>null;assert.throws(()=>f.api.agentAction(update),/修改失败/,'A rolled-back native edit cannot report a successful update');
});
test('native IK creation and continuation preserve the same rig and keys, use the original solver order and expose actual targets',()=>{
 const f=native();f.state.json.bones.push({name:'lower',parent:'arm',x:40,length:30},{name:'hand_target',parent:'root',x:60,y:20});f.state.json.bones.find(b=>b.name==='arm').length=40;
 const before=JSON.parse(JSON.stringify(f.state.json)),context=()=>({schema:FOART_TOOL_SCHEMA,controls:[],animation:f.api.agentContext()});
 const create={operation:'create_constraint',constraintKind:'ik',name:'arm_chain',boneNames:['arm','lower'],targetName:'hand_target',values:{mix:1}};validateFoartPlan(wire(create),context());
 const made=f.api.agentAction(create);assert.equal(f.state.history.length,1);assert.equal(made.constraint.target,'hand_target');assert.deepEqual(Array.from(made.constraint.bones),['arm','lower']);assert.equal(made.context.constraints[0].kind,'ik');assert.equal(made.context.constraints[0].name,'arm_chain');assert.deepEqual(JSON.parse(JSON.stringify(f.state.json.animations)),before.animations);assert.deepEqual(JSON.parse(JSON.stringify(f.state.json.bones)),before.bones);
 const update={operation:'update_constraint',constraintKind:'ik',name:'arm_chain',values:{mix:.5,softness:10,bendPositive:false}};validateFoartPlan(wire(update),context());const changed=f.api.agentAction(update);assert.equal(changed.constraint.mix,.5);assert.equal(changed.constraint.softness,10);assert.equal(changed.constraint.bendPositive,false);assert.equal(changed.previousConstraint.mix??1,1);assert.equal(f.state.history.length,2);
 const selected=f.api.agentAction({operation:'select_constraint',constraintKind:'ik',name:'arm_chain'});assert.equal(selected.constraint.target,'hand_target');assert.equal(f.state.history.length,2);
 for(const bad of [{...create,name:'second',boneNames:['lower','arm']},{...create,name:'second',targetName:'missing'},{...update,name:'missing'},{...update,values:{mix:2}},{...update,values:{script:'bad'}}])assert.throws(()=>validateFoartPlan(wire(bad),context()));
 f.api.agentAction({operation:'undo'});assert.equal(f.state.json.ik[0].mix??1,1);f.api.agentAction({operation:'undo'});assert.deepEqual(f.state.json,before);
});

test('bone selection resolves the original native target picker during a constraint operation',()=>{
 const f=native();let target;f.state.pick={want:'bone',text:'选择目标骨骼'};f.api.resolvePick=(kind,name)=>{target={kind,name};f.state.pick=null;};f.api.agentAction({operation:'select_bone',boneName:'arm'});assert.deepEqual(target,{kind:'bone',name:'arm'});assert.equal(f.state.pick,null);
});
test('native animation keys keep setup pose, unrelated channels/bones/animations and one undo step',()=>{
 const f=native(),before=JSON.parse(JSON.stringify(f.state.json));
 const result=f.api.agentAction({operation:'key_bones',name:'idle',keys:[{boneName:'root',frame:0,values:{rotation:10}},{boneName:'root',frame:15,values:{rotation:30}},{boneName:'root',frame:30,values:{rotation:10}}]});
 assert.equal(result.keyCount,3);assert.equal(f.state.history.length,1);assert.equal(f.state.mode,'animate');
 const j=f.state.json;assert.deepEqual(JSON.parse(JSON.stringify(j.animations.walk)),before.animations.walk);assert.deepEqual(JSON.parse(JSON.stringify(j.animations.idle.bones.arm)),before.animations.idle.bones.arm);
 assert.deepEqual(JSON.parse(JSON.stringify(j.animations.idle.bones.root.translate)),before.animations.idle.bones.root.translate);
 assert.deepEqual(JSON.parse(JSON.stringify(j.animations.idle.bones.root.rotate)),[{angle:0},{time:.5,angle:20},{time:1,angle:0}]);
 assert.equal(j.bones[0].rotation,10);f.api.agentAction({operation:'undo'});assert.deepEqual(f.state.json,before);
});

test('native bone creation and setup revision preserve slots and all animation keys with one undo per edit',()=>{
 const f=native(),before=JSON.parse(JSON.stringify(f.state.json));f.state.mode='animate';
 const create={operation:'create_bone',name:'antenna',parentBoneName:'root',values:{length:40,x:0,y:100,rotation:0,scaleX:1.5}};
 validateFoartPlan(wire(create),{schema:FOART_TOOL_SCHEMA,controls:[],animation:f.api.agentContext()});
 const created=f.api.agentAction(create);assert.equal(f.state.mode,'setup');assert.equal(f.state.axes,'parent');assert.equal(created.changed,true);assert.equal(f.state.history.length,1);assert.equal(f.state.selected,'antenna');
 const bone=f.state.json.bones.find(b=>b.name==='antenna');assert.equal(bone.parent,'root');assert.equal(bone.y,100);assert.equal(bone.length,40);assert.equal(bone.scaleX,1.5);
 assert.deepEqual(JSON.parse(JSON.stringify(f.state.json.animations)),before.animations);assert.deepEqual(JSON.parse(JSON.stringify(f.state.json.slots)),before.slots);
 const update={operation:'update_bone',boneName:'antenna',values:{y:120,rotation:10}},updated=f.api.agentAction(update);assert.equal(f.state.history.length,2);assert.equal(f.state.json.bones.find(b=>b.name==='antenna').length,40);
 assert.equal(updated.changed,true);assert.equal(updated.previousBone.y,100);assert.equal(updated.bone.y,120);
 const unchanged=f.api.agentAction(update);assert.equal(unchanged.changed,false);assert.equal(f.state.history.length,2,'Matching values must not create an extra undo step');
 f.api.agentAction({operation:'undo'});assert.equal(f.state.json.bones.find(b=>b.name==='antenna').y,100);
 f.api.agentAction({operation:'undo'});assert.deepEqual(f.state.json,before);
 for(const op of [{...create,parentBoneName:'missing'},{...create,values:{length:-1}},{...create,name:'root'},{operation:'update_bone',boneName:'missing',values:{y:1}},{...create,values:{x:Infinity}}]){
   assert.throws(()=>f.api.agentAction(op));assert.throws(()=>validateFoartPlan(wire(op),{schema:FOART_TOOL_SCHEMA,controls:[],animation:f.api.agentContext()}));
 }
 assert.deepEqual(f.state.json,before);
});
test('animation rejects an invalid whole key batch before mutation and requires existing bones and animations',()=>{
 const f=native(),before=JSON.stringify(f.state.json);
 for(const keys of [[{boneName:'invented',frame:0,values:{rotation:10}}],[{boneName:'root',frame:0,values:{scaleX:101}}],[{boneName:'root',frame:0,values:{rotation:10}},{boneName:'root',frame:-1,values:{rotation:20}}]])assert.throws(()=>f.api.agentAction({operation:'key_bones',name:'idle',keys}));
 assert.equal(JSON.stringify(f.state.json),before);assert.equal(f.state.history.length,0);
 assert.throws(()=>f.api.agentAction({operation:'select_animation',name:'invented'}));
 f.api.agentAction({operation:'create_animation',name:'nod'});assert.ok(f.state.json.animations.nod);assert.ok(f.state.json.animations.walk);
 assert.throws(()=>f.api.agentAction({operation:'create_animation',name:'nod'}));
});
test('planner animation schema and live validation use real project IDs and bounded key values',()=>{
 const f=native(),context={schema:FOART_TOOL_SCHEMA,controls:[],animation:f.api.agentContext()};
 const op={operation:'key_bones',name:'idle',keys:[{boneName:'root',frame:30,values:{rotation:20}}]};
 assert.doesNotThrow(()=>validateFoartPlan(wire(op),context));assert.throws(()=>validateFoartPlan(wire({...op,name:'missing'}),context));
 assert.throws(()=>validateFoartPlan(wire({...op,keys:[{boneName:'root',frame:2,values:{script:'evil'}}]}),context));
 const schema=foartPlanResponseFormat().schema.properties.operations.items.anyOf;
 assert.ok(schema.some(s=>s.properties.action.const==='animation'&&s.properties.operation.const==='key_bones'));
 const snapshot=JSON.stringify(context);assert.ok(snapshot.length<5000);assert.ok(!snapshot.includes('vertices'));assert.ok(!snapshot.includes('uvs'));
});

test('targeted native mesh processing awaits its own receipt, exposes real counts, preserves other attachments and keys',async()=>{
 const f=native(),json=f.state.json;json.slots=[{name:'body',bone:'root',attachment:'robot'}];json.skins[0].attachments={body:{robot:{width:64,height:64},other:{type:'mesh',uvs:[0,0,1,0,1,1,0,1],vertices:[0,0,64,0,64,64,0,64]}}};
 const before=JSON.parse(JSON.stringify(json));let target,builder;
 f.api.meshOneLayer=()=>{};f.api.weighOneLayer=()=>{};f.api.enterMeshEdit=L=>f.state.meshEdit=L;f.api.enterWeightEdit=L=>f.state.weightEdit=L;
 f.api.runBatch=async(layers,label,each)=>{target=layers;builder=each;await new Promise(resolve=>setTimeout(resolve,5));f.api.edit(label,j=>{const next=JSON.parse(JSON.stringify(j));next.skins[0].attachments.body.robot={type:'mesh',uvs:Array(30).fill(0),vertices:Array(30).fill(0),hull:8};return {json:next}});return {done:1,verts:15,skipped:0}};
 const op={operation:'auto_mesh',skinName:'default',slotName:'body',attachmentName:'robot'};
 validateFoartPlan(wire(op),{schema:FOART_TOOL_SCHEMA,controls:[],animation:f.api.agentContext()});const pending=f.api.agentAction(op);assert.equal(f.state.history.length,0);const result=await pending;
 assert.deepEqual(JSON.parse(JSON.stringify(target)),[{skin:'default',slot:'body',name:'robot'}]);assert.equal(builder,f.api.meshOneLayer);assert.equal(result.attachment.vertexCount,15);assert.equal(result.nativeResult.done,1);assert.equal(f.state.history.length,1);assert.equal(f.state.mode,'setup');assert.equal(f.state.meshEdit.name,'robot');
 assert.deepEqual(JSON.parse(JSON.stringify(f.state.json.animations)),before.animations);assert.deepEqual(JSON.parse(JSON.stringify(f.state.json.skins[0].attachments.body.other)),before.skins[0].attachments.body.other);
 for(const bad of [{...op,attachmentName:'missing'},{...op,slotName:'missing'},{...op,skinName:'missing'}]){assert.throws(()=>f.api.agentAction(bad));assert.throws(()=>validateFoartPlan(wire(bad),{schema:FOART_TOOL_SCHEMA,controls:[],animation:f.api.agentContext()}));}
 f.api.runBatch=async()=>({done:0,skipped:1,why:'读不到图片像素'});await assert.rejects(f.api.agentAction(op),/读不到图片像素/);
 const schemas=foartPlanResponseFormat({animation:{active:true}}).schema.properties.operations.items.anyOf;assert.ok(schemas.some(s=>s.properties.action.const==='animation'&&s.properties.attachmentName));
});


test('native slot and skin operations preserve the existing mesh weights and animation and reject invalid edits before mutation',()=>{
 const f=native();f.api.setSkin=name=>f.state.skin=name;
 f.state.json.slots=[{name:'body',bone:'root',attachment:'robot'}];f.state.json.skins[0].attachments={body:{robot:{type:'mesh',uvs:[0,0,1,0,0,1],vertices:[0,0,20,0,0,20]}}};
 const original=JSON.parse(JSON.stringify(f.state.json)),ctx=()=>({schema:FOART_TOOL_SCHEMA,controls:[],animation:f.api.agentContext()});
 const run=op=>{validateFoartPlan(wire(op),ctx());return f.api.agentAction(op);};
 assert.equal(run({operation:'create_skin',name:'验证皮肤'}).skin.name,'验证皮肤');assert.equal(f.state.skin,'验证皮肤');
 assert.equal(run({operation:'select_skin',name:'default'}).skin.name,'default');
 const created=run({operation:'create_slot',name:'marker',parentBoneName:'arm'});assert.equal(created.slot.bone,'arm');assert.equal(created.slot.name,'marker');
 assert.equal(run({operation:'select_slot',slotName:'body'}).slot.name,'body');
 const updated=run({operation:'update_slot',slotName:'body',values:{blend:'additive',color:'ff8040ff'}});assert.equal(updated.slot.blend,'additive');assert.equal(updated.previousSlot.blend,undefined);assert.equal(updated.slot.attachment,'robot');
 assert.deepEqual(JSON.parse(JSON.stringify(f.state.json.skins[0])),original.skins[0]);assert.deepEqual(JSON.parse(JSON.stringify(f.state.json.animations)),original.animations);assert.deepEqual(JSON.parse(JSON.stringify(f.state.json.bones)),original.bones);
 const before=JSON.stringify(f.state.json),history=f.state.history.length;
 for(const op of [{operation:'create_slot',name:'marker',parentBoneName:'arm'},{operation:'create_slot',name:'bad',parentBoneName:'missing'},{operation:'create_skin',name:'default'},{operation:'select_skin',name:'missing'},{operation:'select_slot',slotName:'missing'},{operation:'update_slot',slotName:'body',values:{blend:'glow'}},{operation:'update_slot',slotName:'body',values:{color:'red'}},{operation:'update_slot',slotName:'body',values:{bone:'missing'}},{operation:'create_slot',name:' bad ',parentBoneName:'root'}]){assert.throws(()=>validateFoartPlan(wire(op),ctx()));assert.throws(()=>f.api.agentAction(op));}
 assert.equal(JSON.stringify(f.state.json),before);assert.equal(f.state.history.length,history);
 f.api.edit=()=>null;assert.throws(()=>f.api.agentAction({operation:'create_skin',name:'rollback'}),/创建失败/);assert.throws(()=>f.api.agentAction({operation:'create_slot',name:'rollback',parentBoneName:'root'}),/修改失败/);
});
