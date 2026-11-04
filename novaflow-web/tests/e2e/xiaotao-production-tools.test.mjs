import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {FOART_TOOL_SCHEMA,validateFoartPlan,readFoartPlan} from '../../packages/shared/src/foart-tool-plan.mjs';
const source=await readFile(new URL('../../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8');
const effectWorkflowSource=await readFile(new URL('../../renderer/aifx-restyle.workflow.js',import.meta.url),'utf8');
const plan=op=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'调用对应原生工具',operations:[op]});
function load(){const context={console,Blob,TextEncoder,DataView,Uint8Array,URL,setTimeout,clearTimeout,document:{body:{classList:{contains:()=>false},getAttribute:()=>null},getElementById:id=>String(id).startsWith('novaflow-')?{}:null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){}})}};context.window=context;vm.runInNewContext(source,context);return context;}

test('automatic rigging awaits the original native builder and reports its actual counts without replacing a rig for an ordinary pose edit',async()=>{
 const root=load();let ran=0,completed=false;
 const context={active:true,loaded:true,bones:[{name:'root'}]};
 root.NovaFlowSkeletonEditor={active:()=>true,api:()=>({agentAction(){throw Error('Use original autoRig')},agentContext:()=>context,async autoRig(){ran++;await new Promise(resolve=>setTimeout(resolve,5));completed=true;context.bones.push({name:'native-bone'});return {bones:7,ik:2,layers:1};}})};
 const op={action:'animation',operation:'auto_rig'};
 validateFoartPlan(plan(op),{schema:FOART_TOOL_SCHEMA,controls:[],animation:context});
 await assert.rejects(root.NovaFlowFoartTools.execute(op,{requirements:'把手抬高一点'}),/未要求自动架设/);assert.equal(ran,0);
 const receipt=await root.NovaFlowFoartTools.execute(op,{requirements:'使用自动架设给这个工程建立骨架'});
 assert.equal(completed,true);assert.equal(receipt.bones,7);assert.equal(receipt.ik,2);assert.equal(receipt.layers,1);assert.equal(receipt.context.bones.length,2);
});

test('a native art parameter dialog resumes its existing wrapped generation while generic generation stays blocked',async()=>{
 const root=load();let resolveNative,clicked=0;
 root.crypto={randomUUID:()=> 'angle-task'};root.PointerEvent=root.MouseEvent=class{constructor(type,init){this.type=type;Object.assign(this,init);}};
 const state={source:{fileName:'original.png',dataUrl:'data:image/png;base64,old'},parts:[]};
 root.__NovaFlowArtGenerate={captureContext:()=>({generationSurface:'drawing'}),state:{}};
 root.NovaFlowSpineSplitBridge={getState:()=>state,agentAction:()=>new Promise(resolve=>{resolveNative=resolve;})};
 const geometry={isConnected:true,getBoundingClientRect:()=>({left:0,top:0,width:100,height:30})};
 const modal={...geometry,id:'novaflow-spine-split-mode-dialog',className:'modal',getAttribute:key=>key==='aria-label'?'角度调整':null,matches:()=>false,closest:()=>null,contains:el=>el===submit,querySelectorAll:()=>[submit]};
 const submit={...geometry,tagName:'BUTTON',type:'button',textContent:'开始生成',getAttribute:()=>null,hasAttribute:()=>false,matches:()=>false,closest:selector=>selector.includes('novaflow-spine-split-mode-dialog')||selector.includes('[role="dialog"]')?modal:null,querySelector:()=>null,dispatchEvent:event=>{if(event.type==='click'){clicked++;state.source={fileName:'actual-angle.png',dataUrl:'data:image/png;base64,new'};resolveNative({phase:'completed',sourceChanged:true});}}};
 root.document.querySelectorAll=selector=>selector.includes('[role="dialog"]')?[modal]:[];
 const [button]=root.NovaFlowFoartTools.catalog();
 await assert.rejects(root.NovaFlowFoartTools.execute({action:'activate_control',controlId:button.id}),/对应生成工具/);
 await root.NovaFlowFoartTools.execute({action:'art_action',name:'imageAngleAdjust'});
 const actual=await root.NovaFlowFoartTools.execute({action:'activate_control',controlId:button.id});
 assert.equal(clicked,1);assert.equal(actual.phase,'completed');assert.equal(actual.outputs[0].name,'actual-angle.png');
 const settled=await root.NovaFlowFoartTools.settlePending();assert.equal(settled.name,'imageAngleAdjust');assert.equal(settled.phase,'completed');
});

test('a native split choice dialog yields to the planner even when its buttons lack generic confirm verbs',async()=>{
 const root=load();let resolveNative,clicked=0;
 root.crypto={randomUUID:()=> 'angle-task'};root.PointerEvent=root.MouseEvent=class{constructor(type,init){this.type=type;Object.assign(this,init);}};
 const state={source:{fileName:'original.png',dataUrl:'data:image/png;base64,old'},parts:[]};
 root.__NovaFlowArtGenerate={captureContext:()=>({generationSurface:'drawing'}),state:{}};
 root.NovaFlowSpineSplitBridge={getState:()=>state,agentAction:()=>new Promise(resolve=>{resolveNative=resolve;})};
 const geometry={isConnected:true,getBoundingClientRect:()=>({left:0,top:0,width:100,height:30})};
 const modal={...geometry,id:'novaflow-spine-split-mode-dialog',className:'modal',getAttribute:key=>key==='aria-label'?'选择拆图方式':null,matches:()=>false,closest:()=>null,contains:el=>el===submit,querySelectorAll:()=>[submit]};
 const submit={...geometry,tagName:'BUTTON',type:'button',textContent:'默认拆图（推荐）',getAttribute:()=>null,hasAttribute:()=>false,matches:()=>false,closest:selector=>selector.includes('novaflow-spine-split-mode-dialog')||selector.includes('[role="dialog"]')?modal:null,querySelector:()=>null,dispatchEvent:event=>{if(event.type==='click'){clicked++;state.source={fileName:'actual-angle.png',dataUrl:'data:image/png;base64,new'};resolveNative({phase:'completed',sourceChanged:true});}}};
 root.document.querySelectorAll=selector=>selector.includes('[role="dialog"]')?[modal]:[];
 const [button]=root.NovaFlowFoartTools.catalog();
 await root.NovaFlowFoartTools.execute({action:'art_action',name:'split'});
 const originalTimer=root.setTimeout;root.setTimeout=()=>{throw Error('A pending native choice must yield, never wait for its own click')};assert.equal(await root.NovaFlowFoartTools.settlePending(),null);root.setTimeout=originalTimer;assert.equal(clicked,0);
 const actual=await root.NovaFlowFoartTools.execute({action:'activate_control',controlId:button.id});
 assert.equal(clicked,1);assert.equal(actual.phase,'completed');assert.equal(actual.outputs[0].name,'actual-angle.png');
 const settled=await root.NovaFlowFoartTools.settlePending();assert.equal(settled.name,'split');assert.equal(settled.phase,'completed');
});

