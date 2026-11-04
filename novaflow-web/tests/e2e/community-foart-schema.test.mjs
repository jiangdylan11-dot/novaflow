import test from 'node:test';
import assert from 'node:assert/strict';
import {createFlashArtAgent} from '../../worker/src/flash-art-agent.mjs';
import {createFlashBrainSession} from '../../worker/src/flash-brain-session.mjs';
import {FOART_TOOL_SCHEMA} from '../../packages/shared/src/foart-tool-plan.mjs';

const context={schema:FOART_TOOL_SCHEMA,controls:[]};
const payload={requestId:'schema-test',mode:'foart',message:'请先检查当前状态',history:[],foartContext:context,images:[]};
const answer=JSON.stringify({schema:FOART_TOOL_SCHEMA,status:'clarify',reply:'请先提供对象。',operations:[]});

test('community FOART requests the existing schema; Next keeps its original request',async()=>{
  for(const supported of [false,true]) {
    let call;
    const flash={identity:{id:'fixture'},supportsFoartJsonSchema:supported,async inferConversation(value){
      call=value;return {model:'fixture',requestId:'one',finishReason:'stop',message:{content:answer}};
    }};
    const result=await createFlashArtAgent().run({payload,flash});
    assert.equal(result.toolPlan.status,'clarify');
    if(supported){assert.equal(call.responseFormat.type,'json_schema');assert.equal(call.responseFormat.json_schema.name,'foart_native_plan');assert.match(call.messages[0].content,/inspect_bones/);}
    else {assert.equal(call.responseFormat,undefined);assert.doesNotMatch(call.messages[0].content,/inspect_bones/);}
  }
});

test('community animation inspection phase is carried to the schema without authorizing execution',async()=>{
  const animationContext={...context,animation:{active:true}};
  let call;
  const flash={identity:{id:'fixture'},supportsFoartJsonSchema:true,async inferConversation(value){
    call=value;return {model:'fixture',requestId:'one',finishReason:'stop',message:{content:answer}};
  }};
  await createFlashArtAgent().run({payload:{...payload,foartContext:animationContext,foartAnimationStage:'inspect'},flash});
  const choices=call.responseFormat.json_schema.schema.properties.operations.items.anyOf;
  assert.ok(choices.length>0);
  assert.ok(choices.every(item=>item.properties.action.const==='animation' && item.properties.operation.const==='inspect_bones'));
  await assert.rejects(createFlashArtAgent().run({payload:{...payload,foartAnimationStage:'untrusted'},flash}),/动画规划阶段无效/);
});

test('conversation sends explicit JSON schema and rejects combining it with native tools',async()=>{
  const calls=[];
  const json=value=>new Response(JSON.stringify(value));
  const session=createFlashBrainSession({expectedModel:{ids:['fixture'],paths:['E:/fixture.gguf']},
    lifecycle:{load:async()=>({ok:true}),unload:async()=>({ok:true,released:true})},
    fetchImpl:async(url,init)=>{
      if(url.endsWith('/v1/models'))return json({data:[{id:'fixture'}]});
      if(url.endsWith('/props'))return json({model_path:'E:/fixture.gguf'});
      calls.push(JSON.parse(init.body));return json({id:'one',model:'fixture',choices:[{finish_reason:'stop',message:{role:'assistant',content:answer}}]});
    }});
  const messages=[{role:'system',content:'Reply with JSON.'},{role:'user',content:'Check state.'}];
  const format={type:'json_schema',json_schema:{name:'fixture',schema:{type:'object'}}};
  await session.withSession(async({inferConversation})=>{
    await inferConversation({messages,responseFormat:format});
    await assert.rejects(inferConversation({messages,responseFormat:format,tools:[{type:'function',function:{name:'read',parameters:{type:'object',properties:{}}}}]}),/JSON format and native tools/);
    await inferConversation({messages});
  });
  assert.deepEqual(calls[0].response_format,format);
  assert.equal(calls[1].response_format,undefined);
});
