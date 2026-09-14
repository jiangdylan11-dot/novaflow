const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const holder={exports:{}};
new Function('module',fs.readFileSync(process.env.NF_MATTING_TEST_CORE||path.join(__dirname,'../../particle-editor/ai-sequence-green-screen-matting.js'),'utf8'))(holder);
const {matte}=holder.exports;

function scene(emission=0,color=[1,.75,.06],swap=false,external=color){
  const width=160,height=160,bg=[0,210/255,12/255],data=new Uint8ClampedArray(width*height*4),mask=new Uint8Array(width*height);
  function set(x,y,rgb,m=0){const p=y*width+x;data.set([...rgb.map(v=>Math.round(v*255)),255],p*4);mask[p]=m;}
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)set(x,y,bg);
  for(let y=20;y<110;y++)for(let x=60;x<100;x++)set(x,y,[.8,.5,.65],255);
  for(let y=60;y<130;y++)for(let x=100;x<135;x++)set(x,y,[.88,.82,.96],255);
  // Known neutral 35% shadow with spatially varying screen contamination.
  // It is generated independently of the recovery algorithm.
  for(let y=100;y<151;y++)for(let x=15;x<56;x++){
    const cast=[.025,0,.30+.45*(x-15)/40],a=.35;
    set(x,y,bg.map((v,c)=>v*(1-a)+cast[c]*a+emission*color[c]));
  }
  // A separate, visible light measures the effect hue. It may change while
  // the shadow stays unchanged; that must not change the shadow's colour.
  for(let y=20;y<50;y++)for(let x=15;x<40;x++)set(x,y,bg.map((v,c)=>v*.25+external[c]*.75));
  if(swap)for(let i=0;i<data.length;i+=4)[data[i+1],data[i+2]]=[data[i+2],data[i+1]];
  return {frame:{width,height,data},subjectMask:{width,height,data:mask}};
}
const sequenceOf=(...samples)=>({frames:new Map(samples.map((s,i)=>[i,{frame:s.frame}])),masks:new Map(samples.map((s,i)=>[i,s.subjectMask.data])),maskWidth:160,maskHeight:160});

test('a light crossing a contaminated shadow keeps its hue and the known absorption',()=>{
  for(const [color,swap] of [[[1,.75,.06],false],[[.04,.85,1],false],[[1,1,1],false],[[.04,.08,1],true]]){
    const ref=scene(0,color,swap),sequence=sequenceOf(ref,ref);
    for(const emission of [0,.03,.08,.14,.20]){
      const sample=scene(emission,color,swap),r=matte(sample.frame,{subjectMask:sample.subjectMask,sequence});
      const expected=swap?[color[0],color[2],color[1]]:color;
      for(const x of [27,36,45]){
        const p=125*160+x,a=r.alpha[p]/255;
        assert(Math.abs(a-.35)<.045,`shadow opacity ${a} at emission ${emission} ${color}`);
        for(let c=0;c<3;c++){
          const energy=r.data[p*4+c]*a;
          assert(Math.abs(energy-emission*expected[c]*255)<7,`shadow invented light: ${energy}, expected ${emission*expected[c]*255}, hue ${color}, channel ${c}, swap ${swap}`);
        }
      }
    }
  }
});

test('changing a separate light cannot flash an unchanged shadow',()=>{
  const ref=scene(),sequence=sequenceOf(ref,ref);let previous;
  for(let b=.02;b<1;b+=.04){
    const s=scene(0,[1,.75,.06],false,[1,.8,b]),r=matte(s.frame,{subjectMask:s.subjectMask,sequence});
    const values=[];
    for(let y=116;y<137;y++)for(let x=25;x<47;x++){
      const p=y*160+x,a=r.alpha[p]/255;
      for(let c=0;c<3;c++)values.push(r.data[p*4+c]*a+128*(1-a));
    }
    if(previous)assert(Math.max(...values.map((v,i)=>Math.abs(v-previous[i])))<2,'unrelated light recoloured the shadow');
    previous=values;
  }
});

test('shadow calibration is deterministic on backward seeking and leaves vacated background clear',()=>{
  const ref=scene(),lit=scene(.14),sequence=sequenceOf(ref,lit);
  const first=matte(lit.frame,{subjectMask:lit.subjectMask,sequence});
  matte(ref.frame,{subjectMask:ref.subjectMask,sequence});
  assert.deepEqual(matte(lit.frame,{subjectMask:lit.subjectMask,sequence}).data,first.data);
  const clear=scene();
  for(let y=100;y<151;y++)for(let x=15;x<56;x++)clear.frame.data.set([0,210,12,255],(y*160+x)*4);
  const r=matte(clear.frame,{subjectMask:clear.subjectMask,sequence});
  assert.equal(r.alpha[125*160+36],0,'reference must not paint an old shadow into empty background');
});
