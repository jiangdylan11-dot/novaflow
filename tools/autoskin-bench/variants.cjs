// Run several assignment option sets end to end (build -> silhouette IoU of the
// full-auto rig against the artist) and tabulate them.
//   node variants.cjs [json array of assign option sets] [step=0.2]
const { execFileSync } = require('child_process'); const path = require('path');
const variants = process.argv[2] ? JSON.parse(process.argv[2]) : [
  { name: 'base', assign: {} },
  { name: 'noFullFirst', assign: { fullFirst: false } },
  { name: 'minFrac0.75', assign: { minFrac: 0.75 } },
  { name: 'cover0.5', assign: { cover: 0.5 } },
  { name: 'cover1', assign: { cover: 1.0 } },
  { name: 'cover0.5+minFrac0.75', assign: { cover: 0.5, minFrac: 0.75 } }
];
const step = process.argv[3] || '0.2';
const run = (args) => execFileSync(process.execPath, args, { cwd: __dirname, encoding: 'utf8', maxBuffer: 1 << 26 });
const rows = [];
for (const v of variants) {
  const t0 = Date.now();
  const build = run(['build-rig.cjs', '22', JSON.stringify(Object.assign({ assign: v.assign || {}, weights: v.weights || {} }, v.extra || {}))]);
  const sel = (build.match(/B2: (P [\d.]+ R [\d.]+)/) || [])[1] || '?';
  const met = run(['metrics.cjs', 'artist,rigB2', step]);
  const iou = (met.match(/rigB2\s+([\d.]+)\s+min frame ([\d.]+)/) || []);
  const per = {};
  for (const m of met.matchAll(/^\s{2}(\S+)\s+([\d.]+)\s+([\d.]+)$/gm)) per[m[1]] = +m[3];
  const worst = Object.entries(per).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([k, x]) => `${k} ${x.toFixed(3)}`).join('  ');
  rows.push({ name: v.name, sel, iou: iou[1], min: iou[2], worst, per, secs: ((Date.now() - t0) / 1000).toFixed(0) });
  console.log(`${v.name.padEnd(24)} IoU ${iou[1]} (min ${iou[2]})  selection ${sel}  worst layers: ${worst}  [${rows[rows.length - 1].secs}s]`);
}
console.log('\nname                     IoU     min     selection');
for (const r of rows) console.log(`${r.name.padEnd(24)} ${r.iou}  ${r.min}  ${r.sel}`);
// per-layer matrix for layers where any variant differs from the first by > 0.005
const layers = Object.keys(rows[0].per);
const differing = layers.filter((l) => rows.some((r) => Math.abs((r.per[l] || 0) - rows[0].per[l]) > 0.005));
console.log('\nlayer       ' + rows.map((r) => r.name.slice(0, 12).padStart(13)).join(''));
for (const l of differing) console.log(l.padEnd(12) + rows.map((r) => (r.per[l] === undefined ? '-' : r.per[l].toFixed(3)).padStart(13)).join(''));
