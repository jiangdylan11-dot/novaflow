const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const holder = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '../../particle-editor/ai-sequence-green-screen-matting.js'), 'utf8'))(holder);
const { matte } = holder.exports;
function specimen(swap = false) {
  const width = 96, height = 96, bg = [0, 210, 12], data = new Uint8ClampedArray(width * height * 4), mask = new Uint8ClampedArray(width * height);
  const set = (x, y, color, alpha = 1, segmentation = 0) => {
    const p = y * width + x, rgb = color.map((v, c) => Math.round(v * alpha + bg[c] * (1 - alpha)));
    data.set([...rgb, 255], p * 4); mask[p] = segmentation;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, bg);
  for (let y = 15; y < 64; y++) for (let x = 20; x < 46; x++) set(x, y, [210, 130, 170], 1, 255);
  for (let y = 34; y < 65; y++) for (let x = 46; x < 72; x++) set(x, y, [225, 210, 245], 1, 255);
  for (let y = 65; y < 82; y++) for (let x = 46; x < 72; x++) set(x, y, [225, 210, 245], .25 + (81 - y) * .025, 255);
  // A generated shadow carries an unwanted blue cast, with known smooth opacity.
  for (let y = 70; y < 87; y++) for (let x = 8; x < 38; x++) set(x, y, [0, 0, 75], .12 + (86 - y) * .02);
  for (let y = 18; y < 34; y++) for (let x = 77; x < 88; x++) set(x, y, [10, 210, 255], .18 + (x - 77) * .025);
  if (swap) for (let i = 0; i < data.length; i += 4) [data[i + 1], data[i + 2]] = [data[i + 2], data[i + 1]];
  return { frame: { width, height, data }, subjectMask: { width, height, data: mask } };
}
test('neutralizes a measured shadow cast without deleting its opacity gradient', () => {
  const f = specimen(), result = matte(f.frame, { subjectMask: f.subjectMask });
  const values = [];
  for (let y = 71; y < 86; y++) {
    const p = y * 96 + 16, expected = .12 + (86 - y) * .02;
    assert(Math.max(...result.data.slice(p * 4, p * 4 + 3)) <= 3, 'shadow must remain neutral');
    assert(Math.abs(result.alpha[p] / 255 - expected) < .025, 'shadow opacity must remain continuous');
    values.push(result.alpha[p]);
  }
  assert(values.every((v, i) => !i || v <= values[i - 1]));
});
test('pale translucent material uses material alpha, not the opaque segmentation mask', () => {
  const f = specimen(), r = matte(f.frame, { subjectMask: f.subjectMask });
  const p = 77 * 96 + 58, expected = .25 + (81 - 77) * .025;
  assert(Math.abs(r.alpha[p] / 255 - expected) < .035);
  assert(Math.abs(r.data[p * 4 + 1] - 210) < 8, 'green screen cast remains in the fabric');
  assert.deepEqual([...r.data.slice((40 * 96 + 30) * 4, (40 * 96 + 30) * 4 + 4)], [210, 130, 170, 255]);
});
test('chroma recovery is symmetric for green/blue screens and retains real colored light', () => {
  const a = specimen(), b = specimen(true), ra = matte(a.frame, { subjectMask: a.subjectMask }), rb = matte(b.frame, { subjectMask: b.subjectMask });
  assert.deepEqual(ra.alpha, rb.alpha);
  for (let i = 0; i < ra.data.length; i += 4) assert.deepEqual([...ra.data.slice(i, i + 4)], [rb.data[i], rb.data[i + 2], rb.data[i + 1], rb.data[i + 3]]);
  const p = 25 * 96 + 82, baseline = matte(a.frame);
  assert.deepEqual([...ra.data.slice(p * 4, p * 4 + 4)], [...baseline.data.slice(p * 4, p * 4 + 4)]);
});
test('shadow off clears the recovered shadow and keeps translucent material', () => {
  const f = specimen(), on = matte(f.frame, { subjectMask: f.subjectMask }), off = matte(f.frame, { subjectMask: f.subjectMask, preserveShadow: false });
  assert.equal(off.alpha[78 * 96 + 16], 0);
  assert.equal(off.alpha[77 * 96 + 58], on.alpha[77 * 96 + 58]);
});

