const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const renderer=path.resolve(__dirname,'../../renderer');
const adapterSource=fs.readFileSync(path.join(renderer,'ui-design-layers.js'),'utf8'),nativeSource=fs.readFileSync(path.join(renderer,'spine-split-runtime.js'),'utf8');
function environment(generate) {
 const drawOps=[],doc={createElement(tag){assert.equal(tag,'canvas');const c={width:1,height:1};c.getContext=()=>({save(){},restore(){},fillText(...a){drawOps.push(['text',...a])},drawImage(im,...a){drawOps.push(['image',im.src,...a])}});c.toDataURL=()=> 'data:image/png;base64,'+Buffer.from(JSON.stringify({w:c.width,h:c.height,ops:drawOps.splice(0)})).toString('base64');return c},body:{classList:{contains:()=>true}},querySelector:()=>({})};
 const root={console,document:doc,Image:class{set src(v){this._src=v;queueMicrotask(()=>this.onload())}get src(){return this._src}},AbortController,queueMicrotask};root.window=root;vm.createContext(root);vm.runInContext(adapterSource,root);
 root.NovaFlowUiDesignLayers={...root.NovaFlowUiDesignLayers,localGenerate:generate|| (async()=>({dataUrl:'data:image/png;base64,result'}))};
 const layer={id:'t',type:'text',name:'标题',text:'before',x:8,y:9,width:120,height:60,fontSize:24,fontWeight:'bold',fontFamily:'Arial',textAlign:'left',color:'#ffffff',visible:true,locked:false,opacity:1};
 const other={id:'i',type:'image',name:'资产',x:160,y:20,width:80,height:90,dataUrl:'data:image/png;base64,original',prompt:'one asset',visible:true,locked:false,opacity:1};
 const project={version:1,width:640,height:480,layers:[layer,other]},part=l=>({...l,layer:l.id==='t'?0:1,manualLayer:true,metadata:{legacyUiLayer:{...l},legacyRenderedDataUrl:l.dataUrl||'data:image/png;base64,text',legacyNativeBounds:{x:l.x,y:l.y,width:l.width,height:l.height}},dataUrl:l.dataUrl||'data:image/png;base64,text'});
 const set={id:'set',sourceResourceId:'source',name:'project',uiLayerProject:project,originalUiLayerProject:JSON.parse(JSON.stringify(project)),parts:[part(layer),part(other)]};
 Object.assign(root,{state:{parts:set.parts,source:{dataUrl:'data:image/png;base64,source',fileName:'source.png'},sourceSize:{width:640,height:480},activeSourceResourceId:'source',splitSets:[set],activeSplitSetId:'set',activePartId:'t',selectedPartIds:['t'],viewMode:'parts',busy:false},document:doc,activeSplitSet:()=>set,sourceCanvasSizeSync:()=>({width:640,height:480}),normalizeSpineLayerOrder:a=>a.map(p=>({...p})).sort((a,b)=>a.layer-b.layer),normalizeLayerRecord:p=>p,activeSplitEditToolKind:()=>'',uniquePartIdForSet:(id,parts)=>parts.some(p=>p.id===id)?id+'_2':id,render(){},updatePreviewOverlay(){},syncSplitWorkspace(){},normalizeSelection(){},async refreshSplitPreview(){},async cacheTempSplitPackage(){},setMessage(){},safeDownloadFileName:s=>s,movePartLayer(id,offset){const parts=root.state.parts.slice().sort((a,b)=>a.layer-b.layer),i=parts.findIndex(p=>p.id===id),j=i+offset;if(j<0||j>=parts.length)return;const a=parts[i].layer,b=parts[j].layer;root.state.parts=root.state.parts.map(p=>p.id===parts[i].id?{...p,layer:b}:p.id===parts[j].id?{...p,layer:a}:p)},__NovaFlowArtGenerate:{state:{running:false,randomSeed:false,seed:1},references:()=>[],render(){}},async previewDataUrl(){return 'data:image/png;base64,preview'},async psdDataUrl(){return 'data:image/vnd.adobe.photoshop;base64,OEJQUw=='}});
 const history=nativeSource.slice(nativeSource.indexOf('  function splitLayerHistoryContextSignature()'),nativeSource.indexOf('  function handleSplitToolUndo()'));
 const operations=nativeSource.slice(nativeSource.indexOf('  const uiLayerProjectListeners = new Set()'),nativeSource.indexOf('  function pruneEmptySplitSets('));
 vm.runInContext('let splitLayerUndoStack=[],splitLayerRedoStack=[];\n'+history+'\n'+operations+'\nfunction isSplitEditToolActive(){return !!(uiLayerMutation||uiLayerGeneration||activeSplitEditToolKind())}\nthis.api={patchUiLayer,addUiLayer,removeUiLayer,moveUiLayer,regenerateUiLayer,cancelUiLayerGeneration,getUiLayerEditingSnapshot,exportUiLayerProject,getUiLayerExport,undoSplitLayerEdit,redoSplitLayerEdit,subscribeUiLayerProjects};',root);
 return {root,api:root.api,set,project};
}
const tick=()=>new Promise(setImmediate),plain=v=>JSON.parse(JSON.stringify(v));
test('native text edit changes its pixels and typed JSON while preserving other layers, then undo/redo restores both',async()=>{
 const e=environment(),other=plain(e.root.state.parts[1]),before=e.root.state.parts[0].dataUrl;
 await e.api.patchUiLayer('t',{text:'修改后的文字',fontSize:30,color:'#ff0000'});
 assert.notEqual(e.root.state.parts[0].dataUrl,before);assert.equal(e.api.exportUiLayerProject().layers[0].type,'text');assert.equal(e.api.exportUiLayerProject().layers[0].text,'修改后的文字');assert.deepEqual(plain(e.root.state.parts[1]),other);
 assert.equal(e.api.undoSplitLayerEdit(),true);await tick();assert.equal(e.api.exportUiLayerProject().layers[0].text,'before');assert.equal(e.root.state.parts[0].dataUrl,before);
 assert.equal(e.api.redoSplitLayerEdit(),true);await tick();assert.equal(e.api.exportUiLayerProject().layers[0].text,'修改后的文字');
});
test('lock rejects actual edits, image replacement and removal; unlock and dimensions update real layer bounds',async()=>{
 const e=environment();await e.api.patchUiLayer('i',{locked:true});const before=JSON.stringify(e.root.state.parts);
 await assert.rejects(e.api.patchUiLayer('i',{width:200}));await assert.rejects(e.api.patchUiLayer('i',{dataUrl:'data:image/png;base64,replaced'}));await assert.rejects(e.api.removeUiLayer('i'));assert.equal(JSON.stringify(e.root.state.parts),before);
 await e.api.patchUiLayer('i',{locked:false});await e.api.patchUiLayer('i',{x:22,y:33,width:144,height:155,opacity:.5});const p=e.root.state.parts.find(p=>p.id==='i');assert.equal(p.width,144);assert.equal(p.height,155);assert.equal(p.x,22);assert.equal(e.api.exportUiLayerProject().layers.find(l=>l.id==='i').opacity,.5);
});
test('adding an independent asset and background, reordering, deleting and history all use the same native parts',async()=>{
 const e=environment();await e.api.addUiLayer({id:'a',type:'image',kind:'asset',name:'new'});assert.equal(e.root.state.parts.length,3);assert.equal(e.api.exportUiLayerProject().layers.at(-1).id,'a');
 await e.api.addUiLayer({id:'b',type:'image',kind:'background',name:'background'});assert.equal(e.root.state.parts[0].id,'b');assert.equal(e.root.state.parts[0].width,640);assert.equal(e.root.state.parts[0].height,480);
 await e.api.moveUiLayer('a',-1);assert.equal(e.api.exportUiLayerProject().layers.at(-2).id,'a');await e.api.removeUiLayer('a');assert.equal(e.root.state.parts.length,3);e.api.undoSplitLayerEdit();await tick();assert.equal(e.root.state.parts.length,4);
});
test('failed property validation does not change native pixels, geometry or history',async()=>{
 const e=environment(),before=JSON.stringify(e.root.state.parts);await assert.rejects(e.api.patchUiLayer('t',{width:0}));assert.equal(JSON.stringify(e.root.state.parts),before);assert.equal(e.api.getUiLayerEditingSnapshot().canUndo,false);
});
test('JSON save carries editable text, PNG/PSD export returns actual typed payloads and old recovery snapshot',async()=>{
 const e=environment();await e.api.patchUiLayer('t',{text:'saved'});const json=await e.api.getUiLayerExport('json'),saved=JSON.parse(decodeURIComponent(json.dataUrl.split(',')[1]));assert.equal(saved.layers[0].text,'saved');assert.equal(saved.originalProject.layers[0].text,'before');assert.ok((await e.api.getUiLayerExport('png')).dataUrl.startsWith('data:image/png'));assert.ok((await e.api.getUiLayerExport('psd')).dataUrl.startsWith('data:image/vnd.adobe.photoshop'));assert.equal((await e.api.getUiLayerExport('layer')).dataUrl,e.root.state.parts[0].dataUrl);
});
test('cancel then retry rejects the late result and old finally cannot clear the replacement transaction',async()=>{
 const resolvers=[];const e=environment((_layer,_project,signal)=>new Promise(resolve=>resolvers.push({resolve,signal})));e.root.state.activePartId='i';
 const first=e.api.regenerateUiLayer('i');await tick();assert.equal(e.api.cancelUiLayerGeneration(),true);assert.equal(resolvers[0].signal.aborted,true);
 const second=e.api.regenerateUiLayer('i');await tick();assert.equal(e.api.getUiLayerEditingSnapshot().generating,true);resolvers[0].resolve({dataUrl:'data:image/png;base64,late'});await assert.rejects(first);assert.equal(e.api.getUiLayerEditingSnapshot().generating,true);assert.equal(e.root.__NovaFlowArtGenerate.state.running,true);
 resolvers[1].resolve({dataUrl:'data:image/png;base64,accepted',provenance:{promptId:'own'}});await second;assert.equal(e.api.getUiLayerEditingSnapshot().generating,false);assert.equal(e.root.__NovaFlowArtGenerate.state.running,false);assert.equal(e.api.exportUiLayerProject().layers.find(l=>l.id==='i').dataUrl,'data:image/png;base64,accepted');assert.equal(e.api.exportUiLayerProject().layers.find(l=>l.id==='t').text,'before');
});
