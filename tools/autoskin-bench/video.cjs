// Side-by-side animation video: artist rig | full-auto re-skin | weights-only re-skin |
// silhouette difference of the full-auto rig, at 30 fps over the whole animation,
// looped twice. Also a torso zoom video from the same renders.
//   node video.cjs [rigs=artist,rigB2,rigA] [fps=30] [scale=0.5]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const { execFileSync } = require('child_process');
const R = require('./render.cjs');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
const FFMPEG = REPO + '/particle-editor-desktop/node_modules/ffmpeg-static/ffmpeg.exe';
const OUT = path.join(__dirname, 'out'); const VD = path.join(OUT, 'video'); fs.mkdirSync(VD, { recursive: true });
const rigNames = (process.argv[2] || 'artist,rigB2,rigA').split(',');
const fps = Number(process.argv[3] || 30);
const scale = Number(process.argv[4] || 0.5);
// optional extra crop "x,y,w,h,scale" (canvas px) -> compare_face.mp4
const FACE = process.argv[5] ? process.argv[5].split(',').map(Number) : null;
const LABEL = { artist: '原版（美术手绑）', rigA: '只重算权重（美术网格+美术选骨）', rigB2: '全自动重新蒙皮（网格+选骨+权重）', rigC: '自动网格+美术选骨+自动权重', rigD: '全自动含自动骨架（自动骨架+自动网格+自动权重）' };
const { CW, CH } = R;
const ZOOM = [250, 60, 480, 620];

function svg(w, h, text, sub) {
  const s = 22;
  return Buffer.from(`<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${s + 12}" fill="rgba(0,0,0,0.6)"/><text x="10" y="${s}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="${s - 2}" fill="#fff">${text}</text>${sub ? `<rect x="0" y="${h - 30}" width="${w}" height="30" fill="rgba(0,0,0,0.6)"/><text x="10" y="${h - 9}" font-family="Consolas, monospace" font-size="18" fill="#ffd966">${sub}</text>` : ''}</svg>`);
}
async function panel(rgba8, label, sub, crop, sc) {
  let s = sharp(Buffer.from(rgba8.buffer, rgba8.byteOffset, rgba8.byteLength), { raw: { width: CW, height: CH, channels: 4 } });
  if (crop) s = s.extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] });
  const cw = crop ? crop[2] : CW, ch = crop ? crop[3] : CH;
  const ow = Math.round(cw * sc / 2) * 2, oh = Math.round(ch * sc / 2) * 2;
  if (sc !== 1) s = s.resize({ width: ow, height: oh, kernel: 'lanczos3' });
  const buf = await s.png().toBuffer();
  return { buf: await sharp(buf).composite([{ input: svg(ow, oh, label, sub), top: 0, left: 0 }]).png().toBuffer(), w: ow, h: oh };
}
function diffImage(ref, cur) {
  const out = new Uint8ClampedArray(CW * CH * 4); let inter = 0, uni = 0;
  for (let i = 0; i < CW * CH; i++) {
    const a = ref[4 * i + 3] > 0.5, b = cur[4 * i + 3] > 0.5; const o = 4 * i;
    if (a && b) { inter++; uni++; const l = 0.3 * ref[o] + 0.59 * ref[o + 1] + 0.11 * ref[o + 2]; out[o] = out[o + 1] = out[o + 2] = 60 + l * 0.5; }
    else if (a) { uni++; out[o] = 255; out[o + 1] = 40; out[o + 2] = 40; }
    else if (b) { uni++; out[o] = 40; out[o + 1] = 220; out[o + 2] = 255; }
    else { out[o] = 30; out[o + 1] = 30; out[o + 2] = 34; }
    out[o + 3] = 255;
  }
  return { img: out, iou: inter / uni };
}
async function row(panels, file) {
  const W = panels.reduce((a, p) => a + p.w, 0), Hh = Math.max(...panels.map((p) => p.h));
  let x = 0; const comp = panels.map((p) => { const c = { input: p.buf, left: x, top: 0 }; x += p.w; return c; });
  await sharp({ create: { width: W, height: Hh, channels: 4, background: { r: 24, g: 24, b: 28, alpha: 1 } } }).composite(comp).png().toFile(file);
}
(async () => {
  const images = await R.loadImages();
  const rigs = {}; for (const n of rigNames) rigs[n] = R.loadRig(path.join(OUT, n + '.json'));
  const duration = rigs[rigNames[0]].data.animations[0].duration;
  const nFrames = Math.round(duration * fps) + 1;
  const ious = [];
  for (const f of fs.readdirSync(VD)) if (f.endsWith('.png')) fs.unlinkSync(path.join(VD, f));
  const t0 = Date.now();
  for (let k = 0; k < nFrames; k++) {
    const t = Math.min(duration, k / fps);
    const canvases = {}; for (const n of rigNames) canvases[n] = R.renderFrame(rigs[n], images, t).canvas;
    const ref = canvases[rigNames[0]];
    const { img: diff, iou } = diffImage(ref, canvases[rigNames[1]]);
    ious.push(iou);
    const tag = `t=${t.toFixed(2)}s`;
    const full = [], zoom = [], face = [];
    for (const n of rigNames) {
      const rgba = R.toRGBA8(canvases[n], [40, 40, 44]);
      full.push(await panel(rgba, LABEL[n] || n, tag, null, scale));
      zoom.push(await panel(rgba, LABEL[n] || n, tag, ZOOM, 1));
      if (FACE) face.push(await panel(rgba, LABEL[n] || n, tag, FACE.slice(0, 4), FACE[4]));
    }
    full.push(await panel(diff, `${LABEL[rigNames[1]] || rigNames[1]} 差异  红=缺失 青=多出`, `轮廓 IoU ${iou.toFixed(3)}`, null, scale));
    zoom.push(await panel(diff, '差异  红=缺失 青=多出', `轮廓 IoU ${iou.toFixed(3)}`, ZOOM, 1));
    await row(full, path.join(VD, `f_${String(k).padStart(3, '0')}.png`));
    await row(zoom, path.join(VD, `z_${String(k).padStart(3, '0')}.png`));
    if (FACE) await row(face, path.join(VD, `c_${String(k).padStart(3, '0')}.png`));
    if (k % 10 === 0) console.log(`frame ${k}/${nFrames - 1} ${tag} iou ${iou.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  const outputs = [['f_%03d.png', 'compare_full.mp4'], ['z_%03d.png', 'compare_zoom.mp4']];
  if (FACE) outputs.push(['c_%03d.png', 'compare_face.mp4']);
  for (const [pat, name] of outputs) {
    const file = path.join(OUT, name);
    execFileSync(FFMPEG, ['-y', '-stream_loop', '1', '-framerate', String(fps), '-i', path.join(VD, pat), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', file], { stdio: 'ignore' });
    console.log('wrote', file, (fs.statSync(file).size / 1048576).toFixed(1) + 'MB');
  }
  const mean = ious.reduce((a, b) => a + b, 0) / ious.length;
  console.log(`per-frame IoU of ${rigNames[1]} vs ${rigNames[0]}: mean ${mean.toFixed(4)} min ${Math.min(...ious).toFixed(4)} at frame ${ious.indexOf(Math.min(...ious))}`);
  fs.writeFileSync(path.join(OUT, 'video_ious.json'), JSON.stringify({ fps, ious }));
})().catch((e) => { console.error(e); process.exit(1); });
