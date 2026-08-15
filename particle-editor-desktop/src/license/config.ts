export const SUPABASE_URL = process.env.NOVAFLOW_SUPABASE_URL || "https://cjakoblszlmbmotchzva.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NOVAFLOW_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_jRdohxpyiElcaQQEgyVgLw_cQEc09bF";

export const LICENSE_CACHE_FILE_NAME = "license-cache.json";
export const LICENSE_LOG_FILE_NAME = "license.log";
export const ONLINE_VERIFY_TIMEOUT_MS = 7000;
export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export const REMOTE_STATUS_ACTIVE = "active";
export const REMOTE_STATUS_BANNED = "banned";
export const REMOTE_STATUS_EXPIRED = "expired";

export const SUPPORTED_REMOTE_STATUSES = new Set([
  REMOTE_STATUS_ACTIVE,
  REMOTE_STATUS_BANNED,
  REMOTE_STATUS_EXPIRED
]);
