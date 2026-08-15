import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const bundle = read("particle-editor/assets/index-BbIa-2NM.js");
const index = read("particle-editor/index.html");
const preload = read("particle-editor-desktop/preload.js");
const runtimeProxy = read("particle-editor/runtime-fetch-proxy.js");

const submitStart = bundle.indexOf("let T=`novaflow_${crypto.randomUUID()}`");
const submitEnd = bundle.indexOf("},M=async e=>", submitStart);
assert.ok(submitStart >= 0 && submitEnd > submitStart, "AI sequence submit/result collector must exist");

const runStart = bundle.lastIndexOf(",j=async()=>", submitStart);
assert.ok(runStart >= 0 && runStart < submitStart, "AI sequence generation dispatcher must exist");

const generationRun = bundle.slice(runStart, submitEnd);
const collector = bundle.slice(submitStart, submitEnd);
assert.ok(
  generationRun.includes("nfCloudMode=e.aiSeqMode===`cloud`") &&
    generationRun.includes("if(e.aiSeqMode!==`local`&&!nfCloudMode)") &&
    generationRun.includes("nfCloudMode&&(u=NFAiSeqPatchCloudWorkflowV2"),
  "local models and Kling/Seedance cloud workflows must share the same downstream submit/result collector",
);
assert.equal(
  generationRun.split("let T=`novaflow_${crypto.randomUUID()}`").length - 1,
  1,
  "AI sequence local and cloud branches must converge before one common ComfyUI submission",
);
assert.ok(
  collector.includes("for(;;){if(t!==e.aiSeqRunTokenRef.current)return;"),
  "AI sequence result collection must wait for a terminal history state without a task deadline",
);
assert.ok(
  !collector.includes("Date.now()-j<18e4") && !collector.includes("等待生成超时"),
  "AI sequence result collection must not stop after the old 180-second business timeout",
);
assert.ok(
  collector.includes("nfHistoryRetryCount") &&
    collector.includes("网络中断，自动重试") &&
    collector.includes("网络已恢复，继续等待生成"),
  "transient history/network failures must remain running and retry instead of ending the task",
);
assert.ok(
  collector.includes("f.includes(`complete`)||f.includes(`success`)||f.includes(`error`)") &&
    collector.includes("已生成（共 ${u.length} 个输出）"),
  "the collector must still stop on explicit terminal success/error and publish completed outputs",
);

assert.ok(
  preload.includes("await commitRuntimeProviderUsage(runtimeHistoryPromptId(url), data);") &&
    runtimeProxy.includes("await commitProviderWorkflowUsage(promptId, data)"),
  "desktop and locked-4783 history reads must retain successful-output credit settlement",
);
assert.ok(
  index.includes("index-BbIa-2NM.js?v=20260710-seedance-ref34-1"),
  "the active source bundle cache key must publish the terminal-wait behavior",
);

console.log("AI sequence terminal wait contract passed");
