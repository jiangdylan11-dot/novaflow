import type { ParticleSystemConfig, Key1D, ParticleSprite } from '../types';

type Curve = 'stepped' | number[];

type TimelineFrame = {
  time: number;
  x?: number;
  y?: number;
  angle?: number;
  color?: string;
  curve?: Curve;
  _inj?: string;
};

type ParticleSample = {
  translate: TimelineFrame[];
  scale: TimelineFrame[];
  rotate: TimelineFrame[];
  color: TimelineFrame[];
  startDelay: number;
  life: number;
  lifeUsed: number;
  baseAttachment: string;
  blendMode: 'normal' | 'additive' | 'multiply' | 'screen';
};

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const SIM_DT = 1 / 120;
const EXPORT_DT = 1 / 60;
const DEFAULT_DURATION = 2;
const ATTACHMENT_BASE_SIZE = 100;
const VISIBILITY_ALPHA_HIDDEN_MAX = 10;

function wrapTimeIntoDuration(t: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 1e-6) return t;
  if (Math.abs(t - duration) <= 1e-6) return duration;
  let out = t % duration;
  if (out < 0) out += duration;
  return out;
}

function wrapAndDedupeTimelineGroup(
  timelines: { translate: TimelineFrame[]; scale: TimelineFrame[]; rotate: TimelineFrame[]; color: TimelineFrame[] },
  duration: number,
  quantStep: number
) {
  if (!Number.isFinite(duration) || duration <= 1e-6) return timelines;
  const step = Math.max(1e-6, quantStep);
  const q = (t: number) => {
    if (Math.abs(t - duration) <= 1e-6) return duration;
    const tt = Math.max(0, Math.min(duration, t));
    const qq = Math.round(tt / step) * step;
    if (Math.abs(qq - duration) <= 1e-6) return duration;
    return Math.max(0, Math.min(duration, qq));
  };

  const cycDist = (rt: number, t: number) => {
    const d0 = Math.abs(rt - t);
    const d1 = Math.abs(rt - (t - duration));
    const d2 = Math.abs(rt - (t + duration));
    return Math.min(d0, d1, d2);
  };

  type AnyFrame = TimelineFrame & { _rt?: number };
  const all = ([] as AnyFrame[])
    .concat(timelines.translate as any, timelines.scale as any, timelines.rotate as any, timelines.color as any);

  const alpha255 = (c?: string) => {
    const s = String(c || '').trim();
    if (/^[0-9a-fA-F]{8}$/.test(s)) return parseInt(s.slice(6, 8), 16);
    return 255;
  };
  const colorPriority = (f: AnyFrame) => {
    const a = alpha255((f as any).color);
    if (a <= 0) return 2;
    if (a <= VISIBILITY_ALPHA_HIDDEN_MAX) return 1;
    return 0;
  };
  const scalePriority = (f: AnyFrame) => {
    const x = Number((f as any).x ?? 1);
    const y = Number((f as any).y ?? 1);
    const zero = Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 1e-9 && Math.abs(y) <= 1e-9;
    return zero ? 1 : 0;
  };

  const repRtByT = new Map<number, number>();
  for (const f of all) {
    const rawT = Number((f as any)._rt);
    if (!Number.isFinite(rawT)) continue;
    const wrapped = q(wrapTimeIntoDuration(Number(f.time), duration));
    const prevRt = repRtByT.get(wrapped);
    if (!Number.isFinite(prevRt)) {
      repRtByT.set(wrapped, rawT);
      continue;
    }
    const sn = cycDist(rawT, wrapped);
    const sp = cycDist(prevRt!, wrapped);
    if (Math.abs(sn - sp) <= 1e-9) {
      repRtByT.set(wrapped, Math.abs(rawT) < Math.abs(prevRt!) ? rawT : prevRt!);
    } else {
      repRtByT.set(wrapped, sn < sp ? rawT : prevRt!);
    }
  }

  const pickFor = (frames: TimelineFrame[], kind: 'translate' | 'scale' | 'rotate' | 'color') => {
    const buckets = new Map<number, AnyFrame[]>();
    for (const f of frames as any as AnyFrame[]) {
      const wrapped = q(wrapTimeIntoDuration(Number(f.time), duration));
      const list = buckets.get(wrapped);
      if (list) list.push(f);
      else buckets.set(wrapped, [f]);
    }
    const out: TimelineFrame[] = [];
    for (const [t, list] of buckets.entries()) {
      const repRt = repRtByT.get(t);
      if (!Number.isFinite(repRt as any)) {
        const last = list[list.length - 1]!;
        out.push({ ...last, time: t, curve: (last as any).curve } as any);
        continue;
      }
      let best = list[0]!;
      let bestScore = Number.POSITIVE_INFINITY;
      let bestAbs = Number.POSITIVE_INFINITY;
      let bestStepped = 0;
      let bestPri = 0;
      for (const cand of list) {
        const rt = Number((cand as any)._rt);
        const score = Number.isFinite(rt) ? cycDist(rt, repRt!) : Number.POSITIVE_INFINITY;
        const absRt = Number.isFinite(rt) ? Math.abs(rt) : Number.POSITIVE_INFINITY;
        const stepped = (cand as any).curve === 'stepped' ? 1 : 0;
        const pri = kind === 'color' ? colorPriority(cand) : kind === 'scale' ? scalePriority(cand) : 0;
        if (pri !== bestPri) {
          if (pri > bestPri) {
            best = cand;
            bestScore = score;
            bestAbs = absRt;
            bestStepped = stepped;
            bestPri = pri;
          }
          continue;
        }
        if (score < bestScore - 1e-9) {
          best = cand;
          bestScore = score;
          bestAbs = absRt;
          bestStepped = stepped;
          continue;
        }
        if (Math.abs(score - bestScore) <= 1e-9) {
          if (stepped !== bestStepped) {
            if (stepped > bestStepped) {
              best = cand;
              bestAbs = absRt;
              bestStepped = stepped;
            }
            continue;
          }
          if (absRt < bestAbs - 1e-9) {
            best = cand;
            bestAbs = absRt;
          }
        }
      }
      const cleaned = { ...best, time: t } as any;
      delete cleaned._rt;
      out.push(cleaned);
    }
    return out.sort((a, b) => a.time - b.time);
  };

  return {
    translate: pickFor(timelines.translate, 'translate'),
    scale: pickFor(timelines.scale, 'scale'),
    rotate: pickFor(timelines.rotate, 'rotate'),
    color: pickFor(timelines.color, 'color'),
  };
}

function makeSequenceFrameAttachmentName(sprite: ParticleSprite, frameIndex: number) {
  const base = (sprite.name || 'particle').trim() || 'particle';
  const idRaw = (sprite.id || '').trim();
  const id = idRaw ? idRaw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) : 'sp';
  const idx = String(Math.max(0, frameIndex)).padStart(4, '0');
  return `${base}_${id}_${idx}`;
}

function makeSequenceAttachmentName(sprite: ParticleSprite) {
  const base = (sprite.name || 'particle').trim() || 'particle';
  const idRaw = (sprite.id || '').trim();
  const id = idRaw ? idRaw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) : 'sp';
  return `${base}_${id}_seq`;
}

function makeSequenceBasePath(sprite: ParticleSprite) {
  const base = (sprite.name || 'particle').trim() || 'particle';
  const idRaw = (sprite.id || '').trim();
  const id = idRaw ? idRaw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) : 'sp';
  return `${base}_${id}_`;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function sampleCurve(points: Key1D[] | undefined, t: number, start: number, end: number) {
  if (!points || points.length === 0) {
    return lerp(start, end, clamp01(t));
  }
  const sorted = [...points].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0].v;
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (t >= cur.t && t <= next.t) {
      const ratio = (t - cur.t) / Math.max(1e-6, next.t - cur.t);
      return lerp(cur.v, next.v, ratio);
    }
  }
  return sorted[sorted.length - 1].v;
}

function hexToRgb(hex: string) {
  const normalized = (hex || '').replace('#', '').trim();
  if (normalized.length !== 6) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function toHex2(n: number) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

function lerpHex(a: string, b: string, t: number) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(lerp(A.r, B.r, t), lerp(A.g, B.g, t), lerp(A.b, B.b, t));
}

function normalizeColorStops(stops: any, fallback: string) {
  const base = (Array.isArray(stops) ? stops : [])
    .map((s) => ({ t: clamp01(Number((s as any)?.t ?? 0)), color: String((s as any)?.color || fallback) }))
    .sort((a, b) => a.t - b.t);
  const first = base.find((s) => s.t <= 0 + 1e-6) || { t: 0, color: fallback };
  const last = base.find((s) => s.t >= 1 - 1e-6) || { t: 1, color: fallback };
  const mids = base.filter((s) => s.t > 1e-6 && s.t < 1 - 1e-6);
  return [{ t: 0, color: first.color }, ...mids, { t: 1, color: last.color }];
}

function sampleColorStops(stops: { t: number; color: string }[], t: number) {
  const s = normalizeColorStops(stops, '#ffffff');
  const x = clamp01(t);
  let prev = s[0];
  for (let i = 1; i < s.length; i++) {
    const next = s[i];
    if (x <= next.t + 1e-9) {
      const span = Math.max(1e-9, next.t - prev.t);
      const lt = clamp01((x - prev.t) / span);
      return lerpHex(prev.color, next.color, lt);
    }
    prev = next;
  }
  return s[s.length - 1].color;
}

function getSpriteTintColor(sprite: any, lifeT: number) {
  if (!sprite) return null;
  const mode = sprite.colorMode || 'fixed';
  const fallback = String(sprite.color || '#ffffff');
  if (mode !== 'lifecycle') return fallback;
  const stops = normalizeColorStops(sprite.colorStops, fallback);
  const q = Math.round(clamp01(lifeT) * 32) / 32;
  return sampleColorStops(stops, q);
}

function rgbWithAlpha(rgbHex: string, alpha: number) {
  const { r, g, b } = hexToRgb(rgbHex);
  let a255 = Math.round(clamp01(alpha) * 255);
  if (a255 <= VISIBILITY_ALPHA_HIDDEN_MAX) a255 = 0;
  else if (a255 >= 255 - VISIBILITY_ALPHA_HIDDEN_MAX) a255 = 255;
  const a = a255.toString(16).padStart(2, '0');
  return `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${a}`;
}

function resolveBaseColor(sprite?: ParticleSprite) {
  const c = getSpriteTintColor(sprite as any, 0);
  return c || '#ffffff';
}

function resolveBlendMode(system: ParticleSystemConfig, sprite?: ParticleSprite): ParticleSample['blendMode'] {
  const raw = (sprite?.blendMode || system.blendMode || 'normal') as ParticleSample['blendMode'] | 'add';
  if (raw === 'add') return 'additive';
  if (raw === 'additive') return 'additive';
  if (raw === 'multiply') return 'multiply';
  if (raw === 'screen') return 'screen';
  return 'normal';
}


function simplifyFrames2D(frames: TimelineFrame[], epsilon: number, maxPoints: number) {
  if (frames.length <= 2) return frames;
  const keep = new Set<number>([0, frames.length - 1]);
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].curve !== undefined) keep.add(i);
  }

  const errorAt = (i: number, a: number, b: number) => {
    const fa = frames[a];
    const fb = frames[b];
    const fi = frames[i];
    const ta = fa.time;
    const tb = fb.time;
    const ti = fi.time;
    const denom = Math.max(1e-6, tb - ta);
    const t = (ti - ta) / denom;
    const px = lerp(fa.x ?? 0, fb.x ?? 0, t);
    const py = lerp(fa.y ?? 0, fb.y ?? 0, t);
    const dx = (fi.x ?? 0) - px;
    const dy = (fi.y ?? 0) - py;
    return Math.hypot(dx, dy);
  };

  const recurse = (a: number, b: number) => {
    if (keep.size >= maxPoints) return;
    let maxErr = 0;
    let maxIdx = -1;
    for (let i = a + 1; i < b; i++) {
      const err = errorAt(i, a, b);
      if (err > maxErr) {
        maxErr = err;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxErr > epsilon && keep.size < maxPoints) {
      keep.add(maxIdx);
      recurse(a, maxIdx);
      recurse(maxIdx, b);
    }
  };

  recurse(0, frames.length - 1);
  return Array.from(keep).sort((a, b) => a - b).map((i) => frames[i]);
}

function pruneRedundantFrames(frames: TimelineFrame[], kind: 'translate' | 'scale' | 'rotate' | 'color') {
  if (frames.length <= 2) return frames;
  const same = (a: TimelineFrame, b: TimelineFrame) => {
    if (kind === 'rotate') return Math.abs((a.angle ?? 0) - (b.angle ?? 0)) <= 1e-9;
    if (kind === 'color') return String(a.color ?? '') === String(b.color ?? '');
    return Math.abs((a.x ?? 0) - (b.x ?? 0)) <= 1e-9 && Math.abs((a.y ?? 0) - (b.y ?? 0)) <= 1e-9;
  };
  const out: TimelineFrame[] = [frames[0]];
  for (let i = 1; i < frames.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = frames[i];
    const next = frames[i + 1];
    if (same(prev, cur) && same(cur, next) && cur.curve === undefined) continue;
    out.push(cur);
  }
  out.push(frames[frames.length - 1]);
  return out;
}

function stripTrivialConstTail(frames: TimelineFrame[], kind: 'translate' | 'scale' | 'rotate' | 'color') {
  if (!Array.isArray(frames) || frames.length !== 2) return frames;
  const a = frames[0];
  const b = frames[1];
  if (!a || !b) return frames;
  if (a.curve !== undefined) return frames;
  if (b.curve !== undefined) return frames;
  if (a.time > 1e-9) return frames;
  const same = () => {
    if (kind === 'rotate') return Math.abs((a.angle ?? 0) - (b.angle ?? 0)) <= 1e-9;
    if (kind === 'color') return String(a.color ?? '') === String(b.color ?? '');
    return Math.abs((a.x ?? 0) - (b.x ?? 0)) <= 1e-9 && Math.abs((a.y ?? 0) - (b.y ?? 0)) <= 1e-9;
  };
  if (!same()) return frames;
  if (!(b.time > a.time + 1e-9)) return frames;
  return [a];
}

function stripRedundantLastKey(frames: TimelineFrame[], kind: 'translate' | 'scale' | 'rotate' | 'color') {
  if (!Array.isArray(frames) || frames.length <= 1) return frames;
  const last = frames[frames.length - 1];
  const prev = frames[frames.length - 2];
  if (!last || !prev) return frames;
  if (last.curve !== undefined) return frames;
  const same = () => {
    if (kind === 'rotate') return Math.abs((last.angle ?? 0) - (prev.angle ?? 0)) <= 1e-9;
    if (kind === 'color') return String(last.color ?? '').toLowerCase() === String(prev.color ?? '').toLowerCase();
    return Math.abs((last.x ?? 0) - (prev.x ?? 0)) <= 1e-9 && Math.abs((last.y ?? 0) - (prev.y ?? 0)) <= 1e-9;
  };
  if (!same()) return frames;
  if (!(last.time > prev.time + 1e-9)) return frames;
  return frames.slice(0, -1);
}

function quantizeNumber(v: number, step: number) {
  if (!Number.isFinite(v)) return v;
  const s = Math.max(1e-12, step);
  const q = Math.round(v / s) * s;
  const d = Math.min(8, Math.max(0, Math.ceil(-Math.log10(s))) + 1);
  return Number(q.toFixed(d));
}

function quantizeFrames(
  frames: TimelineFrame[],
  opts: { kind: 'translate' | 'scale' | 'rotate' | 'color' }
) {
  if (!Array.isArray(frames) || frames.length === 0) return frames;
  const out: TimelineFrame[] = [];
  for (const f of frames) {
    if (!f) continue;
    if (opts.kind === 'rotate') {
      out.push({
        ...f,
        angle: quantizeNumber(Number(f.angle ?? 0), 0.01)
      });
      continue;
    }
    if (opts.kind === 'color') {
      out.push(f);
      continue;
    }
    const step = opts.kind === 'scale' ? 0.0005 : 0.01;
    out.push({
      ...f,
      x: quantizeNumber(Number(f.x ?? 0), step),
      y: quantizeNumber(Number(f.y ?? 0), step)
    });
  }
  return out;
}

function estimateJsonSize(v: unknown) {
  try {
    return JSON.stringify(v).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function bezierEase01(u: number, cy1: number, cy2: number) {
  const t = clamp01(u);
  const a = 3 * (1 - t) * (1 - t) * t;
  const b = 3 * (1 - t) * t * t;
  const c = t * t * t;
  return a * cy1 + b * cy2 + c;
}

function fitBezierEase01(observations: { u: number; p: number; w: number }[]) {
  let sAA = 0;
  let sAB = 0;
  let sBB = 0;
  let sAy = 0;
  let sBy = 0;
  for (const o of observations) {
    const u = clamp01(o.u);
    const w = Number.isFinite(o.w) ? o.w : 1;
    const A = 3 * (1 - u) * (1 - u) * u;
    const B = 3 * (1 - u) * u * u;
    const C = u * u * u;
    const y = (clamp01(o.p) - C) * w;
    sAA += A * A * w;
    sAB += A * B * w;
    sBB += B * B * w;
    sAy += A * y;
    sBy += B * y;
  }
  const det = sAA * sBB - sAB * sAB;
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12) return null;
  const inv = 1 / det;
  let cy1 = (sBB * sAy - sAB * sBy) * inv;
  let cy2 = (-sAB * sAy + sAA * sBy) * inv;
  if (!Number.isFinite(cy1) || !Number.isFinite(cy2)) return null;
  cy1 = clamp01(cy1);
  cy2 = clamp01(cy2);
  const q = (x: number) => Math.round(x * 1000) / 1000;
  const cx1 = q(1 / 3);
  const cx2 = q(2 / 3);
  return { cy1, cy2, curve: [cx1, q(cy1), cx2, q(cy2)] as number[] };
}

function samplesBetween(frames: TimelineFrame[], t0: number, t1: number, maxPoints?: number) {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  const lo = (() => {
    let l = 0;
    let r = frames.length;
    while (l < r) {
      const m = (l + r) >> 1;
      const tm = Number((frames[m] as any)?.time ?? NaN);
      if (!Number.isFinite(tm) || tm < t0 - 1e-9) l = m + 1;
      else r = m;
    }
    return l;
  })();
  const hi = (() => {
    let l = lo;
    let r = frames.length;
    while (l < r) {
      const m = (l + r) >> 1;
      const tm = Number((frames[m] as any)?.time ?? NaN);
      if (!Number.isFinite(tm) || tm <= t1 + 1e-9) l = m + 1;
      else r = m;
    }
    return l;
  })();
  const slice = frames.slice(lo, hi);
  if (!maxPoints || slice.length <= maxPoints) return slice;
  if (maxPoints <= 2) return [slice[0], slice[slice.length - 1]];
  const out: TimelineFrame[] = [];
  const n = slice.length;
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i * (n - 1)) / (maxPoints - 1));
    out.push(slice[idx]!);
  }
  return out;
}

