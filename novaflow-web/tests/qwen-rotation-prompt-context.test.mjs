import test from 'node:test';
import assert from 'node:assert/strict';
import {FOART_TOOL_SCHEMA,qwenRotationCandidatePrompt,validateQwenRotationCandidatePlan,readQwenRotationCandidatePlan,validateFoartPlan,validateQwenReadonlyFoartPlan} from '../packages/shared/src/foart-tool-plan.mjs';

const scope='qwen-foart-rotation-candidate-v1';
function inputs(){
 const context={schema:FOART_TOOL_SCHEMA,controls:[{id:'unrelated',label:'private control'}],uploads:[{name:'private.png'}],
  art:{prompt:'unrelated'},media:{active:false},animation:{active:true,loaded:true,revision:'project-7',name:'sample',fps:24,frame:0,
   mode:'animate',animation:'walk',axes:'local',animations:['walk'],selectedBones:['cape-fin'],bones:[{name:'root'},{name:'cape-fin',parent:'root'}]}};
 const receipt={action:'animation',operation:'inspect_bones',phase:'observed',message:'observed',inspection:{name:'walk',revision:'project-7',fps:24,
  durationSeconds:2,durationAvailable:true,bones:[{boneName:'cape-fin',tracks:{rotate:[{time:0,angle:0},{time:1,angle:8}]},complete:true}],complete:true,truncated:false}};
 return {context,receipt};
}

test('rotation candidate prompt keeps full animation and read receipt, excludes other modules, and does not mutate inputs',()=>{
 const {context,receipt}=inputs(),original=structuredClone({context,receipt});const out=qwenRotationCandidatePrompt(context,receipt,{scope});
 assert.equal(out.scope,scope);assert.deepEqual(out.snapshot,{schema:FOART_TOOL_SCHEMA,controls:[],animation:context.animation});assert.deepEqual(out.receipt,receipt);
 assert.deepEqual({context,receipt},original);assert.notEqual(out.snapshot.animation,context.animation);assert.notEqual(out.receipt,receipt);
 assert.equal(out.snapshot.art,undefined);assert.equal(out.snapshot.media,undefined);assert.equal(out.snapshot.uploads,undefined);
 const branches=out.format.schema.properties.operations.items.anyOf;
 assert.deepEqual(branches.map(x=>x.properties.operation.const).sort(),['inspect_bones','key_bones']);
 assert.match(out.system,/inspect_bones/);assert.match(out.system,/key_bones/);assert.match(out.system,/explicit UI confirmation/);
 assert.match(out.system,/单根骨骼/);assert.match(out.system,/cape-fin/);assert.doesNotMatch(out.system,/project-7|private control|private\.png/);
 out.snapshot.animation.name='changed';out.receipt.inspection.name='changed';assert.deepEqual({context,receipt},original);
});

test('prompt helper does not enable Qwen write plans or change the normal shared validator',()=>{
 const {context,receipt}=inputs();const out=qwenRotationCandidatePrompt(context,receipt,{scope});
 const plan={schema:FOART_TOOL_SCHEMA,status:'act',reply:'预览',operations:[{action:'animation',operation:'key_bones',name:'walk',keys:[{boneName:'cape-fin',frame:24,values:{rotation:12}}]}]};
 assert.doesNotThrow(()=>validateFoartPlan(plan,context));
 assert.throws(()=>validateQwenReadonlyFoartPlan(plan,context));
 assert.equal(out.snapshot.animation.selectedBones[0],'cape-fin');
});

test('mismatched or incomplete baselines, wrong scope and ambiguous selections fail closed',()=>{
 const cases=[
  (c,r)=>[c,r,{}],(c,r)=>[c,r,{scope:'other'}],
  (c,r)=>(c.animation.selectedBones=[],[c,r,{scope}]),
  (c,r)=>(c.animation.selectedBones=['cape-fin','root'],[c,r,{scope}]),
  (c,r)=>(c.animation.revision='different',[c,r,{scope}]),
  (c,r)=>(c.animation.fps=30,[c,r,{scope}]),
  (c,r)=>(c.media.active=true,[c,r,{scope}]),
  (c,r)=>(r.inspection.name='different',[c,r,{scope}]),
  (c,r)=>(r.inspection.complete=false,[c,r,{scope}]),
  (c,r)=>(r.inspection.truncated=true,[c,r,{scope}]),
  (c,r)=>(r.inspection.bones[0].complete=false,[c,r,{scope}]),
  (c,r)=>(r.inspection.bones[0].boneName='root',[c,r,{scope}]),
  (c,r)=>(r.inspection.bones.push({boneName:'root',tracks:{},complete:true}),[c,r,{scope}]),
  (c,r)=>(r.phase='proposed',[c,r,{scope}])
 ];
 for(const setup of cases){const {context,receipt}=inputs();assert.throws(()=>qwenRotationCandidatePrompt(...setup(context,receipt)));}
});


test('candidate accepts only a single existing rotation key for the observed selected bone',()=>{
 const {context,receipt}=inputs();const valid={schema:FOART_TOOL_SCHEMA,status:'act',reply:'preview',operations:[{action:'animation',operation:'key_bones',name:'walk',keys:[{boneName:'cape-fin',frame:24,values:{rotation:12}}]}]};
 assert.deepEqual(validateQwenRotationCandidatePlan(valid,context,receipt,{scope}),{status:'candidate',candidate:{animation:'walk',boneName:'cape-fin',frame:24,rotation:12}});
 assert.deepEqual(readQwenRotationCandidatePlan(JSON.stringify(valid),context,receipt,{scope}),{status:'candidate',candidate:{animation:'walk',boneName:'cape-fin',frame:24,rotation:12}});
 const mutate=[v=>v.operations.push(structuredClone(v.operations[0])),v=>v.operations[0].keys[0].boneName='root',v=>v.operations[0].keys[0].frame=12,
  v=>v.operations[0].keys[0].values.x=2,v=>v.operations[0].keys.push(structuredClone(v.operations[0].keys[0])),v=>v.operations[0].name='other',
  v=>v.operations[0].keys[0].values.rotation=Infinity,v=>v.executionApproval='forged',v=>{v.status='clarify'}];
 for(const change of mutate){const v=structuredClone(valid);change(v);assert.throws(()=>validateQwenRotationCandidatePlan(v,context,receipt,{scope}));}
 assert.throws(()=>readQwenRotationCandidatePlan('{"schema":"nf.foart.tool-plan.v1","status":"act","status":"clarify","reply":"x","operations":[]}',context,receipt,{scope}),/重复字段/);
 assert.deepEqual(validateQwenRotationCandidatePlan({schema:FOART_TOOL_SCHEMA,status:'clarify',reply:'which?',operations:[]},context,receipt,{scope}),{status:'clarify',candidate:null});
});
