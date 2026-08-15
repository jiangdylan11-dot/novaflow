import type { ParticleSystemConfig, Key1D, PathPoint } from '../types';
import { buildBezierSamples, computeUniformPathU, evalBezierSamples } from '../utils/customPath';

export class ParticleEngine {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private viewportRect: { x: number; y: number; w: number; h: number } | null = null;
  private particles: {
    x: number;
    y: number;
    startY: number;
    startR?: number;
    spiralRadius?: number;
    spiralAngle?: number;
    pathAngle?: number;
    pathRadiusDelta?: number;
    pathU?: number;
    pathDir?: number;
    pathUOffset?: number;
    expectedTravelY: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    rot: number;
    rotVel: number;
    nx: number;
    ny: number;
    dirX: number;
    dirY: number;
    spriteIndex: number;
    seqOffset: number;
  }[] = [];
  private lastTime = 0;
  private acc = 0;
  private burstAcc = 0;
  private running = false;
  private cfg: ParticleSystemConfig;
  private elapsed = 0;
  private spriteImages: HTMLImageElement[] = [];
  private spriteFrameStarts: number[] = [];
  private spriteFrameCounts: number[] = [];
  private streamPrevLocal = 0;
  private streamLocal = 0;
  private streamLoopDuration = 0;
  private streamLoopEnabled = false;
  private tintedSpriteCache = new Map<string, HTMLCanvasElement>();
  private pathEmitterAngle0 = 0;
  private pathEmitterU0 = 0;
  private pathEmitIndex = 0;
  private rngSeed: number | null = null;
  private rngResetOnLoop = false;
  private rng: (() => number) | null = null;
  private customPathCache: null | {
    key: string;
    total: number;
    samples: { x: number; y: number; cum: number }[];
  } = null;

  private resolveWarmupSeconds(cfg: ParticleSystemConfig) {
    if (!cfg.warmupEnabled) return 0;
    const raw = Number(cfg.warmupSeconds ?? 0);
    if (Number.isFinite(raw) && raw > 0) return Math.min(10, Math.max(0, raw));
    const auto = Math.max(0, Number(cfg.lifetimeMax ?? 0) * 2);
    return Math.min(10, Math.max(0, auto));
  }

  constructor(ctx: CanvasRenderingContext2D, cfg: ParticleSystemConfig, options?: { seed?: number; resetSeedOnLoop?: boolean }) {
    this.ctx = ctx;
    this.cfg = cfg;
    if (Number.isFinite(options?.seed as any)) {
      this.rngSeed = Math.floor(Number(options?.seed) || 0);
      this.rngResetOnLoop = !!options?.resetSeedOnLoop;
      this.rng = this.mulberry32(this.rngSeed);
    }
    this.resize();
  }

  setViewportRect(rect: { x: number; y: number; w: number; h: number } | null) {
    if (!rect) {
      this.viewportRect = null;
      return;
    }
    const w = Math.max(0, rect.w);
    const h = Math.max(0, rect.h);
    if (w <= 0 || h <= 0) {
      this.viewportRect = null;
      return;
    }
    this.viewportRect = { x: rect.x, y: rect.y, w, h };
  }

  updateConfig(cfg: ParticleSystemConfig) {
    const prevSpriteKey = this.makeSpriteKey(this.cfg);
    const prevDynKey = this.makeDynamicsKey(this.cfg);
    this.cfg = cfg;
    const nextSpriteKey = this.makeSpriteKey(this.cfg);
    const nextDynKey = this.makeDynamicsKey(this.cfg);
    if (prevSpriteKey !== nextSpriteKey) this.tintedSpriteCache.clear();
    if (prevSpriteKey !== nextSpriteKey) this.rebuildSpriteFrameRanges();
    if (prevDynKey !== nextDynKey) this.reset(this.cfg);
  }

  setSprites(images: HTMLImageElement[]) {
    this.spriteImages = images;
    this.tintedSpriteCache.clear();
    this.rebuildSpriteFrameRanges();
  }

  private rebuildSpriteFrameRanges() {
    const sprites = this.cfg.sprites || [];
    const playback = this.cfg.spritePlayback || 'single';

    if (sprites.length === 0 || this.spriteImages.length === 0) {
      this.spriteFrameStarts = [];
      this.spriteFrameCounts = [];
      return;
    }

    if (playback === 'sequence' && sprites.length === 1 && this.spriteImages.length > 1) {
      this.spriteFrameStarts = [0];
      this.spriteFrameCounts = [this.spriteImages.length];
      return;
    }

    let cursor = 0;
    const starts: number[] = [];
    const counts: number[] = [];
    for (const s of sprites as any[]) {
      let count = 1;
      if (playback === 'sequence' && Array.isArray(s?.frames) && s.frames.length > 0) {
        count = s.frames.length;
      }
      starts.push(cursor);
      counts.push(count);
      cursor += count;
    }

    if (cursor !== this.spriteImages.length) {
      this.spriteFrameStarts = sprites.map((_, i) => i);
      this.spriteFrameCounts = sprites.map(() => 1);
      return;
    }

    this.spriteFrameStarts = starts;
    this.spriteFrameCounts = counts;
  }

  reset(cfg: ParticleSystemConfig, options?: { draw?: boolean; clear?: boolean }) {
    this.cfg = cfg;
    this.particles = [];
    this.acc = 0;
    this.burstAcc = 0;
    this.elapsed = 0;
    this.streamPrevLocal = 0;
    this.streamLocal = 0;
    this.streamLoopDuration = 0;
    this.streamLoopEnabled = false;
    this.pathEmitterAngle0 = this.resolveEmitterStartAngle(cfg);
    this.pathEmitterU0 = this.resolveEmitterStartU(cfg);
    this.pathEmitIndex = 0;
    if (this.rngSeed != null) this.rng = this.mulberry32(this.rngSeed);
    if (cfg.mode === 'burst') this.spawn(cfg.burstCount);

    const warm = this.resolveWarmupSeconds(cfg);
    if (warm > 1e-6) {
      const simDt = 1 / 60;
      const steps = Math.floor(warm / simDt);
      for (let i = 0; i < steps; i++) this.stepInternal(simDt, false, false);
      const rem = warm - steps * simDt;
      if (rem > 1e-6) this.stepInternal(rem, false, false);
    }
    const shouldDraw = options?.draw !== false;
    if (shouldDraw) this.draw({ clear: options?.clear !== false });
  }

