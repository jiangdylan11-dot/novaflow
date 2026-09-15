const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { loadSpine } = require('../../tools/qwen-rapid-migration-smoke.cjs')

const root = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const RUNTIME = 'particle-editor/spine-split-runtime.js'
const NODE_FILE = 'particle-editor-desktop/main/novaflow-seethrough-head-node.py'

function loadRuntime() {
  const s = loadSpine(RUNTIME)
  s.PRESETS = []
  s.state = { includeFaceDetails: false }
  return s
}

test('the whole-head helper node ships with the app and is installed into the runtime before start', () => {
  const node = read(NODE_FILE)
  assert.match(node, /class NovaFlowSeeThroughHeadLayer/)
  assert.match(node, /HEAD_GROUP_TAGS = \["headwear", "head", "irides", "eyebrow", "eyewhite", "eyelash", "eyewear", "ears", "earwear", "nose", "mouth"\]/, 'the head group keeps its 11 slots with face replaced by head')
  assert.match(node, /group_index=HEAD_GROUP_INDEX/)
  assert.match(node, /"layer": \{"name": "head", "filename": png_name, "left": left, "top": top, "right": right, "bottom": bottom\}/, 'the manifest must use the plugin layer shape')
  const main = read('particle-editor-desktop/main.js')
  assert.match(main, /const NOVAFLOW_SEETHROUGH_HEAD_NODE_FILE = "novaflow_seethrough_head_layer\.py"/)
  assert.match(main, /path\.join\(__dirname, "main", "novaflow-seethrough-head-node\.py"\)/)
  assert.match(main, /ensureNovaFlowSeeThroughHeadNode\(config\);\s*\n\s*appendLogLine\("info", "novaflow-runtime-start"/, 'the node must be installed right before the runtime start script runs')
  for (const manifest of ['scripts/sync-runtime.mjs', 'scripts/check-runtime-sync.mjs']) {
    assert.match(read(manifest), /main\/novaflow-seethrough-head-node\.py/, `${manifest} must ship the node file`)
  }
})

test('the split workflow requests the whole-head layer only when facial features are not split and the node exists', () => {
  const source = read(RUNTIME)
  assert.match(source, /state\.seeThroughHeadLayerNodeAvailable = !!data\.NovaFlowSeeThroughHeadLayer/)
  assert.match(source, /function seeThroughWantsHeadLayer\(\) \{\s*return !state\.includeFaceDetails && state\.seeThroughHeadLayerNodeAvailable === true/)
  assert.match(source, /workflow\['10'\] = \{ class_type: 'NovaFlowSeeThroughHeadLayer', inputs: \{ image: \['1', 0\], layers: \['4', 0\], layerdiff_model: \['2', 0\], seed, resolution, num_inference_steps: steps, filename_prefix: prefix \} \}/)
  assert.match(source, /viewOutputPath\(`\$\{prefix\}_head\.json`\)/)
  assert.match(source, /clean = applySeeThroughHeadLayer\(clean\)/, 'the head layer must replace face and feature layers before the leg split and face merge')
})

test('with a whole-head layer the separate face and feature layers are dropped; with the toggle on the head layer is dropped instead', () => {
  const s = loadRuntime()
  const parts = [
    { id: 'hair_front', dataUrl: 'x' },
    { id: 'face', dataUrl: 'x' },
    { id: 'eyebrow_l', dataUrl: 'x' },
    { id: 'irides_r', dataUrl: 'x' },
    { id: 'ears_l', dataUrl: 'x' },
    { id: 'earwear', dataUrl: 'x' },
    { id: 'headwear', dataUrl: 'x' },
    { id: 'head', dataUrl: 'x', seeThroughHeadLayer: true },
    { id: 'body', dataUrl: 'x' }
  ]
  s.state.includeFaceDetails = false
  assert.deepEqual(s.applySeeThroughHeadLayer(parts).map((p) => p.id), ['hair_front', 'earwear', 'headwear', 'head', 'body'])
  s.state.includeFaceDetails = true
  assert.deepEqual(s.applySeeThroughHeadLayer(parts).map((p) => p.id), ['hair_front', 'face', 'eyebrow_l', 'irides_r', 'ears_l', 'earwear', 'headwear', 'body'])
  const noHead = parts.filter((p) => !p.seeThroughHeadLayer)
  s.state.includeFaceDetails = false
  assert.equal(s.applySeeThroughHeadLayer(noHead), noHead, 'without a head layer nothing changes')
})
