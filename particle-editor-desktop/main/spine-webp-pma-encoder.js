const { spawn } = require("node:child_process");

const PMA_QUALITY = 90;
const MAX_PASSES = 4;

function webpChunks(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12
      || bytes.toString("ascii", 0, 4) !== "RIFF"
      || bytes.toString("ascii", 8, 12) !== "WEBP"
      || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error("Invalid WebP container");
  }
  const chunks = new Map();
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error("Truncated WebP chunk");
    const tag = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    const next = end + (size & 1);
    if (next > bytes.length || chunks.has(tag)) throw new Error("Invalid WebP chunk");
    chunks.set(tag, bytes.subarray(offset + 8, end));
    offset = next;
  }
  return chunks;
}

function webpChunk(tag, data) {
  const chunk = Buffer.alloc(8 + data.length + (data.length & 1));
  chunk.write(tag, 0, 4, "ascii");
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

function muxAlpha(colorWebp, alpha, width, height) {
  // FFmpeg's non-seekable muxer may append the size fixup instead of patching
  // the flushed header. Normalize only that internal form, then check all chunks.
  if (colorWebp.length >= 12 && colorWebp.toString("ascii", 0, 4) === "RIFF"
      && colorWebp.toString("ascii", 8, 12) === "WEBP" && colorWebp.readUInt32LE(4) === 0) {
    const trailingSize = colorWebp.readUInt32LE(colorWebp.length - 4);
    const end = trailingSize + 12 === colorWebp.length ? colorWebp.length - 4 : colorWebp.length;
    colorWebp = Buffer.from(colorWebp.subarray(0, end));
    colorWebp.writeUInt32LE(colorWebp.length - 8, 4);
  }
  const color = webpChunks(colorWebp).get("VP8 ");
  if (!color) throw new Error("Missing VP8 color data");
  if (!alpha) return colorWebp;
  const flags = Buffer.alloc(10);
  flags[0] = 0x10;
  flags.writeUIntLE(width - 1, 4, 3);
  flags.writeUIntLE(height - 1, 7, 3);
  const body = Buffer.concat([
    Buffer.from("WEBP"), webpChunk("VP8X", flags),
    webpChunk("ALPH", alpha), webpChunk("VP8 ", color)
  ]);
  const header = Buffer.alloc(8);
  header.write("RIFF");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function runFfmpeg(args, input, maxOutputBytes) {
  return new Promise((resolve, reject) => {
    const executable = require("ffmpeg-static");
    if (!executable) { reject(new Error("FFmpeg unavailable")); return; }
    const child = spawn(executable, ["-hide_banner", "-loglevel", "error", ...args], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
    });
    const chunks = [];
    let size = 0;
    let stderr = "";
    let failure;
    const stop = (error) => { failure ||= error; child.kill(); };
    const timer = setTimeout(() => stop(new Error("PMA encoder timed out")), 120000);
    child.on("error", (error) => { failure ||= error; });
    child.stdin.on("error", (error) => { failure ||= error; });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(0, 8192); });
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxOutputBytes) stop(new Error("PMA encoder output limit exceeded"));
      else if (!failure) chunks.push(chunk);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure || code !== 0) reject(failure || new Error(`PMA encoder: ${stderr.trim().slice(0, 300) || code}`));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}

