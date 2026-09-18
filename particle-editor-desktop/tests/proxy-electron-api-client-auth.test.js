const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function main() {
  const source = fs.readFileSync(path.resolve(__dirname, "../../particle-editor/proxy-electron-api.js"), "utf8");
  const calls = [];
  let bootstrapUnauthorized = false;
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const rawUrl = String(url);
    const pathname = rawUrl.startsWith("/") ? rawUrl.split("?")[0] : new URL(rawUrl).pathname;
    if (pathname === "/__prompt_assistant/reverse-image-prompt") {
      return new Response(JSON.stringify({
        ok: false,
        error: "local H3 deterministic validation failed",
        errorCode: "h3-local-deterministic-validation-failed",
        failureCategory: "h3_contract_alignment",
        failureClass: "audio-fidelity",
        generationGate: "blocked",
        requestedVisualSchema: "nf.h3.visual.v1",
        retryable: false,
        legacyFallbackSuppressed: true,
        sensitivePromptBlocked: false,
        preview: true,
      }), { status: 500 });
    }
    if (pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, status: "running" }), { status: 200 });
    }
    if (pathname === "/api/auth/login") {
      return new Response(JSON.stringify({ ok: true, session: { token: "owner-token" }, user: { account: "owner" } }), { status: 200 });
    }
    if (pathname === "/api/client/bootstrap") {
      if (bootstrapUnauthorized) {
        return new Response(JSON.stringify({ ok: false, error: "session expired" }), { status: 401 });
      }
      return new Response(JSON.stringify({ ok: true, user: { account: "owner" }, credits: { balance: 99 } }), { status: 200 });
    }
    if (pathname === "/api/auth/logout") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (pathname === "/api/ai/tasks/usage") {
      return new Response(JSON.stringify({ ok: true, settlement: { status: "settled" } }), { status: 200 });
    }
    if (pathname === "/api/client/grok/image-reverse") {
      return new Response(JSON.stringify({ ok: true, provider: "grok", prompt: "visual analysis" }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false, error: "unexpected route" }), { status: 404 });
  };
  const storage = new Map();
  const window = { electronAPI: {} };
  window.window = window;
  const context = vm.createContext({
    window,
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
    fetch,
    Headers,
    Response,
    Request,
    FormData,
    Blob,
    URL,
    URLSearchParams,
    Uint8Array,
    TextDecoder,
    btoa,
    atob,
    console,
  });
  vm.runInContext(source, context, { filename: "proxy-electron-api.js" });

  const api = window.electronAPI;
  for (const method of ["clientAuthStatus", "clientAuthLogin", "clientAuthBootstrap", "clientAuthLogout"]) {
    assert.equal(typeof api[method], "function", `preview proxy should expose ${method}`);
  }
  const status = await api.clientAuthStatus();
  assert.equal(status.ok, true);
  assert.equal(status.baseUrl, "http://127.0.0.1:4761");
  const login = await api.clientAuthLogin({ account: "owner", password: "secret-six" });
  assert.equal(login.session.token, "owner-token");
  const bootstrap = await api.clientAuthBootstrap({ token: "owner-token" });
  assert.equal(bootstrap.credits.balance, 99);
  assert.equal(bootstrap.httpStatus, 200);
  const usage = await api.clientAuthAiTaskCommitUsage({
    token: "owner-token",
    providerKey: "comfyui",
    promptId: "preview-provider-prompt",
    creditCost: 7,
  });
  assert.equal(usage.ok, true, "browser preview usage bridge should remain available");
  storage.set("novaflow.client.auth.session.v1", JSON.stringify({ session: { token: "owner-token" } }));
  const reverse = await api.smartAiImageReverse({ images: [{ dataUrl: "data:image/png;base64,AA==" }] });
  assert.equal(reverse.ok, true, "preview AI director Grok image reverse bridge should remain available");
  const h3TechnicalFailure = await api.promptAssistantReverseImagePrompt({
    purpose: "minimax-h3-i2v-reverse",
    visualSchema: "nf.h3.visual.v1",
  });
  assert.equal(h3TechnicalFailure.ok, false);
  assert.equal(h3TechnicalFailure.errorCode, "h3-local-deterministic-validation-failed",
    "the 4783 proxy must preserve the exact H3 technical failure code from an HTTP 500 response");
  assert.equal(h3TechnicalFailure.failureCategory, "h3_contract_alignment");
  assert.equal(h3TechnicalFailure.failureClass, "audio-fidelity");
  assert.equal(h3TechnicalFailure.generationGate, "blocked");
  assert.equal(h3TechnicalFailure.requestedVisualSchema, "nf.h3.visual.v1");
  assert.equal(h3TechnicalFailure.retryable, false);
  assert.equal(h3TechnicalFailure.legacyFallbackSuppressed, true);
  assert.equal(h3TechnicalFailure.sensitivePromptBlocked, false);
  bootstrapUnauthorized = true;
  const expired = await api.clientAuthBootstrap({ token: "owner-token" });
  assert.equal(expired.httpStatus, 401, "preview auth bridge must preserve HTTP 401 for stale-session cleanup");
  await api.clientAuthLogout({ token: "owner-token" });

  const byPath = Object.fromEntries(calls.map((call) => {
    const rawUrl = String(call.url);
    const pathname = rawUrl.startsWith("/") ? rawUrl.split("?")[0] : new URL(rawUrl).pathname;
    return [pathname, call];
  }));
  assert.equal(byPath["/health"].init.method, "GET");
  assert.equal(byPath["/api/auth/login"].init.method, "POST");
  assert.deepEqual(JSON.parse(byPath["/api/auth/login"].init.body), { account: "owner", password: "secret-six" });
  assert.equal(byPath["/api/client/bootstrap"].init.method, "GET");
  assert.equal(byPath["/api/client/bootstrap"].init.headers.Authorization, "Bearer owner-token");
  assert.equal(byPath["/api/client/bootstrap"].init.body, undefined);
  assert.equal(byPath["/api/auth/logout"].init.headers.Authorization, "Bearer owner-token");
  assert.deepEqual(JSON.parse(byPath["/api/auth/logout"].init.body), {});
  assert.equal(byPath["/api/ai/tasks/usage"].init.headers.Authorization, "Bearer owner-token");
  assert.deepEqual(JSON.parse(byPath["/api/ai/tasks/usage"].init.body), {
    providerKey: "comfyui",
    promptId: "preview-provider-prompt",
    creditCost: 7,
  });
  assert.equal(byPath["/api/client/grok/image-reverse"].init.headers.Authorization, "Bearer owner-token");
  assert.deepEqual(JSON.parse(byPath["/api/client/grok/image-reverse"].init.body), {
    images: [{ dataUrl: "data:image/png;base64,AA==" }],
  });
  assert.equal(byPath["/__prompt_assistant/reverse-image-prompt"].init.method, "POST");

  const desktopWindow = {
    electronAPI: { runtimeProviderUsageSettlement: "preload-price-v1" },
  };
  desktopWindow.window = desktopWindow;
  const desktopContext = vm.createContext({
    window: desktopWindow,
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    fetch,
    Headers,
    Response,
    Request,
    FormData,
    Blob,
    URL,
    URLSearchParams,
    Uint8Array,
    TextDecoder,
    btoa,
    atob,
    console,
  });
  vm.runInContext(source, desktopContext, { filename: "proxy-electron-api.desktop.js" });
  assert.equal(
    typeof desktopWindow.electronAPI.clientAuthAiTaskCommitUsage,
    "undefined",
    "trusted preload settlement must not regain a renderer usage-commit fallback"
  );
}

main().then(() => {
  console.log("preview client-auth bridge tests passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
