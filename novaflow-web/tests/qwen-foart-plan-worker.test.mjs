import test from 'node:test';
import assert from 'node:assert/strict';
import {createQwenFoartPlanOnlineVerifier,validateQwenFoartPlanTask,qwenFoartPlanResultName,qwenPlanSafeFailureMessage} from '../worker/src/worker-core.mjs';
import {computePromptAssistantOptions} from '../worker/src/compute-assistant.mjs';
import {createPromptAssistant} from '../worker/src/prompt-assistant.mjs';
import {QWEN_ROTATION_RELEASE_POLICY} from '../worker/src/qwen-rotation-release-policy.mjs';
import {runQwenRotationCandidatePreview} from '../worker/src/flash-art-agent.mjs';
import {FOART_TOOL_SCHEMA} from '../packages/shared/src/foart-tool-plan.mjs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const taskId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const workerId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const sessionId='33333333-3333-4333-8333-333333333333',digest='a'.repeat(64),scope='qwen-foart-plan-v1';
const metadata=()=>({id:taskId,task_type:'prompt_assistant',model_id:'qwen3.5-9b-heretic-foart-plan-v1',attempt_count:1,
  parameters:{action:'art-agent-chat',model_id:'qwen3.5-9b-heretic',assistant_tool_scope:scope,request_id:requestId,request_sha256:digest,request_bytes:72},
  references:[{name:'qwen-foart-plan-request.json',kind:'json',bytes:72}]});

test('plan failures distinguish safe GPU and identity causes without forwarding arbitrary errors',()=>{
  for(const [errorCode,part] of [
    ['qwen-gpu-memory-low','显存不足'],['qwen-gpu-generation-busy','生成任务'],
    ['qwen-gpu-queue-unverified','队列'],['qwen-gpu-component-missing','组件缺失'],
    ['qwen-gpu-not-ready','尚未就绪'],['qwen-gpu-proof-unconfirmed','未切换到 CPU'],
    ['strata-identity-mismatch','身份'],['qwen-rotation-owner-stale','登录会话']
  ]) {
    const message=qwenPlanSafeFailureMessage({ok:false,errorCode,error:'C:\\private\\secret'});
    assert.ok(message.includes(part),errorCode);assert.match(message,/未修改作品/);assert.doesNotMatch(message,/private|secret/);
  }
  for(const errorCode of ['unknown','constructor','__proto__','qwen-gpu-memory-low\nprivate',undefined]) {
    const message=qwenPlanSafeFailureMessage({ok:false,errorCode,error:'secret C:\\private'});
    assert.equal(message,'本地模型规划未完成，本次未修改作品。');
  }
  assert.equal(qwenPlanSafeFailureMessage({ok:true}), '本地模型规划未完成，本次未修改作品。');
});

test('plan task accepts only its bound ordinary capability, exact file and attempt',()=>{
  assert.equal(validateQwenFoartPlanTask(metadata()),true);
  for(const alter of [t=>t.id='fa047a0a-aaaa-8aaa-8aaa-aaaaaaaaaaaa',t=>t.model_id='qwen3.5-9b-heretic',
    t=>t.parameters.assistant_tool_scope='qwen-foart-rotation-candidate-v1',t=>t.attempt_count=0,t=>t.attempt_count=21,
    t=>t.parameters.request_sha256='bad',t=>t.parameters.request_bytes=0,t=>t.references[0].name='request.json',
    t=>t.references[0].bytes=71,t=>t.references.push(t.references[0])]){
    const task=metadata();alter(task);assert.throws(()=>validateQwenFoartPlanTask(task));
  }
  assert.equal(qwenFoartPlanResultName(2),'qwen-foart-plan-result-2.json');
});

test('plan online verifier binds worker, task, session, scope, attempt and uploaded bytes',async()=>{
  let captured;
  const base={authorized:true,taskId,workerId,userId,sessionId,scope,attempt:1,op:'upload',digestBound:true,sha256:digest,bytes:72};
  const make=result=>createQwenFoartPlanOnlineVerifier({getWorkerToken:()=> 'fixture-token',getWorkerId:()=>workerId,
    callControl:async(method,path,options)=>{captured={method,path,options};return result;}});
  const request={taskId,workerId,op:'upload',phase:'finish',attempt:1,sha256:digest,bytes:72,untrustedGrantUser:'ignored'};
  assert.deepEqual(await make(base)(request),base);
  assert.equal(captured.path,`/api/worker/tasks/${taskId}/qwen-foart-plan-verify`);
  assert.equal(Object.hasOwn(captured.options.body,'untrustedGrantUser'),false);
  for(const change of [{authorized:false},{taskId:requestId},{workerId:userId},{sessionId:'bad'},
    {scope:'qwen-foart-rotation-candidate-v1'},{attempt:2},{digestBound:false},{sha256:'b'.repeat(64)},{bytes:71}]){
    await assert.rejects(make({...base,...change})(request));
  }
  await assert.rejects(make(base)({...request,workerId:userId}));
});

