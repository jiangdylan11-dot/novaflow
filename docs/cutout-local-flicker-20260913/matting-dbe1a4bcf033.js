(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NovaFlowGreenScreenMatting = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
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
    if ((kind === "black" || kind === "white") && options.requireSubjectMask && !options.subjectMask?.data) return null;
    if (kind === "black" || kind === "white") return finishShadow(frame, matteNeutral(frame, screen, options), options);
    if (kind === "green") return finishShadow(frame, refineChromaMaterial(frame, matteGreen(frame, { ...options, screen }), options), options);
    // Reuse the validated chroma/glow solution with blue and green exchanged.
    const swapped = new Uint8ClampedArray(frame.data);
    for (let i = 0; i < swapped.length; i += 4) [swapped[i + 1], swapped[i + 2]] = [swapped[i + 2], swapped[i + 1]];
    // ImageData dimensions are prototype accessors in Chromium, so spreading
    // it drops width/height and produces an empty blue-screen alpha plane.
    const result = matteGreen({ width: frame.width, height: frame.height, data: swapped }, { ...options, screen: { ...screen, rgb: [screen.rgb[0], screen.rgb[2], screen.rgb[1]] } });
    for (let i = 0; i < result.data.length; i += 4) [result.data[i + 1], result.data[i + 2]] = [result.data[i + 2], result.data[i + 1]];
    result.screen = screen;
    return finishShadow(frame, refineChromaMaterial(frame, result, options), options);
  }

  function nearestSeeds(seeds, w, h) {
    const owner = new Int32Array(w * h), distance = new Float32Array(w * h);
    owner.fill(-1); distance.fill(1e6);
    for (let p = 0; p < owner.length; p++) if (seeds[p]) { owner[p] = p; distance[p] = 0; }
    const visit = (p, q, step) => { const d = distance[q] + step; if (d < distance[p]) { distance[p] = d; owner[p] = owner[q]; } };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (x) visit(p, p - 1, 1);
      if (y) { visit(p, p - w, 1); if (x) visit(p, p - w - 1, 1.414); if (x + 1 < w) visit(p, p - w + 1, 1.414); }
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      if (x + 1 < w) visit(p, p + 1, 1);
      if (y + 1 < h) { visit(p, p + w, 1); if (x) visit(p, p + w - 1, 1.414); if (x + 1 < w) visit(p, p + w + 1, 1.414); }
    }
    return { owner, distance };
  }

  const sequenceMaterials = new WeakMap();
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
    const field=new Float32Array(gw*gh*3), current=new Float32Array(w*h*3), mask=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const p=y*w+x,sx=(x+.5)*frame.width/w-.5,sy=(y+.5)*frame.height/h-.5;
      for(let c=0;c<3;c++)current[p*3+c]=samplePlane(frame.data,frame.width,frame.height,sx,sy,4,c)/255;
      mask[p]=samplePlane(coverage,frame.width,frame.height,sx,sy,1,0);
    }
    const offsets=[-4,-2,0,2,4],radius=10,delta0=new Float64Array(25),delta1=new Float64Array(25);
    for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){
      const x=Math.min(w-1,gx*step),y=Math.min(h-1,gy*step),p=y*w+x,fi=(gy*gw+gx)*3;
      if(x<radius+5||y<radius+5||x>=w-radius-5||y>=h-radius-5||mask[p]<.3||ref.distance[p]>radius)continue;
      let best=Infinity,bx=0,by=0;
      const cost=(dx,dy)=>{
        if(ref.support[(y+dy)*w+x+dx]<.04)return Infinity;
        let s0=0,s1=0,md=0,k=0;
        for(const oy of offsets)for(const ox of offsets){
          const a=(y+oy)*w+x+ox,b=(y+dy+oy)*w+x+dx+ox;
          const d0=current[a*3]-ref.rgb[b*3],d1=current[a*3+other]-ref.rgb[b*3+other];
          s0+=d0;s1+=d1;delta0[k]=d0;delta1[k++]=d1;md+=(mask[a]-ref.coverage[b])**2;
        }
        // Estimate the shared lighting change robustly: a few animated
        // sparks are photometric outliers, not displacement of the fabric.
        const mean0=s0/25,mean1=s1/25;let weightSum=0,robust0=0,robust1=0;
        for(let k=0;k<25;k++){
          const weight=1/(1+((delta0[k]-mean0)**2+(delta1[k]-mean1)**2)/.0025);
          robust0+=delta0[k]*weight;robust1+=delta1[k]*weight;weightSum+=weight;
        }
        robust0/=weightSum;robust1/=weightSum;let error=0,outliers=0;
        for(let k=0;k<25;k++){
          const e=(delta0[k]-robust0)**2+(delta1[k]-robust1)**2;
          error+=Math.min(e,.0036);if(e>.0036)outliers++;
        }
        return error/25+smooth(.25,.6,outliers/25)*.02+md*.02/25+(dx*dx+dy*dy)*.000006;
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
      field[fi]=(bx+fx)*frame.width/w;field[fi+1]=(by+fy)*frame.height/h;field[fi+2]=1-smooth(.0015,.012,best);
    }
    // A passing sparkle can pull one patch away from the surrounding fold.
    // Stabilize only interior matches; leave unsupported/occluded boundaries
    // alone and never mix pixels or light between successive video frames.
    const stable=new Float32Array(field);
    for(let gy=1;gy<gh-1;gy++)for(let gx=1;gx<gw-1;gx++){
      const i=(gy*gw+gx)*3;
      if(field[i+2]<.5)continue;
      let sx=0,sy=0,sum=0,count=0;
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
        const j=((gy+oy)*gw+gx+ox)*3;
        if(field[j+2]<.5)continue;
        const weight=field[j+2]/(1+ox*ox+oy*oy);
        sx+=field[j]*weight;sy+=field[j+1]*weight;sum+=weight;count++;
      }
      if(count>=7){stable[i]=field[i]*.25+sx/sum*.75;stable[i+1]=field[i+1]*.25+sy/sum*.75;}
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
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, sx = clamp((x + .5) * mw / w - .5, 0, mw - 1), sy = clamp((y + .5) * mh / h - .5, 0, mh - 1);
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(mw - 1, x0 + 1), y1 = Math.min(mh - 1, y0 + 1), dx = sx - x0, dy = sy - y0;
      coverage[p] = ((mask.data[y0 * mw + x0] * (1 - dx) + mask.data[y0 * mw + x1] * dx) * (1 - dy)
        + (mask.data[y1 * mw + x0] * (1 - dx) + mask.data[y1 * mw + x1] * dx) * dy) / 255;
      if (coverage[p] > .9) { population[y]++; count++; }
    }
    if (!count) return result;
    const candidateReference = sequenceMaterial(options.sequence);
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
    const lightBins = new Map();
    for (let p = 0; p < n; p++) if (lights[p] && body.distance[p] > Math.max(5, Math.min(w, h) * .012)) {
      const i = p * 4, maximum = Math.max(out[i], out[i + 1], out[i + 2], 1), rgb = [out[i] / maximum, out[i + 1] / maximum, out[i + 2] / maximum];
      const id = rgb.reduce((v, c) => v * 6 + Math.round(c * 5), 0), bin = lightBins.get(id) || { count: 0, sum: [0, 0, 0] };
      bin.count++; for (let c = 0; c < 3; c++) bin.sum[c] += rgb[c]; lightBins.set(id, bin);
    }
    const peakLightCount = Math.max(0, ...[...lightBins.values()].map(bin => bin.count));
    const lightColors = [...lightBins.values()].filter(bin => bin.count >= Math.max(3, n * .000003, peakLightCount * .025)).map(bin => bin.sum.map(v => v / bin.count)).filter(color => Math.max(...color) > .9);
    // Learn a possible cast in the generated shadow from darkened screen
    // samples. This is a measured color, not a rule tied to gold/cyan effects.
    const shadowHist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let shadowSamples = 0;
    for (let y = Math.floor(y0 + (y1 - y0) * .60); y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4, B = rows.subarray(y * 3, y * 3 + 3), shade = 1 - data[i + key] / 255 / Math.max(.1, B[key]);
      if (coverage[p] > .01 || shade < .08 || shade > .65) continue;
      const u0 = Math.max(0, data[i + c0] / 255 - (1 - shade) * B[c0]), u1 = Math.max(0, data[i + c1] / 255 - (1 - shade) * B[c1]);
      if (Math.min(u0, u1) > .035 || Math.max(u0, u1) > .28 || Math.max(u0, u1) / shade > .85) continue;
      shadowSamples++; shadowHist[c0][Math.round(clamp(u0 / shade) * 255)]++; shadowHist[c1][Math.round(clamp(u1 / shade) * 255)]++;
    }
    const shadowCast = [0, 0, 0];
    if (shadowSamples > 30) for (const c of [c0, c1]) {
      let sum = 0; for (let v = 0; v < 256; v++) { sum += shadowHist[c][v]; if (sum >= shadowSamples / 2) { shadowCast[c] = v / 255; break; } }
    }
    const lightConfidence = (premul, exact = false) => {
      if (!lightColors.length) return 0;
      const maximum = Math.max(...premul, .005), rgb = premul.map(v => v / maximum);
      let difference = 3;
      for (const color of lightColors) difference = Math.min(difference, Math.hypot(...rgb.map((v, c) => v - color[c])));
      return 1 - smooth(exact ? .08 : .2, exact ? .16 : .45, difference);
    };
    const palette = reference?.palette || hist.map(histogram => { let sum = 0; for (let v = 0; v < 256; v++) { sum += histogram[v]; if (sum >= paleCount / 2) return v / 255; } return .9; });
    let fabricPixels = 0, shadowPixels = 0, edgePixels = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4, m = coverage[p];
      if (!out[i + 3] && data[i + key] >= rows[y * 3 + key] * 255 - .25
        && Math.abs(data[i + c0] - rows[y * 3 + c0] * 255) < 4 && Math.abs(data[i + c1] - rows[y * 3 + c1] * 255) < 4) {
        out[i] = out[i + 1] = out[i + 2] = 0; continue;
      }
      if (solid[p] && (!fabricSupport || fabricSupport.distance[p] >= Math.min(w, h) * .10)) continue;
      const C = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255], B = [rows[y * 3], rows[y * 3 + 1], rows[y * 3 + 2]];
      let a = out[i + 3] / 255, P = [out[i] / 255 * a, out[i + 1] / 255 * a, out[i + 2] / 255 * a], materialWeight = 0;
      const combine = (opacity, premul, weight) => { a = a * (1 - weight) + opacity * weight; for (let c = 0; c < 3; c++) P[c] = P[c] * (1 - weight) + premul[c] * weight; };
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
      if (motion && m > .15) {
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
            if(sum>.05)delta[key]=green/sum;
          }
          const fp=F.map(v=>v*baseAlpha);
          fp[c0]=clamp(C0[c0]-(1-baseAlpha)*B0[c0]);fp[c1]=clamp(C0[c1]-(1-baseAlpha)*B0[c1]);
          fp[key]=(fp[c0]+fp[c1])*F[key]/Math.max(.1,F[c0]+F[c1]);
          for(let c=0;c<3;c++)fp[c]=clamp(fp[c]+Math.max(0,delta[c])*lightWeight);
          const weight=confidence*support*smooth(.15,.8,m)*(1-smooth(.08,.22,-Math.min(delta[c0],delta[c1])));
          if(weight>.01){combine(Math.max(baseAlpha,...fp),fp,weight);materialWeight=Math.max(materialWeight,weight);}
        }
      }
      // Re-estimate a narrow solid contour from adjacent foreground. This is
      // separate from fabric so a thin skirt is never eroded as an opaque edge.
      const q = body.owner[p], d = body.distance[p];
      if (q >= 0 && d > 0 && d < 9 && m > .01 && materialWeight < .2) {
        const F = C.map((_, c) => data[q * 4 + c] / 255), delta = F.map((v, c) => v - B[c]);
        const fit = clamp(C.reduce((sum, v, c) => sum + (v - B[c]) * delta[c], 0) / Math.max(.01, delta.reduce((sum, v) => sum + v * v, 0)));
        const residual = Math.hypot(...C.map((v, c) => v - F[c] * fit - B[c] * (1 - fit)));
        const cast = C[key] - (C[c0] + C[c1]) * F[key] / Math.max(.08, F[c0] + F[c1]);
        const weight = (1 - smooth(.055, .18, residual)) * (1 - smooth(5, 9, d)) * smooth(.005, .045, cast);
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
          *(1-smooth(.02,.12,C[0]-C[c1]))*(1-smooth(1.05,1.35,redFit/Math.max(.01,a)));
        if(weight>.01){const fit=Math.min(a,redFit);combine(fit,F.map(v=>v*fit),weight);edgePixels++;}
      }
      // Background-colored fringe immediately outside a solid is not a new
      // luminous outline. Retain hues actually observed in separate emission.
      if (m < .15 && d < 24 && q >= 0 && a > 0) {
        const F = P.map(v => v / Math.max(.005, a));
        const cast = F[key] - (F[c0] + F[c1]) * .5;
        const weight = smooth(.04, .2, cast) * (1 - smooth(.01, .15, m)) * (1 - smooth(10, 24, d)) * (1 - lightConfidence(P));
        if (weight > 0) combine(0, [0, 0, 0], weight);
      }
      // Neutral absorption retains the broad shadow opacity. Its tiny colored
      // residue must not be normalized into bright cyan/green RGB. Protect
      // observed emission near the same hue, including dim parts of a glow.
      if (m < .3) {
        const shade = clamp(1 - C[key] / Math.max(.1, B[key]));
        const dominance = (C[key] - Math.max(C[c0], C[c1])) / Math.max(.1, B[key] - Math.max(B[c0], B[c1]));
        const ground = smooth(y0 + .42 * (y1 - y0), y0 + .64 * (y1 - y0), y);
        let weight = smooth(.005, .03, shade) * smooth(.15, .4, dominance) * (1 - smooth(.025, .22, m)) * ground;
        if (weight > 0) {
          const D = C.map((v, c) => v - B[c]), S = B.map((v, c) => shadowCast[c] - v), ss = S.reduce((sum, v) => sum + v * v, 0);
          let sa = clamp(D.reduce((sum, v, c) => sum + v * S[c], 0) / Math.max(.01, ss));
          let best = Math.hypot(...D.map((v, c) => v - sa * S[c])), ep = [0, 0, 0];
          for (const color of lightColors) {
            const ll = color.reduce((sum, v) => sum + v * v, 0), sl = color.reduce((sum, v, c) => sum + v * S[c], 0);
            const ds = D.reduce((sum, v, c) => sum + v * S[c], 0), dl = D.reduce((sum, v, c) => sum + v * color[c], 0), det = ss * ll - sl * sl;
            if (det < .01) continue;
            const s = clamp((ds * ll - dl * sl) / det), e = clamp((dl * ss - ds * sl) / det);
            const error = Math.hypot(...D.map((v, c) => v - s * S[c] - e * color[c]));
            if (error < best) { best = error; sa = s; ep = color.map(v => v * e); }
          }
          weight *= 1 - smooth(.055, .14, best);
          // Faint true emission without absorption keeps its original solution.
          weight *= smooth(.006, .025, sa);
          weight *= smooth(.005, .055, sa - Math.max(...ep) * 1.2);
          const observedEmission = Math.max(0, C[c0] - B[c0], C[c1] - B[c1]);
          weight *= 1 - lightConfidence(P, true) * (1 - smooth(.85, 1.35, shade / Math.max(.005, observedEmission)));
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
      if (old === 0 && next > 0 && original) {
        result.data[i] = original[i]; result.data[i + 1] = original[i + 1]; result.data[i + 2] = original[i + 2];
      }
    }
    return result;
  }

  function render(frame, options) {
    if (!options?.enabled) return null;
    const result = matte(frame, options);
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
    return { maskCanvas: mask, rgbaCanvas: rgba, finalAlpha: result.alpha, screen: result.screen, materialStats: result.materialStats };
  }
  return { detectScreen, matte, removeShadowAlpha, applyBrush, render };
});