test('fresh conversation images retain their full bytes without slot mutation or replacing a later result-bound analysis',async()=>{
 const root=load(),png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 root.NovaFlowFoartTools.setUploads([{kind:'image',name:'new-reference.png',dataUrl:png}]);
 const fresh=await root.NovaFlowFoartTools.images({requirements:'分析本次上传图片，不修改工作区',preferUploads:true});assert.equal(fresh.length,1);assert.equal(fresh[0].dataUrl,png);assert.equal(fresh[0].role,'attachment');
 root.__NovaFlowArtGenerate={selectedResult:()=>({id:'real-output',name:'actual-result.png',imageUrl:png})};
 const continuation=await root.NovaFlowFoartTools.images({requirements:'检查刚才生成结果'});assert.equal(continuation.length,1);assert.equal(continuation[0].name,'actual-result.png');assert.equal(continuation[0].role,'result');
 root.NovaFlowFoartTools.setUploads([1,2,3].map(i=>({kind:'image',name:i+'.png',dataUrl:png})));
 assert.equal((await root.NovaFlowFoartTools.images({preferUploads:true})).length,3,'New attachment images and workspace previews share the original three-image limit');
});

test('ordinary art result analysis sees the displayed full layer composite before a small generated patch',async()=>{
 const root=load(),composite='data:image/png;base64,Y29tcG9zaXRl',source='data:image/png;base64,b3JpZ2luYWw=';
 root.NovaFlowSpineSplitBridge={getState:()=>({viewMode:'parts',splitPreviewDataUrl:composite,source:{fileName:'source.png',dataUrl:source},parts:[{id:'small-patch',dataUrl:'data:image/png;base64,cGF0Y2g='}]})};
 const images=await root.NovaFlowFoartTools.images({requirements:'看看刚才编辑后的整张图'});
 assert.equal(images[0].dataUrl,composite);assert.equal(images[0].name,'当前美工画板合成预览.png');assert.equal(images[1].dataUrl,source);
});

test('an unapplied mask sends its actual visible live pixels before older source images without applying the mask',async()=>{
 const root=load(),preview='data:image/png;base64,current-live-mask';
 const live={width:326,height:489,isConnected:true,getBoundingClientRect:()=>({width:652,height:978}),closest:()=>null,toDataURL:()=>preview};
 root.document.querySelector=selector=>selector==='canvas[data-novaflow-mask-live-canvas]'?live:null;
 root.NovaFlowSpineSplitBridge={getState:()=>({maskEditor:{active:true},source:{dataUrl:'data:image/png;base64,older-source'}})};
 const images=await root.NovaFlowFoartTools.images({requirements:'检查当前蒙版擦除范围'});
 assert.equal(images[0].dataUrl,preview);assert.equal(images[0].name,'当前蒙版实际预览.png');assert.equal(images[0].role,'result');assert.equal(root.NovaFlowSpineSplitBridge.getState().maskEditor.active,true);
});

test('an initialized native selection layer is not returned as a newly generated image',async()=>{
 const root=load(),state={source:{fileName:'original.png',dataUrl:'data:image/png;base64,original'},parts:[]};root.crypto={randomUUID:()=> 'selection-task'};root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA,FOART_ART_ACTIONS:[]};
 root.__NovaFlowArtGenerate={captureContext:()=>({generationSurface:'drawing'}),state:{}};
 root.NovaFlowSpineSplitBridge={getState:()=>state,async agentAction(){state.parts.push({id:'working',dataUrl:state.source.dataUrl});state.selectionTool={active:true,mode:'inpaint',inpaintMode:'edit'};return {phase:'opened',layersChanged:true};}};
 await root.NovaFlowFoartTools.execute({action:'art_action',name:'inpaintEdit'});
 const receipt=await root.NovaFlowFoartTools.settlePending();assert.equal(receipt.phase,'opened');assert.equal(receipt.outputs,undefined);assert.equal(root.NovaFlowFoartTools.capture().lastOutput,null);assert.equal(root.NovaFlowFoartTools.capture().artEditor.editingAction,'inpaintEdit');
});

test('the native selection mask canvas is exposed without pen mode and receives a continuous brush stroke',async()=>{
 const root=load(),events=[];root.PointerEvent=class{constructor(type,init){this.type=type;Object.assign(this,init);}};
 root.NovaFlowSpineSplitBridge={getState:()=>({penTool:{active:false},selectionTool:{active:true,mode:'inpaint'}})};
 const scope={isConnected:true,getBoundingClientRect:()=>({width:640,height:512}),matches:()=>false,closest:()=>null,getAttribute:()=>null};
 const canvas={isConnected:true,tagName:'CANVAS',width:640,height:512,getBoundingClientRect:()=>({left:0,top:0,width:640,height:512}),matches:selector=>['canvas[data-novaflow-selection-tool-canvas]','[data-novaflow-selection-tool-canvas]'].includes(selector),closest:selector=>selector==='[data-novaflow-split-canvas-art="1"]'?scope:null,getAttribute:()=>null,hasAttribute:()=>false,dispatchEvent:event=>events.push(event.type)};
 scope.querySelectorAll=()=>[canvas];root.document.querySelectorAll=selector=>selector.startsWith('[data-novaflow-art-drawing-host')?[scope]:[];
 const [control]=root.NovaFlowFoartTools.catalog();assert.equal(control.label,'美工局部选区画布（原图坐标）');assert.equal(control.pointerMode,undefined);
 await root.NovaFlowFoartTools.execute({action:'draw',controlId:control.id,points:[[.05,.05],[.1,.1],[.15,.05]]});assert.deepEqual(events,['pointerdown','pointermove','pointermove','pointerup']);
});

