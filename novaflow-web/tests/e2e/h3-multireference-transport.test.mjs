import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createContext,runInContext} from 'node:vm';
import {createWorkflowHost} from '../../worker/src/comfy/workflow-host.mjs';
import {withReferences,assertGraphLoadsTaskInputs} from '../../worker/src/worker-core.mjs';
import {createLocalTasks} from '../../worker/src/local-tasks.mjs';
import {workflowModelId} from '../../packages/shared/src/workflow-modules.mjs';
const renderer=new URL('../../renderer/',import.meta.url),ctx=createContext({console});ctx.globalThis=ctx;ctx.window=ctx;
for(const file of ['h3-prompt-format.js','ai-sequence-minimax-h3.resource.js','ai-sequence-minimax-h3-prompt.workflow.js','ai-sequence-minimax-h3.workflow.js'])runInContext(await readFile(new URL(file,renderer),'utf8'),ctx);
const resource=ctx.NovaFlowAiSequenceMiniMaxH3Resource,compiler=ctx.NovaFlowAiSequenceMiniMaxH3PromptWorkflow;
const bindings=Array.from(resource.multiReferenceSlots,(r,i)=>({key:r.key,sourceId:'stable-'+i,kind:r.kind,modelToken:r.modelToken,fileName:'original-'+i,uploadedName:'stage-'+i+'.'+({image:'png',video:'mp4',audio:'wav'}[r.kind]),occupied:true,type:r.kind+'/test'}));
const allPrompt=bindings.map(x=>x.modelToken).join(' ');
const namedPrompt=Array.from(resource.multiReferenceSlots,x=>'@'+x.label).join(' ');
assert.equal(resource.compileMentions(namedPrompt,bindings).text,allPrompt);
assert.equal(resource.compileMentions('[已删除素材:参考视频 1]',bindings).invalidTokens.length,1);
assert.equal(resource.compileMentions('@参考图9 @视频参考3 @声音参考3',bindings).text,'<Picture 9> <Video 3> <Audio 3>');
assert.throws(()=>compiler.assertExplicitReferences({mode:'multi_reference',prompt:allPrompt,resources:bindings},'<Picture 1>'),/遗漏/);
assert.equal(compiler.assertExplicitReferences({mode:'multi_reference',prompt:allPrompt,resources:bindings},allPrompt),true);
const host=await createWorkflowHost({rendererDir:process.env.NOVAFLOW_H3_PACKAGED_RENDERER || new URL('../../worker-renderer/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
const temp=await mkdtemp(join(tmpdir(),'novaflow-h3-transport-'));
try {
 let tasks=await createLocalTasks(temp);
 for(const profile of ['beta5_int8','beta6_int8']) {
  const options={profile,mode:'r2v',prompt:allPrompt,steps:profile==='beta6_int8'?8:4,width:256,height:256,durationSeconds:1,fps:24,seed:55,resourceBindings:bindings,
   referenceImages:bindings.filter(x=>x.kind==='image').map(x=>x.uploadedName),referenceVideos:bindings.filter(x=>x.kind==='video').map(x=>x.uploadedName),referenceAudios:bindings.filter(x=>x.kind==='audio').map(x=>x.uploadedName)};
  const references=bindings.map(x=>({name:x.uploadedName,kind:x.kind,bytes:100}));
  const task=await tasks.create({task_type:'renderer_workflow',workflow:{module:'NovaFlowAiSequenceMiniMaxH3Workflow',method:'buildWorkflow'},parameters:options,references},'test-only');
  const staged=references.map((x,i)=>'comfy-'+i+'-'+x.name);
  const parameters=withReferences(task.parameters,staged,references);
  const graph=await host.buildGraph({module:task.workflow.module,method:'buildWorkflow',options:parameters});
  assertGraphLoadsTaskInputs(graph,staged);
  assert.equal(Object.values(graph).filter(x=>['LoadImage','LoadVideo','LoadAudio'].includes(x.class_type)).length,15);
  const condition=Object.values(graph).find(x=>x.class_type==='MiniMaxH3ReferenceToVideo');
  assert.equal(condition._meta.h3_bindings.length,15);
  assert.equal(JSON.stringify(condition._meta.h3_bindings.map(x=>x.sourceId)),JSON.stringify(bindings.map(x=>x.sourceId)));
  assert.match(Object.values(graph).find(x=>x.class_type==='UNETLoader').inputs.unet_name,new RegExp(profile==='beta6_int8'?'beta6':'beta5'));
  assert.equal(workflowModelId(task.workflow.module,options),profile==='beta6_int8'?'minimax-h3-beta6':'minimax-h3');
  for(const mode of ['t2v','i2v','fl2v','r2v'])assert.doesNotThrow(()=>ctx.NovaFlowAiSequenceMiniMaxH3Workflow.getWorkflowJson({profile,mode}));
  console.log('PASS',profile,'15-file queue serialize/remap/private-worker graph, profile dispatch and all mode templates');
 }
 const before=tasks.list().map(x=>({id:x.id,parameters:x.parameters,references:x.references}));tasks=await createLocalTasks(temp);
 assert.equal(JSON.stringify(tasks.list().map(x=>({id:x.id,parameters:x.parameters,references:x.references}))),JSON.stringify(before));
 console.log('PASS persisted queue reload preserves all source identities and filenames; explicit-reference omission fails');
}finally{if(resolve(temp).startsWith(resolve(tmpdir())+'\\')||resolve(temp).startsWith(resolve(tmpdir())+'/'))await rm(temp,{recursive:true,force:true});}
