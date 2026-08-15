"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const sharp = require("sharp");

const {
  MAX_ALPHA_ANALYSIS_PIXELS,
  SPINE_ATLAS_PMA_PROFILE,
  classifyStoredRgbaAlpha,
  createPngCompressor
} = require("../main/compression-helpers");
const {
  crc32,
  repairIndexedPngTransparentPalette
} = require("../main/png-palette-helpers");

const memoryFs = {
  existsSync: () => false,
  readFileSync: () => {
    throw new Error("unexpected file read");
  }
};

function solidRgba(width, height, rgba) {
  const data = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  }
  return data;
}

function pmaAlphaRampRgba(width = 16) {
  const alphaRows = [0, 8, 16, 24, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 248];
  const data = Buffer.alloc(width * alphaRows.length * 4);
  for (let row = 0; row < alphaRows.length; row += 1) {
    const alpha = alphaRows[row];
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 4;
      data[offset] = Math.floor(alpha * 0.8);
      data[offset + 1] = Math.floor(alpha * 0.4);
      data[offset + 2] = Math.floor(alpha * 0.2);
      data[offset + 3] = alpha;
    }
  }
  return { data, width, height: alphaRows.length };
}

function straightDarkAlphaRampRgba(width = 16) {
  const ramp = pmaAlphaRampRgba(width);
  for (let offset = 0; offset < ramp.data.length; offset += 4) {
    ramp.data[offset] = 8;
    ramp.data[offset + 1] = 4;
    ramp.data[offset + 2] = 2;
  }
  return ramp;
}

async function encodeRgba(data, width, height, palette = false) {
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png({ palette, colours: 16, dither: 0 })
    .toBuffer();
}

function readChunks(png) {
  const chunks = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    chunks.push({
      type: png.subarray(typeOffset, dataOffset).toString("ascii"),
      typeOffset,
      dataOffset,
      length,
      crcOffset
    });
    offset = crcOffset + 4;
  }
  return chunks;
}

function makeTransparentPaletteEntryDirty(png) {
  const output = Buffer.from(png);
  const chunks = readChunks(output);
  const plte = chunks.find((chunk) => chunk.type === "PLTE");
  const trns = chunks.find((chunk) => chunk.type === "tRNS");
  assert.ok(plte && trns, "fixture must be an indexed PNG with transparency");

  let paletteIndex = -1;
  for (let index = 0; index < trns.length; index += 1) {
    if (output[trns.dataOffset + index] === 0) {
      paletteIndex = index;
      break;
    }
  }
  assert.notEqual(paletteIndex, -1, "fixture must contain a fully transparent palette entry");

  const rgbOffset = plte.dataOffset + paletteIndex * 3;
  output[rgbOffset] = 76;
  output[rgbOffset + 1] = 105;
  output[rgbOffset + 2] = 113;
  output.writeUInt32BE(
    crc32(output.subarray(plte.typeOffset, plte.dataOffset + plte.length)),
    plte.crcOffset
  );
  return output;
}

function pngColorType(png) {
  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );
  return png[25];
}

async function compressProfile(input) {
  const compress = createPngCompressor({ fs: memoryFs, sharp });
  return compress(
    {
      bytes: Array.from(input),
      profile: SPINE_ATLAS_PMA_PROFILE,
      compressionLevel: 9,
      effort: 8,
      quality: 82,
      colors: 64,
      dither: 0
    },
    { palette: true }
  );
}

test("classifies stored RGBA conservatively", () => {
  const pmaRamp = pmaAlphaRampRgba();
  assert.equal(classifyStoredRgbaAlpha(pmaRamp.data).mode, "pma-like");
  assert.equal(classifyStoredRgbaAlpha(solidRgba(8, 8, [255, 32, 16, 128])).mode, "straight");
  assert.equal(classifyStoredRgbaAlpha(solidRgba(8, 8, [32, 16, 8, 255])).mode, "opaque");
  assert.equal(classifyStoredRgbaAlpha(solidRgba(4, 4, [32, 16, 8, 128])).mode, "ambiguous");
  assert.equal(classifyStoredRgbaAlpha(solidRgba(8, 8, [64, 32, 16, 128])).mode, "ambiguous");
  assert.equal(
    classifyStoredRgbaAlpha(solidRgba(8, 8, [10, 8, 6, 128])).mode,
    "ambiguous",
    "dark straight-alpha pixels without a broad alpha ramp are not positive PMA evidence"
  );
  const straightDarkRamp = straightDarkAlphaRampRgba();
  assert.equal(
    classifyStoredRgbaAlpha(straightDarkRamp.data).mode,
    "ambiguous",
    "a broad alpha ramp with constant dark RGB is straight-alpha evidence, not PMA proof"
  );
  assert.throws(() => classifyStoredRgbaAlpha(Buffer.alloc(3)), /invalid RGBA analysis buffer/);
});

test("PMA profile keeps enhanced palette compression and cleans a dirty input palette", async () => {
  const ramp = pmaAlphaRampRgba();
  const cleanIndexed = await encodeRgba(ramp.data, ramp.width, ramp.height, true);
  const dirtyIndexed = makeTransparentPaletteEntryDirty(cleanIndexed);
  assert.ok(repairIndexedPngTransparentPalette(dirtyIndexed).repairedEntries > 0);

  const result = await compressProfile(dirtyIndexed);
  const output = Buffer.from(result.bytes);

  assert.equal(result.spineAtlasProtection.alphaMode, "pma-like");
  assert.equal(result.spineAtlasProtection.pmaConfirmed, true);
  assert.equal(result.spineAtlasProtection.safeFallback, false);
  assert.ok(result.spineAtlasProtection.inputDirtyTransparentEntries > 0);
  assert.equal(pngColorType(output), 3, "PMA enhanced output should remain indexed");
  assert.equal(
    repairIndexedPngTransparentPalette(output).repairedEntries,
    0,
    "the returned PNG must not retain dirty fully-transparent palette colours"
  );
});

