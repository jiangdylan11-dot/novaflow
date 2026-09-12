// Generate API fixtures through the same workflow module used by NovaFlow.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const context = { globalThis: {} }
vm.runInNewContext(fs.readFileSync(path.join(root, 'particle-editor/ai-sequence-minimax-h3.workflow.js'), 'utf8'), context)
const api = context.globalThis.NovaFlowAiSequenceMiniMaxH3Workflow
const out = process.argv[2]
if (!out) throw Error('Usage: node build-lightx-smoke.cjs <output-directory>')
fs.mkdirSync(out, { recursive: true })
const prompt = 'A small red wooden toy sailboat gently floating on a calm pond, soft morning sunlight, reeds in the background, steady camera, natural water sounds.'
for (const [name, profile, mode, steps] of [
  ['classic-t2v-4', 'classic', 't2v', 4],
  ['lightx-t2v-4', 'lightx_768', 't2v', 4],
  ['lightx-t2v-8', 'lightx_768', 't2v', 8],
  ['lightx-i2v-4', 'lightx_768', 'i2v', 4],
  ['lightx-fl2v-4', 'lightx_768', 'fl2v', 4],
  ['lightx-r2v-4', 'lightx_768', 'r2v', 4],
  ['lightx-r2v-8', 'lightx_768', 'r2v', 8],
  ['classic-t2v-warm', 'classic', 't2v', 4],
  ['lightx-t2v-warm', 'lightx_768', 't2v', 4],
  ['classic-t2v-compare', 'classic', 't2v', 4],
  ['lightx-t2v-compare', 'lightx_768', 't2v', 4],
]) {
  const images = mode === 't2v' ? {} : mode === 'r2v'
    ? { referenceImages: ['h3-acceptance-first.png', 'h3-acceptance-last.png'] }
    : { firstFrame: 'h3-acceptance-first.png', ...(mode === 'fl2v' ? { lastFrame: 'h3-acceptance-last.png' } : {}) }
  const options = { profile, mode, steps, prompt: mode === 'r2v' ? '<Picture 1> and <Picture 2> show the same toy sailboat. ' + prompt : prompt, width: 576, height: 352, durationSeconds: 1, fps: 24, seed: 20260912, outputPrefix: 'h3-acceptance/' + name, ...images }
  if (name.endsWith('-warm')) options.seed = 20260913
  if (name.endsWith('-compare')) options.seed = 20260914
  const graph = api.buildWorkflow(options)
  api.validateWorkflow(graph, options)
  fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify({ options, prompt: graph }, null, 2))
}
console.log('Wrote H3 acceptance workflows to', out)
