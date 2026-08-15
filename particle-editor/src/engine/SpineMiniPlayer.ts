type TranslateFrame = { time?: number; x?: number; y?: number; value?: number; curve?: unknown };
type RotateFrame = { time?: number; angle?: number; value?: number; curve?: unknown };
type ScaleFrame = { time: number; x?: number; y?: number; curve?: unknown };
type ColorFrame = { time: number; color?: string; curve?: unknown };

type SpineBone = {
  name: string;
  parent?: string;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  length?: number;
  shearX?: number;
  shearY?: number;
  transformMode?: string;
};

type SpineSlot = {
  name: string;
  bone: string;
  attachment?: string;
  color?: string;
  blend?: string;
};

type SpineAttachmentRegion = {
  type?: string;
  name?: string;
  path?: string;
  sequence?: { count?: number; start?: number; digits?: number; setup?: number };
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  color?: string;
  uvs?: number[];
  triangles?: number[];
  vertices?: number[];
  parent?: string;
  skin?: string;
};

type SpineAnimation = {
  bones?: Record<string, { translate?: TranslateFrame[]; rotate?: RotateFrame[]; scale?: ScaleFrame[]; shear?: TranslateFrame[] }>;
  slots?: Record<string, { color?: ColorFrame[]; rgba?: ColorFrame[]; attachment?: { time: number; name?: string | null; curve?: unknown }[] }>;
  duration?: number;
  deform?: Record<string, Record<string, Record<string, { time: number; offset?: number; vertices: number[]; curve?: unknown }[]>>>;
  attachments?: Record<string, Record<string, Record<string, Record<string, { time?: number; mode?: string; index?: number; delay?: number }[]>>>>;
  drawOrder?: { time: number; offsets?: { slot: string; offset: number }[] }[];
  ik?: Record<string, ({ time?: number } & Partial<Pick<SpineIkConstraint, 'mix' | 'bendPositive' | 'compress' | 'stretch'>>)[]>;
  transform?: Record<string, ({ time?: number } & Partial<Pick<SpineTransformConstraint, 'rotateMix' | 'translateMix' | 'scaleMix' | 'shearMix' | 'rotation' | 'x' | 'y'>>)[]>;
  path?: Record<string, {
    position?: ({ time?: number; value?: number; position?: number; curve?: unknown })[];
    spacing?: ({ time?: number; value?: number; spacing?: number; curve?: unknown })[];
    mix?: ({ time?: number; mixRotate?: number; mixX?: number; mixY?: number; translateMix?: number; curve?: unknown })[];
  }>;
};

type SpineIkConstraint = {
  name: string;
  order?: number;
  bones: string[];
  target: string;
  bendPositive?: boolean;
  compress?: boolean;
  stretch?: boolean;
  mix?: number;
};

type SpineTransformConstraint = {
  name: string;
  order?: number;
  bones: string[];
  target: string;
  rotation?: number;
  x?: number;
  y?: number;
  rotateMix?: number;
  translateMix?: number;
  scaleMix?: number;
  shearMix?: number;
};

type SpinePathConstraint = {
  name: string;
  order?: number;
  bones: string[];
  target: string;
  position?: number;
  spacing?: number;
  mixRotate?: number;
  mixX?: number;
  mixY?: number;
  translateMix?: number;
};

export type SpineProject = {
  skeleton: { fps?: number; x?: number; y?: number };
  bones: SpineBone[];
  slots: SpineSlot[];
  skins: unknown;
  ik?: SpineIkConstraint[];
  transform?: SpineTransformConstraint[];
  path?: SpinePathConstraint[];
  animations: Record<string, SpineAnimation>;
  atlas: {
    pages: Record<
      string,
      {
        size?: { w: number; h: number };
        pma?: boolean;
        regions: Record<
          string,
          { x: number; y: number; w: number; h: number; rotate: boolean; origW?: number; origH?: number; offX?: number; offY?: number }
        >;
      }
    >;
    regionToPage: Record<string, string>;
  };
  images: Record<string, string>;
};

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function parseHex8(hex8: string | undefined) {
  const normalized = (hex8 || "ffffffff").trim().replace("#", "");
  const s = normalized.length === 8 ? normalized : "ffffffff";
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const a = parseInt(s.slice(6, 8), 16);
  return { r, g, b, a };
}

function rgbaToCss(r: number, g: number, b: number) {
  return `rgb(${r},${g},${b})`;
}

function resolveBlendComposite(blend: unknown): GlobalCompositeOperation {
  const b = String(blend || '').trim().toLowerCase();
  if (b === 'add' || b === 'additive' || b === 'lighter') return 'lighter';
  if (b === 'multiply') return 'multiply';
  if (b === 'screen') return 'screen';
  return 'source-over';
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function timeOf(frame: { time?: number } | undefined) {
  const t = frame?.time;
  return typeof t === 'number' && Number.isFinite(t) ? t : 0;
}

export function interpolateSpineRotateAngle(a: number, b: number, t: number) {
  let delta = (b - a) % 360;
  if (delta >= 180) delta -= 360;
  if (delta < -180) delta += 360;
  return a + delta * t;
}

function shortestAngleLerp(a: number, b: number, t: number) {
  return interpolateSpineRotateAngle(a, b, t);
}

function numericField(frame: Record<string, unknown> | undefined, names: string[], fallback: number) {
  if (!frame) return fallback;
  for (const name of names) {
    const value = frame[name];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return fallback;
}

function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function sampleSpineCurvePercent(percent: number, frame: Record<string, unknown> | undefined) {
  const p = clamp01(percent);
  const curve = frame?.curve;
  if (curve === 'stepped') return 0;
  if (Array.isArray(curve) && curve.length >= 4) {
    const x1 = Number(curve[0]);
    const y1 = Number(curve[1]);
    const x2 = Number(curve[2]);
    const y2 = Number(curve[3]);
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        const x = cubicBezier(mid, 0, x1, x2, 1);
        if (x < p) lo = mid;
        else hi = mid;
      }
      return clamp01(cubicBezier((lo + hi) / 2, 0, y1, y2, 1));
    }
  }
  if (
    typeof curve !== 'number' &&
    typeof frame?.c1 !== 'number' &&
    typeof frame?.c2 !== 'number' &&
    typeof frame?.c3 !== 'number' &&
    typeof frame?.c4 !== 'number'
  ) {
    return p;
  }
  const x1 = numericField(frame, ['curve', 'c1', 'cx1'], 0.25);
  const y1 = numericField(frame, ['c2', 'cy1'], x1);
  const x2 = numericField(frame, ['c3', 'cx2'], 0.75);
  const y2 = numericField(frame, ['c4', 'cy2'], x2);
  if ([x1, y1, x2, y2].every(Number.isFinite)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      const x = cubicBezier(mid, 0, x1, x2, 1);
      if (x < p) lo = mid;
      else hi = mid;
    }
    return clamp01(cubicBezier((lo + hi) / 2, 0, y1, y2, 1));
  }
  return p;
}

export function sampleSpineScalarCurveValue(
  t: number,
  frame: Record<string, unknown> | undefined,
  startTime: number,
  endTime: number,
  startValue: number,
  endValue: number,
  absoluteCurve: boolean
) {
  const denom = Math.max(1e-6, endTime - startTime);
  const percent = clamp01((t - startTime) / denom);
  const curve = frame?.curve;
  if (Array.isArray(curve) && curve.length >= 4) {
    const x1 = Number(curve[0]);
    const y1 = Number(curve[1]);
    const x2 = Number(curve[2]);
    const y2 = Number(curve[3]);
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        const x = cubicBezier(mid, startTime, x1, x2, endTime);
        if (x < t) lo = mid;
        else hi = mid;
      }
      const u = (lo + hi) / 2;
      if (absoluteCurve) return cubicBezier(u, startValue, y1, y2, endValue);
      return lerp(startValue, endValue, clamp01(cubicBezier(u, 0, y1, y2, 1)));
    }
  }
  return lerp(startValue, endValue, sampleSpineCurvePercent(percent, frame));
}

function evalTimelineAngle(frames: RotateFrame[] | undefined, t: number, fallback: number) {
  if (!frames || frames.length === 0) return fallback;
  if (t <= timeOf(frames[0])) return numericField(frames[0] as any, ['angle', 'value'], fallback);
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (t >= ta && t <= tb) {
      if (a.curve === "stepped") return numericField(a as any, ['angle', 'value'], fallback);
      const av = numericField(a as any, ['angle', 'value'], fallback);
      const bv = numericField(b as any, ['angle', 'value'], fallback);
      if (Array.isArray((a as any).curve)) {
        return sampleSpineScalarCurveValue(t, a as any, ta, tb, av, bv, true);
      }
      const u = sampleSpineCurvePercent((t - ta) / Math.max(1e-6, tb - ta), a as any);
      return shortestAngleLerp(av, bv, u);
    }
  }
  return numericField(frames[frames.length - 1] as any, ['angle', 'value'], fallback);
}

function evalTimelineXY(frames: TranslateFrame[] | ScaleFrame[] | undefined, t: number, fallbackX: number, fallbackY: number) {
  if (!frames || frames.length === 0) return { x: fallbackX, y: fallbackY };
  if (t <= timeOf(frames[0])) return { x: frames[0].x ?? fallbackX, y: frames[0].y ?? fallbackY };
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (t >= ta && t <= tb) {
      if (a.curve === "stepped") return { x: a.x ?? fallbackX, y: a.y ?? fallbackY };
      const ax = a.x ?? fallbackX;
      const ay = a.y ?? fallbackY;
      const bx = b.x ?? fallbackX;
      const by = b.y ?? fallbackY;
      if (Array.isArray(a.curve) && a.curve.length >= 8) {
        return {
          x: sampleSpineScalarCurveValue(t, { curve: a.curve.slice(0, 4) }, ta, tb, ax, bx, true),
          y: sampleSpineScalarCurveValue(t, { curve: a.curve.slice(4, 8) }, ta, tb, ay, by, true),
        };
      }
      const u = sampleSpineCurvePercent((t - ta) / Math.max(1e-6, tb - ta), a as any);
      return { x: lerp(ax, bx, u), y: lerp(ay, by, u) };
    }
  }
  const last = frames[frames.length - 1];
  return { x: last.x ?? fallbackX, y: last.y ?? fallbackY };
}

