// Spine 图集稳妥压缩 in the browser.
//
// The panel (工具 → PNG 压缩 → Spine 图集) enables 开始压缩 on
// electronAPI.compressSpineAtlasSafe, and calls it with a data URL. This drives
// the Web implementation of that method the way the panel does, and holds it to
// the one promise its name makes: the stored samples come back byte for byte.
//
// Fixtures are written here with node:zlib rather than by the code under test,
// so a bug in the encoder cannot hide behind the same bug in the fixture. The
// checks decode with an independent unfilter for the same reason.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../../renderer/novaflow-web-capabilities.js', import.meta.url), 'utf8');

let checks = 0;
const equal = (a, b, what) => { assert.deepEqual(a, b, what); checks += 1; };
const ok = (value, what) => { assert.ok(value, what); checks += 1; };

function boot() {
  const sandbox = {
    console, atob, Blob, Response, CompressionStream, DecompressionStream,
    electronAPI: {}
  };
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

/** A PNG with every scanline stored unfiltered, at the given deflate level. */
function makePng({ width, height, bitDepth = 8, colorType = 6, interlace = 0, raw, extra = [], level = 0 }) {
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
  ihdr[12] = interlace;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra.map(([type, data]) => chunk(type, data)),
    chunk('IDAT', deflateSync(filtered, { level })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** An atlas page the canvas path would damage: colour under and behind alpha. */
function pmaLikePage(width, height) {
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const inside = x > 3 && x < width - 4 && y > 3 && y < height - 4;
      // Outside the region: fully transparent, but NOT black - this is the
      // bleed colour a runtime samples at a region edge, and the exact thing
      // a canvas round trip throws away.
      const alpha = inside ? Math.min(255, 8 + ((x * 7 + y * 3) % 200)) : 0;
      const tint = (x * 5 + y * 11) % 256;
      raw[at] = inside ? Math.round((tint * alpha) / 255) : 180;
      raw[at + 1] = inside ? Math.round(((255 - tint) * alpha) / 255) : 40;
      raw[at + 2] = inside ? Math.round((tint * alpha) / 510) : 220;
      raw[at + 3] = alpha;
    }
  }
  return raw;
}

// -------------------------------------------------------------- decoding
const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/** Independent reader: chunks, header, and the raw samples. */
function decode(bytes) {
  const buffer = Buffer.from(bytes);
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    assert.equal(buffer.readUInt32BE(offset + 8 + length), crc32(buffer.subarray(offset + 4, offset + 8 + length)), type + ' CRC');
    chunks.push({ type, data });
    offset += length + 12;
    if (type === 'IEND') break;
  }
  assert.equal(offset, buffer.length, 'no trailing bytes');
  const ihdr = chunks[0].data;
  const header = {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8],
    colorType: ihdr[9],
    interlace: ihdr[12]
  };
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  const bpp = Math.max(1, Math.ceil((channels * header.bitDepth) / 8));
  const stride = Math.ceil((header.width * channels * header.bitDepth) / 8);
  const filtered = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const raw = Buffer.alloc(header.height * stride);
  for (let y = 0; y < header.height; y += 1) {
    const type = filtered[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const value = filtered[y * (stride + 1) + 1 + x];
      const left = x >= bpp ? raw[y * stride + x - bpp] : 0;
      const above = y > 0 ? raw[(y - 1) * stride + x] : 0;
      const corner = y > 0 && x >= bpp ? raw[(y - 1) * stride + x - bpp] : 0;
      const restored = type === 0 ? value
        : type === 1 ? value + left
          : type === 2 ? value + above
            : type === 3 ? value + ((left + above) >> 1)
              : value + paeth(left, above, corner);
      raw[y * stride + x] = restored & 0xff;
    }
  }
  return { chunks, header, raw };
}

const asDataUrl = (bytes) => 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');

const api = boot();
ok(typeof api.compressSpineAtlasSafe === 'function', 'the Web build answers compressSpineAtlasSafe');

// ------------------------------------------- an RGBA page keeps every sample
{
  const raw = pmaLikePage(96, 64);
  const png = makePng({ width: 96, height: 64, raw });
  const result = await api.compressSpineAtlasSafe({ dataUrl: asDataUrl(png), compressionLevel: 7 });

  equal(result.ok, true, 'RGBA page compressed');
  // The panel does Array.isArray(result.bytes) before it builds the blob.
  ok(Array.isArray(result.bytes), 'bytes come back as a plain array');
  equal([result.width, result.height], [96, 64], 'dimensions reported');

  const out = decode(Uint8Array.from(result.bytes));
  equal(Buffer.compare(out.raw, raw), 0, 'every stored sample survives, alpha and the colour under it');
  equal([out.header.bitDepth, out.header.colorType], [8, 6], 'bit depth and colour type unchanged');
  ok(result.bytes.length < png.length, 'a level-0 page gets smaller');

  // The failure mode this exists to avoid: canvas returns 0,0,0 for a fully
  // transparent pixel. The bleed colour outside the region has to still be there.
  equal([out.raw[0], out.raw[1], out.raw[2], out.raw[3]], [180, 40, 220, 0], 'transparent pixels keep their RGB');
}

