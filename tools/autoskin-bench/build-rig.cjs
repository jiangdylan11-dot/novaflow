// Build the auto-weighted test rigs from the artist's finished rig.
//   A   artist mesh + artist bone set + auto weights        (isolates weight quality)
//   B   auto mesh   + per-layer geometric selection + auto  (old rule: bone inside silhouette)
//   B2  auto mesh   + exclusive chain-vote assignment + auto (the product path, module defaults)
//   B3  B2 without the point-controller parent anchor
//   C   auto mesh   + artist bone set + auto weights        (isolates bone selection)
// Layers are keyed by SLOT: a rig may draw one image from two slots (daizi5 reuses
// daizi4). The auto rigs keep only the first slot of a shared image, because the
// PS export has one layer for it; the artist's extra slot is left untouched there.
// Writes out/rig*.json, out/artist*.json and out/build.json.
//   node build-rig.cjs [density=22] [json-opts: {weights:{}, select:{}, assign:{}, mesh:{}}]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const root = REPO + '/particle-editor';
require(path.join(root, 'spine-auto-mesh-core.js'));
require(path.join(root, 'spine-auto-mesh.js'));
require(path.join(root, 'spine-auto-mesh-attach.js'));
require(path.join(root, 'spine-auto-weights.js'));
const AM = globalThis.NovaFlowAutoMesh, AW = globalThis.NovaFlowAutoWeights, AT = globalThis.NovaFlowAutoMeshAttach;

