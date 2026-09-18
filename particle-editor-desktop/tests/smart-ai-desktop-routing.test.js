const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const mainPath = path.resolve(__dirname, "../main.js");
const source = fs.readFileSync(mainPath, "utf8");
const brandRuntimeSource = fs.readFileSync(path.resolve(__dirname, "../../particle-editor/novaflow-brand-runtime.js"), "utf8");
const smartAiSource = fs.readFileSync(path.resolve(__dirname, "../../particle-editor/novaflow-smart-ai.js"), "utf8");

function extractNamedFunction(input, name) {
  const start = input.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const declarationStart = input.slice(Math.max(0, start - 6), start) === "async " ? start - 6 : start;
  const bodyStart = input.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < input.length; index += 1) {
    const char = input[index];
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
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(declarationStart, index + 1);
    }
  }
  throw new Error(`${name} body is incomplete`);
}

function createRoutingHarness() {
  const state = {
    explicit: false,
    configuredEndpoint: { ok: false, baseUrl: "https://cloud.example.test" },
    localEndpoint: { ok: true, baseUrl: "http://127.0.0.1:4761" },
    cloudBaseUrl: "https://cloud.example.test",
  };
  const context = vm.createContext({
    process: { env: {} },
    NOVAFLOW_ADMIN_SERVER_AUTOSTART_ENV: "NOVAFLOW_ADMIN_SERVER_AUTOSTART",
    NOVAFLOW_GROK_CLOUD_DEFAULT_PATHS: new Set([
      "/api/client/grok/prompt-optimize",
      "/api/client/grok/image-reverse",
    ]),
    NF_ELECTRON_AB_NO_ADMIN_SERVER_AUTOSTART: false,
    isTruthyEnv(value) {
      return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
    },
    hasExplicitNovaFlowClientApiBaseUrl() {
      return state.explicit;
    },
    resolveNovaFlowClientApiEndpoint() {
      return state.configuredEndpoint;
    },
    resolveNovaFlowLocalClientApiEndpoint() {
      return state.localEndpoint;
    },
    getNovaFlowClientApiBaseUrl() {
      return state.cloudBaseUrl;
    },
  });
  const functionSource = extractNamedFunction(source, "resolveNovaFlowSmartAiApiTarget");
  const resolveTarget = vm.runInContext(`(${functionSource})`, context);
  return { state, context, resolveTarget };
}

function assertTarget(actual, expected) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
}

test("Smart AI uses the cloud backend by default", () => {
  const { resolveTarget } = createRoutingHarness();
  assertTarget(resolveTarget("/api/client/grok/prompt-optimize"), {
    baseUrl: "https://cloud.example.test",
    useLocal: false,
    forceLocal: false,
    source: "cloud-default",
  });
});

test("an explicit remote backend remains authoritative", () => {
  const { state, context, resolveTarget } = createRoutingHarness();
  state.explicit = true;
  state.configuredEndpoint = { ok: false, baseUrl: "https://backend.example.test/api" };
  context.process.env.NOVAFLOW_ADMIN_SERVER_AUTOSTART = "1";
  assertTarget(resolveTarget("/api/ai/tasks/usage"), {
    baseUrl: "https://backend.example.test/api",
    useLocal: false,
    forceLocal: false,
    source: "explicit-remote",
  });
});

test("an explicit loopback backend uses its configured local endpoint", () => {
  const { state, resolveTarget } = createRoutingHarness();
  state.explicit = true;
  state.configuredEndpoint = { ok: true, baseUrl: "http://localhost:4900" };
  assertTarget(resolveTarget("/api/client/grok/image-reverse"), {
    baseUrl: "http://localhost:4900",
    useLocal: true,
    forceLocal: false,
    source: "explicit-loopback",
  });
});

test("the explicit admin-server development switch opts Smart AI into local 4761", () => {
  const { context, resolveTarget } = createRoutingHarness();
  context.process.env.NOVAFLOW_ADMIN_SERVER_AUTOSTART = "true";
  assertTarget(resolveTarget("/api/client/grok/image-reverse"), {
    baseUrl: "http://127.0.0.1:4761",
    useLocal: true,
    forceLocal: true,
    source: "explicit-local-dev",
  });
});

