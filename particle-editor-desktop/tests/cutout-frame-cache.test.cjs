const test=require('node:test'),assert=require('node:assert/strict');
global.ImageData=class ImageData{constructor(data,width,height){this.data=data;this.width=width;this.height=height;}};
const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../particle-editor/ai-sequence-green-screen-matting.js'),'utf8');
const loaded={exports:{}};new Function('module',source)(loaded);
const {createFrameCache}=loaded.exports;
const frame=(value=42)=>({width:16,height:16,imageData:new ImageData(new Uint8ClampedArray(16*16*4).fill(value),16,16),decodedFrameIndex:7,alphaFrameIndex:7,cacheFrameIndex:7,frameSyncVerified:true});
test('full resolution cache is lossless and returns independent pixel buffers',async()=>{
 const cache=createFrameCache(),original=frame();assert(await cache.put('source|settings|7',original));
 const result=await cache.get('source|settings|7');assert.deepEqual(result.imageData.data,original.imageData.data);assert.equal(result.decodedFrameIndex,7);assert.equal(result.frameSyncVerified,true);
 result.imageData.data[0]=0;assert.equal((await cache.get('source|settings|7')).imageData.data[0],42);
 assert.equal(await cache.get('different-source|settings|7'),null);assert.equal(await cache.get('source|changed-settings|7'),null);
});
test('clear and epoch prevent in-flight stale renders from repopulating cache',async()=>{
 const cache=createFrameCache(),epoch=cache.epoch,pending=cache.put('old',frame(),epoch);cache.clear();await pending;
 assert.equal(await cache.get('old'),null);assert.equal(await cache.put('late',frame(),epoch),false);
 await cache.put('current',frame());const read=cache.get('current');cache.clear();assert.equal(await read,null);
});
test('frame and byte budgets evict old entries without exceeding bounds',async()=>{
 const cache=createFrameCache({maxFrames:2,maxBytes:2048});await cache.put('a',frame(1));await cache.put('b',frame(2));await cache.get('a');await cache.put('c',frame(3));
 assert.equal(await cache.get('b'),null);assert.ok(await cache.get('a'));assert.equal(cache.stats().frames,2);assert.ok(cache.stats().bytes<=2048);
 const tiny=createFrameCache({maxBytes:1});assert.equal(await tiny.put('large',frame()),false);assert.equal(tiny.stats().bytes,0);
 const invalid=frame();invalid.width=17;assert.equal(await cache.put('invalid',invalid),false);
});

test('single-frame edits preserve other frames and reject pending stale writes',async()=>{
 const cache=createFrameCache(),a={...frame(10),decodedFrameIndex:1,cacheFrameIndex:1},b={...frame(20),decodedFrameIndex:2,cacheFrameIndex:2};
 await cache.put('clip|1',a);await cache.put('clip|2',b);
 const epoch=cache.epoch,pending=cache.put('clip|1',a,epoch);
 cache.invalidateFrame(1);await pending;
 assert.equal(await cache.get('clip|1'),null);
 assert.deepEqual((await cache.get('clip|2')).imageData.data,b.imageData.data);
 assert.equal(await cache.put('clip|1',a,epoch),false);
 assert(await cache.put('clip|1',{...a,imageData:frame(99).imageData}));
 assert.equal((await cache.get('clip|1')).imageData.data[0],99);
 assert.equal(cache.stats().frames,2);
});
