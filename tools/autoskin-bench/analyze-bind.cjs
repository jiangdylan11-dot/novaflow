// Where does inv(setupWorld)*worldVertex disagree with the artist's stored bone-local coords?
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs');
const H = require('./spine-headless.cjs'); const spine = H.spine;
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const rigJson = JSON.parse(fs.readFileSync((process.env.NOVA_AUTOSKIN_RIG || 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json'), 'utf8'));
const { data, skeleton } = H.loadSkeleton(rigJson);
const mats = skeleton.bones.map((b) => ({ name: b.data.name, a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY, length: b.data.length }));
const perBone = new Map();
const atts = rigJson.skins[0].attachments;
for (const slot of skeleton.slots) {
  const a = slot.getAttachment(); if (!(a instanceof spine.MeshAttachment)) continue;
  const att = atts[slot.data.name][a.name]; const n = a.worldVerticesLength / 2;
  const world = new Float32Array(2 * n); a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
  const inf = AW.decodeWeighted(att.vertices, n);
  for (let i = 0; i < n; i++) for (const e of inf[i]) {
    const m = AW.invertBone(mats[e.bone]); const dx = world[2 * i] - m.wx, dy = world[2 * i + 1] - m.wy;
    const d = Math.hypot(m.ia * dx + m.ib * dy - e.x, m.ic * dx + m.id * dy - e.y);
    const k = e.bone; const r = perBone.get(k) || { name: mats[k].name, max: 0, cnt: 0, layers: new Set(), wsum: 0 };
    r.max = Math.max(r.max, d); r.cnt++; r.layers.add(a.name); r.wsum += e.w; perBone.set(k, r);
  }
}
const rows = Array.from(perBone.values()).sort((x, y) => y.max - x.max);
console.log('bones with deviation > 1px:', rows.filter((r) => r.max > 1).length, 'of', rows.length);
const ikBones = new Set(), tcBones = new Set(), ikT = new Set(), tcT = new Set();
for (const c of data.ikConstraints) { for (const b of c.bones) ikBones.add(b.index); ikT.add(c.target.index); }
for (const c of data.transformConstraints) { for (const b of c.bones) tcBones.add(b.index); tcT.add(c.target.index); }
const tag = (k) => [ikBones.has(k) ? 'ikBone' : '', ikT.has(k) ? 'ikTarget' : '', tcBones.has(k) ? 'tcBone' : '', tcT.has(k) ? 'tcTarget' : ''].filter(Boolean).join('+') || '-';
for (const r of rows.slice(0, 14)) {
  const k = skeleton.findBoneIndex(r.name);
  console.log(`  ${r.name.padEnd(8)} max ${r.max.toFixed(1)}px entries ${r.cnt} meanW ${(r.wsum / r.cnt).toFixed(3)} ${tag(k)} parent=${skeleton.bones[k].parent ? skeleton.bones[k].parent.data.name : ''} layers [${Array.from(r.layers).join(',')}]`);
}
// does the deviation vanish without constraints?
for (const c of skeleton.ikConstraints) c.mix = 0;
for (const c of skeleton.transformConstraints) { c.rotateMix = 0; c.translateMix = 0; c.scaleMix = 0; c.shearMix = 0; }
skeleton.updateWorldTransform();
const mats2 = skeleton.bones.map((b) => ({ a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY }));
let worst2 = 0; const perBone2 = new Map();
for (const slot of skeleton.slots) {
  const a = slot.getAttachment(); if (!(a instanceof spine.MeshAttachment)) continue;
  const att = atts[slot.data.name][a.name]; const n = a.worldVerticesLength / 2;
  const world = new Float32Array(2 * n); a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
  const inf = AW.decodeWeighted(att.vertices, n);
  for (let i = 0; i < n; i++) for (const e of inf[i]) {
    const m = AW.invertBone(mats2[e.bone]); const dx = world[2 * i] - m.wx, dy = world[2 * i + 1] - m.wy;
    const d = Math.hypot(m.ia * dx + m.ib * dy - e.x, m.ic * dx + m.id * dy - e.y);
    worst2 = Math.max(worst2, d); perBone2.set(e.bone, Math.max(perBone2.get(e.bone) || 0, d));
  }
}
console.log('with all constraint mixes forced to 0: worst deviation', worst2.toFixed(3), 'px; bones > 1px:', Array.from(perBone2.entries()).filter(([, d]) => d > 1).map(([k, d]) => `${mats[k].name}:${d.toFixed(1)}`).join(' '));
