import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {FOART_TOOL_SCHEMA,validateFoartPlan} from '../../packages/shared/src/foart-tool-plan.mjs';

const source=readFileSync(new URL('../../renderer/spine-split-runtime.js',import.meta.url),'utf8');

test('native selected-layer export retains exact encoded bytes in a recoverable assistant download without downloading twice',async()=>{
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10]),blob=new Blob([bytes],{type:'image/png'});let clicks=0,format;
 const root={state:{source:{fileName:'source.png'}},getUiLayerExport:async value=>{format=value;return {name:'矩形内部.png',dataUrl:'native-encoded-layer'};},dataUrlToBlob:async()=>blob,document:{createElement:()=>({click:()=>clicks++,remove(){}}),body:{appendChild(){}}},URL:{createObjectURL:()=> 'blob:actual-layer',revokeObjectURL(){}},window:{setTimeout(){}},setMessage(){},render(){},syncSplitWorkspace(){}};
 vm.createContext(root);vm.runInContext(source.slice(source.indexOf('  async function exportForAgent('),source.indexOf('  async function exportPsd()')),root);
 const result=await root.exportForAgent('layer',async file=>{assert.equal(file.name,'矩形内部.png');assert.equal(file.blob,blob);assert.deepEqual(new Uint8Array(await file.blob.arrayBuffer()),bytes);return {downloadId:'actual-download',downloadInitiated:true};});
 assert.equal(format,'layer');assert.equal(result.fileName,'矩形内部.png');assert.equal(result.downloadId,'actual-download');assert.equal(result.bytes,bytes.length);assert.equal(result.saved,false);assert.equal(clicks,0);
 await root.exportForAgent('layer');assert.equal(clicks,1,'The original direct export remains available');
});
function fixture(){
  const state={source:{dataUrl:'unchanged-source'},splitSets:[],selectedPartIds:[],viewMode:'parts',parts:[{id:'inside',name:'pen_cutout',dataUrl:'inside-pixels'},{id:'outside',name:'选区外',dataUrl:'outside-pixels'}]};
  let persisted=0,editing=false;
  const root={state,window:{},isSplitEditToolActive:()=>editing,isUiLayerMode:()=>false,syncActiveSplitSet:()=>persisted++,patchRightWorkspaceRenameRow:()=>false,render(){},syncSplitWorkspace(){},isMaskStencilActive:()=>false,markSplitPreviewStale(){},activeSplitSet:()=>null,normalizeSelection(){},isMountedCardVisible:()=>false,scheduleSplitPreviewRefresh(){}};
  Object.assign(root,{splitSetById:()=>null,emitUiLayerState(){},patchRightWorkspaceSelectionSignature:()=>false,updatePreviewOverlay(){}});
  vm.createContext(root);
  vm.runInContext(source.slice(source.indexOf('  function commitRenamePart('),source.indexOf('  const SPLIT_SET_SOURCE_ORIGIN'))+source.slice(source.indexOf('  function togglePartVisibility('),source.indexOf('  function selectedParts(')),root);
  vm.runInContext(source.slice(source.indexOf('  function setLayerSelection('),source.indexOf('  function layerRenameInputId(')),root);
  const start=source.indexOf('    agentSelectLayers('),end=source.indexOf('    async agentAction(',start);
  vm.runInContext('globalThis.bridge={'+source.slice(start,end)+'};',root);
  return {root,state,get persisted(){return persisted;},edit:()=>editing=true};
}

