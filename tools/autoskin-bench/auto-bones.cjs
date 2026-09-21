// Build an automatic skeleton for a PhotoshopToSpine export and draw it next to the
// artist's rig (when one is given).
//   node auto-bones.cjs --ps <export.json> --img <layer dir> [--rig <artist.json>] [--out <tag>] [--opts '{...}'] [--noNames]
// Writes out/<tag>/autobones.json (loadable skeleton: PS export + auto bones + IK),
// plan.json (per-layer decisions), bones.json (world segments) and fig_bones.png.
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const H = require('./spine-headless.cjs');
require(REPO + '/particle-editor/spine-auto-mesh-core.js');
require(REPO + '/particle-editor/spine-auto-weights.js');
require(REPO + '/particle-editor/spine-auto-bones.js');
const AB = globalThis.NovaFlowAutoBones, AW = globalThis.NovaFlowAutoWeights;

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; }
const PS = arg('ps', 'C:/Users/jiang/OneDrive/Desktop/test/新建文件夹/伽夜立绘.json');
const IMG = arg('img', 'C:/Users/jiang/OneDrive/Desktop/test/新建文件夹/images/e');
const RIG = arg('rig', 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json');
const TAG = arg('out', 'jiaye');
const OPTS = Object.assign(arg('opts') ? JSON.parse(arg('opts')) : {}, process.argv.includes('--noNames') ? { names: false } : {});
const OUT = path.join(__dirname, 'out', TAG); fs.mkdirSync(OUT, { recursive: true });

async function loadLayers(psJson, dir) {
  const skin = Array.isArray(psJson.skins) ? psJson.skins[0].attachments : psJson.skins.default;
  const layers = [];
  for (const slot of psJson.slots) {
    const atts = skin[slot.name]; if (!atts) continue;
    const an = slot.attachment || Object.keys(atts)[0]; const att = atts[an]; if (!att || (att.type && att.type !== 'region')) continue;
    const file = path.join(dir, (att.path || an) + '.png');
    if (!fs.existsSync(file)) { console.log('  no image for', slot.name); continue; }
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    layers.push({ name: slot.name, att: an, width: info.width, height: info.height, rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), place: { x: att.x || 0, y: att.y || 0 }, drawIndex: layers.length });
  }
  return layers;
}

