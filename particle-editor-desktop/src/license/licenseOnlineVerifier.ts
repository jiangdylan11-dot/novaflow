import path from "node:path";
import {
  OFFLINE_GRACE_MS,
  ONLINE_VERIFY_TIMEOUT_MS,
  REMOTE_STATUS_ACTIVE,
  REMOTE_STATUS_BANNED,
  REMOTE_STATUS_EXPIRED,
  SUPPORTED_REMOTE_STATUSES
} from "./config";
import {
  appendLicenseLog,
  clearLicenseCache,
  readLicenseCache,
  writeLicenseCache
} from "./licenseCache";
import {
  fetchLicenseRecordByKey,
  RemoteLicenseFetchResult,
  RemoteLicenseRecord
} from "./supabaseClient";

export interface LocalLicenseState {
  status: string;
  machineId: string;
  payload?: any;
  error?: string;
}

export interface EffectiveLicenseState {
  status: "licensed" | "unlicensed" | "expired" | "invalid" | "locked";
  locked: boolean;
  machineId: string;
  payload?: any;
  error?: string;
  reason?: string;
  licenseKey?: string;
  expireAt?: string | number | null;
  permissions?: unknown;
  online?: {
    source: "online" | "offline-cache";
    status: string;
    licenseKey: string;
    lastVerifyTime?: number;
    offlineRemainingMs?: number;
    remoteExpireAt?: string | null;
  };
}

export interface VerifyLicenseOnlineOptions {
  userDataDir: string;
  localState: LocalLicenseState;
  timeoutMs?: number;
  allowOfflineCache?: boolean;
  source?: string;
  successReuseMs?: number;
  successReuseScope?: string;
}

interface OnlineVerificationSuccessEntry {
  userDataDir: string;
  licenseKey: string;
  machineId: string;
  scope: string;
  verifiedAt: number;
  record: RemoteLicenseRecord;
}

const MAX_ONLINE_SUCCESS_REUSE_MS = 60_000;
const onlineVerificationSuccessEntries = new Map<string, OnlineVerificationSuccessEntry>();
const onlineVerificationRequestsInFlight = new Map<string, Promise<RemoteLicenseFetchResult>>();

