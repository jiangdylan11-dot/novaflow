// SPINE 图集转换 in the browser.
//
// 工具 → SPINE 图集转换 calls electronAPI.convertSpineAtlasWebp with the atlas
// text and the PNG pages, and shows what comes back. The desktop answers it
// with sharp and ffmpeg; the Web answer lives in novaflow-web-capabilities.js
// and runs the vendored libwebp (vendor/webp). This drives that answer the way
// the panel does and holds it to the desktop's contract: the same result
// shape, the same atlas rewriting, alpha exact after a lossy page, every byte
// exact after a PMA page.
//
// The WebAssembly codec is the real one, loaded from vendor/webp as the page
// loads it; only the JPG encoder (a canvas in the browser) is a stub that
// records what it was handed.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../../renderer/novaflow-web-capabilities.js', import.meta.url), 'utf8');
const vendor = new URL('../../renderer/vendor/webp/', import.meta.url);
const encoder = await (await import(new URL('webp_enc.js', vendor))).default({ noInitialRun: true, wasmBinary: await readFile(new URL('webp_enc.wasm', vendor)) });
const decoder = await (await import(new URL('webp_dec.js', vendor))).default({ noInitialRun: true, wasmBinary: await readFile(new URL('webp_dec.wasm', vendor)) });

let checks = 0;
const equal = (a, b, what) => { assert.deepEqual(a, b, what); checks += 1; };
const ok = (value, what) => { assert.ok(value, what); checks += 1; };

// The page's typed arrays come from the vm realm; the codec's embind checks
// `instanceof Uint8Array` against this realm's, so hand it copies made here.
const jpegCalls = [];
const codec = {
  encode: async (rgba, width, height, options) => {
    const out = encoder.encode(Uint8Array.from(rgba), width, height, options);
    if (!out) throw new Error('encode failed');
    return new Uint8Array(out);
  },
  decode: async (bytes) => {
    const image = decoder.decode(Uint8Array.from(bytes));
    if (!image) throw new Error('decode failed');
    return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
  },
  encodeJpeg: async (rgb, width, height, quality) => {
    jpegCalls.push({ rgb: Uint8Array.from(rgb), width, height, quality });
    return Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9);
  }
};
const decodeWebp = (bytes) => codec.decode(bytes);

function boot(webpCodec = codec) {
  const sandbox = {
    console, atob, Blob, Response, CompressionStream, DecompressionStream, URL,
    electronAPI: {}, NovaFlowWebWebpCodec: webpCodec
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
/** A PNG with every scanline stored unfiltered. */
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

/**
 * A straight-alpha page the way a packer with bleed writes it: an opaque
 * coloured disc, a soft edge, and colour left under the transparent margin.
 */
function straightPage(size) {
  const raw = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - c, y - c) / (size / 2);
      const o = (y * size + x) * 4;
      raw[o] = 220; raw[o + 1] = 60 + ((x * 7) % 90); raw[o + 2] = 30 + ((y * 5) % 60);
      raw[o + 3] = d < 0.55 ? 255 : d < 0.8 ? Math.round(255 * (0.8 - d) / 0.25) : 0;
    }
  }
  return raw;
}
function premultiply(raw) {
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 4) {
    const a = raw[i + 3];
    out[i] = Math.round((raw[i] * a) / 255);
    out[i + 1] = Math.round((raw[i + 1] * a) / 255);
    out[i + 2] = Math.round((raw[i + 2] * a) / 255);
    out[i + 3] = a;
  }
  return out;
}

const MODERN_ATLAS = '\nfx.png\nsize: 32,32\nfilter: Linear,Linear\npma: true\nregion\n  bounds: 0,0,32,32\n';
const MODERN_ATLAS_UNMARKED = '\nfx.png\nsize: 32,32\nfilter: Linear,Linear\nregion\n  bounds: 0,0,32,32\n';
const LEGACY_ATLAS = '\nfx.png\nsize: 32, 32\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nregion\n  rotate: false\n  xy: 0, 0\n  size: 32, 32\n  orig: 32, 32\n  offset: 0, 0\n  index: -1\n';

