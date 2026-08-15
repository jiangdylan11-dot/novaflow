#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const runtime = readFileSync("particle-editor/novaflow-brand-runtime.js", "utf8");
const smartAi = readFileSync("particle-editor/novaflow-smart-ai.js", "utf8");
const indexHtml = readFileSync("particle-editor/index.html", "utf8");
const toolPath = "particle-editor/resource-mention.tool.js";
if (!existsSync(toolPath)) throw new Error("resource mention tool is missing");
const tool = readFileSync(toolPath, "utf8");
const mentionCss = readFileSync("particle-editor/resource-mention.tool.css", "utf8");

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

assertIncludes(indexHtml, "resource-mention.tool.css", "resource mention stylesheet entry");
assertIncludes(indexHtml, "resource-mention.tool.js", "resource mention script entry");
assertIncludes(tool, "window.NovaFlowResourceMentionTool", "global mention tool export");

const artGenerateBackingRule = Array.from(mentionCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)).find(
  ([, selectors]) => selectors.split(",").some((selector) =>
    selector.includes("#novaflow-art-generate-workspace.novaflow-app") &&
    selector.includes(".novaflow-art-generate-prompt") &&
    selector.includes("textarea.nf-resource-mention-backing")
  )
);
if (!artGenerateBackingRule) {
  throw new Error("Art Generate scoped mention backing visibility rule is missing");
}
const artGenerateBackingDeclarations = artGenerateBackingRule[2];
[
  [/(?:^|;)\s*color\s*:\s*transparent\s*!important\s*(?:;|$)/i, "color: transparent !important"],
  [/(?:^|;)\s*caret-color\s*:\s*transparent\s*!important\s*(?:;|$)/i, "caret-color: transparent !important"],
  [/(?:^|;)\s*pointer-events\s*:\s*none\s*!important\s*(?:;|$)/i, "pointer-events: none !important"]
].forEach(([pattern, declaration]) => {
  if (!pattern.test(artGenerateBackingDeclarations)) {
    throw new Error(`Art Generate mention backing visibility missing: ${declaration}`);
  }
});
if (/display\s*:\s*none/i.test(artGenerateBackingDeclarations)) {
  throw new Error("Art Generate mention backing must remain measurable: display:none is forbidden");
}
if (/visibility\s*:\s*hidden/i.test(artGenerateBackingDeclarations)) {
  throw new Error("Art Generate mention backing must remain measurable: visibility:hidden is forbidden");
}

assertIncludes(
  runtime,
  "function artGenerateResourceMentionSnapshot(",
  "Art Generate three-slot resource snapshot"
);
assertIncludes(
  runtime,
  "function mountArtGenerateResourceMentionTextarea(",
  "Art Generate prompt mount bridge"
);
assertIncludes(
  runtime,
  "function compileArtGeneratePromptMentions(",
  "Art Generate prompt compiler bridge"
);
assertIncludes(
  runtime,
  "const compiledPrompt = compileArtGeneratePromptMentions(refs, promptWithReferenceRoles);",
  "Art Generate compile-before-workflow call"
);
assertIncludes(
  runtime,
  "buildArtGenerateRunWorkflow(runProvider, runMode, uploadedNames, prefix, compiledPrompt.text, qualityCompiled.negativePrompt, clientId, referenceSizes)",
  "compiled prompt workflow builder injection"
);
assertIncludes(
  runtime,
  'localWorkflow = patchArtWorkflow(cloneArtWorkflow(), uploadedNames, outputPrefix, positivePrompt, negativePrompt, referenceSizes);',
  "compiled prompt local workflow injection"
);
assertIncludes(
  runtime,
  "mountArtGenerateResourceMentionTextarea(textarea);",
  "Art Generate Runtime-created textarea mount"
);
assertIncludes(
  smartAi,
  "protectSmartAiResourceMentions(",
  "Smart AI mention protection bridge"
);
assertIncludes(
  smartAi,
  "restoreSmartAiResourceMentions(",
  "Smart AI mention restore validation"
);
assertIncludes(
  smartAi,
  "function preserveSmartAiReverseResourceMentions(",
  "Smart AI reverse alias preservation"
);
assertIncludes(
  smartAi,
  "nextPrompt = preserveSmartAiReverseResourceMentions(prompt, nextPrompt);",
  "Smart AI reverse alias merge call"
);

const protectionStart = smartAi.indexOf("  function smartAiResourceMentionError(");
const protectionEnd = smartAi.indexOf("  function hasOwnValue(", protectionStart);
if (protectionStart < 0 || protectionEnd <= protectionStart) throw new Error("Smart AI protection source range is missing");
const window = {};
const context = vm.createContext({ window, console, setTimeout, clearTimeout });
vm.runInContext(tool, context, { filename: toolPath });
vm.runInContext(
  `${smartAi.slice(protectionStart, protectionEnd)}\nthis.protectForTest = protectSmartAiResourceMentions; this.restoreForTest = restoreSmartAiResourceMentions; this.preserveReverseForTest = preserveSmartAiReverseResourceMentions;`,
  context
);
const protectedMention = context.protectForTest("保留@参考图2的服装");
const restoredMention = context.restoreForTest(protectedMention.text, protectedMention);
if (!restoredMention.ok || restoredMention.text !== "保留@参考图2的服装") throw new Error("Smart AI mention restore failed");
const missingMention = context.restoreForTest("资源引用已被删除", protectedMention);
if (missingMention.ok) throw new Error("Smart AI accepted a missing protected mention");
const duplicatedMention = context.restoreForTest(
  `${protectedMention.text} ${protectedMention.text}`,
  protectedMention
);
if (duplicatedMention.ok) throw new Error("Smart AI accepted a duplicated protected mention");
const preservedReverse = context.preserveReverseForTest(
  "让@参考图2参考@参考图3",
  "角色转身并抬手"
);
if (preservedReverse !== "@参考图2 @参考图3\n角色转身并抬手") {
  throw new Error(`Smart AI reverse alias preservation mismatch: ${preservedReverse}`);
}
const existingReverse = context.preserveReverseForTest("使用@参考图2", "@参考图2中的角色转身");
if (existingReverse !== "@参考图2中的角色转身") throw new Error("Smart AI duplicated an existing reverse alias");

console.log("PASS Art Generate resource mention contract");
