// Sanity pass over a rig before benching it against the PS export: slots and
// attachment kinds, atlas regions vs layer PNGs, setup-pose placement vs PS
// placement, which bones the mechanism rule would skip, and where the face
// controllers sit and how far they move.
//   node inspect-rig.cjs [rig.json] [atlas]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs'); const spine = H.spine;
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const RIG = process.argv[2] || (process.env.NOVA_AUTOSKIN_RIG || 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json');
const ATLAS = process.argv[3] || RIG.replace(/\.json$/, '.atlas');
const PS = (process.env.NOVA_AUTOSKIN_PS || 'D:/foyo_new/立绘/女角色 (2)/伽夜立绘/新建文件夹/伽夜立绘.json');
const IMG = (process.env.NOVA_AUTOSKIN_IMG || 'D:/foyo_new/立绘/女角色 (2)/伽夜立绘/新建文件夹/images/e');
(async () => {
  const json = JSON.parse(fs.readFileSync(RIG, 'utf8'));
  const { data, skeleton } = H.loadSkeleton(json);
  console.log(`slots (${json.slots.length}):`, json.slots.map((s) => s.name + (s.attachment ? '' : '(no att)')).join(' '));
  const atts = json.skins[0].attachments;
  const kinds = {};
  for (const slot of Object.keys(atts)) for (const an of Object.keys(atts[slot])) { const a = atts[slot][an]; const k = a.type || 'region'; const w = k === 'mesh' && a.vertices.length !== a.uvs.length ? 'weighted mesh' : k; kinds[w] = (kinds[w] || []); kinds[w].push(`${slot}/${an}`); }
  for (const k of Object.keys(kinds)) console.log(`  ${k}: ${kinds[k].length} [${kinds[k].join(' ')}]`);
  // atlas
  const atlas = fs.readFileSync(ATLAS, 'utf8').split(/\r?\n/);
  const regions = []; let cur = null;
  for (const line of atlas) { if (!line.trim()) { cur = null; continue; } if (!line.startsWith(' ') && cur === null && /\.(png|jpg)$/i.test(line.trim())) { cur = 'page'; continue; } if (!line.startsWith(' ') && !line.includes(':')) { regions.push({ name: line.trim() }); continue; } const m = line.match(/^\s+(\w+):\s*(.*)$/); if (m && regions.length) regions[regions.length - 1][m[1]] = m[2]; }
  console.log(`atlas regions: ${regions.length}`);
  let mism = 0;
  for (const r of regions) {
    const f = path.join(IMG, r.name + '.png');
    if (!fs.existsSync(f)) { console.log(`  ${r.name}: NO PS IMAGE`); mism++; continue; }
    const meta = await sharp(f).metadata();
    const [ow, oh] = (r.orig || '0,0').split(',').map((x) => +x);
    if (ow !== meta.width || oh !== meta.height) { console.log(`  ${r.name}: atlas orig ${ow}x${oh} vs image ${meta.width}x${meta.height}`); mism++; }
  }
  console.log(`atlas orig vs PS image size mismatches: ${mism}`);
  // placement
  const ps = JSON.parse(fs.readFileSync(PS, 'utf8'));
  const place = {}; for (const s of Object.keys(ps.skins.default)) for (const an of Object.keys(ps.skins.default[s])) place[an] = ps.skins.default[s][an];
  let worst = 0; const bad = [];
  for (const slot of skeleton.slots) {
    const a = slot.getAttachment(); if (!(a instanceof spine.MeshAttachment)) continue;
    const p = place[a.name]; if (!p) { bad.push(a.name + ':no PS layer'); continue; }
    const n = a.worldVerticesLength; const out = new Float32Array(n); a.computeWorldVertices(slot, 0, n, out, 0, 2);
    let d = 0; for (let i = 0; i < n / 2; i++) { const px = a.regionUVs[2 * i] * a.width, py = a.regionUVs[2 * i + 1] * a.height; d = Math.max(d, Math.hypot((p.x || 0) + px - a.width / 2 - out[2 * i], (p.y || 0) + a.height / 2 - py - out[2 * i + 1])); }
    worst = Math.max(worst, d); if (d > 2) bad.push(`${a.name}:${d.toFixed(1)}px`);
  }
  console.log(`setup pose vs PS placement: worst ${worst.toFixed(2)}px; over 2px: [${bad.join(' ')}]`);
  // mechanism bones
  const skip = AW.mechanismBones(json);
  console.log(`mechanism bones (${skip.size}): ${Array.from(skip).map((i) => json.bones[i].name).join(' ')}`);
  const zeroLeaf = json.bones.filter((b, i) => !(b.length > 0) && !skip.has(i)).map((b) => b.name);
  console.log(`zero-length controllers kept (${zeroLeaf.length}): ${zeroLeaf.join(' ')}`);
  // face controllers: position relative to the head bone and motion
  const head = skeleton.findBone('head');
  const faceNames = json.bones.filter((b) => /face|eyes|mouth|head|neck/.test(b.name)).map((b) => b.name);
  const rest = {}; skeleton.setToSetupPose(); skeleton.updateWorldTransform();
  for (const nm of faceNames) { const b = skeleton.findBone(nm); rest[nm] = [b.worldX, b.worldY, b.getWorldRotationX()]; }
  const mv = {}; for (const nm of faceNames) mv[nm] = { d: 0, rot: 0 };
  const dur = data.animations[0].duration;
  for (let t = 0; t <= dur + 1e-6; t += dur / 40) { H.poseAt(data, skeleton, data.animations[0].name, t); for (const nm of faceNames) { const b = skeleton.findBone(nm); mv[nm].d = Math.max(mv[nm].d, Math.hypot(b.worldX - rest[nm][0], b.worldY - rest[nm][1])); mv[nm].rot = Math.max(mv[nm].rot, Math.abs(b.getWorldRotationX() - rest[nm][2])); } }
  console.log('face bones: world position (setup), parent, length, max motion over the animation:');
  for (const nm of faceNames) { const b = skeleton.findBone(nm); const dHead = head ? AW.segPoint(rest[nm][0], rest[nm][1], head.worldX, head.worldY, head.worldX + head.a * head.data.length, head.worldY + head.c * head.data.length) : NaN; console.log(`  ${nm.padEnd(15)} (${rest[nm][0].toFixed(0).padStart(5)}, ${rest[nm][1].toFixed(0).padStart(5)}) parent ${(b.parent ? b.parent.data.name : '-').padEnd(10)} len ${String(b.data.length.toFixed(0)).padStart(4)} dist-to-head-bone ${dHead.toFixed(0).padStart(3)}  moves ${mv[nm].d.toFixed(1).padStart(5)}px ${mv[nm].rot.toFixed(1).padStart(5)}°`); }
  console.log(`animation ${data.animations[0].name}: ${dur}s`);
})().catch((e) => { console.error(e); process.exit(1); });
