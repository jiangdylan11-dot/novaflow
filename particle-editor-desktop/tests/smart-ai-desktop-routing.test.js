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
      "/api/client/grok/storyboard-unified-nine-shots",
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
  assertTarget(resolveTarget("/api/client/grok/storyboard-unified-nine-shots"), {
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

test("storyboard receives 120 seconds while image reverse preserves v2 metadata at 60 seconds", async () => {
  const calls = [];
  const context = vm.createContext({
    NOVAFLOW_GROK_STORYBOARD_PATH: "/api/client/grok/storyboard-unified-nine-shots",
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
  const requestSmartAi = vm.runInContext(`(${functionSource})`, context);

  await requestSmartAi("/api/client/grok/storyboard-unified-nine-shots", { token: "story-token" });
  await requestSmartAi("/api/client/grok/prompt-optimize", { token: "prompt-token" });
  await requestSmartAi("/api/client/grok/image-reverse", {
    token: "image-token",
    visualSchema: "nf.visual.v2",
    nsfw: true,
    purpose: "static-image-reverse",
    images: [{ imageUrl: "data:image/png;base64,ONE" }],
  });

  assert.equal(calls[0].options.timeoutMs, 120_000);
  assert.equal(calls[1].options.timeoutMs, 60_000);
  assert.equal(calls[2].options.timeoutMs, 60_000);
  assert.equal(calls[0].options.baseUrl, "https://cloud.example.test");
  assert.equal(calls[0].options.body.token, undefined, "bearer tokens must stay out of request bodies");
  assert.equal(calls[2].options.body.token, undefined);
  assert.equal(calls[2].options.body.visualSchema, "nf.visual.v2");
  assert.equal(calls[2].options.body.nsfw, true);
  assert.equal(calls[2].options.body.purpose, "static-image-reverse");
});
