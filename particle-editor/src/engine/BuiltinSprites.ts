import { getCanvas2DContext } from '../utils/canvas2d';

export type BuiltinSpriteKey =
  | 'circle'
  | 'feather_circle'
  | 'ring'
  | 'square'
  | 'triangle'
  | 'rect'
  | 'diamond'
  | 'star4'
  | 'star'
  | 'smoke'
  | 'flame';

export type BuiltinSpriteDef = {
  key: BuiltinSpriteKey;
  label: string;
  dataUrl: string;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCanvas(size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = getCanvas2DContext(canvas);
  ctx.clearRect(0, 0, size, size);
  return { canvas, ctx };
}

function toDataUrl(canvas: HTMLCanvasElement) {
  return canvas.toDataURL('image/png');
}

function drawCircleSolid(size: number) {
  const { canvas, ctx } = makeCanvas(size);
  const r = size * 0.42;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.fill();
  return toDataUrl(canvas);
}

function drawCircleFeather(size: number) {
  const { canvas, ctx } = makeCanvas(size);
  const cx = size / 2;
  const cy = size / 2;
  const r0 = size * 0.12;
  const r1 = size * 0.46;
  const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.65, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r1, 0, Math.PI * 2);
  ctx.fill();
  return toDataUrl(canvas);
}

function drawRing(size: number) {
  const { canvas, ctx } = makeCanvas(size);
  const r = size * 0.38;
  const w = Math.max(2, size * 0.12);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.stroke();
  return toDataUrl(canvas);
}

function drawSquare(size: number) {
  const { canvas, ctx } = makeCanvas(size);
  const s = size * 0.72;
  const x = (size - s) / 2;
  const y = (size - s) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, s, s);
  return toDataUrl(canvas);
}

function drawRect(size: number) {
  const { canvas, ctx } = makeCanvas(size);
  const w = size * 0.78;
  const h = size * 0.52;
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  return toDataUrl(canvas);
}

function drawTriangle(size: number) {
  const { canvas, ctx } = makeCanvas(size);
  const pad = size * 0.14;
  const x0 = size / 2;
  const y0 = pad;
  const x1 = size - pad;
  const y1 = size - pad;
  const x2 = pad;
  const y2 = size - pad;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.fill();
  return toDataUrl(canvas);
}

function drawDiamond(size: number) {
  const { canvas, ctx } = makeCanvas(size);
  const pad = size * 0.14;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(size / 2, pad);
  ctx.lineTo(size - pad, size / 2);
  ctx.lineTo(size / 2, size - pad);
  ctx.lineTo(pad, size / 2);
  ctx.closePath();
  ctx.fill();
  return toDataUrl(canvas);
}

function drawStar(size: number) {
  const { canvas, ctx } = makeCanvas(size);
  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.42;
  const inner = size * 0.18;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  return toDataUrl(canvas);
}

function drawStar4(size: number) {
  const { canvas, ctx } = makeCanvas(size);
  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.45;
  const inner = size * 0.18;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const r = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  return toDataUrl(canvas);
}

function drawSmoke(size: number) {
  const { canvas, ctx } = makeCanvas(size);
  const rnd = seeded(1337);
  const cx = size / 2;
  const cy = size / 2;
  const baseR = size * 0.26;

  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = baseR * (0.35 + rnd() * 0.95);
    const dist = baseR * (rnd() * 0.9);
    const x = cx + Math.cos(a) * dist;
    const y = cy + Math.sin(a) * dist;
    const g = ctx.createRadialGradient(x, y, rr * 0.1, x, y, rr);
    const alpha = clamp01(0.18 + rnd() * 0.25);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  const mask = ctx.createRadialGradient(cx, cy, size * 0.02, cx, cy, size * 0.5);
  mask.addColorStop(0, 'rgba(255,255,255,1)');
  mask.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = mask;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  return toDataUrl(canvas);
}

function drawFlameSvg() {
  return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'><defs><radialGradient id='g' cx='50%25' cy='40%25' r='65%25'><stop offset='0' stop-color='white' stop-opacity='1'/><stop offset='0.45' stop-color='white' stop-opacity='0.75'/><stop offset='1' stop-color='white' stop-opacity='0'/></radialGradient></defs><path d='M64 8C90 32 92 56 80 80C73 93 69 108 64 120C59 108 55 93 48 80C36 56 38 32 64 8Z' fill='url(%23g)'/></svg>";
}

let cached: BuiltinSpriteDef[] | null = null;

export function getBuiltinSprites(size = 128): BuiltinSpriteDef[] {
  if (cached) return cached;
  cached = [
    { key: 'circle', label: '圆形', dataUrl: drawCircleSolid(size) },
    { key: 'feather_circle', label: '羽化圆形', dataUrl: drawCircleFeather(size) },
    { key: 'ring', label: '圆环', dataUrl: drawRing(size) },
    { key: 'square', label: '方形', dataUrl: drawSquare(size) },
    { key: 'triangle', label: '三角形', dataUrl: drawTriangle(size) },
    { key: 'rect', label: '长方形', dataUrl: drawRect(size) },
    { key: 'diamond', label: '菱形', dataUrl: drawDiamond(size) },
    { key: 'star4', label: '四角星', dataUrl: drawStar4(size) },
    { key: 'star', label: '五角星', dataUrl: drawStar(size) },
    { key: 'smoke', label: '雾气', dataUrl: drawSmoke(size) },
    { key: 'flame', label: '火焰', dataUrl: drawFlameSvg() }
  ];
  return cached;
}
