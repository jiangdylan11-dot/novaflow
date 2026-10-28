const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const rh = require("../license-admin-gui/runninghub-provider.cjs");
const fakeKey = "test-runninghub-secret-never-return";
const config = () => ({ ...rh.readConfig(() => ""), apiKey: fakeKey });

test("admin page no longer offers ComfyUI, Grok, or Google provider fields", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../license-admin-gui/index.html"), "utf8");
  const renderer = fs.readFileSync(path.resolve(__dirname, "../license-admin-gui/renderer.js"), "utf8");
  for (const id of ["runninghubRuntimeGoogleImageEndpoint", "comfyRuntimeApiKey", "grokRuntimeApiKey", "saveComfyRuntimeConfig", "saveGrokRuntimeConfig", "saveComfyProviderBudget"]) {
    assert.equal(html.includes(id), false, id);
  }
  assert.equal(html.includes("runninghubRuntimeApiKey"), true);
  assert.equal(renderer.includes("function saveComfyProviderBudget"), false);
  assert.equal(renderer.includes("function isGrokProvider"), false);
  assert.equal(renderer.includes("function providerConnectionBadge"), false);
});

test("image host stays domestic and the LLM host defaults to the international site", () => {
  const parsed = rh.parseConfig({ apiKey: fakeKey, llmModel: "model-from-provider-list", gptImageEndpoint: "/openapi/v2/example/text-to-image" });
  assert.equal(parsed.baseUrl, "https://www.runninghub.cn");
  assert.equal(parsed.llmBaseUrl, "https://llm.runninghub.ai/v1");
  assert.equal(rh.parseConfig({ llmBaseUrl: "https://llm.runninghub.cn/v1" }).llmBaseUrl, "https://llm.runninghub.cn/v1");
  assert.equal(rh.parseConfig({ llmBaseUrl: "https://llm.runninghub.ai/v1" }).llmBaseUrl, "https://llm.runninghub.ai/v1");
  assert.equal(rh.readConfig(() => "").llmModel, "xai/grok-4.7");
  assert.equal(Object.hasOwn(parsed, "googleImageEndpoint"), false);
  assert.equal(Object.values(rh.ENV).includes("NOVAFLOW_RUNNINGHUB_GOOGLE_IMAGE_ENDPOINT"), false);
  assert.equal(parsed.updateApiKey, true);
  assert.equal(rh.publicStatus(config()).integrationStatus, "configuration_only");
  assert.equal(Object.hasOwn(rh.publicStatus(config()), "googleImageEndpoint"), false);
  assert(!JSON.stringify(rh.publicStatus(config())).includes(fakeKey));
});

test("configuration rejects invalid addresses, paths and conflicting key changes before writes", () => {
  for (const baseUrl of ["http://www.runninghub.cn", "https://example.com", "https://www.runninghub.cn/openapi/v2", "https://key@www.runninghub.cn", "https://www.runninghub.cn?key=secret"]) {
    assert.throws(() => rh.parseConfig({ baseUrl }));
  }
  assert.throws(() => rh.parseConfig({ llmBaseUrl: "https://www.runninghub.cn" }));
  assert.throws(() => rh.parseConfig({ apiKey: fakeKey, clearApiKey: true }));
  assert.throws(() => rh.parseConfig({ updateApiKey: true }));
  assert.throws(() => rh.parseConfig({ apiKey: "secret\nother" }));
  assert.throws(() => rh.parseConfig({ gptImageEndpoint: "https://example.com/path" }));
  const ignoredGoogle = rh.parseConfig({ apiKey: fakeKey, googleImageEndpoint: "/openapi/v2/../query" });
  assert.equal(Object.hasOwn(ignoredGoogle, "googleImageEndpoint"), false);
  assert.equal(ignoredGoogle.apiKey, fakeKey);
});

