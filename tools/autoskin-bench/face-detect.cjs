// Validate the face-feature detector against the artist's controller points.
//   node face-detect.cjs
// For each character: the face layer at 4x with the skin blob (dim), the feature holes
// (blue), the detected controller points (red) and the artist's (green), plus the
// per-point error in face pixels. Writes out/fig_faces.png.
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const H = require('./spine-headless.cjs');
require(REPO + '/particle-editor/spine-auto-mesh-core.js');
require(REPO + '/particle-editor/spine-auto-bones.js');
const AB = globalThis.NovaFlowAutoBones;
const CASES = [
  { tag: 'jiaye', file: 'C:/Users/jiang/OneDrive/Desktop/test/新建文件夹/images/e/faec.png', rig: 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json', slot: 'faec', names: { eyes_l_up: 'eyes_l_up', eyes_l_down: 'eyes_l_down', eyes_r_up: 'eyes_r_up', eyes_r_down: 'eyes_r_down', mouth_up: 'mouth_up', mouth_down: 'mouth_down', mouth_l: 'mouth_l', mouth_r: 'mouth_r', nose: 'face_turn' } },
  { tag: 'jinse', file: 'D:/foyo_new/立绘/锦瑟/images/face.png', rig: 'D:/foyo_new/立绘/锦瑟/NovaFlow/立绘.json', slot: 'face', names: { eyes_l_up: 'bone161', eyes_l_down: 'bone162', eyes_r_up: 'bone163', eyes_r_down: 'bone164', mouth_down: 'bone165', mouth_l: 'bone166', mouth_r: 'bone167', nose: 'bone97' } },
  { tag: 'anan', file: path.join(__dirname, 'out/anan/flat/images/tou.png'), rig: 'D:/AI_APP/spine查看/test/spine_lihui_anan_5.json', slot: 'tou', names: { eyes_l_up: 'bone19', eyes_r_up: 'bone20', mouth_l: 'bone16', mouth_r: 'bone17', mouth_down: 'bone18' } }
];
function fit(uvs, wd) {
  const n = uvs.length / 2; const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rx = [0, 0, 0], ry = [0, 0, 0];
  for (let i = 0; i < n; i++) { const r = [uvs[2 * i], uvs[2 * i + 1], 1]; for (let p = 0; p < 3; p++) { for (let q = 0; q < 3; q++) M[p][q] += r[p] * r[q]; rx[p] += r[p] * wd[2 * i]; ry[p] += r[p] * wd[2 * i + 1]; } }
  const solve = (A, b) => { const m = A.map((row, i) => [...row, b[i]]); for (let c = 0; c < 3; c++) { let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r; [m[c], m[p]] = [m[p], m[c]]; for (let r = 0; r < 3; r++) { if (r === c) continue; const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; } } return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]]; };
  const [A, B, C] = solve(M, rx), [D, E, F] = solve(M, ry); return { A, B, C, D, E, F };
}
function artistPoints(rigJson, slotName, names) {
  const { skeleton } = H.loadSkeleton(rigJson);
  const atts = rigJson.skins[0].attachments; const att = Object.values(atts[slotName])[0];
  const slot = skeleton.findSlot(slotName); const a = slot.getAttachment(); const n = att.uvs.length / 2; const world = new Float32Array(2 * n); a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
  const f = fit(att.uvs, Array.from(world)); const det = f.A * f.E - f.B * f.D;
  const out = {};
  for (const [key, bn] of Object.entries(names)) { const b = skeleton.findBone(bn); if (!b) continue; const dx = b.worldX - f.C, dy = b.worldY - f.F; out[key] = [(f.E * dx - f.B * dy) / det * att.width, (-f.D * dx + f.A * dy) / det * att.height]; }
  return out;
}
(async () => {
  const tiles = [];
  for (const cs of CASES) {
    const { data, info } = await sharp(cs.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
    const t0 = Date.now();
    const det = AB.detectFace(rgba, w, h, {});
    const ms = Date.now() - t0;
    const art = artistPoints(JSON.parse(fs.readFileSync(cs.rig, 'utf8')), cs.slot, cs.names);
    const mine = {};
    if (det) {
      if (det.eyes.length === 2) { mine.eyes_l_up = det.eyes[0].top; mine.eyes_l_down = det.eyes[0].bottom; mine.eyes_r_up = det.eyes[1].top; mine.eyes_r_down = det.eyes[1].bottom; }
      else if (det.eyes.length === 1) { mine.eyes_up = det.eyes[0].top; }
      if (det.mouth) { mine.mouth_up = det.mouth.up; mine.mouth_down = det.mouth.down; mine.mouth_l = det.mouth.l; mine.mouth_r = det.mouth.r; }
      mine.nose = det.nose;
    }
    const errs = [];
    for (const k of Object.keys(art)) if (mine[k]) errs.push(`${k} ${Math.hypot(mine[k][0] - art[k][0], mine[k][1] - art[k][1]).toFixed(1)}`);
    const faceScale = det ? Math.max(det.faceBox[2] - det.faceBox[0], det.faceBox[3] - det.faceBox[1]) : Math.max(w, h);
    console.log(`${cs.tag}: ${w}x${h} ${ms} ms ${det ? `eyes ${det.eyes.length} mouth ${det.mouth ? 'yes' : 'no'} blobs ${det.blobs} skin(${det.skin.map((v) => v.toFixed(2)).join(',')})` : 'NO FACE'}; errors px (face ${faceScale}px): ${errs.join(' ')}`);
    // figure tile
    const z = Math.max(1, Math.min(4, Math.floor(420 / Math.max(w, h))));
    const W = w * z, Hh = h * z;
    const out = new Uint8ClampedArray(W * Hh * 4);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = ((y / z) | 0) * w + ((x / z) | 0); const o = 4 * (y * W + x); const a = rgba[4 * i + 3] / 255; out[o] = rgba[4 * i] * a + 40 * (1 - a); out[o + 1] = rgba[4 * i + 1] * a + 40 * (1 - a); out[o + 2] = rgba[4 * i + 2] * a + 44 * (1 - a); out[o + 3] = 255; }
    const dot = (p, c, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r) continue; const x = Math.round(p[0] * z + dx), y = Math.round(p[1] * z + dy); if (x < 0 || y < 0 || x >= W || y >= Hh) continue; const o = 4 * (y * W + x); out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; } };
    const ring = (p, c, r) => { for (let a = 0; a < 40; a++) { const t = a / 40 * Math.PI * 2; dot([p[0] + Math.cos(t) * r / z, p[1] + Math.sin(t) * r / z], c, 1); } };
    if (det && det.faceBox) { const [x0, y0, x1, y1] = det.faceBox; for (let x = x0; x <= x1; x++) { dot([x, y0], [255, 255, 0], 0); dot([x, y1], [255, 255, 0], 0); } for (let y = y0; y <= y1; y++) { dot([x0, y], [255, 255, 0], 0); dot([x1, y], [255, 255, 0], 0); } }
    for (const [k, p] of Object.entries(art)) ring(p, [80, 255, 80], 5);
    for (const [k, p] of Object.entries(mine)) dot(p, [255, 60, 60], 3);
    const buf = await sharp(Buffer.from(out.buffer), { raw: { width: W, height: Hh, channels: 4 } }).png().toBuffer();
    const lab = Buffer.from(`<svg width="${W}" height="30"><rect width="${W}" height="30" fill="rgba(0,0,0,0.7)"/><text x="6" y="21" font-family="Microsoft YaHei, sans-serif" font-size="15" fill="#fff">${cs.tag} ${w}x${h}  绿=美术  红=检测</text></svg>`);
    tiles.push({ buf: await sharp(buf).composite([{ input: lab, left: 0, top: 0 }]).png().toBuffer(), w: W, h: Hh });
  }
  const gap = 8; const TW = tiles.reduce((a, t) => a + t.w + gap, 0) - gap, TH = Math.max(...tiles.map((t) => t.h));
  let x = 0; const comp = tiles.map((t) => { const c = { input: t.buf, left: x, top: 0 }; x += t.w + gap; return c; });
  await sharp({ create: { width: TW, height: TH, channels: 4, background: { r: 24, g: 24, b: 28, alpha: 1 } } }).composite(comp).png().toFile(path.join(__dirname, 'out', 'fig_faces.png'));
  console.log('wrote out/fig_faces.png');
})().catch((e) => { console.error(e); process.exit(1); });
