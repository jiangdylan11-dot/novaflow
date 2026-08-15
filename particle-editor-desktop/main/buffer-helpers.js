function hasPngSignature(buf) {
  return Buffer.isBuffer(buf)
    && buf.length >= 8
    && buf[0] === 0x89
    && buf[1] === 0x50
    && buf[2] === 0x4e
    && buf[3] === 0x47
    && buf[4] === 0x0d
    && buf[5] === 0x0a
    && buf[6] === 0x1a
    && buf[7] === 0x0a;
}

function hasPsdSignature(buf) {
  return Buffer.isBuffer(buf)
    && buf.length >= 4
    && buf[0] === 0x38
    && buf[1] === 0x42
    && buf[2] === 0x50
    && buf[3] === 0x53;
}

function dataUrlToBuffer(dataUrl, options = {}) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  const mime = String(m[1] || "").toLowerCase();
  if (options.mime && mime !== String(options.mime).toLowerCase()) return null;
  if (Array.isArray(options.mimeOneOf) && !options.mimeOneOf.map((x) => String(x).toLowerCase()).includes(mime)) return null;
  const body = String(m[2] || "").replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  const buf = Buffer.from(body, "base64");
  if (!buf.length) return null;
  if (options.requirePng && !hasPngSignature(buf)) return null;
  if (options.requirePsd && !hasPsdSignature(buf)) return null;
  return buf;
}

function safeBufferFromBytes(bytes) {
  try {
    if (!bytes) return null;
    if (Buffer.isBuffer(bytes)) return bytes;
    if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
    if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes && typeof bytes === "object" && bytes.type === "Buffer" && Array.isArray(bytes.data)) return Buffer.from(bytes.data);
    if (Array.isArray(bytes)) return Buffer.from(bytes);
  } catch {
    return null;
  }
  return null;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  hasPngSignature,
  hasPsdSignature,
  dataUrlToBuffer,
  safeBufferFromBytes,
  clampNumber,
  clampManifestNumber: clampNumber
};
