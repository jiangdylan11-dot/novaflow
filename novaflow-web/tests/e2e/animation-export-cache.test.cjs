'use strict';
// Extract only reviewed functions from the isolated candidate. All projects,
// pixels and the output writer below are synthetic and live in memory.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'../../renderer').replace(/\\/g,'/')+'/';
const source=fs.readFileSync(root+'spine-skeleton-editor.js','utf8');
vm.runInThisContext(fs.readFileSync(root+'spine-sequence-atlas.js','utf8'));
const actualAtlas=globalThis.NovaFlowSequenceAtlas;
const a=source.indexOf('  function createExportImageCache('),b=source.indexOf('  function setProjectExport(',a);
assert(a>=0&&b>a,'candidate extraction markers missing');
let parseCount=0,readCount=0,clears=0,writerDisposals=0;
class TrackedMap extends Map {clear(){clears++;super.clear()}}
const pageWidth=32,pageHeight=32,pagePixels=new Uint8ClampedArray(pageWidth*pageHeight*4);
for(let i=0;i<pagePixels.length;i+=4){pagePixels[i]=(i/4)&255;pagePixels[i+1]=30;pagePixels[i+2]=80;pagePixels[i+3]=255}
const page={width:pageWidth,height:pageHeight,data:pagePixels};
const regions=new Map();for(let i=0;i<102;i++)regions.set('image_'+i,{x:(i%8)*4,y:(Math.floor(i/8)%8)*4,w:4,h:4,origW:4,origH:4,offX:0,offY:0,rotate:false,page:'atlas.png'});
const atlas={...actualAtlas,createWriter(options){const w=actualAtlas.createWriter(options);return {...w,dispose(){writerDisposals++;w.dispose()}}}};
const sandbox={console,Map:TrackedMap,Uint8ClampedArray,DOMException,performance,setTimeout,TextEncoder,
 document:{createElement(type){assert.equal(type,'canvas');let width=0,height=0,img=null;return {get width(){return width},set width(x){width=x},get height(){return height},set height(x){height=x},getContext(){return {drawImage(x){img=x},getImageData(){readCount++;return {data:new Uint8ClampedArray(img.data)}}}}}}},
 Attach:{parseAtlas(){parseCount++;return regions}},window:{NovaFlowSequenceAtlas:atlas},
 Ops:{exportable:x=>JSON.parse(JSON.stringify(x))},state:{},rt:{atlas:null},
 lower:x=>String(x||'').toLowerCase(),baseName:x=>String(x).split('/').pop(),pagePma:()=>false,
 exportImageNames:json=>[...new Set(json.skins.flatMap(s=>Object.values(s.attachments||{}).flatMap(group=>Object.entries(group).map(([name,a])=>a.path||a.name||name))))],
 regionPixelsCanvas(){throw Error('unexpected per-attachment canvas fallback')},unpremultiply(){throw Error('unexpected PMA')},
 imageFromBlob(){throw Error('unexpected bitmap')},AudioAssets:{path:()=>''},fetch(){throw Error('unexpected network')}
};
vm.createContext(sandbox);
// exportProject keeps mesh images untrimmed (797135af); its helper sits just above exportImageNames.
const m=source.indexOf('  function meshImageNames('),n=source.indexOf('  /** The images the attachments use',m);assert(m>=0&&n>m,'meshImageNames marker missing');
vm.runInContext(source.slice(m,n)+source.slice(a,b),sandbox,{filename:'isolated-editor-export'});
function project(count){const attachments={};for(let i=0;i<count;i++)attachments['image_'+i]={path:'image_'+i,width:4,height:4};return {atlasText:'synthetic',images:new Map([['atlas.png',{img:page}]]),json:{skeleton:{spine:'3.8.99'},bones:[{name:'root'}],slots:[{name:'slot',bone:'root',attachment:'image_0'}],skins:[{name:'default',attachments:{slot:attachments}}],animations:{}},audio:new Map()}}
async function run(count,fail=false){const files=new Map(),name='p'+count;return sandbox.exportProject({project:project(count),name,packed:true,settings:{maxWidth:512,maxHeight:512,dedupe:false}},async(n,d)=>{if(fail&&n.endsWith('.png'))throw Error('synthetic disk write failure');files.set(n,d)}).then(result=>({result,files}))}
(async()=>{
 for(const count of [91,102]){const {result,files}=await run(count);assert.equal(result.images,count);assert.equal(result.missing.length,0);const json=JSON.parse(files.get('p'+count+'.json')),atlasText=String(files.get('p'+count+'.atlas'));assert.equal(Object.keys(json.skins[0].attachments.slot).length,count);for(let i=0;i<count;i++)assert(atlasText.includes('\nimage_'+i+'\n'));assert([...files.keys()].some(n=>n.endsWith('.png')))}
 assert.equal(parseCount,2,'atlas should be parsed once per project');assert.equal(readCount,2,'atlas page should be read once per project');assert.equal(writerDisposals,2);assert.equal(clears,2);
 await assert.rejects(run(8,true),/synthetic disk write failure/);assert.equal(writerDisposals,3,'failed export must dispose writer');assert.equal(clears,3,'failed export must release page cache');
 console.log(JSON.stringify({synthetic:true,projects:[91,102],atlasParses:parseCount-1,pageReads:readCount-1,attachmentsRetained:true,writerAndCacheDisposedOnSuccessAndFailure:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
