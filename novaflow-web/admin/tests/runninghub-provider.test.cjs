const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const rh = require("../license-admin-gui/runninghub-provider.cjs");
const fakeKey = "test-runninghub-secret-never-return";
const config = () => ({ ...rh.readConfig(() => ""), apiKey: fakeKey });

test("domestic defaults and model configuration remain independent of existing providers", () => {
  const parsed = rh.parseConfig({ apiKey: fakeKey, llmModel: "model-from-provider-list", gptImageEndpoint: "/openapi/v2/example/text-to-image" });
  assert.equal(parsed.baseUrl, "https://www.runninghub.cn");
  assert.equal(parsed.llmBaseUrl, "https://llm.runninghub.cn/v1");
  assert.equal(parsed.googleImageEndpoint, "");
  assert.equal(parsed.updateApiKey, true);
  assert.equal(rh.publicStatus(config()).integrationStatus, "configuration_only");
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
  assert.throws(() => rh.parseConfig({ googleImageEndpoint: "/openapi/v2/../query" }));
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
  assert.equal(f.registry.get(rh.ENV.llmModel), "chosen-model");
  assert(!JSON.stringify(result).includes(fakeKey));
  result = await f.api.setAdminProviderRuntimeConfig({ providerKey: "runninghub", apiKey: "" });
  assert.equal(result.ok, true);
  assert.equal(f.registry.get(rh.ENV.apiKey), fakeKey);
  assert.equal(f.env.NOVAFLOW_GROK_API_KEY, "unrelated-grok-key");
  result = await f.api.setAdminProviderRuntimeConfig({ providerKey: "runninghub", clearApiKey: true });
  assert.equal(result.env.hasApiKey, false);
  assert.equal(f.registry.has(rh.ENV.apiKey), false);
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
