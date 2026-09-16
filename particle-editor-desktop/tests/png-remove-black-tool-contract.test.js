const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')

const repoRoot = path.resolve(__dirname, '..', '..')
const toolPath = path.join(repoRoot, 'particle-editor', 'png-remove-black.tool.js')

test('PNG remove-black tool reuses the shared background-removal API', () => {
  const source = fs.readFileSync(toolPath, 'utf8')
  const backgroundRemoval = fs.readFileSync(path.join(repoRoot, 'particle-editor', 'ai-background-removal-runtime.js'), 'utf8')
  assert.match(source, /NovaFlowBackgroundRemoval/)
  assert.match(source, /unmultBlackBackgroundDataUrl/)
  assert.match(backgroundRemoval, /async function unmultBlackBackgroundDataUrl/)
  assert.doesNotMatch(source, /function\s+removeBlackBackgroundFromImageData/)
  assert.doesNotMatch(source, /去黑强度|data-prb-strength|optionsFromStrength/)
})

test('PNG remove-black entry is scoped to the primary Tools section', () => {
  const source = fs.readFileSync(toolPath, 'utf8')
  assert.match(source, /isToolsSectionActive/)
  assert.match(source, /png\.parentElement === jpg\.parentElement/)
  assert.match(source, /existing\?\.remove\(\)/)
})

for (const [fileName, ownKey, otherKey] of [
  ['png-remove-black.tool.js', 'png_remove_black', 'spine_atlas_webp'],
  ['spine-atlas-webp.tool.js', 'spine_atlas_webp', 'png_remove_black'],
]) {
  test(`${fileName} deactivates on peer entry clicks before target activation`, () => {
    const source = fs.readFileSync(path.join(repoRoot, 'particle-editor', fileName), 'utf8')
    assert.match(source, /document\.addEventListener\('click', handleToolEntryClick, true\)/)
    const handler = source.match(/  function handleToolEntryClick\(event\) \{[\s\S]*?\n  \}/)?.[0]
    assert.ok(handler)
    let deactivations = 0
    class Element {
      constructor(entry) { this.entry = entry }
      closest(selector) { assert.equal(selector, '[data-novaflow-tools-entry]'); return this.entry }
    }
    const click = vm.runInNewContext(`(${handler})`, { Element, TOOL_ID: ownKey, deactivate: () => deactivations++ })
    const target = key => new Element({ getAttribute: name => { assert.equal(name, 'data-novaflow-tools-entry'); return key } })
    click({ target: target(ownKey) })
    click({ target: new Element(null) })
    click({ target: null })
    assert.equal(deactivations, 0)
    // Delegation handles entry descendants and buttons created after activation.
    for (const key of [otherKey, 'png_compress', 'jpg_compress', otherKey]) click({ target: target(key) })
    assert.equal(deactivations, 4)
  })
}

