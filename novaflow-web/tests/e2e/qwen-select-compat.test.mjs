import test from 'node:test';
import assert from 'node:assert/strict';
import {FOART_TOOL_SCHEMA,readCommunityBoneSelection} from '../../packages/shared/src/foart-tool-plan.mjs';
import {communityTrialCapabilityFailure,communityTrialResponseFailure} from '../../worker/src/local-model-selection.mjs';
import {createFlashArtAgent} from '../../worker/src/flash-art-agent.mjs';

const context={schema:FOART_TOOL_SCHEMA,controls:[],animation:{active:true,loaded:true,animation:'idle',animations:['idle'],boneCount:2,bones:[{name:'body'},{name:'hair'}],selectedBones:[]}};
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const payload={modelId:'qwen3.5-9b-heretic',provider:'local',mode:'foart',foartAnimationStage:'select_candidate',requestId:'select-compat-1',
  message:'请选择头发骨骼',history:[],images:[{role:'result',dataUrl:image}],foartContext:context};

test('previous image selection candidate still parses in isolated agent but remains disabled at production guard',async()=>{
  assert.equal(communityTrialCapabilityFailure(payload)?.errorCode,'community-trial-capability-unavailable');
  let seen;const flash={identity:{id:'qwen35-heretic'},supportsFoartJsonSchema:true,inferConversation:async request=>{seen=request;return {model:'qwen35-heretic',requestId:'select-result-1',finishReason:'stop',message:{content:JSON.stringify({status:'candidate',boneName:'hair'})}};}};
  const result=await createFlashArtAgent().run({payload,flash});assert.equal(result.selectionCandidate.boneName,'hair');
  assert.equal(result.toolPlan,undefined);assert.deepEqual(result.toolTrace,[]);assert.equal(seen.responseFormat.json_schema.name,'community_bone_candidate');
  assert.equal(communityTrialResponseFailure(payload,result)?.errorCode,'community-trial-response-rejected');
});

test('selection schema retains complete-bone and no-operation safeguards',()=>{
  assert.equal(readCommunityBoneSelection('{"status":"candidate","boneName":"hair"}',context).boneName,'hair');
  for(const value of [{status:'candidate',boneName:'unknown'},{status:'candidate',boneName:'hair',operations:[{action:'animation',operation:'select_bone'}]},
    {status:'clarify',boneName:'hair'}]) assert.throws(()=>readCommunityBoneSelection(JSON.stringify(value),context));
  assert.throws(()=>readCommunityBoneSelection('{"status":"candidate","boneName":"hair"}',{...context,animation:{...context.animation,boneCount:3}}));
});

test('legacy inspect/plan stages remain blocked by default even when readonly and seek are available',()=>{
  for(const stage of ['select_candidate','inspect','plan'])assert.equal(communityTrialCapabilityFailure({...payload,foartAnimationStage:stage})?.errorCode,'community-trial-capability-unavailable');
  assert.equal(communityTrialCapabilityFailure({...payload,foartAnimationStage:undefined,images:[]}),null);
  assert.equal(communityTrialCapabilityFailure({...payload,foartAnimationStage:'seek_candidate',images:[]}),null);
});

