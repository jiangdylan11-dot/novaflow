import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')

const bundle = read('particle-editor/assets/index-BbIa-2NM.js')
const h3Resource = read('particle-editor/ai-sequence-minimax-h3.resource.js')
const h3LoraResource = read('particle-editor/ai-sequence-minimax-h3-lora.resource.js')
const h3Workflow = read('particle-editor/ai-sequence-minimax-h3.workflow.js')
const wanLoraResource = read('particle-editor/ai-sequence-wan22-lora.resource.js')
const wanLoraWorkflow = read('particle-editor/ai-sequence-wan22-lora.workflow.js')
const wanLoraCatalog = read('particle-editor-desktop/main/wan22-lora-catalog.js')
const desktopMain = read('particle-editor-desktop/main.js')

const presetStart = bundle.indexOf('aiSeqModelPresets={')
const presetEnd = bundle.indexOf('(0,_.useEffect)(()=>{r===`local`', presetStart)
assert.ok(presetStart >= 0 && presetEnd > presetStart, 'active AI sequence preset block must exist')
const presets = bundle.slice(presetStart, presetEnd)
assert.match(presets, /local_a:\{mode:`local`,label:`Wan2_2`/)
assert.match(presets, /minimax_h3_local:\{mode:`minimax_h3_local`,label:`MiniMax_h3`/)
assert.doesNotMatch(presets, /mode:`cloud`|value:`(?:kling|jimeng)`/)

const generationStart = bundle.indexOf(',j=async nfH3SubmitOptions=>{try{let t=e.aiSeqRunTokenRef.current+=1,')
const generationEnd = bundle.indexOf('let _=nfH3Mode?nfH3ValidatedLoras.length:', generationStart)
assert.ok(generationStart >= 0 && generationEnd > generationStart, 'active AI sequence submit branch must exist')
const generation = bundle.slice(generationStart, generationEnd + 128)
assert.match(generation, /nfCloudMode=!1/)
assert.match(generation, /nfCloudSubmitSnapshot=null/)
assert.match(generation, /nfH3Mode=e\.aiSeqMode===`minimax_h3_local`/)
assert.match(
  generation,
  /let _=nfH3Mode\?nfH3ValidatedLoras\.length:nfWanValidatedLoras\.length/,
  'H3 and Wan LoRA display accounting must use only local validation results',
)
assert.equal(Array.from(generation.matchAll(/validateSelection\(nfWanSubmitContext\)/g)).length, 2, 'Wan LoRAs must be validated before upload and immediately before workflow construction')
assert.match(
  generation,
  /loras:\[\]\}\);let nfWanRoleWorkflow=[\s\S]*?buildRoleAwareWorkflow\(u,nfWanValidatedLoras\)\.workflow/,
  'Wan Cn must stay LoRA-free before the role-aware workflow consumes the final validation result',
)
assert.doesNotMatch(generation, /loras:nfWanValidatedLoras/, 'Wan must not inject one unpartitioned LoRA list through the legacy Cn helper')
assert.doesNotMatch(generation, /loras:Array\.isArray\(e\.aiSeqComfyLoras\)/, 'Wan workflow construction must not use legacy renderer selection state')
assert.match(bundle, /if\(e\.aiSeqMode!==`minimax_h3_local`&&a\?\.comfyRequestJson\)/, 'H3 JSON must bypass the shared provider proxy')
assert.match(bundle, /if\(e\.aiSeqMode!==`minimax_h3_local`&&a\?\.comfyRequestBinary\)/, 'H3 output fetch must bypass the shared provider proxy')
assert.match(bundle, /if\(e\.aiSeqMode!==`minimax_h3_local`&&a\?\.comfyUploadImage\)/, 'H3 uploads must bypass the shared provider proxy')
assert.match(bundle, /let r=nfH3Runtime\?\[8189\]:\[/, 'H3 runtime probing must be isolated to port 8189')
assert.match(bundle, /nfAiSeqResolvedBaseRef\.current=t;if\(!nfH3Runtime\)\{try\{localStorage\.setItem\(`comfyui_last_connected_url`,t\)\}/, 'H3 must not persist 8189 into the shared Wan Runtime URL')
assert.match(bundle, /if\(!nfH3Mode\)\{try\{await fetch\(`http:\/\/127\.0\.0\.1:8189\/free`[\s\S]{0,420}minimaxH3RuntimeStop/, 'Wan generation must stop a residual H3 Runtime before GPU use')

for (const [label, source] of [
  ['MiniMax H3 resource module', h3Resource],
  ['MiniMax H3 LoRA resource module', h3LoraResource],
  ['MiniMax H3 workflow module', h3Workflow],
  ['Wan2.2 LoRA resource module', wanLoraResource],
  ['Wan2.2 role-aware LoRA workflow module', wanLoraWorkflow],
  ['Wan2.2 LoRA catalog module', wanLoraCatalog],
]) {
  assert.doesNotMatch(source, /clientAuth|credits?(?:Check|Authorize|Reserve|Settle)|runtime-fetch-proxy|providerUsage/i, `${label} must stay independent from cloud credit and provider authorization`)
}
assert.doesNotMatch(wanLoraResource, /object_info|comfyRequestJson|127\.0\.0\.1:8188|fetch\s*\(/, 'Wan renderer Resource must not expose a raw Runtime fallback')
for (const channel of ['wan22-lora-catalog', 'wan22-lora-validate']) {
  const start = desktopMain.indexOf(`ipcMain.handle("${channel}"`)
  const end = desktopMain.indexOf('ipcMain.handle("', start + 20)
  assert.ok(start >= 0 && end > start, `${channel} narrow IPC must exist`)
  assert.doesNotMatch(desktopMain.slice(start, end), /clientAuth|credit|providerUsage|runtimeRequestJson|8189/i, `${channel} must remain a local NovaFlow Runtime operation`)
}

const tests = [
  'particle-editor-desktop/tests/ai-sequence-minimax-h3-surface.test.js',
  'particle-editor-desktop/tests/ai-sequence-minimax-h3-lora-resource.test.js',
  'particle-editor-desktop/tests/minimax-h3-lora-catalog.test.js',
  'particle-editor-desktop/tests/minimax-h3-lora-ipc.test.js',
  'particle-editor-desktop/tests/minimax-h3-runtime-ipc.test.js',
  'particle-editor-desktop/tests/ai-sequence-wan22-lora-resource.test.js',
  'particle-editor-desktop/tests/ai-sequence-wan22-lora-workflow.test.js',
  'particle-editor-desktop/tests/wan22-lora-catalog.test.js',
  'particle-editor-desktop/tests/wan22-lora-ipc.test.js',
  'particle-editor-desktop/tests/ai-sequence-lora-preview-bridge.test.js',
  'particle-editor-desktop/tests/proxy-electron-api-ai-sequence-lora.test.js',
  'particle-editor-desktop/tests/art-generate-credit-pricing-tool.test.js',
  'particle-editor-desktop/tests/art-generate-provider-runtime-contract.test.js',
]
const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: root,
  stdio: 'inherit',
})
assert.equal(result.error, undefined, result.error?.message)
assert.equal(result.status, 0, 'AI sequence credit isolation or Art Generate credit regression tests failed')

console.log('AI sequence local credit isolation and Art Generate credit contracts passed.')
