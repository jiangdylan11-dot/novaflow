// Debug view of one layer's medial-axis analysis: mask (grey), skeleton pixels (blue),
// pruned graph (yellow edges, white nodes), trunk path (red).
//   node layer-axis.cjs <layer.png> <out.png> [zoom=2] [opts-json]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const sharp = require(REPO + '/particle-editor-desktop/node_modules/sharp');
require(REPO + '/particle-editor/spine-auto-mesh-core.js');
require(REPO + '/particle-editor/spine-auto-bones.js');
const AB = globalThis.NovaFlowAutoBones;
const [file, out, zoomArg, optsArg] = process.argv.slice(2);
const zoom = Number(zoomArg || 2);
const opts = optsArg ? JSON.parse(optsArg) : {};
(async () => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const t0 = Date.now();
  const a = AB.analyzeLayer(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, opts);
  console.log(`analysis ${Date.now() - t0} ms: scale ${a.scale.toFixed(3)} work ${a.ws}x${a.hs} nodes ${a.graph.nodes.length} edges ${a.graph.edges.length} comps ${a.components}`);
  const tp = AB._internals.trunkPath(a.graph);
  const W = a.ws * zoom, H = a.hs * zoom;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = ((y / zoom) | 0) * a.ws + ((x / zoom) | 0);
    const o = 4 * (y * W + x);
    const m = a.mask[i], s = a.skeleton[i];
    rgba[o] = m ? (s ? 60 : 90) : 20; rgba[o + 1] = m ? (s ? 120 : 90) : 20; rgba[o + 2] = m ? (s ? 255 : 100) : 24; rgba[o + 3] = 255;
  }
  const px = (v) => (v * a.scale + 1) * zoom;   // image px → padded work px → canvas
  const line = (ax, ay, bx, by, c, w) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1; for (let s = 0; s <= n; s++) { const x = Math.round(ax + (bx - ax) * s / n), y = Math.round(ay + (by - ay) * s / n); for (let dy = -w; dy <= w; dy++) for (let dx = -w; dx <= w; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const o = 4 * (yy * W + xx); rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; } } };
  const trunkSet = new Set(tp ? tp.edges : []);
  a.graph.edges.forEach((e, i) => { const p = e.poly; for (let k = 2; k < p.length; k += 2) line(px(p[k - 2]), px(p[k - 1]), px(p[k]), px(p[k + 1]), trunkSet.has(i) ? [255, 60, 60] : [255, 220, 60], 1); });
  a.graph.nodes.forEach((n, i) => { if (!n.deg) return; const x = px(n.x), y = px(n.y); line(x - 4, y, x + 4, y, [255, 255, 255], 1); line(x, y - 4, x, y + 4, [255, 255, 255], 1); console.log(`  node ${i} deg ${n.deg} at img (${n.x.toFixed(0)},${n.y.toFixed(0)}) r ${n.r.toFixed(1)}`); });
  a.graph.edges.forEach((e, i) => console.log(`  edge ${i}: ${e.a}->${e.b} len ${e.len.toFixed(0)} rMean ${e.rMean.toFixed(1)} rMin ${e.rMin.toFixed(1)} pts ${e.poly.length / 2}${trunkSet.has(i) ? ' TRUNK' : ''}`));
  await sharp(Buffer.from(rgba.buffer), { raw: { width: W, height: H, channels: 4 } }).png().toFile(out);
  console.log('wrote', out, W, H);
})();