function bezierEval(t: number, p0: number, p1: number, p2: number, p3: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function bezierEvalDeriv(t: number, p0: number, p1: number, p2: number, p3: number) {
  const u = 1 - t;
  return 3 * u * u * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

function bezierYforX(x: number, curve: number[]) {
  const u = clamp01(x);
  if (!Array.isArray(curve) || curve.length !== 4) return u;
  const [x1, y1, x2, y2] = curve;
  let t = u;
  for (let i = 0; i < 6; i++) {
    const xt = bezierEval(t, 0, x1, x2, 1);
    const dx = xt - u;
    const dxt = bezierEvalDeriv(t, 0, x1, x2, 1);
    if (Math.abs(dxt) <= 1e-6) break;
    t -= dx / dxt;
    if (t <= 0) {
      t = 0;
      break;
    }
    if (t >= 1) {
      t = 1;
      break;
    }
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const xt = bezierEval(t, 0, x1, x2, 1);
    if (Math.abs(xt - u) <= 1e-6) break;
    if (xt < u) lo = t;
    else hi = t;
    t = (lo + hi) * 0.5;
  }
  return bezierEval(t, 0, y1, y2, 1);
}

function findSegmentIndex(frames: TimelineFrame[], t: number) {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = ((lo + hi + 1) / 2) | 0;
    if (frames[mid].time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function eval2D(frames: TimelineFrame[], t: number) {
  if (frames.length === 0) return { x: 0, y: 0 };
  if (t <= frames[0].time) return { x: frames[0].x ?? 0, y: frames[0].y ?? 0 };
  const last = frames[frames.length - 1];
  if (t >= last.time) return { x: last.x ?? 0, y: last.y ?? 0 };
  const i = findSegmentIndex(frames, t);
  const a = frames[i];
  const b = frames[i + 1];
  if (!a || !b) return { x: a?.x ?? 0, y: a?.y ?? 0 };
  const dt = Math.max(1e-12, b.time - a.time);
  let u = (t - a.time) / dt;
  if ((a as any).curve === 'stepped') u = 0;
  else if (Array.isArray(a.curve)) u = bezierYforX(u, a.curve);
  return {
    x: lerp(a.x ?? 0, b.x ?? 0, u),
    y: lerp(a.y ?? 0, b.y ?? 0, u)
  };
}

function eval1D(frames: TimelineFrame[], t: number, key: 'angle') {
  if (frames.length === 0) return 0;
  if (t <= frames[0].time) return frames[0][key] ?? 0;
  const last = frames[frames.length - 1];
  if (t >= last.time) return last[key] ?? 0;
  const i = findSegmentIndex(frames, t);
  const a = frames[i];
  const b = frames[i + 1];
  if (!a || !b) return a?.[key] ?? 0;
  const dt = Math.max(1e-12, b.time - a.time);
  let u = (t - a.time) / dt;
  if ((a as any).curve === 'stepped') u = 0;
  else if (Array.isArray(a.curve)) u = bezierYforX(u, a.curve);
  return lerp(a[key] ?? 0, b[key] ?? 0, u);
}

function evalColor(frames: TimelineFrame[], t: number) {
  if (frames.length === 0) return { r: 255, g: 255, b: 255, a: 255 };
  if (t <= frames[0].time) return parseRgba8888(String(frames[0].color ?? 'ffffffff'));
  const last = frames[frames.length - 1];
  if (t >= last.time) return parseRgba8888(String(last.color ?? 'ffffffff'));
  const i = findSegmentIndex(frames, t);
  const a = frames[i];
  const b = frames[i + 1];
  if (!a || !b) return parseRgba8888(String(a?.color ?? 'ffffffff'));
  if ((a as any).curve === 'stepped') return parseRgba8888(String(a.color ?? 'ffffffff'));
  const dt = Math.max(1e-12, b.time - a.time);
  let u = (t - a.time) / dt;
  if (Array.isArray(a.curve)) u = bezierYforX(u, a.curve);
  const ca = parseRgba8888(String(a.color ?? 'ffffffff'));
  const cb = parseRgba8888(String(b.color ?? a.color ?? 'ffffffff'));
  return {
    r: Math.round(lerp(ca.r, cb.r, u)),
    g: Math.round(lerp(ca.g, cb.g, u)),
    b: Math.round(lerp(ca.b, cb.b, u)),
    a: Math.round(lerp(ca.a, cb.a, u))
  };
}

function sampleTimesForRemoval(t0: number, tm: number, t1: number, maxT: number) {
  const eps = 1e-4;
  const times = [
    t0,
    t0 + eps,
    (t0 + tm) * 0.5,
    tm - eps,
    tm,
    tm + eps,
    (tm + t1) * 0.5,
    t1 - eps,
    t1
  ];
  const out: number[] = [];
  for (const t of times) {
    const tt = Math.max(0, Math.min(maxT, t));
    if (!Number.isFinite(tt)) continue;
    if (out.length && Math.abs(out[out.length - 1] - tt) <= 1e-9) continue;
    out.push(tt);
  }
  out.sort((a, b) => a - b);
  return out;
}

function optimizeTimelineVerified(
  frames: TimelineFrame[],
  kind: 'translate' | 'scale' | 'rotate' | 'color'
) {
  if (!Array.isArray(frames) || frames.length <= 2) return frames;
  const out = frames.map((f) => ({ ...(f as any) })) as TimelineFrame[];
  const maxT = out[out.length - 1].time;
  const eq2D = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6;
  const eq1D = (a: number, b: number) => Math.abs(a - b) <= 1e-6;
  const eqC = (a: any, b: any) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

  const canTryRemove = (i: number) => {
    if (i <= 0 || i >= out.length - 1) return false;
    const prev = out[i - 1];
    const cur = out[i];
    if (!prev || !cur) return false;
    if (Array.isArray(prev.curve)) return false;
    if (Array.isArray(cur.curve)) return false;
    return true;
  };

  let i = 1;
  while (i < out.length - 1) {
    if (!canTryRemove(i)) {
      i++;
      continue;
    }
    const prev = out[i - 1];
    const cur = out[i];
    const next = out[i + 1];
    if (!prev || !cur || !next) {
      i++;
      continue;
    }
    const t0 = prev.time;
    const tm = cur.time;
    const t1 = next.time;
    if (!(t1 > t0 + 1e-9) || !(tm > t0 + 1e-9) || !(tm < t1 - 1e-9)) {
      i++;
      continue;
    }

    if ((cur as any).curve === 'stepped') {
      const sameAsPrev =
        kind === 'rotate'
          ? Math.abs((cur.angle ?? 0) - (prev.angle ?? 0)) <= 1e-12
          : kind === 'color'
            ? String(cur.color ?? '').toLowerCase() === String(prev.color ?? '').toLowerCase()
            : Math.hypot((cur.x ?? 0) - (prev.x ?? 0), (cur.y ?? 0) - (prev.y ?? 0)) <= 1e-12;
      if (!sameAsPrev) {
        i++;
        continue;
      }
    }

    const candidate = out.slice(0, i).concat(out.slice(i + 1));
    const times = sampleTimesForRemoval(t0, tm, t1, maxT);
    let ok = true;
    for (const t of times) {
      if (kind === 'translate' || kind === 'scale') {
        if (!eq2D(eval2D(out, t), eval2D(candidate, t))) {
          ok = false;
          break;
        }
      } else if (kind === 'rotate') {
        if (!eq1D(eval1D(out, t, 'angle'), eval1D(candidate, t, 'angle'))) {
          ok = false;
          break;
        }
      } else {
        if (!eqC(evalColor(out, t), evalColor(candidate, t))) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      out.splice(i, 1);
      i = Math.max(1, i - 1);
      continue;
    }
    i++;
  }
  return out;
}

function tryBezierEaseCompress2D(
  frames: TimelineFrame[],
  samples: TimelineFrame[],
  epsilon: number,
  minRemove: number
) {
  if (frames.length < minRemove + 2) return frames;
  const out = frames.map((f) => ({ ...(f as any) })) as TimelineFrame[];
  const isBlocked = (f: TimelineFrame) => f.curve !== undefined;
  let i = 0;
  while (i < out.length - 2) {
    const a = out[i];
    if (!a || a.curve !== undefined) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < out.length && !isBlocked(out[j]!)) j++;
    const segEnd = j - 1;
    if (segEnd - i - 1 < minRemove) {
      i = Math.max(i + 1, segEnd);
      continue;
    }
    const c = out[segEnd]!;
    const t0 = a.time;
    const t1 = c.time;
    if (!(t1 > t0 + 1e-9)) {
      i++;
      continue;
    }
    const beforeSize = estimateJsonSize(out.slice(i, segEnd + 1));
    const dx = (c.x ?? 0) - (a.x ?? 0);
    const dy = (c.y ?? 0) - (a.y ?? 0);
    const denom = Math.max(1e-6, t1 - t0);
    const segSamples = samplesBetween(samples, t0, t1, 64);
    const obs: { u: number; p: number; w: number }[] = [];
    const wX = Math.abs(dx);
    const wY = Math.abs(dy);
    for (const s of segSamples) {
      const t = Number(s.time);
      const u = (t - t0) / denom;
      if (u <= 1e-9 || u >= 1 - 1e-9) continue;
      if (wX > 1e-9) obs.push({ u, p: ((s.x ?? 0) - (a.x ?? 0)) / dx, w: wX });
      if (wY > 1e-9) obs.push({ u, p: ((s.y ?? 0) - (a.y ?? 0)) / dy, w: wY });
    }
    if (obs.length < 2) {
      i = segEnd;
      continue;
    }
    const fit = fitBezierEase01(obs);
    if (!fit) {
      i = segEnd;
      continue;
    }
    let maxErr = 0;
    for (const s of segSamples) {
      const t = Number(s.time);
      const u = (t - t0) / denom;
      const p = bezierEase01(u, fit.cy1, fit.cy2);
      const px = (a.x ?? 0) + dx * p;
      const py = (a.y ?? 0) + dy * p;
      maxErr = Math.max(maxErr, Math.hypot((s.x ?? 0) - px, (s.y ?? 0) - py));
      if (maxErr > epsilon) break;
    }
    if (maxErr > epsilon) {
      i = segEnd;
      continue;
    }
    const candidate: TimelineFrame[] = [{ ...(a as any), curve: fit.curve } as any, { ...(c as any), curve: undefined } as any];
    const afterSize = estimateJsonSize(candidate);
    if (afterSize >= beforeSize) {
      i = segEnd;
      continue;
    }
    out.splice(i, segEnd - i + 1, ...candidate);
    i++;
  }
  return out;
}

function tryBezierEaseCompress1D(
  frames: TimelineFrame[],
  samples: TimelineFrame[],
  key: 'angle',
  epsilon: number,
  minRemove: number
) {
  if (frames.length < minRemove + 2) return frames;
  const out = frames.map((f) => ({ ...(f as any) })) as TimelineFrame[];
  const isBlocked = (f: TimelineFrame) => f.curve !== undefined;
  let i = 0;
  while (i < out.length - 2) {
    const a = out[i];
    if (!a || a.curve !== undefined) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < out.length && !isBlocked(out[j]!)) j++;
    const segEnd = j - 1;
    if (segEnd - i - 1 < minRemove) {
      i = Math.max(i + 1, segEnd);
      continue;
    }
    const c = out[segEnd]!;
    const t0 = a.time;
    const t1 = c.time;
    if (!(t1 > t0 + 1e-9)) {
      i++;
      continue;
    }
    const beforeSize = estimateJsonSize(out.slice(i, segEnd + 1));
    const dv = (c[key] ?? 0) - (a[key] ?? 0);
    if (Math.abs(dv) <= 1e-9) {
      i = segEnd;
      continue;
    }
    const denom = Math.max(1e-6, t1 - t0);
    const segSamples = samplesBetween(samples, t0, t1, 64);
    const obs: { u: number; p: number; w: number }[] = [];
    const w = Math.abs(dv);
    for (const s of segSamples) {
      const t = Number(s.time);
      const u = (t - t0) / denom;
      if (u <= 1e-9 || u >= 1 - 1e-9) continue;
      obs.push({ u, p: ((s[key] ?? 0) - (a[key] ?? 0)) / dv, w });
    }
    if (obs.length < 2) {
      i = segEnd;
      continue;
    }
    const fit = fitBezierEase01(obs);
    if (!fit) {
      i = segEnd;
      continue;
    }
    let maxErr = 0;
    for (const s of segSamples) {
      const t = Number(s.time);
      const u = (t - t0) / denom;
      const p = bezierEase01(u, fit.cy1, fit.cy2);
      const pv = (a[key] ?? 0) + dv * p;
      maxErr = Math.max(maxErr, Math.abs((s[key] ?? 0) - pv));
      if (maxErr > epsilon) break;
    }
    if (maxErr > epsilon) {
      i = segEnd;
      continue;
    }
    const candidate: TimelineFrame[] = [{ ...(a as any), curve: fit.curve } as any, { ...(c as any), curve: undefined } as any];
    const afterSize = estimateJsonSize(candidate);
    if (afterSize >= beforeSize) {
      i = segEnd;
      continue;
    }
    out.splice(i, segEnd - i + 1, ...candidate);
    i++;
  }
  return out;
}

function simplifyFrames1D(frames: TimelineFrame[], key: 'angle', epsilon: number, maxPoints: number) {
  if (frames.length <= 2) return frames;
  const keep = new Set<number>([0, frames.length - 1]);
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].curve !== undefined) keep.add(i);
  }

  const errorAt = (i: number, a: number, b: number) => {
    const fa = frames[a];
    const fb = frames[b];
    const fi = frames[i];
    const ta = fa.time;
    const tb = fb.time;
    const ti = fi.time;
    const denom = Math.max(1e-6, tb - ta);
    const t = (ti - ta) / denom;
    const pv = lerp(fa[key] ?? 0, fb[key] ?? 0, t);
    return Math.abs((fi[key] ?? 0) - pv);
  };

  const recurse = (a: number, b: number) => {
    if (keep.size >= maxPoints) return;
    let maxErr = 0;
    let maxIdx = -1;
    for (let i = a + 1; i < b; i++) {
      const err = errorAt(i, a, b);
      if (err > maxErr) {
        maxErr = err;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxErr > epsilon && keep.size < maxPoints) {
      keep.add(maxIdx);
      recurse(a, maxIdx);
      recurse(maxIdx, b);
    }
  };

  recurse(0, frames.length - 1);
  return Array.from(keep).sort((a, b) => a - b).map((i) => frames[i]);
}

function parseRgba8888(hex8: string) {
  const normalized = hex8.trim().replace('#', '');
  if (normalized.length !== 8) return { r: 255, g: 255, b: 255, a: 255 };
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
    a: parseInt(normalized.slice(6, 8), 16)
  };
}

function simplifyColor(frames: TimelineFrame[], epsilonPerChannel: number, maxPoints: number) {
  if (frames.length <= 2) return frames;
  const keep = new Set<number>([0, frames.length - 1]);
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].curve !== undefined) keep.add(i);
  }

  const errorAt = (i: number, a: number, b: number) => {
    const fa = frames[a];
    const fb = frames[b];
    const fi = frames[i];
    const ta = fa.time;
    const tb = fb.time;
    const ti = fi.time;
    const denom = Math.max(1e-6, tb - ta);
    const t = (ti - ta) / denom;
    const ca = parseRgba8888(fa.color ?? 'ffffffff');
    const cb = parseRgba8888(fb.color ?? fa.color ?? 'ffffffff');
    const ci = parseRgba8888(fi.color ?? 'ffffffff');
    const pr = lerp(ca.r, cb.r, t);
    const pg = lerp(ca.g, cb.g, t);
    const pb = lerp(ca.b, cb.b, t);
    const pa = lerp(ca.a, cb.a, t);
    return Math.max(Math.abs(ci.r - pr), Math.abs(ci.g - pg), Math.abs(ci.b - pb), Math.abs(ci.a - pa));
  };

  const recurse = (a: number, b: number) => {
    if (keep.size >= maxPoints) return;
    let maxErr = 0;
    let maxIdx = -1;
    for (let i = a + 1; i < b; i++) {
      const err = errorAt(i, a, b);
      if (err > maxErr) {
        maxErr = err;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxErr > epsilonPerChannel && keep.size < maxPoints) {
      keep.add(maxIdx);
      recurse(a, maxIdx);
      recurse(maxIdx, b);
    }
  };

  recurse(0, frames.length - 1);
  return Array.from(keep).sort((a, b) => a - b).map((i) => frames[i]);
}

function ensureHiddenAtStart(translate: TimelineFrame[], scale: TimelineFrame[], rotate: TimelineFrame[], color: TimelineFrame[], baseColor: string) {
  const firstTime = Math.min(translate[0]?.time ?? Infinity, scale[0]?.time ?? Infinity, rotate[0]?.time ?? Infinity, color[0]?.time ?? Infinity);
  if (!Number.isFinite(firstTime) || firstTime <= 1e-6) return;
  color.unshift({ time: 0, color: rgbWithAlpha(baseColor, 0), curve: 'stepped' });
}

