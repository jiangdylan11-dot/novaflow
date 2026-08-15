const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..', '..')
const mainSource = fs.readFileSync(path.join(root, 'particle-editor-desktop', 'main.js'), 'utf8')
const preloadSource = fs.readFileSync(path.join(root, 'particle-editor-desktop', 'preload.js'), 'utf8')
const indexSource = fs.readFileSync(path.join(root, 'particle-editor', 'index.html'), 'utf8')
const buildSource = fs.readFileSync(path.join(root, 'particle-editor-desktop', 'scripts', 'build-renderer.mjs'), 'utf8')
const syncSource = fs.readFileSync(path.join(root, 'scripts', 'sync-runtime.mjs'), 'utf8')
const checkSource = fs.readFileSync(path.join(root, 'scripts', 'check-runtime-sync.mjs'), 'utf8')

function blockBetween(source, startMarker, nextMarker) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `missing ${startMarker}`)
  const end = source.indexOf(nextMarker, start + startMarker.length)
  return source.slice(start, end >= 0 ? end : source.length)
}

test('desktop owns one isolated H3 output publisher backed by the current temp warehouse', () => {
  assert.match(
    mainSource,
    /const \{ createMiniMaxH3OutputPublisher \} = require\("\.\/main\/minimax-h3-output-publisher"\);/,
  )
  assert.equal((mainSource.match(/createMiniMaxH3OutputPublisher\(\{/g) || []).length, 1)
  const creation = blockBetween(
    mainSource,
    'const miniMaxH3OutputPublisher = createMiniMaxH3OutputPublisher({',
    'handleNovaFlowTempIpc("minimax-h3-output-publish"',
  )
  assert.match(creation, /readRuntimeConfig: \(\) => miniMaxH3RuntimeLifecycle\.readConfig\(\)/)
  assert.match(creation, /getWarehouseDir: \(\) => ensureAiSeqCacheDir\(\)/)
  assert.doesNotMatch(creation, /8188|getNovaFlowRuntimeOutputDir|clientAuth|credit|provider/i)
})

test('publish and list use narrow temp-job IPC and preload methods', () => {
  const publishBlock = blockBetween(
    mainSource,
    'handleNovaFlowTempIpc("minimax-h3-output-publish"',
    'handleNovaFlowTempIpc("minimax-h3-output-list"',
  )
  const listBlock = blockBetween(
    mainSource,
    'handleNovaFlowTempIpc("minimax-h3-output-list"',
    'const cleanupAiSeqCacheDir',
  )
  assert.match(publishBlock, /miniMaxH3OutputPublisher\.publish\(payload\)/)
  assert.match(listBlock, /miniMaxH3OutputPublisher\.list\(\)/)
  assert.doesNotMatch(`${publishBlock}\n${listBlock}`, /8188|clientAuth|credit|provider|runtimeRequest/i)
  assert.match(
    preloadSource,
    /minimaxH3OutputPublish: \(payload\) => ipcRenderer\.invoke\("minimax-h3-output-publish", payload\)/,
  )
  assert.match(
    preloadSource,
    /minimaxH3OutputList: \(\) => ipcRenderer\.invoke\("minimax-h3-output-list"\)/,
  )
})

test('the warehouse shortcut opens the current AI sequence session warehouse', () => {
  const block = blockBetween(
    mainSource,
    'handleNovaFlowTempIpc("runtime-open-output-folder"',
    'ipcMain.handle("runtime-open-logs-folder"',
  )
  assert.match(block, /const target = ensureAiSeqCacheDir\(\)/)
  assert.match(block, /kind: "ai-sequence-temp-warehouse"/)
  assert.doesNotMatch(block, /getNovaFlowRuntimeOutputDir/)
})

test('the renderer loads the modular output resource before the active H3 bundle', () => {
  const resource = indexSource.indexOf('ai-sequence-minimax-h3-output.resource.js?v=20260812-minimax-h3-timing-1')
  const bundle = indexSource.indexOf('assets/index-BbIa-2NM.js?v=20260812-minimax-h3-assistant-1')
  assert.ok(resource >= 0 && bundle > resource)
  assert.match(indexSource, /proxy-electron-api\.js\?v=20260812-minimax-h3-output-1/)
  for (const source of [buildSource, syncSource, checkSource]) {
    assert.match(source, /ai-sequence-minimax-h3-output\.resource\.js/)
  }
  assert.match(syncSource, /main\/minimax-h3-output-publisher\.js/)
  assert.match(checkSource, /main\/minimax-h3-output-publisher\.js/)
})