const SIZE = 32;
const straightRaw = straightPage(SIZE);
const pmaRaw = premultiply(straightRaw);
const straightPng = makePng({ width: SIZE, height: SIZE, raw: straightRaw });
const pmaPng = makePng({ width: SIZE, height: SIZE, raw: pmaRaw });

const api = boot();
ok(typeof api.convertSpineAtlasWebp === 'function', 'the Web build answers convertSpineAtlasWebp');

const convert = (payload) => api.convertSpineAtlasWebp(payload);
const image = (png, extra) => ({ fileName: 'fx.png', bytes: Array.from(png), outputFormat: 'webp', alphaMode: 'pma', ...extra });
const isWebp = (bytes) => bytes.length > 12 && Buffer.from(bytes.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('latin1') === 'WEBP';

// ------------------------------------------------ a straight page, lossy
{
  const result = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(straightPng, { alphaMode: 'straight' })], options: { preset: 'compact' } });
  equal(result.ok, true, 'a straight page converts: ' + result.error);
  equal(result.images.length, 1, 'one page out');
  const page = result.images[0];
  equal([page.sourceName, page.fileName, page.format], ['fx.png', 'fx.webp', 'webp'], 'named like the desktop would');
  equal([page.encoding, page.quality, page.alphaQuality], ['spine', 80, 100], 'the panel\'s fixed setting is Q80 with lossless alpha');
  equal([page.alphaVerified, page.rgbaVerified, page.sourceAlphaMode, page.pma], [true, false, 'straight', false], 'alpha was read back and checked');
  ok(isWebp(page.bytes), 'the bytes are a WebP container');
  equal(page.size, page.bytes.length, 'size is the byte count');
  equal([page.width, page.height], [SIZE, SIZE], 'dimensions reported');
  const back = await decodeWebp(page.bytes);
  let alphaMismatch = 0;
  for (let i = 3; i < straightRaw.length; i += 4) if (back.data[i] !== straightRaw[i]) alphaMismatch += 1;
  equal(alphaMismatch, 0, 'every alpha sample survives the lossy page');
  equal(result.atlases.length, 1, 'one atlas out');
  equal(result.atlases[0].fileName, 'fx.atlas', 'the atlas keeps its name');
  ok(result.atlases[0].text.includes('\nfx.webp\n'), 'the page line names the WebP');
  ok(!result.atlases[0].text.includes('fx.png'), 'and no longer the PNG');
  ok(result.atlases[0].text.includes('pma: false'), 'a page declared straight has its pma flag rewritten to false');
  equal(result.atlas, result.atlases[0], 'result.atlas is the first atlas, as on the desktop');
  // Objects cross the vm realm boundary with their own prototypes; compare the data.
  equal(JSON.parse(JSON.stringify(result.atlases[0].replacements)), [{ oldName: 'fx.png', nextName: 'fx.webp' }], 'the replacement is reported');

  const clarity = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(straightPng, { alphaMode: 'straight' })], options: { preset: 'clarity' } });
  const small = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(straightPng, { alphaMode: 'straight' })], options: { preset: 'small' } });
  equal([clarity.images[0].quality, small.images[0].quality], [95, 70], '画质优先 is Q95, 更小体积 is Q70');
  ok(small.images[0].size <= clarity.images[0].size, '更小体积 is not larger than 画质优先');
}