function dedupeExactTimes(frames: TimelineFrame[]) {
  if (frames.length <= 1) return frames;
  const out: TimelineFrame[] = [];
  for (const f of frames) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.time - f.time) <= 1e-9) {
      const merged: any = { ...(f as any) };
      if (merged.curve === undefined && (last as any).curve !== undefined) merged.curve = (last as any).curve;
      out[out.length - 1] = merged as TimelineFrame;
      continue;
    }
    out.push(f);
  }
  return out;
}

function cloneNearestAtTime(frames: TimelineFrame[], time: number) {
  if (!frames.length) return null;
  let best = frames[0];
  let bestD = Math.abs((best.time ?? 0) - time);
  for (let i = 1; i < frames.length; i++) {
    const d = Math.abs(frames[i].time - time);
    if (d < bestD) {
      bestD = d;
      best = frames[i];
    }
  }
  return { ...best, time };
}

function ensureLoopHiddenAtStart(translate: TimelineFrame[], scale: TimelineFrame[], rotate: TimelineFrame[], color: TimelineFrame[], baseColor: string) {
  const sortByTime = (arr: TimelineFrame[]) => arr.sort((a, b) => a.time - b.time);
  sortByTime(translate);
  sortByTime(scale);
  sortByTime(rotate);
  sortByTime(color);

  const firstAfter0 = (arr: TimelineFrame[]) => {
    let best: TimelineFrame | null = null;
    for (const f of arr) {
      if (f.time <= 1e-6) continue;
      if (best == null || f.time < best.time) best = f;
    }
    return best;
  };
  const tFirst = firstAfter0(translate)?.time ?? Number.POSITIVE_INFINITY;
  const sFirst = firstAfter0(scale)?.time ?? Number.POSITIVE_INFINITY;
  const cFirst = firstAfter0(color)?.time ?? Number.POSITIVE_INFINITY;
  const firstTime = Math.min(tFirst, sFirst, cFirst);
  if (!Number.isFinite(firstTime) || firstTime <= 1e-6) return;

  const shouldHideAt0 = firstTime > EXPORT_DT * 1.1;
  if (!shouldHideAt0) return;

  const upsertAt0 = (arr: TimelineFrame[], frame: TimelineFrame) => {
    const i = arr.findIndex((f) => Math.abs(f.time - 0) <= 1e-6);
    if (i >= 0) arr[i] = frame;
    else arr.unshift(frame);
  };

  upsertAt0(color, { time: 0, color: rgbWithAlpha(baseColor, 0), curve: 'stepped', _inj: 'hide0' });

  sortByTime(translate);
  sortByTime(scale);
  sortByTime(rotate);
  sortByTime(color);

  translate.splice(0, translate.length, ...dedupeExactTimes(translate));
  scale.splice(0, scale.length, ...dedupeExactTimes(scale));
  rotate.splice(0, rotate.length, ...dedupeExactTimes(rotate));
  color.splice(0, color.length, ...dedupeExactTimes(color));
}

function ensureLoopSeamCarryOverAtStartFromEnd(
  translate: TimelineFrame[],
  scale: TimelineFrame[],
  rotate: TimelineFrame[],
  color: TimelineFrame[]
) {
  const eps = 1e-6;
  const tEq = (a: number, b: number) => Math.abs(a - b) <= eps;
  const atTime = (arr: TimelineFrame[], t: number) => arr.find((f) => tEq(f.time, t));
  const alpha255 = (c?: string) => {
    const s = String(c || '').trim();
    if (/^[0-9a-fA-F]{8}$/.test(s)) return parseInt(s.slice(6, 8), 16);
    return 255;
  };

  const cEnd = color[color.length - 1];
  if (!cEnd) return;

  const aEnd = alpha255(cEnd.color);
  if (aEnd <= VISIBILITY_ALPHA_HIDDEN_MAX) return;

  const c0 = atTime(color, 0);
  const a0 = c0 ? alpha255(c0.color) : 0;
  if (a0 > VISIBILITY_ALPHA_HIDDEN_MAX) return;

  {
    let firstAfter0: TimelineFrame | null = null;
    for (const f of color) {
      if (!f) continue;
      if (f.time <= eps) continue;
      firstAfter0 = f;
      break;
    }
    if (firstAfter0) {
      const a1 = alpha255(firstAfter0.color);
      if (a1 <= VISIBILITY_ALPHA_HIDDEN_MAX && firstAfter0.curve === 'stepped' && (cEnd.time - firstAfter0.time) > 0.2) return;
    }
  }

  const upsertAt0 = (arr: TimelineFrame[], from: TimelineFrame | undefined) => {
    if (!from) return;
    const i = arr.findIndex((f) => tEq(f.time, 0));
    const frame = { ...(from as any), time: 0, curve: undefined, _inj: 'seam0' } as any;
    if (i >= 0) arr[i] = { ...(arr[i] as any), ...frame } as any;
    else arr.unshift(frame);
  };

  upsertAt0(translate, translate[translate.length - 1]);
  upsertAt0(scale, scale[scale.length - 1]);
  upsertAt0(rotate, rotate[rotate.length - 1]);
  upsertAt0(color, cEnd);

  translate.sort((a, b) => a.time - b.time);
  scale.sort((a, b) => a.time - b.time);
  rotate.sort((a, b) => a.time - b.time);
  color.sort((a, b) => a.time - b.time);

  translate.splice(0, translate.length, ...dedupeExactTimes(translate));
  scale.splice(0, scale.length, ...dedupeExactTimes(scale));
  rotate.splice(0, rotate.length, ...dedupeExactTimes(rotate));
  color.splice(0, color.length, ...dedupeExactTimes(color));
}

function ensureLoopSeamStepAtEndFromStart(
  translate: TimelineFrame[],
  scale: TimelineFrame[],
  rotate: TimelineFrame[],
  color: TimelineFrame[],
  loopDuration: number
) {
  const T = loopDuration;
  if (!Number.isFinite(T) || T <= 1e-6) return;
  if (T <= EXPORT_DT * 1.1) return;
  const eps = 1e-6;
  const tEq = (a: number, b: number) => Math.abs(a - b) <= eps;
  const atTime = (arr: TimelineFrame[], t: number) => arr.find((f) => tEq(f.time, t));
  const alpha255 = (c?: string) => {
    const s = String(c || '').trim();
    if (/^[0-9a-fA-F]{8}$/.test(s)) return parseInt(s.slice(6, 8), 16);
    return 255;
  };
  const hiddenFrom = (c?: string) => {
    const s = String(c || '').trim();
    if (/^[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 6) + '00';
    return 'ffffff00';
  };

  const c0 = atTime(color, 0);
  if (!c0) return;
  const a0 = alpha255(c0.color);
  if (a0 <= VISIBILITY_ALPHA_HIDDEN_MAX) return;

  const cEnd = atTime(color, T) || color[color.length - 1];
  if (!cEnd) return;
  const aEnd = alpha255(cEnd.color);
  if (aEnd > VISIBILITY_ALPHA_HIDDEN_MAX) return;

  const upsertAt = (arr: TimelineFrame[], t: number, from: TimelineFrame | undefined) => {
    if (!from) return;
    const i = arr.findIndex((f) => tEq(f.time, t));
    const frame = { ...(from as any), time: t, curve: undefined, _inj: 'seamT' } as any;
    if (i >= 0) arr[i] = { ...(arr[i] as any), ...frame } as any;
    else arr.push(frame);
  };

  const tPrev = Math.max(0, T - EXPORT_DT);
  const iPrev = color.findIndex((f) => tEq(f.time, tPrev));
  const hidden = hiddenFrom(c0.color);
  const prevFrame = { time: tPrev, color: hidden, curve: 'stepped', _inj: 'seamTPrev' } as any;
  if (iPrev >= 0) color[iPrev] = { ...(color[iPrev] as any), ...prevFrame } as any;
  else color.push(prevFrame);

  upsertAt(color, T, { ...(c0 as any), color: hidden } as any);
  upsertAt(translate, T, atTime(translate, 0) || translate[0]);
  upsertAt(scale, T, atTime(scale, 0) || scale[0]);
  upsertAt(rotate, T, atTime(rotate, 0) || rotate[0]);

  const setSteppedAt = (arr: TimelineFrame[], t: number) => {
    const i = arr.findIndex((f) => tEq(f.time, t));
    if (i >= 0) {
      const f = arr[i];
      if (f && f.curve !== 'stepped') arr[i] = { ...(f as any), curve: 'stepped' } as any;
      return;
    }
    const k = cloneNearestAtTime(arr, t);
    if (!k) return;
    arr.push({ ...(k as any), time: t, curve: 'stepped' } as any);
  };
  setSteppedAt(translate, tPrev);
  setSteppedAt(scale, tPrev);
  setSteppedAt(rotate, tPrev);

  translate.sort((a, b) => a.time - b.time);
  scale.sort((a, b) => a.time - b.time);
  rotate.sort((a, b) => a.time - b.time);
  color.sort((a, b) => a.time - b.time);

  translate.splice(0, translate.length, ...dedupeExactTimes(translate));
  scale.splice(0, scale.length, ...dedupeExactTimes(scale));
  rotate.splice(0, rotate.length, ...dedupeExactTimes(rotate));
  color.splice(0, color.length, ...dedupeExactTimes(color));
}

function ensureLoopBoundaryFrames(translate: TimelineFrame[], scale: TimelineFrame[], rotate: TimelineFrame[], color: TimelineFrame[]) {
  const sortByTime = (arr: TimelineFrame[]) => arr.sort((a, b) => a.time - b.time);
  sortByTime(translate);
  sortByTime(scale);
  sortByTime(rotate);
  sortByTime(color);

  const has0 = (arr: TimelineFrame[]) => arr.some((f) => Math.abs(f.time - 0) <= 1e-6);
  const ensure0 = (arr: TimelineFrame[]) => {
    if (has0(arr)) return;
    const first = arr[0];
    if (!first) return;
    if (first.time > EXPORT_DT * 1.1) return;
    const k0 = cloneNearestAtTime(arr, 0);
    if (!k0) return;
    arr.unshift({ ...k0, time: 0, curve: undefined });
  };
  ensure0(translate);
  ensure0(scale);
  ensure0(rotate);
  ensure0(color);
  sortByTime(translate);
  sortByTime(scale);
  sortByTime(rotate);
  sortByTime(color);

  translate.splice(0, translate.length, ...dedupeExactTimes(translate));
  scale.splice(0, scale.length, ...dedupeExactTimes(scale));
  rotate.splice(0, rotate.length, ...dedupeExactTimes(rotate));
  color.splice(0, color.length, ...dedupeExactTimes(color));
}

function ensureParticleLifecycleSteppedFrames(
  translate: TimelineFrame[],
  scale: TimelineFrame[],
  rotate: TimelineFrame[],
  color: TimelineFrame[],
  opts: { loopDuration: number; startDelay: number; endRawTime: number; baseColor: string }
) {
  const T = opts.loopDuration;
  if (!Number.isFinite(T) || T <= 1e-6) return;
  const eps = 1e-6;
  const hiddenColor = rgbWithAlpha(opts.baseColor, 0);
  const tickT = Math.max(0, Math.round(T / EXPORT_DT));
  const tickToTime = (tick: number) => {
    if (tick <= 0) return 0;
    if (tick >= tickT) return T;
    return tick * EXPORT_DT;
  };
  const rawToTick = (raw: number) => {
    const t = Math.max(0, Math.min(T, raw));
    if (Math.abs(t - T) <= EXPORT_DT * 0.5 + eps) return tickT;
    let tick = Math.round(t / EXPORT_DT);
    if (tick <= 0 && t > eps) tick = 1;
    if (tick >= tickT && t < T - eps) tick = tickT - 1;
    return Math.max(0, Math.min(tickT, tick));
  };

  const upsert = (arr: TimelineFrame[], frame: TimelineFrame) => {
    const i = arr.findIndex((f) => Math.abs(f.time - frame.time) <= eps);
    if (i >= 0) arr[i] = { ...(arr[i] as any), ...(frame as any) } as any;
    else arr.push(frame);
  };

  const ensureSteppedAtTime = (arr: TimelineFrame[], t: number) => {
    let found = false;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (!f) continue;
      if (Math.abs(f.time - t) > eps) continue;
      found = true;
      if (f.curve !== 'stepped') arr[i] = { ...(f as any), curve: 'stepped' } as any;
    }
    if (found) return;
    const k = cloneNearestAtTime(arr, t);
    if (!k) return;
    arr.push({ ...(k as any), time: t, curve: 'stepped' } as any);
  };

  const ensureBirth = () => {
    const raw = opts.startDelay;
    if (!Number.isFinite(raw) || raw < EXPORT_DT * 0.5 || raw > T + 1e-6) return;
    const tickBirth = rawToTick(raw);
    if (tickBirth <= 0) return;
    const tBirth = tickToTime(tickBirth);
    const tPrev = tickToTime(tickBirth - 1);

    const coBirth = cloneNearestAtTime(color, tBirth) || { time: tBirth, color: rgbWithAlpha(opts.baseColor, 1) };

    upsert(color, { time: tBirth, color: (coBirth as any).color ?? rgbWithAlpha(opts.baseColor, 1) } as any);

    upsert(color, { time: tPrev, color: hiddenColor, curve: 'stepped' } as any);

    ensureSteppedAtTime(translate, tPrev);
    ensureSteppedAtTime(scale, tPrev);
    ensureSteppedAtTime(rotate, tPrev);
  };

  const ensureDeath = () => {
    const raw = opts.endRawTime;
    if (!Number.isFinite(raw) || raw < -1e-9 || raw > T + 1e-6) return;
    const tickDeath = rawToTick(raw);
    if (tickDeath <= 0) return;
    const tDeath = tickToTime(tickDeath);
    const tPrev = tickToTime(tickDeath - 1);

    const coPrev = cloneNearestAtTime(color, tPrev) || cloneNearestAtTime(color, tDeath) || { time: tPrev, color: rgbWithAlpha(opts.baseColor, 1) };

    upsert(color, { time: tPrev, color: (coPrev as any).color ?? rgbWithAlpha(opts.baseColor, 1), curve: 'stepped' } as any);

    upsert(color, { time: tDeath, color: hiddenColor } as any);

    ensureSteppedAtTime(translate, tPrev);
    ensureSteppedAtTime(scale, tPrev);
    ensureSteppedAtTime(rotate, tPrev);
  };

  ensureBirth();
  ensureDeath();

  translate.sort((a, b) => a.time - b.time);
  scale.sort((a, b) => a.time - b.time);
  rotate.sort((a, b) => a.time - b.time);
  color.sort((a, b) => a.time - b.time);

  translate.splice(0, translate.length, ...dedupeExactTimes(translate));
  scale.splice(0, scale.length, ...dedupeExactTimes(scale));
  rotate.splice(0, rotate.length, ...dedupeExactTimes(rotate));
  color.splice(0, color.length, ...dedupeExactTimes(color));
}

function enforceSteppedOnVisibilityTransitions(
  color: TimelineFrame[]
) {
  const alpha255 = (c?: string) => {
    const s = String(c || '').trim();
    if (/^[0-9a-fA-F]{8}$/.test(s)) return parseInt(s.slice(6, 8), 16);
    return 255;
  };
  const alpha0 = (f: TimelineFrame) => alpha255(f.color) <= 0;
  const isColorHidden = (f: TimelineFrame) => alpha255(f.color) <= VISIBILITY_ALPHA_HIDDEN_MAX;
  const toHex8 = (r: number, g: number, b: number, a: number) =>
    `${Math.round(Math.max(0, Math.min(255, r))).toString(16).padStart(2, '0')}${Math.round(Math.max(0, Math.min(255, g))).toString(16).padStart(2, '0')}${Math.round(Math.max(0, Math.min(255, b))).toString(16).padStart(2, '0')}${Math.round(Math.max(0, Math.min(255, a))).toString(16).padStart(2, '0')}`;

  const ensureSteppedAt = (arr: TimelineFrame[], idx: number) => {
    if (idx < 0 || idx >= arr.length) return;
    const f = arr[idx];
    if (!f || f.curve === 'stepped') return;
    arr[idx] = { ...(f as any), curve: 'stepped' } as any;
  };

  const pending: TimelineFrame[] = [];
  for (let i = 0; i < color.length - 1; i++) {
    const a = color[i];
    const b = color[i + 1];
    if (!a || !b) continue;

    const hiddenA = isColorHidden(a);
    const hiddenB = isColorHidden(b);
    if (hiddenA !== hiddenB) {
      if (!hiddenA && hiddenB) {
        const aA = alpha255(a.color);
        const gap = b.time - a.time;
        if (aA < 250 && gap > EXPORT_DT * 1.1) {
          const tStep = Math.max(0, b.time - EXPORT_DT);
          const denom = Math.max(1e-6, b.time - a.time);
          const u = (tStep - a.time) / denom;
          const ca = parseRgba8888(String((a as any).color || 'ffffffff'));
          const cb = parseRgba8888(String((b as any).color || String((a as any).color || 'ffffffff')));
          pending.push({ time: tStep, color: toHex8(lerp(ca.r, cb.r, u), lerp(ca.g, cb.g, u), lerp(ca.b, cb.b, u), lerp(ca.a, cb.a, u)), curve: 'stepped' } as any);
          if (a.curve === 'stepped') color[i] = { ...(a as any), curve: undefined } as any;
          continue;
        }
      }
      ensureSteppedAt(color, i);
      continue;
    }
    if (alpha0(a) !== alpha0(b)) ensureSteppedAt(color, i);
  }

  if (pending.length) {
    color.push(...pending);
    color.sort((a, b) => a.time - b.time);
    color.splice(0, color.length, ...dedupeExactTimes(color));
  }
}

