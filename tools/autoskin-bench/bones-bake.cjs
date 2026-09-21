// Functional test of an automatic skeleton: can it carry the artist's animation?
//   node bones-bake.cjs [--tag jiaye] [--rig <artist.json>] [--ps <export.json>] [--img <dir>] [--density 22] [--fps 30] [--opts '{...}']
// 1. builds the auto skeleton from the PS export (spine-auto-bones),
// 2. auto-meshes every layer the artist meshed, assigns bones and solves weights against
//    the AUTO bones (the product path: nothing from the artist's rig is used),
// 3. bakes the artist's animation onto the auto bones: each auto bone's origin and tip are
//    carried by the artist's skinning (barycentric weights inside the artist mesh, nearest
//    vertex outside), and the bone's local rotate/translate/scale is keyed every frame,
// 4. writes out/rigD.json for metrics.cjs / video.cjs (D = auto bones + auto mesh + auto weights).
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
require(REPO + '/particle-editor/spine-auto-mesh-core.js');
require(REPO + '/particle-editor/spine-auto-mesh.js');
require(REPO + '/particle-editor/spine-auto-mesh-attach.js');
require(REPO + '/particle-editor/spine-auto-weights.js');
require(REPO + '/particle-editor/spine-auto-bones.js');
require(REPO + '/particle-editor/spine-bones.editor.js');
const AM = globalThis.NovaFlowAutoMesh, AW = globalThis.NovaFlowAutoWeights, AT = globalThis.NovaFlowAutoMeshAttach, AB = globalThis.NovaFlowAutoBones;
const BE = globalThis.NovaFlowBonesEditor;

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; }
const TAG = arg('tag', 'jiaye');
const RIG = arg('rig', 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json');
const PS = arg('ps', 'C:/Users/jiang/OneDrive/Desktop/test/新建文件夹/伽夜立绘.json');
const IMG = arg('img', 'C:/Users/jiang/OneDrive/Desktop/test/新建文件夹/images/e');
const DENSITY = Number(arg('density', 22));
const FPS = Number(arg('fps', 30));
const OPTS = arg('opts') ? JSON.parse(arg('opts')) : {};
const OUTNAME = arg('name', 'rigD');
const OUT = path.join(__dirname, 'out'); const OUTT = path.join(OUT, TAG); fs.mkdirSync(OUTT, { recursive: true });

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
  return { a, b, c, d, e, f };
}
function boneMats(skeleton) { return skeleton.bones.map((b) => ({ name: b.data.name, a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY, length: b.data.length })); }
function bary(px, py, ax, ay, bx, by, cx, cy) {
  const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(det) < 1e-12) return null;
  const l1 = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) / det;
  const l2 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / det;
  return [1 - l1 - l2, l1, l2];
}