test("missing key never contacts provider", async () => {
  let calls = 0;
  const result = await rh.checkAccount(rh.readConfig(() => ""), { fetchImpl: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(result.connected, false);
  assert.equal(result.checked, false);
});

test("account check uses only read-only account endpoint and handles zero balances", async () => {
  let calls = 0;
  const result = await rh.checkAccount(config(), { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, "https://www.runninghub.cn/uc/openapi/accountStatus");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
    assert.deepEqual(JSON.parse(options.body), { apikey: fakeKey });
    return { ok: true, json: async () => ({ code: 0, data: { remainCoins: "0", remainMoney: "0", currency: "CNY", currentTaskCounts: "0", apiType: fakeKey } }) };
  } });
  assert.equal(calls, 1);
  assert.equal(result.connected, true);
  assert.equal(result.balance.money, 0);
  assert.equal(result.balance.coins, 0);
  assert.equal(result.currentTaskCounts, 0);
  assert(!JSON.stringify(result).includes(fakeKey));
});

test("HTTP, business, malformed and network failures never report connected or leak credentials", async () => {
  const responses = [
    async () => ({ ok: false, status: 401 }),
    async () => ({ ok: true, json: async () => ({ code: 401, msg: fakeKey, data: {} }) }),
    async () => ({ ok: true, json: async () => ({ code: 0 }) }),
    async () => ({ ok: true, json: async () => { throw new Error(fakeKey); } }),
    async () => { throw new Error(fakeKey); },
    async () => { throw Object.assign(new Error(fakeKey), { name: "TimeoutError" }); }
  ];
  for (const fetchImpl of responses) {
    const result = await rh.checkAccount(config(), { fetchImpl });
    assert.equal(result.status, "error");
    assert.equal(result.connected, false);
    assert.equal(result.checked, true);
    assert(!JSON.stringify(result).includes(fakeKey));
  }
});