test('the actual skeleton overlay accepts native strokes and reports whether the original editor committed data',async()=>{
 const root=load();let revision='before';const events=[];root.PointerEvent=class{constructor(type,init){this.type=type;Object.assign(this,init);}};
 const frameDoc={querySelectorAll:selector=>selector.startsWith('button,input')?[canvas]:[]};
 const geometry={isConnected:true,getBoundingClientRect:()=>({left:100,top:50,width:500,height:300,right:600,bottom:350})};
 const canvas={...geometry,ownerDocument:frameDoc,tagName:'CANVAS',id:'overlay',width:1000,height:600,getAttribute:()=>null,hasAttribute:()=>false,matches:()=>false,closest:()=>null,querySelector:()=>null,dispatchEvent:event=>{events.push([event.type,event.clientX,event.clientY]);if(event.type==='pointerup')revision='after';}};
 const frame={...geometry,contentDocument:frameDoc};root.document.body.classList.contains=key=>key==='novaflow-primary-target-animation';root.document.querySelector=selector=>selector==='#novaflow-skeleton-editor-frame'?frame:null;
 root.NovaFlowSkeletonEditor={active:()=>true,api:()=>({agentContext:()=>({loaded:true,revision,editingVertices:[{index:0,x:.1,y:.1,weights:[[0,1]]},{index:4,x:revision==='before'?.5:.51,y:.5,weights:revision==='before'?[[0,.5],[1,.5]]:[[0,.25],[1,.75]]}]}),agentPreview:()=> 'data:image/png;base64,dmlldw=='})};
 const [control]=root.NovaFlowFoartTools.catalog();assert.equal(control.surface,'animation');assert.equal(control.kind,'canvas');
 const receipt=await root.NovaFlowFoartTools.execute({action:'draw',controlId:control.id,points:[[.2,.3],[.4,.5]]});assert.equal(receipt.changed,true);assert.equal(receipt.context.revision,'after');assert.deepEqual(JSON.parse(JSON.stringify(receipt.vertexChanges)),[{index:4,before:{x:.5,y:.5},after:{x:.51,y:.5}}]);assert.deepEqual(JSON.parse(JSON.stringify(receipt.weightChanges)),[{index:4,weights:[[0,.25],[1,.75]]}]);assert.deepEqual(events,[['pointerdown',200,140],['pointermove',300,200],['pointerup',300,200]]);
 const image=await root.NovaFlowFoartTools.images();assert.equal(image[0].name,'当前骨骼动画画板.png');assert.equal(image[0].dataUrl,'data:image/png;base64,dmlldw==');
});

test('native weight bone rows are real clickable controls rather than invisible generic labels',async()=>{
 const root=load();let picked=false;root.PointerEvent=root.MouseEvent=class{constructor(type,init){this.type=type;Object.assign(this,init);}};
 const geometry={isConnected:true,getBoundingClientRect:()=>({left:0,top:0,width:100,height:30,right:100,bottom:30})};
 const frameDoc={querySelectorAll:selector=>selector.startsWith('button,input')?[row]:[]};
 const row={...geometry,ownerDocument:frameDoc,tagName:'DIV',textContent:'chest',getAttribute:key=>key==='title'?'「chest」：点一下选中刷它的权重':key==='aria-pressed'?String(picked):null,hasAttribute:key=>key==='aria-pressed',matches:()=>false,closest:()=>null,querySelector:()=>null,dispatchEvent:event=>{if(event.type==='pointerup')picked=true;}};
 root.document.body.classList.contains=key=>key==='novaflow-primary-target-animation';root.document.querySelector=selector=>selector==='#novaflow-skeleton-editor-frame'?{...geometry,contentDocument:frameDoc}:null;
 const [control]=root.NovaFlowFoartTools.catalog();assert.equal(control.kind,'button');assert.match(control.label,/chest/);
 await root.NovaFlowFoartTools.execute({action:'activate_control',controlId:control.id});assert.equal(picked,true);
});

test('animation exports retain native encoder bytes in a recoverable file and do not fabricate a directory or saved state',async()=>{
 const root=load();let calls=0,settings;
 const api={agentAction(){},agentContext:()=>({exportVersion:'4.2'}),exportSelectedProjects:async options=>{calls++;settings=options;await options.write('robot.json',new TextEncoder().encode('{"bones":[{"name":"root"}]}'));await options.write('robot.atlas',new TextEncoder().encode('robot.png\n'));return {projects:[{name:'robot',images:1,missing:[]}]}}};
 root.NovaFlowSkeletonEditor={active:()=>true,api:()=>api};
 const op={action:'animation',operation:'export_project',format:'json',packed:true};
 await assert.rejects(root.NovaFlowFoartTools.execute(op,{requirements:'保留工程，不导出。'}),/未要求导出/);assert.equal(calls,0);
 const receipt=await root.NovaFlowFoartTools.execute(op,{requirements:'导出当前勾选的工程为JSON和图集'});assert.equal(calls,1);assert.equal(settings.version,'4.2');assert.equal(settings.directory,undefined);assert.equal(settings.skel,false);assert.equal(settings.packed,true);
 const output=receipt.outputs[0];assert.equal(output.count,2);assert.equal(output.downloadInitiated,true);assert.equal(output.saved,undefined);assert.ok(output.bytes>0);assert.ok(root.NovaFlowFoartTools.downloadFile(output.downloadId).url);assert.match(receipt.message,/2 个实际文件/);
});

