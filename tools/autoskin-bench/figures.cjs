// Figures for the auto-weights feasibility report.
//   node figures.cjs [rigs=artist,rigA,rigC,rigB] [times=0.6,1.0,1.4]
// Produces out/fig_frames.png (side by side), out/fig_diff_t*.png (silhouette
// difference maps), out/fig_zoom_t*.png (torso crop) and out/fig_weights_<layer>.png
// (per-bone weight heat maps, artist vs auto).
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const R = require('./render.cjs');
const H = require('./spine-headless.cjs'); const spine = H.spine;
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const OUT = path.join(__dirname, 'out');
const rigNames = (process.argv[2] || 'artist,rigA,rigC,rigB').split(',');
const times = (process.argv[3] || '0.6,1.0,1.4').split(',').map(Number);
const LABEL = { artist: '美术手绑（参考）', artist_nodeform: '美术（无FFD）', rigA: 'A 美术网格+美术选骨+自动权重', rigB: 'B 全自动（自动网格+自动选骨+自动权重）', rigB2: 'B2 全自动（链投票选骨）', rigB3: 'B3 全自动（链投票+锚骨）', rigC: 'C 自动网格+美术选骨+自动权重', rigD: 'D 全自动含自动骨架' };
const { CW, CH } = R;

function svgLabel(w, h, text, size) {
  const s = size || 26;
  return Buffer.from(`<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${s + 14}" fill="rgba(0,0,0,0.55)"/><text x="10" y="${s + 2}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="${s}" fill="#ffffff">${text}</text></svg>`);
}
async function panel(rgba8, w, h, label, scale, crop) {
  let s = sharp(Buffer.from(rgba8.buffer, rgba8.byteOffset, rgba8.byteLength), { raw: { width: w, height: h, channels: 4 } });
  if (crop) s = s.extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] });
  const cw = crop ? crop[2] : w, ch = crop ? crop[3] : h;
  const ow = Math.round(cw * scale), oh = Math.round(ch * scale);
  if (scale !== 1) s = s.resize({ width: ow, height: oh, kernel: 'lanczos3' });
  let buf = await s.png().toBuffer();
  if (label) buf = await sharp(buf).composite([{ input: svgLabel(ow, oh, label, Math.max(16, Math.round(26 * Math.min(1, scale * 1.6)))), top: 0, left: 0 }]).png().toBuffer();
  return { buf, w: ow, h: oh };
}
async function grid(panels, cols, gap, file) {
  const rows = Math.ceil(panels.length / cols);
  const pw = Math.max(...panels.map((p) => p.w)), ph = Math.max(...panels.map((p) => p.h));
  const W = cols * pw + (cols - 1) * gap, Hh = rows * ph + (rows - 1) * gap;
  const comp = panels.map((p, i) => ({ input: p.buf, left: (i % cols) * (pw + gap), top: Math.floor(i / cols) * (ph + gap) }));
  await sharp({ create: { width: W, height: Hh, channels: 4, background: { r: 24, g: 24, b: 28, alpha: 1 } } }).composite(comp).png().toFile(file);
  console.log('wrote', file, `${W}x${Hh}`);
}
function diffImage(ref, cur) {
  // grey artwork where both agree; red = artist only (missing), cyan = rig only (extra)
  const out = new Uint8ClampedArray(CW * CH * 4);
  for (let i = 0; i < CW * CH; i++) {
    const a = ref[4 * i + 3] > 0.5, b = cur[4 * i + 3] > 0.5;
    const o = 4 * i;
    if (a && b) { const l = 0.3 * ref[o] + 0.59 * ref[o + 1] + 0.11 * ref[o + 2]; out[o] = out[o + 1] = out[o + 2] = 60 + l * 0.5; }
    else if (a) { out[o] = 255; out[o + 1] = 40; out[o + 2] = 40; }
    else if (b) { out[o] = 40; out[o + 1] = 220; out[o + 2] = 255; }
    else { out[o] = 30; out[o + 1] = 30; out[o + 2] = 34; }
    out[o + 3] = 255;
  }
  return out;
}
function colormap(v) { // 0..1 → blue → cyan → green → yellow → red
  const c = Math.max(0, Math.min(1, v)) * 4;
  const seg = Math.floor(c), f = c - seg;
  const stops = [[30, 40, 200], [30, 200, 220], [60, 210, 60], [240, 220, 40], [230, 40, 30], [230, 40, 30]];
  const a = stops[seg], b = stops[seg + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
function drawScalar(field, cover, dst, tris, vals) {
  for (let t = 0; t < tris.length; t += 3) {
    const i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
    const ax = dst[2 * i0], ay = dst[2 * i0 + 1], bx = dst[2 * i1], by = dst[2 * i1 + 1], cx = dst[2 * i2], cy = dst[2 * i2 + 1];
    const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); if (Math.abs(det) < 1e-9) continue;
    const xs = Math.max(0, Math.floor(Math.min(ax, bx, cx))), xe = Math.min(CW - 1, Math.ceil(Math.max(ax, bx, cx)));
    const ys = Math.max(0, Math.floor(Math.min(ay, by, cy))), ye = Math.min(CH - 1, Math.ceil(Math.max(ay, by, cy)));
    const inv = 1 / det;
    for (let y = ys; y <= ye; y++) for (let x = xs; x <= xe; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w1 = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) * inv, w2 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * inv, w0 = 1 - w1 - w2;
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
      field[y * CW + x] = w0 * vals[i0] + w1 * vals[i1] + w2 * vals[i2]; cover[y * CW + x] = 1;
    }
  }
}
function bboxOf(dst, margin) {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (let i = 0; i < dst.length; i += 2) { minX = Math.min(minX, dst[i]); maxX = Math.max(maxX, dst[i]); minY = Math.min(minY, dst[i + 1]); maxY = Math.max(maxY, dst[i + 1]); }
  const m = margin || 20;
  const x0 = Math.max(0, Math.floor(minX - m)), y0 = Math.max(0, Math.floor(minY - m));
  return [x0, y0, Math.min(CW, Math.ceil(maxX + m)) - x0, Math.min(CH, Math.ceil(maxY + m)) - y0];
}

