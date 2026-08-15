"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { deflateSync } = require("node:zlib");

const {
  crc32,
  repairIndexedPngTransparentPalette
} = require("../main/png-palette-helpers");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  assert.equal(typeBytes.length, 4);
  const payload = Buffer.from(data);
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  typeBytes.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), payload.length + 8);
  return chunk;
}

function makeIhdr({
  width = 1,
  height = 1,
  bitDepth = 8,
  colorType = 3,
  compressionMethod = 0,
  filterMethod = 0,
  interlaceMethod = 0
} = {}) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = bitDepth;
  data[9] = colorType;
  data[10] = compressionMethod;
  data[11] = filterMethod;
  data[12] = interlaceMethod;
  return makeChunk("IHDR", data);
}

function makePng(chunks) {
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

function makeIdat(colorType = 3) {
  const scanlineByColorType = {
    0: Buffer.from([0, 0]),
    2: Buffer.from([0, 0, 0, 0]),
    3: Buffer.from([0, 0]),
    4: Buffer.from([0, 0, 0]),
    6: Buffer.from([0, 0, 0, 0, 0])
  };
  return makeChunk("IDAT", deflateSync(scanlineByColorType[colorType]));
}

function makeIndexedPng({
  palette = Buffer.from([76, 105, 113, 10, 20, 30]),
  trns = Buffer.from([0, 255]),
  bitDepth = 8
} = {}) {
  const chunks = [makeIhdr({ bitDepth, colorType: 3 }), makeChunk("PLTE", palette)];
  if (trns !== null) chunks.push(makeChunk("tRNS", trns));
  chunks.push(makeIdat(3), makeChunk("IEND"));
  return makePng(chunks);
}

function makeTruecolorPng({ colorType, trns = null } = {}) {
  const chunks = [makeIhdr({ bitDepth: 8, colorType })];
  if (trns !== null) chunks.push(makeChunk("tRNS", trns));
  chunks.push(makeIdat(colorType), makeChunk("IEND"));
  return makePng(chunks);
}

function readChunks(png) {
  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const endOffset = crcOffset + 4;
    chunks.push({
      type: png.subarray(typeOffset, dataOffset).toString("ascii"),
      typeOffset,
      dataOffset,
      length,
      crcOffset,
      endOffset,
      data: png.subarray(dataOffset, crcOffset)
    });
    offset = endOffset;
  }
  return chunks;
}

function chunkData(png, type) {
  const chunk = readChunks(png).find((entry) => entry.type === type);
  assert.ok(chunk, `missing test chunk ${type}`);
  return chunk.data;
}

function assertAllChunkCrcs(png) {
  for (const chunk of readChunks(png)) {
    const expected = png.readUInt32BE(chunk.crcOffset);
    const actual = crc32(png.subarray(chunk.typeOffset, chunk.crcOffset));
    assert.equal(actual, expected, `${chunk.type} CRC should be valid`);
  }
}

test("crc32 matches the standard known vector", () => {
  assert.equal(crc32(Buffer.from("123456789", "ascii")), 0xcbf43926);
});

test("repairs every dirty alpha-zero palette entry without touching partial alpha or IDAT", () => {
  const palette = Buffer.from([
    76, 105, 113,
    10, 20, 30,
    40, 50, 60,
    70, 80, 90,
    100, 110, 120
  ]);
  const input = makeIndexedPng({ palette, trns: Buffer.from([0, 0, 1, 128, 255]) });
  const inputSnapshot = Buffer.from(input);
  const idatBefore = Buffer.from(chunkData(input, "IDAT"));

  const result = repairIndexedPngTransparentPalette(input);

  assert.equal(Buffer.isBuffer(result.data), true);
  assert.equal(result.repaired, true);
  assert.equal(result.repairedEntries, 2);
  assert.equal(result.data.length, input.length);
  assert.deepEqual(input, inputSnapshot, "the caller-owned input must not be mutated");
  assert.deepEqual(
    chunkData(result.data, "PLTE"),
    Buffer.from([
      0, 0, 0,
      0, 0, 0,
      40, 50, 60,
      70, 80, 90,
      100, 110, 120
    ])
  );
  assert.deepEqual(chunkData(result.data, "tRNS"), Buffer.from([0, 0, 1, 128, 255]));
  assert.deepEqual(chunkData(result.data, "IDAT"), idatBefore);
  assertAllChunkCrcs(result.data);

  const secondPass = repairIndexedPngTransparentPalette(result.data);
  assert.equal(secondPass.repaired, false);
  assert.equal(secondPass.repairedEntries, 0);
  assert.deepEqual(secondPass.data, result.data, "repair must be idempotent");
});

