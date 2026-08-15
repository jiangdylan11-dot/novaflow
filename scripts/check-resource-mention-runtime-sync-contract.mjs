#!/usr/bin/env node
import { readFileSync } from "node:fs";

const sync = readFileSync("scripts/sync-runtime.mjs", "utf8");
const check = readFileSync("scripts/check-runtime-sync.mjs", "utf8");
const files = [
  "ai-sequence-input-compat.tool.js",
  "resource-mention.tool.js",
  "resource-mention.tool.css"
];

for (const file of files) {
  if (!sync.includes(`label: '${file}'`) || !sync.includes(`'${file}'`)) {
    throw new Error(`sync-runtime entry missing: ${file}`);
  }
  if (!check.includes(`name: '${file}'`) || !check.includes(`'${file}'`)) {
    throw new Error(`check-runtime-sync group missing: ${file}`);
  }
}

console.log("PASS resource mention Runtime sync contract");
