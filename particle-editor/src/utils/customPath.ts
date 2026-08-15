import type { PathPoint } from '../types';

export type BezierSamplePoint = { x: number; y: number; cum: number };

export function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function buildBezierSamples(points: PathPoint[], closed: boolean, stepsPerSeg = 24) {
  const pts = points;
  const segCount = closed ? pts.length : pts.length - 1;
  const samples: BezierSamplePoint[] = [];
  let cum = 0;

  const push = (x: number, y: number) => {
    if (samples.length > 0) {
      const prev = samples[samples.length - 1];
      cum += Math.hypot(x - prev.x, y - prev.y);
    }
    samples.push({ x, y, cum });
  };

  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
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
}

function wrap01(base: number) {
  const f = base - Math.floor(base);
  return f < 0 ? f + 1 : f;
}

export function evalBezierSamples(samples: BezierSamplePoint[], total: number, closed: boolean, u01: number) {
  const u = closed ? wrap01(u01) : Math.max(0, Math.min(1, u01));
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
  const t = Math.max(0, Math.min(1, (target - a.cum) / span));
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;

  const j0 = Math.max(0, i0 - 1);
  const j1 = Math.min(samples.length - 1, i1 + 1);
  const dx = samples[j1].x - samples[j0].x;
  const dy = samples[j1].y - samples[j0].y;
  const d = Math.hypot(dx, dy);
  const tx = d > 1e-6 ? dx / d : 1;
  const ty = d > 1e-6 ? dy / d : 0;
  return { x, y, tx, ty, total };
}

export function computeUniformPathU(sampleIndex: number, sampleCount: number, closed: boolean) {
  const n = Math.max(1, Math.floor(sampleCount));
  if (n === 1) return 0.5;
  if (closed) return sampleIndex / n;
  return sampleIndex / Math.max(1, n - 1);
}
