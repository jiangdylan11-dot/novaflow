const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function fixture({ connected = true, readFails = false, writeFails = false, missingConfirmation = false } = {}) {
  const filename = path.resolve(__dirname, "../license-admin-gui/admin-data.js");
  const realRequire = createRequire(filename);
  const settings = new Map([["feature_credit_config", { prices: { online_chat_turn: 4 }, token_billing: { markup: 2 } }]]);
  const writes = [];
  const client = { from(table) {
    assert.equal(table, "system_settings");
    let key, record;
    const q = {
      select() { return q; }, eq(_key, value) { key = value; return q; },
      upsert(value) { record = value; return q; },
      async maybeSingle() {
        if (record) {
          if (writeFails) return { error: new Error("fixture write failure") };
          writes.push(record); settings.set(record.key, record.value);
          return { data: missingConfirmation ? null : record };
        }
        if (readFails) return { error: new Error("fixture read failure") };
        return { data: settings.has(key) ? { value: settings.get(key) } : null };
      }
    };
    return q;
  } };
  const module = { exports: {} };
  const env = connected ? { NOVAFLOW_SUPABASE_URL: "https://fixture.invalid", NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY: "fixture-role" } : {};
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports, process: { env, platform: "linux" },
    console: { log() {}, warn() {} },
    require: name => name === "@supabase/supabase-js" ? { createClient: () => client } : realRequire(name)
  }, { filename });
  return { api: module.exports, settings, writes };
}
const plain = x => JSON.parse(JSON.stringify(x));

test("profit assumptions use an independent key and preserve billing and future settings", async () => {
  const f = fixture();
  assert.deepEqual(plain(await f.api.getProfitEstimateSettings()), { credit_price_usd: null, credit_price_cny: null, usd_cny: null });
  f.settings.set("feature_credit_profit_estimate", { future_field: "preserved" });
  assert.deepEqual(plain(await f.api.saveProfitEstimateSettings({ credit_price_cny: "0.02857142857", usd_cny: "6.7" })),
    { credit_price_usd: null, credit_price_cny: 0.02857142857, usd_cny: 6.7 });
  assert.equal(f.writes[0].key, "feature_credit_profit_estimate");
  assert.equal(f.settings.get("feature_credit_profit_estimate").future_field, "preserved");
  assert.deepEqual(f.settings.get("feature_credit_config"), { prices: { online_chat_turn: 4 }, token_billing: { markup: 2 } });
  assert.deepEqual(plain(await f.api.getProfitEstimateSettings()), { credit_price_usd: null, credit_price_cny: 0.02857142857, usd_cny: 6.7 });
  assert.deepEqual(plain(await f.api.saveProfitEstimateSettings({ credit_price_cny: "", usd_cny: null })), { credit_price_usd: null, credit_price_cny: null, usd_cny: null });
  await f.api.saveProfitEstimateSettings({ credit_price_usd: "0.0042643923", credit_price_cny: "", usd_cny: "" });
  assert.equal((await f.api.getProfitEstimateSettings()).credit_price_usd, 0.0042643923);
  await f.api.saveProfitEstimateSettings({ credit_price_cny: "0.03", usd_cny: "6.7" });
  assert.equal((await f.api.getProfitEstimateSettings()).credit_price_usd, 0.0042643923, "older clients must preserve USD assumptions");
});

test("invalid or incomplete assumptions never write", async () => {
  const f = fixture();
  for (const input of [
    {}, { credit_price_cny: 1 }, { credit_price_cny: -1, usd_cny: 6.7 },
    { credit_price_cny: true, usd_cny: 6.7 }, { credit_price_cny: 1, usd_cny: "nope" },
    { credit_price_cny: 1, usd_cny: 1000001 }, { credit_price_cny: 1, usd_cny: 0 },
    { credit_price_usd: -1, credit_price_cny: "", usd_cny: "" }
  ]) await assert.rejects(f.api.saveProfitEstimateSettings(input));
  assert.equal(f.writes.length, 0);
});

test("missing connection, read error and unconfirmed saves report failure", async () => {
  const disconnected = fixture({ connected: false });
  await assert.rejects(disconnected.api.getProfitEstimateSettings(), /尚未连接/);
  await assert.rejects(disconnected.api.saveProfitEstimateSettings({ credit_price_cny: 1, usd_cny: 1 }), /尚未连接/);
  const unreadable = fixture({ readFails: true });
  await assert.rejects(unreadable.api.getProfitEstimateSettings(), /read failure/);
  await assert.rejects(unreadable.api.saveProfitEstimateSettings({ credit_price_cny: 1, usd_cny: 1 }), /read failure/);
  const failed = fixture({ writeFails: true });
  await assert.rejects(failed.api.saveProfitEstimateSettings({ credit_price_cny: 1, usd_cny: 1 }), /write failure/);
  const unconfirmed = fixture({ missingConfirmation: true });
  await assert.rejects(unconfirmed.api.saveProfitEstimateSettings({ credit_price_cny: 1, usd_cny: 1 }), /服务器未确认/);
});

test("IPC and preload expose only the dedicated assumption methods", () => {
  const preload = fs.readFileSync(path.resolve(__dirname, "../license-admin-gui/preload.js"), "utf8");
  const ipc = fs.readFileSync(path.resolve(__dirname, "../license-admin-gui/ipc.js"), "utf8");
  assert.match(preload, /getProfitEstimateSettings:.*admin:data:profit_estimate:get/);
  assert.match(preload, /saveProfitEstimateSettings:.*admin:data:profit_estimate:save/);
  assert.match(ipc, /registerAdminDataList\("admin:data:profit_estimate:get", adminData\.getProfitEstimateSettings\)/);
  assert.match(ipc, /registerAdminDataWrite\("admin:data:profit_estimate:save", adminData\.saveProfitEstimateSettings\)/);
});
