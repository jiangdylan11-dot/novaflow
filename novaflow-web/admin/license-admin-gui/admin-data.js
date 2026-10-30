const { createClient } = require("@supabase/supabase-js");
const childProcess = require("child_process");
const WebSocket = require("ws");
const runningHub = require("./runninghub-provider.cjs");
const {
  DEFAULT_RUNNINGHUB_LLM_MODEL,
  loadFeatureCredits
} = require("../load-shared-esm.cjs");

if (typeof globalThis.WebSocket !== "function") {
  globalThis.WebSocket = WebSocket;
}

const ENV_SUPABASE_URL = "NOVAFLOW_SUPABASE_URL";
const ENV_SERVICE_ROLE_KEY = "NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY";
const ENV_SUPABASE_PUBLISHABLE_KEY = "NOVAFLOW_SUPABASE_PUBLISHABLE_KEY";
const ENV_SUPABASE_ANON_KEY = "NOVAFLOW_SUPABASE_ANON_KEY";
const ENV_COMFYUI_BASE_URL = "NOVAFLOW_COMFYUI_BASE_URL";
const ENV_COMFYUI_API_KEY = "NOVAFLOW_COMFYUI_API_KEY";
const ENV_COMFYUI_API_KEY_SECRET_REF = "NOVAFLOW_COMFYUI_API_KEY_SECRET_REF";
const ENV_GROK_BASE_URL = "NOVAFLOW_GROK_BASE_URL";
const ENV_GROK_API_KEY = "NOVAFLOW_GROK_API_KEY";
const ENV_GROK_MODEL = "NOVAFLOW_GROK_MODEL";
const DEFAULT_LIMIT = 100;
const ERROR_PREFIX = "Supabase Error";
const DEFAULT_GROK_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_GROK_MODEL = DEFAULT_RUNNINGHUB_LLM_MODEL;
const PROVIDER_QUOTA_PREFIX = "provider_quota_";
const INTERNAL_ACCOUNT_EMAIL_DOMAIN = "accounts.novaflow.local";
const INTERNAL_ACCOUNT_EMAIL_PREFIX = "acct_";
// The only operator-writable online provider secret. Other RunningHub fields
// stay readable. Grok, cloud ComfyUI, and the removed Google endpoint are not
// writable; unmigrated call paths may still read their existing env values.
const FEATURE_CREDIT_PRICE_ENV = "NOVAFLOW_FEATURE_CREDIT_PRICES";
const WRITABLE_PROVIDER_ENV_NAMES = new Set([runningHub.ENV.apiKey, FEATURE_CREDIT_PRICE_ENV]);
const RETIRED_PROVIDER_ENV_NAMES = new Set([
  ENV_COMFYUI_BASE_URL,
  ENV_COMFYUI_API_KEY,
  ENV_COMFYUI_API_KEY_SECRET_REF,
  ENV_GROK_BASE_URL,
  ENV_GROK_API_KEY,
  ENV_GROK_MODEL,
  "NOVAFLOW_RUNNINGHUB_GOOGLE_IMAGE_ENDPOINT"
]);

let cachedClient = null;
let cachedClientEnvKey = "";
let adminConnectionResolver = null;

// Main-process-only resolver for the saved, encrypted backend connection.
// Credentials never cross the preload bridge.
function setAdminConnectionResolver(resolve) {
  adminConnectionResolver = typeof resolve === "function" ? resolve : null;
  cachedClient = null;
  cachedClientEnvKey = "";
}

const adminQueries = {
  users: {
    select: "id,email,display_name,role,plan,status,created_at,updated_at",
    // The user list also shows 同时在线 / 有效期; before
    // 20261013010000_user_session_limits.sql has run it falls back to `select`.
    listSelect: "id,email,display_name,role,plan,status,max_sessions,expires_at,created_at,updated_at",
    orderBy: "created_at",
    ascending: false
  },
  credits: {
    select: "id,user_id,balance,updated_at",
    orderBy: "updated_at",
    ascending: false
  },
  ai_providers: {
    select: "id,provider_key,name,status,billing_multiplier,api_key_secret_ref,created_at,updated_at",
    orderBy: "created_at",
    ascending: false
  },
  system_settings: {
    select: "key,value,updated_at",
    orderBy: "key",
    ascending: true,
    limit: 500
  },
  gpu_workers: {
    select: "id,owner_id,worker_name,name_managed,status,tier,enabled,owner_enabled,sharing_enabled,sharing_scope,allowed_user_ids,gpu_name,vram_mb,ram_mb,comfy_version,worker_version,endpoint_url,transport,last_heartbeat,total_completed,total_failed,created_at",
    // Until 20260925010000_novaflow_web_node_tiers.sql is applied there is no
    // tier column; the page still has to list the nodes.
    fallbackSelect: "id,owner_id,worker_name,status,gpu_name,vram_mb,ram_mb,comfy_version,worker_version,endpoint_url,transport,last_heartbeat,total_completed,total_failed,created_at",
    orderBy: "created_at",
    ascending: false,
    limit: 200
  },
  web_compute_usage: {
    // Who generated, when, and on whose machine - and nothing else.
    //
    // No prompt, no parameters, no output manifest: the operator asked to see
    // usage, not what anyone made. Reading those columns would put a user's
    // work on an admin screen for no reason, so they are not selected at all.
    select: "id,user_id,user_account,assigned_worker_id,worker_name,task_type,model_id,status,attempt_count,charged_credit_cost,error_code,error_message,created_at,assigned_at,started_at,completed_at,failed_at,cancelled_at,updated_at",
    orderBy: "created_at",
    ascending: false,
    limit: 500
  },
  web_worker_registration_codes: {
    // The table is keyed by code_hash - there is no id column. The hash is the
    // row identity and is used for revoking; it stays in JS and is never put in
    // the DOM. It cannot be turned back into a code, and the plaintext is shown
    // once at creation and never stored, so nothing here can recover a code.
    select: "code_hash,owner_id,label,tier,max_uses,used_count,expires_at,created_at",
    fallbackSelect: "code_hash,owner_id,label,max_uses,used_count,expires_at,created_at",
    orderBy: "created_at",
    ascending: false,
    limit: 200
  }
};

function disabledTableResult(tableName, message) {
  return {
    source: "disabled",
    status: "disabled",
    configured: false,
    table: tableName,
    records: [],
    message,
    durationMs: 0,
    query: queryMeta(tableName, "-", { disabled: true })
  };
}

function readAdminSupabaseEnv() {
  const supabaseUrl = readAdminEnvValue(ENV_SUPABASE_URL).replace(/\/+$/, "");
  const serviceRoleKey = readAdminEnvValue(ENV_SERVICE_ROLE_KEY);
  return {
    supabaseUrl,
    hasServiceRoleKey: Boolean(serviceRoleKey),
    configured: Boolean(supabaseUrl && serviceRoleKey),
    serviceRoleKey
  };
}

function readAdminSupabaseAuthEnv() {
  const supabaseUrl = readAdminEnvValue(ENV_SUPABASE_URL).replace(/\/+$/, "");
  const publishableKey =
    readAdminEnvValue(ENV_SUPABASE_PUBLISHABLE_KEY) ||
    readAdminEnvValue(ENV_SUPABASE_ANON_KEY) ||
    readBundledSupabasePublishableKey();
  return {
    supabaseUrl,
    hasPublishableKey: Boolean(publishableKey),
    configured: Boolean(supabaseUrl && publishableKey),
    publishableKey
  };
}

function readBundledSupabasePublishableKey() {
  try {
    const config = require("../license/config");
    return String(config.SUPABASE_PUBLISHABLE_KEY || "").trim();
  } catch {
    return "";
  }
}

function readAdminComfyUiEnv() {
  const baseUrl = normalizeBaseUrl(readAdminEnvValue(ENV_COMFYUI_BASE_URL));
  const apiKey = readAdminEnvValue(ENV_COMFYUI_API_KEY);
  const apiKeySecretRef = readAdminEnvValue(ENV_COMFYUI_API_KEY_SECRET_REF);
  return {
    baseUrl,
    configured: Boolean(apiKey && baseUrl),
    secretConfigured: Boolean(apiKey || apiKeySecretRef),
    hasBaseUrl: Boolean(baseUrl),
    hasApiKey: Boolean(apiKey),
    hasApiKeySecretRef: Boolean(apiKeySecretRef),
    apiKeySecretRef,
    apiKey
  };
}

function readAdminGrokEnv() {
  const baseUrl = normalizeBaseUrl(readAdminEnvValue(ENV_GROK_BASE_URL) || DEFAULT_GROK_BASE_URL);
  const apiKey = readAdminEnvValue(ENV_GROK_API_KEY);
  const model = String(readAdminEnvValue(ENV_GROK_MODEL) || DEFAULT_GROK_MODEL).trim() || DEFAULT_GROK_MODEL;
  return {
    baseUrl,
    model,
    configured: Boolean(apiKey),
    hasBaseUrl: Boolean(baseUrl),
    hasApiKey: Boolean(apiKey),
    apiKey
  };
}

function readAdminRunningHubEnv() {
  return runningHub.readConfig(readAdminEnvValue);
}

let runningHubCheck = null;
async function getAdminRunningHubProviderStatus({ checkAccount = false } = {}) {
  const env = readAdminRunningHubEnv();
  if (checkAccount) {
    const result = await runningHub.checkAccount(env);
    runningHubCheck = { baseUrl: env.baseUrl, apiKey: env.apiKey, result };
    if (result?.connected) {
      try {
        const saved = await upsertAdminSystemSetting({
          key: "rh_domestic_balance",
          value: {
            site: "domestic",
            label: "国内站余额",
            remainMoney: result.balance?.money ?? null,
            remainCoins: result.balance?.coins ?? null,
            currency: result.balance?.currency || "",
            checkedAt: result.checkedAt || new Date().toISOString()
          }
        });
        result.balanceCacheSaved = saved?.ok === true && saved?.source === "supabase";
      } catch (_err) {
        // The balance read still returns. A missing settings table must not hide it.
        result.balanceCacheSaved = false;
      }
    }
  }
  const cached = runningHubCheck?.baseUrl === env.baseUrl && runningHubCheck?.apiKey === env.apiKey ? runningHubCheck.result : null;
  let serverSync={synced:false,error:'尚未确认服务器同步'},serverFields={};
  try {
    const {client}=getAdminClient();
    if(client){
      const {data,error}=await client.rpc('novaflow_runninghub_config_get',{});
      if(error)throw new Error('server config unavailable');
      const row=Array.isArray(data)?data[0]:data;
      if(row)serverFields={llmBaseUrl:row.llm_base_url,llmModel:row.llm_model};
      serverSync=row?{synced:row.api_key===env.apiKey,configured:!!row.api_key,revision:row.revision,updatedAt:row.updated_at}
        :{synced:false,configured:false,error:'服务器尚无同步配置，请重新保存 Key'};
    }
  } catch {serverSync={synced:false,error:'无法读取服务器同步状态'};}
  return { ...runningHub.publicStatus(env), ...(cached || {}),...serverFields,serverSync };
}

const DOMESTIC_BALANCE_REFRESH_MS = 10 * 60 * 1000;
let domesticBalanceTimer = null;

