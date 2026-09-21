// Compare an automatic skeleton with the artist's rig, bone by bone.
//   node bones-compare.cjs [--tag jiaye] [--rig <artist.json>] [--tau 20]
// Reads out/<tag>/bones.json + plan.json (from auto-bones.cjs). Reports, overall and per
// region (regions come from the layer each artist bone mostly deforms):
//   coverage   fraction of the artist's deformation-bone length that has an auto bone
//              within tau px running in the same direction (±30°, either sense);
//   precision  fraction of auto bone length that has an artist bone within tau px;
//   joints     distance from each artist joint (bone origin) to the nearest auto joint;
//   hierarchy  whether each layer's auto chain hangs from the layer the artist hung it from.
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
require(REPO + '/particle-editor/spine-auto-mesh-core.js');
require(REPO + '/particle-editor/spine-auto-weights.js');
require(REPO + '/particle-editor/spine-auto-bones.js');
const AW = globalThis.NovaFlowAutoWeights, AB = globalThis.NovaFlowAutoBones;
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; }
const TAG = arg('tag', 'jiaye');
const RIG = arg('rig', 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json');
const TAU = Number(arg('tau', 20));
const OUT = path.join(__dirname, 'out', TAG);

function regionOf(layerName) {
  const p = AB.nameHint(layerName).part;
  if (p === 'body') return 'trunk';
  if (p === 'face' || p === 'head') return 'head';
  if (p === 'arm' || p === 'hand') return 'arms';
  if (p === 'leg' || p === 'foot') return 'legs';
  if (p === 'hair') return 'hair';
  if (p === 'cloth') return 'cloth';
  if (p === 'accessory') return 'accessory';
  return 'other';
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Artist bones as world segments, with the layer each one mostly deforms (from the mesh weights). */
function artistBones(rigJson) {
  const { skeleton } = H.loadSkeleton(rigJson);
  const mech = AW.mechanismBones(rigJson);
  const ikTargets = new Set((rigJson.ik || []).map((c) => c.target));
  const mass = skeleton.bones.map(() => new Map());
  const skins = Array.isArray(rigJson.skins) ? rigJson.skins : Object.keys(rigJson.skins).map((n) => ({ name: n, attachments: rigJson.skins[n] }));
  for (const sk of skins) for (const slot of Object.keys(sk.attachments || {})) for (const an of Object.keys(sk.attachments[slot])) {
    const att = sk.attachments[slot][an];
    if (!att || att.type !== 'mesh') continue;
    const n = att.uvs.length / 2;
    if (att.vertices.length === n * 2) { // unweighted mesh: the slot bone owns it
      const sb = rigJson.slots.find((s) => s.name === slot); const bi = skeleton.bones.findIndex((b) => b.data.name === (sb && sb.bone));
      if (bi >= 0) mass[bi].set(slot, (mass[bi].get(slot) || 0) + n);
      continue;
    }
    const inf = AW.decodeWeighted(att.vertices, n);
    for (const v of inf) for (const e of v) mass[e.bone].set(slot, (mass[e.bone].get(slot) || 0) + e.w);
  }
  return skeleton.bones.map((b, i) => {
    let layer = null, best = 0;
    for (const [slot, m] of mass[i]) if (m > best) { best = m; layer = slot; }
    const deform = b.data.length > 0 && !mech.has(i) && !ikTargets.has(b.data.name) && best > 0;
    return { name: b.data.name, parent: b.parent ? b.parent.data.name : null, ax: b.worldX, ay: b.worldY, bx: b.worldX + b.a * b.data.length, by: b.worldY + b.c * b.data.length, len: b.data.length, mech: mech.has(i), ikTarget: ikTargets.has(b.data.name), layer, deform, controller: !(b.data.length > 0) && !mech.has(i) && best > 0 };
  });
}

(function main() {
  const rigJson = JSON.parse(fs.readFileSync(RIG, 'utf8'));
  const art = artistBones(rigJson);
  const auto = JSON.parse(fs.readFileSync(path.join(OUT, 'bones.json'), 'utf8')).bones;
  const plan = JSON.parse(fs.readFileSync(path.join(OUT, 'plan.json'), 'utf8'));
  const artD = art.filter((b) => b.deform);
  const autoD = auto.filter((b) => b.kind === 'bone' && b.len > 0);
  const artByName = new Map(art.map((b) => [b.name, b]));
  console.log(`artist: ${art.length} bones, ${artD.length} deformation bones (${art.filter((b) => b.mech).length} mechanism, ${art.filter((b) => b.controller).length} zero-length controllers)`);
  console.log(`auto:   ${auto.length} bones, ${autoD.length} with length (${auto.filter((b) => b.kind === 'ikTarget').length} IK targets, ${auto.filter((b) => b.kind === 'controller').length} controllers)`);

  // ---- coverage of the artist's bones
  const NS = 10;
  const regions = {};
  const reg = (r) => regions[r] || (regions[r] = { artLen: 0, covLen: 0, flipLen: 0, autoLen: 0, precLen: 0, joints: [], artBones: 0, autoBones: 0, missed: [] });
  for (const b of artD) {
    const r = reg(regionOf(b.layer)); r.artBones++;
    const dx = b.bx - b.ax, dy = b.by - b.ay, L = Math.hypot(dx, dy) || 1;
    let cov = 0, flip = 0;
    for (let k = 0; k < NS; k++) {
      const u = (k + 0.5) / NS, px = b.ax + u * dx, py = b.ay + u * dy;
      let ok = 0, fl = 0;
      for (const a of autoD) {
        if (segDist(px, py, a.ax, a.ay, a.bx, a.by) > TAU) continue;
        const ex = a.bx - a.ax, ey = a.by - a.ay, La = Math.hypot(ex, ey) || 1;
        const cs = (dx * ex + dy * ey) / (L * La);
        if (cs >= Math.cos(30 * Math.PI / 180)) { ok = 1; break; }
        if (cs <= -Math.cos(30 * Math.PI / 180)) fl = 1;
      }
      cov += ok; if (!ok && fl) flip++;
    }
    r.artLen += L; r.covLen += L * cov / NS; r.flipLen += L * flip / NS;
    if (cov / NS < 0.5) r.missed.push(`${b.name}(${b.layer})`);
  }
  // ---- precision of the auto bones
  for (const a of autoD) {
    const r = reg(regionOf(a.layer === plan.rootLayer ? 'body' : a.layer)); r.autoBones++;
    const dx = a.bx - a.ax, dy = a.by - a.ay, L = Math.hypot(dx, dy) || 1;
    let hit = 0;
    for (let k = 0; k < NS; k++) {
      const u = (k + 0.5) / NS, px = a.ax + u * dx, py = a.ay + u * dy;
      if (artD.some((b) => segDist(px, py, b.ax, b.ay, b.bx, b.by) <= TAU)) hit++;
    }
    r.autoLen += L; r.precLen += L * hit / NS;
  }
  // ---- joints: artist bone origins (deduped) → nearest auto joint
  const autoJoints = [];
  for (const a of auto) { if (a.kind === 'root') continue; autoJoints.push([a.ax, a.ay]); if (a.len > 0) autoJoints.push([a.bx, a.by]); }
  const seen = new Set();
  for (const b of artD) {
    const key = `${b.ax.toFixed(0)},${b.ay.toFixed(0)}`; if (seen.has(key)) continue; seen.add(key);
    let bd = Infinity; for (const j of autoJoints) bd = Math.min(bd, Math.hypot(j[0] - b.ax, j[1] - b.ay));
    reg(regionOf(b.layer)).joints.push(bd);
  }
  const pct = (arr, p) => { if (!arr.length) return NaN; const s = arr.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const order = ['trunk', 'head', 'arms', 'legs', 'hair', 'cloth', 'accessory', 'other'];
  const tot = { artLen: 0, covLen: 0, flipLen: 0, autoLen: 0, precLen: 0, joints: [], artBones: 0, autoBones: 0 };
  console.log(`\nregion      artist  auto   coverage  flipped  precision  joint px median / p75 / p90   missed (<50% covered)`);
  for (const k of order) {
    const r = regions[k]; if (!r) continue;
    tot.artLen += r.artLen; tot.covLen += r.covLen; tot.flipLen += r.flipLen; tot.autoLen += r.autoLen; tot.precLen += r.precLen; tot.joints.push(...r.joints); tot.artBones += r.artBones; tot.autoBones += r.autoBones;
    console.log(`${k.padEnd(11)} ${String(r.artBones).padStart(5)} ${String(r.autoBones).padStart(5)}   ${(100 * r.covLen / Math.max(1e-9, r.artLen)).toFixed(1).padStart(6)}%  ${(100 * r.flipLen / Math.max(1e-9, r.artLen)).toFixed(1).padStart(5)}%   ${(100 * r.precLen / Math.max(1e-9, r.autoLen)).toFixed(1).padStart(6)}%   ${pct(r.joints, 0.5).toFixed(0).padStart(5)} / ${pct(r.joints, 0.75).toFixed(0).padStart(3)} / ${pct(r.joints, 0.9).toFixed(0).padStart(3)}      ${r.missed.slice(0, 8).join(' ')}${r.missed.length > 8 ? ` +${r.missed.length - 8}` : ''}`);
  }
  console.log(`${'ALL'.padEnd(11)} ${String(tot.artBones).padStart(5)} ${String(tot.autoBones).padStart(5)}   ${(100 * tot.covLen / tot.artLen).toFixed(1).padStart(6)}%  ${(100 * tot.flipLen / tot.artLen).toFixed(1).padStart(5)}%   ${(100 * tot.precLen / tot.autoLen).toFixed(1).padStart(6)}%   ${pct(tot.joints, 0.5).toFixed(0).padStart(5)} / ${pct(tot.joints, 0.75).toFixed(0).padStart(3)} / ${pct(tot.joints, 0.9).toFixed(0).padStart(3)}`);

  // ---- hierarchy: the artist's parent layer of each layer's chain vs the auto plan
  console.log(`\nhierarchy (layer ← parent layer):   artist   |   auto`);
  const layerBonesArt = new Map();
  for (const b of art) if (b.layer && (b.deform || b.controller)) { if (!layerBonesArt.has(b.layer)) layerBonesArt.set(b.layer, []); layerBonesArt.get(b.layer).push(b); }
  let agree = 0, total = 0;
  const rows = [];
  for (const [layer, p] of Object.entries(plan.layers)) {
    if (!p.parent && p.role === 'trunk') continue;
    const mine = new Set((layerBonesArt.get(layer) || []).map((b) => b.name));
    // artist parent layers: the layer of the first ancestor that deforms another layer
    const parents = new Map();
    for (const b of layerBonesArt.get(layer) || []) {
      let q = artByName.get(b.parent), hops = 0;
      while (q && hops < 6 && (mine.has(q.name) || (!q.deform && !q.controller))) { q = artByName.get(q.parent); hops++; }
      if (q && q.layer && q.layer !== layer) parents.set(q.layer, (parents.get(q.layer) || 0) + 1);
    }
    const artP = Array.from(parents.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v > 1 ? '×' + v : ''}`);
    const autoP = p.parent === plan.rootLayer ? 'body' : p.parent;
    const artPrimary = artP.length ? artP[0].replace(/×\d+$/, '') : null;
    const ok = artPrimary === null ? null : (artPrimary === (p.parent || '') || parents.has(p.parent));
    if (ok !== null) { total++; if (ok) agree++; }
    rows.push(`  ${layer.padEnd(11)} ← ${(artP.join(', ') || '-').padEnd(26)} | ${String(autoP || '-').padEnd(11)} ${ok === null ? '' : (ok ? 'ok' : 'DIFF')}  (${p.role}${p.rootWhy ? ', root:' + p.rootWhy : ''}${p.parentWhy ? ', parent:' + p.parentWhy : ''})`);
  }
  console.log(rows.join('\n'));
  console.log(`hierarchy agreement: ${agree}/${total}`);
  // per-layer bone counts
  console.log(`\nbones per layer (artist deform+controller / auto):`);
  const names = Array.from(new Set([...layerBonesArt.keys(), ...Object.keys(plan.layers)])).sort();
  console.log('  ' + names.map((n) => `${n} ${(layerBonesArt.get(n) || []).filter((b) => b.deform).length}+${(layerBonesArt.get(n) || []).filter((b) => b.controller).length}/${(plan.layers[n] && plan.layers[n].bones ? plan.layers[n].bones.filter((x) => !/_ik$/.test(x)).length : 0)}`).join('  '));
  fs.writeFileSync(path.join(OUT, 'compare.json'), JSON.stringify({ tau: TAU, regions, hierarchy: { agree, total } }, null, 1));
})();
