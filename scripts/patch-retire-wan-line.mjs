import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Retires the WAN 2.2 local video line from the AI sequence panel.
// MiniMax H3 becomes the only local model: the selector, the initial mode and any
// persisted `local` mode are pinned to `minimax_h3_local`. The dead WAN generation
// branches stay in the bundle but are unreachable.

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const bundlePath = path.join(repoRoot, 'particle-editor', 'assets', 'index-BbIa-2NM.js')

let source = fs.readFileSync(bundlePath, 'utf8')

function occurrenceCount(haystack, needle) {
  let count = 0
  let cursor = 0
  while (true) {
    const index = haystack.indexOf(needle, cursor)
    if (index < 0) return count
    count += 1
    cursor = index + needle.length
  }
}

function replaceOnceOrAlready(search, replacement, label) {
  const count = occurrenceCount(source, search)
  if (count === 1) {
    source = source.replace(search, () => replacement)
    console.log(`patched: ${label}`)
    return
  }
  if (count === 0 && (replacement === '' || occurrenceCount(source, replacement) >= 1)) {
    console.log(`already applied: ${label}`)
    return
  }
  throw new Error(`${label}: expected exactly one match, found ${count}`)
}

replaceOnceOrAlready(
  '[u,d]=(0,_.useState)(()=>`local`),[f,p]=(0,_.useState)(()=>`image_video`)',
  '[u,d]=(0,_.useState)(()=>`minimax_h3_local`),[f,p]=(0,_.useState)(()=>`text_video`)',
  'AI sequence starts in MiniMax H3 mode',
)

replaceOnceOrAlready(
  'aiSeqModelValue=r===`minimax_h3_local`?`minimax_h3_local`:`local_a`,aiSeqWanModel=aiSeqModelValue===`local_a`',
  'aiSeqModelValue=`minimax_h3_local`,aiSeqWanModel=!1',
  'model selector value is pinned to MiniMax H3',
)

replaceOnceOrAlready(
  'applyAiSeqModelValue=e=>{let t=String(e||`local_a`),n=aiSeqModelPresets[t]||aiSeqModelPresets.local_a;t===`minimax_h3_local`?(i(`minimax_h3_local`),nfSetAiSeqGenType?.(`text_video`)):(fetch(`http://127.0.0.1:8189/free`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify({unload_models:!0,free_memory:!0})}).catch(()=>{}),window.electronAPI?.minimaxH3RuntimeStop?.({timeoutMs:3e4}).catch?.(()=>{}),i(`local`),[`image_video`,`first_last`].includes(a)||nfSetAiSeqGenType?.(`image_video`),g(`http://127.0.0.1:8188`),x(n.high||``),C(n.low||``))};',
  'applyAiSeqModelValue=()=>{i(`minimax_h3_local`),nfSetAiSeqGenType?.(`text_video`)};',
  'model selector only applies MiniMax H3',
)

replaceOnceOrAlready(
  '(0,_.useEffect)(()=>{r===`local`&&(()=>{let e=`http://127.0.0.1:8188`;h!==e&&g(e);try{localStorage.setItem(`comfyui_last_connected_url`,e)}catch{}b!==aiSeqModelPresets.local_a.high&&x(aiSeqModelPresets.local_a.high),S!==aiSeqModelPresets.local_a.low&&C(aiSeqModelPresets.local_a.low)})()},[r,h,b,S]);',
  '(0,_.useEffect)(()=>{r===`local`&&i(`minimax_h3_local`)},[r,i]);',
  'leftover WAN local mode is coerced to MiniMax H3',
)

replaceOnceOrAlready(
  '(0,X.jsx)(`option`,{value:`local_a`,children:`Wan2_2`}),',
  '',
  'Wan2_2 option removed from the model selector',
)

fs.writeFileSync(bundlePath, source, 'utf8')
console.log(`wrote ${path.relative(repoRoot, bundlePath)}`)
