// Per-bone weight maps of one layer, artist vs a rig, zoomed: how the artist paints
// each controller (plateau? bump?) against what the solver produced.
//   node weights-map.cjs <layer> [rig=rigA] [scale=3] [bones: comma list, default = every artist bone]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const R = require('./render.cjs');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const OUT = path.join(__dirname, 'out');
const layer = process.argv[2] || 'faec';
const rigName = process.argv[3] || 'rigA';
const scale = Number(process.argv[4] || 3);
const only = process.argv[5] ? process.argv[5].split(',') : null;
const { CW, CH } = R;
function colormap(v) {
  const c = Math.max(0, Math.min(1, v)) * 4, seg = Math.floor(c), f = c - seg;
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
(async () => {
  const images = await R.loadImages();
  const artistRig = R.loadRig(path.join(OUT, 'artist.json'));
  const rig = R.loadRig(path.join(OUT, rigName + '.json'));
  const artistJson = JSON.parse(fs.readFileSync(path.join(OUT, 'artist.json'), 'utf8'));
  const rigJson = JSON.parse(fs.readFileSync(path.join(OUT, rigName + '.json'), 'utf8'));
  const boneName = (i) => artistRig.skeleton.bones[i].data.name;
  const base = R.toRGBA8(R.renderFrame(artistRig, images, null, { only: new Set([layer]) }).canvas, [30, 30, 34]);
  const panels = []; let crop = null; let pw = 0, ph = 0;
  const per = [];
  for (const [tag, rg, js] of [['美术', artistRig, artistJson], [rigName === 'rigA' ? '自动(A)' : rigName, rig, rigJson]]) {
    const sk = rg.skeleton; sk.setToSetupPose(); sk.updateWorldTransform();
    const slot = sk.slots.find((s) => s.data.name === layer); const a = slot.getAttachment(); const n = a.worldVerticesLength / 2;
    const world = new Float32Array(2 * n); a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
    const dst = new Float32Array(2 * n); for (let i = 0; i < n; i++) { dst[2 * i] = world[2 * i] - R.X0; dst[2 * i + 1] = R.Y1 - world[2 * i + 1]; }
    const att = js.skins[0].attachments[slot.data.name][a.name];
    const inf = AW.decodeWeighted(att.vertices, n);
    per.push({ tag, sk, dst, tris: a.triangles, inf, n });
    if (!crop) { let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9; for (let i = 0; i < n; i++) { minX = Math.min(minX, dst[2 * i]); maxX = Math.max(maxX, dst[2 * i]); minY = Math.min(minY, dst[2 * i + 1]); maxY = Math.max(maxY, dst[2 * i + 1]); } const m = 16; crop = [Math.floor(minX - m), Math.floor(minY - m), Math.ceil(maxX - minX + 2 * m), Math.ceil(maxY - minY + 2 * m)]; pw = crop[2] * scale; ph = crop[3] * scale; }
  }
  const artistBones = new Map(); for (const v of per[0].inf) for (const e of v) artistBones.set(e.bone, (artistBones.get(e.bone) || 0) + e.w);
  let bones = Array.from(artistBones.entries()).sort((x, y) => y[1] - x[1]).map(([b]) => b);
  if (only) bones = bones.filter((b) => only.includes(boneName(b)));
  const rows = [];
  for (const b of bones) {
    const row = [];
    for (const p of per) {
      const vals = new Float32Array(p.n); for (let i = 0; i < p.n; i++) for (const e of p.inf[i]) if (e.bone === b) vals[i] += e.w;
      const field = new Float32Array(CW * CH), cover = new Uint8Array(CW * CH);
      drawScalar(field, cover, p.dst, p.tris, vals);
      const img = new Uint8ClampedArray(base);
      for (let i = 0; i < CW * CH; i++) { if (!cover[i]) continue; const c = colormap(field[i]); const o = 4 * i; const k = 0.75; img[o] = img[o] * (1 - k) + c[0] * k; img[o + 1] = img[o + 1] * (1 - k) + c[1] * k; img[o + 2] = img[o + 2] * (1 - k) + c[2] * k; }
      const bone = p.sk.bones[b]; const len = bone.data.length;
      R.drawLine(img, bone.worldX - R.X0, R.Y1 - bone.worldY, bone.worldX + bone.a * len - R.X0, R.Y1 - (bone.worldY + bone.c * len), 255, 255, 255, 2);
      R.drawLine(img, bone.worldX - R.X0 - 3, R.Y1 - bone.worldY, bone.worldX - R.X0 + 3, R.Y1 - bone.worldY, 255, 255, 255, 5);
      let cnt = 0, sum = 0, mx = 0; for (let i = 0; i < p.n; i++) if (vals[i] > 0.005) { cnt++; sum += vals[i]; mx = Math.max(mx, vals[i]); }
      let s = sharp(Buffer.from(img.buffer, img.byteOffset, img.byteLength), { raw: { width: CW, height: CH, channels: 4 } }).extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] }).resize({ width: pw, height: ph, kernel: 'nearest' });
      const buf = await s.png().toBuffer();
      const label = Buffer.from(`<svg width="${pw}" height="${ph}"><rect x="0" y="0" width="${pw}" height="30" fill="rgba(0,0,0,0.6)"/><text x="8" y="22" font-family="Microsoft YaHei, sans-serif" font-size="18" fill="#fff">${boneName(b)} · ${p.tag} · ${cnt}顶点 均${cnt ? (sum / cnt).toFixed(2) : '-'} 峰${mx.toFixed(2)}</text></svg>`);
      row.push({ buf: await sharp(buf).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer() });
    }
    rows.push(row);
  }
  const cols = 2, W = cols * (pw + 6), Hh = rows.length * (ph + 6);
  const comp = []; rows.forEach((row, r) => row.forEach((p, c) => comp.push({ input: p.buf, left: c * (pw + 6), top: r * (ph + 6) })));
  const file = path.join(OUT, `fig_wmap_${layer}_${rigName}.png`);
  await sharp({ create: { width: W, height: Hh, channels: 4, background: { r: 24, g: 24, b: 28, alpha: 1 } } }).composite(comp).png().toFile(file);
  console.log('wrote', file, `${W}x${Hh}`, 'bones:', bones.map(boneName).join(' '));
})().catch((e) => { console.error(e); process.exit(1); });