test('PNG remove-black drop handlers bind once per root lifecycle', () => {
  const source = fs.readFileSync(toolPath, 'utf8')
  const renderStart = source.indexOf('  function render() {')
  const renderEnd = source.indexOf('\n  installStyle()', renderStart)
  const renderSource = source.slice(renderStart, renderEnd)
  const rootCreationSource = renderSource.match(/    if \(!root\) \{[\s\S]*?\n    \}\n    const selected/)?.[0] || ''

  assert.ok(renderStart >= 0 && renderEnd > renderStart)
  assert.equal((renderSource.match(/root\.addEventListener\('dragover'/g) || []).length, 1)
  assert.equal((renderSource.match(/root\.addEventListener\('drop'/g) || []).length, 1)
  assert.match(rootCreationSource, /root\.addEventListener\('dragover', handleRootDragOver\)/)
  assert.match(rootCreationSource, /root\.addEventListener\('drop', handleRootDrop\)/)
  assert.match(rootCreationSource, /document\.body\.appendChild\(root\)/)
  assert.match(source, /function handleRootDrop\(event\) \{[\s\S]*event\.preventDefault\(\)[\s\S]*addFiles\(event\.dataTransfer\?\.files\)[\s\S]*\}/)
})

test('PNG remove-black workspace keeps the compression-tool pixel contract', () => {
  const source = fs.readFileSync(toolPath, 'utf8')
  assert.match(source, /grid-template-columns:220px minmax\(0,1fr\)/)
  assert.match(source, /gap:12px;padding:14px 14px 14px 12px/)
  assert.match(source, /\.nf-prb-upload\{width:220px;height:44px/)
  assert.match(source, /\.nf-prb-actions\{display:grid;grid-template-columns:220px/)
  assert.match(source, /right:26px;top:14px/)
  assert.match(source, /width:102px;height:36px/)
  assert.match(source, /width:calc\(100% \+ 14px\);height:100%/)
  assert.match(source, /margin-top:-14px;margin-right:-14px/)
  assert.match(source, /padding:12px 12px 16px;background:#090a0a/)
  assert.doesNotMatch(source, /height:636px/)
  assert.match(source, /min-height:52px;height:52px;max-height:52px/)
  assert.match(source, /width:40px;height:40px/)
  assert.match(source, /\.nf-prb-preview\{[^}]*background:transparent/)
  assert.doesNotMatch(source, /background-image:linear-gradient\(45deg/)
  assert.match(source, /rgba\(30,166,114,\.12\)/)
})

test('PNG remove-black controls keep the native compression interaction and typography contract', () => {
  const source = fs.readFileSync(toolPath, 'utf8')
  const topActionsRule = source.match(/#\$\{ROOT_ID\} \.nf-prb-top-actions button\{[^}]*\}/)?.[0] || ''

  assert.match(source, /#\$\{ROOT_ID\} :where\(\.nf-prb-upload,\.nf-prb-btn,\.nf-prb-top-actions button\)\{[^}]*font-size:12px!important/)
  assert.match(source, /#\$\{ROOT_ID\} :where\(\.nf-prb-upload,\.nf-prb-btn,\.nf-prb-top-actions button\)\{[^}]*cursor:pointer/)
  assert.match(source, /background:rgba\(255,255,255,\.045\);opacity:0;pointer-events:none/)
  assert.match(source, /:hover\{filter:brightness\(1\.08\);border-color:rgba\(255,255,255,\.20\)!important\}/)
  assert.match(source, /:hover::after\{opacity:1\}/)
  assert.match(source, /:active\{filter:brightness\(1\.02\)\}/)
  assert.match(source, /:focus-visible\{outline:2px solid rgba\(255,255,255,\.22\);outline-offset:2px\}/)
  assert.match(source, /:is\(:disabled,\[disabled\],\[aria-disabled="true"\]\)\{opacity:\.45;cursor:default;filter:none\}/)

  assert.match(topActionsRule, /width:102px;height:36px/)
  assert.match(topActionsRule, /background:linear-gradient\(135deg,rgba\(30,166,114,\.96\),rgba\(30,166,114,\.92\)\)/)
  assert.match(topActionsRule, /color:#effcf5/)
  assert.match(topActionsRule, /font-size:12px!important/)
  assert.match(source, /#\$\{ROOT_ID\} \.nf-prb-top-actions button:last-child\{background:#b98218;color:#fff2c0;border-color:rgba\(255,211,105,\.32\)\}/)
  assert.match(source, /\.nf-prb-panel-head\{[^}]*font-size:14px/)
  assert.match(source, /\.nf-prb-panel-head small\{[^}]*font-size:11px/)
})

test('native PNG and JPG workspaces inherit the PNG remove-black control-surface background', () => {
  const brandRuntime = fs.readFileSync(path.join(repoRoot, 'particle-editor', 'novaflow-brand-runtime.js'), 'utf8')
  const source = fs.readFileSync(toolPath, 'utf8')

  assert.match(brandRuntime, /const NOVAFLOW_TOOLS_WORKSPACE_BACKGROUND = "#151515";/)

  const workspaceCss = brandRuntime.match(/body\.novaflow-primary-target-tools \[data-novaflow-tools-workspace="1"\] \{[\s\S]*?\n\s*\}/)?.[0] || ''
  assert.match(workspaceCss, /background: \$\{NOVAFLOW_TOOLS_WORKSPACE_BACKGROUND\} !important;/)
  assert.match(workspaceCss, /background-color: \$\{NOVAFLOW_TOOLS_WORKSPACE_BACKGROUND\} !important;/)

  assert.match(brandRuntime, /workspace\.style\.setProperty\("background", NOVAFLOW_TOOLS_WORKSPACE_BACKGROUND, "important"\);/)
  assert.match(brandRuntime, /workspace\.style\.setProperty\("background-color", NOVAFLOW_TOOLS_WORKSPACE_BACKGROUND, "important"\);/)

  const dragChromeGuard = brandRuntime.match(/function applyNovaflowToolsTransparentDragChrome\(node\) \{[\s\S]*?\n  \}/)?.[0] || ''
  assert.match(dragChromeGuard, /node\.getAttribute\("data-novaflow-tools-workspace"\) === "1"/)
  assert.match(dragChromeGuard, /\? NOVAFLOW_TOOLS_WORKSPACE_BACKGROUND\s*:\s*"transparent";/)

  const leftPanelCss = brandRuntime.match(/body\.novaflow-primary-target-tools \[data-novaflow-tools-left-panel="1"\] \{[\s\S]*?\n\s*\}/)?.[0] || ''
  assert.match(leftPanelCss, /background: transparent !important;/)
  assert.match(leftPanelCss, /background-color: transparent !important;/)
  assert.match(brandRuntime, /leftPanel\.style\.setProperty\("background", "transparent", "important"\);/)
  assert.match(brandRuntime, /leftPanel\.style\.setProperty\("background-color", "transparent", "important"\);/)

  const previewGridCss = brandRuntime.match(/body\.novaflow-primary-target-tools \[data-novaflow-tools-preview-grid="1"\] \{[\s\S]*?\n\s*\}/)?.[0] || ''
  assert.match(previewGridCss, /background: #090a0a !important;/)
  assert.match(previewGridCss, /background-color: #090a0a !important;/)
  assert.match(source, /#\$\{ROOT_ID\}\{[^}]*background:#151515/)
})

test('PNG remove-black list supports single-item deletion without leaking previews', () => {
  const source = fs.readFileSync(toolPath, 'utf8')
  assert.match(source, /function removeItem\(id\)/)
  assert.match(source, /URL\.revokeObjectURL\(item\.result\.url\)/)
  assert.match(source, /data-prb-delete=/)
  assert.match(source, /event\.stopPropagation\(\)/)
  assert.doesNotMatch(source, /selected\?\.result \? '透明 PNG'/)
})

test('PNG remove-black tool is loaded and packaged as a required runtime helper', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'particle-editor', 'index.html'), 'utf8')
  const buildScript = fs.readFileSync(path.join(repoRoot, 'particle-editor-desktop', 'scripts', 'build-renderer.mjs'), 'utf8')
  assert.match(html, /png-remove-black\.tool\.js\?v=20260916-section-switch-1/)
  assert.equal((buildScript.match(/"png-remove-black\.tool\.js"/g) || []).length, 2)
})

test('PNG remove-black tool keeps batch export and guarded overwrite actions', () => {
  const source = fs.readFileSync(toolPath, 'utf8')
  assert.match(source, /multiple hidden/)
  assert.match(source, /pickDirectory/)
  assert.match(source, /writeBinaryFile/)
  assert.match(source, /item\.result && item\.filePath/)
})