function evalTimelineColor(frames: ColorFrame[] | undefined, t: number, fallback: string) {
  if (!frames || frames.length === 0) return fallback;
  if (t <= timeOf(frames[0])) return frames[0].color ?? fallback;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (t >= ta && t <= tb) {
      if (a.curve === "stepped") return a.color ?? fallback;
      const u = sampleSpineCurvePercent((t - ta) / Math.max(1e-6, tb - ta), a as any);
      const ca = parseHex8(a.color ?? fallback);
      const cb = parseHex8(b.color ?? a.color ?? fallback);
      const r = Math.round(lerp(ca.r, cb.r, u));
      const g = Math.round(lerp(ca.g, cb.g, u));
      const bch = Math.round(lerp(ca.b, cb.b, u));
      const aCh = Math.round(lerp(ca.a, cb.a, u));
      return `${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bch.toString(16).padStart(2, "0")}${aCh.toString(16).padStart(2, "0")}`;
    }
  }
  return frames[frames.length - 1].color ?? fallback;
}

export function evalSlotTimelineHex(slotTimeline: { color?: ColorFrame[]; rgba?: ColorFrame[] } | undefined, t: number, fallback: string) {
  return evalTimelineColor(slotTimeline?.rgba || slotTimeline?.color, t, fallback);
}

function evalTimelineAttachment(frames: { time: number; name?: string | null; curve?: unknown }[] | undefined, t: number) {
  if (!frames || frames.length === 0) return undefined;
  let name: string | null | undefined = undefined;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (t + 1e-6 < timeOf(f)) break;
    name = f.name;
  }
  return name;
}

function resolveDeformFrame(
  anim: SpineAnimation,
  t: number,
  slotName: string,
  attachmentName: string
): { offset: number; vertices: number[] } | null {
  const deform = anim.deform;
  if (!deform) return null;
  const skinName = deform.default ? 'default' : Object.keys(deform)[0];
  if (!skinName) return null;
  const slotMap = deform[skinName];
  const attachMap = slotMap?.[slotName];
  const frames = attachMap?.[attachmentName];
  if (!frames || frames.length === 0) return null;
  let hit: { time: number; offset?: number; vertices: number[] } | null = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (t + 1e-6 < f.time) break;
    hit = f;
  }
  if (!hit) return null;
  return { offset: hit.offset ?? 0, vertices: hit.vertices || [] };
}

function buildDeformArray(frame: { offset: number; vertices: number[] } | null, vertCount: number) {
  if (!frame) return null;
  const out = new Array<number>(vertCount * 2).fill(0);
  const start = Math.max(0, frame.offset) * 2;
  const src = frame.vertices || [];
  for (let i = 0; i < src.length && start + i < out.length; i++) out[start + i] = src[i] ?? 0;
  return out;
}

function resolveDrawOrder(anim: SpineAnimation, t: number, setupSlotNames: string[]) {
  const frames = anim.drawOrder;
  if (!frames || frames.length === 0) return setupSlotNames;
  let hit: { time?: number; offsets?: { slot: string; offset: number }[] } | null = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (t + 1e-6 < timeOf(f)) break;
    hit = f;
  }
  if (!hit || !hit.offsets || hit.offsets.length === 0) return setupSlotNames;

  const setupIndex: Record<string, number> = {};
  for (let i = 0; i < setupSlotNames.length; i++) setupIndex[setupSlotNames[i]] = i;

  const offsets = hit.offsets
    .map((o) => ({ slotIndex: setupIndex[o.slot], offset: o.offset }))
    .filter((o) => typeof o.slotIndex === 'number')
    .sort((a, b) => a.slotIndex - b.slotIndex);

  const n = setupSlotNames.length;
  const drawOrder = new Array<string | null>(n).fill(null);
  const unchanged: string[] = [];
  let originalIndex = 0;

  for (let i = 0; i < offsets.length; i++) {
    const slotIndex = offsets[i].slotIndex;
    while (originalIndex !== slotIndex) {
      unchanged.push(setupSlotNames[originalIndex++]);
    }
    const drawIndex = Math.max(0, Math.min(n - 1, originalIndex + offsets[i].offset));
    drawOrder[drawIndex] = setupSlotNames[slotIndex];
    originalIndex++;
  }

  while (originalIndex < n) unchanged.push(setupSlotNames[originalIndex++]);

  for (let i = n - 1; i >= 0; i--) {
    if (drawOrder[i] === null) drawOrder[i] = unchanged.pop() || null;
  }

  return drawOrder.filter((s): s is string => !!s);
}

function resolveConstraintFrame<T extends { time?: number }>(frames: T[] | undefined, t: number): T | null {
  if (!frames || frames.length === 0) return null;
  let hit: T | null = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (t + 1e-6 < timeOf(f)) break;
    hit = f;
  }
  return hit || frames[0] || null;
}

function sampleNumericTimeline<T extends Record<string, unknown>>(
  frames: T[] | undefined,
  t: number,
  names: string[],
  fallback: number,
  absoluteCurve = false
) {
  if (!frames || frames.length === 0) return fallback;
  if (t <= timeOf(frames[0])) return numericField(frames[0], names, fallback);
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (t >= ta && t <= tb) {
      const av = numericField(a, names, fallback);
      const bv = numericField(b, names, fallback);
      return sampleSpineScalarCurveValue(t, a, ta, tb, av, bv, absoluteCurve);
    }
  }
  return numericField(frames[frames.length - 1], names, fallback);
}

export function parseAtlas(atlasText: string) {
  const lines = atlasText.split(/\r?\n/);
  const pages: Record<
    string,
    {
      size?: { w: number; h: number };
      pma?: boolean;
      regions: Record<string, { x: number; y: number; w: number; h: number; rotate: boolean; origW?: number; origH?: number; offX?: number; offY?: number }>;
    }
  > = {};
  const regionToPage: Record<string, string> = {};

  const readKV = (line: string) => {
    const idx = line.indexOf(":");
    if (idx === -1) return null;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    return { k, v };
  };

  const readNums = (value: string) => value.split(',').map((s) => parseFloat(s.trim()));
  const isPageMetadata = (key: string) => ['size', 'format', 'filter', 'repeat', 'pma', 'scale'].includes(key);
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && !lines[i].trim()) i++;
    if (i >= lines.length) break;
    const pageName = lines[i].trim();
    i++;
    if (!pageName) continue;

    pages[pageName] = pages[pageName] || { regions: {} };

    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) {
        i++;
        break;
      }
      const kv = readKV(line);
      if (!kv) break;
      if (!isPageMetadata(kv.k)) break;
      if (kv.k === 'size') {
        const m = readNums(kv.v);
        pages[pageName].size = { w: m[0] || 0, h: m[1] || 0 };
      } else if (kv.k === 'pma') {
        pages[pageName].pma = kv.v.toLowerCase() === 'true';
      }
      i++;
    }

    while (i < lines.length) {
      if (!lines[i]?.trim()) {
        i++;
        break;
      }
      const regionName = lines[i]?.trim();
      i++;
      if (!regionName) break;
      if (regionName.includes(":")) continue;

      let rotate = false;
      let x = 0;
      let y = 0;
      let w = 0;
      let h = 0;
      let origW: number | undefined;
      let origH: number | undefined;
      let offX: number | undefined;
      let offY: number | undefined;

      while (i < lines.length) {
        const line = lines[i].trim();
        if (!line) break;
        if (!line.includes(":")) break;
        const kv = readKV(line);
        i++;
        if (!kv) continue;

        if (kv.k === "rotate") {
          const v = kv.v.toLowerCase();
          rotate = v === "true" || v === "90";
        } else if (kv.k === "xy") {
          const m = readNums(kv.v);
          x = m[0] || 0;
          y = m[1] || 0;
        } else if (kv.k === "size") {
          const m = readNums(kv.v);
          w = m[0] || 0;
          h = m[1] || 0;
        } else if (kv.k === "orig") {
          const m = readNums(kv.v);
          origW = m[0] || 0;
          origH = m[1] || 0;
        } else if (kv.k === "offset") {
          const m = readNums(kv.v);
          offX = m[0] || 0;
          offY = m[1] || 0;
        } else if (kv.k === "bounds") {
          const m = readNums(kv.v);
          x = m[0] || 0;
          y = m[1] || 0;
          w = m[2] || 0;
          h = m[3] || 0;
        } else if (kv.k === "offsets") {
          const m = readNums(kv.v);
          offX = m[0] || 0;
          offY = m[1] || 0;
          origW = m[2] || 0;
          origH = m[3] || 0;
        }
      }

      pages[pageName].regions[regionName] = { x, y, w, h, rotate, origW, origH, offX, offY };
      regionToPage[regionName] = pageName;
    }
  }

  return { pages, regionToPage };
}

export function buildSpineProject(jsonText: string, atlasText: string, images: { fileName: string; dataUrl: string }[]) {
  const parsed = JSON.parse(jsonText);
  normalizeAttachmentArrays(parsed.skins);
  const atlas = parseAtlas(atlasText);
  const imagesMap: Record<string, string> = {};
  for (const img of images) {
    const fileName = String(img.fileName || '');
    const dataUrl = String(img.dataUrl || '');
    if (!fileName || !dataUrl) continue;
    imagesMap[fileName] = dataUrl;
    const base = getBaseName(fileName);
    imagesMap[base] = dataUrl;
    imagesMap[stripExt(base)] = dataUrl;
    imagesMap[normalizePathKey(fileName)] = dataUrl;
    imagesMap[normalizePathKey(base)] = dataUrl;
    imagesMap[normalizePathKey(stripExt(base))] = dataUrl;
  }

  const atlasPages = atlas?.pages ? Object.keys(atlas.pages) : [];
  if (atlasPages.length > 0) {
    for (const pageName of atlasPages) {
      const want = String(pageName || '');
      if (!want) continue;
      const base = getBaseName(want);
      const noExt = stripExt(base);
      const url =
        imagesMap[want] ||
        imagesMap[base] ||
        imagesMap[noExt] ||
        imagesMap[stripExt(want)] ||
        imagesMap[normalizePathKey(want)] ||
        imagesMap[normalizePathKey(base)] ||
        imagesMap[normalizePathKey(noExt)] ||
        null;
      if (!url) continue;
      imagesMap[want] = url;
      imagesMap[base] = url;
      imagesMap[noExt] = url;
      imagesMap[normalizePathKey(want)] = url;
      imagesMap[normalizePathKey(base)] = url;
      imagesMap[normalizePathKey(noExt)] = url;
    }
  }
  return {
    skeleton: parsed.skeleton || {},
    bones: parsed.bones || [],
    slots: parsed.slots || [],
    skins: parsed.skins || {},
    ik: parsed.ik || [],
    transform: parsed.transform || [],
    path: parsed.path || [],
    animations: parsed.animations || {},
    atlas,
    images: imagesMap
  } as SpineProject;
}

