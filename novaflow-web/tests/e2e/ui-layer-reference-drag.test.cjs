const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const renderer=path.resolve(__dirname,'../../renderer'),fallback='D:/AI_APP/NovaFlow-Web/novaflow-web/renderer';const read=name=>fs.readFileSync(path.join(fs.existsSync(path.join(renderer,name))?renderer:fallback,name),'utf8');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),dataUrl='data:image/png;base64,'+png.toString('base64');
class Element {
 constructor(attrs={},workspace=false){this.attrs={...attrs};this.style={};this.workspace=workspace;this.isConnected=true;}
 matches(selector){return selector.includes('data-ais-import')&&!!this.attrs['data-ais-import'];}
 closest(selector){if(selector==='#novaflow-art-generate-workspace')return this.workspace?this:null;if(selector.includes('data-ais-import'))return this.matches(selector)?this:null;return null;}
 getAttribute(key){return this.attrs[key]??null;}setAttribute(key,value){this.attrs[key]=String(value);}removeAttribute(key){delete this.attrs[key];}setPointerCapture(){}releasePointerCapture(){}
}
function setup({enabled=true,limit=2,onFile}={}){
 const slots=[1,2,3].map(i=>new Element({'data-ais-import':'art_reference_'+i},true)),body=new Element(),callbacks=[],refs=[],messages=[],reorders=[];
 const document={body,addEventListener(){},querySelectorAll:()=>slots,elementFromPoint(x,y){return x>=0&&x<100&&y>=0&&y<90?slots[Math.floor(y/30)]:null;}};
 const root={Element,document,File,atob,Uint8Array};root.window=root;vm.runInNewContext(read('art-generate-reference-drop.tool.js'),root);
 root.NovaFlowArtGenerateReferenceDropTool.configure({isEnabled:()=>enabled,onFile:async(index,file)=>{callbacks.push({index,file});if(index>=limit)throw Error('Existing reference capacity reached');if(onFile)return onFile(index,file);refs[index]=Buffer.from(await file.arrayBuffer());}});
 const part={id:'text',label:'MAJOR name',dataUrl,width:1,height:1,layer:0},row=new Element(),state={parts:[part,{id:'neighbor',dataUrl,layer:1}],busy:false,activeSplitSetId:'set'},baseline=JSON.stringify(state.parts);
 const native={state,Element,window:root,document,SPLIT_LAYER_DROP_OUTLINE:'1px solid blue',LAYER_ROW_ATTR:'data-novaflow-spine-split-layer-row',LAYER_COMMAND_ATTR:'data-novaflow-layer-command',splitPartForRightWorkspaceId:()=>part,isSplitEditToolActive:()=>false,blockLayerPointerEvent(){},clearLayerPointerDropPreview(){},showLayerPointerDropLine(){},scheduleLayerPointerAutoScroll(){},cancelLayerPointerDrag(){state.layerPointerDrag=null;},finishLayerPointerDragVisual(){root.NovaFlowArtGenerateReferenceDropTool.clearLayerDrag();state.dragLayerId='';state.dragLayerSetId='';},setLayerSelection(){},layerPointerTargetAt(x){return x>=200&&x<400?{targetId:'neighbor',targetSetId:'set',insertAfterTarget:true,row:new Element(),rect:{}}:null;},moveLayerToSplitSet(){throw Error('Unexpected move to group');},reorderPartLayerByDrop(...args){reorders.push(args);return Promise.resolve();},setMessage:(text,error)=>messages.push({text,error}),render(){},syncSplitWorkspace(){}};
 const source=read('spine-split-runtime.js');for(const name of ['layerPointerInputKind','layerPointerEventMatchesDrag','startLayerPointerDrag','updateLayerPointerDragPreview','moveLayerPointerDrag','endLayerPointerDrag']){const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  function ',start+4);assert.ok(start>0&&end>start,name);vm.runInNewContext(source.slice(start,end),native);}
 const event=(type,x,y)=>({type,button:0,buttons:1,pointerId:1,clientX:x,clientY:y,currentTarget:row,target:row,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}});
 const begin=()=>native.startLayerPointerDrag('text','set',event('pointerdown',300,10)),move=(x,y)=>native.moveLayerPointerDrag(event('pointermove',x,y)),end=(x,y,cancelled=false)=>native.endLayerPointerDrag(event('pointerup',x,y),cancelled),settle=()=>new Promise(resolve=>setTimeout(resolve,20));
 return {root,native,state,part,slots,callbacks,refs,messages,reorders,baseline,begin,move,end,settle};
}
test('layer reference import uses the existing file callback with every original PNG byte and no extra role metadata',async()=>{
 const s=setup();s.begin();s.move(20,10);s.end(20,10);await s.settle();assert.equal(s.callbacks.length,1);assert.equal(s.callbacks[0].index,0);assert.equal(s.callbacks[0].file.type,'image/png');assert.equal(s.callbacks[0].file.name,'MAJOR name.png');assert.equal(s.callbacks[0].file.role,undefined);assert.deepEqual(s.refs[0],png);assert.equal(JSON.stringify(s.state.parts),s.baseline);assert.equal(s.reorders.length,0);
});
test('normal pointer drag within the original list still commits the original ordering operation',async()=>{
 const s=setup();s.begin();s.move(320,20);s.end(320,20);await s.settle();assert.equal(s.reorders.length,1);assert.equal(s.reorders[0][0],'text');assert.equal(s.reorders[0][1],'neighbor');assert.equal(s.callbacks.length,0);
});
test('the final reference location clears a stale ordering destination, including without a final pointermove',async()=>{
 const s=setup();s.begin();s.move(320,20);assert.equal(s.state.layerPointerDrag.targetId,'neighbor');s.end(20,10);await s.settle();assert.equal(s.reorders.length,0);assert.equal(s.callbacks.length,1);assert.equal(JSON.stringify(s.state.parts),s.baseline);
});
test('repeating the same slot replaces that slot with the same stable image instead of appending references',async()=>{
 const s=setup();for(let i=0;i<3;i++){s.begin();s.move(20,10);s.end(20,10);await s.settle();}assert.equal(s.callbacks.length,3);assert.equal(s.refs.filter(Boolean).length,1);assert.deepEqual(s.refs[0],png);assert.equal(JSON.stringify(s.state.parts),s.baseline);
});
test('a drag snapshots the chosen image so a later layer change does not silently change the reference',async()=>{
 const s=setup();s.begin();s.part.dataUrl='data:image/png;base64,bGF0ZXI=';s.move(20,10);s.end(20,10);await s.settle();assert.deepEqual(s.refs[0],png);assert.equal(s.reorders.length,0);
});
test('the existing reference capacity rejection is retained and cannot move or delete source layers',async()=>{
 const s=setup();s.begin();s.move(20,70);s.end(20,70);await s.settle();assert.equal(s.refs.filter(Boolean).length,0);assert.equal(s.messages.length,1);assert.match(s.messages[0].text,/capacity/);assert.equal(s.reorders.length,0);assert.equal(JSON.stringify(s.state.parts),s.baseline);
});
test('cancel or release outside both regions leaves references and layer order alone',async()=>{
 for(const cancelled of [true,false]){const s=setup();s.begin();s.move(320,20);s.end(150,200,cancelled);await s.settle();assert.equal(s.callbacks.length,0);assert.equal(s.reorders.length,0);assert.equal(JSON.stringify(s.state.parts),s.baseline);assert.equal(s.state.layerPointerDrag,null);}
});
test('disabled reference mode and missing callbacks cannot report a handled layer drop',async()=>{
 const s=setup({enabled:false});assert.equal(s.root.NovaFlowArtGenerateReferenceDropTool.previewLayerDrag({clientX:20,clientY:10}),false);assert.equal(s.root.NovaFlowArtGenerateReferenceDropTool.finishLayerDrag({clientX:20,clientY:10},{dataUrl}),false);s.root.NovaFlowArtGenerateReferenceDropTool.configure({isEnabled:()=>true});assert.equal(s.root.NovaFlowArtGenerateReferenceDropTool.finishLayerDrag({clientX:20,clientY:10},{dataUrl}),false);assert.equal(s.callbacks.length,0);
});
test('synchronous image import errors follow the existing error path without mutating source layers',async()=>{
 const s=setup();s.part.dataUrl='unavailable';const unchanged=JSON.stringify(s.state.parts);s.begin();s.move(20,10);s.end(20,10);await s.settle();assert.equal(s.messages.length,1);assert.equal(s.messages[0].error,true);assert.equal(s.callbacks.length,0);assert.equal(s.reorders.length,0);assert.equal(JSON.stringify(s.state.parts),unchanged);
});
