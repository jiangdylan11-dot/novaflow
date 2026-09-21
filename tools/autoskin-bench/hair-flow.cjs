// Feasibility: chains along the DRAWN hair strands of a broad hair mass (a fringe), which the
// alpha silhouette merges into one blob. Structure-tensor orientation of the luminance inside
// the mask, streamlines traced from seeds on the mass's top edge, compared with the artist.
//   node hair-flow.cjs [--layer hair_front] [--sigma 6] [--seedGap 30]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const sc = require('./struct-compare.cjs');
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; }
const LAYER = arg('layer', 'hair_front');
const PS = arg('ps', 'C:/Users/jiang/OneDrive/Desktop/test/新建文件夹/伽夜立绘.json');
const IMG = arg('img', 'C:/Users/jiang/OneDrive/Desktop/test/新建文件夹/images/e');
const RIG = arg('rig', 'C:/Users/jiang/OneDrive/Desktop/test/骨骼蒙版模板/a.json');
const SIGMA = Number(arg('sigma', 6)), SEEDGAP = Number(arg('seedGap', 30)), STEP = 3;

function gauss1d(sigma) { const r = Math.ceil(3 * sigma); const k = []; let s = 0; for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * sigma * sigma)); k.push(v); s += v; } return { k: k.map((v) => v / s), r }; }
function blur(src, w, h, sigma) {
  const { k, r } = gauss1d(sigma); const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -r; i <= r; i++) { const xx = Math.min(w - 1, Math.max(0, x + i)); s += src[y * w + xx] * k[i + r]; } tmp[y * w + x] = s; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -r; i <= r; i++) { const yy = Math.min(h - 1, Math.max(0, y + i)); s += tmp[yy * w + x] * k[i + r]; } out[y * w + x] = s; }
  return out;
}

