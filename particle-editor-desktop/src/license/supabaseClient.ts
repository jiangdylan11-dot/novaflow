import { ONLINE_VERIFY_TIMEOUT_MS, SUPABASE_URL } from "./config";

const LICENSE_VERIFY_PATH = "/api/client/license/verify";

export interface RemoteLicenseRecord {
  license_key: string | null;
  machine_id: string | null;
  status: string | null;
  expire_at: string | null;
  permissions: unknown;
}

export interface RemoteLicenseFetchResult {
  record: RemoteLicenseRecord | null;
  status: number;
  error?: string;
  rejectionReason?: string;
}

function clientApiBaseUrl(): string {
  const explicit = String(
    process.env.NOVAFLOW_CLIENT_API_BASE_URL ||
    process.env.NOVAFLOW_BACKEND_URL ||
    ""
  ).trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return `${String(SUPABASE_URL || "").trim().replace(/\/+$/, "")}/functions/v1/novaflow-backend`;
}

export function resolveLicenseVerifyUrl(): string {
  const url = new URL(clientApiBaseUrl());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("invalid client api protocol");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  const basePath = String(url.pathname || "/").replace(/\/+$/, "");
  url.pathname = `${basePath}/${LICENSE_VERIFY_PATH.replace(/^\/+/, "")}`;
  return url.toString();
}

export async function fetchLicenseRecordByKey(
  licenseKey: string,
  machineId: string,
  timeoutMs = ONLINE_VERIFY_TIMEOUT_MS
): Promise<RemoteLicenseFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(resolveLicenseVerifyUrl(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        licenseKey: String(licenseKey || "").trim(),
        machineId: String(machineId || "").trim()
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      return {
        record: null,
        status: response.status,
        error: text ? "invalid license verification response" : "empty license verification response"
      };
    }

    if (!response.ok || payload?.ok === false) {
      return {
        record: null,
        status: response.status,
        error: String(payload?.error || `license verification HTTP ${response.status}`)
      };
    }
    if (!payload || typeof payload !== "object" || typeof payload.valid !== "boolean") {
      return {
        record: null,
        status: response.status,
        error: "invalid license verification response"
      };
    }
    if (payload.valid !== true) {
      return {
        record: null,
        status: response.status,
        rejectionReason: String(payload?.reason || "license_rejected")
      };
    }

    return {
      status: response.status,
      record: {
        license_key: String(licenseKey || "").trim(),
        machine_id: String(machineId || "").trim(),
        status: "active",
        expire_at: payload.expireAt == null ? null : String(payload.expireAt),
        permissions: payload.permissions ?? null
      }
    };
  } catch (error: any) {
    const message = error?.name === "AbortError"
      ? "license verification timeout"
      : String(error?.message || error || "license verification failed");
    return { record: null, status: 0, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