test("a short tRNS repairs explicit alpha zero only and treats omitted entries as opaque", () => {
  const input = makeIndexedPng({
    palette: Buffer.from([
      9, 8, 7,
      6, 5, 4,
      3, 2, 1,
      30, 20, 10
    ]),
    trns: Buffer.from([0, 128])
  });

  const result = repairIndexedPngTransparentPalette(input);

  assert.equal(result.repaired, true);
  assert.equal(result.repairedEntries, 1);
  assert.deepEqual(
    chunkData(result.data, "PLTE"),
    Buffer.from([
      0, 0, 0,
      6, 5, 4,
      3, 2, 1,
      30, 20, 10
    ])
  );
});

test("clean, no-tRNS, RGB, and RGBA PNGs are validated no-ops", async (t) => {
  const fixtures = [
    {
      name: "clean indexed PNG",
      png: makeIndexedPng({ palette: Buffer.from([0, 0, 0, 10, 20, 30]) })
    },
    {
      name: "indexed PNG without tRNS",
      png: makeIndexedPng({ palette: Buffer.from([76, 105, 113, 10, 20, 30]), trns: null })
    },
    {
      name: "RGB PNG with a truecolor tRNS key",
      png: makeTruecolorPng({ colorType: 2, trns: Buffer.alloc(6) })
    },
    {
      name: "RGBA PNG",
      png: makeTruecolorPng({ colorType: 6 })
    }
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      const result = repairIndexedPngTransparentPalette(fixture.png);
      assert.equal(result.repaired, false);
      assert.equal(result.repairedEntries, 0);
      assert.deepEqual(result.data, fixture.png);
      assertAllChunkCrcs(result.data);
    });
  }
});

