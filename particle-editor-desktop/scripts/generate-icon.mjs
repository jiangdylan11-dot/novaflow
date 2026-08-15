import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const editorAssetsDir = path.resolve(__dirname, '..', '..', 'particle-editor', 'assets');
const iconPngPath = path.join(editorAssetsDir, 'icon.png');
const icoDir = path.join(editorAssetsDir, 'ico');
const icoPath = path.join(editorAssetsDir, 'favicon.ico');
const outDir = path.resolve(__dirname, '..', 'build');
const outIcoPath = path.join(outDir, 'icon.ico');
const outPngPath = path.join(outDir, 'icon.png');

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readIcoEntries(buf) {
  if (buf.length < 6) throw new Error('invalid ico file');
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) {
    throw new Error('invalid ico header');
  }

  const count = buf.readUInt16LE(4);
  if (count <= 0) throw new Error('ico has no image entries');

  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const entryOffset = 6 + i * 16;
    if (entryOffset + 16 > buf.length) throw new Error('invalid ico directory');
    const width = buf.readUInt8(entryOffset) || 256;
    const height = buf.readUInt8(entryOffset + 1) || 256;
    const colors = buf.readUInt8(entryOffset + 2);
    const planes = buf.readUInt16LE(entryOffset + 4);
    const bitCount = buf.readUInt16LE(entryOffset + 6);
    const bytes = buf.readUInt32LE(entryOffset + 8);
    const offset = buf.readUInt32LE(entryOffset + 12);
    if (offset <= 0 || bytes <= 0 || offset + bytes > buf.length) {
      throw new Error('invalid ico image entry');
    }
    entries.push({ width, height, colors, planes, bitCount, bytes, offset });
  }

  return entries;
}

function writeIco(entries) {
  if (entries.length <= 0) throw new Error('ico has no image entries');

  const headerBytes = 6 + entries.length * 16;
  const totalBytes = headerBytes + entries.reduce((sum, entry) => sum + entry.image.length, 0);
  const buf = Buffer.alloc(totalBytes);
  let cursor = 0;
  buf.writeUInt16LE(0, cursor);
  cursor += 2;
  buf.writeUInt16LE(1, cursor);
  cursor += 2;
  buf.writeUInt16LE(entries.length, cursor);
  cursor += 2;

  let imageOffset = headerBytes;
  for (const entry of entries) {
    buf.writeUInt8(entry.width === 256 ? 0 : entry.width, cursor);
    cursor += 1;
    buf.writeUInt8(entry.height === 256 ? 0 : entry.height, cursor);
    cursor += 1;
    buf.writeUInt8(entry.colors || 0, cursor);
    cursor += 1;
    buf.writeUInt8(0, cursor);
    cursor += 1;
    buf.writeUInt16LE(entry.planes || 1, cursor);
    cursor += 2;
    buf.writeUInt16LE(entry.bitCount || 32, cursor);
    cursor += 2;
    buf.writeUInt32LE(entry.image.length, cursor);
    cursor += 4;
    buf.writeUInt32LE(imageOffset, cursor);
    cursor += 4;
    entry.image.copy(buf, imageOffset);
    imageOffset += entry.image.length;
  }

  return buf;
}

async function buildIcoFromSourceDir() {
  if (!fs.existsSync(icoDir)) return null;

  const sourceFiles = fs
    .readdirSync(icoDir)
    .filter((name) => name.toLowerCase().endsWith('.ico'))
    .map((name) => path.join(icoDir, name));
  if (sourceFiles.length <= 0) return null;

  const bySize = new Map();
  for (const sourceFile of sourceFiles) {
    const buf = fs.readFileSync(sourceFile);
    for (const entry of readIcoEntries(buf)) {
      const image = Buffer.from(buf.subarray(entry.offset, entry.offset + entry.bytes));
      bySize.set(`${entry.width}x${entry.height}`, {
        ...entry,
        image,
        sourceFile,
      });
    }
  }

  if (!bySize.has('256x256')) {
    const largest = [...bySize.values()].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!largest) throw new Error('ico source folder has no readable image entries');
    bySize.set('256x256', {
      width: 256,
      height: 256,
      colors: 0,
      planes: 1,
      bitCount: 32,
      image: await sharp(largest.image)
        .resize(256, 256, { fit: 'fill', kernel: 'lanczos3' })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer(),
      sourceFile: largest.sourceFile,
      generated: true,
    });
  }

  const entries = [...bySize.values()].sort((a, b) => b.width * b.height - a.width * a.height);
  return {
    source: icoDir,
    buf: writeIco(entries),
    entries,
  };
}

