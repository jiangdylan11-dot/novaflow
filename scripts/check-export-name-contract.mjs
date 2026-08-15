import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function extractBetween(text, startToken, endToken, filePath, label) {
  const start = text.indexOf(startToken);
  const end = text.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0 && end > start, `${filePath}: ${label} source must exist`);
  return text.slice(start, end);
}

function countOccurrences(text, token) {
  return text.split(token).length - 1;
}

const indexHtml = read("particle-editor/index.html");
const bundleMatch = indexHtml.match(/src="\.\/(assets\/index-[^"]+\.js)(?:\?[^\"]*)?"/);
assert.ok(bundleMatch, "particle-editor/index.html: active renderer bundle must be referenced");

const activeBundlePath = bundleMatch[1];
const bundleFileName = path.basename(activeBundlePath);
const bundlePaths = [
  `particle-editor/${activeBundlePath}`,
  `particle-editor-desktop/renderer/assets/${bundleFileName}`,
  `particle-editor-desktop/dist/win-unpacked/resources/app/renderer/assets/${bundleFileName}`,
];
const brandRuntimePaths = [
  "particle-editor/novaflow-brand-runtime.js",
  "particle-editor-desktop/renderer/novaflow-brand-runtime.js",
  "particle-editor-desktop/dist/win-unpacked/resources/app/renderer/novaflow-brand-runtime.js",
];
const aifxRuntimePaths = [
  "particle-editor/aifx-repaint-runtime.js",
  "particle-editor-desktop/renderer/aifx-repaint-runtime.js",
  "particle-editor-desktop/dist/win-unpacked/resources/app/renderer/aifx-repaint-runtime.js",
];

const bundles = bundlePaths.map((filePath) => ({ filePath, text: read(filePath) }));
const brandRuntimes = brandRuntimePaths.map((filePath) => ({ filePath, text: read(filePath) }));
const aifxRuntimes = aifxRuntimePaths.map((filePath) => ({ filePath, text: read(filePath) }));

for (const { filePath, text } of bundles) {
  const exportDialog = extractBetween(text, "function Ei(e){let{exportTab:t", "function Di(e)", filePath, "shared export dialog");
  const exportBaseNameIndex = exportDialog.indexOf("nfExportBaseName=");
  assert.ok(exportBaseNameIndex >= 0, `${filePath}: shared export dialog must define nfExportBaseName`);
  const exportBaseNameSource = exportDialog.slice(exportBaseNameIndex, exportBaseNameIndex + 520);
  assert.ok(exportBaseNameSource.includes(".trim()"), `${filePath}: nfExportBaseName must trim the entered export name`);
  assert.ok(exportBaseNameSource.includes(".replace("), `${filePath}: nfExportBaseName must sanitize invalid filename characters`);
  assert.ok(
    exportBaseNameSource.includes(".replace(/\\.[a-z0-9]{1,8}$/i,``)"),
    `${filePath}: nfExportBaseName must strip an entered file extension before appending output extensions`,
  );
  assert.ok(exportBaseNameSource.includes(".slice(0,"), `${filePath}: nfExportBaseName must keep the existing bounded filename contract`);

  const aiSequenceBranch = extractBetween(exportDialog, "I===`ai`", "t===`spine`", filePath, "AI sequence export branch");
  assert.ok(
    aiSequenceBranch.includes("await e({baseName:nfExportBaseName})"),
    `${filePath}: AI sequence export button must pass the sanitized nfExportBaseName to the exporter`,
  );
  assert.ok(
    !aiSequenceBranch.includes("await e(),n(null)"),
    `${filePath}: AI sequence export button must not call the exporter without a baseName`,
  );

  const aiExporter = extractBetween(text, "let ni=async n=>", ",ri=async()=>", filePath, "AI sequence frame exporter");
  const aiExporterBaseNameIndex = aiExporter.indexOf("nfExportBaseName=");
  assert.ok(aiExporterBaseNameIndex >= 0, `${filePath}: AI sequence exporter must define nfExportBaseName`);
  const aiExporterBaseNameSource = aiExporter.slice(aiExporterBaseNameIndex, aiExporterBaseNameIndex + 520);
  assert.ok(aiExporterBaseNameSource.includes("n?.baseName"), `${filePath}: AI exporter nfExportBaseName must consume options.baseName`);
  assert.ok(aiExporterBaseNameSource.includes("`NF`"), `${filePath}: AI exporter must retain NF only as its compatibility fallback`);
  assert.ok(aiExporterBaseNameSource.includes(".trim()"), `${filePath}: AI exporter baseName must be trimmed`);
  assert.ok(aiExporterBaseNameSource.includes(".replace("), `${filePath}: AI exporter baseName must be filename-safe`);
  assert.ok(
    aiExporterBaseNameSource.includes(".replace(/\\.[a-z0-9]{1,8}$/i,``)"),
    `${filePath}: AI exporter baseName must strip an entered file extension`,
  );
  assert.ok(
    aiExporter.includes("`${nfExportBaseName}_${e+1}`"),
    `${filePath}: multi-board AI sequence prefixes must derive from nfExportBaseName`,
  );
  assert.ok(
    aiExporter.includes(",nfExportBaseName,`compose_image`") && aiExporter.includes(",nfExportBaseName,e.inputSourceKind"),
    `${filePath}: single-board image and video prefixes must derive from nfExportBaseName`,
  );
  assert.ok(
    aiExporter.includes("u=[],d=nfExportBaseName;"),
    `${filePath}: AI sequence Spine atlas/json must use the exact entered base name`,
  );
  assert.ok(
    aiExporter.includes("pattern:`${nfExportBaseName}_%04d.png`"),
    `${filePath}: AI sequence exporter must return the nfExportBaseName frame pattern`,
  );
  assert.ok(!aiExporter.includes("`NF_${e+1}`"), `${filePath}: multi-board user output must not retain the NF_n prefix`);
  assert.ok(!aiExporter.includes("`NF_bg`"), `${filePath}: user-visible Spine output must not retain NF_bg`);
  assert.ok(!aiExporter.includes("`${nfExportBaseName}_bg`"), `${filePath}: user-visible Spine output must not add a generated bg suffix`);
  assert.ok(!aiExporter.includes("pattern:`NF_%04d.png`"), `${filePath}: user-visible AI sequence pattern must not retain NF_%04d`);

  const videoAnchor = text.indexOf("let n=`video_${");
  assert.ok(videoAnchor >= 0, `${filePath}: video export source must exist`);
  const videoStart = text.lastIndexOf(",Ue=async()=>", videoAnchor);
  const videoEnd = text.indexOf(",We=async()=>", videoAnchor);
  assert.ok(videoStart >= 0 && videoEnd > videoStart, `${filePath}: video export function must be extractable`);
  const videoExporter = text.slice(videoStart, videoEnd);
  assert.ok(
    videoExporter.includes("pattern:`NF_%04d.png`"),
    `${filePath}: AI video encoding must retain the internal NF_%04d temp-frame pattern`,
  );
  assert.ok(
    videoExporter.includes("`NF_${String(i).padStart(4,`0`)}.png`"),
    `${filePath}: AI video fallback must retain matching internal NF_#### temp-frame files`,
  );
  assert.ok(
    videoExporter.includes("exportPickSaveFile({baseName:n,format:G})"),
    `${filePath}: final video filename must remain an explicit save-file baseName`,
  );

  const particleSequence = extractBetween(text, "Ms=async({activeConfig:e", ",Ns=async({activeConfig:e", filePath, "particle sequence exporter");
  assert.ok(
    particleSequence.includes("A=`frames_${u(await Ds())}`"),
    `${filePath}: particle sequence export must retain its explicit generated base-name input`,
  );
  assert.ok(
    particleSequence.includes("n=`${A}_${j(e)}.png`"),
    `${filePath}: particle sequence frames must retain the baseName_#### contract`,
  );
  assert.ok(
    particleSequence.includes("await M(`${A}.atlas`,s)") && particleSequence.includes("await M(`${A}.json`,d)"),
    `${filePath}: particle Spine sidecars must retain the same explicit sequence base name`,
  );
}

for (const { filePath, text } of brandRuntimes) {
  assert.ok(
    text.includes('const prefix = sanitizeNovaflowManualExportName(state.name, "skeleton");'),
    `${filePath}: skeleton sequence export must sanitize the entered manual name`,
  );
  assert.ok(
    text.includes('`${prefix}_${String(index).padStart(4, "0")}.png`'),
    `${filePath}: skeleton sequence frames must retain the manualName_#### contract`,
  );
  assert.ok(
    text.includes('`${prefix}_%04d.png`'),
    `${filePath}: skeleton sequence pattern must retain the same manual-name prefix`,
  );
  assert.ok(
    text.includes("api.exportPickSaveFile({ baseName: state.name, format })"),
    `${filePath}: skeleton video must pass the entered name to the final save-file picker`,
  );
  assert.ok(
    text.includes("const finalName = sanitizeNovaflowManualExportName(manualName || getNovaflowManualExportState()?.name || \"\", \"\");") &&
      text.includes("if (finalName) payload.baseName = finalName;") &&
      text.includes("applySkeletonSpineExportAssetNames(payload);"),
    `${filePath}: skeleton Spine files and atlas references must retain the explicit manual-name contract`,
  );
  assert.ok(
    text.includes('if (mode === "seq") return lowerExt === ".png"') &&
      text.includes("return `${name}_${String(ordinal).padStart(width, \"0\")}${ext}`;"),
    `${filePath}: shared particle/sequence binary writes must retain manual-name ordinals`,
  );
}

for (const { filePath, text } of aifxRuntimes) {
  assert.ok(
    countOccurrences(text, "const exportName = sanitizeAifxExportName(options.name, '')") >= 2,
    `${filePath}: AIFX final and Spine exports must both sanitize the explicit export name`,
  );
  assert.ok(
    text.includes("const base = exportName || 'aifx_conditioned_regen'"),
    `${filePath}: AIFX Spine sidecars must derive from the explicit export name`,
  );
  assert.ok(
    text.includes("fileName: `${base}.png`") &&
      text.includes("writeTextAsBinary(assetDir, `${base}.atlas`, atlas)") &&
      text.includes("writeTextAsBinary(assetDir, `${base}.json`, JSON.stringify(json, null, 2))"),
    `${filePath}: AIFX Spine PNG/atlas/json must retain one explicit shared base name`,
  );
  assert.ok(
    text.includes("const canonicalAifxFrameName = (index) => `frame_${pad(Math.max(0, Math.round(Number(index) || 0)), 3)}.png`"),
    `${filePath}: AIFX canonical frame_### package naming must not drift`,
  );
}

for (const group of [bundles, brandRuntimes, aifxRuntimes]) {
  const expectedHash = sha256(group[0].text);
  for (const { filePath, text } of group.slice(1)) {
    assert.equal(sha256(text), expectedHash, `${filePath}: shipped export-name implementation mirror drift`);
  }
}

console.log("PASS shared export name contract");
