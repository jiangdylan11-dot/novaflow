const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname,'../../renderer/ui-design-layers.js'),'utf8');
function setup(bridge) {
  const calls = [];
  const doc = {createElement(tag) {
    assert.equal(tag,'canvas','Compatibility must not build an independent editor');
    const canvas = {width:0,height:0,toDataURL:()=> 'data:image/png;base64,' + Buffer.from(JSON.stringify(calls)).toString('base64')};
    canvas.getContext=()=>({clearRect(){},save(){},restore(){},drawImage(){calls.push('image')},fillText(...args){calls.push(args)},globalAlpha:1});
    return canvas;
  }};
  const root = {console,AbortController,NovaFlowSpineSplitBridge:bridge,Image:class {set src(value){this.onload()}}};
  root.window=root; vm.createContext(root);vm.runInContext(source,root);
  return {api:root.NovaFlowUiDesignLayers,doc,calls};
}
const project = () => ({version:1,width:300,height:200,layers:[{id:'a',type:'text',name:'标题',text:'NovaFlow',fontSize:25,fontWeight:'bold',textAlign:'center',color:'#ffcc00',x:10,y:20,width:100,height:40,visible:false,locked:true,opacity:.5}]});
test('legacy conversion retains exact original data and text attributes while using native image layers',async()=>{
  const {api,doc,calls}=setup(), input=project(), before=JSON.stringify(input),p=await api.prepareProject(input,doc);
  assert.equal(JSON.stringify(input),before);assert.equal(JSON.stringify(p.originalProject),before);
  assert.equal(p.parts.length,1);assert.equal(p.parts[0].id,'a');assert.equal(p.parts[0].visible,false);assert.equal(p.parts[0].locked,true);
  assert.equal(p.parts[0].metadata.legacyUiLayer.text,'NovaFlow');assert.equal(p.parts[0].metadata.legacyUiLayer.fontWeight,'bold');
  assert.equal(p.parts[0].metadata.legacyUiLayer.opacity,.5);assert.ok(calls.some(call=>call[0]==='NovaFlow'));
  const reopened=api.projectFromParts(p.originalProject,p.parts);
  for(const key of ['id','type','text','fontSize','fontWeight','textAlign','color','x','y','width','height','opacity','visible','locked']) assert.equal(reopened.layers[0][key],input.layers[0][key],key);
});
test('native replacement preserves old text provenance and updates only the selected layer',async()=>{
  const {api,doc}=setup(),input=project();input.layers.push({...input.layers[0],id:'b',text:'unchanged'});
  const p=await api.prepareProject(input,doc);p.parts[0].dataUrl='data:image/png;base64,replacement';p.parts[0].x=99;
  const next=api.projectFromParts(input,p.parts);
  assert.equal(next.layers[0].type,'image');assert.equal(next.layers[0].dataUrl,p.parts[0].dataUrl);assert.equal(next.layers[0].provenance.legacySource.text,'NovaFlow');assert.equal(next.layers[0].x,99);
  assert.equal(next.layers[1].type,'text');assert.equal(next.layers[1].text,'unchanged');assert.equal(next.layers[1].x,10);
});
test('invalid project fails before rendering and leaves supplied data intact',async()=>{
  const {api,doc,calls}=setup(),input=project();input.width=9000;const before=JSON.stringify(input);
  await assert.rejects(api.prepareProject(input,doc));assert.equal(JSON.stringify(input),before);assert.equal(calls.length,0);
});
test('headless migration preserves recovery copy, imports once, and persists native edits without an overlay',async()=>{
  let listener,imports=0, storeListener, state={project:{uiLayers:project()}};
  const bridge={subscribeUiLayerProjects(fn){listener=fn;return()=>{listener=null}},async importUiLayerProject(value,options){imports++;assert.equal(options.activateIfEmpty,true);assert.equal(value.layers[0].text,'NovaFlow')}};
  const {api}=setup(bridge),guardDoc={createElement(){throw new Error('Unexpected editor DOM')}};
  const store={getState:()=>state,patchProject(p){state={project:{...state.project,...p}};storeListener?.()},subscribe(fn){storeListener=fn;return()=>{storeListener=null}}};
  const mounted=api.mount({leftHost:{ownerDocument:guardDoc},store});await mounted.pending;await mounted.sync();
  assert.equal(imports,1);assert.equal(state.project.uiLayersOriginal.layers[0].text,'NovaFlow');
  const edited=project();edited.layers[0].name='native rename';listener({project:edited});await mounted.sync();assert.equal(imports,1);assert.equal(state.project.uiLayers.layers[0].name,'native rename');
  listener({project:{...edited,layers:[]}});await mounted.sync();assert.equal(state.project.uiLayers.layers.length,0);assert.equal(imports,1);
  mounted.destroy();assert.equal(listener,null);assert.equal(storeListener,null);
});
test('a busy native operation reports migration failure while preserving original project',async()=>{
  let reported='';const {api}=setup({subscribeUiLayerProjects(){return()=>{}},async importUiLayerProject(){throw Error('busy')},reportUiLayerProjectError(e){reported=e}});
  const original=project(),state={project:{uiLayers:original}},store={getState:()=>state,patchProject(p){Object.assign(state.project,p)},subscribe(){return()=>{}}};
  const mounted=api.mount({leftHost:{ownerDocument:{}},store});await mounted.pending;
  assert.equal(reported,'busy');assert.equal(JSON.stringify(state.project.uiLayers),JSON.stringify(original));assert.equal(JSON.stringify(state.project.uiLayersOriginal),JSON.stringify(original));mounted.destroy();
});

