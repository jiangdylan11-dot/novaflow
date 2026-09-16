const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const repoRoot = path.resolve(__dirname, "..", "..");
const toolPath = path.join(repoRoot, "particle-editor", "spine-atlas-webp.tool.js");

test("SPINE WebP tool is loaded and packaged as a required runtime helper", () => {
  const html = fs.readFileSync(path.join(repoRoot, "particle-editor", "index.html"), "utf8");
  const buildScript = fs.readFileSync(path.join(repoRoot, "particle-editor-desktop", "scripts", "build-renderer.mjs"), "utf8");
  const syncScript = fs.readFileSync(path.join(repoRoot, "scripts", "sync-runtime.mjs"), "utf8");

  assert.match(html, /spine-atlas-webp\.tool\.js\?v=20260916-section-switch-1/);
  assert.equal((buildScript.match(/"spine-atlas-webp\.tool\.js"/g) || []).length, 2);
  assert.match(syncScript, /label: 'spine-atlas-webp\.tool\.js'/);
  assert.match(syncScript, /particle-editor-desktop', 'renderer', 'spine-atlas-webp\.tool\.js'/);
  assert.match(syncScript, /dist', 'win-unpacked', 'resources', 'app', 'renderer', 'spine-atlas-webp\.tool\.js'/);
});

test("SPINE WebP tool is scoped to the primary Tools section", () => {
  const source = fs.readFileSync(toolPath, "utf8");
  assert.match(source, /isToolsSectionActive/);
  assert.match(source, /png\.parentElement === jpg\.parentElement/);
  assert.match(source, /existing\?\.remove\(\)/);
  assert.match(source, /SPINE 图集转换/);
});

test("SPINE WebP tool accepts atlas and PNG files and calls the Electron converter", () => {
  const source = fs.readFileSync(toolPath, "utf8");
  const preload = fs.readFileSync(path.join(repoRoot, "particle-editor-desktop", "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(repoRoot, "particle-editor-desktop", "main.js"), "utf8");

  assert.match(source, /accept="\.atlas,image\/png,\.png"/);
  assert.match(source, /readAtlasFile/);
  assert.match(source, /readPngFile/);
  assert.match(source, /getPathForFile/);
  assert.match(source, /inputPath: getFilePath\(file\)/);
  assert.match(source, /convertSpineAtlasWebp/);
  assert.match(source, /atlases: state\.atlases\.map/);
  assert.match(source, /outputFormat: 'webp'/);
  assert.match(source, /sourceSize: file\.size \|\| bytes\.length/);
  assert.match(source, /outputFormat: item\.outputFormat \|\| 'webp'/);
  assert.match(source, /Atlas \$\{state\.atlases\.length\} 个/);
  assert.match(source, /preset: 'compact'/);
  assert.doesNotMatch(source, /Spine兼容|data-saw-mode|nf-saw-mode|state\.mode/);
  assert.doesNotMatch(source, /data-saw-strength|compressionStrength|state\.strength/);
  assert.match(source, /options: \{ preset: state\.preset \}/);
  assert.match(source, /id: 'clarity', label: '画质优先', quality: 95/);
  assert.match(source, /id: 'compact', label: '均衡', quality: 90/);
  assert.match(source, /id: 'small', label: '更小体积', quality: 70/);
  assert.match(source, /data-saw-preset="\$\{preset\.id\}"/);
  assert.match(source, /画质优先/);
  assert.match(source, /更小体积/);
  assert.match(source, /role="group" aria-label="压缩档位"/);
  assert.match(source, /aria-pressed="\$\{state\.preset === preset\.id\}"/);
  assert.match(source, /function setPreset\(preset\)/);
  assert.match(source, /setPreset\(button\.getAttribute\('data-saw-preset'\)\)/);
  assert.match(source, /原图 Alpha/);
  assert.doesNotMatch(source, /跟随 atlas/);
  assert.match(source, /output\.encoding === 'pma-compatible'/);
  assert.match(source, /已转换 Q\$\{output\.quality\}｜Alpha 已校验/);
  assert.match(source, /formatBytes/);
  assert.match(source, /formatSizeDelta/);
  assert.match(source, /原 \$\{formatBytes\(item\.sourceSize\)\} → 改 \$\{formatBytes\(outputSize\)\}/);
  assert.match(source, /selectedSourceMeta = selected \? formatBytes\(selected\.sourceSize\) : ''/);
  assert.match(source, /selectedResultMeta = selected\?\.result \? `\$\{formatBytes\(selectedResultSize\)\}/);
  assert.doesNotMatch(source, /selectedSourceMeta = selected \? `\$\{selected\.width\} × \$\{selected\.height\}/);
  assert.doesNotMatch(source, /\$\{item\.width\} × \$\{item\.height\}｜\$\{escapeHtml\(sizeText\)\}/);
  assert.match(preload, /convertSpineAtlasWebp: \(payload\) => ipcRenderer\.invoke\("convert-spine-atlas-webp", payload\)/);
  assert.match(main, /ipcMain\.handle\("convert-spine-atlas-webp"/);
});

test("SPINE WebP tool defaults each imported page to explicit PMA with a manual straight override", () => {
  const source = fs.readFileSync(toolPath, "utf8");
  assert.match(source, /outputFormat: 'webp', alphaMode: 'pma', result: null/);
  assert.match(source, /alphaMode: item\.alphaMode \|\| 'pma'/);
  assert.match(source, /alphaSelect\.value = selected\?\.alphaMode \|\| 'pma'/);
  assert.match(source, /<option value="pma">已预乘（PMA）<\/option><option value="straight">未预乘（Straight）<\/option>/);
  assert.match(source, /!\['straight', 'pma'\]\.includes\(alphaMode\)/);
  assert.match(source, /image\.alphaMode = alphaMode\s+revokeResults\(\)/);
  assert.doesNotMatch(source, /value="auto"|alphaMode[^\n]*'auto'/);
});

test("SPINE WebP tool exports to a folder or directly overwrites source files", () => {
  const source = fs.readFileSync(toolPath, "utf8");
  const preload = fs.readFileSync(path.join(repoRoot, "particle-editor-desktop", "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(repoRoot, "particle-editor-desktop", "main.js"), "utf8");

  assert.match(source, /saveSpineAtlasWebpOutput/);
  assert.match(source, /overwriteSpineAtlasWebpOutput/);
  assert.match(source, /pickDirectory/);
  assert.match(source, /writeBinaryFile/);
  assert.match(source, /if \(!saved\?\.ok\) throw new Error/);
  assert.match(source, /if \(!atlasWrite\?\.ok\) throw new Error/);
  assert.match(source, /if \(!imageWrite\?\.ok\) throw new Error/);
  assert.match(source, /导出到文件夹/);
  assert.match(source, /直接覆盖/);
  assert.match(source, /overwriteReady/);
  assert.match(source, /已覆盖｜原 PNG 已删除/);
  assert.match(source, /已导出 \$\{ready\.length\} 张图集/);
  assert.match(source, /overwriteAll/);
  assert.match(preload, /saveSpineAtlasWebpOutput: \(payload\) => ipcRenderer\.invoke\("save-spine-atlas-webp-output", payload\)/);
  assert.match(preload, /overwriteSpineAtlasWebpOutput: \(payload\) => ipcRenderer\.invoke\("overwrite-spine-atlas-webp-output", payload\)/);
  assert.match(main, /ipcMain\.handle\("save-spine-atlas-webp-output"/);
  assert.match(main, /ipcMain\.handle\("overwrite-spine-atlas-webp-output"/);
  assert.match(main, /writeSpineAtlasWebpOutput/);
  assert.match(main, /overwriteSpineAtlasWebpOutput/);
});

test("SPINE WebP workspace keeps the compression-tool pixel contract", () => {
  const source = fs.readFileSync(toolPath, "utf8");

  assert.match(source, /grid-template-columns:220px minmax\(0,1fr\)/);
  assert.match(source, /gap:12px;padding:14px 14px 14px 12px/);
  assert.match(source, /\.nf-saw-upload\{width:220px;height:44px/);
  assert.match(source, /\.nf-saw-preset\{display:grid;gap:6px;width:220px/);
  assert.match(source, /\.nf-saw-preset-options\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(source, /\.nf-saw-format\{width:62px;height:24px;display:grid;grid-template-columns:1fr 1fr/);
  assert.match(source, /\.nf-saw-actions\{display:grid;grid-template-columns:220px/);
  assert.match(source, /right:26px;top:14px/);
  assert.match(source, /width:102px;height:36px/);
  assert.match(source, /width:calc\(100% \+ 14px\);height:100%/);
  assert.match(source, /margin-top:-14px;margin-right:-14px/);
  assert.match(source, /padding:12px 12px 16px;background:#090a0a/);
  assert.match(source, /min-height:52px;height:52px;max-height:52px/);
  assert.match(source, /width:40px;height:40px/);
  assert.match(source, /\.nf-saw-preview\{[^}]*background:transparent/);
});

test("SPINE WebP controls keep the native compression interaction and typography contract", () => {
  const source = fs.readFileSync(toolPath, "utf8");
  const topActionsRule = source.match(/#\$\{ROOT_ID\} \.nf-saw-top-actions button\{[^}]*\}/)?.[0] || "";

  assert.match(source, /#\$\{ROOT_ID\} :where\(\.nf-saw-upload,\.nf-saw-btn,\.nf-saw-preset button,\.nf-saw-format button,\.nf-saw-top-actions button\)\{/);
  assert.match(source, /\.nf-saw-preset button\{height:34px;[^}]*font-size:12px!important/);
  assert.match(source, /@container \(max-width:980px\)\{#\$\{ROOT_ID\} \.nf-saw-main\{padding-top:56px\}\}/);
  assert.match(source, /\.nf-saw-format button\{[^}]*font-size:10px!important/);
  assert.match(source, /background:rgba\(255,255,255,\.045\);opacity:0;pointer-events:none/);
  assert.match(source, /:hover\{filter:brightness\(1\.08\);border-color:rgba\(255,255,255,\.20\)!important\}/);
  assert.match(source, /:hover::after\{opacity:1\}/);
  assert.match(source, /:active\{filter:brightness\(1\.02\)\}/);
  assert.match(source, /:focus-visible\{outline:2px solid rgba\(255,255,255,\.22\);outline-offset:2px\}/);
  assert.match(source, /:is\(:disabled,\[disabled\],\[aria-disabled="true"\]\)\{opacity:\.45;cursor:default;filter:none\}/);
  assert.match(topActionsRule, /width:102px;height:36px/);
  assert.match(topActionsRule, /background:linear-gradient\(135deg,rgba\(30,166,114,\.96\),rgba\(30,166,114,\.92\)\)/);
  assert.match(source, /#\$\{ROOT_ID\} \.nf-saw-top-actions button:last-child\{background:#b98218;color:#fff2c0;border-color:rgba\(255,211,105,\.32\)\}/);
  assert.match(topActionsRule, /font-size:12px!important/);
  assert.match(source, /\.nf-saw-panel-head\{[^}]*justify-content:flex-start/);
  assert.match(source, /\.nf-saw-panel-head\{[^}]*gap:8px/);
  assert.match(source, /\.nf-saw-panel-head\{[^}]*font-size:14px/);
  assert.match(source, /\.nf-saw-panel-head small\{[^}]*font-size:11px/);
});
