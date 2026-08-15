const path = require("path");

function sanitizeFileName(name) {
  if (typeof name !== "string") return "";
  const base = path.basename(name);
  const cleaned = base
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned.length ? cleaned.slice(0, 120) : "";
}

function sanitizeFileStem(name, fallback) {
  const cleaned = sanitizeFileName(name).replace(/\.[^/.]+$/g, "");
  return cleaned.length ? cleaned : fallback;
}

function ensurePngFileName(name, fallbackStem) {
  const stem = sanitizeFileStem(name, fallbackStem);
  return `${stem || fallbackStem || "part"}.png`;
}

function isPathInside(childPath, parentPath) {
  try {
    const rel = path.relative(parentPath, childPath);
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

function guessMimeFromPath(p) {
  const low = String(p || "").toLowerCase();
  if (low.endsWith(".mp4")) return "video/mp4";
  if (low.endsWith(".webm")) return "video/webm";
  if (low.endsWith(".mov")) return "video/quicktime";
  if (low.endsWith(".mkv")) return "video/x-matroska";
  return "application/octet-stream";
}

module.exports = {
  sanitizeFileName,
  sanitizeFileStem,
  ensurePngFileName,
  isPathInside,
  guessMimeFromPath
};
