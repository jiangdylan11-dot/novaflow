const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const vm = require("node:vm");

const desktopDir = path.resolve(__dirname, "..");

function extractNamedFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const declarationStart = source.slice(Math.max(0, start - 6), start) === "async " ? start - 6 : start;
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(declarationStart, index + 1);
  }
  throw new Error(`${name} body is incomplete`);
}

function createAuthenticatedRequestHarness({ request, refresh }) {
  const mainSource = fs.readFileSync(path.join(desktopDir, "main.js"), "utf8");
  const context = vm.createContext({
    Date,
    NOVAFLOW_CLIENT_AUTH_REFRESH_EARLY_MS: 120_000,
    clientAuthDirect: {
      CLIENT_AUTH_TRANSPORT: "supabase-direct",
      refreshSession: refresh
    },
    requestNovaFlowClientApi: request
  });
  for (const name of [
    "novaFlowClientSessionExpiryMs",
    "novaFlowClientSessionFromPayload",
    "novaFlowClientSessionExpiresSoon",
    "requestNovaFlowAuthenticatedClientApi"
  ]) {
    vm.runInContext(extractNamedFunction(mainSource, name), context);
  }
  return context.requestNovaFlowAuthenticatedClientApi;
}

test("desktop auth module uses the publishable key for Supabase Auth only", async () => {
  const authCalls = [];
  const originalLoad = Module._load;
  Module._load = function loadWithFakeSupabase(request, parent, isMain) {
    if (request === "@supabase/supabase-js") {
      return {
        createClient(url, key, options) {
          authCalls.push({ type: "create", url, key, options });
          return {
            auth: {
              async signInWithPassword(credentials) {
                authCalls.push({ type: "login", credentials });
                return {
                  data: {
                    user: {
                      id: "user-1",
                      email: credentials.email,
                      created_at: "2026-07-21T00:00:00Z",
                      user_metadata: { display_name: "Secure User" }
                    },
                    session: {
                      access_token: "access-token",
                      refresh_token: "refresh-token",
                      expires_at: 123456
                    }
                  },
                  error: null
                };
              },
              async refreshSession(credentials) {
                authCalls.push({ type: "refresh", credentials });
                return {
                  data: {
                    session: {
                      access_token: "refreshed-access-token",
                      refresh_token: "rotated-refresh-token",
                      expires_at: 654321
                    }
                  },
                  error: null
                };
              }
            }
          };
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const modulePath = require.resolve("../client-auth-direct");
  delete require.cache[modulePath];
  try {
    const clientAuth = require(modulePath);
    const result = await clientAuth.loginWithPassword({ account: "secure-user", password: "123456" });
    assert.equal(result.ok, true);
    assert.equal(result.session.token, "access-token");
    assert.equal(result.session.refreshToken, "refresh-token");
    assert.equal(result.session.provider, "supabase_auth");
    assert.equal(result.user.account, "secure-user");
    assert.deepEqual(authCalls.find((call) => call.type === "login").credentials, {
      email: "secure-user@accounts.novaflow.local",
      password: "123456"
    });
    const refreshed = await clientAuth.refreshSession({ refreshToken: "refresh-token" });
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.session.token, "refreshed-access-token");
    assert.equal(refreshed.session.refreshToken, "rotated-refresh-token");
    assert.equal(refreshed.session.expiresAt, 654321);
    assert.deepEqual(authCalls.find((call) => call.type === "refresh").credentials, {
      refresh_token: "refresh-token"
    });
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  }
});

test("authenticated client requests refresh near expiry and keep refresh secrets out of bodies", async () => {
  const requests = [];
  const refreshes = [];
  const requestAuthenticated = createAuthenticatedRequestHarness({
    async refresh(payload) {
      refreshes.push(payload);
      return {
        ok: true,
        session: {
          token: "new-access",
          refreshToken: "new-refresh",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          provider: "supabase_auth",
          transport: "supabase-direct"
        }
      };
    },
    async request(pathName, options) {
      requests.push({ pathName, options });
      return { ok: true, httpStatus: 200 };
    }
  });

  const result = await requestAuthenticated("/api/client/credits/check", {
    token: "old-access",
    refreshToken: "old-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    creditCost: 3
  }, "POST");

  assert.equal(refreshes.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.token, "new-access");
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].options.body)), { creditCost: 3 });
  assert.equal(result.session.token, "new-access");
  assert.equal(result.session.refreshToken, "new-refresh");
});

test("authenticated client requests refresh once and retry after the first 401", async () => {
  const tokens = [];
  let refreshCount = 0;
  const requestAuthenticated = createAuthenticatedRequestHarness({
    async refresh() {
      refreshCount += 1;
      return {
        ok: true,
        session: {
          token: "retry-access",
          refreshToken: "retry-refresh",
          expiresAt: Math.floor(Date.now() / 1000) + 3600
        }
      };
    },
    async request(_pathName, options) {
      tokens.push(options.token);
      return tokens.length === 1
        ? { ok: false, httpStatus: 401, error: "expired" }
        : { ok: true, httpStatus: 200 };
    }
  });

  const result = await requestAuthenticated("/api/client/bootstrap", {
    token: "expired-access",
    refreshToken: "retry-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 600
  });

  assert.equal(refreshCount, 1);
  assert.deepEqual(tokens, ["expired-access", "retry-access"]);
  assert.equal(result.ok, true);
  assert.equal(result.session.token, "retry-access");
});