test("AI-task authorization and usage retain their legacy local default", () => {
  const { resolveTarget } = createRoutingHarness();
  for (const pathName of ["/api/ai/tasks", "/api/ai/tasks/usage"]) {
    assertTarget(resolveTarget(pathName), {
      baseUrl: "http://127.0.0.1:4761",
      useLocal: true,
      forceLocal: true,
      source: "legacy-ai-task-local",
    });
  }
});

test("Smart AI starts the local server only for a selected local target", () => {
  const requestSource = extractNamedFunction(source, "requestNovaFlowSmartAiApi");
  assert.match(
    requestSource,
    /const target = resolveNovaFlowSmartAiApiTarget\(pathName\);[\s\S]*?if \(target\.useLocal\) \{[\s\S]*?ensureNovaFlowAdminServerStarted\([\s\S]*?forceLocal: target\.forceLocal/,
  );
  assert.match(requestSource, /baseUrl: target\.baseUrl/);
  assert.doesNotMatch(
    requestSource,
    /if \(!hasExplicitNovaFlowClientApiBaseUrl\(\)\)[\s\S]*?forceLocal: true/,
    "the absence of an override must not force production Smart AI onto localhost",
  );
});

test("single-image v2 analysis is adult-aware while the generation NSFW setter remains Runtime-owned", () => {
  assert.match(smartAiSource, /const analysisNsfw = usesStaticVisualV2 \? true :/);
  assert.match(smartAiSource, /visualSchema: "nf\.visual\.v2",\s*nsfw: analysisNsfw/);
  assert.match(brandRuntimeSource, /setNsfw: setArtGenerateNsfwEnabled/);

  const artState = { nsfw: false };
  const renders = [];
  const setterSource = extractNamedFunction(brandRuntimeSource, "setArtGenerateNsfwEnabled");
  const setNsfw = vm.runInNewContext(`(${setterSource})`, {
    ART_GENERATE_STATE: artState,
    renderArtGenerateSurfaces(options) { renders.push(options); },
  });
  assert.equal(setNsfw(true), true);
  assert.equal(artState.nsfw, true);
  assert.deepEqual(JSON.parse(JSON.stringify(renders)), [{ forceBottom: true }]);
  assert.equal(setNsfw(true), true, "setting the current value remains idempotent");
  assert.equal(renders.length, 1);
  assert.equal(setNsfw(false), true);
  assert.equal(artState.nsfw, false);
  assert.equal(renders.length, 2);
});

test("client API URL joining preserves cloud and explicit remote path prefixes", () => {
  const functionSource = extractNamedFunction(source, "joinNovaFlowClientApiUrl");
  const joinUrl = vm.runInNewContext(`(${functionSource})`, { URL });
  assert.equal(
    joinUrl(
      "https://project.supabase.co/functions/v1/novaflow-backend/",
      "/api/client/grok/prompt-optimize",
    ),
    "https://project.supabase.co/functions/v1/novaflow-backend/api/client/grok/prompt-optimize",
  );
  assert.equal(
    joinUrl("http://127.0.0.1:4761", "/api/client/grok/image-reverse"),
    "http://127.0.0.1:4761/api/client/grok/image-reverse",
  );
  assert.equal(
    joinUrl("https://backend.example.test/custom/root?old=1#old", "/api/ai/tasks"),
    "https://backend.example.test/custom/root/api/ai/tasks",
  );
});

test("image reverse preserves v2 metadata at 60 seconds", async () => {
  const calls = [];
  const context = vm.createContext({
    resolveNovaFlowSmartAiApiTarget() {
      return { baseUrl: "https://cloud.example.test", useLocal: false, forceLocal: false };
    },
    async ensureNovaFlowAdminServerStarted() {
      throw new Error("cloud requests must not start the local server");
    },
    async requestNovaFlowClientApi(pathName, options) {
      calls.push({ pathName, options });
      return { ok: true };
    },
  });
  const functionSource = extractNamedFunction(source, "requestNovaFlowSmartAiApi");
  vm.runInContext(extractNamedFunction(source, "novaFlowClientApiTimeoutLimit"), context);
  const requestSmartAi = vm.runInContext(`(${functionSource})`, context);

  await requestSmartAi("/api/client/grok/prompt-optimize", { token: "prompt-token" });
  await requestSmartAi("/api/client/grok/image-reverse", {
    token: "image-token",
    visualSchema: "nf.visual.v2",
    nsfw: true,
    purpose: "static-image-reverse",
    images: [{ imageUrl: "data:image/png;base64,ONE" }],
  });

  assert.equal(calls[0].options.timeoutMs, 60_000);
  assert.equal(calls[1].options.timeoutMs, 60_000);
  assert.equal(calls[0].options.baseUrl, "https://cloud.example.test");
  assert.equal(calls[0].options.body.token, undefined, "bearer tokens must stay out of request bodies");
  assert.equal(calls[1].options.body.token, undefined);
  assert.equal(calls[1].options.body.visualSchema, "nf.visual.v2");
  assert.equal(calls[1].options.body.nsfw, true);
  assert.equal(calls[1].options.body.purpose, "static-image-reverse");
});

test("H3 waits for both provider calls and the transport does not clamp it to 60 seconds", async () => {
  const timers = [];
  let elapsedMs = 100_000;
  const context = vm.createContext({
    NOVAFLOW_CLIENT_API_ALLOWED_PATHS: new Set(["/api/client/grok/image-reverse", "/api/client/grok/prompt-optimize"]),
    AbortController,
    URL,
    getNovaFlowClientApiBaseUrl: () => "https://cloud.example.test",
    joinNovaFlowClientApiUrl: (base, route) => base + route,
    setTimeout(callback, ms) { timers.push({ callback, ms }); return timers.length; },
    clearTimeout() {},
    fetch: async (_url, options) => {
      // Simulate provider responses after the old deadline, without wall-clock waits.
      for (const timer of timers) if (timer.ms <= elapsedMs) timer.callback();
      if (options.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, positivePrompt: "complete" }) };
    },
    appendLogLine() {},
    redactNovaFlowClientApiText: (value) => String(value),
  });
  vm.runInContext(extractNamedFunction(source, "novaFlowClientApiTimeoutLimit"), context);
  const limit = vm.runInContext("novaFlowClientApiTimeoutLimit", context);
  const transportSource = source.slice(source.indexOf("async function requestNovaFlowClientApi("), source.indexOf("let novaFlowAdminServerProcess ="));
  const request = vm.runInContext(`(${transportSource})`, context);
  for (const [route, purpose] of [
    ["image-reverse", "minimax-h3-i2v-reverse"],
    ["image-reverse", "minimax-h3-fl2v-reverse"],
    ["prompt-optimize", "minimax-h3-prompt-enhance"],
  ]) {
    timers.length = 0;
    const pathName = `/api/client/grok/${route}`;
    const body = { purpose };
    assert.equal(limit(pathName, body), 135_000);
    const result = await request(pathName, { body, method: "POST", timeoutMs: limit(pathName, body) });
    assert.equal(result.ok, true, "a complete H3 response at 100 seconds must reach the renderer");
    assert.equal(timers[0].ms, 135_000);
  }
  assert.equal(limit("/api/client/grok/image-reverse", { purpose: "static-image-reverse" }), 60_000);
  assert.equal(limit("/api/client/bootstrap", { purpose: "minimax-h3-fl2v-reverse" }), 60_000);
  timers.length = 0;
  const ordinary = await request("/api/client/grok/image-reverse", { body: {}, timeoutMs: 999_000 });
  assert.equal(ordinary.ok, false);
  assert.equal(timers[0].ms, 60_000);
  timers.length = 0;
  elapsedMs = 136_000;
  const overdue = await request("/api/client/grok/image-reverse", {
    body: { purpose: "minimax-h3-fl2v-reverse" }, timeoutMs: 999_000,
  });
  assert.equal(overdue.ok, false, "H3 still has a bounded deadline");
  assert.equal(timers[0].ms, 135_000);
});
