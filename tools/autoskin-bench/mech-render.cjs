// Setup-pose render with every bone drawn: yellow = carries weights, red = a
// mechanism bone that the rule excludes (IK targets, zero-length pivots with
// children, IK helper chains copied by transform constraints). Also prints where
// the excluded bones are, so the picture can be checked against the artist rig.
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const R = require('./render.cjs');
const H = require('./spine-headless.cjs');
require(REPO + '/particle-editor/spine-auto-weights.js'); const AW = globalThis.NovaFlowAutoWeights;
const OUT = path.join(__dirname, 'out');
(async () => {
  const images = await R.loadImages();
  const rigJson = JSON.parse(fs.readFileSync(path.join(OUT, 'artist.json'), 'utf8'));
  const rig = H.loadSkeleton(rigJson);
  const skip = AW.mechanismBones(rigJson);
  const fr = R.renderFrame(rig, images, null);
  const rgba = R.toRGBA8(fr.canvas, [40, 40, 44]);
  // dim the artwork so the bones read clearly
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = rgba[i] * 0.55; rgba[i + 1] = rgba[i + 1] * 0.55; rgba[i + 2] = rgba[i + 2] * 0.55; }
  const sk = fr.skeleton;
  const seg = (bone) => { const len = bone.data.length; return [bone.worldX - R.X0, R.Y1 - bone.worldY, bone.worldX + bone.a * len - R.X0, R.Y1 - (bone.worldY + bone.c * len)]; };
  for (const bone of sk.bones) { if (skip.has(bone.data.index)) continue; const len = bone.data.length; const [x0, y0, x1, y1] = seg(bone); if (len > 0) R.drawLine(rgba, x0, y0, x1, y1, 255, 220, 60, 3); R.drawLine(rgba, x0 - 2, y0, x0 + 2, y0, 255, 235, 140, 5); }
  for (const bone of sk.bones) {
    if (!skip.has(bone.data.index)) continue;
    const len = bone.data.length; const [x0, y0, x1, y1] = seg(bone);
    if (len > 0) R.drawLine(rgba, x0, y0, x1, y1, 255, 40, 40, 7);
    R.drawLine(rgba, x0 - 5, y0, x0 + 5, y0, 255, 80, 80, 11);
    console.log(`${bone.data.name.padEnd(6)} len ${String(len.toFixed(0)).padStart(4)} world (${bone.worldX.toFixed(0)}, ${bone.worldY.toFixed(0)}) -> (${(bone.worldX + bone.a * len).toFixed(0)}, ${(bone.worldY + bone.c * len).toFixed(0)})`);
  }
  await R.savePng(rgba, path.join(OUT, 'fig_mechanism_bones.png'));
  // a closer look at the legs
  await R.savePng(rgba, path.join(OUT, 'fig_mechanism_legs.png'), [200, 560, 560, 780], 1);
  console.log('wrote fig_mechanism_bones.png / fig_mechanism_legs.png');
})().catch((e) => { console.error(e); process.exit(1); });