test('animation iframe file inputs dispatch their own native change handler instead of the unrelated viewer',async()=>{
 const root=load(),file=new File(['{"bones":[]}'],'skeleton.json',{type:'application/json'});let changed=0;
 root.setTimeout=fn=>setTimeout(fn,0);root.Event=class{constructor(type){this.type=type;}};
 root.DataTransfer=class{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}};
 const frameDoc={defaultView:{},querySelectorAll:selector=>selector.startsWith('button,input')?[input]:[]};
 const geometry={isConnected:true,getBoundingClientRect:()=>({left:0,top:0,width:100,height:30}),closest:()=>null,getAttribute:()=>null,hasAttribute:()=>false,matches:()=>false};
 const input={...geometry,tagName:'INPUT',type:'file',accept:'.json',ownerDocument:frameDoc,dispatchEvent:event=>{if(event.type==='change')changed++;}};
 const frame={...geometry,contentDocument:frameDoc};root.document.body.classList.contains=key=>key==='novaflow-primary-target-animation';root.document.querySelector=selector=>selector==='#novaflow-skeleton-editor-frame'?frame:null;
 const control=root.NovaFlowFoartTools.catalog()[0];assert.equal(control.kind,'file');root.NovaFlowFoartTools.setUploads([{file,name:file.name,kind:'tool'}]);
 const receipt=await root.NovaFlowFoartTools.execute({action:'assign_upload',controlId:control.id,uploadId:'upload-0'});
 assert.equal(changed,1);assert.equal(input.files[0],file);assert.equal(receipt.files[0].name,'skeleton.json');assert.equal(receipt.viewer,undefined);
});
test('an open native modal exposes its confirmation and hides covered sidebar actions',()=>{
 const root=load();let modal;
 const node=(text,inside=false)=>({tagName:'BUTTON',textContent:text,isConnected:true,type:'button',getBoundingClientRect:()=>({width:100,height:30}),getAttribute:()=>null,hasAttribute:()=>false,matches:()=>false,closest:selector=>inside&&selector.includes('[role="dialog"]')?modal:null,querySelector:()=>null});
 const sidebar=node('画布扩展'),apply=node('执行扩展',true),scope={...node('编辑'),querySelectorAll:()=>[sidebar]};
 modal={...node('画布扩展'),id:'novaflow-art-dialog',className:'modal',querySelectorAll:()=>[apply],contains:el=>el===apply};
 root.document.querySelectorAll=selector=>selector.includes('[role="dialog"]')?[modal]:selector.startsWith('[data-novaflow-art-drawing-host')?[scope]:[];
 const controls=root.NovaFlowFoartTools.catalog();assert.deepEqual(Array.from(controls,c=>c.label),['执行扩展']);assert.equal(controls[0].dialog,true);
});

test('art mask canvas remains writable without pen mode and receives a real stroke instead of separate pen clicks',async()=>{
 const root=load(),events=[],painted=[];root.PointerEvent=class{constructor(type,init){this.type=type;Object.assign(this,init)}};
 root.NovaFlowSpineSplitBridge={getState:()=>({penTool:{active:false}})};
 const scope={isConnected:true,getBoundingClientRect:()=>({width:512,height:512}),matches:()=>false,closest:()=>null,getAttribute:()=>null};
 const mask={isConnected:true,tagName:'CANVAS',width:512,height:512,getBoundingClientRect:()=>({left:0,top:0,width:512,height:512}),matches:s=>s==='canvas[data-novaflow-mask-tool-canvas]',closest:s=>s==='[data-novaflow-split-canvas-art="1"]'?scope:null,getAttribute:()=>null,hasAttribute:()=>false,dispatchEvent:e=>{events.push(e.type);if(e.type==='pointerdown'||e.type==='pointermove')painted.push([e.clientX,e.clientY]);}};
 const live={...mask,matches:()=>false,preview:true};scope.querySelectorAll=()=>[mask,live];
 root.document.querySelectorAll=s=>s.startsWith('[data-novaflow-art-drawing-host')?[scope]:[];root.getComputedStyle=e=>({pointerEvents:e.preview?'none':'auto'});
 const controls=root.NovaFlowFoartTools.catalog();assert.equal(controls.length,1);assert.equal(controls[0].label,'美工蒙版画布（原图坐标）');assert.equal(controls[0].width,512);assert.equal(controls[0].pointerMode,undefined);
 assert.equal(controls[0].brushSizeUnit,'screen_pixels');assert.equal(controls[0].sourcePixelsPerBrushPixel,1);
 mask.getBoundingClientRect=()=>({left:0,top:0,width:1024,height:1024});const zoomed=root.NovaFlowFoartTools.catalog()[0];assert.equal(zoomed.sourcePixelsPerBrushPixel,.5);assert.equal(zoomed.displayWidth,1024);
 await root.NovaFlowFoartTools.execute({action:'draw',controlId:controls[0].id,points:[[.4,.1],[.6,.1]]});assert.deepEqual(events,['pointerdown','pointermove','pointerup']);assert.deepEqual(painted,[[409.6,102.4],[614.4,102.4]],'The native brush paints on down/move, never on up: a two-point stroke must reach its actual endpoint');
});

test('continuing the current drawing tool never reactivates generation or discards its active mask',async()=>{
 const root=load(),mask={active:true,partId:'actual-part'};
 root.__NovaFlowArtGenerate={captureContext:()=>({generationSurface:'drawing'}),activate(){throw Error('Must not reactivate generation')}};
 root.NovaFlowSpineSplitBridge={getState:()=>({maskEditor:mask})};root.document.querySelectorAll=()=>{throw Error('Must not re-click navigation')};
 const receipt=await root.NovaFlowFoartTools.open('drawing');assert.equal(receipt.reused,true);assert.equal(mask.active,true);assert.equal(mask.partId,'actual-part');
});

test('continuing the active tools section preserves its existing working files',async()=>{
 const root=load();root.document.body.classList.contains=value=>value==='novaflow-primary-target-tools';
 root.document.querySelectorAll=()=>{throw Error('Must not re-click navigation or clear native files');};
 assert.equal((await root.NovaFlowFoartTools.open('tools')).reused,true);
});

test('multi-reference remove controls name the exact native binding and cannot remove it during unrelated work',async()=>{
 const root=load(),card={getAttribute:key=>key==='aria-label'?'参考视频 2 motion.mp4':null};
 const button={tagName:'BUTTON',textContent:'×',isConnected:true,type:'button',getBoundingClientRect:()=>({width:100,height:30}),getAttribute:()=>null,hasAttribute:()=>false,matches:()=>false,closest:selector=>selector==='[data-novaflow-h3-source-id]'?card:null,querySelector:()=>null};
 const scope={...button,textContent:'多参',closest:()=>null,querySelectorAll:()=>[button]};root.document.querySelectorAll=selector=>selector.startsWith('[data-novaflow-art-drawing-host')?[scope]:[];
 const [control]=root.NovaFlowFoartTools.catalog();assert.equal(control.label,'移除参考视频 2 motion.mp4');
 await assert.rejects(root.NovaFlowFoartTools.execute({action:'activate_control',controlId:control.id},{requirements:'分析一下参考视频的镜头'}),/未要求删除或清空/);
});