test("an explicitly selected PMA profile still rejects obvious straight alpha", async () => {
  const input = await encodeRgba(solidRgba(8, 8, [255, 32, 16, 128]), 8, 8, false);
  const result = await compressProfile(input);
  const output = Buffer.from(result.bytes);

  assert.equal(result.spineAtlasProtection.alphaMode, "straight");
  assert.equal(result.spineAtlasProtection.pmaConfirmed, true);
  assert.equal(result.spineAtlasProtection.safeFallback, true);
  assert.equal(pngColorType(output), 6, "a clear PMA mismatch should preserve RGBA storage");
  assert.equal(repairIndexedPngTransparentPalette(output).repairedEntries, 0);
});

test("confirmed PMA repairs binary transparency even when pixels alone are ambiguous", async () => {
  const width = 8;
  const height = 8;
  const rgba = solidRgba(width, height, [64, 32, 16, 255]);
  for (let offset = 0; offset < rgba.length / 2; offset += 4) {
    rgba[offset] = 0;
    rgba[offset + 1] = 0;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 0;
  }
  const dirtyIndexed = makeTransparentPaletteEntryDirty(
    await encodeRgba(rgba, width, height, true)
  );
  const result = await compressProfile(dirtyIndexed);
  const output = Buffer.from(result.bytes);

  assert.equal(result.spineAtlasProtection.alphaMode, "ambiguous");
  assert.equal(result.spineAtlasProtection.pmaConfirmed, true);
  assert.equal(result.spineAtlasProtection.safeFallback, false);
  assert.ok(result.spineAtlasProtection.inputDirtyTransparentEntries > 0);
  assert.equal(pngColorType(output), 3);
  assert.equal(repairIndexedPngTransparentPalette(output).repairedEntries, 0);
});

test("ordinary PNG compression does not opt into Spine analysis", async () => {
  const calls = [];
  const fakeSharp = (input, options) => ({
    png(pngOptions) {
      calls.push({ input, options, pngOptions });
      return {
        async toBuffer() {
          return { data: Buffer.from([7, 8, 9]), info: { width: 2, height: 3 } };
        }
      };
    }
  });
  const compress = createPngCompressor({ fs: memoryFs, sharp: fakeSharp });
  const result = await compress({ bytes: [1, 2, 3], quality: 80 }, { palette: true });

  assert.equal(result.spineAtlasProtection, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pngOptions.palette, true);
});

test("the unconfirmed Spine safe path preserves RGBA and skips PMA metadata", async () => {
  const input = await encodeRgba(solidRgba(8, 8, [255, 32, 16, 128]), 8, 8, false);
  const compress = createPngCompressor({ fs: memoryFs, sharp });
  const result = await compress(
    { bytes: Array.from(input), compressionLevel: 9, effort: 10 },
    { palette: false }
  );

  assert.equal(result.spineAtlasProtection, undefined);
  assert.equal(pngColorType(Buffer.from(result.bytes)), 6);
});

test("oversized confirmed-PMA atlases skip raw analysis without losing the explicit mode", async () => {
  const input = await encodeRgba(solidRgba(2, 2, [32, 16, 8, 128]), 2, 2, false);
  const calls = [];
  const fakeSharp = () => {
    const callIndex = calls.length;
    const call = { rawAnalysisRequested: false, pngOptions: null };
    calls.push(call);
    if (callIndex === 0) {
      return {
        async metadata() {
          return { width: MAX_ALPHA_ANALYSIS_PIXELS + 1, height: 1 };
        },
        ensureAlpha() {
          call.rawAnalysisRequested = true;
          throw new Error("oversized input should not be decoded to raw RGBA for analysis");
        }
      };
    }
    return {
      png(pngOptions) {
        call.pngOptions = pngOptions;
        return {
          async toBuffer() {
            return { data: input, info: { width: 2, height: 2 } };
          }
        };
      }
    };
  };
  const compress = createPngCompressor({ fs: memoryFs, sharp: fakeSharp });
  const result = await compress(
    { bytes: Array.from(input), profile: SPINE_ATLAS_PMA_PROFILE },
    { palette: true }
  );

  assert.equal(result.spineAtlasProtection.alphaMode, "ambiguous");
  assert.equal(result.spineAtlasProtection.pmaConfirmed, true);
  assert.equal(result.spineAtlasProtection.analysisReason, "analysis-pixel-limit");
  assert.equal(result.spineAtlasProtection.safeFallback, false);
  assert.equal(calls[0].rawAnalysisRequested, false);
  assert.equal(calls[1].pngOptions.palette, true);
});

test("Spine profile rejects malformed PNG input before compression", async () => {
  const compress = createPngCompressor({ fs: memoryFs, sharp });
  await assert.rejects(
    compress(
      { bytes: [1, 2, 3], profile: SPINE_ATLAS_PMA_PROFILE },
      { palette: true }
    ),
    /Invalid PNG: signature mismatch/
  );
});
