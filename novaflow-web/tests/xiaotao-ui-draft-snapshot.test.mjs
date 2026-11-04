import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const pipelineSource=await readFile(new URL('../renderer/ui-design-prompt.pipeline.js',import.meta.url),'utf8');
const drawingSource=(await readFile(new URL('../renderer/ui-design.drawing.js',import.meta.url),'utf8')).replace('root.NovaFlowUiDesignDrawing = Object.freeze','root.__testMount = value => { mounted = value }; root.__testSelectionBinding = selectionSourceBinding; root.NovaFlowUiDesignDrawing = Object.freeze');
const bytes=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
const dataUrl='data:image/png;base64,'+bytes.toString('base64');
function fixture({imageUrl=dataUrl,fetchImpl}={}) {
  const state={provider:'local',mode:'img2img',prompt:'UI layout',negativePrompt:'No logo',width:768,height:512};
  const refs=[{id:'layout',role:'combined',dataUrl:imageUrl},{id:'style',role:'style',dataUrl}];
  const project={nodes:[{id:'canvas',data:{blocks:[]}}]},selection={kind:'none'},route={revision:1};
  const listeners=new Set(),store={getState:()=>({project,settings:{}}),subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener)},emit(){for(const fn of listeners)fn()}};
  const window={NovaFlowArtGenerateModels:{capabilityFor:()=>({negativePrompt:true})},document:{body:{classList:{contains:()=>true}},querySelector:()=>({})},crypto:webcrypto,
    fetch:fetchImpl||(()=>Promise.resolve({ok:true,blob:async()=>new Blob([bytes],{type:'image/png'})})),
    FileReader:class {readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result='data:'+blob.type+';base64,'+Buffer.from(buffer).toString('base64');this.onload();},()=>this.onerror());}},
    __NovaFlowArtGenerate:{state,render(){},capturePrompt(){return {prompt:state.prompt,negativePrompt:state.negativePrompt};},captureContext(){return {state,references:refs,referenceLimit:10,generationSurface:'ui',routeRevision:route.revision};}}};
  const context=vm.createContext({window,TextEncoder,Uint8Array,console});
  vm.runInContext(pipelineSource,context);window.NovaFlowUiDesignPromptPipeline=context.NovaFlowUiDesignPromptPipeline;
  vm.runInContext(drawingSource,context);
  window.__testMount({store,editor:{getSelection:()=>selection},layoutContext:()=>({node:null,structure:{}}),getSelectionBinding:()=>window.__testSelectionBinding(selection,refs,state.prompt)});
  return {window,state,refs,project,selection,store,route};
}
const requestId='b2bc4bd0-42b0-4120-8e22-55306e1a3d82';
test('legacy UI input stays unchanged when the new snapshot option is absent',()=>{
  const f=fixture(),drawing=f.window.NovaFlowUiDesignDrawing,context={state:f.state,references:f.refs,referenceLimit:10,selection:{kind:'none'}};
  const legacy=drawing.inputFor(context),preview=drawing.inputFor(context,{includeOriginalReferences:true});
  assert.equal(Object.hasOwn(legacy,'originalReferences'),false);
  assert.equal(JSON.stringify(legacy.references),JSON.stringify(preview.references));
  assert.equal(legacy.prompt,preview.prompt);assert.equal(legacy.negativePrompt,preview.negativePrompt);
  assert.equal(preview.originalReferences[0].role,'combined');assert.equal(legacy.references[0].role,'layout');
});
test('draft snapshot copies blob and keeps original roles without writing references',async()=>{
  const f=fixture({imageUrl:'blob:local-fixture'}),before=JSON.stringify(f.refs);
  const result=await f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId,requirements:'Keep buttons'});
  assert.equal(JSON.stringify(f.refs),before);assert.equal(result.request.references[0].dataUrl,dataUrl);
  assert.equal(result.request.references[0].role,'combined');assert.equal(result.request.references[1].role,'style');
  assert.match(result.request.revision,/^[a-f0-9]{64}$/);assert.equal(result.isCurrent(),true);
  f.refs[0].role='layout';assert.equal(result.isCurrent(),false);
});
test('explicit conversation prompt changes only the requested draft, never the bound UI project',async()=>{
  const f=fixture(),before=JSON.stringify({state:f.state,refs:f.refs,project:f.project});
  const result=await f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId,sourcePrompt:'A conversation-supplied UI prompt',requirements:'Keep buttons'});
  assert.equal(result.request.prompt,'A conversation-supplied UI prompt');
  assert.equal(result.request.requirements,'Keep buttons');
  assert.equal(result.request.references[0].role,'combined');assert.equal(result.request.references[1].role,'style');
  assert.equal(JSON.stringify({state:f.state,refs:f.refs,project:f.project}),before);
  assert.equal(result.isCurrent(),true);f.state.prompt='changed on page';assert.equal(result.isCurrent(),false);
  await assert.rejects(()=>f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId,sourcePrompt:''}));
  await assert.rejects(()=>f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId,sourcePrompt:'a'.repeat(6001)}));
});
test('changing project while blob is read rejects before any draft is returned',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});
  const f=fixture({imageUrl:'blob:local-fixture',fetchImpl:async()=>{await wait;return {ok:true,blob:async()=>new Blob([bytes],{type:'image/png'})};}});
  const pending=f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId});f.project.nodes[0].id='changed';release();
  await assert.rejects(pending,/UI/);assert.equal(f.refs[0].dataUrl,'blob:local-fixture');
});
test('cancelling while materializing a reference rejects and leaves source unchanged',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});
  const f=fixture({imageUrl:'blob:local-fixture',fetchImpl:async()=>{await wait;return {ok:true,blob:async()=>new Blob([bytes],{type:'image/png'})};}});
  const abort=new AbortController(),before=JSON.stringify(f.refs);
  const pending=f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId,signal:abort.signal});
  abort.abort();release();await assert.rejects(pending,/UI/);
  assert.equal(JSON.stringify(f.refs),before);
});
test('role conflicts fail preflight without changing the reference or project',()=>{
  const f=fixture(),before=JSON.stringify({refs:f.refs,project:f.project});
  assert.throws(()=>f.window.NovaFlowUiDesignDrawing.preflightSelectedIntent({references:f.refs},{prompt:'参考图2作为布局'}),/冲突/);
  assert.equal(JSON.stringify({refs:f.refs,project:f.project}),before);
  assert.equal(f.window.NovaFlowUiDesignDrawing.preflightSelectedIntent({references:f.refs},{prompt:'参考图2作为风格'}),true);
});
test('selected region checks original blob binding while passing a copied image onward',async()=>{
  const f=fixture({imageUrl:'blob:local-fixture'});f.state.prompt='only edit selected';
  Object.assign(f.selection,{kind:'block',blockId:'b',block:{id:'b',x:0,y:0,width:100,height:100},node:{id:'canvas',data:{canvasSize:{width:768,height:512}}}});
  const result=await f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId});
  assert.equal(result.request.references[0].dataUrl,dataUrl);assert.equal(f.refs[0].dataUrl,'blob:local-fixture');
  assert.equal(result.isCurrent(),true);f.selection.block.x=10;assert.equal(result.isCurrent(),false);
});
test('rejects excess references and non-local URLs instead of dropping or fetching them',async()=>{
  const f=fixture();f.refs.push({id:'3',role:'asset',dataUrl},{id:'4',role:'content',dataUrl});
  await assert.rejects(()=>f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId}));
  const remote=fixture({imageUrl:'https://example.invalid/secret.png'});await assert.rejects(()=>remote.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId}));
});

