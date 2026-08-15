import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file) => readFileSync(file, 'utf8')
const compiler = read('particle-editor/art-reference-compiler.workflow.js')
const smartAi = read('particle-editor/novaflow-smart-ai.js')
const runtime = read('particle-editor/novaflow-brand-runtime.js')
const index = read('particle-editor/index.html')

assert.match(index, /art-reference-compiler\.workflow\.js/, 'renderer must load reference compiler before SmartAI')
assert.match(compiler, /SDPoseKeypointExtractor/, 'pose role must use SDPose when its checkpoint is installed')
assert.match(compiler, /BiRefNetRMBG/, 'background role must use foreground isolation')
assert.match(compiler, /class_type: "Canny"/, 'layout and composition roles must compile to structural maps')
assert.match(compiler, /TEXT_ONLY_ROLES = new Set\(\["style", "color", "material"\]\)/, 'style, color and material must remain text-only')
assert.match(smartAi, /fingerprints:/, 'reference plan must be bound to current image content')
assert.doesNotMatch(smartAi, /plan\.prompt !==/, 'reference plan must not be invalidated by prompt editing')
assert.match(runtime, /applyArtReferenceControlNet/, 'runtime must apply strong structural control when available')
assert.match(runtime, /ControlNetApplyAdvanced/, 'strong control must be inserted in the final sampling workflow')
assert.match(runtime, /const refs = rolePlan\s*\?/, 'a valid role plan must own final reference routing')

console.log('art-reference-compiler-contract: PASS')