test('an animation native menu exposes only its own choices, not the covered mode and new-menu buttons',()=>{
 const root=load();let menu;
 const node=text=>({tagName:'BUTTON',type:'button',textContent:text,isConnected:true,getBoundingClientRect:()=>({width:100,height:30}),getAttribute:()=>null,hasAttribute:()=>false,matches:()=>false,closest:()=>null,querySelector:()=>null});
 const underlying=node('新建…'),choice=node('骨骼');menu={...node('骨骼 插槽'),id:'menu',contains:el=>el===choice};
 const frameDoc={querySelectorAll:selector=>selector.startsWith('button,input')?[underlying,choice]:selector.includes('#menu')?[menu]:[]};
 const frame={...node('frame'),contentDocument:frameDoc};root.document.body.classList.contains=key=>key==='novaflow-primary-target-animation';root.document.querySelector=selector=>selector==='#novaflow-skeleton-editor-frame'?frame:null;
 assert.deepEqual(Array.from(root.NovaFlowFoartTools.catalog(),c=>c.label),['骨骼']);
});

test('the native animation iframe hides covered legacy controls while keeping the real host sidebar',()=>{
 const root=load();const frameDoc={querySelectorAll:selector=>selector.startsWith('button,input')?[native]:[]};
 const node=(text,left,ownerDocument=root.document)=>({ownerDocument,tagName:'BUTTON',type:'button',textContent:text,isConnected:true,getBoundingClientRect:()=>({left,top:10,width:40,height:30,right:left+40,bottom:40}),getAttribute:()=>null,hasAttribute:()=>false,matches:()=>false,closest:()=>null,querySelector:()=>null});
 const hidden=node('旧骨骼树',150),sidebar=node('骨骼架设',10),native=node('新建…',10,frameDoc),scope={...node('panel',0),querySelectorAll:()=>[hidden,sidebar]},frame={...node('frame',100),getBoundingClientRect:()=>({left:100,top:0,width:400,height:500,right:500,bottom:500}),contentDocument:frameDoc};
 root.document.body.classList.contains=key=>key==='novaflow-primary-target-animation';root.document.querySelector=selector=>selector==='#novaflow-skeleton-editor-frame'?frame:null;root.document.querySelectorAll=selector=>selector.startsWith('[data-novaflow-art-drawing-host')?[scope]:[];
 assert.deepEqual(Array.from(root.NovaFlowFoartTools.catalog(),c=>c.label),['骨骼架设','新建…']);
});
test('only existing production surfaces and currently active tools can execute',()=>{
 const ctx={schema:FOART_TOOL_SCHEMA,controls:[],productionTools:[{name:'mp4_compress',active:true,busy:false}],effects:{active:true,busy:false,source:{name:'source.mp4'}}};
 for(const surface of ['tools','effects','particle','animation'])assert.equal(validateFoartPlan(plan({action:'open',surface}),ctx).status,'act');
 for(const surface of ['account'])assert.throws(()=>validateFoartPlan(plan({action:'open',surface}),ctx));
 validateFoartPlan(plan({action:'tool',name:'mp4_compress',operation:'run'}),ctx);
 assert.throws(()=>validateFoartPlan(plan({action:'tool',name:'png_compress',operation:'run'}),ctx));
 assert.throws(()=>validateFoartPlan(plan({action:'effect_generate',prompt:'override compiler'}),ctx));
 assert.throws(()=>validateFoartPlan(plan({action:'effect_export',format:'spine'}),ctx));
});
test('native async output is required and a failed rerun cannot claim its cached old output',async()=>{
 const root=load();let items=[{id:'source',name:'a.png',status:'waiting',output:null}],finished=false;
 root.NovaFlowProductionTools={png_compress:{snapshot:()=>({name:'png_compress',active:true,busy:false,items}),run:async()=>{await Promise.resolve();finished=true;items=[{...items[0],status:'done',output:{id:'actual',name:'a.png',bytes:14}}];}}};
 const actual=await root.NovaFlowFoartTools.execute({action:'tool',name:'png_compress',operation:'run'});assert.equal(finished,true);assert.equal(actual.outputs[0].bytes,14);
 root.NovaFlowProductionTools.png_compress.run=async()=>{items[0].status='error';items[0].message='encoder failed';};
 await assert.rejects(root.NovaFlowFoartTools.execute({action:'tool',name:'png_compress',operation:'run'}),/encoder failed/);
});
test('effects require a new candidate and retain native material compiler and display identity',async()=>{
 const root=load(),old={result:{frames:['old']},seed:1},state={source:{fileName:'source.mp4'},sourceFrames:[{}],candidates:[old],isGenerating:false,finalProduct:{source:'result'}};
 root.NovaFlowAifxMvp={isOpen:()=>true,getState:()=>state,runProductionPipeline:async()=>{}};
 await assert.rejects(root.NovaFlowFoartTools.execute({action:'effect_generate'}),/没有返回新结果/);
 root.NovaFlowAifxMvp.runProductionPipeline=async()=>{state.candidates.push({result:{frames:['new1','new2']},seed:2});};
 const receipt=await root.NovaFlowFoartTools.execute({action:'effect_generate'});assert.equal(receipt.outputs.length,1);assert.equal(receipt.outputs[0].frames,2);assert.equal(receipt.displayedSource,'result');
});

test('effects expose the native preset and supplement strength difference without replacing its original rules',()=>{
 const root=load();root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA};vm.runInNewContext(effectWorkflowSource,root);
 const s={sourceFrames:[],candidates:[],attribute:'ice',lifecycle:'once',strength:null,supplement:'',candidateCount:1};root.NovaFlowAifxMvp={isOpen:()=>true,getState:()=>s,detectedShape:()=>({archetype:'ring',lifecycle:'once'})};
 let actual=root.NovaFlowFoartTools.capture().effects;assert.equal(actual.strength,20);assert.equal(actual.presetStrength,20);assert.equal(actual.attributeLabel,'冰霜');assert.equal(actual.shape.archetype,'ring');
 s.supplement='保留原视频运动';actual=root.NovaFlowFoartTools.capture().effects;assert.equal(actual.strength,50);assert.equal(actual.presetStrength,20);
 s.strength=30;assert.equal(root.NovaFlowFoartTools.capture().effects.strength,30,'An explicit native setting stays authoritative');
});

