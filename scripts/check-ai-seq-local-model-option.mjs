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

// The WAN 2.2 local line was retired on 2026-09-16. MiniMax H3 is the only local model.
const dropdownMarker = 'value:aiSeqModelValue,onChange:'
const dropdownStart = sourceBundle.indexOf(dropdownMarker)
assert.notEqual(dropdownStart, -1, 'active AI sequence model selector must exist')
const dropdownSource = sourceBundle.slice(dropdownStart, dropdownStart + 1800)
const options = Array.from(
  dropdownSource.matchAll(/`option`,\{value:`([^`]+)`,children:`([^`]*)`\}/g),
  (match) => ({ value: match[1], label: match[2] }),
)

assert.deepEqual(options, [{ value: 'minimax_h3_local', label: 'MiniMax_h3' }], 'MiniMax_h3 must be the only local model option')
assert.doesNotMatch(dropdownSource, /value:`(?:kling|jimeng|local_a)`/)

assert.match(sourceBundle, /aiSeqModelValue=`minimax_h3_local`,aiSeqWanModel=!1/, 'model selector value must be pinned to MiniMax H3')
assert.match(
  sourceBundle,
  /applyAiSeqModelValue=\(\)=>\{i\(`minimax_h3_local`\),nfSetAiSeqGenType\?\.\(`text_video`\)\};/,
  'model selector must only apply MiniMax H3',
)
assert.match(
  sourceBundle,
  /\(0,_\.useEffect\)\(\(\)=>\{r===`local`&&i\(`minimax_h3_local`\)\},\[r,i\]\);/,
  'a leftover WAN local mode must be coerced to MiniMax H3',
)
assert.match(
  sourceBundle,
  /\[u,d\]=\(0,_\.useState\)\(\(\)=>`minimax_h3_local`\),\[f,p\]=\(0,_\.useState\)\(\(\)=>`text_video`\)/,
  'AI sequence must start in MiniMax H3 mode',
)
assert.doesNotMatch(
  sourceBundle,
  /aiSeqModelValue=r===`minimax_h3_local`\?`minimax_h3_local`:`local_a`/,
  'the retired WAN selector value must not return',
)

const presetStart = sourceBundle.indexOf('aiSeqModelPresets={')
assert.ok(presetStart >= 0, 'active AI sequence presets must exist')
assert.match(sourceBundle.slice(presetStart, presetStart + 1200), /minimax_h3_local:\{mode:`minimax_h3_local`,label:`MiniMax_h3`/)

const generatorStart = sourceBundle.indexOf('function Vs(e){')
const generatorEnd = sourceBundle.indexOf('function Hs(e){', generatorStart)
assert.ok(generatorStart >= 0 && generatorEnd > generatorStart, 'active AI sequence generator must be bounded')
const generatorSource = sourceBundle.slice(generatorStart, generatorEnd)
assert.match(generatorSource, /nfH3Runtime\?\[8189\]:\[8188\]/)
assert.equal(
  Array.from(
    generatorSource.matchAll(
      /\(e\.aiSeqMode===`minimax_h3_local`\?`http:\/\/127\.0\.0\.1:8189`:`http:\/\/127\.0\.0\.1:8188`\)/g,
    ),
  ).length,
  4,
  'all AI sequence transports must use the fixed endpoint for the selected local model',
)

assert.equal(rendererBundle, sourceBundle, 'renderer bundle mirror must match the authoritative bundle')
assert.equal(packagedBundle, sourceBundle, 'win-unpacked bundle mirror must match the authoritative bundle')

const cacheKey = 'index-BbIa-2NM.js?v=20260920-aifx-particle-idle-1'
for (const indexPath of [
  'particle-editor/index.html',
  'particle-editor-desktop/renderer/index.html',
  'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html',
]) {
  const indexHtml = read(indexPath)
  assert.ok(indexHtml.includes(cacheKey), `${indexPath} must publish the MiniMax H3-only selector revision`)
  assert.doesNotMatch(indexHtml, /ai-sequence-wan22-lora/, `${indexPath} must not load the retired WAN LoRA modules`)
}

console.log('AI sequence MiniMax_h3-only local model contract passed.')
