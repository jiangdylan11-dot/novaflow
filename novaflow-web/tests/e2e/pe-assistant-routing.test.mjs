import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPromptAssistant} from '../../worker/src/prompt-assistant.mjs';
import {ART_EDIT_MODEL} from '../../worker/src/art-edit-planner.mjs';
import {workflowModelId} from '../../packages/shared/src/workflow-modules.mjs';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
const modelContext=createContext({});runInContext(readFileSync(new URL('../../renderer/art-generate-model.resource.js',import.meta.url),'utf8'),modelContext);
const models=modelContext.NovaFlowArtGenerateModels;
test('ordinary drawing defaults to 25, preserves explicit 40, and keeps UI and Turbo baselines',()=>{
 const state={provider:'local',localDrawEngine:'qwen-2.1'};
 assert.equal(models.localSamplingFor(state,'img2img','','qwen-2.1').steps,25);
 assert.equal(models.localSamplingFor(state,'txt2img','','qwen-2.1').steps,25);
 assert.equal(models.localSamplingFor(state,'img2img','','qwen-2.1','ui').steps,40);
 state.samplingOverrides={'qwen-2.1:img2img':{steps:40}};
 assert.equal(models.localSamplingFor(state,'img2img','','qwen-2.1').steps,40);
 state.localQwen21Variant='turbo';
 assert.equal(models.localSamplingFor(state,'img2img','','qwen-2.1').steps,8);
});
test('production assistant is available from PE alone and reports no NF4 cache dependency',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nf-single-pe-'));let assistant;
 try{
  const modelPath=join(root,'models','text_encoders',ART_EDIT_MODEL);await mkdir(join(root,'models','text_encoders'),{recursive:true});await writeFile(modelPath,'fixture');
  const runtimeJsonPath=join(root,'runtime.json');await writeFile(runtimeJsonPath,JSON.stringify({installPath:root,modelsPath:join(root,'models')}));
  assistant=createPromptAssistant({analysisBackend:'pe',runtimeJsonPath,pythonPath:process.execPath,serviceScript:fileURLToPath(new URL('../fixtures/prompt-assistant-fake-service.mjs',import.meta.url)),comfyUrls:[]});
  const status=assistant.status();assert.equal(status.modelType,'qwen35_pe_i2i');assert.equal(status.enabled,true);assert.equal(status.cachePath,'');assert.equal(status.cacheReady,false);
  const result=await assistant.optimizePrompt({prompt:'a cat'});assert.equal(result.ok,true);assert.equal(result.data.echo.modelPath,modelPath);assert.equal(result.data.echo.cachePath,'');
  await assert.rejects(access(join(root,'models','prompt_assistant')));
 }finally{await assistant?.stop();await rm(root,{recursive:true,force:true});}
});
test('Turbo selection has isolated sampling settings and does not inherit ordinary 40-step guidance',()=>{
 const state={provider:'local',localQwen21Variant:'turbo',samplingOverrides:{'qwen-2.1:img2img':{steps:40,cfg:3}}};
 const sampling=models.localSamplingFor(state,'img2img','avoid donor','qwen-2.1');
 assert.equal(sampling.route,'qwen-2.1-turbo');assert.equal(sampling.steps,8);assert.equal(sampling.cfg,1);
 assert.notEqual(models.renderKey(state),models.renderKey({...state,localQwen21Variant:'standard'}));
 state.localQwen21Variant='standard';assert.equal(models.localSamplingFor(state,'img2img').cfg,3);
});
test('pool queues Turbo drawing and explicit editing tools for the Turbo checkpoint',()=>{
 const args=['local','img2img',[],null,null,null,null,null,{localDrawEngine:'qwen-2.1',localQwen21Variant:'turbo'},10,{}];
 assert.equal(workflowModelId('novaflow-brand-runtime',{__args:args}),'qwen-image-2.1-turbo');
 args[10]={taskProfile:'ui-design'};args[8].localUiEngine='qwen-2.1';assert.equal(workflowModelId('novaflow-brand-runtime',{__args:args}),'qwen-image-2.1');
 assert.equal(workflowModelId('spine-split-runtime',{},'buildImageAngleAdjustWorkflow'),'qwen-image-2.1-turbo');
 assert.equal(workflowModelId('spine-split-runtime',{},'defaultRmbgWorkflow'),'qwen-image-2511');
});

test('model choices contain only providers and leave acceleration under the parameter switch',()=>{
 class Element{
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attributes={};this.events={};this.style={setProperty(){}};}
  replaceChildren(...children){this.children=children;} appendChild(child){this.children.push(child);child.parentElement=this;return child;}
  setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}removeAttribute(k){delete this.attributes[k];}
  addEventListener(k,fn){this.events[k]=fn;}remove(){}closest(){return null;}
 }
 const doc={getElementById:()=>null};doc.createElement=tag=>new Element(tag,doc);doc.head=doc.createElement('head');
 const c=createContext({document:doc});runInContext(readFileSync(new URL('../../renderer/art-generate-mode.tool.js',import.meta.url),'utf8'),c);
 const host=doc.createElement('div'),state={provider:'local'};let changes=0;
 const refresh=()=>c.NovaFlowArtGenerateModeTool.syncControlPanel({host,state,showAccount:false,showTurboRoute:true,onChange:()=>changes++});
 refresh();const select=host.children[0].children[1];assert.deepEqual(Array.from(select.children,x=>x.value),['local','gpt']);
 state.localQwen21Variant='turbo';refresh();assert.equal(select.value,'local');
 select.value='gpt';select.events.change();assert.equal(state.provider,'gpt');assert.equal(state.localQwen21Variant,'turbo');assert.equal(changes,1);
 select.value='local';select.events.change();assert.equal(state.provider,'local');assert.equal(state.localQwen21Variant,'turbo');
 c.NovaFlowArtGenerateModeTool.syncControlPanel({host,state,showAccount:false,showTurboRoute:false});
 assert.ok(select.children.every(x=>x.value!=='local-turbo'),'UI gets ordinary BF16 only');
});

test('the local acceleration control follows NSFW and is absent from cloud parameter fields',()=>{
 const c=createContext({NovaFlowArtGenerateModels:models});runInContext(readFileSync(new URL('../../renderer/art-generate-mode.tool.js',import.meta.url),'utf8'),c);
 const nsfw={id:'nsfw'},fast={id:'fast'};
 const fields=c.NovaFlowArtGenerateModeTool.renderParameterFields({state:{provider:'local'},createElement:()=>({}),nsfwSwitch:nsfw,accelerationSwitch:fast,renderNumber:()=>({}),renderSeedToggle:()=>({})});
 assert.equal(fields.at(-1),fast);assert.equal(fields.at(-2),nsfw);
 const cloud=c.NovaFlowArtGenerateModeTool.renderParameterFields({state:{provider:'gpt'},createElement:()=>({}),accelerationSwitch:fast});
 assert.equal(cloud.includes(fast),false);
});
