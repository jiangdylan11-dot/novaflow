const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadSpine}=require('../../tools/qwen-rapid-migration-smoke.cjs');
const s=loadSpine('particle-editor/spine-split-runtime.js');
function solid(w,h,rgb,a=255){const d=new Uint8ClampedArray(w*h*4);for(let i=0;i<d.length;i+=4)d.set([...rgb,a],i);return d;}
function rect(d,w,x,y,bw,bh,rgba){for(let yy=y;yy<y+bh;yy++)for(let xx=x;xx<x+bw;xx++)d.set(rgba,(yy*w+xx)*4);}
function fixture(){
 const w=160,h=100,box={x:80,y:20,width:30,height:50};
 const base=solid(w,h,[200,180,160]),generated=new Uint8ClampedArray(base),mask=solid(w,h,[0,0,0]);
 const source=solid(w,h,[0,0,0],0),foreground=solid(w,h,[0,0,0],0);
 rect(mask,w,85,25,20,45,[255,255,255,255]);
 rect(generated,w,80,23,33,47,[30,150,80,255]);
 rect(foreground,w,80,23,33,47,[30,150,80,255]);
 // Cast shadow extends much farther left than the reference footprint.
 rect(generated,w,32,70,78,7,[30,65,110,255]);
 return {w,h,box,base,generated,mask,source,foreground};
}
function run(f){return s.objectTransferScenePixels(f.base,f.generated,f.mask,f.source,f.foreground,f.w,f.h,f.box);}
test('complete generated edges are opaque beyond the reference silhouette',()=>{
 const f=fixture(),r=run(f);
 const i=(40*f.w+111)*4;
 assert.deepEqual(Array.from(r.pixels.slice(i,i+4)),[30,150,80,255]);
 assert.deepEqual(Array.from(f.base.slice(i,i+4)),[200,180,160,255]);
});
test('connected long shadow is retained and uses the receiving surface colour',()=>{
 const f=fixture(),r=run(f),i=(73*f.w+40)*4;
 assert.ok(r.stats.shadowPixels>300);
 assert.ok(r.pixels[i]<f.base[i]-30,'shadow survives beyond small contact ellipse');
 assert.ok(r.pixels[i]>r.pixels[i+1]&&r.pixels[i+1]>r.pixels[i+2],'blue model RGB does not replace warm surface colour');
 assert.ok(Math.abs(r.pixels[i]/r.pixels[i+2]-200/160)<0.025);
 assert.equal(r.pixels[i+3],255);
});
test('existing foreground and unrelated distant dark changes are protected',()=>{
 const f=fixture();
 rect(f.source,f.w,45,65,8,20,[255,255,255,255]);
 rect(f.generated,f.w,18,80,6,5,[0,0,0,255]);
 const r=run(f);
 for(const [x,y]of [[48,73],[20,82],[0,0],[150,10]]){
  const i=(y*f.w+x)*4;
  assert.deepEqual(Array.from(r.pixels.slice(i,i+4)),Array.from(f.base.slice(i,i+4)));
 }
});
test('modest background colour drift alone creates no cast shadow',()=>{
 const f=fixture();f.generated=solid(f.w,f.h,[190,173,158]);f.foreground=solid(f.w,f.h,[0,0,0],0);
 const r=run(f);
 assert.equal(r.stats.shadowPixels,0);
 const i=(75*f.w+95)*4;
 assert.deepEqual(Array.from(r.pixels.slice(i,i+4)),[200,180,160,255]);
});

test('shadow tint follows existing cool scene shadows instead of a fixed neutral colour',()=>{
 const f=fixture();
 rect(f.base,f.w,114,78,12,20,[105,120,130,255]);
 rect(f.generated,f.w,114,78,12,20,[105,120,130,255]);
 const r=run(f);
 assert.ok(r.stats.ambientTint[0]<1,'ambient red is reduced in the cool original shadow');
 assert.ok(r.stats.ambientTint[2]>1,'ambient blue is learned from the original scene');
 assert.ok(r.stats.shadowLimit<0.6);
 const outsideEdge=(69*f.w+40)*4,interior=(73*f.w+40)*4;
 assert.ok(r.pixels[outsideEdge]<f.base[outsideEdge],'shadow edges soften onto adjacent ground');
 assert.ok(r.pixels[outsideEdge]>r.pixels[interior],'penumbra remains lighter than the shadow interior');
});
