const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { loadSpine } = require('../../tools/qwen-rapid-migration-smoke.cjs')

const root = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const RUNTIME = 'particle-editor/spine-split-runtime.js'
const CACHE_VERSION = '20260916-effect-extract-1'

function loadRuntime() {
  const s = loadSpine(RUNTIME)
  s.state = { parts: [] }
  return s
}

test('the smart cutout toolbar ships a one-click 去背 button after 退出 and bumps its cache key', () => {
  const html = read('particle-editor/index.html')
  assert.ok(html.includes(`spine-split-runtime.js?v=${CACHE_VERSION}`), 'index.html must load the remove-background build of the split runtime')
  const source = read(RUNTIME)
  assert.match(source, /button\('\\u9000\\u51fa', \(\) => stopSelectionTool\(\), false, \{ \[TOOL_ACTION_ATTR\]: 'selectionExit' \}\),\n\s+isCutoutTool \? button\('\\u53bb\\u80cc', \(\) => executeSelectionRemoveBackground\(\), false, \{\n\s+\[TOOL_ACTION_ATTR\]: 'selectionRemoveBackground'/, 'the 去背 button follows 退出 and only renders in cutout mode')
  assert.match(source, /\(kind === 'cutout' && \(name === 'selectionRemoveBackground' \|\| name === 'selectionEffect'\)\)/, 'the action is allowed only while the cutout tool is active')
  assert.match(source, /if \(action === 'selectionRemoveBackground'\) return executeSelectionRemoveBackground\(\)/, 'the tool action dispatcher runs the removal')
  assert.match(source, /const COMFY_BUSY_ACTIONS = new Set\(\['split', 'cutout', 'removeBackground'/, 'the removal shows the ComfyUI busy overlay with elapsed time')
  assert.match(source, /removeBackground: '\\u6b63\\u5728\\u81ea\\u52a8\\u53bb\\u80cc\.\.\.'/, 'the busy overlay names the removal')
  assert.match(source, /const modelAlphaDataUrl = await runRmbgCutout\(modelInputCanvas\.toDataURL\('image\/png'\)\)\n\s+const modelAlphaStats = await assertModelAlphaDataUrl\(modelAlphaDataUrl, '去背 RMBG'\)/, 'the whole image goes through the same RMBG path as 万物迁移 and demands real alpha')
  assert.match(source, /const resultCanvas = await sourceRgbWithModelAlpha\(baseCanvas, modelAlphaDataUrl, width, height, modelAlphaDataUrl\)/, 'the layer keeps the source RGB under the model alpha')
  assert.match(source, /kind: 'background-removal',\n\s+source: 'executeSelectionRemoveBackground'/, 'the new layer is tagged as a background removal')
  assert.match(source, /resetSelectionTool\(\)\n\s+await addManualPart\(cropped\)\n\s+setMessage\(`已生成去背图层：\$\{id\}`\)/, 'the tool exits and the result is added through the manual layer path')
  assert.match(source, /has\('__novaflow_remove_bg_smoke'\)/, 'the in-page smoke is wired to a query flag')
  assert.match(source, /runMaskStencilSmokeTest,\n\s+executeSelectionRemoveBackground,\n\s+runSelectionRemoveBackgroundSmokeTest,/, 'the debug hooks expose the removal')
})

test('the model alpha only narrows the source alpha and clears hidden RGB', () => {
  const s = loadRuntime()
  // opaque source / half-transparent source / fully transparent source / opaque source hidden by the model
  const data = new Uint8ClampedArray([
    200, 100, 50, 255,
    200, 100, 50, 255,
    200, 100, 50, 255,
    200, 100, 50, 0
  ])
  const sourceData = new Uint8ClampedArray([
    0, 0, 0, 255,
    0, 0, 0, 128,
    0, 0, 0, 0,
    0, 0, 0, 255
  ])
  const stats = s.gateImageAlphaBySourceAlpha({ data }, sourceData)
  assert.deepEqual(Array.from(data), [200, 100, 50, 255, 200, 100, 50, 128, 0, 0, 0, 0, 0, 0, 0, 0])
  // stats objects come from the vm realm, so compare their JSON shape rather than prototypes
  assert.deepEqual(JSON.parse(JSON.stringify(stats)), { visible: 2, semi: 1 })
  assert.deepEqual(JSON.parse(JSON.stringify(s.gateImageAlphaBySourceAlpha(null, sourceData))), { visible: 0, semi: 0 })
})

test('去背 layers are named after their source and never collide', () => {
  const s = loadRuntime()
  s.state.parts = [{ id: 'nobg' }, { id: 'body_nobg' }]
  assert.equal(s.selectionRemoveBackgroundLayerId('original', null), 'nobg_2')
  assert.equal(s.selectionRemoveBackgroundLayerId('layer', { id: 'body' }), 'body_nobg_2')
  assert.equal(s.selectionRemoveBackgroundLayerId('layer', { id: 'head' }), 'head_nobg')
  assert.equal(s.selectionRemoveBackgroundLayerId('preview', { id: 'head' }), 'nobg_2')
})