test("license verification posts only license and machine identity to the Edge route", async () => {
  const previousBaseUrl = process.env.NOVAFLOW_CLIENT_API_BASE_URL;
  const originalFetch = global.fetch;
  process.env.NOVAFLOW_CLIENT_API_BASE_URL = "https://project.supabase.co/functions/v1/novaflow-backend/";
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      ok: true,
      valid: true,
      status: "licensed",
      expireAt: "2099-12-31T23:59:59Z",
      permissions: ["all"]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const modulePath = require.resolve("../license/supabaseClient");
  delete require.cache[modulePath];
  try {
    const licenseClient = require(modulePath);
    const result = await licenseClient.fetchLicenseRecordByKey("license-one", "machine-one", 1000);
    assert.equal(result.error, undefined);
    assert.equal(result.record.license_key, "license-one");
    assert.equal(result.record.machine_id, "machine-one");
    assert.equal(result.record.status, "active");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://project.supabase.co/functions/v1/novaflow-backend/api/client/license/verify"
    );
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      licenseKey: "license-one",
      machineId: "machine-one"
    });
    assert.equal(calls[0].init.headers.apikey, undefined);
    assert.equal(calls[0].init.headers.Authorization, undefined);

    global.fetch = async () => new Response(JSON.stringify({
      valid: false,
      reason: "license_rejected"
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const rejected = await licenseClient.fetchLicenseRecordByKey("license-one", "machine-one", 1000);
    assert.equal(rejected.error, undefined);
    assert.equal(rejected.record, null);
    assert.equal(rejected.rejectionReason, "license_rejected");
  } finally {
    global.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.NOVAFLOW_CLIENT_API_BASE_URL;
    else process.env.NOVAFLOW_CLIENT_API_BASE_URL = previousBaseUrl;
    delete require.cache[modulePath];
  }
});

test("desktop source contains no direct business-table reads", () => {
  const authSource = fs.readFileSync(path.join(desktopDir, "client-auth-direct.js"), "utf8");
  const licenseSource = fs.readFileSync(path.join(desktopDir, "license", "supabaseClient.js"), "utf8");
  const mainSource = fs.readFileSync(path.join(desktopDir, "main.js"), "utf8");

  assert.doesNotMatch(
    authSource,
    /\.from\s*\(\s*["'](?:users|credits|system_settings)["']\s*\)/,
    "desktop auth must not query PostgREST tables"
  );
  assert.doesNotMatch(
    licenseSource,
    /\.from\s*\(\s*["']licenses["']\s*\)/,
    "license verification must not query the licenses table directly"
  );
  assert.match(licenseSource, /\/api\/client\/license\/verify/);
  assert.doesNotMatch(mainSource, /clientAuthDirect\.(?:bootstrap|getMe|creditsCheck)\s*\(/);
  assert.match(mainSource, /requestNovaFlowAuthenticatedClientApi\("\/api\/auth\/me", payload, "GET"\)/);
  assert.match(mainSource, /requestNovaFlowAuthenticatedClientApi\("\/api\/client\/bootstrap", payload, "GET"\)/);
  assert.match(mainSource, /requestNovaFlowAuthenticatedClientApi\("\/api\/client\/credits\/check", payload, "POST"\)/);
  assert.match(mainSource, /"\/api\/client\/bootstrap",\s*authResult\.session,\s*"GET"/);
  assert.match(mainSource, /session:\s*bootstrapResult\.session\s*\|\|\s*authResult\.session/);
});

test("an explicit Edge license rejection locks immediately instead of using offline cache", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "novaflow-license-rejection-"));
  const licenseClient = require("../license/supabaseClient");
  const originalFetchLicense = licenseClient.fetchLicenseRecordByKey;
  licenseClient.fetchLicenseRecordByKey = async () => ({
    record: null,
    status: 200,
    rejectionReason: "license_rejected"
  });
  try {
    const { verifyLicenseOnline } = require("../license/licenseOnlineVerifier");
    const result = await verifyLicenseOnline({
      userDataDir,
      localState: {
        status: "licensed",
        machineId: "machine-one",
        payload: { licenseKey: "license-one" }
      },
      allowOfflineCache: true,
      source: "secure-data-path-test"
    });
    assert.equal(result.status, "locked");
    assert.equal(result.locked, true);
    assert.equal(result.reason, "license_rejected");
    assert.equal(result.online, undefined);
  } finally {
    licenseClient.fetchLicenseRecordByKey = originalFetchLicense;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