function enforceTransformSteppedForAlphaZeroDrops(
  translate: TimelineFrame[],
  scale: TimelineFrame[],
  rotate: TimelineFrame[],
  color: TimelineFrame[]
) {
  const eps = 1e-6;
  const SCALE_HIDE_EPS = 0.02;
  const tEq = (a: number, b: number) => Math.abs(a - b) <= eps;
  const alpha255 = (c?: string) => {
    const s = String(c || '').trim();
    if (/^[0-9a-fA-F]{8}$/.test(s)) return parseInt(s.slice(6, 8), 16);
    return 255;
  };
  const alpha0 = (f?: TimelineFrame) => alpha255((f as any)?.color) <= 0;
  const alphaPos = (f?: TimelineFrame) => alpha255((f as any)?.color) > 0;

  const sample2DAt = (arr: TimelineFrame[], t: number) => {
    let prev: TimelineFrame | null = null;
    let next: TimelineFrame | null = null;
    for (const f of arr) {
      if (!f) continue;
      const tf = Number(f.time);
      if (!Number.isFinite(tf)) continue;
      if (tEq(tf, t)) return { ...(f as any), time: t } as any;
      if (tf < t - eps) {
        if (!prev || tf > prev.time) prev = f;
      } else if (tf > t + eps) {
        if (!next || tf < next.time) next = f;
      }
    }
    if (prev && next) {
      const denom = Math.max(1e-6, next.time - prev.time);
      const u = (t - prev.time) / denom;
      return { time: t, x: lerp(prev.x ?? 0, next.x ?? 0, u), y: lerp(prev.y ?? 0, next.y ?? 0, u) } as any;
    }
    const k = cloneNearestAtTime(arr, t);
    return k ? ({ time: t, x: (k as any).x, y: (k as any).y } as any) : null;
  };

  const sampleAngleAt = (arr: TimelineFrame[], t: number) => {
    let prev: TimelineFrame | null = null;
    let next: TimelineFrame | null = null;
    for (const f of arr) {
      if (!f) continue;
      const tf = Number(f.time);
      if (!Number.isFinite(tf)) continue;
      if (tEq(tf, t)) return { ...(f as any), time: t } as any;
      if (tf < t - eps) {
        if (!prev || tf > prev.time) prev = f;
      } else if (tf > t + eps) {
        if (!next || tf < next.time) next = f;
      }
    }
    if (prev && next) {
      const denom = Math.max(1e-6, next.time - prev.time);
      const u = (t - prev.time) / denom;
      return { time: t, angle: lerp((prev as any).angle ?? 0, (next as any).angle ?? 0, u) } as any;
    }
    const k = cloneNearestAtTime(arr, t);
    return k ? ({ time: t, angle: (k as any).angle ?? 0 } as any) : null;
  };

  const upsertAt = (arr: TimelineFrame[], frame: TimelineFrame) => {
    const i = arr.findIndex((f) => tEq(f.time, frame.time));
    if (i >= 0) arr[i] = { ...(arr[i] as any), ...(frame as any) } as any;
    else arr.push(frame);
  };

  const setSteppedAt = (arr: TimelineFrame[], t: number, kind: '2d' | 'angle') => {
    const i = arr.findIndex((f) => tEq(f.time, t));
    if (i >= 0) {
      const f = arr[i];
      if (f && f.curve !== 'stepped') arr[i] = { ...(f as any), curve: 'stepped' } as any;
      return;
    }
    const sampled = kind === 'angle' ? sampleAngleAt(arr, t) : sample2DAt(arr, t);
    if (!sampled) return;
    upsertAt(arr, { ...(sampled as any), time: t, curve: 'stepped' } as any);
  };

  const ensureKeyAt = (arr: TimelineFrame[], t: number, kind: '2d' | 'angle') => {
    if (arr.some((f) => tEq(f.time, t))) return;
    const sampled = kind === 'angle' ? sampleAngleAt(arr, t) : sample2DAt(arr, t);
    if (!sampled) return;
    upsertAt(arr, { ...(sampled as any), time: t, curve: undefined } as any);
  };

  if (color.length < 2) return;
  color.sort((a, b) => a.time - b.time);
  for (let i = 0; i < color.length - 1; i++) {
    const a = color[i];
    const b = color[i + 1];
    if (!a || !b) continue;
    if (!alphaPos(a) || !alpha0(b)) continue;
    const tPrev = Number(a.time);
    const tDeath = Number(b.time);
    if (!Number.isFinite(tPrev) || !Number.isFinite(tDeath)) continue;
    setSteppedAt(translate, tPrev, '2d');
    setSteppedAt(scale, tPrev, '2d');
    if (rotate.length) setSteppedAt(rotate, tPrev, 'angle');

    {
      const si = scale.findIndex((f) => tEq(f.time, tPrev));
      if (si >= 0) {
        const f = scale[si];
        const x = Math.abs(Number((f as any).x ?? 0));
        const y = Math.abs(Number((f as any).y ?? 0));
        if (Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0 && x <= SCALE_HIDE_EPS && y <= SCALE_HIDE_EPS) {
          scale[si] = { ...(f as any), x: 0, y: 0, curve: 'stepped' } as any;
        }
      }
    }

    if (tDeath > tPrev + eps) {
      ensureKeyAt(translate, tDeath, '2d');
      ensureKeyAt(scale, tDeath, '2d');
      if (rotate.length) ensureKeyAt(rotate, tDeath, 'angle');
    }
  }

  translate.sort((a, b) => a.time - b.time);
  scale.sort((a, b) => a.time - b.time);
  rotate.sort((a, b) => a.time - b.time);
  translate.splice(0, translate.length, ...dedupeExactTimes(translate));
  scale.splice(0, scale.length, ...dedupeExactTimes(scale));
  rotate.splice(0, rotate.length, ...dedupeExactTimes(rotate));
}

function unwrapAngles(frames: TimelineFrame[]) {
  if (frames.length <= 1) return frames;
  const out: TimelineFrame[] = [];
  let prev = frames[0]?.angle ?? 0;
  out.push({ ...frames[0], angle: prev });
  for (let i = 1; i < frames.length; i++) {
    const cur = frames[i];
    let a = cur.angle ?? 0;
    while (a - prev > 180) a -= 360;
    while (a - prev < -180) a += 360;
    out.push({ ...cur, angle: a });
    prev = a;
  }
  return out;
}

function stripCurveOnLast(frames: TimelineFrame[]) {
  if (frames.length === 0) return frames;
  const last = frames[frames.length - 1];
  if (!last || last.curve === undefined) return frames;
  frames[frames.length - 1] = { ...last, curve: undefined };
  return frames;
}

function sanitizeTimelineFrames(
  frames: any,
  opts: { kind: 'translate' | 'scale' | 'rotate' | 'color' | 'attachment' }
) {
  if (!Array.isArray(frames) || frames.length === 0) return undefined;
  const out: any[] = [];

  const allowCurve = (c: any) => {
    if (c === undefined) return undefined;
    if (typeof c === 'string') return c.toLowerCase() === 'stepped' ? 'stepped' : undefined;
    if (Array.isArray(c) && c.length === 4 && c.every((n) => typeof n === 'number' && Number.isFinite(n))) return c;
    return undefined;
  };

  for (const f of frames) {
    const t = Number(f?.time ?? 0);
    if (!Number.isFinite(t)) continue;
    const time = t < 0 ? 0 : t;

    if (opts.kind === 'attachment') {
      const name = typeof f?.name === 'string' ? f.name : (typeof f?.attachment === 'string' ? f.attachment : undefined);
      if (!name) continue;
      out.push({ time, name });
      continue;
    }

    if (opts.kind === 'rotate') {
      const angle = Number(f?.angle ?? 0);
      if (!Number.isFinite(angle)) continue;
      out.push({ time, angle, curve: allowCurve(f?.curve) });
      continue;
    }

    if (opts.kind === 'color') {
      const color = typeof f?.color === 'string' && /^[0-9a-fA-F]{8}$/.test(f.color) ? f.color : undefined;
      if (!color) continue;
      out.push({ time, color, curve: allowCurve(f?.curve) });
      continue;
    }

    const x = Number(f?.x ?? 0);
    const y = Number(f?.y ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ time, x, y, curve: allowCurve(f?.curve) });
  }

  out.sort((a, b) => a.time - b.time);
  const dedup: any[] = [];
  for (const f of out) {
    const last = dedup[dedup.length - 1];
    if (last && Math.abs(last.time - f.time) <= 1e-9) {
      dedup[dedup.length - 1] = f;
    } else {
      dedup.push(f);
    }
  }

  if (dedup.length > 0) {
    const last = dedup[dedup.length - 1];
    if (last && last.curve !== undefined) delete last.curve;
  }

  for (const f of dedup) {
    if (f.curve === undefined) delete f.curve;
  }

  return dedup.length ? dedup : undefined;
}

function sanitizeSpine38Data(data: any) {
  if (!data || typeof data !== 'object') return;
  const anim = data.animations?.animation;
  if (!anim || typeof anim !== 'object') return;

  const bones = anim.bones || {};
  for (const [bn, obj] of Object.entries<any>(bones)) {
    if (!obj || typeof obj !== 'object') continue;
    const tr = sanitizeTimelineFrames(obj.translate, { kind: 'translate' });
    const sc = sanitizeTimelineFrames(obj.scale, { kind: 'scale' });
    const ro = sanitizeTimelineFrames(obj.rotate, { kind: 'rotate' });
    const out: any = {};
    if (tr) out.translate = tr;
    if (sc) out.scale = sc;
    if (ro) out.rotate = ro;
    bones[bn] = out;
  }

  const slots = anim.slots || {};
  for (const [sn, obj] of Object.entries<any>(slots)) {
    if (!obj || typeof obj !== 'object') continue;
    const co = sanitizeTimelineFrames(obj.color, { kind: 'color' });
    const at = sanitizeTimelineFrames(obj.attachment, { kind: 'attachment' });
    const out: any = {};
    if (co) out.color = co;
    if (at) out.attachment = at;
    slots[sn] = out;
  }
}

function pickWeightedSprite(sprites: ParticleSprite[] | undefined, seed: number) {
  const list = sprites || [];
  if (list.length === 0) return null;
  const rng = mulberry32(seed);
  let sum = 0;
  for (const s of list) sum += Math.max(0, s.weight ?? 0);
  if (sum <= 1e-6) return list[Math.floor(rng() * list.length)] || null;
  let r = rng() * sum;
  for (let i = 0; i < list.length; i++) {
    r -= Math.max(0, list[i].weight ?? 0);
    if (r <= 0) return list[i] || null;
  }
  return list[list.length - 1] || null;
}

function buildAttachmentTimeline(opts: { startDelay: number; life: number; frames: string[]; fps: number; loop: boolean; frameOffset?: number }) {
  const frames = (opts.frames || []).filter(Boolean);
  if (frames.length <= 1) return undefined;

  const out: { time: number; name: string }[] = [];
  const startTime = Number.isFinite(opts.startDelay) ? opts.startDelay : 0;
  const endTime = startTime + Math.max(1e-3, opts.life || 0);
  const fps = Math.max(1e-3, opts.fps || 12);
  const dt = 1 / fps;
  const off = Math.max(0, Math.floor(opts.frameOffset || 0));

  let k = 0;
  while (true) {
    const time = startTime + k * dt;
    if (time > endTime + 1e-6) break;
    const kk = k + off;
    const idx = opts.loop ? (kk % frames.length) : Math.min(kk, frames.length - 1);
    const name = frames[idx];
    const last = out[out.length - 1];
    if (!last || last.name !== name) out.push({ time, name });
    k++;
    if (k > 2000) break;
  }

  return out;
}

function buildSequenceTimelineKeyframes(opts: {
  startDelay: number;
  fps: number;
  loop: boolean;
  frameOffset?: number;
  count: number;
  isLoopAnim: boolean;
  duration: number;
}) {
  const count = Math.max(0, Math.floor(opts.count || 0));
  if (count <= 0) return undefined;
  const fps = Math.max(1e-3, opts.fps || 12);
  const delay = 1 / fps;
  const offRaw = Math.max(0, Math.floor(opts.frameOffset || 0));
  const off = count > 0 ? (offRaw % count) : 0;
  const mode = opts.loop ? 'loop' : 'once';
  const t0 = Number.isFinite(opts.startDelay) ? opts.startDelay : 0;
  const duration = Math.max(0, opts.duration || 0);

  const out: { time: number; mode: string; index: number; delay: number }[] = [];

  if (opts.isLoopAnim && duration > 1e-6) {
    if (t0 >= 0) {
      out.push({ time: 0, mode: 'hold', index: 0, delay });
      out.push({ time: t0, mode, index: off, delay });
      out.push({ time: duration, mode: 'hold', index: 0, delay });
    } else {
      const adv = Math.max(0, Math.floor((-t0) / delay + 1e-9));
      const idx0 = opts.loop ? ((off + adv) % count) : Math.min(off + adv, count - 1);
      out.push({ time: 0, mode, index: idx0, delay });
      out.push({ time: duration, mode, index: idx0, delay });
    }
  } else {
    out.push({ time: Math.max(0, t0), mode, index: off, delay });
  }

  out.sort((a, b) => a.time - b.time);
  const dedup: typeof out = [];
  for (const k of out) {
    const last = dedup[dedup.length - 1];
    if (last && Math.abs(last.time - k.time) <= 1e-9) {
      dedup[dedup.length - 1] = k;
      continue;
    }
    dedup.push(k);
  }
  return dedup.length ? dedup : undefined;
}

function wrapAndFinalizeAttachmentLoop(frames: { time: number; name: string }[], duration: number) {
  if (!frames.length || !Number.isFinite(duration) || duration <= 1e-6) return frames;

  const rawSorted = [...frames].sort((a, b) => a.time - b.time);
  let nameAt0: string | null = rawSorted[0]?.name ?? null;
  for (const k of rawSorted) {
    if (k.time <= 0 + 1e-6) nameAt0 = k.name;
    else break;
  }

  const cycDist = (rt: number, t: number) => {
    const d0 = Math.abs(rt - t);
    const d1 = Math.abs(rt - (t - duration));
    const d2 = Math.abs(rt - (t + duration));
    return Math.min(d0, d1, d2);
  };

  const wrapped = frames.map((k) => ({ time: wrapTimeIntoDuration(k.time, duration), name: k.name, _rt: k.time } as any));
  const map = new Map<number, any>();
  for (const k of wrapped) {
    const t = k.time;
    const prev = map.get(t);
    if (!prev) {
      map.set(t, k);
      continue;
    }
    const prt = Number(prev._rt);
    const nrt = Number(k._rt);
    const sn = cycDist(nrt, t);
    const sp = cycDist(prt, t);
    if (Math.abs(sn - sp) <= 1e-9) {
      map.set(t, Math.abs(nrt) < Math.abs(prt) ? k : prev);
    } else {
      map.set(t, sn < sp ? k : prev);
    }
  }
  const out = Array.from(map.values()).sort((a, b) => a.time - b.time) as { time: number; name: string }[];

  const dedupName: { time: number; name: string }[] = [];
  for (const k of out) {
    const last = dedupName[dedupName.length - 1];
    if (last && last.name === k.name) continue;
    dedupName.push(k);
  }

  if (nameAt0 != null) {
    const has0 = dedupName.some((k) => Math.abs(k.time - 0) <= 1e-6);
    if (!has0) dedupName.unshift({ time: 0, name: nameAt0 });
    const endIdx = dedupName.findIndex((k) => Math.abs(k.time - duration) <= 1e-6);
    if (endIdx >= 0) dedupName[endIdx] = { time: duration, name: nameAt0 };
    else dedupName.push({ time: duration, name: nameAt0 });
  }

  const finalSorted = dedupName.sort((a, b) => a.time - b.time);
  const finalOut: { time: number; name: string }[] = [];
  for (const k of finalSorted) {
    const last = finalOut[finalOut.length - 1];
    if (last && Math.abs(last.time - k.time) <= 1e-9) {
      finalOut[finalOut.length - 1] = k;
      continue;
    }
    if (last && last.name === k.name) continue;
    finalOut.push(k);
  }
  if (finalOut.length > 0 && !finalOut.some((k) => Math.abs(k.time - 0) <= 1e-6)) {
    const first = finalOut[0];
    if (first.time <= EXPORT_DT * 1.1) finalOut.unshift({ time: 0, name: first.name });
  }
  return finalOut;
}

