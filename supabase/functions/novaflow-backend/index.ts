import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildGrokImageReverseRequest,
  buildGrokPromptOptimizeRequest,
  callGrokResponseWithVisualRetry,
  grokResponsesPublicResult,
  grokVisualFailureEnvelope,
  miniMaxH3FailureEnvelope,
  miniMaxH3ReversePreflightFailure,
  normalizeGrokResponseUsage
} from "./smart-ai-grok.workflow.mjs";
import { readRunningHubLlmConfig, postRunningHubResponses, uiCatalogResponsesRequest, responsesOutputText, DEFAULT_RUNNINGHUB_LLM_MODEL } from "../_art-shared/runninghub-llm.mjs";
import { createOnlineAiCharge } from "../_art-shared/online-ai-charge.mjs";
import { createFeatureCreditPorts, normalizeCreditConfig, publicCreditError } from "../_art-shared/feature-credits.mjs";
import {readRunningHubImageConfig,quoteGptImage,formatCreditButtonLabel,formatCreditButtonTitle,runChargedGptImage,readImagePoolAccount} from "../_art-shared/runninghub-gpt-image.mjs";
import { RELEASE_VERSION } from "../_art-shared/release.mjs";
import { createRunningHubServerConfig } from "../_art-shared/runninghub-server-config.mjs";
import {
  licenseVerificationRejected,
  normalizeLicenseVerificationInput,
  validateLicenseVerificationRecord
} from "./license-verification.workflow.mjs";

const FUNCTION_NAME = "novaflow-backend";
const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_GROK_BODY_BYTES = 512 * 1024;
const MAX_GROK_IMAGE_BODY_BYTES = 10 * 1024 * 1024;
const MAX_LICENSE_VERIFY_BODY_BYTES = 2 * 1024;
const LICENSE_VERIFY_RATE_LIMIT_RPC = "check_novaflow_license_verify_rate_limit";
const LICENSE_VERIFY_RATE_LIMIT_WINDOW_SECONDS = 60;
const LICENSE_VERIFY_RATE_LIMIT_MAX_ATTEMPTS = 10;
const PROVIDER_QUOTA_PREFIX = "provider_quota_";
const PROVIDER_QUOTA_KEYS = ["grok"];
const LOCAL_WORKFLOW_PROVIDER_KEYS = new Set(["comfyui"]);
const INTERNAL_ACCOUNT_EMAIL_DOMAIN = "accounts.novaflow.local";
const INTERNAL_ACCOUNT_EMAIL_PREFIX = "acct_";
const USER_COLUMNS = "id,email,display_name,role,plan,status,max_sessions,expires_at,created_at,updated_at";
const ACCOUNT_EXPIRED_MESSAGE = "账号已到期，请联系管理员";
const SESSION_REPLACED_MESSAGE = "账号已在其他设备登录";

type AnyRecord = Record<string, unknown>;

type PublicUser = {
  id: string;
  email: string;
  display_name?: string | null;
  role?: string | null;
  plan?: string | null;
  status?: string | null;
  max_sessions?: number | null;
  expires_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ProviderQuotaRecord = {
  key: string;
  provider_key: string;
  user_id: string;
  email: string;
  display_name: string;
  allocated_count: number;
  used_count: number;
  reserved_count: number;
  remaining_count: number;
  status: string;
  note: string;
  updated_at: string;
  raw_value: AnyRecord;
};

function env(name: string): string {
  return String(Deno.env.get(name) || "").trim();
}

function parseSecretDictionary(name: string): Record<string, string> {
  const raw = env(name);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => typeof value === "string" && value)
        .map(([key, value]) => [key, String(value)])
    );
  } catch {
    return {};
  }
}

function firstJwtLikeValue(values: Record<string, string>): string {
  return Object.values(values).find((value) => value.split(".").length >= 3) || "";
}

function serviceRoleKey(): string {
  const secrets = parseSecretDictionary("SUPABASE_SECRET_KEYS");
  return env("NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY") ||
    env("SUPABASE_SERVICE_ROLE_KEY") ||
    secrets.service_role ||
    secrets.service_role_key ||
    firstJwtLikeValue(secrets);
}

function publishableKey(): string {
  const publishable = parseSecretDictionary("SUPABASE_PUBLISHABLE_KEYS");
  return env("NOVAFLOW_SUPABASE_PUBLISHABLE_KEY") ||
    env("SUPABASE_ANON_KEY") ||
    publishable.anon ||
    publishable.publishable ||
    firstJwtLikeValue(publishable) ||
    serviceRoleKey();
}

function supabaseUrl(): string {
  return (env("NOVAFLOW_SUPABASE_URL") || env("SUPABASE_URL")).replace(/\/+$/, "");
}

function sessionSecret(): string {
  return env("NOVAFLOW_SESSION_SECRET");
}

function sessionTtlSeconds(): number {
  const value = Number(env("NOVAFLOW_SESSION_TTL_SECONDS"));
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SESSION_TTL_SECONDS;
}

const serverProvider = createRunningHubServerConfig({rpc:(name:string,args:AnyRecord)=>adminClient().rpc(name,args),env});
function runningHubLlm() {
  try {
    return serverProvider.read();
  } catch {
    return { apiKey: "", baseUrl: "", model: DEFAULT_RUNNINGHUB_LLM_MODEL, configured: false };
  }
}

function grokModel(): string {
  return runningHubLlm().model;
}

function grokApiKey(): string {
  return runningHubLlm().apiKey;
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type,x-novaflow-admin-token,x-request-id",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

function jsonResponse(req: Request, status: number, payload: AnyRecord): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
}

function sanitizeError(error: unknown): string {
  let message = String(error instanceof Error ? error.message : error || "unknown");
  const secrets = [
    serviceRoleKey(),
    publishableKey(),
    sessionSecret(),
    grokApiKey(),
    env("NOVAFLOW_COMFYUI_API_KEY")
  ].filter(Boolean);
  for (const secret of secrets) {
    message = message.split(secret).join("[redacted]");
  }
  return message;
}

function errorHttpStatus(error: unknown, fallback: number): number {
  const statusCode = Number((error as Error & { statusCode?: number })?.statusCode || fallback);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600 ? statusCode : fallback;
}

function logInfo(message: string, details: AnyRecord = {}): void {
  const safe = Object.fromEntries(
    Object.entries(details).filter(([key]) => !/key|secret|token/i.test(key))
  );
  console.log(`[NovaFlowBackend] ${new Date().toISOString()} ${message}`, safe);
}

