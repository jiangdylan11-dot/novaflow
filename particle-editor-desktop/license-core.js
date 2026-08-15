const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const zlib = require("zlib");

const PRODUCT = "NovaFlow";
const LICENSE_FILE_NAME = "license.nfl";
const USERDATA_ENC_PREFIX = "NFENC1";
const KDF_SALT = "NovaFlow.userdata.scrypt.salt.v1";
const LICENSE_TOKEN_PREFIX = "NF1:";

let _machineIdPromise = null;

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

function runPowerShell(script) {
  return new Promise((resolve) => {
    const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script];
    execFile("powershell.exe", args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({ ok: false, out: "" });
      return resolve({ ok: true, out: String(stdout || "").trim() });
    });
  });
}

async function getWindowsMachineFacts() {
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$uuid = (Get-CimInstance -ClassName Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID)
$bios = (Get-CimInstance -ClassName Win32_BIOS | Select-Object -ExpandProperty SerialNumber)
$board = (Get-CimInstance -ClassName Win32_BaseBoard | Select-Object -ExpandProperty SerialNumber)
$macs = (Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.MacAddress } | Select-Object -ExpandProperty MacAddress)
[pscustomobject]@{ uuid=$uuid; bios=$bios; board=$board; macs=$macs } | ConvertTo-Json -Compress
`;
  const res = await runPowerShell(ps);
  if (!res.ok || !res.out) return null;
  try {
    const o = JSON.parse(res.out);
    return {
      uuid: String(o?.uuid || "").trim(),
      bios: String(o?.bios || "").trim(),
      board: String(o?.board || "").trim(),
      macs: Array.isArray(o?.macs) ? o.macs.map((m) => String(m || "").trim()).filter(Boolean) : []
    };
  } catch {
    return null;
  }
}

async function computeMachineId() {
  const plat = process.platform;
  const base = {
    platform: plat,
    hostname: os.hostname(),
    arch: process.arch,
    release: os.release()
  };

  if (plat === "win32") {
    const facts = await getWindowsMachineFacts();
    if (facts) base.win = facts;
  }

  const h = crypto.createHash("sha256");
  h.update("NovaFlow.machineId.v1|");
  h.update(stableStringify(base));
  return h.digest("hex");
}

function getMachineId() {
  if (!_machineIdPromise) _machineIdPromise = computeMachineId();
  return _machineIdPromise;
}

function getLicensePath(userDataDir) {
  return path.join(userDataDir, LICENSE_FILE_NAME);
}

function readPublicKeyBase64() {
  try {
    const p = path.join(__dirname, "license-public-key.b64");
    if (fs.existsSync(p)) {
      const b64 = fs.readFileSync(p, "utf8").trim();
      if (b64) return b64;
    }
  } catch {}
  return "";
}

function getPublicKey() {
  const b64 = readPublicKeyBase64();
  if (!b64) return null;
  try {
    const der = Buffer.from(b64, "base64");
    return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    return null;
  }
}

function verifyLicenseObject(licenseObj, machineId) {
  const pub = getPublicKey();
  if (!pub) return { ok: false, code: "no_public_key" };

  const payload = licenseObj?.payload;
  const sigB64 = licenseObj?.signature;
  if (!payload || typeof sigB64 !== "string") return { ok: false, code: "bad_format" };
  if (payload?.product !== PRODUCT) return { ok: false, code: "wrong_product" };
  if (typeof payload?.machineId !== "string" || payload.machineId !== machineId) return { ok: false, code: "machine_mismatch" };

  const now = Date.now();
  if (payload?.expiresAt != null) {
    const exp = Number(payload.expiresAt);
    if (!Number.isFinite(exp)) return { ok: false, code: "bad_expiry" };
    if (now > exp) return { ok: false, code: "expired" };
  }

  const data = Buffer.from(stableStringify(payload), "utf8");
  const sig = Buffer.from(sigB64, "base64");
  const ok = crypto.verify(null, data, pub, sig);
  if (!ok) return { ok: false, code: "bad_signature" };
  return { ok: true, payload };
}

function loadLicenseFromDisk(userDataDir) {
  const p = getLicensePath(userDataDir);
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadLicenseFromDiskAsync(userDataDir) {
  const p = getLicensePath(userDataDir);
  try {
    const raw = await fs.promises.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLicenseToDisk(userDataDir, licenseObj) {
  const p = getLicensePath(userDataDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(licenseObj, null, 2), "utf8");
}

async function saveLicenseToDiskAsync(userDataDir, licenseObj) {
  const p = getLicensePath(userDataDir);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, JSON.stringify(licenseObj, null, 2), "utf8");
}

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecodeToBuffer(s) {
  const input = String(s || "").trim().replaceAll("-", "+").replaceAll("_", "/");
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input + pad, "base64");
}

function encodeLicenseToken(licenseObj) {
  const raw = Buffer.from(JSON.stringify(licenseObj), "utf8");
  const deflated = zlib.deflateRawSync(raw, { level: 9 });
  return LICENSE_TOKEN_PREFIX + base64UrlEncode(deflated);
}

function decodeLicenseTokenToObject(token) {
  const t = String(token || "").trim().replace(/\s+/g, "");
  if (!t.startsWith(LICENSE_TOKEN_PREFIX)) throw new Error("not a license token");
  const b64u = t.slice(LICENSE_TOKEN_PREFIX.length);
  const compressed = base64UrlDecodeToBuffer(b64u);
  const raw = zlib.inflateRawSync(compressed);
  return JSON.parse(raw.toString("utf8"));
}

function parseLicenseInput(text) {
  const s = String(text || "").trim();
  if (!s) throw new Error("empty license input");
  try {
    return JSON.parse(s);
  } catch {}
  const cleaned = s
    .replace(/^"+|"+$/g, "")
    .replace(/[，,]/g, "")
    .replace(/\s+/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (cleaned.startsWith(LICENSE_TOKEN_PREFIX)) {
    const body = cleaned.slice(LICENSE_TOKEN_PREFIX.length).replace(/[^A-Za-z0-9\-_]/g, "");
    return decodeLicenseTokenToObject(LICENSE_TOKEN_PREFIX + body);
  }
  return decodeLicenseTokenToObject(cleaned);
}

function deriveUserDataKey(machineId) {
  return crypto.scryptSync(machineId, KDF_SALT, 32);
}

function encryptUtf8ToStorage(machineId, textUtf8) {
  const key = deriveUserDataKey(machineId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(textUtf8), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${USERDATA_ENC_PREFIX}:${Buffer.concat([iv, tag, enc]).toString("base64")}`;
}