function simulateParticle(
  system: ParticleSystemConfig,
  sprite: ParticleSprite | null,
  seed: number,
  attachmentBase: number,
  opts: { startDelay: number; maxDuration: number; loop?: boolean; loopDuration?: number; trimLifeToLoop?: boolean }
): ParticleSample {
  const rng = mulberry32(seed);
  const rngShape = mulberry32(seed ^ 0x9e3779b9);
  const life = Math.max(1e-3, lerp(system.lifetimeMin || 1, system.lifetimeMax || 1.5, rng()));
  let speed = lerp(system.speedMin || 0, system.speedMax || (system.speedMin || 0), rng());

  const startDelayRaw = Number.isFinite(opts.startDelay) ? opts.startDelay : 0;
  const loopDuration = Math.max(0, opts.loopDuration || 0);
  const isLoop = !!opts.loop && loopDuration > 1e-6;
  const startDelay = isLoop
    ? Math.max(-opts.maxDuration, Math.min(opts.maxDuration, startDelayRaw))
    : Math.max(0, Math.min(opts.maxDuration, startDelayRaw));

  const sysAngle = (system.systemRotationDeg || 0) * DEG2RAD;
  const sysRotCos = Math.cos(sysAngle);
  const sysRotSin = Math.sin(sysAngle);
  let emitAngle = sysAngle;

  let localPx = 0;
  let localPy = 0;

  const pathEnabled = !!(system as any).pathEnabled;
  const pathMode = ((system as any).pathMode || 'lock') as 'lock' | 'emitter';
  const pathType = ((system as any).pathType || 'circle') as 'circle' | 'ellipse' | 'custom';
  const pathClosed = (system as any).pathClosed !== false;
  const pathStartT = clamp01(Number((system as any).pathStartT ?? 0));
  const pathSpeedPx = Math.max(0, Number((system as any).pathSpeedPxPerSec ?? 360));
  const rawRx = Math.max(0, Number((system as any).pathRadiusX ?? 0));
  const rawRy = Math.max(0, Number((system as any).pathRadiusY ?? 0));
  const baseRx = rawRx > 0 ? rawRx : 120;
  const baseRy = rawRy > 0 ? rawRy : (pathType === 'circle' ? baseRx : baseRx);
  const radiusOffset = Number((system as any).pathRadiusOffset ?? 0);
  const thickness = Math.max(0, Number((system as any).pathThickness ?? 0));
  const radiusDelta = (rng() - 0.5) * thickness;
  const pathRx = Math.max(0, baseRx + radiusOffset + radiusDelta);
  const pathRy = Math.max(0, baseRy + radiusOffset + radiusDelta);
  const pathOmega = (((Number((system as any).pathSpeedDegPerSec ?? 0)) * DEG2RAD)) * ((system as any).pathReverse ? -1 : 1);
  const randomStart = (system as any).pathRandomStartAngle !== false;
  const baseStart = Number((system as any).pathStartAngleDeg ?? 0) * DEG2RAD;
  const hashToUnit01 = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10_000_000) / 10_000_000;
  };
  const emitterAngle0 = randomStart
    ? hashToUnit01(`${(system as any).id || ''}|${system.systemName || ''}|path`) * Math.PI * 2
    : baseStart;

  const emitterU0 = randomStart
    ? hashToUnit01(`${(system as any).id || ''}|${system.systemName || ''}|path_u`)
    : pathStartT;

  const wrap01 = (base: number) => {
    const f = base - Math.floor(base);
    return f < 0 ? f + 1 : f;
  };
  const pingpong01 = (base: number) => {
    const m = base - Math.floor(base / 2) * 2;
    if (m <= 1) return { u: m, dir: 1 };
    return { u: 2 - m, dir: -1 };
  };
  const normalizePathPoints = (points: any): { x: number; y: number; in: { x: number; y: number }; out: { x: number; y: number } }[] => {
    const base = (Array.isArray(points) ? points : [])
      .map((p: any) => {
        const x = Number(p?.x ?? 0);
        const y = Number(p?.y ?? 0);
        const ix = Number(p?.in?.x ?? 0);
        const iy = Number(p?.in?.y ?? 0);
        const ox = Number(p?.out?.x ?? 0);
        const oy = Number(p?.out?.y ?? 0);
        return {
          x: Number.isFinite(x) ? x : 0,
          y: Number.isFinite(y) ? y : 0,
          in: { x: Number.isFinite(ix) ? ix : 0, y: Number.isFinite(iy) ? iy : 0 },
          out: { x: Number.isFinite(ox) ? ox : 0, y: Number.isFinite(oy) ? oy : 0 },
        };
      });
    if (base.length >= 2) return base;
    return [{ x: -120, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }, { x: 120, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }];
  };
  const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  };
  const buildBezierSamples = (points: { x: number; y: number; in: { x: number; y: number }; out: { x: number; y: number } }[], closed: boolean, stepsPerSeg: number = 24) => {
    const segCount = closed ? points.length : points.length - 1;
    const samples: { x: number; y: number; cum: number }[] = [];
    let cum = 0;
    const push = (x: number, y: number) => {
      if (samples.length > 0) {
        const prev = samples[samples.length - 1];
        cum += Math.hypot(x - prev.x, y - prev.y);
      }
      samples.push({ x, y, cum });
    };
    for (let i = 0; i < segCount; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const p0x = a.x;
      const p0y = a.y;
      const p1x = a.x + (a.out?.x ?? 0);
      const p1y = a.y + (a.out?.y ?? 0);
      const p2x = b.x + (b.in?.x ?? 0);
      const p2y = b.y + (b.in?.y ?? 0);
      const p3x = b.x;
      const p3y = b.y;
      if (i === 0) push(p0x, p0y);
      for (let s = 1; s <= stepsPerSeg; s++) {
        const t = s / stepsPerSeg;
        const x = cubicAt(p0x, p1x, p2x, p3x, t);
        const y = cubicAt(p0y, p1y, p2y, p3y, t);
        push(x, y);
      }
    }
    const total = Math.max(1e-6, cum);
    return { samples, total };
  };
  const evalBezierSamples = (samples: { x: number; y: number; cum: number }[], total: number, closed: boolean, u01: number, dir: number) => {
    const u = closed ? wrap01(u01) : clamp01(u01);
    const target = u * total;
    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].cum < target) lo = mid + 1;
      else hi = mid;
    }
    const i1 = Math.max(1, lo);
    const i0 = i1 - 1;
    const a = samples[i0];
    const b = samples[i1];
    const span = Math.max(1e-6, b.cum - a.cum);
    const t = clamp01((target - a.cum) / span);
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const j0 = Math.max(0, i0 - 1);
    const j1 = Math.min(samples.length - 1, i1 + 1);
    let dx = samples[j1].x - samples[j0].x;
    let dy = samples[j1].y - samples[j0].y;
    const d = Math.hypot(dx, dy);
    let tx = d > 1e-6 ? dx / d : 1;
    let ty = d > 1e-6 ? dy / d : 0;
    if (dir < 0) {
      tx = -tx;
      ty = -ty;
    }
    return { x, y, tx, ty };
  };

  let initialAgeOffset = 0;
  const remaining = isLoop
    ? Math.max(0, opts.maxDuration - startDelay)
    : Math.max(0, opts.maxDuration - Math.max(0, startDelay));
  let simLife = Math.min(life, Math.max(1e-6, remaining));
  if (pathEnabled && pathMode === 'emitter') {
    initialAgeOffset = rng() * life;
    simLife = Math.max(1e-6, life - initialAgeOffset);
  }
  const customPoints = pathType === 'custom' ? normalizePathPoints((system as any).pathPoints) : [];
  const customBezier = pathType === 'custom' ? buildBezierSamples(customPoints, pathClosed, 24) : null;
  const customDuMag = customBezier ? (pathSpeedPx / Math.max(1e-6, customBezier.total)) : 0;
  const customRevSign = (system as any).pathReverse ? -1 : 1;

  let pathAngle = emitterAngle0;
  let pathU = emitterU0;
  let pathUDir = 1;
  let pathUOffset = 0;

  if (pathEnabled && pathMode === 'lock') {
    if (pathType !== 'custom' && randomStart) {
      pathAngle = rng() * Math.PI * 2;
    }
    if (pathType === 'custom' && randomStart) {
      pathU = rng();
    }
    if (pathType === 'custom' && !randomStart) {
      pathU = emitterU0;
    }
    pathUDir = pathClosed ? customRevSign : 1;
  }

  if (pathEnabled && pathMode === 'emitter') {
    if (pathType !== 'custom') {
      pathAngle = emitterAngle0 + pathOmega * startDelay - pathOmega * initialAgeOffset;
    } else {
      pathUOffset = -customDuMag * customRevSign * initialAgeOffset;
      const base = emitterU0 + customDuMag * customRevSign * startDelay + pathUOffset;
      const state = pathClosed ? { u: wrap01(base), dir: customRevSign } : pingpong01(base);
      pathU = state.u;
      pathUDir = state.dir;
    }
  }

  const shape = system.shape || { type: 'point', x: 0, y: 0 };
  const spiralMode = system.attractorEnabled && (system as any).attractorMode === 'spiral';
  const linearForceMode = system.attractorEnabled && !spiralMode && shape.type === 'point';
  if (pathEnabled && (pathMode === 'lock' || pathMode === 'emitter')) {
    if (pathType === 'custom') {
      const ev = evalBezierSamples(customBezier!.samples, customBezier!.total, pathClosed, pathU, pathUDir);
      const nx = -ev.ty;
      const ny = ev.tx;
      localPx = ev.x + nx * radiusDelta;
      localPy = ev.y + ny * radiusDelta;
      const tvxLocal = ev.tx * pathSpeedPx;
      const tvyLocal = ev.ty * pathSpeedPx;
      const vxWorld = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
      const vyWorld = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
      emitAngle = Math.atan2(vyWorld, vxWorld);
      speed = Math.hypot(vxWorld, vyWorld);
    } else {
      localPx = Math.cos(pathAngle) * pathRx;
      localPy = Math.sin(pathAngle) * pathRy;
      const tvxLocal = -Math.sin(pathAngle) * pathRx * pathOmega;
      const tvyLocal = Math.cos(pathAngle) * pathRy * pathOmega;
      const vxWorld = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
      const vyWorld = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
      emitAngle = Math.atan2(vyWorld, vxWorld);
    }
  } else if (linearForceMode) {
    if (!system.emissionAngleEnabled) {
      emitAngle = sysAngle + rng() * Math.PI * 2;
    } else {
      const offset = (system.emissionOffsetDeg || 0) * DEG2RAD;
      const spread = (system.emissionAngleDeg || 0) * DEG2RAD;
      emitAngle += offset + (rng() - 0.5) * spread;
    }
  } else {
    const inward = spiralMode ? !!(system as any).spiralInward : !!(shape as any).emitInward;
    const rRand = (spiralMode && inward) ? rngShape : rng;
    if (shape.type === 'circle') {
      const a = rRand() * Math.PI * 2;
      const rInner = shape.innerRadius || 0;
      const rOuter = shape.outerRadius || 30;
      const ri = Math.max(0, rInner);
      const ro = Math.max(ri, rOuter);
      const r = (spiralMode && inward) ? ro : Math.sqrt(rRand() * (ro * ro - ri * ri) + ri * ri);
      localPx += Math.cos(a) * r;
      localPy += Math.sin(a) * r;
      emitAngle = sysAngle + a + (inward ? Math.PI : 0);
    } else if (shape.type === 'rect') {
      const w0 = Math.max(1, shape.width || 100);
      const h0 = Math.max(1, shape.height || 100);
      const rectEdgeOnly = !!(shape as any).rectEdgeOnly;
      if (spiralMode && inward) {
        const t = rRand();
        const side = Math.floor(rRand() * 4);
        if (side === 0) { localPx += -w0 / 2; localPy += (t - 0.5) * h0; }
        else if (side === 1) { localPx += w0 / 2; localPy += (t - 0.5) * h0; }
        else if (side === 2) { localPx += (t - 0.5) * w0; localPy += -h0 / 2; }
        else { localPx += (t - 0.5) * w0; localPy += h0 / 2; }
      } else if (rectEdgeOnly) {
        const t = rRand();
        const side = Math.floor(rRand() * 4);
        if (side === 0) { localPx += -w0 / 2; localPy += (t - 0.5) * h0; }
        else if (side === 1) { localPx += w0 / 2; localPy += (t - 0.5) * h0; }
        else if (side === 2) { localPx += (t - 0.5) * w0; localPy += -h0 / 2; }
        else { localPx += (t - 0.5) * w0; localPy += h0 / 2; }
      } else {
        localPx += (rRand() - 0.5) * w0;
        localPy += (rRand() - 0.5) * h0;
      }
      if (!system.emissionAngleEnabled) {
        const randomDir = !!(shape as any).rectRandomDirection;
        emitAngle = randomDir ? sysAngle + rRand() * Math.PI * 2 : sysAngle;
      } else {
        const offset = (system.emissionOffsetDeg || 0) * DEG2RAD;
        const spread = (system.emissionAngleDeg || 0) * DEG2RAD;
        emitAngle = sysAngle + offset + (rRand() - 0.5) * spread;
      }
    } else if (shape.type === 'cone') {
      const rr = Math.max(0, shape.coneRadius || 150);
      const spread = (shape.coneAngleDeg || 45) * DEG2RAD;
      const aLocal = (rRand() - 0.5) * spread;
      const r = (spiralMode && inward) ? rr : (inward ? rr : Math.sqrt(rRand()) * rr);
      localPx += Math.cos(aLocal) * r;
      localPy += Math.sin(aLocal) * r;
      emitAngle = sysAngle + aLocal + (inward ? Math.PI : 0);
    } else {
      if (spiralMode) {
        const offset = (system.emissionOffsetDeg || 0) * DEG2RAD;
        const theta = system.emissionAngleEnabled ? offset : 0;
        const viewR = 256;
        const rawStart = inward ? Math.max(0, (system as any).spiralStartRadius ?? system.attractorRadius ?? viewR) : 1;
        const startR = Math.max(1, Math.min(viewR, rawStart));
        localPx += Math.cos(theta) * startR;
        localPy += Math.sin(theta) * startR;
        emitAngle = sysAngle + theta + (inward ? Math.PI : 0);
      } else {
        if (!system.emissionAngleEnabled) {
          emitAngle = sysAngle;
        } else {
          const offset = (system.emissionOffsetDeg || 0) * DEG2RAD;
          const spread = (system.emissionAngleDeg || 0) * DEG2RAD;
          emitAngle += offset + (rRand() - 0.5) * spread;
        }
      }
    }
  }

  let px = localPx * sysRotCos - localPy * sysRotSin;
  let py = localPx * sysRotSin + localPy * sysRotCos;

  let vx = Math.cos(emitAngle) * speed;
  let vy = Math.sin(emitAngle) * speed;
  if (pathEnabled && (pathMode === 'lock' || pathMode === 'emitter')) {
    if (pathType === 'custom') {
      const ev = evalBezierSamples(customBezier!.samples, customBezier!.total, pathClosed, pathU, pathUDir);
      const tvxLocal = ev.tx * pathSpeedPx;
      const tvyLocal = ev.ty * pathSpeedPx;
      vx = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
      vy = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
      speed = Math.hypot(vx, vy);
      emitAngle = Math.atan2(vy, vx);
    } else {
      const tvxLocal = -Math.sin(pathAngle) * pathRx * pathOmega;
      const tvyLocal = Math.cos(pathAngle) * pathRy * pathOmega;
      vx = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
      vy = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
      speed = Math.hypot(vx, vy);
      emitAngle = Math.atan2(vy, vx);
    }
  }
  const spiralInward = spiralMode && !!((system as any).spiralInward);
  const spiralEndR = spiralInward ? Math.max(0, (system as any).spiralEndRadius ?? 0) : 0;
  const spiralStartR = spiralInward ? Math.max(0, Math.hypot(px, py)) : 0;
  let spiralAngle = spiralInward ? Math.atan2(py, px) : 0;
  let spiralRadius = spiralInward ? spiralStartR : 0;

  const minTravelY = (!pathEnabled && system.noiseEnabled && system.noiseMode === 's_curve') ? Math.max(0, (system as any).minTravelY || 0) : 0;
  const gy = system.gravityEnabled ? (system.gravityY || 0) : 0;
  if (minTravelY > 0) {
    const expectedFromGravity = 0.5 * gy * life * life;
    const remain = minTravelY - Math.abs(expectedFromGravity);
    if (remain > 0) {
      const requiredAbsVy = remain / Math.max(1e-6, life);
      const dirY = Math.sin(emitAngle);
      const absDirY = Math.abs(dirY);
      const signY = dirY >= 0 ? 1 : -1;

      if (absDirY > 1e-3) {
        const requiredSpeed = requiredAbsVy / absDirY;
        const factor = requiredSpeed / Math.max(1e-6, speed);
        if (factor > 1) {
          speed *= factor;
          vx *= factor;
          vy *= factor;
        }
      } else {
        speed = Math.max(speed, requiredAbsVy);
        vx = 0;
        vy = signY * speed;
      }
    }
  }

  if (!system.attractorEnabled && (shape.type === 'circle' || (shape.type === 'cone' && (shape as any).emitInward))) {
    const dx = -px;
    const dy = -py;
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) {
      const dot = vx * dx + vy * dy;
      if (shape.type === 'circle') {
        const inward = !!(shape as any).emitInward;
        if ((inward && dot < 0) || (!inward && dot > 0)) {
          vx = -vx;
          vy = -vy;
        }
      } else if (shape.type === 'cone' && (shape as any).emitInward) {
        if (dot < 0) {
          vx = -vx;
          vy = -vy;
        }
      }
    }
  }

  const noiseFreq = system.noiseFrequency || 0.5;
  const noiseAmp = system.noiseIntensity || 100;
  const noisePhaseX = rng() * Math.PI * 2;
  const noisePhaseY = rng() * Math.PI * 2;
  const startPy = py;
  const expectedTravelY = Math.max(1e-6, Math.abs(vy) * life + 0.5 * Math.abs(gy) * life * life, minTravelY);

  const lockSpriteRotation = !!(system as any).lockSpriteRotation;
  let rotationDeg = lockSpriteRotation ? 0 : rng() * 360;
  const spinDegPerSec = lockSpriteRotation ? 0 : (system.particleSpinDegPerSec || 0);

  const baseColor = resolveBaseColor(sprite || undefined);
  const blendMode = resolveBlendMode(system, sprite || undefined);
  const attachmentName = sprite?.name || 'particle';
  const spriteOpacity = sprite ? Math.max(0, Math.min(1, Number((sprite as any).opacity ?? 1))) : 1;
    const spriteScale = sprite ? Math.max(0, Number((sprite as any).scale ?? 1)) : 1;
    const spriteScaleSeparate = sprite ? !!(sprite as any).scaleSeparate : false;
    const spriteScaleX = spriteScaleSeparate ? Math.max(0, Number((sprite as any).scaleX ?? spriteScale)) : spriteScale;
    const spriteScaleY = spriteScaleSeparate ? Math.max(0, Number((sprite as any).scaleY ?? spriteScale)) : spriteScale;

  const translateKeyframes: TimelineFrame[] = [];
  const scaleKeyframes: TimelineFrame[] = [];
  const rotateKeyframes: TimelineFrame[] = [];
  const colorKeyframes: TimelineFrame[] = [];

  const recordState = (localTime: number) => {
    const age = Math.max(0, Math.min(life, initialAgeOffset + localTime));
    const tNorm = clamp01(age / Math.max(1e-6, life));
    const yProgress = Math.abs(py - startPy);
    const yNorm = clamp01(yProgress / expectedTravelY);

    const systemScale = Number((system as any).systemScale ?? 1);
    const systemScaleSeparate = !!(system as any).systemScaleSeparate;
    const systemScaleX = systemScaleSeparate ? Number((system as any).systemScaleX ?? systemScale) : systemScale;
    const systemScaleY = systemScaleSeparate ? Number((system as any).systemScaleY ?? systemScale) : systemScale;

    const sizeSeparate = !!(system as any).sizeSeparate;
    const s0x = sizeSeparate ? Number((system as any).sizeStartX ?? system.sizeStart ?? 1) : Number(system.sizeStart ?? 1);
    const s1x = sizeSeparate ? Number((system as any).sizeEndX ?? system.sizeEnd ?? (system.sizeStart ?? 1)) : Number(system.sizeEnd ?? (system.sizeStart ?? 1));
    const s0y = sizeSeparate ? Number((system as any).sizeStartY ?? system.sizeStart ?? 1) : Number(system.sizeStart ?? 1);
    const s1y = sizeSeparate ? Number((system as any).sizeEndY ?? system.sizeEnd ?? (system.sizeStart ?? 1)) : Number(system.sizeEnd ?? (system.sizeStart ?? 1));
    const baseSizeX = lerp(s0x, s1x, tNorm);
    const baseSizeY = lerp(s0y, s1y, tNorm);
    const sizeFactor = system.useSizeCurve ? sampleCurve(system.sizeCurve, tNorm, 1, 1) : 1;
    const absoluteSizeX = baseSizeX * sizeFactor;
    const absoluteSizeY = baseSizeY * sizeFactor;
    const scaleBase = Math.max(1e-6, attachmentBase);
    const scaleValueX = (absoluteSizeX / scaleBase) * systemScaleX;
    const scaleValueY = (absoluteSizeY / scaleBase) * systemScaleY;

    const opacityRaw = system.useOpacityCurve ? clamp01(sampleCurve(system.opacityCurve, tNorm, 1, 0)) : lerp(system.opacityStart ?? 1, system.opacityEnd ?? 0, tNorm);
    const opacity = clamp01(opacityRaw) * spriteOpacity;
    const tint = getSpriteTintColor(sprite as any, tNorm) || baseColor;
    const rawTime = startDelay + localTime;
    const time = isLoop ? wrapTimeIntoDuration(rawTime, loopDuration) : rawTime;

    let drawPx = px;
    const drawPy = py;
    if (system.noiseEnabled && ((system as any).noiseMode || 'random') === 's_curve') {
      const cycles = Math.max(0, system.noiseFrequency || 0);
      const strengthMode = (system as any).sNoiseStrengthMode || 'linear';
      const mult = strengthMode === 'curve'
        ? Math.max(0, sampleCurve((system as any).sNoiseCurve, yNorm, 1, 1))
        : 1;
      const ampX = (system.noiseIntensity || 0) * mult;
      const offset = Math.sin(noisePhaseX + yNorm * cycles * Math.PI * 2) * ampX;
      drawPx += offset;
    }

    translateKeyframes.push(isLoop ? ({ time, x: drawPx * systemScaleX, y: -drawPy * systemScaleY, _rt: rawTime } as any) : ({ time, x: drawPx * systemScaleX, y: -drawPy * systemScaleY } as any));
    scaleKeyframes.push(isLoop ? ({ time, x: scaleValueX * spriteScaleX, y: scaleValueY * spriteScaleY, _rt: rawTime } as any) : ({ time, x: scaleValueX * spriteScaleX, y: scaleValueY * spriteScaleY } as any));
    colorKeyframes.push(isLoop ? ({ time, color: rgbWithAlpha(tint, opacity), _rt: rawTime } as any) : ({ time, color: rgbWithAlpha(tint, opacity) } as any));

    let dirVx = vx;
    let dirVy = vy;
    if (system.rotationMode === 'direction' && spiralInward && system.attractorEnabled && localTime <= 1e-9) {
      const predDt = Math.min(SIM_DT, EXPORT_DT);
      const turnsStrength = Math.max(0, Math.min(2000, Math.abs(system.attractorStrength || 0)));
      const turns = 1 + (turnsStrength / 2000) * 19;
      const sw = ((system as any).swirlStrength || 0);
      const dir = Math.abs(sw) < 1e-6 ? 1 : Math.sign(sw);
      const omega = dir * (Math.PI * 2 * turns) / Math.max(1e-6, life);
      const t1Norm = Math.max(0, Math.min(1, predDt / Math.max(1e-6, life)));
      const r1 = Math.max(spiralEndR, spiralStartR + (spiralEndR - spiralStartR) * t1Norm);
      const a1 = spiralAngle + omega * predDt;
      const nx = Math.cos(a1) * r1;
      const ny = Math.sin(a1) * r1;
      dirVx = (nx - px) / Math.max(1e-6, predDt);
      dirVy = (ny - py) / Math.max(1e-6, predDt);
    }
    const curRot = system.rotationMode === 'direction' ? Math.atan2(-dirVy, dirVx) * RAD2DEG : rotationDeg;
    const outRot = system.rotationMode === 'direction' ? curRot : -curRot;
    rotateKeyframes.push(isLoop ? ({ time, angle: outRot, _rt: rawTime } as any) : ({ time, angle: outRot } as any));
  };

  recordState(0);
  let simLocal = 0;
  let nextSample = EXPORT_DT;
  const forceZeroAt = isLoop && startDelay < 0 ? -startDelay : null;
  let forcedZero = false;
  while (simLocal < simLife - 1e-6) {
    const dt = Math.min(SIM_DT, simLife - simLocal);
    simLocal += dt;

    if (pathEnabled && (pathMode === 'lock' || pathMode === 'emitter')) {
      if (pathType === 'custom') {
        if (pathMode === 'emitter') {
          const base = emitterU0 + customDuMag * customRevSign * (startDelay + simLocal) + pathUOffset;
          const state = pathClosed ? { u: wrap01(base), dir: customRevSign } : pingpong01(base);
          pathU = state.u;
          pathUDir = state.dir;
        } else {
          if (pathClosed) {
            pathU = wrap01(pathU + customDuMag * customRevSign * dt);
            pathUDir = customRevSign;
          } else {
            pathU += pathUDir * customDuMag * dt;
            if (pathU > 1) {
              pathU = 2 - pathU;
              pathUDir = -pathUDir;
            }
            if (pathU < 0) {
              pathU = -pathU;
              pathUDir = -pathUDir;
            }
          }
        }

        const ev = evalBezierSamples(customBezier!.samples, customBezier!.total, pathClosed, pathU, pathUDir);
        const nx = -ev.ty;
        const ny = ev.tx;
        const lx = ev.x + nx * radiusDelta;
        const ly = ev.y + ny * radiusDelta;
        px = lx * sysRotCos - ly * sysRotSin;
        py = lx * sysRotSin + ly * sysRotCos;

        const tvxLocal = ev.tx * pathSpeedPx;
        const tvyLocal = ev.ty * pathSpeedPx;
        vx = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
        vy = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
      } else {
        pathAngle += pathOmega * dt;
        const lx = Math.cos(pathAngle) * pathRx;
        const ly = Math.sin(pathAngle) * pathRy;
        px = lx * sysRotCos - ly * sysRotSin;
        py = lx * sysRotSin + ly * sysRotCos;
        const tvxLocal = -Math.sin(pathAngle) * pathRx * pathOmega;
        const tvyLocal = Math.cos(pathAngle) * pathRy * pathOmega;
        vx = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
        vy = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
      }

      if (system.rotationMode !== 'direction') {
        rotationDeg += spinDegPerSec * dt;
      }

      if (!forcedZero && forceZeroAt != null && simLocal + 1e-6 >= forceZeroAt) {
        recordState(forceZeroAt);
        forcedZero = true;
      }
      if (simLocal + 1e-6 >= nextSample) {
        recordState(Math.min(simLocal, simLife));
        nextSample += EXPORT_DT;
      }
      continue;
    }

    if (spiralInward && system.attractorEnabled) {
      const prevPx = px;
      const prevPy = py;
      const tNorm = Math.max(0, Math.min(1, simLocal / Math.max(1e-6, life)));
      spiralRadius = Math.max(spiralEndR, spiralStartR + (spiralEndR - spiralStartR) * tNorm);
      const turnsStrength = Math.max(0, Math.min(2000, Math.abs(system.attractorStrength || 0)));
      const turns = 1 + (turnsStrength / 2000) * 19;
      const sw = ((system as any).swirlStrength || 0);
      const dir = Math.abs(sw) < 1e-6 ? 1 : Math.sign(sw);
      const omega = dir * (Math.PI * 2 * turns) / Math.max(1e-6, life);
      spiralAngle += omega * dt;
      px = Math.cos(spiralAngle) * spiralRadius;
      py = Math.sin(spiralAngle) * spiralRadius;
      vx = (px - prevPx) / Math.max(1e-6, dt);
      vy = (py - prevPy) / Math.max(1e-6, dt);

      if (system.rotationMode !== 'direction') {
        rotationDeg += spinDegPerSec * dt;
      }

      if (!forcedZero && forceZeroAt != null && simLocal + 1e-6 >= forceZeroAt) {
        recordState(forceZeroAt);
        forcedZero = true;
      }
      if (simLocal + 1e-6 >= nextSample) {
        recordState(Math.min(simLocal, life));
        nextSample += EXPORT_DT;
      }
      continue;
    }

    if (system.gravityEnabled) {
      vx += (system.gravityX || 0) * dt;
      vy += (system.gravityY || 0) * dt;
    }

    if (system.noiseEnabled && ((system as any).noiseMode || 'random') !== 's_curve') {
      const globalT = startDelay + simLocal;
      vx += Math.sin(noisePhaseX + globalT * noiseFreq) * noiseAmp * dt;
      vy += Math.cos(noisePhaseY + globalT * noiseFreq) * noiseAmp * dt;
    }

    if (system.dampingEnabled) {
      const factor = 1 - (system.targetSpeedRatio || 0.5) * dt;
      vx *= factor;
      vy *= factor;
    }

    if (system.attractorEnabled) {
      const dx = -px;
      const dy = -py;
      const d = Math.hypot(dx, dy);
      const rawR = system.attractorRadius || 0;
      let r = rawR > 0 ? rawR : Number.POSITIVE_INFINITY;
      if (spiralInward) {
        const startR = Math.max(0, (system as any).spiralStartRadius || 0);
        if (Number.isFinite(r)) r = Math.max(r, startR);
      }
      if (spiralInward && d <= spiralEndR) {
        const inv = d > 1e-6 ? 1 / d : 0;
        px = -dx * inv * spiralEndR;
        py = -dy * inv * spiralEndR;
        vx = 0;
        vy = 0;
      } else if (d < r) {
        const strength = system.attractorStrength || 0;
        const k = spiralInward ? Math.abs(strength) : strength;
        const nx = dx / Math.max(1e-6, d);
        const ny = dy / Math.max(1e-6, d);
        vx += nx * k * dt;
        vy += ny * k * dt;
        if ((system as any).attractorMode === 'spiral') {
          const tnx = -ny;
          const tny = nx;
          let swirl = ((system as any).swirlStrength || 0);
          if (spiralInward) {
            const startR = Math.max(d, spiralStartR || d);
            const denom = Math.max(1e-6, startR - spiralEndR);
            const t = Math.max(0, Math.min(1, (d - spiralEndR) / denom));
            swirl *= Math.max(0.2, t);
          }
          vx += tnx * swirl * dt;
          vy += tny * swirl * dt;
        }

        if (spiralInward) {
          const tNorm = Math.max(0, Math.min(1, simLocal / Math.max(1e-6, life)));
          const tEase = Math.sqrt(tNorm);
          const desired = spiralStartR + (spiralEndR - spiralStartR) * tEase;
          const err = d - desired;
          const vRad = vx * nx + vy * ny;
          const kp = 80;
          const kd = 24;
          const maxAccel = 8000;
          const acc = Math.max(-maxAccel, Math.min(maxAccel, err * kp - vRad * kd));
          vx += nx * acc * dt;
          vy += ny * acc * dt;
        }
      }
    }

    px += vx * dt;
    py += vy * dt;

    if (system.rotationMode !== 'direction') {
      rotationDeg += spinDegPerSec * dt;
    }

    if (!forcedZero && forceZeroAt != null && simLocal + 1e-6 >= forceZeroAt) {
      recordState(forceZeroAt);
      forcedZero = true;
    }
    if (simLocal + 1e-6 >= nextSample) {
      recordState(Math.min(simLocal, simLife));
      nextSample += EXPORT_DT;
    }
  }

  recordState(simLife);

  const rawEndTime = startDelay + simLife;
  const endTime = isLoop ? wrapTimeIntoDuration(rawEndTime, loopDuration) : rawEndTime;
  const shouldWriteKillKey = !isLoop || rawEndTime <= loopDuration + 1e-6;
  if (!isLoop) {
    if (shouldWriteKillKey) {
      scaleKeyframes.push({ time: endTime, x: 0, y: 0 } as any);
      colorKeyframes.push({ time: endTime, color: rgbWithAlpha(baseColor, 0) } as any);
    }
  } else {
    if (shouldWriteKillKey) {
      scaleKeyframes.push({ time: endTime, x: 0, y: 0, _rt: rawEndTime } as any);
      colorKeyframes.push({ time: endTime, color: rgbWithAlpha(baseColor, 0), _rt: rawEndTime } as any);
    }
  }

  const sortByTime = (arr: TimelineFrame[]) => arr.sort((a, b) => a.time - b.time);
  sortByTime(translateKeyframes);
  sortByTime(scaleKeyframes);
  sortByTime(rotateKeyframes);
  sortByTime(colorKeyframes);

  if (isLoop) {
    const wrapped = wrapAndDedupeTimelineGroup(
      { translate: translateKeyframes, scale: scaleKeyframes, rotate: rotateKeyframes, color: colorKeyframes },
      loopDuration,
      EXPORT_DT
    );
    translateKeyframes.splice(0, translateKeyframes.length, ...wrapped.translate);
    scaleKeyframes.splice(0, scaleKeyframes.length, ...wrapped.scale);
    rotateKeyframes.splice(0, rotateKeyframes.length, ...wrapped.rotate);
    colorKeyframes.splice(0, colorKeyframes.length, ...wrapped.color);
  }

  const pathDriven = pathEnabled && (pathMode === 'lock' || pathMode === 'emitter');
  const trEps = spiralInward ? 0.2 : (pathDriven ? 0.05 : 0.8);
  const trMax = spiralInward ? 160 : (pathDriven ? 240 : 80);
  let translate = quantizeFrames(pruneRedundantFrames(simplifyFrames2D(translateKeyframes, trEps, trMax), 'translate'), { kind: 'translate' });
  let scale = quantizeFrames(pruneRedundantFrames(simplifyFrames2D(scaleKeyframes, 0.004, 40), 'scale'), { kind: 'scale' });
  const rotateModeRich = system.rotationMode === 'direction' || Math.abs(system.particleSpinDegPerSec || 0) > 1e-6;
  const rotateSrc = unwrapAngles(rotateKeyframes);
  const rotateEps = (system.rotationMode === 'direction' && spiralInward)
    ? 0.2
    : (pathDriven ? 0.2 : (rotateModeRich ? 0.5 : 1.0));
  const rotateMax = (system.rotationMode === 'direction' && spiralInward)
    ? 160
    : (pathDriven ? 120 : (rotateModeRich ? 60 : 40));
  let rotate = quantizeFrames(pruneRedundantFrames(simplifyFrames1D(rotateSrc, 'angle', rotateEps, rotateMax), 'rotate'), { kind: 'rotate' });
  const hasSpriteLifecycle = (sprite as any)?.colorMode === 'lifecycle' && Array.isArray((sprite as any)?.colorStops) && (sprite as any).colorStops.length > 0;
  const color = pruneRedundantFrames(simplifyColor(colorKeyframes, hasSpriteLifecycle ? 1.5 : 3.0, hasSpriteLifecycle ? 60 : 40), 'color');

  translate = tryBezierEaseCompress2D(translate, translateKeyframes, trEps, 8);
  scale = tryBezierEaseCompress2D(scale, scaleKeyframes, 0.004, 8);
  rotate = tryBezierEaseCompress1D(rotate, rotateSrc, 'angle', rotateEps, 8);
  translate = stripTrivialConstTail(translate, 'translate');
  scale = stripTrivialConstTail(scale, 'scale');
  rotate = stripTrivialConstTail(rotate, 'rotate');

  const alpha255 = (c?: string) => {
    const s = String(c || '').trim();
    if (/^[0-9a-fA-F]{8}$/.test(s)) return parseInt(s.slice(6, 8), 16);
    return 255;
  };
  const lastVisibleTime = (() => {
    let t = -1;
    for (const k of color) {
      if (!k) continue;
      const tt = Number((k as any).time);
      if (!Number.isFinite(tt)) continue;
      if (alpha255((k as any).color) > VISIBILITY_ALPHA_HIDDEN_MAX) t = Math.max(t, tt);
    }
    return t;
  })();
  const tEq = (a: number, b: number) => Math.abs(a - b) <= 1e-6;
  const lastTime = (arr: TimelineFrame[]) => {
    let m = -1;
    for (const k of arr) {
      const tt = Number((k as any)?.time);
      if (Number.isFinite(tt)) m = Math.max(m, tt);
    }
    return m;
  };
  const ensureTail = (arr: TimelineFrame[], t: number, make: () => TimelineFrame) => {
    if (t < 0 || !arr.length) return;
    const lt = lastTime(arr);
    if (lt >= t - 0.02) return;
    if (arr.find((k) => tEq(Number((k as any).time), t))) return;
    arr.push(make());
    arr.sort((a, b) => Number((a as any).time) - Number((b as any).time));
  };
  if (lastVisibleTime >= 0) {
    if (scale.length) {
      const last = scale[scale.length - 1] as any;
      ensureTail(scale, lastVisibleTime, () => ({ time: lastVisibleTime, x: last.x, y: last.y }));
    }
    if (rotate.length) {
      const last = rotate[rotate.length - 1] as any;
      ensureTail(rotate, lastVisibleTime, () => ({ time: lastVisibleTime, angle: last.angle }));
    }
  }

  if (isLoop) {
    ensureLoopBoundaryFrames(translate, scale, rotate, color);
    ensureLoopHiddenAtStart(translate, scale, rotate, color, baseColor);
    ensureParticleLifecycleSteppedFrames(translate, scale, rotate, color, { loopDuration, startDelay, endRawTime: rawEndTime, baseColor });
    enforceSteppedOnVisibilityTransitions(color);
    ensureLoopSeamCarryOverAtStartFromEnd(translate, scale, rotate, color);
    ensureLoopSeamStepAtEndFromStart(translate, scale, rotate, color, loopDuration);
    enforceSteppedOnVisibilityTransitions(color);
    enforceTransformSteppedForAlphaZeroDrops(translate, scale, rotate, color);

    const alpha255 = (c?: string) => {
      const s = String(c || '').trim();
      if (/^[0-9a-fA-F]{8}$/.test(s)) return parseInt(s.slice(6, 8), 16);
      return 255;
    };
    const tEq = (a: number, b: number) => Math.abs(a - b) <= 1e-6;
    const atTime = (arr: TimelineFrame[], t: number) => arr.find((f) => tEq(f.time, t));
    const removeAtTime = (arr: TimelineFrame[], t: number) => {
      const i = arr.findIndex((f) => tEq(f.time, t));
      if (i >= 0) arr.splice(i, 1);
    };

    const c0 = atTime(color, 0);
    if (c0 && alpha255(c0.color) <= VISIBILITY_ALPHA_HIDDEN_MAX) {
      const lastVisibleTime = (() => {
        let t = -1;
        for (const k of color) {
          if (!k) continue;
          const tt = Number(k.time);
          if (!Number.isFinite(tt)) continue;
          if (alpha255((k as any).color) > VISIBILITY_ALPHA_HIDDEN_MAX) t = Math.max(t, tt);
        }
        return t;
      })();
      const shouldRemoveT = (arr: TimelineFrame[]) => {
        if (!arr.length) return false;
        const atEnd = atTime(arr, loopDuration);
        if (!atEnd) return false;
        let maxOther = -1;
        for (const k of arr) {
          if (!k) continue;
          const tt = Number(k.time);
          if (!Number.isFinite(tt)) continue;
          if (Math.abs(tt - loopDuration) <= 1e-6) continue;
          maxOther = Math.max(maxOther, tt);
        }
        if (lastVisibleTime >= 0 && maxOther >= 0 && maxOther < lastVisibleTime - 1e-6) return false;
        return true;
      };

      if (shouldRemoveT(translate)) removeAtTime(translate, loopDuration);
      if (shouldRemoveT(scale)) removeAtTime(scale, loopDuration);
      if (shouldRemoveT(rotate)) removeAtTime(rotate, loopDuration);
    }
  } else {
    ensureHiddenAtStart(translate, scale, rotate, color, baseColor);
  }

  translate.splice(0, translate.length, ...optimizeTimelineVerified(translate, 'translate'));
  scale.splice(0, scale.length, ...optimizeTimelineVerified(scale, 'scale'));
  rotate.splice(0, rotate.length, ...optimizeTimelineVerified(rotate, 'rotate'));
  color.splice(0, color.length, ...optimizeTimelineVerified(color, 'color'));

  translate.splice(0, translate.length, ...stripRedundantLastKey(translate, 'translate'));
  scale.splice(0, scale.length, ...stripRedundantLastKey(scale, 'scale'));
  rotate.splice(0, rotate.length, ...stripRedundantLastKey(rotate, 'rotate'));
  color.splice(0, color.length, ...stripRedundantLastKey(color, 'color'));

  stripCurveOnLast(translate);
  stripCurveOnLast(scale);
  stripCurveOnLast(color);
  stripCurveOnLast(rotate);

  {
    const alpha255 = (c?: string) => {
      const s = String(c || '').trim();
      if (/^[0-9a-fA-F]{8}$/.test(s)) return parseInt(s.slice(6, 8), 16);
      return 255;
    };
    let lastVis = -1;
    for (const k of color) {
      if (!k) continue;
      const tt = Number((k as any).time);
      if (!Number.isFinite(tt)) continue;
      if (alpha255((k as any).color) > VISIBILITY_ALPHA_HIDDEN_MAX) lastVis = Math.max(lastVis, tt);
    }
    if (lastVis >= 0) {
      const lastTime = (arr: TimelineFrame[]) => {
        let m = -1;
        for (const k of arr) {
          const tt = Number((k as any)?.time);
          if (Number.isFinite(tt)) m = Math.max(m, tt);
        }
        return m;
      };
      const tEq = (a: number, b: number) => Math.abs(a - b) <= 1e-6;
      const ensure = (arr: TimelineFrame[], make: () => TimelineFrame) => {
        if (!arr.length) return;
        const lt = lastTime(arr);
        if (lt >= lastVis - 0.02) return;
        if (arr.find((k) => tEq(Number((k as any).time), lastVis))) return;
        arr.push(make());
        arr.sort((a, b) => Number((a as any).time) - Number((b as any).time));
      };
      if (scale.length) {
        const last = scale[scale.length - 1] as any;
        ensure(scale, () => ({ time: lastVis, x: last.x, y: last.y }));
      }
      if (rotate.length) {
        const last = rotate[rotate.length - 1] as any;
        ensure(rotate, () => ({ time: lastVis, angle: last.angle }));
      }
    }
  }

  const stripRt = (arr: TimelineFrame[]) =>
    arr.map((f) => {
      const out: any = { ...f };
      delete out._rt;
      return out as TimelineFrame;
    });

  const translateOut = stripRt(translate);
  const scaleOut = stripRt(scale);
  const rotateOut = stripRt(rotate);
  const colorOut = stripRt(color);

  return { translate: translateOut, scale: scaleOut, rotate: rotateOut, color: colorOut, startDelay, life, lifeUsed: simLife, baseAttachment: attachmentName, blendMode };
}