// ------------------------------------------------ a PMA page, lossy with exact
{
  const result = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(pmaPng)], options: { preset: 'compact' } });
  equal(result.ok, true, 'a PMA page converts: ' + result.error);
  const page = result.images[0];
  equal([page.encoding, page.quality, page.alphaQuality, page.rgbaVerified, page.alphaVerified, page.transparentRgbVerified, page.pma, page.sourceAlphaMode], ['pma-compatible', 80, 100, false, true, true, true, 'pma'], 'a PMA page is written lossy at Q80 and its margin verified');
  const back = await decodeWebp(page.bytes);
  let alphaMismatch = 0;
  let spill = 0;
  for (let i = 0; i < pmaRaw.length; i += 4) {
    if (back.data[i + 3] !== pmaRaw[i + 3]) alphaMismatch += 1;
    if (pmaRaw[i + 3] === 0) spill = Math.max(spill, back.data[i], back.data[i + 1], back.data[i + 2]);
  }
  equal(alphaMismatch, 0, 'every alpha sample of the PMA page survives');
  ok(spill <= 48, 'no transparent pixel rises more than 48 above black (got ' + spill + ')');
  ok(result.atlases[0].text.includes('pma: true'), 'the atlas keeps pma: true');
  ok(!result.warnings.some((w) => /无损/.test(w)), 'and nothing warns about lossless: ' + JSON.stringify(result.warnings));

  const lossless = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(pmaPng)], options: { lossless: true } });
  equal(lossless.images[0].encoding, 'pma-lossless', 'options.lossless still keeps a PMA page exact');
  equal(Buffer.compare(Buffer.from((await decodeWebp(lossless.images[0].bytes)).data), Buffer.from(pmaRaw)), 0, 'every RGBA byte survives the lossless page');
  ok(page.size < lossless.images[0].size, 'the lossy PMA page is smaller than the lossless one');

  // A page declared PMA but carrying colour above its alpha still goes lossy, with a warning.
  const over = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(straightPng)], options: { preset: 'compact' } });
  equal(over.ok, true, 'a mis-declared page still converts');
  ok(over.warnings.some((w) => /超出 Alpha/.test(w)), 'with a warning about colour above alpha: ' + JSON.stringify(over.warnings));
  equal([over.images[0].encoding, over.images[0].quality], ['pma-compatible', 80], 'and is never written lossless');
}

// ------------------------------------------------ the PMA ladder
{
  // A codec whose lossy output lifts one transparent pixel by (135 - quality):
  // Q80 (55) and Q85 (50) are over the limit, Q90 (45) is the first under it.
  const spilling = {
    ...codec,
    encode: async (rgba, width, height, options) => {
      if (options.lossless) return codec.encode(rgba, width, height, options);
      const out = await codec.encode(rgba, width, height, options);
      return Uint8Array.from([...out, 0xee, options.quality]); // tag, read back by decode below
    },
    decode: async (bytes) => {
      const tagged = bytes[bytes.length - 2] === 0xee;
      const image = await codec.decode(tagged ? bytes.subarray(0, bytes.length - 2) : bytes);
      if (tagged) for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3] === 0) { image.data[i] = 135 - bytes[bytes.length - 1]; break; }
      return image;
    }
  };
  const api = boot(spilling);
  const climbed = await api.convertSpineAtlasWebp({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(pmaPng)], options: { preset: 'compact' } });
  equal(climbed.ok, true, 'the ladder converts: ' + climbed.error);
  equal([climbed.images[0].encoding, climbed.images[0].quality, climbed.images[0].transparentRgbVerified], ['pma-compatible', 90, true], 'Q80 and Q85 spill past 48, Q90 (spill 45) ships');
  ok(climbed.warnings.some((w) => /Q80.*Q90/.test(w)), 'and the warning names both: ' + JSON.stringify(climbed.warnings));

  // Nothing passes: the cleanest attempt ships, never lossless.
  const hopeless = { ...spilling, decode: async (bytes) => { const image = await spilling.decode(bytes); if (bytes[bytes.length - 2] === 0xee) for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3] === 0) { image.data[i] = 200 - bytes[bytes.length - 1]; break; } return image; } };
  const kept = await boot(hopeless).convertSpineAtlasWebp({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(pmaPng)], options: { preset: 'compact' } });
  equal([kept.images[0].encoding, kept.images[0].quality, kept.images[0].transparentRgbVerified], ['pma-compatible', 95, false], 'all four spill; Q95 (the lowest) ships and says the margin is unverified');
  ok(kept.warnings.some((w) => /残留最低的 Q95/.test(w)), 'with a warning: ' + JSON.stringify(kept.warnings));
}

