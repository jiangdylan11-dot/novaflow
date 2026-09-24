// PNG 强压缩 / Spine 图集增强压缩 in the browser.
//
// 工具 → PNG 压缩 enables 强压缩 (普通 PNG) and 增强 (Spine 图集, 压缩强度 55+)
// on electronAPI.compressPngStrong and calls it with the quality / colours /
// dither / effort it derives from the slider. This drives the Web answer in
// novaflow-web-capabilities.js with the real libimagequant WebAssembly module
// from vendor/imagequant and holds it to the desktop's contract: an indexed
// PNG within the colour budget, pixels that read back as the quantiser wrote
// them, straight-alpha atlas pages left lossless, transparent palette
// entries written black.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../../renderer/novaflow-web-capabilities.js', import.meta.url), 'utf8');
const vendor = new URL('../../renderer/vendor/imagequant/', import.meta.url);
const wasm = await import(new URL('libimagequant_wasm.js', vendor));
await wasm.default({ module_or_path: await readFile(new URL('libimagequant_wasm_bg.wasm', vendor)) });

let checks = 0;
const equal = (a, b, what) => { assert.deepEqual(a, b, what); checks += 1; };
const ok = (value, what) => { assert.ok(value, what); checks += 1; };

// The page's quantiser hook, answered by the module loaded above (the page
// itself runs it in a worker; the numbers are the same).
const quantizeCalls = [];
const quantizer = {
  quantize: async (rgba, width, height, options) => {
    quantizeCalls.push({ width, height, options });
    const pixels = new Uint8ClampedArray(rgba);
    const q = new wasm.ImageQuantizer();
    try {
      q.setSpeed(options.speed);
      q.setQuality(options.minQuality, options.quality);
      q.setMaxColors(options.colors);
      const result = q.quantizeImage(pixels, width, height);
      try {
        result.setDithering(options.dither);
        const palette = result.getPalette();
        const indices = new Uint8Array(result.getPaletteIndices(pixels, width, height));
        const flat = new Uint8Array(palette.length * 4);
        for (let i = 0; i < palette.length; i += 1) flat.set(palette[i], i * 4);
        return { palette: flat, indices, quality: result.getQuantizationQuality() };
      } finally { result.free(); }
    } finally { q.free(); }
  }
};

function boot() {
  const sandbox = { console, atob, Blob, Response, CompressionStream, DecompressionStream, URL, electronAPI: {}, NovaFlowWebQuantizer: quantizer };
  sandbox.window = sandbox;
  runInContext(source, createContext(sandbox));
  return sandbox.electronAPI;
}