test('native layer rename and explicit visibility preserve source, other layer and pixels',()=>{
  const f=fixture(),sourceRef=f.state.source,outside=f.state.parts[1];
  const result=f.root.bridge.agentLayerAction({operation:'rename',layerId:'inside',name:'  矩形  验收  '});
  assert.equal(result.name,'矩形 验收');assert.equal(result.phase,'applied');assert.equal(f.state.source,sourceRef);assert.equal(f.state.parts[0].dataUrl,'inside-pixels');assert.equal(f.state.parts[1],outside);assert.equal(f.persisted,1);
  f.root.bridge.agentLayerAction({operation:'visibility',layerId:'inside',visible:false});
  assert.equal(f.state.parts[0].visible,false);assert.equal(f.persisted,2);
  f.root.bridge.agentLayerAction({operation:'visibility',layerId:'inside',visible:false});assert.equal(f.persisted,2);
  f.state.parts[0].locked=true;assert.throws(()=>f.root.bridge.agentLayerAction({operation:'rename',layerId:'inside',name:'禁止'}),/锁定/);
  f.edit();assert.throws(()=>f.root.bridge.agentLayerAction({operation:'visibility',layerId:'outside',visible:false}),/当前操作/);
});

test('native multi-layer selection preserves pixels and rejects a stale set before selecting anything',()=>{
 const f=fixture(),pixels=f.state.parts.map(p=>p.dataUrl),sourceRef=f.state.source;
 f.root.bridge.agentSelectLayers(['outside','inside']);assert.deepEqual(Array.from(f.state.selectedPartIds),['outside','inside']);assert.equal(f.state.activePartId,'inside');assert.equal(f.state.source,sourceRef);assert.deepEqual(f.state.parts.map(p=>p.dataUrl),pixels);
 assert.throws(()=>f.root.bridge.agentSelectLayers(['inside','unknown']),/选择无效/);assert.deepEqual(Array.from(f.state.selectedPartIds),['outside','inside']);
 f.root.bridge.agentSelectLayers(['inside']);assert.deepEqual(Array.from(f.state.selectedPartIds),['inside']);
});

test('layer operations validate live identity, locked state and operation-specific parameters',()=>{
  const context={schema:FOART_TOOL_SCHEMA,controls:[],artEditor:{layers:[{id:'inside',name:'pen_cutout'}]}};
  const op={action:'art_layer',operation:'rename',layerId:'inside',name:'矩形验收'};
  const plan=op=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'修改实际图层名称',operations:[op]});
  assert.doesNotThrow(()=>validateFoartPlan(plan(op),context));
  for(const patch of [{layerId:'invented'},{name:''},{name:'长'.repeat(101)},{operation:'delete'},{visible:true}])assert.throws(()=>validateFoartPlan(plan({...op,...patch}),context));
  context.artEditor.layers[0].locked=true;assert.throws(()=>validateFoartPlan(plan(op),context));
});

test('opening a mask cannot claim a completed edit, and layer edits/export wait for native apply',async()=>{
 const state={source:{dataUrl:'source'},parts:[],maskEditor:{active:false}},root={state,window:{},getSourceResources:()=>[],runSplitControlAction:async()=>{if(state.maskEditor.active){state.maskEditor.active=false;state.parts[0].dataUrl='applied-mask'}else{state.parts.push({id:'base',dataUrl:'source'});state.maskEditor.active=true}}};
 vm.createContext(root);const start=source.indexOf('    async agentAction('),end=source.indexOf('    supportsSilentSourceResourceRegistration:',start);vm.runInContext('globalThis.bridge={'+source.slice(start,end)+'};',root);
 const opened=await root.bridge.agentAction('mask');assert.equal(opened.layersChanged,true);assert.equal(opened.phase,'opened');const applied=await root.bridge.agentAction('mask');assert.equal(applied.phase,'completed');assert.equal(state.parts[0].dataUrl,'applied-mask');
 const context={schema:FOART_TOOL_SCHEMA,controls:[],artEditor:{editingTool:'mask',layers:[{id:'base'}]}};
 const plan=op=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'按实际状态执行',operations:[op]});
 for(const op of [{action:'art_layer',operation:'rename',layerId:'base',name:'新名称'},{action:'art_layer',operation:'select',layerIds:['base']},{action:'art_action',name:'export',format:'layer'}])assert.throws(()=>validateFoartPlan(plan(op),context),/先应用或退出/);
 assert.doesNotThrow(()=>validateFoartPlan(plan({action:'art_action',name:'mask'}),context));
});
