// Mode A: same mesh, same bones; artist weights vs auto weights, deformation error
// over the real animation (bone matrices from the runtime, constraints included).
//   node deform-error.cjs [rigName=rigA]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const OUT = path.join(__dirname, 'out');
const rigName = process.argv[2] || 'rigA';
const artistJson = JSON.parse(fs.readFileSync(path.join(OUT, 'artist_nodeform.json'), 'utf8'));
const rigA = JSON.parse(fs.readFileSync(path.join(OUT, rigName + '.json'), 'utf8'));
const { data, skeleton } = H.loadSkeleton(artistJson);
const atts = artistJson.skins[0].attachments, attsA = rigA.skins[0].attachments;
const times = []; for (let t = 0; t <= 2.0001; t += 0.1) times.push(+t.toFixed(2));
const matsAt = [];
for (const t of times) { H.poseAt(data, skeleton, 'animation', t); matsAt.push(skeleton.bones.map((b) => ({ a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY }))); }
function deform(inf, M) { let x = 0, y = 0; for (const e of inf) { const m = M[e.bone]; x += (m.a * e.x + m.b * e.y + m.worldX) * e.w; y += (m.c * e.x + m.d * e.y + m.worldY) * e.w; } return [x, y]; }
// EXCLUDE=<regex>: drop matching bones from the artist reference (renormalised), to
// measure how much of the error is e.g. the "turn" controllers the solver cannot know
const exclude = process.env.EXCLUDE ? new RegExp(process.env.EXCLUDE) : null;
const boneName = (i) => skeleton.bones[i].data.name;
function filterRef(inf) {
  if (!exclude) return inf;
  return inf.map((v) => { const kept = v.filter((e) => !exclude.test(boneName(e.bone))); const s = kept.reduce((a, e) => a + e.w, 0); return s > 1e-9 ? kept.map((e) => ({ ...e, w: e.w / s })) : v; });
}
if (exclude) console.log(`reference excludes bones matching /${process.env.EXCLUDE}/`);
const rows = []; let allErr = [], allMax = 0;
for (const slot of Object.keys(atts)) for (const name of Object.keys(atts[slot])) {
  const a = atts[slot][name], b = attsA[slot][name]; const n = a.uvs.length / 2;
  if (b.uvs.length !== a.uvs.length) { console.log('  skip (different mesh)', name); continue; }
  const ia = filterRef(AW.decodeWeighted(a.vertices, n)), ib = AW.decodeWeighted(b.vertices, n);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9; const M0 = matsAt[0];
  for (let i = 0; i < n; i++) { const [x, y] = deform(ia[i], M0); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  let sum = 0, cnt = 0, mx = 0, moveSum = 0, mxAt = null;
  for (let f = 0; f < times.length; f++) {
    const M = matsAt[f];
    for (let i = 0; i < n; i++) {
      const pa = deform(ia[i], M), pb = deform(ib[i], M), p0 = deform(ia[i], M0);
      const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]); sum += d; cnt++;
      if (d > mx) { mx = d; mxAt = { t: times[f], v: i }; }
      moveSum += Math.hypot(pa[0] - p0[0], pa[1] - p0[1]);
    }
  }
  rows.push({ name, n, bones: new Set(ia.flatMap((v) => v.map((e) => e.bone))).size, mean: sum / cnt, max: mx, maxAt: mxAt, diag, move: moveSum / cnt });
  allErr.push(sum / cnt); allMax = Math.max(allMax, mx);
  // REGION=<r>: error of the vertices within r of each zero-length controller of the layer
  if (process.env.REGION) {
    const rr = Number(process.env.REGION);
    const M0 = matsAt[0];
    const bonesHere = Array.from(new Set(ia.flatMap((v) => v.map((e) => e.bone)))).filter((b) => !(skeleton.bones[b].data.length > 0));
    const out = [];
    for (const b of bonesHere) {
      const bx = M0[b].worldX, by = M0[b].worldY;
      let s = 0, c = 0, m = 0;
      for (let i = 0; i < n; i++) { const p0 = deform(ia[i], M0); if (Math.hypot(p0[0] - bx, p0[1] - by) > rr) continue; for (let f = 0; f < times.length; f++) { const M = matsAt[f]; const pa = deform(ia[i], M), pb = deform(ib[i], M); const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]); s += d; c++; m = Math.max(m, d); } }
      if (c) out.push(`${boneName(b)} ${(s / c).toFixed(2)}/${m.toFixed(1)}`);
    }
    if (out.length) console.log(`    ${name} regions (mean/max px within ${rr}px): ${out.join('  ')}`);
  }
}
rows.sort((x, y) => y.mean - x.mean);
for (const r of rows) console.log(`  ${r.name.padEnd(10)} n=${String(r.n).padStart(3)} bones=${String(r.bones).padStart(2)} err mean ${r.mean.toFixed(2)}px (${(100 * r.mean / r.diag).toFixed(2)}% diag) max ${r.max.toFixed(1)}px @t=${r.maxAt.t} v${r.maxAt.v} | artist motion mean ${r.move.toFixed(1)}px`);
console.log(`${rigName} over ${times.length} frames: mean err ${(allErr.reduce((a, b) => a + b, 0) / allErr.length).toFixed(2)}px, worst ${allMax.toFixed(1)}px`);
fs.writeFileSync(path.join(OUT, 'deform_' + rigName + '.json'), JSON.stringify(rows, null, 1));