// ---- drawing helpers on a raw RGBA canvas with a world → canvas map
function makeCanvas(layers, margin, scale) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of layers) {
    const b = l.analysis ? l.analysis.bbox : [0, 0, l.width, l.height];
    const wx0 = l.place.x + b[0] - l.width / 2, wx1 = l.place.x + b[2] - l.width / 2;
    const wy1 = l.place.y + l.height / 2 - b[1], wy0 = l.place.y + l.height / 2 - b[3];
    x0 = Math.min(x0, wx0); x1 = Math.max(x1, wx1); y0 = Math.min(y0, wy0); y1 = Math.max(y1, wy1);
  }
  x0 -= margin; x1 += margin; y0 -= margin; y1 += margin;
  const W = Math.ceil((x1 - x0) * scale), Hh = Math.ceil((y1 - y0) * scale);
  const rgba = new Uint8ClampedArray(W * Hh * 4);
  for (let i = 0; i < W * Hh; i++) { rgba[4 * i] = 34; rgba[4 * i + 1] = 34; rgba[4 * i + 2] = 40; rgba[4 * i + 3] = 255; }
  const map = (wx, wy) => [(wx - x0) * scale, (y1 - wy) * scale];
  return { rgba, W, H: Hh, map, x0, y1, scale };
}
function compositeLayers(cv, layers, dim) {
  const { rgba, W, H, x0, y1, scale } = cv;
  for (const l of layers) {
    const step = 1 / scale;
    for (let cy = 0; cy < H; cy++) {
      const wy = y1 - cy / scale;
      const py = Math.floor(l.place.y + l.height / 2 - wy);
      if (py < 0 || py >= l.height) continue;
      for (let cx = 0; cx < W; cx++) {
        const wx = x0 + cx / scale;
        const px = Math.floor(wx - l.place.x + l.width / 2);
        if (px < 0 || px >= l.width) continue;
        const si = 4 * (py * l.width + px);
        const a = l.rgba[si + 3] / 255 * (dim || 1);
        if (a <= 0) continue;
        const o = 4 * (cy * W + cx);
        rgba[o] = l.rgba[si] * a + rgba[o] * (1 - a);
        rgba[o + 1] = l.rgba[si + 1] * a + rgba[o + 1] * (1 - a);
        rgba[o + 2] = l.rgba[si + 2] * a + rgba[o + 2] * (1 - a);
      }
    }
    void step;
  }
}
function line(cv, ax, ay, bx, by, c, width) {
  const { rgba, W, H } = cv;
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
  const rad = Math.max(0, (width || 1) / 2);
  for (let s = 0; s <= n; s++) {
    const x = ax + (bx - ax) * s / n, y = ay + (by - ay) * s / n;
    for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
      if (dx * dx + dy * dy > rad * rad + 0.5) continue;
      const xx = Math.round(x + dx), yy = Math.round(y + dy);
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const o = 4 * (yy * W + xx);
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
    }
  }
}
function dot(cv, x, y, c, r) { line(cv, x, y, x, y, c, 2 * r); }
function ring(cv, x, y, c, r) { const n = 24; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2; line(cv, x + r * Math.cos(a), y + r * Math.sin(a), x + r * Math.cos(b), y + r * Math.sin(b), c, 1.5); } }
function cross(cv, x, y, c, r) { line(cv, x - r, y - r, x + r, y + r, c, 1.5); line(cv, x - r, y + r, x + r, y - r, c, 1.5); }
const PALETTE = [[255, 90, 90], [90, 200, 255], [120, 255, 120], [255, 200, 60], [230, 120, 255], [80, 240, 220], [255, 140, 40], [170, 170, 255], [255, 110, 180], [180, 240, 90], [255, 240, 120], [120, 160, 255]];
function drawAuto(cv, built) {
  const colorOf = new Map(); let k = 0;
  const col = (layer) => { if (!colorOf.has(layer)) colorOf.set(layer, PALETTE[k++ % PALETTE.length]); return colorOf.get(layer); };
  for (const b of built.bones) {
    if (b.kind === 'root') continue;
    const [ax, ay] = cv.map(b.ax, b.ay), [bx, by] = cv.map(b.bx, b.by);
    const c = b.role === 'trunk' ? [255, 255, 255] : (b.role === 'connector' || b.role === 'trunkBranch' ? [255, 230, 120] : col(b.layer));
    if (b.kind === 'ikTarget') { cross(cv, ax, ay, [255, 60, 60], 6); continue; }
    if (b.kind === 'pivot') { ring(cv, ax, ay, [255, 120, 60], 7); continue; }
    if (b.kind === 'helper') { line(cv, ax, ay, bx, by, [120, 120, 120], 2); continue; }
    if (b.kind === 'slider') { ring(cv, ax, ay, [180, 255, 120], 8); cross(cv, ax, ay, [180, 255, 120], 3); continue; }
    if (b.kind === 'controller') { ring(cv, ax, ay, [180, 255, 120], 5); dot(cv, ax, ay, [180, 255, 120], 1.5); continue; }
    line(cv, ax, ay, bx, by, [0, 0, 0], 5);
    line(cv, ax, ay, bx, by, c, 3);
    dot(cv, ax, ay, [255, 255, 255], 2.5);
  }
  return colorOf;
}
function artistSegments(rigJson) {
  const { skeleton } = H.loadSkeleton(rigJson);
  const mech = AW.mechanismBones(rigJson);
  const ikTargets = new Set((rigJson.ik || []).map((c) => c.target));
  return skeleton.bones.map((b, i) => ({ name: b.data.name, parent: b.parent ? b.parent.data.name : null, ax: b.worldX, ay: b.worldY, bx: b.worldX + b.a * b.data.length, by: b.worldY + b.c * b.data.length, len: b.data.length, mech: mech.has(i), ikTarget: ikTargets.has(b.data.name) }));
}
function drawArtist(cv, segs) {
  for (const b of segs) {
    if (b.name === 'root') continue;
    const [ax, ay] = cv.map(b.ax, b.ay), [bx, by] = cv.map(b.bx, b.by);
    if (b.ikTarget) { cross(cv, ax, ay, [255, 60, 60], 6); continue; }
    if (!(b.len > 0)) { if (b.mech) ring(cv, ax, ay, [255, 120, 60], 7); else { ring(cv, ax, ay, [180, 255, 120], 5); dot(cv, ax, ay, [180, 255, 120], 1.5); } continue; }
    if (b.mech) { line(cv, ax, ay, bx, by, [120, 120, 120], 2); continue; }
    line(cv, ax, ay, bx, by, [0, 0, 0], 5);
    line(cv, ax, ay, bx, by, [120, 230, 90], 3);
    dot(cv, ax, ay, [255, 255, 255], 2.5);
  }
}
function drawAxes(cv, layers) {
  let k = 0;
  for (const l of layers) {
    if (!l.analysis) continue;
    const c = PALETTE[k++ % PALETTE.length];
    for (const e of l.analysis.graph.edges) {
      const p = e.poly;
      for (let i = 2; i < p.length; i += 2) {
        const [ax, ay] = cv.map(l.place.x + p[i - 2] - l.width / 2, l.place.y + l.height / 2 - p[i - 1]);
        const [bx, by] = cv.map(l.place.x + p[i] - l.width / 2, l.place.y + l.height / 2 - p[i + 1]);
        line(cv, ax, ay, bx, by, c, 2);
      }
    }
    for (const n of l.analysis.graph.nodes) {
      if (!n.deg) continue;
      const [x, y] = cv.map(l.place.x + n.x - l.width / 2, l.place.y + l.height / 2 - n.y);
      if (n.deg >= 3) ring(cv, x, y, [255, 255, 255], 4); else dot(cv, x, y, [255, 255, 255], 2);
    }
  }
}
function label(w, h, text) {
  return Buffer.from(`<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="34" fill="rgba(0,0,0,0.6)"/><text x="10" y="24" font-family="Microsoft YaHei, sans-serif" font-size="20" fill="#fff">${text}</text></svg>`);
}
async function panel(cv, text) {
  const buf = await sharp(Buffer.from(cv.rgba.buffer, cv.rgba.byteOffset, cv.rgba.byteLength), { raw: { width: cv.W, height: cv.H, channels: 4 } }).composite([{ input: label(cv.W, cv.H, text), top: 0, left: 0 }]).png().toBuffer();
  return { buf, w: cv.W, h: cv.H };
}
async function row(panels, file) {
  const gap = 8;
  const W = panels.reduce((a, p) => a + p.w, 0) + gap * (panels.length - 1), Hh = Math.max(...panels.map((p) => p.h));
  let x = 0; const comp = panels.map((p) => { const c = { input: p.buf, left: x, top: 0 }; x += p.w + gap; return c; });
  await sharp({ create: { width: W, height: Hh, channels: 4, background: { r: 24, g: 24, b: 28, alpha: 1 } } }).composite(comp).png().toFile(file);
  console.log('wrote', file, `${W}x${Hh}`);
}

