// One layer, artist vs auto: the layer's image with the artist's deform bones on the left
// and the auto skeleton's bones of that layer on the right (roots circled, one colour per
// chain). For judging chain layout on hair, cloth and limbs without the rest of the figure.
//   node layer-bones.cjs --tag jiaye --layer hair_front [--ps ... --img ... --rig ...] [--zoom 3] [--pad 20]
// Writes out/dbg_<tag>_<layer>_bones.png.
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const sc = require('./struct-compare.cjs');
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; }
const TAG = arg('tag', 'jiaye');
const LAYER = arg('layer', 'hair_front');
const DEF = {
  jiaye: { ps: 'C:/Users/jiang/OneDrive/Desktop/test/新建文件夹/伽夜立绘.json', img: 'C:/Users/jiang/OneDrive/Desktop/test/新建文件夹/images/e', rig: 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json' },
  jinse: { ps: 'D:/foyo_new/立绘/锦瑟/PSD.json', img: 'D:/foyo_new/立绘/锦瑟/images', rig: 'D:/foyo_new/立绘/锦瑟/NovaFlow/立绘.json' },
  anan: { ps: path.join(__dirname, 'out/anan/flat/flat.json'), img: path.join(__dirname, 'out/anan/flat/images'), rig: 'D:/AI_APP/spine查看/test/spine_lihui_anan_5.json' },
};
const D = DEF[TAG] || DEF.jiaye;
const PS = arg('ps', D.ps), IMG = arg('img', D.img), RIG = arg('rig', D.rig);
const Z = Number(arg('zoom', 3)), PAD = Number(arg('pad', 20));
const OUT = arg('out', path.join(__dirname, 'out', `dbg_${TAG}_${LAYER}_bones.png`));

const PAL = ['#ffd040', '#40c8ff', '#ff60c0', '#a0ff60', '#ff9040', '#c090ff', '#ff5050', '#60ffe0', '#ffffff', '#f0a0a0'];
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

(async () => {
  const ps = JSON.parse(fs.readFileSync(PS, 'utf8')); const skin = Array.isArray(ps.skins) ? ps.skins[0].attachments : ps.skins.default;
  if (!skin[LAYER]) { console.error('no such layer in the PS export: ' + LAYER); process.exit(1); }
  const an = Object.keys(skin[LAYER])[0]; const att = skin[LAYER][an]; const file = path.join(IMG, (att.path || an) + '.png');
  const meta = await sharp(file).metadata(); const w = meta.width, h = meta.height;
  // crop to the layer's alpha (plus PAD) so a big canvas does not dwarf the hair
  const rawA = (await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
  let bx0 = w, bx1 = -1, by0 = h, by1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rawA[4 * (y * w + x) + 3] >= 40) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  const FIT = arg('fit', '1') !== '0' && bx1 >= 0;
  const cx0 = FIT ? Math.max(0, bx0 - PAD) : 0, cy0 = FIT ? Math.max(0, by0 - PAD) : 0;
  const cw = FIT ? Math.min(w, bx1 + PAD + 1) - cx0 : w, ch = FIT ? Math.min(h, by1 + PAD + 1) - cy0 : h;
  // world → layer pixel (the attachment is centred at att.x / att.y, y up)
  const toPx = (wx, wy) => [wx - att.x + w / 2, att.y + h / 2 - wy];
  const artistAll = RIG && RIG !== 'none' && fs.existsSync(RIG) ? sc.artistBones(JSON.parse(fs.readFileSync(RIG, 'utf8'))) : [];
  const artist = artistAll.filter((b) => b.deform && b.layer === LAYER);
  const oursAll = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', TAG, 'bones.json'), 'utf8')).bones;
  const ours = oursAll.filter((b) => b.layer === LAYER && b.kind === 'bone');
  const oursByName = new Map(oursAll.map((b) => [b.name, b]));
  const artByName = new Map(artistAll.map((b) => [b.name, b]));
  // chain colouring: bones sharing a root (first ancestor whose parent is off-layer) share a colour
  const rootOf = (b, byName, onLayer) => { let n = b; while (n && byName.get(n.parent) && onLayer(byName.get(n.parent))) n = byName.get(n.parent); return n.name; };
  const draw = (bones, byName, onLayer, dashed) => {
    const roots = new Map(); let svg = '';
    for (const b of bones) { const r = rootOf(b, byName, onLayer); if (!roots.has(r)) roots.set(r, roots.size); }
    for (const b of bones) {
      const col = PAL[roots.get(rootOf(b, byName, onLayer)) % PAL.length];
      const [ax, ay] = toPx(b.ax, b.ay), [bx, by] = toPx(b.bx, b.by);
      const isRoot = !byName.get(b.parent) || !onLayer(byName.get(b.parent));
      svg += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${col}" stroke-width="1.6"${dashed ? ' stroke-dasharray="4,2"' : ''}/>`;
      svg += `<circle cx="${bx}" cy="${by}" r="1.4" fill="#fff"/>`;
      if (isRoot) svg += `<circle cx="${ax}" cy="${ay}" r="3.2" fill="none" stroke="${col}" stroke-width="1.4"/>`;
    }
    return { svg, chains: roots.size };
  };
  const A = draw(artist, artByName, (b) => b.layer === LAYER && b.deform, true);
  const O = draw(ours, oursByName, (b) => b.layer === LAYER && b.kind === 'bone', false);
  const meanLen = (bs) => (bs.length ? bs.reduce((a, b) => a + b.len, 0) / bs.length : 0);
  const labelA = `美术 ${LAYER}：${artist.length} 骨 / ${A.chains} 链，均长 ${meanLen(artist).toFixed(0)}`;
  const labelO = `自动 ${LAYER}：${ours.length} 骨 / ${O.chains} 链，均长 ${meanLen(ours).toFixed(0)}`;
  const panel = async (svgBody, label) => {
    const W = Math.round(cw * Z), H = Math.round(ch * Z) + 30;
    const svg = `<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#202226"/><text x="8" y="21" font-family="Microsoft YaHei, sans-serif" font-size="16" fill="#eee">${esc(label)}</text><g transform="translate(0,30) scale(${Z}) translate(${-cx0},${-cy0})">${svgBody}</g></svg>`;
    const img = await sharp(file).extract({ left: cx0, top: cy0, width: cw, height: ch }).resize({ width: W, kernel: 'lanczos3' }).png().toBuffer();
    const base = await sharp({ create: { width: W, height: H, channels: 4, background: '#202226' } }).composite([{ input: img, top: 30, left: 0 }]).png().toBuffer();
    return sharp(base).composite([{ input: Buffer.from(svg.replace('<rect width', '<rect fill-opacity="0" width')), top: 0, left: 0 }]).png().toBuffer();
  };
  const pa = await panel(A.svg, labelA), po = await panel(O.svg, labelO);
  const W = Math.round(cw * Z), H = Math.round(ch * Z) + 30;
  await sharp({ create: { width: 2 * W + PAD, height: H, channels: 4, background: '#202226' } }).composite([{ input: pa, top: 0, left: 0 }, { input: po, top: 0, left: W + PAD }]).png().toFile(OUT);
  console.log(`${labelA} | ${labelO} → ${path.relative(__dirname, OUT)}`);
})();
