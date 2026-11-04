import test from 'node:test';
import assert from 'node:assert/strict';
import {FOART_TOOL_SCHEMA,foartPlanResponseFormat,communityBoneSelectionResponseFormat,readCommunityBoneSelection} from '../../packages/shared/src/foart-tool-plan.mjs';
import {createFlashArtAgent,prepareFlashArtAgentPayload} from '../../worker/src/flash-art-agent.mjs';

const context=()=>({schema:FOART_TOOL_SCHEMA,controls:[],animation:{active:true,loaded:true,animation:'idle',boneCount:2,bones:[{name:'body'},{name:'hair'}],selectedBones:['body']}});
const image={role:'result',dataUrl:'data:image/png;base64,iVBORw0KGgo='};
const request=(patch={})=>({requestId:'candidate-request-1',provider:'local',mode:'foart',foartAnimationStage:'select_candidate',message:'请选择头发骨骼',history:[],foartContext:context(),images:[image],...patch});

test('candidate schema is independent from the default tool plan and contains no executable operation',()=>{
  const c=context(),schema=communityBoneSelectionResponseFormat(c).schema;
  assert.deepEqual(schema.anyOf[0].properties.boneName.enum,['body','hair']);
  assert.equal(JSON.stringify(schema).includes('operations'),false);
  assert.ok(JSON.stringify(foartPlanResponseFormat(c)).includes('select_bone'));
  assert.equal(JSON.stringify(foartPlanResponseFormat(c)).includes('community_bone_candidate'),false);
  const truncated=context();truncated.animation.boneCount=3;
  assert.deepEqual(communityBoneSelectionResponseFormat(truncated).schema.anyOf.map(x=>x.properties.status.const),['clarify']);
  const duplicate=context();duplicate.animation.bones[1].name='body';
  assert.deepEqual(communityBoneSelectionResponseFormat(duplicate).schema.anyOf.map(x=>x.properties.status.const),['clarify']);
});
test('candidate parser allows only unique existing bones and deterministic user-facing text',()=>{
  const c=context();assert.deepEqual(readCommunityBoneSelection('{"status":"candidate","boneName":"hair"}',c),
    {status:'candidate',boneName:'hair',reply:'候选骨骼：hair。请确认是否选择。'});
  assert.equal(readCommunityBoneSelection('{"status":"clarify","boneName":""}',c).status,'clarify');
  for(const value of ['{"status":"candidate","boneName":"missing"}','{"status":"candidate","boneName":"hair","operations":[]}',
    '{"status":"clarify","boneName":"hair"}','{"status":"candidate","boneName":"hair","reply":"已选择"}','not json'])
    assert.throws(()=>readCommunityBoneSelection(value,c));
});
test('candidate stage requires current animation and one actual result image',()=>{
  assert.equal(prepareFlashArtAgentPayload(request()).images.length,1);
  for(const change of [{images:[]},{images:[{...image,role:'attachment'}]},{mode:'chat'},{foartContext:{...context(),animation:{...context().animation,loaded:false}}}])
    assert.throws(()=>prepareFlashArtAgentPayload(request(change)));
});
test('community planner returns candidate only without executing a tool or using default history',async()=>{
  const agent=createFlashArtAgent(),calls=[],flash={identity:{id:'community'},supportsFoartJsonSchema:true,
    inferConversation:async input=>{calls.push(input);return {model:'community',requestId:'response-1',finishReason:'stop',message:{content:'{"status":"candidate","boneName":"hair"}'}};}};
  const result=await agent.run({payload:request({history:[{role:'user',content:'old unrelated instruction'}]}),flash});
  assert.equal(result.selectionCandidate.boneName,'hair');assert.equal(result.toolPlan,undefined);assert.deepEqual(result.toolTrace,[]);
  assert.equal(calls.length,1);assert.equal(calls[0].messages.length,2);assert.equal(calls[0].messages[1].content[1].type,'image_url');
  assert.equal(calls[0].responseFormat.json_schema.name,'community_bone_candidate');
});
test('Next and untrusted or malformed candidates fail closed without tools or repair',async()=>{
  let calls=0;const next={identity:{id:'next'},inferConversation:async()=>{calls++;}};
  await assert.rejects(createFlashArtAgent().run({payload:request(),flash:next}),/仅支持社区本地模型/);assert.equal(calls,0);
  const flash={identity:{id:'community'},supportsFoartJsonSchema:true,inferConversation:async()=>{calls++;return {model:'community',requestId:'r',finishReason:'stop',message:{content:'{"status":"candidate","boneName":"unknown"}'}};}};
  await assert.rejects(createFlashArtAgent().run({payload:request(),flash}),/候选无效/);assert.equal(calls,1);
});
