const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { loadSpine } = require('../../tools/qwen-rapid-migration-smoke.cjs')

const root = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const RUNTIME = 'particle-editor/spine-split-runtime.js'
const CACHE_VERSION = '20260916-effect-extract-2'
const deepEqual = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message)

function loadRuntime() {
  const s = loadSpine(RUNTIME)
  s.PRESETS = []
  s.LAYER_MODEL_VERSION = 1
  s.SPINE_LAYER_ORDER = { body: 50, neck: 55, head: 60 }
  s.state = { parts: [], splitSets: [], activeSplitSetId: '', maskStencil: { active: false, fromPartId: '', setId: '' } }
  return s
}

test('the split runtime ships the mask stencil entry on every layer row and bumps its cache key', () => {
  const html = read('particle-editor/index.html')
  assert.match(html, new RegExp(`spine-split-runtime\\.js\\?v=${CACHE_VERSION.replace(/[-]/g, '\\-')}`), 'index.html must load the stencil build of the split runtime')
  const source = read(RUNTIME)
  assert.match(source, /gridTemplateColumns: '28px 30px 22px minmax\(0, 1fr\) 20px'/, 'layer rows gain a 22px stencil column after the thumbnail')
  assert.match(source, /splitLayerThumbNode\(part\),\n\s+splitLayerStencilButtonNode\(part, setId, editToolLocked, commandButtonStyle\),\n\s+splitLayerNameSlotNode\(part, isRenaming\)/, 'the stencil button sits between the thumbnail and the name')
  assert.match(source, /\[LAYER_COMMAND_ATTR\]: 'stencil',\n\s+\[LAYER_COMMAND_TARGET_ATTR\]: partId,\n\s+\[LAYER_STENCIL_ATTR\]: originActive \? 'active' : '1'/, 'the stencil button is a layer command with an active marker')
  assert.match(source, /h\('img', \{ src: maskSrc, alt: '', draggable: 'false'/, 'the stencil button renders the layer mask thumbnail')
  assert.match(source, /if \(command !== 'visibility' && command !== 'delete' && command !== 'stencil'\) return/, 'the window click fallback must accept the stencil command')
  assert.match(source, /else if \(command === 'stencil'\) startMaskStencil\(partId, row && row\.getAttribute\('data-novaflow-spine-split-layer-set'\) \|\| ''\)/)
  assert.match(source, /maskStencil: maskStencilRenderSignature\(\),\n\s+mergeControl: \{/, 'stencil state must be part of the right panel render signature')
})

test('pointing mode is guarded by a global overlay, Esc, and the target click paths', () => {
  const source = read(RUNTIME)
  assert.match(source, /window\.addEventListener\('pointerdown', handleMaskStencilPointerCapture, true\)\n\s+window\.addEventListener\('mousedown', handleMaskStencilPointerCapture, true\)\n\s+window\.addEventListener\('dblclick', handleMaskStencilPointerCapture, true\)\n\s+window\.addEventListener\('pointerup', handleMaskStencilPointerCapture, true\)\n\s+window\.addEventListener\('click', handleMaskStencilPointerCapture, true\)\n\s+window\.addEventListener\('resize', scheduleMaskStencilOverlaySync\)\n\s+window\.addEventListener\('scroll', scheduleMaskStencilOverlaySync, true\)\n\s+window\.addEventListener\('click', handleSplitControlClickFallback, true\)/, 'the stencil capture listeners must be registered before the other window click fallbacks')
  assert.match(source, /overlay\.style\.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483300;pointer-events:none;overflow:visible'/, 'the overlay is a fixed full-window svg')
  assert.match(source, /dim\.setAttribute\('fill-rule', 'evenodd'\)/, 'targets are punched out of the dim path with evenodd holes')
  assert.match(source, /dim\.addEventListener\('wheel', handleMaskStencilOverlayWheel, \{ passive: false \}\)/, 'wheel over the dim area still scrolls the layer list')
  assert.match(source, /if \(isMaskStencilActive\(\)\) \{\n\s+if \(key === 'escape'\) \{\n\s+event\.preventDefault\(\)\n\s+event\.stopPropagation\(\)\n\s+resetMaskStencil\(\)\n\s+return\n\s+\}/, 'Esc cancels pointing mode')
  assert.match(source, /if \(isMaskStencilActive\(\)\) \{\n\s+applyMaskStencil\(\{ type: 'source', id: resource\.id \}\)\n\s+return\n\s+\}\n\s+activateSourceResourceWithLinkedSplitSet\(resource\.id, \{ sourceView: true \}\)/, 'clicking the source card while pointing copies instead of switching the view')
  assert.match(source, /if \(isMaskStencilActive\(\)\) \{\n\s+applyMaskStencil\(\{ type: 'part', id: part\.id \}\)\n\s+return\n\s+\}\n\s+setLayerSelection\(part\.id, event\)/, 'keyboard activation of a row while pointing copies instead of selecting')
  assert.match(source, /function runSplitControlAction\(action, options = \{\}\) \{\n\s+if \(isMaskStencilActive\(\)\) resetMaskStencil\(\{ silent: true, render: false \}\)/, 'any left panel tool action leaves pointing mode')
  assert.match(source, /function resetSplitWorkspaceToolsForUnmount\(\) \{\n\s+resetMaskStencil\(\{ silent: true, render: false \}\)/, 'unmounting the workspace clears pointing mode')
  assert.match(source, /renderRightWorkspacePanel\(\)\n\s+syncMaskStencilOverlay\(\)\n\s+\}/, 'the overlay follows every right panel sync')
  assert.match(source, /pushSplitLayerUndoSnapshot\('mask stencil', origin\.id\)\n\s+await addManualPart\(record\)/, 'the copy is undoable and goes through the manual layer path')
  assert.match(source, /has\('__novaflow_mask_stencil_smoke'\)/, 'the in-page smoke is wired to a query flag')
  assert.match(source, /assertNoVisibleSplitToolAction\('viewMask', 'Mask view button'\)/, 'the hidden mask view stays hidden')
  assert.match(source, /window\.NovaFlowSpineSplitDebug = \{\n\s+importSourceDataUrl,\n\s+startMaskStencil,\n\s+applyMaskStencil,\n\s+resetMaskStencil,\n\s+maskStencilTargets,/, 'the debug hooks expose pointing mode')
})

test('stencil targets are every ready source resource plus every other layer with pixels', () => {
  const s = loadRuntime()
  const targets = s.maskStencilTargetsFor('body', [
    { id: 'body', dataUrl: 'data:body' },
    { id: 'head', dataUrl: 'data:head' },
    { id: 'empty', dataUrl: '' },
    { id: 'neck', dataUrl: 'data:neck' }
  ], [
    { id: 'src_1', dataUrl: 'data:src1' },
    { id: 'src_pending', dataUrl: 'data:src2', pendingDataUrl: true },
    { id: 'src_none', dataUrl: '' }
  ])
  deepEqual(targets, [
    { type: 'source', id: 'src_1' },
    { type: 'part', id: 'head' },
    { type: 'part', id: 'neck' }
  ])
  deepEqual(s.maskStencilTargetsFor('', [], []), [])
})

test('the copied layer keeps the origin rect and mask and sits directly above the origin', () => {
  const s = loadRuntime()
  const origin = { id: 'body', name: 'body', x: 168, y: 1, width: 848, height: 1015, pivot: { x: 0.5, y: 0.5 }, layer: 50, dataUrl: 'data:body', maskDataUrl: 'data:mask', layerMaskDataUrl: 'data:mask' }
  const record = s.maskStencilLayerRecord(origin, { type: 'source', id: 'src_1' }, '原图', {
    id: 'body_copy',
    imageDataUrl: 'data:image',
    maskDataUrl: 'data:mask',
    dataUrl: 'data:rendered',
    sceneWidth: 1016,
    sceneHeight: 1018
  })
  assert.equal(record.id, 'body_copy')
  assert.equal(record.name, 'body ← 原图')
  deepEqual([record.x, record.y, record.width, record.height], [168, 1, 848, 1015])
  assert.equal(record.manualLayer, true)
  assert.ok(Math.abs(record.layer - 50.01) < 1e-9, `layer rank ${record.layer} must be origin + 0.01`)
  assert.equal(record.imageDataUrl, 'data:image', 'the unmasked crop is kept for the mask editor restore brush')
  assert.equal(record.layerMaskDataUrl, 'data:mask', 'the mask is synced from the origin')
  assert.equal(record.maskDataUrl, 'data:mask')
  assert.equal(record.dataUrl, 'data:rendered')
  assert.equal(record.file, 'images/body_copy.png')
  assert.equal(record.maskFile, 'masks/body_copy_mask.png')
  assert.equal(record.sourcePartId, 'body')
  assert.equal(record.spineReady, true)
  assert.equal(record.visible, true)
  assert.equal(record.layerModelVersion, 1)
  deepEqual(record.metadata, { kind: 'mask-stencil', source: 'maskStencil', fromPartId: 'body', target: { type: 'source', id: 'src_1' } })
  deepEqual([record.originalWidth, record.originalHeight], [1016, 1018])

  const ordered = s.normalizeSpineLayerOrder([
    { id: 'neck', dataUrl: 'data:neck' },
    record,
    origin,
    { id: 'head', dataUrl: 'data:head' }
  ]).map((part) => part.id)
  deepEqual(ordered, ['body', 'body_copy', 'neck', 'head'])

  const manualOrigin = { ...origin, id: 'tail', name: 'tail', manualLayer: true, layer: 80.02 }
  const manualCopy = s.maskStencilLayerRecord(manualOrigin, { type: 'part', id: 'head' }, 'head', { id: 'tail_copy', imageDataUrl: 'a', maskDataUrl: 'b', dataUrl: 'c', sceneWidth: 1, sceneHeight: 1 })
  assert.ok(Math.abs(manualCopy.layer - 80.03) < 1e-9)
  assert.equal(manualCopy.name, 'tail ← head')
})

test('the dim path punches an evenodd hole for every exposed target', () => {
  const s = loadRuntime()
  assert.equal(s.maskStencilOverlayPath(100, 50, []), 'M0 0H100V50H0Z')
  assert.equal(
    s.maskStencilOverlayPath(100, 50, [{ left: 10, top: 10, width: 20, height: 5 }, { left: 40, top: 20, width: 8, height: 8 }]),
    'M0 0H100V50H0Z M10 10h20v5h-20Z M40 20h8v8h-8Z'
  )
})

test('the render signature only carries the origin while pointing is active', () => {
  const s = loadRuntime()
  deepEqual(s.maskStencilRenderSignature(), { active: false, fromPartId: '' })
  s.state.maskStencil = { active: true, fromPartId: 'body', setId: '' }
  deepEqual(s.maskStencilRenderSignature(), { active: true, fromPartId: 'body' })
  s.state.maskStencil = { active: true, fromPartId: '', setId: '' }
  deepEqual(s.maskStencilRenderSignature(), { active: false, fromPartId: '' }, 'an origin-less flag is not an active session')
})