(async () => {
  const images = await R.loadImages();
  const rigs = {}; for (const n of rigNames) rigs[n] = R.loadRig(path.join(OUT, n + '.json'));
  const ref = rigNames.includes('artist') ? 'artist' : rigNames[0];
  // 1. frames side by side (rows = times, cols = rigs)
  const panels = [];
  const cache = {};
  for (const t of times) for (const n of rigNames) {
    const fr = R.renderFrame(rigs[n], images, t); cache[`${n}@${t}`] = fr.canvas;
    panels.push(await panel(R.toRGBA8(fr.canvas, [40, 40, 44]), CW, CH, `${LABEL[n] || n}  t=${t}s`, 0.5));
  }
  await grid(panels, rigNames.length, 8, path.join(OUT, 'fig_frames.png'));
  // 2. difference maps and 3. torso zoom
  for (const t of times) {
    const dp = [], zp = [];
    for (const n of rigNames) {
      if (n !== ref) dp.push(await panel(diffImage(cache[`${ref}@${t}`], cache[`${n}@${t}`]), CW, CH, `${LABEL[n] || n} vs 参考  t=${t}s  红=缺失 青=多出`, 0.6));
      zp.push(await panel(R.toRGBA8(cache[`${n}@${t}`], [40, 40, 44]), CW, CH, `${LABEL[n] || n}  t=${t}s`, 1, [250, 60, 480, 620]));
    }
    await grid(dp, dp.length, 8, path.join(OUT, `fig_diff_t${t.toFixed(2)}.png`));
    await grid(zp, zp.length, 8, path.join(OUT, `fig_zoom_t${t.toFixed(2)}.png`));
  }
  // 4. weight heat maps: artist vs rigA, top bones of each chosen layer
  const artistJson = JSON.parse(fs.readFileSync(path.join(OUT, 'artist.json'), 'utf8'));
  const autoJson = JSON.parse(fs.readFileSync(path.join(OUT, rigNames.includes('rigA') ? 'rigA.json' : rigNames[1] + '.json'), 'utf8'));
  const { skeleton } = rigs[ref];
  skeleton.setToSetupPose(); skeleton.updateWorldTransform();
  const boneName = (i) => skeleton.bones[i].data.name;
  for (const layerName of ['body', 'hair_back', 'skirt', 'faec', 'arm_l']) {
    const slot = skeleton.slots.find((s) => s.getAttachment() && s.getAttachment().name === layerName);
    if (!slot) continue;
    const a = slot.getAttachment(); const n = a.worldVerticesLength / 2;
    const world = new Float32Array(2 * n); a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
    const dst = new Float32Array(2 * n); for (let i = 0; i < n; i++) { dst[2 * i] = world[2 * i] - R.X0; dst[2 * i + 1] = R.Y1 - world[2 * i + 1]; }
    const attA = artistJson.skins[0].attachments[slot.data.name][layerName], attB = autoJson.skins[0].attachments[slot.data.name][layerName];
    const infA = AW.decodeWeighted(attA.vertices, n), infB = AW.decodeWeighted(attB.vertices, n);
    const tot = new Map(); for (const v of infA) for (const e of v) tot.set(e.bone, (tot.get(e.bone) || 0) + e.w);
    const top = Array.from(tot.entries()).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([id]) => id);
    const art = R.renderFrame(rigs[ref], images, null, { only: new Set([layerName]) }).canvas;
    const base = R.toRGBA8(art, [30, 30, 34]);
    const crop = bboxOf(dst, 24);
    const scale = Math.min(1, 420 / crop[2], 620 / crop[3]);
    const hp = [];
    for (const b of top) for (const [tag, inf] of [['美术', infA], ['自动', infB]]) {
      const vals = new Float32Array(n); for (let i = 0; i < n; i++) for (const e of inf[i]) if (e.bone === b) vals[i] += e.w;
      const field = new Float32Array(CW * CH), cover = new Uint8Array(CW * CH);
      drawScalar(field, cover, dst, a.triangles, vals);
      const img = new Uint8ClampedArray(base);
      for (let i = 0; i < CW * CH; i++) { if (!cover[i]) continue; const c = colormap(field[i]); const o = 4 * i; const k = 0.72; img[o] = img[o] * (1 - k) + c[0] * k; img[o + 1] = img[o + 1] * (1 - k) + c[1] * k; img[o + 2] = img[o + 2] * (1 - k) + c[2] * k; }
      // bone segment in white
      const bone = skeleton.bones[b]; const len = bone.data.length;
      R.drawLine(img, bone.worldX - R.X0, R.Y1 - bone.worldY, bone.worldX + bone.a * Math.max(len, 0) - R.X0, R.Y1 - (bone.worldY + bone.c * Math.max(len, 0)), 255, 255, 255, 3);
      if (!(len > 0)) R.drawLine(img, bone.worldX - R.X0 - 6, R.Y1 - bone.worldY, bone.worldX - R.X0 + 6, R.Y1 - bone.worldY, 255, 255, 255, 5);
      hp.push(await panel(img, CW, CH, `${layerName} · ${boneName(b)} · ${tag}`, scale, crop));
    }
    await grid(hp, 4, 6, path.join(OUT, `fig_weights_${layerName}.png`));
  }
})().catch((e) => { console.error(e); process.exit(1); });
