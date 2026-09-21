// Turn a finished Spine 3.8 project (json + atlas + page png) into the flat layered form
// the auto-skeleton takes: one untrimmed PNG per attachment and a PhotoshopToSpine-style
// JSON whose region attachments sit where the artist's artwork sits at setup pose.
//   node unpack-rig.cjs <rig.json> <out dir>
// Meshes are placed through a least-squares affine fit of their uv → world map (the
// rotation of that fit is reported; the flat form cannot express a rotated layer).
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const H = require('./spine-headless.cjs'); const spine = H.spine;
require(REPO + '/particle-editor/spine-auto-mesh-attach.js');
const AT = globalThis.NovaFlowAutoMeshAttach;
const [RIG, OUTDIR] = process.argv.slice(2);
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
(async () => {
  const rigJson = JSON.parse(fs.readFileSync(RIG, 'utf8'));
  const base = RIG.replace(/\.json$/i, '');
  const atlasText = fs.readFileSync(base + '.atlas', 'utf8');
  const regions = AT.parseAtlas(atlasText);
  const pages = new Map();
  const imgDir = path.join(OUTDIR, 'images'); fs.mkdirSync(imgDir, { recursive: true });
  const { skeleton } = H.loadSkeleton(rigJson);
  const out = { skeleton: { images: imgDir.replace(/\\/g, '/') + '/' }, bones: [{ name: 'root' }], slots: [], skins: { default: {} } };
  const skinAtts = rigJson.skins[0].attachments;
  for (const slot of skeleton.slots) {
    const a = slot.getAttachment();
    if (!a) continue;
    const slotName = slot.data.name, attName = a.name, image = (a.path || a.name);
    const reg = regions.get(image);
    if (!reg) { console.log('  no atlas region for', image); continue; }
    if (!pages.has(reg.page)) pages.set(reg.page, path.join(path.dirname(RIG), reg.page));
    const pageFile = pages.get(reg.page);
    // unpack: transparent orig canvas, region pasted at (offX, offTop), rotated back clockwise
    const pw = reg.rotate ? reg.h : reg.w, ph = reg.rotate ? reg.w : reg.h;
    let piece = sharp(pageFile).extract({ left: reg.x, top: reg.y, width: pw, height: ph });
    if (reg.rotate) piece = piece.rotate(90);
    const pieceBuf = await piece.png().toBuffer();
    const file = path.join(imgDir, image + '.png');
    await sharp({ create: { width: reg.origW, height: reg.origH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: pieceBuf, left: reg.offX, top: reg.offTop }]).png().toFile(file);
    // placement of the untrimmed image at setup pose
    let cx, cy, rot = 0;
    if (a instanceof spine.MeshAttachment) {
      const att = skinAtts[slotName][attName];
      const n = a.worldVerticesLength / 2;
      const world = new Float32Array(2 * n);
      a.computeWorldVertices(slot, 0, 2 * n, world, 0, 2);
      const fit = fitAffine(att.uvs, Array.from(world));
      cx = fit.a * 0.5 + fit.b * 0.5 + fit.c; cy = fit.d * 0.5 + fit.e * 0.5 + fit.f;
      rot = Math.atan2(fit.d, fit.a) * 180 / Math.PI;
      const sx = Math.hypot(fit.a, fit.d) / reg.origW, sy = Math.hypot(fit.b, fit.e) / reg.origH;
      if (Math.abs(rot) > 2 || Math.abs(sx - 1) > 0.03 || Math.abs(sy - 1) > 0.03) console.log(`  ${slotName}: mesh fit rot ${rot.toFixed(1)}° scale ${sx.toFixed(3)}/${sy.toFixed(3)} (flat placement is approximate)`);
    } else if (a instanceof spine.RegionAttachment) {
      const world = new Float32Array(8);
      a.computeWorldVertices(slot.bone, world, 0, 2);
      cx = (world[0] + world[2] + world[4] + world[6]) / 4; cy = (world[1] + world[3] + world[5] + world[7]) / 4;
      rot = Math.atan2(world[5] - world[3], world[4] - world[2]) * 180 / Math.PI;   // BR → UR... approximate
      if (Math.abs(rot) > 2) console.log(`  ${slotName}: region rotated ${rot.toFixed(1)}°`);
    } else continue;
    out.slots.push({ name: slotName, bone: 'root', attachment: attName });
    out.skins.default[slotName] = { [attName]: { x: +cx.toFixed(2), y: +cy.toFixed(2), width: reg.origW, height: reg.origH, path: image !== attName ? image : undefined } };
    if (out.skins.default[slotName][attName].path === undefined) delete out.skins.default[slotName][attName].path;
  }
  fs.writeFileSync(path.join(OUTDIR, 'flat.json'), JSON.stringify(out, null, 1));
  console.log(`wrote ${out.slots.length} layers to ${OUTDIR}`);
})().catch((e) => { console.error(e); process.exit(1); });
