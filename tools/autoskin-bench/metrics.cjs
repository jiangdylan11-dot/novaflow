// Render every rig over the animation and compare silhouettes with the artist rig.
//   node metrics.cjs [rigs=artist,artist_nodeform,rigA,rigB,rigC] [step=0.1] [--frames]
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const path = require('path');
const R = require('./render.cjs');
const OUT = path.join(__dirname, 'out'); const FR = path.join(OUT, 'frames'); fs.mkdirSync(FR, { recursive: true });
const names = (process.argv[2] || 'artist,artist_nodeform,rigA,rigB,rigC').split(',');
const step = Number(process.argv[3] || 0.1);
const saveFrames = process.argv.includes('--frames');
(async () => {
  const images = await R.loadImages();
  const times = []; for (let t = 0; t <= 2.0001; t += step) times.push(+t.toFixed(2));
  const rigs = {}; for (const n of names) rigs[n] = R.loadRig(path.join(OUT, n + '.json'));
  const res = {}; for (const n of names) res[n] = { inter: 0, uni: 0, perFrame: [], layers: {} };
  const N = R.CW * R.CH;
  const refName = names.includes('artist') ? 'artist' : names[0];
  for (const t of times) {
    const t0 = Date.now();
    const frames = {};
    for (const n of names) frames[n] = R.renderFrame(rigs[n], images, t, { perLayer: true });
    const refA = frames[refName].canvas, refL = frames[refName].layers;
    for (const n of names) {
      const fr = frames[n]; let inter = 0, uni = 0;
      for (let i = 0; i < N; i++) { const a = refA[4 * i + 3] > 0.5, b = fr.canvas[4 * i + 3] > 0.5; if (a && b) inter++; if (a || b) uni++; }
      res[n].inter += inter; res[n].uni += uni; res[n].perFrame.push(+(inter / uni).toFixed(4));
      for (const [ln, L] of fr.layers) {
        const rl = refL.get(ln); if (!rl) continue; let li = 0, lu = 0;
        for (let i = 0; i < N; i++) { const a = rl.alpha[i] > 0.5, b = L.alpha[i] > 0.5; if (a && b) li++; if (a || b) lu++; }
        const r = res[n].layers[ln] || (res[n].layers[ln] = { inter: 0, uni: 0 }); r.inter += li; r.uni += lu;
      }
      if (saveFrames) await R.savePng(R.toRGBA8(fr.canvas, [40, 40, 44]), path.join(FR, `${n}_t${t.toFixed(2)}.png`));
    }
    console.log(`t=${t.toFixed(2)} ` + names.map((n) => `${n}=${res[n].perFrame[res[n].perFrame.length - 1].toFixed(4)}`).join(' ') + ` ${Date.now() - t0}ms`);
  }
  console.log(`\nSILHOUETTE IoU vs ${refName} (whole 2s animation):`);
  for (const n of names) console.log(`  ${n.padEnd(16)} ${(res[n].inter / res[n].uni).toFixed(4)}  min frame ${Math.min(...res[n].perFrame).toFixed(4)}`);
  console.log('\nper-layer IoU:');
  const layerNames = Object.keys(res[names[0]].layers);
  console.log('  ' + 'layer'.padEnd(11) + names.map((n) => n.padStart(16)).join(''));
  for (const ln of layerNames) console.log('  ' + ln.padEnd(11) + names.map((n) => { const r = res[n].layers[ln]; return (r ? (r.inter / r.uni).toFixed(4) : '-').padStart(16); }).join(''));
  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify({ times, res }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