function adminFixture() {
  const filename = path.resolve(__dirname, "../license-admin-gui/admin-data.js");
  const realRequire = createRequire(filename);
  const registry = new Map();
  const writes = [];
  const env = {};
  const logs = [];
  let checks = 0;
  const module = { exports: {} };
  const context = {
    module, exports: module.exports, process: { env, platform: "win32" },
    console: { log: (s) => logs.push(s), warn: (s) => logs.push(s) },
    require: (name) => name === "child_process" ? { spawnSync: (_cmd, args) => {
      const key = args[args.indexOf("/v") + 1];
      if (args[0] === "query") return registry.has(key) ? { status: 0, stdout: `${key} REG_SZ ${registry.get(key)}` } : { status: 1 };
      writes.push(key);
      if (args[0] === "add") registry.set(key, args[args.indexOf("/d") + 1]);
      else registry.delete(key);
      return { status: 0 };
    } } : name === "./runninghub-provider.cjs" ? { ...rh, checkAccount: async (c) => { checks++; return rh.checkAccount(c, { fetchImpl: async () => ({ ok: true, json: async () => ({ code: 0, data: { remainMoney: "12.5", currency: "CNY" } }) }) }); } } : realRequire(name)
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return { api: module.exports, registry, writes, env, logs, checks: () => checks };
}

test("save persists RunningHub config, preserves blank key, clears explicitly, and returns no secret", async () => {
  const f = adminFixture();
  f.env.NOVAFLOW_GROK_API_KEY = "unrelated-grok-key";
  let result = await f.api.setAdminProviderRuntimeConfig({ providerKey: "runninghub", apiKey: fakeKey, llmModel: "chosen-model" });
  assert.equal(result.ok, true);
  assert.equal(result.env.hasApiKey, true);
  assert.equal(f.registry.get(rh.ENV.apiKey), fakeKey);
  assert.equal(f.registry.has(rh.ENV.llmModel), false);
  assert.equal(f.registry.has("NOVAFLOW_RUNNINGHUB_GOOGLE_IMAGE_ENDPOINT"), false);
  assert.deepEqual(f.writes.filter((name) => name !== rh.ENV.apiKey), []);
  assert(!JSON.stringify(result).includes(fakeKey));
  assert.equal(Object.hasOwn(result.env, "googleImageEndpoint"), false);
  result = await f.api.setAdminProviderRuntimeConfig({ providerKey: "runninghub", apiKey: "" });
  assert.equal(result.ok, true);
  assert.equal(f.registry.get(rh.ENV.apiKey), fakeKey);
  assert.equal(f.env.NOVAFLOW_GROK_API_KEY, "unrelated-grok-key");
  result = await f.api.setAdminProviderRuntimeConfig({ providerKey: "runninghub", clearApiKey: true });
  assert.equal(result.env.hasApiKey, false);
  assert.equal(f.registry.has(rh.ENV.apiKey), false);
  assert(!f.logs.join("\n").includes(fakeKey));
});

test("old provider env writes are rejected and do not touch stored secrets", async () => {
  const f = adminFixture();
  f.env.NOVAFLOW_GROK_API_KEY = "unrelated-grok-key";
  f.env.NOVAFLOW_COMFYUI_API_KEY = "unrelated-comfy-key";
  for (const payload of [
    { providerKey: "grok", apiKey: "new-grok-secret" },
    { providerKey: "comfyui", apiKey: "new-comfy-secret" },
    { providerKey: "runninghub", NOVAFLOW_GROK_API_KEY: "new-grok-secret", apiKey: fakeKey },
    { providerKey: "runninghub", NOVAFLOW_COMFYUI_API_KEY: "new-comfy-secret", apiKey: fakeKey },
    { providerKey: "runninghub", NOVAFLOW_RUNNINGHUB_GOOGLE_IMAGE_ENDPOINT: "/openapi/v2/google/image", apiKey: fakeKey }
  ]) {
    const result = await f.api.setAdminProviderRuntimeConfig(payload);
    assert.equal(result.ok, false);
    assert.match(result.error, /Unsupported/);
  }
  assert.equal(f.writes.length, 0);
  assert.equal(f.env.NOVAFLOW_GROK_API_KEY, "unrelated-grok-key");
  assert.equal(f.env.NOVAFLOW_COMFYUI_API_KEY, "unrelated-comfy-key");
  assert.equal(f.registry.has(rh.ENV.apiKey), false);
  assert(!f.logs.join("\n").includes("new-grok-secret"));
  assert(!f.logs.join("\n").includes("new-comfy-secret"));
  assert(!f.logs.join("\n").includes(fakeKey));
});

test("rejected config makes no environment writes; status reads make no provider calls", async () => {
  const f = adminFixture();
  const result = await f.api.setAdminProviderRuntimeConfig({ providerKey: "runninghub", baseUrl: "https://example.com", apiKey: fakeKey });
  assert.equal(result.ok, false);
  assert.equal(f.writes.length, 0);
  await f.api.getAdminRunningHubProviderStatus();
  assert.equal(f.checks(), 0);
  await f.api.setAdminProviderRuntimeConfig({ providerKey: "runninghub", apiKey: fakeKey });
  const checked = await f.api.getAdminRunningHubProviderStatus({ checkAccount: true });
  assert.equal(checked.connected, true);
  await f.api.getAdminRunningHubProviderStatus();
  assert.equal(f.checks(), 1);
  await f.api.setAdminProviderRuntimeConfig({ providerKey: "runninghub", clearApiKey: true });
  const cleared = await f.api.getAdminRunningHubProviderStatus();
  assert.equal(cleared.connected, false);
  assert.equal(cleared.checked, false);
});

test("manual Comfy balance writes are refused by the data API and the IPC handler", async () => {
  const f = adminFixture();
  const result = await f.api.setAdminProviderBudget({ providerKey: "comfyui", balance: 10550, unit: "credits", note: "manual calibration" });
  assert.equal(result.ok, false);
  assert.equal(result.status, "error");
  assert.match(result.error, /不再录入/);
  assert.equal(f.writes.length, 0);

  const handlers = new Map();
  const Module = require("node:module");
  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "electron") {
      return {
        ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on: () => {} },
        dialog: {},
        shell: {},
        app: { getPath: () => "/tmp" },
        BrowserWindow: { getFocusedWindow: () => null, fromWebContents: () => null }
      };
    }
    return realLoad.call(this, request, parent, isMain);
  };
  try {
    const ipcPath = require.resolve("../license-admin-gui/ipc.js");
    delete require.cache[ipcPath];
    const ipc = require("../license-admin-gui/ipc.js");
    ipc.registerLicenseAdminIpc();
  } finally {
    Module._load = realLoad;
  }
  const response = await handlers.get("admin:data:provider_budget:set")({}, { providerKey: "comfyui", balance: 20 });
  assert.equal(response.ok, false);
  assert.match(String(response.error || ""), /不再录入/);
});

