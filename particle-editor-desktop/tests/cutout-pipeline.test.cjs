const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../particle-editor/ai-sequence-cutout-pipeline.js'),'utf8');
function fixture(){
 const readers=new Map(),cache=new Map(),calls=[],frames=new Map([0,1,2].map(i=>[i,{frame:{width:1,height:1,data:new Uint8ClampedArray([i,0,0,255])}}]));
 const canvas=()=>({getContext:()=>({putImageData(){}})});let current=true;
 class ImageData{constructor(data,width,height){Object.assign(this,{data,width,height})}}
 const api={referenceFrameIndices:()=>[0,2],parallelism:()=>2,registerPreparedFrame:(f,reader)=>{readers.set(f,reader);return()=>readers.delete(f)},createFrameCache:()=>({put:async(k,v)=>cache.set(k,v),get:async k=>cache.get(k),delete:k=>cache.delete(k),clear:()=>cache.clear()}),prepareSequenceReference:s=>{assert.notEqual(s.frames,frames);assert(s.masks.has(0)&&s.masks.has(2));return{}},renderAsync:async(f,o)=>{calls.push(f);return{rawPixels:new Uint8ClampedArray([200,100,50,128]),rgbaCanvas:o.rgbaCanvas,screen:{kind:'green'}}}};
 const root={NovaFlowGreenScreenMatting:api};vm.runInNewContext(source,{window:root,document:{createElement:canvas},performance,console,Uint8ClampedArray,ImageData,ArrayBuffer});
 const pipeline=root.NovaFlowCutoutPipeline.create({frames,width:1,height:1,preserveShadow:false,active:()=>current});
 const add=ids=>pipeline.add({decodedFrameIndices:ids,width:1,height:1,alphaBytes:new Uint8Array(ids.map(i=>i+1))});
 return{readers,frames,calls,cache,pipeline,add,canvas,cancel:()=>current=false};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('prewarm waits for complete reference masks, reuses results, and bypasses changed edit settings',async()=>{
 const f=fixture();f.add([1]);await flush();assert.equal(f.calls.length,0);f.add([0,2]);await flush();assert.equal(f.calls.length,3);
 assert(f.pipeline.commit(new Map([0,1,2].map(i=>[i,new Uint8ClampedArray([i+1])]))));
 const read=f.readers.get(f.frames.get(0).frame),options={preserveShadow:false,rgbaCanvas:f.canvas(),maskCanvas:f.canvas()};
 assert.equal(await read({...options,frameEdit:{}}),null);assert.equal(await read({...options,preserveShadow:true}),null);
 const hit=await read(options);assert.equal(hit.finalAlpha[0],128);assert.equal(f.calls.length,3);assert.equal(f.cache.has('0'),false);
 f.pipeline.stop();assert.equal(f.readers.size,0);assert.equal(f.cache.size,0);
});
test('mismatched final masks and canceled sessions cannot return provisional cached frames',async()=>{
 const f=fixture();f.add([0,1,2]);await flush();assert.equal(f.pipeline.commit(new Map([[0,new Uint8ClampedArray([9])]])),false);assert.equal(f.readers.size,0);assert.equal(f.cache.size,0);
 const g=fixture();g.cancel();g.add([0,1,2]);await flush();assert.equal(g.calls.length,0);assert.equal(g.pipeline.commit(new Map()),false);g.pipeline.stop();
});
