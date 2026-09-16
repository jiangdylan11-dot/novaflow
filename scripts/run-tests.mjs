#!/usr/bin/env node
// Aggregate test runner.
//
// The repo has ~160 test files and 39 contract scripts, but almost none of them had a way to
// be invoked, so in practice nothing ran unless someone remembered which file to pick. This
// runs them as groups and reports one result.
//
// A net with standing red lights is not a net, because people learn to ignore it. So the
// known-failing set is recorded in TEST_BASELINE.json: those are reported as KNOWN-RED and do
// not fail the run. Only a test that was green and went red fails it. A test that was red and
// went green is reported as FIXED, with a nudge to re-record.
//
//   npm test                    every group that needs no running service
//   npm run test:unit           node:test + vitest only
//   npm run test:contracts      static contract scripts only
//   npm run test:py             python tests only
//   npm run test:live           the groups that need 4783 / ComfyUI running
//   node scripts/run-tests.mjs --update    re-record the baseline

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(repoRoot, "TEST_BASELINE.json");
const DESKTOP_TESTS = path.join("particle-editor-desktop", "tests");

const argv = process.argv.slice(2);
const UPDATE = argv.includes("--update");
const JSON_OUT = argv.includes("--json");
const WANTED = (() => {
  const i = argv.indexOf("--group");
  return i >= 0 ? argv[i + 1].split(",") : null;
})();
const CONCURRENCY = Math.max(2, Math.min(os.cpus().length, 8));

// Scripts that talk to a live service. They are correct but cannot run on a bare checkout,
// so they live in their own group rather than failing every run.
const LIVE_SCRIPTS = new Set([
  "check-ai-seq-cloud-credit-live.mjs",
  "check-ai-seq-cloud-credit-button.mjs",
  "check-ai-seq-local-model-option.mjs",
  "check-ai-seq-local-provider-gateway.mjs",
  "check-ai-seq-local-provider-runtime-proxy-flow.mjs",
  "check-runtime-write-budget.mjs",
  "check-pen-source-split.cjs",
  "check-runtime-sync.mjs",
  "check-smart-ai-contract.mjs",
  "check-primary-animation-entry-preview.mjs"
]);

// pytest cannot import a module whose filename contains hyphens, so these are run directly.
const PY_DIRECT = /\.test\.py$/;
const PY_PYTEST = /^test_.*\.py$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, timeoutMs = 180000, cwd = repoRoot) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let out = "";
    child.stdout.on("data", (b) => { if (out.length < 120000) out += b.toString(); });
    child.stderr.on("data", (b) => { if (out.length < 120000) out += b.toString(); });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, timeoutMs);
    const done = (code) => { clearTimeout(timer); resolve({ code, out, ms: Date.now() - started }); };
    child.on("close", done);
    child.on("error", () => done(-1));
  });
}

async function runPool(items, worker) {
  const results = [];
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

const listDir = (dir, re) => {
  try { return fs.readdirSync(path.join(repoRoot, dir)).filter((f) => re.test(f)).sort(); }
  catch { return []; }
};

const GROUPS = {
  unit: {
    title: "单元 / 契约测试 (node:test)",
    live: false,
    async collect() {
      return listDir(DESKTOP_TESTS, /\.test\.(js|mjs)$/).map((f) => ({
        id: `${DESKTOP_TESTS}/${f}`.replace(/\\/g, "/"),
        exec: () => run(process.execPath, ["--test", path.join(DESKTOP_TESTS, f)], 180000)
      }));
    }
  },
  vitest: {
    title: "引擎测试 (vitest)",
    live: false,
    async collect() {
      return [{
        id: "particle-editor/vitest",
        // Not via npm: Node 24 refuses to spawn a .cmd shim on Windows without a shell,
        // and going through a shell would need quoting care for no benefit.
        exec: () => run(process.execPath,
          [path.join("node_modules", "vitest", "vitest.mjs"), "run"],
          300000, path.join(repoRoot, "particle-editor"))
      }];
    }
  },
  py: {
    title: "Python 测试",
    live: false,
    async collect() {
      const pytest = listDir(DESKTOP_TESTS, PY_PYTEST).map((f) => ({
        id: `${DESKTOP_TESTS}/${f}`.replace(/\\/g, "/"),
        exec: () => run("python", ["-m", "pytest", "-q", path.join(DESKTOP_TESTS, f)], 300000)
      }));
      const direct = listDir(DESKTOP_TESTS, PY_DIRECT).map((f) => ({
        id: `${DESKTOP_TESTS}/${f}`.replace(/\\/g, "/"),
        exec: () => run("python", [path.join(DESKTOP_TESTS, f)], 300000)
      }));
      return [...pytest, ...direct];
    }
  },
  contracts: {
    title: "契约脚本 (scripts/check-*)",
    live: false,
    async collect() {
      return listDir("scripts", /^check-.*\.(mjs|cjs)$/)
        .filter((f) => !LIVE_SCRIPTS.has(f))
        .map((f) => ({
          id: `scripts/${f}`,
          exec: () => run(process.execPath, [path.join("scripts", f)], 120000)
        }));
    }
  },
  live: {
    title: "需要服务在跑的检查 (4783 / ComfyUI / Electron)",
    live: true,
    async collect() {
      return listDir("scripts", /^check-.*\.(mjs|cjs)$/)
        .filter((f) => LIVE_SCRIPTS.has(f))
        .map((f) => ({
          id: `scripts/${f}`,
          exec: () => run(process.execPath, [path.join("scripts", f)], 600000)
        }));
    }
  }
};

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")); } catch { return null; }
}

