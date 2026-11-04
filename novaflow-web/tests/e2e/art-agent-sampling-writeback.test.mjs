import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
const modelSandbox={module:{exports:{}}};
runInContext(readFileSync(new URL('../../renderer/art-generate-model.resource.js',import.meta.url),'utf8'),createContext(modelSandbox));
const models=modelSandbox.module.exports;
const runtimeSource=readFileSync(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));

function drawing(){
  const sandbox={localStorage:{getItem:()=>null},NovaFlowArtGenerateModels:models};sandbox.window=sandbox;
  const vm=createContext(sandbox);runInContext(readFileSync(new URL('../../renderer/art-direction.workflow.js',import.meta.url),'utf8'),vm);
  const state={provider:'local',mode:'img2img',prompt:'Use @参考图1 content and @参考图2 style.',negativePrompt:'',width:1280,height:960,localDrawEngine:'qwen-2.1',samplingOverrides:{}};
  const references=['photo','style'].map((name,i)=>({name,dataUrl:`data:image/png;base64,${Buffer.from(name).toString('base64')}`,drawingRole:i?'style':'subject'}));
  const prompt='Use <image1> content and <image2> style.';
  const nativeExecution={kind:'qwen21-strata-native',version:'flash-native-v1',sourceOrder:[1,2],prompt,analysisBackend:'strata',resourcesReleased:true,generationReady:true,model:'flash-proof',modelIdentity:{id:'flash-proof',verification:'server-model-id'},providerPolicy:{schema:'nf.qwen21-native-provider.v1',cfg:3}};
  const compiled={references:references.map((ref,i)=>({...ref,sourceNumber:i+1,role:i?'style':'subject'})),promptSnapshot:{prompt,negativePrompt:''},nativeExecution,referencePolicy:{stylePriority:true}};
  return {api:sandbox.NovaFlowArtDirection,context:{state,references},state,references,compiled};
}

test('verified Agent writeback aligns panel and actual CFG while retaining exact negative and manual overrides',()=>{
  const {api,context,state,compiled}=drawing();
  const sampled=policy=>models.localSamplingFor(state,'img2img',state.negativePrompt,'qwen-2.1','drawing',policy);
  assert.equal(sampled(api.samplingOptions(context)).cfg,1);
  const runPolicy=api.generationOptions(compiled);assert.equal(sampled(runPolicy).cfg,3);
  assert.deepEqual(plain(api.registerAgentWriteback(context,compiled)),plain(runPolicy));
  assert.equal(sampled(api.samplingOptions(context)).cfg,3);
  assert.equal(state.negativePrompt,'');assert.deepEqual(plain(state.samplingOverrides),{});
  models.setLocalSamplingValue(state,'img2img','cfg','4',api.samplingOptions(context));
  assert.equal(sampled(api.samplingOptions(context)).cfg,4);
  state.localQwen21Variant='turbo';
  models.setLocalSamplingValue(state,'img2img','cfg','1',api.samplingOptions(context));
  assert.deepEqual([sampled(api.samplingOptions(context)).steps,sampled(api.samplingOptions(context)).cfg],[8,1]);
});

test('Agent registration rejects changed images, negative, text, role or unverified handoff',()=>{
  for(const change of [
    e=>{e.references[1].dataUrl+='changed';},e=>{e.state.negativePrompt='new exclusion';},
    e=>{e.state.prompt+=' changed';},e=>{e.references[1].drawingRole='subject';},
    e=>{e.compiled.nativeExecution.resourcesReleased=false;},e=>{e.compiled.nativeExecution.prompt+=' changed';}
  ]){
    const e=drawing();change(e);
    assert.throws(()=>e.api.registerAgentWriteback(e.context,e.compiled));
    assert.deepEqual(plain(e.api.samplingOptions(e.context)),{});
  }
});

test('later reference edits invalidate an Agent policy instead of carrying native guidance to unrelated work',()=>{
  const e=drawing();e.api.registerAgentWriteback(e.context,e.compiled);
  assert.equal(e.api.samplingOptions(e.context).qwen21NativeGuidance.cfg,3);
  e.references[1].dataUrl+='changed';
  assert.deepEqual(plain(e.api.samplingOptions(e.context)),{});
});
