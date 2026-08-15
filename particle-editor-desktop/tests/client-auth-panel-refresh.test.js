const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.resolve(__dirname, "../../particle-editor/novaflow-client-auth.js");
const source = fs.readFileSync(sourcePath, "utf8");

assert.match(source, /function normalizeProviderQuotas\(/, "account panel should normalize stale provider quota cache");
assert.match(source, /function applyProfileSnapshot\(/, "account panel should have one refresh write-back path");
assert.match(source, /state\.providerQuotas\s*=\s*normalizeProviderQuotas\(/, "provider quotas should be written through the normalizer");
assert.match(source, /document\.addEventListener\("click",\s*handleGlobalActionClick\)/, "account actions should retain a document fallback");
assert.match(source, /eventName === "pointerup" && handleHostAction\(event\)/, "logout should have a pointerup path when click is intercepted");
assert.match(source, /requestRevision !== sessionRevision/, "logout should invalidate an in-flight profile refresh");
assert.match(source, /window\.addEventListener\("focus",\s*handleWindowFocusRefresh\)/, "returning from admin app should refresh logged-in account state");
assert.match(source, /function formatCreditAmount\(/, "account credits should have a fixed-point formatter");
assert.match(source, /maximumFractionDigits:\s*6/, "account credits should preserve up to six decimal places");
assert.match(source, /formatCreditAmount\(state\.credits\?\.balance_text\s*\?\?\s*state\.credits\?\.balance\)/, "the credit balance must prefer the precision-safe text field");
assert.match(source, /formatNumber\(remaining\)[\s\S]{0,40}formatNumber\(allocated\)/, "provider quotas should remain integer-formatted");

const applyStart = source.indexOf("function applyCreditsSnapshot(");
const applyEnd = source.indexOf("\n  function applyProviderQuotaSnapshot", applyStart);
assert.ok(applyStart >= 0 && applyEnd > applyStart, "credit snapshot updater should be extractable");
const context = vm.createContext({ state: { credits: { balance: 4.27, balance_text: "4.270000" } } });
vm.runInContext(`${source.slice(applyStart, applyEnd)}\nthis.applyCreditsSnapshot = applyCreditsSnapshot;`, context);
context.applyCreditsSnapshot({ balance: 8.5 });
assert.equal(context.state.credits.balance, 8.5);
assert.equal(Object.prototype.hasOwnProperty.call(context.state.credits, "balance_text"), false, "a later numeric refresh must clear stale settlement text");

console.log("client-auth-panel refresh tests passed");