function normalizeUserDataDir(value: string): string {
  const resolved = path.resolve(String(value || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function normalizeSuccessReuseMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(MAX_ONLINE_SUCCESS_REUSE_MS, Math.floor(parsed));
}

function onlineVerificationIdentityKey(userDataDir: string, licenseKey: string, machineId: string): string {
  return JSON.stringify([normalizeUserDataDir(userDataDir), licenseKey, machineId]);
}

function onlineVerificationSuccessKey(
  userDataDir: string,
  licenseKey: string,
  machineId: string,
  scope: string
): string {
  return JSON.stringify([normalizeUserDataDir(userDataDir), licenseKey, machineId, scope]);
}

function clearOnlineVerificationSuccessEntries(
  userDataDir: string,
  licenseKey?: string,
  machineId?: string
): void {
  const normalizedUserDataDir = normalizeUserDataDir(userDataDir);
  for (const [key, entry] of onlineVerificationSuccessEntries) {
    if (entry.userDataDir !== normalizedUserDataDir) continue;
    if (licenseKey !== undefined && entry.licenseKey !== licenseKey) continue;
    if (machineId !== undefined && entry.machineId !== machineId) continue;
    onlineVerificationSuccessEntries.delete(key);
  }
}

async function fetchLicenseRecordSingleFlight(
  userDataDir: string,
  licenseKey: string,
  machineId: string,
  timeoutMs: number
): Promise<RemoteLicenseFetchResult> {
  const key = JSON.stringify([
    onlineVerificationIdentityKey(userDataDir, licenseKey, machineId),
    timeoutMs
  ]);
  const existing = onlineVerificationRequestsInFlight.get(key);
  if (existing) return existing;

  const pending = fetchLicenseRecordByKey(licenseKey, machineId, timeoutMs);
  onlineVerificationRequestsInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (onlineVerificationRequestsInFlight.get(key) === pending) {
      onlineVerificationRequestsInFlight.delete(key);
    }
  }
}

function normalizeRemoteStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function getLicenseKeyFromPayload(payload: any): string {
  return String(payload?.licenseKey || payload?.license_key || "").trim();
}

function parseTimeMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function lockedState(
  localState: LocalLicenseState,
  reason: string,
  extra: Partial<EffectiveLicenseState> = {}
): EffectiveLicenseState {
  return {
    status: "locked",
    locked: true,
    machineId: String(localState.machineId || ""),
    payload: localState.payload,
    reason,
    error: reason,
    ...extra
  };
}

function localFailureState(localState: LocalLicenseState): EffectiveLicenseState {
  const status = localState.status === "expired" ? "expired" : localState.status === "unlicensed" ? "unlicensed" : "invalid";
  return {
    status,
    locked: true,
    machineId: String(localState.machineId || ""),
    payload: localState.payload,
    error: localState.error || localState.status,
    reason: localState.error || localState.status
  };
}

function validateRemoteRecord(
  record: RemoteLicenseRecord | null,
  licenseKey: string,
  machineId: string,
  now: number
): { ok: true; expireMs: number | null } | { ok: false; reason: string; clearCache: boolean } {
  if (!record) return { ok: false, reason: "remote_record_missing", clearCache: true };

  const remoteLicenseKey = String(record.license_key || "").trim();
  if (remoteLicenseKey !== licenseKey) return { ok: false, reason: "remote_license_key_mismatch", clearCache: true };

  const status = normalizeRemoteStatus(record.status);
  if (!SUPPORTED_REMOTE_STATUSES.has(status)) return { ok: false, reason: `remote_status_${status || "empty"}`, clearCache: true };
  if (status === REMOTE_STATUS_BANNED) return { ok: false, reason: "remote_banned", clearCache: true };
  if (status === REMOTE_STATUS_EXPIRED) return { ok: false, reason: "remote_expired", clearCache: true };
  if (status !== REMOTE_STATUS_ACTIVE) return { ok: false, reason: `remote_status_${status}`, clearCache: true };

  const remoteMachineId = String(record.machine_id || "").trim();
  if (remoteMachineId !== machineId) return { ok: false, reason: "remote_machine_mismatch", clearCache: true };

  const expireMs = parseTimeMs(record.expire_at);
  if (!expireMs) return { ok: false, reason: "remote_expire_at_missing", clearCache: true };
  if (now > expireMs) return { ok: false, reason: "remote_expire_at_passed", clearCache: true };

  return { ok: true, expireMs };
}

function onlineLicensedState(
  localState: LocalLicenseState,
  licenseKey: string,
  record: RemoteLicenseRecord,
  verifiedAt: number
): EffectiveLicenseState {
  const remoteExpireAt = String(record.expire_at || "");
  const offlineRemainingMs = Math.max(0, OFFLINE_GRACE_MS - Math.max(0, Date.now() - verifiedAt));
  return {
    status: "licensed",
    locked: false,
    machineId: localState.machineId,
    payload: localState.payload,
    licenseKey,
    permissions: record.permissions ?? null,
    expireAt: remoteExpireAt,
    online: {
      source: "online",
      status: REMOTE_STATUS_ACTIVE,
      licenseKey,
      lastVerifyTime: verifiedAt,
      offlineRemainingMs,
      remoteExpireAt
    }
  };
}

async function offlineCacheState(
  options: VerifyLicenseOnlineOptions,
  licenseKey: string,
  now: number,
  networkReason: string
): Promise<EffectiveLicenseState> {
  const localState = options.localState;
  if (options.allowOfflineCache === false) {
    await appendLicenseLog(options.userDataDir, "warn", "offline_cache_disallowed", {
      source: options.source || "",
      reason: networkReason,
      license_key: licenseKey
    });
    return lockedState(localState, networkReason || "online_verify_failed", { licenseKey });
  }

  const cacheResult = await readLicenseCache(options.userDataDir, localState.machineId);
  if (!cacheResult.ok) {
    return lockedState(localState, cacheResult.error === "cache_missing" ? "first_online_verify_required" : "license_cache_invalid", {
      licenseKey,
      error: networkReason
    });
  }

  const cache = cacheResult.cache;
  if (cache.license_key !== licenseKey || cache.machine_id !== localState.machineId) {
    await appendLicenseLog(options.userDataDir, "warn", "offline_cache_mismatch", {
      source: options.source || "",
      expected_license_key: licenseKey,
      cached_license_key: cache.license_key
    });
    return lockedState(localState, "license_cache_mismatch", { licenseKey });
  }

  const remoteExpireMs = parseTimeMs(cache.remote_expire_at);
  if (!remoteExpireMs || now > remoteExpireMs) {
    await clearLicenseCache(options.userDataDir, "offline_cached_remote_expired");
    return lockedState(localState, "offline_cached_remote_expired", { licenseKey });
  }

  const ageMs = now - Number(cache.last_verify_time || 0);
  const offlineRemainingMs = OFFLINE_GRACE_MS - ageMs;
  if (ageMs < 0 || offlineRemainingMs <= 0) {
    await appendLicenseLog(options.userDataDir, "warn", "offline_grace_expired", {
      source: options.source || "",
      license_key: licenseKey,
      age_ms: ageMs
    });
    return lockedState(localState, "offline_grace_expired", { licenseKey });
  }

  await appendLicenseLog(options.userDataDir, "info", "offline_allowed", {
    source: options.source || "",
    license_key: licenseKey,
    offline_remaining_ms: offlineRemainingMs
  });
  return {
    status: "licensed",
    locked: false,
    machineId: localState.machineId,
    payload: localState.payload,
    licenseKey,
    permissions: cache.permissions,
    expireAt: cache.remote_expire_at,
    online: {
      source: "offline-cache",
      status: cache.status,
      licenseKey,
      lastVerifyTime: cache.last_verify_time,
      offlineRemainingMs,
      remoteExpireAt: cache.remote_expire_at
    }
  };
}

export async function verifyLicenseOnline(options: VerifyLicenseOnlineOptions): Promise<EffectiveLicenseState> {
  const localState = options.localState;
  const userDataDir = options.userDataDir;
  const now = Date.now();

  if (!localState || localState.status !== "licensed") {
    await appendLicenseLog(userDataDir, "warn", "local_license_rejected", {
      source: options.source || "",
      status: localState?.status || "missing",
      error: localState?.error || ""
    });
    return localFailureState(localState || { status: "invalid", machineId: "" });
  }

  const licenseKey = getLicenseKeyFromPayload(localState.payload);
  if (!licenseKey) {
    await appendLicenseLog(userDataDir, "error", "license_key_missing", {
      source: options.source || "",
      machine_id: localState.machineId
    });
    return lockedState(localState, "license_key_missing");
  }

  const successReuseScope = String(options.successReuseScope || "").trim().slice(0, 128);
  const successReuseMs = successReuseScope ? normalizeSuccessReuseMs(options.successReuseMs) : 0;
  const successKey = onlineVerificationSuccessKey(
    userDataDir,
    licenseKey,
    localState.machineId,
    successReuseScope
  );
  if (successReuseMs > 0) {
    const cached = onlineVerificationSuccessEntries.get(successKey);
    if (cached) {
      const ageMs = now - cached.verifiedAt;
      const validation = validateRemoteRecord(cached.record, licenseKey, localState.machineId, now);
      if (ageMs >= 0 && ageMs < successReuseMs && validation.ok) {
        await appendLicenseLog(userDataDir, "info", "online_verify_success_reused", {
          source: options.source || "",
          license_key: licenseKey,
          machine_id: localState.machineId,
          scope: successReuseScope,
          age_ms: ageMs
        });
        return onlineLicensedState(localState, licenseKey, cached.record, cached.verifiedAt);
      }
      onlineVerificationSuccessEntries.delete(successKey);
    }
  }

  await appendLicenseLog(userDataDir, "info", "online_verify_start", {
    source: options.source || "",
    license_key: licenseKey,
    machine_id: localState.machineId
  });

  try {
    const result = await fetchLicenseRecordSingleFlight(
      userDataDir,
      licenseKey,
      localState.machineId,
      options.timeoutMs || ONLINE_VERIFY_TIMEOUT_MS
    );
    if (result.error) {
      throw new Error(result.error);
    }
    if (result.rejectionReason) {
      clearOnlineVerificationSuccessEntries(userDataDir, licenseKey, localState.machineId);
      await clearLicenseCache(userDataDir, result.rejectionReason);
      await appendLicenseLog(userDataDir, "warn", "online_verify_rejected", {
        source: options.source || "",
        reason: result.rejectionReason,
        license_key: licenseKey,
        machine_id: localState.machineId
      });
      return lockedState(localState, result.rejectionReason, { licenseKey });
    }

    const verifiedAt = Date.now();
    const remoteValidation = validateRemoteRecord(result.record, licenseKey, localState.machineId, verifiedAt);
    if (!remoteValidation.ok) {
      clearOnlineVerificationSuccessEntries(userDataDir, licenseKey, localState.machineId);
      if (remoteValidation.clearCache) await clearLicenseCache(userDataDir, remoteValidation.reason);
      await appendLicenseLog(userDataDir, remoteValidation.reason === "remote_banned" ? "error" : "warn", "online_verify_rejected", {
        source: options.source || "",
        reason: remoteValidation.reason,
        license_key: licenseKey,
        status: result.record?.status || null,
        machine_id: result.record?.machine_id || null
      });
      return lockedState(localState, remoteValidation.reason, { licenseKey });
    }

    const record = result.record as RemoteLicenseRecord;
    const remoteExpireAt = String(record.expire_at || "");
    await writeLicenseCache(userDataDir, {
      license_key: licenseKey,
      machine_id: localState.machineId,
      last_verify_time: verifiedAt,
      remote_expire_at: remoteExpireAt,
      permissions: record.permissions ?? null
    });

    if (successReuseMs > 0) {
      onlineVerificationSuccessEntries.set(successKey, {
        userDataDir: normalizeUserDataDir(userDataDir),
        licenseKey,
        machineId: localState.machineId,
        scope: successReuseScope,
        verifiedAt,
        record: { ...record }
      });
    }

    await appendLicenseLog(userDataDir, "info", "online_verify_ok", {
      source: options.source || "",
      license_key: licenseKey,
      machine_id: localState.machineId,
      expire_at: remoteExpireAt
    });

    return onlineLicensedState(localState, licenseKey, record, verifiedAt);
  } catch (err: any) {
    const reason = String(err?.message || err || "online_verify_failed");
    await appendLicenseLog(userDataDir, "warn", "online_verify_failed", {
      source: options.source || "",
      license_key: licenseKey,
      error: reason
    });
    return offlineCacheState(options, licenseKey, now, reason);
  }
}

export function clearOnlineLicenseSuccessReuse(userDataDir: string): void {
  clearOnlineVerificationSuccessEntries(userDataDir);
}

export async function clearOnlineLicenseCache(userDataDir: string, reason: string): Promise<void> {
  clearOnlineLicenseSuccessReuse(userDataDir);
  await clearLicenseCache(userDataDir, reason);
}