(async () => {
  const ps = JSON.parse(fs.readFileSync(PS, 'utf8')); const skin = Array.isArray(ps.skins) ? ps.skins[0].attachments : ps.skins.default;
  const an = Object.keys(skin[LAYER])[0]; const att = skin[LAYER][an]; const file = path.join(IMG, (att.path || an) + '.png');
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, n = w * h;
  const alpha = new Uint8Array(n), lum = new Float32Array(n);
  for (let i = 0; i < n; i++) { alpha[i] = data[4 * i + 3] >= 40 ? 1 : 0; lum[i] = alpha[i] ? (0.3 * data[4 * i] + 0.59 * data[4 * i + 1] + 0.11 * data[4 * i + 2]) : 0; }
  // fill outside with the nearest inside value would be better; a light blur first
  const L = blur(lum, w, h, 1.2);
  const gx = new Float32Array(n), gy = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!alpha[i]) continue; gx[i] = (L[i + 1] - L[i - 1]) / 2; gy[i] = (L[i + w] - L[i - w]) / 2; }
  const Jxx = blur(Float32Array.from(gx, (v) => v * v), w, h, SIGMA), Jyy = blur(Float32Array.from(gy, (v) => v * v), w, h, SIGMA), Jxy = blur(Float32Array.from(gx, (v, i) => v * gy[i]), w, h, SIGMA);
  // stroke direction = perpendicular to the dominant gradient
  const dirX = new Float32Array(n), dirY = new Float32Array(n), coh = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Jxx[i], b = Jyy[i], c = Jxy[i]; const th = 0.5 * Math.atan2(2 * c, a - b); const gxD = Math.cos(th), gyD = Math.sin(th); dirX[i] = -gyD; dirY[i] = gxD; coh[i] = (a + b) > 1e-6 ? Math.sqrt((a - b) * (a - b) + 4 * c * c) / (a + b) : 0; }
  // evenly spaced streamlines (Jobard–Lefer): candidates on a grid, each traced both ways
  // along the stroke direction, stopping outside the mask, near an existing line, or at a
  // sharp turn (a whorl); lines closer than dSep to an earlier one are not started
  const DSEP = Number(arg('dsep', 22)), DTEST = 0.5 * DSEP, GRID = 6
  const at = (arr, x, y) => arr[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))]
  const occ = new Uint8Array(n), occSeed = new Uint8Array(n)   // stop within DTEST of a line; start only DSEP away
  const stampInto = (arr, pts, rad) => { for (const [x, y] of pts) { for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { if (dx * dx + dy * dy > rad * rad) continue; const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx >= 0 && yy >= 0 && xx < w && yy < h) arr[yy * w + xx] = 1 } } }
  const stamp = (pts) => { stampInto(occ, pts, Math.round(DTEST)); stampInto(occSeed, pts, Math.round(DSEP)) }
  const trace = (sx, sy, sign) => {
    let x = sx, y = sy, px = sign * at(dirX, sx, sy), py = sign * at(dirY, sx, sy)
    if (Math.hypot(px, py) < 1e-6) return []
    const pts = []; let turn = 0
    for (let k = 0; k < 500; k++) {
      let dx = at(dirX, x, y), dy = at(dirY, x, y)
      if (dx * px + dy * py < 0) { dx = -dx; dy = -dy }
      if (at(coh, x, y) < 0.03) { dx = px; dy = py }
      const ang = Math.abs(Math.atan2(px * dy - py * dx, px * dx + py * dy))
      if (ang > 0.6) break                       // > 35° in one step: not a strand any more
      turn += ang; if (turn > 2.6) break          // wound round more than 150°: a whorl
      x += dx * STEP; y += dy * STEP; px = dx; py = dy
      if (x < 0 || y < 0 || x >= w || y >= h || !at(alpha, x, y)) break
      if (k > 3 && at(occ, x, y)) break
      pts.push([x, y])
    }
    return pts
  }
  const lines = []
  const cands = []
  for (let y = GRID / 2; y < h; y += GRID) for (let x = GRID / 2; x < w; x += GRID) if (at(alpha, x, y) && at(coh, x, y) > 0.08) cands.push([x, y, at(coh, x, y)])
  cands.sort((a, b) => b[2] - a[2])   // strongest texture first
  for (const [sx, sy] of cands) {
    if (at(occSeed, sx, sy)) continue
    const fwd = trace(sx, sy, 1), back = trace(sx, sy, -1)
    const pts = back.reverse().concat([[sx, sy]], fwd)
    if (pts.length * STEP < 40) continue
    lines.push(pts); stamp(pts)
  }
  const kept = lines
  // world coords for comparison with the artist
  const toW = (px, py) => [att.x + px - w / 2, att.y + h / 2 - py];
  const art = sc.artistBones(JSON.parse(fs.readFileSync(RIG, 'utf8'))).filter((b) => b.deform && b.layer === LAYER);
  // coverage of the artist's bones by the streamlines (τ 15 px, any direction)
  let cov = 0, tot = 0;
  for (const b of art) { const L2 = b.len; let c = 0; for (let s = 0; s < 8; s++) { const u = (s + 0.5) / 8, x = b.ax + u * (b.bx - b.ax), y = b.ay + u * (b.by - b.ay); if (kept.some((ln) => ln.some((p) => { const [wx, wy] = toW(p[0], p[1]); return Math.hypot(wx - x, wy - y) <= 15; }))) c++; } cov += L2 * c / 8; tot += L2; }
  console.log(`${LAYER}: ${cands.length} candidates → ${kept.length} streamlines (dSep ${DSEP}); artist bones ${art.length}; coverage of artist chains by streamlines (τ15) ${(100 * cov / tot).toFixed(1)}%`);
  // render
  const z = 3; let svg = `<svg width="${w * z}" height="${h * z}"><g transform="scale(${z})">`;
  for (const b of art) { const [ax, ay] = [b.ax - att.x + w / 2, att.y + h / 2 - b.ay], [bx, by] = [b.bx - att.x + w / 2, att.y + h / 2 - b.by]; svg += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#7be05a" stroke-width="1.2" stroke-dasharray="3,2"/>`; }
  const pal = ['#ff9040', '#ffd040', '#40c8ff', '#ff60c0', '#a0ff60', '#ff5050', '#c090ff'];
  kept.forEach((ln, i) => { svg += `<polyline points="${ln.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${pal[i % pal.length]}" stroke-width="1.2"/>`; });
  svg += `</g></svg>`;
  const base = await sharp(file).resize({ width: w * z, kernel: 'nearest' }).png().toBuffer();
  await sharp(base).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).png().toFile(path.join(__dirname, 'out', `dbg_hairflow_${LAYER}.png`));
  console.log('wrote out/dbg_hairflow_' + LAYER + '.png');
})();
