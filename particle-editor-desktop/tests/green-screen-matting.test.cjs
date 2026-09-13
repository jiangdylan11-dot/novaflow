const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const holder={exports:{}};
new Function('module',fs.readFileSync(path.join(__dirname,'../../particle-editor/ai-sequence-green-screen-matting.js'),'utf8'))(holder);
const {matte,detectScreen,applyBrush}=holder.exports;
const fixture=()=>{const data=new Uint8ClampedArray(32*32*4);for(let i=0;i<data.length;i+=4)data.set([4,179,21,255],i);return {width:32,height:32,data};};
test('blue screen accepts native ImageData-style inherited dimensions',()=>{
  const f=fixture();for(let i=0;i<f.data.length;i+=4)[f.data[i+1],f.data[i+2]]=[f.data[i+2],f.data[i+1]];
  f.data.set([230,170,20,255],(16*32+16)*4);
  const nativeLike=Object.create({get width(){return 32;},get height(){return 32;}});nativeLike.data=f.data;
  assert.equal(Object.hasOwn(nativeLike,'width'),false);
  const actual=matte(nativeLike),expected=matte(f);
  assert.equal(actual.alpha.length,1024);assert.deepEqual(actual.alpha,expected.alpha);assert.deepEqual(actual.data,expected.data);
});
test('uniform screen is removed; dark and colored opaque subject pixels retain exact color',()=>{
  const f=fixture();f.data.set([20,10,18,255],(16*32+16)*4);f.data.set([180,50,200,255],(16*32+17)*4);
  const r=matte(f);assert.equal(r.alpha[0],0);assert.deepEqual([...r.data.slice((16*32+16)*4,(16*32+18)*4)],[20,10,18,255,180,50,200,255]);
});
test('faint blue emission gets soft alpha and clean bright RGB, avoiding a dark band on gray',()=>{
  const f=fixture(),p=16*32+16;f.data.set([12,174,83,255],p*4);
  const r=matte(f),a=r.alpha[p]/255;assert(a>.1&&a<.4);assert(r.data[p*4+2]>245);
  const blue=r.data[p*4+2]*a+128*(1-a);assert(blue>150);
});
test('real compressed screen fluctuation does not become a colored transparent speck',()=>{
  const f=fixture(),p=16*32+16;f.data.set([8,176,22,255],p*4);
  assert.equal(matte(f).alpha[p],0);
});

test('green and blue padded clips remove both screen shades without changing the embedded subject and light',()=>{
  for(const swap of [false,true]){
    const width=96,height=96,outer=[0,212,11],inner=[0,207,24];
    const make=padded=>{const data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([...(padded&&(y<30||y>=80)?outer:inner),255],(y*width+x)*4);
      data.set([200,80,120,255],(48*width+48)*4);
      data.set([9,199,100,255],(55*width+55)*4);
      if(swap)for(let i=0;i<data.length;i+=4)[data[i+1],data[i+2]]=[data[i+2],data[i+1]];
      return{width,height,data};};
    const plain=matte(make(false)),padded=matte(make(true));
    for(const p of [48*width+48,55*width+55])assert.deepEqual([...padded.data.slice(p*4,p*4+4)],[...plain.data.slice(p*4,p*4+4)]);
    for(const p of [10*width+10,40*width+10,75*width+85])assert.equal(padded.alpha[p],0,'padding color must not leave a tinted rectangle');
  }
});

test('light particles touching one border do not switch off screen detection for that frame',()=>{
  const f=fixture();for(let y=0;y<2;y++)for(let x=0;x<(y?f.width/2:f.width);x++)f.data.set([245,190,60,255],(y*f.width+x)*4);
  assert.equal(detectScreen(f)?.kind,'green');assert.equal(matte(f).alpha[16*f.width+16],0);
  assert.equal(matte(f).alpha[5],255,'bright border emission remains visible');
});
test('cyan emission stays translucent and continuous across the green/blue crossover',()=>{
  const samples=[[7,164,168,255],[7,168,168,255],[7,172,168,255]];
  const alphas=samples.map(pixel=>{const f=fixture(),p=16*32+16;for(let y=9;y<24;y++)for(let x=9;x<24;x++)f.data.set(pixel,(y*32+x)*4);const r=matte(f);assert(r.data[p*4+2]>=245,'glow must not become a dark opaque contour');return r.alpha[p];});
  assert(alphas.every(a=>a>=150&&a<=180),`cyan glow became opaque: ${alphas}`);
  assert(Math.max(...alphas)-Math.min(...alphas)<10,`opacity jumps at G=B: ${alphas}`);
});
test('isolated cool pixels within a character are not mistaken for cyan emission',()=>{
  const f=fixture();for(let y=4;y<28;y++)for(let x=4;x<28;x++)f.data.set([180,100,170,255],(y*32+x)*4);
  const p=16*32+16;f.data.set([53,80,100,255],p*4);assert.deepEqual([...matte(f).data.slice(p*4,p*4+4)],[53,80,100,255]);
});
test('bright blade core and purple character remain opaque and keep source color',()=>{
  for(const pixel of [[195,227,247,255],[70,30,110,255],[210,160,220,255]]){
    const f=fixture(),p=16*32+16;f.data.set(pixel,p*4);assert.deepEqual([...matte(f).data.slice(p*4,p*4+4)],pixel);
  }
});
test('transparent assets and nonuniform natural green scenes do not automatically key',()=>{
  const f=fixture();for(let i=3;i<f.data.length;i+=4)f.data[i]=100;assert.equal(detectScreen(f),null);
  const g=fixture();for(let i=0;i<g.data.length;i+=4)g.data[i+1]=(i%24<12)?110:220;assert.equal(detectScreen(g),null);
});
test('eraser feather changes alpha proportionally and restore recovers source RGB',()=>{
  const f=fixture(),p=16*32+16;f.data.set([180,50,200,255],p*4);const r=matte(f),overlay=new Uint8ClampedArray(f.data.length);
  overlay.set([0,0,0,128],p*4);applyBrush(r,overlay,f.data);assert.equal(r.alpha[p],127);assert.equal(r.data[p*4],180);
  overlay.fill(0);overlay.set([255,255,255,255],0);applyBrush(r,overlay,f.data);assert.equal(r.alpha[0],255);assert.deepEqual([...r.data.slice(0,4)],[4,179,21,255]);
});