(async () => {
  const rigJson = JSON.parse(fs.readFileSync(RIG, 'utf8'));
  const psJson = JSON.parse(fs.readFileSync(PS, 'utf8'));
  // ---- layers + auto skeleton
  const skin = Array.isArray(psJson.skins) ? psJson.skins[0].attachments : psJson.skins.default;
  const layers = [];
  for (const slot of psJson.slots) {
    const atts = skin[slot.name]; if (!atts) continue;
    const an = slot.attachment || Object.keys(atts)[0]; const att = atts[an]; if (!att || (att.type && att.type !== 'region')) continue;
    const file = path.join(IMG, (att.path || an) + '.png'); if (!fs.existsSync(file)) continue;
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    layers.push({ name: slot.name, att: an, width: info.width, height: info.height, rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), place: { x: att.x || 0, y: att.y || 0 }, drawIndex: layers.length });
  }
  let t0 = Date.now();
  const built = AB.buildSkeleton(layers, OPTS);
  const tBones = Date.now() - t0;
  const autoJson = AB.applyToSkeleton(psJson, built);
  delete autoJson.ik;   // FK bake: the IK / transform constraints would fight the keyed rotations
  delete autoJson.transform;
  // The INHERIT MODE is kept (the keys below are derived mode-aware): a ribbon bone with
  // 'noRotationOrReflection' stores its WORLD angle, so stripping the mode while keeping
  // that angle left every sash rotated by minus its parent's angle (left_hand IoU 0.002).
  // Only the constraints are dropped — they would fight the keyed rotations, the mode does not.
  autoJson.skeleton = Object.assign({}, autoJson.skeleton, { spine: '3.8.99' });
  const { data: autoData, skeleton: autoSkel } = H.loadSkeleton(autoJson);
  const autoMats = boneMats(autoSkel);
  const autoSegs = autoMats.map(AW.boneSegment);
  const autoNames = autoMats.map((m) => m.name);
  const autoIndex = new Map(autoNames.map((n, i) => [n, i]));
  const parents = Array.from(AW.logicalParents(autoJson));
  const skipSet = AW.mechanismBones(autoJson);
  const candSegs = autoSegs.map((s, i) => skipSet.has(i) ? Object.assign({}, s, { skip: true }) : s);
  console.log(`auto skeleton: ${autoNames.length} bones in ${tBones} ms; ${skipSet.size} never weighted [${Array.from(skipSet).map((i) => autoNames[i]).join(' ')}]`);

  // ---- artist meshes (setup pose) with weights, per slot
  const { data: artData, skeleton: artSkel } = H.loadSkeleton(rigJson);
  const artMats0 = boneMats(artSkel);
  const artInv0 = artMats0.map(AW.invertBone);
  const skinAtts = rigJson.skins[0].attachments;
  const artist = {}; const imageOwner = new Map(); const drawIndex = new Map();
  artSkel.slots.forEach((slot, i) => {
    const a = slot.getAttachment();
    if (!(a instanceof spine.MeshAttachment)) return;
    const slotName = slot.data.name, attName = a.name, image = a.path || a.name;
    const att = skinAtts[slotName][attName];
    const n = a.worldVerticesLength / 2;
    const world = new Float32Array(2 * n);
    a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
    const inf = att.vertices.length === 2 * n ? null : AW.decodeWeighted(att.vertices, n);
    const duplicate = imageOwner.has(image);
    if (!duplicate) imageOwner.set(image, slotName);
    drawIndex.set(slotName, i);
    artist[slotName] = { slot: slotName, attName, image, duplicate, n, world: Array.from(world), tris: Array.from(a.triangles), inf, uvs: att.uvs, slotBone: slot.data.boneData.index, attachment: a, slotObj: slot };
  });
  console.log(`artist: ${Object.keys(artist).length} meshes`);

  // ---- auto meshes on the artist's slots, bones assigned + weighted against the AUTO skeleton
  const auto = {}; const timing = { mesh: 0, weights: 0 };
  for (const slotName of Object.keys(artist)) {
    const ar = artist[slotName]; if (ar.duplicate) continue;
    const L = layers.find((l) => l.name === slotName || l.att === ar.image);
    if (!L) { console.log('  no PS layer for', slotName); continue; }
    t0 = Date.now();
    const mesh = AM.buildMesh(L.rgba, L.width, L.height, { density: DENSITY });
    timing.mesh += Date.now() - t0;
    if (!mesh) continue;
    const n = mesh.vertices.length / 2;
    const fit = fitAffine(ar.uvs, ar.world);
    const world = new Float64Array(2 * n), uvs = new Array(2 * n);
    for (let i = 0; i < n; i++) {
      const u = mesh.vertices[2 * i] / L.width, v = mesh.vertices[2 * i + 1] / L.height;
      world[2 * i] = fit.a * u + fit.b * v + fit.c; world[2 * i + 1] = fit.d * u + fit.e * v + fit.f;
      uvs[2 * i] = u; uvs[2 * i + 1] = v;
    }
    auto[slotName] = { n, world, uvs, tris: Array.from(mesh.triangles), hull: mesh.hull, width: L.width, height: L.height };
  }
  // Bone sets per layer: the generator knows which layer every bone came from, so a layer
  // takes its own bones plus the bone each of its chains hangs from (the head for hair,
  // the pelvis for a skirt strip), which lets the weights blend into the parent's motion.
  // --assign geometric switches to the artist-rig assignment rule instead.
  const asg = { layers: new Map() };
  if (arg('assign') === 'geometric') {
    const geom = Object.keys(auto).map((s) => ({ name: s, vertices: auto[s].world, triangles: auto[s].tris, drawIndex: drawIndex.get(s) }));
    Object.assign(asg, AW.assignBones(geom, candSegs, parents, {}));
  } else {
    for (const slotName of Object.keys(auto)) {
      const mine = new Set();
      built.bones.forEach((b, i) => { if (b.layer === slotName && b.kind === 'bone' && !skipSet.has(i)) mine.add(i); });
      const withAnchors = new Set(mine);
      for (const i of mine) { const p = parents[i]; if (p > 0 && !mine.has(p) && !skipSet.has(p) && built.bones[p].kind === 'bone') withAnchors.add(p); }
      // the trunk layer also anchors to nothing; a layer with no bones of its own uses its slot bone
      if (!withAnchors.size) { const sb = autoIndex.get(built.slotBone[slotName]); if (sb !== undefined && !skipSet.has(sb)) withAnchors.add(sb); }
      asg.layers.set(slotName, Array.from(withAnchors));
    }
  }
  // The studio's turn sliders carry a faint UNIFORM weight over whole layers (measured on
  // the reference: face 0.15, front hair 0.13, head ornaments 0.2 on the back handle,
  // body 0.05, legs 0.025). Added after the heat solve as a blend.
  const sliderIndex = (n) => autoIndex.get(n);
  function sliderBlend(slotName) {
    const L = layers.find((l) => l.name === slotName); const part = L ? AB.nameHint(L.name).part : null;
    const headL = layers.find((l) => AB.nameHint(l.name).part === 'face' || AB.nameHint(l.name).part === 'head');
    const out = [];
    const has = (n) => sliderIndex(n) !== undefined;
    // measured on the reference: faec 0.15 / hair_front 0.13 on face_turn; fashj1 0.24 on
    // face_turn_back (back hair gets nothing); body 0.045 / xianlian 0.06 / zhuangshi 0.05
    // on body_up_turn; legs 0.03 / 0.015 on body_down_turn; cloth nothing
    if ((part === 'face' || part === 'head' || part === 'eye' || part === 'mouth' || part === 'nose') && has('face_turn')) out.push(['face_turn', 0.15]);
    else if (part === 'hair' && headL && L.drawIndex > headL.drawIndex && has('face_turn')) out.push(['face_turn', 0.13]);
    else if (part === 'accessory' && headL && Math.abs((L.place.y) - headL.place.y) < 0.6 * headL.height && has('face_turn_back')) out.push(['face_turn_back', 0.2]);
    else if ((part === 'body' || part === 'breast') && has('body_up_turn')) out.push(['body_up_turn', 0.05]);
    else if ((part === 'leg' || part === 'foot') && has('body_down_turn')) out.push(['body_down_turn', 0.025]);
    else if (part === 'accessory' && has('body_up_turn')) out.push(['body_up_turn', 0.05]);
    return out;
  }
  const rigD = JSON.parse(JSON.stringify(autoJson));
  const attsD = Array.isArray(rigD.skins) ? rigD.skins[0].attachments : rigD.skins.default;
  const perLayer = {};
  for (const slotName of Object.keys(auto)) {
    const au = auto[slotName], ar = artist[slotName];
    const sel = asg.layers.get(slotName) || [];
    if (!sel.length) { console.log('  no bones assigned to', slotName); continue; }
    t0 = Date.now();
    const r = AW.heatWeights(au.world, au.tris, sel.map((id) => autoSegs[id]), {});
    timing.weights += Date.now() - t0;
    const keep = sel.map((id, j) => { let mx = 0; for (let i = 0; i < au.n; i++) mx = Math.max(mx, r.weights[i * sel.length + j]); return mx > 1e-4 ? j : -1; }).filter((j) => j >= 0);
    let ids = keep.map((j) => sel[j]);
    let W = new Float64Array(au.n * ids.length);
    for (let i = 0; i < au.n; i++) { let s = 0; keep.forEach((j, k) => { W[i * ids.length + k] = r.weights[i * sel.length + j]; s += W[i * ids.length + k]; }); if (s > 0) for (let k = 0; k < ids.length; k++) W[i * ids.length + k] /= s; }
    const blend = OPTS.rigStyle === 'simple' || OPTS.sliders === false ? [] : sliderBlend(slotName);
    if (blend.length) {
      const total = blend.reduce((a, b) => a + b[1], 0);
      const ids2 = ids.concat(blend.map((b) => sliderIndex(b[0])));
      const W2 = new Float64Array(au.n * ids2.length);
      for (let i = 0; i < au.n; i++) { for (let k = 0; k < ids.length; k++) W2[i * ids2.length + k] = W[i * ids.length + k] * (1 - total); blend.forEach((b, q) => { W2[i * ids2.length + ids.length + q] = b[1]; }); }
      ids = ids2; W = W2;
    }
    // the auto skeleton binds the slot to a layer bone; the mesh attachment sits under that slot
    const slotEntry = rigD.slots.find((s) => s.name === slotName);
    const attName = slotEntry ? slotEntry.attachment : ar.attName;
    if (!attsD[slotName]) attsD[slotName] = {};
    // drop whatever region was there and write the weighted mesh under the artist's attachment name
    for (const k of Object.keys(attsD[slotName])) delete attsD[slotName][k];
    attsD[slotName][attName || ar.attName] = { type: 'mesh', path: ar.image, uvs: au.uvs, triangles: au.tris, vertices: AW.weightedVertices(au.world, W, ids, autoMats), hull: au.hull, edges: AT.hullEdges(au.hull), width: au.width, height: au.height };
    if (slotEntry) slotEntry.attachment = attName || ar.attName;
    perLayer[slotName] = { n: au.n, bones: ids.map((id) => autoNames[id]) };
    console.log(`  ${slotName.padEnd(11)} verts ${String(au.n).padStart(3)}  bones ${ids.length}: ${ids.map((id) => autoNames[id]).join(' ')}`);
  }
  // slots whose layer the artist did not mesh keep their region attachment but are never
  // drawn by the bench renderer (nor is the artist's), so the comparison stays like for like
  // ---- bake the artist's animation onto the auto bones
  const animName = artData.animations[0].name;
  const duration = artData.animations[0].duration;
  const frames = Math.round(duration * FPS) + 1;
  // carrier for a world point: barycentric in the artist mesh of `slot` (or nearest vertex)
  function carrier(slot, x, y) {
    const ar = artist[slot] || artist[imageOwner.get(slot)];
    const pick = (a) => {
      const V = a.world;
      for (let t = 0; t < a.tris.length; t += 3) {
        const i0 = a.tris[t], i1 = a.tris[t + 1], i2 = a.tris[t + 2];
        const l = bary(x, y, V[2 * i0], V[2 * i0 + 1], V[2 * i1], V[2 * i1 + 1], V[2 * i2], V[2 * i2 + 1]);
        if (l && l[0] >= -1e-6 && l[1] >= -1e-6 && l[2] >= -1e-6) return { a, idx: [i0, i1, i2], l, dist: 0 };
      }
      let bi = 0, bd = Infinity;
      for (let i = 0; i < a.n; i++) { const d = Math.hypot(V[2 * i] - x, V[2 * i + 1] - y); if (d < bd) { bd = d; bi = i; } }
      return { a, idx: [bi], l: [1], dist: bd };
    };
    if (ar) { const c = pick(ar); if (c.dist < 1e-6 || c.dist < 60) return c; }
    // outside its own layer's mesh: the nearest vertex of any artist mesh
    let best = null;
    for (const a of Object.values(artist)) { const c = pick(a); if (!best || c.dist < best.dist) best = c; }
    return best;
  }
  // blended bone weights of a carrier
  function carrierWeights(c) {
    const w = new Map();
    if (!c.a.inf) { w.set(c.a.slotBone, 1); return w; }
    c.idx.forEach((vi, k) => { for (const e of c.a.inf[vi]) w.set(e.bone, (w.get(e.bone) || 0) + c.l[k] * e.w); });
    return w;
  }
  const artIndex = new Map(artMats0.map((m, i) => [m.name, i]));
  const carriers = autoMats.map((m, i) => {
    const b = built.bones[i];
    if (b.kind === 'root') return null;
    // the studio's turn sliders: same name in the artist rig → carried by that bone alone
    if (b.kind === 'slider' && artIndex.has(b.name)) { const w = new Map([[artIndex.get(b.name), 1]]); return { w0: w, w1: null, p0: [b.ax, b.ay], p1: null }; }
    const slot = b.layer;
    const c0 = carrier(slot, b.ax, b.ay), c1 = b.len > 0 ? carrier(slot, b.bx, b.by) : null;
    return { w0: carrierWeights(c0), w1: c1 ? carrierWeights(c1) : null, p0: [b.ax, b.ay], p1: [b.bx, b.by] };
  });
  const lbs = (w, p, mats) => {
    let x = 0, y = 0;
    for (const [j, wj] of w) {
      const inv = artInv0[j], m = mats[j];
      const lx = inv.ia * (p[0] - inv.wx) + inv.ib * (p[1] - inv.wy), ly = inv.ic * (p[0] - inv.wx) + inv.id * (p[1] - inv.wy);
      x += wj * (m.a * lx + m.b * ly + m.worldX); y += wj * (m.c * lx + m.d * ly + m.worldY);
    }
    return [x, y];
  };
  const setupLocal = autoSkel.bones.map((b) => ({ x: b.data.x, y: b.data.y, rot: b.data.rotation }));
  // A bone's INHERIT MODE decides how the runtime builds its world matrix, so the keys must
  // be derived the same way: a 'noRotationOrReflection' / 'onlyTranslation' bone (the auto
  // rig's ribbons, the artist's bone37/45/53) keeps its own WORLD angle, so its local
  // rotation is that angle, not the angle relative to its parent. Deriving them the plain
  // way put every sash where the runtime does not draw it (left_hand IoU 0.002).
  const inheritOf = autoSkel.bones.map((b) => {
    const d = b.data;
    const t = d.transformMode;
    if (typeof t === 'string') return t;
    // the 3.8 runtime stores an enum; map it back by name
    const names = ['normal', 'onlyTranslation', 'noRotation', 'noScale', 'noScaleOrReflection'];
    const E = spine.TransformMode || {};
    for (const k of Object.keys(E)) if (E[k] === t && typeof k === 'string') return k[0].toLowerCase() + k.slice(1);
    return names[t] || 'normal';
  });
  const absoluteRot = inheritOf.map((m) => m === 'noRotationOrReflection' || m === 'noRotation' || m === 'onlyTranslation');
  const keys = autoNames.map(() => ({ rotate: [], translate: [], scale: [] }));
  const nb = autoNames.length;
  for (let f = 0; f < frames; f++) {
    const t = Math.min(duration, f / FPS);
    H.poseAt(artData, artSkel, animName, t);
    const mats = boneMats(artSkel);
    // world transforms wanted for every auto bone
    const want = new Array(nb);
    for (let i = 0; i < nb; i++) {
      const c = carriers[i];
      if (!c) { want[i] = { x: 0, y: 0, rot: 0, sx: 1 }; continue; }
      const q0 = lbs(c.w0, c.p0, mats);
      if (c.w1) {
        const q1 = lbs(c.w1, c.p1, mats);
        const len = Math.hypot(c.p1[0] - c.p0[0], c.p1[1] - c.p0[1]);
        want[i] = { x: q0[0], y: q0[1], rot: Math.atan2(q1[1] - q0[1], q1[0] - q0[0]), sx: Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) / Math.max(1e-6, len) };
      } else want[i] = { x: q0[0], y: q0[1], rot: null, sx: 1 };
    }
    // Local values in tree order (bones are listed parents first). The runtime composes
    // world = parentWorld × [cos r·sx, -sin r; sin r·sx, cos r] (+ translation), so the local
    // rotation/scale are read off P⁻¹ · (wanted x axis), and the world matrix propagated
    // here is the one the runtime will actually build, second column included.
    const world = new Array(nb);
    for (let i = 0; i < nb; i++) {
      const p = autoSkel.bones[i].parent ? autoSkel.bones[i].parent.data.index : -1;
      const wnt = want[i];
      const pw = p >= 0 ? world[p] : { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 };
      const det = pw.a * pw.d - pw.b * pw.c;
      const ia = pw.d / det, ib = -pw.b / det, ic = -pw.c / det, id = pw.a / det;
      const dx = wnt.x - pw.x, dy = wnt.y - pw.y;
      const lx = ia * dx + ib * dy, ly = ic * dx + id * dy;
      let lr, lsx;
      if (wnt.rot === null) { lr = setupLocal[i].rot * Math.PI / 180; lsx = 1; }   // a point bone follows its parent
      else if (absoluteRot[i]) {
        // the world angle IS the local rotation; the length factor divides out the parent's
        // scale for noRotation* (which keeps it) and not for onlyTranslation (which drops it)
        lr = wnt.rot;
        const ps = inheritOf[i] === 'onlyTranslation' ? 1 : Math.hypot(pw.a, pw.c);
        lsx = wnt.sx / Math.max(1e-9, ps);
      } else {
        const vx = Math.cos(wnt.rot) * wnt.sx, vy = Math.sin(wnt.rot) * wnt.sx;
        const l1x = ia * vx + ib * vy, l1y = ic * vx + id * vy;
        lr = Math.atan2(l1y, l1x); lsx = Math.hypot(l1x, l1y);
      }
      // propagate the world matrix the way the runtime will build it (mode included)
      const wm = BE.worldMatrix(p >= 0 ? { a: pw.a, b: pw.b, c: pw.c, d: pw.d, worldX: pw.x, worldY: pw.y } : null,
        { x: lx, y: ly, rotation: lr * 180 / Math.PI, scaleX: lsx, scaleY: 1, shearX: 0, shearY: 0, mode: inheritOf[i] });
      world[i] = { a: wm.a, b: wm.b, c: wm.c, d: wm.d, x: wnt.x, y: wnt.y };
      let lrot = lr * 180 / Math.PI - setupLocal[i].rot;
      while (lrot > 180) lrot -= 360; while (lrot < -180) lrot += 360;
      keys[i].rotate.push({ time: +t.toFixed(4), angle: +lrot.toFixed(3) });
      keys[i].translate.push({ time: +t.toFixed(4), x: +(lx - setupLocal[i].x).toFixed(3), y: +(ly - setupLocal[i].y).toFixed(3) });
      keys[i].scale.push({ time: +t.toFixed(4), x: +lsx.toFixed(4), y: 1 });
    }
  }
  const bonesAnim = {};
  autoNames.forEach((n, i) => { if (i === 0) return; bonesAnim[n] = keys[i]; });
  rigD.animations = { [animName]: { bones: bonesAnim } };
  // Spine 3.8 reads skins as an array [{name, attachments}]; the PS export uses the older object form
  if (rigD.skins && !Array.isArray(rigD.skins)) rigD.skins = Object.keys(rigD.skins).map((n) => ({ name: n, attachments: rigD.skins[n] }));
  fs.writeFileSync(path.join(OUT, OUTNAME + '.json'), JSON.stringify(rigD));
  fs.writeFileSync(path.join(OUTT, 'bake.json'), JSON.stringify({ perLayer, timing, frames, fps: FPS }, null, 1));
  // sanity: the baked rig loads and the bones land where the carriers put them at t=0.5
  const { data: dD, skeleton: sD } = H.loadSkeleton(rigD);
  H.poseAt(dD, sD, animName, 0.5);
  H.poseAt(artData, artSkel, animName, 0.5);
  const mats5 = boneMats(artSkel);
  let err = 0, cnt = 0, worst = 0, worstName = '';
  for (let i = 1; i < nb; i++) { const c = carriers[i]; if (!c) continue; const q = lbs(c.w0, c.p0, mats5); const b = sD.bones[i]; const e = Math.hypot(b.worldX - q[0], b.worldY - q[1]); err += e; cnt++; if (e > worst) { worst = e; worstName = autoNames[i]; } }
  console.log(`baked ${frames} frames of '${animName}' (${duration}s) → out/${OUTNAME}.json; bone origin replay error at t=0.5: mean ${(err / cnt).toFixed(2)} px, worst ${worst.toFixed(2)} px (${worstName}); timing ${JSON.stringify(timing)}`);
})().catch((e) => { console.error(e); process.exit(1); });