const RIG = (process.env.NOVA_AUTOSKIN_RIG || 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json');
const PS = (process.env.NOVA_AUTOSKIN_PS || 'D:/foyo_new/立绘/女角色 (2)/伽夜立绘/新建文件夹/伽夜立绘.json');
const IMG = (process.env.NOVA_AUTOSKIN_IMG || 'D:/foyo_new/立绘/女角色 (2)/伽夜立绘/新建文件夹/images/e');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const density = Number(process.argv[2] || 22);
const extra = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const weightOpts = extra.weights || {};
const selectOpts = extra.select || {};
const assignOpts = extra.assign || {};
const meshOpts = extra.mesh || {};

function boneMats(skeleton) {
  return skeleton.bones.map((b) => ({ name: b.data.name, a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY, length: b.data.length }));
}
/** Least-squares affine map from uv (pairs) to world (pairs): x = a u + b v + c, y = d u + e v + f. */
function fitAffine(uvs, world) {
  const n = uvs.length / 2;
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rx = [0, 0, 0], ry = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const r = [uvs[2 * i], uvs[2 * i + 1], 1];
    for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b]; rx[a] += r[a] * world[2 * i]; ry[a] += r[a] * world[2 * i + 1]; }
  }
  const solve = (A, bvec) => {
    const m = A.map((row, i) => [...row, bvec[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
      [m[c], m[p]] = [m[p], m[c]];
      for (let r = 0; r < 3; r++) { if (r === c) continue; const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
    }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  };
  const [a, b, c] = solve(M, rx), [d, e, f] = solve(M, ry);
  let se = 0;
  for (let i = 0; i < n; i++) { const u = uvs[2 * i], v = uvs[2 * i + 1]; se += (a * u + b * v + c - world[2 * i]) ** 2 + (d * u + e * v + f - world[2 * i + 1]) ** 2; }
  return { a, b, c, d, e, f, rms: Math.sqrt(se / n) };
}
function stripDeform(json) {
  const out = JSON.parse(JSON.stringify(json));
  for (const k of Object.keys(out.animations || {})) delete out.animations[k].deform;
  return out;
}

(async () => {
  const rigJson = JSON.parse(fs.readFileSync(RIG, 'utf8'));
  const psJson = JSON.parse(fs.readFileSync(PS, 'utf8'));
  const { data, skeleton } = H.loadSkeleton(rigJson);
  const mats = boneMats(skeleton);
  const segs = mats.map(AW.boneSegment);
  const boneNames = mats.map((m) => m.name);
  // Per-controller presets by bone name. The artist's eyelid points are compact,
  // strong and rigid (the lid slides over the eye); the mouth points wide and faint.
  // Geometry cannot tell an eyelid from a lip corner, the rig's names can.
  const presets = extra.presets !== undefined ? extra.presets : [
    { pattern: 'eye|lid', radiusFrac: 0.08, peak: 0.85, pin: 5 },
    { pattern: 'mouth|lip', radiusFrac: 0.16, peak: 0.3, pin: 0 }
  ];
  const presetHits = [];
  for (const p of presets) {
    const re = new RegExp(p.pattern, 'i');
    mats.forEach((m, i) => { if (!(m.length > 0) && re.test(m.name)) { Object.assign(segs[i], { radiusFrac: p.radiusFrac, peak: p.peak, pin: p.pin }); presetHits.push(m.name); } });
  }
  if (presetHits.length) console.log(`controller presets applied: ${presetHits.join(' ')}`);
  // logical hierarchy: a child of an IK target hangs off the chain that target drives
  // (thigh -> shin -> foot; hip -> leg chain / skirt strips); rawParents uses the tree as saved
  const parents = extra.rawParents ? skeleton.bones.map((b) => (b.parent ? b.parent.data.index : -1)) : Array.from(AW.logicalParents(rigJson));
  if (!extra.rawParents) { const changed = skeleton.bones.filter((b, i) => parents[i] !== (b.parent ? b.parent.data.index : -1)).map((b, k) => `${b.data.name}->${boneNames[parents[b.data.index]]}`); console.log(`logical parents differ from the tree for ${changed.length} bones: ${changed.join(' ')}`); }

  // skipNames (regex, e.g. "turn"): name hint for slide controllers the user paints by hand
  const skipSet = extra.noSkipRules ? new Set([0]) : AW.mechanismBones(rigJson, { skipNames: extra.skipNames ? new RegExp(extra.skipNames, 'i') : undefined });
  const candSegs = segs.map((s, i) => skipSet.has(i) ? { ...s, skip: true } : s);
  console.log(`mechanism bones skipped: ${skipSet.size} [${Array.from(skipSet).map((i) => boneNames[i]).join(' ')}]`);

  const place = {};
  for (const s of Object.keys(psJson.skins.default)) for (const an of Object.keys(psJson.skins.default[s])) place[an] = psJson.skins.default[s][an];

  // ---- artist ground truth per slot
  const artist = {};
  const skinAtts = rigJson.skins[0].attachments;
  const drawIndex = new Map();
  const imageOwner = new Map();     // image name -> first slot drawing it
  skeleton.slots.forEach((slot, i) => {
    const a = slot.getAttachment();
    if (!(a instanceof spine.MeshAttachment)) return;
    const slotName = slot.data.name, attName = a.name, image = a.path || a.name;
    drawIndex.set(slotName, i);
    const att = skinAtts[slotName][attName];
    const n = a.worldVerticesLength / 2;
    const world = new Float32Array(2 * n);
    a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
    const inf = AW.decodeWeighted(att.vertices, n);
    const ids = Array.from(new Set(inf.flatMap((v) => v.map((e) => e.bone)))).sort((x, y) => x - y);
    const col = new Map(ids.map((id, j) => [id, j]));
    const W = new Float64Array(n * ids.length);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const e of inf[i]) { W[i * ids.length + col.get(e.bone)] += e.w; s += e.w; }
      if (s > 0) for (let j = 0; j < ids.length; j++) W[i * ids.length + j] /= s;
    }
    const duplicate = imageOwner.has(image);
    if (!duplicate) imageOwner.set(image, slotName);
    artist[slotName] = { slot: slotName, attName, image, duplicate, n, world: Array.from(world), tris: Array.from(a.triangles), ids, W, uvs: att.uvs, hull: att.hull, edges: att.edges, width: att.width, height: att.height };
  });
  const dups = Object.values(artist).filter((r) => r.duplicate).map((r) => `${r.slot}(${r.image})`);
  console.log(`artist: ${Object.keys(artist).length} weighted meshes${dups.length ? `, extra slots sharing an image (kept as the artist made them in the auto rigs): ${dups.join(' ')}` : ''}`);

  // ---- layer images and auto meshes (one per image)
  const auto = {};
  const timing = { mesh: 0, weightsA: 0, weightsB: 0, weightsB2: 0, weightsB3: 0, weightsC: 0, select: 0, assign: 0 };
  for (const slotName of Object.keys(artist)) {
    const ar = artist[slotName];
    if (ar.duplicate) continue;
    const file = path.join(IMG, ar.image + '.png');
    if (!fs.existsSync(file)) { console.log('  no image for', slotName, ar.image); continue; }
    const { data: rgba, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const t0 = Date.now();
    const mesh = AM.buildMesh(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), info.width, info.height, Object.assign({ density }, meshOpts));
    timing.mesh += Date.now() - t0;
    if (!mesh) { console.log('  no mesh for', slotName); continue; }
    // feature gate (edge strength) sampled at the artist's and the auto mesh's vertices
    if (extra.gateMin) {
      const field = AW.featureGate(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), info.width, info.height, extra.gateSigma || 3);
      ar.gate = new Float32Array(ar.n);
      for (let i = 0; i < ar.n; i++) ar.gate[i] = AW.sampleField(field, info.width, info.height, ar.uvs[2 * i] * info.width, ar.uvs[2 * i + 1] * info.height);
      const ng = mesh.vertices.length / 2; const g = new Float32Array(ng);
      for (let i = 0; i < ng; i++) g[i] = AW.sampleField(field, info.width, info.height, mesh.vertices[2 * i], mesh.vertices[2 * i + 1]);
      mesh.gate = g;
    }
    const p = place[ar.image] || place[ar.attName];
    if (!p) { console.log('  no PS placement for', slotName, ar.image); continue; }
    // Place the auto mesh where the ARTIST's artwork is: fit the affine uv -> world
    // map of the artist mesh at setup pose (least squares) instead of trusting the
    // PS placement. The rig declares leg_1 961 px wide over a 958 px image, so the
    // artist's artwork sits 1.5 px right of the PS placement and every edge of the
    // leg showed as a miss (IoU 0.954 at rest). This measures skinning, not placement.
    const n = mesh.vertices.length / 2;
    const world = new Float64Array(2 * n), uvs = new Array(2 * n);
    const fit = extra.psPlacement ? null : fitAffine(ar.uvs, ar.world);
    for (let i = 0; i < n; i++) {
      const px = mesh.vertices[2 * i], py = mesh.vertices[2 * i + 1];
      const u = px / info.width, v = py / info.height;
      if (fit) { world[2 * i] = fit.a * u + fit.b * v + fit.c; world[2 * i + 1] = fit.d * u + fit.e * v + fit.f; }
      else { world[2 * i] = (p.x || 0) + px - info.width / 2; world[2 * i + 1] = (p.y || 0) + info.height / 2 - py; }
      uvs[2 * i] = u; uvs[2 * i + 1] = v;
    }
    if (fit && fit.rms > 3) console.log(`  ${slotName}: artist uv->world map is not affine (rms ${fit.rms.toFixed(1)} px, moved vertices / FFD)`);
    auto[slotName] = { n, world, uvs, tris: Array.from(mesh.triangles), hull: mesh.hull, width: info.width, height: info.height, gate: mesh.gate };
  }

  // ---- exclusive assignment on the auto meshes (product path: no artist information)
  const geom = Object.keys(auto).map((slotName) => ({ name: slotName, vertices: auto[slotName].world, triangles: auto[slotName].tris, drawIndex: drawIndex.get(slotName) }));
  let t0 = Date.now();
  // B2 = the module defaults (chain vote, point controllers to the smallest layer,
  // their parent bone when the layer needs it); B3 = the same without the parent anchor
  const asg2 = AW.assignBones(geom, candSegs, parents, Object.assign({}, assignOpts));
  const asg3 = AW.assignBones(geom, candSegs, parents, Object.assign({ anchors: false }, assignOpts));
  timing.assign = Date.now() - t0;

  const report = { density, rig: RIG, layers: {} };
  const rigs = { A: stripDeform(rigJson), B: stripDeform(rigJson), B2: stripDeform(rigJson), B3: stripDeform(rigJson), C: stripDeform(rigJson) };
  const attsOf = (rig) => rig.skins[0].attachments;

  const gateOpts = (gate) => (extra.gateMin && gate ? { gate, gateMin: extra.gateMin } : {});
  function autoWeighted(au, sel, timingKey) {
    const t = Date.now();
    const r = AW.heatWeights(au.world, au.tris, sel.map((id) => segs[id]), Object.assign({}, weightOpts, gateOpts(au.gate)));
    timing[timingKey] += Date.now() - t;
    const keep = sel.map((id, j) => { let mx = 0; for (let i = 0; i < au.n; i++) mx = Math.max(mx, r.weights[i * sel.length + j]); return mx > 1e-4 ? j : -1; }).filter((j) => j >= 0);
    const ids = keep.map((j) => sel[j]);
    const W = new Float64Array(au.n * ids.length);
    for (let i = 0; i < au.n; i++) { let s = 0; keep.forEach((j, k) => { W[i * ids.length + k] = r.weights[i * sel.length + j]; s += W[i * ids.length + k]; }); if (s > 0) for (let k = 0; k < ids.length; k++) W[i * ids.length + k] /= s; }
    return { ids, W };
  }
  function meshAtt(au, ids, W) {
    return { type: 'mesh', uvs: au.uvs, triangles: au.tris, vertices: AW.weightedVertices(au.world, W, ids, mats), hull: au.hull, edges: AT.hullEdges(au.hull), width: au.width, height: au.height };
  }
  function selStats(ids, ar) {
    const artistSet = new Set(ar.ids), selSet = new Set(ids);
    const hit = ids.filter((id) => artistSet.has(id)).length;
    return { bones: ids.length, precision: ids.length ? hit / ids.length : 0, recall: ar.ids.length ? hit / ar.ids.length : 0, extra: ids.filter((id) => !artistSet.has(id)).map((id) => boneNames[id]), missed: ar.ids.filter((id) => !selSet.has(id)).map((id) => boneNames[id]) };
  }

  for (const slotName of Object.keys(artist)) {
    const ar = artist[slotName], au = auto[slotName];
    const row = { n_artist: ar.n, bones_artist: ar.ids.length, attName: ar.attName, duplicate: ar.duplicate };
    // A and C use the artist's bone set, minus any name-hinted slide controllers
    const idsA = extra.skipNames ? ar.ids.filter((id) => !skipSet.has(id)) : ar.ids;
    t0 = Date.now();
    const rA = AW.heatWeights(ar.world, ar.tris, idsA.map((id) => segs[id]), Object.assign({}, weightOpts, gateOpts(ar.gate)));
    timing.weightsA += Date.now() - t0;
    row.itersA = rA.iterations;
    let l1 = 0;
    if (idsA.length === ar.ids.length) for (let i = 0; i < ar.n; i++) for (let j = 0; j < ar.ids.length; j++) l1 += Math.abs(rA.weights[i * ar.ids.length + j] - ar.W[i * ar.ids.length + j]);
    row.weightL1 = l1 / ar.n;
    attsOf(rigs.A)[ar.slot][ar.attName] = { type: 'mesh', uvs: ar.uvs, triangles: ar.tris, vertices: AW.weightedVertices(ar.world, rA.weights, idsA, mats), hull: ar.hull, edges: ar.edges, width: ar.width, height: ar.height };
    if (au) {
      row.n_auto = au.n;
      t0 = Date.now();
      const sel = AW.selectBones(au.world, au.tris, candSegs, selectOpts);
      timing.select += Date.now() - t0;
      const b = autoWeighted(au, sel, 'weightsB');
      row.B = selStats(b.ids, ar);
      attsOf(rigs.B)[ar.slot][ar.attName] = meshAtt(au, b.ids, b.W);
      const sel2 = asg2.layers.get(slotName) || [];
      const sel3 = asg3.layers.get(slotName) || [];
      const b2 = autoWeighted(au, sel2.length ? sel2 : sel.slice(0, 2), 'weightsB2');
      const b3 = autoWeighted(au, sel3.length ? sel3 : sel.slice(0, 2), 'weightsB3');
      row.B2 = selStats(b2.ids, ar); row.B3 = selStats(b3.ids, ar);
      row.B2.fallback = !sel2.length; row.B3.fallback = !sel3.length;
      attsOf(rigs.B2)[ar.slot][ar.attName] = meshAtt(au, b2.ids, b2.W);
      attsOf(rigs.B3)[ar.slot][ar.attName] = meshAtt(au, b3.ids, b3.W);
      const c = autoWeighted(au, idsA, 'weightsC');
      attsOf(rigs.C)[ar.slot][ar.attName] = meshAtt(au, c.ids, c.W);
    }
    report.layers[slotName] = row;
    const f = (s) => s ? `${String(s.bones).padStart(2)} P${s.precision.toFixed(2)} R${s.recall.toFixed(2)}` : '-';
    console.log(`  ${slotName.padEnd(10)} n=${String(ar.n).padStart(3)}/${String(au ? au.n : 0).padStart(3)} artist=${String(ar.ids.length).padStart(2)} | B ${f(row.B)} | B2 ${f(row.B2)}${row.B2 && row.B2.fallback ? '!' : ' '} miss=[${row.B2 ? row.B2.missed.join(',') : ''}] extra=[${row.B2 ? row.B2.extra.join(',') : ''}] | B3 ${f(row.B3)}${ar.duplicate ? ' (artist mesh kept)' : ''}`);
  }
  report.timing = timing;
  for (const k of Object.keys(rigs)) fs.writeFileSync(path.join(OUT, 'rig' + k + '.json'), JSON.stringify(rigs[k]));
  fs.writeFileSync(path.join(OUT, 'artist_nodeform.json'), JSON.stringify(stripDeform(rigJson)));
  fs.writeFileSync(path.join(OUT, 'artist.json'), JSON.stringify(rigJson));
  fs.writeFileSync(path.join(OUT, 'build.json'), JSON.stringify(report, null, 1));
  const rowsWith = Object.values(report.layers).filter((r) => r.B);
  const mean = (get) => rowsWith.reduce((a, r) => a + get(r), 0) / Math.max(1, rowsWith.length);
  const micro = (key) => { let hit = 0, sel = 0, art = 0; for (const r of rowsWith) { hit += r[key].precision * r[key].bones; sel += r[key].bones; art += r.bones_artist; } return `P ${(hit / sel).toFixed(3)} R ${(hit / art).toFixed(3)} (${sel} picks / ${art} truth)`; };
  console.log(`mean weight L1 (A) ${mean((r) => r.weightL1).toFixed(3)}`);
  console.log(`selection  B: ${micro('B')}   B2: ${micro('B2')}   B3: ${micro('B3')}`);
  console.log('timing', JSON.stringify(timing));
})().catch((e) => { console.error(e); process.exit(1); });
