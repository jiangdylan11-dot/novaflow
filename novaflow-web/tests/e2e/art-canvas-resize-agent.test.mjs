import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../renderer/spine-split-runtime.js',import.meta.url),'utf8');
test('agent size runs the original canvas expansion and preserves centered source pixels',async()=>{
 const draws=[],messages=[];let dialogs=0;const noop=()=>{};
 const state={source:{dataUrl:'original'},parts:[],splitSets:[]};
 const root={state,sourceSize:async()=>({width:512,height:512}),sourceFullCanvas:async()=>({kind:'original'}),canvasOfSize:(width,height)=>({getContext:()=>({drawImage:(...args)=>draws.push(args)}),toDataURL:()=>`png:${width}x${height}`}),showCanvasResizeDialog:async()=>{dialogs++;return {width:768,height:512,anchor:'center'};},splitSetById:()=>null,normalizeSpineLayerOrder:x=>x,cacheTempSplitPackage:async()=>{},refreshSplitPreview:async()=>{},setMessage:(text,error)=>messages.push({text,error})};
 for(const name of ['syncActiveSourceResourceFromState','resetSelectionTool','resetMaskEditor','resetPenTool','syncActiveSplitSet','resetSplitCanvasViewport','render','updatePreviewOverlay','syncSplitWorkspace'])root[name]=noop;
 vm.createContext(root);vm.runInContext(source.slice(source.indexOf('  function normalizeCanvasResizeAnchor('),source.indexOf('  function shiftPartForCanvasResize('))+source.slice(source.indexOf('  async function executeCanvasResizeTool('),source.indexOf('  function imageOutpaintNextSize(')),root);
 await root.executeCanvasResizeTool({width:640,height:512,anchor:'center'});assert.equal(dialogs,0);assert.equal(state.source.dataUrl,'png:640x512');assert.deepEqual(draws[0],[{kind:'original'},64,0]);assert.equal(state.sourceSize.width,640);
 await root.executeCanvasResizeTool({width:480,height:512,anchor:'center'});assert.equal(state.source.dataUrl,'png:640x512');assert.equal(messages.at(-1).error,true);
 await assert.rejects(root.executeCanvasResizeTool({width:8193,height:512}),/参数无效/);
 await root.executeCanvasResizeTool();assert.equal(dialogs,1);
});
