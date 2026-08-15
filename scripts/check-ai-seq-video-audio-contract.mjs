import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

const runtime = read("particle-editor/novaflow-brand-runtime.js");
const indexHtml = read("particle-editor/index.html");
const bundleMatch = indexHtml.match(/src="\.\/(assets\/index-[^"]+\.js)(?:\?[^"]*)?"/);
assert(bundleMatch, "active particle-editor bundle must be referenced from index.html");

const bundlePath = bundleMatch[1];
const bundle = read(path.join("particle-editor", bundlePath));

assert(
  bundle.includes("D?.objectUrl?") && bundle.includes("muted:!0") && bundle.includes("onTimeUpdate"),
  "AI sequence main video preview should still be detected in the active bundle"
);

assert(
  runtime.includes("function bindAiSequenceMainVideoAudioUnlock("),
  "runtime must bind an AI sequence main video audio unlock compatibility layer"
);
assert(
  runtime.includes("function unlockAiSequenceMainVideoAudio("),
  "runtime must expose a focused main-video audio unlock helper"
);
assert(
  runtime.includes("video.muted = false"),
  "main preview video must be unmuted by the compatibility layer"
);
assert(
  runtime.includes("closest('[data-novaflow-ai-resource-card=\"1\"]')"),
  "resource-card preview videos must stay excluded from automatic audio unlock"
);

console.log("PASS AI sequence video audio contract");
