// Does image edge strength separate the vertices the artist paints for a controller
// from the other vertices near it? For each controller of a layer: within radius r,
// mean/percentiles of a blurred Sobel magnitude at painted vs unpainted vertices.
//   node gate-probe.cjs [layer=faec] [r=22] [sigma=4]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const IMG = (process.env.NOVA_AUTOSKIN_IMG || 'D:/foyo_new/立绘/女角色 (2)/伽夜立绘/新建文件夹/images/e');
const OUT = path.join(__dirname, 'out');
const layer = process.argv[2] || 'faec'; const r = Number(process.argv[3] || 22); const sigma = Number(process.argv[4] || 4);
function gateField(rgba, w, h, sigma) {
  const lum = new Float32Array(w * h), alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const a = rgba[4 * i + 3] / 255; alpha[i] = a; lum[i] = (0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2]) * a + 255 * (1 - a) * 0; }
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1] + lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
    const gy = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
    mag[i] = Math.hypot(gx, gy) * (alpha[i] > 0.5 ? 1 : 0);
  }
  // separable gaussian blur
  const k = Math.ceil(3 * sigma); const ker = []; let ks = 0; for (let d = -k; d <= k; d++) { const v = Math.exp(-d * d / (2 * sigma * sigma)); ker.push(v); ks += v; } for (let j = 0; j < ker.length; j++) ker[j] /= ks;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let d = -k; d <= k; d++) { const xx = Math.min(w - 1, Math.max(0, x + d)); s += mag[y * w + xx] * ker[d + k]; } tmp[y * w + x] = s; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let d = -k; d <= k; d++) { const yy = Math.min(h - 1, Math.max(0, y + d)); s += tmp[yy * w + x] * ker[d + k]; } out[y * w + x] = s; }
  const vals = Array.from(out).filter((v, i) => alpha[i] > 0.5 && v > 0).sort((a, b) => a - b);
  const p95 = vals[Math.floor(vals.length * 0.95)] || 1;
  for (let i = 0; i < w * h; i++) out[i] = Math.min(1, out[i] / p95);
  return out;
}
(async () => {
  const rigJson = JSON.parse(fs.readFileSync(path.join(OUT, 'artist.json'), 'utf8'));
  const { skeleton } = H.loadSkeleton(rigJson);
  const slot = skeleton.slots.find((s) => s.data.name === layer); const a = slot.getAttachment(); const n = a.worldVerticesLength / 2;
  const att = rigJson.skins[0].attachments[layer][a.name];
  const { data: rgba, info } = await sharp(path.join(IMG, (a.path || a.name) + '.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const gate = gateField(rgba, info.width, info.height, sigma);
  const world = new Float32Array(2 * n); a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
  const inf = AW.decodeWeighted(att.vertices, n);
  const px = new Float32Array(n), py = new Float32Array(n), g = new Float32Array(n);
  for (let i = 0; i < n; i++) { px[i] = att.uvs[2 * i] * info.width; py[i] = att.uvs[2 * i + 1] * info.height; const x = Math.round(px[i]), y = Math.round(py[i]); g[i] = (x >= 0 && y >= 0 && x < info.width && y < info.height) ? gate[y * info.width + x] : 0; }
  const boneName = (i) => skeleton.bones[i].data.name;
  const points = skeleton.bones.filter((b) => !(b.data.length > 0) && inf.some((v) => v.some((e) => e.bone === b.data.index)));
  console.log(`${layer}: ${n} vertices, image ${info.width}x${info.height}, r=${r}px sigma=${sigma}`);
  const q = (arr) => { const s = arr.slice().sort((x, y) => x - y); const f = (p) => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : '-'; return `n=${String(s.length).padStart(3)} p25 ${f(0.25)} p50 ${f(0.5)} p75 ${f(0.75)}`; };
  for (const b of points) {
    const bx = b.worldX, by = b.worldY;
    const painted = [], other = [];
    for (let i = 0; i < n; i++) { const d = Math.hypot(world[2 * i] - bx, world[2 * i + 1] - by); if (d > r) continue; const w = inf[i].filter((e) => e.bone === b.data.index).reduce((s, e) => s + e.w, 0); (w > 0.05 ? painted : other).push(g[i]); }
    console.log(`  ${boneName(b.data.index).padEnd(12)} painted ${q(painted)}   unpainted ${q(other)}`);
  }
  // save the gate field as a picture for eyeballing
  const img = new Uint8ClampedArray(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) { const v = gate[i] * 255; img[4 * i] = v; img[4 * i + 1] = v; img[4 * i + 2] = v; img[4 * i + 3] = rgba[4 * i + 3]; }
  await sharp(Buffer.from(img.buffer), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(path.join(OUT, `fig_gate_${layer}.png`));
  console.log('wrote', `fig_gate_${layer}.png`);
})().catch((e) => { console.error(e); process.exit(1); });
