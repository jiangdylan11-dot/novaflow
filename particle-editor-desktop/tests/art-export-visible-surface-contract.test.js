const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..', '..')
const runtime = fs.readFileSync(path.join(root, 'particle-editor', 'novaflow-brand-runtime.js'), 'utf8')
const uiBridge = fs.readFileSync(path.join(root, 'particle-editor', 'ui-design.bridge.js'), 'utf8')

test('art export resolves the active visible surface before persistent split state', () => {
  const start = runtime.indexOf('async function getNovaflowArtExportImageSource')
  const end = runtime.indexOf('\n  function novaflowArtDataUrlToBlob', start)
  const resolver = runtime.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.ok(resolver.indexOf('data-novaflow-ui-design-active') < resolver.indexOf('novaflowArtSplitExportImageSource(state)'))
  assert.ok(resolver.indexOf('isNovaflowArtGenerateExportSurfaceActive()') < resolver.indexOf('novaflowArtSplitExportImageSource(state)'))
  assert.match(resolver, /selectedNovaflowArtGenerateImageSource\(\)/)
})

test('PSD keeps layers only while the split canvas is actually active', () => {
  const start = runtime.indexOf('async function buildNovaflowArtExportPsdDataUrl')
  const end = runtime.indexOf('\n  async function encodeNovaflowArtImageBlob', start)
  const resolver = runtime.slice(start, end)
  assert.match(resolver, /isNovaflowArtSplitExportSurfaceActive\(\)\s*&&\s*hasNovaflowArtSplitLayers\(state\)/)
  assert.match(resolver, /getNovaflowArtExportImageSource\(\)/)
})

test('UI Design bridge exposes the currently selected or latest valid result for export', () => {
  assert.match(uiBridge, /function getCurrentExportSource\(\)/)
  assert.match(uiBridge, /selection\?\.node\?\.type === 'result'/)
  assert.match(uiBridge, /results\[results\.length - 1\]/)
  assert.match(uiBridge, /getCurrentExportSource,/)
})
