// Which geometric rule best reproduces the artist bone-to-layer assignment?
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const rigJson = JSON.parse(fs.readFileSync((process.env.NOVA_AUTOSKIN_RIG || 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json'), 'utf8'));
const { data, skeleton } = H.loadSkeleton(rigJson);
const mats = skeleton.bones.map((b) => ({ name: b.data.name, a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY, length: b.data.length, parent: b.parent ? b.parent.data.index : -1 }));
const segs = mats.map(AW.boneSegment);
const atts = rigJson.skins[0].attachments;
const layers = [];
for (const slot of skeleton.slots) {
  const a = slot.getAttachment(); if (!(a instanceof spine.MeshAttachment)) continue;
  const att = atts[slot.data.name][a.name]; const n = a.worldVerticesLength / 2;
  const world = new Float32Array(2 * n); a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
  const inf = AW.decodeWeighted(att.vertices, n);
  const wsum = new Map(); for (const v of inf) for (const e of v) wsum.set(e.bone, (wsum.get(e.bone) || 0) + e.w);
  layers.push({ name: a.name, V: Array.from(world), T: Array.from(a.triangles), ids: new Set(wsum.keys()), wsum, n });
}
const useCount = new Map(); for (const L of layers) for (const id of L.ids) useCount.set(id, (useCount.get(id) || 0) + 1);
const shared = Array.from(useCount.entries()).filter(([, c]) => c > 1);
console.log(`bones used by >1 layer: ${shared.length} of ${useCount.size}; max sharing ${Math.max(...useCount.values())}`);
console.log('  most shared:', shared.sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, c]) => `${mats[id].name}:${c}`).join(' '));
let connected = 0;
for (const L of layers) { let roots = 0; for (const id of L.ids) if (!L.ids.has(mats[id].parent)) roots++; if (roots === 1) connected++; }
console.log(`layers whose artist bone set is ONE connected subtree: ${connected}/${layers.length}`);
function fracInside(L, s, be) { const ns = 9; let c = 0; for (let k = 0; k < ns; k++) { const u = k / (ns - 1); if (AW.insideBoundary(L.V, be, s.ax + u * (s.bx - s.ax), s.ay + u * (s.by - s.ay))) c++; } return c / ns; }
function nearest(L, s) { let d = Infinity; for (let i = 0; i < L.n; i++) d = Math.min(d, AW.segPoint(L.V[2 * i], L.V[2 * i + 1], s.ax, s.ay, s.bx, s.by)); return d; }
const rules = {
  seg85: (L, s, be) => fracInside(L, s, be) >= 0.85,
  seg100: (L, s, be) => fracInside(L, s, be) >= 0.999,
  seg50: (L, s, be) => fracInside(L, s, be) >= 0.5,
  origin: (L, s, be) => AW.insideBoundary(L.V, be, s.ax, s.ay),
  mid: (L, s, be) => AW.insideBoundary(L.V, be, (s.ax + s.bx) / 2, (s.ay + s.by) / 2),
  any: (L, s, be) => fracInside(L, s, be) > 0,
  near10: (L, s) => nearest(L, s) < 10,
  near30: (L, s) => nearest(L, s) < 30
};
const tot = {}; for (const r of Object.keys(rules)) tot[r] = { hit: 0, sel: 0, art: 0, wcov: 0, wtot: 0 };
for (const L of layers) {
  const be = AW.boundaryEdges(L.T);
  let wtot = 0; for (const w of L.wsum.values()) wtot += w;
  for (const r of Object.keys(rules)) {
    let sel = 0, hit = 0, wcov = 0;
    for (let s = 1; s < segs.length; s++) { if (rules[r](L, segs[s], be)) { sel++; if (L.ids.has(s)) { hit++; wcov += L.wsum.get(s); } } }
    tot[r].hit += hit; tot[r].sel += sel; tot[r].art += L.ids.size; tot[r].wcov += wcov; tot[r].wtot += wtot;
  }
}
console.log('rule      precision recall  weight-covered  selected/artist');
for (const r of Object.keys(rules)) console.log(`  ${r.padEnd(8)} ${(tot[r].hit / tot[r].sel).toFixed(3)}     ${(tot[r].hit / tot[r].art).toFixed(3)}   ${(tot[r].wcov / tot[r].wtot).toFixed(3)}           ${tot[r].sel}/${tot[r].art}`);
let outside = [];
for (const L of layers) { const be = AW.boundaryEdges(L.T); for (const id of L.ids) if (!rules.any(L, segs[id], be)) outside.push(`${L.name}:${mats[id].name}(len${mats[id].length.toFixed(0)},w${(L.wsum.get(id)).toFixed(1)},d${nearest(L, segs[id]).toFixed(0)})`); }
console.log('artist bones fully outside their layer:', outside.length, '\n  ' + outside.join(' '));
// per layer: how many extra bones does seg85 admit, and what weight share do the top-k artist bones carry
console.log('\nper layer (seg85): artist bones | rule picks | extra | weight share of the 3 heaviest artist bones');
for (const L of layers) {
  const be = AW.boundaryEdges(L.T); let sel = 0, hit = 0;
  for (let s = 1; s < segs.length; s++) if (rules.seg85(L, segs[s], be)) { sel++; if (L.ids.has(s)) hit++; }
  let wtot = 0; for (const w of L.wsum.values()) wtot += w;
  const top = Array.from(L.wsum.values()).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  console.log(`  ${L.name.padEnd(10)} ${String(L.ids.size).padStart(2)} | ${String(sel).padStart(2)} | ${String(sel - hit).padStart(2)} | ${(top / wtot).toFixed(2)}`);
}
