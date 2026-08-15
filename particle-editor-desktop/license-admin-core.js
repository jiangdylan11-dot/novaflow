const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function ensureParentDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function normalizeFilePath(p) {
  if (typeof p !== "string") throw new Error("invalid path");
  const s = p.trim();
  if (!s) throw new Error("invalid path");
  return s;
}

function stableStringify(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (t === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(null);
}

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function encodeLicenseToken(licenseObj) {
  const raw = Buffer.from(JSON.stringify(licenseObj), "utf8");
  const deflated = zlib.deflateRawSync(raw, { level: 9 });
  return "NF1:" + base64UrlEncode(deflated);
}

function getKeyFingerprintFromPublicB64(publicKeyB64) {
  const buf = Buffer.from(String(publicKeyB64 || "").trim(), "base64");
  const h = crypto.createHash("sha256").update(buf).digest("hex");
  return h.slice(0, 16);
}

function normalizeLicenseKey(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function generateLicenseKey() {
  try {
    return `nf_${crypto.randomUUID().replace(/-/g, "")}`;
  } catch {
    return `nf_${Date.now().toString(36)}_${crypto.randomBytes(8).toString("hex")}`;
  }
}

function readKeyStatus(publicKeyPath, privateKeyPath) {
  const pubPath = normalizeFilePath(publicKeyPath);
  const privPath = normalizeFilePath(privateKeyPath);
  const pubExists = fs.existsSync(pubPath);
  const privExists = fs.existsSync(privPath);
  let pubFingerprint = "";
  let pubPreview = "";
  if (pubExists) {
    try {
      const b64 = fs.readFileSync(pubPath, "utf8").trim();
      pubFingerprint = getKeyFingerprintFromPublicB64(b64);
      pubPreview = b64.slice(0, 18) + (b64.length > 18 ? "..." : "");
    } catch {}
  }
  return { pubExists, privExists, pubFingerprint, pubPreview, publicKeyPath: pubPath, privateKeyPath: privPath };
}

function generateKeyPair(publicKeyPath, privateKeyPath) {
  const pubPath = normalizeFilePath(publicKeyPath);
  const privPath = normalizeFilePath(privateKeyPath);

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubDer = publicKey.export({ format: "der", type: "spki" });
  const pubB64 = Buffer.from(pubDer).toString("base64");
  const privPem = privateKey.export({ format: "pem", type: "pkcs8" });

  ensureParentDir(pubPath);
  ensureParentDir(privPath);
  fs.writeFileSync(pubPath, `${pubB64}\n`, "utf8");
  fs.writeFileSync(privPath, `${String(privPem).trim()}\n`, "utf8");

  return {
    publicKeyPath: pubPath,
    privateKeyPath: privPath,
    pubFingerprint: getKeyFingerprintFromPublicB64(pubB64)
  };
}

function deleteKeyFiles(publicKeyPath, privateKeyPath) {
  const pubPath = normalizeFilePath(publicKeyPath);
  const privPath = normalizeFilePath(privateKeyPath);
  let deletedPublic = false;
  let deletedPrivate = false;
  if (fs.existsSync(pubPath)) {
    fs.unlinkSync(pubPath);
    deletedPublic = true;
  }
  if (fs.existsSync(privPath)) {
    fs.unlinkSync(privPath);
    deletedPrivate = true;
  }
  return { deletedPublic, deletedPrivate, publicKeyPath: pubPath, privateKeyPath: privPath };
}

function issueLicenseFile(params) {
  const machineId = String(params?.machineId || "").trim();
  const privateKeyPath = normalizeFilePath(params?.privateKeyPath);
  const outPath = normalizeFilePath(params?.outPath);
  const expiresAt = String(params?.expiresAt || "").trim();
  const featuresText = String(params?.featuresText || "").trim();
  const licenseKey = normalizeLicenseKey(params?.licenseKey) || generateLicenseKey();

  if (!machineId) throw new Error("machineId 不能为空");
  if (!licenseKey) throw new Error("licenseKey 不能为空");

  let expMs = null;
  if (expiresAt) {
    const d = new Date(expiresAt);
    const ms = d.getTime();
    if (!Number.isFinite(ms)) throw new Error("expiresAt 无效（示例：2027-12-31）");
    expMs = ms;
  }

  let features = undefined;
  if (featuresText) {
    try {
      features = JSON.parse(featuresText);
    } catch {
      throw new Error("features JSON 格式不正确");
    }
  }

  const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
  const keyObj = crypto.createPrivateKey(privateKeyPem);

  const payload = {
    v: 1,
    product: "NovaFlow",
    licenseKey,
    machineId,
    issuedAt: Date.now(),
    ...(expMs != null ? { expiresAt: expMs } : {}),
    ...(features ? { features } : {})
  };

  const data = Buffer.from(stableStringify(payload), "utf8");
  const sig = crypto.sign(null, data, keyObj);

  const licenseObj = { payload, signature: sig.toString("base64") };
  ensureParentDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(licenseObj, null, 2), "utf8");

  return { outPath, licenseObj, licenseCode: encodeLicenseToken(licenseObj) };
}

function verifyLicenseFile(params) {
  const licensePath = normalizeFilePath(params?.licensePath);
  const publicKeyPath = normalizeFilePath(params?.publicKeyPath);
  const machineId = String(params?.machineId || "").trim();

  const lic = JSON.parse(fs.readFileSync(licensePath, "utf8"));
  const pubB64 = fs.readFileSync(publicKeyPath, "utf8").trim();
  const pub = crypto.createPublicKey({ key: Buffer.from(pubB64, "base64"), format: "der", type: "spki" });

  const payload = lic?.payload;
  const sig = Buffer.from(String(lic?.signature || ""), "base64");
  const data = Buffer.from(stableStringify(payload), "utf8");
  const ok = crypto.verify(null, data, pub, sig);
  if (!ok) return { ok: false, code: "INVALID_SIGNATURE" };

  if (payload?.product !== "NovaFlow") return { ok: false, code: "WRONG_PRODUCT" };
  if (machineId && payload?.machineId !== machineId) return { ok: false, code: "MACHINE_MISMATCH" };
  if (payload?.expiresAt != null && Date.now() > Number(payload.expiresAt)) return { ok: false, code: "EXPIRED" };

  return { ok: true, code: "OK", payload };
}

module.exports = {
  readKeyStatus,
  generateKeyPair,
  deleteKeyFiles,
  issueLicenseFile,
  verifyLicenseFile,
  encodeLicenseToken
};
