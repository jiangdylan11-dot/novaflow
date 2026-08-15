import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')

const sourceBundle = read('particle-editor/assets/index-BbIa-2NM.js')
const rendererBundle = read('particle-editor-desktop/renderer/assets/index-BbIa-2NM.js')
const packagedBundle = read(
  'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/assets/index-BbIa-2NM.js',
)

const dropdownMarker = 'value:aiSeqModelValue,onChange:'
const dropdownStart = sourceBundle.indexOf(dropdownMarker)
assert.notEqual(dropdownStart, -1, 'active AI sequence model selector must exist')
const dropdownSource = sourceBundle.slice(dropdownStart, dropdownStart + 1800)
const options = Array.from(
  dropdownSource.matchAll(/`option`,\{value:`([^`]+)`,children:`([^`]*)`\}/g),
  (match) => ({ value: match[1], label: match[2] }),
)

assert.deepEqual(options, [
  { value: 'local_a', label: 'Wan2_2' },
  { value: 'minimax_h3_local', label: 'MiniMax_h3' },
])
assert.doesNotMatch(dropdownSource, /value:`(?:kling|jimeng)`/)

const presetStart = sourceBundle.indexOf('aiSeqModelPresets={')
const presetEnd = sourceBundle.indexOf('(0,_.useEffect)(()=>{r===`local`', presetStart)
assert.ok(presetStart >= 0 && presetEnd > presetStart, 'active AI sequence presets must be bounded')
const presetSource = sourceBundle.slice(presetStart, presetEnd)
assert.match(presetSource, /local_a:\{mode:`local`,label:`Wan2_2`/)
assert.match(presetSource, /minimax_h3_local:\{mode:`minimax_h3_local`,label:`MiniMax_h3`/)
assert.match(presetSource, /t===`minimax_h3_local`\?\(i\(`minimax_h3_local`\)/)
assert.doesNotMatch(presetSource, /(?:kling|jimeng):\{mode:`cloud`/)

const generatorStart = sourceBundle.indexOf('function Vs(e){')
const generatorEnd = sourceBundle.indexOf('function Hs(e){', generatorStart)
assert.ok(generatorStart >= 0 && generatorEnd > generatorStart, 'active AI sequence generator must be bounded')
const generatorSource = sourceBundle.slice(generatorStart, generatorEnd)
assert.match(generatorSource, /nfH3Runtime\?\[8189\]:\[8188\]/)
assert.doesNotMatch(
  generatorSource,
  /nfH3Runtime\?\[8189\]:\[[^\]]*(?:8e3|8080|7860|3e3)/,
  'Wan Runtime discovery must not probe Comfy Desktop or unrelated local ports',
)
assert.equal(
  Array.from(
    generatorSource.matchAll(
      /\(e\.aiSeqMode===`minimax_h3_local`\?`http:\/\/127\.0\.0\.1:8189`:`http:\/\/127\.0\.0\.1:8188`\)/g,
    ),
  ).length,
  4,
  'all AI sequence transports must use the fixed endpoint for the selected local model',
)
assert.doesNotMatch(
  generatorSource,
  /nfAiSeqResolvedBaseRef\.current\|\|\(e\.aiSeqMode===`minimax_h3_local`/,
  'a stale resolved URL must not override the NovaFlow-owned 8188/8189 endpoints',
)
assert.match(sourceBundle, /let t=await Ne\(`http:\/\/127\.0\.0\.1:8188`,`\/object_info`\)/)
assert.match(
  sourceBundle,
  /nfWanVisibleModel=e=>!String\(e\|\|``\)\.toLowerCase\(\)\.replaceAll\(String\.fromCharCode\(92\),`\/`\)\.split\(`\/`\)\.includes\(`minimax_h3`\)/,
  'Wan model choices must exclude paths inside the minimax_h3 directory',
)

assert.equal(rendererBundle, sourceBundle, 'renderer bundle mirror must match the authoritative bundle')
assert.equal(packagedBundle, sourceBundle, 'win-unpacked bundle mirror must match the authoritative bundle')

const cacheKey = 'index-BbIa-2NM.js?v=20260812-minimax-h3-assistant-1'
for (const indexPath of [
  'particle-editor/index.html',
  'particle-editor-desktop/renderer/index.html',
  'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html',
]) {
  assert.ok(read(indexPath).includes(cacheKey), `${indexPath} must publish the MiniMax H3 selector revision`)
}

console.log('AI sequence Wan2_2 / MiniMax_h3 model contract passed.')
