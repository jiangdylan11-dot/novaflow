// The face: (1) a 3x zoom strip artist | rigA | rigB2 over the animation,
// (2) how the artist spreads the face weight over the head bone and the point
// controllers (per bone: vertices touched, mean/max weight, reach), (3) how much
// each of those bones actually moves in the animation.
//   node face-probe.cjs [layer=faec] [rigs=artist,rigA,rigB2] [times=0,0.5,1,1.5]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const R = require('./render.cjs');
const H = require('./spine-headless.cjs'); const spine = H.spine;
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const OUT = path.join(__dirname, 'out');
const layer = process.argv[2] || 'faec';
const rigNames = (process.argv[3] || 'artist,rigA,rigB2').split(',');
const times = (process.argv[4] || '0,0.5,1,1.5').split(',').map(Number);
const LABEL = { artist: '原版', rigA: 'A 只重算权重', rigB2: 'B2 全自动', rigC: 'C' };
(async () => {
  const images = await R.loadImages();
  const rigs = {}; for (const n of rigNames) rigs[n] = R.loadRig(path.join(OUT, n + '.json'));
  const artistJson = JSON.parse(fs.readFileSync(path.join(OUT, 'artist.json'), 'utf8'));
  const { data, skeleton } = rigs.artist;
  skeleton.setToSetupPose(); skeleton.updateWorldTransform();
  const slot = skeleton.slots.find((s) => s.getAttachment() && s.getAttachment().name === layer);
  const att = slot.getAttachment(); const n = att.worldVerticesLength / 2;
  const world = new Float32Array(2 * n); att.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (let i = 0; i < n; i++) { const cx = world[2 * i] - R.X0, cy = R.Y1 - world[2 * i + 1]; minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy); }
  const m = 40; const crop = [Math.floor(minX - m), Math.floor(minY - m), Math.ceil(maxX - minX + 2 * m), Math.ceil(maxY - minY + 2 * m)];
  const sc = 3;
  // (1) zoom strip
  const rowsImg = [];
  for (const t of times) {
    const row = [];
    for (const nme of rigNames) {
      const fr = R.renderFrame(rigs[nme], images, t);
      const rgba = R.toRGBA8(fr.canvas, [40, 40, 44]);
      let s = sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: R.CW, height: R.CH, channels: 4 } }).extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] }).resize({ width: crop[2] * sc, kernel: 'lanczos3' });
      const buf = await s.png().toBuffer();
      const label = Buffer.from(`<svg width="${crop[2] * sc}" height="${crop[3] * sc}"><rect x="0" y="0" width="${crop[2] * sc}" height="34" fill="rgba(0,0,0,0.6)"/><text x="10" y="25" font-family="Microsoft YaHei, sans-serif" font-size="22" fill="#fff">${LABEL[nme] || nme}  t=${t}s</text></svg>`);
      row.push({ buf: await sharp(buf).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer(), w: crop[2] * sc, h: crop[3] * sc });
    }
    rowsImg.push(row);
  }
  const W = rowsImg[0].reduce((a, p) => a + p.w + 6, 0), Hh = rowsImg.reduce((a, r) => a + r[0].h + 6, 0);
  const comp = []; let y = 0;
  for (const row of rowsImg) { let x = 0; for (const p of row) { comp.push({ input: p.buf, left: x, top: y }); x += p.w + 6; } y += row[0].h + 6; }
  await sharp({ create: { width: W, height: Hh, channels: 4, background: { r: 24, g: 24, b: 28, alpha: 1 } } }).composite(comp).png().toFile(path.join(OUT, `fig_face_${layer}.png`));
  console.log(`wrote fig_face_${layer}.png crop ${crop.join(',')} x${sc}`);
  // (2) artist weight spread per bone on this layer
  const a = artistJson.skins[0].attachments[slot.data.name][layer];
  const inf = AW.decodeWeighted(a.vertices, n);
  const stats = new Map();
  for (let i = 0; i < n; i++) for (const e of inf[i]) { const s = stats.get(e.bone) || { cnt: 0, sum: 0, max: 0, full: 0, reach: 0 }; s.cnt++; s.sum += e.w; s.max = Math.max(s.max, e.w); if (e.w > 0.99) s.full++; const b = skeleton.bones[e.bone]; const d = AW.segPoint(world[2 * i], world[2 * i + 1], b.worldX, b.worldY, b.worldX + b.a * b.data.length, b.worldY + b.c * b.data.length); if (e.w >= 0.1) s.reach = Math.max(s.reach, d); stats.set(e.bone, s); }
  console.log(`\n${layer}: ${n} vertices, artist bones:`);
  for (const [b, s] of Array.from(stats.entries()).sort((x, y) => y[1].sum - x[1].sum)) {
    const bone = skeleton.bones[b];
    console.log(`  ${bone.data.name.padEnd(7)} len ${String(bone.data.length.toFixed(0)).padStart(4)} verts ${String(s.cnt).padStart(3)} total ${s.sum.toFixed(1).padStart(6)} mean ${(s.sum / s.cnt).toFixed(2)} max ${s.max.toFixed(2)} full(>0.99) ${s.full} reach(w>=0.1) ${s.reach.toFixed(0)}px`);
  }
  // (3) motion of those bones over the animation, relative to the head bone
  const names = Array.from(stats.keys()).map((b) => skeleton.bones[b].data.name);
  const rest = {}; skeleton.setToSetupPose(); skeleton.updateWorldTransform();
  for (const nm of names) { const b = skeleton.findBone(nm); rest[nm] = [b.worldX, b.worldY, b.getWorldRotationX()]; }
  const mv = {}; for (const nm of names) mv[nm] = { d: 0, rot: 0 };
  for (let t = 0; t <= 2.0001; t += 0.1) {
    H.poseAt(data, skeleton, 'animation', t);
    for (const nm of names) { const b = skeleton.findBone(nm); mv[nm].d = Math.max(mv[nm].d, Math.hypot(b.worldX - rest[nm][0], b.worldY - rest[nm][1])); mv[nm].rot = Math.max(mv[nm].rot, Math.abs(b.getWorldRotationX() - rest[nm][2])); }
  }
  console.log('motion over the animation (max world displacement / rotation):');
  for (const nm of names) console.log(`  ${nm.padEnd(7)} ${mv[nm].d.toFixed(1).padStart(6)}px  ${mv[nm].rot.toFixed(1).padStart(5)}°`);
  const anim = artistJson.animations.animation.bones || {};
  console.log('keyed in the animation:', names.filter((nm) => anim[nm]).map((nm) => nm + '[' + Object.keys(anim[nm]).join('/') + ']').join(' ') || '(none)');
})().catch((e) => { console.error(e); process.exit(1); });