// ------------------------------------------------ legacy atlas, unmarked pages, auto
{
  const legacy = await convert({ atlases: [{ fileName: 'fx.atlas', text: LEGACY_ATLAS }], images: [image(pmaPng)], options: { preset: 'compact' } });
  equal(legacy.ok, true, 'a Spine 3.x atlas converts: ' + legacy.error);
  ok(!legacy.atlases[0].text.includes('pma:'), 'no pma line is added to a 3.x atlas');
  ok(legacy.warnings.some((w) => /3\.x/.test(w)), 'and the warning explains why');
  ok(legacy.atlases[0].text.includes('\nfx.webp\n'), 'the 3.x page line names the WebP');

  const modernUnmarked = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS_UNMARKED }], images: [image(pmaPng)], options: { preset: 'compact' } });
  ok(modernUnmarked.atlases[0].text.includes('pma: true'), 'a 4.x atlas without the flag gets pma: true when the page is declared PMA');

  const auto = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS_UNMARKED }], images: [image(pmaPng, { alphaMode: 'auto' })], options: { preset: 'compact' } });
  equal([auto.images[0].encoding, auto.images[0].sourceAlphaMode], ['rgba-lossless', 'unknown'], 'auto on an unmarked page keeps RGBA exactly');
  ok(auto.warnings.some((w) => /未标记/.test(w)), 'and says the atlas did not mark it');
  ok(!auto.atlases[0].text.includes('pma:'), 'auto never invents a flag');

  const autoMarked = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(pmaPng, { alphaMode: 'auto' })], options: { preset: 'compact' } });
  equal(autoMarked.images[0].encoding, 'pma-compatible', 'auto follows the atlas flag');

  const lossless = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(straightPng, { alphaMode: 'straight' })], options: { lossless: true } });
  equal(lossless.images[0].encoding, 'lossless', 'options.lossless asks for exact output of a straight page too');
}

// ------------------------------------------------ JPG
{
  jpegCalls.length = 0;
  const pma = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(pmaPng, { outputFormat: 'jpg' })], options: { preset: 'compact' } });
  equal(pma.ok, true, 'a PMA page becomes JPG: ' + pma.error);
  equal([pma.images[0].fileName, pma.images[0].format, pma.images[0].encoding, pma.images[0].quality], ['fx.jpg', 'jpg', 'jpg', 80], 'named .jpg, at the preset quality');
  equal(jpegCalls.length, 1, 'the JPG encoder ran once');
  equal([jpegCalls[0].width, jpegCalls[0].height, jpegCalls[0].quality], [SIZE, SIZE, 80], 'with the page size and quality');
  let rgbKept = true;
  for (let i = 0; i < pmaRaw.length; i += 4) {
    if (jpegCalls[0].rgb[i] !== pmaRaw[i] || jpegCalls[0].rgb[i + 1] !== pmaRaw[i + 1] || jpegCalls[0].rgb[i + 2] !== pmaRaw[i + 2] || jpegCalls[0].rgb[i + 3] !== 255) rgbKept = false;
  }
  ok(rgbKept, 'a PMA page keeps its RGB (already composited over black) and drops alpha');
  ok(pma.atlases[0].text.includes('\nfx.jpg\n') && pma.atlases[0].text.includes('pma: false'), 'the atlas names the JPG and turns pma off');
  ok(pma.warnings.some((w) => /JPG/.test(w) && /黑底/.test(w)), 'and warns about the black background');

  jpegCalls.length = 0;
  const straight = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(straightPng, { outputFormat: 'jpg', alphaMode: 'straight' })], options: { preset: 'small' } });
  equal(straight.ok, true, 'a straight page becomes JPG');
  let flattened = true;
  for (let i = 0; i < straightRaw.length; i += 4) {
    const a = straightRaw[i + 3];
    if (jpegCalls[0].rgb[i] !== Math.round((straightRaw[i] * a) / 255) || jpegCalls[0].rgb[i + 2] !== Math.round((straightRaw[i + 2] * a) / 255)) flattened = false;
  }
  ok(flattened, 'a straight page is multiplied down onto black first');
  equal(straight.images[0].quality, 70, '更小体积 is JPG quality 70');
}

