const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const migration = read("supabase/migrations/20260710000000_comfyui_usage_settlement.sql");
const decimalMigrationPath = "supabase/migrations/20260712000000_decimal_comfy_image_settlement.sql";
assert.equal(fs.existsSync(path.join(root, decimalMigrationPath)), true, "the decimal Comfy image migration should exist");
const decimalMigration = read(decimalMigrationPath);
const creditsUniqueMigration = read("supabase/migrations/20260710001000_credits_user_id_unique.sql");
const schema = read("particle-editor-desktop/license-admin-gui/supabase-admin-schema.sql");
const adminData = read("particle-editor-desktop/license-admin-gui/admin-data.js");
const server = read("particle-editor-desktop/admin-server/server.js");
const edge = read("supabase/functions/novaflow-backend/index.ts");
const runtimeProxy = read("particle-editor/runtime-fetch-proxy.js");
const preload = read("particle-editor-desktop/preload.js");
const adminRenderer = read("particle-editor-desktop/license-admin-gui/renderer.js");

for (const sql of [migration, schema]) {
  assert.match(sql, /create table if not exists public\.comfy_usage_settlements/i);
  assert.match(sql, /usage_key text (?:primary key|not null)/i);
  assert.match(sql, /create or replace function public\.settle_comfy_usage/i);
  assert.match(sql, /pending_pricing/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /provider_budget_comfyui/i);
  assert.match(sql, /revoke all on function public\.settle_comfy_usage/i);
}

for (const sql of [decimalMigration, schema]) {
  assert.match(sql, /credits[\s\S]{0,260}(?:column\s+)?balance(?:\s+type)?\s+numeric\(20,\s*6\)/i, "user credit balances must support fixed-point Comfy charges");
  assert.match(sql, /(?:column\s+)?charge_amount(?:\s+type)?\s+numeric\(20,\s*6\)/i);
  assert.match(sql, /(?:column\s+)?user_balance_before(?:\s+type)?\s+numeric\(20,\s*6\)/i);
  assert.match(sql, /(?:column\s+)?user_balance_after(?:\s+type)?\s+numeric\(20,\s*6\)/i);
  assert.match(sql, /p_charge_amount\s+numeric/i);
  assert.match(sql, /charge_amount_text/i, "RPC responses should include canonical decimal strings");
  assert.match(sql, /deducted_text/i);
  assert.match(sql, /balance_text/i);
  assert.match(sql, /settled charge mismatch/i);
  assert.match(sql, /for update/i);
}
assert.match(decimalMigration, /drop function if exists public\.settle_comfy_usage\(text, uuid, text, text, text, text, numeric, integer, text, jsonb\)/i);
assert.match(schema, /drop function if exists public\.settle_comfy_usage\(text, uuid, text, text, text, text, numeric, integer, text, jsonb\)/i);
assert.match(decimalMigration, /revoke all on function public\.settle_comfy_usage\(text, uuid, text, text, text, text, numeric, numeric, text, jsonb\)/i);

assert.match(creditsUniqueMigration, /having count\(\*\) > 1/i);
assert.match(creditsUniqueMigration, /create unique index if not exists credits_user_id_unique_idx/i);

assert.match(adminData, /\.rpc\("settle_comfy_usage"/);
assert.match(server, /settleAdminComfyUsage\(\{/);
assert.doesNotMatch(server, /const usage = await deductLocalWorkflowCredits\(/);
assert.match(edge, /\.rpc\("settle_comfy_usage"/);
assert.match(edge, /new Set\(\["comfyui"\]\)/);

for (const source of [server, edge]) {
  assert.match(source, /pending_pricing/);
  assert.doesNotMatch(source, /return await calculateGatewayCreditCost\(task\)/);
}

assert.match(runtimeProxy, /if \(window\.location\.protocol === 'file:'\) return/);
assert.doesNotMatch(preload, /__novaflowProviderUsageOwner/);
assert.match(runtimeProxy, /promptId: id/);
assert.match(preload, /promptId: id/);
assert.match(preload, /chargeAmount:\s*observedPrice\.amountText/, "preload should transport the exact six-decimal string");

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf("\nfunction ", start + 1);
  assert.notEqual(next, -1, `${name} should be followed by another function`);
  return source.slice(start, next).trim();
}

for (const [label, source] of [["local server", server], ["admin data", adminData]]) {
  const context = vm.createContext({});
  vm.runInContext(`this.parseCanonicalCreditAmount = ${extractNamedFunction(source, "parseCanonicalCreditAmount")}`, context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.parseCanonicalCreditAmount("4.270000"))),
    { amountText: "4.270000", amount: 4.27 },
    `${label} should preserve a valid canonical amount`,
  );
  for (const invalid of ["4", "4.27", "0.000000", "4.2700001", "4e0", " 4.270000", "4.270000 ", "-1.000000", "NaN", "Infinity", "04.270000"]) {
    assert.throws(() => context.parseCanonicalCreditAmount(invalid), /canonical|invalid/i, `${label} should reject ${invalid}`);
  }
}

for (const source of [server, edge]) {
  assert.match(source, /local_workflow_image/);
  assert.match(source, /comfy_api_exact_price_v1/);
  assert.match(source, /chargeAmount|charge_amount/);
  assert.match(source, /Math\.ceil/, "non-image and gateway paths must retain integer charging");
}
assert.match(adminData, /comfy_api_exact_price_v1/);
assert.match(adminRenderer, /function formatCreditAmount\(/);
assert.match(adminRenderer, /maximumFractionDigits:\s*6/);
assert.match(adminRenderer, /function formatProviderBalance[\s\S]{0,260}maximumFractionDigits:\s*6/);
assert.match(adminRenderer, /function formatProviderBalanceInput\(/);
assert.match(adminRenderer, /input\.value\s*=\s*hasBalance\s*\?\s*formatProviderBalanceInput\(balance\)/);
assert.doesNotMatch(adminRenderer, /balance\.toFixed\(2\)/, "provider budget edit controls must not round six-decimal balances");
assert.match(adminData, /new Intl\.NumberFormat\("en-US",\s*\{\s*maximumFractionDigits:\s*6\s*\}\)/);

console.log("comfyui usage settlement contract tests passed");
