// Do the auto mesh's structure lines (ridge chains) of a layer land on the features the
// controllers drive? For each chain: length, endpoints, and the controllers whose
// position is within `rEnd` px of an endpoint or `rAny` px of any sample. Also draws
// the chains and controllers over the layer at 4x.
//   node curves-probe.cjs [layer=faec] [rEnd=8] [rAny=12]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
require(REPO + '/particle-editor/spine-auto-mesh-core.js'); require(REPO + '/particle-editor/spine-auto-mesh.js'); require(REPO + '/particle-editor/spine-auto-weights.js');
const AM = globalThis.NovaFlowAutoMesh, AW = globalThis.NovaFlowAutoWeights;
const IMG = (process.env.NOVA_AUTOSKIN_IMG || 'D:/foyo_new/立绘/女角色 (2)/伽夜立绘/新建文件夹/images/e');
const OUT = path.join(__dirname, 'out');
const layer = process.argv[2] || 'faec'; const rEnd = Number(process.argv[3] || 8); const rAny = Number(process.argv[4] || 12);
(async () => {
  const rigJson = JSON.parse(fs.readFileSync(path.join(OUT, 'artist.json'), 'utf8'));
  const { skeleton } = H.loadSkeleton(rigJson);
  const slot = skeleton.slots.find((s) => s.data.name === layer); const a = slot.getAttachment(); const n = a.worldVerticesLength / 2;
  const att = rigJson.skins[0].attachments[layer][a.name];
  const { data: rgba, info } = await sharp(path.join(IMG, (a.path || a.name) + '.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mesh = AM.buildMesh(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), info.width, info.height, { density: 22 });
  // world -> image px map from the artist mesh (affine fit), to place the controllers in image space
  const world = new Float32Array(2 * n); a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
  // least squares: px = A*wx + B*wy + C
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rx = [0, 0, 0], ry = [0, 0, 0];
  for (let i = 0; i < n; i++) { const r = [world[2 * i], world[2 * i + 1], 1]; for (let p = 0; p < 3; p++) { for (let q = 0; q < 3; q++) M[p][q] += r[p] * r[q]; rx[p] += r[p] * att.uvs[2 * i] * info.width; ry[p] += r[p] * att.uvs[2 * i + 1] * info.height; } }
  const solve = (A, b) => { const m = A.map((row, i) => [...row, b[i]]); for (let c = 0; c < 3; c++) { let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r; [m[c], m[p]] = [m[p], m[c]]; for (let r = 0; r < 3; r++) { if (r === c) continue; const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; } } return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]]; };
  const [A1, B1, C1] = solve(M, rx), [A2, B2, C2] = solve(M, ry);
  const toPx = (wx, wy) => [A1 * wx + B1 * wy + C1, A2 * wx + B2 * wy + C2];
  const inf = AW.decodeWeighted(att.vertices, n);
  const ctrls = skeleton.bones.filter((b) => !(b.data.length > 0) && inf.some((v) => v.some((e) => e.bone === b.data.index))).map((b) => ({ name: b.data.name, p: toPx(b.worldX, b.worldY) }));
  console.log(`${layer}: image ${info.width}x${info.height}, auto mesh ${mesh.vertices.length / 2} verts, edge ${mesh.edge.toFixed(1)}px, ${(mesh.curves || []).length} chains; controllers: ${ctrls.map((c) => `${c.name}(${c.p[0].toFixed(0)},${c.p[1].toFixed(0)})`).join(' ')}`);
  const curves = mesh.curves || [];
  curves.forEach((c, k) => {
    const pts = []; for (let i = 0; i < c.length; i += 2) pts.push([c[i], c[i + 1]]);
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const e0 = pts[0], e1 = pts[pts.length - 1];
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const endsNear = ctrls.filter((ct) => Math.min(Math.hypot(e0[0] - ct.p[0], e0[1] - ct.p[1]), Math.hypot(e1[0] - ct.p[0], e1[1] - ct.p[1])) <= rEnd).map((ct) => ct.name);
    const anyNear = ctrls.filter((ct) => pts.some((p) => Math.hypot(p[0] - ct.p[0], p[1] - ct.p[1]) <= rAny)).map((ct) => ct.name);
    const nearestCtrlToCentroid = ctrls.map((ct) => ({ name: ct.name, d: Math.hypot(cx - ct.p[0], cy - ct.p[1]) })).sort((x, y) => x.d - y.d)[0];
    console.log(`  chain ${String(k).padStart(2)} len ${len.toFixed(0).padStart(4)}px ${pts.length} pts ends (${e0[0].toFixed(0)},${e0[1].toFixed(0)})-(${e1[0].toFixed(0)},${e1[1].toFixed(0)}) centroid (${cx.toFixed(0)},${cy.toFixed(0)}) nearest-centroid ${nearestCtrlToCentroid.name} ${nearestCtrlToCentroid.d.toFixed(0)}px | end<=${rEnd}: [${endsNear.join(' ')}] any<=${rAny}: [${anyNear.join(' ')}]`);
  });
  // picture
  const sc = 4; const W = info.width * sc, Hh = info.height * sc;
  const img = new Uint8ClampedArray(W * Hh * 4);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = 4 * ((y >> 2) * info.width + (x >> 2)), o = 4 * (y * W + x); const al = rgba[i + 3] / 255; img[o] = rgba[i] * al * 0.6 + 30; img[o + 1] = rgba[i + 1] * al * 0.6 + 30; img[o + 2] = rgba[i + 2] * al * 0.6 + 34; img[o + 3] = 255; }
  const line = (x0, y0, x1, y1, r, g, b) => { const nn = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * sc)); for (let s = 0; s <= nn; s++) { const x = Math.round((x0 + (x1 - x0) * s / nn) * sc), y = Math.round((y0 + (y1 - y0) * s / nn) * sc); if (x < 0 || y < 0 || x >= W || y >= Hh) continue; const o = 4 * (y * W + x); img[o] = r; img[o + 1] = g; img[o + 2] = b; } };
  const V = mesh.vertices, T = mesh.triangles;
  for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const i = T[t + e], j = T[t + (e + 1) % 3]; line(V[2 * i], V[2 * i + 1], V[2 * j], V[2 * j + 1], 70, 110, 90); }
  curves.forEach((c) => { for (let i = 0; i + 3 < c.length; i += 2) line(c[i], c[i + 1], c[i + 2], c[i + 3], 255, 210, 60); });
  for (const ct of ctrls) { for (let d = -6; d <= 6; d++) { line(ct.p[0] + d / sc, ct.p[1], ct.p[0] + d / sc, ct.p[1], 255, 60, 60); line(ct.p[0], ct.p[1] + d / sc, ct.p[0], ct.p[1] + d / sc, 255, 60, 60); } }
  await sharp(Buffer.from(img.buffer), { raw: { width: W, height: Hh, channels: 4 } }).png().toFile(path.join(OUT, `fig_curves_${layer}.png`));
  console.log('wrote', `fig_curves_${layer}.png`);
})().catch((e) => { console.error(e); process.exit(1); });