// -------------------------------------- a palette page keeps PLTE and tRNS
{
  const palette = Buffer.alloc(3 * 4);
  for (let i = 0; i < 4; i += 1) { palette[i * 3] = i * 60; palette[i * 3 + 1] = 255 - i * 50; palette[i * 3 + 2] = 30 + i; }
  const trns = Buffer.from([0, 128, 200, 255]);
  const raw = Buffer.alloc(32 * 16);
  for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 3) % 4;
  const png = makePng({ width: 32, height: 16, colorType: 3, raw, extra: [['PLTE', palette], ['tRNS', trns], ['tEXt', Buffer.from('Software\0NovaFlow', 'latin1')]] });
  const result = await api.compressSpineAtlasSafe({ dataUrl: asDataUrl(png), compressionLevel: 9 });

  equal(result.ok, true, 'palette page compressed');
  const out = decode(Uint8Array.from(result.bytes));
  equal(Buffer.compare(out.raw, raw), 0, 'palette indices survive');
  const types = out.chunks.map((c) => c.type);
  ok(types.includes('PLTE') && types.includes('tRNS'), 'the palette and its transparency are carried across');
  ok(!types.includes('tEXt'), 'metadata is dropped');
}

// --------------------------------------------- 16-bit samples are not halved
{
  const raw = Buffer.alloc(24 * 8 * 8);
  for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 37) % 256;
  const png = makePng({ width: 24, height: 8, bitDepth: 16, colorType: 6, raw });
  const result = await api.compressSpineAtlasSafe({ dataUrl: asDataUrl(png), compressionLevel: 5 });

  equal(result.ok, true, '16-bit page compressed');
  const out = decode(Uint8Array.from(result.bytes));
  equal(out.header.bitDepth, 16, 'still 16-bit');
  equal(Buffer.compare(out.raw, raw), 0, 'both bytes of every sample survive');
}

// --------------------------------------------------- refusals say what is wrong
{
  const raw = pmaLikePage(16, 16);
  const interlaced = makePng({ width: 16, height: 16, raw, interlace: 1 });
  const refused = await api.compressSpineAtlasSafe({ dataUrl: asDataUrl(interlaced), compressionLevel: 7 });
  equal(refused.ok, false, 'an interlaced PNG is refused rather than mangled');
  ok(/隔行/.test(refused.error), 'and the reason names interlacing');

  const acTL = Buffer.alloc(8);
  acTL.writeUInt32BE(3, 0);
  const animated = makePng({ width: 16, height: 16, raw, extra: [['acTL', acTL]] });
  const refusedApng = await api.compressSpineAtlasSafe({ dataUrl: asDataUrl(animated), compressionLevel: 7 });
  equal(refusedApng.ok, false, 'an APNG is refused rather than flattened to its first frame');
  ok(/APNG/.test(refusedApng.error), 'and the reason names the animation');

  const notPng = await api.compressSpineAtlasSafe({ dataUrl: 'data:image/png;base64,' + Buffer.from('nope').toString('base64') });
  equal(notPng.ok, false, 'a non-PNG is refused');
  ok(/PNG/.test(notPng.error), 'with a readable reason');

  const empty = await api.compressSpineAtlasSafe({});
  equal(empty.ok, false, 'a missing payload is refused, not thrown');
}

// ------------------------------------- a real PNG from the shipped templates
{
  const png = await readFile(new URL('../../renderer/templates/vfx/slash_basic_builtin/source/frame_001.png', import.meta.url));
  const before = decode(png);
  const result = await api.compressSpineAtlasSafe({ dataUrl: asDataUrl(png), compressionLevel: 7 });

  equal(result.ok, true, 'a shipped template frame compressed');
  equal(result.losslessVerified, true, 'the implementation verified itself too');
  const out = decode(Uint8Array.from(result.bytes));
  equal(Buffer.compare(out.raw, before.raw), 0, 'a real frame round-trips unchanged');
  equal([out.header.width, out.header.height], [before.header.width, before.header.height], 'same page size');
}

console.log(checks + ' passed, 0 failed: Spine 图集稳妥压缩 re-encodes PNG losslessly in the browser');
