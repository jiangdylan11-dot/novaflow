// Package a re-skinned rig as a loadable project: skeleton JSON + a synthesized
// atlas (one page per layer PNG, the form NovaFlow's 导入工程 accepts) + the images.
//   node export-reskin.cjs [rig=rigB2] [outDir=out/reskin]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
require(REPO + '/particle-editor/spine-auto-mesh-attach.js'); const AT = globalThis.NovaFlowAutoMeshAttach;
const IMG = (process.env.NOVA_AUTOSKIN_IMG || 'D:/foyo_new/立绘/女角色 (2)/伽夜立绘/新建文件夹/images/e');
const rigName = process.argv[2] || 'rigB2';
const outDir = process.argv[3] || path.join(__dirname, 'out', 'reskin');
(async () => {
  fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
  const rig = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', rigName + '.json'), 'utf8'));
  const used = new Set();
  for (const skin of rig.skins) for (const slot of Object.keys(skin.attachments || {})) for (const an of Object.keys(skin.attachments[slot] || {})) used.add((skin.attachments[slot][an].path || an) + '.png');
  const images = [];
  for (const f of fs.readdirSync(IMG)) {
    if (!used.has(f)) continue;
    const meta = await sharp(path.join(IMG, f)).metadata();
    fs.copyFileSync(path.join(IMG, f), path.join(outDir, 'images', f));
    images.push({ fileName: f, width: meta.width, height: meta.height });
  }
  // An attachment whose image is not in the package (an alternate skin's bu4 /
  // xiongzhao2) makes the official runtime reject the whole skeleton with
  // "Region not found in atlas", and the app then falls back to a preview that
  // cannot draw weighted meshes at all. Drop such attachments and empty skins.
  const have = new Set(images.map((i) => i.fileName.replace(/\.[^.]+$/, '').toLowerCase()));
  let dropped = 0;
  rig.skins = rig.skins.filter((skin) => {
    for (const slot of Object.keys(skin.attachments || {})) {
      for (const an of Object.keys(skin.attachments[slot] || {})) {
        const a = skin.attachments[slot][an];
        const img = String(a.path || an).toLowerCase();
        if (!have.has(img)) { delete skin.attachments[slot][an]; dropped++; }
      }
      if (!Object.keys(skin.attachments[slot]).length) delete skin.attachments[slot];
    }
    return skin.name === 'default' || Object.keys(skin.attachments || {}).length > 0;
  });
  if (dropped) console.log(`dropped ${dropped} attachment(s) without an image; skins kept: ${rig.skins.map((s) => s.name).join(', ')}`);
  const base = rigName === 'rigB2' ? '伽夜_自动蒙皮' : rigName === 'rigA' ? '伽夜_自动权重' : '伽夜_' + rigName;
  rig.skeleton = Object.assign({}, rig.skeleton, { images: './images/' });
  fs.writeFileSync(path.join(outDir, base + '.json'), JSON.stringify(rig));
  fs.writeFileSync(path.join(outDir, base + '.atlas'), AT.synthesizeAtlas(images));
  let weighted = 0, verts = 0;
  for (const skin of rig.skins) for (const slot of Object.keys(skin.attachments || {})) for (const an of Object.keys(skin.attachments[slot] || {})) { const a = skin.attachments[slot][an]; if (a.type === 'mesh' && a.vertices.length !== a.uvs.length) { weighted++; verts += a.uvs.length / 2; } }
  console.log(`wrote ${outDir}/${base}.json (+ .atlas, ${images.length} images): ${weighted} weighted meshes, ${verts} vertices, ${rig.bones.length} bones, animations [${Object.keys(rig.animations).join(', ')}]`);
})().catch((e) => { console.error(e); process.exit(1); });
