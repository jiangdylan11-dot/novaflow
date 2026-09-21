// One layer, drawn alone: artist vs the rigs, with a silhouette difference map, at a
// few times, cropped to the layer. Finds where a single layer loses IoU.
//   node layer-diff.cjs <layer> [rigs=rigA,rigC,rigB2] [times=0.6,1.0,1.4] [--mesh]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const R = require('./render.cjs');
const H = require('./spine-headless.cjs'); const spine = H.spine;
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const OUT = path.join(__dirname, 'out');
const layer = process.argv[2];
const rigNames = (process.argv[3] || 'rigA,rigC,rigB2').split(',');
const times = (process.argv[4] || '0.6,1.0,1.4').split(',').map(Number);
const showMesh = process.argv.includes('--mesh');
const LABEL = { artist: '原版', rigA: 'A 美术网格+自动权重', rigB2: 'B2 全自动', rigC: 'C 自动网格+美术选骨' };
const { CW, CH } = R;
(async () => {
  const images = await R.loadImages();
  const rigs = { artist: R.loadRig(path.join(OUT, 'artist.json')) };
  for (const n of rigNames) rigs[n] = R.loadRig(path.join(OUT, n + '.json'));
  const only = new Set([layer]);
  const panels = []; let crop = null; let pw = 0, ph = 0;
  const report = [];
  for (const t of times) {
    const ref = R.renderFrame(rigs.artist, images, t, { only });
    const refA = new Float32Array(CW * CH); for (let i = 0; i < CW * CH; i++) refA[i] = ref.canvas[4 * i + 3];
    if (!crop) {
      let minX = CW, minY = CH, maxX = 0, maxY = 0;
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (refA[y * CW + x] > 0.5) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const m = 40; crop = [Math.max(0, minX - m), Math.max(0, minY - m), Math.min(CW, maxX + m) - Math.max(0, minX - m), Math.min(CH, maxY + m) - Math.max(0, minY - m)];
      const sc = Math.min(1, 700 / crop[3], 500 / crop[2]); pw = Math.round(crop[2] * sc); ph = Math.round(crop[3] * sc);
    }
    const row = [];
    const mk = async (rgba8, label) => { let s = sharp(Buffer.from(rgba8.buffer, rgba8.byteOffset, rgba8.byteLength), { raw: { width: CW, height: CH, channels: 4 } }).extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] }).resize({ width: pw, height: ph, kernel: 'lanczos3' }); const buf = await s.png().toBuffer(); const svg = Buffer.from(`<svg width="${pw}" height="${ph}"><rect x="0" y="0" width="${pw}" height="26" fill="rgba(0,0,0,0.6)"/><text x="6" y="19" font-family="Microsoft YaHei, sans-serif" font-size="15" fill="#fff">${label}</text></svg>`); return { buf: await sharp(buf).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer() }; };
    const drawMeshOn = (rgba, rig) => { const sk = rig.skeleton; for (const slot of sk.drawOrder) { const a = slot.getAttachment(); if (!(a instanceof spine.MeshAttachment) || slot.data.name !== layer) continue; const n = a.worldVerticesLength; const w = new Float32Array(n); a.computeWorldVertices(slot, 0, n, w, 0, 2); for (let k = 0; k < a.triangles.length; k += 3) for (let e = 0; e < 3; e++) { const i = a.triangles[k + e], j = a.triangles[k + (e + 1) % 3]; R.drawLine(rgba, w[2 * i] - R.X0, R.Y1 - w[2 * i + 1], w[2 * j] - R.X0, R.Y1 - w[2 * j + 1], 0, 230, 140, 1); } } };
    const refImg = R.toRGBA8(ref.canvas, [40, 40, 44]); if (showMesh) drawMeshOn(refImg, rigs.artist);
    row.push(await mk(refImg, `${LABEL.artist}  t=${t}s`));
    for (const n of rigNames) {
      const fr = R.renderFrame(rigs[n], images, t, { only });
      const img = R.toRGBA8(fr.canvas, [40, 40, 44]); if (showMesh) drawMeshOn(img, rigs[n]);
      let inter = 0, uni = 0, missing = 0, extraPx = 0;
      const diff = new Uint8ClampedArray(CW * CH * 4);
      for (let i = 0; i < CW * CH; i++) { const a = refA[i] > 0.5, b = fr.canvas[4 * i + 3] > 0.5; const o = 4 * i; if (a && b) { inter++; uni++; const l = 0.3 * refImg[o] + 0.59 * refImg[o + 1] + 0.11 * refImg[o + 2]; diff[o] = diff[o + 1] = diff[o + 2] = 60 + l * 0.5; } else if (a) { uni++; missing++; diff[o] = 255; diff[o + 1] = 40; diff[o + 2] = 40; } else if (b) { uni++; extraPx++; diff[o] = 40; diff[o + 1] = 220; diff[o + 2] = 255; } else { diff[o] = 30; diff[o + 1] = 30; diff[o + 2] = 34; } diff[o + 3] = 255; }
      report.push(`${n} t=${t}: IoU ${(inter / uni).toFixed(4)} missing ${missing}px extra ${extraPx}px`);
      row.push(await mk(img, `${LABEL[n] || n}`));
      row.push(await mk(diff, `差异 IoU ${(inter / uni).toFixed(3)}`));
    }
    panels.push(row);
  }
  const W = panels[0].length * (pw + 6), Hh = panels.length * (ph + 6);
  const comp = []; panels.forEach((row, r) => row.forEach((p, c) => comp.push({ input: p.buf, left: c * (pw + 6), top: r * (ph + 6) })));
  const file = path.join(OUT, `fig_layer_${layer}.png`);
  await sharp({ create: { width: W, height: Hh, channels: 4, background: { r: 24, g: 24, b: 28, alpha: 1 } } }).composite(comp).png().toFile(file);
  console.log(report.join('\n')); console.log('wrote', file, `${W}x${Hh}`);
})().catch((e) => { console.error(e); process.exit(1); });
