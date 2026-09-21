// For layers no bone runs through: the nearest candidate bones, their distance and
// length, and what the artist actually used.
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const rigJson = JSON.parse(fs.readFileSync((process.env.NOVA_AUTOSKIN_RIG || 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json'), 'utf8'));
const { data, skeleton } = H.loadSkeleton(rigJson);
const mats = skeleton.bones.map((b) => ({ name: b.data.name, a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY, length: b.data.length }));
const segs = mats.map(AW.boneSegment);
const skip = new Set([0]);
const tcT = new Set(); for (const c of data.transformConstraints) tcT.add(c.target.index);
for (const c of data.ikConstraints) { skip.add(c.target.index); if (c.bones.some((b) => tcT.has(b.index))) for (const b of c.bones) skip.add(b.index); }
skeleton.bones.forEach((b, i) => { if (!(b.data.length > 0) && b.children.length > 0) skip.add(i); });
const atts = rigJson.skins[0].attachments;
const lens = mats.filter((m, i) => !skip.has(i) && m.length > 0).map((m) => m.length).sort((a, b) => a - b);
console.log('median candidate bone length', lens[Math.floor(lens.length / 2)].toFixed(0));
for (const slot of skeleton.slots) {
  const a = slot.getAttachment(); if (!(a instanceof spine.MeshAttachment)) continue;
  if (!['fashj1', 'daizi1_1', 'hua1', 'xianlian', 'daizi4', 'fashi2'].includes(a.name)) continue;
  const n = a.worldVerticesLength / 2; const world = new Float32Array(2 * n); a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
  const inf = AW.decodeWeighted(atts[slot.data.name][a.name].vertices, n);
  const used = new Map(); for (const v of inf) for (const e of v) used.set(e.bone, (used.get(e.bone) || 0) + e.w);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9; for (let i = 0; i < n; i++) { minX = Math.min(minX, world[2 * i]); maxX = Math.max(maxX, world[2 * i]); minY = Math.min(minY, world[2 * i + 1]); maxY = Math.max(maxY, world[2 * i + 1]); }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const cands = [];
  for (let s = 0; s < segs.length; s++) { if (skip.has(s)) continue; let d = Infinity; for (let i = 0; i < n; i++) d = Math.min(d, AW.segPoint(world[2 * i], world[2 * i + 1], segs[s].ax, segs[s].ay, segs[s].bx, segs[s].by)); cands.push({ s, d }); }
  cands.sort((x, y) => x.d - y.d);
  console.log(`\n${a.name} diag ${diag.toFixed(0)}  artist: ${Array.from(used.entries()).map(([b, w]) => `${mats[b].name}(len${mats[b].length.toFixed(0)},w${w.toFixed(1)})`).join(' ')}`);
  console.log('  nearest: ' + cands.slice(0, 8).map((c) => `${mats[c.s].name}(d${c.d.toFixed(0)},len${mats[c.s].length.toFixed(0)}${used.has(c.s) ? ',*' : ''})`).join(' '));
}
