// Synthetic animal silhouettes for the generic (no-name, no-human-template) path of the
// auto skeleton: a side-view quadruped, a bird and a fish, each as one flat layer, plus a
// layered quadruped whose parts carry meaningless names (part1..part7).
//   node make-animals.cjs   → out/animals/<name>/flat.json + images/
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const OUT = path.join(__dirname, 'out', 'animals');

function raster(W, H, shapes, fill) {
  // shapes: [{type:'ellipse', cx, cy, rx, ry, rot}] | {type:'poly', pts:[[x,y],...]} | {type:'capsule', x0,y0,x1,y1,r}
  const rgba = new Uint8ClampedArray(W * H * 4);
  const inside = (x, y) => {
    for (const s of shapes) {
      if (s.type === 'ellipse') {
        const c = Math.cos(-(s.rot || 0)), sn = Math.sin(-(s.rot || 0));
        const dx = x - s.cx, dy = y - s.cy;
        const u = dx * c - dy * sn, v = dx * sn + dy * c;
        if ((u * u) / (s.rx * s.rx) + (v * v) / (s.ry * s.ry) <= 1) return true;
      } else if (s.type === 'capsule') {
        const dx = s.x1 - s.x0, dy = s.y1 - s.y0, l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((x - s.x0) * dx + (y - s.y0) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
        const r = s.r0 !== undefined ? s.r0 + (s.r1 - s.r0) * t : s.r;
        if (Math.hypot(x - (s.x0 + t * dx), y - (s.y0 + t * dy)) <= r) return true;
      } else if (s.type === 'poly') {
        let inn = false; const p = s.pts;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) inn = !inn;
        }
        if (inn) return true;
      }
    }
    return false;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x + 0.5, y + 0.5)) continue;
    const o = 4 * (y * W + x);
    rgba[o] = fill[0]; rgba[o + 1] = fill[1]; rgba[o + 2] = fill[2]; rgba[o + 3] = 255;
  }
  return rgba;
}
async function writeLayer(dir, name, W, H, shapes, fill) {
  const rgba = raster(W, H, shapes, fill);
  await sharp(Buffer.from(rgba.buffer), { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(dir, 'images', name + '.png'));
}
function flatJson(layers, W, H) {
  const json = { skeleton: { images: './images/' }, bones: [{ name: 'root' }], slots: [], skins: { default: {} } };
  for (const l of layers) { json.slots.push({ name: l, bone: 'root', attachment: l }); json.skins.default[l] = { [l]: { x: 0, y: 0, width: W, height: H } }; }
  return json;
}
(async () => {
  const W = 1000, H = 700;
  // ---- quadruped (horse-like), side view, head to the right
  const body = { type: 'ellipse', cx: 470, cy: 330, rx: 230, ry: 110 };
  const neck = { type: 'capsule', x0: 650, y0: 300, x1: 780, y1: 170, r0: 60, r1: 40 };
  const head = { type: 'ellipse', cx: 830, cy: 150, rx: 75, ry: 42, rot: -0.35 };
  const ear = { type: 'poly', pts: [[790, 120], [805, 70], [825, 118]] };
  const legFL = { type: 'capsule', x0: 620, y0: 380, x1: 640, y1: 600, r0: 34, r1: 22 };
  const legFR = { type: 'capsule', x0: 570, y0: 390, x1: 545, y1: 600, r0: 34, r1: 22 };
  const legBL = { type: 'capsule', x0: 330, y0: 380, x1: 300, y1: 600, r0: 40, r1: 22 };
  const legBR = { type: 'capsule', x0: 390, y0: 395, x1: 405, y1: 600, r0: 36, r1: 22 };
  const hoofs = [[640, 600], [545, 600], [300, 600], [405, 600]].map(([x, y]) => ({ type: 'ellipse', cx: x, cy: y + 10, rx: 30, ry: 16 }));
  const tail = { type: 'capsule', x0: 250, y0: 300, x1: 130, y1: 470, r0: 22, r1: 8 };
  const q = { body, neck, head, ear, legFL, legFR, legBL, legBR, tail };
  for (const [name, dir] of [['quadruped', path.join(OUT, 'quadruped')], ['quadruped-parts', path.join(OUT, 'quadruped-parts')]]) {
    fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
    if (name === 'quadruped') {
      await writeLayer(dir, 'animal', W, H, [q.body, q.neck, q.head, q.ear, q.legFL, q.legFR, q.legBL, q.legBR, ...hoofs, q.tail], [170, 120, 80]);
      fs.writeFileSync(path.join(dir, 'flat.json'), JSON.stringify(flatJson(['animal'], W, H), null, 1));
    } else {
      // meaningless names: the geometry alone must sort out the hierarchy
      const parts = { part1: [q.body], part2: [q.neck, q.head, q.ear], part3: [q.legFL, hoofs[0]], part4: [q.legFR, hoofs[1]], part5: [q.legBL, hoofs[2]], part6: [q.legBR, hoofs[3]], part7: [q.tail] };
      const order = ['part5', 'part4', 'part7', 'part1', 'part2', 'part6', 'part3'];
      for (const [nm, sh] of Object.entries(parts)) await writeLayer(dir, nm, W, H, sh, [160 + Math.random() * 60, 110, 80]);
      fs.writeFileSync(path.join(dir, 'flat.json'), JSON.stringify(flatJson(order, W, H), null, 1));
    }
    console.log('wrote', dir);
  }
  // ---- bird, side view, standing
  {
    const dir = path.join(OUT, 'bird'); fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
    const shapes = [
      { type: 'ellipse', cx: 480, cy: 340, rx: 170, ry: 105, rot: -0.25 },              // body
      { type: 'capsule', x0: 600, y0: 260, x1: 690, y1: 150, r0: 40, r1: 30 },           // neck
      { type: 'ellipse', cx: 720, cy: 125, rx: 55, ry: 45 },                              // head
      { type: 'poly', pts: [[760, 120], [850, 140], [760, 150]] },                        // beak
      { type: 'poly', pts: [[380, 260], [560, 250], [520, 330], [250, 420], [330, 320]] },// wing
      { type: 'poly', pts: [[330, 380], [120, 470], [140, 520], [340, 420]] },            // tail
      { type: 'capsule', x0: 470, y0: 430, x1: 450, y1: 560, r: 12 },                     // leg 1
      { type: 'capsule', x0: 520, y0: 430, x1: 540, y1: 560, r: 12 },                     // leg 2
      { type: 'poly', pts: [[400, 560], [500, 560], [470, 580], [420, 580]] },            // foot 1
      { type: 'poly', pts: [[500, 560], [600, 560], [570, 580], [520, 580]] }             // foot 2
    ];
    await writeLayer(dir, 'bird', W, H, shapes, [90, 140, 200]);
    fs.writeFileSync(path.join(dir, 'flat.json'), JSON.stringify(flatJson(['bird'], W, H), null, 1));
    console.log('wrote', dir);
  }
  // ---- fish
  {
    const dir = path.join(OUT, 'fish'); fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
    const shapes = [
      { type: 'ellipse', cx: 480, cy: 350, rx: 260, ry: 120 },                            // body
      { type: 'poly', pts: [[230, 350], [90, 250], [120, 350], [90, 450]] },              // tail fin
      { type: 'poly', pts: [[380, 240], [470, 130], [560, 240]] },                        // dorsal fin
      { type: 'poly', pts: [[420, 455], [470, 540], [530, 455]] },                        // ventral fin
      { type: 'poly', pts: [[560, 380], [640, 470], [660, 400]] }                         // pectoral fin
    ];
    await writeLayer(dir, 'fish', W, H, shapes, [220, 140, 60]);
    fs.writeFileSync(path.join(dir, 'flat.json'), JSON.stringify(flatJson(['fish'], W, H), null, 1));
    console.log('wrote', dir);
  }
})();
