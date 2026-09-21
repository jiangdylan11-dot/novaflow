// Times at which the face controllers move most relative to the head (blinks,
// mouth shapes) — the frames to judge face weights on. Prints a comma list.
//   node blink-times.cjs [count=3] [pattern=eyes|mouth]
const fs = require('fs'); const path = require('path');
const H = require('./spine-headless.cjs');
const OUT = path.join(__dirname, 'out');
const count = Number(process.argv[2] || 3); const pat = new RegExp(process.argv[3] || 'eyes|mouth');
const json = JSON.parse(fs.readFileSync(path.join(OUT, 'artist.json'), 'utf8'));
const { data, skeleton } = H.loadSkeleton(json);
const names = json.bones.filter((b) => pat.test(b.name) && !(b.length > 0)).map((b) => b.name);
const head = skeleton.findBone('head');
skeleton.setToSetupPose(); skeleton.updateWorldTransform();
const rel = () => names.map((n) => { const b = skeleton.findBone(n); return [b.worldX - head.worldX, b.worldY - head.worldY]; });
const rest = rel();
const dur = data.animations[0].duration; const rows = [];
for (let t = 0; t <= dur + 1e-6; t += 1 / 30) {
  H.poseAt(data, skeleton, data.animations[0].name, t);
  const cur = rel(); let s = 0, mx = 0, who = '';
  cur.forEach((p, i) => { const d = Math.hypot(p[0] - rest[i][0], p[1] - rest[i][1]); s += d; if (d > mx) { mx = d; who = names[i]; } });
  rows.push({ t: +t.toFixed(3), sum: s, mx, who });
}
rows.sort((a, b) => b.sum - a.sum);
const picked = []; for (const r of rows) { if (picked.every((p) => Math.abs(p.t - r.t) > 0.25)) picked.push(r); if (picked.length >= count) break; }
picked.sort((a, b) => a.t - b.t);
console.error(picked.map((r) => `t=${r.t}s total ${r.sum.toFixed(0)}px, most ${r.who} ${r.mx.toFixed(1)}px`).join(' | '));
console.log(picked.map((r) => r.t).join(','));
