const fs = require("fs");
const path = require("path");
const { safeStorage } = require("electron");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

const DEFAULT_SUPABASE_URL = "https://cjakoblszlmbmotchzva.supabase.co";
const ENV_SUPABASE_URL = "NOVAFLOW_SUPABASE_URL";
const ENV_SERVICE_ROLE_KEY = "NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY";
const CONFIG_FILE = "online-license-admin.json";
const DEFAULT_REMOTE_EXPIRE_AT = "2099-12-31T23:59:59.000Z";
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const VALID_STATUSES = new Set(["active", "banned", "expired"]);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUrl(value) {
  const url = normalizeText(value) || DEFAULT_SUPABASE_URL;
  return url.replace(/\/+$/, "");
}

function readEnvOnlineConfig() {
  const secretKey = normalizeText(process.env[ENV_SERVICE_ROLE_KEY]);
  if (!secretKey) return null;
  return {
    supabaseUrl: normalizeUrl(process.env[ENV_SUPABASE_URL]),
    secretKey,
    source: "environment"
  };
}

function normalizeLicenseKey(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeStatus(value) {
  const status = normalizeText(value).toLowerCase();
  return VALID_STATUSES.has(status) ? status : "active";
}

function normalizeLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(n)));
}

function getConfigPath(userDataDir) {
  return path.join(userDataDir, CONFIG_FILE);
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function encryptSecret(secretKey) {
  const raw = normalizeText(secretKey);
  if (!raw) return null;
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    return {
      encrypted: true,
      value: safeStorage.encryptString(raw).toString("base64")
    };
  }
  return { encrypted: false, value: raw };
}

function decryptSecret(payload) {
  if (!payload || typeof payload !== "object") return "";
  const value = normalizeText(payload.value);
  if (!value) return "";
  if (payload.encrypted) {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  }
  return value;
}

function maskSecret(secretKey) {
  const s = normalizeText(secretKey);
  if (!s) return "";
  if (s.length <= 14) return "********";
  return `${s.slice(0, 10)}...${s.slice(-4)}`;
}

function readRawConfig(userDataDir) {
  const filePath = getConfigPath(userDataDir);
  if (!fs.existsSync(filePath)) {
    return {
      supabaseUrl: DEFAULT_SUPABASE_URL,
      secret: null,
      savedAt: ""
    };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    supabaseUrl: normalizeUrl(raw.supabaseUrl),
    secret: raw.secret || null,
    savedAt: normalizeText(raw.savedAt)
  };
}

function getPublicConfig(userDataDir) {
  const envConfig = readEnvOnlineConfig();
  if (envConfig) {
    return {
      supabaseUrl: envConfig.supabaseUrl,
      hasSecretKey: true,
      secretPreview: ENV_SERVICE_ROLE_KEY,
      encryptionAvailable: Boolean(safeStorage && safeStorage.isEncryptionAvailable()),
      savedAt: "environment",
      source: envConfig.source
    };
  }
  const config = readRawConfig(userDataDir);
  let secret = "";
  try {
    secret = decryptSecret(config.secret);
  } catch {}
  return {
    supabaseUrl: normalizeUrl(config.supabaseUrl),
    hasSecretKey: Boolean(secret),
    secretPreview: maskSecret(secret),
    encryptionAvailable: Boolean(safeStorage && safeStorage.isEncryptionAvailable()),
    savedAt: config.savedAt || ""
  };
}

function saveConfig(userDataDir, input) {
  const current = readRawConfig(userDataDir);
  const supabaseUrl = normalizeUrl(input?.supabaseUrl || current.supabaseUrl);
  const nextSecret = normalizeText(input?.secretKey);
  const secret = nextSecret ? encryptSecret(nextSecret) : current.secret || null;
  const payload = {
    supabaseUrl,
    secret,
    savedAt: new Date().toISOString()
  };
  const filePath = getConfigPath(userDataDir);
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return getPublicConfig(userDataDir);
}

function requireSecretConfig(userDataDir) {
  const envConfig = readEnvOnlineConfig();
  if (envConfig) return envConfig;
  const config = readRawConfig(userDataDir);
  const supabaseUrl = normalizeUrl(config.supabaseUrl);
  const secretKey = decryptSecret(config.secret);
  if (!secretKey) throw new Error("supabase_secret_key_missing");
  return { supabaseUrl, secretKey };
}

function createAdminClient(userDataDir) {
  const config = requireSecretConfig(userDataDir);
  return createClient(config.supabaseUrl, config.secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    realtime: {
      transport: WebSocket
    }
  });
}

function parsePermissionsJson(value) {
  const text = normalizeText(value);
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("permissions_json_invalid");
  }
}

