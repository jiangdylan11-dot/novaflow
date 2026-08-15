import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LICENSE_CACHE_FILE_NAME, LICENSE_LOG_FILE_NAME } from "./config";

export type LicenseLogLevel = "info" | "warn" | "error";

export interface LicenseCachePayload {
  v: 1;
  license_key: string;
  machine_id: string;
  status: "active";
  last_verify_time: number;
  remote_expire_at: string;
  verify_token: string;
  permissions: unknown;
}

interface EncryptedCacheEnvelope {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  data: string;
}

const CACHE_KDF_SALT = "NovaFlow.onlineLicense.cache.scrypt.v1";
const CACHE_TOKEN_LABEL = "NovaFlow.onlineLicense.cacheToken.v1";

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

export function getLicenseCachePath(userDataDir: string): string {
  return path.join(userDataDir, LICENSE_CACHE_FILE_NAME);
}

export function getLicenseLogPath(userDataDir: string): string {
  return path.join(userDataDir, "logs", LICENSE_LOG_FILE_NAME);
}

export async function appendLicenseLog(
  userDataDir: string,
  level: LicenseLogLevel,
  event: string,
  meta?: unknown
): Promise<void> {
  const line = `[${new Date().toISOString()}] [${level}] ${String(event || "license")}${
    meta ? ` ${safeJson(meta)}` : ""
  }\n`;
  try {
    const filePath = getLicenseLogPath(userDataDir);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.appendFile(filePath, line, "utf8");
  } catch {
    void 0;
  }
}

function deriveCacheKey(machineId: string): Buffer {
  return crypto.scryptSync(String(machineId || "unknown-machine"), CACHE_KDF_SALT, 32);
}

function computeVerifyToken(payload: Omit<LicenseCachePayload, "verify_token">, machineId: string): string {
  const h = crypto.createHmac("sha256", deriveCacheKey(machineId));
  h.update(CACHE_TOKEN_LABEL);
  h.update("|");
  h.update(String(payload.license_key || ""));
  h.update("|");
  h.update(String(payload.machine_id || ""));
  h.update("|");
  h.update(String(payload.status || ""));
  h.update("|");
  h.update(String(payload.last_verify_time || 0));
  h.update("|");
  h.update(String(payload.remote_expire_at || ""));
  return h.digest("hex");
}

function encryptCache(machineId: string, payload: LicenseCachePayload): EncryptedCacheEnvelope {
  const key = deriveCacheKey(machineId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64")
  };
}

function decryptCache(machineId: string, envelope: EncryptedCacheEnvelope): LicenseCachePayload {
  if (!envelope || envelope.v !== 1 || envelope.alg !== "aes-256-gcm") {
    throw new Error("bad_cache_envelope");
  }
  const key = deriveCacheKey(machineId);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final()
  ]);
  const payload = JSON.parse(decrypted.toString("utf8")) as LicenseCachePayload;
  const { verify_token: _token, ...tokenPayload } = payload;
  const expected = computeVerifyToken(tokenPayload, machineId);
  if (!payload.verify_token || payload.verify_token !== expected) {
    throw new Error("bad_cache_token");
  }
  return payload;
}

export async function writeLicenseCache(
  userDataDir: string,
  input: Omit<LicenseCachePayload, "v" | "status" | "verify_token">
): Promise<LicenseCachePayload> {
  const tokenPayload: Omit<LicenseCachePayload, "verify_token"> = {
    v: 1,
    status: "active",
    license_key: String(input.license_key || ""),
    machine_id: String(input.machine_id || ""),
    last_verify_time: Number(input.last_verify_time || Date.now()),
    remote_expire_at: String(input.remote_expire_at || ""),
    permissions: input.permissions ?? null
  };
  const payload: LicenseCachePayload = {
    ...tokenPayload,
    verify_token: computeVerifyToken(tokenPayload, tokenPayload.machine_id)
  };
  const filePath = getLicenseCachePath(userDataDir);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(encryptCache(payload.machine_id, payload), null, 2), "utf8");
  await appendLicenseLog(userDataDir, "info", "cache_write", {
    license_key: payload.license_key,
    machine_id: payload.machine_id,
    last_verify_time: payload.last_verify_time,
    remote_expire_at: payload.remote_expire_at
  });
  return payload;
}

export async function readLicenseCache(
  userDataDir: string,
  machineId: string
): Promise<{ ok: true; cache: LicenseCachePayload } | { ok: false; error: string }> {
  const filePath = getLicenseCachePath(userDataDir);
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const envelope = JSON.parse(raw) as EncryptedCacheEnvelope;
    const cache = decryptCache(machineId, envelope);
    await appendLicenseLog(userDataDir, "info", "cache_read", {
      license_key: cache.license_key,
      machine_id: cache.machine_id,
      last_verify_time: cache.last_verify_time
    });
    return { ok: true, cache };
  } catch (err: any) {
    const error = err?.code === "ENOENT" ? "cache_missing" : String(err?.message || err);
    await appendLicenseLog(userDataDir, "warn", "cache_read_failed", { error });
    return { ok: false, error };
  }
}

export async function clearLicenseCache(userDataDir: string, reason: string): Promise<void> {
  const filePath = getLicenseCachePath(userDataDir);
  try {
    await fs.promises.unlink(filePath);
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      await appendLicenseLog(userDataDir, "warn", "cache_clear_failed", {
        reason,
        error: String(err?.message || err)
      });
      return;
    }
  }
  await appendLicenseLog(userDataDir, "info", "cache_cleared", { reason });
}
