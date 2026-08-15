import crypto from "crypto";
import fs from "fs";

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
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

const licensePath = arg("--license");
const publicKeyB64Path = arg("--publicKeyB64");
const machineId = arg("--machineId");

if (!licensePath || !publicKeyB64Path || !machineId) {
  process.stderr.write("Usage: node verify-license.mjs --license <license.nfl> --publicKeyB64 <license-public-key.b64> --machineId <hex>\n");
  process.exit(2);
}

const lic = JSON.parse(fs.readFileSync(licensePath, "utf8"));
const pubB64 = fs.readFileSync(publicKeyB64Path, "utf8").trim();
const pub = crypto.createPublicKey({ key: Buffer.from(pubB64, "base64"), format: "der", type: "spki" });

const payload = lic?.payload;
const sig = Buffer.from(String(lic?.signature || ""), "base64");
const data = Buffer.from(stableStringify(payload), "utf8");

const ok = crypto.verify(null, data, pub, sig);
if (!ok) {
  process.stderr.write("INVALID_SIGNATURE\n");
  process.exit(1);
}

if (payload?.product !== "NovaFlow") {
  process.stderr.write("WRONG_PRODUCT\n");
  process.exit(1);
}
if (payload?.machineId !== machineId) {
  process.stderr.write("MACHINE_MISMATCH\n");
  process.exit(1);
}
if (payload?.expiresAt != null && Date.now() > Number(payload.expiresAt)) {
  process.stderr.write("EXPIRED\n");
  process.exit(1);
}

process.stdout.write("OK\n");

