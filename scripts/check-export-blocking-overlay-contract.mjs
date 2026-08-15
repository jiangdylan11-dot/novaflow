import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const bundlePaths = [
  "particle-editor/assets/index-BbIa-2NM.js",
  "particle-editor-desktop/renderer/assets/index-BbIa-2NM.js",
  "particle-editor-desktop/dist/win-unpacked/resources/app/renderer/assets/index-BbIa-2NM.js",
];
const runtimePaths = [
  "particle-editor/novaflow-brand-runtime.js",
  "particle-editor-desktop/renderer/novaflow-brand-runtime.js",
  "particle-editor-desktop/dist/win-unpacked/resources/app/renderer/novaflow-brand-runtime.js",
];
const bundles = bundlePaths.map((filePath) => ({
  filePath,
  text: fs.readFileSync(path.join(root, filePath), "utf8"),
}));
const runtimes = runtimePaths.map((filePath) => ({
  filePath,
  text: fs.readFileSync(path.join(root, filePath), "utf8"),
}));

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function extractExportBlockingSource(text, filePath) {
  const start = text.indexOf("var bi=({exportBlocking:e})=>e?");
  const end = text.indexOf(",xi=({open:e", start);
  assert.ok(start >= 0 && end > start, `${filePath}: exportBlocking component must exist`);
  return text.slice(start, end);
}

function extractFullscreenModalClassifier(text, filePath) {
  const start = text.indexOf("function isFullscreenModalBackdrop(element)");
  const end = text.indexOf("function getNovaflowFullscreenDialogCard(element)", start);
  assert.ok(start >= 0 && end > start, `${filePath}: fullscreen modal classifier must exist`);
  return text.slice(start, end);
}

for (const { filePath, text } of runtimes) {
  const source = extractFullscreenModalClassifier(text, filePath);
  assert.ok(
    source.includes('if (element.getAttribute("data-novaflow-export-blocking") === "1") return false;'),
    `${filePath}: Runtime modal scanner must exclude the export-blocking overlay`,
  );
  class ExportBlockingElement {
    getAttribute(name) {
      return name === "data-novaflow-export-blocking" ? "1" : null;
    }
  }
  let downstreamScannerCalled = false;
  const classifier = new Function(
    "HTMLElement",
    "isDropdownControllerNode",
    "window",
    "document",
    `${source}\nreturn isFullscreenModalBackdrop;`,
  )(
    ExportBlockingElement,
    () => {
      downstreamScannerCalled = true;
      return false;
    },
    {
      getComputedStyle() {
        downstreamScannerCalled = true;
        throw new Error("export-blocking marker must short-circuit before computed style");
      },
    },
    {},
  );
  assert.equal(classifier(new ExportBlockingElement()), false, `${filePath}: exportBlocking must not be a modal backdrop`);
  assert.equal(downstreamScannerCalled, false, `${filePath}: Runtime modal scanner must short-circuit on the marker`);
}

for (const { filePath, text } of bundles) {
  const source = extractExportBlockingSource(text, filePath);
  assert.match(
    source,
    /=>e\?\(0,X\.jsx\)\(`div`,\{"data-novaflow-export-blocking":`1`,"data-novaflow-runtime-ignore":`1`,style:\{position:`fixed`,inset:0,zIndex:2147483646,[\s\S]*?pointerEvents:`auto`\}/,
    `${filePath}: exportBlocking root contract drift`,
  );
  assert.ok(
    source.includes('"data-novaflow-export-blocking":`1`'),
    `${filePath}: exportBlocking must expose a stable DOM marker`,
  );
  assert.ok(
    source.includes('"data-novaflow-runtime-ignore":`1`'),
    `${filePath}: exportBlocking must opt out of Runtime modal mutation handling`,
  );
  assert.ok(source.includes("pointerEvents:`auto`"), `${filePath}: exportBlocking must block pointer interaction`);
  const match = source.match(/zIndex:(\d+)/);
  assert.ok(match, `${filePath}: exportBlocking z-index must exist`);
  const zIndex = Number(match[1]);
  assert.ok(zIndex > 2147483644, `${filePath}: exportBlocking must cover export modal notices`);
  assert.ok(zIndex < 2147483647, `${filePath}: exportBlocking must remain below the boot splash`);
}

const expectedHash = sha256(bundles[0].text);
for (const { filePath, text } of bundles.slice(1)) {
  assert.equal(sha256(text), expectedHash, `${filePath}: bundle mirror drift`);
}

const expectedRuntimeHash = sha256(runtimes[0].text);
for (const { filePath, text } of runtimes.slice(1)) {
  assert.equal(sha256(text), expectedRuntimeHash, `${filePath}: Runtime mirror drift`);
}

console.log("export blocking overlay contract passed");
