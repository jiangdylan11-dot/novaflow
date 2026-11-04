import test from 'node:test';
import assert from 'node:assert/strict';
import {runQwenRotationCandidatePreview} from '../worker/src/flash-art-agent.mjs';
import {communityTrialCapabilityFailure,communityTrialResponseFailure} from '../worker/src/local-model-selection.mjs';
import {FOART_TOOL_SCHEMA} from '../packages/shared/src/foart-tool-plan.mjs';
const actor={workerId:'fixture-worker',taskId:'fixture-task',scope:'qwen-foart-rotation-candidate-v1',attempt:1};
function payload(requestId='fixture_request_01') {return {requestId,provider:'local',modelId:'qwen3.5-9b-heretic',mode:'foart',foartAnimationStage:'rotation_candidate',message:'旋转选中骨骼第24帧',history:[],images:[],
 foartContext:{schema:FOART_TOOL_SCHEMA,controls:[],animation:{active:true,loaded:true,revision:'r1',name:'fixture',fps:24,animation:'walk',animations:['walk'],selectedBones:['cape'],bones:[{name:'cape'}]}},
 rotationBaseline:{action:'animation',operation:'inspect_bones',phase:'observed',inspection:{name:'walk',revision:'r1',fps:24,bones:[{boneName:'cape',tracks:{rotate:[{time:1,angle:0}]},complete:true}],complete:true,truncated:false}}};}
const modelPlan=()=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'预览',operations:[{action:'animation',operation:'key_bones',name:'walk',keys:[{boneName:'cape',frame:24,values:{rotation:12}}]}]});
const flash=(inferConversation)=>({identity:{id:'qwen35-heretic'},supportsFoartJsonSchema:true,inferConversation});

test('default product gate stays closed even with candidate-shaped input',async()=>{
 const p=payload();assert.equal(communityTrialCapabilityFailure(p)?.ok,false);let called=false;
 await assert.rejects(runQwenRotationCandidatePreview({payload:p,flash:flash(async()=>{called=true}),actor,isCurrent:async()=>true}),/已验证/);
 assert.equal(called,false);
});

test('isolated verified candidate produces data only and stays behind existing response gate',async()=>{
 const p=payload('fixture_request_02');let request,checks=0;
 const result=await runQwenRotationCandidatePreview({enabled:true,payload:p,actor,isCurrent:async actual=>{checks++;assert.deepEqual(actual,actor);return true},flash:flash(async input=>{request=input;return {model:'qwen35-heretic',requestId:'fixture-model',finishReason:'stop',message:{content:JSON.stringify(modelPlan())}}})});
 assert.equal(checks,2);assert.equal(result.rotationCandidateStatus,'candidate');assert.deepEqual(result.rotationCandidate,{animation:'walk',boneName:'cape',frame:24,rotation:12});
 assert.equal(result.toolPlan,undefined);assert.equal(result.executionApproval,undefined);assert.deepEqual(result.toolTrace,[]);assert.match(result.reply,/尚未修改/);
 assert.equal(request.maxTokens,512);assert.equal(request.reasoningEffort,'none');assert.match(request.messages[0].content,/key_bones/);
 assert.equal(communityTrialResponseFailure(p,result)?.ok,false,'normal production response gate remains closed');
 await assert.rejects(runQwenRotationCandidatePreview({enabled:true,payload:p,actor,isCurrent:async()=>true,flash:flash(async()=>{})}),/已处理/);
});

test('owner changes, unsupported media and forged operations cannot produce a candidate',async()=>{
 let modelCalls=0;const good=flash(async()=>{modelCalls++;return {model:'qwen35-heretic',requestId:'fixture-model',finishReason:'stop',message:{content:JSON.stringify(modelPlan())}}});

 await assert.rejects(runQwenRotationCandidatePreview({enabled:true,payload:payload('fixture_request_07'),actor:{...actor,attempt:0},isCurrent:async()=>true,flash:good}));
 await assert.rejects(runQwenRotationCandidatePreview({enabled:true,payload:payload('fixture_request_08'),actor:{...actor,scope:'qwen-readonly'},isCurrent:async()=>true,flash:good}));assert.equal(modelCalls,0);
 await assert.rejects(runQwenRotationCandidatePreview({enabled:true,payload:payload('fixture_request_03'),actor,isCurrent:async()=>false,flash:good}),/已变化/);assert.equal(modelCalls,0);
 const p=payload('fixture_request_04');p.images=[{dataUrl:'data:image/png;base64,AA=='}];await assert.rejects(runQwenRotationCandidatePreview({enabled:true,payload:p,actor,isCurrent:async()=>true,flash:good}),/请求无效/);
 let checks=0;await assert.rejects(runQwenRotationCandidatePreview({enabled:true,payload:payload('fixture_request_05'),actor,isCurrent:async()=>++checks===1,flash:good}),/已变化/);
 const invalid=modelPlan();invalid.operations[0].keys[0].values.x=1;
 await assert.rejects(runQwenRotationCandidatePreview({enabled:true,payload:payload('fixture_request_06'),actor,isCurrent:async()=>true,flash:flash(async()=>({model:'qwen35-heretic',requestId:'fixture-model',finishReason:'stop',message:{content:JSON.stringify(invalid)}}))}),/参数无效/);
});

test('cancellation during an in-flight authorization cannot start inference or return a candidate',async()=>{
 let release,modelCalls=0;const controller=new AbortController();
 const pending=runQwenRotationCandidatePreview({enabled:true,payload:payload('fixture_request_09'),actor,
   signal:controller.signal,isCurrent:()=>new Promise(resolve=>{release=resolve}),flash:flash(async()=>{modelCalls++;})});
 controller.abort();release(true);await assert.rejects(pending);assert.equal(modelCalls,0);
 let releaseAfter,checks=0;const afterController=new AbortController();
 const pendingAfter=runQwenRotationCandidatePreview({enabled:true,payload:payload('fixture_request_10'),actor,
   signal:afterController.signal,isCurrent:()=>++checks===1?true:new Promise(resolve=>{releaseAfter=resolve}),
   flash:flash(async()=>({model:'qwen35-heretic',requestId:'fixture-model',finishReason:'stop',message:{content:JSON.stringify(modelPlan())}}))});
 while(!releaseAfter)await new Promise(resolve=>setImmediate(resolve));
 afterController.abort();releaseAfter(true);await assert.rejects(pendingAfter);
});