test('effect export names its actual selected candidate and frame count, rejects source substitution and a changed candidate',async()=>{
 const root=load(),state={sourceFrames:[],candidates:[{result:{frames:['first']}},{result:{frames:['second']}}],selectedCandidate:1,finalProduct:{source:'result'}};let exports=0;
 const files=[{name:'frame_0001.png',blob:new Blob(['first actual frame'])},{name:'frame_0002.png',blob:new Blob(['second actual frame'])}];
 root.NovaFlowAifxMvp={isOpen:()=>true,getState:()=>state,agentFiles:async()=>{exports++;return files;}};
 const receipt=await root.NovaFlowFoartTools.execute({action:'effect_export',format:'seq'},{requirements:'导出当前候选，不导出源素材'});
 assert.equal(receipt.exportSource,'result');assert.ok(receipt.candidateId);assert.equal(receipt.outputs[0].count,2);assert.match(receipt.message,/2 张透明 PNG/);
 state.finalProduct.source='source';await assert.rejects(root.NovaFlowFoartTools.execute({action:'effect_export',format:'seq'},{requirements:'导出当前候选，不导出源素材'}),/当前预览是原素材/);assert.equal(exports,1);
 state.finalProduct.source='result';root.NovaFlowAifxMvp.agentFiles=async()=>{state.selectedCandidate=0;return files;};
 await assert.rejects(root.NovaFlowFoartTools.execute({action:'effect_export',format:'seq'},{requirements:'导出当前候选'}),/所选特效已变化/);
});
test('immutable React rerenders replace the adapter and kept-original is a successful native outcome',async()=>{
 const root=load();const before={snapshot:()=>({name:'png_compress',active:true,busy:false,items:[{id:'source',status:'idle'}]}),run:async()=>{root.NovaFlowProductionTools.png_compress={snapshot:()=>({name:'png_compress',active:true,busy:false,items:[{id:'source',status:'done',output:{id:'source',name:'a.png',bytes:20,keptOriginal:true}}]})};}};
 root.NovaFlowProductionTools={png_compress:before};const receipt=await root.NovaFlowFoartTools.execute({action:'tool',name:'png_compress',operation:'run'});assert.equal(receipt.outputs[0].keptOriginal,true);assert.equal(receipt.outputs[0].bytes,20);
});
test('multi-file export contains real UTF-8 names and bytes in a standard ZIP',async()=>{
 const root=load();let archive;root.URL={createObjectURL:b=>{archive=b;return 'blob:proof';},revokeObjectURL(){}};root.setTimeout=()=>0;
 const result=await root.NovaFlowFoartTools.downloadFiles([{name:'角色.atlas',blob:new Blob(['page.webp'])},{name:'page.webp',blob:new Blob([new Uint8Array([1,2,3])])}],'atlas-output');
 assert.equal(result.name,'atlas-output.zip');assert.equal(result.count,2);const bytes=new Uint8Array(await archive.arrayBuffer());assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);assert.ok(new TextDecoder().decode(bytes).includes('角色.atlas'));assert.equal(result.bytes,bytes.length);
});
test('actual download links survive asynchronous completion and evict older native bytes',async()=>{
 const root=load(),revoked=[];let index=0;root.URL={createObjectURL:()=>`blob:actual-${++index}`,revokeObjectURL:url=>revoked.push(url)};
 const first=await root.NovaFlowFoartTools.downloadFiles([{name:'first.png',blob:new Blob(['actual output'])}],'unused');
 assert.equal(root.NovaFlowFoartTools.downloadFile(first.downloadId).url,'blob:actual-1');
 assert.equal(root.NovaFlowFoartTools.downloadFile('invented'),null);
 for(let i=0;i<5;i++)await root.NovaFlowFoartTools.downloadFiles([{name:`${i}.png`,blob:new Blob(['output'])}],'unused');
 assert.equal(root.NovaFlowFoartTools.downloadFile(first.downloadId),null);assert.deepEqual(revoked,['blob:actual-1']);
});
test('single-result continuation never reruns older members of a native batch',async()=>{
 const root=load(),items=[{id:'original',status:'idle'},{id:'new-result',status:'idle'}];let nativeIds;
 root.NovaFlowProductionTools={jpg_compress:{snapshot:()=>({name:'jpg_compress',active:true,busy:false,selectedId:'new-result',items}),run:async ids=>{nativeIds=ids;items[1]={id:'new-result',status:'done',output:{id:'new-result',name:'result.jpg',bytes:9}};}}};
 const receipt=await root.NovaFlowFoartTools.execute({action:'tool',name:'jpg_compress',operation:'run'},{requirements:'请处理刚才的实际结果'});assert.deepEqual(Array.from(nativeIds),['new-result']);assert.equal(receipt.outputs.length,1);assert.equal(items[0].status,'idle');
});

test('cross-tool continuation binds the previous encoded bytes instead of the new tool selected original',async()=>{
 const root=load();root.File=File;root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA};let sequence=0;root.crypto={randomUUID:()=>String(++sequence)};
 const png=new Blob(['PNG!'],{type:'image/png'}),jpg=new Blob(['JPG'],{type:'image/jpeg'});
 const first=[{id:'source',name:'original.png',inputBytes:100,status:'idle'}],second=[{id:'old-original',name:'original.png',inputBytes:100,status:'idle'}];let received,processed;
 root.NovaFlowProductionTools={
  png_compress:{snapshot:()=>({active:true,busy:false,items:first}),run:async()=>{first[0]={...first[0],status:'done',output:{id:'source',name:'compressed.png',bytes:png.size}};},files:()=>[{id:'source',name:'compressed.png',blob:png}]},
  jpg_compress:{snapshot:()=>({active:true,busy:false,selectedId:'old-original',items:second}),async addFiles(files){received=files[0];second.push({id:'actual-previous',name:received.name,inputBytes:received.size,sourceMaterialId:received.__nfFoartMaterialId,status:'idle'});},async run(ids){processed=ids;second[1]={...second[1],status:'done',output:{id:'actual-previous',name:'converted.jpg',bytes:jpg.size}};},files:()=>[{id:'actual-previous',name:'converted.jpg',blob:jpg}]}
 };
 const pngReceipt=await root.NovaFlowFoartTools.execute({action:'tool',name:'png_compress',operation:'run'});
 const snapshot=root.NovaFlowFoartTools.capture();assert.ok(snapshot.uploads.some(item=>item.id===pngReceipt.outputs[0].uploadId));root.NovaFlowFoartTools.capture();
 const receipt=await root.NovaFlowFoartTools.execute({action:'tool',name:'jpg_compress',operation:'run',inputIds:['old-original']},{requirements:'接着刚才实际压缩结果转JPG，不重新使用原图'});
 assert.equal(await received.text(),'PNG!');assert.equal(received.size,4);assert.deepEqual(Array.from(processed),['actual-previous']);assert.equal(second[0].status,'idle');
 assert.equal(receipt.inputs[0].bytes,4);assert.equal(receipt.inputs[0].sourceMaterialId,pngReceipt.outputs[0].uploadId);assert.equal(receipt.outputs[0].name,'converted.jpg');
});

