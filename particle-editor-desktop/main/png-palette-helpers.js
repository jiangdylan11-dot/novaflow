"use strict";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KNOWN_CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

function crc32(input) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    throw new TypeError("crc32 input must be a Buffer or Uint8Array");
  }
  const bytes = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function invalidPng(message) {
  throw new Error(`Invalid PNG: ${message}`);
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError("PNG input must be a Buffer or Uint8Array");
}

function isAsciiLetter(value) {
  return (value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a);
}

function validateChunkType(typeBytes) {
  for (const value of typeBytes) {
    if (!isAsciiLetter(value)) invalidPng("chunk type contains a non-letter byte");
  }
  if (typeBytes[2] >= 0x61 && typeBytes[2] <= 0x7a) {
    invalidPng("chunk type has a lowercase reserved bit");
  }
}

function validateIhdr(data) {
  if (data.length !== 13) invalidPng("IHDR length must be 13 bytes");

  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const bitDepth = data[8];
  const colorType = data[9];
  const compressionMethod = data[10];
  const filterMethod = data[11];
  const interlaceMethod = data[12];

  if (width === 0 || width > 0x7fffffff || height === 0 || height > 0x7fffffff) {
    invalidPng("IHDR width and height must be between 1 and 2^31-1");
  }

  const validBitDepths = {
    0: new Set([1, 2, 4, 8, 16]),
    2: new Set([8, 16]),
    3: new Set([1, 2, 4, 8]),
    4: new Set([8, 16]),
    6: new Set([8, 16])
  };
  if (!validBitDepths[colorType] || !validBitDepths[colorType].has(bitDepth)) {
    invalidPng(`unsupported IHDR color type ${colorType} and bit depth ${bitDepth}`);
  }
  if (compressionMethod !== 0) invalidPng("IHDR compression method must be 0");
  if (filterMethod !== 0) invalidPng("IHDR filter method must be 0");
  if (interlaceMethod !== 0 && interlaceMethod !== 1) {
    invalidPng("IHDR interlace method must be 0 or 1");
  }

  return { bitDepth, colorType };
}

function parseAndValidatePng(input) {
  const source = toBuffer(input);
  if (source.length < PNG_SIGNATURE.length || !source.subarray(0, 8).equals(PNG_SIGNATURE)) {
    invalidPng("signature mismatch");
  }

  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let ihdr = null;
  let plte = null;
  let trns = null;
  let sawIdat = false;
  let idatSequenceClosed = false;
  let sawIend = false;
  const idats = [];

  while (offset < source.length) {
    if (source.length - offset < 12) invalidPng(`truncated chunk at offset ${offset}`);

    const length = source.readUInt32BE(offset);
    if (length > 0x7fffffff) invalidPng(`chunk at offset ${offset} exceeds the PNG length limit`);

    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const crcOffset = dataEnd;
    const endOffset = crcOffset + 4;
    if (endOffset > source.length) invalidPng(`chunk at offset ${offset} extends beyond the file`);

    const typeBytes = source.subarray(typeOffset, dataOffset);
    validateChunkType(typeBytes);
    const type = typeBytes.toString("ascii");
    const expectedCrc = source.readUInt32BE(crcOffset);
    const actualCrc = crc32(source.subarray(typeOffset, dataEnd));
    if (actualCrc !== expectedCrc) invalidPng(`${type} CRC mismatch`);

    if (chunkIndex === 0 && type !== "IHDR") invalidPng("IHDR must be the first chunk");
    if ((typeBytes[0] & 0x20) === 0 && !KNOWN_CRITICAL_CHUNKS.has(type)) {
      invalidPng(`unknown critical chunk ${type}`);
    }
    if (sawIdat && type !== "IDAT") idatSequenceClosed = true;

    const chunk = {
      type,
      offset,
      typeOffset,
      dataOffset,
      length,
      crcOffset,
      endOffset
    };

    switch (type) {
      case "IHDR": {
        if (ihdr) invalidPng("duplicate IHDR chunk");
        if (chunkIndex !== 0) invalidPng("IHDR must be the first chunk");
        ihdr = { ...chunk, ...validateIhdr(source.subarray(dataOffset, dataEnd)) };
        break;
      }
      case "PLTE": {
        if (!ihdr) invalidPng("PLTE appears before IHDR");
        if (plte) invalidPng("duplicate PLTE chunk");
        if (sawIdat) invalidPng("PLTE must appear before IDAT");
        if (trns) invalidPng("PLTE must appear before tRNS");
        if (ihdr.colorType === 0 || ihdr.colorType === 4) {
          invalidPng(`PLTE is forbidden for color type ${ihdr.colorType}`);
        }
        if (length === 0 || length % 3 !== 0 || length > 768) {
          invalidPng("PLTE length must contain between 1 and 256 RGB entries");
        }
        const entries = length / 3;
        if (ihdr.colorType === 3 && entries > 2 ** ihdr.bitDepth) {
          invalidPng("PLTE has more entries than the indexed bit depth permits");
        }
        plte = { ...chunk, entries };
        break;
      }
      case "tRNS": {
        if (!ihdr) invalidPng("tRNS appears before IHDR");
        if (trns) invalidPng("duplicate tRNS chunk");
        if (sawIdat) invalidPng("tRNS must appear before IDAT");
        if (ihdr.colorType === 4 || ihdr.colorType === 6) {
          invalidPng(`tRNS is forbidden for color type ${ihdr.colorType}`);
        }
        if (ihdr.colorType === 3) {
          if (!plte) invalidPng("indexed tRNS must appear after PLTE");
          if (length === 0 || length > plte.entries) {
            invalidPng("indexed tRNS length must not exceed the PLTE entry count");
          }
        } else if (ihdr.colorType === 0 && length !== 2) {
          invalidPng("grayscale tRNS length must be 2 bytes");
        } else if (ihdr.colorType === 2 && length !== 6) {
          invalidPng("truecolor tRNS length must be 6 bytes");
        }
        trns = chunk;
        break;
      }
      case "IDAT": {
        if (!ihdr) invalidPng("IDAT appears before IHDR");
        if (idatSequenceClosed) invalidPng("IDAT chunks must be consecutive");
        if (ihdr.colorType === 3 && !plte) invalidPng("indexed PNG is missing PLTE before IDAT");
        sawIdat = true;
        idats.push(chunk);
        break;
      }
      case "IEND": {
        if (!ihdr) invalidPng("IEND appears before IHDR");
        if (length !== 0) invalidPng("IEND length must be 0 bytes");
        if (sawIend) invalidPng("duplicate IEND chunk");
        sawIend = true;
        if (endOffset !== source.length) invalidPng("data appears after IEND");
        break;
      }
      default:
        break;
    }

    offset = endOffset;
    chunkIndex += 1;
    if (type === "IEND") break;
  }

  if (!ihdr) invalidPng("missing IHDR chunk");
  if (!sawIdat) invalidPng("missing IDAT chunk");
  if (!sawIend) invalidPng("missing IEND chunk");
  if (ihdr.colorType === 3 && !plte) invalidPng("indexed PNG is missing PLTE");

  return { source, ihdr, plte, trns, idats };
}

