import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('native preview normalization shares the reserved height without repeatedly clearing WebGL',()=>{
 const source=readFileSync(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');
 const start=source.indexOf('  function normalizeSkeletonPreviewStageFrame('),end=source.indexOf('  function getSkeletonPreviewOfficialProxy(',start);
 class Element {
  constructor(){this.attrs=new Map();}
  getAttribute(k){return this.attrs.get(k)||null;}
  getBoundingClientRect(){return {width:600,height:800};}
  closest(){return null;}
  querySelectorAll(){return [];}
 }
 class Canvas extends Element {constructor(){super();this.width=600;this.height=800;this.resizes=0;}dispatchEvent(){this.resizes++;}}
 const stage=new Element(),canvas=new Canvas();canvas.parentElement=stage;
 stage.querySelectorAll=q=>q==='canvas'?[canvas]:[];stage.attrs.set('data-novaflow-motion-preview-height','400');
 const c=vm.createContext({HTMLElement:Element,HTMLCanvasElement:Canvas,Event:class{},window:{devicePixelRatio:1},
  hideSkeletonPreviewCenterCross(){},setImportantStyles(){},isVisible:()=>true,
  setAttributeIfChanged:(n,k,v)=>n.attrs.set(k,v),removeAttributeIfPresent:(n,k)=>n.attrs.delete(k),getSkeletonPreviewOfficialPlayer:()=>null});
 vm.runInContext(source.slice(start,end),c);
 for(let i=0;i<100;i++)c.normalizeSkeletonPreviewStageFrame(stage,null);
 assert.equal(canvas.height,400);assert.equal(canvas.resizes,1);
 stage.attrs.delete('data-novaflow-motion-preview-height');c.normalizeSkeletonPreviewStageFrame(stage,null);
 assert.equal(canvas.height,800);assert.equal(canvas.resizes,2);
});
