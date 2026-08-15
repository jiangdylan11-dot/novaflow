import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const frontend = read("particle-editor/novaflow-smart-ai.js");
const server = read("particle-editor-desktop/admin-server/server.js");
const index = read("particle-editor/index.html");

const includes = (text, value, label) => {
  assert.ok(text.includes(value), `${label}: missing ${value}`);
};

includes(
  frontend,
  "const supportsNegativePrompt = isPromptTextControl(textareas.negative);",
  "renderer detects the active page negative-prompt capability",
);
assert.ok(
  frontend.split("supportsNegativePrompt,").length - 1 >= 3,
  "renderer must send the capability through optimize/reverse requests and the write options",
);
includes(
  frontend,
  "if (options.supportsNegativePrompt && options.hasNegativePrompt)",
  "renderer writes a negative prompt only when the page supports it",
);

includes(server, "function smartAiSupportsNegativePrompt(payload)", "backend capability normalizer");
includes(
  server,
  "payload?.supportsNegativePrompt === false || payload?.supports_negative_prompt === false",
  "backend accepts camelCase and snake_case false capabilities",
);
includes(
  server,
  "function parseSmartAiPromptResult(text, options = {})",
  "backend result parser accepts output capability",
);
includes(server, 'negative_prompt: ""', "backend positive-only empty negative prompt");
includes(server, "has_negative_prompt: false", "backend positive-only response metadata");
includes(
  server,
  "function smartAiChinesePromptOutputRules(kind, options = {})",
  "backend prompt rules accept output capability",
);
includes(
  server,
  "当前页面没有负面提示词框，只返回正向提示词",
  "backend positive-only provider instruction",
);
includes(
  server,
  "supportsNegativePrompt",
  "backend request metadata retains page capability",
);

includes(
  index,
  "smart-ai-art-auto-intent.workflow.js?v=20260811-art-auto-intent-1",
  "active source entry publishes the Art auto-intent workflow",
);
includes(
  index,
  "novaflow-smart-ai.js?v=20260815-art-action-split-3",
  "active source entry publishes the capability-aware Smart AI module",
);

console.log("Smart AI optional negative-prompt capability contract passed");
