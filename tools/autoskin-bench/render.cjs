// Textured software renderer for a posed Spine skeleton: every mesh attachment
// is drawn triangle by triangle from its layer PNG (uvs are in ORIGINAL image
// space with v from the top), composited in draw order. Used to compare rigs by
// looking at frames and by measuring silhouettes.
//   node render.cjs <rig.json> <outPrefix> [times=0,0.5,1,1.5] [--bones]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');

const IMG = (process.env.NOVA_AUTOSKIN_IMG || 'D:/foyo_new/立绘/女角色 (2)/伽夜立绘/新建文件夹/images/e');
const X0 = -480, Y1 = 700, CW = 960, CH = 1380;   // world → canvas: cx = wx - X0, cy = Y1 - wy

let imageCache = null;
async function loadImages(dir) {
  if (imageCache) return imageCache;
  const out = new Map();
  for (const f of fs.readdirSync(dir || IMG)) {
    if (!f.endsWith('.png')) continue;
    const { data, info } = await sharp(path.join(dir || IMG, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    out.set(f.slice(0, -4), { data, w: info.width, h: info.height });
  }
  imageCache = out;
  return out;
}

/** Draw one textured triangle list into a premultiplied float RGBA layer buffer. */
function drawMesh(layer, img, src, dst, tris) {
  const { data, w: IW, h: IH } = img;
  const sample = (u, v, out) => {
    // bilinear, premultiplied
    let x = u - 0.5, y = v - 0.5;
    if (x < 0) x = 0; if (y < 0) y = 0; if (x > IW - 1) x = IW - 1; if (y > IH - 1) y = IH - 1;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(IW - 1, x0 + 1), y1 = Math.min(IH - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    let r = 0, g = 0, b = 0, a = 0;
    const acc = (xi, yi, wgt) => {
      if (wgt <= 0) return;
      const i = 4 * (yi * IW + xi);
      const al = data[i + 3] / 255 * wgt;
      r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += al;
    };
    acc(x0, y0, (1 - fx) * (1 - fy)); acc(x1, y0, fx * (1 - fy)); acc(x0, y1, (1 - fx) * fy); acc(x1, y1, fx * fy);
    out[0] = r; out[1] = g; out[2] = b; out[3] = a;
  };
  const px = [0, 0, 0, 0];
  for (let t = 0; t < tris.length; t += 3) {
    const i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
    const ax = dst[2 * i0], ay = dst[2 * i0 + 1], bx = dst[2 * i1], by = dst[2 * i1 + 1], cx = dst[2 * i2], cy = dst[2 * i2 + 1];
    const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(det) < 1e-9) continue;
    const xs = Math.max(0, Math.floor(Math.min(ax, bx, cx))), xe = Math.min(CW - 1, Math.ceil(Math.max(ax, bx, cx)));
    const ys = Math.max(0, Math.floor(Math.min(ay, by, cy))), ye = Math.min(CH - 1, Math.ceil(Math.max(ay, by, cy)));
    const sax = src[2 * i0], say = src[2 * i0 + 1], sbx = src[2 * i1], sby = src[2 * i1 + 1], scx = src[2 * i2], scy = src[2 * i2 + 1];
    const inv = 1 / det;
    for (let y = ys; y <= ye; y++) {
      const pyc = y + 0.5;
      for (let x = xs; x <= xe; x++) {
        const pxc = x + 0.5;
        const w1 = ((pxc - ax) * (cy - ay) - (pyc - ay) * (cx - ax)) * inv;
        const w2 = ((bx - ax) * (pyc - ay) - (by - ay) * (pxc - ax)) * inv;
        const w0 = 1 - w1 - w2;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const u = w0 * sax + w1 * sbx + w2 * scx, v = w0 * say + w1 * sby + w2 * scy;
        sample(u, v, px);
        const o = 4 * (y * CW + x);
        if (px[3] > layer[o + 3]) { layer[o] = px[0]; layer[o + 1] = px[1]; layer[o + 2] = px[2]; layer[o + 3] = px[3]; }
      }
    }
  }
}

/** Pose and draw. Returns {canvas: Float32Array premultiplied, layers: Map name→{alpha: Float32Array}} */
function renderFrame(rig, images, t, opts) {
  const o = opts || {};
  const { data, skeleton } = rig;
  if (t === null || t === undefined) { skeleton.setToSetupPose(); skeleton.updateWorldTransform(); }
  else H.poseAt(data, skeleton, o.animation || data.animations[0].name, t);
  const canvas = new Float32Array(CW * CH * 4);
  const layers = new Map();
  const layer = new Float32Array(CW * CH * 4);
  for (const slot of skeleton.drawOrder) {
    const a = slot.getAttachment();
    if (!(a instanceof spine.MeshAttachment)) continue;
    const img = images.get(a.path || a.name);
    if (!img) continue;
    if (o.only && !o.only.has(a.name)) continue;
    const n = a.worldVerticesLength;
    const world = new Float32Array(n);
    a.computeWorldVertices(slot, 0, n, world, 0, 2);
    const dst = new Float32Array(n), src = new Float32Array(n);
    for (let i = 0; i < n / 2; i++) {
      dst[2 * i] = world[2 * i] - X0; dst[2 * i + 1] = Y1 - world[2 * i + 1];
      src[2 * i] = a.regionUVs[2 * i] * img.w; src[2 * i + 1] = a.regionUVs[2 * i + 1] * img.h;
    }
    layer.fill(0);
    drawMesh(layer, img, src, dst, a.triangles);
    if (o.perLayer) {
      const alpha = new Float32Array(CW * CH);
      for (let i = 0; i < CW * CH; i++) alpha[i] = layer[4 * i + 3];
      layers.set(slot.data.name, { alpha });
    }
    for (let i = 0; i < CW * CH; i++) {
      const la = layer[4 * i + 3];
      if (la <= 0) continue;
      const k = 1 - la;
      canvas[4 * i] = layer[4 * i] + canvas[4 * i] * k;
      canvas[4 * i + 1] = layer[4 * i + 1] + canvas[4 * i + 1] * k;
      canvas[4 * i + 2] = layer[4 * i + 2] + canvas[4 * i + 2] * k;
      canvas[4 * i + 3] = la + canvas[4 * i + 3] * k;
    }
  }
  return { canvas, layers, skeleton };
}

/** Premultiplied float canvas → 8-bit RGBA over a background colour (or transparent). */
function toRGBA8(canvas, bg) {
  const out = new Uint8ClampedArray(CW * CH * 4);
  for (let i = 0; i < CW * CH; i++) {
    const a = Math.min(1, canvas[4 * i + 3]);
    if (bg) {
      out[4 * i] = canvas[4 * i] + bg[0] * (1 - a);
      out[4 * i + 1] = canvas[4 * i + 1] + bg[1] * (1 - a);
      out[4 * i + 2] = canvas[4 * i + 2] + bg[2] * (1 - a);
      out[4 * i + 3] = 255;
    } else {
      out[4 * i] = a > 0 ? canvas[4 * i] / a : 0;
      out[4 * i + 1] = a > 0 ? canvas[4 * i + 1] / a : 0;
      out[4 * i + 2] = a > 0 ? canvas[4 * i + 2] / a : 0;
      out[4 * i + 3] = a * 255;
    }
  }
  return out;
}

function drawLine(rgba, x0, y0, x1, y1, r, g, b, width) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  const rad = Math.max(0, Math.floor((width || 1) / 2));
  for (let s = 0; s <= n; s++) {
    const x = Math.round(x0 + (x1 - x0) * s / n), y = Math.round(y0 + (y1 - y0) * s / n);
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= CW || yy >= CH) continue;
      const o = 4 * (yy * CW + xx);
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
}

/** Overlay the posed bones (origin→tip) on an 8-bit canvas. */
function drawBones(rgba, skeleton, color) {
  const c = color || [255, 220, 60];
  for (const bone of skeleton.bones) {
    const len = bone.data.length;
    if (!(len > 0)) continue;
    const x0 = bone.worldX - X0, y0 = Y1 - bone.worldY;
    const x1 = bone.worldX + bone.a * len - X0, y1 = Y1 - (bone.worldY + bone.c * len);
    drawLine(rgba, x0, y0, x1, y1, c[0], c[1], c[2], 3);
    drawLine(rgba, x0 - 2, y0, x0 + 2, y0, 255, 80, 80, 5);
  }
}

async function savePng(rgba8, file, crop, scale) {
  let s = sharp(Buffer.from(rgba8.buffer, rgba8.byteOffset, rgba8.byteLength), { raw: { width: CW, height: CH, channels: 4 } });
  if (crop) s = s.extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] });
  if (scale && scale !== 1) s = s.resize({ width: Math.round((crop ? crop[2] : CW) * scale), kernel: 'lanczos3' });
  await s.png().toFile(file);
}

function loadRig(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return H.loadSkeleton(json);
}

module.exports = { loadImages, renderFrame, toRGBA8, drawBones, drawLine, savePng, loadRig, X0, Y1, CW, CH, IMG };

if (require.main === module) {
  (async () => {
    const [rigFile, outPrefix] = process.argv.slice(2, 4);
    const times = (process.argv[4] || '0,0.5,1,1.5').split(',').map(Number);
    const bones = process.argv.includes('--bones');
    const images = await loadImages();
    const rig = loadRig(rigFile);
    for (const t of times) {
      const t0 = Date.now();
      const fr = renderFrame(rig, images, t);
      const rgba = toRGBA8(fr.canvas, [40, 40, 44]);
      if (bones) drawBones(rgba, fr.skeleton);
      const file = `${outPrefix}_t${t.toFixed(2)}.png`;
      await savePng(rgba, file);
      console.log(file, (Date.now() - t0) + 'ms');
    }
  })();
}