// Server-side refresh of the domestic balance cache. The admin button is a
// manual refresh; this interval keeps checkedAt inside the default 10 minute TTL.
function startDomesticBalanceRefresh({ intervalMs = DOMESTIC_BALANCE_REFRESH_MS, check } = {}) {
  if (domesticBalanceTimer) clearInterval(domesticBalanceTimer);
  const run = () => Promise.resolve()
    .then(() => (check || (() => getAdminRunningHubProviderStatus({ checkAccount: true })))())
    .catch(() => {});
  void run();
  const timer = setInterval(() => { void run(); }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  domesticBalanceTimer = timer;
  return () => {
    clearInterval(timer);
    if (domesticBalanceTimer === timer) domesticBalanceTimer = null;
  };
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

function readAdminEnvValue(name) {
  const fromProcess = String(process.env[name] || "").trim();
  if (fromProcess) return fromProcess;
  const fromRegistry = readWindowsUserEnvValue(name);
  if (fromRegistry) return fromRegistry;
  if (adminConnectionResolver && [ENV_SUPABASE_URL, ENV_SERVICE_ROLE_KEY].includes(name)) {
    try {
      const saved = adminConnectionResolver();
      return String((name === ENV_SUPABASE_URL ? saved?.supabaseUrl : saved?.secretKey) || "").trim();
    } catch { /* A fresh machine has no saved connection yet. */ }
  }
  return "";
}

function readWindowsUserEnvValue(name) {
  if (process.platform !== "win32") return "";
  try {
    const result = childProcess.spawnSync("reg.exe", ["query", "HKCU\\Environment", "/v", name], {
      encoding: "utf8",
      windowsHide: true
    });
    if (result.status !== 0) return "";
    const line = String(result.stdout || "")
      .split(/\r?\n/)
      .find((item) => item.trim().startsWith(name));
    if (!line) return "";
    const match = line.match(/REG_\w+\s+(.+)$/);
    return String(match?.[1] || "").trim();
  } catch {
    return "";
  }
}

function assertWritableProviderEnvName(name) {
  const envName = String(name || "").trim();
  if (!WRITABLE_PROVIDER_ENV_NAMES.has(envName)) {
    throw new Error("Unsupported provider env name");
  }
  return envName;
}

function writeAdminEnvValue(name, value) {
  const envName = assertWritableProviderEnvName(name);
  const text = String(value ?? "").trim();
  if (text) {
    process.env[envName] = text;
  } else {
    delete process.env[envName];
  }

  if (process.platform !== "win32") {
    return { name: envName, configured: Boolean(text), persistent: false };
  }

  const args = text
    ? ["add", "HKCU\\Environment", "/v", envName, "/t", "REG_SZ", "/d", text, "/f"]
    : ["delete", "HKCU\\Environment", "/v", envName, "/f"];
  const result = childProcess.spawnSync("reg.exe", args, {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `failed to write ${envName}`);
  }
  return { name: envName, configured: Boolean(text), persistent: true };
}

function queryMeta(tableName, selectFields, options = {}) {
  return {
    table: tableName,
    select: selectFields,
    orderBy: options.orderBy || "",
    ascending: Boolean(options.ascending),
    limit: options.limit || DEFAULT_LIMIT
  };
}

function sanitizeError(err) {
  const env = readAdminSupabaseEnv();
  const comfyEnv = readAdminComfyUiEnv();
  const grokEnv = readAdminGrokEnv();
  const runningHubEnv = readAdminRunningHubEnv();
  let message = String(err?.message || err || "unknown");
  if (env.serviceRoleKey) {
    message = message.split(env.serviceRoleKey).join("[redacted-service-role-key]");
  }
  if (comfyEnv.apiKey) {
    message = message.split(comfyEnv.apiKey).join("[redacted-comfyui-api-key]");
  }
  if (comfyEnv.apiKeySecretRef) {
    message = message.split(comfyEnv.apiKeySecretRef).join("[redacted-comfyui-secret-ref]");
  }
  if (grokEnv.apiKey) {
    message = message.split(grokEnv.apiKey).join("[redacted-grok-api-key]");
  }
  if (runningHubEnv.apiKey) {
    message = message.split(runningHubEnv.apiKey).join("[redacted-runninghub-api-key]");
  }
  return message;
}

function logAdminData(level, message, details = {}) {
  const safeDetails = {};
  Object.entries(details || {}).forEach(([key, value]) => {
    if (/key|secret|token/i.test(key)) return;
    safeDetails[key] = value;
  });
  const suffix = Object.keys(safeDetails).length ? ` ${JSON.stringify(safeDetails)}` : "";
  const line = `[AdminData] ${new Date().toISOString()} ${message}${suffix}`;
  if (level === "error") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function mockResult(tableName, selectFields = "*", options = {}, durationMs = 0) {
  return {
    source: "unconfigured",
    status: "unconfigured",
    configured: false,
    table: tableName,
    records: [],
    message: "Supabase 未配置",
    reason: "supabase_env_missing",
    durationMs,
    query: queryMeta(tableName, selectFields, options)
  };
}

function supabaseResult(tableName, records, selectFields, options, durationMs) {
  return {
    source: "supabase",
    status: "connected",
    configured: true,
    table: tableName,
    records: Array.isArray(records) ? records : [],
    durationMs,
    query: queryMeta(tableName, selectFields, options)
  };
}

function errorResult(tableName, err, selectFields = "*", options = {}, durationMs = 0) {
  return {
    source: "supabase",
    status: "error",
    configured: true,
    table: tableName,
    records: [],
    error: `${ERROR_PREFIX}: ${sanitizeError(err)}`,
    durationMs,
    query: queryMeta(tableName, selectFields, options)
  };
}

function singleRecordResult(source, status, tableName, record, selectFields, options, durationMs) {
  return {
    source,
    status,
    configured: source === "supabase",
    table: tableName,
    record: record || null,
    records: record ? [record] : [],
    durationMs,
    query: queryMeta(tableName, selectFields, options)
  };
}

function supabaseErrorResult(tableName, err, selectFields, options, durationMs) {
  return {
    source: "supabase",
    status: "error",
    configured: true,
    table: tableName,
    records: [],
    error: `${ERROR_PREFIX}: ${sanitizeError(err)}`,
    durationMs,
    query: queryMeta(tableName, selectFields, options)
  };
}

function shouldRetryLegacySelect(err, options = {}) {
  if (!options.fallbackSelect) return false;
  const message = String(err?.message || err || "").toLowerCase();
  return (
    message.includes("schema cache") ||
    message.includes("could not find") ||
    // PostgREST wording for a column the migration has not added yet.
    message.includes("does not exist")
  );
}

function adminWriteErrorResult(operation, err, durationMs) {
  return {
    source: "supabase",
    status: "error",
    configured: true,
    operation,
    error: `${ERROR_PREFIX}: ${sanitizeError(err)}`,
    durationMs
  };
}

function localWriteErrorResult(operation, err, durationMs) {
  return {
    source: "local",
    status: "error",
    configured: true,
    operation,
    ok: false,
    error: `Provider Config Error: ${sanitizeError(err)}`,
    durationMs
  };
}

function adminWriteMockResult(operation, durationMs) {
  return {
    source: "mock",
    status: "mock",
    configured: false,
    operation,
    ok: false,
    error: "Supabase 未配置，不能写入。",
    durationMs
  };
}

function parseCreditAdjustmentPayload(payload) {
  const userId = String(payload?.userId || "").trim();
  const mode = String(payload?.mode || "add").trim();
  const amount = Number(payload?.amount);
  const feature = String(payload?.reason || payload?.feature || "").trim().slice(0, 200);
  const note = String(payload?.note || "").trim().slice(0, 500);
  if (!userId) throw new Error("请选择用户");
  if (!["add", "deduct", "set"].includes(mode)) throw new Error("不支持的积分操作");
  if (!feature) throw new Error("请填写不超过 200 字的调整原因");
  if (!Number.isInteger(amount)) throw new Error("积分必须是整数");
  if (mode === "set") {
    if (amount < 0) throw new Error("设置余额不能小于 0");
  } else if (amount <= 0) {
    throw new Error("充值或扣减积分必须大于 0");
  }
  return { userId, mode, amount, feature, reason: feature, note };
}

function creditAdjustmentSource(mode) {
  if (mode === "deduct") return "后台扣减";
  if (mode === "set") return "后台设置";
  return "后台充值";
}

function normalizeUserPlan(value) {
  const plan = String(value || "trial").trim().toLowerCase();
  if (plan === "team") return "pro";
  if (!["trial", "standard", "pro"].includes(plan)) throw new Error("不支持的用户方案");
  return plan;
}

function normalizeMaxSessions(value) {
  const count = Number(value ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 99) throw new Error("同时在线数必须是 1-99 的整数");
  return count;
}

// Empty = permanent. A bare date (from the date picker) lasts to the end of
// that day on this computer's clock.
function normalizeExpiresAt(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const time = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:59`).getTime() : Date.parse(raw);
  if (!Number.isFinite(time)) throw new Error("有效期日期格式不正确");
  return new Date(time).toISOString();
}

// Sign out all but the newest `keep` sessions of a user (0 = everywhere).
// Best effort: the limit is enforced again at the next login anyway.
async function trimUserSessions(client, userId, keep, reason) {
  try {
    const { data, error } = await client.rpc("novaflow_trim_user_sessions", { p_user_id: userId, p_keep: keep, p_reason: reason });
    if (error) throw error;
    return Number(data || 0);
  } catch (err) {
    logAdminData("error", "trim user sessions failed", { userId, keep, reason, error: sanitizeError(err) });
    return 0;
  }
}

function normalizeUserStatus(value) {
  const status = String(value || "active").trim().toLowerCase();
  if (!["active", "disabled"].includes(status)) throw new Error("不支持的用户状态");
  return status;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function normalizeAccountName(value) {
  const account = String(value || "").trim().toLowerCase();
  if (!account) throw new Error("账号不能为空");
  if (account.length < 2) throw new Error("账号至少需要 2 个字符");
  if (account.length > 64) throw new Error("账号不能超过 64 个字符");
  if (!/^[a-z0-9._-]+$/.test(account)) throw new Error("账号只能包含小写字母、数字、点、下划线或短横线");
  return account;
}

function accountToAuthEmail(value) {
  const raw = String(value || "").trim();
  if (isValidEmail(raw)) return normalizeEmail(raw);
  const account = normalizeAccountName(raw);
  return `${account}@${INTERNAL_ACCOUNT_EMAIL_DOMAIN}`;
}

function accountNameFromEmail(value) {
  const email = normalizeEmail(value);
  const suffix = `@${INTERNAL_ACCOUNT_EMAIL_DOMAIN}`;
  if (!email.endsWith(suffix)) return email;
  const local = email.slice(0, -suffix.length);
  if (!local.startsWith(INTERNAL_ACCOUNT_EMAIL_PREFIX)) return local;
  try {
    const account = Buffer.from(local.slice(INTERNAL_ACCOUNT_EMAIL_PREFIX.length), "base64url").toString("utf8");
    return /^[a-z0-9._-]{2,64}$/.test(account) ? account : email;
  } catch {
    return email;
  }
}

function normalizePassword(value) {
  return String(value || "");
}

function validatePassword(password) {
  if (!password || password.length < 6) return "密码至少需要 6 位";
  if (password.length > 128) return "密码不能超过 128 位";
  return "";
}

function parseAdminUserCreatePayload(payload) {
  const accountName = normalizeAccountName(payload?.accountName || payload?.account || payload?.username || payload?.email);
  const email = accountToAuthEmail(accountName);
  const displayName = String(payload?.displayName || payload?.display_name || "").trim().slice(0, 120);
  const password = normalizePassword(payload?.password);
  const plan = normalizeUserPlan(payload?.plan);
  const status = normalizeUserStatus(payload?.status);
  const initialCredits = Number(payload?.initialCredits ?? 0);
  const maxSessions = normalizeMaxSessions(payload?.maxSessions);
  const expiresAt = normalizeExpiresAt(payload?.expiresAt);
  const note = String(payload?.note || "").trim().slice(0, 500);
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(passwordError);
  if (!Number.isInteger(initialCredits) || initialCredits < 0) throw new Error("初始积分必须是大于等于 0 的整数");
  return { accountName, email, displayName, password, plan, status, initialCredits, maxSessions, expiresAt, note };
}

function parseAdminUserUpdatePayload(payload) {
  const userId = String(payload?.userId || "").trim();
  const displayName = payload?.displayName === undefined && payload?.display_name === undefined
    ? undefined
    : String(payload?.displayName || payload?.display_name || "").trim().slice(0, 120);
  const plan = payload?.plan === undefined ? undefined : normalizeUserPlan(payload.plan);
  const status = payload?.status === undefined ? undefined : normalizeUserStatus(payload.status);
  const maxSessions = payload?.maxSessions === undefined ? undefined : normalizeMaxSessions(payload.maxSessions);
  const expiresAt = payload?.expiresAt === undefined ? undefined : normalizeExpiresAt(payload.expiresAt);
  if (!userId) throw new Error("用户 ID 不能为空");
  if (displayName === undefined && plan === undefined && status === undefined && maxSessions === undefined && expiresAt === undefined) {
    throw new Error("没有需要更新的用户字段");
  }
  return { userId, displayName, plan, status, maxSessions, expiresAt };
}

function parseAdminUserDeletePayload(payload) {
  const userId = String(payload?.userId || payload?.id || "").trim();
  const confirmValue = String(payload?.confirmAccount || payload?.confirm_account || payload?.confirmEmail || payload?.confirm_email || "").trim();
  if (!userId) throw new Error("用户 ID 不能为空");
  if (!confirmValue) throw new Error("请输入要删除用户的账号进行确认");
  const confirmAccount = isValidEmail(confirmValue) ? normalizeEmail(confirmValue) : normalizeAccountName(confirmValue);
  return { userId, confirmAccount };
}

function parseAdminUserPasswordResetPayload(payload) {
  const userId = String(payload?.userId || payload?.id || "").trim();
  const password = normalizePassword(payload?.password);
  if (!userId) throw new Error("用户 ID 不能为空");
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(passwordError);
  return { userId, password };
}

function isAuthUserNotFoundError(err) {
  const message = String(err?.message || err || "").toLowerCase();
  return message.includes("user not found") || message.includes("not found");
}

function parseAuthProfilePayload(payload) {
  const authUserId = String(payload?.authUserId || payload?.auth_user_id || payload?.id || "").trim();
  const email = normalizeEmail(payload?.email);
  const displayName = String(payload?.displayName || payload?.display_name || "").trim().slice(0, 120);
  if (!authUserId) throw new Error("Supabase Auth user id is required");
  if (!email || !isValidEmail(email)) throw new Error("valid email is required");
  return { authUserId, email, displayName };
}

function parseProviderBudgetAdjustmentPayload(payload) {
  const providerKey = String(payload?.providerKey || "comfyui").trim().toLowerCase();
  const mode = String(payload?.mode || "deduct").trim().toLowerCase();
  const amount = Number(payload?.amount ?? payload?.balance ?? 0);
  const unit = String(payload?.unit || "credits").trim().slice(0, 32) || "credits";
  const note = String(payload?.note || "").trim().slice(0, 500);
  if (!providerKey) throw new Error("Provider 不能为空");
  if (!["add", "deduct", "set"].includes(mode)) throw new Error("不支持的手动总余额操作");
  if (!Number.isFinite(amount)) throw new Error("手动总余额变更值必须是数字");
  if (amount < 0) throw new Error("手动总余额变更值不能小于 0");
  return { providerKey, mode, amount, unit, note };
}

function parseCanonicalCreditAmount(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,13})\.\d{6}$/.test(value)) {
    throw new Error("canonical credit amount is invalid");
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("canonical credit amount is invalid");
  return { amountText: value, amount };
}

function parseComfyUsageSettlementPayload(payload) {
  const userId = String(payload?.userId || payload?.user_id || "").trim();
  const promptId = String(payload?.promptId || payload?.prompt_id || "").trim().slice(0, 160);
  const usageKey = String(payload?.usageKey || payload?.usage_key || (promptId ? `comfyui:${promptId}` : "")).trim().slice(0, 200);
  const providerKey = String(payload?.providerKey || payload?.provider_key || "comfyui").trim().toLowerCase();
  const modelKey = String(payload?.modelKey || payload?.model_key || "comfyui-workflow").trim().slice(0, 120);
  const taskType = String(payload?.taskType || payload?.task_type || "local_workflow_video").trim().slice(0, 100);
  const estimatedCreditCost = Number(payload?.estimatedCreditCost ?? payload?.estimated_credit_cost ?? 0);
  const requestedPricingSource = String(payload?.pricingSource || payload?.pricing_source || "").trim().slice(0, 120);
  const exactImagePricing = taskType === "local_workflow_image" && requestedPricingSource === "comfy_api_exact_price_v1";
  const exactAmount = exactImagePricing
    ? parseCanonicalCreditAmount(payload?.chargeAmount ?? payload?.charge_amount)
    : null;
  const chargeAmount = exactAmount
    ? exactAmount.amountText
    : Math.ceil(Number(payload?.chargeAmount ?? payload?.charge_amount ?? payload?.creditCost ?? payload?.credit_cost ?? 0));
  const chargeValue = exactAmount ? exactAmount.amount : chargeAmount;
  const pricingSource = String(requestedPricingSource || (chargeValue > 0 ? "workflow" : "unknown")).trim().slice(0, 120) || "unknown";
  const pricingDetails = payload?.pricingDetails && typeof payload.pricingDetails === "object" && !Array.isArray(payload.pricingDetails)
    ? payload.pricingDetails
    : {};
  if (!userId) throw new Error("ComfyUI usage user id is required");
  if (!promptId) throw new Error("ComfyUI usage prompt id is required");
  if (!usageKey || usageKey.length > 200) throw new Error("ComfyUI usage key is invalid");
  if (providerKey !== "comfyui") throw new Error("ComfyUI usage provider must be comfyui");
  if (!Number.isFinite(estimatedCreditCost) || estimatedCreditCost < 0) throw new Error("ComfyUI estimated credit cost is invalid");
  if (exactAmount ? chargeValue < 0 : (!Number.isInteger(chargeAmount) || chargeAmount < 0)) throw new Error("ComfyUI charge amount is invalid");
  return {
    userId,
    promptId,
    usageKey,
    providerKey,
    modelKey,
    taskType,
    estimatedCreditCost,
    chargeAmount,
    pricingSource,
    pricingDetails
  };
}

function normalizeProviderQuotaKey(value) {
  const providerKey = String(value || "grok").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80);
  if (!providerKey) throw new Error("Provider 不能为空");
  return providerKey;
}

function providerQuotaSettingKey(providerKey, userId) {
  return `${PROVIDER_QUOTA_PREFIX}${normalizeProviderQuotaKey(providerKey)}_${String(userId || "").trim()}`;
}

function parseProviderQuotaPayload(payload) {
  const userId = String(payload?.userId || payload?.user_id || "").trim();
  const providerKey = normalizeProviderQuotaKey(payload?.providerKey || payload?.provider_key || "grok");
  const allocatedCount = Number(payload?.allocatedCount ?? payload?.allocated_count ?? payload?.count ?? 0);
  const note = String(payload?.note || "").trim().slice(0, 500);
  if (!userId) throw new Error("请选择用户");
  if (!Number.isInteger(allocatedCount) || allocatedCount < 0) throw new Error("分配次数必须是大于等于 0 的整数");
  return { userId, providerKey, allocatedCount, note };
}

function normalizeProviderQuotaRecord(setting, user, providerKey) {
  const value = setting?.value && typeof setting.value === "object" ? setting.value : {};
  const allocatedCount = Math.max(0, Number(value.allocated_count ?? value.allocatedCount ?? 0) || 0);
  const usedCount = Math.max(0, Number(value.used_count ?? value.usedCount ?? 0) || 0);
  const reservedCount = Math.max(0, Number(value.reserved_count ?? value.reservedCount ?? 0) || 0);
  const recentCalls = Array.isArray(value.recent_calls)
    ? value.recent_calls.filter((item) => item && typeof item === "object").slice(-50)
    : [];
  const userId = String(user?.id || value.user_id || "").trim();
  const email = user?.email || value.email || "";
  const displayName = user?.display_name || value.display_name || "";
  const normalizedProviderKey = normalizeProviderQuotaKey(value.provider_key || providerKey || "grok");
  return {
    key: setting?.key || providerQuotaSettingKey(normalizedProviderKey, userId),
    user_id: userId,
    email,
    display_name: displayName,
    provider_key: normalizedProviderKey,
    allocated_count: allocatedCount,
    used_count: usedCount,
    reserved_count: reservedCount,
    remaining_count: Math.max(0, allocatedCount - usedCount - reservedCount),
    recent_calls: recentCalls,
    note: value.note || "",
    updated_at: value.updated_at || setting?.updated_at || ""
  };
}

function normalizeProviderStatus(value) {
  const status = String(value || "disabled").trim().toLowerCase();
  if (!["enabled", "disabled"].includes(status)) throw new Error("不支持的 Provider 状态");
  return status;
}

function normalizeTaskStatus(value) {
  const status = String(value || "queued").trim().toLowerCase();
  if (!["queued", "running", "success", "failed", "cancelled"].includes(status)) {
    throw new Error("不支持的任务状态");
  }
  return status;
}

function normalizeProviderKey(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80);
  if (!key) throw new Error("Provider key 不能为空");
  return key;
}

function normalizeModelKey(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, "_").slice(0, 120);
  if (!key) throw new Error("Model key 不能为空");
  return key;
}

function parseBillingMultiplier(value, fallback = 1) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("计费倍率必须是大于等于 0 的数字");
  return parsed;
}

function parseAdminAiProviderPayload(payload) {
  if (payload?.apiKey || payload?.api_key || payload?.secret || payload?.secretKey) {
    throw new Error("不要提交真实 API Key；RunningHub Key 只写入后台环境变量");
  }
  const providerKey = normalizeProviderKey(payload?.providerKey || payload?.provider_key);
  if (providerKey !== "runninghub") {
    throw new Error("在线供应商记录只允许 RunningHub；ComfyUI、Grok 与 Google 不再写入");
  }
  const name = String(payload?.name || providerKey).trim().slice(0, 120);
  const status = normalizeProviderStatus(payload?.status);
  const billingMultiplier = parseBillingMultiplier(payload?.billingMultiplier ?? payload?.billing_multiplier, 1);
  const apiKeySecretRef = String(payload?.apiKeySecretRef || payload?.api_key_secret_ref || "").trim().slice(0, 200);
  return { providerKey, name, status, billingMultiplier, apiKeySecretRef };
}

function parseAdminAiModelPayload(payload) {
  const providerId = String(payload?.providerId || payload?.provider_id || "").trim();
  const providerKey = payload?.providerKey || payload?.provider_key
    ? normalizeProviderKey(payload.providerKey || payload.provider_key)
    : "";
  const modelKey = normalizeModelKey(payload?.modelKey || payload?.model_key);
  const modelName = String(payload?.modelName || payload?.model_name || modelKey).trim().slice(0, 160);
  const purpose = String(payload?.purpose || "").trim().slice(0, 160);
  const status = normalizeProviderStatus(payload?.status);
  const isDefault = Boolean(payload?.isDefault ?? payload?.is_default ?? false);
  const billingMultiplier = parseBillingMultiplier(payload?.billingMultiplier ?? payload?.billing_multiplier, 1);
  if (!providerId && !providerKey) throw new Error("请选择 Provider");
  return { providerId, providerKey, modelKey, modelName, purpose, status, isDefault, billingMultiplier };
}

function parseSystemSettingPayload(payload) {
  const key = String(payload?.key || "").trim().slice(0, 120);
  if (!key) throw new Error("设置 key 不能为空");
  if (!/^[a-z0-9_.:-]+$/i.test(key)) throw new Error("设置 key 只能包含字母、数字、下划线、点、冒号和短横线");
  const value = payload?.value;
  if (value === undefined) throw new Error("设置 value 不能为空");
  return { key, value };
}

function getAdminClient() {
  const env = readAdminSupabaseEnv();
  if (!env.configured) return { client: null, env, status: "mock" };

  const envKey = `${env.supabaseUrl}|${env.serviceRoleKey}`;
  if (cachedClient && cachedClientEnvKey === envKey) {
    return { client: cachedClient, env, status: "connected" };
  }

  try {
    cachedClient = createClient(env.supabaseUrl, env.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      realtime: {
        transport: WebSocket
      }
    });
    cachedClientEnvKey = envKey;
    logAdminData("info", "Supabase client initialized", { supabaseUrl: env.supabaseUrl });
    return { client: cachedClient, env, status: "connected" };
  } catch (err) {
    cachedClient = null;
    cachedClientEnvKey = "";
    return { client: null, env, status: "error", error: err };
  }
}

async function readTable(tableName, selectFields, options = {}) {
  const startedAt = Date.now();
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") {
      const result = mockResult(tableName, selectFields, options, durationMs);
      logAdminData("info", `read ${tableName}`, {
        source: result.source,
        status: result.status,
        rows: result.records.length,
        durationMs,
        reason: result.reason
      });
      return result;
    }
    const result = supabaseErrorResult(tableName, clientState.error || "client initialization failed", selectFields, options, durationMs);
    logAdminData("error", `read ${tableName} failed`, {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  try {
    let query = clientState.client.from(tableName).select(selectFields).limit(options.limit || DEFAULT_LIMIT);
    if (options.orderBy) {
      query = query.order(options.orderBy, { ascending: Boolean(options.ascending) });
    }
    const { data, error } = await query;
    const durationMs = Date.now() - startedAt;
    if (error && shouldRetryLegacySelect(error, options)) {
      let fallbackQuery = clientState.client.from(tableName).select(options.fallbackSelect).limit(options.limit || DEFAULT_LIMIT);
      if (options.orderBy) {
        fallbackQuery = fallbackQuery.order(options.orderBy, { ascending: Boolean(options.ascending) });
      }
      const fallback = await fallbackQuery;
      const fallbackDurationMs = Date.now() - startedAt;
      if (!fallback.error) {
        const result = supabaseResult(tableName, fallback.data, options.fallbackSelect, { ...options, usedFallbackSelect: true }, fallbackDurationMs);
        logAdminData("info", `read ${tableName}`, {
          source: result.source,
          status: result.status,
          rows: result.records.length,
          durationMs: fallbackDurationMs,
          usedFallbackSelect: true
        });
        return result;
      }
    }
    if (error) {
      const result = supabaseErrorResult(tableName, error, selectFields, options, durationMs);
      logAdminData("error", `read ${tableName} failed`, {
        source: result.source,
        status: result.status,
        durationMs,
        error: result.error
      });
      return result;
    }
    const result = supabaseResult(tableName, data, selectFields, options, durationMs);
    logAdminData("info", `read ${tableName}`, {
      source: result.source,
      status: result.status,
      rows: result.records.length,
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = supabaseErrorResult(tableName, err, selectFields, options, durationMs);
    logAdminData("error", `read ${tableName} failed`, {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }
}

async function readSingleBy(tableName, selectFields, columnName, value, options = {}) {
  const startedAt = Date.now();
  const clientState = getAdminClient();
  const safeOptions = { ...options, filter: `${columnName}=eq.${String(value || "")}` };
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") {
      const record = null;
      const result = singleRecordResult("unconfigured", "unconfigured", tableName, record, selectFields, safeOptions, durationMs);
      logAdminData("info", `read ${tableName} single`, {
        source: result.source,
        status: result.status,
        found: Boolean(record),
        durationMs,
        reason: "supabase_env_missing"
      });
      return result;
    }
    const result = supabaseErrorResult(tableName, clientState.error || "client initialization failed", selectFields, safeOptions, durationMs);
    logAdminData("error", `read ${tableName} single failed`, {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  try {
    const { data, error } = await clientState.client
      .from(tableName)
      .select(selectFields)
      .eq(columnName, value)
      .maybeSingle();
    const durationMs = Date.now() - startedAt;
    if (error) {
      const result = supabaseErrorResult(tableName, error, selectFields, safeOptions, durationMs);
      logAdminData("error", `read ${tableName} single failed`, {
        source: result.source,
        status: result.status,
        durationMs,
        error: result.error
      });
      return result;
    }
    const result = singleRecordResult("supabase", "connected", tableName, data || null, selectFields, safeOptions, durationMs);
    logAdminData("info", `read ${tableName} single`, {
      source: result.source,
      status: result.status,
      found: Boolean(data),
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = supabaseErrorResult(tableName, err, selectFields, safeOptions, durationMs);
    logAdminData("error", `read ${tableName} single failed`, {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }
}

function getAdminUsers() {
  return readTable("users", adminQueries.users.listSelect, { ...adminQueries.users, fallbackSelect: adminQueries.users.select });
}

function getAdminCredits() {
  return readTable("credits", adminQueries.credits.select, adminQueries.credits);
}

// ---------------------------------------------------------------------------
// 算力节点
//
// The Web line's GPU pool. A machine joins by installing NovaFlowWorkerSetup.exe
// and pasting a one-time registration code minted here - never by an admin
// editing the database, configuring an IP or touching the source.
//
// The code's plaintext is returned once and never stored; the row holds
// sha256("novaflow-web-registration-code:v1:" + code), byte-compatible with
// what the Web control plane computes when a worker presents one.

const WORKER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1

function workerCodeChunk() {
  const bytes = require("node:crypto").randomBytes(6);
  return [...bytes].map((b) => WORKER_CODE_ALPHABET[b % WORKER_CODE_ALPHABET.length]).join("");
}

function hashWorkerRegistrationCode(code) {
  return require("node:crypto")
    .createHash("sha256")
    .update("novaflow-web-registration-code:v1:" + String(code), "utf8")
    .digest("hex");
}

function getAdminGpuWorkers() {
  return readTable("gpu_workers", adminQueries.gpu_workers.select, adminQueries.gpu_workers);
}

async function getAdminWebTaskUsage(options = {}) {
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit)) || 50));
  const offset = Math.max(0, Math.min(1000000000, Math.floor(Number(options.offset)) || 0));
  const selectFields = adminQueries.web_compute_usage.select;
  const clientState = getAdminClient();
  const startedAt = Date.now();
  if (!clientState.client) return supabaseErrorResult("web_compute_usage", "请配置后台连接", selectFields, options, 0);
  const userId = String(options.userId || "");
  if (userId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return supabaseErrorResult("web_compute_usage", "用户编号无效", selectFields, {}, 0);
  const status = String(options.status || "");
  if (status && !["created","queued","assigned","uploading","processing","completed","failed","cancelled","expired"].includes(status)) return supabaseErrorResult("web_compute_usage", "任务状态无效", selectFields, {}, 0);
  try {
    let query = clientState.client.from("web_compute_usage").select(selectFields, { count: "exact" });
    if (userId) query = query.eq("user_id", userId);
    if (status) query = query.eq("status", status);
    const { data, error, count } = await query.order("created_at", { ascending:false }).order("id", { ascending:false }).range(offset, offset + limit - 1);
    if (error) throw error;
    return { ...supabaseResult("web_compute_usage", data || [], selectFields, {limit,offset}, Date.now()-startedAt), total:Number(count || 0), offset, limit, hasMore:offset+(data || []).length<Number(count || 0) };
  } catch (err) {
    return supabaseErrorResult("web_compute_usage", "使用记录读取失败，请确认已升级记录保留服务：" + String(err?.message || err), selectFields, {}, Date.now()-startedAt);
  }
}

async function getAdminComputeUsageSummary() {
  const startedAt = Date.now(), state = getAdminClient();
  if (!state.client) return supabaseErrorResult("web_compute_usage", "请配置后台连接", "", {}, 0);
  try {
    const {data,error} = await state.client.rpc("admin_compute_usage_summary");
    if (error) throw error;
    return supabaseResult("web_compute_usage",data || [],"",{},Date.now()-startedAt);
  } catch (err) { return supabaseErrorResult("web_compute_usage","使用记录读取失败，请确认已升级记录保留服务："+String(err?.message || err),"",{},Date.now()-startedAt); }
}

function getAdminWorkerRegistrationCodes() {
  return readTable(
    "web_worker_registration_codes",
    adminQueries.web_worker_registration_codes.select,
    adminQueries.web_worker_registration_codes
  );
}

async function createAdminWorkerRegistrationCode(payload) {
  const startedAt = Date.now();
  const operation = "web_worker_registration_codes.create";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") return adminWriteMockResult(operation, durationMs);
    return adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
  }

  const ownerId = String(payload?.ownerId || payload?.owner_id || "").trim();
  if (!ownerId) return adminWriteErrorResult(operation, "请选择这批算力归属的用户", Date.now() - startedAt);
  const label = String(payload?.label || "").trim().slice(0, 80);
  const maxUses = Math.max(1, Math.min(50, Number(payload?.maxUses || payload?.max_uses || 1) || 1));
  const days = Math.max(1, Math.min(90, Number(payload?.validDays || payload?.valid_days || 7) || 7));
  // Which tier the machines this code admits join as: 普通 unless asked.
  const tier = normalizeGpuWorkerTier(payload?.tier ?? payload?.nodeTier ?? payload?.node_tier);

  const code = "NFW-" + workerCodeChunk() + "-" + workerCodeChunk();
  const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

  try {
    const { data, error } = await clientState.client
      .from("web_worker_registration_codes")
      .insert({
        code_hash: hashWorkerRegistrationCode(code),
        owner_id: ownerId,
        label,
        tier,
        max_uses: maxUses,
        expires_at: expiresAt
      })
      .select(adminQueries.web_worker_registration_codes.select)
      .maybeSingle();
    if (error) throw error;
    const durationMs = Date.now() - startedAt;
    logAdminData("info", "create worker registration code", {
      source: "supabase", status: "connected", ownerId, tier, maxUses, days, durationMs
    });
    return {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      record: data,
      // Shown once. Nothing stores it, so it cannot be looked up again.
      registrationCode: code,
      expiresAt
    };
  } catch (err) {
    const result = adminWriteErrorResult(operation, err, Date.now() - startedAt);
    logAdminData("error", "create worker registration code failed", {
      source: result.source, status: result.status, ownerId, error: result.error
    });
    return result;
  }
}

async function revokeAdminWorkerRegistrationCode(payload) {
  const startedAt = Date.now();
  const operation = "web_worker_registration_codes.revoke";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") return adminWriteMockResult(operation, durationMs);
    return adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
  }

  const codeHash = String(payload?.codeHash || payload?.code_hash || payload?.id || "").trim();
  if (!codeHash) return adminWriteErrorResult(operation, "缺少注册码标识", Date.now() - startedAt);

  try {
    // Expire rather than delete: a code that was already spent stays in the
    // history, and a revoked one is visibly revoked instead of vanishing.
    const { data, error } = await clientState.client
      .from("web_worker_registration_codes")
      .update({ expires_at: new Date().toISOString() })
      .eq("code_hash", codeHash)
      .select(adminQueries.web_worker_registration_codes.select)
      .maybeSingle();
    if (error) throw error;
    return {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs: Date.now() - startedAt,
      record: data
    };
  } catch (err) {
    return adminWriteErrorResult(operation, err, Date.now() - startedAt);
  }
}

async function setAdminGpuWorkerStatus(payload) {
  const startedAt = Date.now();
  const operation = "gpu_workers.set_status";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") return adminWriteMockResult(operation, durationMs);
    return adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
  }

  const id = String(payload?.id || "").trim();
  const status = String(payload?.status || "").trim();
  if (!id) return adminWriteErrorResult(operation, "缺少算力节点 id", Date.now() - startedAt);
  // Only the two an operator has any business setting. Taking a node out of
  // service is reversible; idle/busy belong to the worker itself.
  if (!["maintenance", "idle"].includes(status)) {
    return adminWriteErrorResult(operation, "只能停用或恢复算力节点", Date.now() - startedAt);
  }

  try {
    const { data, error } = await clientState.client
      .from("gpu_workers")
      .update({ enabled: status === "idle", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(adminQueries.gpu_workers.select)
      .maybeSingle();
    if (error) throw workerPolicyError(error);
    if (!data) throw new Error("算力节点不存在，设置未保存");
    logAdminData("info", "set gpu worker status", { source: "supabase", status: "connected", id, enabled: status === "idle" });
    return {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs: Date.now() - startedAt,
      record: data
    };
  } catch (err) {
    return adminWriteErrorResult(operation, err, Date.now() - startedAt);
  }
}

function workerPolicyError(error) {
  const message = String(error?.message || error || "");
  if (/enabled|name_managed|sharing_scope|allowed_user_ids|schema cache|does not exist|could not find/i.test(message)) {
    return new Error("算力机器权限设置尚未迁移，请先应用算力访问策略数据库迁移后重试；本次未保存。");
  }
  return error;
}

async function setAdminGpuWorkerAccessPolicy(payload) {
  const startedAt = Date.now();
  const operation = "gpu_workers.set_access_policy";
  const fail = (error) => adminWriteErrorResult(operation, error, Date.now() - startedAt);
  const id = String(payload?.id || "").trim();
  if (!id) return fail("缺少算力节点 id");
  const workerName = typeof payload?.worker_name === "string" ? payload.worker_name.trim() : "";
  if (!workerName || workerName.length > 80) return fail("机器名称须为 1–80 个字符");
  const fields = ["enabled", "owner_enabled", "sharing_enabled"];
  if (fields.some((field) => typeof payload?.[field] !== "boolean")) return fail("启用、本人使用和对外分享必须分别设置");
  const scope = payload?.sharing_scope;
  if (!["pool", "selected"].includes(scope)) return fail("请选择共享池或指定用户");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ownerId = String(payload?.owner_id || "").trim();
  if (ownerId && !uuid.test(ownerId)) return fail("本人账号无效");
  if (!ownerId) return fail("请选择设备归属账号；关闭本人使用也需保留节点归属");
  if (!Array.isArray(payload.allowed_user_ids) || payload.allowed_user_ids.some((value) => typeof value !== "string" || !uuid.test(value))) return fail("指定用户列表无效");
  const users = [...new Set(payload.allowed_user_ids)];
  if (users.length > 200) return fail("指定用户不能超过 200 人");
  if (payload.sharing_enabled && scope === "selected" && !users.length) return fail("请至少选择一个可使用算力的账号");
  const clientState = getAdminClient();
  if (!clientState.client) return fail(clientState.error || "Supabase 未配置，不能写入");
  try {
    const { data, error } = await clientState.client.from("gpu_workers").update({
      worker_name: workerName, name_managed: true, owner_id: ownerId || null, enabled: payload.enabled, owner_enabled: payload.owner_enabled,
      sharing_enabled: payload.sharing_enabled, sharing_scope: scope,
      allowed_user_ids: users, updated_at: new Date().toISOString()
    }).eq("id", id).select(adminQueries.gpu_workers.select).maybeSingle();
    if (error) throw workerPolicyError(error);
    if (!data) throw new Error("算力节点不存在，设置未保存");
    logAdminData("info", "set gpu worker access policy", { id, enabled: payload.enabled, sharingEnabled: payload.sharing_enabled });
    return { source: "supabase", status: "connected", configured: true, ok: true, operation, durationMs: Date.now() - startedAt, record: data };
  } catch (error) { return fail(error); }
}

// Node tiers. 普通 (standard) nodes serve 中级 and 高级 accounts, 高级
// (premium) nodes serve 高级 accounts only. The scheduler in Supabase reads
// gpu_workers.tier; this only writes it.
function normalizeGpuWorkerTier(value) {
  return String(value || "").trim().toLowerCase() === "premium" ? "premium" : "standard";
}

function adminWriteResult(operation, startedAt, extra = {}) {
  return {
    source: "supabase",
    status: "connected",
    configured: true,
    operation,
    ok: true,
    durationMs: Date.now() - startedAt,
    ...extra
  };
}

// The Supabase client, or the mock/error result to hand back instead.
function adminWriteClient(operation, startedAt) {
  const clientState = getAdminClient();
  if (clientState.client) return { client: clientState.client };
  const durationMs = Date.now() - startedAt;
  if (clientState.status === "mock") return { result: adminWriteMockResult(operation, durationMs) };
  return { result: adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs) };
}

async function setAdminGpuWorkerTier(payload) {
  const startedAt = Date.now();
  const operation = "gpu_workers.set_tier";
  const { client, result } = adminWriteClient(operation, startedAt);
  if (!client) return result;

  const id = String(payload?.id || "").trim();
  if (!id) return adminWriteErrorResult(operation, "缺少算力节点 id", Date.now() - startedAt);
  const tier = normalizeGpuWorkerTier(payload?.tier);

  try {
    const { data, error } = await client
      .from("gpu_workers")
      .update({ tier, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(adminQueries.gpu_workers.select)
      .maybeSingle();
    if (error) throw error;
    logAdminData("info", "set gpu worker tier", { source: "supabase", status: "connected", id, tier });
    return adminWriteResult(operation, startedAt, { record: data });
  } catch (err) {
    return adminWriteErrorResult(operation, err, Date.now() - startedAt);
  }
}

// Heartbeats stop when a Worker is closed; after this long the node counts
// as gone for the purpose of deleting it. Same window the control plane uses
// to call a node offline.
const GPU_WORKER_OFFLINE_AFTER_MS = 2 * 60 * 1000;

// Removing a node row. worker_models go with it (cascade); finished tasks keep
// their history with assigned_worker_id cleared (set null). A node that is
// still heartbeating is refused: stop it first, so a Worker that is running
// does not find its identity gone mid-task.
async function deleteAdminGpuWorker(payload) {
  const startedAt = Date.now();
  const operation = "gpu_workers.delete";
  const { client, result } = adminWriteClient(operation, startedAt);
  if (!client) return result;

  const id = String(payload?.id || "").trim();
  if (!id) return adminWriteErrorResult(operation, "缺少算力节点 id", Date.now() - startedAt);

  try {
    const { data: worker, error: readError } = await client
      .from("gpu_workers")
      .select("id,worker_name,owner_id,enabled,owner_enabled,sharing_enabled,status,last_heartbeat")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!worker) throw new Error("算力节点不存在或已删除");
    const beat = Date.parse(worker.last_heartbeat || "") || 0;
    const live = ["idle", "busy"].includes(String(worker.status || "")) && Date.now() - beat < GPU_WORKER_OFFLINE_AFTER_MS;
    const pending = !worker.owner_id && worker.enabled === false && worker.owner_enabled === false && worker.sharing_enabled === false;
    if (live && !pending) throw new Error("节点还在线，请先在助手停止节点，等它离线后再删除");

    let deletion = client
      .from("gpu_workers")
      .delete()
      .eq("id", id);
    // Recheck pending state in the write so concurrent approval cannot be deleted.
    if (pending) deletion = deletion.is("owner_id", null).eq("enabled", false).eq("owner_enabled", false).eq("sharing_enabled", false);
    const { data, error } = await deletion.select("id,worker_name");
    if (error) throw error;
    if (!(data || []).length) throw new Error("节点状态已变化或记录已删除，请刷新后重试");
    logAdminData("info", "delete gpu worker", { source: "supabase", status: "connected", id, name: worker.worker_name });
    return adminWriteResult(operation, startedAt, { deleted: (data || []).length, record: worker });
  } catch (err) {
    return adminWriteErrorResult(operation, err, Date.now() - startedAt);
  }
}

async function deleteAdminWorkerRegistrationCode(payload) {
  const startedAt = Date.now();
  const operation = "web_worker_registration_codes.delete";
  const { client, result } = adminWriteClient(operation, startedAt);
  if (!client) return result;

  const codeHash = String(payload?.codeHash || payload?.code_hash || "").trim();
  if (!codeHash) return adminWriteErrorResult(operation, "缺少注册码标识", Date.now() - startedAt);

  try {
    const { data, error } = await client
      .from("web_worker_registration_codes")
      .delete()
      .eq("code_hash", codeHash)
      .select("code_hash,label");
    if (error) throw error;
    logAdminData("info", "delete worker registration code", { source: "supabase", status: "connected", deleted: (data || []).length });
    return adminWriteResult(operation, startedAt, { deleted: (data || []).length });
  } catch (err) {
    return adminWriteErrorResult(operation, err, Date.now() - startedAt);
  }
}

// Every code that can no longer admit a machine: expired, revoked (which
// expires it) or used up. PostgREST cannot compare two columns in a filter,
// so the spent set is worked out here from the rows.
async function purgeAdminWorkerRegistrationCodes() {
  const startedAt = Date.now();
  const operation = "web_worker_registration_codes.purge";
  const { client, result } = adminWriteClient(operation, startedAt);
  if (!client) return result;

  try {
    const { collectPages: readPages } = await loadFeatureCredits();
    const rows = await readPages(async ({ offset, limit }) => {
      const { data, error } = await client
        .from("web_worker_registration_codes")
        .select("code_hash,max_uses,used_count,expires_at")
        .order("created_at", { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return data || [];
    });
    const readError = null;
    if (readError) throw readError;
    const now = Date.now();
    const spent = (rows || [])
      .filter((row) => Date.parse(row.expires_at) <= now || Number(row.used_count || 0) >= Number(row.max_uses || 1))
      .map((row) => row.code_hash);
    if (!spent.length) return adminWriteResult(operation, startedAt, { deleted: 0 });
    const { data, error } = await client
      .from("web_worker_registration_codes")
      .delete()
      .in("code_hash", spent)
      .select("code_hash");
    if (error) throw error;
    logAdminData("info", "purge worker registration codes", { source: "supabase", status: "connected", deleted: (data || []).length });
    return adminWriteResult(operation, startedAt, { deleted: (data || []).length });
  } catch (err) {
    return adminWriteErrorResult(operation, err, Date.now() - startedAt);
  }
}

function getAdminAiProviders() {
  return readTable("ai_providers", adminQueries.ai_providers.select, adminQueries.ai_providers);
}

function getAdminAiModels() {
  return disabledTableResult("ai_models", "模型管理已在轻量后台模式中关闭；Provider 转发阶段不维护模型表");
}

function getAdminAiTasks() {
  return disabledTableResult("ai_tasks", "任务记录已在轻量后台模式中关闭");
}

function getAdminSystemSettings() {
  return readTable("system_settings", adminQueries.system_settings.select, adminQueries.system_settings);
}

function getAdminUserByEmail(email) {
  return readSingleBy("users", adminQueries.users.select, "email", String(email || "").trim().toLowerCase(), {
    purpose: "auth_login"
  });
}

function getAdminUserByAccount(account) {
  let email;
  try {
    email = accountToAuthEmail(account);
  } catch (err) {
    return Promise.resolve({
      source: "supabase",
      status: "error",
      configured: true,
      record: null,
      error: `${ERROR_PREFIX}: ${sanitizeError(err)}`,
      durationMs: 0,
      query: queryMeta("users", adminQueries.users.select, { purpose: "auth_login" })
    });
  }
  return getAdminUserByEmail(email);
}

function getAdminUserById(userId) {
  return readSingleBy("users", adminQueries.users.select, "id", String(userId || "").trim(), {
    purpose: "session_user"
  });
}

function getAdminCreditByUserId(userId) {
  return readSingleBy("credits", adminQueries.credits.select, "user_id", String(userId || "").trim(), {
    purpose: "credit_balance"
  });
}

async function syncAdminAuthUserProfile(payload) {
  const startedAt = Date.now();
  const operation = "auth.profile.sync";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") {
      const result = adminWriteMockResult(operation, durationMs);
      logAdminData("info", "sync auth profile skipped", {
        source: result.source,
        status: result.status,
        durationMs,
        reason: "supabase_env_missing"
      });
      return result;
    }
    const result = adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
    logAdminData("error", "sync auth profile failed", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  let parsed;
  try {
    parsed = parseAuthProfilePayload(payload);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = localWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "sync auth profile rejected", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  try {
    const now = new Date().toISOString();
    const { data: userById, error: idError } = await clientState.client
      .from("users")
      .select(adminQueries.users.select)
      .eq("id", parsed.authUserId)
      .maybeSingle();
    if (idError) throw idError;

    let user = userById || null;
    let match = user ? "id" : "";
    let createdUser = false;

    if (!user) {
      const { data: userByEmail, error: emailError } = await clientState.client
        .from("users")
        .select(adminQueries.users.select)
        .eq("email", parsed.email)
        .maybeSingle();
      if (emailError) throw emailError;
      user = userByEmail || null;
      match = user ? "email" : "";
    }

    if (user) {
      const patch = {
        email: parsed.email,
        updated_at: now
      };
      if (parsed.displayName && !user.display_name) patch.display_name = parsed.displayName;
      const { data: updatedUser, error: updateError } = await clientState.client
        .from("users")
        .update(patch)
        .eq("id", user.id)
        .select(adminQueries.users.select)
        .maybeSingle();
      if (updateError) throw updateError;
      user = updatedUser || user;
    } else {
      const { data: insertedUser, error: insertError } = await clientState.client
        .from("users")
        .insert({
          id: parsed.authUserId,
          email: parsed.email,
          display_name: parsed.displayName || null,
          role: "user",
          plan: "trial",
          status: "active",
          updated_at: now
        })
        .select(adminQueries.users.select)
        .maybeSingle();
      if (insertError) throw insertError;
      if (!insertedUser?.id) throw new Error("auth profile created but user id was not returned");
      user = insertedUser;
      match = "created";
      createdUser = true;
    }

    const { data: creditRows, error: creditReadError } = await clientState.client
      .from("credits")
      .select("id,user_id,balance,updated_at")
      .eq("user_id", user.id)
      .limit(2);
    if (creditReadError) throw creditReadError;
    if ((creditRows || []).length > 1) {
      throw new Error("user has duplicate credit balance rows");
    }

    let credit = (creditRows || [])[0] || null;
    let createdCredit = false;
    if (!credit) {
      const { data: insertedCredit, error: creditInsertError } = await clientState.client
        .from("credits")
        .insert({
          user_id: user.id,
          balance: 0,
          updated_at: now
        })
        .select("id,user_id,balance,updated_at")
        .maybeSingle();
      if (creditInsertError) throw creditInsertError;
      credit = insertedCredit || null;
      createdCredit = true;
    }

    const durationMs = Date.now() - startedAt;
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      user,
      credit,
      auth: {
        provider: "supabase_auth",
        match,
        createdUser,
        createdCredit
      }
    };
    logAdminData("info", "sync auth profile", {
      source: result.source,
      status: result.status,
      userId: user.id,
      email: user.email,
      match,
      createdUser,
      createdCredit,
      creditBalance: Number(credit?.balance || 0),
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = localWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "sync auth profile failed", {
      source: result.source,
      status: result.status,
      email: parsed.email,
      durationMs,
      error: result.error
    });
    return result;
  }
}

async function createAdminUser(payload) {
  const startedAt = Date.now();
  const operation = "users.create";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") {
      const result = adminWriteMockResult(operation, durationMs);
      logAdminData("info", "create user skipped", {
        source: result.source,
        status: result.status,
        durationMs,
        reason: "supabase_env_missing"
      });
      return result;
    }
    const result = adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
    logAdminData("error", "create user failed", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  let parsed;
  try {
    parsed = parseAdminUserCreatePayload(payload);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = localWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "create user rejected", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  try {
    const now = new Date().toISOString();
    let authUser = null;
    let insertedPublicUser = null;
    const { data: existingUser, error: existingError } = await clientState.client
      .from("users")
      .select("id,email")
      .eq("email", parsed.email)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingUser) throw new Error("该账号已存在后台用户");

    try {
      const { data: authData, error: authError } = await clientState.client.auth.admin.createUser({
        email: parsed.email,
        password: parsed.password,
        email_confirm: true,
        user_metadata: {
          novaflow_account: parsed.accountName,
          display_name: parsed.displayName || parsed.accountName
        }
      });
      if (authError) {
        const message = sanitizeError(authError);
        if (/already|registered|exists/i.test(message)) throw new Error("该账号登录身份已存在");
        throw authError;
      }
      authUser = authData?.user || null;
      if (!authUser?.id) throw new Error("Supabase Auth 创建成功但未返回用户 ID");

      const { data: user, error: userError } = await clientState.client
        .from("users")
        .insert({
          id: authUser.id,
          email: parsed.email,
          display_name: parsed.displayName || parsed.accountName,
          role: "user",
          plan: parsed.plan,
          status: parsed.status,
          max_sessions: parsed.maxSessions,
          expires_at: parsed.expiresAt,
          updated_at: now
        })
        .select(adminQueries.users.select)
        .maybeSingle();
      if (userError) throw userError;
      if (!user?.id) throw new Error("用户创建成功但未返回 ID");
      insertedPublicUser = user;
    } catch (err) {
      if (authUser?.id && !insertedPublicUser?.id) {
        try {
          await clientState.client.auth.admin.deleteUser(authUser.id);
        } catch {
          void 0;
        }
      }
      throw err;
    }

    const { data: credit, error: creditError } = await clientState.client
      .from("credits")
      .insert({
        user_id: insertedPublicUser.id,
        balance: parsed.initialCredits,
        updated_at: now
      })
      .select("id,user_id,balance,updated_at")
      .maybeSingle();
    if (creditError) {
      try {
        await clientState.client.from("users").delete().eq("id", insertedPublicUser.id);
      } catch {
        void 0;
      }
      try {
        if (authUser?.id) await clientState.client.auth.admin.deleteUser(authUser.id);
      } catch {
        void 0;
      }
      throw creditError;
    }

    const durationMs = Date.now() - startedAt;
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      user: insertedPublicUser,
      credit,
      auth: {
        provider: "supabase_auth",
        created: true,
        accountName: parsed.accountName,
        email: parsed.email
      }
    };
    logAdminData("info", "create user", {
      source: result.source,
      status: result.status,
      userId: insertedPublicUser.id,
      account: parsed.accountName,
      plan: insertedPublicUser.plan,
      userStatus: insertedPublicUser.status,
      initialCredits: parsed.initialCredits,
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = localWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "create user failed", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }
}

async function updateAdminUser(payload) {
  const startedAt = Date.now();
  const operation = "users.update";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") {
      const result = adminWriteMockResult(operation, durationMs);
      logAdminData("info", "update user skipped", {
        source: result.source,
        status: result.status,
        durationMs,
        reason: "supabase_env_missing"
      });
      return result;
    }
    const result = adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
    logAdminData("error", "update user failed", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  let parsed;
  try {
    parsed = parseAdminUserUpdatePayload(payload);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "update user rejected", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  try {
    const patch = { updated_at: new Date().toISOString() };
    if (parsed.displayName !== undefined) patch.display_name = parsed.displayName || null;
    if (parsed.plan !== undefined) patch.plan = parsed.plan;
    if (parsed.status !== undefined) patch.status = parsed.status;
    if (parsed.maxSessions !== undefined) patch.max_sessions = parsed.maxSessions;
    if (parsed.expiresAt !== undefined) patch.expires_at = parsed.expiresAt;

    const { data: user, error } = await clientState.client
      .from("users")
      .update(patch)
      .eq("id", parsed.userId)
      .select(adminQueries.users.select)
      .maybeSingle();
    if (error) throw error;
    if (!user) throw new Error("用户不存在，无法更新");
    // A lowered limit takes effect now, not at the next login.
    if (parsed.maxSessions !== undefined) await trimUserSessions(clientState.client, user.id, parsed.maxSessions, "limit");

    const durationMs = Date.now() - startedAt;
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      user
    };
    logAdminData("info", "update user", {
      source: result.source,
      status: result.status,
      userId: user.id,
      plan: user.plan,
      userStatus: user.status,
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "update user failed", {
      source: result.source,
      status: result.status,
      userId: parsed.userId,
      durationMs,
      error: result.error
    });
    return result;
  }
}

async function findAdminAuthUserForDelete(client, user) {
  let authUser = null;
  try {
    const { data, error } = await client.auth.admin.getUserById(user.id);
    if (error) {
      if (!isAuthUserNotFoundError(error)) throw error;
    } else if (data?.user?.id) {
      authUser = data.user;
    }
  } catch (err) {
    if (!isAuthUserNotFoundError(err)) throw err;
  }

  if (authUser) {
    const authEmail = String(authUser.email || "").toLowerCase();
    const publicEmail = String(user.email || "").toLowerCase();
    if (authEmail && publicEmail && authEmail !== publicEmail) {
      throw new Error("Auth 用户邮箱与后台用户邮箱不一致，已中止删除");
    }
    return authUser;
  }

  try {
    const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    return (data?.users || []).find((item) => String(item.email || "").toLowerCase() === String(user.email || "").toLowerCase()) || null;
  } catch (err) {
    if (isAuthUserNotFoundError(err)) return null;
    throw err;
  }
}

async function verifyAdminUserDeleted(client, userId, authUserId) {
  const { data: publicUser, error: publicUserError } = await client
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (publicUserError) throw publicUserError;
  if (publicUser?.id) throw new Error("用户删除请求完成，但 public.users 仍存在");

  if (authUserId) {
    const { data: authData, error: authError } = await client.auth.admin.getUserById(authUserId);
    if (authError && !isAuthUserNotFoundError(authError)) throw authError;
    if (authData?.user?.id) throw new Error("用户删除请求完成，但 Supabase Auth 身份仍存在");
  }
}

function verifyAdminUserPasswordReset(resetData, authUser) {
  const resetUserId = resetData?.user?.id || "";
  if (!resetUserId) throw new Error("Supabase Auth 未返回密码重置用户");
  if (authUser?.id && resetUserId !== authUser.id) {
    throw new Error("Supabase Auth 返回的密码重置用户与目标用户不一致");
  }
  return {
    matched: true,
    passwordReset: true,
    authUserId: resetUserId
  };
}

async function deleteAdminUser(payload) {
  const startedAt = Date.now();
  const operation = "users.delete";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") {
      const result = adminWriteMockResult(operation, durationMs);
      logAdminData("info", "delete user skipped", {
        source: result.source,
        status: result.status,
        durationMs,
        reason: "supabase_env_missing"
      });
      return result;
    }
    const result = adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
    logAdminData("error", "delete user failed", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  let parsed;
  try {
    parsed = parseAdminUserDeletePayload(payload);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "delete user rejected", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  try {
    const { data: user, error: userError } = await clientState.client
      .from("users")
      .select(adminQueries.users.select)
      .eq("id", parsed.userId)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) throw new Error("用户不存在，无法删除");
    const accountName = accountNameFromEmail(user.email);
    if (String(accountName || "").toLowerCase() !== parsed.confirmAccount) {
      throw new Error("确认账号不匹配，已中止删除");
    }

    const authUser = await findAdminAuthUserForDelete(clientState.client, user);
    // Snapshot the balance for the response. Deleting users cascades credits
    // in the database; a blocked user delete must leave both login and balance.
    const { data: deletedCredits, error: creditsError } = await clientState.client
      .from("credits")
      .select("id,user_id,balance,updated_at")
      .eq("user_id", user.id);
    if (creditsError) throw creditsError;

    const { data: deletedUser, error: deleteError } = await clientState.client
      .from("users")
      .delete()
      .eq("id", user.id)
      .select(adminQueries.users.select)
      .maybeSingle();
    if (deleteError) throw deleteError;
    if (!deletedUser) throw new Error("用户删除未返回记录，请刷新确认");

    const { data: deletedProviderQuotas, error: providerQuotaError } = await clientState.client
      .from("system_settings")
      .delete()
      .like("key", `${PROVIDER_QUOTA_PREFIX}%_${user.id}`)
      .select("key,value,updated_at");
    if (providerQuotaError) throw providerQuotaError;

    let authDeleted = false;
    if (authUser?.id) {
      const { error: authDeleteError } = await clientState.client.auth.admin.deleteUser(authUser.id);
      if (authDeleteError && !isAuthUserNotFoundError(authDeleteError)) throw authDeleteError;
      authDeleted = true;
    }
    await verifyAdminUserDeleted(clientState.client, user.id, authUser?.id || "");

    const durationMs = Date.now() - startedAt;
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      user: deletedUser,
      deletedCredits: deletedCredits || [],
      deletedProviderQuotas: deletedProviderQuotas || [],
      auth: {
        matched: Boolean(authUser?.id),
        deleted: authDeleted
      }
    };
    logAdminData("info", "delete user", {
      source: result.source,
      status: result.status,
      userId: deletedUser.id,
      account: accountNameFromEmail(deletedUser.email),
      deletedCredits: result.deletedCredits.length,
      deletedProviderQuotas: result.deletedProviderQuotas.length,
      authDeleted,
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "delete user failed", {
      source: result.source,
      status: result.status,
      userId: parsed.userId,
      durationMs,
      error: result.error
    });
    return result;
  }
}

async function resetAdminUserPassword(payload) {
  const startedAt = Date.now();
  const operation = "users.password.reset";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") {
      const result = adminWriteMockResult(operation, durationMs);
      logAdminData("info", "reset user password skipped", {
        source: result.source,
        status: result.status,
        durationMs,
        reason: "supabase_env_missing"
      });
      return result;
    }
    const result = adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
    logAdminData("error", "reset user password failed", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  let parsed;
  try {
    parsed = parseAdminUserPasswordResetPayload(payload);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "reset user password rejected", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  try {
    const { data: user, error: userError } = await clientState.client
      .from("users")
      .select(adminQueries.users.select)
      .eq("id", parsed.userId)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) throw new Error("用户不存在，无法修改密码");

    const authUser = await findAdminAuthUserForDelete(clientState.client, user);
    if (!authUser?.id) throw new Error("未找到匹配的 Supabase Auth 登录身份");

    const { data: resetData, error: resetError } = await clientState.client.auth.admin.updateUserById(authUser.id, {
      password: parsed.password
    });
    if (resetError) throw resetError;
    const authReset = verifyAdminUserPasswordReset(resetData, authUser);
    // Whoever logged in with the old password is signed out.
    authReset.sessionsSignedOut = await trimUserSessions(clientState.client, user.id, 0, "password");

    const durationMs = Date.now() - startedAt;
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      user,
      auth: authReset
    };
    logAdminData("info", "reset user password", {
      source: result.source,
      status: result.status,
      userId: user.id,
      account: accountNameFromEmail(user.email),
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "reset user password failed", {
      source: result.source,
      status: result.status,
      userId: parsed.userId,
      durationMs,
      error: result.error
    });
    return result;
  }
}

async function settleAdminComfyUsage(payload) {
  const startedAt = Date.now();
  const operation = "comfy_usage.settle";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") return adminWriteMockResult(operation, durationMs);
    return adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
  }

  let parsed;
  try {
    parsed = parseComfyUsageSettlementPayload(payload);
  } catch (err) {
    return adminWriteErrorResult(operation, err, Date.now() - startedAt);
  }

  try {
    const { data, error } = await clientState.client.rpc("settle_comfy_usage", {
      p_usage_key: parsed.usageKey,
      p_user_id: parsed.userId,
      p_prompt_id: parsed.promptId,
      p_provider_key: parsed.providerKey,
      p_model_key: parsed.modelKey,
      p_task_type: parsed.taskType,
      p_estimated_credit_cost: parsed.estimatedCreditCost,
      p_charge_amount: parsed.chargeAmount,
      p_pricing_source: parsed.pricingSource,
      p_pricing_details: parsed.pricingDetails
    });
    if (error) throw error;
    const durationMs = Date.now() - startedAt;
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      settlement: data
    };
    logAdminData("info", "settled ComfyUI usage", {
      source: result.source,
      status: data?.status || result.status,
      usageKey: parsed.usageKey,
      userId: parsed.userId,
      chargeAmount: parsed.chargeAmount,
      idempotent: Boolean(data?.idempotent),
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "settle ComfyUI usage failed", {
      usageKey: parsed.usageKey,
      userId: parsed.userId,
      chargeAmount: parsed.chargeAmount,
      durationMs,
      error: result.error
    });
    return result;
  }
}

async function adjustAdminProviderBudget(payload) {
  const startedAt = Date.now();
  const operation = "provider_budget.adjust";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") {
      const result = adminWriteMockResult(operation, durationMs);
      logAdminData("info", "adjust provider budget skipped", {
        source: result.source,
        status: result.status,
        durationMs,
        reason: "supabase_env_missing"
      });
      return result;
    }
    const result = adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
    logAdminData("error", "adjust provider budget failed", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  let parsed;
  try {
    parsed = parseProviderBudgetAdjustmentPayload(payload);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "adjust provider budget rejected", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  try {
    const key = `provider_budget_${parsed.providerKey}`;
    const { data: existing, error: readError } = await clientState.client
      .from("system_settings")
      .select("key,value,updated_at")
      .eq("key", key)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing && parsed.mode !== "set") {
      throw new Error("ComfyUI 手动总余额未保存，无法自动扣减");
    }

    const currentValue = existing?.value && typeof existing.value === "object" && !Array.isArray(existing.value)
      ? existing.value
      : {};
    const beforeBalance = Number(currentValue.balance ?? currentValue.value ?? 0);
    if (!Number.isFinite(beforeBalance)) throw new Error("ComfyUI 手动总余额不是有效数字");
    const delta = parsed.mode === "set"
      ? parsed.amount - beforeBalance
      : parsed.mode === "deduct" ? -parsed.amount : parsed.amount;
    const afterBalance = beforeBalance + delta;
    if (afterBalance < 0) throw new Error("ComfyUI 手动总余额不足，无法扣减");

    const now = new Date().toISOString();
    const value = {
      ...currentValue,
      label: `${parsed.providerKey === "comfyui" ? "ComfyUI" : parsed.providerKey} 手动总余额`,
      provider_key: parsed.providerKey,
      balance: afterBalance,
      unit: currentValue.unit || parsed.unit,
      source: currentValue.source || "manual",
      note: parsed.note || currentValue.note || "",
      last_adjustment: {
        mode: parsed.mode,
        amount: parsed.amount,
        delta,
        note: parsed.note,
        updated_at: now
      },
      updated_at: now
    };

    const query = existing
      ? clientState.client
        .from("system_settings")
        .update({ value, updated_at: now })
        .eq("key", key)
      : clientState.client
        .from("system_settings")
        .insert({ key, value, updated_at: now });
    const { data, error } = await query.select("key,value,updated_at").maybeSingle();
    if (error) throw error;

    const durationMs = Date.now() - startedAt;
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      adjustment: {
        providerKey: parsed.providerKey,
        mode: parsed.mode,
        amount: parsed.amount,
        delta,
        beforeBalance,
        afterBalance
      },
      record: data
    };
    logAdminData("info", "adjust provider budget", {
      source: result.source,
      status: result.status,
      providerKey: parsed.providerKey,
      mode: parsed.mode,
      delta,
      beforeBalance,
      afterBalance,
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "adjust provider budget failed", {
      source: result.source,
      status: result.status,
      providerKey: parsed.providerKey,
      durationMs,
      error: result.error
    });
    return result;
  }
}

function parseProviderRuntimeConfigPayload(payload) {
  if (payload && typeof payload === "object") {
    for (const name of Object.keys(payload)) {
      if (RETIRED_PROVIDER_ENV_NAMES.has(name)) throw new Error("Unsupported provider env name");
    }
  }
  const providerKey = String(payload?.providerKey || payload?.provider_key || "").trim().toLowerCase();
  if (providerKey !== "runninghub") throw new Error("Unsupported Provider");
  return { providerKey, ...runningHub.parseConfig(payload) };
}

async function setAdminProviderRuntimeConfig(payload) {
  const startedAt = Date.now();
  const operation = "provider_runtime_config.set";
  let parsed;
  try {
    parsed = parseProviderRuntimeConfigPayload(payload);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = localWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "set provider runtime config rejected", {
      source: "local",
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  try {
    const clientState = getAdminClient();
    if (!clientState.client) throw new Error('未连接服务器，RunningHub 配置未保存或同步');
    const {data: currentRows,error: readError}=await clientState.client.rpc('novaflow_runninghub_config_get',{});
    if(readError)throw new Error('无法读取服务器当前配置，未覆盖服务器设置');
    const current=Array.isArray(currentRows)?currentRows[0]:currentRows,defaults=runningHub.readConfig(()=>'');
    const { data: serverConfig, error: syncError } = await clientState.client.rpc('novaflow_runninghub_config_set', {
      p_api_key: parsed.updateApiKey ? parsed.apiKey : null,
      p_clear: parsed.clearApiKey,
      // Only the Key is editable. A stale readonly field must not overwrite
      // the server's working endpoint/model during a later Key save.
      p_llm_base_url: current?.llm_base_url || defaults.llmBaseUrl,
      p_llm_model: current?.llm_model || parsed.llmModel || defaults.llmModel
    });
    if (syncError || serverConfig?.synced !== true) throw new Error('RunningHub 配置未同步到服务器，请检查连接或服务端升级状态');
    const written = [];
    if (parsed.clearApiKey || parsed.updateApiKey) {
      written.push(writeAdminEnvValue(runningHub.ENV.apiKey, parsed.clearApiKey ? "" : parsed.apiKey));
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, "imagePrices")) {
      const price = (raw, fallback) => {
        if (raw === undefined || raw === null || raw === "") return fallback;
        const amount = Number(raw);
        if (!Number.isInteger(amount) || amount < 0 || amount > 100) throw new Error("出图积分单价须为 0 到 100 的整数");
        return amount;
      };
      const prices = {
        gpt_image_2_5: price(payload.imagePrices?.gpt_image_2_5, 22),
        gpt_image_2_official: price(payload.imagePrices?.gpt_image_2_official, 4)
      };
      written.push(writeAdminEnvValue(FEATURE_CREDIT_PRICE_ENV, JSON.stringify(prices)));
    }
    runningHubCheck = null;

    const env = runningHub.publicStatus(readAdminRunningHubEnv());
    const durationMs = Date.now() - startedAt;
    const result = {
      source: "local",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      serverSync: { synced:true,configured:serverConfig.configured===true,revision:serverConfig.revision,updatedAt:serverConfig.updatedAt },
      provider_key: parsed.providerKey,
      durationMs,
      env: {
        provider_key: parsed.providerKey,
        baseUrl: env.baseUrl,
        llmBaseUrl: current?.llm_base_url || defaults.llmBaseUrl,
        llmModel: current?.llm_model || parsed.llmModel || defaults.llmModel,
        gptImageEndpoint: env.gptImageEndpoint,
        hasApiKey: Boolean(env.hasApiKey),
        configured: Boolean(env.configured)
      },
      written: written.map((item) => ({
        name: item.name,
        configured: item.configured,
        persistent: item.persistent
      }))
    };
    logAdminData("info", "set provider runtime config", {
      source: result.source,
      status: result.status,
      providerKey: parsed.providerKey,
      baseUrl: result.env.baseUrl,
      llmModel: result.env.llmModel || undefined,
      hasApiKey: result.env.hasApiKey,
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = localWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "set provider runtime config failed", {
      source: "local",
      status: result.status,
      providerKey: parsed.providerKey,
      durationMs,
      error: result.error
    });
    return result;
  }
}

function mockProviderQuotaResult(providerKey, durationMs = 0) {
  return {
    source: "unconfigured",
    status: "unconfigured",
    configured: false,
    table: "system_settings",
    virtualTable: "provider_call_quotas",
    providerKey,
    records: [],
    message: "Supabase 未配置",
    reason: "supabase_env_missing",
    durationMs,
    query: queryMeta("system_settings", adminQueries.system_settings.select, { providerQuota: true })
  };
}

async function readProviderQuotaRecord(client, user, providerKey) {
  const key = providerQuotaSettingKey(providerKey, user.id);
  const { data, error } = await client
    .from("system_settings")
    .select(adminQueries.system_settings.select)
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return normalizeProviderQuotaRecord(data, user, providerKey);
}

async function getAdminProviderCallQuotas(input = {}) {
  const startedAt = Date.now();
  const providerKey = normalizeProviderQuotaKey(input?.providerKey || input?.provider_key || "grok");
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") return mockProviderQuotaResult(providerKey, durationMs);
    return errorResult("system_settings", clientState.error || "client initialization failed", adminQueries.system_settings.select, { providerQuota: true }, durationMs);
  }

  try {
    const { collectPages: readPages } = await loadFeatureCredits();
    const [users, settings] = await Promise.all([
      readPages(async ({ offset, limit }) => {
        const { data, error } = await clientState.client
          .from("users")
          .select(adminQueries.users.select)
          .order(adminQueries.users.orderBy, { ascending: adminQueries.users.ascending })
          .range(offset, offset + limit - 1);
        if (error) throw error;
        return data || [];
      }),
      readPages(async ({ offset, limit }) => {
        const { data, error } = await clientState.client
          .from("system_settings")
          .select(adminQueries.system_settings.select)
          .like("key", `${PROVIDER_QUOTA_PREFIX}${providerKey}_%`)
          .order("key", { ascending: true })
          .range(offset, offset + limit - 1);
        if (error) throw error;
        return data || [];
      })
    ]);
    const settingsByUserId = new Map((settings || []).map((setting) => {
      const value = setting?.value && typeof setting.value === "object" ? setting.value : {};
      return [String(value.user_id || setting.key.replace(`${PROVIDER_QUOTA_PREFIX}${providerKey}_`, "")), setting];
    }));
    const records = (users || []).map((user) => normalizeProviderQuotaRecord(settingsByUserId.get(String(user.id || "")), user, providerKey));
    const durationMs = Date.now() - startedAt;
    logAdminData("info", "read provider quotas", {
      source: "supabase",
      status: "connected",
      provider: providerKey,
      rows: records.length,
      durationMs
    });
    return {
      source: "supabase",
      status: "connected",
      configured: true,
      table: "system_settings",
      virtualTable: "provider_call_quotas",
      providerKey,
      records,
      durationMs,
      query: queryMeta("system_settings", adminQueries.system_settings.select, { providerQuota: true })
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    logAdminData("error", "read provider quotas failed", {
      source: "supabase",
      status: "error",
      provider: providerKey,
      durationMs,
      error: sanitizeError(err)
    });
    return errorResult("system_settings", err, adminQueries.system_settings.select, { providerQuota: true }, durationMs);
  }
}

async function getAdminProviderCallQuotaByUserId(userId, providerKey = "grok") {
  const startedAt = Date.now();
  const normalizedProviderKey = normalizeProviderQuotaKey(providerKey);
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") {
      return {
        source: "unconfigured",
        status: "unconfigured",
        configured: false,
        record: null,
        message: "Supabase 未配置",
        durationMs
      };
    }
    return {
      source: "supabase",
      status: "error",
      configured: true,
      error: `${ERROR_PREFIX}: ${sanitizeError(clientState.error || "client initialization failed")}`,
      durationMs
    };
  }

  try {
    const { data: user, error: userError } = await clientState.client
      .from("users")
      .select(adminQueries.users.select)
      .eq("id", String(userId || ""))
      .maybeSingle();
    if (userError) throw userError;
    if (!user) throw new Error("用户不存在，无法读取提示词服务次数");
    const record = await readProviderQuotaRecord(clientState.client, user, normalizedProviderKey);
    const durationMs = Date.now() - startedAt;
    return {
      source: "supabase",
      status: "connected",
      configured: true,
      record,
      durationMs
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    return {
      source: "supabase",
      status: "error",
      configured: true,
      error: `${ERROR_PREFIX}: ${sanitizeError(err)}`,
      durationMs
    };
  }
}

async function setAdminProviderCallQuota(payload) {
  const startedAt = Date.now();
  const operation = "provider_quota.set";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") {
      const result = adminWriteMockResult(operation, durationMs);
      logAdminData("info", "set provider quota skipped", {
        source: result.source,
        status: result.status,
        durationMs,
        reason: "supabase_env_missing"
      });
      return result;
    }
    return adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
  }

  let parsed;
  try {
    parsed = parseProviderQuotaPayload(payload);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "set provider quota rejected", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  try {
    const { data: user, error: userError } = await clientState.client
      .from("users")
      .select(adminQueries.users.select)
      .eq("id", parsed.userId)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) throw new Error("用户不存在，无法分配提示词服务次数");

    if (parsed.providerKey === "grok") {
      const { data, error } = await clientState.client.rpc("set_grok_quota", {
        p_user_id: user.id,
        p_allocated_calls: parsed.allocatedCount,
        p_reason: parsed.note,
        p_metadata: { email: user.email, display_name: user.display_name || "" }
      });
      if (error) throw error;
      return {
        source: "supabase", status: "connected", configured: true, operation, ok: true,
        durationMs: Date.now() - startedAt, allocation: data,
        record: await readProviderQuotaRecord(clientState.client, user, "grok")
      };
    }

    const current = await readProviderQuotaRecord(clientState.client, user, parsed.providerKey);
    const now = new Date().toISOString();
    const value = {
      label: `${parsed.providerKey === "grok" ? "提示词服务" : parsed.providerKey}次数`,
      provider_key: parsed.providerKey,
      user_id: user.id,
      email: user.email,
      display_name: user.display_name || "",
      allocated_count: parsed.allocatedCount,
      used_count: current.used_count,
      remaining_count: Math.max(0, parsed.allocatedCount - current.used_count),
      source: "manual",
      note: parsed.note,
      updated_at: now
    };
    const key = providerQuotaSettingKey(parsed.providerKey, user.id);
    const { data, error } = await clientState.client
      .from("system_settings")
      .upsert({ key, value, updated_at: now }, { onConflict: "key" })
      .select(adminQueries.system_settings.select)
      .maybeSingle();
    if (error) throw error;

    const durationMs = Date.now() - startedAt;
    const record = normalizeProviderQuotaRecord(data, user, parsed.providerKey);
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      record
    };
    logAdminData("info", "set provider quota", {
      source: result.source,
      status: result.status,
      provider: parsed.providerKey,
      userId: user.id,
      allocatedCount: parsed.allocatedCount,
      usedCount: record.used_count,
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "set provider quota failed", {
      source: result.source,
      status: result.status,
      provider: parsed.providerKey,
      userId: parsed.userId,
      durationMs,
      error: result.error
    });
    return result;
  }
}

function normalizeGrokReservationPayload(payload) {
  const userId = String(payload?.userId || payload?.user_id || "").trim();
  const usageKey = String(payload?.usageKey || payload?.usage_key || "").trim();
  const feature = String(payload?.feature || "grok").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 100);
  const minCalls = Number(payload?.minCalls ?? payload?.min_calls ?? 1);
  const maxCalls = Number(payload?.maxCalls ?? payload?.max_calls ?? minCalls);
  if (!userId) throw new Error("Grok quota user id is required");
  if (!usageKey || usageKey.length > 200) throw new Error("Grok quota usage key is invalid");
  if (!feature) throw new Error("Grok quota feature is required");
  if (!Number.isInteger(minCalls) || !Number.isInteger(maxCalls) || minCalls < 0 || maxCalls < minCalls || maxCalls > 20) {
    throw new Error("Grok quota call bounds are invalid");
  }
  return { userId, usageKey, feature, minCalls, maxCalls };
}

async function readGrokQuotaUser(client, userId) {
  const { data: user, error } = await client.from("users").select(adminQueries.users.select).eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!user) throw new Error("Grok quota user does not exist");
  return user;
}

async function reserveAdminGrokQuota(payload) {
  const startedAt = Date.now();
  const operation = "provider_quota.grok_reserve";
  const clientState = getAdminClient();
  if (!clientState.client) return adminWriteErrorResult(operation, clientState.error || "client initialization failed", Date.now() - startedAt);
  try {
    const parsed = normalizeGrokReservationPayload(payload);
    const { data, error } = await clientState.client.rpc("reserve_grok_quota", {
      p_user_id: parsed.userId,
      p_usage_key: parsed.usageKey,
      p_feature: parsed.feature,
      p_min_calls: parsed.minCalls,
      p_max_calls: parsed.maxCalls,
      p_metadata: payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {}
    });
    if (error) throw error;
    const user = await readGrokQuotaUser(clientState.client, parsed.userId);
    return { source: "supabase", status: "connected", configured: true, operation, ok: true,
      durationMs: Date.now() - startedAt, reservation: data,
      record: await readProviderQuotaRecord(clientState.client, user, "grok") };
  } catch (err) {
    return adminWriteErrorResult(operation, err, Date.now() - startedAt);
  }
}

async function settleAdminGrokQuota(payload) {
  const startedAt = Date.now();
  const operation = "provider_quota.grok_settle";
  const clientState = getAdminClient();
  if (!clientState.client) return adminWriteErrorResult(operation, clientState.error || "client initialization failed", Date.now() - startedAt);
  try {
    const userId = String(payload?.userId || payload?.user_id || "").trim();
    const usageKey = String(payload?.usageKey || payload?.usage_key || "").trim();
    const actualCalls = Number(payload?.actualCalls ?? payload?.actual_calls ?? 0);
    if (!userId || !usageKey || !Number.isInteger(actualCalls) || actualCalls < 0) throw new Error("Grok quota settlement is invalid");
    const { data, error } = await clientState.client.rpc("settle_grok_quota", {
      p_user_id: userId,
      p_usage_key: usageKey,
      p_actual_calls: actualCalls,
      p_success: payload?.success === true,
      p_call_records: Array.isArray(payload?.callRecords) ? payload.callRecords : [],
      p_metadata: payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {}
    });
    if (error) throw error;
    const user = await readGrokQuotaUser(clientState.client, userId);
    return { source: "supabase", status: "connected", configured: true, operation, ok: true,
      durationMs: Date.now() - startedAt, settlement: data,
      record: await readProviderQuotaRecord(clientState.client, user, "grok") };
  } catch (err) {
    return adminWriteErrorResult(operation, err, Date.now() - startedAt);
  }
}

async function releaseAdminGrokQuota(payload) {
  const startedAt = Date.now();
  const operation = "provider_quota.grok_release";
  const clientState = getAdminClient();
  if (!clientState.client) return adminWriteErrorResult(operation, clientState.error || "client initialization failed", Date.now() - startedAt);
  try {
    const userId = String(payload?.userId || payload?.user_id || "").trim();
    const usageKey = String(payload?.usageKey || payload?.usage_key || "").trim();
    if (!userId || !usageKey) throw new Error("Grok quota release identity is required");
    const { data, error } = await clientState.client.rpc("release_grok_quota", {
      p_user_id: userId, p_usage_key: usageKey,
      p_reason: String(payload?.reason || "").slice(0, 240),
      p_metadata: payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {}
    });
    if (error) throw error;
    const user = await readGrokQuotaUser(clientState.client, userId);
    return { source: "supabase", status: "connected", configured: true, operation, ok: true,
      durationMs: Date.now() - startedAt, release: data,
      record: await readProviderQuotaRecord(clientState.client, user, "grok") };
  } catch (err) {
    return adminWriteErrorResult(operation, err, Date.now() - startedAt);
  }
}

function normalizeAdminGrokUsageMode(value) {
  const mode = String(value || "prompt_optimize").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 64);
  return mode || "prompt_optimize";
}

function normalizeAdminGrokUsageStatus(value) {
  const status = String(value || "success").trim().toLowerCase();
  return ["success", "failed", "rejected"].includes(status) ? status : "failed";
}

function normalizeAdminGrokUsageDetail(payload) {
  const tokenUsage = payload?.tokenUsage && typeof payload.tokenUsage === "object" ? payload.tokenUsage : {};
  const inputTokens = Math.max(0, Math.round(Number(tokenUsage.inputTokens ?? tokenUsage.input_tokens ?? 0) || 0));
  const outputTokens = Math.max(0, Math.round(Number(tokenUsage.outputTokens ?? tokenUsage.output_tokens ?? 0) || 0));
  const totalTokens = Math.max(
    inputTokens + outputTokens,
    Math.round(Number(tokenUsage.totalTokens ?? tokenUsage.total_tokens ?? 0) || 0)
  );
  return {
    id: String(payload?.id || `grok_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`).slice(0, 80),
    user_id: String(payload?.userId || payload?.user_id || "").trim(),
    at: String(payload?.at || new Date().toISOString()),
    provider: "grok",
    mode: normalizeAdminGrokUsageMode(payload?.mode),
    token_usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens
    },
    duration_ms: Math.max(0, Math.round(Number(payload?.durationMs ?? payload?.duration_ms ?? 0) || 0)),
    model: String(payload?.model || "").trim().slice(0, 120),
    status: normalizeAdminGrokUsageStatus(payload?.status),
    error: String(payload?.error || "").trim().slice(0, 240)
  };
}

async function recordAdminGrokUsageDetail(payload) {
  const startedAt = Date.now();
  const operation = "provider_quota.grok_usage_detail";
  const userId = String(payload?.userId || payload?.user_id || "").trim();
  const increment = Number(payload?.increment ?? 0);
  const note = String(payload?.note || "").trim().slice(0, 500);
  if (userId && Number.isInteger(increment) && increment >= 0) {
    const usageKey = String(payload?.usageKey || payload?.usage_key || `grok:${Date.now()}:${Math.random().toString(16).slice(2)}`).slice(0, 200);
    const reservation = await reserveAdminGrokQuota({
      userId, usageKey, feature: normalizeAdminGrokUsageMode(payload?.mode),
      minCalls: increment, maxCalls: increment, metadata: { source: "legacy_grok_usage_detail" }
    });
    if (!reservation?.ok || reservation.status === "error") return reservation;
    return await settleAdminGrokQuota({
      userId, usageKey, actualCalls: increment,
      success: normalizeAdminGrokUsageStatus(payload?.status) === "success",
      callRecords: [normalizeAdminGrokUsageDetail({ ...payload, userId })], metadata: { note }
    });
  }
  if (!userId) return adminWriteErrorResult(operation, new Error("用户 ID 不能为空"), 0);
  if (!Number.isInteger(increment) || increment < 0) return adminWriteErrorResult(operation, new Error("调用次数增量不能小于 0"), 0);

  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") return adminWriteMockResult(operation, durationMs);
    return adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
  }

  try {
    const { data: user, error: userError } = await clientState.client
      .from("users")
      .select(adminQueries.users.select)
      .eq("id", userId)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) throw new Error("用户不存在，无法记录 Grok 使用明细");
    const current = await readProviderQuotaRecord(clientState.client, user, "grok");
    const beforeUsed = current.used_count;
    const nextUsed = beforeUsed + increment;
    const now = new Date().toISOString();
    const detail = normalizeAdminGrokUsageDetail({ ...payload, userId: user.id, at: now });
    const recent_calls = [...(Array.isArray(current.recent_calls) ? current.recent_calls : []), detail].slice(-50);
    const value = {
      label: "提示词服务次数",
      provider_key: "grok",
      user_id: user.id,
      email: user.email,
      display_name: user.display_name || "",
      allocated_count: current.allocated_count,
      used_count: nextUsed,
      remaining_count: Math.max(0, current.allocated_count - nextUsed),
      recent_calls,
      source: "usage",
      note: note || current.note || "",
      updated_at: now
    };
    const key = providerQuotaSettingKey("grok", user.id);
    const { data, error } = await clientState.client
      .from("system_settings")
      .upsert({ key, value, updated_at: now }, { onConflict: "key" })
      .select(adminQueries.system_settings.select)
      .maybeSingle();
    if (error) throw error;
    const durationMs = Date.now() - startedAt;
    const record = normalizeProviderQuotaRecord(data, user, "grok");
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      beforeUsed,
      afterUsed: record.used_count,
      detail,
      record
    };
    logAdminData("info", "record grok usage detail", {
      source: result.source,
      status: result.status,
      provider: "grok",
      userId: user.id,
      mode: detail.mode,
      callStatus: detail.status,
      beforeUsed,
      afterUsed: record.used_count,
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "record grok usage detail failed", {
      source: result.source,
      status: result.status,
      provider: "grok",
      userId,
      durationMs,
      error: result.error
    });
    return result;
  }
}

async function recordAdminProviderCallUsage(payload) {
  const startedAt = Date.now();
  const operation = "provider_quota.usage";
  const userId = String(payload?.userId || payload?.user_id || "").trim();
  const providerKey = normalizeProviderQuotaKey(payload?.providerKey || payload?.provider_key || "grok");
  const increment = Number(payload?.increment ?? 1);
  const note = String(payload?.note || "").trim().slice(0, 500);
  if (providerKey === "grok" && userId && Number.isInteger(increment) && increment > 0) {
    const usageKey = String(payload?.usageKey || payload?.usage_key || `grok:${Date.now()}:${Math.random().toString(16).slice(2)}`).slice(0, 200);
    const reservation = await reserveAdminGrokQuota({
      userId, usageKey, feature: String(payload?.feature || "provider_usage"),
      minCalls: increment, maxCalls: increment, metadata: { source: "legacy_provider_usage" }
    });
    if (!reservation?.ok || reservation.status === "error") return reservation;
    return await settleAdminGrokQuota({
      userId, usageKey, actualCalls: increment, success: payload?.success !== false,
      callRecords: Array.isArray(payload?.callRecords) ? payload.callRecords : [], metadata: { note }
    });
  }
  if (!userId) return adminWriteErrorResult(operation, new Error("用户 ID 不能为空"), 0);
  if (!Number.isInteger(increment) || increment <= 0) return adminWriteErrorResult(operation, new Error("调用次数增量必须大于 0"), 0);

  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") return adminWriteMockResult(operation, durationMs);
    return adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
  }

  try {
    const { data: user, error: userError } = await clientState.client
      .from("users")
      .select(adminQueries.users.select)
      .eq("id", userId)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) throw new Error("用户不存在，无法记录提示词服务使用次数");
    const current = await readProviderQuotaRecord(clientState.client, user, providerKey);
    const beforeUsed = current.used_count;
    const nextUsed = beforeUsed + increment;
    const now = new Date().toISOString();
    const value = {
      label: `${providerKey === "grok" ? "提示词服务" : providerKey}次数`,
      provider_key: providerKey,
      user_id: user.id,
      email: user.email,
      display_name: user.display_name || "",
      allocated_count: current.allocated_count,
      used_count: nextUsed,
      remaining_count: Math.max(0, current.allocated_count - nextUsed),
      source: "usage",
      note: note || current.note || "",
      updated_at: now
    };
    const key = providerQuotaSettingKey(providerKey, user.id);
    const { data, error } = await clientState.client
      .from("system_settings")
      .upsert({ key, value, updated_at: now }, { onConflict: "key" })
      .select(adminQueries.system_settings.select)
      .maybeSingle();
    if (error) throw error;
    const durationMs = Date.now() - startedAt;
    const record = normalizeProviderQuotaRecord(data, user, providerKey);
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      beforeUsed,
      afterUsed: record.used_count,
      record
    };
    logAdminData("info", "record provider usage", {
      source: result.source,
      status: result.status,
      provider: providerKey,
      userId: user.id,
      beforeUsed,
      afterUsed: record.used_count,
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "record provider usage failed", {
      source: result.source,
      status: result.status,
      provider: providerKey,
      userId,
      durationMs,
      error: result.error
    });
    return result;
  }
}

async function adjustAdminUserCredits(payload) {
  const startedAt = Date.now();
  const operation = "credits.adjust";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") {
      const result = adminWriteMockResult(operation, durationMs);
      logAdminData("info", "adjust credits skipped", {
        source: result.source,
        status: result.status,
        durationMs,
        reason: "supabase_env_missing"
      });
      return result;
    }
    const result = adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
    logAdminData("error", "adjust credits failed", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  let parsed;
  try {
    parsed = parseCreditAdjustmentPayload(payload);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "adjust credits rejected", {
      source: result.source,
      status: result.status,
      durationMs,
      error: result.error
    });
    return result;
  }

  try {
    const usageKey = String(payload?.usageKey || payload?.usage_key || "").trim() || `admin_adjust_${require("node:crypto").randomUUID()}`;
    const adminLabel = String(require("os").hostname() || "admin").slice(0, 80);
    const { data, error } = await clientState.client.rpc("admin_adjust_feature_credits", {
      p_user_id: parsed.userId,
      p_mode: parsed.mode,
      p_amount: parsed.amount,
      p_reason: parsed.reason,
      p_note: parsed.note,
      p_admin_label: adminLabel,
      p_usage_key: usageKey
    });
    if (error) throw error;
    const row = data && typeof data === "object" ? data : {};
    const beforeBalance = Number(row.before_balance);
    const afterBalance = Number(row.after_balance);
    const delta = Number(row.delta);
    const durationMs = Date.now() - startedAt;
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      adjustment: {
        mode: parsed.mode,
        amount: parsed.amount,
        delta,
        beforeBalance,
        afterBalance,
        usageKey: row.usage_key || usageKey,
        idempotent: row.idempotent === true
      },
      credit: { user_id: parsed.userId, balance: afterBalance }
    };
    logAdminData("info", "adjust credits", {
      source: result.source,
      status: result.status,
      userId: parsed.userId,
      mode: parsed.mode,
      delta,
      beforeBalance,
      afterBalance,
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const result = adminWriteErrorResult(operation, err, durationMs);
    logAdminData("error", "adjust credits failed", {
      source: result.source,
      status: result.status,
      userId: parsed.userId,
      durationMs,
      error: result.error
    });
    return result;
  }
}

async function upsertAdminAiProvider(payload) {
  const startedAt = Date.now();
  const operation = "ai_providers.upsert";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") return adminWriteMockResult(operation, durationMs);
    return adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
  }

  let parsed;
  try {
    parsed = parseAdminAiProviderPayload(payload);
  } catch (err) {
    return adminWriteErrorResult(operation, err, Date.now() - startedAt);
  }

  try {
    const now = new Date().toISOString();
    const { data, error } = await clientState.client
      .from("ai_providers")
      .upsert({
        provider_key: parsed.providerKey,
        name: parsed.name,
        status: parsed.status,
        billing_multiplier: parsed.billingMultiplier,
        api_key_secret_ref: parsed.apiKeySecretRef || null,
        updated_at: now
      }, { onConflict: "provider_key" })
      .select(adminQueries.ai_providers.select)
      .maybeSingle();
    if (error) throw error;
    const durationMs = Date.now() - startedAt;
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      record: data
    };
    logAdminData("info", "upsert ai provider", {
      source: result.source,
      status: result.status,
      providerKey: parsed.providerKey,
      providerStatus: parsed.status,
      durationMs
    });
    return result;
  } catch (err) {
    const result = adminWriteErrorResult(operation, err, Date.now() - startedAt);
    logAdminData("error", "upsert ai provider failed", {
      source: result.source,
      status: result.status,
      providerKey: parsed.providerKey,
      error: result.error,
      durationMs: result.durationMs
    });
    return result;
  }
}

async function upsertAdminAiModel(payload) {
  const startedAt = Date.now();
  const operation = "ai_models.upsert";
  return {
    source: "disabled",
    status: "disabled",
    configured: false,
    operation,
    ok: false,
    error: "模型管理已在轻量后台模式中关闭；当前只维护 Provider 和积分。",
    durationMs: Date.now() - startedAt
  };
}

async function upsertAdminSystemSetting(payload) {
  const startedAt = Date.now();
  const operation = "system_settings.upsert";
  const clientState = getAdminClient();
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") return adminWriteMockResult(operation, durationMs);
    return adminWriteErrorResult(operation, clientState.error || "client initialization failed", durationMs);
  }

  let parsed;
  try {
    parsed = parseSystemSettingPayload(payload);
  } catch (err) {
    return adminWriteErrorResult(operation, err, Date.now() - startedAt);
  }

  try {
    const now = new Date().toISOString();
    const { data, error } = await clientState.client
      .from("system_settings")
      .upsert({ key: parsed.key, value: parsed.value, updated_at: now }, { onConflict: "key" })
      .select(adminQueries.system_settings.select)
      .maybeSingle();
    if (error) throw error;
    const durationMs = Date.now() - startedAt;
    const result = {
      source: "supabase",
      status: "connected",
      configured: true,
      operation,
      ok: true,
      durationMs,
      record: data
    };
    logAdminData("info", "upsert system setting", {
      source: result.source,
      status: result.status,
      key: parsed.key,
      durationMs
    });
    return result;
  } catch (err) {
    const result = adminWriteErrorResult(operation, err, Date.now() - startedAt);
    logAdminData("error", "upsert system setting failed", {
      source: result.source,
      status: result.status,
      key: parsed.key,
      error: result.error,
      durationMs: result.durationMs
    });
    return result;
  }
}

async function readClientRowsForUser(tableName, selectFields, userId, options = {}) {
  const startedAt = Date.now();
  const clientState = getAdminClient();
  const safeOptions = { ...options, filter: `user_id=eq.${String(userId || "")}` };
  if (!clientState.client) {
    const durationMs = Date.now() - startedAt;
    if (clientState.status === "mock") {
      return {
        source: "unconfigured",
        status: "unconfigured",
        configured: false,
        table: tableName,
        records: [],
        message: "Supabase 未配置",
        reason: "supabase_env_missing",
        durationMs,
        query: queryMeta(tableName, selectFields, safeOptions)
      };
    }
    return supabaseErrorResult(tableName, clientState.error || "client initialization failed", selectFields, safeOptions, durationMs);
  }

  try {
    let query = clientState.client.from(tableName).select(selectFields).eq("user_id", userId).limit(options.limit || DEFAULT_LIMIT);
    if (options.orderBy) query = query.order(options.orderBy, { ascending: Boolean(options.ascending) });
    const { data, error } = await query;
    const durationMs = Date.now() - startedAt;
    if (error && shouldRetryLegacySelect(error, options)) {
      let fallbackQuery = clientState.client.from(tableName).select(options.fallbackSelect).eq("user_id", userId).limit(options.limit || DEFAULT_LIMIT);
      if (options.orderBy) fallbackQuery = fallbackQuery.order(options.orderBy, { ascending: Boolean(options.ascending) });
      const fallback = await fallbackQuery;
      if (!fallback.error) {
        return supabaseResult(tableName, fallback.data, options.fallbackSelect, { ...safeOptions, usedFallbackSelect: true }, Date.now() - startedAt);
      }
    }
    if (error) return supabaseErrorResult(tableName, error, selectFields, safeOptions, durationMs);
    return supabaseResult(tableName, data, selectFields, safeOptions, durationMs);
  } catch (err) {
    return supabaseErrorResult(tableName, err, selectFields, safeOptions, Date.now() - startedAt);
  }
}

function isClientAiSettingSafe(record) {
  const key = String(record?.key || "").trim().toLowerCase();
  return key === "default_billing_multiplier" ||
    key === "gateway_default_credit_cost" ||
    key.startsWith("gateway_cost_") ||
    key.startsWith("credit_cost_");
}

async function getClientAiConfig() {
  const [providers, settings] = await Promise.all([
    getAdminAiProviders(),
    getAdminSystemSettings()
  ]);
  const failed = [providers, settings].find((item) => item?.status === "error");
  if (failed) {
    return {
      source: failed.source,
      status: "error",
      configured: Boolean(failed.configured),
      error: failed.error || "AI config lookup failed",
      durationMs: Math.max(Number(providers.durationMs || 0), Number(settings.durationMs || 0))
    };
  }
  const providerRecords = (providers.records || []).map((item) => ({
    id: item.id || "",
    provider_key: item.provider_key || "",
    name: item.name || "",
    status: item.status || "disabled",
    billing_multiplier: Number(item.billing_multiplier ?? 1)
  }));
  return {
    source: providers.source || settings.source,
    status: providers.status === "mock" ? "mock" : "connected",
    configured: Boolean(providers.configured),
    providers: providerRecords.filter((item) => item.status === "enabled"),
    models: [],
    settings: (settings.records || []).filter(isClientAiSettingSafe),
    durationMs: Number(providers.durationMs || 0) + Number(settings.durationMs || 0)
  };
}

function getClientAiTasks(userId) {
  return disabledTableResult("ai_tasks", "客户端任务记录已在轻量后台模式中关闭");
}

async function recordClientGatewayTaskDraft(payload, user) {
  const startedAt = Date.now();
  const operation = "gateway_lite_check";
  return {
    source: "disabled",
    status: "disabled",
    configured: false,
    operation,
    ok: true,
    mode: "gateway_lite_check",
    task: null,
    message: "任务记录已在轻量后台模式中关闭",
    durationMs: Date.now() - startedAt
  };
}

async function recordClientAiTaskUsage(payload, user) {
  const startedAt = Date.now();
  const operation = "record_usage_disabled";
  return {
    source: "disabled",
    status: "disabled",
    configured: false,
    operation,
    ok: false,
    error: "recordUsage 已关闭，不写任务记录或消费记录。",
    durationMs: Date.now() - startedAt
  };
}

async function getAdminGrokProviderStatus() {
  const startedAt = Date.now();
  const env = readAdminGrokEnv();
  const durationMs = Date.now() - startedAt;
  const result = {
    source: "provider",
    provider_key: "grok",
    status: env.configured ? "configured" : "mock",
    configured: Boolean(env.configured),
    connected: Boolean(env.configured),
    baseUrl: env.baseUrl || DEFAULT_GROK_BASE_URL,
    model: env.model || DEFAULT_GROK_MODEL,
    hasApiKey: Boolean(env.hasApiKey),
    accountStatus: env.configured ? "backend_key_configured" : "not_configured",
    balance: {
      supported: false,
      text: "Grok API 不读取账户余额；按管理员分配提示词服务次数控制"
    },
    endpoint: `${env.baseUrl || DEFAULT_GROK_BASE_URL}/chat/completions`,
    durationMs,
    reason: env.configured ? "grok_env_configured" : "grok_env_missing"
  };
  logAdminData("info", "check grok provider config", {
    source: result.source,
    status: result.status,
    configured: result.configured,
    model: result.model,
    durationMs,
    reason: result.reason
  });
  return result;
}

async function readSettingValue(client, key) {
  const { data, error } = await client.from("system_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value && typeof data.value === "object" ? data.value : {};
}

async function readFeatureCreditConfig() {
  const { normalizeCreditConfig } = await loadFeatureCredits();
  const clientState = getAdminClient();
  if (!clientState.client) return normalizeCreditConfig(undefined);
  try {
    return normalizeCreditConfig(await readSettingValue(clientState.client, "feature_credit_config"));
  } catch {
    return normalizeCreditConfig(undefined);
  }
}

async function getFeatureCreditAdmin() {
  const { normalizeCreditConfig, ledgerCsv, lowBalanceState, collectPages, ledgerUserLookup } = await loadFeatureCredits();

  const clientState = getAdminClient();
  const config = normalizeCreditConfig(undefined);
  const empty = {
    config,
    domesticBalance: { site: "domestic", label: "国内站余额", remainMoney: null, currency: "", checkedAt: null },
    estimatedRhCostUsd: null,
    lowBalance: { known: false, blocked: false, warn: false, thresholdUsd: config.low_balance_usd }
  };
  if (!clientState.client) return empty;
  try {
    const stored = normalizeCreditConfig(await readSettingValue(clientState.client, "feature_credit_config"));
    const storedBalance = await readSettingValue(clientState.client, "rh_domestic_balance");
    const env = readAdminRunningHubEnv();
    const latest = runningHubCheck?.baseUrl === env.baseUrl && runningHubCheck?.apiKey === env.apiKey
      ? runningHubCheck.result : null;
    // The live check is authoritative even if saving the shared cache failed.
    const balance = latest?.connected ? {
      remainMoney: latest.balance?.money, remainCoins: latest.balance?.coins,
      currency: latest.balance?.currency, checkedAt: latest.checkedAt
    } : storedBalance;
    let estimatedRhCostUsd = null;
    const summed = await clientState.client.rpc("credit_ledger_estimated_rh_cost");
    if (!summed.error && summed.data != null) estimatedRhCostUsd = Number(summed.data);
    const domesticBalance = {
      site: "domestic",
      label: "国内站余额",
      remainMoney: balance.remainMoney ?? null,
      remainCoins: balance.remainCoins ?? null,
      currency: balance.currency || "",
      checkedAt: balance.checkedAt || null
    };
    return {
      config: stored,
      domesticBalance,
      balanceError: latest && !latest.connected ? latest.error || "RunningHub：未配置有效 Key" : null,
      balanceCacheSaved: latest?.balanceCacheSaved,
      estimatedRhCostUsd,
      lowBalance: lowBalanceState({
        cache: true,
        remainMoney: domesticBalance.remainMoney,
        currency: domesticBalance.currency,
        checkedAt: domesticBalance.checkedAt,
        thresholdUsd: stored.low_balance_usd,
        thresholdCny: stored.low_balance_cny,
        ttlSeconds: stored.balance_ttl_seconds,
        stalePolicy: stored.stale_balance_policy
      })
    };
  } catch (err) {
    return { ...empty, error: String(err?.message || err) };
  }
}

async function saveFeatureCreditAdmin(payload) {
  const { normalizeCreditConfig, ledgerCsv, lowBalanceState, collectPages, ledgerUserLookup } = await loadFeatureCredits();

  const current = await getFeatureCreditAdmin();
  const prices = { ...(current.config?.prices || {}) };
  const incoming = payload?.prices && typeof payload.prices === "object" ? payload.prices : {};
  for (const [key, amount] of Object.entries(incoming)) {
    if (amount === "" || amount == null) continue;
    const n = Math.round(Number(amount));
    if (!Number.isInteger(n) || n < 0 || n > 1000000) throw new Error("积分单价必须是 0 到 1000000 的整数");
    prices[key] = n;
  }
  prices.local = 0;
  const cnyRaw = payload?.credits_to_cny;
  const thresholdRaw = payload?.low_balance_usd;
  const thresholdCnyRaw = payload?.low_balance_cny;
  const ttlRaw = payload?.balance_ttl_seconds;
  const config = normalizeCreditConfig({
    prices,
    rh_cost_usd: current.config?.rh_cost_usd,
    credits_to_cny: cnyRaw === "" || cnyRaw == null ? null : cnyRaw,
    low_balance_usd: thresholdRaw === "" || thresholdRaw == null ? current.config?.low_balance_usd : thresholdRaw,
    low_balance_cny: thresholdCnyRaw === "" || thresholdCnyRaw == null ? current.config?.low_balance_cny : thresholdCnyRaw,
    balance_ttl_seconds: ttlRaw === "" || ttlRaw == null ? current.config?.balance_ttl_seconds : ttlRaw,
    stale_balance_policy: payload?.stale_balance_policy || current.config?.stale_balance_policy,
    credits_per_usd: payload?.credits_per_usd === "" || payload?.credits_per_usd == null
      ? current.config?.credits_per_usd
      : payload.credits_per_usd,
    token_billing: {
      ...(current.config?.token_billing || {}),
      ...(payload?.token_billing && typeof payload.token_billing === "object" ? payload.token_billing : {})
    },
    gpt_image: {
      ...(current.config?.gpt_image || {}),
      ...(payload?.gpt_image && typeof payload.gpt_image === "object" ? payload.gpt_image : {})
    }
  });
  const saved = await upsertAdminSystemSetting({ key: "feature_credit_config", value: config });
  if (saved?.status === "error" || saved?.ok === false) throw new Error(saved.error || "保存积分配置失败");
  return getFeatureCreditAdmin();
}

function ledgerFilters(payload) {
  const user = String(payload?.user || payload?.userId || payload?.account || "").trim();
  const feature = String(payload?.feature || "").trim();
  const status = String(payload?.status || "").trim();
  const from = String(payload?.from || "").trim();
  const to = String(payload?.to || "").trim();
  if (user && !/^[0-9a-f-]{36}$/i.test(user) && !/^[A-Za-z0-9._@\u4e00-\u9fff-]{1,120}$/.test(user)) throw new Error("用户筛选无效");
  if (feature && !/^[a-z0-9_-]{1,80}$/.test(feature)) throw new Error("功能筛选无效");
  if (status && !["reserved", "settled", "released"].includes(status)) throw new Error("状态筛选无效");
  return { user, feature, status, from, to };
}

const LEDGER_COLUMNS = "created_at,settled_at,user_id,feature,model,status,estimated_credits,settled_credits,balance_before,balance_after,rh_cost_usd,rh_cost_currency,usage_key,error_code,pricing_source,pricing_details";

async function lookupLedgerUsers(client, userText) {
  const { normalizeCreditConfig, ledgerCsv, lowBalanceState, collectPages, ledgerUserLookup } = await loadFeatureCredits();

  const lookup = ledgerUserLookup(userText);
  if (!lookup) return null;
  if (lookup.id) {
    const { data, error } = await client.from("users").select("id,email,display_name").eq("id", lookup.id).limit(5);
    if (error) throw error;
    return data || [];
  }
  const byEmail = await client.from("users").select("id,email,display_name").eq("email", lookup.email).limit(20);
  if (byEmail.error) throw byEmail.error;
  const byName = await client.from("users").select("id,email,display_name").eq("display_name", lookup.displayName).limit(20);
  if (byName.error) throw byName.error;
  const users = new Map();
  for (const user of [...(byEmail.data || []), ...(byName.data || [])]) users.set(user.id, user);
  return [...users.values()];
}

async function queryCreditLedger(payload) {
  const { normalizeCreditConfig, ledgerCsv, lowBalanceState, collectPages, ledgerUserLookup } = await loadFeatureCredits();

  const filters = ledgerFilters(payload || {});
  const cap = payload?.limit == null || payload.limit === ""
    ? null
    : Math.max(1, Math.min(200, Math.round(Number(payload.limit)) || 20));
  const clientState = getAdminClient();
  if (!clientState.client) return { records: [], csv: ledgerCsv([]), configured: false, status: "unconfigured", message: "Supabase 未配置" };
  const client = clientState.client;
  let userIds = null;
  let knownUsers = [];
  if (filters.user) {
    knownUsers = await lookupLedgerUsers(client, filters.user);
    userIds = knownUsers.map((user) => user.id);
    if (!userIds.length) return { records: [], csv: ledgerCsv([]) };
  }
  const records = await collectPages(async ({ offset, limit }) => {
    const take = cap == null ? limit : Math.min(limit, cap - offset);
    if (take <= 0) return [];
    let query = client.from("credit_ledger").select(LEDGER_COLUMNS)
      .order("created_at", { ascending: false })
      .order("usage_key", { ascending: true })
      .range(offset, offset + take - 1);
    if (userIds) query = query.in("user_id", userIds);
    if (filters.feature) query = query.eq("feature", filters.feature);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.from) query = query.gte("created_at", filters.from);
    if (filters.to) query = query.lte("created_at", filters.to);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  });
  const ids = [...new Set(records.map((row) => row.user_id).filter(Boolean))];
  let accounts = new Map(knownUsers.map((user) => [user.id, user.display_name || user.email || user.id]));
  const missing = ids.filter((id) => !accounts.has(id));
  if (missing.length) {
    const { data: users, error } = await client.from("users").select("id,email,display_name").in("id", missing);
    if (error) throw error;
    for (const user of users || []) accounts.set(user.id, user.display_name || user.email || user.id);
  }
  const labeled = records.map((row) => ({ ...row, user_email_or_account: accounts.get(row.user_id) || row.user_id || "" }));
  return { records: labeled, csv: ledgerCsv(labeled) };
}

async function callFeatureCreditRpc(name, args) {
  const allowed = new Set(["reserve_feature_credits", "settle_feature_credits", "release_feature_credits", "migrate_grok_quota_to_credits", "rollback_grok_quota_migration"]);
  if (!allowed.has(name)) throw new Error("不支持的积分操作");
  const clientState = getAdminClient();
  if (!clientState.client) {
    const error = new Error(clientState.error || "在线计量未配置");
    error.statusCode = 503;
    throw error;
  }
  const { data, error } = await clientState.client.rpc(name, args || {});
  if (error) throw error;
  return data;
}

async function migrateGrokQuotaToCredits(payload) {
  const batchId = String(payload?.batchId || payload?.batch_id || "").trim();
  const price = payload?.price == null || payload?.price === "" ? null : Number(payload.price);
  return callFeatureCreditRpc("migrate_grok_quota_to_credits", {
    p_batch_id: batchId,
    p_price: Number.isFinite(price) ? price : null,
    p_force_fail: false
  });
}

module.exports = {
  setAdminConnectionResolver,
  artKnowledgeRequest: (operation, payload) => require('./art-knowledge-manager.cjs').createArtKnowledgeManager({getClient:()=>getAdminClient().client}).request(operation,payload),
  ENV_SUPABASE_URL,
  ENV_SERVICE_ROLE_KEY,
  ENV_SUPABASE_PUBLISHABLE_KEY,
  ENV_SUPABASE_ANON_KEY,
  ENV_COMFYUI_BASE_URL,
  ENV_COMFYUI_API_KEY,
  ENV_COMFYUI_API_KEY_SECRET_REF,
  ENV_GROK_BASE_URL,
  ENV_GROK_API_KEY,
  ENV_GROK_MODEL,
  adminQueries,
  readAdminEnvValue,
  readAdminSupabaseEnv,
  readAdminSupabaseAuthEnv,
  readAdminComfyUiEnv,
  readAdminGrokEnv,
  readAdminRunningHubEnv,
  getAdminRunningHubProviderStatus,
  startDomesticBalanceRefresh,
  getAdminUsers,
  getAdminCredits,
  getAdminAiProviders,
  getAdminAiModels,
  getAdminAiTasks,
  getAdminSystemSettings,
  getAdminUserByEmail,
  getAdminUserByAccount,
  getAdminUserById,
  getAdminCreditByUserId,
  syncAdminAuthUserProfile,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  resetAdminUserPassword,
  accountToAuthEmail,
  accountNameFromEmail,
  upsertAdminAiProvider,
  upsertAdminAiModel,
  upsertAdminSystemSetting,
  settleAdminComfyUsage,
  adjustAdminProviderBudget,
  setAdminProviderRuntimeConfig,
  getAdminProviderCallQuotas,
  getAdminProviderCallQuotaByUserId,
  setAdminProviderCallQuota,
  reserveAdminGrokQuota,
  settleAdminGrokQuota,
  releaseAdminGrokQuota,
  recordAdminGrokUsageDetail,
  recordAdminProviderCallUsage,
  adjustAdminUserCredits,
  getClientAiConfig,
  getClientAiTasks,
  recordClientGatewayTaskDraft,
  recordClientAiTaskUsage,
  getAdminGrokProviderStatus,
  getAdminGpuWorkers,
  getAdminWebTaskUsage,
  getAdminComputeUsageSummary,
  getAdminWorkerRegistrationCodes,
  createAdminWorkerRegistrationCode,
  revokeAdminWorkerRegistrationCode,
  deleteAdminWorkerRegistrationCode,
  purgeAdminWorkerRegistrationCodes,
  setAdminGpuWorkerStatus,
  setAdminGpuWorkerAccessPolicy,
  setAdminGpuWorkerTier,
  deleteAdminGpuWorker,
  hashWorkerRegistrationCode,
  getFeatureCreditAdmin,
  readFeatureCreditConfig,
  saveFeatureCreditAdmin,
  queryCreditLedger,
  callFeatureCreditRpc,
  migrateGrokQuotaToCredits
};