async function buildIcoFromPngSource() {
  if (!fs.existsSync(iconPngPath)) return null;

  const sizes = [256, 128, 96, 64, 48, 32, 16];
  const entries = [];
  for (const size of sizes) {
    const image = await sharp(iconPngPath)
      .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    entries.push({
      width: size,
      height: size,
      colors: 0,
      planes: 1,
      bitCount: 32,
      image,
      sourceFile: iconPngPath,
    });
  }

  return {
    source: iconPngPath,
    buf: writeIco(entries),
    entries,
  };
}

async function iconEntryToPng(buf, entry) {
  const image = buf.subarray(entry.offset, entry.offset + entry.bytes);
  if (image.subarray(0, pngSignature.length).equals(pngSignature)) {
    return image;
  }

  if (image.length < 40) throw new Error('unsupported ico bitmap payload');
  const headerSize = image.readUInt32LE(0);
  const width = image.readInt32LE(4);
  const dibHeight = image.readInt32LE(8);
  const planes = image.readUInt16LE(12);
  const bitCount = image.readUInt16LE(14);
  const compression = image.readUInt32LE(16);

  if (headerSize < 40 || width <= 0 || dibHeight === 0 || planes !== 1 || bitCount !== 32 || compression !== 0) {
    throw new Error('unsupported ico bitmap format');
  }

  const height = Math.abs(dibHeight) >= entry.height * 2 ? Math.abs(dibHeight) / 2 : Math.abs(dibHeight);
  const pixelOffset = headerSize;
  const pixelBytes = width * height * 4;
  if (pixelOffset + pixelBytes > image.length) throw new Error('invalid ico bitmap pixels');

  const rgba = Buffer.alloc(pixelBytes);
  const bottomUp = dibHeight > 0;
  for (let y = 0; y < height; y += 1) {
    const sourceY = bottomUp ? height - 1 - y : y;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = pixelOffset + (sourceY * width + x) * 4;
      const targetOffset = (y * width + x) * 4;
      rgba[targetOffset] = image[sourceOffset + 2];
      rgba[targetOffset + 1] = image[sourceOffset + 1];
      rgba[targetOffset + 2] = image[sourceOffset];
      rgba[targetOffset + 3] = image[sourceOffset + 3];
    }
  }

  return sharp(rgba, {
    raw: {
      width,
      height,
      channels: 4,
    },
  }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

const generatedIco = (await buildIcoFromPngSource()) || (await buildIcoFromSourceDir());
let icoSource = generatedIco?.source || icoPath;
let icoBuf = generatedIco?.buf;

if (!icoBuf) {
  if (!fs.existsSync(icoPath)) {
    console.error(`icon not found: ${icoPath}`);
    process.exit(1);
  }
  icoBuf = fs.readFileSync(icoPath);
}

const icoEntries = readIcoEntries(icoBuf);
const pngEntry = [...icoEntries].sort((a, b) => b.width * b.height - a.width * a.height)[0];
const pngBuf = await iconEntryToPng(icoBuf, pngEntry);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(icoPath, icoBuf);
fs.writeFileSync(outIcoPath, icoBuf);
fs.writeFileSync(outPngPath, pngBuf);
console.log(`icon source: ${icoSource}`);
console.log(`favicon synced: ${icoPath}`);
console.log(`icon sizes: ${icoEntries.map((entry) => `${entry.width}x${entry.height}`).join(', ')}`);
console.log(`icon generated: ${outIcoPath}`);
console.log(`icon copied: ${outPngPath}`);
