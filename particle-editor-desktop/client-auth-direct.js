"use strict";

const { createClient } = require("@supabase/supabase-js");

try {
  if (typeof globalThis.WebSocket !== "function") {
    globalThis.WebSocket = require("ws");
  }
} catch {
  // Supabase Auth password login does not require WebSocket, but realtime-capable
  // builds may expect a WebSocket constructor in Electron's Node runtime.
}

const CLIENT_AUTH_TRANSPORT = "supabase-direct";
const INTERNAL_ACCOUNT_EMAIL_DOMAIN = "accounts.novaflow.local";
const INTERNAL_ACCOUNT_EMAIL_PREFIX = "acct_";
const PROVIDER_QUOTA_KEYS = ["grok"];

let cachedClient = null;
let cachedClientKey = "";

function readBundledSupabaseConfig() {
  try {
    return require("./license/config");
  } catch {
    return {};
  }
}

function readClientSupabaseAuthEnv() {
  const config = readBundledSupabaseConfig();
  const supabaseUrl = String(process.env.NOVAFLOW_SUPABASE_URL || config.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const publishableKey = String(
    process.env.NOVAFLOW_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NOVAFLOW_SUPABASE_ANON_KEY ||
    config.SUPABASE_PUBLISHABLE_KEY ||
    ""
  ).trim();
  return {
    supabaseUrl,
    publishableKey,
    configured: Boolean(supabaseUrl && publishableKey),
    hasPublishableKey: Boolean(publishableKey)
  };
}

function getClient() {
  const env = readClientSupabaseAuthEnv();
  if (!env.configured) {
    return {
      client: null,
      env,
      error: "Supabase Auth is not configured"
    };
  }
  const key = `${env.supabaseUrl}|${env.publishableKey}`;
  if (cachedClient && cachedClientKey === key) return { client: cachedClient, env };
  cachedClient = createClient(env.supabaseUrl, env.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  cachedClientKey = key;
  return { client: cachedClient, env };
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
  if (!/^[a-z0-9._-]+$/.test(account)) {
    throw new Error("账号只能包含小写字母、数字、点、下划线或短横线");
  }
  return account;
}

function accountToAuthEmail(value) {
  const raw = String(value || "").trim();
  if (isValidEmail(raw)) return normalizeEmail(raw);
  return `${normalizeAccountName(raw)}@${INTERNAL_ACCOUNT_EMAIL_DOMAIN}`;
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

function validatePassword(password) {
  const text = String(password || "");
  if (!text || text.length < 6) return "请输入至少 6 位密码";
  if (text.length > 128) return "密码不能超过 128 位";
  return "";
}

function normalizeDirectAuthError(error, httpStatus = 500) {
  const raw = String(error?.message || error?.error || error || "").trim();
  if (Number(httpStatus) === 401 || /invalid login credentials/i.test(raw)) return "账号或密码错误";
  if (/email not confirmed/i.test(raw)) return "账号未启用，请联系管理员";
  if (/user not found/i.test(raw)) return "账号不存在";
  if (/jwt expired/i.test(raw)) return "登录已过期，请重新登录";
  if (/permission denied|row-level security|rls/i.test(raw)) return `Supabase 权限不足：${raw}`;
  return raw || "Supabase Auth 请求失败";
}

function userPublicProfile(authUser) {
  const email = normalizeEmail(authUser?.email || "");
  return {
    id: authUser?.id || "",
    email,
    account: accountNameFromEmail(email),
    display_name: authUser?.user_metadata?.display_name || "",
    role: "user",
    plan: "trial",
    status: "active",
    created_at: authUser?.created_at || "",
    updated_at: ""
  };
}

function sessionPublicPayload(session) {
  return {
    token: session?.access_token || "",
    refreshToken: session?.refresh_token || "",
    expiresAt: session?.expires_at || null,
    provider: "supabase_auth",
    transport: CLIENT_AUTH_TRANSPORT
  };
}

async function loginWithPassword(payload) {
  const account = String(payload?.account || payload?.username || payload?.email || "").trim();
  const password = String(payload?.password || "");
  let email = "";
  try {
    email = accountToAuthEmail(account);
  } catch (err) {
    return { ok: false, httpStatus: 400, error: normalizeDirectAuthError(err, 400) };
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return { ok: false, httpStatus: 400, error: passwordError };
  }

  const clientState = getClient();
  if (!clientState.client) {
    return {
      ok: false,
      httpStatus: 503,
      status: "missing",
      baseUrl: clientState.env?.supabaseUrl || "",
      error: clientState.error || "Supabase Auth is not configured"
    };
  }

  const { data, error } = await clientState.client.auth.signInWithPassword({ email, password });
  if (error || !data?.session?.access_token) {
    return {
      ok: false,
      httpStatus: 401,
      transport: CLIENT_AUTH_TRANSPORT,
      baseUrl: clientState.env.supabaseUrl,
      error: normalizeDirectAuthError(error || "Supabase Auth did not return a session", 401)
    };
  }

  return {
    ok: true,
    transport: CLIENT_AUTH_TRANSPORT,
    baseUrl: clientState.env.supabaseUrl,
    user: userPublicProfile(data.user),
    auth: {
      provider: "supabase_password",
      intent: "login",
      transport: CLIENT_AUTH_TRANSPORT
    },
    session: sessionPublicPayload(data.session)
  };
}

async function refreshSession(payload) {
  const refreshToken = String(payload?.refreshToken || payload?.refresh_token || "").trim();
  if (!refreshToken) {
    return {
      ok: false,
      httpStatus: 401,
      transport: CLIENT_AUTH_TRANSPORT,
      error: "登录已过期，请重新登录"
    };
  }

  const clientState = getClient();
  if (!clientState.client) {
    return {
      ok: false,
      httpStatus: 503,
      status: "missing",
      baseUrl: clientState.env?.supabaseUrl || "",
      error: clientState.error || "Supabase Auth is not configured"
    };
  }

  const { data, error } = await clientState.client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session?.access_token) {
    return {
      ok: false,
      httpStatus: 401,
      transport: CLIENT_AUTH_TRANSPORT,
      baseUrl: clientState.env.supabaseUrl,
      error: normalizeDirectAuthError(error || "Supabase Auth did not refresh the session", 401)
    };
  }

  return {
    ok: true,
    transport: CLIENT_AUTH_TRANSPORT,
    baseUrl: clientState.env.supabaseUrl,
    session: sessionPublicPayload(data.session)
  };
}

async function logout(payload) {
  const token = String(payload?.token || "").trim();
  const env = readClientSupabaseAuthEnv();
  if (!token || !env.configured) {
    return { ok: true, transport: CLIENT_AUTH_TRANSPORT, baseUrl: env.supabaseUrl || "" };
  }
  try {
    await fetch(`${env.supabaseUrl}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: env.publishableKey,
        Authorization: `Bearer ${token}`
      }
    });
  } catch {
    // Local session has already been cleared by the renderer. Logout network
    // errors should not block the user from leaving the account.
  }
  return { ok: true, transport: CLIENT_AUTH_TRANSPORT, baseUrl: env.supabaseUrl };
}

async function status() {
  const env = readClientSupabaseAuthEnv();
  return {
    ok: env.configured,
    transport: CLIENT_AUTH_TRANSPORT,
    baseUrl: env.supabaseUrl || "",
    health: {
      ok: env.configured,
      status: env.configured ? "connected" : "missing",
      service: "Supabase Auth",
      transport: CLIENT_AUTH_TRANSPORT
    },
    ready: {
      ok: env.configured,
      service: "Supabase Auth",
      mode: CLIENT_AUTH_TRANSPORT
    },
    error: env.configured ? null : "Supabase Auth is not configured"
  };
}

async function registerDisabled() {
  return {
    ok: false,
    httpStatus: 410,
    transport: CLIENT_AUTH_TRANSPORT,
    error: "主程序不开放注册，请联系管理员开通账号"
  };
}

async function verifyDisabled() {
  return {
    ok: false,
    httpStatus: 410,
    transport: CLIENT_AUTH_TRANSPORT,
    error: "验证码登录已停用，请使用账号和密码登录"
  };
}

module.exports = {
  CLIENT_AUTH_TRANSPORT,
  PROVIDER_QUOTA_KEYS,
  readClientSupabaseAuthEnv,
  accountToAuthEmail,
  accountNameFromEmail,
  validatePassword,
  normalizeDirectAuthError,
  status,
  loginWithPassword,
  refreshSession,
  logout,
  registerDisabled,
  verifyDisabled
};
