import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
// 美工生图面板收起时，小桃浮在拆分工作区上方：拖到小桃上的图片必须交给小桃，不能被工作区当原图导入。
const split=await readFile(new URL('../renderer/spine-split-runtime.js',import.meta.url),'utf8');
const agent=await readFile(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
const fn=name=>{const start=split.indexOf(`  function ${name}(`);assert.ok(start>=0,name);const end=split.slice(start).search(/\r?\n  \}\r?\n/);assert.ok(end>0,name);return split.slice(start,start+end)+'\n  }';};
function guard(){
  const calls={prevented:0};
  const body=[fn('isXiaotaoArtRuntimeElement'),fn('blockExternalSourceDragEvent')].join('\n');
  const make=new Function('state','stubs',`const {hasExternalSourceFileDrag,isObjectTransferUploadDialogEvent,isArtGenerateReferenceDropTarget,setGlobalSourceDragOver,isEventInsideSplitWorkspaceDropArea,isSplitEditToolActive,isLayerFileReplacementDrag,holdSplitCanvasSourceImportPanGuard,extendSplitSourceImportFitBlock}=stubs;${body};return blockExternalSourceDragEvent;`);
  const state={sourceDragOver:true};
  const block=make(state,{hasExternalSourceFileDrag:()=>true,isObjectTransferUploadDialogEvent:()=>false,isArtGenerateReferenceDropTarget:()=>false,setGlobalSourceDragOver:v=>{state.sourceDragOver=v;},
    isEventInsideSplitWorkspaceDropArea:()=>true,isSplitEditToolActive:()=>false,isLayerFileReplacementDrag:()=>false,holdSplitCanvasSourceImportPanGuard(){},extendSplitSourceImportFitBlock(){}});
  const ev=insideXiaotao=>({target:{closest:sel=>insideXiaotao&&/#nf-xiaotao-art-root/.test(sel)?{}:null},preventDefault(){calls.prevented++;},stopPropagation(){},dataTransfer:{}});
  return {block,ev,state,calls};
}
test('a file dragged onto 小桃 above the split workspace is left to 小桃',()=>{
  const g=guard();
  assert.equal(g.block(g.ev(true)),false);assert.equal(g.calls.prevented,0);assert.equal(g.state.sourceDragOver,false);
});
test('a file dropped on the workspace itself is still imported as a source',()=>{
  const g=guard();
  assert.equal(g.block(g.ev(false)),true);assert.equal(g.calls.prevented,1);
});
test('小桃 accepts drops on its whole panel, not only the input footer',()=>{
  assert.match(agent,/listen\(panel,'dragover'/);assert.match(agent,/listen\(panel,'drop'/);
  assert.doesNotMatch(agent,/listen\(footer,'drop'/);
});