type WorldBone = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  a: number;
  b: number;
  c: number;
  d: number;
};

type LocalBone = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  length: number;
  shearX?: number;
  shearY?: number;
  transformMode?: string;
  parent?: string;
};

export function composeSpineWorldBone(local: LocalBone, parent?: WorldBone | null): WorldBone {
  const shearX = local.shearX ?? 0;
  const shearY = local.shearY ?? 0;
  const rx = ((local.rotation + shearX) * Math.PI) / 180;
  const ry = ((local.rotation + shearY + 90) * Math.PI) / 180;
  const la = Math.cos(rx) * local.scaleX;
  const lb = Math.sin(rx) * local.scaleX;
  const lc = Math.cos(ry) * local.scaleY;
  const ld = Math.sin(ry) * local.scaleY;

  if (!parent) {
    return {
      x: local.x,
      y: local.y,
      rotation: local.rotation,
      scaleX: local.scaleX,
      scaleY: local.scaleY,
      a: la,
      b: lb,
      c: lc,
      d: ld,
    };
  }

  const x = parent.a * local.x + parent.c * local.y + parent.x;
  const y = parent.b * local.x + parent.d * local.y + parent.y;
  const mode = String(local.transformMode || '').trim();

  if (mode === 'noScale') {
    const pr = Math.atan2(parent.b, parent.a);
    const pa = Math.cos(pr);
    const pb = Math.sin(pr);
    const pc = Math.cos(pr + Math.PI / 2);
    const pd = Math.sin(pr + Math.PI / 2);
    const a = pa * la + pc * lb;
    const b = pb * la + pd * lb;
    const c = pa * lc + pc * ld;
    const d = pb * lc + pd * ld;
    return { x, y, rotation: (Math.atan2(b, a) * 180) / Math.PI, scaleX: local.scaleX, scaleY: local.scaleY, a, b, c, d };
  }

  if (mode === 'noRotationOrReflection') {
    let pa = parent.a;
    let pb = parent.c;
    let pc = parent.b;
    let pd = parent.d;
    let s = pa * pa + pc * pc;
    let prx = 0;
    if (s > 0.0001) {
      s = Math.abs(pa * pd - pb * pc) / s;
      pb = pc * s;
      pd = pa * s;
      prx = (Math.atan2(pc, pa) * 180) / Math.PI;
    } else {
      pa = 0;
      pc = 0;
      prx = 90 - (Math.atan2(pd, pb) * 180) / Math.PI;
    }
    const nrx = ((local.rotation + shearX - prx) * Math.PI) / 180;
    const nry = ((local.rotation + shearY - prx + 90) * Math.PI) / 180;
    const nla = Math.cos(nrx) * local.scaleX;
    const nlb = Math.cos(nry) * local.scaleY;
    const nlc = Math.sin(nrx) * local.scaleX;
    const nld = Math.sin(nry) * local.scaleY;
    const oa = pa * nla - pb * nlc;
    const ob = pa * nlb - pb * nld;
    const oc = pc * nla + pd * nlc;
    const od = pc * nlb + pd * nld;
    return {
      x,
      y,
      rotation: (Math.atan2(oc, oa) * 180) / Math.PI,
      scaleX: Math.hypot(oa, oc),
      scaleY: Math.hypot(ob, od),
      a: oa,
      b: oc,
      c: ob,
      d: od,
    };
  }

  const a = parent.a * la + parent.c * lb;
  const b = parent.b * la + parent.d * lb;
  const c = parent.a * lc + parent.c * ld;
  const d = parent.b * lc + parent.d * ld;
  return {
    x,
    y,
    rotation: (Math.atan2(b, a) * 180) / Math.PI,
    scaleX: Math.hypot(a, b),
    scaleY: Math.hypot(c, d),
    a,
    b,
    c,
    d,
  };
}

function resolveSkinAttachments(skins: unknown, skinName: string | null | undefined) {
  const want = String(skinName || '').trim()
  if (!skins) return {} as Record<string, Record<string, SpineAttachmentRegion>>
  if (typeof skins === 'object' && !Array.isArray(skins)) {
    const map = skins as Record<string, any>
    if (want && map[want] && typeof map[want] === 'object') return map[want] as any
    if (map.default && typeof map.default === 'object') return map.default as any
    const keys = Object.keys(map)
    for (const k of keys) {
      if (map[k] && typeof map[k] === 'object') return map[k] as any
    }
    return {} as any
  }
  if (Array.isArray(skins)) {
    if (want) {
      const hit = (skins as any[]).find((s) => String((s as any)?.name || '').trim() === want)
      if (hit?.attachments && typeof hit.attachments === 'object') return hit.attachments as any
    }
    const first = skins[0] as { attachments?: unknown } | undefined
    if (first?.attachments && typeof first.attachments === 'object') return first.attachments as any
  }
  return {} as Record<string, Record<string, SpineAttachmentRegion>>
}

function getBaseName(filePath: string) {
  const s = (filePath || "").replace(/\\/g, "/");
  const idx = s.lastIndexOf("/");
  return idx >= 0 ? s.slice(idx + 1) : s;
}

function stripExt(name: string) {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return name;
  return name.slice(0, idx);
}

function normalizePathKey(name: string) {
  return (name || '').replace(/\\/g, '/').trim().toLowerCase();
}

function normalizeRegionName(name: string) {
  const s = (name || '').replace(/\\/g, '/').trim();
  const base = getBaseName(s);
  return stripExt(base).toLowerCase();
}

function parseNumberList(value: unknown) {
  if (Array.isArray(value)) return value.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (typeof value !== 'string') return value;
  return value
    .split(/[\s,]+/)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
}

function normalizeAttachmentArrays(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) normalizeAttachmentArrays(item);
    return value;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (['uvs', 'triangles', 'vertices', 'edges'].includes(key)) obj[key] = parseNumberList(obj[key]);
    else normalizeAttachmentArrays(obj[key]);
  }
  return value;
}

export function makeSpineRegionCanvasCacheKey(url: string, rgb: string, pageKey: string, regionKey: string) {
  return `${url}::${rgb}::${pageKey}::${regionKey}`;
}

export function detectLikelyPremultipliedAlphaFromImageData(data: Uint8ClampedArray, width: number, height: number) {
  let semi = 0;
  let muted = 0;
  const total = Math.max(0, width * height);
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const a = data[idx + 3] || 0;
    if (a <= 0 || a >= 250) continue;
    semi++;
    const maxRgb = Math.max(data[idx] || 0, data[idx + 1] || 0, data[idx + 2] || 0);
    if (maxRgb <= a + 8) muted++;
  }
  return semi > 0 && muted / semi >= 0.6;
}