/**
 * 将粒子样本按时间分槽，非重叠粒子共用同一 bone slot。
 * 仅用于 loop stream 动画，且仅 playback !== 'sequence' 时启用。
 *
 * @returns 每个元素是一组粒子（同一 bone slot 的粒子列表）
 */
function packParticlesIntoSlots(
  samples: ReturnType<typeof simulateParticle>[],
  loopDuration: number
): ReturnType<typeof simulateParticle>[][] {
  const T = loopDuration;
  const GAP = EXPORT_DT * 2; // 两粒子间最小间隔（2帧）

  // 按归一化的 startDelay 排序
  const sorted = [...samples].sort((a, b) => {
    const ta = ((a.startDelay % T) + T) % T;
    const tb = ((b.startDelay % T) + T) % T;
    return ta - tb;
  });

  const slots: ReturnType<typeof simulateParticle>[][] = [];
  // 记录每个 slot 已占用的区间列表（每个区间 [t0, t1]，t1 可能超过 T 表示跨边界）
  const slotIntervals: [number, number][][] = [];

  for (const p of sorted) {
    const t0 = ((p.startDelay % T) + T) % T;
    const t1 = t0 + p.lifeUsed; // 可能超过 T

    // 跨越 loop 边界的粒子（life > T，或粒子时间窗跨越 loop 终点）不参与复用
    // 因为其关键帧会被 wrapTimeIntoDuration 折叠到 [0,T]，与 mergeSlotTimelines
    // 的帧清理逻辑不兼容，强行合并会导致 Spine 中动画错乱。
    if (t1 > T + 1e-6) {
      slots.push([p]);
      slotIntervals.push([[t0, t1]]);
      continue;
    }

    // 检查该粒子是否与某个 slot 中的所有区间都不重叠（含 GAP）
    let assignedSlot = -1;
    for (let s = 0; s < slots.length; s++) {
      let canFit = true;
      for (const [es, ee] of slotIntervals[s]) {
        // 检查 [t0-GAP, t1+GAP] 是否与 [es, ee] 有重叠（循环空间）
        if (intervalsOverlapCircular(t0, t1, es, ee, T, GAP)) {
          canFit = false;
          break;
        }
      }
      if (canFit) {
        assignedSlot = s;
        break;
      }
    }

    if (assignedSlot === -1) {
      assignedSlot = slots.length;
      slots.push([]);
      slotIntervals.push([]);
    }

    slots[assignedSlot].push(p);
    slotIntervals[assignedSlot].push([t0, t1]);
  }

  return slots;
}