function repairIndexedPngTransparentPalette(input) {
  const parsed = parseAndValidatePng(input);
  const output = Buffer.from(parsed.source);

  if (parsed.ihdr.colorType !== 3 || !parsed.plte || !parsed.trns) {
    return { data: output, repaired: false, repairedEntries: 0 };
  }

  let repairedEntries = 0;
  for (let paletteIndex = 0; paletteIndex < parsed.trns.length; paletteIndex += 1) {
    const alpha = parsed.source[parsed.trns.dataOffset + paletteIndex];
    if (alpha !== 0) continue;

    const rgbOffset = parsed.plte.dataOffset + paletteIndex * 3;
    if (output[rgbOffset] === 0 && output[rgbOffset + 1] === 0 && output[rgbOffset + 2] === 0) {
      continue;
    }
    output[rgbOffset] = 0;
    output[rgbOffset + 1] = 0;
    output[rgbOffset + 2] = 0;
    repairedEntries += 1;
  }

  if (repairedEntries === 0) {
    return { data: output, repaired: false, repairedEntries: 0 };
  }

  const plteCrc = crc32(
    output.subarray(parsed.plte.typeOffset, parsed.plte.dataOffset + parsed.plte.length)
  );
  output.writeUInt32BE(plteCrc, parsed.plte.crcOffset);

  if (output.length !== parsed.source.length) {
    throw new Error("PNG palette repair changed the file length");
  }
  const verified = parseAndValidatePng(output);
  if (verified.idats.length !== parsed.idats.length) {
    throw new Error("PNG palette repair changed the IDAT chunk count");
  }
  for (let index = 0; index < parsed.idats.length; index += 1) {
    const before = parsed.idats[index];
    const after = verified.idats[index];
    if (
      before.offset !== after.offset ||
      before.length !== after.length ||
      !parsed.source
        .subarray(before.dataOffset, before.dataOffset + before.length)
        .equals(output.subarray(after.dataOffset, after.dataOffset + after.length))
    ) {
      throw new Error("PNG palette repair changed IDAT data");
    }
  }

  return { data: output, repaired: true, repairedEntries };
}

module.exports = {
  crc32,
  repairIndexedPngTransparentPalette
};
