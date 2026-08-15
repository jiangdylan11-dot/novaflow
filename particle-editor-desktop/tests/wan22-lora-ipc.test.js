const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..', '..')
const mainSource = fs.readFileSync(path.join(root, 'particle-editor-desktop', 'main.js'), 'utf8')
const preloadSource = fs.readFileSync(path.join(root, 'particle-editor-desktop', 'preload.js'), 'utf8')

function handlerBlock(channel, nextChannel) {
  const start = mainSource.indexOf(`ipcMain.handle("${channel}"`)
  assert.notEqual(start, -1, `missing ${channel}`)
  const end = mainSource.indexOf(`ipcMain.handle("${nextChannel}"`, start + 1)
  assert.ok(end > start, `cannot isolate ${channel}`)
  return mainSource.slice(start, end)
}

test('main creates the Wan2.2 catalog from the configured NovaFlow model root and local object_info', () => {
  assert.match(mainSource, /createWan22LoraCatalog\s*\}\s*=\s*require\("\.\/main\/wan22-lora-catalog"\)/)
  const start = mainSource.indexOf('const wan22LoraCatalog = createWan22LoraCatalog({')
  const end = mainSource.indexOf('let promptAssistantProcess', start)
  assert.ok(start >= 0 && end > start)
  const block = mainSource.slice(start, end)
  assert.match(block, /readConfig:\s*\(\)\s*=>\s*readNovaFlowRuntimeConfig\(\)/)
  assert.match(block, /expectedModelsPath:\s*\(\)\s*=>\s*readNovaFlowRuntimeConfig\(\)\?\.modelsPath/)
  assert.match(block, /sanitizeRuntimeBaseUrl\(config\?\.baseUrl/)
  assert.match(block, /new URL\("\/object_info"/)
  assert.doesNotMatch(block, /8189|E:\\ComfyUI|runtimeRequestJson|credit|auth/i)
})

test('Wan2.2 catalog IPC starts only NovaFlow Runtime and returns narrow catalog items', () => {
  const block = handlerBlock('wan22-lora-catalog', 'wan22-lora-validate')
  assert.match(block, /ensureNovaFlowRuntimeStarted\(/)
  assert.match(block, /wan22LoraCatalog\.catalog\(/)
  for (const field of ['highName', 'lowName', 'steps']) {
    assert.match(block, new RegExp(`${field}:\\s*payload\\?\\.${field}`))
  }
  assert.doesNotMatch(block, /miniMaxH3|runtimeRequestJson|credit|auth|8189/i)
})

test('Wan2.2 validation IPC forwards both model fingerprints and the LoRA fingerprint', () => {
  const block = handlerBlock('wan22-lora-validate', 'runtime-get-system-stats')
  assert.match(block, /ensureNovaFlowRuntimeStarted\(/)
  assert.match(block, /wan22LoraCatalog\.validate\(/)
  assert.match(block, /role:\s*payload\?\.role/)
  for (const field of [
    'highName',
    'lowName',
    'steps',
    'name',
    'fingerprint',
    'highFingerprint',
    'lowFingerprint',
    'strength',
  ]) {
    assert.match(block, new RegExp(`${field}:\\s*payload\\?\\.${field}`))
  }
  assert.doesNotMatch(block, /miniMaxH3|runtimeRequestJson|credit|auth|8189/i)
})

test('preload exposes only the matching narrow Wan2.2 catalog channels', () => {
  assert.match(preloadSource, /wan22LoraCatalog:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("wan22-lora-catalog",\s*payload\)/)
  assert.match(preloadSource, /wan22LoraValidate:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("wan22-lora-validate",\s*payload\)/)
})