test('native compression upload awaits asynchronous image decode and fresh React adapter before reporting input ready',async()=>{
 const root=load();root.File=File;root.Event=class{constructor(type){this.type=type;}};root.DataTransfer=class{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}};
 let items=[];const adapter=()=>({snapshot:()=>({name:'jpg_compress',active:true,busy:false,items}),files:()=>[]});root.NovaFlowProductionTools={jpg_compress:adapter()};
 const geometry={isConnected:true,getBoundingClientRect:()=>({left:0,top:0,width:40,height:30})};
 const input={...geometry,tagName:'INPUT',type:'file',accept:'image/png',multiple:true,getAttribute:()=>null,hasAttribute:()=>false,matches:()=>false,closest:()=>null,querySelector:()=>null,dispatchEvent:event=>{if(event.type==='change')setTimeout(()=>{items=[{id:'decoded',name:input.files[0].name,sourceMaterialId:input.files[0].__nfFoartMaterialId,inputBytes:input.files[0].size}];root.NovaFlowProductionTools.jpg_compress=adapter();},140);}};
 const scope={...geometry,matches:()=>false,closest:()=>null,getAttribute:()=>null,querySelectorAll:()=>[input]};input.parentElement=scope;input.ownerDocument=root.document;
 root.document.querySelectorAll=selector=>selector.startsWith('#novaflow-aifx-mvp')?[scope]:[];
 const [control]=root.NovaFlowFoartTools.catalog();root.NovaFlowFoartTools.setUploads([{name:'actual.png',kind:'image',file:new File(['actual output'],'actual.png',{type:'image/png'})}]);
 await root.NovaFlowFoartTools.execute({action:'assign_upload',controlId:control.id,uploadId:'upload-0'});
 assert.equal(root.NovaFlowProductionTools.jpg_compress.snapshot().items[0].sourceMaterialId,'upload-0');
});
test('batch attachment preserves actual files only on an original multiple-file input',()=>{
 const ctx={schema:FOART_TOOL_SCHEMA,controls:[{id:'input',kind:'file',multiple:true}],uploads:[{id:'atlas'},{id:'page'}]};const op={action:'assign_upload',controlId:'input',uploadIds:['atlas','page']};validateFoartPlan(plan(op),ctx);
 assert.throws(()=>validateFoartPlan(plan(op),{...ctx,controls:[{id:'input',kind:'file',multiple:false}]}));assert.throws(()=>validateFoartPlan(plan({...op,uploadId:'atlas'}),ctx));assert.throws(()=>validateFoartPlan(plan({...op,uploadIds:['atlas','invented']}),ctx));
});

test('a generated audio resource can be bound to a native audio-reference input using its actual WAV bytes',async()=>{
 const root=load(),wav=new Blob(['actual-mix-wav'],{type:'audio/wav'});root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA};root.File=File;root.Event=class{constructor(type){this.type=type;}};
 root.DataTransfer=class{constructor(){this.files=[];this.items={add:file=>this.files.push(file)}}};
 const geometry={isConnected:true,getBoundingClientRect:()=>({width:100,height:30}),closest:()=>null,getAttribute:()=>null,hasAttribute:()=>false,matches:()=>false};
 let changed=0;const input={...geometry,tagName:'INPUT',type:'file',accept:'.wav',ownerDocument:root.document,dispatchEvent:event=>{if(event.type==='change')changed++;}};
 const scope={...geometry,querySelectorAll:()=>[input]};root.document.querySelectorAll=selector=>selector.startsWith('[data-novaflow-art-drawing-host')?[scope]:[];
 root.NovaFlowAiSequenceAssetBridge={listResources:()=>[{id:'actual-mix',name:'actual_mix.wav'}]};
 root.NovaFlowAiSequenceVideoMergeResourceBridge={createAdapter:options=>{assert.equal(options.allowAudio,true);assert.equal(options.allowImages,true);return {resolveResource:async id=>{assert.equal(id,'actual-mix');return {blob:wav,fileName:'actual_mix.wav',mimeType:'audio/wav'};}};}};
 const snapshot=root.NovaFlowFoartTools.capture();await root.NovaFlowFoartTools.execute({action:'assign_upload',controlId:snapshot.controls[0].id,uploadId:'resource-actual-mix'});
 assert.equal(changed,1);assert.equal(input.files[0].name,'actual_mix.wav');assert.equal(input.files[0].type,'audio/wav');assert.equal(await input.files[0].text(),'actual-mix-wav');
});