function nativeEnvironment({busy=false,sourcePresent=false,prepare}={}) {
  const nativeSource=fs.readFileSync(path.resolve(__dirname,'../../renderer/spine-split-runtime.js'),'utf8');
  const block=nativeSource.slice(nativeSource.indexOf('  const uiLayerProjectListeners = new Set()'),nativeSource.indexOf('  function syncActiveSplitSet()'));
  assert.ok(block.includes('async function createUiLayerProject'));
  let appends=0,activations=0;
  const state={busy,source:sourcePresent?{id:'existing'}:null,splitSets:[],activeSplitSetId:''};
  const api={projectFromParts:(p,parts)=>({...p,layers:parts.map(part=>({...part.metadata.legacyUiLayer,normalized:true}))}),prepareProject:prepare|| (async value=>{if(value.width>8192)throw Error('invalid');return {parts:value.layers.map(l=>({id:l.id,metadata:{legacyUiLayer:l}})),previewDataUrl:'data:image/png;base64,preview',originalProject:value}})};
  const sandbox={state,window:{NovaFlowUiDesignLayers:api},document:{body:{classList:{contains:()=>true}},querySelector:()=>({})},isSplitEditToolActive:()=>false,normalizeSpineLayerOrder:p=>p,normalizeLayerRecord:p=>p,async addSourceDataUrlResource(){appends++;return {id:'r'+appends,fileName:'project.png'}},activateSplitSet(id){activations++;state.activeSplitSetId=id;state.source={id};state.parts=state.splitSets.find(s=>s.id===id).parts},render(){},updateRightPanel(){},syncSplitWorkspace(){},setMessage(){}};
  vm.createContext(sandbox);vm.runInContext(block+'\nthis.importProject=importUiLayerProject;this.subscribe=subscribeUiLayerProjects;',sandbox);
  return {sandbox,state,get appends(){return appends},get activations(){return activations}};
}
test('reopening the same old project after normalization reuses its existing native group',async()=>{
  const e=nativeEnvironment(),input=project();let events=0;e.sandbox.subscribe(()=>events++);
  const first=await e.sandbox.importProject(input,{activate:true}),second=await e.sandbox.importProject(input,{activate:true});
  assert.equal(first.setId,second.setId);assert.equal(e.appends,1);assert.equal(e.state.splitSets.length,1);assert.equal(events,1);
});
test('overlapping drop and recovery imports coalesce into one native group',async()=>{
  let release;const waiting=new Promise(resolve=>{release=resolve});const input=project();
  const e=nativeEnvironment({prepare:async value=>{await waiting;return {parts:[{id:'a',metadata:{legacyUiLayer:value.layers[0]}}],previewDataUrl:'data:image/png;base64,p',originalProject:value}}});
  const a=e.sandbox.importProject(input,{activate:true}),b=e.sandbox.importProject(input,{activate:true});release();const [one,two]=await Promise.all([a,b]);
  assert.equal(one.setId,two.setId);assert.equal(e.appends,1);
});
test('automatic recovery adds right-side layers while preserving an existing active canvas',async()=>{
  const e=nativeEnvironment({sourcePresent:true}),before=e.state.source;
  await e.sandbox.importProject(project(),{activateIfEmpty:true});assert.equal(e.state.source,before);assert.equal(e.activations,0);assert.equal(e.state.splitSets.length,1);
});
test('a native operation starting during legacy raster preparation prevents mutation',async()=>{
  let e; e=nativeEnvironment({prepare:async value=>{e.state.busy=true;return {parts:[{id:'a'}],previewDataUrl:'data:image/png;base64,p',originalProject:value}}});
  await assert.rejects(e.sandbox.importProject(project()));assert.equal(e.appends,0);assert.equal(e.state.splitSets.length,0);
});


test('fractional geometry survives integer raster conversion and native rename without rounding',async()=>{
  const {api,doc}=setup(),input=project();Object.assign(input.layers[0],{x:457.9230769230769,y:20.25,width:76.15384615384616,height:40.1});
  const prepared=await api.prepareProject(input,doc);prepared.parts[0].name='renamed';
  const next=api.projectFromParts(input,prepared.parts);
  for(const key of ['x','y','width','height'])assert.equal(next.layers[0][key],input.layers[0][key],key);
  assert.equal(next.layers[0].name,'renamed');prepared.parts[0].x+=2;
  assert.equal(api.projectFromParts(input,prepared.parts).layers[0].x,input.layers[0].x+2);
});
