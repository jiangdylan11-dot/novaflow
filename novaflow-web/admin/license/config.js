"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_REMOTE_STATUSES = exports.REMOTE_STATUS_EXPIRED = exports.REMOTE_STATUS_BANNED = exports.REMOTE_STATUS_ACTIVE = exports.OFFLINE_GRACE_MS = exports.ONLINE_VERIFY_TIMEOUT_MS = exports.LICENSE_LOG_FILE_NAME = exports.LICENSE_CACHE_FILE_NAME = exports.SUPABASE_PUBLISHABLE_KEY = exports.SUPABASE_URL = void 0;
exports.SUPABASE_URL = process.env.NOVAFLOW_SUPABASE_URL || "https://cjakoblszlmbmotchzva.supabase.co";
exports.SUPABASE_PUBLISHABLE_KEY = process.env.NOVAFLOW_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_jRdohxpyiElcaQQEgyVgLw_cQEc09bF";
exports.LICENSE_CACHE_FILE_NAME = "license-cache.json";
exports.LICENSE_LOG_FILE_NAME = "license.log";
exports.ONLINE_VERIFY_TIMEOUT_MS = 7000;
exports.OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
exports.REMOTE_STATUS_ACTIVE = "active";
exports.REMOTE_STATUS_BANNED = "banned";
exports.REMOTE_STATUS_EXPIRED = "expired";
exports.SUPPORTED_REMOTE_STATUSES = new Set([
    exports.REMOTE_STATUS_ACTIVE,
    exports.REMOTE_STATUS_BANNED,
    exports.REMOTE_STATUS_EXPIRED
]);