async function encodePmaCompatibleWebp(input, sharp, { run = runFfmpeg, quality = PMA_QUALITY, codecPreset = null } = {}) {
  if (codecPreset !== null && codecPreset !== "drawing") throw new Error("Invalid PMA codec preset");
  quality = Number.isFinite(quality) ? Math.max(1, Math.min(100, Math.round(quality))) : PMA_QUALITY;
  const compactGuard = codecPreset === "drawing" && quality <= 80;
  const maxPasses = compactGuard ? 12 : MAX_PASSES;
  const { data: original, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (width > 16383 || height > 16383) throw new Error("Image exceeds WebP dimensions");
  const count = width * height;
  let hasAlpha = false;
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4;
    const alpha = original[offset + 3];
    hasAlpha ||= alpha !== 255;
    // Additive/hidden colors must not be erased by the transparent-pixel guard.
    if (Math.max(original[offset], original[offset + 1], original[offset + 2]) > alpha) {
      throw new Error("原图含超出 Alpha 的颜色，需要无损保留");
    }
  }
  const raw = { width, height, channels: 4 };
  let alpha;
  if (hasAlpha) {
    const carrier = Buffer.alloc(original.length);
    for (let i = 3; i < carrier.length; i += 4) carrier[i] = original[i];
    const alphaWebp = await sharp(carrier, { raw })
      .webp({ quality: 75, alphaQuality: 100, effort: 6 }).toBuffer();
    alpha = webpChunks(alphaWebp).get("ALPH");
    if (!alpha) throw new Error("Missing lossless alpha data");
  }

  // Keep stored PMA RGB. Encoding color separately avoids alpha-aware RGB cleanup.
  const opaque = await sharp(original, { raw }).removeAlpha()
    .webp({ quality: 100, effort: 6, smartSubsample: true }).toBuffer();
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  const chromaCount = cw * ch;
  const yuvSize = count + 2 * chromaCount;
  const yuv = await run([
    "-f", "webp_pipe", "-i", "pipe:0", "-frames:v", "1",
    "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"
  ], opaque, yuvSize);
  if (yuv.length !== yuvSize) throw new Error("Invalid YUV frame size");
  // Sub-black luma gives fully transparent pixels headroom against VP8 ringing.
  // Alpha and the luma of every visible pixel remain untouched here.
  for (let i = 0; i < count; i++) if (original[i * 4 + 3] === 0) yuv[i] = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    const color = await run([
      "-f", "rawvideo", "-pixel_format", "yuv420p", "-video_size", `${width}x${height}`,
      "-i", "pipe:0", "-frames:v", "1", "-c:v", "libwebp",
      ...(codecPreset ? ["-preset", codecPreset] : []),
      "-quality", String(quality), "-compression_level", "6", "-f", "webp", "pipe:1"
    ], yuv, original.length + 1048576);
    const data = muxAlpha(color, alpha, width, height);
    const decoded = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== width || decoded.info.height !== height || decoded.data.length !== original.length) {
      throw new Error("PMA output dimensions changed");
    }
    const cells = new Uint8Array(chromaCount);
    let spills = 0;
    for (let i = 0; i < count; i++) {
      const offset = i * 4;
      if (original[offset + 3] !== decoded.data[offset + 3]) throw new Error("PMA Alpha 校验失败");
      if (original[offset + 3] !== 0 || !Math.max(decoded.data[offset], decoded.data[offset + 1], decoded.data[offset + 2])) continue;
      spills++;
      const x = Math.floor((i % width) / 2);
      const y = Math.floor(Math.floor(i / width) / 2);
      const radius = compactGuard ? Math.min(4, pass + 1) : 1;
      for (let yy = Math.max(0, y - radius); yy <= Math.min(ch - 1, y + radius); yy++) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(cw - 1, x + radius); xx++) cells[yy * cw + xx] = 1;
      }
    }
    if (!spills) return { data, info, quality, passes: pass + 1 };
    // Only desaturate chroma cells responsible for RGB leaking into alpha=0.
    for (let cell = 0; cell < chromaCount; cell++) if (cells[cell]) {
      if (compactGuard) {
        // Low-Q ringing also needs luma headroom in nearby near-black pixels.
        // Bound this lossy adjustment to flagged cells and RGB <= 16, never alpha.
        const bx = (cell % cw) * 2;
        const by = Math.floor(cell / cw) * 2;
        const blackLimit = Math.min(16, (pass + 1) * 2);
        for (let y = by; y < Math.min(by + 2, height); y++) {
          for (let x = bx; x < Math.min(bx + 2, width); x++) {
            const pixel = y * width + x;
            const offset = pixel * 4;
            if (Math.max(original[offset], original[offset + 1], original[offset + 2]) <= blackLimit) yuv[pixel] = 0;
          }
        }
      }
      for (const offset of [count, count + chromaCount]) {
        yuv[offset + cell] = Math.round(128 + (yuv[offset + cell] - 128) * 0.35);
      }
    }
  }
  const error = new Error("透明区域颜色校验未通过");
  error.code = "PMA_TRANSPARENT_RGB";
  throw error;
}

module.exports = { encodePmaCompatibleWebp, webpChunks };
