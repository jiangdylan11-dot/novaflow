// One picture of the generic-path results: the four synthetic animals' auto skeletons.
//   node montage-animals.cjs
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const OUT = path.join(__dirname, 'out');
(async () => {
  const tiles = [];
  for (const [tag, label] of [['quadruped', '四足（单图层，无名字）'], ['quadruped-parts', '四足（7 层，名字无意义 part1..7）'], ['bird', '鸟（单图层）'], ['fish', '鱼（单图层）']]) {
    const file = path.join(OUT, 'animals', tag, 'fig_bones.png');
    const meta = await sharp(file).metadata();
    // left panel only (the skeleton), the axis panel is a debug view
    const w = Math.floor((meta.width - 8) / 2);
    const buf = await sharp(file).extract({ left: 0, top: 0, width: w, height: meta.height }).resize({ width: 700 }).png().toBuffer();
    const m = await sharp(buf).metadata();
    const lab = Buffer.from(`<svg width="${m.width}" height="${m.height}"><rect x="0" y="0" width="${m.width}" height="30" fill="rgba(0,0,0,0.75)"/><text x="8" y="21" font-family="Microsoft YaHei, sans-serif" font-size="17" fill="#fff">${label}</text></svg>`);
    tiles.push({ buf: await sharp(buf).composite([{ input: lab, left: 0, top: 0 }]).png().toBuffer(), w: m.width, h: m.height });
  }
  const cols = 2, gap = 8;
  const tw = Math.max(...tiles.map((t) => t.w)), th = Math.max(...tiles.map((t) => t.h));
  const rows = Math.ceil(tiles.length / cols);
  const comp = tiles.map((t, i) => ({ input: t.buf, left: (i % cols) * (tw + gap), top: Math.floor(i / cols) * (th + gap) }));
  const file = path.join(OUT, 'fig_animals.png');
  await sharp({ create: { width: cols * tw + (cols - 1) * gap, height: rows * th + (rows - 1) * gap, channels: 4, background: { r: 24, g: 24, b: 28, alpha: 1 } } }).composite(comp).png().toFile(file);
  console.log('wrote', file);
})();
