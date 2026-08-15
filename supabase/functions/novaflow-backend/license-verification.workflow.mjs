const LICENSE_KEY_MAX_LENGTH = 200;
const MACHINE_ID_PATTERN = /^[a-f0-9]{64}$/;

function invalidRequest() {
  const error = new Error("invalid license verification request");
  error.statusCode = 400;
  return error;
}

function parseExpiry(value) {
  if (value == null || value === "") return null;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function normalizeLicenseVerificationInput(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalidRequest();
  }

  const licenseKey = typeof payload.licenseKey === "string"
    ? payload.licenseKey.trim()
    : "";
  const machineId = typeof payload.machineId === "string"
    ? payload.machineId.trim().toLowerCase()
    : "";

  if (
    !licenseKey || licenseKey.length > LICENSE_KEY_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(licenseKey)
  ) {
    throw invalidRequest();
  }
  if (!MACHINE_ID_PATTERN.test(machineId)) throw invalidRequest();

  return { licenseKey, machineId };
}

export function validateLicenseVerificationRecord(record, now = Date.now()) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { ok: true, valid: false, reason: "license_rejected" };
  }

  const status = String(record.status || "").trim().toLowerCase();
  const expireAt = String(record.expire_at || "").trim();
  const expireMs = parseExpiry(expireAt);
  if (status !== "active" || !expireMs || now > expireMs) {
    return { ok: true, valid: false, reason: "license_rejected" };
  }

  return {
    ok: true,
    valid: true,
    status: "licensed",
    expireAt,
    permissions: record.permissions ?? null,
  };
}

export function licenseVerificationRejected() {
  return { ok: true, valid: false, reason: "license_rejected" };
}