// ------------------------------------------------ PNG flavours reach the encoder as RGBA
{
  // A palette page with a transparent entry, as an older packer might write.
  const palette = Buffer.from([0, 0, 0, 200, 40, 10, 10, 200, 40]);
  const trns = Buffer.from([0, 255, 128]);
  const indices = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < indices.length; i += 1) indices[i] = i % 3;
  const palettePng = makePng({ width: SIZE, height: SIZE, colorType: 3, raw: indices, extra: [['PLTE', palette], ['tRNS', trns]] });
  const result = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(palettePng, { alphaMode: 'auto' })], options: { lossless: true } }); // lossless: this checks the PNG decoder, byte for byte
  equal(result.ok, true, 'a palette PNG converts: ' + result.error);
  const back = await decodeWebp(result.images[0].bytes);
  const expected = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < indices.length; i += 1) {
    const p = indices[i] * 3;
    expected[i * 4] = palette[p]; expected[i * 4 + 1] = palette[p + 1]; expected[i * 4 + 2] = palette[p + 2]; expected[i * 4 + 3] = trns[indices[i]];
  }
  equal(Buffer.compare(Buffer.from(back.data), Buffer.from(expected)), 0, 'palette and tRNS expand to the right RGBA');

  // Greyscale with alpha, 16-bit: the high byte is what the page keeps.
  const ga16 = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i += 1) { ga16[i * 4] = i % 256; ga16[i * 4 + 1] = 0x7f; ga16[i * 4 + 2] = 255 - (i % 256); ga16[i * 4 + 3] = 0x01; }
  const gaPng = makePng({ width: SIZE, height: SIZE, colorType: 4, bitDepth: 16, raw: ga16 });
  const grey = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(gaPng, { alphaMode: 'auto' })], options: { lossless: true } });
  equal(grey.ok, true, 'a 16-bit grey+alpha PNG converts: ' + grey.error);
  const greyBack = await decodeWebp(grey.images[0].bytes);
  let greyOk = true;
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const g = i % 256;
    if (greyBack.data[i * 4] !== g || greyBack.data[i * 4 + 1] !== g || greyBack.data[i * 4 + 2] !== g || greyBack.data[i * 4 + 3] !== 255 - g) greyOk = false;
  }
  ok(greyOk, 'grey and alpha land in RGBA at 8 bits');

  // Bytes as a Uint8Array are taken as they are.
  const typed = await convert({ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [{ fileName: 'fx.png', bytes: new Uint8Array(pmaPng), outputFormat: 'webp', alphaMode: 'pma' }], options: { preset: 'compact' } });
  equal(typed.ok, true, 'a typed array of bytes is accepted');
}

