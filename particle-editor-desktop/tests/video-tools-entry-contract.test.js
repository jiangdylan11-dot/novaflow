const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const repoRoot = path.resolve(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8')
const mp4Tool = read('particle-editor', 'mp4-compress.tool.js')
const convertTool = read('particle-editor', 'video-format-convert.tool.js')

const TOOLS = [
  { file: 'mp4-compress.tool.js', source: mp4Tool, key: 'mp4_compress', prefix: 'nf-mp4', label: 'MP4 压缩' },
  { file: 'video-format-convert.tool.js', source: convertTool, key: 'video_format_convert', prefix: 'nf-vfc', label: '视频格式转换' },
]

for (const tool of TOOLS) {
  test(`${tool.file} is loaded and packaged as a required runtime helper`, () => {
    const html = read('particle-editor', 'index.html')
    const buildScript = read('particle-editor-desktop', 'scripts', 'build-renderer.mjs')
    assert.match(html, new RegExp(`${tool.file.replace(/\./g, '\\.')}\\?v=20260921-video-tools-4`))
    // Once in the shell file list and once in the required set, like every other tool module.
    assert.equal((buildScript.match(new RegExp(`"${tool.file.replace(/\./g, '\\.')}"`, 'g')) || []).length, 2)
  })

  test(`${tool.file} entry is scoped to the primary Tools section`, () => {
    assert.match(tool.source, /isToolsSectionActive/)
    assert.match(tool.source, /png\.parentElement === jpg\.parentElement/)
    assert.match(tool.source, /existing\?\.remove\(\)/)
    assert.match(tool.source, new RegExp(`button\\.textContent = '${tool.label}'`))
  })

  test(`${tool.file} deactivates on peer entry clicks before target activation`, () => {
    assert.match(tool.source, /document\.addEventListener\('click', handleToolEntryClick, true\)/)
    const handler = tool.source.match(/  function handleToolEntryClick\(event\) \{[\s\S]*?\n  \}/)?.[0]
    assert.ok(handler)
    let deactivations = 0
    class Element {
      constructor(entry) { this.entry = entry }
      closest(selector) { assert.equal(selector, '[data-novaflow-tools-entry]'); return this.entry }
    }
    const click = vm.runInNewContext(`(${handler})`, { Element, TOOL_ID: tool.key, deactivate: () => { deactivations += 1 } })
    const target = (key) => new Element({ getAttribute: (name) => { assert.equal(name, 'data-novaflow-tools-entry'); return key } })
    click({ target: target(tool.key) })
    click({ target: new Element(null) })
    click({ target: null })
    assert.equal(deactivations, 0)
    for (const key of ['png_compress', 'jpg_compress', 'png_remove_black', 'spine_atlas_webp']) click({ target: target(key) })
    assert.equal(deactivations, 4)
  })

  test(`${tool.file} keeps the compression-tool pixel contract`, () => {
    const { source, prefix } = tool
    assert.match(source, /grid-template-columns:220px minmax\(0,1fr\)/)
    assert.match(source, /gap:12px;padding:14px 14px 14px 12px/)
    assert.match(source, new RegExp(`\\.${prefix}-upload\\{width:220px;height:44px`))
    assert.match(source, new RegExp(`\\.${prefix}-actions\\{display:grid;grid-template-columns:220px`))
    assert.match(source, /right:26px;top:14px/)
    assert.match(source, /width:102px;height:36px/)
    assert.match(source, /width:calc\(100% \+ 14px\);height:100%/)
    assert.match(source, /margin-top:-14px;margin-right:-14px/)
    assert.match(source, /padding:12px 12px 16px;background:#090a0a/)
    assert.match(source, new RegExp(`min-height:52px;height:52px;max-height:52px`))
    assert.match(source, new RegExp(`\\.${prefix}-preview\\{[^}]*background:transparent`))
    assert.match(source, /rgba\(30,166,114,\.12\)/)
    assert.match(source, /#\$\{ROOT_ID\}\{[^}]*background:#151515/)
    assert.match(source, new RegExp(`\\.${prefix}-panel-head\\{[^}]*font-size:14px`))
    assert.match(source, new RegExp(`\\.${prefix}-panel-head small\\{[^}]*font-size:11px`))
  })

  test(`${tool.file} drop handlers bind once per root lifecycle`, () => {
    const renderStart = tool.source.indexOf('  function render() {')
    const renderEnd = tool.source.indexOf('\n  installStyle()', renderStart)
    assert.ok(renderStart >= 0 && renderEnd > renderStart)
    const renderSource = tool.source.slice(renderStart, renderEnd)
    assert.equal((renderSource.match(/root\.addEventListener\('dragover'/g) || []).length, 1)
    assert.equal((renderSource.match(/root\.addEventListener\('drop'/g) || []).length, 1)
    assert.match(tool.source, /function handleRootDrop\(event\) \{[\s\S]*event\.preventDefault\(\)[\s\S]*addFiles\(event\.dataTransfer\?\.files\)[\s\S]*\}/)
  })

  test(`${tool.file} releases both preview handles when an item goes away`, () => {
    assert.match(tool.source, /URL\.revokeObjectURL\(item\.url\)/)
    assert.match(tool.source, /videoResourceMediaRelease\?\.\(\{ token: item\.result\.token \}\)/)
    assert.match(tool.source, /function removeItem\(id\)/)
    assert.match(tool.source, /state\.items\.forEach\(releaseItemPreview\)/)
  })

  test(`${tool.file} patches progress in place instead of re-rendering`, () => {
    // A full render() on every ffmpeg tick would rebuild the <video> and restart playback.
    const bind = tool.source.match(/  function bindProgress\(\) \{[\s\S]*?\n  \}/)?.[0]
    assert.ok(bind)
    assert.doesNotMatch(bind, /\brender\(\)/)
    assert.match(bind, /paintItem\(item\)/)
    assert.match(bind, /paintControls\(\)/)
    assert.match(tool.source, /onVideoToolProgress/)
  })
}

test('MP4 压缩 then 视频格式转换 sit above SPINE 图集转换', () => {
  // The other patch modules append, so a bare appendChild here would leave the order up to
  // whichever module's interval fires first.
  const spineTool = read('particle-editor', 'spine-atlas-webp.tool.js')
  const spineAttr = spineTool.match(/const BUTTON_ATTR = '(.+?)'/)[1]
  assert.equal(mp4Tool.match(/const SPINE_ENTRY_ATTR = '(.+?)'/)[1], spineAttr)
  assert.equal(convertTool.match(/const SPINE_ENTRY_ATTR = '(.+?)'/)[1], spineAttr)
  assert.equal(convertTool.match(/const MP4_ENTRY_ATTR = '(.+?)'/)[1], mp4Tool.match(/const BUTTON_ATTR = '(.+?)'/)[1])

  assert.match(mp4Tool, /const anchor = spineEntry instanceof HTMLElement && spineEntry\.parentElement === jpg\.parentElement \? spineEntry : null/)
  assert.match(mp4Tool, /jpg\.parentElement\.insertBefore\(button, anchor\)/)

  // 视频格式转换 goes right after the MP4 entry, and re-checks that slot every pass because the
  // module that owns its anchor may mount later. Each branch writes only when the slot is wrong:
  // an unconditional move would feed the brand runtime's mutation observer once a second.
  const place = convertTool.match(/  function placeEntry\(list, button\) \{[\s\S]*?\n  \}/)?.[0] || ''
  assert.match(place, /if \(mp4Entry\.nextElementSibling !== button\) list\.insertBefore\(button, mp4Entry\.nextSibling\)/)
  assert.match(place, /if \(spineEntry\.previousElementSibling !== button\) list\.insertBefore\(button, spineEntry\)/)
  assert.match(place, /if \(list\.lastElementChild !== button\) list\.appendChild\(button\)/)
  assert.match(convertTool, /if \(existing\.parentElement === jpg\.parentElement\) placeEntry\(jpg\.parentElement, existing\)/)
  assert.match(convertTool, /\n    placeEntry\(jpg\.parentElement, button\)\n/)
})

test('the sliders are the runtime own 2px track, not a browser default', () => {
  const brandRuntime = read('particle-editor', 'novaflow-brand-runtime.js')
  assert.match(brandRuntime, /const PARTICLE_DENSITY_SLIDER_TRACK_HEIGHT = 2;/)
  assert.match(brandRuntime, /const PARTICLE_DENSITY_SLIDER_THUMB_SIZE = 12;/)
  assert.match(brandRuntime, /const UI_RANGE_ACCENT = "#20c997";/)
  for (const tool of TOOLS) {
    // The same declarations the brand runtime puts on a native tools slider, so the overlay does
    // not depend on that stylesheet reaching a root it appends to <body>.
    assert.match(tool.source, /#\$\{ROOT_ID\} input\[type=range\]\{[^}]*appearance:none/, tool.file)
    assert.match(tool.source, /#\$\{ROOT_ID\} input\[type=range\]\{[^}]*border:0/, tool.file)
    assert.match(tool.source, /#\$\{ROOT_ID\} input\[type=range\]\{[^}]*height:12px;min-height:12px;max-height:12px/, tool.file)
    assert.match(tool.source, /#\$\{ROOT_ID\} input\[type=range\]\{[^}]*#20c997 var\(--nf-range-pct,0%\),#303030 var\(--nf-range-pct,0%\),#303030 100%\) center \/ 100% 2px no-repeat/, tool.file)
    assert.match(tool.source, /::-webkit-slider-runnable-track\{height:2px;border:0;background:transparent\}/, tool.file)
    assert.match(tool.source, /::-webkit-slider-thumb\{[^}]*width:12px;height:12px;margin-top:-5px;border:0;border-radius:999px;background:#dfe7ee/, tool.file)
    assert.doesNotMatch(tool.source, /accent-color:#1ea672/, tool.file)
    // The fill is a gradient stop, so the percentage has to be written back on every change.
    assert.match(tool.source, /input\.style\.setProperty\('--nf-range-pct', `\$\{pct\}%`\)/, tool.file)
    assert.match(tool.source, /syncRangeFill\(event\.target\)/, tool.file)
    assert.match(tool.source, /data-novaflow-tools-range="1"/, tool.file)
  }
})

test('the strength label promises what the encoder delivers', () => {
  const { mp4CompressionPlan } = require('../main/mp4-compressor')
  const plan = vm.runInNewContext(`(${mp4Tool.match(/const compressionPlan = \(strength\) => \{[\s\S]*?\n  \}/)[0].replace('const compressionPlan = ', '')})`, {
    clamp: (value, min, max) => Math.max(min, Math.min(max, value))
  })
  for (const strength of [0, 1, 32, 55, 56, 77, 78, 100]) {
    const { quality, zone } = mp4CompressionPlan(strength)
    // Field by field: the sandbox builds its object against another realm's Object prototype.
    assert.equal(plan(strength).strength, strength, `strength ${strength}`)
    assert.equal(plan(strength).quality, quality, `quality at ${strength}`)
    assert.equal(plan(strength).zone, zone, `zone at ${strength}`)
  }
})

test('视频格式转换 offers exactly the three formats the converter builds', () => {
  const { VIDEO_CONVERT_FORMATS, VIDEO_CONVERT_INPUT_EXTENSIONS } = require('../main/video-format-converter')
  const ids = Array.from(convertTool.matchAll(/\{ id: '([a-z0-9]+)', label: '([A-Z0-9]+)'/g))
  assert.deepEqual(ids.map((match) => match[1]), [...VIDEO_CONVERT_FORMATS])
  assert.deepEqual(ids.map((match) => match[2]), VIDEO_CONVERT_FORMATS.map((format) => format.toUpperCase()))
  const extensions = convertTool.match(/const INPUT_EXTENSIONS = \[([^\]]+)\]/)[1].split(',').map((part) => part.trim().replace(/'/g, ''))
  assert.deepEqual(extensions, [...VIDEO_CONVERT_INPUT_EXTENSIONS])
})

test('a GIF result can be served back to the preview', () => {
  // 视频格式转换 previews its result through the same media service the merge preview uses, and
  // that service refuses an extension it does not know.
  const service = read('particle-editor-desktop', 'main', 'video-resource-media.js')
  assert.match(service, /SUPPORTED_EXTENSIONS = new Set\(\[".mp4", ".webm", ".gif"\]\)/)
  assert.match(service, /\[".gif", "image\/gif"\]/)
  assert.match(convertTool, /item\.result\.format === 'gif'/)
})

test('exports and overwrites go through the shared video-tool channels', () => {
  const preload = read('particle-editor-desktop', 'preload.js')
  const main = read('particle-editor-desktop', 'main.js')
  for (const channel of ['compress-mp4', 'convert-video-format', 'save-video-tool-output', 'overwrite-video-tool-output', 'clear-video-tool-output']) {
    assert.match(preload, new RegExp(`invoke\\("${channel}"`), channel)
    assert.match(main, new RegExp(`handleNovaFlowTempIpc\\("${channel}"`), channel)
  }
  // Writing to the user's disk is entitled; running the encoder is not, so an unlicensed install
  // can still see what a compression would buy before paying for the export.
  for (const channel of ['save-video-tool-output', 'overwrite-video-tool-output']) {
    assert.match(main, new RegExp(`assertOnlineEntitled\\("export", "${channel}"\\)`), channel)
  }
  const compress = main.slice(main.indexOf('handleNovaFlowTempIpc("compress-mp4"'), main.indexOf('handleNovaFlowTempIpc("save-video-tool-output"'))
  assert.doesNotMatch(compress, /assertOnlineEntitled/)
  // Each tool owns its temp dir: clearing one list must not delete the other tool's results.
  assert.match(main, /const novaFlowVideoToolWorkDirs = new Map\(\)/)
  assert.match(mp4Tool, /clearVideoToolOutput\?\.\(\{ tool: 'mp4-compress' \}\)/)
  assert.match(convertTool, /clearVideoToolOutput\?\.\(\{ tool: 'video-convert' \}\)/)
  assert.match(main, /getNovaFlowVideoToolWorkDir\("mp4-compress"\)/)
  assert.match(main, /getNovaFlowVideoToolWorkDir\("video-convert"\)/)
})

test('a kept-original result is never written back over its own source', () => {
  const main = read('particle-editor-desktop', 'main.js')
  assert.match(main, /if \(path\.resolve\(srcPath\) === path\.resolve\(targetPath\)\) continue;/)
  assert.match(mp4Tool, /item\.result\?\.srcPath && item\.filePath && !item\.result\.keptOriginal/)
  // 视频格式转换 changes the extension, so overwriting the source is not offered at all.
  assert.doesNotMatch(convertTool, /overwriteVideoToolOutput/)
})
