import crypto from "crypto";
import fs from "fs";
import path from "path";

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

function hasFlag(name) {
  return process.argv.includes(name);
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

const machineId = arg("--machineId");
const privateKeyPath = arg("--privateKey");
const outPath = arg("--out") || "license.nfl";
const expiresAt = arg("--expiresAt");
const featuresJson = arg("--features");
const featuresFile = arg("--featuresFile");

if (!machineId || !privateKeyPath) {
  process.stderr.write("Usage: node issue-license.mjs --machineId <hex> --privateKey <pemPath> [--expiresAt 2027-12-31] [--features '{\"export\":true}'] [--out license.nfl]\n");
  process.exit(2);
}

let expMs = null;
if (expiresAt) {
  const d = new Date(expiresAt);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) {
    process.stderr.write("Bad --expiresAt (use e.g. 2027-12-31)\n");
    process.exit(2);
  }
  expMs = ms;
}

let features = undefined;
if (featuresFile) {
  try {
    features = JSON.parse(fs.readFileSync(featuresFile, "utf8"));
  } catch {
    process.stderr.write("Bad --featuresFile JSON\n");
    process.exit(2);
  }
} else if (featuresJson) {
  try {
    features = JSON.parse(featuresJson);
  } catch {
    try {
      features = JSON.parse(String(featuresJson).replaceAll('\\"', '"'));
    } catch {
      process.stderr.write("Bad --features JSON\n");
      process.exit(2);
    }
  }
}

const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
const keyObj = crypto.createPrivateKey(privateKeyPem);

const payload = {
  v: 1,
  product: "NovaFlow",
  machineId: String(machineId).trim(),
  issuedAt: Date.now(),
  ...(expMs != null ? { expiresAt: expMs } : {}),
  ...(features ? { features } : {})
};

const data = Buffer.from(stableStringify(payload), "utf8");
const sig = crypto.sign(null, data, keyObj);

const licenseObj = {
  payload,
  signature: sig.toString("base64")
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(licenseObj, null, 2), "utf8");

if (!hasFlag("--quiet")) process.stdout.write(`${outPath}\n`);