const solidScreen=rgb=>{const f=fixture();for(let i=0;i<f.data.length;i+=4)f.data.set([...rgb,255],i);return f;};
test('black, white and blue backgrounds are detected from uniform border pixels',()=>{
  for(const [kind,rgb] of [['black',[3,3,3]],['white',[250,250,250]],['blue',[4,21,179]]]){
    const f=solidScreen(rgb);assert.equal(detectScreen(f).kind,kind);assert.equal(matte(f).alpha[0],0);
  }
});
test('black and white unassociation reconstructs soft colored light without matte contamination',()=>{
  for(const bg of [[0,0,0],[255,255,255],[5,5,5],[248,248,248]]){
    const f=solidScreen(bg),p=16*32+16,foreground=[0,180,255],opacity=.3;
    const observed=foreground.map((v,c)=>Math.round(v*opacity+bg[c]*(1-opacity)));
    f.data.set([...observed,255],p*4);const r=matte(f),a=r.alpha[p]/255;
    assert(Math.abs(a-opacity)<.012,`incorrect soft alpha on ${bg}: ${a}`);
    for(let c=0;c<3;c++){
      assert(Math.abs(r.data[p*4+c]-foreground[c])<5,'background color remains in RGB');
      assert(Math.abs(r.data[p*4+c]*a+bg[c]*(1-a)-observed[c])<1.5,'source appearance not preserved');
    }
  }
});
test('AI subject opacity preserves dark and green solid material including its antialiased outline',()=>{
  for(const bg of [[0,0,0],[255,255,255]]){
    const f=solidScreen(bg),mask=new Uint8ClampedArray(32*32),p=16*32+16;
    const body=[20,85,35];f.data.set([...body,255],p*4);mask[p]=255;
    // The same solid material at a half-covered boundary must not turn into a bright rim.
    const edge=body.map((v,c)=>Math.round(v*.5+bg[c]*.5));f.data.set([...edge,255],(p+1)*4);mask[p+1]=128;
    const r=matte(f,{subjectMask:{data:mask,width:32,height:32}});
    assert.deepEqual([...r.data.slice(p*4,p*4+4)],[...body,255]);
    assert.equal(r.alpha[p+1],128);
    for(let c=0;c<3;c++)assert(Math.abs(r.data[(p+1)*4+c]-body[c])<=2);
  }
});
test('AI mode waits for its actual mask on neutral backgrounds while pure-effect mode needs no mask',()=>{
  for(const rgb of [[0,0,0],[255,255,255]]){const f=solidScreen(rgb);assert.equal(matte(f,{requireSubjectMask:true}),null);assert(matte(f));}
});
test('blue background does not remove an opaque green subject',()=>{
  const f=solidScreen([4,21,179]),p=16*32+16;f.data.set([20,180,45,255],p*4);
  assert.deepEqual([...matte(f).data.slice(p*4,p*4+4)],[20,180,45,255]);
});
test('white-on-white light with no contrast is not invented; a supplied subject matte can retain a white solid',()=>{
  const f=solidScreen([255,255,255]),p=16*32+16;assert.equal(matte(f).alpha[p],0);
  const data=new Uint8ClampedArray(32*32);data[p]=255;
  assert.deepEqual([...matte(f,{subjectMask:{data,width:32,height:32}}).data.slice(p*4,p*4+4)],[255,255,255,255]);
});
test('detached model specks do not become opaque dark dots around a real subject',()=>{
  const f=solidScreen([0,0,0]),data=new Uint8ClampedArray(32*32);
  for(let y=12;y<24;y++)for(let x=12;x<24;x++){const p=y*32+x;data[p]=255;f.data.set([30,90,45,255],p*4);}
  const p=8*32+8;data[p]=255;f.data.set([2,2,2,255],p*4);
  const r=matte(f,{subjectMask:{data,width:32,height:32}});
  assert.equal(r.alpha[p],0);assert.equal(r.alpha[16*32+16],255);
});

test('neutral screen codec excursions cannot create opaque holes in soft colored emission',()=>{
  for (const [bg,pixel] of [[[1,1,1],[24,10,0]],[[254,254,254],[231,245,255]]]) {
    const f=solidScreen(bg),p=16*32+16;f.data.set([...pixel,255],p*4);
    const r=matte(f);assert(r.alpha[p]>10&&r.alpha[p]<35,`codec excursion forced opaque light: ${r.alpha[p]}`);
    const a=r.alpha[p]/255;
    for(let c=0;c<3;c++) assert(Math.abs(r.data[p*4+c]*a+bg[c]*(1-a)-pixel[c])<2);
  }
});
