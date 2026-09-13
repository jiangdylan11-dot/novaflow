const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const holder={exports:{}};new Function('module',fs.readFileSync(path.join(__dirname,'../../particle-editor/ai-sequence-green-screen-matting.js'),'utf8'))(holder);
const {matte,removeShadowAlpha,applyBrush}=holder.exports;
function fixture(bg=[4,190,15]) {
  const width=80,height=80,data=new Uint8ClampedArray(width*height*4),mask=new Uint8ClampedArray(width*height),alpha=new Uint8ClampedArray(width*height);
  for(let p=0;p<alpha.length;p++)data.set([...bg,255],p*4);
  for(let y=16;y<61;y++)for(let x=30;x<50;x++){const p=y*width+x;data.set([150,70,120,255],p*4);mask[p]=alpha[p]=255;}
  const pixels={shadow:65*width+20,darkSubject:57*width+35,cloth:59*width+45,light:65*width+57};
  const put=(p,color,a)=>{data.set([...color.map((v,c)=>Math.round(v*a+bg[c]*(1-a))),255],p*4);alpha[p]=Math.round(a*255);};
  put(pixels.shadow,[0,0,0],.4);put(pixels.darkSubject,[10,10,10],1);mask[pixels.darkSubject]=255;
  put(pixels.cloth,[215,215,230],.4);mask[pixels.cloth]=230;
  return{frame:{width,height,data},mask:{data:mask,width,height},alpha,pixels,put};
}
test('shadow preservation defaults on and explicitly on is byte-identical to previous matting',()=>{
  const f=fixture();assert.deepEqual(matte(f.frame),matte(f.frame,{preserveShadow:true}));
  assert.equal(removeShadowAlpha(f.frame,f.alpha,{}),f.alpha);
});
test('disable removes neutral floor shadow while preserving dark solid and translucent cloth',()=>{
  for(const bg of [[4,190,15],[4,15,190],[248,248,248]]){
    const f=fixture(bg),out=removeShadowAlpha(f.frame,f.alpha,{preserveShadow:false,subjectMask:f.mask});
    assert.equal(out[f.pixels.shadow],0);assert.equal(out[f.pixels.darkSubject],255);assert.equal(out[f.pixels.cloth],f.alpha[f.pixels.cloth]);
    assert.equal(f.alpha[f.pixels.shadow],102,'must not mutate reusable input alpha');
  }
});
test('shadow suppression protects cyan gold white emission on green and green emission on blue',()=>{
  for(const [bg,color] of [[[4,190,15],[10,210,255]],[[4,190,15],[255,180,20]],[[4,190,15],[255,255,255]],[[4,15,190],[10,255,30]]]){
    for(const strength of [.015,.04,.08,.2,.5,.8]){
      const f=fixture(bg);f.put(f.pixels.light,color,strength);
      const out=removeShadowAlpha(f.frame,f.alpha,{preserveShadow:false,subjectMask:f.mask});
      assert.equal(out[f.pixels.light],f.alpha[f.pixels.light],`${color} at ${strength}`);
    }
  }
});
test('blue/green source symmetry and lower-resolution AI protection agree',()=>{
  const f=fixture(),other=fixture([4,15,190]);
  for(let i=0;i<f.frame.data.length;i+=4){other.frame.data[i]=f.frame.data[i];other.frame.data[i+1]=f.frame.data[i+2];other.frame.data[i+2]=f.frame.data[i+1];}
  assert.deepEqual(removeShadowAlpha(f.frame,f.alpha,{preserveShadow:false,subjectMask:f.mask}),removeShadowAlpha(other.frame,other.alpha,{preserveShadow:false,subjectMask:other.mask}));
  const small=new Uint8ClampedArray(40*40);for(let y=8;y<31;y++)for(let x=15;x<25;x++)small[y*40+x]=255;
  const out=removeShadowAlpha(f.frame,f.alpha,{preserveShadow:false,subjectMask:{width:40,height:40,data:small}});
  assert.equal(out[f.pixels.cloth],f.alpha[f.pixels.cloth]);assert.equal(out[f.pixels.darkSubject],255);assert.equal(out[f.pixels.shadow],0);
});
test('black screens and uncertain backgrounds are left for manual editing',()=>{
  const f=fixture([0,0,0]);assert.equal(removeShadowAlpha(f.frame,f.alpha,{preserveShadow:false,subjectMask:f.mask}),f.alpha);
  const white=fixture([255,255,255]);assert.equal(removeShadowAlpha(white.frame,white.alpha,{preserveShadow:false}),white.alpha);
  f.frame.data.fill(120);assert.equal(removeShadowAlpha(f.frame,f.alpha,{preserveShadow:false,subjectMask:f.mask}),f.alpha);
});
test('manual restore and feather can override automatic shadow removal',()=>{
  const f=fixture(),p=f.pixels.shadow;f.put(p,[8,6,14],.45);
  const out=matte(f.frame,{preserveShadow:false,subjectMask:f.mask});assert.equal(out.alpha[p],0);
  const brush=new Uint8ClampedArray(f.frame.data.length);brush.set([255,255,255,128],p*4);
  applyBrush(out,brush,out.shadowRestoreData||f.frame.data);assert.equal(out.alpha[p],128);
});

test('connected shadow is fully cleared through its faint compressed fringe, with cloth and glow boundaries intact',()=>{
  const f=fixture([2,210,10]),foreground=new Uint8ClampedArray(f.frame.data.length),shadow=[];
  // A dark core meets a low-opacity, color-contaminated border. The small AI
  // confidence on that border used to leave a visible outline after removal.
  for(let y=42;y<67;y++)for(let x=8;x<23;x++){
    const p=y*80+x,edge=x<14;
    f.put(p,[0,0,0],edge?.04:.35);
    if(edge){f.frame.data.set([8,200,35,255],p*4);f.mask.data[p]=x;}
    foreground.set([0,0,0,f.alpha[p]],p*4);shadow.push(p);
  }
  const cloth=50*80+23,light=60*80+23;
  f.put(cloth,[210,210,220],.2);f.mask.data[cloth]=40;foreground.set([210,210,220,f.alpha[cloth]],cloth*4);
  f.put(light,[10,210,255],.015);foreground.set([10,210,255,f.alpha[light]],light*4);
  const out=removeShadowAlpha(f.frame,f.alpha,{preserveShadow:false,subjectMask:f.mask,foregroundData:foreground});
  assert(shadow.every(p=>out[p]===0),'faint connected border must disappear, not become a ring');
  assert.equal(out[cloth],f.alpha[cloth]);assert.equal(out[light],f.alpha[light]);
});