function adminClient() {
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) throw new Error("Supabase service role is not configured");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function authClient() {
  const url = supabaseUrl();
  const key = publishableKey();
  if (!url || !key) throw new Error("Supabase auth is not configured");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function normalizePath(url: URL): string {
  let path = url.pathname.replace(/\/+$/, "") || "/";
  const prefix = `/${FUNCTION_NAME}`;
  if (path === prefix) return "/";
  if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
  return path || "/";
}

async function parseJsonBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<AnyRecord> {
  const text = await req.text();
  const size = new TextEncoder().encode(text).length;
  if (size > maxBytes) {
    const error = new Error("request body too large") as Error & { statusCode?: number };
    error.statusCode = 413;
    throw error;
  }
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const error = new Error("invalid json request body") as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as AnyRecord;
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeAccountName(value: unknown): string {
  const account = String(value || "").trim().toLowerCase();
  if (!account) throw new Error("account is required");
  if (account.length < 2) throw new Error("account must be at least 2 characters");
  if (account.length > 64) throw new Error("account is too long");
  if (!/^[a-z0-9._-]+$/.test(account)) throw new Error("account can only contain lowercase letters, numbers, dot, underscore, or hyphen");
  return account;
}

function accountToAuthEmail(value: unknown): string {
  const raw = String(value || "").trim();
  if (isValidEmail(raw)) return normalizeEmail(raw);
  const account = normalizeAccountName(raw);
  return `${account}@${INTERNAL_ACCOUNT_EMAIL_DOMAIN}`;
}

function accountNameFromEmail(value: unknown): string {
  const email = normalizeEmail(value);
  const suffix = `@${INTERNAL_ACCOUNT_EMAIL_DOMAIN}`;
  if (!email.endsWith(suffix)) return email;
  const local = email.slice(0, -suffix.length);
  if (!local.startsWith(INTERNAL_ACCOUNT_EMAIL_PREFIX)) return local;
  try {
    const account = new TextDecoder().decode(base64UrlDecode(local.slice(INTERNAL_ACCOUNT_EMAIL_PREFIX.length)));
    return /^[a-z0-9._-]{2,64}$/.test(account) ? account : email;
  } catch {
    return email;
  }
}

function validatePassword(password: string): string {
  if (!password || password.length < 6) return "password must be at least 6 characters";
  if (password.length > 128) return "password is too long";
  return "";
}

function isActiveUser(user: PublicUser | null): boolean {
  return String(user?.status || "active").toLowerCase() === "active";
}

function isAccountExpired(user: PublicUser | null): boolean {
  const expiresAt = Date.parse(String(user?.expires_at || ""));
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function codedError(statusCode: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

function publicUser(user: PublicUser): AnyRecord {
  const account = accountNameFromEmail(user.email || "");
  return {
    id: user.id || "",
    account,
    email: account,
    display_name: user.display_name || "",
    role: user.role || "user",
    plan: user.plan || "trial",
    status: user.status || "active",
    max_sessions: Number(user.max_sessions || 1),
    expires_at: user.expires_at || null,
    created_at: user.created_at || ""
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlJson(value: AnyRecord): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

async function hmacSha256(input: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(signature));
}

function safeCompare(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function licenseVerificationClientIp(req: Request): string {
  const forwarded = String(req.headers.get("x-forwarded-for") || "").split(",")[0];
  return String(
    req.headers.get("cf-connecting-ip") ||
    forwarded ||
    req.headers.get("x-real-ip") ||
    "unknown"
  ).trim().slice(0, 128) || "unknown";
}

async function licenseVerificationIdentityHash(
  req: Request,
  input: { licenseKey: string; machineId: string }
): Promise<string> {
  const identity = [
    "novaflow-license-verify-v1",
    input.licenseKey,
    input.machineId,
    licenseVerificationClientIp(req)
  ].join("\u0000");
  return await sha256Hex(identity);
}

async function enforceLicenseVerificationRateLimit(
  req: Request,
  input: { licenseKey: string; machineId: string }
): Promise<void> {
  const identityHash = await licenseVerificationIdentityHash(req, input);
  const { data, error } = await adminClient().rpc(LICENSE_VERIFY_RATE_LIMIT_RPC, {
    p_identity_hash: identityHash,
    p_window_seconds: LICENSE_VERIFY_RATE_LIMIT_WINDOW_SECONDS,
    p_max_attempts: LICENSE_VERIFY_RATE_LIMIT_MAX_ATTEMPTS
  });
  if (error) throw error;
  const result = (Array.isArray(data) ? data[0] : data) as AnyRecord | null;
  if (!result || typeof result.allowed !== "boolean") {
    throw new Error("license verification rate limit returned an invalid result");
  }
  if (!result.allowed) {
    const rateError = new Error("license verification rate limit exceeded") as Error & { statusCode?: number };
    rateError.statusCode = 429;
    throw rateError;
  }
}

async function issueSessionToken(user: PublicUser, sessionId: string): Promise<AnyRecord> {
  const secret = sessionSecret();
  if (!secret) throw new Error("NOVAFLOW_SESSION_SECRET is not configured");
  const now = Math.floor(Date.now() / 1000);
  const ttl = sessionTtlSeconds();
  const payload = {
    sub: String(user.id || ""),
    sid: sessionId,
    email: String(user.email || ""),
    plan: String(user.plan || "trial"),
    status: String(user.status || "active"),
    iat: now,
    exp: now + ttl,
    nonce: crypto.randomUUID()
  };
  const encoded = base64UrlJson(payload);
  const signature = await hmacSha256(encoded, secret);
  return {
    token: `nfs_${encoded}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    ttlSeconds: ttl
  };
}

async function verifySessionToken(token: string): Promise<AnyRecord> {
  const secret = sessionSecret();
  if (!secret) throw new Error("NOVAFLOW_SESSION_SECRET is not configured");
  const raw = String(token || "").trim();
  if (!raw.startsWith("nfs_")) throw new Error("invalid session token");
  const parts = raw.slice(4).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("invalid session token");
  const expected = await hmacSha256(parts[0], secret);
  if (!safeCompare(parts[1], expected)) throw new Error("invalid session token");
  let payload: AnyRecord;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  } catch {
    throw new Error("invalid session token");
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.sub || !payload.exp || Number(payload.exp) <= now) throw new Error("session expired");
  return payload;
}

function bearerToken(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  return /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, "").trim() : "";
}

async function readUserById(userId: string): Promise<PublicUser | null> {
  const { data, error } = await adminClient()
    .from("users")
    .select(USER_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as PublicUser | null;
}

async function verifySupabaseClientSessionToken(token: string): Promise<AnyRecord> {
  const raw = String(token || "").trim();
  if (!raw) {
    const error = new Error("missing session token") as Error & { statusCode?: number };
    error.statusCode = 401;
    throw error;
  }
  const { data, error } = await authClient().auth.getUser(raw);
  if (error || !data?.user?.id) {
    const authError = new Error(error?.message || "invalid session token") as Error & { statusCode?: number };
    authError.statusCode = 401;
    throw authError;
  }
  return {
    sub: String(data.user.id || ""),
    email: String(data.user.email || ""),
    provider: "supabase_auth"
  };
}

// Tokens minted before user_sessions existed carry no sid; they stay valid
// until their own exp. A sid whose row is gone or revoked was pushed out by a
// newer login (or a password change) on the same account.
async function sessionIsLive(sessionId: string, userId: string): Promise<boolean> {
  const { data, error } = await adminClient()
    .from("user_sessions")
    .select("id,user_id,revoked_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data && String((data as AnyRecord).user_id) === userId && !(data as AnyRecord).revoked_at);
}

async function requireSession(req: Request): Promise<{ user: PublicUser; payload: AnyRecord }> {
  const token = bearerToken(req);
  const payload = String(token || "").trim().startsWith("nfs_")
    ? await verifySessionToken(token)
    : await verifySupabaseClientSessionToken(token);
  const userId = String(payload.sub || "");
  const sessionId = String(payload.sid || "");
  const [user, live] = await Promise.all([
    readUserById(userId),
    sessionId ? sessionIsLive(sessionId, userId) : Promise.resolve(true)
  ]);
  if (!user) throw new Error("session user not found");
  if (!isActiveUser(user)) {
    const err = new Error("user disabled");
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
  if (isAccountExpired(user)) throw codedError(403, "account_expired", ACCOUNT_EXPIRED_MESSAGE);
  if (!live) throw codedError(401, "session_replaced", SESSION_REPLACED_MESSAGE);
  return { user, payload };
}

async function openUserSession(req: Request, userId: string): Promise<string> {
  const { data, error } = await adminClient().rpc("novaflow_open_user_session", {
    p_user_id: userId,
    p_user_agent: String(req.headers.get("user-agent") || "").slice(0, 300)
  });
  if (error) throw error;
  const sessionId = String(Array.isArray(data) ? data[0] : data || "");
  if (!sessionId) throw new Error("could not open a login session");
  return sessionId;
}

async function ensureCreditRow(userId: string): Promise<AnyRecord> {
  const client = adminClient();
  const { data: existing, error: readError } = await client
    .from("credits")
    .select("id,user_id,balance,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return existing as AnyRecord;
  const { data, error } = await client
    .from("credits")
    .insert({ user_id: userId, balance: 0 })
    .select("id,user_id,balance,updated_at")
    .maybeSingle();
  if (error) throw error;
  return (data || { user_id: userId, balance: 0 }) as AnyRecord;
}

async function creditBalance(userId: string): Promise<{ balance: number; record: AnyRecord }> {
  const record = await ensureCreditRow(userId);
  const balance = Number(record.balance || 0);
  return { balance: Number.isFinite(balance) ? balance : 0, record };
}

async function syncAuthUserProfile(input: { authUserId: string; email: string; displayName?: string }): Promise<PublicUser> {
  const client = adminClient();
  const email = normalizeEmail(input.email);
  const displayName = String(input.displayName || "").trim().slice(0, 120);
  const { data: existing, error: readError } = await client
    .from("users")
    .select(USER_COLUMNS)
    .or(`id.eq.${input.authUserId},email.eq.${email}`)
    .limit(1)
    .maybeSingle();
  if (readError) throw readError;

  let user: PublicUser;
  if (existing) {
    const updatePayload: AnyRecord = {
      email,
      updated_at: new Date().toISOString()
    };
    if (displayName) updatePayload.display_name = displayName;
    const { data, error } = await client
      .from("users")
      .update(updatePayload)
      .eq("id", (existing as PublicUser).id)
      .select(USER_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    user = (data || existing) as PublicUser;
  } else {
    const { data, error } = await client
      .from("users")
      .insert({
        id: input.authUserId,
        email,
        display_name: displayName,
        role: "user",
        plan: "trial",
        status: "active"
      })
      .select(USER_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    user = data as PublicUser;
  }
  await ensureCreditRow(user.id);
  return user;
}

async function authPayload(req: Request, user: PublicUser, provider: string, intent: string): Promise<Response> {
  if (!isActiveUser(user)) return jsonResponse(req, 403, { ok: false, error: "user disabled" });
  if (isAccountExpired(user)) return jsonResponse(req, 403, { ok: false, error: ACCOUNT_EXPIRED_MESSAGE, code: "account_expired" });
  const session = await issueSessionToken(user, await openUserSession(req, user.id));
  const credits = await creditBalance(user.id);
  logInfo("client auth", { intent, userId: user.id, email: user.email, creditBalance: credits.balance });
  return jsonResponse(req, 200, {
    ok: true,
    auth: { provider, intent },
    session,
    user: publicUser(user),
    credits: {
      balance: credits.balance,
      source: "supabase",
      status: "connected"
    }
  });
}

async function handleRegister(req: Request): Promise<Response> {
  return jsonResponse(req, 410, {
    ok: false,
    error: "self registration is disabled; ask the NovaFlow administrator to create an account"
  });
}

async function handleLogin(req: Request): Promise<Response> {
  const payload = await parseJsonBody(req);
  let email = "";
  try {
    email = accountToAuthEmail(payload.account || payload.username || payload.email);
  } catch (error) {
    return jsonResponse(req, 400, { ok: false, error: sanitizeError(error) });
  }
  const password = String(payload.password || "");
  const passwordError = validatePassword(password);
  if (passwordError) return jsonResponse(req, 400, { ok: false, error: passwordError });

  const { data, error } = await authClient().auth.signInWithPassword({ email, password });
  if (error) return jsonResponse(req, 401, { ok: false, error: `Supabase Auth Error: ${sanitizeError(error)}` });
  const authUser = data?.user;
  if (!authUser?.id) return jsonResponse(req, 401, { ok: false, error: "Supabase Auth did not return a logged-in user" });
  const user = await syncAuthUserProfile({
    authUserId: authUser.id,
    email: normalizeEmail(authUser.email || email),
    displayName: String(authUser.user_metadata?.display_name || payload.displayName || payload.display_name || "")
  });
  return await authPayload(req, user, "supabase_password", "login");
}

function quotaKey(providerKey: string, userId: string): string {
  return `${PROVIDER_QUOTA_PREFIX}${normalizeProviderKey(providerKey)}_${userId}`;
}

function normalizeProviderKey(value: unknown): string {
  const key = String(value || "grok").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80);
  if (!key) throw new Error("provider is required");
  return key;
}

function normalizeProviderQuota(setting: AnyRecord | null, user: PublicUser, providerKey: string): ProviderQuotaRecord {
  const value = setting?.value && typeof setting.value === "object" && !Array.isArray(setting.value)
    ? setting.value as AnyRecord
    : {};
  const allocated = Math.max(0, Number(value.allocated_count ?? value.allocatedCount ?? 0) || 0);
  const used = Math.max(0, Number(value.used_count ?? value.usedCount ?? 0) || 0);
  const reserved = Math.max(0, Number(value.reserved_count ?? value.reservedCount ?? 0) || 0);
  return {
    key: String(setting?.key || quotaKey(providerKey, user.id)),
    provider_key: providerKey,
    user_id: user.id,
    email: user.email,
    display_name: String(user.display_name || ""),
    allocated_count: allocated,
    used_count: used,
    reserved_count: reserved,
    remaining_count: Math.max(0, allocated - used - reserved),
    status: allocated > used + reserved ? "available" : "empty",
    note: String(value.note || ""),
    updated_at: String(setting?.updated_at || value.updated_at || ""),
    raw_value: { ...value }
  };
}

async function readProviderQuota(user: PublicUser, providerKey: string): Promise<ProviderQuotaRecord> {
  const key = quotaKey(providerKey, user.id);
  const { data, error } = await adminClient()
    .from("system_settings")
    .select("key,value,updated_at")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return normalizeProviderQuota((data || null) as AnyRecord | null, user, providerKey);
}

function providerQuotaPayload(quota: ProviderQuotaRecord): AnyRecord {
  return {
    status: quota.remaining_count > 0 ? "available" : "empty",
    allocated_count: quota.allocated_count,
    used_count: quota.used_count,
    reserved_count: quota.reserved_count,
    remaining_count: quota.remaining_count
  };
}

function creditQuotaPayload(quota: AnyRecord | null | undefined): AnyRecord {
  const row = quota || {};
  if (row.local === true || row.settled_credits != null || row.balance_after != null || row.estimated_credits != null) {
    return {
      status: row.local === true ? "local" : String(row.status || "settled"),
      charged_credits: Number(row.settled_credits ?? row.charged_credits ?? 0),
      estimated_credits: row.estimated_credits ?? null,
      balance_after: row.balance_after ?? null,
      feature: row.feature || "",
      local: row.local === true
    };
  }
  return providerQuotaPayload(row as ProviderQuotaRecord);
}

async function enabledProviders(): Promise<AnyRecord[]> {
  const { data, error } = await adminClient()
    .from("ai_providers")
    .select("id,provider_key,name,status,billing_multiplier")
    .eq("status", "enabled")
    .limit(100);
  if (error) return [];
  return Array.isArray(data) ? data as AnyRecord[] : [];
}

async function readFeatureCreditConfig(): Promise<AnyRecord> {
  const { data, error } = await adminClient()
    .from("system_settings")
    .select("value")
    .eq("key", "feature_credit_config")
    .maybeSingle();
  if (error || !data) return {};
  const value = (data as AnyRecord).value;
  return value && typeof value === "object" ? value as AnyRecord : {};
}

async function clientSettings(): Promise<AnyRecord[]> {
  const { data, error } = await adminClient()
    .from("system_settings")
    .select("key,value,updated_at")
    .in("key", ["default_billing_multiplier", "gateway_default_credit_cost"])
    .limit(100);
  if (error) return [];
  return Array.isArray(data) ? data as AnyRecord[] : [];
}

async function handleBootstrap(req: Request, session: { user: PublicUser }): Promise<Response> {
  const providerKeys = PROVIDER_QUOTA_KEYS;
  const [credits, providers, settings, ...quotaResults] = await Promise.all([
    creditBalance(session.user.id),
    enabledProviders(),
    clientSettings(),
    ...providerKeys.map((providerKey) => readProviderQuota(session.user, providerKey))
  ]);
  const quotas: Record<string, AnyRecord> = {};
  providerKeys.forEach((providerKey, index) => {
    const quota = quotaResults[index] as ProviderQuotaRecord;
    quotas[providerKey] = {
      status: "connected",
      allocated_count: quota.allocated_count,
      used_count: quota.used_count,
      remaining_count: quota.remaining_count
    };
  });
  return jsonResponse(req, 200, {
    ok: true,
    mode: "lite",
    user: publicUser(session.user),
    credits: {
      balance: credits.balance,
      source: "supabase",
      status: "connected"
    },
    featureCreditPrices: normalizeCreditConfig(await readFeatureCreditConfig()),
    providerQuotas: quotas,
    ai: {
      ok: true,
      result: {
        source: "supabase",
        status: "connected",
        providers,
        models: [],
        settings
      }
    },
    providerStatus: null,
    gateway: {
      endpoint: "POST /api/ai/tasks",
      usageEndpoint: "POST /api/ai/tasks/usage",
      localWorkflowAuthorizeEndpoint: "POST /api/ai/tasks",
      localWorkflowUsageEndpoint: "POST /api/ai/tasks/usage",
      grokEndpoint: "POST /api/provider/grok/chat",
      smartAiPromptOptimizeEndpoint: "POST /api/client/grok/prompt-optimize",
      smartAiImageReverseEndpoint: "POST /api/client/grok/image-reverse",
      mode: "gateway_lite_check",
      calculatesCreditCost: true,
      deductsCredits: false,
      localWorkflowDeductsCredits: true,
      writesTaskRecords: false,
      writesConsumptionRecords: false,
      storesWorkflow: false,
      callsProvider: false
    }
  });
}

function parseCreditCost(payload: AnyRecord, allowZero = false): number {
  const raw = payload.estimatedCreditCost ?? payload.creditCost ?? payload.credit_cost ?? payload.cost ?? 0;
  const cost = Number(raw);
  if (!Number.isFinite(cost)) throw new Error("credit cost must be a number");
  if (allowZero ? cost < 0 : cost <= 0) {
    throw new Error(allowZero ? "credit cost must be greater than or equal to 0" : "credit cost must be greater than 0");
  }
  return Math.ceil(cost);
}

function settingNumber(settings: AnyRecord[], keys: string[], fallback: number): number {
  for (const key of keys) {
    const record = settings.find((item) => String(item.key || "") === key);
    const rawValue = record?.value;
    const value = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue as AnyRecord).value ?? (rawValue as AnyRecord).amount ?? (rawValue as AnyRecord).cost
      : rawValue;
    const parsed = Number(String(value ?? "").replace(/x$/i, ""));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return fallback;
}

function fallbackBaseCost(taskType: string): number {
  const key = String(taskType || "").toLowerCase();
  if (key.includes("video")) return 500;
  if (key.includes("image") || key.includes("repaint")) return 100;
  if (key.includes("prompt")) return 10;
  return 25;
}

function parseGatewayTask(payload: AnyRecord): AnyRecord {
  const parameters = payload.parameters && typeof payload.parameters === "object" && !Array.isArray(payload.parameters)
    ? payload.parameters as AnyRecord
    : {};
  const providerKey = normalizeProviderKey(payload.provider || payload.providerKey || payload.provider_key);
  const modelKey = String(payload.modelKey || payload.model_key || payload.model || parameters.modelKey || parameters.model_key || "unconfigured")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, "_")
    .slice(0, 120) || "unconfigured";
  const taskType = String(payload.taskType || payload.task_type || parameters.taskType || parameters.task_type || "ai_task").trim().slice(0, 100) || "ai_task";
  return { providerKey, modelKey, taskType };
}

async function calculateCreditCost(task: AnyRecord): Promise<AnyRecord> {
  const [settings, providers] = await Promise.all([clientSettings(), enabledProviders()]);
  const taskKey = String(task.taskType || "ai_task").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "ai_task";
  const baseCost = settingNumber(settings, [`gateway_cost_${taskKey}`, `credit_cost_${taskKey}`, "gateway_default_credit_cost"], fallbackBaseCost(String(task.taskType || "")));
  const provider = providers.find((item) => String(item.provider_key || "").toLowerCase() === task.providerKey);
  const multiplier = Number(provider?.billing_multiplier ?? 1);
  return {
    creditCost: Math.max(1, Math.ceil(baseCost * (Number.isFinite(multiplier) ? multiplier : 1))),
    source: "supabase",
    status: "connected",
    baseCost,
    providerMultiplier: Number.isFinite(multiplier) ? multiplier : 1,
    modelMultiplier: 1
  };
}

function parseCanonicalCreditAmount(value: unknown): { amountText: string; amount: number } {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,13})\.\d{6}$/.test(value)) {
    throw new Error("canonical credit amount is invalid");
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("canonical credit amount is invalid");
  return { amountText: value, amount };
}

async function calculateLocalWorkflowCreditCost(payload: AnyRecord, _task: AnyRecord): Promise<AnyRecord> {
  const parameters = payload.parameters && typeof payload.parameters === "object" && !Array.isArray(payload.parameters)
    ? payload.parameters as AnyRecord
    : {};
  const pricingSource = String(payload.pricingSource || payload.pricing_source || parameters.pricingSource || "unknown").slice(0, 120);
  const imageTask = String(_task?.taskType || "") === "local_workflow_image";
  const exactImagePricing = imageTask && pricingSource === "comfy_api_exact_price_v1";
  if (exactImagePricing) {
    const exact = parseCanonicalCreditAmount(payload.chargeAmount ?? payload.charge_amount);
    const estimatedCreditCost = Number(payload.estimatedCreditCost ?? payload.estimated_credit_cost ?? exact.amount);
    if (!Number.isFinite(estimatedCreditCost) || estimatedCreditCost < 0) throw new Error("credit cost must be a number");
    return {
      creditCost: exact.amount,
      chargeAmount: exact.amountText,
      estimatedCreditCost,
      source: pricingSource,
      status: exact.amount > 0 ? "known" : "pending_pricing",
      baseCost: exact.amount,
      providerMultiplier: 1,
      modelMultiplier: 1
    };
  }
  if (imageTask) {
    const estimate = Number(payload.estimatedCreditCost ?? payload.estimated_credit_cost ?? 0);
    return {
      creditCost: 0,
      estimatedCreditCost: Number.isFinite(estimate) && estimate > 0 ? estimate : 0,
      source: pricingSource,
      status: "pending_pricing",
      baseCost: 0,
      providerMultiplier: 1,
      modelMultiplier: 1
    };
  }
  const rawCost = Number(payload.estimatedCreditCost ?? payload.creditCost ?? payload.credit_cost ?? payload.cost ?? 0);
  if (Number.isFinite(rawCost) && rawCost > 0) {
    return {
      creditCost: Math.ceil(rawCost),
      estimatedCreditCost: rawCost,
      source: pricingSource === "unknown" ? "workflow" : pricingSource,
      status: "known",
      baseCost: rawCost,
      providerMultiplier: 1,
      modelMultiplier: 1
    };
  }
  return {
    creditCost: 0,
    estimatedCreditCost: 0,
    source: pricingSource,
    status: "pending_pricing",
    baseCost: 0,
    providerMultiplier: 1,
    modelMultiplier: 1
  };
}

async function deductCredits(userId: string, amount: number): Promise<AnyRecord> {
  const cost = Math.max(1, Math.ceil(Number(amount || 0)));
  const current = await ensureCreditRow(userId);
  if (!current.id) throw new Error("credit balance row is missing an id");
  const beforeBalance = Number(current.balance || 0);
  const afterBalance = beforeBalance - cost;
  if (afterBalance < 0) throw new Error("insufficient credits");
  const { data, error } = await adminClient()
    .from("credits")
    .update({ balance: afterBalance, updated_at: new Date().toISOString() })
    .eq("id", current.id)
    .select("id,user_id,balance,updated_at")
    .maybeSingle();
  if (error) throw error;
  return {
    beforeBalance,
    afterBalance,
    deducted: cost,
    credit: (data || { ...current, balance: afterBalance }) as AnyRecord
  };
}

async function handleCreditCheck(req: Request, session: { user: PublicUser }): Promise<Response> {
  const payload = await parseJsonBody(req);
  const cost = parseCreditCost(payload, true);
  const credits = await creditBalance(session.user.id);
  return jsonResponse(req, 200, {
    ok: true,
    user: publicUser(session.user),
    credits: {
      balance: credits.balance,
      required: cost,
      enough: credits.balance >= cost
    }
  });
}

async function handleAiTasks(req: Request, session: { user: PublicUser }): Promise<Response> {
  const payload = await parseJsonBody(req);
  if (payload.recordUsage || payload.record_usage || payload.commitUsage || payload.commit_usage) {
    return jsonResponse(req, 400, {
      ok: false,
      error: "recordUsage has been disabled; the lite Gateway does not write task or consumption records"
    });
  }
  const task = parseGatewayTask(payload);
  const pricing = LOCAL_WORKFLOW_PROVIDER_KEYS.has(String(task.providerKey || ""))
    ? await calculateLocalWorkflowCreditCost(payload, task)
    : await calculateCreditCost(task);
  const credits = await creditBalance(session.user.id);
  if (LOCAL_WORKFLOW_PROVIDER_KEYS.has(String(task.providerKey || ""))) {
    return jsonResponse(req, 200, {
      ok: true,
      accepted: false,
      mode: "local_workflow_credit_authorize",
      message: "ComfyUI generation is never blocked by balance. Successful output will be settled afterward using the workflow's real charge.",
      user: publicUser(session.user),
      provider: {
        providerKey: task.providerKey,
        modelKey: task.modelKey,
        taskType: task.taskType
      },
      pricing,
      credits: {
        balance: credits.balance,
        required: pricing.creditCost,
        enough: true,
        overdraftAllowed: true,
        deducted: 0
      },
      providerBudget: {
        providerKey: task.providerKey,
        settlementMode: "post_success_atomic",
        overdraftAllowed: true
      },
      localWorkflow: {
        runtime: "comfyui",
        callsProvider: false,
        storesWorkflow: false
      }
    });
  }
  if (credits.balance < Number(pricing.creditCost || 0)) {
    return jsonResponse(req, 402, {
      ok: false,
      error: "insufficient credits",
      mode: "gateway_lite_check",
      pricing,
      credits: {
        balance: credits.balance,
        required: pricing.creditCost,
        enough: false
      }
    });
  }
  return jsonResponse(req, 200, {
    ok: true,
    accepted: false,
    mode: "gateway_lite_check",
    message: "Lite Gateway check passed. No task record, consumption record, workflow hash, or credit deduction was written.",
    user: publicUser(session.user),
    provider: {
      providerKey: task.providerKey,
      modelKey: task.modelKey,
      taskType: task.taskType
    },
    pricing,
    credits: {
      balance: credits.balance,
      required: pricing.creditCost,
      enough: true,
      deducted: 0
    }
  });
}

async function handleAiTaskUsage(req: Request, session: { user: PublicUser }): Promise<Response> {
  const payload = await parseJsonBody(req);
  const task = parseGatewayTask(payload);
  if (!LOCAL_WORKFLOW_PROVIDER_KEYS.has(String(task.providerKey || ""))) {
    return jsonResponse(req, 400, {
      ok: false,
      error: "local workflow usage can only be committed for comfyui",
      provider: {
        providerKey: task.providerKey,
        modelKey: task.modelKey,
        taskType: task.taskType
      }
    });
  }

  const pricing = await calculateLocalWorkflowCreditCost(payload, task);
  const promptId = String(payload.promptId || payload.prompt_id || "").trim().slice(0, 160);
  if (!promptId) {
    return jsonResponse(req, 400, {
      ok: false,
      error: "ComfyUI prompt id is required for idempotent usage settlement",
      mode: "local_workflow_credit_usage",
      provider: {
        providerKey: task.providerKey,
        modelKey: task.modelKey,
        taskType: task.taskType
      }
    });
  }

  const parameters = payload.parameters && typeof payload.parameters === "object" && !Array.isArray(payload.parameters)
    ? payload.parameters as AnyRecord
    : {};
  const usageKey = `comfyui:${promptId}`;
  const { data, error } = await adminClient().rpc("settle_comfy_usage", {
    p_usage_key: usageKey,
    p_user_id: session.user.id,
    p_prompt_id: promptId,
    p_provider_key: task.providerKey,
    p_model_key: task.modelKey,
    p_task_type: task.taskType,
    p_estimated_credit_cost: Number(pricing.estimatedCreditCost || 0),
    p_charge_amount: pricing.chargeAmount ?? Number(pricing.creditCost || 0),
    p_pricing_source: String(pricing.source || parameters.pricingSource || "unknown"),
    p_pricing_details: {
      runtime: "comfyui",
      workflowNodeType: String(parameters.workflowNodeType || ""),
      pricingStatus: pricing.status,
      clientSource: String(parameters.source || "")
    }
  });
  if (error) throw error;
  const settlement = data && typeof data === "object" && !Array.isArray(data) ? data as AnyRecord : {};
  const pendingPricing = settlement.status === "pending_pricing";
  return jsonResponse(req, 200, {
    ok: true,
    mode: "local_workflow_credit_usage",
    message: pendingPricing
      ? "ComfyUI output was recorded with pending pricing; no fabricated fixed charge was deducted."
      : "ComfyUI real workflow charge was atomically deducted from user credits and the manual provider balance.",
    user: publicUser(session.user),
    provider: {
      providerKey: task.providerKey,
      modelKey: task.modelKey,
      taskType: task.taskType,
      promptId
    },
    pricing,
    usageKey,
    idempotent: Boolean(settlement.idempotent),
    pendingPricing,
    settlement,
    credits: pendingPricing ? null : settlement.credits || null,
    providerBudget: settlement.provider_budget || null,
    localWorkflow: {
      runtime: "comfyui",
      callsProvider: false,
      storesWorkflow: false
    }
  });
}

function normalizeGrokRole(value: unknown): string {
  const role = String(value || "user").trim().toLowerCase();
  return ["system", "user", "assistant"].includes(role) ? role : "user";
}

function normalizeGrokPayload(payload: AnyRecord): { body: AnyRecord; inputMeta: AnyRecord } {
  const sourceMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const messages = sourceMessages.length
    ? sourceMessages.map((item) => ({
      role: normalizeGrokRole((item as AnyRecord)?.role),
      content: String((item as AnyRecord)?.content || "").slice(0, 20000)
    })).filter((item) => item.content.trim())
    : [{ role: "user", content: String(payload.prompt || payload.input || "").slice(0, 20000) }].filter((item) => item.content.trim());
  if (!messages.length) throw new Error("grok prompt or messages are required");
  const charCount = messages.reduce((sum, item) => sum + item.content.length, 0);
  if (charCount > 24000) throw new Error("grok text input is too large");
  const body: AnyRecord = { model: grokModel(), messages };
  const temperature = Number(payload.temperature);
  if (Number.isFinite(temperature)) body.temperature = Math.max(0, Math.min(2, temperature));
  const maxTokens = Number(payload.max_tokens ?? payload.maxTokens);
  if (Number.isInteger(maxTokens) && maxTokens > 0) body.max_tokens = Math.min(4096, maxTokens);
  return { body, inputMeta: { messageCount: messages.length, charCount } };
}

function grokPublicResult(data: AnyRecord): AnyRecord {
  return {
    id: data.id || "",
    object: data.object || "",
    created: data.created || null,
    model: data.model || "",
    choices: Array.isArray(data.choices) ? data.choices : [],
    usage: data.usage || null
  };
}

async function callGrok(payload: AnyRecord): Promise<AnyRecord> {
  const config = runningHubLlm();
  const { body, inputMeta } = normalizeGrokPayload(payload);
  const startedAt = Date.now();
  try {
    const posted = await postRunningHubResponses({ body:{...body,reasoning:{effort:'low'}}, config, timeoutMs: 45000, maxRetries: 0 });
    return {
      ok: true,
      statusCode: posted.status,
      durationMs: Date.now() - startedAt,
      model: posted.data.model || config.model,
      inputMeta,
      data: grokPublicResult({
        id: posted.data.id,
        model: posted.data.model || config.model,
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: posted.data.output_text } }],
        usage: posted.data.usage
      })
    };
  } catch (error) {
    const trackedError = error as Error & { grokProviderCallCount?: number; providerCallStarted?: boolean };
    trackedError.grokProviderCallCount = trackedError.providerCallStarted ? 1 : 0;
    throw trackedError;
  }
}

function isGrokResponseAttemptResultUsable(result: AnyRecord, resultOptions: AnyRecord): boolean {
  if (String(result?.output_text || "").trim()) return true;
  return resultOptions?.minimaxH3Reverse === true
    && resultOptions?.minimaxH3RichVisualStage !== true
    && result?.h3VisualFacts?.schema === "nf.visual.v2";
}

async function callGrokResponseAttempt(body: AnyRecord, inputMeta: AnyRecord, resultOptions: AnyRecord = {}): Promise<AnyRecord> {
  const config = runningHubLlm();
  const startedAt = Date.now();
  let attemptUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  try {
    // Interactive optimizers cannot spend three provider timeout windows
    // inside one Edge request; report/release the failed attempt promptly.
    const posted = await postRunningHubResponses({ body:{...body,reasoning:{effort:'low'}}, config, timeoutMs: 45000, maxRetries: 0 });
    const data = posted.data;
    attemptUsage = normalizeGrokResponseUsage(data);
    const result = grokResponsesPublicResult(data, {
      ...resultOptions,
      supportsNegativePrompt: inputMeta?.supportsNegativePrompt !== false
    }) as AnyRecord;
    if (!isGrokResponseAttemptResultUsable(result, resultOptions)) {
      const error = new Error("在线模型未返回提示词") as Error & { statusCode?: number; providerCallStarted?: boolean };
      error.statusCode = 502;
      error.providerCallStarted = true;
      throw error;
    }
    return {
      ok: true,
      statusCode: posted.status,
      durationMs: Date.now() - startedAt,
      model: data.model || config.model,
      requestId: posted.requestId,
      inputMeta,
      usage: attemptUsage,
      providerCallCount: 1,
      data: result
    };
  } catch (error) {
    const trackedError = error as Error & {
      grokUsage?: AnyRecord;
      grokDurationMs?: number;
      grokProviderCallCount?: number;
      providerCallStarted?: boolean;
    };
    trackedError.grokUsage = attemptUsage;
    trackedError.grokDurationMs = Date.now() - startedAt;
    trackedError.grokProviderCallCount = trackedError.providerCallStarted ? 1 : 0;
    throw trackedError;
  }
}

function createGrokUsageKey(feature: string): string {
  return `grok:${String(feature || "call").replace(/[^a-z0-9_-]/gi, "_").slice(0, 60)}:${Date.now()}:${crypto.randomUUID()}`;
}

async function creditRpc(name: string, args: AnyRecord): Promise<AnyRecord> {
  const { data, error } = await adminClient().rpc(name, args);
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as AnyRecord;
}

async function chargeOnlineAi(user: PublicUser, input: { feature: string; amount: number; metadata?: AnyRecord; run: (granted: { amount: number }) => Promise<AnyRecord> }): Promise<AnyRecord> {
  const charge = createOnlineAiCharge(createFeatureCreditPorts(creditRpc));
  return await charge({ userId: user.id, feature: input.feature, amount: input.amount, usageKey: createGrokUsageKey(input.feature), metadata: input.metadata, run: input.run }) as AnyRecord;
}

async function callGrokResponse(body: AnyRecord, inputMeta: AnyRecord, resultOptions: AnyRecord = {}): Promise<AnyRecord> {
  return await callGrokResponseWithVisualRetry(
    body,
    inputMeta,
    resultOptions,
    (attemptBody: AnyRecord) => callGrokResponseAttempt(attemptBody, inputMeta, resultOptions)
  ) as AnyRecord;
}

async function handleGrokPromptOptimize(
  req: Request,
  session: { user: PublicUser }
): Promise<Response> {
  let payload: AnyRecord;
  try {
    // Prompt optimize carries the H3 reference frames (图生/首尾帧/多参), like image reverse.
    payload = await parseJsonBody(req, MAX_GROK_IMAGE_BODY_BYTES);
  } catch (error) {
    return jsonResponse(req, errorHttpStatus(error, 400), { ok: false, error: sanitizeError(error) });
  }
  let request: AnyRecord;
  try {
    request = buildGrokPromptOptimizeRequest(payload, grokModel()) as AnyRecord;
  } catch (error) {
    // An explicit minor + sensitive H3 request is refused before any call, as in reverse: 422 with the Chinese message.
    if ((error as AnyRecord)?.errorCode === "provider_content_policy") {
      const refused = miniMaxH3FailureEnvelope(error);
      return jsonResponse(req, 422, { ok: false, error: refused.message, provider: "grok", ...refused });
    }
    return jsonResponse(req, 400, { ok: false, error: sanitizeError(error) });
  }
  const requiredProviderCalls = Math.max(
    1,
    Math.round(Number((request.resultOptions as AnyRecord)?.requiredProviderCalls || 1))
  );
  const isH3Prompt = (request.resultOptions as AnyRecord)?.minimaxH3Prompt === true;
  let grok: AnyRecord = {};
  let usage: ProviderQuotaRecord;
  let resultOptions: AnyRecord = request.resultOptions as AnyRecord;
  try {
    const charged = await chargeOnlineAi(session.user, {
      feature: "prompt-optimize",
      amount: Math.max(requiredProviderCalls, isH3Prompt ? 2 : requiredProviderCalls),
      run: async ({ amount: providerCallBudget }) => {
        if (providerCallBudget < requiredProviderCalls) {
          const error = new Error("积分不足或暂时不可用") as Error & { statusCode?: number; chargedAmount?: number };
          error.statusCode = 402;
          error.chargedAmount = 0;
          throw error;
        }
        resultOptions = {
          ...(request.resultOptions as AnyRecord),
          visualRetryAllowed: isH3Prompt && providerCallBudget >= 2,
          providerCallBudget,
          h3RepairAllowed: (request.resultOptions as AnyRecord)?.minimaxH3Reverse === true
            && providerCallBudget >= requiredProviderCalls + 1
        };
        try {
          const value = await callGrokResponse(request.body as AnyRecord, request.inputMeta as AnyRecord, resultOptions);
          const providerCallCount = Math.max(1, Math.round(Number(value.providerCallCount || 1)));
          return { amount: providerCallCount, value, metadata: { mode: String((request.inputMeta as AnyRecord).mode || "prompt_optimize"), tokenUsage: value.usage, durationMs: value.durationMs, model: value.model, providerCallCount, h3ContractRepairUsed: Boolean(value.h3ContractRepairUsed), success: true } };
        } catch (error) {
          const tracked = error as Error & { grokProviderCallCount?: number; chargedAmount?: number; chargeMetadata?: AnyRecord; grokUsage?: AnyRecord; grokDurationMs?: number };
          tracked.chargedAmount = 0;
          tracked.chargeMetadata = { mode: "prompt_optimize", error: sanitizeError(error), tokenUsage: tracked.grokUsage || null, durationMs: tracked.grokDurationMs || 0, success: false };
          throw error;
        }
      }
    });
    grok = charged.value as AnyRecord;
    usage = charged.quota as ProviderQuotaRecord;
  } catch (error) {
    const tracked = error as Error & { statusCode?: number; quota?: ProviderQuotaRecord; quotaFailed?: boolean };
    if (tracked.quotaFailed) return jsonResponse(req, 500, { ok: false, provider: "grok", error: "在线计量没有完成" });
    const failureQuota = tracked.quota || await readProviderQuota(session.user, "grok");
    const statusCode = Number(tracked.statusCode || 502);
    const h3Failure = resultOptions.minimaxH3Prompt === true ? miniMaxH3FailureEnvelope(error) : null;
    const ordinaryArtPatchFailure = (resultOptions.ordinaryArtPromptPatch === true || resultOptions.ordinaryArtStructuredPrompt === true) && /^Grok ordinary Art\b/.test(sanitizeError(error));
    const artFusionFailure = (error as AnyRecord)?.artSemanticFusionFailed === true;
    const modelTimeout = /^在线模型响应超时/.test(sanitizeError(error));
    return jsonResponse(req, statusCode === 402 ? 402 : statusCode >= 400 && statusCode < 600 ? statusCode : 502, {
      ok: false,
      error: statusCode === 402 ? publicCreditError(tracked.message) : h3Failure?.message || (artFusionFailure ? sanitizeError(error) : modelTimeout ? '在线提示词优化超时，未写入提示词或提交生成' : ordinaryArtPatchFailure
        ? "提示词优化未落实你的修改要求，原提示词保持不变；请重试或把修改要求写得更具体"
        : "生成失败，请稍后重试"),
      provider: "grok",
      ...(h3Failure || {}),
      ...(ordinaryArtPatchFailure || artFusionFailure ? { errorCode: "art-prompt-edit-not-applied", failureClass: "application" } : {}),
      quota: creditQuotaPayload(failureQuota)
    });
  }
  const providerCallCount = Math.max(1, Math.round(Number(grok.providerCallCount || 1)));
  const data = grok.data as AnyRecord;
  return jsonResponse(req, 200, {
    ok: true,
    provider: "grok",
    mode: "prompt_optimize",
    prompt: data.output_text,
    ...(data.uiPlan ? { uiPlan: data.uiPlan } : {}),
    negative_prompt: data.negative_prompt,
    has_negative_prompt: Boolean(data.has_negative_prompt),
    ...(data.editContract === "structured-recompile-v1"
      && data.promptSchema === "nf.art.prompt.v1"
      ? {
          editContract: "structured-recompile-v1",
          promptSchema: "nf.art.prompt.v1"
        }
      : (data.editContract === "deterministic-merge-v1"
        ? { editContract: "deterministic-merge-v1" }
        : {})),
    user: publicUser(session.user),
    quota: creditQuotaPayload(usage),
    grok: {
      statusCode: grok.statusCode,
      durationMs: grok.durationMs,
      input: grok.inputMeta,
      usage: grok.usage,
      model: grok.model,
      providerCallCount,
      h3ContractRepairUsed: Boolean(grok.h3ContractRepairUsed)
    }
  });
}

async function handleRunningHubGptImage(req:Request, session:{user:PublicUser}, quoteOnly=false):Promise<Response> {
  try {
    const payload=await parseJsonBody(req,24*1024*1024) as AnyRecord;
    const creditConfig=normalizeCreditConfig(await readFeatureCreditConfig());
    const provider=runningHubLlm();
    const base=readRunningHubImageConfig((name:string)=>name==='NOVAFLOW_RUNNINGHUB_API_KEY'?provider.apiKey:env(name),creditConfig);
    const config={...base,creditConfig,pricePreview:true};
    const quote=quoteGptImage({endpoint:config.gptImageEndpoint,imageEndpoint:config.gptImageI2iEndpoint,mode:payload.mode,count:payload.count||1,prices:config.prices,creditConfig,settings:payload.settings,width:payload.width,height:payload.height});
    if(quoteOnly)return jsonResponse(req,200,{ok:true,...quote,buttonLabel:formatCreditButtonLabel(quote.credits,quote),buttonTitle:formatCreditButtonTitle(quote.credits,quote)});
    if(!config.configured)return jsonResponse(req,503,{ok:false,error:'RunningHub 出图尚未配置'});
    const poolAccount=await readImagePoolAccount(config);
    const charge=createOnlineAiCharge({...createFeatureCreditPorts(creditRpc),prices:creditConfig});
    const outcome=await runChargedGptImage({charge,config,poolAccount,request:{userId:session.user.id,usageKey:'gptimg_'+crypto.randomUUID(),mode:payload.mode,prompt:payload.prompt,settings:payload.settings,images:payload.images,count:payload.count||1,width:payload.width,height:payload.height}});
    const rejected=outcome.results?.find((item:AnyRecord)=>item.success===false);
    if(rejected)return jsonResponse(req,400,{ok:false,error:rejected.message||'提示内容未通过审核，请修改后再试',moderation:true,charged:outcome.charged||0,remaining:outcome.remaining,billing:outcome.billing});
    return jsonResponse(req,200,{ok:true,charged:outcome.charged,remaining:outcome.remaining,quote:outcome.quote,billing:outcome.billing,images:(outcome.results||[]).map((item:AnyRecord)=>item.image).filter(Boolean)});
  }catch(error){
    const failed=error as AnyRecord,status=Number(failed.statusCode)||502;
    return jsonResponse(req,status>=400&&status<600?status:502,{ok:false,error:status===402?'积分不足或云服务余额不足，本次未生成':/出图|审核|参考图|提示词|积分|RunningHub|云服务/.test(sanitizeError(error))?sanitizeError(error):'云端出图未完成',charged:0});
  }
}

async function handleGrokImageReverse(
  req: Request,
  session: { user: PublicUser }
): Promise<Response> {
  let payload: AnyRecord;
  try {
    payload = await parseJsonBody(req, MAX_GROK_IMAGE_BODY_BYTES);
  } catch (error) {
    return jsonResponse(req, errorHttpStatus(error, 400), { ok: false, error: sanitizeError(error) });
  }
  let request: AnyRecord;
  try {
    request = buildGrokImageReverseRequest(payload, grokModel()) as AnyRecord;
  } catch (error) {
    const h3Preflight = miniMaxH3ReversePreflightFailure(payload, error);
    if (h3Preflight) {
      return jsonResponse(req, errorHttpStatus(error, h3Preflight.httpStatus), {
        ok: false,
        error: h3Preflight.envelope.message,
        provider: "grok",
        ...h3Preflight.envelope
      });
    }
    return jsonResponse(req, 400, { ok: false, error: sanitizeError(error) });
  }
  const requiredProviderCalls = Math.max(
    1,
    Math.round(Number((request.resultOptions as AnyRecord)?.requiredProviderCalls || 1))
  );
  const isH3Reverse = (request.resultOptions as AnyRecord)?.minimaxH3Reverse === true;
  const videoFrames = String((request.inputMeta as AnyRecord).scenario || "") === "video_frames";
  const mode = videoFrames ? "video_reverse" : "image_reverse";
  let grok: AnyRecord = {};
  let usage: ProviderQuotaRecord;
  let resultOptions: AnyRecord = request.resultOptions as AnyRecord;
  try {
    const charged = await chargeOnlineAi(session.user, {
      feature: videoFrames ? "video-reverse" : "image-reverse",
      amount: isH3Reverse ? requiredProviderCalls : Math.max(requiredProviderCalls, 2),
      run: async ({ amount: providerCallBudget }) => {
        if (providerCallBudget < requiredProviderCalls) {
          const error = new Error("积分不足或暂时不可用") as Error & { statusCode?: number; chargedAmount?: number };
          error.statusCode = 402;
          error.chargedAmount = 0;
          throw error;
        }
        resultOptions = { ...(request.resultOptions as AnyRecord), visualRetryAllowed: providerCallBudget >= 2, providerCallBudget, h3RepairAllowed: false };
        try {
          const value = await callGrokResponse(request.body as AnyRecord, request.inputMeta as AnyRecord, resultOptions);
          const providerCallCount = Math.max(1, Math.round(Number(value.providerCallCount || 1)));
          return { amount: providerCallCount, value, metadata: { mode, tokenUsage: value.usage, durationMs: value.durationMs, model: value.model, providerCallCount, visualContractRetryUsed: Boolean(value.visualContractRetryUsed), success: true } };
        } catch (error) {
          const tracked = error as Error & { grokProviderCallCount?: number; chargedAmount?: number; chargeMetadata?: AnyRecord; grokUsage?: AnyRecord; grokDurationMs?: number };
          tracked.chargedAmount = 0;
          tracked.chargeMetadata = { mode, error: sanitizeError(error), tokenUsage: tracked.grokUsage || null, durationMs: tracked.grokDurationMs || 0, success: false };
          throw error;
        }
      }
    });
    grok = charged.value as AnyRecord;
    usage = charged.quota as ProviderQuotaRecord;
  } catch (error) {
    const tracked = error as Error & { statusCode?: number; quota?: ProviderQuotaRecord; quotaFailed?: boolean };
    if (tracked.quotaFailed) return jsonResponse(req, 500, { ok: false, provider: "grok", error: "在线计量没有完成" });
    const failureQuota = tracked.quota || await readProviderQuota(session.user, "grok");
    const statusCode = Number(tracked.statusCode || 502);
    const isVisualV2 = String(resultOptions.visualIrSchema || "") === "nf.visual.v2";
    const h3Failure = resultOptions.minimaxH3Prompt === true ? miniMaxH3FailureEnvelope(error) : null;
    const contentPolicyFailure = !h3Failure && (error as AnyRecord)?.errorCode === "provider_content_policy";
    return jsonResponse(req, statusCode === 402 ? 402 : statusCode >= 400 && statusCode < 600 ? statusCode : 502, {
      ok: false,
      error: statusCode === 402 ? publicCreditError(tracked.message) : h3Failure?.message || (contentPolicyFailure ? "未通过未成年人敏感内容安全校验" : "生成失败，请稍后重试"),
      provider: "grok",
      ...(contentPolicyFailure ? { errorCode: "provider_content_policy", retryable: false } : {}),
      ...(h3Failure || {}),
      ...(isVisualV2 ? grokVisualFailureEnvelope(error) : {}),
      quota: creditQuotaPayload(failureQuota)
    });
  }
  const providerCallCount = Math.max(1, Math.round(Number(grok.providerCallCount || 1)));
  const data = grok.data as AnyRecord;
  return jsonResponse(req, 200, {
    ok: true,
    provider: "grok",
    mode,
    prompt: data.output_text,
    ...(data.uiPlan ? { uiPlan: data.uiPlan } : {}),
    negative_prompt: data.negative_prompt,
    has_negative_prompt: Boolean(data.has_negative_prompt),
    visualSchema: String(data.visualSchema || ""),
    contentSafety: data.contentSafety || null,
    contentWarnings: Array.isArray(data.contentWarnings) ? data.contentWarnings : [],
    sensitivePromptBlocked: Boolean(data.sensitivePromptBlocked),
    ...(String(data.visualSchema || "") === "nf.visual.v2"
      ? { generationGate: String(data.generationGate || "blocked") }
      : {}),
    visualPrompt: String(data.visualPrompt || ""),
    generationRequirements: String(data.generationRequirements || ""),
    ...((data.analysisDegraded === true || data.analysisPartial === true) ? {
      ...(data.analysisDegraded === true ? { analysisDegraded: true } : {}),
      ...(data.analysisPartial === true ? { analysisPartial: true } : {}),
      qualityGateFailed: data.qualityGateFailed === true,
      qualityGateRetried: data.qualityGateRetried === true,
      contractFailureCode: String(data.contractFailureCode || ""),
      errorCode: String(data.errorCode || ""),
      message: String(data.message || ""),
      retryable: data.retryable === true,
      retryAttempted: data.retryAttempted === true,
      retryCount: Math.max(0, Math.min(1, Math.trunc(Number(data.retryCount) || 0))),
      reverseProvider: "grok",
      providerFailureCode: String(data.providerFailureCode || ""),
      legacyFallbackSuppressed: data.legacyFallbackSuppressed === true,
      requestedVisualSchema: String(data.requestedVisualSchema || ""),
      failureCategory: String(data.failureCategory || ""),
      reverseFallbackReason: ""
    } : {}),
    user: publicUser(session.user),
    quota: creditQuotaPayload(usage),
    grok: {
      statusCode: grok.statusCode,
      durationMs: grok.durationMs,
      requestId: grok.requestId,
      input: grok.inputMeta,
      usage: grok.usage,
      model: grok.model,
      providerCallCount,
      visualContractRetryUsed: Boolean(grok.visualContractRetryUsed)
    }
  });
}





async function handleRunningHubUiCatalog(req: Request, session: { user: PublicUser }): Promise<Response> {
  let payload: AnyRecord;
  try {
    payload = await parseJsonBody(req, MAX_GROK_IMAGE_BODY_BYTES);
  } catch (error) {
    return jsonResponse(req, errorHttpStatus(error, 400), { ok: false, error: sanitizeError(error) });
  }
  const requestId = String(payload.requestId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) return jsonResponse(req, 400, { ok: false, error: "分析请求标识无效" });
  let responsesBody: AnyRecord;
  try {
    responsesBody = uiCatalogResponsesRequest(payload) as AnyRecord;
  } catch (error) {
    return jsonResponse(req, errorHttpStatus(error, 400), { ok: false, error: sanitizeError(error) });
  }
  try {
    const charged = await chargeOnlineAi(session.user, {
      feature: "ui-catalog",
      amount: 1,
      run: async () => {
        try {
          const posted = await postRunningHubResponses({ body: responsesBody, config: runningHubLlm(), timeoutMs: 180000 });
          const rawOutputText = responsesOutputText(posted.data);
          if (!rawOutputText || posted.data.status !== "completed" || posted.data.output?.some((item: AnyRecord) => item.type === "function_call")) {
            throw Object.assign(new Error("在线目录分析未返回完整结果"), { statusCode: 502, chargedAmount: 0 });
          }
          return { amount: 1, value: { rawOutputText, model: posted.data.model || runningHubLlm().model, requestId: posted.requestId }, metadata: { mode: "ui-catalog", model: posted.data.model, success: true } };
        } catch (error) {
          const tracked = error as Error & { chargedAmount?: number; providerCallStarted?: boolean };
          tracked.chargedAmount = 0;
          throw error;
        }
      }
    });
    const value = charged.value as AnyRecord;
    return jsonResponse(req, 200, {
      ok: true, model: value.model, providerCallCount: 1, retryCount: 0,
      clientRequestId: requestId, requestId: value.requestId || requestId,
      finishReason: "completed", rawOutputText: value.rawOutputText
    });
  } catch (error) {
    const tracked = error as Error & { statusCode?: number; quotaFailed?: boolean };
    if (tracked.quotaFailed) return jsonResponse(req, 500, { ok: false, error: "在线计量没有完成" });
    const statusCode = Number(tracked.statusCode || 502);
    return jsonResponse(req, statusCode === 402 ? 402 : statusCode >= 400 && statusCode < 600 ? statusCode : 502, {
      ok: false, error: statusCode === 402 ? publicCreditError(tracked.message) : /在线/.test(String(tracked.message || "")) ? tracked.message : "在线目录分析未完成"
    });
  }
}

async function handleGrokChat(req: Request, session: { user: PublicUser }): Promise<Response> {
  const payload = await parseJsonBody(req, MAX_GROK_BODY_BYTES);
  let grok: AnyRecord;
  let usage: ProviderQuotaRecord;
  try {
    const charged = await chargeOnlineAi(session.user, {
      feature: "xiaotao-text",
      amount: 1,
      run: async () => {
        try {
          const value = await callGrok(payload);
          return { amount: 1, value, metadata: { mode: "provider_gateway", tokenUsage: (value.data as AnyRecord)?.usage || null, durationMs: value.durationMs, model: value.model, success: true } };
        } catch (error) {
          const tracked = error as Error & { chargedAmount?: number; grokProviderCallCount?: number };
          tracked.chargedAmount = 0;
          throw error;
        }
      }
    });
    grok = charged.value as AnyRecord;
    usage = charged.quota as ProviderQuotaRecord;
  } catch (error) {
    const tracked = error as Error & { statusCode?: number; quota?: ProviderQuotaRecord; quotaFailed?: boolean };
    if (tracked.quotaFailed) return jsonResponse(req, 500, { ok: false, error: "在线计量没有完成" });
    const statusCode = Number(tracked.statusCode || 502);
    return jsonResponse(req, statusCode === 402 ? 402 : statusCode >= 400 && statusCode < 600 ? statusCode : 502, {
      ok: false,
      error: statusCode === 402 ? publicCreditError(tracked.message) : /在线模型/.test(String(tracked.message || "")) ? tracked.message : "在线模型暂时不可用",
      provider: "grok",
      quota: creditQuotaPayload(tracked.quota || await readProviderQuota(session.user, "grok"))
    });
  }

  return jsonResponse(req, 200, {
    ok: true,
    provider: "grok",
    mode: "provider_gateway",
    message: "Prompt service call completed; only used_count was recorded.",
    user: publicUser(session.user),
    quota: {
      allocated_count: usage.allocated_count,
      used_count: usage.used_count,
      remaining_count: usage.remaining_count
    },
    grok: {
      statusCode: grok.statusCode,
      durationMs: grok.durationMs,
      input: grok.inputMeta,
      result: grok.data
    }
  });
}

async function handleLicenseVerification(req: Request): Promise<Response> {
  let input: { licenseKey: string; machineId: string };
  try {
    const payload = await parseJsonBody(req, MAX_LICENSE_VERIFY_BODY_BYTES);
    input = normalizeLicenseVerificationInput(payload);
  } catch {
    return jsonResponse(req, 400, { ok: false, error: "invalid license verification request" });
  }

  try {
    await enforceLicenseVerificationRateLimit(req, input);
    const { data, error } = await adminClient()
      .from("licenses")
      .select("status,expire_at,permissions")
      .eq("license_key", input.licenseKey)
      .eq("machine_id", input.machineId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return jsonResponse(req, 200, validateLicenseVerificationRecord(data || null));
  } catch (error) {
    const statusCode = errorHttpStatus(error, 503);
    if (statusCode !== 429) {
      logInfo("license verification unavailable", { error: sanitizeError(error) });
    }
    return jsonResponse(req, statusCode === 429 ? 429 : 503, {
      ok: false,
      error: statusCode === 429
        ? "license verification rate limit exceeded"
        : "license verification unavailable"
    });
  }
}

function readiness(): AnyRecord {
  const checks = [
    { key: "supabase_url", ok: Boolean(supabaseUrl()), required: true },
    { key: "service_role", ok: Boolean(serviceRoleKey()), required: true },
    { key: "auth_key", ok: Boolean(publishableKey()), required: true },
    { key: "session_secret", ok: Boolean(sessionSecret()) && sessionSecret().length >= 32, required: true },
    { key: "runninghub_api_key", ok: Boolean(grokApiKey()), required: false }
  ];
  const llm = runningHubLlm();
  return {
    ok: checks.every((item) => !item.required || item.ok),
    service: "NovaFlow Backend",
    mode: "supabase_edge_function",
    checks,
    config: {
      supabaseUrl: supabaseUrl(),
      serviceRoleConfigured: Boolean(serviceRoleKey()),
      authKeyConfigured: Boolean(publishableKey()),
      sessionSecretConfigured: Boolean(sessionSecret()),
      sessionTtlSeconds: sessionTtlSeconds(),
      runningHubLlmBaseUrl: llm.baseUrl,
      runningHubLlmModel: llm.model,
      runningHubLlmConfigured: Boolean(grokApiKey())
    }
  };
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const url = new URL(req.url);
  const path = normalizePath(url);
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }
    if (req.method === "GET" && path === "/health") {
      await serverProvider.refresh();
      return jsonResponse(req, 200, {
        ok: true,
        service: "NovaFlow Backend",
        releaseVersion: RELEASE_VERSION,
        status: "running",
        mode: "supabase_edge_function",
        config: readiness().config
      });
    }
    if (req.method === "GET" && path === "/ready") {
      const ready = readiness();
      return jsonResponse(req, ready.ok ? 200 : 503, ready);
    }
    if (req.method === "POST" && path === "/api/client/license/verify") {
      return await handleLicenseVerification(req);
    }
    if (req.method === "POST" && path === "/api/auth/register") return await handleRegister(req);
    if (req.method === "POST" && path === "/api/auth/login") return await handleLogin(req);
    if (req.method === "POST" && path === "/api/auth/verify") {
      return jsonResponse(req, 410, { ok: false, error: "verification code login is disabled; use account and password" });
    }
    if (req.method === "POST" && path === "/api/auth/logout") {
      return jsonResponse(req, 200, { ok: true, message: "stateless session token; client should discard it" });
    }

    const sessionRoutes = new Set([
      "/api/auth/me",
      "/api/client/credits",
      "/api/client/bootstrap",
      "/api/client/credits/check",
      "/api/ai/tasks",
      "/api/ai/tasks/usage",
      "/api/client/grok/prompt-optimize",
      "/api/client/grok/image-reverse",
      "/api/client/runninghub/ui-catalog",
      "/api/client/runninghub/gpt-image/quote",
      "/api/client/runninghub/gpt-image",
      "/api/provider/grok/chat"
    ]);
    if (sessionRoutes.has(path)) {
      let session: { user: PublicUser; payload: AnyRecord };
      try {
        session = await requireSession(req);
      } catch (error) {
        const statusCode = Number((error as Error & { statusCode?: number })?.statusCode || 401);
        const code = (error as Error & { code?: string })?.code;
        return jsonResponse(req, statusCode, { ok: false, error: sanitizeError(error), ...(code ? { code } : {}) });
      }
      if(path.includes('/grok/') || path.includes('/runninghub/'))await serverProvider.refresh();
      if (req.method === "GET" && (path === "/api/auth/me" || path === "/api/client/credits")) {
        const credits = await creditBalance(session.user.id);
        return jsonResponse(req, 200, {
          ok: true,
          user: publicUser(session.user),
          credits: {
            balance: credits.balance,
            source: "supabase",
            status: "connected"
          }
        });
      }
      if (req.method === "GET" && path === "/api/client/bootstrap") return await handleBootstrap(req, session);
      if (req.method === "POST" && path === "/api/client/credits/check") return await handleCreditCheck(req, session);
      if (req.method === "POST" && path === "/api/ai/tasks") return await handleAiTasks(req, session);
      if (req.method === "POST" && path === "/api/ai/tasks/usage") return await handleAiTaskUsage(req, session);
      if (req.method === "POST" && path === "/api/client/grok/prompt-optimize") return await handleGrokPromptOptimize(req, session);
      if (req.method === "POST" && path === "/api/client/grok/image-reverse") return await handleGrokImageReverse(req, session);
      if (req.method === "POST" && path === "/api/provider/grok/chat") return await handleGrokChat(req, session);
      if (req.method === "POST" && path === "/api/client/runninghub/ui-catalog") return await handleRunningHubUiCatalog(req, session);
      if (req.method === "POST" && path === "/api/client/runninghub/gpt-image/quote") return await handleRunningHubGptImage(req,session,true);
      if (req.method === "POST" && path === "/api/client/runninghub/gpt-image") return await handleRunningHubGptImage(req,session);
    }

    return jsonResponse(req, 404, { ok: false, error: "route not found", path });
  } catch (error) {
    logInfo("request failed", { path, method: req.method, durationMs: Date.now() - startedAt, error: sanitizeError(error) });
    return jsonResponse(req, errorHttpStatus(error, 500), { ok: false, error: sanitizeError(error) });
  }
});