(async () => {
  const psJson = JSON.parse(fs.readFileSync(PS, 'utf8'));
  const layers = await loadLayers(psJson, IMG);
  console.log(`${layers.length} layers from ${PS}`);
  const t0 = Date.now();
  const built = AB.buildSkeleton(layers, OPTS);
  console.log(`auto skeleton: ${built.bones.length} bones, ${built.json.ik.length} IK, ${Date.now() - t0} ms`);
  for (const [name, p] of Object.entries(built.plan.layers)) console.log(`  ${name.padEnd(12)} ${String(p.role).padEnd(7)} ${(p.part || '-').padEnd(9)} parent=${p.parent || '-'}/${p.parentBone || '-'} ${p.rootWhy || ''} bones=${(p.bones || []).length} elong=${p.elong || ''} width=${p.width || ''} leaves=${p.leaves || ''}`);
  const skel = AB.applyToSkeleton(psJson, built);
  skel.skeleton = Object.assign({}, skel.skeleton, { spine: '3.8.99', images: IMG.replace(/\\/g, '/') + '/' });
  // Spine 3.8 reads skins as an array [{name, attachments}]; the PS export uses the older object form
  if (skel.skins && !Array.isArray(skel.skins)) skel.skins = Object.keys(skel.skins).map((n) => ({ name: n, attachments: skel.skins[n] }));
  fs.writeFileSync(path.join(OUT, 'autobones.json'), JSON.stringify(skel, null, 1));
  fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify(built.plan, null, 1));
  fs.writeFileSync(path.join(OUT, 'bones.json'), JSON.stringify({ bones: built.bones, ik: built.json.ik, slotBone: built.slotBone }, null, 1));
  // the skeleton must load in the official runtime
  const { skeleton } = H.loadSkeleton(skel);
  console.log(`runtime loads it: ${skeleton.bones.length} bones, ${skeleton.ikConstraints.length} IK`);

  const scale = Number(arg('scale', 0.6));
  const cvAuto = makeCanvas(layers, 40, scale); compositeLayers(cvAuto, layers, 0.55); drawAuto(cvAuto, built);
  const cvAxes = makeCanvas(layers, 40, scale); compositeLayers(cvAxes, layers, 0.35); drawAxes(cvAxes, layers);
  const panels = [];
  if (RIG && fs.existsSync(RIG)) {
    const rigJson = JSON.parse(fs.readFileSync(RIG, 'utf8'));
    const segs = artistSegments(rigJson);
    fs.writeFileSync(path.join(OUT, 'artist_bones.json'), JSON.stringify(segs, null, 1));
    const cvArt = makeCanvas(layers, 40, scale); compositeLayers(cvArt, layers, 0.55); drawArtist(cvArt, segs);
    panels.push(await panel(cvArt, `美术手绑 ${segs.filter((b) => b.len > 0 && !b.mech).length} 条形变骨（灰=机构骨，×=IK目标，环=控制点）`));
  }
  panels.push(await panel(cvAuto, `自动架设 ${built.bones.filter((b) => b.kind === 'bone').length} 条形变骨（灰=辅助链，×=IK目标，橙环=枢轴，绿环=控制点/转面，${built.json.ik.length} IK ${built.json.transform.length} 变换约束）`));
  panels.push(await panel(cvAxes, `各层中轴（剪枝后）`));
  await row(panels, path.join(OUT, 'fig_bones.png'));
})().catch((e) => { console.error(e); process.exit(1); });
