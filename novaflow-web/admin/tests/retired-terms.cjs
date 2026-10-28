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
assert(files["license-admin-gui/index.html"].includes("积分流水"), "member page should point at the credit ledger");
assert(files["license-admin-gui/index.html"].includes("RunningHub 余额"), "dashboard should show the domestic balance");
assert(!files["license-admin-gui/art-knowledge-review.js"].includes("showModal"));
console.log("retired admin terms are gone from rendered pages");
