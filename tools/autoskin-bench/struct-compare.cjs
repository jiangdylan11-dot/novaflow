// Structural comparison of an automatic skeleton with the artist's rig, layer by layer:
// how many deformation bones each layer OWNS (the layer it mostly deforms), whether they
// are IK-driven, how long the chain is and where it starts — against the auto chain of
// the same layer. Flags the kinds of discrepancy a rigger would see at once: a ribbon
// with a limb mechanism, a hand cut into three, a leg without IK, a chain twice as long.
//   node struct-compare.cjs [--tag jiaye] [--rig <artist.json>] [--all]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs');
require(REPO + '/particle-editor/spine-auto-mesh-core.js');
require(REPO + '/particle-editor/spine-auto-weights.js');
const AW = globalThis.NovaFlowAutoWeights;
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; }
const TAG = arg('tag', 'jiaye');
const RIG = arg('rig', 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json');
const ALL = process.argv.includes('--all');
const OUT = path.join(__dirname, 'out', TAG);

function artistBones(rigJson) {
  const { skeleton } = H.loadSkeleton(rigJson);
  const mech = AW.mechanismBones(rigJson);
  const ikTargets = new Set((rigJson.ik || []).map((c) => c.target));
  const ikBones = new Set((rigJson.ik || []).flatMap((c) => c.bones));
  const mass = skeleton.bones.map(() => new Map());
  const skins = Array.isArray(rigJson.skins) ? rigJson.skins : Object.keys(rigJson.skins).map((n) => ({ name: n, attachments: rigJson.skins[n] }));
  for (const sk of skins) for (const slot of Object.keys(sk.attachments || {})) for (const an of Object.keys(sk.attachments[slot])) {
    const att = sk.attachments[slot][an];
    if (!att) continue;
    if (att.type !== 'mesh') {
      const sb = rigJson.slots.find((s) => s.name === slot); const bi = skeleton.bones.findIndex((b) => b.data.name === (sb && sb.bone));
      if (bi >= 0) mass[bi].set(slot, (mass[bi].get(slot) || 0) + 4);
      continue;
    }
    const n = att.uvs.length / 2;
    if (att.vertices.length === n * 2) {
      const sb = rigJson.slots.find((s) => s.name === slot); const bi = skeleton.bones.findIndex((b) => b.data.name === (sb && sb.bone));
      if (bi >= 0) mass[bi].set(slot, (mass[bi].get(slot) || 0) + n);
      continue;
    }
    const inf = AW.decodeWeighted(att.vertices, n);
    for (const v of inf) for (const e of v) mass[e.bone].set(slot, (mass[e.bone].get(slot) || 0) + e.w);
  }
  return skeleton.bones.map((b, i) => {
    let layer = null, best = 0, total = 0;
    for (const [slot, m] of mass[i]) { total += m; if (m > best) { best = m; layer = slot; } }
    const deform = b.data.length > 0 && !mech.has(i) && !ikTargets.has(b.data.name) && best > 0;
    return { name: b.data.name, index: i, parent: b.parent ? b.parent.data.name : null, ax: b.worldX, ay: b.worldY, bx: b.worldX + b.a * b.data.length, by: b.worldY + b.c * b.data.length, len: b.data.length, mech: mech.has(i), ikTarget: ikTargets.has(b.data.name), ik: ikBones.has(b.data.name), layer, deform, shareFrac: total > 0 ? best / total : 0, controller: !(b.data.length > 0) && !mech.has(i) && best > 0 };
  });
}

function chainDepth(names, parentOf) {
  const set = new Set(names);
  const memo = new Map();
  const depth = (n) => { if (memo.has(n)) return memo.get(n); const p = parentOf.get(n); const d = p && set.has(p) ? 1 + depth(p) : 1; memo.set(n, d); return d; };
  let m = 0; for (const n of names) m = Math.max(m, depth(n)); return m;
}

function compare(tag, rigFile) {
  const out = path.join(__dirname, 'out', tag);
  const rigJson = JSON.parse(fs.readFileSync(rigFile, 'utf8'));
  const art = artistBones(rigJson);
  const bj = JSON.parse(fs.readFileSync(path.join(out, 'bones.json'), 'utf8'));
  const auto = bj.bones;
  const plan = JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8'));
  const autoIk = new Set((bj.ik || []).flatMap((c) => c.bones));
  const artParent = new Map(art.map((b) => [b.name, b.parent]));
  const autoParent = new Map(auto.map((b) => [b.name, typeof b.parent === 'string' ? b.parent : (b.parent >= 0 && auto[b.parent] ? auto[b.parent].name : null)]));
  const layers = new Set([...art.filter((b) => b.layer).map((b) => b.layer), ...Object.keys(plan.layers)]);
  const rows = [];
  for (const L of layers) {
    const A = art.filter((b) => b.deform && b.layer === L);
    const Ac = art.filter((b) => b.controller && b.layer === L);
    const B = auto.filter((b) => b.kind === 'bone' && b.len > 0 && b.layer === L && (L !== plan.rootLayer || b.role !== 'connector'));
    const Bc = auto.filter((b) => b.kind === 'controller' && b.layer === L);
    const Bm = auto.filter((b) => (b.kind === 'pivot' || b.kind === 'helper' || b.kind === 'ikTarget') && b.layer === L);
    const aLen = A.reduce((s, b) => s + b.len, 0), bLen = B.reduce((s, b) => s + b.len, 0);
    const aIk = A.filter((b) => b.ik).length, bIk = B.filter((b) => autoIk.has(b.name)).length;
    const aDepth = A.length ? chainDepth(A.map((b) => b.name), artParent) : 0, bDepth = B.length ? chainDepth(B.map((b) => b.name), autoParent) : 0;
    const p = plan.layers[L] || {};
    const flags = [];
    if (!plan.layers[L]) flags.push('NOT-PLACED');
    else if (p.role === 'skipped') flags.push('SKIPPED');
    if (A.length === 0 && Ac.length === 0 && B.length >= 2) flags.push('ARTIST-NO-BONES');
    if (A.length > 0 && aIk > 0 && bIk === 0 && B.length > 0) flags.push('NO-IK');
    if (A.length > 0 && aIk === 0 && bIk > 0) flags.push('IK-EXTRA');
    if (A.length === 0 && Ac.length === 0 && bIk > 0) flags.push('IK-EXTRA');
    if (A.length > 0 && B.length > 2 * A.length + 1) flags.push('OVER-SEG');
    if (A.length >= 2 && B.length * 2 < A.length && B.length > 0) flags.push('UNDER-SEG');
    if (A.length > 0 && B.length > 0 && (bLen > 1.6 * aLen || bLen < 0.6 * aLen)) flags.push('LEN');
    if (Ac.length > 0 && B.length === 0 && Bc.length === 0) flags.push('NO-CONTROLLER');
    if (A.length === 0 && Ac.length > 0 && B.length > 0) flags.push('CONTROLLER-EXPECTED');
    rows.push({ L, role: p.role || '-', part: p.part || '-', A: A.length, Ac: Ac.length, aIk, aDepth, aLen, B: B.length, Bc: Bc.length, bIk, bDepth, bLen, Bm: Bm.length, flags, rootWhy: p.rootWhy || '-', parent: p.parent || '-', artistParents: [...new Set(A.map((b) => { const pb = art.find((x) => x.name === b.parent); return pb ? (pb.layer || pb.name) : '-'; }))].join('|') });
  }
  rows.sort((a, b) => (b.flags.length - a.flags.length) || (b.A - a.A));
  console.log(`== ${tag}: ${rows.length} layers, ${rows.filter((r) => r.flags.length).length} flagged`);
  console.log('layer              role/part          artist: n(ik) depth len   |  auto: n(ik) depth len mech  | flags');
  for (const r of rows) {
    if (!ALL && !r.flags.length) continue;
    console.log(`${r.L.padEnd(18)} ${(r.role + '/' + r.part).padEnd(18)} ${String(r.A).padStart(3)}(${r.aIk})+${r.Ac}c  ${String(r.aDepth).padStart(2)}  ${String(Math.round(r.aLen)).padStart(5)}   | ${String(r.B).padStart(3)}(${r.bIk})+${r.Bc}c  ${String(r.bDepth).padStart(2)}  ${String(Math.round(r.bLen)).padStart(5)}  ${String(r.Bm).padStart(2)}    | ${r.flags.join(' ')}${r.flags.length ? `  [root:${r.rootWhy} parent:${r.parent} artist-parent:${r.artistParents}]` : ''}`);
  }
  return rows;
}

module.exports = { artistBones, compare };
if (require.main === module) if (process.argv.includes('--three')) {
  compare('jiaye', 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json');
  compare('jinse', 'D:/foyo_new/立绘/锦瑟/NovaFlow/立绘.json');
  compare('anan', 'D:/AI_APP/spine查看/test/spine_lihui_anan_5.json');
} else compare(TAG, RIG);
