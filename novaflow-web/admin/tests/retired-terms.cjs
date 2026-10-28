const assert = require("assert");
const fs = require("fs");
const path = require("path");
process.chdir(path.join(__dirname, ".."));

const phrases = [
  "提示词次数",
  "提示词服务",
  "Grok 次数",
  "次数分配",
  "提示词已分配",
  "提示词已使用",
  "不保存流水",
  "不保存积分流水",
  "不保存任务记录",
  "不写消费流水",
  "轻量后台",
  "ComfyUI 手动",
  "ComfyUI 连接",
  "cloud.comfy.org",
  "secret resolver",
  "团队",
  "Google",
  "待迁移",
  "尚未启用计费",
  "尚未切换",
  "积分与提示词"
];

function stripHtml(source) {
  return source
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<section\b[^>]*data-allow-history="quota-migration"[\s\S]*?<\/section>/i, "");
}

function visibleJs(source) {
  const migration = source.indexOf("async function runQuotaMigration");
  const kept = migration >= 0 ? source.slice(0, migration) : source;
  return kept.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const files = {
  "license-admin-gui/index.html": stripHtml(fs.readFileSync("license-admin-gui/index.html", "utf8")),
  "license-admin-gui/renderer.js": visibleJs(fs.readFileSync("license-admin-gui/renderer.js", "utf8")),
  "license-admin-gui/art-knowledge-review.js": fs.readFileSync("license-admin-gui/art-knowledge-review.js", "utf8"),
  "license-admin-gui/README.md": fs.readFileSync("license-admin-gui/README.md", "utf8")
};

const hits = [];
for (const [file, text] of Object.entries(files)) {
  for (const phrase of phrases) {
    if (text.includes(phrase)) hits.push(`${file}: ${phrase}`);
  }
}
assert.deepEqual(hits, [], `retired admin copy still visible:\n${hits.join("\n")}`);
const adminData = fs.readFileSync("license-admin-gui/admin-data.js", "utf8");
for (const phrase of ["artist@demo.com", "mock-4090", "mock placeholder", "demo.com"]) {
  assert(!adminData.includes(phrase), `admin-data still contains fake row ${phrase}`);
}
assert(!adminData.includes("const mockData"), "mockData fixture must not be rendered");
assert(!files["license-admin-gui/renderer.js"].includes("mock 数据"), "renderer must not label fake rows as data");
assert(!files["license-admin-gui/renderer.js"].includes("getAdminCreditLogs"), "dashboard must not read credit_logs");
assert(!files["license-admin-gui/renderer.js"].includes("getAdminComfyUiProviderStatus"), "dashboard must not probe cloud Comfy");

const preload = fs.readFileSync("license-admin-gui/preload.js", "utf8");
const ipc = fs.readFileSync("license-admin-gui/ipc.js", "utf8");
const retiredIpc = [
  ["getAdminCreditLogs", "admin:data:credit_logs:list"],
  ["getAdminComfyUiProviderStatus", "admin:provider:comfyui:status"],
  ["setAdminProviderBudget", "admin:data:provider_budget:set"]
];
for (const [bridge, channel] of retiredIpc) {
  assert(!preload.includes(bridge), `preload still exports ${bridge}`);
  assert(!preload.includes(channel), `preload still invokes ${channel}`);
  assert(!ipc.includes(channel), `ipc still registers ${channel}`);
}
for (const symbol of ["function getAdminCreditLogs", "function getAdminComfyUiProviderStatus", "function setAdminProviderBudget", "function getClientCreditLogs"]) {
  assert(!adminData.includes(symbol), `admin-data still defines ${symbol}`);
}
assert(files["license-admin-gui/index.html"].includes("积分流水"), "member page should point at the credit ledger");
assert(files["license-admin-gui/index.html"].includes("RunningHub 余额"), "dashboard should show the domestic balance");
assert(!files["license-admin-gui/art-knowledge-review.js"].includes("showModal"));
console.log("retired admin terms are gone from rendered pages");