test('typed frame opening loads the exact new video, awaits its real frame count and preserves an existing dirty editor',async()=>{
 const root=load(),resources=[{id:'old',name:'original.mp4'},{id:'new',name:'original_edit.mp4'}],loaded=[];root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA};
 root.PointerEvent=root.MouseEvent=class{constructor(type,init){this.type=type;Object.assign(this,init);}};
 let active='old',opened=false,current=null;
 root.NovaFlowAudioStudio={isOpen:()=>true,sub:()=> 'video'};
 root.NovaFlowMediaAgent={capture:()=>({artContext:{active:true,sub:'video',videoResources:resources}})};
 const cards=resources.map(r=>({isConnected:true,getBoundingClientRect:()=>({left:0,top:0,width:100,height:60}),getAttribute:key=>key==='data-novaflow-ai-resource-id'?r.id:key==='data-novaflow-ai-resource-card-active'?(r.id===active?'1':'0'):null,dispatchEvent:event=>{if(event.type==='click'){loaded.push(r.id);active=r.id;}}}));
 let cardReads=0;root.document.querySelectorAll=selector=>selector==='[data-novaflow-ai-resource-card="1"]'?(++cardReads<3?[]:cards):[];
 root.NovaFlowAiSequenceAssetBridge={listResources:()=>resources,loadResource:async()=>{throw Error('The low-level loader bypasses the native board selection')}};
 const heading={isConnected:true,getBoundingClientRect:()=>({left:0,top:0,width:200,height:40}),getAttribute:()=>null,dispatchEvent:event=>{if(event.type==='click'){opened=true;current={sourceName:'original_edit.mp4',frames:40,fps:15,width:256,height:256,dirty:false};}}};
 root.document.querySelector=selector=>selector==='[data-novaflow-ai-tool-heading="frame-edit"]'?heading:null;
 root.NovaFlowVideoFrameEditTool={previewContext:()=>({resourceId:active,ready:true}),isOpen:()=>opened,isBusy:()=>false,canOpen:()=>active==='new',open:async()=>{throw Error('Direct open bypasses the native expanded toolbar')},agentOpen:async()=>{heading.dispatchEvent({type:'click'});return current;},agentContext:()=>current};
 const context=root.NovaFlowFoartTools.capture(),op={action:'frame_open',resourceId:'new'};validateFoartPlan(plan(op),context);
 assert.throws(()=>validateFoartPlan(plan({...op,resourceId:'phantom'}),context),/资源不存在/);
 const prefixed=readFoartPlan(JSON.stringify({...plan(op),operations:[op,{action:'frame_select',startFrame:0,endFrame:5}]}),context);assert.equal(prefixed.operations.length,1,'New frame IDs must come from a refreshed native snapshot');
 const actual=await root.NovaFlowFoartTools.execute(op);assert.deepEqual(loaded,['new']);assert.equal(actual.frames,40);assert.equal(actual.name,'original_edit.mp4');assert.match(actual.message,/40 帧/);
 current.dirty=true;await assert.rejects(root.NovaFlowFoartTools.execute({...op,resourceId:'old'}),/未覆盖当前帧编辑/);assert.deepEqual(loaded,['new']);assert.equal(current.dirty,true);
 const reused=await root.NovaFlowFoartTools.execute(op);assert.equal(reused.frames,40);assert.equal(reused.dirty,true);assert.deepEqual(loaded,['new']);
});
test('ZIP exports preserve relative resource paths and do not overwrite duplicate output names',async()=>{
 const root=load();let archive;root.URL={createObjectURL:b=>{archive=b;return 'blob:proof';},revokeObjectURL(){}};root.setTimeout=()=>0;
 await root.NovaFlowFoartTools.downloadFiles([{name:'images/page.png',blob:new Blob(['one'])},{name:'images/page.png',blob:new Blob(['two'])},{name:'../../outside.txt',blob:new Blob(['safe'])}],'proof');const text=new TextDecoder().decode(await archive.arrayBuffer());assert.ok(text.includes('images/page.png'));assert.ok(text.includes('images/page (2).png'));assert.ok(text.includes('outside.txt'));assert.equal(text.includes('../'),false);
});

test('particle export keeps native authorization and reads dimensions from actual encoded PNG bytes',async()=>{
 const root=load();root.setTimeout=(fn,ms)=>ms>=60000?0:setTimeout(fn,0);
 root.document.body.classList.contains=value=>value==='novaflow-primary-target-particle';root.NovaFlowParticleAgent={snapshot:()=>({config:{}})};
 const modal={isConnected:true,getBoundingClientRect:()=>({width:400,height:300}),closest:()=>null};
 root.document.querySelectorAll=selector=>selector==='[data-novaflow-export-modal-root="1"]'?[modal]:[];
 const settings={fps:30,seconds:1,width:512,height:512};let closed=false;
 root.NovaFlowParticleExportAgent={snapshot:()=>({...settings}),configure:value=>Object.assign(settings,value),sequence:async()=>{const bytes=new Uint8Array(24),view=new DataView(bytes.buffer);view.setUint32(0,0x89504e47);view.setUint32(16,256);view.setUint32(20,256);for(let i=0;i<12;i++)root.NovaFlowAgentExportSession.files.set('frames/'+i+'.png',new Blob([bytes]));},close:()=>{closed=true;}};
 const receipt=await root.NovaFlowFoartTools.execute({action:'particle',operation:'export_sequence',fps:12,seconds:1,width:256,height:256,transparent:true},{requirements:'请导出当前粒子透明序列帧'});
 assert.equal(receipt.frames,12);assert.equal(receipt.seconds,1);assert.equal(receipt.width,256);assert.equal(receipt.height,256);assert.equal(receipt.outputs[0].downloadInitiated,true);assert.equal(closed,true);assert.equal(root.NovaFlowAgentExportSession,null);
 root.document.querySelectorAll=()=>[];await assert.rejects(root.NovaFlowFoartTools.execute({action:'particle',operation:'export_sequence'},{requirements:'导出粒子'}),/原生导出入口/);
 assert.equal(root.NovaFlowAgentExportSession,null);
});
test('particle export parameters remain native, bounded and transparent MP4 is rejected',()=>{
 const ctx={schema:FOART_TOOL_SCHEMA,controls:[],particle:{config:{}}};
 validateFoartPlan(plan({action:'particle',operation:'export_sequence',fps:12,seconds:1,width:256,height:256,transparent:true}),ctx);
 validateFoartPlan(plan({action:'particle',operation:'export_sequence',fileName:'orange-particle'}),ctx);
 for(const fileName of ['../outside','C:\\secret','  padded','..'])assert.throws(()=>validateFoartPlan(plan({action:'particle',operation:'export_sequence',fileName}),ctx));
 for(const op of [{operation:'export_video',width:4096},{operation:'export_video',format:'mp4',transparent:true},{operation:'export_sequence',fps:0},{operation:'export_config',seconds:2}])assert.throws(()=>validateFoartPlan(plan({action:'particle',...op}),ctx));
});

test('media planning omits inactive art prompts/layers and the covered animation editor',()=>{
 const root=load();root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA,FOART_ART_ACTIONS:['split']};
 root.__NovaFlowArtGenerate={state:{provider:'local',prompt:'irrelevant draft'.repeat(10000)},captureContext:()=>({generationSurface:'drawing'}),references:()=>[],selectedResult:()=>null};
 root.NovaFlowSpineSplitBridge={getState:()=>({parts:Array.from({length:60},(_,i)=>({id:'unrelated-'+i,label:'unrelated layer'}))})};
 root.NovaFlowMediaAgent={capture:()=>({artContext:{active:true,sub:'audio',audio:{},audioResources:[],audioSettings:{}}})};
 root.NovaFlowSkeletonEditor={active:()=>true,api:()=>({agentContext:()=>{throw Error('covered editor must not be serialized');}})};
 const context=root.NovaFlowFoartTools.capture();assert.equal(context.art.surface,'inactive');assert.equal(context.art.prompt,undefined);assert.equal(context.artEditor,null);assert.equal(context.animation,null);assert.ok(JSON.stringify(context).length<1800);
});