function decryptStorageToUtf8(machineId, stored) {
  if (typeof stored !== "string") throw new Error("bad storage format");
  if (!stored.startsWith(`${USERDATA_ENC_PREFIX}:`)) throw new Error("not encrypted");
  const b64 = stored.slice(USERDATA_ENC_PREFIX.length + 1);
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 12 + 16 + 1) throw new Error("bad storage format");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const key = deriveUserDataKey(machineId);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(enc), decipher.final()]);
  return out.toString("utf8");
}

async function getLicenseState(userDataDir) {
  const machineId = await getMachineId();
  const lic = await loadLicenseFromDiskAsync(userDataDir);
  if (!lic) return { status: "unlicensed", machineId };
  const v = verifyLicenseObject(lic, machineId);
  if (!v.ok) {
    return { status: v.code === "expired" ? "expired" : "invalid", machineId, error: v.code };
  }
  return { status: "licensed", machineId, payload: v.payload };
}

async function assertEntitled(userDataDir, feature) {
  const st = await getLicenseState(userDataDir);
  if (st.status === "licensed") {
    const feats = st?.payload?.features;
    if (feature && feats && typeof feats === "object") {
      if (feats[feature] === false) throw new Error("未授权：当前许可不包含该功能");
    }
    return true;
  }
  throw new Error("未授权：请导入授权文件");
}

module.exports = {
  PRODUCT,
  getMachineId,
  getLicenseState,
  loadLicenseFromDisk,
  loadLicenseFromDiskAsync,
  saveLicenseToDisk,
  saveLicenseToDiskAsync,
  encodeLicenseToken,
  decodeLicenseTokenToObject,
  parseLicenseInput,
  verifyLicenseObject,
  encryptUtf8ToStorage,
  decryptStorageToUtf8,
  assertEntitled
};
