"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLicenseCachePath = getLicenseCachePath;
exports.getLicenseLogPath = getLicenseLogPath;
exports.appendLicenseLog = appendLicenseLog;
exports.writeLicenseCache = writeLicenseCache;
exports.readLicenseCache = readLicenseCache;
exports.clearLicenseCache = clearLicenseCache;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const CACHE_KDF_SALT = "NovaFlow.onlineLicense.cache.scrypt.v1";
const CACHE_TOKEN_LABEL = "NovaFlow.onlineLicense.cacheToken.v1";
function safeJson(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return "{}";
    }
}
function getLicenseCachePath(userDataDir) {
    return node_path_1.default.join(userDataDir, config_1.LICENSE_CACHE_FILE_NAME);
}
function getLicenseLogPath(userDataDir) {
    return node_path_1.default.join(userDataDir, "logs", config_1.LICENSE_LOG_FILE_NAME);
}
async function appendLicenseLog(userDataDir, level, event, meta) {
    const line = `[${new Date().toISOString()}] [${level}] ${String(event || "license")}${meta ? ` ${safeJson(meta)}` : ""}\n`;
    try {
        const filePath = getLicenseLogPath(userDataDir);
        await node_fs_1.default.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        await node_fs_1.default.promises.appendFile(filePath, line, "utf8");
    }
    catch {
        void 0;
    }
}
function deriveCacheKey(machineId) {
    return node_crypto_1.default.scryptSync(String(machineId || "unknown-machine"), CACHE_KDF_SALT, 32);
}
function computeVerifyToken(payload, machineId) {
    const h = node_crypto_1.default.createHmac("sha256", deriveCacheKey(machineId));
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
function encryptCache(machineId, payload) {
    const key = deriveCacheKey(machineId);
    const iv = node_crypto_1.default.randomBytes(12);
    const cipher = node_crypto_1.default.createCipheriv("aes-256-gcm", key, iv);
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
function decryptCache(machineId, envelope) {
    if (!envelope || envelope.v !== 1 || envelope.alg !== "aes-256-gcm") {
        throw new Error("bad_cache_envelope");
    }
    const key = deriveCacheKey(machineId);
    const decipher = node_crypto_1.default.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final()
    ]);
    const payload = JSON.parse(decrypted.toString("utf8"));
    const { verify_token: _token, ...tokenPayload } = payload;
    const expected = computeVerifyToken(tokenPayload, machineId);
    if (!payload.verify_token || payload.verify_token !== expected) {
        throw new Error("bad_cache_token");
    }
    return payload;
}
async function writeLicenseCache(userDataDir, input) {
    const tokenPayload = {
        v: 1,
        status: "active",
        license_key: String(input.license_key || ""),
        machine_id: String(input.machine_id || ""),
        last_verify_time: Number(input.last_verify_time || Date.now()),
        remote_expire_at: String(input.remote_expire_at || ""),
        permissions: input.permissions ?? null
    };
    const payload = {
        ...tokenPayload,
        verify_token: computeVerifyToken(tokenPayload, tokenPayload.machine_id)
    };
    const filePath = getLicenseCachePath(userDataDir);
    await node_fs_1.default.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await node_fs_1.default.promises.writeFile(filePath, JSON.stringify(encryptCache(payload.machine_id, payload), null, 2), "utf8");
    await appendLicenseLog(userDataDir, "info", "cache_write", {
        license_key: payload.license_key,
        machine_id: payload.machine_id,
        last_verify_time: payload.last_verify_time,
        remote_expire_at: payload.remote_expire_at
    });
    return payload;
}
async function readLicenseCache(userDataDir, machineId) {
    const filePath = getLicenseCachePath(userDataDir);
    try {
        const raw = await node_fs_1.default.promises.readFile(filePath, "utf8");
        const envelope = JSON.parse(raw);
        const cache = decryptCache(machineId, envelope);
        await appendLicenseLog(userDataDir, "info", "cache_read", {
            license_key: cache.license_key,
            machine_id: cache.machine_id,
            last_verify_time: cache.last_verify_time
        });
        return { ok: true, cache };
    }
    catch (err) {
        const error = err?.code === "ENOENT" ? "cache_missing" : String(err?.message || err);
        await appendLicenseLog(userDataDir, "warn", "cache_read_failed", { error });
        return { ok: false, error };
    }
}
async function clearLicenseCache(userDataDir, reason) {
    const filePath = getLicenseCachePath(userDataDir);
    try {
        await node_fs_1.default.promises.unlink(filePath);
    }
    catch (err) {
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