function intervalsOverlapCircular(
  a0: number, a1: number,
  b0: number, b1: number,
  T: number,
  gap: number
): boolean {
  // a: [a0, a1+gap], b: [b0-gap, b1+gap]
  // 在圆周 [0, T) 上检查重叠，将区间分解为线性子区间
  const as = a0;
  const ae = a1 + gap;
  const bs = Math.max(0, b0 - gap);
  const be = b1 + gap;

  const aSegs: [number, number][] = ae > T ? [[as, T], [0, ae - T]] : [[as, ae]];
  const bSegs: [number, number][] = be > T ? [[bs, T], [0, be - T]] : [[bs, be]];

  for (const [as2, ae2] of aSegs) {
    for (const [bs2, be2] of bSegs) {
      if (as2 < be2 && bs2 < ae2) return true;
    }
  }
  return false;
}

/**
 * 合并同一 bone slot 内多个粒子的 keyframe 时间线。
 *
 * 关键处理：
 * 1. 按归一化 startDelay 排序粒子
 * 2. 对非首位粒子，移除人工注入的 t=0 边界帧（ensureLoopHiddenAtStart 添加的）
 * 3. 拼接所有帧，按时间排序，dedup
 */
function mergeSlotTimelines(
  particles: ReturnType<typeof simulateParticle>[],
  loopDuration: number
): Pick<ReturnType<typeof simulateParticle>, 'translate' | 'scale' | 'rotate' | 'color'> {
  if (particles.length === 1) {
    const p = particles[0];
    return { translate: p.translate, scale: p.scale, rotate: p.rotate, color: p.color };
  }

  const T = loopDuration;

  // 按归一化 startDelay 排序
  const sorted = [...particles].sort((a, b) => {
    const ta = ((a.startDelay % T) + T) % T;
    const tb = ((b.startDelay % T) + T) % T;
    return ta - tb;
  });

  const allTranslate: TimelineFrame[] = [];
  const allScale: TimelineFrame[] = [];
  const allRotate: TimelineFrame[] = [];
  const allColor: TimelineFrame[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const isFirst = i === 0;
    const tNorm = ((p.startDelay % T) + T) % T;

    // 克隆帧数组（避免修改原始数据）
    let tr = p.translate.map(f => ({ ...f }));
    let sc = p.scale.map(f => ({ ...f }));
    let ro = p.rotate.map(f => ({ ...f }));
    let co = p.color.map(f => ({ ...f }));

    // 非首位粒子：移除人工注入的 t=0 边界帧
    // 判断标准：t≈0 且 curve='stepped'，且粒子本身并非在 t≈0 附近生成
    if (!isFirst && tNorm > EXPORT_DT * 2) {
      const isInjected0 = (f: TimelineFrame) => Math.abs(f.time) < EXPORT_DT * 0.5 && (f as any)._inj === 'hide0';
      tr = tr.filter((f) => !isInjected0(f));
      sc = sc.filter((f) => !isInjected0(f));
      ro = ro.filter((f) => !isInjected0(f));
      co = co.filter((f) => !isInjected0(f));
    }

    allTranslate.push(...tr);
    allScale.push(...sc);
    allRotate.push(...ro);
    allColor.push(...co);
  }

  // 按时间排序 + dedup
  const sortAndDedup = (arr: TimelineFrame[]) => {
    arr.sort((a, b) => a.time - b.time);
    return dedupeExactTimes(arr);
  };

  const translate = sortAndDedup(allTranslate);
  const scale = sortAndDedup(allScale);
  const rotate = sortAndDedup(allRotate);
  const color = sortAndDedup(allColor);

  const eps = 1e-6;
  const tEq = (a: number, b: number) => Math.abs(a - b) <= eps;
  const alpha255 = (c?: string) => {
    const s = String(c || '').trim();
    if (/^[0-9a-fA-F]{8}$/.test(s)) return parseInt(s.slice(6, 8), 16);
    return 255;
  };
  const alpha0 = (f?: TimelineFrame) => alpha255((f as any)?.color) <= 0;
  const isVisible = (f?: TimelineFrame) => alpha255((f as any)?.color) > VISIBILITY_ALPHA_HIDDEN_MAX;

  const sampleColorAt = (t: number) => {
    let prev: TimelineFrame | null = null;
    let next: TimelineFrame | null = null;
    for (const f of color) {
      if (!f) continue;
      if (tEq(f.time, t)) return String((f as any).color || 'ffffffff');
      if (f.time < t) {
        if (!prev || f.time > prev.time) prev = f;
      } else if (f.time > t) {
        if (!next || f.time < next.time) next = f;
      }
    }
    if (!prev) return next ? String((next as any).color || 'ffffffff') : 'ffffffff';
    if (!next) return String((prev as any).color || 'ffffffff');
    const denom = Math.max(1e-6, next.time - prev.time);
    const u = (t - prev.time) / denom;
    const a = parseRgba8888(String((prev as any).color || 'ffffffff'));
    const b = parseRgba8888(String((next as any).color || String((prev as any).color || 'ffffffff')));
    const toHex8 = (r: number, g: number, b2: number, a2: number) =>
      `${Math.round(Math.max(0, Math.min(255, r))).toString(16).padStart(2, '0')}${Math.round(Math.max(0, Math.min(255, g))).toString(16).padStart(2, '0')}${Math.round(Math.max(0, Math.min(255, b2))).toString(16).padStart(2, '0')}${Math.round(Math.max(0, Math.min(255, a2))).toString(16).padStart(2, '0')}`;
    return toHex8(lerp(a.r, b.r, u), lerp(a.g, b.g, u), lerp(a.b, b.b, u), lerp(a.a, b.a, u));
  };

  const upsertAt = (arr: TimelineFrame[], frame: TimelineFrame) => {
    const i = arr.findIndex((f) => tEq(f.time, frame.time));
    if (i >= 0) arr[i] = { ...(arr[i] as any), ...(frame as any) } as any;
    else arr.push(frame);
  };

  const setSteppedAt = (arr: TimelineFrame[], t: number) => {
    const i = arr.findIndex((f) => tEq(f.time, t));
    if (i >= 0) {
      const f = arr[i];
      if (f && f.curve !== 'stepped') arr[i] = { ...(f as any), curve: 'stepped' } as any;
      return;
    }
    const k = cloneNearestAtTime(arr, t);
    if (!k) return;
    arr.push({ ...(k as any), time: t, curve: 'stepped' } as any);
  };

  const ensureKeyAt = (arr: TimelineFrame[], t: number) => {
    if (arr.some((f) => tEq(f.time, t))) return;
    const k = cloneNearestAtTime(arr, t);
    if (!k) return;
    arr.push({ ...(k as any), time: t, curve: undefined } as any);
  };

  for (let i = 0; i < color.length - 1; i++) {
    const a = color[i];
    const b = color[i + 1];
    if (!a || !b) continue;
    if (!isVisible(a) || !alpha0(b)) continue;
    const tDeath = Number(b.time);
    if (!Number.isFinite(tDeath)) continue;
    const tStep = Math.max(0, tDeath - EXPORT_DT);

    upsertAt(color, { time: tStep, color: sampleColorAt(tStep), curve: 'stepped' } as any);
    if (a.curve === 'stepped' && !tEq(a.time, tStep)) color[i] = { ...(a as any), curve: undefined } as any;
    setSteppedAt(translate, tStep);
    setSteppedAt(scale, tStep);
    setSteppedAt(rotate, tStep);
    ensureKeyAt(translate, tDeath);
    ensureKeyAt(scale, tDeath);
    ensureKeyAt(rotate, tDeath);
  }

  translate.sort((a, b) => a.time - b.time);
  scale.sort((a, b) => a.time - b.time);
  rotate.sort((a, b) => a.time - b.time);
  color.sort((a, b) => a.time - b.time);
  translate.splice(0, translate.length, ...dedupeExactTimes(translate));
  scale.splice(0, scale.length, ...dedupeExactTimes(scale));
  rotate.splice(0, rotate.length, ...dedupeExactTimes(rotate));
  color.splice(0, color.length, ...dedupeExactTimes(color));

  translate.splice(0, translate.length, ...optimizeTimelineVerified(translate, 'translate'));
  scale.splice(0, scale.length, ...optimizeTimelineVerified(scale, 'scale'));
  rotate.splice(0, rotate.length, ...optimizeTimelineVerified(rotate, 'rotate'));
  color.splice(0, color.length, ...optimizeTimelineVerified(color, 'color'));

  translate.splice(0, translate.length, ...stripRedundantLastKey(translate, 'translate'));
  scale.splice(0, scale.length, ...stripRedundantLastKey(scale, 'scale'));
  rotate.splice(0, rotate.length, ...stripRedundantLastKey(rotate, 'rotate'));
  color.splice(0, color.length, ...stripRedundantLastKey(color, 'color'));

  stripCurveOnLast(translate);
  stripCurveOnLast(scale);
  stripCurveOnLast(rotate);
  stripCurveOnLast(color);

  return { translate, scale, rotate, color };
}

function normalizeSpineVersion(version: string) {
  const v = version.trim();
  if (v.startsWith('3.8')) return '3.8.99';
  if (v.startsWith('4.0')) return '4.0.64';
  if (v.startsWith('4.1')) return '4.1.24';
  if (v.startsWith('4.2')) return '4.2.19';
  return '3.8.99';
}