test('shadow recovery retains bright and faint cyan, gold, white and green emission', () => {
  for (const [swap, color] of [[false,[10,210,255]],[false,[255,180,20]],[false,[255,255,255]],[true,[10,255,30]]]) {
    const f=specimen(swap),bg=swap?[0,12,210]:[0,210,12];
    for(let y=65;y<87;y++)for(let x=76;x<92;x++){
      const a=x<84?.75:.04,p=y*96+x;
      f.frame.data.set([...color.map((v,c)=>Math.round(v*a+bg[c]*(1-a))),255],p*4);f.subjectMask.data[p]=0;
    }
    const baseline=matte(f.frame),out=matte(f.frame,{subjectMask:f.subjectMask});
    for(const x of [79,88]){
      const p=76*96+x,a=baseline.alpha[p]/255,b=out.alpha[p]/255;
      assert(Math.abs(b-a)<=5/255,`${color} changed light coverage at ${x}`);
      // Straight RGB is unstable near zero alpha. Visible composited energy,
      // on both light and dark backgrounds, is the relevant regression gate.
      for(const bg of [0,255])for(let c=0;c<3;c++){
        const previous=baseline.data[p*4+c]*a+bg*(1-a),current=out.data[p*4+c]*b+bg*(1-b);
        assert(Math.abs(current-previous)<=5,`${color} changed visible light on ${bg}`);
      }
    }
  }
});

function sequenceOf(...samples) {
  return {frames:new Map(samples.map((s,i)=>[i,{frame:s.frame}])),masks:new Map(samples.map((s,i)=>[i,s.subjectMask.data])),maskWidth:samples[0].frame.width,maskHeight:samples[0].frame.height};
}
test('unrelated changing light cannot recolour unchanged translucent material', () => {
  const a=specimen(),b=specimen();
  for(let y=18;y<34;y++)for(let x=77;x<88;x++)b.frame.data.set([220,230,40,255],(y*96+x)*4);
  const sequence=sequenceOf(a,b),p=77*96+58;
  const first=matte(a.frame,{subjectMask:a.subjectMask,sequence}),second=matte(b.frame,{subjectMask:b.subjectMask,sequence});
  assert(Number.isInteger(first.materialStats.referenceFrame),'the video must use its material reference');
  assert.deepEqual([...first.data.slice(p*4,p*4+4)],[...second.data.slice(p*4,p*4+4)]);
});
test('material reference is deterministic when frames are requested out of order', () => {
  const a=specimen(),b=specimen(),sequence=sequenceOf(a,b);
  const one=matte(b.frame,{subjectMask:b.subjectMask,sequence});
  matte(a.frame,{subjectMask:a.subjectMask,sequence});
  const two=matte(b.frame,{subjectMask:b.subjectMask,sequence});
  assert.deepEqual(one.data,two.data);
});
test('moving translucent material follows the source without retaining a previous-frame silhouette', () => {
  const a=specimen(),b=specimen();
  for(let y=0;y<96;y++)for(let x=95;x>=0;x--){
    const p=y*96+x;if(x>=2){b.frame.data.set(a.frame.data.slice((p-2)*4,(p-2)*4+4),p*4);b.subjectMask.data[p]=a.subjectMask.data[p-2];}
    else{b.frame.data.set([0,210,12,255],p*4);b.subjectMask.data[p]=0;}
  }
  const sequence=sequenceOf(a,b),one=matte(a.frame,{subjectMask:a.subjectMask,sequence}),two=matte(b.frame,{subjectMask:b.subjectMask,sequence});
  assert(Math.abs(one.alpha[77*96+58]-two.alpha[77*96+60])<8);
  assert.equal(two.alpha[30*96+20],0,'old silhouette must not remain at the vacated edge');
});
test('narrow cyan contamination loses opacity without filling nearby background', () => {
  const s=specimen();
  for(let y=20;y<60;y++)for(let x=18;x<21;x++)s.frame.data.set([18,190,160,255],(y*96+x)*4);
  const baseline=matte(s.frame),r=matte(s.frame,{subjectMask:s.subjectMask});
  const p=40*96+20;
  assert(r.alpha[p]<baseline.alpha[p]*.65,'the narrow contaminated contour remains');
  assert.equal(r.alpha[40*96+16],0,'cleanup must not expand the silhouette');
});

