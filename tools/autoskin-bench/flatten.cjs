// Flatten a PhotoshopToSpine export into ONE layer (all layers composited in draw order
// at their placement), so the auto skeleton can be tested on a single-image character
// with no layer names at all.
//   node flatten.cjs <export.json> <image dir> <out dir> [name=figure]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const [PS, IMG, OUTDIR, NAME] = process.argv.slice(2);
const name = NAME || 'figure';
(async () => {
  const psJson = JSON.parse(fs.readFileSync(PS, 'utf8'));
  const skin = Array.isArray(psJson.skins) ? psJson.skins[0].attachments : psJson.skins.default;
  const layers = [];
  for (const slot of psJson.slots) {
    const atts = skin[slot.name]; if (!atts) continue;
    const an = slot.attachment || Object.keys(atts)[0]; const att = atts[an]; if (!att) continue;
    const file = path.join(IMG, (att.path || an) + '.png'); if (!fs.existsSync(file)) continue;
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    layers.push({ data, w: info.width, h: info.height, x: att.x || 0, y: att.y || 0 });
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of layers) { x0 = Math.min(x0, l.x - l.w / 2); x1 = Math.max(x1, l.x + l.w / 2); y0 = Math.min(y0, l.y - l.h / 2); y1 = Math.max(y1, l.y + l.h / 2); }
  const W = Math.ceil(x1 - x0), H = Math.ceil(y1 - y0);
  const out = new Float32Array(W * H * 4);
  for (const l of layers) {   // draw order: first slot at the back
    const ox = Math.round(l.x - l.w / 2 - x0), oy = Math.round(y1 - (l.y + l.h / 2));
    for (let py = 0; py < l.h; py++) {
      const cy = oy + py; if (cy < 0 || cy >= H) continue;
      for (let px = 0; px < l.w; px++) {
        const cx = ox + px; if (cx < 0 || cx >= W) continue;
        const si = 4 * (py * l.w + px), a = l.data[si + 3] / 255; if (a <= 0) continue;
        const o = 4 * (cy * W + cx);
        out[o] = l.data[si] * a + out[o] * (1 - a); out[o + 1] = l.data[si + 1] * a + out[o + 1] * (1 - a); out[o + 2] = l.data[si + 2] * a + out[o + 2] * (1 - a); out[o + 3] = a + out[o + 3] * (1 - a);
      }
    }
  }
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const a = out[4 * i + 3]; rgba[4 * i] = a > 0 ? out[4 * i] / a : 0; rgba[4 * i + 1] = a > 0 ? out[4 * i + 1] / a : 0; rgba[4 * i + 2] = a > 0 ? out[4 * i + 2] / a : 0; rgba[4 * i + 3] = a * 255; }
  fs.mkdirSync(path.join(OUTDIR, 'images'), { recursive: true });
  await sharp(Buffer.from(rgba.buffer), { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(OUTDIR, 'images', name + '.png'));
  // the flat image's centre sits at the union bbox centre in the same world frame
  const json = { skeleton: { images: './images/' }, bones: [{ name: 'root' }], slots: [{ name, bone: 'root', attachment: name }], skins: { default: { [name]: { [name]: { x: +((x0 + x1) / 2).toFixed(2), y: +((y0 + y1) / 2).toFixed(2), width: W, height: H } } } } };
  fs.writeFileSync(path.join(OUTDIR, 'flat.json'), JSON.stringify(json, null, 1));
  console.log(`flattened ${layers.length} layers into ${W}x${H} at (${((x0 + x1) / 2).toFixed(1)}, ${((y0 + y1) / 2).toFixed(1)}) → ${OUTDIR}`);
})();