export function exportToSpine(
  systems: ParticleSystemConfig[],
  version: string = '3.8',
  opts?: { attachmentBases?: Record<string, number>; forceFullRate?: boolean; disablePooling?: boolean; explicitNativeSequenceAttachmentTimeline?: boolean }
) {
  const normalized = normalizeSpineVersion(version);
  const useLegacy38 = normalized.startsWith('3.8');
  const useSpineSequence = !useLegacy38 && (normalized.startsWith('4.1') || normalized.startsWith('4.2'));
  const exporterHash = `pe2_lifecycle_stepped_v9_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const attachmentBaseFor = (name: string) => {
    const v = opts?.attachmentBases?.[name];
    return Number.isFinite(v as any) && (v as any) > 1 ? Number(v) : ATTACHMENT_BASE_SIZE;
  };

  const data: {
    skeleton: Record<string, unknown>;
    bones: Record<string, unknown>[];
    slots: Record<string, unknown>[];
    skins: unknown;
    animations: { animation: { bones: Record<string, unknown>; slots: Record<string, unknown>; attachments?: Record<string, unknown> } };
  } = {
    skeleton: { hash: exporterHash, spine: normalized, fps: 60, x: 0, y: 0, width: 1024, height: 1024, images: './', audio: '' },
    bones: [{ name: 'root' }],
    slots: [],
    skins: useLegacy38 ? { default: {} } : [{ name: 'default', attachments: {} }],
    animations: { animation: { bones: {}, slots: {} } }
  };

  const anim = data.animations.animation;
  const stripInj = (arr: any) => {
    if (!Array.isArray(arr) || arr.length === 0) return arr;
    return arr.map((f) => {
      const out: any = { ...(f as any) };
      delete out._inj;
      if (typeof out.time === 'number' && Number.isFinite(out.time)) {
        if (Math.abs(out.time) <= 1e-9) {
          delete out.time;
        } else {
          const t = out.time;
          out.time = Math.floor(t * 10000 + 1e-9) / 10000;
        }
      }
      if (out.x === 0) delete out.x;
      if (out.y === 0) delete out.y;
      if (out.angle === 0) delete out.angle;
      return out;
    });
  };

  systems.forEach((system, sIdx) => {
    const genBoneName = `sys_${sIdx}_GEN`;
    data.bones.push({ name: genBoneName, parent: 'root', x: system.systemX, y: -(system.systemY || 0), rotation: 0, scaleX: 1, scaleY: 1 });

    const sprites = system.sprites || [];
    const playback = system.spritePlayback || 'single';
    const primarySequenceSprite =
      playback === 'sequence' &&
      sprites.length === 1 &&
      sprites[0]?.mode === 'sequence' &&
      Array.isArray((sprites[0] as any).frames) &&
      (sprites[0] as any).frames.length > 1
        ? (sprites[0] as any as ParticleSprite)
        : null;
    const useNativeSequence = useSpineSequence && !!primarySequenceSprite;
    const nativeSequenceAttachmentName = useNativeSequence && primarySequenceSprite ? makeSequenceAttachmentName(primarySequenceSprite) : null;
    const nativeSequenceBasePath = useNativeSequence && primarySequenceSprite ? makeSequenceBasePath(primarySequenceSprite) : null;
    const nativeSequenceCount =
      useNativeSequence && primarySequenceSprite && Array.isArray((primarySequenceSprite as any).frames)
        ? Math.max(0, (primarySequenceSprite as any).frames.length || 0)
        : 0;

    const sequenceFrames = (() => {
      if (playback !== 'sequence') return [];
      const frames: string[] = [];
      for (const sp of sprites) {
        if (sp?.mode === 'sequence' && Array.isArray((sp as any).frames) && (sp as any).frames.length > 0) {
          const list = (sp as any).frames as { name: string; dataUrl: string }[];
          for (let i = 0; i < list.length; i++) frames.push(makeSequenceFrameAttachmentName(sp, i));
          continue;
        }
        if (sp?.name) frames.push(sp.name);
      }
      return frames;
    })();
    const defaultAttachment = playback === 'sequence'
      ? (useNativeSequence ? (nativeSequenceAttachmentName || 'particle') : (sequenceFrames[0] || 'particle'))
      : (sprites[0]?.name || 'particle');

    const loopAnimEnabled = !!system.loopAnimation;
    const isLoop = loopAnimEnabled;
    const spiralMode = !!system.attractorEnabled && (system as any).attractorMode === 'spiral';
    const pathEnabled = !!(system as any).pathEnabled;
    const pathMode = String((system as any).pathMode || 'lock');
    const pathType = String((system as any).pathType || 'circle');
    const particleMaxLife = Math.max(0.1, Number(system.lifetimeMin) || 0, Number(system.lifetimeMax) || 0);
    const maxLife = Math.max(particleMaxLife, DEFAULT_DURATION);
    const streamEnd = system.streamDurationSec && system.streamDurationSec > 0 ? system.streamDurationSec : 0;
    const duration = (() => {
      if (loopAnimEnabled) {
        return Math.max(0.01, particleMaxLife);
      }
      if (system.loopDurationSec && Number(system.loopDurationSec) > 0) {
        return Math.max(0.01, Number(system.loopDurationSec));
      }
      return Math.max(0.01, system.mode === 'burst' ? maxLife : (streamEnd > 0 ? streamEnd + maxLife : maxLife));
    })();

    const loopDuration = (() => {
      if (!(isLoop && pathEnabled && pathMode === 'emitter')) return duration;

      let period = Number.POSITIVE_INFINITY;

      if (pathType !== 'custom') {
        const deg = Math.abs(Number((system as any).pathSpeedDegPerSec ?? 0));
        if (deg > 1e-6) period = 360 / deg;
      }

      if (!Number.isFinite(period) || period <= 1e-6) return duration;
      const min = Math.max(0.01, duration, period);
      const k = Math.max(1, Math.ceil(min / period));
      return Math.max(0.01, k * period);
    })();

    const rng = mulberry32((sIdx + 1) * 9973);

    const baseRate = Math.max(0, Number(system.rate || 0));
    const shouldAutoReduceExportRate =
      !opts?.forceFullRate &&
      playback === 'sequence' &&
      system.mode === 'stream' &&
      isLoop &&
      (system.streamDurationSec || 0) <= 0 &&
      duration > 0;
    const exportRate = shouldAutoReduceExportRate
      ? baseRate * 0.5
      : baseRate;

    const maxParticles = (system.mode === 'stream' && isLoop)
      ? Math.min(spiralMode ? 200 : 300, Math.max(1, Math.ceil(exportRate * (loopDuration + (pathEnabled ? particleMaxLife : maxLife)))))
      : 150;

    const spawnTimes: number[] = [];
    let loopWarmup = 0;
    if (system.mode === 'stream' && isLoop && (system.rate || 0) > 0) {
      const naturalInterval = 1 / Math.max(1e-6, exportRate || 0);
      const loopMaxParticles = maxParticles;

      loopWarmup = pathEnabled ? particleMaxLife : maxLife;

      const startT = -loopWarmup;
      const totalSpan = loopDuration + loopWarmup;
      // 若高速率模板触及上限，改用匀布间隔以覆盖完整 loop 周期，避免产生空白死区
      const interval = Math.max(naturalInterval, totalSpan / loopMaxParticles);

      for (let t = startT; t < loopDuration - 1e-6; t += interval) {
        spawnTimes.push(t);
        if (spawnTimes.length >= loopMaxParticles) break;
      }
      if (spawnTimes.length === 0) spawnTimes.push(0);
    } else {
      const count = Math.min(maxParticles, Math.max(1, system.mode === 'burst' ? Math.round(system.burstCount || 12) : Math.round((system.rate || 0) * loopDuration)));
      for (let i = 0; i < count; i++) spawnTimes.push(system.mode === 'stream' ? rng() * loopDuration : 0);
    }

    // 1. 收集所有样本
    interface ParticleSampleEntry {
      index: number;
      seed: number;
      chosenSprite: typeof sprites[0] | null;
      attachmentName: string;
      sample: ReturnType<typeof simulateParticle>;
    }
    const allSamples: ParticleSampleEntry[] = [];
    for (let i = 0; i < spawnTimes.length; i++) {
      const seed = (sIdx + 1) * 9973 + i * 151;
      const chosenSprite = playback === 'random' ? pickWeightedSprite(sprites, seed) : (sprites[0] || null);
      const attachmentName = playback === 'sequence' ? defaultAttachment : (chosenSprite?.name || 'particle');
      const sample = simulateParticle(system, chosenSprite, seed, attachmentBaseFor(attachmentName), {
        startDelay: spawnTimes[i],
        maxDuration: loopDuration + loopWarmup,
        loop: isLoop,
        loopDuration: isLoop ? loopDuration : undefined,
        trimLifeToLoop: false
      });
      if (sample.translate.length === 0 && sample.scale.length === 0 && sample.rotate.length === 0 && sample.color.length === 0) {
        continue;
      }
      allSamples.push({ index: i, seed, chosenSprite, attachmentName, sample });
    }

    // 2. 决定是否分槽
    // 只在 loop stream 且 playback='single' 时启用骨骼复用
    const canPool = !opts?.disablePooling && isLoop && playback === 'single' && allSamples.length > 1 && !spiralMode && !pathEnabled;
    const pooledSlots: ParticleSampleEntry[][] = canPool
      ? packParticlesIntoSlots(allSamples.map(s => s.sample), duration).map(
          slotSamples => slotSamples.map(s => allSamples.find(ps => ps.sample === s)!)
        )
      : allSamples.map(s => [s]);

    // 3. 按槽写入
    for (let slotIdx = 0; slotIdx < pooledSlots.length; slotIdx++) {
      const slotParticles = pooledSlots[slotIdx];
      if (slotParticles.length === 0) continue;

      const first = slotParticles[0];
      const boneName = `sys_${sIdx}_p_${canPool ? slotIdx : first.index}`;
      const slotName = boneName;

      // 合并时间线（单粒子 slot 直接使用原始数据）
      const merged = canPool && slotParticles.length > 1
        ? mergeSlotTimelines(slotParticles.map(s => s.sample), loopDuration)
        : { translate: first.sample.translate, scale: first.sample.scale, rotate: first.sample.rotate, color: first.sample.color };

      // 使用 first 的 attachmentName 和 blendMode（同一 slot 内粒子应相同）
      const attachmentName = first.attachmentName;
      const blendMode = first.sample.blendMode;

      data.bones.push({ name: boneName, parent: genBoneName, rotation: 0, scaleX: 1, scaleY: 1, x: 0, y: 0 });
      const slotDef: Record<string, unknown> = { name: slotName, bone: boneName, attachment: attachmentName, color: 'ffffff00' };
      if (blendMode !== 'normal') slotDef.blend = blendMode;
      data.slots.push(slotDef);

      const addAttachmentDef = (name: string, def?: Record<string, unknown>) => {
        const base = attachmentBaseFor(name);
        const payload = def ?? { x: 0, y: 0, rotation: 0, width: base, height: base };
        if (useLegacy38) {
          const skins = data.skins as any;
          if (!skins.default) skins.default = {};
          if (!skins.default[slotName]) skins.default[slotName] = {};
          skins.default[slotName][name] = payload;
          return;
        }
        const skins = data.skins as { name: string; attachments: Record<string, Record<string, unknown>> }[];
        if (!skins[0].attachments[slotName]) skins[0].attachments[slotName] = {};
        skins[0].attachments[slotName][name] = payload;
      };
      if (playback === 'sequence' && sprites.length > 0) {
        if (useNativeSequence && nativeSequenceAttachmentName && nativeSequenceBasePath && nativeSequenceCount > 0) {
          const base = attachmentBaseFor(nativeSequenceAttachmentName);
          addAttachmentDef(nativeSequenceAttachmentName, {
            x: 0,
            y: 0,
            rotation: 0,
            width: base,
            height: base,
            path: nativeSequenceBasePath,
            sequence: { count: nativeSequenceCount, start: 0, digits: 4, setup: 0 }
          });
          if (opts?.explicitNativeSequenceAttachmentTimeline && primarySequenceSprite) {
            for (let fi = 0; fi < nativeSequenceCount; fi++) {
              addAttachmentDef(makeSequenceFrameAttachmentName(primarySequenceSprite, fi));
            }
          }
        } else {
          for (const s of sprites) {
            if (s?.mode === 'sequence' && Array.isArray((s as any).frames) && (s as any).frames.length > 0) {
              const list = (s as any).frames as { name: string; dataUrl: string }[];
              for (let fi = 0; fi < list.length; fi++) {
                const name = makeSequenceFrameAttachmentName(s, fi);
                addAttachmentDef(name);
              }
              continue;
            }
            const name = s?.name || 'particle';
            addAttachmentDef(name);
          }
        }
      } else {
        addAttachmentDef(attachmentName);
      }

      const boneAnim: Record<string, unknown> = {};
      if (merged.translate.length) boneAnim.translate = stripInj(merged.translate);
      if (merged.scale.length) boneAnim.scale = stripInj(merged.scale);
      if (merged.rotate.length) boneAnim.rotate = stripInj(merged.rotate);
      if (Object.keys(boneAnim).length) anim.bones[boneName] = boneAnim;

      const slotAnimObj: Record<string, unknown> = {};
      if (merged.color.length) slotAnimObj.color = stripInj(merged.color);
      if (playback === 'sequence' && !canPool) {
        // sequence 模式单独处理（canPool=false）
        if (useNativeSequence && nativeSequenceAttachmentName && nativeSequenceCount > 0) {
          const seqOffset = (system.spriteSequenceRandom || shouldAutoReduceExportRate) && nativeSequenceCount > 0
            ? Math.floor(mulberry32(first.seed ^ 0x9e3779b9)() * nativeSequenceCount)
            : 0;
          const seq = buildSequenceTimelineKeyframes({
            startDelay: first.sample.startDelay,
            fps: system.spriteSequenceFps || 12,
            loop: !!system.spriteSequenceLoop,
            frameOffset: seqOffset,
            count: nativeSequenceCount,
            isLoopAnim: isLoop,
            duration
          });
          if (opts?.explicitNativeSequenceAttachmentTimeline && seq && seq.length && primarySequenceSprite) {
            const asAttach = (keys: { time?: number; mode?: string; index?: number; delay?: number }[]) => {
              const out: { time: number; name: string }[] = [];
              const count = nativeSequenceCount;
              const frameName = (idx: number) => makeSequenceFrameAttachmentName(primarySequenceSprite, idx);
              const tOf = (x: any) => {
                const t = x?.time;
                return typeof t === 'number' && Number.isFinite(t) ? t : 0;
              };
              const sorted = [...keys].sort((a, b) => tOf(a) - tOf(b));
              for (let ki = 0; ki < sorted.length; ki++) {
                const k = sorted[ki];
                const t0 = tOf(k);
                const t1 = ki + 1 < sorted.length ? tOf(sorted[ki + 1]) : duration;
                const mode = String(k.mode || 'hold');
                const idx0 = ((Math.floor(Number(k.index ?? 0)) % count) + count) % count;
                const delay = Math.max(1e-6, Number(k.delay ?? 0));
                if (mode === 'hold' || !(delay > 1e-6) || t1 <= t0 + 1e-9) {
                  out.push({ time: t0, name: frameName(idx0) });
                  continue;
                }
                const steps = Math.max(0, Math.ceil((t1 - t0) / delay - 1e-9));
                for (let s = 0; s < steps; s++) {
                  const tt = t0 + s * delay;
                  if (tt > t1 + 1e-9) break;
                  const idx = mode === 'loop' ? (idx0 + s) % count : Math.min(idx0 + s, count - 1);
                  out.push({ time: tt, name: frameName(idx) });
                }
              }
              if (duration > 1e-6) {
                const firstAt0 = out.find((x) => Math.abs(x.time - 0) <= 1e-6);
                if (!firstAt0 && out.length) out.unshift({ time: 0, name: out[0].name });
                const nameAt0 = firstAt0?.name || out[0]?.name;
                if (nameAt0) out.push({ time: duration, name: nameAt0 });
              }
              out.sort((a, b) => a.time - b.time);
              const dedup: typeof out = [];
              for (const f of out) {
                const last = dedup[dedup.length - 1];
                if (last && Math.abs(last.time - f.time) <= 1e-9) {
                  dedup[dedup.length - 1] = f;
                  continue;
                }
                if (last && last.name === f.name) continue;
                dedup.push(f);
              }
              return dedup;
            };
            const attach = asAttach(seq);
            if (attach.length) {
              const wrapped = isLoop ? wrapAndFinalizeAttachmentLoop(attach, duration) : attach;
              if (wrapped.length) slotAnimObj.attachment = wrapped;
            }
          }
          if (seq && seq.length) {
            if (!anim.attachments) anim.attachments = {};
            const root = anim.attachments as any;
            if (!root.default) root.default = {};
            if (!root.default[slotName]) root.default[slotName] = {};
            if (!root.default[slotName][nativeSequenceAttachmentName]) root.default[slotName][nativeSequenceAttachmentName] = {};
            root.default[slotName][nativeSequenceAttachmentName].sequence = stripInj(seq);
          }
        } else {
          const seqOffset = (system.spriteSequenceRandom || shouldAutoReduceExportRate) && sequenceFrames.length > 0
            ? Math.floor(mulberry32(first.seed ^ 0x9e3779b9)() * sequenceFrames.length)
            : 0;
          const attach = buildAttachmentTimeline({
            startDelay: first.sample.startDelay,
            life: first.sample.lifeUsed,
            frames: sequenceFrames.length ? sequenceFrames : [attachmentName],
            fps: system.spriteSequenceFps || 12,
            loop: !!system.spriteSequenceLoop,
            frameOffset: seqOffset
          });
          if (attach && attach.length) {
            if (isLoop) {
              const wrapped = wrapAndFinalizeAttachmentLoop(attach, duration);
              if (wrapped.length) slotAnimObj.attachment = wrapped;
            } else {
              slotAnimObj.attachment = attach;
            }
          }
        }
      }
      if (Object.keys(slotAnimObj).length) anim.slots[slotName] = slotAnimObj;
    }

    if (loopAnimEnabled) {
      anim.bones[genBoneName] = { translate: [{ time: 0, x: 0, y: 0 }, { time: loopDuration, x: 0, y: 0 }] };
    }
  });

  if (useLegacy38) sanitizeSpine38Data(data);
  return JSON.stringify(data);
}