test("malformed, invalidly ordered, or CRC-corrupt PNGs fail closed", async (t) => {
  const palette = makeChunk("PLTE", Buffer.from([1, 2, 3, 4, 5, 6]));
  const trns = makeChunk("tRNS", Buffer.from([0, 255]));
  const idat = makeIdat(3);
  const iend = makeChunk("IEND");
  const valid = makePng([makeIhdr(), palette, trns, idat, iend]);

  const badSignature = Buffer.from(valid);
  badSignature[0] ^= 0xff;

  const crcCorrupt = makePng([
    makeIhdr(),
    palette,
    makeChunk("tEXt", Buffer.from("key\0value")),
    trns,
    idat,
    iend
  ]);
  const textChunk = readChunks(crcCorrupt).find((chunk) => chunk.type === "tEXt");
  crcCorrupt[textChunk.dataOffset] ^= 1;

  const oversizedHeader = Buffer.alloc(12);
  oversizedHeader.writeUInt32BE(0x80000000, 0);
  Buffer.from("IDAT").copy(oversizedHeader, 4);

  const cases = [
    ["bad signature", badSignature],
    ["truncated chunk", valid.subarray(0, valid.length - 1)],
    ["CRC mismatch in an unrelated ancillary chunk", crcCorrupt],
    ["chunk length beyond PNG limit", Buffer.concat([PNG_SIGNATURE, oversizedHeader])],
    ["IHDR is not first", makePng([palette, makeIhdr(), idat, iend])],
    ["duplicate IHDR", makePng([makeIhdr(), makeIhdr(), palette, idat, iend])],
    ["bad IHDR length", makePng([makeChunk("IHDR", Buffer.alloc(12)), idat, iend])],
    ["zero image width", makePng([makeIhdr({ width: 0 }), palette, idat, iend])],
    ["invalid color type and bit-depth pair", makePng([makeIhdr({ colorType: 3, bitDepth: 16 }), palette, idat, iend])],
    ["invalid compression method", makePng([makeIhdr({ compressionMethod: 1 }), palette, idat, iend])],
    ["invalid filter method", makePng([makeIhdr({ filterMethod: 1 }), palette, idat, iend])],
    ["invalid interlace method", makePng([makeIhdr({ interlaceMethod: 2 }), palette, idat, iend])],
    ["empty PLTE", makePng([makeIhdr(), makeChunk("PLTE"), idat, iend])],
    ["non-RGB PLTE length", makePng([makeIhdr(), makeChunk("PLTE", Buffer.alloc(4)), idat, iend])],
    [
      "palette larger than indexed bit depth",
      makePng([
        makeIhdr({ bitDepth: 1 }),
        makeChunk("PLTE", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9])),
        idat,
        iend
      ])
    ],
    ["duplicate PLTE", makePng([makeIhdr(), palette, palette, idat, iend])],
    ["indexed tRNS before PLTE", makePng([makeIhdr(), trns, palette, idat, iend])],
    ["empty indexed tRNS", makePng([makeIhdr(), palette, makeChunk("tRNS"), idat, iend])],
    [
      "tRNS longer than PLTE",
      makePng([makeIhdr(), palette, makeChunk("tRNS", Buffer.from([0, 1, 2])), idat, iend])
    ],
    ["duplicate tRNS", makePng([makeIhdr(), palette, trns, trns, idat, iend])],
    ["indexed PNG without PLTE", makePng([makeIhdr(), idat, iend])],
    [
      "PLTE after IDAT",
      makePng([makeIhdr({ colorType: 2 }), makeIdat(2), palette, iend])
    ],
    [
      "tRNS after IDAT",
      makePng([makeIhdr({ colorType: 2 }), makeIdat(2), makeChunk("tRNS", Buffer.alloc(6)), iend])
    ],
    [
      "tRNS forbidden for RGBA",
      makePng([makeIhdr({ colorType: 6 }), makeChunk("tRNS", Buffer.alloc(1)), makeIdat(6), iend])
    ],
    [
      "wrong truecolor tRNS length",
      makePng([makeIhdr({ colorType: 2 }), makeChunk("tRNS", Buffer.alloc(5)), makeIdat(2), iend])
    ],
    [
      "PLTE forbidden for grayscale",
      makePng([makeIhdr({ colorType: 0 }), palette, makeIdat(0), iend])
    ],
    [
      "non-consecutive IDAT chunks",
      makePng([makeIhdr(), palette, idat, makeChunk("tEXt", Buffer.from("a\0b")), idat, iend])
    ],
    ["missing IDAT", makePng([makeIhdr(), palette, iend])],
    ["IEND has data", makePng([makeIhdr(), palette, idat, makeChunk("IEND", Buffer.from([0]))])],
    ["missing IEND", makePng([makeIhdr(), palette, idat])],
    ["bytes after IEND", Buffer.concat([valid, Buffer.from([0])])],
    [
      "non-letter chunk type",
      makePng([makeIhdr(), palette, makeChunk("ID1T", Buffer.alloc(1)), idat, iend])
    ],
    [
      "lowercase reserved chunk bit",
      makePng([makeIhdr(), palette, makeChunk("texT", Buffer.alloc(1)), idat, iend])
    ],
    [
      "unknown critical chunk",
      makePng([makeIhdr(), palette, makeChunk("ABCD", Buffer.alloc(1)), idat, iend])
    ]
  ];

  for (const [name, png] of cases) {
    await t.test(name, () => {
      assert.throws(() => repairIndexedPngTransparentPalette(png), /^Error: Invalid PNG:/);
    });
  }
});