test('identical project replacement or leave-and-return route invalidates draft',async()=>{
  const f=fixture();const draft=await f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId});
  assert.equal(draft.isCurrent(),true);f.store.emit();assert.equal(draft.isCurrent(),false);
  const second=await f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId});
  assert.equal(second.isCurrent(),true);f.route.revision+=2;assert.equal(second.isCurrent(),false);
});
test('prompt source guard is captured before selection and invalidates on route or same-content project switch',()=>{for(const change of ['project','route']){const f=fixture();const guard=f.window.NovaFlowUiDesignDrawing.capturePromptSourceGuard();assert.equal(guard.isCurrent(),true);if(change==='project')f.store.emit();else f.route.revision+=2;assert.equal(guard.isCurrent(),false)}});

test('text-only UI draft uses the chosen current-turn source without inventing a reference',async()=>{
  const f=fixture();f.refs.splice(0);f.state.prompt='';
  const draft=await f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId,sourcePrompt:'minimal music player',requirements:'keep accessible buttons'});
  assert.equal(draft.request.prompt,'minimal music player');assert.equal(draft.request.requirements,'keep accessible buttons');
  assert.equal(draft.request.references.length,0);assert.equal(f.state.prompt,'');assert.equal(draft.isCurrent(),true);
});
test('confirmed UI draft applies both prompt fields and undoes them together',async()=>{
  const f=fixture(),before=JSON.stringify(f.refs);const draft=await f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId});
  await assert.rejects(()=>draft.applyDraft({prompt:'new UI',negativePrompt:'no clutter'},{userConfirmed:false,bindingCurrent:()=>true}));
  assert.equal(f.state.prompt,'UI layout');assert.equal(f.state.negativePrompt,'No logo');
  assert.equal((await draft.applyDraft({prompt:'new UI',negativePrompt:'no clutter'},{userConfirmed:true,bindingCurrent:()=>true})).phase,'applied');
  assert.equal(f.state.prompt,'new UI');assert.equal(f.state.negativePrompt,'no clutter');assert.equal(draft.isCurrent(),true);assert.equal(JSON.stringify(f.refs),before);
  assert.equal((await draft.undoDraft({userConfirmed:true,bindingCurrent:()=>true})).phase,'undone');
  assert.equal(f.state.prompt,'UI layout');assert.equal(f.state.negativePrompt,'No logo');assert.equal(JSON.stringify(f.refs),before);
  await assert.rejects(()=>draft.undoDraft({userConfirmed:true,bindingCurrent:()=>true}));
});
test('UI draft cannot overwrite a later edit, changed project or unconfirmed session',async()=>{
  for(const change of ['prompt','negative','project','route','session','running']){
    const f=fixture(),draft=await f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId});
    await draft.applyDraft({prompt:'new UI',negativePrompt:'no clutter'},{userConfirmed:true,bindingCurrent:()=>true});
    if(change==='prompt')f.state.prompt='user edit';if(change==='negative')f.state.negativePrompt='user negative';
    if(change==='project')f.store.emit();if(change==='route')f.route.revision++;if(change==='running')f.state.running=true;
    await assert.rejects(()=>draft.undoDraft({userConfirmed:true,bindingCurrent:()=>change!=='session'}));
    assert.equal(f.state.prompt,change==='prompt'?'user edit':'new UI');
  }
});
test('failed UI render rolls back our prompt and negative write without touching references',async()=>{
  const f=fixture(),before=JSON.stringify({state:f.state,refs:f.refs});
  const draft=await f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId});
  f.window.__NovaFlowArtGenerate.render=()=>{throw new Error('synthetic-render-failed')};
  await assert.rejects(()=>draft.applyDraft({prompt:'new UI',negativePrompt:'new negative'},{userConfirmed:true,bindingCurrent:()=>true}));
  assert.equal(JSON.stringify({state:f.state,refs:f.refs}),before);
});
test('UI refuses hidden unsupported negative constraints but permits an empty one',async()=>{
  const f=fixture();f.state.negativePrompt='';f.window.NovaFlowArtGenerateModels.capabilityFor=()=>({negativePrompt:false});
  const draft=await f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId});
  await assert.rejects(()=>draft.applyDraft({prompt:'new UI',negativePrompt:'no clutter'},{userConfirmed:true,bindingCurrent:()=>true}),/不支持负面/);
  assert.equal(f.state.prompt,'UI layout');assert.equal(f.state.negativePrompt,'');
  assert.equal((await draft.applyDraft({prompt:'new UI',negativePrompt:''},{userConfirmed:true,bindingCurrent:()=>true})).phase,'applied');
  assert.equal((await draft.undoDraft({userConfirmed:true,bindingCurrent:()=>true})).phase,'undone');
});
test('UI never discards a pre-existing negative constraint',async()=>{
  const f=fixture(),draft=await f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId});
  await assert.rejects(()=>draft.applyDraft({prompt:'new UI',negativePrompt:''},{userConfirmed:true,bindingCurrent:()=>true}),/缺少原有负面/);
  assert.equal(f.state.prompt,'UI layout');assert.equal(f.state.negativePrompt,'No logo');
});
test('dialogue references remain separate until confirmation and undo restores page refs and both prompts',async()=>{
  const f=fixture(),before=JSON.stringify({state:f.state,refs:f.refs});
  const chosen=Object.freeze([Object.freeze({id:'chat-layout',role:'layout',dataUrl})]);let phase='ready';
  const tx=Object.freeze({requestReferences:chosen,apply({prompt,negativePrompt}){assert.equal(phase,'ready');phase='applied';f.refs.splice(0,f.refs.length,...chosen);f.state.prompt=prompt;f.state.negativePrompt=negativePrompt;},undo(){assert.equal(phase,'applied');phase='closed';const old=JSON.parse(before);f.refs.splice(0,f.refs.length,...old.refs);f.state.prompt=old.state.prompt;f.state.negativePrompt=old.state.negativePrompt;},isCurrent(){return phase==='applied'&&f.refs.length===1&&f.refs[0]===chosen[0]&&f.state.prompt==='new UI'&&f.state.negativePrompt==='new negative'},cancel(){if(phase!=='ready')return false;phase='closed';return true}});
  const snapshot=await f.window.NovaFlowUiDesignDrawing.captureUiDraftSnapshot({requestId,sourcePrompt:'conversation',referenceTransaction:tx});
  assert.equal(snapshot.request.references.length,1);assert.equal(snapshot.request.references[0].id,'chat-layout');assert.equal(JSON.stringify({state:f.state,refs:f.refs}),before);
  assert.equal((await snapshot.applyDraft({prompt:'new UI',negativePrompt:'new negative'},{userConfirmed:true,bindingCurrent:()=>true})).phase,'applied');
  assert.equal(f.refs[0].id,'chat-layout');assert.equal(snapshot.isCurrent(),true);
  assert.equal((await snapshot.undoDraft({userConfirmed:true,bindingCurrent:()=>true})).phase,'undone');assert.equal(JSON.stringify({state:f.state,refs:f.refs}),before);
});
