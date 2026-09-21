// Does the generated limb mechanism behave like the artist's? Pose both rigs in the
// official runtime by moving an end target (ankle / wrist) and read what the joint target,
// the helper knee and the bones did; then draw before / after.
//   node mech-check.cjs [--tag jiaye] [--rig <artist.json>] [--dx 40] [--dy 90]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const H = require('./spine-headless.cjs');
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; }
const TAG = arg('tag', 'jiaye');
const RIG = arg('rig', 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json');
const DX = Number(arg('dx', 40)), DY = Number(arg('dy', 90));
const OUT = path.join(__dirname, 'out', TAG);
const f1 = (v) => v.toFixed(1);
function pose(skeleton) { skeleton.updateWorldTransform(); }
function bonePos(skeleton, name) { const b = skeleton.findBone(name); return b ? [b.worldX, b.worldY] : null; }
function boneTip(skeleton, name) { const b = skeleton.findBone(name); return b ? [b.worldX + b.a * b.data.length, b.worldY + b.c * b.data.length] : null; }
function boneRot(skeleton, name) { const b = skeleton.findBone(name); return Math.atan2(b.c, b.a) * 180 / Math.PI; }
function moveTarget(skeleton, name, dx, dy) {
  // move a root-level handle in world space: its local == world (root at origin)
  const b = skeleton.findBone(name); const p = b.parent;
  // world delta → parent local delta
  const det = p.a * p.d - p.b * p.c; const ia = p.d / det, ib = -p.b / det, ic = -p.c / det, id = p.a / det;
  b.x += ia * dx + ib * dy; b.y += ic * dx + id * dy;
}
/** Test one limb: {pivot, upper, t1, lower, t2, helper2} on a skeleton. */
function testLimb(json, spec, dx, dy) {
  const { skeleton } = H.loadSkeleton(json);
  pose(skeleton);
  const before = { t1: bonePos(skeleton, spec.t1), t2: bonePos(skeleton, spec.t2), knee: bonePos(skeleton, spec.helper2), upTip: boneTip(skeleton, spec.upper), lowTip: boneTip(skeleton, spec.lower), upRot: boneRot(skeleton, spec.upper), lowRot: boneRot(skeleton, spec.lower), lowLen: Math.hypot(...[boneTip(skeleton, spec.lower)[0] - bonePos(skeleton, spec.lower)[0], boneTip(skeleton, spec.lower)[1] - bonePos(skeleton, spec.lower)[1]]) };
  moveTarget(skeleton, spec.t2, dx, dy);
  pose(skeleton);
  const after = { t1: bonePos(skeleton, spec.t1), t2: bonePos(skeleton, spec.t2), knee: bonePos(skeleton, spec.helper2), upTip: boneTip(skeleton, spec.upper), lowTip: boneTip(skeleton, spec.lower), upRot: boneRot(skeleton, spec.upper), lowRot: boneRot(skeleton, spec.lower), lowLen: Math.hypot(...[boneTip(skeleton, spec.lower)[0] - bonePos(skeleton, spec.lower)[0], boneTip(skeleton, spec.lower)[1] - bonePos(skeleton, spec.lower)[1]]) };
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return {
    t2Moved: d(after.t2, before.t2), kneeMoved: d(after.knee, before.knee), t1Moved: d(after.t1, before.t1),
    t1FollowRatio: d(after.t1, before.t1) / Math.max(1e-9, d(after.knee, before.knee)),
    upperTipToT1: d(after.upTip, after.t1), lowerTipToT2: d(after.lowTip, after.t2),
    upperTurn: after.upRot - before.upRot, lowerTurn: after.lowRot - before.lowRot, lowerStretch: after.lowLen / before.lowLen,
    skeleton, before, after
  };
}
(async () => {
  const auto = JSON.parse(fs.readFileSync(path.join(OUT, 'autobones.json'), 'utf8'));
  const bones = JSON.parse(fs.readFileSync(path.join(OUT, 'bones.json'), 'utf8'));
  // limbs of the auto rig from the constraint names
  const limbs = [];
  // by SHAPE, not by name (the generator now names constraints after their targets, as
  // the template does): a 2-bone helper IK, the single-bone IK on the same end target, the
  // transform constraint driven by the helper's knee, and the upper IK on the bone it moves
  const singleIk = new Map();
  for (const c of auto.ik || []) if (c.bones.length === 1) singleIk.set(c.target, c);
  const boneOf = new Map(auto.bones.map((b) => [b.name, b]));
  for (const c of auto.ik || []) {
    if (!Array.isArray(c.bones) || c.bones.length !== 2) continue;
    const lowIk = singleIk.get(c.target); if (!lowIk) continue;
    const follow = (auto.transform || []).find((t) => t.target === c.bones[1] && t.bones.length === 1);
    if (!follow) continue;
    const upIk = singleIk.get(follow.bones[0]); if (!upIk) continue;
    const upper = upIk.bones[0];
    limbs.push({ name: upper, pivot: (boneOf.get(upper) || {}).parent, upper, lower: lowIk.bones[0], t1: follow.bones[0], t2: c.target, helper2: c.bones[1] });
  }
  console.log(`auto rig: ${limbs.length} mechanised limbs; moving each end target by (${DX}, ${DY}) px`);
  console.log('limb            t2 moved  helper knee moved  joint target moved  follow ratio  upper tip→T1  lower tip→T2  upper turn  lower turn  lower stretch');
  const rows = [];
  for (const L of limbs) {
    const r = testLimb(auto, L, DX, DY);
    rows.push({ L, r });
    console.log(`${L.name.padEnd(15)} ${f1(r.t2Moved).padStart(8)} ${f1(r.kneeMoved).padStart(18)} ${f1(r.t1Moved).padStart(19)} ${r.t1FollowRatio.toFixed(2).padStart(13)} ${f1(r.upperTipToT1).padStart(13)} ${f1(r.lowerTipToT2).padStart(13)} ${f1(r.upperTurn).padStart(11)}° ${f1(r.lowerTurn).padStart(10)}° ${r.lowerStretch.toFixed(3).padStart(13)}`);
  }
  // the artist's rig, same experiment
  if (RIG && fs.existsSync(RIG) && RIG.includes('a.json')) {
    const art = JSON.parse(fs.readFileSync(RIG, 'utf8'));
    for (const k of Object.keys(art.animations || {})) delete art.animations[k];
    const specs = [{ name: 'leg_r(artist)', pivot: 'kua1', upper: 'leg_r', lower: 'lowerLeg_r', t1: 'leg1', t2: 'leg2', helper2: 'kua4' }, { name: 'leg_l(artist)', pivot: 'kua2', upper: 'leg_l', lower: 'lowerLeg_l', t1: 'leg3', t2: 'leg4', helper2: 'kua6' }, { name: 'arm_r(artist)', pivot: 'jian1', upper: 'Upper_arm_r', lower: 'forearm_r', t1: 'arm1', t2: 'arm2', helper2: 'jian4' }, { name: 'arm_l(artist)', pivot: 'jian2', upper: 'Upper_arm_l', lower: 'forearm_l', t1: 'arm3', t2: 'arm4', helper2: 'jian6' }];
    console.log('\nartist rig, same experiment:');
    for (const S of specs) {
      const r = testLimb(art, S, DX, DY);
      console.log(`${S.name.padEnd(15)} ${f1(r.t2Moved).padStart(8)} ${f1(r.kneeMoved).padStart(18)} ${f1(r.t1Moved).padStart(19)} ${r.t1FollowRatio.toFixed(2).padStart(13)} ${f1(r.upperTipToT1).padStart(13)} ${f1(r.lowerTipToT2).padStart(13)} ${f1(r.upperTurn).padStart(11)}° ${f1(r.lowerTurn).padStart(10)}° ${r.lowerStretch.toFixed(3).padStart(13)}`);
    }
  }
  // ---- figure: setup vs posed bones of the auto rig (all limbs moved at once)
  const { skeleton } = H.loadSkeleton(auto);
  pose(skeleton);
  const segs0 = skeleton.bones.map((b) => ({ name: b.data.name, x: b.worldX, y: b.worldY, tx: b.worldX + b.a * b.data.length, ty: b.worldY + b.c * b.data.length, len: b.data.length }));
  for (const L of limbs) moveTarget(skeleton, L.t2, DX, DY);
  pose(skeleton);
  const segs1 = skeleton.bones.map((b) => ({ name: b.data.name, x: b.worldX, y: b.worldY, tx: b.worldX + b.a * b.data.length, ty: b.worldY + b.c * b.data.length, len: b.data.length }));
  const kindOf = new Map(bones.bones.map((b) => [b.name, b.kind]));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segs0.concat(segs1)) { x0 = Math.min(x0, s.x, s.tx); x1 = Math.max(x1, s.x, s.tx); y0 = Math.min(y0, s.y, s.ty); y1 = Math.max(y1, s.y, s.ty); }
  const scale = 0.55, M = 30; const W = Math.ceil((x1 - x0 + 2 * M) * scale), Hh = Math.ceil((y1 - y0 + 2 * M) * scale);
  const map = (x, y) => [(x - x0 + M) * scale, (y1 - y + M) * scale];
  const draw = (segs, title) => {
    const rgba = new Uint8ClampedArray(W * Hh * 4); for (let i = 0; i < W * Hh; i++) { rgba[4 * i] = 34; rgba[4 * i + 1] = 34; rgba[4 * i + 2] = 40; rgba[4 * i + 3] = 255; }
    const line = (ax, ay, bx, by, c, wd) => { const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2)); const r = wd / 2; for (let s = 0; s <= n; s++) { const x = ax + (bx - ax) * s / n, y = ay + (by - ay) * s / n; for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) { if (dx * dx + dy * dy > r * r + 0.5) continue; const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx < 0 || yy < 0 || xx >= W || yy >= Hh) continue; const o = 4 * (yy * W + xx); rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; } } };
    for (const s of segs) {
      const k = kindOf.get(s.name); const [ax, ay] = map(s.x, s.y), [bx, by] = map(s.tx, s.ty);
      if (k === 'helper') { line(ax, ay, bx, by, [140, 140, 140], 2); continue; }
      if (k === 'ikTarget') { line(ax - 5, ay - 5, ax + 5, ay + 5, [255, 60, 60], 2); line(ax - 5, ay + 5, ax + 5, ay - 5, [255, 60, 60], 2); continue; }
      if (k === 'pivot') { for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 2, u = (a + 1) / 24 * Math.PI * 2; line(ax + 6 * Math.cos(t), ay + 6 * Math.sin(t), ax + 6 * Math.cos(u), ay + 6 * Math.sin(u), [255, 140, 60], 1.5); } continue; }
      if (k === 'slider' || k === 'controller') { for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 2, u = (a + 1) / 24 * Math.PI * 2; line(ax + 5 * Math.cos(t), ay + 5 * Math.sin(t), ax + 5 * Math.cos(u), ay + 5 * Math.sin(u), [170, 230, 60], 1.5); } continue; }
      if (!(s.len > 0)) continue;
      line(ax, ay, bx, by, [0, 0, 0], 4); line(ax, ay, bx, by, [120, 230, 90], 2.5); line(ax - 1, ay, ax + 1, ay, [255, 255, 255], 4);
    }
    const lab = Buffer.from(`<svg width="${W}" height="30"><rect width="${W}" height="30" fill="rgba(0,0,0,0.7)"/><text x="6" y="21" font-family="Microsoft YaHei, sans-serif" font-size="15" fill="#fff">${title}</text></svg>`);
    return sharp(Buffer.from(rgba.buffer), { raw: { width: W, height: Hh, channels: 4 } }).composite([{ input: lab, left: 0, top: 0 }]).png().toBuffer();
  };
  const a = await draw(segs0, '自动骨架 绑定姿态（灰=辅助链，×=IK目标，橙环=枢轴，绿环=控制点/转面）'), b = await draw(segs1, `每个末端目标平移 (${DX}, ${DY}) 后：辅助链重解，关节目标跟随，骨骼 IK 伸缩到位`);
  await sharp({ create: { width: 2 * W + 8, height: Hh, channels: 4, background: { r: 24, g: 24, b: 28, alpha: 1 } } }).composite([{ input: a, left: 0, top: 0 }, { input: b, left: W + 8, top: 0 }]).png().toFile(path.join(OUT, 'fig_mech.png'));
  console.log(`wrote ${path.join(OUT, 'fig_mech.png')}`);
})().catch((e) => { console.error(e); process.exit(1); });
