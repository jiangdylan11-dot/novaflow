/* Turn a screencast frame dump into an MP4.
 *
 * Screencast frames only arrive when the page repaints, so the real timing
 * lives in frames.json. We replay it through ffmpeg's concat demuxer, shrinking
 * the spans the scenario marked as fast-forward and capping dead air.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DIR = path.resolve(argOf('dir', ''));
const OUT = path.resolve(argOf('out', ''));
const MAX_HOLD = Number(argOf('max-hold', 1.8));
const FF_TARGET = Number(argOf('ff-target', 5));
const FPS = Number(argOf('fps', 30));
const CRF = argOf('crf', '20');
const CLEAN = process.argv.includes('--clean');

const FFMPEG_CANDIDATES = [
  process.env.NOVAFLOW_FFMPEG,
  'C:/ProgramData/NovaFlow/AI-Runtime/engine/python/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe',
  'C:/ProgramData/NovaFlow/AI-Runtime-H3/engine/python/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe',
  'ffmpeg'
].filter(Boolean);

const ffmpeg = FFMPEG_CANDIDATES.find((p) => p === 'ffmpeg' || fs.existsSync(p));
if (!ffmpeg) {
  console.error('[encode] no ffmpeg found');
  process.exit(3);
}

if (!DIR || !OUT) {
  console.error('usage: encode.js --dir=<frames dir> --out=<file.mp4>');
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'frames.json'), 'utf8'));
const frames = manifest.frames || [];
if (frames.length < 2) {
  console.error('[encode] not enough frames');
  process.exit(4);
}

const spans = manifest.ffSpans || [];

/* Raw wall-clock gap each frame held the screen. */
const rawDur = frames.map((cur, i) => {
  const next = frames[i + 1];
  return next ? (next.t - cur.t) / 1000 : 0.55;
});

/* A marked span plays for a fixed number of seconds no matter how long the
   real generation took, so a 12-second run and a 4-minute one look the same. */
const spanPlan = spans.map((s) => {
  let raw = 0;
  frames.forEach((f, i) => {
    if (f.t >= s.from && f.t <= s.to) raw += rawDur[i];
  });
  const target = Math.max(0.5, Number(s.target != null ? s.target : FF_TARGET));
  return { from: s.from, to: s.to, target, raw, factor: Math.max(1, raw / target) };
});
spanPlan.forEach((p) => {
  console.log('[encode] fast-forward', p.raw.toFixed(1) + 's ->', p.target + 's (x' + p.factor.toFixed(1) + ')');
});

const planAt = (t) => {
  for (const p of spanPlan) if (t >= p.from && t <= p.to) return p;
  return null;
};

const lines = ['ffconcat version 1.0'];
let total = 0;
for (let i = 0; i < frames.length; i += 1) {
  const cur = frames[i];
  const plan = planAt(cur.t);
  let d = rawDur[i];
  if (plan) {
    d = Math.min(plan.target, Math.max(1 / 60, d / plan.factor));
  } else {
    d = Math.min(MAX_HOLD, Math.max(1 / 60, d));
  }
  total += d;
  lines.push("file '" + cur.file + "'");
  lines.push('duration ' + d.toFixed(4));
}
// concat demuxer drops the final entry's duration unless the file is repeated
lines.push("file '" + frames[frames.length - 1].file + "'");

const listPath = path.join(DIR, 'concat.txt');
fs.writeFileSync(listPath, lines.join('\n') + '\n');

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const args = [
  '-y',
  '-f', 'concat', '-safe', '0',
  '-i', listPath,
  '-vf', 'fps=' + FPS + ',scale=trunc(iw/2)*2:trunc(ih/2)*2',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', CRF,
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  OUT
];

console.log('[encode]', frames.length, 'frames ->', total.toFixed(1) + 's ->', OUT);
const res = spawnSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], cwd: DIR });
if (res.status !== 0) {
  console.error('[encode] ffmpeg failed');
  console.error(String(res.stderr || '').split('\n').slice(-25).join('\n'));
  process.exit(5);
}

const size = fs.statSync(OUT).size;
console.log('[encode] wrote', OUT, (size / 1048576).toFixed(2) + ' MB');

if (CLEAN) {
  for (const f of fs.readdirSync(DIR)) {
    if (f.endsWith('.jpg')) fs.unlinkSync(path.join(DIR, f));
  }
  console.log('[encode] frames cleaned');
}