test('both plan switches are required; enabling plan never enables old candidate',()=>{
  assert.equal(QWEN_ROTATION_RELEASE_POLICY.planEnabled,true);
  assert.equal(QWEN_ROTATION_RELEASE_POLICY.planVerificationEnabled,true);
  assert.equal(QWEN_ROTATION_RELEASE_POLICY.candidateEnabled,false);
  assert.equal(QWEN_ROTATION_RELEASE_POLICY.verificationEnabled,false);
  for(const options of [{},{qwenPlanEnabled:true},{qwenPlanVerificationEnabled:true}]){
    const actual=computePromptAssistantOptions(options,null,[]);
    assert.equal(actual.qwenPlanEnabled,false);assert.equal(actual.qwenRotationCandidateEnabled,false);
  }
  const both=computePromptAssistantOptions({qwenPlanEnabled:true,qwenPlanVerificationEnabled:true},null,[]);
  assert.equal(both.qwenPlanEnabled,true);assert.equal(both.qwenRotationCandidateEnabled,false);
});

test('actual assistant factory requires trusted independent plan switches',async()=>{
  const worker={getState:()=>({sharing:true,runtimeReady:true,currentTaskId:taskId})};
  const config=join(tmpdir(),'foart-absent-plan-factory.json');
  for(const [plan,verification,want] of [[undefined,undefined,false],[true,undefined,false],
    [undefined,true,false],[true,true,true],['true',true,false],[true,1,false]]){
    const options=computePromptAssistantOptions({qwenPlanEnabled:plan,qwenPlanVerificationEnabled:verification,
      promptAssistant:{strataConfigPath:config,qwenPlanEnabled:true,qwenPlanVerificationEnabled:true}},worker,['http://127.0.0.1:8188']);
    const assistant=createPromptAssistant(options);
    try {assert.equal(assistant.status().qwenPlanEnabled,want);assert.equal(assistant.status().qwenRotationCandidateEnabled,false);}
    finally {await assistant.stop();}
  }
});

test('new scope uses the same bounded model preview and authoritative before/after checks',async()=>{
  const actor={taskId,workerId,scope,attempt:1}, checks=[];
  const payload={requestId,provider:'local',modelId:'qwen3.5-9b-heretic',mode:'foart',foartAnimationStage:'rotation_candidate',
    message:'选中骨骼第24帧旋转12度',history:[],images:[],
    foartContext:{schema:FOART_TOOL_SCHEMA,controls:[],animation:{active:true,loaded:true,revision:'r1',name:'fixture',fps:24,
      animation:'walk',animations:['walk'],selectedBones:['cape'],bones:[{name:'cape'}]}},
    rotationBaseline:{action:'animation',operation:'inspect_bones',phase:'observed',inspection:{name:'walk',revision:'r1',fps:24,
      bones:[{boneName:'cape',tracks:{rotate:[{time:1,angle:0}]},complete:true}],complete:true,truncated:false}}};
  const plan={schema:FOART_TOOL_SCHEMA,status:'act',reply:'预览',operations:[{action:'animation',operation:'key_bones',name:'walk',keys:[{boneName:'cape',frame:24,values:{rotation:12}}]}]};
  const flash={identity:{id:'qwen35-heretic'},supportsFoartJsonSchema:true,inferConversation:async()=>
    ({model:'qwen35-heretic',requestId:'model-fixture',finishReason:'stop',message:{content:JSON.stringify(plan)}})};
  const result=await runQwenRotationCandidatePreview({enabled:true,payload,actor,flash,isCurrent:async(a,phase)=>{assert.equal(a.scope,scope);checks.push(phase);return true;}});
  assert.deepEqual(checks,['before','after']);assert.deepEqual(result.rotationCandidate,{animation:'walk',boneName:'cape',frame:24,rotation:12});
  assert.deepEqual(result.toolTrace,[]);assert.match(result.reply,/尚未修改/);
});