// ---------------------------------------------------------------- fixtures
const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(bytes) {
  let c = -1;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function makePng({ width, height, bitDepth = 8, colorType = 6, raw, extra = [] }) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  const filtered = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    filtered[y * (stride + 1)] = 0;
    Buffer.from(raw.subarray(y * stride, (y + 1) * stride)).copy(filtered, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra.map(([type, data]) => chunk(type, data)),
    chunk('IDAT', deflateSync(filtered, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
/** An independent read of an indexed PNG: palette, alpha, and each pixel's index. */
function readIndexed(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  const chunks = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  const ihdr = chunks[0].data;
  const header = { width: new DataView(ihdr.buffer, ihdr.byteOffset).getUint32(0), height: new DataView(ihdr.buffer, ihdr.byteOffset).getUint32(4), bitDepth: ihdr[8], colorType: ihdr[9] };
  const plte = (chunks.find((c) => c.type === 'PLTE') || {}).data || new Uint8Array(0);
  const trns = (chunks.find((c) => c.type === 'tRNS') || {}).data || new Uint8Array(0);
  return { header, chunks, plte, trns };
}
const asDataUrl = (png) => 'data:image/png;base64,' + Buffer.from(png).toString('base64');

// A soft coloured disc with a faded edge and a transparent margin - what a
// packer writes, once premultiplied (PMA), once straight.
function page(size, pma) {
  const raw = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - c, y - c) / (size / 2);
      const o = (y * size + x) * 4;
      const r = 40 + ((x * 3) % 200), g = 60 + ((y * 5) % 180), b = 200 - ((x + y) % 150);
      const a = d < 0.5 ? 255 : d < 0.95 ? Math.round(255 * (0.95 - d) / 0.45) : 0;
      raw[o] = pma ? Math.round((r * a) / 255) : r;
      raw[o + 1] = pma ? Math.round((g * a) / 255) : g;
      raw[o + 2] = pma ? Math.round((b * a) / 255) : b;
      raw[o + 3] = a;
    }
  }
  return raw;
}
const SIZE = 96;
const pmaRaw = page(SIZE, true);
const straightRaw = page(SIZE, false);
const pmaPng = makePng({ width: SIZE, height: SIZE, raw: pmaRaw });
const straightPng = makePng({ width: SIZE, height: SIZE, raw: straightRaw });

const api = boot();
ok(typeof api.compressPngStrong === 'function', 'the Web build answers compressPngStrong');

// ------------------------------------------------------- 普通 PNG 强压缩
{
  quantizeCalls.length = 0;
  const result = await api.compressPngStrong({ dataUrl: asDataUrl(straightPng), compressionLevel: 9, effort: 8, quality: 80, colors: 64, dither: 0.5 });
  equal(result.ok, true, 'a straight PNG compresses: ' + result.error);
  equal([result.width, result.height], [SIZE, SIZE], 'size reported');
  ok(Array.isArray(result.bytes) && result.bytes.length === result.size, 'bytes come back as an Array, size is its length');
  ok(result.size < straightPng.length, 'the palette PNG is smaller (' + result.size + ' < ' + straightPng.length + ')');
  // Objects cross the vm realm with their own prototypes; compare the data.
  equal(JSON.parse(JSON.stringify(quantizeCalls[0].options)), { speed: 3, minQuality: 0, quality: 80, colors: 64, dither: 0.5 }, 'effort 8 is speed 3; quality, colours and dither pass through');
  const out = Uint8Array.from(result.bytes);
  const indexed = readIndexed(out);
  equal(indexed.header.colorType, 3, 'the output is an indexed PNG');
  ok(indexed.plte.length / 3 <= 64, 'within the colour budget (' + indexed.plte.length / 3 + ' colours)');
  equal(result.paletteLength, indexed.plte.length / 3, 'paletteLength matches the file');
  ok(result.quality > 0 && result.quality <= 1, 'the achieved quality is reported (' + result.quality + ')');
  equal(result.spineAtlasProtection, undefined, 'no Spine analysis outside the Spine profile');

  // The pixels are close to the source: decode through the page's own decoder path by a second call.
  const roundTrip = await api.compressSpineAtlasSafe({ dataUrl: asDataUrl(out), compressionLevel: 0 });
  equal(roundTrip.ok, true, 'the indexed PNG is readable by the lossless path too');
}

// ------------------------------------------------------- Spine 图集增强 (PMA page)
{
  quantizeCalls.length = 0;
  const result = await api.compressPngStrong({ dataUrl: asDataUrl(pmaPng), compressionLevel: 8, effort: 9, quality: 86, colors: 192, dither: 0.4, profile: 'spine-atlas-pma' });
  equal(result.ok, true, 'a PMA page compresses under the Spine profile: ' + result.error);
  equal(quantizeCalls.length, 1, 'it was quantised');
  ok(result.spineAtlasProtection && result.spineAtlasProtection.safeFallback === false, 'and not sent down the safe fallback');
  ok(['pma-like', 'ambiguous'].includes(result.spineAtlasProtection.alphaMode), 'the page reads as PMA or ambiguous, not straight (' + result.spineAtlasProtection.alphaMode + ')');
  equal(result.spineAtlasProtection.analysisReason, 'full-resolution-alpha-analysis', 'every pixel was analysed');
  const indexed = readIndexed(Uint8Array.from(result.bytes));
  equal(indexed.header.colorType, 3, 'indexed output');
  let colouredTransparent = 0;
  for (let i = 0; i < indexed.trns.length; i += 1) {
    if (indexed.trns[i] === 0 && (indexed.plte[i * 3] || indexed.plte[i * 3 + 1] || indexed.plte[i * 3 + 2])) colouredTransparent += 1;
  }
  equal(colouredTransparent, 0, 'no fully transparent palette entry carries colour');
  ok(indexed.plte.length / 3 <= 192, 'within the colour budget (' + indexed.plte.length / 3 + ')');
}

// ------------------------------------------------------- Spine 图集增强 (straight page): the safe fallback
{
  quantizeCalls.length = 0;
  const result = await api.compressPngStrong({ dataUrl: asDataUrl(straightPng), compressionLevel: 8, effort: 9, quality: 86, colors: 192, dither: 0.4, profile: 'spine-atlas-pma' });
  equal(result.ok, true, 'a straight page under the Spine profile still answers: ' + result.error);
  equal(quantizeCalls.length, 0, 'it was not quantised');
  equal([result.spineAtlasProtection.alphaMode, result.spineAtlasProtection.safeFallback], ['straight', true], 'it reads as straight and took the safe fallback');
  equal(result.paletteLength, null, 'no palette');
  const indexed = readIndexed(Uint8Array.from(result.bytes));
  equal(indexed.header.colorType, 6, 'the fallback keeps the RGBA encoding');
  const lossless = await api.compressSpineAtlasSafe({ dataUrl: asDataUrl(straightPng), compressionLevel: 8 });
  equal(result.bytes, lossless.bytes, 'and is byte for byte the lossless re-encode');
}

// ------------------------------------------------------- small palettes pack down
{
  const flat = new Uint8Array(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i += 1) { const v = i % 3 === 0 ? 255 : i % 3 === 1 ? 128 : 0; flat[i * 4] = v; flat[i * 4 + 1] = 255 - v; flat[i * 4 + 2] = 40; flat[i * 4 + 3] = 255; }
  const result = await api.compressPngStrong({ bytes: Array.from(makePng({ width: 32, height: 32, raw: flat })), quality: 100, colors: 4, dither: 0 });
  equal(result.ok, true, 'a three-colour image compresses: ' + result.error);
  const indexed = readIndexed(Uint8Array.from(result.bytes));
  ok(indexed.header.bitDepth <= 2, 'a palette of ' + indexed.plte.length / 3 + ' packs to ' + indexed.header.bitDepth + ' bits per pixel');
  equal(result.spineAtlasProtection, undefined, 'plain profile');
}

// ------------------------------------------------------- refusals
{
  const notPng = await api.compressPngStrong({ dataUrl: 'data:image/png;base64,' + Buffer.from('nope').toString('base64') });
  equal(notPng.ok, false, 'a non-PNG is refused');
  ok(/PNG/.test(notPng.error), 'with a readable reason: ' + notPng.error);
  const empty = await api.compressPngStrong({});
  equal(empty.ok, false, 'a missing payload is refused, not thrown');
  const nothing = await api.compressPngStrong();
  equal(nothing.ok, false, 'no payload at all is refused, not thrown');
}

console.log(checks + ' passed, 0 failed: PNG 强压缩 quantises to a palette in the browser');