function normalizeExpireAt(value) {
  const text = normalizeText(value);
  if (!text) return DEFAULT_REMOTE_EXPIRE_AT;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T23:59:59.000Z`;
  }
  const ms = new Date(text).getTime();
  if (!Number.isFinite(ms)) throw new Error("expire_at_invalid");
  return new Date(ms).toISOString();
}

function mapRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    created_at: row.created_at || "",
    license_key: row.license_key || "",
    machine_id: row.machine_id || "",
    status: row.status || "",
    expire_at: row.expire_at || "",
    permissions: row.permissions == null ? [] : row.permissions
  };
}

async function testConnection(userDataDir) {
  const client = createAdminClient(userDataDir);
  const { data, error, status } = await client.from("licenses").select("id").limit(1);
  if (error) throw new Error(error.message || String(error));
  return { ok: true, status: Number(status || 200), rows: Array.isArray(data) ? data.length : 0 };
}

async function queryLicenses(userDataDir, input) {
  const licenseKey = normalizeLicenseKey(input?.licenseKey);
  const machineId = normalizeText(input?.machineId);
  const limit = normalizeLimit(input?.limit);

  const client = createAdminClient(userDataDir);
  let query = client
    .from("licenses")
    .select("id,created_at,license_key,machine_id,status,expire_at,permissions")
    .order("id", { ascending: false })
    .limit(limit);
  if (licenseKey) query = query.eq("license_key", licenseKey);
  if (!licenseKey && machineId) query = query.eq("machine_id", machineId);

  const { data, error, status } = await query;
  if (error) throw new Error(error.message || String(error));
  return {
    ok: true,
    status: Number(status || 200),
    mode: licenseKey ? "license_key" : machineId ? "machine_id" : "list",
    limit,
    records: Array.isArray(data) ? data.map(mapRecord) : []
  };
}

async function upsertLicense(userDataDir, input) {
  const licenseKey = normalizeLicenseKey(input?.licenseKey);
  const machineId = normalizeText(input?.machineId);
  if (!licenseKey) throw new Error("license_key_required");
  if (!machineId) throw new Error("machine_id_required");

  const client = createAdminClient(userDataDir);
  const payload = {
    license_key: licenseKey,
    machine_id: machineId,
    status: normalizeStatus(input?.status),
    expire_at: normalizeExpireAt(input?.expireAt),
    permissions: parsePermissionsJson(input?.permissionsText)
  };

  const found = await client
    .from("licenses")
    .select("id")
    .eq("license_key", licenseKey)
    .order("id", { ascending: false })
    .limit(1);
  if (found.error) throw new Error(found.error.message || String(found.error));

  const existing = Array.isArray(found.data) ? found.data[0] : null;
  let result;
  if (existing?.id != null) {
    result = await client
      .from("licenses")
      .update(payload)
      .eq("id", existing.id)
      .select("id,created_at,license_key,machine_id,status,expire_at,permissions")
      .single();
  } else {
    result = await client
      .from("licenses")
      .insert(payload)
      .select("id,created_at,license_key,machine_id,status,expire_at,permissions")
      .single();
  }

  if (result.error) throw new Error(result.error.message || String(result.error));
  return {
    ok: true,
    mode: existing?.id != null ? "updated" : "inserted",
    record: mapRecord(result.data)
  };
}

async function setLicenseStatus(userDataDir, input) {
  const licenseKey = normalizeLicenseKey(input?.licenseKey);
  const status = normalizeStatus(input?.status);
  if (!licenseKey) throw new Error("license_key_required");

  const client = createAdminClient(userDataDir);
  const result = await client
    .from("licenses")
    .update({ status })
    .eq("license_key", licenseKey)
    .select("id,created_at,license_key,machine_id,status,expire_at,permissions");
  if (result.error) throw new Error(result.error.message || String(result.error));
  const records = Array.isArray(result.data) ? result.data.map(mapRecord) : [];
  if (!records.length) throw new Error("remote_record_missing");
  return { ok: true, status, records };
}

async function deleteLicense(userDataDir, input) {
  const licenseKey = normalizeLicenseKey(input?.licenseKey);
  const id = input?.id == null || input?.id === "" ? "" : String(input.id).trim();
  if (!licenseKey) throw new Error("license_key_required");

  const client = createAdminClient(userDataDir);
  let query = client
    .from("licenses")
    .delete()
    .eq("license_key", licenseKey)
    .select("id,created_at,license_key,machine_id,status,expire_at,permissions");
  if (id) query = query.eq("id", id);

  const result = await query;
  if (result.error) throw new Error(result.error.message || String(result.error));
  const records = Array.isArray(result.data) ? result.data.map(mapRecord) : [];
  if (!records.length) throw new Error("remote_record_missing");
  return { ok: true, licenseKey, mode: id ? "id" : "license_key", records, deletedCount: records.length };
}

module.exports = {
  DEFAULT_SUPABASE_URL,
  DEFAULT_REMOTE_EXPIRE_AT,
  getPublicConfig,
  saveConfig,
  testConnection,
  queryLicenses,
  upsertLicense,
  setLicenseStatus,
  deleteLicense
};
