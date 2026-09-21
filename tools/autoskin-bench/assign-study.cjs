// Exclusive bone->layer assignment: can "the layer that fits the bone tightest"
// reproduce the artist assignment? Ground truth = the layer carrying most of a
// bone's weight. Also evaluates chain-level (subtree) voting.
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
  const T = Array.from(a.triangles); let area = 0;
  for (let t = 0; t < T.length; t += 3) { const i = T[t], j = T[t + 1], k = T[t + 2]; area += 0.5 * Math.abs((world[2 * j] - world[2 * i]) * (world[2 * k + 1] - world[2 * i + 1]) - (world[2 * j + 1] - world[2 * i + 1]) * (world[2 * k] - world[2 * i])); }
  const be = AW.boundaryEdges(T);
  layers.push({ name: a.name, V: Array.from(world), T, be, area, wsum, n, drawIndex: layers.length });
}
// primary layer per bone
const primary = new Map();
for (const L of layers) for (const [id, w] of L.wsum) { const p = primary.get(id); if (!p || w > p.w) primary.set(id, { layer: L.name, w }); }
const truthSets = new Map(layers.map((L) => [L.name, new Set(L.wsum.keys())]));

function distToBoundary(L, x, y) { let d = Infinity; for (let e = 0; e < L.be.length; e += 2) { const a = L.be[e], b = L.be[e + 1]; d = Math.min(d, AW.segPoint(x, y, L.V[2 * a], L.V[2 * a + 1], L.V[2 * b], L.V[2 * b + 1])); } return d; }
const NS = 9;
// per bone per layer features
const feat = new Map();
for (let s = 1; s < segs.length; s++) {
  const b = segs[s]; const row = [];
  for (const L of layers) {
    let inside = 0, edt = 0;
    for (let k = 0; k < NS; k++) { const u = k / (NS - 1); const x = b.ax + u * (b.bx - b.ax), y = b.ay + u * (b.by - b.ay); if (AW.insideBoundary(L.V, L.be, x, y)) { inside++; edt += distToBoundary(L, x, y); } }
    row.push({ L, frac: inside / NS, edt: inside ? edt / inside : Infinity });
  }
  feat.set(s, row);
}
const rules = {
  smallestArea: (row) => row.filter((r) => r.frac >= 0.85).sort((a, b) => a.L.area - b.L.area)[0],
  tightestEDT: (row) => row.filter((r) => r.frac >= 0.85).sort((a, b) => a.edt - b.edt)[0],
  tightestEDT50: (row) => row.filter((r) => r.frac >= 0.5).sort((a, b) => a.edt - b.edt)[0],
  edtOverSqrtArea: (row) => row.filter((r) => r.frac >= 0.85).sort((a, b) => a.edt / Math.sqrt(a.L.area) - b.edt / Math.sqrt(b.L.area))[0],
  topmostDraw: (row) => row.filter((r) => r.frac >= 0.85).sort((a, b) => b.L.drawIndex - a.L.drawIndex)[0]
};
const used = Array.from(primary.keys()).filter((id) => id > 0);
console.log(`bones with weights: ${used.length}`);
for (const rn of Object.keys(rules)) {
  let ok = 0, none = 0; const perLayer = new Map(layers.map((L) => [L.name, new Set()]));
  for (let s = 1; s < segs.length; s++) { const pick = rules[rn](feat.get(s)); if (pick) perLayer.get(pick.L.name).add(s); }
  for (const id of used) { const pick = rules[rn](feat.get(id)); if (!pick) none++; else if (pick.L.name === primary.get(id).layer) ok++; }
  let hit = 0, sel = 0, art = 0;
  for (const L of layers) { const S = perLayer.get(L.name), Tt = truthSets.get(L.name); sel += S.size; art += Tt.size; for (const s of S) if (Tt.has(s)) hit++; }
  console.log(`  ${rn.padEnd(16)} bone->primary layer correct ${ok}/${used.length} (${(100 * ok / used.length).toFixed(0)}%), unassigned ${none}; as layer sets: precision ${(hit / sel).toFixed(3)} recall ${(hit / art).toFixed(3)} (${sel} picks / ${art} truth)`);
}
// chain-level: a chain = maximal run of bones where each bone has exactly one child and parent in the candidate pool
const rn = 'tightestEDT';
const pick = new Map(); for (let s = 1; s < segs.length; s++) { const p = rules[rn](feat.get(s)); if (p) pick.set(s, p.L.name); }
// group into subtrees by parent links among assigned bones; vote by bone length
const children = new Map(); for (let s = 1; s < mats.length; s++) { const p = mats[s].parent; if (!children.has(p)) children.set(p, []); children.get(p).push(s); }
function chainOf(s) { const out = [s]; let cur = s; while ((children.get(cur) || []).length === 1) { cur = children.get(cur)[0]; out.push(cur); } return out; }
const visited = new Set(); const chainPick = new Map(); let chains = 0;
for (let s = 1; s < mats.length; s++) {
  if (visited.has(s)) continue;
  const p = mats[s].parent; if (p > 0 && (children.get(p) || []).length === 1) continue; // not a chain head
  const ch = chainOf(s); ch.forEach((x) => visited.add(x)); chains++;
  const votes = new Map(); for (const x of ch) { const l = pick.get(x); if (l) votes.set(l, (votes.get(l) || 0) + Math.max(1, mats[x].length)); }
  const best = Array.from(votes.entries()).sort((a, b) => b[1] - a[1])[0];
  for (const x of ch) chainPick.set(x, best ? best[0] : null);
}
{
  let ok = 0; const perLayer = new Map(layers.map((L) => [L.name, new Set()]));
  for (const [s, l] of chainPick) if (l) perLayer.get(l).add(s);
  for (const id of used) if (chainPick.get(id) === primary.get(id).layer) ok++;
  let hit = 0, sel = 0, art = 0;
  for (const L of layers) { const S = perLayer.get(L.name), Tt = truthSets.get(L.name); sel += S.size; art += Tt.size; for (const s of S) if (Tt.has(s)) hit++; }
  console.log(`  chain-vote(${rn})  ${chains} chains; correct ${ok}/${used.length} (${(100 * ok / used.length).toFixed(0)}%); precision ${(hit / sel).toFixed(3)} recall ${(hit / art).toFixed(3)}`);
  console.log('\n  per layer (tightestEDT, per-bone): truth | picked | missed names');
  for (const L of layers) {
    const S = new Set(); for (const [s, l] of pick) if (l === L.name) S.add(s);
    const Tt = truthSets.get(L.name);
    const missed = Array.from(Tt).filter((s) => !S.has(s)).map((s) => mats[s].name + (pick.get(s) ? '->' + pick.get(s) : '->none'));
    const extra = Array.from(S).filter((s) => !Tt.has(s)).map((s) => mats[s].name);
    console.log(`    ${L.name.padEnd(10)} ${String(Tt.size).padStart(2)} | ${String(S.size).padStart(2)} | missed [${missed.join(' ')}] extra [${extra.join(' ')}]`);
  }
}