export function computeSpineWeightedWorldPositions(
  vertices: number[],
  vertCount: number,
  bonesByIndex: string[],
  world: Record<string, WorldBone>,
  deform: number[] | null,
  attX: number,
  attY: number,
  attRotDeg: number,
  attSX: number,
  attSY: number
) {
  const out = new Array<number>(vertCount * 2);
  let p = 0;
  let i = 0;
  const rad = (attRotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let deformIndex = 0;
  for (let v = 0; v < vertCount; v++) {
    const boneCount = vertices[i++] ?? 0;
    let wx = 0;
    let wy = 0;
    for (let b = 0; b < boneCount; b++) {
      const boneIndex = vertices[i++] ?? 0;
      const ddx = deform ? (deform[deformIndex * 2] ?? 0) : 0;
      const ddy = deform ? (deform[deformIndex * 2 + 1] ?? 0) : 0;
      deformIndex++;
      const vx0 = (vertices[i++] ?? 0) + ddx;
      const vy0 = (vertices[i++] ?? 0) + ddy;
      const weight = vertices[i++] ?? 0;
      const boneName = bonesByIndex[boneIndex];
      const wb = boneName ? world[boneName] : undefined;
      if (!wb) continue;
      const vx1 = (vx0 * cos * attSX) - (vy0 * sin * attSY) + attX;
      const vy1 = (vx0 * sin * attSX) + (vy0 * cos * attSY) + attY;
      const x = vx1 * wb.a + vy1 * wb.c + wb.x;
      const y = vx1 * wb.b + vy1 * wb.d + wb.y;
      wx += x * weight;
      wy += y * weight;
    }
    out[p++] = wx;
    out[p++] = wy;
  }
  return out;
}

export function computeSpineUnweightedWorldPositions(
  vertices: number[],
  vertCount: number,
  wb: WorldBone,
  deform: number[] | null,
  attX: number,
  attY: number,
  attRotDeg: number,
  attSX: number,
  attSY: number
) {
  const out = new Array<number>(vertCount * 2);
  const rad = (attRotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (let v = 0; v < vertCount; v++) {
    const vx0 = (vertices[v * 2] ?? 0) + (deform?.[v * 2] ?? 0);
    const vy0 = (vertices[v * 2 + 1] ?? 0) + (deform?.[v * 2 + 1] ?? 0);
    const vx1 = (vx0 * cos * attSX) - (vy0 * sin * attSY) + attX;
    const vy1 = (vx0 * sin * attSX) + (vy0 * cos * attSY) + attY;
    out[v * 2] = vx1 * wb.a + vy1 * wb.c + wb.x;
    out[v * 2 + 1] = vx1 * wb.b + vy1 * wb.d + wb.y;
  }
  return out;
}

export function analyzeSpineProjectMeshStats(project: SpineProject) {
  let attachmentCount = 0;
  let triangleCount = 0;
  let weightedCount = 0;
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const obj = value as Record<string, any>;
    const type = String(obj.type || '').toLowerCase();
    if (type === 'mesh' || type === 'linkedmesh' || (Array.isArray(obj.triangles) && Array.isArray(obj.vertices))) {
      attachmentCount++;
      triangleCount += Math.floor((obj.triangles?.length || 0) / 3);
      const uvs = Array.isArray(obj.uvs) ? obj.uvs : [];
      const verts = Array.isArray(obj.vertices) ? obj.vertices : [];
      if (verts.length !== Math.floor(uvs.length / 2) * 2) weightedCount++;
    }
    for (const key of Object.keys(obj)) visit(obj[key]);
  };
  visit(project.skins);
  return { attachmentCount, triangleCount, weightedCount };
}

const sequenceTimelineCache = new WeakMap<object, Map<string, any[] | null>>();

function resolveSequenceTimelineFrames(anim: SpineAnimation, slotName: string, attachmentName: string) {
  const root: any = (anim as any).attachments;
  if (!root || typeof root !== 'object') return null;

  let cache = sequenceTimelineCache.get(anim as any);
  if (!cache) {
    cache = new Map<string, any[] | null>();
    sequenceTimelineCache.set(anim as any, cache);
  }
  const cacheKey = `${slotName}::${attachmentName}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) || null;

  const direct = root?.default?.[slotName]?.[attachmentName]?.sequence;
  if (Array.isArray(direct)) {
    cache.set(cacheKey, direct);
    return direct;
  }

  const visited = new Set<any>();
  const stack: any[] = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const hit = cur?.[slotName]?.[attachmentName]?.sequence;
    if (Array.isArray(hit)) {
      cache.set(cacheKey, hit);
      return hit;
    }
    for (const k of Object.keys(cur)) {
      const v = cur[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }

  cache.set(cacheKey, null);
  return null;
}

function evalSequenceIndex(
  frames: { time?: number; mode?: string; index?: number; delay?: number }[] | null,
  t: number,
  seq: { count?: number; setup?: number }
) {
  const count = Math.max(0, Math.floor(Number(seq.count ?? 0)));
  if (!frames || frames.length === 0 || count <= 0) return -1;
  let key: any = null;
  let lastDelay = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const ft = timeOf(f);
    if (t + 1e-6 < ft) break;
    key = f;
    if (typeof f.delay === 'number' && Number.isFinite(f.delay)) lastDelay = f.delay;
  }
  if (!key) return -1;

  const mode = String(key.mode || 'hold');
  const startIndexRaw = Math.floor(Number(key.index ?? 0));
  const startIndex = ((startIndexRaw % count) + count) % count;
  const delay = Number.isFinite(key.delay as any) ? Number(key.delay) : lastDelay;
  if (!(delay > 1e-9)) return startIndex;

  const steps = Math.max(0, Math.floor((t - timeOf(key)) / delay + 1e-9));

  const pingpong = (base: number, delta: number, reverse: boolean) => {
    if (count <= 1) return 0;
    const span = count * 2 - 2;
    const n = reverse ? (base - delta) : (base + delta);
    let m = n % span;
    if (m < 0) m += span;
    return m < count ? m : span - m;
  };

  if (mode === 'hold') return startIndex;
  if (mode === 'once') return Math.min(startIndex + steps, count - 1);
  if (mode === 'loop') return (startIndex + steps) % count;
  if (mode === 'pingpong') return pingpong(startIndex, steps, false);
  if (mode === 'onceReverse') return Math.max(startIndex - steps, 0);
  if (mode === 'loopReverse') {
    const v = (startIndex - steps) % count;
    return v < 0 ? v + count : v;
  }
  if (mode === 'pingpongReverse') return pingpong(startIndex, steps, true);
  return startIndex;
}

function resolveSequenceRegionName(
  att: SpineAttachmentRegion,
  attachmentName: string,
  index: number
) {
  const seq = att.sequence || {};
  const basePath = att.path || att.name || attachmentName;
  const start = Math.floor(Number(seq.start ?? 0));
  const digits = Math.max(0, Math.floor(Number(seq.digits ?? 0)));
  const frame = String(Math.max(0, start + Math.max(0, index)));
  return `${basePath}${frame.padStart(digits, '0')}`;
}

export class SpineMiniPlayer {
  private ctx: CanvasRenderingContext2D;
  private project: SpineProject;
  private animationName: string;
  private time = 0;
  private playing = true;
  private hud = true;
  private lastTs = 0;
  private raf = 0;
  private tintedCache = new Map<string, HTMLCanvasElement>();
  private regionCache = new Map<string, HTMLCanvasElement>();
  private regionKeyCache = new Map<string, { pageKey: string; regionKey: string } | null>();
  private textureCache = new Map<string, HTMLCanvasElement>();
  private skinName: string | null = null;
  public lastComputedWorld: Record<string, WorldBone> = {};

  constructor(ctx: CanvasRenderingContext2D, project: SpineProject, animationName: string) {
    this.ctx = ctx;
    this.project = project;
    this.animationName = animationName;
  }

  setAnimation(name: string) {
    this.animationName = name;
    this.time = 0;
  }

  setSkin(name: string | null) {
    const s = String(name || '').trim()
    this.skinName = s ? s : null
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
  }

  setHud(enabled: boolean) {
    this.hud = !!enabled;
  }

  getDurationSec() {
    return this.getDuration();
  }

  renderAt(timeSec: number, opts?: { clear?: boolean }) {
    this.time = Number.isFinite(timeSec) ? timeSec : 0;
    this.draw(opts);
  }

  start() {
    this.lastTs = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - this.lastTs) / 1000;
      this.lastTs = now;
      if (this.playing) this.time += dt;
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  private getDuration() {
    const anim = this.project.animations?.[this.animationName];
    if (!anim) return 0;
    if (typeof anim.duration === "number" && anim.duration > 0) return anim.duration;
    let maxT = 0;
    const bones = anim.bones || {};
    const slots = anim.slots || {};
    for (const k of Object.keys(bones)) {
      const b = bones[k] || {};
      for (const list of [b.translate, b.rotate, b.scale, b.shear]) {
        const last = list?.[list.length - 1];
        if (last) maxT = Math.max(maxT, timeOf(last as { time?: number }));
      }
    }
    for (const k of Object.keys(slots)) {
      const s = slots[k] || {};
      const colorFrames = s.rgba || s.color;
      const last = colorFrames?.[colorFrames.length - 1];
      if (last) maxT = Math.max(maxT, timeOf(last as { time?: number }));
      const lastAtt = s.attachment?.[s.attachment.length - 1];
      if (lastAtt) maxT = Math.max(maxT, timeOf(lastAtt as { time?: number }));
    }
    const attachments = anim.attachments || {};
    for (const skinName of Object.keys(attachments)) {
      const skin = (attachments as any)[skinName] || {};
      for (const slotName of Object.keys(skin)) {
        const slotMap = skin[slotName] || {};
        for (const attName of Object.keys(slotMap)) {
          const seq = slotMap[attName]?.sequence;
          if (Array.isArray(seq) && seq.length > 0) {
            const last = seq[seq.length - 1];
            maxT = Math.max(maxT, timeOf(last as { time?: number }));
          }
        }
      }
    }
    const drawOrder = anim.drawOrder || [];
    if (Array.isArray(drawOrder) && drawOrder.length) {
      const last = drawOrder[drawOrder.length - 1];
      if (last) maxT = Math.max(maxT, timeOf(last as { time?: number }));
    }
    for (const group of [anim.ik, anim.transform]) {
      for (const key of Object.keys(group || {})) {
        const list = (group as any)?.[key];
        const last = Array.isArray(list) ? list[list.length - 1] : null;
        if (last) maxT = Math.max(maxT, timeOf(last as { time?: number }));
      }
    }
    for (const key of Object.keys(anim.path || {})) {
      const pathAnim = (anim.path as any)?.[key] || {};
      for (const list of [pathAnim.position, pathAnim.spacing, pathAnim.mix]) {
        const last = Array.isArray(list) ? list[list.length - 1] : null;
        if (last) maxT = Math.max(maxT, timeOf(last as { time?: number }));
      }
    }
    for (const skinName of Object.keys(anim.deform || {})) {
      const skin = (anim.deform as any)[skinName] || {};
      for (const slotName of Object.keys(skin)) {
        for (const attName of Object.keys(skin[slotName] || {})) {
          const list = skin[slotName][attName];
          const last = Array.isArray(list) ? list[list.length - 1] : null;
          if (last) maxT = Math.max(maxT, timeOf(last as { time?: number }));
        }
      }
    }
    return maxT;
  }

  private resolveRegionKey(regionName: string) {
    const cacheKey = normalizePathKey(regionName);
    if (this.regionKeyCache.has(cacheKey)) return this.regionKeyCache.get(cacheKey);

    const regionToPage = this.project.atlas.regionToPage || {};
    const direct = regionToPage[regionName];
    if (direct) {
      const hit = { pageKey: direct, regionKey: regionName };
      this.regionKeyCache.set(cacheKey, hit);
      return hit;
    }

    const targetPath = normalizePathKey(stripExt(regionName));
    const targetBase = normalizeRegionName(regionName);
    const keys = Object.keys(regionToPage);
    for (const k of keys) {
      const pageKey = regionToPage[k];
      const kPath = normalizePathKey(stripExt(k));
      if (kPath === targetPath) {
        const hit = { pageKey, regionKey: k };
        this.regionKeyCache.set(cacheKey, hit);
        return hit;
      }
      if (normalizeRegionName(k) === targetBase) {
        const hit = { pageKey, regionKey: k };
        this.regionKeyCache.set(cacheKey, hit);
        return hit;
      }
    }

    this.regionKeyCache.set(cacheKey, null);
    return null;
  }

  private getImageForRegion(regionName: string) {
    const resolved = this.resolveRegionKey(regionName);
    if (!resolved) return null;

    const pageKey = resolved.pageKey;
    const regionKey = resolved.regionKey;

    const images: any = this.project.images || {};
    const base = getBaseName(pageKey);
    const noExtBase = stripExt(base);
    const noExtFull = stripExt(pageKey);
    const url =
      images[pageKey] ||
      images[base] ||
      images[noExtBase] ||
      images[noExtFull] ||
      images[normalizePathKey(pageKey)] ||
      images[normalizePathKey(base)] ||
      images[normalizePathKey(noExtBase)] ||
      images[normalizePathKey(noExtFull)] ||
      null;
    if (!url) return null;

    const region = this.project.atlas.pages?.[pageKey]?.regions?.[regionKey] || null;
    const pageSize = this.project.atlas.pages?.[pageKey]?.size;
    if (!region) return null;
    return { url, region, pageKey, pageSize };
  }

  private getTintedImage(img: HTMLImageElement, rgb: string) {
    const key = `${img.src}::${rgb}`;
    const cached = this.tintedCache.get(key);
    if (cached) return cached;
    const w = Math.max(1, img.naturalWidth || img.width || 1);
    const h = Math.max(1, img.naturalHeight || img.height || 1);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = rgb;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(img, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    this.tintedCache.set(key, c);
    return c;
  }

  private getTextureCanvas(
    regionCanvas: HTMLCanvasElement,
    cacheKey: string,
    atlasRegion: { origW?: number; origH?: number; offX?: number; offY?: number }
  ) {
    const cached = this.textureCache.get(cacheKey);
    if (cached) return cached;

    const packedW = regionCanvas.width;
    const packedH = regionCanvas.height;
    const origW = atlasRegion.origW && atlasRegion.origW > 0 ? atlasRegion.origW : packedW;
    const origH = atlasRegion.origH && atlasRegion.origH > 0 ? atlasRegion.origH : packedH;
    const offX = atlasRegion.offX ?? 0;
    const offY = atlasRegion.offY ?? 0;

    if (origW === packedW && origH === packedH && offX === 0 && offY === 0) {
      this.textureCache.set(cacheKey, regionCanvas);
      return regionCanvas;
    }

    const c = document.createElement('canvas');
    c.width = Math.max(1, origW);
    c.height = Math.max(1, origH);
    const ctx = c.getContext('2d');
    if (!ctx) return regionCanvas;

    ctx.clearRect(0, 0, c.width, c.height);
    const dx = offX;
    const dy = c.height - offY - packedH;
    ctx.drawImage(regionCanvas, dx, dy);

    this.textureCache.set(cacheKey, c);
    return c;
  }

  private getRegionCanvas(source: CanvasImageSource, cacheKey: string, region: { x: number; y: number; w: number; h: number; rotate: boolean }, pageSize?: { w: number; h: number }) {
    const cached = this.regionCache.get(cacheKey);
    if (cached) return cached;

    const srcW = Math.max(1, region.w);
    const srcH = Math.max(1, region.h);
    const outW = srcW;
    const outH = srcH;

    const c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext('2d');
    if (!ctx) return null;

    const pageH = pageSize?.h;
    const sx = region.x;
    const cropW = region.rotate ? srcH : srcW;
    const cropH = region.rotate ? srcW : srcH;
    let sy = region.y;
    if (typeof pageH === 'number' && pageH > 0) {
      const syTop = region.y;
      const syBottom = pageH - region.y - cropH;
      const topValid = syTop >= 0 && syTop + cropH <= pageH;
      const bottomValid = syBottom >= 0 && syBottom + cropH <= pageH;
      if (topValid && bottomValid && Math.abs(syTop - syBottom) > 0.5) {
        const scoreAt = (syValue: number) => {
          try {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, outW, outH);
            if (!region.rotate) {
              ctx.drawImage(source, sx, syValue, cropW, cropH, 0, 0, outW, outH);
            } else {
              ctx.translate(0, outH);
              ctx.rotate(-Math.PI / 2);
              ctx.drawImage(source, sx, syValue, cropW, cropH, 0, 0, cropW, cropH);
            }
            const imgData = ctx.getImageData(0, 0, outW, outH);
            const data = imgData.data;
            const step = Math.max(1, Math.floor(Math.min(outW, outH) / 32));
            let acc = 0;
            for (let y = 0; y < outH; y += step) {
              for (let x = 0; x < outW; x += step) {
                const a = data[(y * outW + x) * 4 + 3] || 0;
                if (a > 0) acc++;
              }
            }
            return acc;
          } catch {
            return -1;
          }
        };
        const sTop = scoreAt(syTop);
        const sBottom = scoreAt(syBottom);
        sy = sBottom > sTop ? syBottom : syTop;
      } else {
        sy = topValid ? syTop : (bottomValid ? syBottom : syTop);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, outW, outH);
    if (!region.rotate) {
      ctx.drawImage(source, sx, sy, cropW, cropH, 0, 0, outW, outH);
    } else {
      ctx.translate(0, outH);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(source, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
    }

    this.regionCache.set(cacheKey, c);
    return c;
  }

  private drawMesh(
    ctx: CanvasRenderingContext2D,
    tex: HTMLCanvasElement,
    mesh: SpineAttachmentRegion,
  ) {
    const uvs = mesh.uvs;
    const triangles = mesh.triangles;
    const vertices = mesh.vertices;
    if (!uvs || !triangles || !vertices) return false;

    const vertCount = Math.floor(uvs.length / 2);
    if (vertCount <= 0) return false;
    if (vertices.length !== vertCount * 2) return false; // weighted mesh not supported

    let maxUv = 0;
    for (let i = 0; i < uvs.length; i++) maxUv = Math.max(maxUv, Math.abs(uvs[i]));
    const uvNormalized = maxUv <= 2;

    const texW = tex.width;
    const texH = tex.height;

    const getS = (i: number) => {
      const u = uvs[i * 2] ?? 0;
      const v = uvs[i * 2 + 1] ?? 0;
      const sx = uvNormalized ? u * texW : u;
      const sy = uvNormalized ? (1 - v) * texH : v;
      return { sx, sy };
    };

    const getD = (i: number) => {
      const x = vertices[i * 2] ?? 0;
      const y = vertices[i * 2 + 1] ?? 0;
      return { dx: x, dy: -y };
    };

    const triCount = Math.floor(triangles.length / 3);
    for (let ti = 0; ti < triCount; ti++) {
      const i0 = triangles[ti * 3] ?? 0;
      const i1 = triangles[ti * 3 + 1] ?? 0;
      const i2 = triangles[ti * 3 + 2] ?? 0;

      const s0 = getS(i0);
      const s1 = getS(i1);
      const s2 = getS(i2);
      const d0 = getD(i0);
      const d1 = getD(i1);
      const d2 = getD(i2);

      const denom = s0.sx * (s1.sy - s2.sy) + s1.sx * (s2.sy - s0.sy) + s2.sx * (s0.sy - s1.sy);
      if (Math.abs(denom) < 1e-6) continue;

      const a = (d0.dx * (s1.sy - s2.sy) + d1.dx * (s2.sy - s0.sy) + d2.dx * (s0.sy - s1.sy)) / denom;
      const c = (d0.dx * (s2.sx - s1.sx) + d1.dx * (s0.sx - s2.sx) + d2.dx * (s1.sx - s0.sx)) / denom;
      const e = (d0.dx * (s1.sx * s2.sy - s2.sx * s1.sy) + d1.dx * (s2.sx * s0.sy - s0.sx * s2.sy) + d2.dx * (s0.sx * s1.sy - s1.sx * s0.sy)) / denom;

      const b = (d0.dy * (s1.sy - s2.sy) + d1.dy * (s2.sy - s0.sy) + d2.dy * (s0.sy - s1.sy)) / denom;
      const d = (d0.dy * (s2.sx - s1.sx) + d1.dy * (s0.sx - s2.sx) + d2.dy * (s1.sx - s0.sx)) / denom;
      const f = (d0.dy * (s1.sx * s2.sy - s2.sx * s1.sy) + d1.dy * (s2.sx * s0.sy - s0.sx * s2.sy) + d2.dy * (s0.sx * s1.sy - s1.sx * s0.sy)) / denom;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(d0.dx, d0.dy);
      ctx.lineTo(d1.dx, d1.dy);
      ctx.lineTo(d2.dx, d2.dy);
      ctx.closePath();
      ctx.clip();
      ctx.transform(a, b, c, d, e, f);
      ctx.drawImage(tex, 0, 0);
      ctx.restore();
    }

    return true;
  }

  public resolveSlotAttachmentName(slot: SpineSlot, anim: SpineAnimation, t: number) {
    const slotAnim = anim.slots?.[slot.name];
    const frames = slotAnim?.attachment;
    if (frames && frames.length > 0) {
      const hit = evalTimelineAttachment(frames, t);
      return hit === undefined ? null : hit;
    }
    if (slot.attachment) return slot.attachment;
    const allAnimations = this.project.animations || {};
    for (const animName of Object.keys(allAnimations)) {
      if (allAnimations[animName] === anim) continue;
      const otherFrames = allAnimations[animName]?.slots?.[slot.name]?.attachment;
      if (otherFrames && otherFrames.length > 0) return null;
    }
    const skin = resolveSkinAttachments(this.project.skins, this.skinName);
    const names = Object.keys(skin?.[slot.name] || {});
    return names.length === 1 ? names[0] : null;
  }

  private resolveAttachment(
    skinOrSlotName: Record<string, Record<string, SpineAttachmentRegion>> | string,
    slotNameOrAttachmentName: string,
    maybeAttachmentName?: string
  ): SpineAttachmentRegion | { attachment: SpineAttachmentRegion | null } | null {
    if (typeof skinOrSlotName === 'string') {
      const skin = resolveSkinAttachments(this.project.skins, this.skinName);
      const attachment = this.resolveAttachment(skin, skinOrSlotName, slotNameOrAttachmentName) as SpineAttachmentRegion | null;
      return { attachment };
    }
    const skin = skinOrSlotName;
    const slotName = slotNameOrAttachmentName;
    const attachmentName = maybeAttachmentName || '';
    const att = skin?.[slotName]?.[attachmentName];
    if (!att) return null;
    const type = (att.type || 'region').toLowerCase();
    if (type !== 'linkedmesh') return att;

    const hasData = !!(att.uvs && att.triangles && att.vertices);
    if (hasData) return att;

    const parentName = att.parent;
    if (!parentName) return att;
    const parent = skin?.[slotName]?.[parentName];
    if (!parent) return att;
    return {
      ...parent,
      ...att,
      uvs: att.uvs || parent.uvs,
      triangles: att.triangles || parent.triangles,
      vertices: att.vertices || parent.vertices,
    };
  }

  private computeWeightedWorldPositions(
    vertices: number[],
    vertCount: number,
    bonesByIndex: string[],
    world: Record<string, WorldBone>,
    deform: number[] | null,
    attX: number,
    attY: number,
    attRotDeg: number,
    attSX: number,
    attSY: number
  ) {
    return computeSpineWeightedWorldPositions(vertices, vertCount, bonesByIndex, world, deform, attX, attY, attRotDeg, attSX, attSY);
  }

  private applyIkConstraints(
    locals: Record<string, LocalBone>,
    getWorld: () => Record<string, WorldBone>,
    constraints: SpineIkConstraint[] | undefined,
    anim: SpineAnimation
  ) {
    if (!constraints || constraints.length === 0) return;
    const sorted = [...constraints].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const c of sorted) {
      const tl = resolveConstraintFrame(anim.ik?.[c.name], this.time);
      const mix = typeof tl?.mix === 'number' ? tl.mix : (typeof c.mix === 'number' ? c.mix : 1);
      if (mix <= 1e-6) continue;
      const bendPositive = typeof tl?.bendPositive === 'boolean' ? tl.bendPositive : c.bendPositive;
      const chain = c.bones || [];
      if (chain.length === 0) continue;

      const world = getWorld();
      const target = world[c.target];
      if (!target) continue;

      if (chain.length === 1) {
        const boneName = chain[0];
        const boneW = world[boneName];
        const boneL = locals[boneName];
        if (!boneW || !boneL) continue;

        const parentName = boneL.parent;
        const parentW = parentName ? world[parentName] : null;
        const parentRot = parentW ? parentW.rotation : 0;

        const dx = target.x - boneW.x;
        const dy = target.y - boneW.y;
        const desiredWorldRot = (Math.atan2(dy, dx) * 180) / Math.PI;
        const newWorldRot = shortestAngleLerp(boneW.rotation, desiredWorldRot, mix);
        boneL.rotation = newWorldRot - parentRot;
        continue;
      }

      if (chain.length >= 2) {
        const parentName = chain[0];
        const childName = chain[1];
        const pw = world[parentName];
        const cw = world[childName];
        const pl = locals[parentName];
        const cl = locals[childName];
        if (!pw || !cw || !pl || !cl) continue;

        const ppName = pl.parent;
        const ppw = ppName ? world[ppName] : null;
        const ppRot = ppw ? ppw.rotation : 0;

        const l1 = Math.max(1e-6, pl.length * pl.scaleX);
        const l2 = Math.max(1e-6, cl.length * cl.scaleX);

        const dx = target.x - pw.x;
        const dy = target.y - pw.y;
        const dist = Math.max(1e-6, Math.hypot(dx, dy));
        const angleToTarget = Math.atan2(dy, dx);

        const cosA1 = clamp01((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist));
        const cosA2 = clamp01((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2));
        const a1 = Math.acos(cosA1);
        const a2 = Math.acos(cosA2);

        const bendPos = bendPositive !== false;
        const sign = bendPos ? 1 : -1;

        const parentDesired = angleToTarget - a1 * sign;
        const childDesired = parentDesired + (Math.PI - a2) * sign;

        const parentDesiredDeg = (parentDesired * 180) / Math.PI;
        const childDesiredDeg = (childDesired * 180) / Math.PI;

        const parentNewWorld = shortestAngleLerp(pw.rotation, parentDesiredDeg, mix);
        const childNewWorld = shortestAngleLerp(cw.rotation, childDesiredDeg, mix);

        pl.rotation = parentNewWorld - ppRot;
        cl.rotation = childNewWorld - parentNewWorld;
      }
    }
  }

  private applyTransformConstraints(
    locals: Record<string, LocalBone>,
    getWorld: () => Record<string, WorldBone>,
    constraints: SpineTransformConstraint[] | undefined,
    anim: SpineAnimation
  ) {
    if (!constraints || constraints.length === 0) return;
    const sorted = [...constraints].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    for (const c of sorted) {
      const frames = anim.transform?.[c.name];
      const rotateMix = sampleNumericTimeline(frames as any, this.time, ['rotateMix'], typeof c.rotateMix === 'number' ? c.rotateMix : 0);
      const translateMix = sampleNumericTimeline(frames as any, this.time, ['translateMix'], typeof c.translateMix === 'number' ? c.translateMix : 0);
      const scaleMix = sampleNumericTimeline(frames as any, this.time, ['scaleMix'], typeof c.scaleMix === 'number' ? c.scaleMix : 0);
      if (Math.abs(rotateMix) <= 1e-6 && Math.abs(translateMix) <= 1e-6 && Math.abs(scaleMix) <= 1e-6) continue;

      const world = getWorld();
      const target = world[c.target];
      if (!target) continue;

      const offsetX = sampleNumericTimeline(frames as any, this.time, ['x'], c.x ?? 0);
      const offsetY = sampleNumericTimeline(frames as any, this.time, ['y'], c.y ?? 0);
      const offsetRot = sampleNumericTimeline(frames as any, this.time, ['rotation'], c.rotation ?? 0);

      const targetRad = (target.rotation * Math.PI) / 180;
      const cosT = Math.cos(targetRad);
      const sinT = Math.sin(targetRad);

      const offWX = (offsetX * cosT - offsetY * sinT) * target.scaleX;
      const offWY = (offsetX * sinT + offsetY * cosT) * target.scaleY;
      const desiredX = target.x + offWX;
      const desiredY = target.y + offWY;
      const desiredRot = target.rotation + offsetRot;

      for (const boneName of c.bones || []) {
        const local = locals[boneName];
        if (!local) continue;
        const bw = world[boneName];
        if (!bw) continue;

        const parentName = local.parent;
        const parent = parentName ? world[parentName] : ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, a: 1, b: 0, c: 0, d: 1 } as WorldBone);

        if (Math.abs(rotateMix) > 1e-6) {
          const newWorldRot = shortestAngleLerp(bw.rotation, desiredRot, rotateMix);
          local.rotation = newWorldRot - parent.rotation;
        }

        if (Math.abs(translateMix) > 1e-6) {
          const newWorldX = lerp(bw.x, desiredX, translateMix);
          const newWorldY = lerp(bw.y, desiredY, translateMix);

          const dx = newWorldX - parent.x;
          const dy = newWorldY - parent.y;
          const det = parent.a * parent.d - parent.b * parent.c;
          if (Math.abs(det) > 1e-6) {
            const invA = parent.d / det;
            const invB = -parent.b / det;
            const invC = -parent.c / det;
            const invD = parent.a / det;
            local.x = dx * invA + dy * invC;
            local.y = dx * invB + dy * invD;
          }
        }

        if (Math.abs(scaleMix) > 1e-6) {
          const desiredScaleX = target.scaleX;
          const desiredScaleY = target.scaleY;
          const newWorldScaleX = lerp(bw.scaleX, desiredScaleX, scaleMix);
          const newWorldScaleY = lerp(bw.scaleY, desiredScaleY, scaleMix);
          const parentScaleX = parent.scaleX || 1;
          const parentScaleY = parent.scaleY || 1;
          local.scaleX = newWorldScaleX / parentScaleX;
          local.scaleY = newWorldScaleY / parentScaleY;
        }
      }
    }
  }

  private getPathAttachment(slotName: string) {
    const slot = this.project.slots.find((item) => item.name === slotName);
    if (!slot) return null;
    const skin = resolveSkinAttachments(this.project.skins, this.skinName);
    const attachmentName = slot.attachment || Object.keys(skin?.[slot.name] || {})[0];
    if (!attachmentName) return null;
    const attachment = this.resolveAttachment(skin, slot.name, attachmentName) as SpineAttachmentRegion | null;
    return attachment ? { attachment, slot } : null;
  }

  private samplePathPoint(att: SpineAttachmentRegion, position: number) {
    const verts = Array.isArray(att.vertices) ? att.vertices : [];
    if (verts.length < 4) return null;
    const points: { x: number; y: number }[] = [];
    if (
      verts.length === 8 &&
      Math.abs((verts[0] ?? 0) - (verts[2] ?? 0)) < 1e-6 &&
      Math.abs((verts[1] ?? 0) - (verts[3] ?? 0)) < 1e-6 &&
      Math.abs((verts[4] ?? 0) - (verts[6] ?? 0)) < 1e-6 &&
      Math.abs((verts[5] ?? 0) - (verts[7] ?? 0)) < 1e-6
    ) {
      const length = Math.hypot((verts[4] ?? 0) - (verts[0] ?? 0), (verts[5] ?? 0) - (verts[1] ?? 0));
      const u = position <= 1 ? clamp01(position) : clamp01(position / Math.max(1, length));
      return {
        x: lerp(verts[0] ?? 0, verts[4] ?? 0, u),
        y: lerp(verts[1] ?? 0, verts[5] ?? 0, u),
      };
    }
    if (verts.length >= 12) {
      const p = position <= 1 ? clamp01(position) : clamp01(position / Math.max(1, Math.hypot((verts[10] ?? 0) - (verts[0] ?? 0), (verts[11] ?? 0) - (verts[1] ?? 0))));
      return {
        x: cubicBezier(p, verts[0] ?? 0, verts[4] ?? 0, verts[6] ?? 0, verts[10] ?? verts[verts.length - 2] ?? 0),
        y: cubicBezier(p, verts[1] ?? 0, verts[5] ?? 0, verts[7] ?? 0, verts[11] ?? verts[verts.length - 1] ?? 0),
      };
    }
    for (let i = 0; i + 1 < verts.length; i += 2) points.push({ x: verts[i] ?? 0, y: verts[i + 1] ?? 0 });
    if (points.length === 1) return points[0];
    let total = 0;
    const lengths: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
      lengths.push(len);
      total += len;
    }
    const distance = position <= 1 ? clamp01(position) * total : Math.max(0, Math.min(position, total));
    let acc = 0;
    for (let i = 0; i < lengths.length; i++) {
      const len = lengths[i] || 1;
      if (distance <= acc + len || i === lengths.length - 1) {
        const u = clamp01((distance - acc) / len);
        return { x: lerp(points[i].x, points[i + 1].x, u), y: lerp(points[i].y, points[i + 1].y, u) };
      }
      acc += len;
    }
    return points[points.length - 1];
  }

  private setLocalFromWorld(local: LocalBone, parent: WorldBone | null, x: number, y: number) {
    if (!parent) {
      local.x = x;
      local.y = y;
      return;
    }
    const dx = x - parent.x;
    const dy = y - parent.y;
    const det = parent.a * parent.d - parent.b * parent.c;
    if (Math.abs(det) <= 1e-6) return;
    local.x = (parent.d * dx - parent.c * dy) / det;
    local.y = (-parent.b * dx + parent.a * dy) / det;
  }

  private applyPathConstraints(
    locals: Record<string, LocalBone>,
    getWorld: () => Record<string, WorldBone>,
    constraints: SpinePathConstraint[] | undefined,
    anim: SpineAnimation
  ) {
    if (!constraints || constraints.length === 0) return;
    const sorted = [...constraints].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const c of sorted) {
      const pathTarget = this.getPathAttachment(c.target);
      if (!pathTarget) continue;
      const frames = anim.path?.[c.name];
      const basePosition = sampleNumericTimeline(frames?.position as any, this.time, ['position', 'value'], c.position ?? 0, true);
      const spacing = sampleNumericTimeline(frames?.spacing as any, this.time, ['spacing', 'value'], c.spacing ?? 0, true);
      const mixX = sampleNumericTimeline(frames?.mix as any, this.time, ['mixX', 'translateMix'], c.mixX ?? c.translateMix ?? 1);
      const mixY = sampleNumericTimeline(frames?.mix as any, this.time, ['mixY', 'translateMix'], c.mixY ?? c.mixX ?? c.translateMix ?? 1);
      if (Math.abs(mixX) <= 1e-6 && Math.abs(mixY) <= 1e-6) continue;
      let distance = basePosition;
      for (const boneName of c.bones || []) {
        const local = locals[boneName];
        if (!local) continue;
        const currentWorld = getWorld();
        const pointLocal = this.samplePathPoint(pathTarget.attachment, distance);
        if (!pointLocal) continue;
        const slotWorld = currentWorld[pathTarget.slot.bone];
        const point = slotWorld
          ? {
              x: slotWorld.a * pointLocal.x + slotWorld.c * pointLocal.y + slotWorld.x,
              y: slotWorld.b * pointLocal.x + slotWorld.d * pointLocal.y + slotWorld.y,
            }
          : pointLocal;
        const current = currentWorld[boneName];
        const parent = local.parent ? currentWorld[local.parent] : null;
        const targetX = lerp(current?.x ?? 0, point.x, mixX);
        const targetY = lerp(current?.y ?? 0, point.y, mixY);
        this.setLocalFromWorld(local, parent || null, targetX, targetY);
        const pathLengthStep = spacing > 0 ? spacing : Math.max(0, local.length || 0);
        distance += pathLengthStep;
      }
    }
  }

  private draw(opts?: { clear?: boolean }) {
    const ctx = this.ctx;
    const canvas = ctx.canvas;
    const w = canvas.width;
    const h = canvas.height;
    const shouldClear = opts?.clear !== false;
    if (shouldClear) ctx.clearRect(0, 0, w, h);

    const skelMeta: any = (this.project as any)?.skeleton || {};
    const metaX = Number(skelMeta?.x);
    const metaY = Number(skelMeta?.y);
    const metaW = Number(skelMeta?.width);
    const metaH = Number(skelMeta?.height);
    const hasMetaBounds = Number.isFinite(metaW) && Number.isFinite(metaH) && metaW > 1e-6 && metaH > 1e-6;
    let viewCenterX = hasMetaBounds ? (Number.isFinite(metaX) ? metaX : 0) + metaW / 2 : 0;
    let viewCenterY = hasMetaBounds ? (Number.isFinite(metaY) ? metaY : 0) + metaH / 2 : 0;
    let viewScale = hasMetaBounds ? Math.max(0.02, Math.min(40, Math.min(w / metaW, h / metaH) * 0.92)) : 1;

    const duration = this.getDuration();
    let t = this.time;
    if (duration > 1e-6) {
      let out = this.time % duration;
      if (out < 0) out += duration;
      if (Math.abs(out) <= 1e-6 && Math.abs(this.time) > 1e-6) out = duration;
      t = out;
    }
    const anim = this.project.animations?.[this.animationName] || {};
    const animHasAnySlotColor = Object.keys(anim.slots || {}).some((k) => ((anim.slots?.[k]?.rgba || anim.slots?.[k]?.color)?.length || 0) > 0);

    const bonesByName: Record<string, SpineBone> = {};
    const bonesInOrder = this.project.bones.map((b) => b.name);
    for (const b of this.project.bones) bonesByName[b.name] = b;
    const bonesByIndex = bonesInOrder;

    const childrenByName: Record<string, string[]> = {};
    for (const b of this.project.bones) {
      const p = b.parent;
      if (!p) continue;
      if (!childrenByName[p]) childrenByName[p] = [];
      childrenByName[p].push(b.name);
    }

    const locals: Record<string, LocalBone> = {};
    for (const b of this.project.bones) {
      const name = b.name;
      const bt = anim.bones?.[name];
      const tr = evalTimelineXY(bt?.translate, t, 0, 0);
      const rot = evalTimelineAngle(bt?.rotate, t, 0);
      const sc = evalTimelineXY(bt?.scale, t, 1, 1);
      const setupX = b.x ?? 0;
      const setupY = b.y ?? 0;
      const setupRot = b.rotation ?? 0;
      const setupSX = b.scaleX ?? 1;
      const setupSY = b.scaleY ?? 1;
      const setupShearX = b.shearX ?? 0;
      const setupShearY = b.shearY ?? 0;
      let length = b.length ?? 0;
      if (!length || length <= 1e-6) {
        const child = childrenByName[name]?.[0];
        if (child) {
          const cb = bonesByName[child];
          if (cb) length = Math.hypot(cb.x ?? 0, cb.y ?? 0);
        }
      }
      locals[name] = {
        x: setupX + tr.x,
        y: setupY + tr.y,
        rotation: setupRot + rot,
        scaleX: setupSX * sc.x,
        scaleY: setupSY * sc.y,
        length,
        shearX: setupShearX,
        shearY: setupShearY,
        transformMode: b.transformMode,
        parent: b.parent
      };
    }

    const computeWorld = () => {
      const world: Record<string, WorldBone> = {};
      const get = (name: string): WorldBone => {
      const cached = world[name];
      if (cached) return cached;
      const local = locals[name];
      const parentName = local?.parent;
      const parent = parentName ? get(parentName) : ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, a: 1, b: 0, c: 0, d: 1 } as WorldBone);
        const wb = composeSpineWorldBone(local, parent);
        world[name] = wb;
        return wb;
      };

      for (const n of bonesInOrder) get(n);
      return world;
    };

    let world = computeWorld();

    const items: (
      | { order: number; type: 'ik'; constraint: SpineIkConstraint }
      | { order: number; type: 'transform'; constraint: SpineTransformConstraint }
      | { order: number; type: 'path'; constraint: SpinePathConstraint }
    )[] = [];
    for (const ik of this.project.ik || []) items.push({ order: ik.order ?? 0, type: 'ik', constraint: ik });
    for (const tr of this.project.transform || []) items.push({ order: tr.order ?? 0, type: 'transform', constraint: tr });
    for (const path of this.project.path || []) items.push({ order: path.order ?? 0, type: 'path', constraint: path });
    items.sort((a, b) => a.order - b.order || (a.type === 'ik' ? -1 : 1));

    for (const item of items) {
      if (item.type === 'ik') this.applyIkConstraints(locals, () => world, [item.constraint], anim);
      else if (item.type === 'transform') this.applyTransformConstraints(locals, () => world, [item.constraint], anim);
      else this.applyPathConstraints(locals, () => computeWorld(), [item.constraint], anim);
      world = computeWorld();
    }
    this.lastComputedWorld = world;

    const skin = resolveSkinAttachments(this.project.skins, this.skinName);
    const canvasAny = canvas as unknown as { __spineImageCache?: Record<string, HTMLImageElement> };
    const imageCache: Record<string, HTMLImageElement> = canvasAny.__spineImageCache || {};
    canvasAny.__spineImageCache = imageCache;

    type DrawOp =
      | {
          kind: 'region';
          wb: WorldBone;
          a: number;
          composite: GlobalCompositeOperation;
          att: SpineAttachmentRegion;
          attX: number;
          attY: number;
          attRot: number;
          attSX: number;
          attSY: number;
          texCanvas: HTMLCanvasElement;
        }
      | {
          kind: 'mesh';
          wb: WorldBone;
          a: number;
          composite: GlobalCompositeOperation;
          att: SpineAttachmentRegion;
          attX: number;
          attY: number;
          attRot: number;
          attSX: number;
          attSY: number;
          texCanvas: HTMLCanvasElement;
          meshOverrideVertices: number[] | null;
        }
      | {
          kind: 'weightedMesh';
          a: number;
          composite: GlobalCompositeOperation;
          att: SpineAttachmentRegion;
          texCanvas: HTMLCanvasElement;
          vertices: number[];
        };

    const drawOps: DrawOp[] = [];
    const missingRegions: string[] = [];
    let usedNonRegion = 0;
    let skippedWeightedMesh = 0;

    const setupSlots = this.project.slots;
    const setupSlotNames = setupSlots.map((s) => s.name);
    const slotByName: Record<string, SpineSlot> = {};
    for (const s of setupSlots) slotByName[s.name] = s;
    const drawOrderNames = resolveDrawOrder(anim, t, setupSlotNames);

    let boundsMinX = Number.POSITIVE_INFINITY;
    let boundsMaxX = Number.NEGATIVE_INFINITY;
    let boundsMinY = Number.POSITIVE_INFINITY;
    let boundsMaxY = Number.NEGATIVE_INFINITY;

    const pushBounds = (x: number, y: number, halfW: number, halfH: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(halfW) || !Number.isFinite(halfH)) return;
      if (!(halfW > 1e-6 && halfH > 1e-6)) return;
      boundsMinX = Math.min(boundsMinX, x - halfW);
      boundsMaxX = Math.max(boundsMaxX, x + halfW);
      boundsMinY = Math.min(boundsMinY, y - halfH);
      boundsMaxY = Math.max(boundsMaxY, y + halfH);
    };

    for (const slotName of drawOrderNames) {
      const slot = slotByName[slotName];
      if (!slot) continue;
      const wb = world[slot.bone];
      if (!wb) continue;
      const setupHex = typeof slot.color === "string" && slot.color.length ? slot.color : "ffffffff";
      const slotColorTimeline = anim.slots?.[slot.name]?.rgba || anim.slots?.[slot.name]?.color;
      const hasTimeline = !!(slotColorTimeline && slotColorTimeline.length);
      let evalHex = hasTimeline ? evalTimelineColor(slotColorTimeline, t, setupHex) : setupHex;
      if (!hasTimeline && animHasAnySlotColor && parseHex8(evalHex).a === 0) evalHex = "ffffffff";
      const c = parseHex8(evalHex);

      const r = c.r;
      const g = c.g;
      const b = c.b;
      const a = clamp01(c.a / 255);
      if (a <= 1e-4) continue;
      const composite = resolveBlendComposite((slot as any).blend);

      const attachmentName = this.resolveSlotAttachmentName(slot, anim, t);
      if (!attachmentName) continue;
      if (attachmentName === null) continue;
      const att = this.resolveAttachment(skin, slot.name, attachmentName) as SpineAttachmentRegion | null;
      if (!att) continue;
      const attType = (att.type || 'region').toLowerCase();
      if (attType !== 'region') usedNonRegion++;

      const attX = att.x ?? 0;
      const attY = att.y ?? 0;
      const attRot = att.rotation ?? 0;
      const attSX = att.scaleX ?? 1;
      const attSY = att.scaleY ?? 1;

      let region = att.path || att.name || attachmentName;
      if (att.sequence && typeof att.sequence === 'object') {
        const frames = resolveSequenceTimelineFrames(anim, slot.name, attachmentName);
        const idx = evalSequenceIndex(frames, t, att.sequence);
        const setupIdx = Math.max(0, Math.floor(Number(att.sequence.setup ?? 0)));
        const count = Math.max(0, Math.floor(Number(att.sequence.count ?? 0)));
        const useIdx = idx >= 0 ? idx : setupIdx;
        const clamped = count > 0 ? Math.max(0, Math.min(useIdx, count - 1)) : useIdx;
        region = resolveSequenceRegionName(att, attachmentName, clamped);
      }
      const imgInfo = this.getImageForRegion(region);
      if (!imgInfo) {
        if (missingRegions.length < 6) missingRegions.push(region);
        continue;
      }
      const url = imgInfo.url;
      const atlasRegion = imgInfo.region;
      let pageSize = imgInfo.pageSize;
      if (!imageCache[url]) {
        const im = new Image();
        im.src = url;
        imageCache[url] = im;
      }
      const im = imageCache[url];
      if (!im.complete || (im.naturalWidth || 0) === 0) continue;
      if (!pageSize || !(pageSize.w > 0 && pageSize.h > 0)) {
        pageSize = { w: Math.max(0, im.naturalWidth || im.width || 0), h: Math.max(0, im.naturalHeight || im.height || 0) };
      }

      const rgb = rgbaToCss(r, g, b);
      const tintedPage = this.getTintedImage(im, rgb);
      const pageSource = (tintedPage ?? im) as CanvasImageSource;

      const resolvedRegion = this.resolveRegionKey(region);
      const regionCanvasKey = makeSpineRegionCanvasCacheKey(url, rgb, resolvedRegion?.pageKey || '', resolvedRegion?.regionKey || region);
      const regionCanvas = this.getRegionCanvas(pageSource, regionCanvasKey, atlasRegion, pageSize);
      if (!regionCanvas) continue;

      const textureKey = `${regionCanvasKey}::tex`;
      const texCanvas = this.getTextureCanvas(regionCanvas, textureKey, atlasRegion);

      let meshOverrideVertices: number[] | null = null;
      if (attType === 'mesh' || attType === 'linkedmesh') {
        const uvs = att.uvs;
        const verts = att.vertices;
        const tris = att.triangles;
        if (!uvs || !verts || !tris) {
          skippedWeightedMesh++;
          continue;
        }

        const vertCount = Math.floor(uvs.length / 2);
        const deformFrame = resolveDeformFrame(anim, t, slot.name, attachmentName);
        const deform = buildDeformArray(deformFrame, vertCount);
        const isWeighted = verts.length !== vertCount * 2;
        if (isWeighted) {
          const positions = this.computeWeightedWorldPositions(verts, vertCount, bonesByIndex, world, deform, attX, attY, attRot, attSX, attSY);
          drawOps.push({ kind: 'weightedMesh', a, composite, att, texCanvas, vertices: positions });
          continue;
        }

        if (deform) {
          const nextVerts = verts.slice();
          for (let vi = 0; vi < vertCount; vi++) {
            nextVerts[vi * 2] = (nextVerts[vi * 2] ?? 0) + (deform[vi * 2] ?? 0);
            nextVerts[vi * 2 + 1] = (nextVerts[vi * 2 + 1] ?? 0) + (deform[vi * 2 + 1] ?? 0);
          }
          meshOverrideVertices = nextVerts;
        }
      }

      const drawW = att.width ?? texCanvas.width;
      const drawH = att.height ?? texCanvas.height;
      const approxSX = Math.max(1e-6, Math.abs(wb.scaleX * (attSX || 1)));
      const approxSY = Math.max(1e-6, Math.abs(wb.scaleY * (attSY || 1)));
      pushBounds(wb.x + attX, wb.y + attY, (drawW / 2) * approxSX, (drawH / 2) * approxSY);

      if (attType === 'mesh' || attType === 'linkedmesh') {
        drawOps.push({ kind: 'mesh', wb, a, composite, att, attX, attY, attRot, attSX, attSY, texCanvas, meshOverrideVertices });
      } else {
        drawOps.push({ kind: 'region', wb, a, composite, att, attX, attY, attRot, attSX, attSY, texCanvas });
      }
    }

    const hasBounds =
      Number.isFinite(boundsMinX) &&
      Number.isFinite(boundsMaxX) &&
      Number.isFinite(boundsMinY) &&
      Number.isFinite(boundsMaxY) &&
      boundsMaxX - boundsMinX > 1e-3 &&
      boundsMaxY - boundsMinY > 1e-3;
    if (hasBounds) {
      const bw = Math.max(1e-3, boundsMaxX - boundsMinX);
      const bh = Math.max(1e-3, boundsMaxY - boundsMinY);
      viewCenterX = (boundsMinX + boundsMaxX) / 2;
      viewCenterY = (boundsMinY + boundsMaxY) / 2;
      viewScale = Math.max(0.02, Math.min(40, Math.min(w / bw, h / bh) * 0.92));
    }

    let drawn = 0;
    for (const op of drawOps) {
      if (op.kind === 'weightedMesh') {
        ctx.save();
        ctx.translate(w / 2 + (-viewCenterX * viewScale), h / 2 + (viewCenterY * viewScale));
        ctx.scale(viewScale, viewScale);
        ctx.globalAlpha = op.a;
        ctx.globalCompositeOperation = op.composite;
        const ok = this.drawMesh(ctx, op.texCanvas, { ...op.att, vertices: op.vertices });
        ctx.restore();
        if (ok) drawn++;
        else skippedWeightedMesh++;
        continue;
      }

      ctx.save();
      const cx = w / 2;
      const cy = h / 2;
      ctx.translate(cx + (op.wb.x - viewCenterX) * viewScale, cy - (op.wb.y - viewCenterY) * viewScale);
      ctx.rotate((-op.wb.rotation * Math.PI) / 180);
      ctx.scale(op.wb.scaleX * viewScale, op.wb.scaleY * viewScale);
      ctx.globalAlpha = op.a;
      ctx.globalCompositeOperation = op.composite;

      ctx.translate(op.attX, -op.attY);
      if (op.attRot) ctx.rotate((-op.attRot * Math.PI) / 180);
      ctx.scale(op.attSX, op.attSY);

      if (op.kind === 'mesh') {
        const ok = this.drawMesh(ctx, op.texCanvas, op.meshOverrideVertices ? { ...op.att, vertices: op.meshOverrideVertices } : op.att);
        if (ok) drawn++;
        else skippedWeightedMesh++;
      } else {
        const drawW = op.att.width ?? op.texCanvas.width;
        const drawH = op.att.height ?? op.texCanvas.height;
        ctx.drawImage(op.texCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
        drawn++;
      }
      ctx.restore();
    }

    if (drawn === 0) {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.font = "12px Segoe UI, sans-serif";
      const base = "Spine 预览：未绘制任何附件";
      const extraA = usedNonRegion > 0 ? `（存在 mesh/非region: ${usedNonRegion}）` : "";
      const extraB = skippedWeightedMesh > 0 ? `（跳过 weighted mesh: ${skippedWeightedMesh}）` : "";
      ctx.fillText(`${base}${extraA}${extraB}`, 12, 20);
      if (missingRegions.length) {
        ctx.fillText(`找不到 region: ${missingRegions.join(', ')}`, 12, 38);
      }
      ctx.restore();
      return;
    }

    if (this.hud) {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "11px Segoe UI, sans-serif";
      ctx.fillText(`Anim: ${this.animationName}  t=${t.toFixed(2)}/${duration.toFixed(2)}  drawn=${drawn}${usedNonRegion ? `  nonRegion=${usedNonRegion}` : ''}${skippedWeightedMesh ? `  weightedMesh=${skippedWeightedMesh}` : ''}`, 12, 18);
      if (missingRegions.length) {
        ctx.fillText(`Missing region: ${missingRegions.join(', ')}`, 12, 34);
      }
      ctx.restore();
    }
  }
}