function movingFold(shift) {
    const w=160,h=160,data=new Uint8ClampedArray(w*h*4),mask=new Uint8Array(w*h),truth=new Float32Array(w*h),bg=[0,210,12],F=[225,210,245];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let alpha=0;
      if(x>25&&x<130&&y>20&&y<70)alpha=1;
      if(x>25&&x<130&&y>=70&&y<140)alpha=.5+.18*Math.sin((x-shift)*.35)+.025*Math.cos(y*.21);
      const p=y*w+x;data.set([...F.map((v,c)=>Math.round(alpha*v+(1-alpha)*bg[c])),255],p*4);mask[p]=alpha>0?255:0;truth[p]=alpha*255;
    }
    return {frame:{width:w,height:h,data},subjectMask:{width:w,height:h,data:mask},truth};
}

test('slowly moving translucent folds retain continuous known opacity', () => {
  // A continuous material moving by a tenth pixel per frame must not jump
  // between integer reference positions. Ground-truth alpha is analytic.
  const ref=movingFold(0),sequence=sequenceOf(ref,ref);
  let previous=null,error=0,temporalError=0,pixels=0;
  for(let step=0;step<=20;step++){
    const f=movingFold(step/10),out=matte(f.frame,{subjectMask:f.subjectMask,sequence});
    if(previous)for(let y=85;y<125;y++)for(let x=45;x<110;x++){
      const p=y*160+x,expectedChange=f.truth[p]-previous.truth[p];
      error+=Math.abs(out.alpha[p]-f.truth[p]);
      temporalError+=Math.abs(out.alpha[p]-previous.out.alpha[p]-expectedChange);pixels++;
    }
    previous={truth:f.truth,out};
  }
  assert(error/pixels<1.3,'fold opacity must follow the moving material');
  assert(temporalError/pixels<.8,'reference matching adds visible steps to smooth motion');
});

test('moving sparks do not displace unchanged folds and keep their own light', () => {
  const ref=movingFold(0),sequence=sequenceOf(ref,ref),base=matte(ref.frame,{subjectMask:ref.subjectMask,sequence});
  let drift=0,pixels=0;
  for(let n=0;n<10;n++){
    const f=movingFold(0),cx=51+n*5,cy=96+(n%3)*4;
    for(let y=cy-1;y<=cy+1;y++)for(let x=cx-1;x<=cx+1;x++)for(let c=0;c<3;c++){
      const i=(y*160+x)*4+c;f.frame.data[i]=Math.min(255,f.frame.data[i]+140);
    }
    const out=matte(f.frame,{subjectMask:f.subjectMask,sequence});
    for(let y=85;y<125;y++)for(let x=45;x<110;x++){
      const p=y*160+x;
      if(f.frame.data[p*4]!==ref.frame.data[p*4])continue;
      drift+=Math.abs(out.alpha[p]-base.alpha[p]);pixels++;
    }
    const p=cy*160+cx,energy=r=>r.data[p*4]*r.alpha[p]/255;
    assert(energy(out)>energy(base)+60,'stabilizing the fabric must not remove the passing spark');
  }
  assert(drift/pixels<.1,'passing sparks moved the opacity of unchanged fabric');
});
