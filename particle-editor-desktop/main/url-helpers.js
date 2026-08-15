function isHttpUrl(urlString) {
  try {
    const u = new URL(urlString);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeRuntimeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!isHttpUrl(raw)) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.origin;
  } catch {
    return "";
  }
}

function isAllowedAppUrl(urlString, allowedOrigins) {
  try {
    const u = new URL(urlString);
    if (u.protocol === "file:") return true;
    if (allowedOrigins?.has?.(u.origin)) return true;
    return false;
  } catch {
    return false;
  }
}

module.exports = {
  isHttpUrl,
  sanitizeRuntimeBaseUrl,
  isAllowedAppUrl
};
