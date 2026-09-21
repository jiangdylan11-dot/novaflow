// For the bones B2 gets wrong on the big layers: who uses them in the artist rig,
// what role do they play (IK chain / target, constraint), how long are they?
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const rigJson = JSON.parse(fs.readFileSync((process.env.NOVA_AUTOSKIN_RIG || 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json'), 'utf8'));
const build = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'build.json'), 'utf8'));
const { data, skeleton } = H.loadSkeleton(rigJson);
const atts = rigJson.skins[0].attachments;
const usage = new Map();
for (const slot of skeleton.slots) {
  const a = slot.getAttachment(); if (!(a instanceof spine.MeshAttachment)) continue;
  const inf = AW.decodeWeighted(atts[slot.data.name][a.name].vertices, a.worldVerticesLength / 2);
  const w = new Map(); for (const v of inf) for (const e of v) w.set(e.bone, (w.get(e.bone) || 0) + e.w);
  for (const [b, s] of w) { if (!usage.has(b)) usage.set(b, []); usage.get(b).push(`${a.name}:${s.toFixed(1)}`); }
}
const ikBones = new Map(), ikT = new Set(), tcBones = new Map(), tcT = new Set();
for (const c of data.ikConstraints) { for (const b of c.bones) ikBones.set(b.index, c.name); ikT.add(c.target.index); }
for (const c of data.transformConstraints) { for (const b of c.bones) tcBones.set(b.index, c.name); tcT.add(c.target.index); }
const idx = (name) => skeleton.findBoneIndex(name);
function describe(name) {
  const i = idx(name); const b = skeleton.bones[i];
  const role = [ikBones.has(i) ? 'ikChain(' + ikBones.get(i) + ')' : '', ikT.has(i) ? 'ikTarget' : '', tcBones.has(i) ? 'tcBone(' + tcBones.get(i) + ')' : '', tcT.has(i) ? 'tcTarget' : ''].filter(Boolean).join('+') || '-';
  return `${name.padEnd(8)} len ${String(b.data.length.toFixed(0)).padStart(4)} parent ${(b.parent ? b.parent.data.name : '-').padEnd(8)} children ${b.children.length} ${role.padEnd(22)} artist: ${(usage.get(i) || ['UNUSED']).join(' ')}`;
}
for (const layer of ['hair_back', 'skirt', 'body', 'leg_2', 'leg_1', 'xiongzhao', 'faec', 'hair_front', 'bu3']) {
  const r = build.layers[layer]; if (!r || !r.B2) continue;
  console.log(`\n== ${layer}  (B2 extra ${r.B2.extra.length}, missed ${r.B2.missed.length})`);
  for (const n of r.B2.extra) console.log('  EXTRA  ' + describe(n));
  for (const n of r.B2.missed) console.log('  MISSED ' + describe(n));
}
// unused bones overall
const unused = skeleton.bones.filter((b) => !usage.has(b.data.index) && b.data.index > 0).map((b) => b.data.name);
console.log('\nbones the artist never weights:', unused.length, unused.join(' '));
const unusedIk = unused.filter((n) => ikBones.has(idx(n))).length;
console.log(`  of which IK chain bones: ${unusedIk}; IK targets: ${unused.filter((n) => ikT.has(idx(n))).length}; zero length: ${unused.filter((n) => !(skeleton.bones[idx(n)].data.length > 0)).length}`);
