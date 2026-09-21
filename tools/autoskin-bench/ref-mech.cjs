// Measure the reference rig's mechanisms so the auto skeleton can reproduce them:
// limb pivots / joint targets / helper-chain length ratios, turn sliders and their
// per-layer weights, and the face controllers in face-image pixels.
//   node ref-mech.cjs [rig.json] [faceSlot]
const fs = require('fs');
const H = require('./spine-headless.cjs');
require('../../particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const RIG = process.argv[2] || 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json';
const FACE = process.argv[3] || 'faec';
const rig = JSON.parse(fs.readFileSync(RIG, 'utf8'));
const { skeleton } = H.loadSkeleton(rig);
const W = (n) => { const b = skeleton.findBone(n); return b ? [b.worldX, b.worldY, Math.atan2(b.c, b.a) * 180 / Math.PI, b.data.length] : null; };
const f0 = (v) => v.toFixed(0);
function fit(uvs, wd) {
  const n = uvs.length / 2; const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rx = [0, 0, 0], ry = [0, 0, 0];
  for (let i = 0; i < n; i++) { const r = [uvs[2 * i], uvs[2 * i + 1], 1]; for (let p = 0; p < 3; p++) { for (let q = 0; q < 3; q++) M[p][q] += r[p] * r[q]; rx[p] += r[p] * wd[2 * i]; ry[p] += r[p] * wd[2 * i + 1]; } }
  const solve = (A, b) => { const m = A.map((row, i) => [...row, b[i]]); for (let c = 0; c < 3; c++) { let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r; [m[c], m[p]] = [m[p], m[c]]; for (let r = 0; r < 3; r++) { if (r === c) continue; const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; } } return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]]; };
  const [A, B, C] = solve(M, rx), [D, E, F] = solve(M, ry); return { A, B, C, D, E, F };
}
if (RIG.includes('a.json')) {
  console.log('--- limb geometry (world): pivot, |pivot→T1| vs upper len, |T1→T2| vs lower len, helper lengths and ratios');
  for (const [piv, up, t1, low, t2, h1, h2] of [['kua1', 'leg_r', 'leg1', 'lowerLeg_r', 'leg2', 'kua3', 'kua4'], ['kua2', 'leg_l', 'leg3', 'lowerLeg_l', 'leg4', 'kua5', 'kua6'], ['jian1', 'Upper_arm_r', 'arm1', 'forearm_r', 'arm2', 'jian3', 'jian4'], ['jian2', 'Upper_arm_l', 'arm3', 'forearm_l', 'arm4', 'jian5', 'jian6']]) {
    const P = W(piv), U = W(up), T1 = W(t1), L = W(low), T2 = W(t2), H1 = W(h1), H2 = W(h2);
    const dUp = Math.hypot(T1[0] - P[0], T1[1] - P[1]), dLow = Math.hypot(T2[0] - T1[0], T2[1] - T1[1]);
    const knee = [H1[0] + Math.cos(H1[2] * Math.PI / 180) * H1[3], H1[1] + Math.sin(H1[2] * Math.PI / 180) * H1[3]];
    const cross = (T1[0] - P[0]) * (T2[1] - T1[1]) - (T1[1] - P[1]) * (T2[0] - T1[0]);
    const crossH = (knee[0] - P[0]) * (T2[1] - knee[1]) - (knee[1] - P[1]) * (T2[0] - knee[0]);
    console.log(piv.padEnd(6), 'pivot', P.slice(0, 2).map(f0), '|P→T1|', f0(dUp), 'upper', f0(U[3]), '|T1→T2|', f0(dLow), 'lower', f0(L[3]), 'helper', f0(H1[3]), f0(H2[3]), 'ratio', (H1[3] / dUp).toFixed(2), (H2[3] / dLow).toFixed(2), 'helper knee', knee.map(f0), 'T1', T1.slice(0, 2).map(f0), 'bend real', cross > 0 ? '+' : '-', 'helper', crossH > 0 ? '+' : '-');
  }
}
console.log('--- zero-length bones (controllers / pivots / targets) with parents and world positions');
for (const b of skeleton.bones) if (!(b.data.length > 0) && b.data.name !== 'root') console.log('  ', b.data.name.padEnd(16), 'parent', (b.parent ? b.parent.data.name : '-').padEnd(12), 'world', f0(b.worldX), f0(b.worldY), 'color', b.data.color ? b.data.color.toString ? '' : '' : '');
const idx = new Map(skeleton.bones.map((b, i) => [b.data.name, i]));
const atts = rig.skins[0].attachments;
const zeroLen = skeleton.bones.filter((b) => !(b.data.length > 0) && b.data.name !== 'root').map((b) => b.data.name);
console.log('--- weights of zero-length bones per layer (mean over all vertices / max / fraction of vertices)');
for (const t of zeroLen) {
  const per = {};
  for (const slot of Object.keys(atts)) for (const an of Object.keys(atts[slot])) {
    const a = atts[slot][an]; if (a.type !== 'mesh' || a.vertices.length === a.uvs.length) continue;
    const n = a.uvs.length / 2; const inf = AW.decodeWeighted(a.vertices, n); const bi = idx.get(t);
    let s = 0, c = 0, mx = 0; for (const v of inf) for (const e of v) if (e.bone === bi) { s += e.w; c++; mx = Math.max(mx, e.w); }
    if (c) per[slot] = `${(s / n).toFixed(3)}/${mx.toFixed(2)}/${(c / n).toFixed(2)}`;
  }
  if (Object.keys(per).length) console.log('  ', t.padEnd(16), JSON.stringify(per));
}
const faceAtt = atts[FACE] && Object.values(atts[FACE])[0];
if (faceAtt && faceAtt.type === 'mesh') {
  const n = faceAtt.uvs.length / 2; const slot = skeleton.findSlot(FACE); const a = slot.getAttachment(); const world = new Float32Array(2 * n); a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
  const f = fit(faceAtt.uvs, Array.from(world)); const det = f.A * f.E - f.B * f.D;
  const toUV = (x, y) => { const dx = x - f.C, dy = y - f.F; return [(f.E * dx - f.B * dy) / det, (-f.D * dx + f.A * dy) / det]; };
  console.log(`--- zero-length bones in ${FACE} image pixels (${faceAtt.width}x${faceAtt.height}), only those inside the image`);
  for (const t of zeroLen) { const p = W(t); const uv = toUV(p[0], p[1]); if (uv[0] >= -0.2 && uv[0] <= 1.2 && uv[1] >= -0.2 && uv[1] <= 1.2) console.log('  ', t.padEnd(16), 'px', (uv[0] * faceAtt.width).toFixed(1), (uv[1] * faceAtt.height).toFixed(1)); }
}
console.log('--- constraints in order');
const all = [...(rig.ik || []).map((c) => ({ o: c.order || 0, s: `ik  ${String(c.order || 0).padStart(2)} ${c.name.padEnd(12)} ${JSON.stringify(c.bones)} -> ${c.target}${c.compress ? ' compress' : ''}${c.stretch ? ' stretch' : ''}${c.bendPositive === false ? ' bendNeg' : ''}${c.mix !== undefined ? ' mix ' + c.mix : ''}` })), ...(rig.transform || []).map((c) => ({ o: c.order || 0, s: `tc  ${String(c.order || 0).padStart(2)} ${c.name.padEnd(12)} ${JSON.stringify(c.bones)} <- ${c.target} rot ${c.rotation || 0} x ${c.x || 0} y ${c.y || 0} mix r${c.rotateMix} t${c.translateMix} s${c.scaleMix} sh${c.shearMix}${c.shearY ? ' shearY ' + c.shearY : ''}` }))];
all.sort((p, q) => p.o - q.o); for (const c of all) console.log(c.s);
