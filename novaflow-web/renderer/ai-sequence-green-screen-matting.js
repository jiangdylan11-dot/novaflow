(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NovaFlowGreenScreenMatting = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const workerUrl = typeof document !== 'undefined' && document.currentScript?.src
    ? new URL('ai-sequence-matting-worker.js' + new URL(document.currentScript.src).search, document.currentScript.src).href : null;
  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  const smooth = (lo, hi, x) => { const t = clamp((x - lo) / (hi - lo)); return t * t * (3 - 2 * t); };

  function screenKind(rgb) {
    const [r, g, b] = rgb;
    if (g > 70 && g - Math.max(r, b) > 55) return "green";
    if (b > 70 && b - Math.max(r, g) > 55) return "blue";
    if (Math.max(r, g, b) < 65 && Math.max(r, g, b) - Math.min(r, g, b) < 24) return "black";
    if (Math.min(r, g, b) > 205 && Math.max(r, g, b) - Math.min(r, g, b) < 35) return "white";
    return null;
  }

  function detectScreen(frame) {
    const { width: w, height: h, data } = frame || {};
    if (!data || !(w > 8 && h > 8)) return null;
    const samples = [], step = Math.max(1, Math.floor(Math.min(w, h) / 80));
    let count = 0;
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
      if (x > w * .06 && x < w * .94 && y > h * .06 && y < h * .94) continue;
      const i = (y * w + x) * 4;
      count++;
      if (data[i + 3] < 250) continue;
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
    if (samples.length < count * .8) return null;
    const rgb = [0, 1, 2].map(c => samples.map(v => v[c]).sort((a, b) => a - b)[Math.floor(samples.length / 2)]);
    const kind = screenKind(rgb);
    if (!kind) return null;
    const close = samples.filter(v => Math.max(...v.map((n, c) => Math.abs(n - rgb[c]))) <= 14).length;
    // A light burst can reach the border in a few video frames. Require a
    // two-thirds consensus so those frames keep the same screen treatment.
    if (close < samples.length * (2 / 3)) return null;
    return { rgb, kind, confidence: close / count };
  }

  function chromaScreenRows(frame, screen) {
    const { width: w, height: h, data } = frame;
    const bg = screen.rgb.map(v => v / 255), key = bg.indexOf(Math.max(...bg));
    const other = [0, 1, 2].filter(c => c !== key), rows = new Float32Array(h * 3);
    const band = Math.max(1, Math.floor(w / 18));
    // Generated clips can have a padded canvas whose green differs from the
    // actual video rectangle. Learn that change from both image borders on
    // each row, never from the subject or the light surrounding it.
    for (let y = 0; y < h; y++) {
      const samples = [[], [], []];
      for (let j = 0; j < 16; j++) for (const x of [Math.floor(j * band / 16), w - 1 - Math.floor(j * band / 16)]) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) samples[c].push(data[i + c] / 255);
      }
      const b = samples.map(v => { v.sort((a, b) => a - b); return (v[15] + v[16]) / 2; });
      const valid = Math.max(...b.map((v, c) => Math.abs(v - bg[c]))) < .16
        && b[key] - Math.max(...other.map(c => b[c])) > .5 * (bg[key] - Math.max(...other.map(c => bg[c])));
      rows.set(valid ? b : bg, y * 3);
    }
    return rows;
  }

  // RGB alone cannot distinguish a dim solid on black from translucent light.
  // Preserve the AI subject including its antialiased edge; eroding this mask
  // would unmult the solid outline into a bright translucent rim.
  function subjectOpacity(mask, width, height) {
    const data = mask?.data, mw = Number(mask?.width), mh = Number(mask?.height);
    if (!data || !(mw > 0 && mh > 0) || data.length !== mw * mh) return null;
    // A segmentation model can also mark isolated codec specks or particles as
    // solid objects. Keep substantial connected subjects; small detached light
    // components use the soft color solution instead of acquiring opaque dots.
    const labels = new Int32Array(data.length), queue = new Int32Array(data.length), areas = [0];
    let largest = 0;
    for (let start = 0; start < data.length; start++) {
      if (labels[start] || data[start] < 10) continue;
      const id = areas.length;
      let head = 0, tail = 1; queue[0] = start; labels[start] = id;
      while (head < tail) {
        const p = queue[head++], x = p % mw, y = Math.floor(p / mw);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= mw || ny < 0 || ny >= mh) continue;
          const next = ny * mw + nx;
          if (labels[next] || data[next] < 10) continue;
          labels[next] = id; queue[tail++] = next;
        }
      }
      areas.push(tail); largest = Math.max(largest, tail);
    }
    const minimum = Math.min(largest, Math.max(8, largest * .002));
    const valueAt = p => labels[p] && areas[labels[p]] >= minimum ? data[p] : 0;
    const values = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = clamp((x + .5) * mw / width - .5, 0, mw - 1), sy = clamp((y + .5) * mh / height - .5, 0, mh - 1);
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(mw - 1, x0 + 1), y1 = Math.min(mh - 1, y0 + 1);
      const dx = sx - x0, dy = sy - y0;
      values[y * width + x] = clamp(((valueAt(y0 * mw + x0) * (1 - dx) + valueAt(y0 * mw + x1) * dx) * (1 - dy)
        + (valueAt(y1 * mw + x0) * (1 - dx) + valueAt(y1 * mw + x1) * dx) * dy) / 255);
    }
    return values;
  }

  function matteNeutral(frame, screen, options) {
    const { width, height, data } = frame, out = new Uint8ClampedArray(data.length);
    const bg = screen.rgb.map(x => x / 255), alpha = new Uint8ClampedArray(width * height);
    const core = subjectOpacity(options.subjectMask, width, height);
    for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
      let a = 0, distance = 0;
      // C = a F + (1-a) B, with every foreground channel constrained to [0,1].
      // Minimum feasible opacity is max(R,G,B) on black and 1-min(R,G,B)
      // on white. Measured, slightly off-neutral screens use the same formula.
      for (let c = 0; c < 3; c++) {
        const value = data[i + c] / 255, delta = value - bg[c];
        a = Math.max(a, screen.kind === "black"
          ? Math.max(0, delta) / Math.max(.1, 1 - bg[c])
          : Math.max(0, -delta) / Math.max(.1, bg[c]));
        distance = Math.max(distance, Math.abs(delta));
      }
      a = clamp(a);
      const keep = core?.[p] || 0;
      a = Math.max(a, keep);
      const gate = keep + (1 - keep) * smooth(4 / 255, 10 / 255, distance);
      alpha[p] = out[i + 3] = Math.round(a * gate * data[i + 3]);
      if (a < 1 / 255 || out[i + 3] === 0) continue;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(clamp((data[i + c] / 255 - (1 - a) * bg[c]) / a) * 255);
    }
    return { width, height, data: out, alpha, screen, subjectProtected: !!core };
  }

  function matte(frame, options = {}) {
    const detected = options.screen || detectScreen(frame);
    if (!detected) return null;
    const kind = detected.kind || screenKind(detected.rgb);
    if (!kind) return null;
    const screen = { ...detected, kind };
    // 边缘净化 is a post-pass on the chroma result; off, every byte is unchanged.
    const polish = r => options.cleanEdges ? cleanEdges(frame, r, options) : r;
    if ((kind === "black" || kind === "white") && options.requireSubjectMask && !options.subjectMask?.data) return null;
    if (kind === "black" || kind === "white") return finishShadow(frame, matteNeutral(frame, screen, options), options);
    if (kind === "green") return finishShadow(frame, polish(refineChromaMaterial(frame, matteGreen(frame, { ...options, screen }), options)), options);
    // Reuse the validated chroma/glow solution with blue and green exchanged.
    const swapped = new Uint8ClampedArray(frame.data);
    for (let i = 0; i < swapped.length; i += 4) [swapped[i + 1], swapped[i + 2]] = [swapped[i + 2], swapped[i + 1]];
    // ImageData dimensions are prototype accessors in Chromium, so spreading
    // it drops width/height and produces an empty blue-screen alpha plane.
    const result = matteGreen({ width: frame.width, height: frame.height, data: swapped }, { ...options, screen: { ...screen, rgb: [screen.rgb[0], screen.rgb[2], screen.rgb[1]] } });
    for (let i = 0; i < result.data.length; i += 4) [result.data[i + 1], result.data[i + 2]] = [result.data[i + 2], result.data[i + 1]];
    result.screen = screen;
    return finishShadow(frame, polish(refineChromaMaterial(frame, result, options)), options);
  }

  function nearestSeeds(seeds, w, h) {
    const owner = new Int32Array(w * h), distance = new Float32Array(w * h);
    owner.fill(-1); distance.fill(1e6);
    for (let p = 0; p < owner.length; p++) if (seeds[p]) { owner[p] = p; distance[p] = 0; }
    const visit = (p, q, step) => { const d = distance[q] + step; if (d < distance[p]) { distance[p] = d; owner[p] = owner[q]; } };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!distance[p]) continue;
      if (x) visit(p, p - 1, 1);
      if (y) { visit(p, p - w, 1); if (x) visit(p, p - w - 1, 1.414); if (x + 1 < w) visit(p, p - w + 1, 1.414); }
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      if (!distance[p]) continue;
      if (x + 1 < w) visit(p, p + 1, 1);
      if (y + 1 < h) { visit(p, p + w, 1); if (x) visit(p, p + w - 1, 1.414); if (x + 1 < w) visit(p, p + w + 1, 1.414); }
    }
    return { owner, distance };
  }

  const sequenceMaterials = new WeakMap();
  const preparedFrameReaders = new WeakMap();
  function referenceFrameIndices(frames) {
    const indices=[...frames.keys()].sort((a,b)=>a-b),step=Math.max(1,Math.floor(indices.length/16));
    return indices.filter((_,index)=>index%step===0);
  }
  function prepareSequenceReference(sequence) {
    if(!referenceFrameIndices(sequence.frames).every(index=>sequence.masks.has(index)))throw Error('Sequence reference masks are incomplete');
    const profile=sequenceMaterial(sequence);
    sequenceMaterials.set(sequence.frames,{maskCount:sequence.frames.size,profile});
    return profile;
  }
  function registerPreparedFrame(frame,reader) {
    preparedFrameReaders.set(frame.data,reader);
    return ()=>{if(preparedFrameReaders.get(frame.data)===reader)preparedFrameReaders.delete(frame.data);};
  }
  function samplePlane(data, w, h, x, y, channels, channel) {
    x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1);
    const ix = Math.floor(x), iy = Math.floor(y), jx = Math.min(ix + 1, w - 1), jy = Math.min(iy + 1, h - 1), fx = x - ix, fy = y - iy;
    return (data[(iy * w + ix) * channels + channel] * (1 - fx) + data[(iy * w + jx) * channels + channel] * fx) * (1 - fy)
      + (data[(jy * w + ix) * channels + channel] * (1 - fx) + data[(jy * w + jx) * channels + channel] * fx) * fy;
  }
  // The clip owns the reference, so seeking, replay and export use the same
  // material. Never make a preview depend on whichever frame ran previously.
  function sequenceMaterial(sequence) {
    const frames = sequence?.frames, masks = sequence?.masks;
    if (!frames?.size || !masks?.size || frames.size < 2) return null;
    const cached = sequenceMaterials.get(frames);
    if (cached && cached.maskCount === masks.size) return cached.profile;
    const entries = [...frames.entries()].sort((a, b) => a[0] - b[0]), candidates = [];
    const mw = sequence.maskWidth, mh = sequence.maskHeight;
    if (!(mw > 0 && mh > 0)) return null;
    for (let j = 0; j < entries.length; j += Math.max(1, Math.floor(entries.length / 16))) {
      const [index, entry] = entries[j], f = entry.frame, mask = masks.get(index), screen = detectScreen(f);
      if (!f?.data || !mask || !screen || !['green', 'blue'].includes(screen.kind)) continue;
      const w = Math.min(270, f.width), h = Math.round(f.height * w / f.width), key = screen.kind === 'green' ? 1 : 2, other = key === 1 ? 2 : 1;
      const rgb = new Float32Array(w * h * 3), coverage = new Float32Array(w * h), hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
      let light = 0, pale = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = y * w + x, sx = (x + .5) * f.width / w - .5, sy = (y + .5) * f.height / h - .5;
        for (let c = 0; c < 3; c++) rgb[p * 3 + c] = samplePlane(f.data, f.width, f.height, sx, sy, 4, c) / 255;
        const m = coverage[p] = samplePlane(mask, mw, mh, (x + .5) * mw / w - .5, (y + .5) * mh / h - .5, 1, 0) / 255;
        const r = rgb[p * 3], g = rgb[p * 3 + key], b = rgb[p * 3 + other], low = Math.min(r, g, b), high = Math.max(r, g, b);
        if (m < .05) light += Math.max(0, r - screen.rgb[0] / 255, b - screen.rgb[other] / 255) ** 2;
        if (m > .99 && low > .65 && high > .78 && high - low < .25 && g - (r + b) / 2 < .01) {
          pale++; for (let c = 0; c < 3; c++) hist[c][Math.round(rgb[p * 3 + c] * 255)]++;
        }
      }
      if (pale < 12) continue;
      const palette = hist.map(a => { let sum = 0; for (let v = 0; v < 256; v++) { sum += a[v]; if (sum >= pale / 2) return v / 255; } return 1; });
      candidates.push({index, frame:f, screen, w, h, rgb, coverage, palette, score:light / (w * h), key, other});
    }
    // Prefer an early frame among similarly unlit candidates. A few codec
    // pixels must not make the reference change to an unrelated later pose.
    const minimum = Math.min(...candidates.map(c => c.score));
    const ref = candidates.find(c => c.score <= minimum * 1.15 + .0001);
    let profile = null;
    if (ref) {
      const support = new Float32Array(ref.w * ref.h), seeds = new Uint8Array(support.length), F = ref.palette;
      for (let p = 0; p < support.length; p++) {
        const r = ref.rgb[p * 3], g = ref.rgb[p * 3 + ref.key], b = ref.rgb[p * 3 + ref.other];
        const similarity = Math.abs(r * F[ref.other] - b * F[0]) / Math.max(.02, Math.hypot(r,b) * Math.hypot(F[0],F[ref.other]));
        const a = (r / F[0] + Math.max(0, b - ref.screen.rgb[ref.other]/255) / Math.max(.1,F[ref.other]-ref.screen.rgb[ref.other]/255)) / 2;
        support[p] = smooth(.4,.9,ref.coverage[p]) * smooth(.035,.12,g - (r+b)*F[ref.key]/Math.max(.1,F[0]+F[ref.other]))
          * (1-smooth(.12,.3,similarity)) * smooth(.10,.23,Math.min(r,b)) * (1-smooth(.82,.98,a));
        if (support[p] > .2) seeds[p] = 1;
      }
      profile = {...ref, support, distance:nearestSeeds(seeds,ref.w,ref.h).distance, rows:chromaScreenRows(ref.frame,ref.screen)};
    }
    sequenceMaterials.set(frames, {maskCount:masks.size, profile});
    return profile;
  }

  function materialMotion(frame, coverage, ref) {
    if (!ref || frame.width !== ref.frame.width || frame.height !== ref.frame.height) return null;
    const {w,h,key,other}=ref, step=5, gw=Math.ceil((w-1)/step)+1, gh=Math.ceil((h-1)/step)+1;
    const field=new Float32Array(gw*gh*3), sparkle=new Float32Array(gw*gh), current=new Float32Array(w*h*3), mask=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const p=y*w+x,sx=(x+.5)*frame.width/w-.5,sy=(y+.5)*frame.height/h-.5;
      for(let c=0;c<3;c++)current[p*3+c]=samplePlane(frame.data,frame.width,frame.height,sx,sy,4,c)/255;
      mask[p]=samplePlane(coverage,frame.width,frame.height,sx,sy,1,0);
    }
    const offsets=[-4,-2,0,2,4],radius=10,delta0=new Float64Array(25),delta1=new Float64Array(25);
    for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){
      const x=Math.min(w-1,gx*step),y=Math.min(h-1,gy*step),p=y*w+x,fi=(gy*gw+gx)*3;
      if(x<radius+5||y<radius+5||x>=w-radius-5||y>=h-radius-5||mask[p]<.3||ref.distance[p]>radius)continue;
      let best=Infinity,bx=0,by=0,lastSparkle=0;
      const cost=(dx,dy)=>{
        if(ref.support[(y+dy)*w+x+dx]<.04)return Infinity;
        let s0=0,s1=0,sq=0,md=0,k=0;
        for(const oy of offsets)for(const ox of offsets){
          const a=(y+oy)*w+x+ox,b=(y+dy+oy)*w+x+dx+ox;
          const d0=current[a*3]-ref.rgb[b*3],d1=current[a*3+other]-ref.rgb[b*3+other];
          s0+=d0;s1+=d1;sq+=d0*d0+d1*d1;delta0[k]=d0;delta1[k++]=d1;md+=(mask[a]-ref.coverage[b])**2;
        }
        // Estimate the shared lighting change robustly: a few animated
        // sparks are photometric outliers, not displacement of the fabric.
        const mean0=s0/25,mean1=s1/25;let weightSum=0,robust0=0,robust1=0,peaks=0;
        const peak=k=>smooth(.05,.16,delta0[k]-mean0+delta1[k]-mean1)*smooth(-.03,.005,Math.min(delta0[k]-mean0,delta1[k]-mean1));
        for(let k=0;k<25;k++){
          const hot=peak(k),weight=1-hot*(1-1/(1+((delta0[k]-mean0)**2+(delta1[k]-mean1)**2)/.0025));
          peaks+=hot;
          robust0+=delta0[k]*weight;robust1+=delta1[k]*weight;weightSum+=weight;
        }
        robust0/=weightSum;robust1/=weightSum;let error=0;
        for(let k=0;k<25;k++){
          const e=(delta0[k]-robust0)**2+(delta1[k]-robust1)**2,hot=peak(k);
          error+=e*(1-hot)+Math.min(e,.0036)*hot;
        }
        // Broad changing light and real folds keep the ordinary matcher.
        // Downweight only sparse positive peaks, never dark material edges.
        lastSparkle=smooth(.1,1,peaks)*(1-smooth(3,7,peaks))*(1-smooth(.025,.08,Math.max(robust0,robust1)));
        const ordinary=Math.max(0,sq/25-mean0*mean0-mean1*mean1);
        return ordinary*(1-lastSparkle)+error/25*lastSparkle+md*.02/25+(dx*dx+dy*dy)*.00003;
      };
      for(let dy=-radius;dy<=radius;dy+=2)for(let dx=-radius;dx<=radius;dx+=2){const c=cost(dx,dy);if(c<best){best=c;bx=dx;by=dy;}}
      const cx=bx,cy=by;for(let dy=cy-1;dy<=cy+1;dy++)for(let dx=cx-1;dx<=cx+1;dx++){const c=cost(dx,dy);if(c<best){best=c;bx=dx;by=dy;}}
      // Refine a well-defined match continuously. One low-resolution pixel
      // can span four source pixels; rounding the match made translucent
      // folds jump when their best match crossed a pixel boundary.
      const fractional=(lo,hi)=>{
        const curvature=lo+hi-2*best;
        return Number.isFinite(curvature)&&curvature>1e-8 ? clamp((lo-hi)/(2*curvature),-.5,.5) : 0;
      };
      const fx=fractional(cost(bx-1,by),cost(bx+1,by)),fy=fractional(cost(bx,by-1),cost(bx,by+1));
      cost(bx,by);sparkle[gy*gw+gx]=lastSparkle;
      field[fi]=(bx+fx)*frame.width/w;field[fi+1]=(by+fy)*frame.height/h;field[fi+2]=1-smooth(.0015,.012,best);
    }
    // A passing sparkle can pull one patch away from the surrounding fold.
    // Stabilize only interior matches; leave unsupported/occluded boundaries
    // alone and never mix pixels or light between successive video frames.
    const stable=new Float32Array(field);
    for(let gy=1;gy<gh-1;gy++)for(let gx=1;gx<gw-1;gx++){
      const i=(gy*gw+gx)*3;
      if(field[i+2]<.5||sparkle[gy*gw+gx]<.01)continue;
      let sx=0,sy=0,sum=0,count=0;
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
        const j=((gy+oy)*gw+gx+ox)*3;
        if(field[j+2]<.5)continue;
        const weight=field[j+2]/(1+ox*ox+oy*oy);
        sx+=field[j]*weight;sy+=field[j+1]*weight;sum+=weight;count++;
      }
      if(count>=7){const mix=.75*sparkle[gy*gw+gx];stable[i]=field[i]*(1-mix)+sx/sum*mix;stable[i+1]=field[i+1]*(1-mix)+sy/sum*mix;}
    }
    return {data:stable,w:gw,h:gh,step,scaleX:w/frame.width,scaleY:h/frame.height};
  }

  // Segmentation supplies material support, not the opacity of translucent
  // fabric or light. Infer pale material from visible cloth, and distinguish
  // screen absorption from emission before straight-alpha normalization.
  function refineChromaMaterial(frame, result, options) {
    const mask = options.subjectMask, mw = Number(mask?.width), mh = Number(mask?.height);
    if (!mask?.data || mask.data.length !== mw * mh || !mw || !mh) return result;
    const { width: w, height: h, data } = frame, n = w * h, out = result.data;
    const key = result.screen.kind === "blue" ? 2 : 1, c0 = 0, c1 = key === 1 ? 2 : 1;
    const rows = chromaScreenRows(frame, result.screen), coverage = new Float32Array(n);
    const solid = new Uint8Array(n), pale = new Uint8Array(n), lights = new Uint8Array(n), translucent = new Uint8Array(n);
    const population = new Uint32Array(h), hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let count = 0, paleCount = 0, translucentCount = 0;
    if (mw === w && mh === h) {
      for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
        coverage[p] = mask.data[p] / 255;
        if (coverage[p] > .9) { population[y]++; count++; }
      }
    } else for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, sx = clamp((x + .5) * mw / w - .5, 0, mw - 1), sy = clamp((y + .5) * mh / h - .5, 0, mh - 1);
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(mw - 1, x0 + 1), y1 = Math.min(mh - 1, y0 + 1), dx = sx - x0, dy = sy - y0;
      coverage[p] = ((mask.data[y0 * mw + x0] * (1 - dx) + mask.data[y0 * mw + x1] * dx) * (1 - dy)
        + (mask.data[y1 * mw + x0] * (1 - dx) + mask.data[y1 * mw + x1] * dx) * dy) / 255;
      if (coverage[p] > .9) { population[y]++; count++; }
    }
    if (!count) return result;
    const candidateReference = options.sequenceProfile || sequenceMaterial(options.sequence);
    const reference = candidateReference?.screen.kind === result.screen.kind ? candidateReference : null, motion = materialMotion(frame, coverage, reference);
    let acc = 0, y0 = 0, y1 = h - 1;
    for (let y = 0; y < h; y++) { acc += population[y]; if (acc < count * .02) y0 = y; if (acc >= count * .98) { y1 = y; break; } }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4, r = data[i + c0] / 255, b = data[i + c1] / 255, g = data[i + key] / 255;
      const high = Math.max(r, g, b), low = Math.min(r, g, b), m = coverage[p];
      const eroded = x > 2 && x < w - 3 && y > 2 && y < h - 3 && m > .985
        && coverage[p - 2] > .98 && coverage[p + 2] > .98 && coverage[p - w * 2] > .98 && coverage[p + w * 2] > .98;
      if (eroded && result.alpha[p] > 250 && g - (r + b) / 2 < .015 && !(low < .2 && g > .5)) solid[p] = 1;
      if (solid[p] && low > .65 && high > .78 && high - low < .25 && g - (r + b) / 2 < .01) {
        pale[p] = 1; paleCount++; for (let c = 0; c < 3; c++) hist[c][data[i + c]]++;
      }
      const radius = Math.max(3, Math.round(Math.min(w, h) / 100));
      if (x > radius && x < w - radius && y > radius && y < h - radius && m > .9 && g - Math.max(r, b) > .10
        && Math.min(r, b) > .1 && Math.min(r, b) / Math.max(r, b, .01) > .6
        && coverage[p - radius] > .85 && coverage[p + radius] > .85 && coverage[p - w * radius] > .85 && coverage[p + w * radius] > .85) {
        translucent[p] = 1; translucentCount++;
      }
      const bg = rows[y * 3 + key], absorb = clamp(1 - g / Math.max(bg, .1));
      const emit = Math.max(r - rows[y * 3 + c0], b - rows[y * 3 + c1]);
      if (m < .15 && emit > .16 && emit > absorb + .035) lights[p] = 1;
    }
    const body = nearestSeeds(solid, w, h), fabric = paleCount && translucentCount > 8 ? nearestSeeds(pale, w, h) : null;
    const fabricSupport = fabric ? nearestSeeds(translucent, w, h) : null;
    const tintStride=w+1,tintIntegral=new Float32Array((w+1)*(h+1));
    for(let y=0;y<h;y++){
      let sum=0;for(let x=0;x<w;x++){
        const p=y*w+x,i=p*4,r=data[i]/255,g=data[i+key]/255,b=data[i+c1]/255;
        sum+=(out[i+3]>20&&g-(r+b)*.5>.025&&b>g*.55&&r<b*.85)?1:0;
        tintIntegral[(y+1)*tintStride+x+1]=sum+tintIntegral[y*tintStride+x+1];
      }
    }
    // Require a spatially broad emission outside the subject. A narrow screen
    // fringe may share a glow hue, but is not evidence for restoring it.
    const emission = new Uint8Array(n), emissionSeeds = new Uint8Array(n);
    const emissionRadius = Math.max(3, Math.round(Math.min(w,h)*.008));
    for(let p=0;p<n;p++){
      const i=p*4,row=Math.floor(p/w)*3;
      if(coverage[p]<.005 && result.alpha[p]>12 && data[i+key]/255>=rows[row+key]-.003
        && Math.max(data[i+c0]/255-rows[row+c0],data[i+c1]/255-rows[row+c1])>.10)emission[p]=1;
    }
    for(let y=emissionRadius;y<h-emissionRadius;y++)for(let x=emissionRadius;x<w-emissionRadius;x++){
      const p=y*w+x,r=emissionRadius;
      if(body.distance[p]>=24 && emission[p] && emission[p-r] && emission[p+r]
        && emission[p-r*w] && emission[p+r*w])emissionSeeds[p]=1;
    }
    const externalEmission=nearestSeeds(emissionSeeds,w,h);
    const lightBins = new Map();
    for (let p = 0; p < n; p++) if (lights[p] && body.distance[p] > Math.max(5, Math.min(w, h) * .012)) {
      const i = p * 4, maximum = Math.max(out[i], out[i + 1], out[i + 2], 1), rgb = [out[i] / maximum, out[i + 1] / maximum, out[i + 2] / maximum];
      const id = rgb.reduce((v, c) => v * 6 + Math.round(c * 5), 0), bin = lightBins.get(id) || { count: 0, sum: [0, 0, 0] };
      bin.count++; for (let c = 0; c < 3; c++) bin.sum[c] += rgb[c];
      // For a calibrated shadow, estimate the separate light directly from
      // the source over its measured screen, before spill normalisation.
      const row=Math.floor(p/w)*3,opacity=Math.max(.005,...[c0,c1].map(c=>clamp((data[i+c]/255-rows[row+c])/Math.max(.1,1-rows[row+c]))));
      const tx=(p%w+.5)*(reference?.w||1)/w-.5,ty=(Math.floor(p/w)+.5)*(reference?.h||1)/h-.5;
      const referenceRgb=reference?[0,1,2].map(c=>samplePlane(reference.rgb,reference.w,reference.h,tx,ty,3,c)):null;
      const onShadow=referenceRgb&&referenceRgb[key]>Math.max(referenceRgb[c0],referenceRgb[c1])+.10&&referenceRgb[key]<reference.screen.rgb[key]/255*.965;
      bin.shadowSum ||= [0,0,0];bin.shadowCount ||= 0;
      if(!onShadow){bin.shadowCount++;for(let c=0;c<3;c++)bin.shadowSum[c]+=clamp((data[i+c]/255-(1-opacity)*rows[row+c])/opacity);}
      lightBins.set(id, bin);
    }
    const peakLightCount = Math.max(0, ...[...lightBins.values()].map(bin => bin.count));
    const selectedLights=[...lightBins.values()].filter(bin => bin.count >= Math.max(3, n * .000003, peakLightCount * .025)).filter(bin=>Math.max(...bin.sum)/bin.count>.9);
    const lightColors=selectedLights.map(bin=>bin.sum.map(v=>v/bin.count)),shadowLightColors=selectedLights.map(bin=>bin.shadowCount>=3?bin.shadowSum.map(v=>v/bin.shadowCount):null);
    // Learn a possible cast in the generated shadow from darkened screen
    // samples. This is a measured color, not a rule tied to gold/cyan effects.
    const shadowHist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let shadowSamples = 0;
    for (let y = Math.floor(y0 + (y1 - y0) * .60); y < h; y++) {
      const B = rows.subarray(y * 3, y * 3 + 3);
      for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4, shade = 1 - data[i + key] / 255 / Math.max(.1, B[key]);
      if (coverage[p] > .01 || shade < .08 || shade > .65) continue;
      const u0 = Math.max(0, data[i + c0] / 255 - (1 - shade) * B[c0]), u1 = Math.max(0, data[i + c1] / 255 - (1 - shade) * B[c1]);
      if (Math.min(u0, u1) > .035 || Math.max(u0, u1) > .28 || Math.max(u0, u1) / shade > .85) continue;
      shadowSamples++; shadowHist[c0][Math.round(clamp(u0 / shade) * 255)]++; shadowHist[c1][Math.round(clamp(u1 / shade) * 255)]++;
      }
    }
    const shadowCast = [0, 0, 0];
    if (shadowSamples > 30) for (const c of [c0, c1]) {
      let sum = 0; for (let v = 0; v < 256; v++) { sum += shadowHist[c][v]; if (sum >= shadowSamples / 2) { shadowCast[c] = v / 255; break; } }
    }
    // Calibrate only absorption already present outside the reference subject.
    // Spatially measured shadow contamination is not a new emission colour.
    let shadowReference = reference?.shadowReference;
    if(reference && !shadowReference){
      const rw=reference.w,rh=reference.h,field=new Float32Array(rw*rh*4);
      // Each reference sample participates in 25 neighboring windows. Compute
      // its classification once, then retain the original summation order.
      const valid=new Uint8Array(rw*rh),shades=new Float64Array(rw*rh),u0s=new Float64Array(rw*rh),u1s=new Float64Array(rw*rh);
      for(let ry=0;ry<rh;ry++){
        const sy=(ry+.5)*h/rh-.5,B=[0,1,2].map(c=>samplePlane(reference.rows,1,h,0,sy,3,c));
        for(let rx=0;rx<rw;rx++){
          const p=ry*rw+rx;if(reference.coverage[p]>.01)continue;
          const C=reference.rgb.subarray(p*3,p*3+3),shade=clamp(1-C[key]/Math.max(.1,B[key]));
          if(shade<.035||shade>.65||Math.min(C[c0],C[c1])>.12||Math.max(C[c0],C[c1])>.38)continue;
          valid[p]=1;shades[p]=shade;u0s[p]=Math.max(0,C[c0]-(1-shade)*B[c0]);u1s[p]=Math.max(0,C[c1]-(1-shade)*B[c1]);
        }
      }
      for(let ry=2;ry<rh-2;ry++)for(let rx=2;rx<rw-2;rx++){
        let count=0,shadeSum=0,u0=0,u1=0;
        for(let oy=-2;oy<=2;oy++)for(let ox=-2;ox<=2;ox++){
          const p=(ry+oy)*rw+rx+ox;if(!valid[p])continue;
          count++;shadeSum+=shades[p];u0+=u0s[p];u1+=u1s[p];
        }
        if(count>=12){const i=(ry*rw+rx)*4;field[i+c0]=u0/shadeSum;field[i+c1]=u1/shadeSum;field[i+3]=smooth(.035,.10,shadeSum/count)*smooth(11,22,count);}
      }
      // Fill only a narrow unsupported boundary from neighbouring measured
      // shadow samples. Current-frame subject/absorption gates still apply.
      const seeds=new Uint8Array(rw*rh);for(let p=0;p<seeds.length;p++)if(field[p*4+3]>.98)seeds[p]=1;
      const near=nearestSeeds(seeds,rw,rh),filled=new Float32Array(field);
      for(let p=0;p<seeds.length;p++){
        const q=near.owner[p],d=near.distance[p];if(q<0||d>=8)continue;
        const support=1-smooth(2,8,d);if(support<=field[p*4+3])continue;
        for(let c=0;c<3;c++)filled[p*4+c]=field[q*4+c];filled[p*4+3]=support;
      }
      shadowReference=reference.shadowReference={data:filled,w:rw,h:rh};
    }
    const lightConfidence = (premul, exact = false) => {
      if (!lightColors.length) return 0;
      const maximum = Math.max(premul[0], premul[1], premul[2], .005);
      const r = premul[0] / maximum, g = premul[1] / maximum, b = premul[2] / maximum;
      let difference = 3;
      for (const color of lightColors) {
        const dr=r-color[0],dg=g-color[1],db=b-color[2];
        if (Math.max(Math.abs(dr),Math.abs(dg),Math.abs(db)) >= difference) continue;
        difference = Math.min(difference, Math.hypot(dr,dg,db));
      }
      return 1 - smooth(exact ? .08 : .2, exact ? .16 : .45, difference);
    };
    const palette = reference?.palette || hist.map(histogram => { let sum = 0; for (let v = 0; v < 256; v++) { sum += histogram[v]; if (sum >= paleCount / 2) return v / 255; } return .9; });
    let fabricPixels = 0, shadowPixels = 0, edgePixels = 0;
    // These scratch colors never escape a pixel iteration. Reuse them instead
    // of allocating colors and a closure millions of times per full-size frame.
    const C = [0, 0, 0], B = [0, 0, 0], P = [0, 0, 0];
    const shadowMix = [0, 0, 0], D = [0, 0, 0], S = [0, 0, 0], ep = [0, 0, 0];
    let a = 0;
    const combine = (opacity, premul, weight) => { a = a * (1 - weight) + opacity * weight; for (let c = 0; c < 3; c++) P[c] = P[c] * (1 - weight) + premul[c] * weight; };
    const groundStart = y0 + .42 * (y1 - y0), groundEnd = y0 + .64 * (y1 - y0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4, m = coverage[p];
      if (!out[i + 3] && data[i + key] >= rows[y * 3 + key] * 255 - .25
        && Math.abs(data[i + c0] - rows[y * 3 + c0] * 255) < 4 && Math.abs(data[i + c1] - rows[y * 3 + c1] * 255) < 4) {
        out[i] = out[i + 1] = out[i + 2] = 0; continue;
      }
      if (solid[p] && (!fabricSupport || fabricSupport.distance[p] >= Math.min(w, h) * .10)) continue;
      a = out[i + 3] / 255;
      for (let c = 0; c < 3; c++) { C[c] = data[i + c] / 255; B[c] = rows[y * 3 + c]; P[c] = out[i + c] / 255 * a; }
      let materialWeight = 0;
      // White/lilac fabric is recognized by nearby opaque pale material and
      // agreement of the two non-key channels. No position or effect hue list.
      if (fabric && m > .06 && fabric.distance[p] < Math.min(w, h) * .24) {
        const F = palette;
        const d0 = F[c0] - B[c0], d1 = F[c1] - B[c1], u0 = C[c0] - B[c0], u1 = C[c1] - B[c1];
        const af = clamp((u0 * d0 + u1 * d1) / Math.max(.01, d0 * d0 + d1 * d1));
        const mismatch = Math.abs(u0 * d1 - u1 * d0) / Math.max(.01, Math.hypot(u0, u1) * Math.hypot(d0, d1));
        const cast = C[key] - (C[c0] + C[c1]) * F[key] / Math.max(.1, F[c0] + F[c1]);
        materialWeight = smooth(.06, .65, m) * smooth(.005, .06, cast) * (1 - smooth(.12, .40, mismatch))
          * (1 - smooth(Math.min(w, h) * .14, Math.min(w, h) * .24, fabric.distance[p]));
        materialWeight *= 1 - smooth(Math.min(w, h) * .035, Math.min(w, h) * .10, fabricSupport.distance[p]);
        if (Math.min(C[c0], C[c1]) < .05) materialWeight = 0;
        if (materialWeight > 0) {
          const fa = Math.min(af, m / .25), fp = F.map(v => v * fa);
          fp[c0]=clamp(C[c0]-(1-fa)*B[c0]);fp[c1]=clamp(C[c1]-(1-fa)*B[c1]);
          fp[key]=(fp[c0]+fp[c1])*F[key]/Math.max(.1,F[c0]+F[c1]);
          combine(fa, fp, materialWeight); if (materialWeight > .5) fabricPixels++;
        }
      }
      // A solid contour can occlude the reference fold. If this frame has no
      // evidence of translucent material here, keep that solid's own color
      // and alpha; surrounding patch agreement must not transplant the fold.
      // Preserve the existing reconstruction wherever material was detected.
      if (motion && m > .15 && (!solid[p] || materialWeight > .01)) {
        const mx=((x+.5)*motion.scaleX-.5)/motion.step,my=((y+.5)*motion.scaleY-.5)/motion.step;
        const confidence=samplePlane(motion.data,motion.w,motion.h,mx,my,3,2);
        if(confidence>.01){
          const rx=x+samplePlane(motion.data,motion.w,motion.h,mx,my,3,0),ry=y+samplePlane(motion.data,motion.w,motion.h,mx,my,3,1);
          const support=samplePlane(reference.support,reference.w,reference.h,(rx+.5)*motion.scaleX-.5,(ry+.5)*motion.scaleY-.5,1,0);
          const C0=[0,1,2].map(c=>samplePlane(reference.frame.data,w,h,rx,ry,4,c)/255),B0=[0,1,2].map(c=>samplePlane(reference.rows,1,h,0,ry,3,c));
          const F=palette,d0=F[c0]-B0[c0],d1=F[c1]-B0[c1];
          const baseAlpha=clamp(((C0[c0]-B0[c0])*d0+(C0[c1]-B0[c1])*d1)/Math.max(.01,d0*d0+d1*d1));
          const delta=C.map((v,c)=>v-C0[c]-(1-baseAlpha)*(B[c]-B0[c]));
          const strength=Math.max(0,delta[c0],delta[c1]),lightWeight=smooth(.012,.045,strength);
          // Only a measured change from the motion-matched unlit material
          // may borrow a light colour. The old per-frame colour guess also
          // recoloured unchanged cloth when an unrelated light appeared.
          if(strength>.012&&lightColors.length){
            const e0=Math.max(0,delta[c0]),e1=Math.max(0,delta[c1]);let sum=0,green=0;
            for(const color of lightColors){
              const distance=Math.abs(e0*color[c1]-e1*color[c0])/Math.max(.001,Math.hypot(e0,e1)*Math.hypot(color[c0],color[c1]));
              const weight=Math.exp(-distance*distance/.018),s=(e0*color[c0]+e1*color[c1])/Math.max(.01,color[c0]**2+color[c1]**2);
              sum+=weight;green+=weight*s*color[key];
            }
            const neutral=(e0+e1)*F[key]/Math.max(.1,F[c0]+F[c1]);
            delta[key]=(green+neutral*.08)/(sum+.08);
          }
          const fp=F.map(v=>v*baseAlpha);
          fp[c0]=clamp(C0[c0]-(1-baseAlpha)*B0[c0]);fp[c1]=clamp(C0[c1]-(1-baseAlpha)*B0[c1]);
          fp[key]=(fp[c0]+fp[c1])*F[key]/Math.max(.1,F[c0]+F[c1]);
          for(let c=0;c<3;c++)fp[c]=clamp(fp[c]+Math.max(0,delta[c])*lightWeight);
          const weight=confidence*support*smooth(.15,.8,m)*(1-smooth(.08,.22,-Math.min(delta[c0],delta[c1])))
            * (solid[p] ? smooth(.01,.06,materialWeight) : 1);
          if(weight>.01){combine(Math.max(baseAlpha,...fp),fp,weight);materialWeight=Math.max(materialWeight,weight);}
        }
      }
      // Re-estimate a narrow solid contour from adjacent foreground. This is
      // separate from fabric so a thin skirt is never eroded as an opaque edge.
      const q = body.owner[p], d = body.distance[p];
      // A measured external light that adds non-key energy without absorbing
      // the screen is emission, even beside a warm solid. Decide before any
      // contour fit can erase/recolour that evidence. Dark screen spill keeps
      // the existing cleanup, as do pixels protected by the subject mask.
      const emissionOwner=externalEmission.owner[p],emissionDistance=externalEmission.distance[p];
      let localEmission=0;
      if(q>=0 && d>0 && d<24 && m<.025 && a>0 && emissionOwner>=0 && emissionDistance<60){
        const j=emissionOwner*4,scale=Math.max(out[j],out[j+1],out[j+2],1),peak=Math.max(P[0],P[1],P[2],.005);
        localEmission=(1-smooth(36,60,emissionDistance))*(1-smooth(.08,.16,
          Math.hypot(P[0]/peak-out[j]/scale,P[1]/peak-out[j+1]/scale,P[2]/peak-out[j+2]/scale)));
      }
      const contourLight = localEmission>0 && q >= 0 && d > 0 && d < 24 && m < .025 && a > 0
        ? lightConfidence(P, true) * smooth(.03, .10, Math.max(C[c0]-B[c0],C[c1]-B[c1]))
          * (1-smooth(.005,.035,clamp(1-C[key]/Math.max(.1,B[key])))) * (1-smooth(.005,.025,m))*localEmission : 0;
      if (q >= 0 && d > 0 && d < 9 && m > .01 && materialWeight < .2) {
        const F = C.map((_, c) => data[q * 4 + c] / 255), delta = F.map((v, c) => v - B[c]);
        const fit = clamp(C.reduce((sum, v, c) => sum + (v - B[c]) * delta[c], 0) / Math.max(.01, delta.reduce((sum, v) => sum + v * v, 0)));
        const residual = Math.hypot(...C.map((v, c) => v - F[c] * fit - B[c] * (1 - fit)));
        const cast = C[key] - (C[c0] + C[c1]) * F[key] / Math.max(.08, F[c0] + F[c1]);
        const weight = (1 - smooth(.055, .18, residual)) * (1 - smooth(5, 9, d)) * smooth(.005, .045, cast) * (1-contourLight);
        if (weight > 0) { combine(fit, F.map(v => v * fit), weight); if (weight > .5) edgePixels++; }
      }
      // Generated rim contamination can include the neighbouring chroma
      // channel, so an RGB line fit alone rejects it. Use the uncontaminated
      // red channel only in a narrow solid contour. Broad coloured emission
      // has spatial support and must keep its original light solution.
      if(q>=0&&d>0&&d<18&&a>.005&&materialWeight<.2){
        const F=[data[q*4]/255,data[q*4+1]/255,data[q*4+2]/255];
        const cast=C[key]-(C[c0]+C[c1])*F[key]/Math.max(.1,F[c0]+F[c1]);
        const radius=Math.max(4,Math.round(Math.min(w,h)/90)),x0=Math.max(0,x-radius),x1=Math.min(w,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(h,y+radius+1);
        const density=(tintIntegral[y1*tintStride+x1]-tintIntegral[y1*tintStride+x0]-tintIntegral[y0*tintStride+x1]+tintIntegral[y0*tintStride+x0])/((x1-x0)*(y1-y0));
        const redFit=clamp((C[0]-B[0])/Math.max(.1,F[0]-B[0]));
        const weight=smooth(.025,.11,cast)*(1-smooth(7,18,d))*(1-smooth(.22,.44,density))*smooth(.16,.4,F[0]-B[0])
          *(1-smooth(.02,.12,C[0]-C[c1]))*(1-smooth(1.05,1.35,redFit/Math.max(.01,a)))*(1-contourLight);
        if(weight>.01){const fit=Math.min(a,redFit);combine(fit,F.map(v=>v*fit),weight);edgePixels++;}
      }
      // Background-colored fringe immediately outside a solid is not a new
      // luminous outline. Retain hues actually observed in separate emission.
      if (m < .15 && d < 24 && q >= 0 && a > 0) {
        const F = P.map(v => v / Math.max(.005, a));
        const cast = F[key] - (F[c0] + F[c1]) * .5;
        const weight = smooth(.04, .2, cast) * (1 - smooth(.01, .15, m)) * (1 - smooth(10, 24, d)) * (1 - lightConfidence(P)) * (1-contourLight);
        if (weight > 0) combine(0, [0, 0, 0], weight);
      }
      // Neutral absorption retains the broad shadow opacity. Its tiny colored
      // residue must not be normalized into bright cyan/green RGB. Protect
      // observed emission near the same hue, including dim parts of a glow.
      if (m < .3 && y > groundStart) {
        const shade = clamp(1 - C[key] / Math.max(.1, B[key]));
        const dominance = (C[key] - Math.max(C[c0], C[c1])) / Math.max(.1, B[key] - Math.max(B[c0], B[c1]));
        const ground = smooth(groundStart, groundEnd, y);
        const rx=(x+.5)*(shadowReference?.w||1)/w-.5,ry=(y+.5)*(shadowReference?.h||1)/h-.5;
          const calibration=shadowReference ? samplePlane(shadowReference.data,shadowReference.w,shadowReference.h,rx,ry,4,3)*(1-smooth(.005,.025,m)) : 0;
          let weight = smooth(.005, .03, shade) * (calibration+(1-calibration)*smooth(.15, .4, dominance)) * (1 - smooth(.025, .22, m)) * ground;
        if (weight > 0) {
          for (let c = 0; c < 3; c++) {
            const v = shadowCast[c];
            shadowMix[c] = v*(1-calibration)+(shadowReference?samplePlane(shadowReference.data,shadowReference.w,shadowReference.h,rx,ry,4,c):v)*calibration;
            D[c] = C[c] - B[c]; S[c] = shadowMix[c] - B[c]; ep[c] = 0;
          }
          const ss = S[0]*S[0] + S[1]*S[1] + S[2]*S[2];
          let sa = clamp((D[0]*S[0] + D[1]*S[1] + D[2]*S[2]) / Math.max(.01, ss));
          let best = Math.hypot(D[0]-sa*S[0], D[1]-sa*S[1], D[2]-sa*S[2]);
          // Keep the same least-squares fit and operation order, without
          // allocating color/map/reduce arrays for every light at every pixel.
          const ds = D[0] * S[0] + D[1] * S[1] + D[2] * S[2];
          for (let j=0;j<lightColors.length;j++) {
            const color = lightColors[j], shadow = shadowLightColors[j];
            const r = color[0]*(1-calibration)+(shadow?.[0]??color[0])*calibration;
            const g = color[1]*(1-calibration)+(shadow?.[1]??color[1])*calibration;
            const b = color[2]*(1-calibration)+(shadow?.[2]??color[2])*calibration;
            const ll = r*r + g*g + b*b, sl = r*S[0] + g*S[1] + b*S[2];
            const dl = D[0]*r + D[1]*g + D[2]*b, det = ss * ll - sl * sl;
            if (det < .01) continue;
            let s = clamp((ds * ll - dl * sl) / det), e = clamp((dl * ss - ds * sl) / det);
            if(!shadow&&calibration>0){e*=1-calibration;s=clamp((ds-e*sl)/Math.max(.01,ss));}
            const er = D[0]-s*S[0]-e*r, eg = D[1]-s*S[1]-e*g, eb = D[2]-s*S[2]-e*b;
            // A vector's length cannot be smaller than any component. Reject
            // candidates that cannot beat the current fit before the costly
            // hypot, retaining the original norm and strict winning comparison.
            if (Math.max(Math.abs(er), Math.abs(eg), Math.abs(eb)) >= best) continue;
            const error = Math.hypot(er, eg, eb);
            if (error < best) { best = error; sa = s; ep[0] = r*e; ep[1] = g*e; ep[2] = b*e; }
          }
          weight *= 1 - smooth(.055, .14, best);
          // Faint true emission without absorption keeps its original solution.
          weight *= smooth(.006, .025, sa);
          weight *= calibration + (1-calibration)*smooth(.005, .055, sa - Math.max(...ep) * 1.2);
          const observedEmission = Math.max(0, C[c0] - B[c0], C[c1] - B[c1]);
          weight *= 1 - (1-calibration)*lightConfidence(P, true) * (1 - smooth(.85, 1.35, shade / Math.max(.005, observedEmission)));
          if (weight > 0) { combine(Math.max(sa, ...ep) * smooth(.003, .015, sa), ep, weight); if (weight > .5) shadowPixels++; }
        }
      }
      result.alpha[p] = out[i + 3] = Math.round(clamp(a) * 255);
      for (let c = 0; c < 3; c++) out[i + c] = a > .5 / 255 ? Math.round(clamp(P[c] / a) * 255) : 0;
    }
    result.materialStats = { fabricPixels, shadowPixels, edgePixels, shadowCast, lightColorCount: lightColors.length, referenceFrame:reference?.index ?? null };
    return result;
  }

  // A shadow darkens the measured screen. Real emission adds non-key energy;
  // an AI foreground matte protects cloth, dark material and their soft edges.
  // Run before manual edits so a restore stroke can override the automatic mask.
  function removeShadowAlpha(frame, alpha, options = {}) {
    if (options.preserveShadow !== false) return alpha;
    const { width: w, height: h, data } = frame || {};
    if (!data || !alpha || alpha.length !== w * h) return alpha;
    const screen = options.screen || detectScreen(frame);
    if (!screen || (screen.kind || screenKind(screen.rgb)) === "black") return alpha;
    const bg = screen.rgb.map(v => v / 255), key = bg.indexOf(Math.max(...bg));
    const other = [0, 1, 2].filter(c => c !== key), chroma = bg[key] - Math.max(...other.map(c => bg[c])) > .2;
    const mask = options.subjectMask, mw = Number(mask?.width), mh = Number(mask?.height);
    const hasMask = !!mask?.data && mw > 0 && mh > 0 && mask.data.length === mw * mh;
    // On white, RGB cannot distinguish a gray solid from an equally gray shadow.
    if (!chroma && !hasMask) return alpha;
    const protectedAlpha = new Float32Array(alpha.length), rows = new Float32Array(h);
    let count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let value = alpha[p] / 255;
      if (hasMask) {
        const sx = clamp((x + .5) * mw / w - .5, 0, mw - 1), sy = clamp((y + .5) * mh / h - .5, 0, mh - 1);
        const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(mw - 1, x0 + 1), y1 = Math.min(mh - 1, y0 + 1), dx = sx - x0, dy = sy - y0;
        value = ((mask.data[y0 * mw + x0] * (1 - dx) + mask.data[y0 * mw + x1] * dx) * (1 - dy)
          + (mask.data[y1 * mw + x0] * (1 - dx) + mask.data[y1 * mw + x1] * dx) * dy) / 255;
      }
      protectedAlpha[p] = hasMask ? smooth(.015, .12, value) : smooth(.45, .85, value);
      if (value > .85) { rows[y]++; count++; }
    }
    if (!count) return alpha;
    let accumulated = 0, y0 = 0, y1 = h - 1;
    for (let y = 0; y < h; y++) { accumulated += rows[y]; if (accumulated <= count * .02) y0 = y; if (accumulated >= count * .98) { y1 = y; break; } }
    const out = new Uint8ClampedArray(alpha), rowBg = new Float32Array(h * 3);
    const footprint = new Uint8Array(alpha.length), queue = new Int32Array(alpha.length);
    const foreground = options.foregroundData?.length === data.length ? options.foregroundData : null;
    let tail = 0;
    for (let y = 0; y < h; y++) {
      const samples = [[], [], []], band = Math.max(1, Math.floor(w / 18));
      for (let j = 0; j < 6; j++) for (const x of [Math.floor(j * band / 6), w - 1 - Math.floor(j * band / 6)]) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) samples[c].push(data[i + c] / 255);
      }
      const b = samples.map(v => v.sort((a, b) => a - b)[6]);
      const valid = Math.max(...b.map((v, c) => Math.abs(v - bg[c]))) < .16 && (!chroma || b[key] - Math.max(...other.map(c => b[c])) > .5 * (bg[key] - Math.max(...other.map(c => bg[c]))));
      rowBg.set(valid ? b : bg, y * 3);
    }
    for (let y = 0; y < h; y++) {
      const ground = smooth(y0 + .45 * (y1 - y0), y0 + .65 * (y1 - y0), y);
      if (!ground) continue;
      const B = rowBg.subarray(y * 3, y * 3 + 3), norm = B[0] ** 2 + B[1] ** 2 + B[2] ** 2;
      for (let x = 0; x < w; x++) {
        const p = y * w + x, i = p * 4;
        if (!alpha[p] || protectedAlpha[p] >= 1) continue;
        const C = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
        const transmission = clamp((C[0] * B[0] + C[1] * B[1] + C[2] * B[2]) / Math.max(norm, 1e-6));
        const residual = Math.max(...C.map((v, c) => Math.abs(v - transmission * B[c])));
        const shade = 1 - transmission;
        // Compare chromatic residual to the amount of darkening. An absolute
        // RGB tolerance alone would mistake very faint colored light for shade.
        let weight = (1 - smooth(.02, .065, residual)) * (1 - smooth(.10, .30, residual / Math.max(shade, .005))) * smooth(.003, .018, shade);
        if (chroma) {
          const absorb = clamp((B[key] - C[key]) / Math.max(B[key], .1));
          const emit = Math.max(...other.map(c => Math.max(0, (C[c] - B[c]) / Math.max(1 - B[c], .1))));
          const dominance = (C[key] - Math.max(...other.map(c => C[c]))) / Math.max(.1, B[key] - Math.max(...other.map(c => B[c])));
          weight = Math.max(weight, smooth(.003, .025, absorb - emit) * smooth(.18, .45, dominance) * smooth(.003, .02, absorb));
        }
        // Confidence locates a shadow; it is not its remaining opacity. Scaling
        // alpha by confidence leaves a ring around every low-confidence fringe.
        // Grow the identified footprint through faint/compressed dark pixels,
        // stopping at foreground material or non-key emission.
        const darkForeground = foreground && Math.max(foreground[i], foreground[i + 1], foreground[i + 2]) < 80;
        const screenDominant = chroma && C[key] - Math.max(...other.map(c => C[c])) > .12;
        const fringe = hasMask && darkForeground && screenDominant && shade > .003;
        if (weight > .02 || fringe) {
          footprint[p] = 1;
          if (ground > .5 && (weight > .65 || fringe && shade > .08)) {
            footprint[p] = 2;
            queue[tail++] = p;
          }
        }
      }
    }
    // Eight-connected growth also clears thin diagonal edges without dilating
    // into the protected subject. No fixed crop or effect hue is used.
    for (let head = 0; head < tail; head++) {
      const p = queue[head], x = p % w, y = Math.floor(p / w);
      out[p] = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const next = ny * w + nx;
        if (footprint[next] !== 1) continue;
        footprint[next] = 2;
        queue[tail++] = next;
      }
    }
    return out;
  }

  // 边缘净化. Runs after the chroma matte, before shadow removal, only when
  // options.cleanEdges is set; off, the result is byte-identical.
  //
  // What it fixes (measured on an upscaled green-screen clip): contour pixels
  // whose source mixes screen and foreground get a reduced alpha but keep a
  // premultiplied colour that was not reduced in step, so colour/alpha
  // overshoots into a bright screen complement (yellow on green). Around the
  // subject, codec ringing and foreground bleed leave faint pale pixels that
  // the glow path turns into cyan/pink haze. Interior pixels, the real shadow,
  // emission with spatial support and the subject mask are never touched.
  function cleanEdges(frame, result, options) {
    const { width: w, height: h, data: src } = frame, out = result.data, alpha = result.alpha, n = w * h;
    const mask = options.subjectMask?.data;
    if (!mask || mask.length !== n || !result?.screen) return result;
    const screen = result.screen, key = screen.kind === "blue" ? 2 : screen.kind === "green" ? 1 : -1;
    if (key < 0) return result;
    const c0 = 0, c1 = key === 1 ? 2 : 1;
    const B = [screen.rgb[0] / 255, screen.rgb[1] / 255, screen.rgb[2] / 255];
    const band = Math.max(3, Math.round(Math.min(w, h) / 300));
    const srcCast = p => { const i = p * 4; return (src[i + key] - Math.max(src[i + c0], src[i + c1])) / 255; };
    // Interior seeds: opaque, inside the mask, not screen-cast, eroded twice so
    // the contour ring never contributes to the reference colour.
    const seeds = new Uint8Array(n), inner = new Uint8Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (alpha[p] < 250 || mask[p] < 240) continue;
      if (alpha[p - 1] < 250 || alpha[p + 1] < 250 || alpha[p - w] < 250 || alpha[p + w] < 250) continue;
      if (srcCast(p) > -.02) continue;
      seeds[p] = 1;
    }
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (seeds[p] && seeds[p - 1] && seeds[p + 1] && seeds[p - w] && seeds[p + w]) inner[p] = 1;
    }
    const near = nearestSeeds(inner, w, h);
    // Distance to the outside of the subject mask: the band hugs the contour,
    // so interior detail (glowing eyes, patterns) is never in it.
    const outside = new Uint8Array(n);
    for (let p = 0; p < n; p++) if (mask[p] < 128) outside[p] = 1;
    const toOutside = nearestSeeds(outside, w, h).distance;
    // Integral images of interior colour, for a small local reference window.
    const stride = w + 1, sum = [new Float64Array(stride * (h + 1)), new Float64Array(stride * (h + 1)), new Float64Array(stride * (h + 1))], cnt = new Float64Array(stride * (h + 1));
    for (let y = 0; y < h; y++) {
      let r = 0, g = 0, b = 0, c = 0;
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (inner[p]) { r += src[p * 4]; g += src[p * 4 + 1]; b += src[p * 4 + 2]; c++; }
        const k = (y + 1) * stride + x + 1, u = y * stride + x + 1;
        sum[0][k] = r + sum[0][u]; sum[1][k] = g + sum[1][u]; sum[2][k] = b + sum[2][u]; cnt[k] = c + cnt[u];
      }
    }
    const localColor = (x, y, F, r) => {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      const box = a => a[y1 * stride + x1] - a[y0 * stride + x1] - a[y1 * stride + x0] + a[y0 * stride + x0];
      const c = box(cnt); if (c < 1) return false;
      F[0] = box(sum[0]) / c / 255; F[1] = box(sum[1]) / c / 255; F[2] = box(sum[2]) / c / 255; return true;
    };
    // Emission support: real light extends well past the contour and adds to
    // the screen; an upscaler halo, codec ringing or a half-masked foreground
    // part does not. The emission exemption needs enough such pixels nearby.
    const outerLight = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (mask[p] >= 8 || near.distance[p] <= band * 3) continue;
      const i = p * 4;
      if (src[i + key] / 255 >= B[key] * .9 && Math.max(src[i + c0] / 255 - B[c0], src[i + c1] / 255 - B[c1]) > .14) outerLight[p] = 1;
    }
    const lightIntegral = new Float64Array(stride * (h + 1));
    for (let y = 0; y < h; y++) { let acc = 0; for (let x = 0; x < w; x++) { acc += outerLight[y * w + x]; lightIntegral[(y + 1) * stride + x + 1] = acc + lightIntegral[y * stride + x + 1]; } }
    const lightSupport = (x, y) => {
      const R = band * 4, x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
      const c = lightIntegral[y1 * stride + x1] - lightIntegral[y0 * stride + x1] - lightIntegral[y1 * stride + x0] + lightIntegral[y0 * stride + x0];
      return smooth(6, 30, c);
    };
    const F = [0, 0, 0], O = [0, 0, 0], C = [0, 0, 0], D = [0, 0, 0], T = [0, 0, 0];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, d = near.distance[p];
      if (d <= 0 || d > band * 8) continue;
      const a = alpha[p]; if (!a) continue;
      const i = p * 4;
      // Faint pixels outside the mask whose source is the screen with a little
      // non-key lift (ringing), or with foreground colour bled into it: neither
      // is content, and a shadow never lifts the non-key channels.
      const bleed = Math.max(src[i + c0] / 255 - B[c0], src[i + c1] / 255 - B[c1]) >= .12;
      if (mask[p] < 24 && ((a < 110 && src[i + key] >= B[key] * 255 * .88) || (a < 160 && bleed)) && lightSupport(x, y) < .5) {
        alpha[p] = out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue;
      }
      if (d > band + 3 || toOutside[p] > band + 2) continue;
      // Opaque, mask-confirmed pixels whose source is clearly not screen-cast are content.
      if (a === 255 && mask[p] >= 250 && srcCast(p) <= -.02) continue;
      // Screen noise: faint pixel outside the mask whose source is the screen itself.
      const srcDist = Math.max(Math.abs(src[i] / 255 - B[0]), Math.abs(src[i + 1] / 255 - B[1]), Math.abs(src[i + 2] / 255 - B[2]));
      if (mask[p] < 8 && a < 20 && srcDist < .07) {
        alpha[p] = out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue;
      }
      // Reference colour: the interior right behind this edge pixel (3x3 around
      // the nearest interior pixel), never brighter than that pixel itself, so a
      // dark outline stays dark instead of borrowing a wider, lighter average.
      const q = near.owner[p]; if (q < 0) continue;
      const qr = src[q * 4] / 255, qg = src[q * 4 + 1] / 255, qb = src[q * 4 + 2] / 255;
      if (!localColor(q % w, (q / w) | 0, F, 1) || F[0] + F[1] + F[2] > qr + qg + qb) { F[0] = qr; F[1] = qg; F[2] = qb; }
      O[0] = out[i] / 255; O[1] = out[i + 1] / 255; O[2] = out[i + 2] / 255;
      // Overshoot: output brighter than the interior reference, or tinted toward
      // the screen (key channel high relative to the stronger other channel).
      const lumaO = (O[0] + O[1] + O[2]) / 3, lumaF = (F[0] + F[1] + F[2]) / 3;
      const bright = smooth(.06, .22, lumaO - lumaF);
      const tint = smooth(.08, .25, O[key] / Math.max(O[c0], O[c1], .01) - F[key] / Math.max(F[c0], F[c1], .01));
      // The source must show the screen mixed in, or sit on the mask boundary.
      const evidence = Math.max(smooth(-.06, .02, srcCast(p)), 1 - smooth(60, 240, mask[p]));
      // Non-key energy beyond a plain screen/interior mix is emission; it is
      // kept only where real light has spatial support.
      C[0] = src[i] / 255; C[1] = src[i + 1] / 255; C[2] = src[i + 2] / 255;
      D[0] = F[0] - B[0]; D[1] = F[1] - B[1]; D[2] = F[2] - B[2];
      const dd = D[0] * D[0] + D[1] * D[1] + D[2] * D[2];
      const t = dd > .01 ? clamp(((C[0] - B[0]) * D[0] + (C[1] - B[1]) * D[1] + (C[2] - B[2]) * D[2]) / dd) : 0;
      const emission = Math.max(C[c0] - B[c0] - t * D[c0], C[c1] - B[c1] - t * D[c1]);
      // A semi-transparent contour pixel's own colour is the foreground at the
      // edge; its unassociated colour is noise amplified by the small alpha.
      const mixed = Math.max(smooth(-.08, 0, srcCast(p)), 1 - smooth(120, 250, mask[p]));
      const semi = 1 - smooth(230, 250, a);
      const score0 = Math.max(Math.max(bright, tint) * evidence, semi * mixed) * (1 - smooth(.12, .25, emission) * lightSupport(x, y));
      // Decide per pixel: a half-recoloured pixel leaves a faint tinted line.
      const score = smooth(.12, .4, score0);
      if (score < .05) continue;
      // Opaque pixels keep a real rim light: when the next pixel inward is also
      // brighter than the reference, add that brightness equally to the
      // reference colour (pale, not saturated). A single pale edge pixel is an
      // upscaler halo and takes the reference colour.
      T[0] = F[0]; T[1] = F[1]; T[2] = F[2];
      if (a >= 230) {
        const qx = q % w, qy = (q / w) | 0, np = (y + Math.sign(qy - y)) * w + x + Math.sign(qx - x), ni = np * 4;
        if (np !== p && mask[np] >= 250 && alpha[np] >= 250) {
          const rim = smooth(.03, .08, (src[ni] + src[ni + 1] + src[ni + 2]) / 765 - lumaF);
          const lift = clamp(lumaO - lumaF, 0, .45) * rim;
          T[0] = clamp(F[0] + lift); T[1] = clamp(F[1] + lift); T[2] = clamp(F[2] + lift);
        }
      }
      out[i] = Math.round((O[0] * (1 - score) + T[0] * score) * 255);
      out[i + 1] = Math.round((O[1] * (1 - score) + T[1] * score) * 255);
      out[i + 2] = Math.round((O[2] * (1 - score) + T[2] * score) * 255);
    }
    // Tighten: smooth alpha along the contour band (3x3), then steepen the
    // ramp, so a blurred transition becomes a smooth anti-aliased edge instead
    // of exposing the mask's pixel stair-steps. Pixels outside the band keep
    // their bytes.
    const copy = new Uint8ClampedArray(alpha);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x, d = near.distance[p];
      if (d <= 0 || d > band + 3 || toOutside[p] > band + 2) continue;
      let total = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) total += copy[p + oy * w + ox];
      const a2 = Math.round(smooth(.34, .66, total / 9 / 255) * 255), a = alpha[p], i = p * 4;
      if (a2 === a) continue;
      if (a2 === 0) { alpha[p] = out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }
      if (a === 0) { const q = near.owner[p]; if (q >= 0) { out[i] = src[q * 4]; out[i + 1] = src[q * 4 + 1]; out[i + 2] = src[q * 4 + 2]; } }
      alpha[p] = out[i + 3] = a2;
    }
    return result;
  }

  function finishShadow(frame, result, options) {
    if (options.preserveShadow !== false) return result;
    const alpha = removeShadowAlpha(frame, result.alpha, { ...options, screen: result.screen, foregroundData: result.data });
    if (alpha === result.alpha) return result;
    result.shadowRestoreData = new Uint8ClampedArray(result.data);
    result.alpha = alpha;
    for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
      result.data[i + 3] = alpha[p];
      if (!alpha[p]) result.data[i] = result.data[i + 1] = result.data[i + 2] = 0;
    }
    return result;
  }

  function matteGreen(frame, options = {}) {
    const screen = options.screen || detectScreen(frame);
    if (!screen) return null;
    const { width, height, data } = frame, out = new Uint8ClampedArray(data.length);
    const rowBackground = chromaScreenRows(frame, screen);
    const alpha = new Uint8ClampedArray(width * height);
    const normalizeGlow = options.normalizeGlow !== false;
    const cyanField = normalizeGlow ? new Float32Array(width * height) : null;
    const stride = width + 1;
    const cyanRadius = Math.max(2, Math.round(Math.min(width, height) / 147));
    const cyanIntegral = normalizeGlow ? new Float32Array(stride * (height + 1)) : null;
    if (normalizeGlow) for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) {
        const p = y * width + x, i = p * 4;
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        const weight = smooth(.05, .25, b - r) * smooth(.5, .85, g / Math.max(.001, b))
          * (1 - smooth(.35, .65, r / Math.max(.001, g, b)));
        cyanField[p] = weight;
        row += weight;
        cyanIntegral[(y + 1) * stride + x + 1] = row + cyanIntegral[y * stride + x + 1];
      }
    }
    for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
      const row = Math.floor(p / width) * 3;
      const br = rowBackground[row], bg = rowBackground[row + 1], bb = rowBackground[row + 2];
      const bgDiff = Math.max(.1, bg - Math.max(br, bb));
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const dominance = g - Math.max(r, b);
      // A cyan glow can cross G=B while its opacity remains continuous. Treating
      // that crossing as an opaque object creates a dark, hard cyan contour.
      // Preserve opaque neutral/warm/purple material; continue unassociation
      // smoothly through the low-red cyan part of the glow and protect its
      // bright, less saturated core.
      let cyanGlow = cyanField?.[p] || 0;
      if (cyanGlow > 0) {
        // Require surrounding cyan light, so isolated cool shadow/compression
        // pixels inside the opaque character do not acquire transparency.
        const x = p % width, y = Math.floor(p / width);
        const radius = cyanRadius;
        const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
        const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
        const sum = cyanIntegral[y1 * stride + x1] - cyanIntegral[y0 * stride + x1]
          - cyanIntegral[y1 * stride + x0] + cyanIntegral[y0 * stride + x0];
        cyanGlow *= smooth(.08, .4, sum / ((x1 - x0) * (y1 - y0)));
      }
      if (dominance <= 0 && (cyanGlow <= 0 || !normalizeGlow)) {
        out[i] = data[i]; out[i + 1] = data[i + 1]; out[i + 2] = data[i + 2];
        alpha[p] = out[i + 3] = data[i + 3];
        continue;
      }
      let a = clamp(1 - dominance / bgDiff);
      // The screen is estimated from opaque border pixels. Suppress only the
      // small compression residual around that screen, retaining faint glow.
      a *= smooth(.004, .025, a);
      const pr = clamp(r - (1 - a) * br), pg = clamp(g - (1 - a) * bg), pb = clamp(b - (1 - a) * bb);
      if (normalizeGlow) {
        const glowAlpha = Math.max(pr, pg, pb);
        const blend = Math.max(smooth(0, .08, dominance), cyanGlow);
        a = a * (1 - blend) + Math.min(a, glowAlpha) * blend;
      }
      // Unassociation amplifies tiny codec fluctuations into colored specks.
      // Fade only pixels still close to the measured screen in all channels;
      // blue/cyan emission departs from that screen color and stays intact.
      const distance = Math.max(Math.abs(r - br), Math.max(0, bg - g), Math.abs(b - bb));
      const screenNoiseGate = smooth(5 / 255, 12 / 255, distance);
      const sourceAlpha = data[i + 3] / 255;
      alpha[p] = Math.round(a * sourceAlpha * screenNoiseGate * 255);
      out[i + 3] = alpha[p];
      if (a < 1 / 255) continue;
      out[i] = Math.round(clamp(pr / a) * 255);
      out[i + 1] = Math.round(clamp(pg / a) * 255);
      out[i + 2] = Math.round(clamp(pb / a) * 255);
    }
    return { width, height, data: out, alpha, screen };
  }

  function applyBrush(result, overlay, original) {
    if (!overlay || overlay.length !== result.data.length) return result;
    for (let p = 0, i = 0; p < result.alpha.length; p++, i += 4) {
      const coverage = overlay[i + 3] / 255;
      if (!coverage) continue;
      const value = (overlay[i] + overlay[i + 1] + overlay[i + 2]) / 765;
      const old = result.alpha[p];
      const next = value < .5 ? old * (1 - (1 - 2 * value) * coverage) : Math.max(old, (2 * value - 1) * coverage * 255);
      result.alpha[p] = result.data[i + 3] = Math.round(clamp(next, 0, 255));
      // A restore stroke brings the source back: the colour follows the
      // alpha it adds. A pixel the matte left semi-transparent (a glow on a
      // matching screen) carries the matte's unassociated colour, which is
      // not what the user sees under the brush; mix the source colour in by
      // how much of the remaining transparency the stroke fills: a full
      // restore is the source colour, a light touch barely tints.
      if (next > old && original) {
        const share = clamp((next - old) / Math.max(1, 255 - old));
        for (let c = 0; c < 3; c++) result.data[i + c] = Math.round(result.data[i + c] * (1 - share) + original[i + c] * share);
      }
    }
    return result;
  }

  function render(frame, options) {
    return renderMatte(frame, options, options?.enabled ? matte(frame, options) : null);
  }

  function renderMatte(frame, options, prepared) {
    if (!options?.enabled) return null;
    const result = prepared;
    if (!result) return null;
    const { width, height } = frame, rgba = options.rgbaCanvas, mask = options.maskCanvas;
    const color = rgba.getContext("2d", { willReadFrequently: true });
    for (const edit of [options.globalEdit, options.frameEdit]) {
      if (!edit) continue;
      color.clearRect(0, 0, width, height); color.filter = "none";
      color.drawImage(edit, 0, 0, width, height);
      applyBrush(result, color.getImageData(0, 0, width, height).data, result.shadowRestoreData || frame.data);
    }
    color.clearRect(0, 0, width, height);
    color.putImageData(new ImageData(result.data, width, height), 0, 0);
    const maskPixels = new Uint8ClampedArray(result.data.length);
    for (let p = 0, i = 0; p < result.alpha.length; p++, i += 4) {
      maskPixels[i] = maskPixels[i + 1] = maskPixels[i + 2] = 255;
      maskPixels[i + 3] = result.alpha[p];
    }
    mask.getContext("2d").putImageData(new ImageData(maskPixels, width, height), 0, 0);
    return { maskCanvas: mask, rgbaCanvas: rgba, finalAlpha: result.alpha, screen: result.screen, materialStats: result.materialStats, ...(options.prewarm ? {rawPixels:result.data} : {}) };
  }

  // Send immutable pixel snapshots, not canvases or the entire decoded clip.
  // Each worker retains only the selected sequence reference and one active frame.
  const workerSlots = [], workerQueue = [], profileIds = new WeakMap();
  let profileSerial = 0, taskSerial = 0, workerDisabled = false, idleTimer = null;
  function parallelism(width,height) {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
    // Estimate 64 bytes/pixel for masks, distance fields, input and result;
    // larger clips reduce concurrency instead of multiplying memory unchecked.
    return Math.max(1,Math.min(8,Math.floor(cores/4),Math.floor(1024*1024*1024/Math.max(1,width*height*64))));
  }
  const workerMetrics = {completed:0, failed:0, computeMs:0, maxActive:0,prewarmHits:0};
  function workerStats() { return {...workerMetrics, workers:workerSlots.length, queued:workerQueue.length}; }
  function disableWorkers(error) {
    workerDisabled = true;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    for (const slot of workerSlots) { slot.worker.terminate(); slot.task?.reject(error); }
    workerSlots.length = 0;
    for (const task of workerQueue.splice(0)) task.reject(error);
  }
  function pumpWorkers() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    for (const slot of workerSlots) {
      if (slot.task || !workerQueue.length) continue;
      if (workerSlots.filter(s=>s.task).length >= parallelism(workerQueue[0].frame.width,workerQueue[0].frame.height)) break;
      const task = workerQueue.shift(); slot.task = task;
      try {
        if (slot.profileId !== task.profileId) {
          slot.worker.postMessage({type:'profile', profile:task.profile}); slot.profileId = task.profileId;
        }
        slot.worker.postMessage({type:'matte', id:task.id, frame:task.frame, options:task.options}, task.buffers);
        workerMetrics.maxActive = Math.max(workerMetrics.maxActive, workerSlots.filter(s => s.task).length);
      } catch (error) { disableWorkers(error); return; }
    }
    if (!workerQueue.length && workerSlots.every(s=>!s.task)) idleTimer=setTimeout(()=>{
      for (const slot of workerSlots) slot.worker.terminate();
      workerSlots.length=0;idleTimer=null;
    },30000);
  }
  async function renderAsync(frame, options) {
    if (!options?.enabled) return null;
    if(!options.prewarm){const original=options.preparedFrame?.width===frame.width&&options.preparedFrame?.height===frame.height?options.preparedFrame:frame;const reader=preparedFrameReaders.get(original.data);if(reader){const hit=await reader(options);if(hit){workerMetrics.prewarmHits++;return hit;}}}
    if (!workerUrl || workerDisabled || typeof Worker !== 'function') return render(frame, options);
    if (workerSlots.length < parallelism(frame.width,frame.height)) {
      try {
        const count = parallelism(frame.width,frame.height);
        for (let i=workerSlots.length;i<count;i++) {
          const slot = {worker:new Worker(workerUrl), task:null, profileId:null};
          slot.worker.onmessage = ({data}) => {
            const task = slot.task;
            if (!task || data.id !== task.id) return;
            slot.task = null;
            if (data.error) { workerMetrics.failed++; task.reject(new Error(data.error)); }
            else { workerMetrics.completed++; workerMetrics.computeMs += data.ms || 0; task.resolve(data.result); }
            pumpWorkers();
          };
          slot.worker.onerror = event => { event.preventDefault(); disableWorkers(new Error(event.message || 'Matting worker unavailable')); };
          workerSlots.push(slot);
        }
      } catch (error) { disableWorkers(error); return render(frame, options); }
    }
    const profile = options.sequenceProfile !== undefined ? options.sequenceProfile : sequenceMaterial(options.sequence);
    if (profile && !profileIds.has(profile)) profileIds.set(profile, ++profileSerial);
    const pixels = new Uint8ClampedArray(frame.data), mask = options.subjectMask;
    const maskData = mask?.data ? new Uint8ClampedArray(mask.data) : null;
    const result = await new Promise((resolve,reject) => {
      workerQueue.push({id:++taskSerial, profile, profileId:profile ? profileIds.get(profile) : 0,
        frame:{data:pixels,width:frame.width,height:frame.height},
        options:{preserveShadow:options.preserveShadow,cleanEdges:!!options.cleanEdges,normalizeGlow:options.normalizeGlow,screen:options.screen,
          requireSubjectMask:options.requireSubjectMask,subjectMask:maskData ? {data:maskData,width:mask.width,height:mask.height} : null},
        buffers:maskData ? [pixels.buffer,maskData.buffer] : [pixels.buffer],resolve,reject});
      pumpWorkers();
    }).catch(error => {
      if (!workerDisabled) throw error;
      return matte(frame, options);
    });
    return renderMatte(frame, options, result);
  }

  // Keep exact full-size RGBA between preview and save, compressed rather than
  // retaining gigabytes of uncompressed frames. This cache belongs to one dock.
  function createFrameCache({maxBytes = 192 * 1024 * 1024, maxFrames = 300} = {}) {
    if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') return null;
    const entries = new Map(); let bytes = 0, epoch = 0;
    const drop = key => { const entry = entries.get(key); if (entry) { bytes -= entry.blob.size; entries.delete(key); } };
    return {
      get epoch() { return epoch; },
      stats() { return {bytes, frames:entries.size, maxBytes, epoch}; },
      delete(key) { drop(key); },
      clear() { entries.clear(); bytes = 0; epoch++; },
      invalidateFrame(index) {
        // Reject stale pending writes while retaining the other decoded frames.
        epoch++;
        for (const [key, entry] of entries) if (entry.meta.decodedFrameIndex === index || entry.meta.cacheFrameIndex === index) drop(key);
      },
      async get(key) {
        const entry = entries.get(key), version = epoch;
        if (!entry) return null;
        try {
          const data = new Uint8ClampedArray(await new Response(entry.blob.stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
          if (epoch !== version || entries.get(key) !== entry) return null;
          if (data.length !== entry.meta.width * entry.meta.height * 4) { drop(key); return null; }
          entries.delete(key); entries.set(key, entry);
          return {...entry.meta, imageData:new ImageData(data,entry.meta.width,entry.meta.height), cacheHit:true};
        } catch { if (entries.get(key) === entry) drop(key); return null; }
      },
      async put(key, frame, version = epoch) {
        if (version !== epoch || !frame?.imageData?.data || frame.imageData.data.length !== frame.width * frame.height * 4) return false;
        try {
          const blob = await new Response(new Blob([frame.imageData.data]).stream().pipeThrough(new CompressionStream('deflate'))).blob();
          if (version !== epoch || blob.size > maxBytes) return false;
          const {imageData, drawCanvas, ...meta} = frame;
          drop(key);
          while(entries.size && (bytes + blob.size > maxBytes || entries.size >= maxFrames)) drop(entries.keys().next().value);
          entries.set(key,{blob,meta}); bytes += blob.size; return true;
        } catch { return false; }
      }
    };
  }
  let rawCalibration;
  function rawEncodeCalibration() {
    // Canvas PNG and getImageData use slightly different unpremultiplication
    // rounding. Capture the current renderer's PNG mapping once (64K pixels),
    // so raw video saves retain the previous PNG path's exact colors.
    return rawCalibration ||= (async()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
      const data=new Uint8ClampedArray(256*256*4);
      for(let alpha=0;alpha<256;alpha++)for(let value=0;value<256;value++){
        const i=(alpha*256+value)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=alpha;
      }
      canvas.getContext('2d').putImageData(new ImageData(data,256,256),0,0);
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG calibration failed')),'image/png'));
      return new Uint8Array(await blob.arrayBuffer());
    })().catch(error=>{rawCalibration=null;throw error;});
  }
  return { detectScreen, matte, removeShadowAlpha, applyBrush, render, renderAsync, workerStats, parallelism, createFrameCache,referenceFrameIndices,prepareSequenceReference,registerPreparedFrame,rawEncodeCalibration };
});
