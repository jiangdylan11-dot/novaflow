const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..', '..')
const mainPath = path.join(root, 'particle-editor-desktop', 'main.js')
const preloadPath = path.join(root, 'particle-editor-desktop', 'preload.js')
const mainSource = fs.readFileSync(mainPath, 'utf8')
const preloadSource = fs.readFileSync(preloadPath, 'utf8')

function handlerBlock(channel, nextChannel) {
  const start = mainSource.indexOf(`ipcMain.handle("${channel}"`)
  assert.notEqual(start, -1, `missing ${channel}`)
  const end = nextChannel
    ? mainSource.indexOf(`ipcMain.handle("${nextChannel}"`, start + 1)
    : mainSource.indexOf('ipcMain.handle("runtime-get-system-stats"', start + 1)
  assert.ok(end > start, `cannot isolate ${channel}`)
  return mainSource.slice(start, end)
}

test('main creates the isolated H3 LoRA catalog from the H3 lifecycle config and fixed 8189 object_info', () => {
  assert.match(
    mainSource,
    /const\s*\{\s*createMiniMaxH3LoraCatalog\s*\}\s*=\s*require\("\.\/main\/minimax-h3-lora-catalog"\)/,
  )
  const start = mainSource.indexOf('const miniMaxH3LoraCatalog = createMiniMaxH3LoraCatalog({')
  const end = mainSource.indexOf('\n});', start) + 4
  assert.ok(start >= 0 && end > start)
  const block = mainSource.slice(start, end)
  assert.match(block, /miniMaxH3RuntimeLifecycle\.readConfig\(\)/)
  assert.match(block, /expectedModelsPath:\s*\(\)\s*=>\s*readNovaFlowRuntimeConfig\(\)\?\.modelsPath/)
  assert.match(block, /http:\/\/127\.0\.0\.1:8189\/object_info\/LoraLoaderModelOnly/)
  assert.doesNotMatch(block, /8188|8000|E:\\ComfyUI|runtimeRequestJson|credit|auth/i)
})

test('catalog and validation IPC start only the H3 sidecar and delegate to narrow catalog methods', () => {
  const catalogBlock = handlerBlock('minimax-h3-lora-catalog', 'minimax-h3-lora-validate')
  assert.match(catalogBlock, /miniMaxH3RuntimeLifecycle\.start\(/)
  assert.match(catalogBlock, /miniMaxH3LoraCatalog\.catalog\(\{\s*mode:\s*payload\?\.mode,\s*steps:\s*payload\?\.steps\s*\}\)/s)
  assert.doesNotMatch(catalogBlock, /novaFlowRuntime|runtimeRequestJson|credit|auth|8188/i)

  const validateBlock = handlerBlock('minimax-h3-lora-validate')
  assert.match(validateBlock, /miniMaxH3RuntimeLifecycle\.start\(/)
  assert.match(validateBlock, /miniMaxH3LoraCatalog\.validate\(/)
  for (const field of ['mode', 'steps', 'name', 'fingerprint', 'strength']) {
    assert.match(validateBlock, new RegExp(`${field}:\\s*payload\\?\\.${field}`))
  }
  assert.doesNotMatch(validateBlock, /novaFlowRuntime|runtimeRequestJson|credit|auth|8188/i)
})

test('preload exposes only the two narrow H3 LoRA methods on their matching channels', () => {
  assert.match(
    preloadSource,
    /minimaxH3LoraCatalog:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("minimax-h3-lora-catalog",\s*payload\)/,
  )
  assert.match(
    preloadSource,
    /minimaxH3LoraValidate:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("minimax-h3-lora-validate",\s*payload\)/,
  )
})
