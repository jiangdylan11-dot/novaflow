import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {FOART_TOOL_SCHEMA,validateFoartPlan,foartPlanResponseFormat} from '../../packages/shared/src/foart-tool-plan.mjs';
const source=readFileSync(new URL('../../renderer/spine-split-runtime.js',import.meta.url),'utf8');
const plan=operation=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'使用原生迁移位置规则',operations:[operation]});
test('transfer placement uses the original scale/visibility clamps and preserves its background and reference',()=>{
 const state={source:{dataUrl:'background'},objectTransfer:{active:true,referenceOriginalDataUrl:'data:image/png;base64,reference',referenceCutoutDataUrl:'data:image/png;base64,cutout',referenceWidth:100,referenceHeight:200,referenceFileName:'object.png',x:0,y:0,scale:1}};
 const context={state,clampNumber:(v,min,max)=>Math.max(min,Math.min(max,v)),OBJECT_TRANSFER_MIN_VISIBLE_PX:24,OBJECT_TRANSFER_MIN_VISIBLE_RATIO:.2,sourceCanvasSizeSync:()=>({width:640,height:512}),objectTransferReady:()=>true,refreshObjectTransferOverlay(){},patchSplitCanvasContentSignature(){},syncSplitWorkspace(){}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  function objectTransferState()'),source.indexOf('  function objectTransferInitialScale(')),context);
 const start=source.indexOf('    agentTransferContext()'),end=source.indexOf('    agentSelectLayers(',start);vm.runInContext('this.bridge={'+source.slice(start,end)+'};',context);
 const result=context.bridge.agentPlaceTransfer({x:-10000,y:10000,scale:100});assert.equal(result.phase,'applied');assert.ok(result.placement.scale<=result.placement.limits.max);assert.ok(result.placement.bounds.x>-10000);assert.ok(result.placement.bounds.y<512);assert.equal(state.source.dataUrl,'background');assert.equal(state.objectTransfer.referenceOriginalDataUrl,'data:image/png;base64,reference');
 const before=JSON.stringify(state);assert.throws(()=>context.bridge.agentPlaceTransfer({x:NaN,y:0,scale:1}));assert.equal(JSON.stringify(state),before);
 const current={schema:FOART_TOOL_SCHEMA,controls:[],artEditor:{objectTransfer:result.placement}};
 assert.doesNotThrow(()=>validateFoartPlan(plan({action:'art_transfer_place',x:20,y:370,scale:.25}),current));assert.throws(()=>validateFoartPlan(plan({action:'art_transfer_place',x:20,y:370,scale:0}),current));
});
test('loaded animation planning includes the real native canvas draw operation',()=>{
 const context={schema:FOART_TOOL_SCHEMA,animation:{active:true,loaded:true},controls:[{id:'native-stage',kind:'canvas',surface:'animation'}]};
 const schemas=foartPlanResponseFormat(context).schema.properties.operations.items.anyOf;
 assert.ok(schemas.some(schema=>schema.properties.action.const==='draw'));
 assert.doesNotThrow(()=>validateFoartPlan(plan({action:'draw',controlId:'native-stage',points:[[.49,.5],[.51,.5]]}),context));
});