  private hashToUnit01(s: string) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10_000_000) / 10_000_000;
  }

  private mulberry32(seed: number) {
    return function () {
      seed |= 0;
      seed = seed + 0x6d2b79f5 | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private rand() {
    return this.rng ? this.rng() : Math.random();
  }

  private getLoopedElapsed() {
    if (this.streamLoopEnabled && this.streamLoopDuration > 1e-6) return this.streamLocal;
    return this.elapsed;
  }

  private resolveEmitterStartAngle(cfg: ParticleSystemConfig) {
    const baseStart = ((cfg.pathStartAngleDeg || 0) * Math.PI) / 180;
    if (cfg.pathRandomStartAngle === false) return baseStart;
    const key = `${cfg.id || ''}|${cfg.systemName || ''}|path`;
    return this.hashToUnit01(key) * Math.PI * 2;
  }

  private resolveEmitterStartU(cfg: ParticleSystemConfig) {
    const startT = Math.max(0, Math.min(1, Number(cfg.pathStartT ?? 0)));
    if (cfg.pathRandomStartAngle === false) return startT;
    const key = `${cfg.id || ''}|${cfg.systemName || ''}|path_u`;
    return this.hashToUnit01(key);
  }

  private wrap01(base: number) {
    const f = base - Math.floor(base);
    return f < 0 ? f + 1 : f;
  }

  private pingpong01(base: number) {
    const m = base - Math.floor(base / 2) * 2;
    if (m <= 1) return { u: m, dir: 1 };
    return { u: 2 - m, dir: -1 };
  }

  private normalizePathPoints(points: any): (PathPoint & { in: { x: number; y: number }; out: { x: number; y: number } })[] {
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
          out: { x: Number.isFinite(ox) ? ox : 0, y: Number.isFinite(oy) ? oy : 0 }
        };
      });
    if (base.length >= 2) return base;
    return [{ x: -120, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }, { x: 120, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }];
  }

  private getCustomPathCache(cfg: ParticleSystemConfig) {
    const closed = cfg.pathClosed !== false;
    const pts = this.normalizePathPoints(cfg.pathPoints);
    const key = `${closed ? 1 : 0}|${(cfg.pathPoints || []).map((p: any) => `${Number(p?.x ?? 0).toFixed(2)},${Number(p?.y ?? 0).toFixed(2)},${Number(p?.in?.x ?? 0).toFixed(2)},${Number(p?.in?.y ?? 0).toFixed(2)},${Number(p?.out?.x ?? 0).toFixed(2)},${Number(p?.out?.y ?? 0).toFixed(2)}`).join(';')}`;
    if (this.customPathCache?.key === key) return this.customPathCache;
    const built = buildBezierSamples(pts, closed, 24);
    this.customPathCache = { key, total: built.total, samples: built.samples };
    return this.customPathCache;
  }

  private evalCustomPath(cfg: ParticleSystemConfig, u01: number) {
    const closed = cfg.pathClosed !== false;
    const cache = this.getCustomPathCache(cfg);
    return evalBezierSamples(cache.samples, cache.total, closed, u01);
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      const dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      this.step(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  resize() {
    const c = this.ctx.canvas;
    this.width = c.clientWidth || c.width;
    this.height = c.clientHeight || c.height;
    if (c.width !== this.width || c.height !== this.height) {
      c.width = this.width;
      c.height = this.height;
    }
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private clamp01(n: number) {
    return Math.max(0, Math.min(1, n));
  }

  private hexToRgb(hex: string) {
    const h = String(hex || '').trim().toLowerCase().replace('#', '');
    if (h.length !== 6) return { r: 255, g: 255, b: 255 };
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return {
      r: Number.isFinite(r) ? r : 255,
      g: Number.isFinite(g) ? g : 255,
      b: Number.isFinite(b) ? b : 255
    };
  }

  private toHex2(n: number) {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  }

  private rgbToHex(r: number, g: number, b: number) {
    return `#${this.toHex2(r)}${this.toHex2(g)}${this.toHex2(b)}`;
  }

  private lerpHex(a: string, b: string, t: number) {
    const A = this.hexToRgb(a);
    const B = this.hexToRgb(b);
    return this.rgbToHex(this.lerp(A.r, B.r, t), this.lerp(A.g, B.g, t), this.lerp(A.b, B.b, t));
  }

  private normalizeColorStops(stops: any, fallback: string) {
    const base = (Array.isArray(stops) ? stops : [])
      .map((s) => ({ t: this.clamp01(Number(s?.t ?? 0)), color: String(s?.color || fallback) }))
      .sort((a, b) => a.t - b.t);
    const first = base.find((s) => s.t <= 0 + 1e-6) || { t: 0, color: fallback };
    const last = base.find((s) => s.t >= 1 - 1e-6) || { t: 1, color: fallback };
    const mids = base.filter((s) => s.t > 1e-6 && s.t < 1 - 1e-6);
    return [{ t: 0, color: first.color }, ...mids, { t: 1, color: last.color }];
  }

  private sampleColorStops(stops: { t: number; color: string }[], t: number) {
    const s = this.normalizeColorStops(stops, '#ffffff');
    const x = this.clamp01(t);
    let prev = s[0];
    for (let i = 1; i < s.length; i++) {
      const next = s[i];
      if (x <= next.t + 1e-9) {
        const span = Math.max(1e-9, next.t - prev.t);
        const lt = this.clamp01((x - prev.t) / span);
        return this.lerpHex(prev.color, next.color, lt);
      }
      prev = next;
    }
    return s[s.length - 1].color;
  }

  private getSpriteTintColor(sprite: any, lifeT: number) {
    if (!sprite) return null;
    const mode = sprite.colorMode || 'fixed';
    const fallback = String(sprite.color || '#ffffff');
    if (mode !== 'lifecycle') return fallback;
    const stops = this.normalizeColorStops(sprite.colorStops, fallback);
    const q = Math.round(this.clamp01(lifeT) * 32) / 32;
    return this.sampleColorStops(stops, q);
  }

  private sample1D(curve: Key1D[], t: number): number {
    if (!curve || curve.length === 0) return 1;
    const sorted = [...curve].sort((a, b) => a.t - b.t);
    if (t <= sorted[0].t) return sorted[0].v;
    if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (t >= sorted[i].t && t <= sorted[i+1].t) {
        const denom = (sorted[i+1].t - sorted[i].t);
        if (Math.abs(denom) < 1e-6) return sorted[i+1].v;
        const ratio = (t - sorted[i].t) / denom;
        return this.lerp(sorted[i].v, sorted[i+1].v, ratio);
      }
    }
    return 1;
  }

  private getTintedSprite(img: HTMLImageElement, colorHex: string) {
    const hex = (colorHex || '#ffffff').trim().toLowerCase();
    if (hex === '#ffffff' || hex === 'ffffff') return null;
    const key = `${img.src}::${hex}`;
    const cached = this.tintedSpriteCache.get(key);
    if (cached) return cached;

    const w = Math.max(1, img.naturalWidth || img.width || 1);
    const h = Math.max(1, img.naturalHeight || img.height || 1);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = hex.startsWith('#') ? hex : `#${hex}`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    this.tintedSpriteCache.set(key, c);
    return c;
  }

  private makeSpriteKey(cfg: ParticleSystemConfig) {
    const sprites = cfg.sprites || [];
    const playback = cfg.spritePlayback || 'single';
    const fps = cfg.spriteSequenceFps || 0;
    const loop = cfg.spriteSequenceLoop ? 1 : 0;
    const seqRandom = cfg.spriteSequenceRandom ? 1 : 0;
    const seqFrames = (() => {
      if (playback !== 'sequence') return 0;
      if (sprites.length !== 1) return 0;
      const first: any = sprites[0] as any;
      const frames = first?.frames;
      return Array.isArray(frames) ? frames.length : 0;
    })();
    const parts: string[] = [playback, String(fps), String(loop), String(seqRandom), String(sprites.length), String(seqFrames)];
    for (const s of sprites) {
      const frameCount = Array.isArray((s as any)?.frames) ? (s as any).frames.length : 0;
      const cs = Array.isArray((s as any)?.colorStops) ? JSON.stringify((s as any).colorStops) : '';
      parts.push(`${s.id}|${s.dataUrl}|${s.colorMode}|${s.color}|${cs}|${s.blendMode}|${s.weight}|${s.name}|${frameCount}`);
    }
    return parts.join('::');
  }

  private getEffectiveSpriteCount() {
    const sprites = this.cfg.sprites || [];
    const playback = this.cfg.spritePlayback || 'single';
    if (playback !== 'sequence') return sprites.length;
    if (!this.cfg.spriteSequenceRandom) {
      const hasSeq = sprites.some((s: any) => Array.isArray(s?.frames) && s.frames.length > 0);
      if (hasSeq && this.spriteImages.length > 1) return this.spriteImages.length;
    }
    if (sprites.length === 1 && this.spriteImages.length > 1) return this.spriteImages.length;
    return sprites.length;
  }

  private getPrimarySequenceSpriteIndex() {
    const sprites = this.cfg.sprites || [];
    for (let i = 0; i < sprites.length; i++) {
      const s: any = sprites[i] as any;
      if (Array.isArray(s?.frames) && s.frames.length > 0) return i;
    }
    return sprites.length > 0 ? 0 : -1;
  }

  private getSequenceFrameCountForSprite(spriteIndex: number) {
    if (this.spriteFrameCounts.length > 0) {
      return Math.max(1, this.spriteFrameCounts[Math.max(0, Math.min(this.spriteFrameCounts.length - 1, spriteIndex))] || 1);
    }
    return Math.max(1, this.getEffectiveSpriteCount() || 1);
  }

  private pickWeightedSpriteIndex(sprites: ParticleSystemConfig['sprites']) {
    if (!sprites || sprites.length === 0) return 0;
    let sum = 0;
    for (const s of sprites) sum += Math.max(0, s.weight ?? 0);
    if (sum <= 1e-6) return Math.floor(this.rand() * sprites.length);
    let r = this.rand() * sum;
    for (let i = 0; i < sprites.length; i++) {
      r -= Math.max(0, sprites[i].weight ?? 0);
      if (r <= 0) return i;
    }
    return sprites.length - 1;
  }

  private makeDynamicsKey(cfg: ParticleSystemConfig) {
    const parts = [
      cfg.attractorEnabled ? '1' : '0',
      cfg.attractorMode || 'linear',
      cfg.radialInward ? '1' : '0',
      cfg.spiralInward ? '1' : '0',
      String(cfg.spiralStartRadius || 0),
      String(cfg.spiralEndRadius || 0),
      String(cfg.attractorRadius || 0),
      cfg.noiseEnabled ? '1' : '0',
      cfg.noiseMode || 'random',
      cfg.sNoiseStrengthMode || 'linear',
      String(cfg.noiseFrequency || 0),
      String(cfg.noiseIntensity || 0),
      (cfg.sNoiseCurve || []).map((p) => `${p.t.toFixed(3)},${p.v.toFixed(3)}`).join(';'),
      String(cfg.minTravelY || 0),
      cfg.emissionAngleEnabled ? '1' : '0',
      String(cfg.emissionAngleDeg || 0),
      String(cfg.emissionOffsetDeg || 0),
      String(cfg.gravityEnabled ? (cfg.gravityX || 0) : 0),
      String(cfg.gravityEnabled ? (cfg.gravityY || 0) : 0),
      String(cfg.speedMin || 0),
      String(cfg.speedMax || 0),
      cfg.warmupEnabled ? '1' : '0',
      String(cfg.warmupSeconds ?? 0),
      cfg.pathEnabled ? '1' : '0',
      cfg.pathMode || 'lock',
      cfg.pathType || 'circle',
      cfg.pathClosed === false ? '0' : '1',
      String(cfg.pathStartT ?? 0),
      String(cfg.pathSpeedPxPerSec ?? 0),
      (cfg.pathPoints || []).map((p: any) => `${Number(p?.x ?? 0).toFixed(2)},${Number(p?.y ?? 0).toFixed(2)},${Number(p?.in?.x ?? 0).toFixed(2)},${Number(p?.in?.y ?? 0).toFixed(2)},${Number(p?.out?.x ?? 0).toFixed(2)},${Number(p?.out?.y ?? 0).toFixed(2)}`).join(';'),
      String(cfg.pathRadiusX || 0),
      String(cfg.pathRadiusY || 0),
      String(cfg.pathRadiusOffset || 0),
      String(cfg.pathThickness || 0),
      String(cfg.pathSpeedDegPerSec || 0),
      cfg.pathReverse ? '1' : '0',
      cfg.pathRandomStartAngle === false ? '0' : '1',
      String(cfg.pathStartAngleDeg || 0),
      String(cfg.pathEmitSampleCount ?? 0),
      String(cfg.pathEmitSideMode || 'left'),
      String(cfg.pathEmitBothSideRatioLeft ?? 0.5),
      (cfg as any).pathEmitFacingEnabled ? '1' : '0',
      String((cfg as any).pathEmitFacingDeg ?? 0),
      `${cfg.shape?.type || 'point'}:${((cfg.shape?.type === 'circle' || cfg.shape?.type === 'cone') && cfg.shape?.emitInward) ? 1 : 0}:${cfg.shape?.innerRadius || 0}:${cfg.shape?.outerRadius || 0}:${cfg.shape?.width || 0}:${cfg.shape?.height || 0}:${cfg.shape?.coneRadius || 0}:${cfg.shape?.coneAngleDeg || 0}:${(cfg.shape as any)?.rectEdgeOnly ? 1 : 0}:${(cfg.shape as any)?.rectRandomDirection ? 1 : 0}`,
      cfg.mode
    ];
    return parts.join('|');
  }

  private spawn(n: number) {
    const basePathEmitIndex = this.pathEmitIndex;
    const useCustomPathShape = !this.cfg.pathEnabled && (this.cfg.shape?.type === 'custom_path');
    for (let i = 0; i < n; i++) {
      let x = this.width / 2 + (this.cfg.systemX || 0);
      let y = this.height / 2 + (this.cfg.systemY || 0);
      
      let speed = (this.cfg.speedMin || 0) + this.rand() * ((this.cfg.speedMax || 0) - (this.cfg.speedMin || 0));
      const sysAngle = ((this.cfg.systemRotationDeg || 0) * Math.PI) / 180;
      const sysRotCos = Math.cos(sysAngle);
      const sysRotSin = Math.sin(sysAngle);
      let emitAngle = sysAngle;
      
      let localX = 0;
      let localY = 0;

      const pathEnabled = !!this.cfg.pathEnabled;
      const pathMode = this.cfg.pathMode || 'lock';
      const pathType = this.cfg.pathType || 'circle';
      const isCustomPath = pathType === 'custom';
      const pathClosed = this.cfg.pathClosed !== false;
      const pathSpeedPx = Math.max(0, this.cfg.pathSpeedPxPerSec ?? 360);
      const revSign = this.cfg.pathReverse ? -1 : 1;
      const duMag = isCustomPath ? (pathSpeedPx / Math.max(1e-6, this.getCustomPathCache(this.cfg).total)) : 0;
      let customU = 0;
      let customDir = 1;
      let customUOffset = 0;
      const pathRx = Math.max(0, this.cfg.pathRadiusX ?? 0);
      const pathRyRaw = this.cfg.pathRadiusY ?? 0;
      const pathRy = Math.max(0, (pathType === 'circle' ? (pathRx || pathRyRaw) : (pathRyRaw || pathRx)));
      const pathSpeed = (this.cfg.pathSpeedDegPerSec ?? 0);
      const pathOmega = ((pathSpeed * Math.PI) / 180) * (this.cfg.pathReverse ? -1 : 1);
      const pathRadiusOffset = this.cfg.pathRadiusOffset || 0;
      const pathThickness = Math.max(0, this.cfg.pathThickness || 0);
      const randomStart = this.cfg.pathRandomStartAngle !== false;
      const baseStart = ((this.cfg.pathStartAngleDeg || 0) * Math.PI) / 180;
      let pathAngle = 0;
      let pathRadiusDelta = 0;
      if (pathEnabled && (pathMode === 'lock' || pathMode === 'emitter')) {
        pathRadiusDelta = (this.rand() - 0.5) * pathThickness;
        if (pathMode === 'lock') {
          pathAngle = randomStart
            ? this.rand() * Math.PI * 2
            : baseStart + (Math.PI * 2) * (i / Math.max(1, n));
        }
      }

      const emitterAngle = this.pathEmitterAngle0 + pathOmega * this.getLoopedElapsed();

      const spiralMode = this.cfg.attractorEnabled && this.cfg.attractorMode === 'spiral';
      const linearForceMode = this.cfg.attractorEnabled && !spiralMode;

      if (!pathEnabled) {
        const shape = this.cfg.shape || { type: 'point', x: 0, y: 0 };
        const inward = spiralMode
          ? !!this.cfg.spiralInward
          : ((shape.type === 'circle' || shape.type === 'cone') ? !!shape.emitInward : false);

        if (linearForceMode && shape.type === 'point') {
          if (!this.cfg.emissionAngleEnabled) {
            emitAngle = sysAngle + this.rand() * Math.PI * 2;
          } else {
            const offset = (((this.cfg.emissionOffsetDeg || 0) * Math.PI) / 180);
            const spread = (((this.cfg.emissionAngleDeg || 0) * Math.PI) / 180);
            emitAngle += offset + (this.rand() - 0.5) * spread;
          }
        } else if (shape.type === 'custom_path') {
          const pts = this.normalizePathPoints((this.cfg as any).pathPoints);
          const closed = ((this.cfg as any).pathClosed !== false) && pts.length > 2;
          const sampleCount = Math.max(1, Math.round((this.cfg as any).pathEmitSampleCount ?? 50));
          const idx = (basePathEmitIndex + i) % sampleCount;
          const u = computeUniformPathU(idx, sampleCount, closed);
          const ev = this.evalCustomPath(this.cfg, u);

          const rev = (this.cfg as any).pathReverse ? -1 : 1;
          const tx = ev.tx * rev;
          const ty = ev.ty * rev;
          const nLeftX = -ty;
          const nLeftY = tx;

          const sideMode = String((this.cfg as any).pathEmitSideMode || 'left');
          const ratio = Math.max(0, Math.min(1, Number((this.cfg as any).pathEmitBothSideRatioLeft ?? 0.5)));
          let nX = nLeftX;
          let nY = nLeftY;
          if (sideMode === 'right') {
            nX = -nLeftX;
            nY = -nLeftY;
          } else if (sideMode === 'both') {
            const chooseLeft = this.rand() < ratio;
            if (!chooseLeft) {
              nX = -nLeftX;
              nY = -nLeftY;
            }
          }

          localX = ev.x;
          localY = ev.y;

          const facingEnabled = !!(this.cfg as any).pathEmitFacingEnabled;
          const facingDeg = Math.max(0, Math.min(360, Number((this.cfg as any).pathEmitFacingDeg ?? 0)));
          const facingRad = (facingDeg * Math.PI) / 180;
          const baseAngle = (sysAngle + Math.atan2(nY, nX)) + (facingEnabled ? facingRad : 0);
          if (!this.cfg.emissionAngleEnabled) {
            emitAngle = baseAngle;
          } else {
            const offset = (((this.cfg.emissionOffsetDeg || 0) * Math.PI) / 180);
            const spread = (((this.cfg.emissionAngleDeg || 0) * Math.PI) / 180);
            emitAngle = baseAngle + offset + (this.rand() - 0.5) * spread;
          }
        } else if (shape.type === 'circle') {
          const a = this.rand() * Math.PI * 2;
          const rInner = Math.max(0, shape.innerRadius || 0);
          const rOuter = Math.max(rInner, shape.outerRadius || 50);
          const r = (spiralMode && inward)
            ? rOuter
            : Math.sqrt(this.rand() * (rOuter * rOuter - rInner * rInner) + rInner * rInner);
          localX += Math.cos(a) * r;
          localY += Math.sin(a) * r;
          emitAngle = sysAngle + a + (inward ? Math.PI : 0);
        } else if (shape.type === 'rect') {
          const w0 = Math.max(1, shape.width || 100);
          const h0 = Math.max(1, shape.height || 100);
          const edgeOnly = !!(shape as any).rectEdgeOnly;
          if (spiralMode && inward) {
            const t = this.rand();
            const side = Math.floor(this.rand() * 4);
            if (side === 0) { localX += -w0 / 2; localY += (t - 0.5) * h0; }
            else if (side === 1) { localX += w0 / 2; localY += (t - 0.5) * h0; }
            else if (side === 2) { localX += (t - 0.5) * w0; localY += -h0 / 2; }
            else { localX += (t - 0.5) * w0; localY += h0 / 2; }
          } else if (edgeOnly) {
            const t = this.rand();
            const side = Math.floor(this.rand() * 4);
            if (side === 0) { localX += -w0 / 2; localY += (t - 0.5) * h0; }
            else if (side === 1) { localX += w0 / 2; localY += (t - 0.5) * h0; }
            else if (side === 2) { localX += (t - 0.5) * w0; localY += -h0 / 2; }
            else { localX += (t - 0.5) * w0; localY += h0 / 2; }
          } else {
            localX += (this.rand() - 0.5) * w0;
            localY += (this.rand() - 0.5) * h0;
          }
          if (!this.cfg.emissionAngleEnabled) {
            const randomDir = !!(shape as any).rectRandomDirection;
            emitAngle = randomDir
              ? (sysAngle + this.rand() * Math.PI * 2)
              : sysAngle;
          } else {
            const offset = (((this.cfg.emissionOffsetDeg || 0) * Math.PI) / 180);
            const spread = (((this.cfg.emissionAngleDeg || 0) * Math.PI) / 180);
            emitAngle = sysAngle + offset + (this.rand() - 0.5) * spread;
          }
        } else if (shape.type === 'cone') {
          const rr = Math.max(0, shape.coneRadius || 150);
          const spread = ((shape.coneAngleDeg || 45) * Math.PI) / 180;
          const aLocal = (this.rand() - 0.5) * spread;
          const r = (spiralMode && inward) ? rr : (inward ? rr : Math.sqrt(this.rand()) * rr);
          localX += Math.cos(aLocal) * r;
          localY += Math.sin(aLocal) * r;
          emitAngle = sysAngle + aLocal + (inward ? Math.PI : 0);
        } else {
          if (spiralMode) {
            const offset = (((this.cfg.emissionOffsetDeg || 0) * Math.PI) / 180);
            const theta = this.cfg.emissionAngleEnabled ? offset : 0;
            const viewR = this.viewportRect ? Math.max(0, Math.min(this.viewportRect.w, this.viewportRect.h) / 2) : Math.max(0, Math.min(this.width, this.height) / 2);
            const rawStart = inward ? Math.max(0, this.cfg.spiralStartRadius ?? this.cfg.attractorRadius ?? viewR) : 1;
            const startR = Math.max(1, Math.min(viewR, rawStart));
            localX += Math.cos(theta) * startR;
            localY += Math.sin(theta) * startR;
            emitAngle = sysAngle + theta + (inward ? Math.PI : 0);
          } else {
            if (!this.cfg.emissionAngleEnabled) {
              emitAngle = sysAngle;
            } else {
              const offset = (((this.cfg.emissionOffsetDeg || 0) * Math.PI) / 180);
              const spread = (((this.cfg.emissionAngleDeg || 0) * Math.PI) / 180);
              emitAngle += offset + (this.rand() - 0.5) * spread;
            }
          }
        }
      }

      if (pathEnabled && pathMode === 'lock' && !isCustomPath) {
        const baseRx = pathRx > 0 ? pathRx : 120;
        const baseRy = pathRy > 0 ? pathRy : baseRx;
        const rx = Math.max(0, baseRx + pathRadiusOffset + pathRadiusDelta);
        const ry = Math.max(0, baseRy + pathRadiusOffset + pathRadiusDelta);

        localX = Math.cos(pathAngle) * rx;
        localY = Math.sin(pathAngle) * ry;

        const tvxLocal = -Math.sin(pathAngle) * rx * pathOmega;
        const tvyLocal = Math.cos(pathAngle) * ry * pathOmega;
        const vxWorld = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
        const vyWorld = tvxLocal * sysRotSin + tvyLocal * sysRotCos;

        emitAngle = Math.atan2(vyWorld, vxWorld);
        speed = Math.hypot(vxWorld, vyWorld);
      }

      if (pathEnabled && pathMode === 'lock' && isCustomPath) {
        const startU = this.cfg.pathRandomStartAngle === false
          ? (this.pathEmitterU0 + (i / Math.max(1, n)))
          : this.rand();
        customU = pathClosed ? this.wrap01(startU) : Math.max(0, Math.min(1, startU));
        customDir = revSign;
        const ev = this.evalCustomPath(this.cfg, customU);
        const tx = ev.tx * customDir;
        const ty = ev.ty * customDir;
        const nx = -ty;
        const ny = tx;
        localX = ev.x + nx * pathRadiusDelta;
        localY = ev.y + ny * pathRadiusDelta;
        const tvxLocal = tx * pathSpeedPx;
        const tvyLocal = ty * pathSpeedPx;
        const vxWorld = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
        const vyWorld = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
        emitAngle = Math.atan2(vyWorld, vxWorld);
        speed = Math.hypot(vxWorld, vyWorld);
      }

      const sprites = this.cfg.sprites || [];
      const playback = this.cfg.spritePlayback || 'single';
      const spriteCount = this.getEffectiveSpriteCount();
      const spriteIndex = sprites.length > 0
        ? ((playback === 'random' || (playback === 'sequence' && this.cfg.spriteSequenceRandom)) ? this.pickWeightedSpriteIndex(sprites) : 0)
        : 0;
      const seqOffset = playback === 'sequence'
        ? Math.floor(this.rand() * (this.cfg.spriteSequenceRandom ? this.getSequenceFrameCountForSprite(spriteIndex) : Math.max(1, spriteCount)))
        : 0;

      const maxLife = (this.cfg.lifetimeMin || 1) + this.rand() * ((this.cfg.lifetimeMax || 2) - (this.cfg.lifetimeMin || 1));
      const gy = this.cfg.gravityEnabled ? (this.cfg.gravityY || 0) : 0;
      const minTravelY = (!pathEnabled && this.cfg.noiseEnabled && this.cfg.noiseMode === 's_curve') ? Math.max(0, this.cfg.minTravelY || 0) : 0;

      let initialLife = 0;

      if (pathEnabled && pathMode === 'emitter' && !isCustomPath) {
        const trailTime = this.rand() * maxLife;
        initialLife = Math.max(0, Math.min(maxLife - 1e-6, trailTime));
        pathAngle = emitterAngle - pathOmega * initialLife;

        const baseRx = pathRx > 0 ? pathRx : 120;
        const baseRy = pathRy > 0 ? pathRy : baseRx;
        const rx = Math.max(0, baseRx + pathRadiusOffset + pathRadiusDelta);
        const ry = Math.max(0, baseRy + pathRadiusOffset + pathRadiusDelta);

        localX = Math.cos(pathAngle) * rx;
        localY = Math.sin(pathAngle) * ry;

        const tvxLocal = -Math.sin(pathAngle) * rx * pathOmega;
        const tvyLocal = Math.cos(pathAngle) * ry * pathOmega;
        const vxWorld = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
        const vyWorld = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
        const tangentAngle = Math.atan2(vyWorld, vxWorld);
        emitAngle = tangentAngle;
        speed = Math.hypot(vxWorld, vyWorld);
      }

      if (pathEnabled && pathMode === 'emitter' && isCustomPath) {
        initialLife = Math.max(0, Math.min(maxLife - 1e-6, this.rand() * maxLife));
        customUOffset = -duMag * revSign * initialLife;
        const base = this.pathEmitterU0 + duMag * revSign * this.getLoopedElapsed() + customUOffset;
        const state = pathClosed ? { u: this.wrap01(base), dir: revSign } : this.pingpong01(base);
        customU = state.u;
        customDir = state.dir;
        const ev = this.evalCustomPath(this.cfg, customU);
        const tx = ev.tx * customDir;
        const ty = ev.ty * customDir;
        const nx = -ty;
        const ny = tx;
        localX = ev.x + nx * pathRadiusDelta;
        localY = ev.y + ny * pathRadiusDelta;
        const tvxLocal = tx * pathSpeedPx;
        const tvyLocal = ty * pathSpeedPx;
        const vxWorld = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
        const vyWorld = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
        emitAngle = Math.atan2(vyWorld, vxWorld);
        speed = Math.hypot(vxWorld, vyWorld);
      }

      x += localX * sysRotCos - localY * sysRotSin;
      y += localX * sysRotSin + localY * sysRotCos;

      let dirX = Math.cos(emitAngle);
      let dirY = Math.sin(emitAngle);
      let vx = dirX * speed;
      let vy = dirY * speed;

      if (pathEnabled && pathMode === 'lock' && !isCustomPath) {
        const baseRx = (pathRx > 0 ? pathRx : 120);
        const baseRy = (pathRy > 0 ? pathRy : baseRx);
        const rx = Math.max(0, baseRx + pathRadiusOffset + pathRadiusDelta);
        const ry = Math.max(0, baseRy + pathRadiusOffset + pathRadiusDelta);
        const tvxLocal = -Math.sin(pathAngle) * rx * pathOmega;
        const tvyLocal = Math.cos(pathAngle) * ry * pathOmega;
        vx = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
        vy = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
        const spd = Math.hypot(vx, vy);
        if (spd > 1e-6) {
          dirX = vx / spd;
          dirY = vy / spd;
        }
      }

      if (pathEnabled && pathMode === 'emitter' && !isCustomPath) {
        const baseRx = (pathRx > 0 ? pathRx : 120);
        const baseRy = (pathRy > 0 ? pathRy : baseRx);
        const rx = Math.max(0, baseRx + pathRadiusOffset + pathRadiusDelta);
        const ry = Math.max(0, baseRy + pathRadiusOffset + pathRadiusDelta);
        const tvxLocal = -Math.sin(pathAngle) * rx * pathOmega;
        const tvyLocal = Math.cos(pathAngle) * ry * pathOmega;
        vx = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
        vy = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
        const spd = Math.hypot(vx, vy);
        if (spd > 1e-6) {
          dirX = vx / spd;
          dirY = vy / spd;
        }
      }

      if (minTravelY > 0) {
        const expectedFromGravity = 0.5 * gy * maxLife * maxLife;
        const remain = minTravelY - Math.abs(expectedFromGravity);
        if (remain > 0) {
          const requiredAbsVy = remain / Math.max(1e-6, maxLife);
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

          const spd = Math.hypot(vx, vy);
          if (spd > 1e-6) {
            dirX = vx / spd;
            dirY = vy / spd;
          } else {
            dirX = 0;
            dirY = signY;
          }
        }
      }

      if (!this.cfg.attractorEnabled && (this.cfg.shape.type === 'circle' || (this.cfg.shape.type === 'cone' && this.cfg.shape.emitInward))) {
        const cx = (this.width / 2) + (this.cfg.systemX || 0);
        const cy = (this.height / 2) + (this.cfg.systemY || 0);
        const dx = cx - x;
        const dy = cy - y;
        const d = Math.hypot(dx, dy);
        if (d > 1e-6) {
          const dot = vx * dx + vy * dy;
          if (this.cfg.shape.type === 'circle') {
            const inward = !!this.cfg.shape.emitInward;
            if ((inward && dot < 0) || (!inward && dot > 0)) {
              vx = -vx;
              vy = -vy;
            }
          } else if (this.cfg.shape.type === 'cone' && this.cfg.shape.emitInward) {
            if (dot < 0) {
              vx = -vx;
              vy = -vy;
            }
          }
          const spd = Math.hypot(vx, vy);
          if (spd > 1e-6) {
            dirX = vx / spd;
            dirY = vy / spd;
          }
        }
      }

      const expectedTravelY = Math.max(1e-6, Math.abs(vy) * maxLife + 0.5 * Math.abs(gy) * maxLife * maxLife);

      const phase = this.rand() * Math.PI * 2;
      const rotationMode = (this.cfg.rotationMode || 'random') as any;
      const lockRot = !!this.cfg.lockSpriteRotation;
      const rot = lockRot
        ? 0
        : (rotationMode === 'direction'
          ? Math.atan2(vy, vx)
          : (this.rand() * Math.PI * 2));
      const rotVel = lockRot || rotationMode === 'direction'
        ? 0
        : (((this.cfg.particleSpinDegPerSec || 0) * Math.PI) / 180);

      this.particles.push({
        x, y,
        startY: y,
        startR: spiralMode ? Math.hypot((this.width / 2 + (this.cfg.systemX || 0)) - x, (this.height / 2 + (this.cfg.systemY || 0)) - y) : 0,
        spiralRadius: (spiralMode && !!this.cfg.spiralInward)
          ? Math.hypot((this.width / 2 + (this.cfg.systemX || 0)) - x, (this.height / 2 + (this.cfg.systemY || 0)) - y)
          : undefined,
        spiralAngle: (spiralMode && !!this.cfg.spiralInward)
          ? Math.atan2(
            y - ((this.height / 2) + (this.cfg.systemY || 0)),
            x - ((this.width / 2) + (this.cfg.systemX || 0))
          )
          : undefined,
        pathAngle: (pathEnabled && (pathMode === 'lock' || pathMode === 'emitter') && !isCustomPath) ? pathAngle : undefined,
        pathRadiusDelta: (pathEnabled && (pathMode === 'lock' || pathMode === 'emitter')) ? pathRadiusDelta : undefined,
        pathU: (pathEnabled && isCustomPath) ? customU : undefined,
        pathDir: (pathEnabled && isCustomPath) ? customDir : undefined,
        pathUOffset: (pathEnabled && isCustomPath && pathMode === 'emitter') ? customUOffset : undefined,
        expectedTravelY: Math.max(expectedTravelY, minTravelY > 0 ? minTravelY : 0),
        vx,
        vy,
        life: initialLife,
        maxLife,
        rot,
        rotVel,
        nx: phase,
        ny: this.rand() * 100,
        dirX,
        dirY,
        spriteIndex,
        seqOffset
      });
    }

    if (useCustomPathShape) this.pathEmitIndex = basePathEmitIndex + n;
  }

  private stepInternal(dt: number, shouldDraw: boolean, drawClear: boolean) {
    const rotationMode = (this.cfg.rotationMode || 'random') as any;
    this.elapsed += dt;
    if (this.cfg.mode === 'stream') {
      const duration = this.cfg.streamDurationSec || 0;
      const loop = !!this.cfg.streamLoopEnabled;
      const local = duration > 0 && loop ? (this.elapsed % duration) : this.elapsed;
      const active = duration <= 0 || local <= duration;

      if (duration > 0 && loop && local < this.streamPrevLocal) {
        this.acc = 0;
        if (this.rngResetOnLoop && this.rngSeed != null) this.rng = this.mulberry32(this.rngSeed);
      }
      this.streamPrevLocal = local;
      this.streamLocal = local;
      this.streamLoopDuration = duration;
      this.streamLoopEnabled = duration > 0 && loop;

      if (active) {
        this.acc += dt * (this.cfg.rate || 0);
        const n = Math.floor(this.acc);
        if (n > 0) {
          this.spawn(n);
          this.acc -= n;
        }
      }
    } else {
      this.burstAcc += dt;
      if (this.burstAcc >= (this.cfg.loopIntervalSec || 1)) {
        this.burstAcc = 0;
        this.spawn(this.cfg.burstCount || 0);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }

      if (this.cfg.pathEnabled && ((this.cfg.pathMode || 'lock') === 'lock' || (this.cfg.pathMode || 'lock') === 'emitter')) {
        const sysAngle = ((this.cfg.systemRotationDeg || 0) * Math.PI) / 180;
        const sysRotCos = Math.cos(sysAngle);
        const sysRotSin = Math.sin(sysAngle);
        const pathType = this.cfg.pathType || 'circle';
        if (pathType === 'custom') {
          const pathClosed = this.cfg.pathClosed !== false;
          const speed = Math.max(0, this.cfg.pathSpeedPxPerSec ?? 360);
          const revSign = this.cfg.pathReverse ? -1 : 1;
          const duMag = (speed / Math.max(1e-6, this.getCustomPathCache(this.cfg).total));

          let u = p.pathU ?? 0;
          let dir = p.pathDir ?? 1;
          if ((this.cfg.pathMode || 'lock') === 'emitter') {
            const base = this.pathEmitterU0 + duMag * revSign * this.getLoopedElapsed() + (p.pathUOffset || 0);
            const state = pathClosed ? { u: this.wrap01(base), dir: revSign } : this.pingpong01(base);
            u = state.u;
            dir = state.dir;
          } else {
            if (pathClosed) {
              u = this.wrap01(u + duMag * revSign * dt);
              dir = revSign;
            } else {
              u += dir * duMag * dt;
              if (u > 1) {
                u = 2 - u;
                dir = -dir;
              }
              if (u < 0) {
                u = -u;
                dir = -dir;
              }
            }
          }

          p.pathU = u;
          p.pathDir = dir;

          const ev = this.evalCustomPath(this.cfg, u);
          const tx = ev.tx * dir;
          const ty = ev.ty * dir;
          const nx = -ty;
          const ny = tx;
          const off = p.pathRadiusDelta || 0;
          const lx = ev.x + nx * off;
          const ly = ev.y + ny * off;

          const cx = (this.width / 2) + (this.cfg.systemX || 0);
          const cy = (this.height / 2) + (this.cfg.systemY || 0);
          p.x = cx + lx * sysRotCos - ly * sysRotSin;
          p.y = cy + lx * sysRotSin + ly * sysRotCos;

          const tvxLocal = tx * speed;
          const tvyLocal = ty * speed;
          p.vx = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
          p.vy = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
          const spd = Math.hypot(p.vx, p.vy);
          if (spd > 1e-6) {
            p.dirX = p.vx / spd;
            p.dirY = p.vy / spd;
          }
          if (!this.cfg.lockSpriteRotation) {
            if (rotationMode === 'direction') {
              const spd2 = p.vx * p.vx + p.vy * p.vy;
              if (spd2 > 1e-12) p.rot = Math.atan2(p.vy, p.vx);
            } else {
              p.rot += p.rotVel * dt;
            }
          }
          continue;
        }
        const rawRx = Math.max(0, this.cfg.pathRadiusX ?? 0);
        const rawRy = Math.max(0, this.cfg.pathRadiusY ?? 0);
        const baseRx = rawRx > 0 ? rawRx : 120;
        const baseRy = (pathType === 'circle') ? (rawRy > 0 ? rawRy : baseRx) : (rawRy > 0 ? rawRy : baseRx);
        const rOff = this.cfg.pathRadiusOffset || 0;
        const rDelta = p.pathRadiusDelta || 0;
        const rx = Math.max(0, baseRx + rOff + rDelta);
        const ry = Math.max(0, baseRy + rOff + rDelta);
        const omega = (((this.cfg.pathSpeedDegPerSec ?? 0) * Math.PI) / 180) * (this.cfg.pathReverse ? -1 : 1);

        const cx = (this.width / 2) + (this.cfg.systemX || 0);
        const cy = (this.height / 2) + (this.cfg.systemY || 0);
        const a0 = p.pathAngle ?? this.rand() * Math.PI * 2;
        const a = a0 + omega * dt;
        p.pathAngle = a;

        const lx = Math.cos(a) * rx;
        const ly = Math.sin(a) * ry;
        p.x = cx + lx * sysRotCos - ly * sysRotSin;
        p.y = cy + lx * sysRotSin + ly * sysRotCos;

        const tvxLocal = -Math.sin(a) * rx * omega;
        const tvyLocal = Math.cos(a) * ry * omega;
        p.vx = tvxLocal * sysRotCos - tvyLocal * sysRotSin;
        p.vy = tvxLocal * sysRotSin + tvyLocal * sysRotCos;
        const spd = Math.hypot(p.vx, p.vy);
        if (spd > 1e-6) {
          p.dirX = p.vx / spd;
          p.dirY = p.vy / spd;
        }
        if (!this.cfg.lockSpriteRotation) {
          if (rotationMode === 'direction') {
            const spd2 = p.vx * p.vx + p.vy * p.vy;
            if (spd2 > 1e-12) p.rot = Math.atan2(p.vy, p.vx);
          } else {
            p.rot += p.rotVel * dt;
          }
        }
        continue;
      }

      const spiralInward = this.cfg.attractorEnabled && this.cfg.attractorMode === 'spiral' && !!this.cfg.spiralInward;
      if (spiralInward) {
        const cx = (this.width / 2) + (this.cfg.systemX || 0);
        const cy = (this.height / 2) + (this.cfg.systemY || 0);
        const endRadius = Math.max(0, this.cfg.spiralEndRadius ?? 0);
        const startRadius = Math.max(endRadius, p.startR ?? 0);
        const tNorm = Math.max(0, Math.min(1, p.life / Math.max(1e-6, p.maxLife)));
        const desiredR = Math.max(endRadius, startRadius + (endRadius - startRadius) * tNorm);
        p.spiralRadius = desiredR;

        const turnsStrength = Math.max(0, Math.min(2000, Math.abs(this.cfg.attractorStrength || 0)));
        const turns = 1 + (turnsStrength / 2000) * 19;
        const sw = (this.cfg.swirlStrength || 0);
        const dir = Math.abs(sw) < 1e-6 ? 1 : Math.sign(sw);
        const omega = dir * (Math.PI * 2 * turns) / Math.max(1e-6, p.maxLife);
        p.spiralAngle = (p.spiralAngle ?? 0) + omega * dt;

        p.x = cx + Math.cos(p.spiralAngle) * desiredR;
        p.y = cy + Math.sin(p.spiralAngle) * desiredR;
        p.vx = 0;
        p.vy = 0;
        if (!this.cfg.lockSpriteRotation) {
          if (rotationMode === 'direction') {
            const spd2 = p.vx * p.vx + p.vy * p.vy;
            if (spd2 > 1e-12) p.rot = Math.atan2(p.vy, p.vx);
          } else {
            p.rot += p.rotVel * dt;
          }
        }
        continue;
      }

      // 重力系统
      if (this.cfg.gravityEnabled) {
        p.vx += (this.cfg.gravityX || 0) * dt;
        p.vy += (this.cfg.gravityY || 0) * dt;
      }

      // 移动噪声 (Noise)
      if (this.cfg.noiseEnabled) {
        const mode = this.cfg.noiseMode || 'random';
        const freq = (this.cfg.noiseFrequency || 0.5);
        const amp = (this.cfg.noiseIntensity || 100);
        if (mode !== 's_curve') {
          const t = this.getLoopedElapsed();
          p.vx += Math.sin(p.nx + t * freq) * amp * dt;
          p.vy += Math.cos(p.ny + t * freq) * amp * dt;
        }
      }

      // 速度抑制 (Damping)
      if (this.cfg.dampingEnabled) {
        const factor = 1 - (this.cfg.targetSpeedRatio || 0.5) * dt;
        p.vx *= factor;
        p.vy *= factor;
      }

      if (this.cfg.attractorEnabled) {
        const cx = (this.width / 2) + (this.cfg.systemX || 0);
        const cy = (this.height / 2) + (this.cfg.systemY || 0);
        const dx = cx - p.x;
        const dy = cy - p.y;
        const d = Math.hypot(dx, dy);
        const rawR = this.cfg.attractorRadius || 0;
        let r = rawR > 0 ? rawR : Number.POSITIVE_INFINITY;
        const spiralInward = this.cfg.attractorMode === 'spiral' && !!this.cfg.spiralInward;
        const spiralEndR = spiralInward ? Math.max(0, this.cfg.spiralEndRadius ?? 0) : 0;
        if (spiralInward && d <= spiralEndR) {
          if (d > 1e-6) {
            p.x = cx - (dx / d) * spiralEndR;
            p.y = cy - (dy / d) * spiralEndR;
          } else {
            p.x = cx;
            p.y = cy;
          }
          p.vx = 0;
          p.vy = 0;
          continue;
        }
        if (spiralInward) {
          const startR = Math.max(0, this.cfg.spiralStartRadius || 0);
          if (Number.isFinite(r)) r = Math.max(r, startR);
        }
        if (d < r) {
          const strength = this.cfg.attractorStrength || 0;
          const k = spiralInward ? Math.abs(strength) : strength;
          const nx = dx / Math.max(1e-6, d);
          const ny = dy / Math.max(1e-6, d);
          p.vx += nx * k * dt;
          p.vy += ny * k * dt;
          if (this.cfg.attractorMode === 'spiral') {
            const tnx = -ny;
            const tny = nx;
            let swirl = (this.cfg.swirlStrength || 0);
            if (spiralInward) {
              const startR = Math.max(d, p.startR ?? d);
              const denom = Math.max(1e-6, startR - spiralEndR);
              const t = Math.max(0, Math.min(1, (d - spiralEndR) / denom));
              swirl *= Math.max(0.2, t);
            }
            p.vx += tnx * swirl * dt;
            p.vy += tny * swirl * dt;
          }

          if (spiralInward) {
            const tNorm = Math.max(0, Math.min(1, p.life / Math.max(1e-6, p.maxLife)));
            const startRadius = Math.max(0, p.startR ?? d);
            const endRadius = spiralEndR;
            const tEase = Math.sqrt(tNorm);
            const desired = startRadius + (endRadius - startRadius) * tEase;
            const err = d - desired;
            const vRad = p.vx * nx + p.vy * ny;
            const kp = 80;
            const kd = 24;
            const maxAccel = 8000;
            const acc = Math.max(-maxAccel, Math.min(maxAccel, err * kp - vRad * kd));
            p.vx += nx * acc * dt;
            p.vy += ny * acc * dt;
          }
        }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (!this.cfg.lockSpriteRotation) {
        if (rotationMode === 'direction') {
          const spd2 = p.vx * p.vx + p.vy * p.vy;
          if (spd2 > 1e-12) p.rot = Math.atan2(p.vy, p.vx);
        } else {
          p.rot += p.rotVel * dt;
        }
      }
    }
    if (shouldDraw) this.draw({ clear: drawClear });
  }

  step(dt: number, options?: { draw?: boolean; clear?: boolean }) {
    const shouldDraw = options?.draw !== false;
    const drawClear = options?.clear !== false;
    this.stepInternal(dt, shouldDraw, drawClear);
  }

  draw(options?: { clear?: boolean }) {
    const ctx = this.ctx;
    if (options?.clear !== false) ctx.clearRect(0, 0, this.width, this.height);

    if (this.viewportRect) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.viewportRect.x, this.viewportRect.y, this.viewportRect.w, this.viewportRect.h);
      ctx.clip();
    }

    const systemScale = Number(this.cfg.systemScale ?? 1);
    const systemScaleSeparate = !!(this.cfg as any).systemScaleSeparate;
    const systemScaleX = systemScaleSeparate ? Number((this.cfg as any).systemScaleX ?? systemScale) : systemScale;
    const systemScaleY = systemScaleSeparate ? Number((this.cfg as any).systemScaleY ?? systemScale) : systemScale;
    const didScale = Math.abs(systemScaleX - 1) > 1e-6 || Math.abs(systemScaleY - 1) > 1e-6;
    if (didScale) {
      const cx = (this.width / 2) + (this.cfg.systemX || 0);
      const cy = (this.height / 2) + (this.cfg.systemY || 0);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(systemScaleX, systemScaleY);
      ctx.translate(-cx, -cy);
    }

    this.particles.forEach(p => {
      const t = p.life / p.maxLife;
      const sizeSeparate = !!(this.cfg as any).sizeSeparate;
      const s0x = sizeSeparate ? Number((this.cfg as any).sizeStartX ?? this.cfg.sizeStart ?? 0) : Number(this.cfg.sizeStart ?? 0);
      const s1x = sizeSeparate ? Number((this.cfg as any).sizeEndX ?? this.cfg.sizeEnd ?? 0) : Number(this.cfg.sizeEnd ?? 0);
      const s0y = sizeSeparate ? Number((this.cfg as any).sizeStartY ?? this.cfg.sizeStart ?? 0) : Number(this.cfg.sizeStart ?? 0);
      const s1y = sizeSeparate ? Number((this.cfg as any).sizeEndY ?? this.cfg.sizeEnd ?? 0) : Number(this.cfg.sizeEnd ?? 0);
      const baseSizeX = this.lerp(s0x, s1x, t);
      const baseSizeY = this.lerp(s0y, s1y, t);
      const sizeScale = this.cfg.useSizeCurve ? this.sample1D(this.cfg.sizeCurve || [], t) : 1;
      const opacity = this.cfg.useOpacityCurve
        ? this.sample1D(this.cfg.opacityCurve || [], t)
        : this.lerp(this.cfg.opacityStart || 0, this.cfg.opacityEnd || 0, t);
      const sizeX = Math.max(0, (baseSizeX || 0) * sizeScale);
      const sizeY = Math.max(0, (baseSizeY || 0) * sizeScale);

      ctx.save();
      let drawX = p.x;
      const drawY = p.y;
      if (this.cfg.noiseEnabled && (this.cfg.noiseMode || 'random') === 's_curve') {
        const cycles = Math.max(0, this.cfg.noiseFrequency || 0);
        const strengthMode = this.cfg.sNoiseStrengthMode || 'linear';
        const yProgress = Math.abs(p.y - p.startY);
        const yNorm = Math.max(0, Math.min(1, yProgress / Math.max(1e-6, p.expectedTravelY)));
        const mult = strengthMode === 'curve'
          ? Math.max(0, this.sample1D(this.cfg.sNoiseCurve || [], yNorm))
          : 1;
        const amp = (this.cfg.noiseIntensity || 0) * mult;
        const offset = Math.sin((p.nx || 0) + yNorm * cycles * Math.PI * 2) * amp;
        drawX += offset;
      }
      ctx.translate(drawX, drawY);
      ctx.rotate(this.cfg.lockSpriteRotation ? 0 : p.rot);
      
      const sprites = this.cfg.sprites || [];
      const playback = this.cfg.spritePlayback || 'single';
      const spriteCount = playback === 'sequence' ? this.getEffectiveSpriteCount() : sprites.length;
      let sprite: any = null;
      let img: HTMLImageElement | null = null;

      if (playback === 'sequence' && this.cfg.spriteSequenceRandom) {
        const si = Math.max(0, Math.min(sprites.length - 1, p.spriteIndex || 0));
        sprite = sprites[si] || null;
        const frameCount = this.getSequenceFrameCountForSprite(si);
        const fps = Math.max(1e-6, this.cfg.spriteSequenceFps || 12);
        const frame = Math.floor(p.life * fps) + (p.seqOffset || 0);
        const local = this.cfg.spriteSequenceLoop ? (frame % frameCount) : Math.min(frame, frameCount - 1);
        const start = this.spriteFrameStarts[si] || 0;
        const imgIndex = start + local;
        img = this.spriteImages[imgIndex] || null;
      } else {
        let idx = 0;
        if (spriteCount > 0) {
          if (playback === 'sequence') {
            const fps = Math.max(1e-6, this.cfg.spriteSequenceFps || 12);
            const frame = Math.floor(p.life * fps) + (p.seqOffset || 0);
            idx = this.cfg.spriteSequenceLoop ? (frame % spriteCount) : Math.min(frame, spriteCount - 1);
          } else {
            idx = Math.max(0, Math.min(spriteCount - 1, p.spriteIndex || 0));
          }
        }
        if (playback === 'sequence' && !this.cfg.spriteSequenceRandom && this.spriteImages.length > 1) {
          const si = this.getPrimarySequenceSpriteIndex();
          sprite = si >= 0 ? sprites[si] : null;
          img = this.spriteImages[idx] || null;
        } else {
          sprite = spriteCount > 0
            ? (playback === 'sequence' && sprites.length === 1 && this.spriteImages.length > 1 ? sprites[0] : sprites[idx])
            : null;
          img = this.spriteImages[idx] || null;
        }
      }

      const lifeT = p.maxLife > 0 ? p.life / p.maxLife : 0;
      const tintColor = sprite ? this.getSpriteTintColor(sprite as any, lifeT) : null;

      const spriteOpacity = sprite ? Math.max(0, Math.min(1, Number((sprite as any).opacity ?? 1))) : 1;
      const spriteScaleSeparate = sprite ? !!(sprite as any).scaleSeparate : false;
      const spriteScale = sprite ? Math.max(0, Number((sprite as any).scale ?? 1)) : 1;
      const spriteScaleX = spriteScaleSeparate ? Math.max(0, Number((sprite as any).scaleX ?? spriteScale)) : spriteScale;
      const spriteScaleY = spriteScaleSeparate ? Math.max(0, Number((sprite as any).scaleY ?? spriteScale)) : spriteScale;

      const finalAlpha = Math.max(0, Math.min(1, opacity)) * spriteOpacity;
      const finalSizeX = Math.max(0, sizeX * spriteScaleX);
      const finalSizeY = Math.max(0, sizeY * spriteScaleY);

      ctx.globalAlpha = finalAlpha;

      const bm0 = (sprite as any)?.blendMode ?? (this.cfg as any)?.blendMode ?? 'normal';
      const bm = bm0 === 'lighter' ? 'add'
        : bm0 === 'additive' ? 'add'
        : bm0 === 'plus' ? 'add'
        : bm0 === 'lighten' ? 'screen'
        : bm0;
      if (bm === 'add') ctx.globalCompositeOperation = 'lighter';
      else if (bm === 'multiply') ctx.globalCompositeOperation = 'multiply';
      else if (bm === 'screen') ctx.globalCompositeOperation = 'screen';
      else if (bm === 'overlay') ctx.globalCompositeOperation = 'overlay';
      else ctx.globalCompositeOperation = 'source-over';

      if (img && sprite) {
        if (img.complete && (img.naturalWidth || 0) > 0) {
          const tinted = tintColor ? this.getTintedSprite(img, tintColor) : null;
          const source = tinted ?? img;
          const sw = Number((source as any).naturalWidth ?? (source as any).width ?? 0);
          const sh = Number((source as any).naturalHeight ?? (source as any).height ?? 0);
          const base = Math.max(1, Math.max(sw, sh));
          const dw = finalSizeX * (sw / base);
          const dh = finalSizeY * (sh / base);
          ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
        }
      } else {
        ctx.fillStyle = tintColor || '#fff';
        ctx.beginPath();
        if (Math.abs(finalSizeX - finalSizeY) <= 1e-6) {
          ctx.arc(0, 0, Math.max(0.5, finalSizeX / 2), 0, Math.PI * 2);
        } else {
          ctx.ellipse(0, 0, Math.max(0.5, finalSizeX / 2), Math.max(0.5, finalSizeY / 2), 0, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.restore();
    });

    if (didScale) {
      ctx.restore();
    }

    if (this.viewportRect) {
      ctx.restore();
    }
  }
}
