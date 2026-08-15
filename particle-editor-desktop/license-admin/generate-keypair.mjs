import crypto from "crypto";
import fs from "fs";
import path from "path";

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

const publicOut = arg("--publicOut");
const privateOut = arg("--privateOut");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pubDer = publicKey.export({ format: "der", type: "spki" });
const pubB64 = Buffer.from(pubDer).toString("base64");
const privPem = privateKey.export({ format: "pem", type: "pkcs8" });

if (publicOut) {
  fs.mkdirSync(path.dirname(publicOut), { recursive: true });
  fs.writeFileSync(publicOut, `${pubB64}\n`, "utf8");
}
if (privateOut) {
  fs.mkdirSync(path.dirname(privateOut), { recursive: true });
  fs.writeFileSync(privateOut, `${String(privPem).trim()}\n`, "utf8");
}

process.stdout.write(
  stableStringify({
    publicKeySpkiDerBase64: pubB64,
    privateKeyPkcs8Pem: String(privPem).trim()
  }) + "\n"
);

