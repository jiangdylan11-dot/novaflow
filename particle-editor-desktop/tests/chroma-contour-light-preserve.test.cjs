const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const holder={exports:{}};
new Function('module',fs.readFileSync(process.env.NF_MATTING_TEST_CORE||path.join(__dirname,'../../particle-editor/ai-sequence-green-screen-matting.js'),'utf8'))(holder);
const {matte}=holder.exports;
function scene(color,swap=false,strip=false){
 const width=120,height=110,data=new Uint8ClampedArray(width*height*4),mask=new Uint8ClampedArray(width*height),bg=[0,155,16];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const solid=x>=30&&x<60&&y>=20&&y<90,light=x>=60&&x<(strip?63:103)&&y>=26&&y<82,p=y*width+x;
  const rgb=solid?[220,145,130]:light?color:bg;
  data.set([rgb[0],rgb[swap?2:1],rgb[swap?1:2],255],p*4);if(solid)mask[p]=255;
 }
 return {frame:{width,height,data},subjectMask:{width,height,data:mask}};
}
test('a real light keeps its soft edge beside a warm solid on green and blue screens',()=>{
 for(const swap of [false,true])for(const color of [[5,158,80],[80,158,5],[80,180,80]]){
  const s=scene(color,swap),r=matte(s.frame,{subjectMask:s.subjectMask});
  // The same source light beside and away from the object must composite the
  // same. This compares visible energy on dark and bright backgrounds.
  const remote=55*120+85;
  for(const x of [60,61,63,65,69,74]){
   const p=55*120+x;
   for(const bg of [0,128,255])for(let c=0;c<3;c++){
    const value=q=>r.data[q*4+c]*r.alpha[q]/255+bg*(1-r.alpha[q]/255);
    assert(Math.abs(value(p)-value(remote))<2,`light cut away at x=${x}, ${color}, swap=${swap}`);
   }
  }
  assert.deepEqual([...r.data.slice((55*120+45)*4,(55*120+45)*4+4)],swap?[220,130,145,255]:[220,145,130,255]);
 }
});
test('a darkened screen-coloured fringe still receives contour cleanup',()=>{
 for(const swap of [false,true]){
  const s=scene([10,125,80],swap,true),raw=matte(s.frame),r=matte(s.frame,{subjectMask:s.subjectMask}),p=55*120+61;
  assert(r.alpha[p]<raw.alpha[p]*.5,'retaining emission must not restore screen spill');
  assert.equal(r.alpha[55*120+65],0);
 }
});
test('a narrow bright fringe is not restored without nearby broad emission',()=>{
 for(const swap of [false,true]){
  const s=scene([5,158,80],swap,true),raw=matte(s.frame),r=matte(s.frame,{subjectMask:s.subjectMask}),p=55*120+61;
  assert(r.alpha[p]<raw.alpha[p]*.5,'a shared hue alone must not restore subject fringe');
 }
});
