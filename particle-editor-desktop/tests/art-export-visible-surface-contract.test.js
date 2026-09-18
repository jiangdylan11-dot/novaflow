const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..', '..')
const runtime = fs.readFileSync(path.join(root, 'particle-editor', 'novaflow-brand-runtime.js'), 'utf8')
const split = fs.readFileSync(path.join(root, 'particle-editor', 'spine-split-runtime.js'), 'utf8')
const uiBridge = fs.readFileSync(path.join(root, 'particle-editor', 'ui-design.bridge.js'), 'utf8')

test('art export resolves the active visible surface before persistent split state', () => {
  const start = runtime.indexOf('async function getNovaflowArtExportImageSource')
  const end = runtime.indexOf('\n  function novaflowArtDataUrlToBlob', start)
  const resolver = runtime.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.ok(resolver.indexOf('data-novaflow-ui-design-active') < resolver.indexOf('novaflowArtSplitExportImageSource(state)'))
  assert.match(resolver, /selectedNovaflowArtGenerateImageSource\(\)/)
})

test('the art canvas outranks the generate result strip', () => {
  const start = runtime.indexOf('async function getNovaflowArtExportImageSource')
  const end = runtime.indexOf('\n  function novaflowArtDataUrlToBlob', start)
  const resolver = runtime.slice(start, end)
  // \u753b\u677f\u4e0a\u663e\u793a\u7684\u90a3\u4e00\u5f20\u5148\u8d70\uff0c\u751f\u6210\u7ed3\u679c\u53ea\u505a\u5175\u5e95\u3002
  assert.ok(resolver.indexOf('novaflowArtSplitExportImageSource(state)') < resolver.indexOf('selectedNovaflowArtGenerateImageSource()'))
  assert.ok(resolver.indexOf('selectedNovaflowArtGenerateImageSource()') < resolver.indexOf('isNovaflowArtGenerateExportSurfaceActive()'))
})

test('the split export source asks the canvas first', () => {
  const start = runtime.indexOf('async function novaflowArtSplitExportImageSource')
  const end = runtime.indexOf('\n  async function getNovaflowArtExportImageSource', start)
  const resolver = runtime.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.ok(resolver.indexOf('novaflowArtSplitCanvasExportImageSource()') < resolver.indexOf('hasNovaflowArtSplitLayers(state)'))
  assert.match(runtime, /getCanvasExportSource !== "function"/)
})

test('the split runtime exports exactly what the canvas renders', () => {
  const start = split.indexOf('async function currentSplitCanvasExportSource')
  const end = split.indexOf('\n  function isSplitCanvasViewportInteractive', start)
  const resolver = split.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.match(resolver, /splitCanvasSource\(\)/)
  // \u9884\u89c8\u8fd8\u6ca1\u91cd\u5efa\u5b8c\u5c31\u5bfc\u51fa\uff0c\u5bfc\u51fa\u7684\u5c31\u662f\u4e0a\u4e00\u7248\uff0c\u6240\u4ee5\u5148\u51b2\u6389\u3002
  assert.match(resolver, /flushSplitPreviewRefresh\(\)/)
  assert.match(split, /getCanvasExportSource: currentSplitCanvasExportSource,/)
})

test('PSD keeps layers whenever the split canvas holds them', () => {
  const start = runtime.indexOf('async function buildNovaflowArtExportPsdDataUrl')
  const end = runtime.indexOf('\n  async function encodeNovaflowArtImageBlob', start)
  const resolver = runtime.slice(start, end)
  assert.match(resolver, /isNovaflowArtSplitWorkspaceActive\(\)\s*&&\s*hasNovaflowArtSplitLayers\(state\)/)
  assert.match(resolver, /getNovaflowArtExportImageSource\(\)/)
})

test('UI Design bridge exposes the currently selected or latest valid result for export', () => {
  assert.match(uiBridge, /function getCurrentExportSource\(\)/)
  assert.match(uiBridge, /selection\?\.node\?\.type === 'result'/)
  assert.match(uiBridge, /results\[results\.length - 1\]/)
  assert.match(uiBridge, /getCurrentExportSource,/)
})
