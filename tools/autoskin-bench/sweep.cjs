// Weight-solver parameter sweep on mode A (artist mesh + artist bone set):
// deformation error over the animation against (a) the artist rig as saved and
// (b) the artist rig re-bound consistently (artist weights, locals = inv(M)·x),
// which removes the "bone moved after binding" artefact from the comparison.
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const rigJson = JSON.parse(fs.readFileSync((process.env.NOVA_AUTOSKIN_RIG || 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json'), 'utf8'));
const { data, skeleton } = H.loadSkeleton(rigJson);
const mats0 = skeleton.bones.map((b) => ({ a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY, length: b.data.length }));
const segs = mats0.map(AW.boneSegment);
const atts = rigJson.skins[0].attachments;
const layers = [];
for (const slot of skeleton.slots) {
  const a = slot.getAttachment(); if (!(a instanceof spine.MeshAttachment)) continue;
  const att = atts[slot.data.name][a.name]; const n = a.worldVerticesLength / 2;
  const world = new Float32Array(2 * n); a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
  const inf = AW.decodeWeighted(att.vertices, n);
  const ids = Array.from(new Set(inf.flatMap((v) => v.map((e) => e.bone)))).sort((x, y) => x - y);
  const col = new Map(ids.map((id, j) => [id, j]));
  const W = new Float64Array(n * ids.length);
  for (let i = 0; i < n; i++) { let s = 0; for (const e of inf[i]) { W[i * ids.length + col.get(e.bone)] += e.w; s += e.w; } if (s > 0) for (let j = 0; j < ids.length; j++) W[i * ids.length + j] /= s; }
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (let i = 0; i < n; i++) { minX = Math.min(minX, world[2 * i]); maxX = Math.max(maxX, world[2 * i]); minY = Math.min(minY, world[2 * i + 1]); maxY = Math.max(maxY, world[2 * i + 1]); }
  layers.push({ name: a.name, n, V: Array.from(world), T: Array.from(a.triangles), ids, W, inf, diag: Math.hypot(maxX - minX, maxY - minY) });
}
const times = []; for (let t = 0; t <= 2.0001; t += 0.1) times.push(+t.toFixed(2));
const matsAt = times.map((t) => { H.poseAt(data, skeleton, 'animation', t); return skeleton.bones.map((b) => ({ a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY })); });
const inv = mats0.map(AW.invertBone);
function deformSaved(inf, M) { let x = 0, y = 0; for (const e of inf) { const m = M[e.bone]; x += (m.a * e.x + m.b * e.y + m.worldX) * e.w; y += (m.c * e.x + m.d * e.y + m.worldY) * e.w; } return [x, y]; }
function deformW(L, W, i, M) { let x = 0, y = 0; const px = L.V[2 * i], py = L.V[2 * i + 1]; for (let j = 0; j < L.ids.length; j++) { const w = W[i * L.ids.length + j]; if (w <= 0) continue; const iv = inv[L.ids[j]]; const dx = px - iv.wx, dy = py - iv.wy; const lx = iv.ia * dx + iv.ib * dy, ly = iv.ic * dx + iv.id * dy; const m = M[L.ids[j]]; x += (m.a * lx + m.b * ly + m.worldX) * w; y += (m.c * lx + m.d * ly + m.worldY) * w; } return [x, y]; }
// reference positions
for (const L of layers) {
  L.refSaved = []; L.refRebound = [];
  for (const M of matsAt) { const a = new Float64Array(2 * L.n), b = new Float64Array(2 * L.n); for (let i = 0; i < L.n; i++) { const p = deformSaved(L.inf[i], M); a[2 * i] = p[0]; a[2 * i + 1] = p[1]; const q = deformW(L, L.W, i, M); b[2 * i] = q[0]; b[2 * i + 1] = q[1]; } L.refSaved.push(a); L.refRebound.push(b); }
}
function evaluate(opts, exclude) {
  let sumS = 0, sumR = 0, cnt = 0, maxS = 0, maxR = 0, ms = 0; const per = {};
  for (const L of layers) {
    if (exclude && exclude.has(L.name)) continue;
    const t0 = Date.now();
    const r = AW.heatWeights(L.V, L.T, L.ids.map((id) => segs[id]), opts);
    ms += Date.now() - t0;
    let ls = 0, lr = 0, lc = 0;
    for (let f = 0; f < matsAt.length; f++) { const M = matsAt[f]; for (let i = 0; i < L.n; i++) { const p = deformW(L, r.weights, i, M); const ds = Math.hypot(p[0] - L.refSaved[f][2 * i], p[1] - L.refSaved[f][2 * i + 1]); const dr = Math.hypot(p[0] - L.refRebound[f][2 * i], p[1] - L.refRebound[f][2 * i + 1]); ls += ds; lr += dr; lc++; maxS = Math.max(maxS, ds); maxR = Math.max(maxR, dr); } }
    sumS += ls; sumR += lr; cnt += lc; per[L.name] = { saved: ls / lc, rebound: lr / lc };
  }
  return { saved: sumS / cnt, rebound: sumR / cnt, maxS, maxR, ms, per };
}
const base = evaluate({});
console.log(`baseline (heat 1, eps 1.0001, maxInf 4, visibility on): vs saved ${base.saved.toFixed(3)}px (max ${base.maxS.toFixed(1)}), vs rebound ${base.rebound.toFixed(3)}px (max ${base.maxR.toFixed(1)}), ${base.ms}ms`);
console.log('per layer (saved / rebound):', Object.entries(base.per).sort((a, b) => b[1].saved - a[1].saved).slice(0, 8).map(([k, v]) => `${k} ${v.saved.toFixed(2)}/${v.rebound.toFixed(2)}`).join('  '));
// artist-vs-artist: how much of the saved error is the rebinding artefact alone?
{ let s = 0, c = 0, mx = 0; for (const L of layers) for (let f = 0; f < matsAt.length; f++) for (let i = 0; i < L.n; i++) { const d = Math.hypot(L.refSaved[f][2 * i] - L.refRebound[f][2 * i], L.refSaved[f][2 * i + 1] - L.refRebound[f][2 * i + 1]); s += d; c++; mx = Math.max(mx, d); } console.log(`artist saved vs artist rebound (same weights): mean ${(s / c).toFixed(3)}px max ${mx.toFixed(1)}px`); }
const rows = [];
if (process.argv[2]) {
  for (const opts of JSON.parse(process.argv[2])) {
    const r = evaluate(opts);
    const watch = (process.env.LAYERS || '').split(',').filter(Boolean);
    console.log(`  ${JSON.stringify(opts).padEnd(60)} mean ${r.rebound.toFixed(3)}px max ${r.maxR.toFixed(1)}px ${r.ms}ms  worst layers: ` + Object.entries(r.per).sort((a, b) => b[1].rebound - a[1].rebound).slice(0, 4).map(([k, v]) => `${k} ${v.rebound.toFixed(2)}`).join(' ') + (watch.length ? '  | ' + watch.map((k) => `${k} ${r.per[k] ? r.per[k].rebound.toFixed(2) : '-'}`).join(' ') : ''));
  }
  process.exit(0);
}
for (const heat of [0.1, 0.3, 1, 3, 10]) for (const closestEps of [1.0001, 1.15, 1.4]) for (const maxInfluences of [2, 3, 4, 8]) for (const visibility of [true, false]) {
  const r = evaluate({ heat, closestEps, maxInfluences, visibility });
  rows.push({ heat, closestEps, maxInfluences, visibility, ...r });
}
rows.sort((a, b) => a.rebound - b.rebound);
console.log('\nbest by error vs rebound reference:');
for (const r of rows.slice(0, 12)) console.log(`  heat ${String(r.heat).padStart(4)} eps ${r.closestEps} maxInf ${r.maxInfluences} vis ${r.visibility ? 'on ' : 'off'}: rebound ${r.rebound.toFixed(3)} (max ${r.maxR.toFixed(1)})  saved ${r.saved.toFixed(3)} (max ${r.maxS.toFixed(1)})  ${r.ms}ms`);
rows.sort((a, b) => a.saved - b.saved);
console.log('best by error vs saved reference:');
for (const r of rows.slice(0, 6)) console.log(`  heat ${String(r.heat).padStart(4)} eps ${r.closestEps} maxInf ${r.maxInfluences} vis ${r.visibility ? 'on ' : 'off'}: rebound ${r.rebound.toFixed(3)} (max ${r.maxR.toFixed(1)})  saved ${r.saved.toFixed(3)} (max ${r.maxS.toFixed(1)})`);
// marginal effect of each parameter (mean over the others)
for (const key of ['heat', 'closestEps', 'maxInfluences', 'visibility']) {
  const g = new Map(); for (const r of rows) { const k = String(r[key]); const e = g.get(k) || { s: 0, c: 0 }; e.s += r.rebound; e.c++; g.set(k, e); }
  console.log(`  ${key}: ` + Array.from(g.entries()).map(([k, e]) => `${k}=${(e.s / e.c).toFixed(3)}`).join('  '));
}
fs.writeFileSync(path.join(__dirname, 'out', 'sweep.json'), JSON.stringify(rows, null, 1));
