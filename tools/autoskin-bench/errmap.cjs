// Where exactly does the weights-only re-skin (A) leave the artist? For the layers
// with the largest error, at their worst frame: the artist mesh (grey), artist
// vertex positions (green) and the auto positions (red) joined by a line, over the
// artist frame. Also prints the worst vertices with both weight sets.
//   node errmap.cjs [layers=auto top 4] [rig=rigA]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const R = require('./render.cjs');
const H = require('./spine-headless.cjs');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const OUT = path.join(__dirname, 'out');
const rigName = process.argv[3] || 'rigA';
const rows = JSON.parse(fs.readFileSync(path.join(OUT, 'deform_' + rigName + '.json'), 'utf8'));
const layers = process.argv[2] ? process.argv[2].split(',') : rows.slice(0, 4).map((r) => r.name);
const artistJson = JSON.parse(fs.readFileSync(path.join(OUT, 'artist_nodeform.json'), 'utf8'));
const autoJson = JSON.parse(fs.readFileSync(path.join(OUT, rigName + '.json'), 'utf8'));
const { data, skeleton } = H.loadSkeleton(artistJson);
const boneName = (i) => skeleton.bones[i].data.name;
function deform(inf, M) { let x = 0, y = 0; for (const e of inf) { const m = M[e.bone]; x += (m.a * e.x + m.b * e.y + m.worldX) * e.w; y += (m.c * e.x + m.d * e.y + m.worldY) * e.w; } return [x, y]; }
(async () => {
  const images = await R.loadImages();
  const rig = R.loadRig(path.join(OUT, 'artist_nodeform.json'));
  for (const name of layers) {
    const r = rows.find((x) => x.name === name); if (!r) continue;
    const t = r.maxAt.t;
    H.poseAt(data, skeleton, 'animation', t);
    const M = skeleton.bones.map((b) => ({ a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY }));
    const slot = Object.keys(artistJson.skins[0].attachments).find((s) => artistJson.skins[0].attachments[s][name]);
    const a = artistJson.skins[0].attachments[slot][name], b = autoJson.skins[0].attachments[slot][name];
    const n = a.uvs.length / 2;
    const ia = AW.decodeWeighted(a.vertices, n), ib = AW.decodeWeighted(b.vertices, n);
    const P = [], Q = [], err = [];
    for (let i = 0; i < n; i++) { const p = deform(ia[i], M), q = deform(ib[i], M); P.push(p); Q.push(q); err.push(Math.hypot(p[0] - q[0], p[1] - q[1])); }
    const fr = R.renderFrame(rig, images, t);
    const img = R.toRGBA8(fr.canvas, [40, 40, 44]);
    for (let i = 0; i < img.length; i += 4) { img[i] *= 0.6; img[i + 1] *= 0.6; img[i + 2] *= 0.6; }
    const cx = (p) => p[0] - R.X0, cy = (p) => R.Y1 - p[1];
    for (let k = 0; k < a.triangles.length; k += 3) for (let e = 0; e < 3; e++) { const u = P[a.triangles[k + e]], v = P[a.triangles[k + (e + 1) % 3]]; R.drawLine(img, cx(u), cy(u), cx(v), cy(v), 120, 120, 130, 1); }
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (let i = 0; i < n; i++) {
      const p = P[i], q = Q[i]; const e = err[i];
      minX = Math.min(minX, cx(p), cx(q)); maxX = Math.max(maxX, cx(p), cx(q)); minY = Math.min(minY, cy(p), cy(q)); maxY = Math.max(maxY, cy(p), cy(q));
      const k = Math.min(1, e / 20);
      R.drawLine(img, cx(p), cy(p), cx(q), cy(q), 255, 255 * (1 - k), 0, e > 6 ? 3 : 1);
      R.drawLine(img, cx(p) - 1, cy(p), cx(p) + 1, cy(p), 60, 255, 90, 3);
      R.drawLine(img, cx(q) - 1, cy(q), cx(q) + 1, cy(q), 255, 60, 60, 3);
    }
    const m = 30, x0 = Math.max(0, Math.floor(minX - m)), y0 = Math.max(0, Math.floor(minY - m));
    const crop = [x0, y0, Math.min(R.CW, Math.ceil(maxX + m)) - x0, Math.min(R.CH, Math.ceil(maxY + m)) - y0];
    const sc = Math.min(1.5, 900 / crop[3], 700 / crop[2]);
    const file = path.join(OUT, `fig_errmap_${name}.png`);
    await R.savePng(img, file, crop, sc);
    const order = err.map((e, i) => i).sort((x, y) => err[y] - err[x]).slice(0, 6);
    console.log(`\n== ${name} @t=${t}s  mean ${r.mean.toFixed(2)}px max ${r.max.toFixed(1)}px  -> ${path.basename(file)}`);
    for (const i of order) {
      const fmt = (inf) => inf.filter((e) => e.w > 0.005).sort((x, y) => y.w - x.w).map((e) => `${boneName(e.bone)}:${e.w.toFixed(2)}`).join(' ');
      console.log(`  v${String(i).padStart(3)} err ${err[i].toFixed(1).padStart(5)}px | artist ${fmt(ia[i])}  |  auto ${fmt(ib[i])}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
