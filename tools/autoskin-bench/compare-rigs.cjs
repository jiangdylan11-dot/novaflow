// What changed between two artist rigs: bones, meshes, per-layer bone sets and
// weight distributions, animation keys. Used to read an optimised rig against the
// previous one before re-running the bench on it.
//   node compare-rigs.cjs <old.json> <new.json> [layers to detail, comma separated]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs');
const H = require('./spine-headless.cjs'); const spine = H.spine;
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const [oldFile, newFile] = process.argv.slice(2, 4);
const detail = (process.argv[4] || 'faec,body,leg_1,leg_2').split(',');
const load = (f) => { const json = JSON.parse(fs.readFileSync(f, 'utf8')); const rig = H.loadSkeleton(json); return { json, ...rig }; };
const A = load(oldFile), B = load(newFile);
console.log(`old: ${A.json.bones.length} bones, ${A.json.slots.length} slots, spine ${A.json.skeleton.spine}, hash ${A.json.skeleton.hash}`);
console.log(`new: ${B.json.bones.length} bones, ${B.json.slots.length} slots, spine ${B.json.skeleton.spine}, hash ${B.json.skeleton.hash}`);
// bones
const bonesA = new Map(A.json.bones.map((b) => [b.name, b])), bonesB = new Map(B.json.bones.map((b) => [b.name, b]));
const added = B.json.bones.filter((b) => !bonesA.has(b.name)).map((b) => b.name);
const removed = A.json.bones.filter((b) => !bonesB.has(b.name)).map((b) => b.name);
const moved = [];
for (const [n, b] of bonesB) { const a = bonesA.get(n); if (!a) continue; const d = Math.hypot((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0)); const dr = Math.abs((b.rotation || 0) - (a.rotation || 0)); const dl = Math.abs((b.length || 0) - (a.length || 0)); if (d > 0.5 || dr > 0.5 || dl > 0.5 || a.parent !== b.parent) moved.push(`${n}(${d > 0.5 ? 'pos ' + d.toFixed(0) : ''}${dr > 0.5 ? ' rot ' + dr.toFixed(0) : ''}${dl > 0.5 ? ' len ' + dl.toFixed(0) : ''}${a.parent !== b.parent ? ' parent ' + a.parent + '->' + b.parent : ''})`); }
console.log(`bones added [${added.join(' ')}] removed [${removed.join(' ')}] changed ${moved.length}: ${moved.slice(0, 20).join(' ')}`);
console.log(`ik ${A.json.ik.length} -> ${B.json.ik.length}, transform ${A.json.transform.length} -> ${B.json.transform.length}`);
// per layer
function layerStats(R) {
  const out = new Map();
  const atts = R.json.skins[0].attachments;
  for (const slot of R.skeleton.slots) {
    const a = slot.getAttachment(); if (!(a instanceof spine.MeshAttachment)) continue;
    const att = atts[slot.data.name][a.name]; const n = a.worldVerticesLength / 2;
    const inf = AW.decodeWeighted(att.vertices, n);
    const per = new Map();
    for (const v of inf) for (const e of v) { const s = per.get(e.bone) || { cnt: 0, sum: 0, max: 0 }; s.cnt++; s.sum += e.w; s.max = Math.max(s.max, e.w); per.set(e.bone, s); }
    let maxInf = 0, sumInf = 0; for (const v of inf) { maxInf = Math.max(maxInf, v.length); sumInf += v.length; }
    out.set(a.name, { n, hull: att.hull, tris: att.triangles.length / 3, per, meanInf: sumInf / n, maxInf, width: att.width, height: att.height, uvs: att.uvs, bones: R.skeleton.bones });
  }
  return out;
}
const SA = layerStats(A), SB = layerStats(B);
const nameOf = (R, i) => R.skeleton.bones[i].data.name;
console.log('\nlayer       verts old->new  tris      bones old->new   mean/max influences   bone-set changes');
for (const [name, sb] of SB) {
  const sa = SA.get(name);
  if (!sa) { console.log(`  ${name.padEnd(10)} NEW LAYER`); continue; }
  const setA = new Set(Array.from(sa.per.keys()).map((i) => nameOf(A, i))), setB = new Set(Array.from(sb.per.keys()).map((i) => nameOf(B, i)));
  const plus = Array.from(setB).filter((x) => !setA.has(x)), minus = Array.from(setA).filter((x) => !setB.has(x));
  const uvSame = sa.n === sb.n && sa.uvs.every((u, i) => Math.abs(u - sb.uvs[i]) < 1e-6);
  console.log(`  ${name.padEnd(10)} ${String(sa.n).padStart(4)}->${String(sb.n).padEnd(4)} ${uvSame ? 'same uv ' : 'REMESHED'} ${String(sa.tris).padStart(4)}->${String(sb.tris).padEnd(4)} ${String(sa.per.size).padStart(2)}->${String(sb.per.size).padEnd(2)}  ${sa.meanInf.toFixed(2)}/${sa.maxInf} -> ${sb.meanInf.toFixed(2)}/${sb.maxInf}   +[${plus.join(' ')}] -[${minus.join(' ')}]`);
}
for (const L of SA.keys()) if (!SB.has(L)) console.log(`  ${L.padEnd(10)} REMOVED`);
// weight distributions for the detailed layers
for (const name of detail) {
  const sa = SA.get(name), sb = SB.get(name); if (!sb) continue;
  console.log(`\n== ${name}: per-bone weight (verts / total / max)`);
  const rows = new Map();
  if (sa) for (const [i, s] of sa.per) rows.set(nameOf(A, i), { old: s });
  for (const [i, s] of sb.per) { const k = nameOf(B, i); rows.set(k, Object.assign(rows.get(k) || {}, { nw: s })); }
  for (const [k, r] of Array.from(rows.entries()).sort((x, y) => ((y[1].nw || y[1].old).sum) - ((x[1].nw || x[1].old).sum))) {
    const f = (s) => s ? `${String(s.cnt).padStart(3)} / ${s.sum.toFixed(1).padStart(6)} / ${s.max.toFixed(2)}` : '        -        ';
    const bone = bonesB.get(k) || bonesA.get(k);
    console.log(`  ${k.padEnd(8)} len ${String((bone.length || 0).toFixed(0)).padStart(4)}  old ${f(r.old)}   new ${f(r.nw)}`);
  }
}
// animation changes
const anA = A.json.animations, anB = B.json.animations;
console.log(`\nanimations old [${Object.keys(anA).join(' ')}] new [${Object.keys(anB).join(' ')}]`);
for (const k of Object.keys(anB)) {
  const a = anA[k], b = anB[k]; if (!a) { console.log(`  ${k}: NEW`); continue; }
  const bonesKeyedA = Object.keys(a.bones || {}), bonesKeyedB = Object.keys(b.bones || {});
  const same = JSON.stringify(a.bones) === JSON.stringify(b.bones);
  console.log(`  ${k}: bones keyed ${bonesKeyedA.length} -> ${bonesKeyedB.length}, bone timelines ${same ? 'identical' : 'CHANGED'}, deform slots old [${Object.keys((a.deform || {}).default || {}).join(' ')}] new [${Object.keys((b.deform || {}).default || {}).join(' ')}]`);
}
