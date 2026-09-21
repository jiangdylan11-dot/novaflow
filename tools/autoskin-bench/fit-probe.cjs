// On the AUTO meshes of a few small layers: for the artist bones and the bones B2
// picked, the fraction of the bone inside the layer and its mean distance to the
// boundary, plus which layer the exclusive assignment sent each bone to.
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const root = REPO + '/particle-editor';
require(path.join(root, 'spine-auto-mesh-core.js')); require(path.join(root, 'spine-auto-mesh.js')); require(path.join(root, 'spine-auto-weights.js'));
const AM = globalThis.NovaFlowAutoMesh, AW = globalThis.NovaFlowAutoWeights;
const RIG = (process.env.NOVA_AUTOSKIN_RIG || 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json');
const PS = (process.env.NOVA_AUTOSKIN_PS || 'D:/foyo_new/立绘/女角色 (2)/伽夜立绘/新建文件夹/伽夜立绘.json');
const IMG = (process.env.NOVA_AUTOSKIN_IMG || 'D:/foyo_new/立绘/女角色 (2)/伽夜立绘/新建文件夹/images/e');
const WATCH = (process.argv[2] || 'daizi4,xianlian,hua1,daizi1_1').split(',');
(async () => {
  const rigJson = JSON.parse(fs.readFileSync(RIG, 'utf8')); const psJson = JSON.parse(fs.readFileSync(PS, 'utf8'));
  const { data, skeleton } = H.loadSkeleton(rigJson);
  const mats = skeleton.bones.map((b) => ({ name: b.data.name, a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY, length: b.data.length }));
  const segs = mats.map(AW.boneSegment); const skip = AW.mechanismBones(rigJson);
  const cand = segs.map((s, i) => skip.has(i) ? { ...s, skip: true } : s);
  const parents = skeleton.bones.map((b) => (b.parent ? b.parent.data.index : -1));
  const place = {}; for (const s of Object.keys(psJson.skins.default)) for (const an of Object.keys(psJson.skins.default[s])) place[an] = psJson.skins.default[s][an];
  const atts = rigJson.skins[0].attachments;
  const layers = []; const artistIds = {};
  let di = 0;
  for (const slot of skeleton.slots) {
    const a = slot.getAttachment(); if (!(a instanceof spine.MeshAttachment)) continue;
    const inf = AW.decodeWeighted(atts[slot.data.name][a.name].vertices, a.worldVerticesLength / 2);
    artistIds[a.name] = new Set(inf.flatMap((v) => v.map((e) => e.bone)));
    const { data: rgba, info } = await sharp(path.join(IMG, a.name + '.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const mesh = AM.buildMesh(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), info.width, info.height, { density: 22 });
    const p = place[a.name]; const n = mesh.vertices.length / 2; const world = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) { world[2 * i] = (p.x || 0) + mesh.vertices[2 * i] - info.width / 2; world[2 * i + 1] = (p.y || 0) + info.height / 2 - mesh.vertices[2 * i + 1]; }
    layers.push({ name: a.name, vertices: world, triangles: Array.from(mesh.triangles), drawIndex: di++ });
  }
  const asg = AW.assignBones(layers, cand, parents);
  const layerOf = (s) => asg.pick[s] >= 0 ? layers[asg.pick[s]].name : 'none';
  for (const name of WATCH) {
    const L = layers.find((x) => x.name === name); const be = AW.boundaryEdges(L.triangles);
    const ids = new Set([...artistIds[name], ...(asg.layers.get(name) || [])]);
    console.log(`\n== ${name}: artist [${Array.from(artistIds[name]).map((i) => mats[i].name).join(' ')}]  B2 [${(asg.layers.get(name) || []).map((i) => mats[i].name).join(' ')}]`);
    for (const s of ids) {
      const b = segs[s]; let inside = 0, edt = 0, dmin = Infinity;
      for (let k = 0; k < 9; k++) { const u = k / 8; const x = b.ax + u * (b.bx - b.ax), y = b.ay + u * (b.by - b.ay); if (AW.insideBoundary(L.vertices, be, x, y)) { inside++; edt += AW.distToBoundary(L.vertices, be, x, y); } }
      for (let i = 0; i < L.vertices.length; i += 2) dmin = Math.min(dmin, AW.segPoint(L.vertices[i], L.vertices[i + 1], b.ax, b.ay, b.bx, b.by));
      console.log(`  ${mats[s].name.padEnd(8)} len ${String(mats[s].length.toFixed(0)).padStart(4)} inside ${(inside / 9).toFixed(2)} edt ${(inside ? edt / inside : NaN).toFixed(1)} dmin ${dmin.toFixed(1)} ${skip.has(s) ? 'SKIP' : ''} -> assigned to ${layerOf(s)}  ${artistIds[name].has(s) ? '(artist)' : ''}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