// ------------------------------------------------ several pages, several atlases
{
  const two = '\nfx.png\nsize: 32,32\nfilter: Linear,Linear\npma: true\nregion\n  bounds: 0,0,32,32\n\nfx2.png\nsize: 32,32\nfilter: Linear,Linear\npma: true\nother\n  bounds: 0,0,32,32\n';
  const result = await convert({
    atlases: [{ fileName: 'a.atlas', text: two }, { fileName: 'b.atlas', text: MODERN_ATLAS }],
    images: [image(pmaPng), image(straightPng, { fileName: 'fx2.png', alphaMode: 'straight' }), image(pmaPng, { fileName: 'unused.png' })],
    options: { preset: 'compact' }
  });
  equal(result.ok, true, 'two atlases and three pages convert: ' + result.error);
  equal(Array.from(result.images, (p) => p.fileName), ['fx.webp', 'fx2.webp'], 'only pages an atlas references come back');
  equal(Array.from(result.atlases, (a) => a.fileName), ['a.atlas', 'b.atlas'], 'both atlases come back');
  ok(result.atlases[0].text.includes('\nfx.webp\n') && result.atlases[0].text.includes('\nfx2.webp\n'), 'both pages of the first atlas are renamed');
  ok(/fx2\.webp\nsize: 32,32\nfilter: Linear,Linear\npma: false\n/.test(result.atlases[0].text), 'the straight page has its flag rewritten and the PMA page keeps its own');
}

// ------------------------------------------------ refusals say what is wrong
{
  const cases = [
    [{ atlases: [], images: [image(pmaPng)] }, /缺少 atlas/, 'no atlas'],
    [{ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [] }, /至少上传 1 张/, 'no page'],
    [{ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS.replace('fx.png', 'other.png') }], images: [image(pmaPng)] }, /未匹配到/, 'an atlas naming another page'],
    [{ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(pmaPng), image(pmaPng)] }, /文件名重复/, 'the same page twice'],
    [{ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS_UNMARKED }], images: [image(pmaPng, { outputFormat: 'jpg', alphaMode: 'auto' })] }, /转 JPG 前请选择/, 'JPG without knowing the alpha'],
    [{ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(pmaPng)], options: { preset: 'huge' } }, /压缩档位无效/, 'an unknown preset'],
    [{ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [image(pmaPng, { alphaMode: 'maybe' })] }, /Alpha 设置无效/, 'an unknown alpha mode'],
    [{ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS }], images: [{ fileName: 'fx.png', bytes: Array.from(Buffer.from('not a png')), alphaMode: 'pma' }] }, /PNG 解码失败/, 'bytes that are not a PNG'],
    [{ atlases: [{ fileName: 'fx.atlas', text: MODERN_ATLAS + '\nfx.png\nsize: 32,32\npma: false\nregion\n  bounds: 0,0,32,32\n' }], images: [image(pmaPng, { alphaMode: 'auto' })] }, /PMA 标记冲突/, 'pages that disagree about PMA under auto']
  ];
  for (const [payload, pattern, what] of cases) {
    const refused = await convert(payload);
    equal(refused.ok, false, what + ' is refused');
    ok(pattern.test(refused.error), what + ' says why: ' + refused.error);
  }
  const thrown = await convert(null);
  equal(thrown.ok, false, 'a missing payload is refused, not thrown');
}

// ------------------------------------------------ a shipped atlas page, end to end
{
  const png = await readFile(new URL('../../renderer/templates/vfx/slash_basic_builtin/source/frame_001.png', import.meta.url));
  // The frame is a straight-alpha PNG (colour under its margin), so it is declared so.
  const atlas = '\nframe_001.png\nsize: 8,8\nfilter: Linear,Linear\npma: false\nslash\n  bounds: 0,0,8,8\n';
  const result = await convert({ atlases: [{ fileName: 'slash.atlas', text: atlas }], images: [{ fileName: 'frame_001.png', bytes: Array.from(png), outputFormat: 'webp', alphaMode: 'straight' }], options: { preset: 'compact' } });
  equal(result.ok, true, 'a shipped template frame converts: ' + result.error);
  equal([result.images[0].encoding, result.images[0].quality, result.images[0].alphaVerified], ['spine', 80, true], 'lossy at Q80, alpha read back and checked');
  ok(result.images[0].size < png.length, 'the WebP is smaller than the PNG (' + result.images[0].size + ' < ' + png.length + ')');
}

console.log(checks + ' passed, 0 failed: SPINE 图集转换 converts atlas pages to WebP/JPG in the browser');