test("runninghub config route rejects a mislabeled provider key and does not store it", async () => {
  const http = require("node:http");
  const previous = {
    token: process.env.NOVAFLOW_ADMIN_API_TOKEN,
    runninghub: process.env.NOVAFLOW_RUNNINGHUB_API_KEY,
    grok: process.env.NOVAFLOW_GROK_API_KEY
  };
  process.env.NOVAFLOW_ADMIN_API_TOKEN = "test-admin-token-not-a-provider-key";
  delete process.env.NOVAFLOW_RUNNINGHUB_API_KEY;
  process.env.NOVAFLOW_GROK_API_KEY = "existing-grok-key";
  const { createAdminServer } = require("../admin-server/server.js");
  const server = createAdminServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const post = (body) => new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method: "POST",
      path: "/api/admin/providers/runninghub/config",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-admin-token-not-a-provider-key"
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} });
      });
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
  try {
    const mislabeled = await post({ providerKey: "grok", apiKey: "mislabeled-secret-not-runninghub" });
    assert.equal(mislabeled.status, 400);
    assert.equal(mislabeled.body.ok, false);
    assert.equal(process.env.NOVAFLOW_RUNNINGHUB_API_KEY, undefined);
    assert.equal(process.env.NOVAFLOW_GROK_API_KEY, "existing-grok-key");
    assert.equal(JSON.stringify(mislabeled.body).includes("mislabeled-secret-not-runninghub"), false);
    const alias = await post({ provider_key: "comfyui", apiKey: "mislabeled-comfy-secret" });
    assert.equal(alias.status, 400);
    assert.equal(process.env.NOVAFLOW_RUNNINGHUB_API_KEY, undefined);
    const missing = await post({ apiKey: "unlabeled-secret" });
    assert.equal(missing.status, 400);
    assert.equal(process.env.NOVAFLOW_RUNNINGHUB_API_KEY, undefined);
    const accepted = await post({ providerKey: "runninghub", apiKey: "rh-fixture-key-not-real" });
    assert.equal(accepted.body.ok, true);
    assert.equal(process.env.NOVAFLOW_RUNNINGHUB_API_KEY, "rh-fixture-key-not-real");
    assert.equal(process.env.NOVAFLOW_GROK_API_KEY, "existing-grok-key");
    assert.equal(JSON.stringify(accepted.body).includes("rh-fixture-key-not-real"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous.token === undefined) delete process.env.NOVAFLOW_ADMIN_API_TOKEN;
    else process.env.NOVAFLOW_ADMIN_API_TOKEN = previous.token;
    if (previous.runninghub === undefined) delete process.env.NOVAFLOW_RUNNINGHUB_API_KEY;
    else process.env.NOVAFLOW_RUNNINGHUB_API_KEY = previous.runninghub;
    if (previous.grok === undefined) delete process.env.NOVAFLOW_GROK_API_KEY;
    else process.env.NOVAFLOW_GROK_API_KEY = previous.grok;
  }
});