async function main() {
  const groupNames = WANTED || Object.keys(GROUPS).filter((g) => !GROUPS[g].live);
  const baseline = loadBaseline();
  const knownRed = new Set(baseline?.knownRed || []);

  const all = [];
  for (const name of groupNames) {
    const group = GROUPS[name];
    if (!group) { console.error(`unknown group: ${name}`); process.exit(2); }
    const items = await group.collect();
    process.stdout.write(`\n${group.title}  (${items.length})\n`);
    const results = await runPool(items, async (item) => {
      const r = await item.exec();
      return { group: name, id: item.id, ok: r.code === 0, ms: r.ms, tail: r.code === 0 ? "" : r.out.slice(-1200) };
    });
    for (const r of results) {
      const state = r.ok ? (knownRed.has(r.id) ? "FIXED" : "ok") : (knownRed.has(r.id) ? "known-red" : "NEW FAIL");
      const mark = { ok: "  ok     ", "known-red": "  known-red", FIXED: "  FIXED  ", "NEW FAIL": "  NEW FAIL" }[state];
      if (state !== "ok" || !JSON_OUT) {
        process.stdout.write(`${mark} ${String(r.ms).padStart(6)}ms  ${r.id.replace(DESKTOP_TESTS.replace(/\\/g, "/") + "/", "")}\n`);
      }
      r.state = state;
    }
    all.push(...results);
  }

  const nowRed = all.filter((r) => !r.ok).map((r) => r.id).sort();
  const newFail = all.filter((r) => r.state === "NEW FAIL");
  const fixed = all.filter((r) => r.state === "FIXED");

  if (UPDATE) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify({
      note: "Tests known to fail on this baseline. They are reported as known-red and do not fail the run, so that a newly broken test stands out. Shrink this list; do not grow it.",
      recordedAt: new Date().toISOString().slice(0, 10),
      groups: groupNames,
      knownRed: nowRed
    }, null, 2) + "\n");
    console.log(`\n已记录基线: ${nowRed.length} 个已知红灯 -> ${path.relative(repoRoot, BASELINE_PATH)}`);
    return;
  }

  const green = all.filter((r) => r.ok).length;
  console.log("");
  console.log(`总计 ${all.length}:  通过 ${green}   已知红灯 ${all.length - green - newFail.length}   新增失败 ${newFail.length}   意外修好 ${fixed.length}`);

  if (fixed.length) {
    console.log(`\n以下测试原本是红的，现在绿了 - 用 --update 把它们移出基线，否则下次坏掉不会有人发现:`);
    for (const f of fixed) console.log(`  - ${f.id}`);
  }
  if (newFail.length) {
    console.error(`\n新增失败 ${newFail.length} 个:`);
    for (const f of newFail) {
      console.error(`\n  ${f.id}`);
      console.error(f.tail.split("\n").slice(-12).map((l) => "    " + l).join("\n"));
    }
    process.exit(1);
  }
  console.log("\nPASS 没有新增失败");
}

main().catch((e) => { console.error("FAIL " + (e?.stack || e)); process.exit(2); });
