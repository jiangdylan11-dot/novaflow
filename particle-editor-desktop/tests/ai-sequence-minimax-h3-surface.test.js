const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const bundlePath = path.join(root, 'particle-editor', 'assets', 'index-BbIa-2NM.js')
const indexPath = path.join(root, 'particle-editor', 'index.html')
const runtimePath = path.join(root, 'particle-editor', 'novaflow-brand-runtime.js')
const patchScriptPath = path.join(root, 'scripts', 'patch-ai-sequence-minimax-h3.mjs')
const mainPath = path.join(root, 'particle-editor-desktop', 'main.js')
const preloadPath = path.join(root, 'particle-editor-desktop', 'preload.js')
const bundle = fs.readFileSync(bundlePath, 'utf8')
const indexHtml = fs.readFileSync(indexPath, 'utf8')
const runtimeSource = fs.readFileSync(runtimePath, 'utf8')
const patchScript = fs.readFileSync(patchScriptPath, 'utf8')
const mainSource = fs.readFileSync(mainPath, 'utf8')
const preloadSource = fs.readFileSync(preloadPath, 'utf8')

function enclosingMemoComponentForMarker(source, marker, label) {
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `${label} marker must exist: ${marker}`)

  const componentPattern = /\bvar\s+[$A-Z_a-z][$\w]*=\(0,[$A-Z_a-z][$\w]*\.memo\)\(function\([^)]*\)\{/g
  let owner = null
  for (const match of source.slice(0, markerIndex).matchAll(componentPattern)) owner = match
  assert.ok(owner, `${label} must be owned by a memo component`)

  const start = owner.index
  const nextNamedFunction = /\bfunction\s+[$A-Z_a-z][$\w]*\(/g
  nextNamedFunction.lastIndex = markerIndex + marker.length
  const boundary = nextNamedFunction.exec(source)
  assert.ok(boundary, `${label} memo component must have a bounded end`)
  const end = boundary.index
  return source.slice(start, end)
}

function balancedObjectAt(source, openIndex, label) {
  assert.equal(source[openIndex], '{', `${label} must start with an object literal`)

  let depth = 0
  let quote = null
  let escaped = false
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '`' || character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, index + 1)
    }
  }

  assert.fail(`${label} object literal must have a balanced closing brace`)
}

function namedFunctionSource(source, name) {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${name} must exist`)
  const bodyStart = source.indexOf('{', start + marker.length)
  assert.notEqual(bodyStart, -1, `${name} must have a body`)
  return source.slice(start, bodyStart) + balancedObjectAt(source, bodyStart, name)
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase()
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function modeArrays(component) {
  const arrayPattern = /\[(\s*\{value:`(?:text_video|image_video|first_last|multi_reference)`,label:`[^`]+`\}\s*(?:,\s*\{value:`(?:text_video|image_video|first_last|multi_reference)`,label:`[^`]+`\}\s*)*)\]/g
  const entryPattern = /\{value:`([^`]+)`,label:`([^`]+)`\}/g

  return Array.from(component.matchAll(arrayPattern), (arrayMatch) =>
    Array.from(arrayMatch[1].matchAll(entryPattern), (entryMatch) => ({
      value: entryMatch[1],
      label: entryMatch[2],
    })),
  )
}

function scriptSources(html) {
  return Array.from(
    html.matchAll(/<script\b[^>]*\bsrc=["']\.\/([^"'?]+)(?:\?[^"']*)?["'][^>]*>/gi),
    (match) => match[1],
  )
}

test('AI sequence model selector exposes only local MiniMax_h3 after the Wan2_2 retirement', () => {
  const marker = 'value:aiSeqModelValue,onChange:'
  const markerIndex = bundle.indexOf(marker)
  assert.notEqual(markerIndex, -1, 'AI sequence model select must keep an explicit selected-model value')
  const selectFragment = bundle.slice(markerIndex, markerIndex + 1800)
  const options = Array.from(
    selectFragment.matchAll(/`option`,\{value:`([^`]+)`,children:`([^`]*)`\}/g),
    (match) => ({ value: match[1], label: match[2] }),
  )

  assert.deepEqual(options, [
    { value: 'minimax_h3_local', label: 'MiniMax_h3' },
  ])
  assert.doesNotMatch(selectFragment, /value:`(?:kling|jimeng|local_a)`/)
  assert.match(bundle, /aiSeqModelValue=`minimax_h3_local`,aiSeqWanModel=!1/, 'the selector value must be pinned to MiniMax_h3')
  assert.match(
    bundle,
    /\[u,d\]=\(0,_\.useState\)\(\(\)=>`minimax_h3_local`\)/,
    'AI sequence must start in MiniMax_h3 mode now that the Wan2_2 local line is retired',
  )
})

test('MiniMax_h3 owns four ordered top modes while Wan keeps its two established modes', () => {
  const topModeComponent = enclosingMemoComponentForMarker(
    bundle,
    'data-novaflow-ai-top-mode-tabs',
    'AI sequence top-mode component',
  )
  const modes = modeArrays(topModeComponent)

  assert.match(
    topModeComponent,
    /(?:===|==)`minimax_h3_local`/,
    'top modes must be gated by the selected H3 model',
  )
  assert.deepEqual(modes, [
    [
      { value: 'text_video', label: '文生视频' },
      { value: 'image_video', label: '图生视频' },
      { value: 'first_last', label: '首尾帧视频' },
      { value: 'multi_reference', label: '多参视频' },
    ],
    [
      { value: 'image_video', label: '图生视频' },
      { value: 'first_last', label: '首尾帧视频' },
    ],
  ])
})

test('MiniMax_h3 dispatch is isolated from Wan controls and accepts only validated H3 LoRAs', () => {
  const workflowMarker = 'NovaFlowAiSequenceMiniMaxH3Workflow'
  const workflowIndex = bundle.indexOf(workflowMarker)
  assert.notEqual(workflowIndex, -1, 'bundle must dispatch H3 through its dedicated workflow module')

  const buildCallIndex = bundle.indexOf('.buildWorkflow(', workflowIndex)
  assert.notEqual(buildCallIndex, -1, 'H3 workflow module must call buildWorkflow')
  const buildOptionsStart = bundle.indexOf('{', buildCallIndex)
  assert.notEqual(buildOptionsStart, -1, 'H3 buildWorkflow must receive an options object')
  const buildOptions = balancedObjectAt(bundle, buildOptionsStart, 'H3 buildWorkflow options')

  const routeFragment = bundle.slice(Math.max(0, workflowIndex - 12000), buildCallIndex)
  assert.match(
    routeFragment,
    /minimax_h3_local/,
    'dedicated H3 workflow dispatch must be explicitly guarded by minimax_h3_local',
  )
  assert.doesNotMatch(
    buildOptions,
    /\b(?:(?:aiSeqComfy)?(?:high|low|unet|negative)\w*|aiSeqFps)\b/i,
    'H3 workflow options must not inherit Wan high/low UNET, negative, or shared FPS fields',
  )
  assert.doesNotMatch(buildOptions, /aiSeqComfyLoras/, 'H3 must not inherit the Wan LoRA state')
  assert.match(
    buildOptions,
    /loras\s*:\s*nfH3ValidatedLoras/,
    'H3 must receive only the dedicated Resource validation result',
  )
  assert.match(
    buildOptions,
    /\baspectRatio\s*:/,
    'H3 dispatch must pass the selected aspect ratio to the workflow module',
  )
  assert.match(
    buildOptions,
    /\bmegapixels\s*:/,
    'H3 dispatch must pass the selected megapixel target to the workflow module',
  )
  assert.match(
    buildOptions,
    /\bdurationSeconds\s*:/,
    'H3 dispatch must pass free-form seconds to the workflow module',
  )
  assert.match(
    buildOptions,
    /aspectRatio\s*:\s*nfH3SubmitOptions\?\.aspectRatio\s*\|\|\s*`9:16`/,
    'H3 dispatch must use the submit-time aspect-ratio snapshot',
  )
  assert.match(
    buildOptions,
    /megapixels\s*:\s*Number\(nfH3SubmitOptions\?\.megapixels\)\s*\|\|\s*\.4/,
    'H3 dispatch must use the submit-time resolution snapshot',
  )
  assert.match(
    buildOptions,
    /durationSeconds\s*:\s*nfH3SubmitOptions\?\.durationSeconds/,
    'H3 dispatch must use the submit-time duration snapshot',
  )
  assert.match(
    buildOptions,
    /fps\s*:\s*nfH3SubmitOptions\?\.fps/,
    'H3 dispatch must pass the submit-time output FPS snapshot',
  )
  assert.match(
    buildOptions,
    /steps\s*:\s*nfH3SubmitOptions\?\.steps/,
    'H3 dispatch must pass the submitted integer steps in every mode',
  )
  assert.doesNotMatch(buildOptions, /nfH3ModeName===`r2v`\?20:/)
  assert.doesNotMatch(
    buildOptions,
    /aiSeqOut(?:W|H|Frames)|aiSeqSampleSteps|Number\(e\.aiSeqOutFrames\)\s*\/\s*24/,
    'H3 parameters must not be reconstructed from shared Wan width, height, frame, or steps state',
  )
  assert.match(
    bundle,
    /j=async nfH3SubmitOptions=>/,
    'the generator must accept the submit-time H3 parameter snapshot',
  )
  assert.match(
    bundle,
    /nfH3SubmitSnapshot=ze===`minimax_h3_local`\?\(\(\)=>\{let e=nfCommitH3Duration\(nfH3DurationInput\);return\{profile:nfH3Profile,acceleration:nfH3Acceleration,aspectRatio:nfH3AspectRatio,megapixels:nfH3Megapixels,durationSeconds:e\.requestedDuration,fps:nfH3Fps,steps:nfCommitH3Steps\(nfH3Steps\)\}\}\)\(\):null[\s\S]{0,80}Er\(nfH3SubmitSnapshot\|\|void 0\)/,
    'clicking Generate must synchronously snapshot duration, FPS, and integer steps without a mode override',
  )
  assert.doesNotMatch(
    buildOptions,
    /\[`480x864`,`864x480`,`768x1344`,`1344x768`\]|\[124,192,243,362\]/,
    'H3 dispatch must not retain the retired fixed resolution or duration whitelist',
  )

  const validationIndex = bundle.indexOf(
    'validateSelection({mode:a,steps:nfH3SubmitOptions?.steps})',
    workflowIndex,
  )
  const firstUploadIndex = bundle.indexOf('for(let n of o){', validationIndex)
  const finalValidationIndex = bundle.indexOf(
    'validateSelection({mode:a,steps:nfH3SubmitOptions?.steps})',
    validationIndex + 1,
  )
  const lastUploadCompletionIndex = bundle.indexOf('nfAudios.push(', firstUploadIndex)
  const promptSubmitIndex = bundle.indexOf('f(`/prompt`', buildCallIndex)
  assert.ok(
    validationIndex >= 0 && firstUploadIndex > validationIndex && buildCallIndex > firstUploadIndex,
    'H3 LoRA selection must be revalidated before media upload and workflow construction',
  )
  assert.ok(
    lastUploadCompletionIndex > firstUploadIndex &&
      finalValidationIndex > lastUploadCompletionIndex &&
      buildCallIndex > finalValidationIndex &&
      promptSubmitIndex > buildCallIndex,
    'H3 LoRA selection must be revalidated again after the final upload and immediately before workflow construction',
  )
  assert.equal(
    Array.from(routeFragment.matchAll(/validateSelection\(\{mode:a,steps:nfH3SubmitOptions\?\.steps\}\)/g)).length,
    2,
    'H3 submit must retain both the fail-fast and final anti-TOCTOU validations',
  )
  assert.match(
    routeFragment,
    /catch\(nfH3LoraError\)\{e\.setAiSeqJob\(\{state:`error`,message:`MiniMax H3 LoRA 校验失败：\$\{String\(nfH3LoraError\?\.message\|\|nfH3LoraError\)\}`\}\);return\}/,
    'a failed compatibility recheck must stop submission with a visible error',
  )
  assert.match(
    routeFragment,
    /catch\(nfH3FinalLoraError\)\{e\.setAiSeqJob\(\{state:`error`,message:`MiniMax H3 LoRA 最终校验失败：\$\{String\(nfH3FinalLoraError\?\.message\|\|nfH3FinalLoraError\)\}`\}\);return\}/,
    'a final fingerprint failure must stop before workflow construction and prompt submission',
  )
})

test('MiniMax_h3 LoRA controls consume only the dedicated compatible catalog store', () => {
  const stateStart = bundle.indexOf('[nfH3LoraSnapshot,nfSetH3LoraSnapshot]')
  const stateEnd = bundle.indexOf(',Fr=Ja(`ai_seq_prompt`', stateStart)
  assert.ok(stateStart >= 0 && stateEnd > stateStart, 'H3 LoRA state must have stable boundaries')
  const stateFragment = bundle.slice(stateStart, stateEnd)
  assert.match(stateFragment, /NovaFlowAiSequenceMiniMaxH3LoraResource/)
  assert.match(stateFragment, /getSnapshot\?\.\(\)/)
  assert.match(stateFragment, /subscribe\(t\)/)
  assert.match(stateFragment, /setContext\?\.\(\{mode:t,steps:n\}\)/)
  assert.match(stateFragment, /refreshCatalog\(\{mode:t,steps:n\}\)/)
  assert.match(stateFragment, /\[ze,Ve,nfH3Steps,nfH3Profile\]/)
  assert.match(
    stateFragment,
    /Array\.isArray\(nfH3LoraSnapshot\?\.items\)\?nfH3LoraSnapshot\.items:\[\]/,
    'candidate options must come only from the filtered H3 snapshot items',
  )
  assert.doesNotMatch(stateFragment, /aiSeqComfyLoras|127\.0\.0\.1:8188|object_info/)

  const panelFunctionMarker = 'function nn(e){let{SegmentedTabs:'
  const panelFunctionStart = bundle.indexOf(panelFunctionMarker)
  assert.notEqual(panelFunctionStart, -1, 'the nn model-panel function must exist')
  const panelBodyStart = bundle.indexOf('{', panelFunctionStart)
  const panelComponent = bundle.slice(panelFunctionStart, panelBodyStart) +
    balancedObjectAt(bundle, panelBodyStart, 'nn model-panel function')
  const panelStateStart = panelComponent.indexOf('[nfPanelH3LoraSnapshot,nfSetPanelH3LoraSnapshot]')
  const panelStateEnd = panelComponent.indexOf(',[nfPanelWanLoraSnapshot,nfSetPanelWanLoraSnapshot]', panelStateStart)
  assert.ok(panelStateStart >= 0 && panelStateEnd > panelStateStart, 'model-panel H3 LoRA state must be defined inside nn')
  const panelStateFragment = panelComponent.slice(panelStateStart, panelStateEnd)
  assert.match(panelStateFragment, /NovaFlowAiSequenceMiniMaxH3LoraResource/)
  assert.match(panelStateFragment, /getSnapshot\?\.\(\)/)
  assert.match(panelStateFragment, /subscribe\(t\)/)
  assert.match(
    panelStateFragment,
    /Array\.isArray\(nfPanelH3LoraSnapshot\?\.items\)\?nfPanelH3LoraSnapshot\.items:\[\]/,
    'the panel candidate options must come only from the shared Resource snapshot',
  )
  assert.doesNotMatch(
    panelStateFragment,
    /setContext|refreshCatalog|nfH3LoraSnapshot|nfH3SubmitSteps|\bze\b/,
    'the panel may subscribe but must not duplicate the main workspace catalog refresh or capture its variables',
  )

  const uiStart = panelComponent.indexOf('r===`minimax_h3_local`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-h3-lora-section":`1`')
  const uiEnd = panelComponent.indexOf(',(0,X.jsxs)(`div`,{"data-novaflow-ai-post-section":`1`', uiStart)
  assert.ok(uiStart >= 0 && uiEnd > uiStart, 'H3 LoRA surface must be owned by the nn model-panel function')
  const uiFragment = panelComponent.slice(uiStart, uiEnd)
  assert.doesNotMatch(uiFragment, /data-novaflow-h3-internal-turbo/)
  assert.match(uiFragment, /"data-novaflow-h3-lora-add":`1`/)
  assert.match(uiFragment, /\.\.\.nfPanelH3LoraAvailable\(\)\.map/)
  assert.match(uiFragment, /setSelection\?\.\(\[\.\.\.n,\{name:t\}\]\)/)
  assert.match(uiFragment, /updateStrength\?\.\(e\.name,Number\(t\.target\.value\)\)/)
  assert.match(uiFragment, /"data-novaflow-h3-lora-remove":`1`/)
  assert.match(uiFragment, /remove\?\.\(e\.name\)/)
  assert.match(uiFragment, /当前模式与步数暂无兼容 LoRA/)
  assert.doesNotMatch(
    uiFragment,
    /aiSeqComfyLoras|127\.0\.0\.1:8188|object_info|暂无LORA|nfH3LoraSnapshot|nfH3SubmitSteps|\bze\b/,
    'the model-panel UI must not close over main-workspace H3 or Wan state',
  )

  const panelSnapshot = {
    steps: 4,
    items: [{ name: 'compatible.safetensors' }],
    selected: [],
    loading: false,
    error: '',
  }
  const jsx = (type, props) => ({ type, props })
  const renderContext = {
    r: 'minimax_h3_local',
    window: { NovaFlowAiSequenceMiniMaxH3Workflow: { getSelectedProfile: () => 'classic' } },
    X: { jsx, jsxs: jsx },
    Qt: 'label',
    tn: 'select',
    nfPanelH3LoraSnapshot: panelSnapshot,
    nfPanelH3LoraAvailable: () => panelSnapshot.items,
    nfPanelH3LoraApi: () => ({}),
    o: () => {},
  }
  const rendered = vm.runInNewContext(uiFragment, renderContext)
  assert.equal(rendered?.props?.['data-novaflow-h3-lora-section'], '1')
  assert.equal(rendered?.props?.['data-novaflow-ai-mode-body-item'], '1')
  assert.equal(rendered?.props?.children?.[1]?.props?.['data-novaflow-h3-internal-turbo'], undefined)
  assert.equal(
    vm.runInNewContext(uiFragment, { ...renderContext, r: 'local' }),
    false,
    'the executable model-panel condition must render H3 controls only for the H3 prop',
  )
  assert.match(patchScript, /H3 LoRA submit validation before media uploads/)
  assert.match(patchScript, /model-panel H3 LoRA snapshot subscription/)
  assert.match(patchScript, /final H3 LoRA validation after all uploads and before workflow construction/)
  assert.match(patchScript, /validated H3 LoRAs passed to the workflow module/)
})

test('Wan2.2 High Low and shared LoRA controls consume only the independent fail-closed catalog store', () => {
  const panelFunctionStart = bundle.indexOf('function nn(e){let{SegmentedTabs:')
  assert.notEqual(panelFunctionStart, -1, 'the nn model-panel function must exist')
  const panelBodyStart = bundle.indexOf('{', panelFunctionStart)
  const panelComponent = bundle.slice(panelFunctionStart, panelBodyStart) +
    balancedObjectAt(bundle, panelBodyStart, 'nn model-panel function for Wan LoRA')

  const stateStart = panelComponent.indexOf('[nfPanelWanLoraSnapshot,nfSetPanelWanLoraSnapshot]')
  const stateEnd = panelComponent.indexOf(',Se=(0,_.useRef)(0)', stateStart)
  assert.ok(stateStart >= 0 && stateEnd > stateStart, 'Wan LoRA state must be defined inside nn')
  const stateFragment = panelComponent.slice(stateStart, stateEnd)
  assert.match(stateFragment, /NovaFlowAiSequenceWan22LoraResource/)
  assert.match(stateFragment, /getSnapshot\?\.\(\)/)
  assert.match(stateFragment, /subscribe\(t\)/)
  assert.match(stateFragment, /highName:String\(b\|\|``\)\.trim\(\),lowName:String\(S\|\|``\)\.trim\(\),steps:Number\(nfWanPanelSteps\)/)
  assert.match(stateFragment, /setContext\?\.\(t\)/)
  assert.match(stateFragment, /refreshCatalog\(t\)/)
  assert.match(stateFragment, /\[r,b,S,nfWanPanelSteps\]/)
  assert.match(stateFragment, /T\(Array\.from\(Array\.isArray\(e\?\.selected\)\?e\.selected:\[\]\)\)/)
  assert.match(
    stateFragment,
    /Array\.isArray\(nfPanelWanLoraSnapshot\?\.items\)\?nfPanelWanLoraSnapshot\.items:\[\]/,
    'Wan candidate options must come only from the secure snapshot items',
  )
  assert.match(
    stateFragment,
    /nfPanelWanLoraAvailable=e=>[\s\S]*e\?\.role===t\|\|e\?\.role===`shared`/,
    'each selector must expose only its trusted role plus shared catalog items',
  )
  assert.doesNotMatch(
    stateFragment,
    /NovaFlowAiSequenceMiniMaxH3LoraResource|object_info|comfyRequestJson|127\.0\.0\.1:8188|\bve\b/,
    'Wan and H3 stores must remain independent and the Wan store must not read a raw Runtime list',
  )

  const uiStart = panelComponent.indexOf('aiSeqWanModel&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-wan22-lora-section":`1`')
  const h3Start = panelComponent.indexOf('r===`minimax_h3_local`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-h3-lora-section":`1`', uiStart)
  assert.ok(uiStart >= 0 && h3Start > uiStart + 4, 'Wan LoRA surface must precede the independent H3 surface')
  const uiFragment = panelComponent.slice(uiStart, h3Start - 4)
  assert.match(uiFragment, /\[`high`,`low`\]\.map\(nfWanRole=>/)
  assert.match(uiFragment, /"data-novaflow-wan22-lora-role-group":nfWanRole/)
  assert.match(uiFragment, /nfWanRole===`high`\?`High LoRA`:`Low LoRA`/)
  assert.match(uiFragment, /"data-novaflow-wan22-lora-add":nfWanRole/)
  assert.match(uiFragment, /nfPanelWanLoraAvailable\(nfWanRole\)/)
  assert.match(uiFragment, /\.\.\.nfWanAvailable\.map/)
  assert.match(uiFragment, /e\?\.role===nfWanRole\|\|e\?\.role===`shared`/)
  assert.match(uiFragment, /共享 High \+ Low/)
  assert.match(uiFragment, /setSelection\?\.\(\[\.\.\.n,\{name:t\}\]\)/)
  assert.match(uiFragment, /updateStrength\?\.\(e\.name,Number\(t\.target\.value\)\)/)
  assert.match(uiFragment, /"data-novaflow-wan22-lora-role":e\.role/)
  assert.match(uiFragment, /"data-novaflow-wan22-lora-remove":e\.role/)
  assert.match(uiFragment, /remove\?\.\(e\.name\)/)
  assert.match(uiFragment, /当前 High \/ Low 模型与步数暂无兼容 LoRA/)
  assert.doesNotMatch(
    uiFragment,
    /\bve\b|\bye\b|\bw\b|aiSeqComfyLoras|object_info|127\.0\.0\.1:8188|Array\.from\(new Set/,
    'Wan controls must not expose the raw object_info LoRA list or legacy React selection list',
  )

  const panelSnapshot = {
    items: [
      { name: 'high.safetensors', role: 'high' },
      { name: 'low.safetensors', role: 'low' },
      { name: 'shared.safetensors', role: 'shared', strength: 0.8 },
    ],
    selected: [{ name: 'shared.safetensors', role: 'shared', strength: 0.8 }],
    loading: false,
    error: '',
  }
  const jsx = (type, props) => ({ type, props })
  const renderContext = {
    aiSeqWanModel: true,
    X: { jsx, jsxs: jsx },
    Qt: 'label',
    tn: 'select',
    nfPanelWanLoraSnapshot: panelSnapshot,
    nfPanelWanLoraAvailable: (role) => panelSnapshot.items.filter((entry) => (
      entry.role === role || entry.role === 'shared'
    ) && !panelSnapshot.selected.some((selected) => selected.name === entry.name)),
    nfPanelWanLoraApi: () => ({}),
  }
  const rendered = vm.runInNewContext(uiFragment, renderContext)
  assert.equal(rendered?.props?.['data-novaflow-wan22-lora-section'], '1')
  const roleGroups = Array.from(rendered?.props?.children || []).filter((child) => (
    child?.props?.['data-novaflow-wan22-lora-role-group']
  ))
  assert.deepEqual(
    roleGroups.map((child) => child.props['data-novaflow-wan22-lora-role-group']),
    ['high', 'low'],
    'the executable surface must render independent High and Low groups',
  )
  for (const roleGroup of roleGroups) {
    const selectedContainer = roleGroup?.props?.children?.[2]
    const sharedCard = Array.from(selectedContainer?.props?.children || []).find((card) => (
      card?.props?.['data-novaflow-wan22-lora-role'] === 'shared'
    ))
    assert.ok(sharedCard, 'a shared catalog selection must be visibly marked in both role groups')
  }
  assert.equal(
    vm.runInNewContext(uiFragment, { ...renderContext, aiSeqWanModel: false }),
    false,
    'the executable Wan condition must hide Wan controls while H3 is selected',
  )

  assert.match(patchScript, /renderer raw Wan LoRA list is discarded/)
  assert.match(patchScript, /Wan High and Low LoRA controls use only role-aware compatibility catalog items/)
  assert.match(patchScript, /Wan panel actual steps prop wiring/)
})

test('Wan2.2 validates selected LoRAs before upload and again before workflow construction', () => {
  const generatorStart = bundle.indexOf(',j=async nfH3SubmitOptions=>')
  const generatorEnd = bundle.indexOf(',M=async e=>', generatorStart)
  assert.ok(generatorStart >= 0 && generatorEnd > generatorStart, 'AI sequence submit function must have stable boundaries')
  const generator = bundle.slice(generatorStart, generatorEnd)

  const firstValidation = generator.indexOf('nfWanLoraResource.validateSelection(nfWanSubmitContext)')
  const firstUpload = generator.indexOf('let s=[];for(let n of o){')
  const finalValidation = generator.indexOf('nfWanFinalLoraResource.validateSelection(nfWanSubmitContext)')
  const workflowBuild = generator.indexOf('try{if(nfH3Mode){')
  const legacyWanBuild = generator.indexOf('loras:[]', workflowBuild)
  const roleAwareWanBuild = generator.indexOf(
    'nfWanRoleWorkflow.buildRoleAwareWorkflow(u,nfWanValidatedLoras).workflow',
    legacyWanBuild,
  )
  const promptSubmit = generator.indexOf('let k=await f(`/prompt`', workflowBuild)
  assert.ok(
    firstValidation >= 0 && firstUpload > firstValidation && finalValidation > firstUpload &&
      workflowBuild > finalValidation && legacyWanBuild > workflowBuild &&
      roleAwareWanBuild > legacyWanBuild && promptSubmit > roleAwareWanBuild,
    'Wan validation must surround all uploads and finish before role-aware workflow build and prompt submission',
  )
  assert.match(generator, /NovaFlowAiSequenceWan22LoraWorkflow/)
  assert.doesNotMatch(
    generator,
    /loras:nfWanValidatedLoras/,
    'the legacy Cn helper must never inject one unpartitioned LoRA list into both branches',
  )
  assert.equal(
    Array.from(generator.matchAll(/validateSelection\(nfWanSubmitContext\)/g)).length,
    2,
    'Wan submit must perform exactly the fail-fast and final anti-TOCTOU validations',
  )
  assert.match(
    generator,
    /nfWanSubmitContext=\{highName:String\(e\.aiSeqComfyUnetHighName\|\|``\)\.trim\(\),lowName:String\(e\.aiSeqComfyUnetLowName\|\|``\)\.trim\(\),steps:Number\(e\.aiSeqSampleSteps\)\}/,
    'both validations must use one submit-time High Low and actual-step snapshot',
  )
  assert.match(generator, /catch\(nfWanLoraError\)[\s\S]{0,220}setAiSeqJob\(\{state:`error`[\s\S]{0,180}return\}/)
  assert.match(generator, /catch\(nfWanFinalLoraError\)[\s\S]{0,240}setAiSeqJob\(\{state:`error`[\s\S]{0,180}return\}/)
  assert.match(
    generator,
    /else\{u=Cn\(u,\{[\s\S]*?loras:\[\]\}\);let nfWanRoleWorkflow=[\s\S]*?buildRoleAwareWorkflow\(u,nfWanValidatedLoras\)\.workflow\}/,
  )
  assert.match(generator, /let _=nfH3Mode\?nfH3ValidatedLoras\.length:nfWanValidatedLoras\.length/)
  assert.doesNotMatch(generator, /loras:Array\.isArray\(e\.aiSeqComfyLoras\)|aiSeqComfyLoras:\[\]|\.filter\(e=>e\?\.enabled/)
  assert.match(patchScript, /Wan LoRA fail-fast validation before the first media upload/)
  assert.match(patchScript, /Wan LoRA final validation after uploads and before workflow construction/)
  assert.match(patchScript, /Wan Cn stays LoRA-free before the role-aware workflow module injects validated descriptors/)
})

test('MiniMax_h3 text-to-video collapses the empty reference column and exposes independent controls', () => {
  assert.match(
    bundle,
    /"--novaflow-ai-reference-column-width":ze===`minimax_h3_local`&&Ve===`text_video`\?`0px`:/,
    'H3 text-to-video must reserve zero reference-column width',
  )
  assert.match(
    bundle,
    /"--novaflow-ai-reference-offset":ze===`minimax_h3_local`&&Ve===`text_video`\?`0px`:/,
    'H3 text-to-video settings and prompt must start at the main-row edge',
  )
  assert.match(
    bundle,
    /display:ze===`minimax_h3_local`&&Ve===`text_video`\?`none`:`flex`/,
    'H3 text-to-video must hide the empty reference-column element',
  )

  for (const attribute of [
    'data-novaflow-h3-aspect-ratio',
    'data-novaflow-h3-resolution',
    'data-novaflow-h3-duration',
    'data-novaflow-h3-fps',
    'data-novaflow-h3-steps',
  ]) {
    assert.match(bundle, new RegExp(escapeRegExp(attribute)), attribute + ' must be rendered')
  }
  assert.match(
    bundle,
    /"data-novaflow-h3-duration":`1`,type:`number`,inputMode:`decimal`,min:1,max:30,step:\.01/,
    'H3 duration must be a free decimal input constrained to 1.00-30.00 seconds',
  )
  assert.match(bundle, /normalizeDuration\?\.\(\{seconds:nfH3DurationInput,fps:nfH3Fps\}\)/)
  assert.match(
    bundle,
    /nfCommitH3Duration=e=>\{let t=Number\(e\),n=Number\.isFinite\(t\)\?Math\.max\(1,Math\.min\(30,Math\.round\(t\*100\)\/100\)\):5/,
    'H3 duration commit must clamp to the visible 1.00-30.00 second range',
  )
  assert.match(
    bundle,
    /title:`模型对齐输出 \$\{nfH3Duration\(\)\.actualDuration\.toFixed\(2\)\} 秒 \/ \$\{nfH3Duration\(\)\.frames\} 帧 · \$\{nfH3Duration\(\)\.fps\} FPS\$\{nfH3Duration\(\)\.frames<124\?`；短时长实验模式`:nfH3Duration\(\)\.requestedDuration>15\?`；长时长实验模式`:``\}`/,
    'H3 duration alignment details must remain available in the input tooltip',
  )
  assert.doesNotMatch(bundle, /data-novaflow-h3-duration-output/, 'duration details must not occupy the parameter row')

  const stateStart = bundle.indexOf('[nfH3AspectRatio,nfSetH3AspectRatio]')
  const stateEnd = bundle.indexOf(',Fr=Ja(`ai_seq_prompt`', stateStart)
  assert.ok(stateStart >= 0 && stateEnd > stateStart, 'independent H3 state must have stable boundaries')
  const stateFragment = bundle.slice(stateStart, stateEnd)
  assert.match(stateFragment, /useState\)\(\(\)=>nfH3Saved\(\)\.aspectRatio\)/, 'H3 must default to 9:16')
  assert.match(stateFragment, /nfH3Megapixels,nfSetH3Megapixels\]=\(0,_\.useState\)\(\(\)=>nfH3Saved\(\)\.megapixels\)/)
  assert.match(stateFragment, /nfH3Fps,nfSetH3Fps\]=\(0,_\.useState\)\(\(\)=>nfH3Saved\(\)\.fps\)/)
  assert.match(stateFragment, /nfH3Steps,nfSetH3Steps\]=\(0,_\.useState\)\(\(\)=>nfH3Saved\(\)\.steps\)/)
  assert.match(stateFragment, /width:480,height:864/, 'H3 must default to 480 x 864')
  assert.doesNotMatch(
    stateFragment,
    /\b(?:bt|St|Pt|It|wt|Rt)\(/,
    'H3 state adapters must not write shared Wan width, height, or frames',
  )
  for (const ratio of ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9']) {
    assert.match(stateFragment, new RegExp('value:`' + escapeRegExp(ratio) + '`'))
  }
  for (const label of [
    '1:1（方形）',
    '2:3（竖屏照片）',
    '3:2（横屏照片）',
    '3:4（竖屏标准）',
    '4:3（横屏标准）',
    '9:16（竖屏宽银幕）',
    '16:9（横屏宽银幕）',
    '21:9（超宽屏）',
  ]) {
    assert.match(stateFragment, new RegExp('label:`' + escapeRegExp(label) + '`'))
  }
  assert.match(
    stateFragment,
    /findIndex\(t=>`\$\{t\.width\}x\$\{t\.height\}`===`\$\{e\.width\}x\$\{e\.height\}`\)===t/,
    'resolution choices must deduplicate identical rounded dimensions',
  )

  const settingsStart = bundle.indexOf('children:ze===`minimax_h3_local`?(0,X.jsxs)(X.Fragment,{children:[')
  const settingsEnd = bundle.indexOf(']}):ze===`local`?', settingsStart)
  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart, 'H3 settings must have stable boundaries')
  const settingsFragment = bundle.slice(settingsStart, settingsEnd)
  assert.doesNotMatch(settingsFragment, /data-novaflow-h3-(?:orientation|aspect`|megapixels|output-size)/)
  assert.doesNotMatch(settingsFragment, /\bMP\b/, 'H3 resolution choices must not expose megapixel labels')
  assert.ok(
    settingsFragment.includes('children:`${e.width} × ${e.height}${e.megapixels>.98?`（高负载）`:``}`'),
    'resolution choices must show direct dimensions and flag presets above the verified 0.98 level',
  )
  assert.match(settingsFragment, /children:`采样步数`/)
  assert.match(settingsFragment, /children:`FPS`/)
  assert.match(
    settingsFragment,
    /"data-novaflow-h3-fps":`1`,value:String\(nfH3Fps\),onChange:e=>nfSetH3Fps\(Number\(e\.target\.value\)===16\?16:24\)/,
    'FPS must be a dedicated H3 selector with 16 and 24 FPS gears',
  )
  assert.match(settingsFragment, /value:`24`,children:`24`/)
  assert.match(settingsFragment, /value:`16`,children:`16`/)
  assert.match(
    settingsFragment,
    /"data-novaflow-h3-steps":`1`,type:`number`,inputMode:`numeric`,min:1,max:1e4,step:1,value:String\(nfH3Steps\)/,
    'steps must be an editable integer input from 1 through 10000 in every mode',
  )
  assert.doesNotMatch(settingsFragment, /disabled:Ve===`multi_reference`/)
  assert.doesNotMatch(settingsFragment, /value:`4`,children:`4`|value:`20`,children:`20`/)
  assert.doesNotMatch(settingsFragment, /"data-novaflow-h3-steps-hint":`1`/)
  assert.match(settingsFragment, /title:`beta5 TURBO 已内置加速权重；不额外叠加 Turbo LoRA`/)
  assert.match(stateFragment, /e===4\?`4 步：自动启用 Turbo LoRA`/)
  assert.match(stateFragment, /e===20\?`20 步：推荐质量基线`/)
  assert.match(stateFragment, /`\$\{e\} 步：自定义采样`/)

  const commonModeBodySelector = '[data-novaflow-ai-mode-section="1"] > [data-novaflow-ai-mode-body-item="1"],'
  const commonRuleStart = runtimeSource.indexOf(commonModeBodySelector)
  assert.notEqual(commonRuleStart, -1, 'shared mode-body sizing rule must exist')
  const scopedLoraRuleMatch = /body\.novaflow-ai-animation-section-layers\.novaflow-ai-bottom-workspace-active \[data-novaflow-ai-mode-section="1"\] > \*:has\(\[data-novaflow-ai-lora-section="1"\]\) \{\s*min-height:/m.exec(
    runtimeSource.slice(commonRuleStart + commonModeBodySelector.length),
  )
  const scopedLoraRuleStart = scopedLoraRuleMatch
    ? commonRuleStart + commonModeBodySelector.length + scopedLoraRuleMatch.index
    : -1
  assert.notEqual(scopedLoraRuleStart, -1, 'LoRA-owned branch sizing rule must exist after the shared rule')
  const commonRuleBody = runtimeSource.slice(commonRuleStart, scopedLoraRuleStart)
  assert.doesNotMatch(
    commonRuleBody,
    /--novaflow-ai-entry-main-model-min-height/,
    'cached Wan LoRA height must not stretch every model body item',
  )
  assert.match(
    runtimeSource.slice(scopedLoraRuleStart, scopedLoraRuleStart + 500),
    /\[data-novaflow-ai-mode-section="1"\] > \*:has\(\[data-novaflow-ai-lora-section="1"\]\) \{\s*min-height: var\(--novaflow-ai-entry-main-model-min-height, auto\) !important;/,
    'the cached main-model height must apply only to a direct branch that actually owns a LoRA section',
  )

  assert.match(
    patchScript,
    /H3 text-to-video empty reference column visibility/,
    'the source-owned patch must reproduce the full-width text-to-video layout',
  )
  assert.match(
    patchScript,
    /combined H3 aspect, resolution, duration, and steps controls/,
    'the source-owned patch must reproduce the independent H3 control contract',
  )
  assert.match(patchScript, /free-form H3 steps number input/)
})

test('all MiniMax_h3 top-mode switches refresh the source-owned reference layout', () => {
  const refreshCapture = namedFunctionSource(runtimeSource, 'handleAiAnimationModeSwitchRefreshCapture')
  const refreshAfterReact = namedFunctionSource(runtimeSource, 'handleAiAnimationModeSwitchRefreshAfterReact')
  for (const encodedLabel of [
    '\\u6587\\u751f\\u89c6\\u9891',
    '\\u56fe\\u751f\\u89c6\\u9891',
    '\\u9996\\u5c3e\\u5e27\\u89c6\\u9891',
    '\\u591a\\u53c2\\u89c6\\u9891',
  ]) {
    assert.ok(
      refreshCapture.includes(encodedLabel),
      `${encodedLabel} must be treated as a top-mode switch`,
    )
    assert.ok(
      refreshAfterReact.includes(encodedLabel),
      `${encodedLabel} must refresh once more after React commits the new slots`,
    )
  }
  assert.match(
    refreshCapture,
    /scheduleAiAnimationStructureRefresh\(\[0, 16, 32, 60, 120, 240, 320\]\)/,
    'H3 mode changes must reuse the established source-owned layout refresh schedule',
  )
  assert.match(
    runtimeSource,
    /document\.addEventListener\("click", handleAiAnimationModeSwitchRefreshAfterReact, false\)/,
    'the post-React mode refresh must run from the bubble phase',
  )
  assert.match(refreshAfterReact, /queueMicrotask\(refreshAfterCommit\)/)
  assert.match(refreshAfterReact, /requestAnimationFrame\(\(\) => \{/)
  assert.match(refreshAfterReact, /scheduleAiAnimationStructureRefresh\(\[0, 48, 160\]\)/)
})

test('MiniMax_h3 multi-reference media validates FPS, duration, and audio-only use before upload', () => {
  assert.match(
    bundle,
    /v=async\(e,t\)=>\{try\{let n=window\.electronAPI;if\(!n\?\.aiSeqProbeVideoMeta\)return null;/,
    'the H3 reference-video validator must use the existing Electron ffprobe bridge when available',
  )

  const startMarker = 'if(nfH3Mode&&a===`multi_reference`){'
  const start = bundle.indexOf(startMarker)
  assert.notEqual(start, -1, 'H3 multi-reference media block must exist')
  const end = bundle.indexOf(
    'if(t!==e.aiSeqRunTokenRef.current)return;if(nfH3Mode){let nfH3FinalLoraResource=',
    start + startMarker.length,
  )
  assert.notEqual(end, -1, 'H3 multi-reference media block must have a stable submit boundary')
  const mediaBlock = bundle.slice(start, end)

  const videoProbeIndex = mediaBlock.indexOf('nfH3VideoMeta=await v(')
  const audioProbeIndex = mediaBlock.indexOf('nfH3AudioMeta=await v(')
  const policyIndex = mediaBlock.indexOf('.validateReferenceMediaPolicy(')
  const firstUploadIndex = mediaBlock.indexOf('await y(')
  const videoUploadIndex = mediaBlock.indexOf('nfH3VideoUpload=await y(')
  const audioUploadIndex = mediaBlock.indexOf('nfH3AudioUpload=await y(')
  assert.ok(videoProbeIndex >= 0, 'the H3 reference video must be probed through aiSeqProbeVideoMeta')
  assert.ok(audioProbeIndex >= 0, 'the H3 standalone audio must reuse the same format-duration probe')
  assert.ok(policyIndex >= 0, 'the H3 submit path must call the Resource-owned media policy')
  assert.ok(firstUploadIndex >= 0, 'the H3 reference upload path must remain present')
  assert.ok(videoProbeIndex < policyIndex && audioProbeIndex < policyIndex, 'both probes must finish before policy validation')
  assert.ok(policyIndex < firstUploadIndex, 'reference policy validation must finish before any upload')
  assert.ok(videoUploadIndex > policyIndex && audioUploadIndex > policyIndex, 'video and audio uploads must follow validation')
  assert.match(mediaBlock, /images:o,videos:/)
  assert.match(mediaBlock, /audios:/)

  assert.match(
    patchScript,
    /H3 reference policy before all uploads/,
    'the source-owned bundle patch must reproduce the probe-policy-upload ordering',
  )
})

test('leaving AI sequence or switching to skeleton best-effort releases and stops the H3 sidecar', () => {
  const releaseName = 'releaseMiniMaxH3RuntimeForRouteExit'
  assert.match(
    runtimeSource,
    new RegExp(`function\\s+${releaseName}\\s*\\(`),
    'source Runtime must expose a small MiniMax H3 release lifecycle bridge',
  )
  const releaseSource = namedFunctionSource(runtimeSource, releaseName)

  assert.match(releaseSource, /http:\/\/127\.0\.0\.1:8189\/free/)
  assert.match(releaseSource, /method:\s*["']POST["']/)
  assert.match(releaseSource, /unload_models:\s*true/)
  assert.match(releaseSource, /free_memory:\s*true/)
  assert.match(releaseSource, /minimaxH3RuntimeStop(?:\?\.)?\(\{\s*timeoutMs:\s*(?:30000|30_000)(?:,\s*reason)?\s*\}\)/)
  assert.match(
    releaseSource,
    /(?:\.catch\s*\(|catch\s*\{)[\s\S]*(?:\.catch\s*\(|catch\s*\{)/,
    'both /free and lifecycle stop must be best-effort and must not block navigation',
  )

  const releaseCall = new RegExp(`${escapeRegExp(releaseName)}\\s*\\(`)
  const primaryRoute = namedFunctionSource(runtimeSource, 'syncPrimaryTargetBodyClass')
  assert.match(
    primaryRoute,
    /const leavingAnimationTarget\s*=\s*targetIndex\s*!==\s*1\s*&&\s*wasAnimationTarget/,
    'primary routing must identify the transition away from Animation before body classes change',
  )
  const primaryExit = /if\s*\(leavingAnimationTarget\)\s*\{[\s\S]{0,500}?\}/.exec(primaryRoute)
  assert.ok(primaryExit, 'primary routing must retain an explicit Animation-exit branch')
  assert.match(primaryExit[0], releaseCall, 'leaving the Animation primary entry must release H3')

  const skeletonEntry = namedFunctionSource(runtimeSource, 'armSkeletonSecondarySwitchQuietWindow')
  const skeletonClear = namedFunctionSource(runtimeSource, 'clearAiAnimationRuntimeStateForSkeletonLayout')
  assert.ok(
    releaseCall.test(skeletonEntry) || releaseCall.test(skeletonClear),
    'switching from AI sequence to Skeleton animation must release H3',
  )
})

test('MiniMax H3 surface changes preserve Art Generate, credit, and auth implementations byte-for-byte', () => {
  const protectedFiles = {
    'particle-editor/art-generate-model.resource.js': '3C015618C3029952667C0C6B83E86A47DE9DF9CB80AD7A7B34AA89A1BE2D3DD0',
    'particle-editor/art-generate-provider.workflow.js': 'C714A54AEA2A742B56A42A7FF083B10A9B838BC5C6DE9EA22B7EE36A7E571BEF',
    'particle-editor/art-generate-mode.tool.js': 'F83892AB631202670AFD4E4C42E26252E206B7ED69CEFEA71EC587CE4C636751',
    'particle-editor/art-generate-credit-pricing.tool.js': '9C2937BD136C5EEF3962B616C6F8B80A9546A69FFE022A1B3AC64C7B734E2884',
    'particle-editor/art-generate-reference-drop.tool.js': '38569185D3BFA679FF315327781001AC5D6023BA25D50DE647D9CBA1251E7EA5',
    'particle-editor/art-quality-profile.workflow.js': 'D238F08DCD6101F54EF7104BD8B3A9EF27D7974D7BADD663257C8F909B2EDBD2',
    'particle-editor/ai-sequence-credit-pricing.js': 'B57159EE6F2C220961C634CB37CB0F4A6CB912359C9445D9DFE04B108C18ECC5',
    'particle-editor/comfyui-workflow-credit-cost.js': '02D0BC55EB9B7EA09431815A92A75DE0E41450BA4F310EF1B13FDB414AE34EF8',
    'particle-editor/runtime-fetch-proxy.js': '077061238A8F180BE634EA4A5C98E271B841126EF86C118C8C75AA6F97F58D89',
    'particle-editor/novaflow-client-auth.js': '5207E9259CA41301A6A08A1BD780421577CB6914B8B1E3BF1D6C5515EA14949C',
  }

  for (const [relativePath, expectedHash] of Object.entries(protectedFiles)) {
    assert.equal(sha256(path.join(root, relativePath)), expectedHash, `${relativePath} must remain unchanged`)
  }
})

test('MiniMax_h3 keeps 8189 out of the shared Wan Runtime URL and coordinates residual memory', () => {
  const generatorStart = bundle.indexOf('function Vs(e){')
  const generatorEnd = bundle.indexOf('function Hs(e){', generatorStart)
  assert.ok(generatorStart >= 0 && generatorEnd > generatorStart, 'AI sequence generator must have stable boundaries')
  const generator = bundle.slice(generatorStart, generatorEnd)

  assert.match(bundle, /nfAiSeqResolvedBaseRef=\(0,_\.useRef\)\(``\)/)
  assert.equal(
    Array.from(bundle.matchAll(/\(e\.aiSeqMode===`minimax_h3_local`\?`http:\/\/127\.0\.0\.1:8189`:`http:\/\/127\.0\.0\.1:8188`\)/g)).length,
    4,
    'JSON, binary, upload, and websocket requests must use only the fixed per-run endpoint',
  )
  assert.doesNotMatch(
    generator,
    /nfAiSeqResolvedBaseRef\.current\|\|\(e\.aiSeqMode===`minimax_h3_local`/,
    'request helpers must not allow a stale resolved URL to override fixed NovaFlow ports',
  )
  assert.match(bundle, /nfH3Runtime\?\[8189\]:\[8188\]/, 'Runtime discovery must probe only the selected NovaFlow Runtime')
  assert.doesNotMatch(
    generator,
    /nfH3Runtime\?\[8189\]:\[[^\]]*(?:8e3|8080|7860|3e3)/,
    'Wan discovery must not fall back to Comfy Desktop or unrelated local ports',
  )
  assert.doesNotMatch(
    bundle,
    /t===`minimax_h3_local`\?\([^)]*g\(`http:\/\/127\.0\.0\.1:8189`\)/,
    'selecting H3 must not write 8189 into the shared Wan Runtime state',
  )
  assert.match(
    bundle,
    /nfAiSeqResolvedBaseRef\.current=t;if\(!nfH3Runtime\)\{try\{localStorage\.setItem\(`comfyui_last_connected_url`,t\)\}/,
    'only the Wan probe may persist the shared Runtime URL',
  )
  assert.equal(
    Array.from(generator.matchAll(/localStorage\.setItem\(`comfyui_last_connected_url`/g)).length,
    1,
    'the AI sequence generator must have exactly one shared Runtime URL write, guarded as Wan-only',
  )
  assert.match(
    bundle,
    /let t=await Ne\(`http:\/\/127\.0\.0\.1:8188`,`\/object_info`\)/,
    'Wan UNET choices must always come from the NovaFlow-owned 8188 Runtime',
  )
  assert.match(
    bundle,
    /nfWanVisibleModel=e=>!String\(e\|\|``\)\.toLowerCase\(\)\.replaceAll\(String\.fromCharCode\(92\),`\/`\)\.split\(`\/`\)\.includes\(`minimax_h3`\)/,
    'Wan UNET choices must exclude the minimax_h3 directory',
  )
  assert.match(
    bundle,
    /\{unets:r\}=Me\(n\)[\s\S]{0,360}_e\(a\),ye\(\[\]\)/,
    'the renderer must discard every raw object_info LoRA name',
  )
  assert.match(
    bundle,
    /\(0,_\.useEffect\)\(\(\)=>\{r===`local`&&i\(`minimax_h3_local`\)\},\[r,i\]\);/,
    'a leftover Wan local mode must be coerced to MiniMax_h3 instead of re-entering the retired Wan line',
  )
  assert.match(
    bundle,
    /value:aiSeqWanModel\?`http:\/\/127\.0\.0\.1:8188`:`http:\/\/127\.0\.0\.1:8189`,onChange:\(\)=>\{\},readOnly:!0/,
    'the Runtime field must display the fixed endpoint for the selected model',
  )
  assert.match(
    patchScript,
    /H3 model selection must not overwrite the shared Wan Runtime URL[\s\S]*H3 probe must not overwrite the shared Wan Runtime URL/,
    'the source-owned bundle patch must preserve H3 URL isolation on regeneration',
  )
  assert.match(patchScript, /fixed Runtime probe ports/)
  assert.match(patchScript, /direct Wan\/H3 helper endpoints/)
  assert.match(patchScript, /Wan object_info endpoint/)
  assert.match(patchScript, /Wan model dropdown excludes the minimax_h3 directory/)
  assert.match(
    bundle,
    /采样步数可输入 1–10000，4 步自动使用专用 Turbo LoRA，20 步为推荐质量基线/,
    'the H3 model description must describe free-form steps and the two recommended profiles',
  )
  assert.doesNotMatch(
    bundle,
    /多参视频固定 20 步|steps:nfH3ModeName===`r2v`\?20:/,
    'the H3 model description and dispatch must not retain the retired multi-reference lock',
  )
  assert.match(
    bundle,
    /if\(!nfH3Mode\)\{try\{await fetch\(`http:\/\/127\.0\.0\.1:8189\/free`[\s\S]{0,420}minimaxH3RuntimeStop/,
    'a Wan submit must release a residual H3 sidecar before using the GPU',
  )
})

test('MiniMax_h3 publishes only the final output while Wan keeps only the normal video_a output', () => {
  assert.match(
    bundle,
    /NovaFlowAiSequenceMiniMaxH3OutputResource[\s\S]{0,260}\.list\(\)/,
    'the H3 surface must restore the current warehouse manifest into the resource list',
  )
  assert.match(
    bundle,
    /nfH3PublishOutputs=d\?\[d\]:\[\][\s\S]{0,900}\.publish\(\{promptId:A,filename:nfOutput\.filename,subfolder:nfOutput\.subfolder\|\|``,type:nfOutput\.type\|\|`output`,mediaDurationSec:nfH3NormalizedMediaDurationSec,generationElapsedSec:nfH3NormalizedGenerationElapsedSec\}\)/,
    'MiniMax H3 must publish only the final output loaded to the canvas',
  )
  assert.match(
    bundle,
    /for\(let n of \(d\?\[d\]:u\.slice\(0,1\)\)\)\{if\(t!==e\.aiSeqRunTokenRef\.current\)return;await C\(\{/,
    'Wan generation must publish only the selected video_a history output',
  )
  assert.doesNotMatch(
    bundle,
    /"filename_prefix": "video_b"/,
    'Wan workflows must not retain the filtered video_b save node',
  )
  assert.match(
    bundle,
    /d=u\.find\(e=>\/\^video_a\/i\.test\(String\(e\?\.filename\|\|``\)\)\)\|\|u\[0\]/,
    'Wan canvas and resource publication must prefer the normal video_a output',
  )
  assert.doesNotMatch(
    preloadSource,
    /aiSeqCacheClear:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("ai-seq-cache-clear",\s*payload\)/,
    'the renderer bridge must not expose a full physical warehouse clear operation to generation UI',
  )
  assert.match(
    mainSource,
    /handleNovaFlowTempIpc\("ai-seq-cache-clear"[\s\S]{0,420}cleanupAiSeqCacheDir\(source\)[\s\S]{0,160}ensureAiSeqCacheDir\(\)/,
    'the main process must clear and recreate the physical ai-sequence-cache directory',
  )
  assert.doesNotMatch(
    bundle,
    /aiSeqCacheClear\?\.\(\{source:`ai-sequence-generate-start`\}\)[\s\S]{0,120}nfRunAiSeqGenerate\(\)/,
    'starting a new AI sequence generation must not delete existing warehouse resources',
  )
  assert.match(
    bundle,
    /h=async\(nfCacheBlob,nfCacheName,nfCacheKey\)=>\{try\{if\(e\.aiSeqMode===`minimax_h3_local`\)return null;if\(!nfCacheKey\)return null/,
    'only selected Wan outputs with stable output ids may be written to the physical cache',
  )
  assert.match(
    bundle,
    /aiSeqCacheTempFile\(\{bytes:r,fileName:nfCacheFileName,cacheKey:String\(nfCacheKey\),cacheRank:nfCacheRank,maxFiles:1\}\)/,
    'Wan cache writes must be keyed and capped to one physical warehouse file',
  )
  assert.match(
    bundle,
    /s=await h\(o,t\.filename,t\.id\),c=i\(o\)/,
    'resource object-url prefetch must cache by the generated output id',
  )
  assert.match(
    bundle,
    /o=await h\(n,d\.filename,a\),s=await v\(n,d\.filename\)/,
    'canvas preview cache writes must reuse the same selected generated output id',
  )
  assert.doesNotMatch(
    bundle,
    /await h\([^,\)]*,[^,\)]*\)/,
    'unkeyed Comfy downloads must not write arbitrary history outputs into ai-sequence-cache',
  )
  assert.match(
    mainSource,
    /AI_SEQ_GENERATED_CACHE_INDEX = "\.generated-cache-index\.json"/,
    'Wan duplicate-cache state must be isolated from the H3 manifest.json warehouse',
  )
  assert.match(
    mainSource,
    /const cacheKey = normalizeAiSeqGeneratedCacheKey\(payload\?\.cacheKey\)/,
    'the renderer-provided generated output id must reach the main-process cache writer',
  )
  assert.match(
    mainSource,
    /existing\?\.path[\s\S]{0,260}reused: true/,
    'the main process must reuse an existing physical file for the same generated output id',
  )
  assert.match(
    mainSource,
    /const cacheGroup = normalizeAiSeqGeneratedCacheGroup\(payload\?\.cacheGroup, cacheKey\)/,
    'the main process must derive a generated-output group from the current Wan prompt id',
  )
  assert.match(
    mainSource,
    /const scopedItems = index\.items\.filter\(\(item\) => normalizeAiSeqGeneratedCacheGroup\(item\?\.cacheGroup, item\?\.cacheKey\) === group\)/,
    'the generated-output cap must be scoped to the current prompt group instead of the whole warehouse',
  )
  assert.match(
    mainSource,
    /pruneAiSeqGeneratedCacheIndex\(dir, cacheIndex, maxFiles, cacheGroup\)/,
    'the main process must enforce the requested cap only within the current generated-output group',
  )
  assert.match(
    mainSource,
    /const formatAiSeqWarehouseTimestamp = \(date = new Date\(\)\) =>/,
    'generated Wan warehouse files must use a readable timestamp instead of a random suffix',
  )
  assert.match(
    mainSource,
    /const firstName = `\$\{safePrefix\}_\$\{stamp\}\$\{safeExt\}`/,
    'the first generated Wan warehouse name must be short and readable',
  )
  assert.match(
    mainSource,
    /const outPrefix = cacheKey \? "wan" : "ais";[\s\S]{0,180}cacheKey[\s\S]{0,80}createAiSeqWarehouseFileName\(dir, outPrefix, ext\)/,
    'generated Wan warehouse files must use wan_ readable names while generic temp copies keep ais_',
  )
  assert.match(bundle, /视频已生成，但加入临时仓库失败/)
  assert.match(bundle, /已生成并加入临时仓库/)
  assert.match(patchScript, /--h3-output-warehouse-only/)
  assert.match(patchScript, /publish stable H3 outputs before reporting completion/)
})

test('MiniMax_h3 publishes authoritative media and generation timing for resource cards', () => {
  assert.match(
    bundle,
    /nfH3ProbedDurationSec=Number\(s\?\.durationSec\)[\s\S]{0,180}nfH3MediaDurationSec=nfH3ProbedDurationSec/,
    'the existing media probe must supply the output video duration',
  )
  assert.match(
    bundle,
    /nfH3OutputApi\.extractHistoryTiming\?\.\(o\)/,
    'the already-polled H3 history entry must be parsed synchronously',
  )
  assert.equal(
    (bundle.match(/\/history\/\$\{A\}/g) || []).length,
    1,
    'timing extraction must not issue a second history request',
  )
  assert.match(bundle, /mediaDurationSec:nfH3NormalizedMediaDurationSec/)
  assert.match(bundle, /generationElapsedSec:nfH3NormalizedGenerationElapsedSec/)
  assert.equal((bundle.match(/data-novaflow-ai-media-duration-sec/g) || []).length, 2)
  assert.equal((bundle.match(/data-novaflow-ai-generation-elapsed-sec/g) || []).length, 2)
  assert.match(runtimeSource, /const AI_SEQUENCE_MEDIA_DURATION_ATTR = "data-novaflow-ai-media-duration-sec"/)
  assert.match(runtimeSource, /const AI_SEQUENCE_GENERATION_ELAPSED_ATTR = "data-novaflow-ai-generation-elapsed-sec"/)
  assert.match(
    runtimeSource,
    /timingParts\.push\(`视频\$\{formatAiSequenceMediaDurationSeconds\(stableTiming\.mediaDurationSec\)\}S`\)/,
    'the Runtime display adapter must distinguish media duration',
  )
  assert.match(
    runtimeSource,
    /timingParts\.push\(`生成\$\{Math\.round\(stableTiming\.generationElapsedSec\)\}S`\)/,
    'the Runtime display adapter must distinguish generation elapsed time',
  )
  assert.match(runtimeSource, /timingParts\.length \? timingParts\.join\(" · "\) : `\$\{seconds\} S`/)
  assert.match(runtimeSource, /const expandedTimingLabel = timingParts\.length > 1/)
  assert.match(runtimeSource, /Math\.round\(metaRowRect\.left - timestampRect\.left\)/)
  assert.match(runtimeSource, /width: expandedTimingLabel \? `\$\{expandedLabelWidth\}px` : "auto"/)
  assert.equal(
    (bundle.match(/new Date\(e\.createdAt\)\.toLocaleString\(\)/g) || []).length,
    2,
    'resource cards must retain the existing createdAt clock and legacy fallback',
  )
  assert.match(patchScript, /publish H3 media and generation timing without another history request/)
  assert.match(patchScript, /expose H3 timing metadata on resource list card timestamps/)
})

test('HTML loads H3 workflow/resource modules and retires the AI sequence cloud workflow', () => {
  const sources = scriptSources(indexHtml)
  const h3Resource = 'ai-sequence-minimax-h3.resource.js'
  const h3OutputResource = 'ai-sequence-minimax-h3-output.resource.js'
  const h3LoraResource = 'ai-sequence-minimax-h3-lora.resource.js'
  const wanLoraResource = 'ai-sequence-wan22-lora.resource.js'
  const wanLoraWorkflow = 'ai-sequence-wan22-lora.workflow.js'
  const h3Workflow = 'ai-sequence-minimax-h3.workflow.js'
  const bundleModule = 'assets/index-BbIa-2NM.js'
  const cloudWorkflow = 'ai-sequence-cloud-workflow.js'

  assert.ok(sources.includes(h3Resource), `${h3Resource} must be loaded`)
  assert.match(
    indexHtml,
    /assets\/index-BbIa-2NM\.js\?v=20260916-retire-wan-1/,
    'the formal surface must invalidate the bundle cache after the Wan2_2 retirement',
  )
  assert.match(indexHtml, /ai-sequence-minimax-h3-output\.resource\.js\?v=20260812-minimax-h3-timing-1/)
  assert.match(indexHtml, /novaflow-brand-runtime\.js\?v=20260817-prompt-editor-modal-1/)
  assert.match(indexHtml, /ai-sequence-minimax-h3-prompt\.workflow\.js\?v=20260819-minimax-h3-longfps-1/)
  assert.match(indexHtml, /ai-sequence-minimax-h3-reverse\.workflow\.js\?v=20260819-minimax-h3-longfps-1/)
  assert.match(indexHtml, /ai-sequence-minimax-h3\.workflow\.js\?v=20260819-minimax-h3-longfps-1/)
  assert.ok(sources.includes(h3LoraResource), `${h3LoraResource} must be loaded`)
  assert.ok(sources.includes(h3OutputResource), `${h3OutputResource} must be loaded`)
  assert.equal(sources.includes(wanLoraResource), false, `${wanLoraResource} was retired and must not be loaded`)
  assert.equal(sources.includes(wanLoraWorkflow), false, `${wanLoraWorkflow} was retired and must not be loaded`)
  assert.match(indexHtml, /proxy-electron-api\.js\?v=20260812-minimax-h3-output-1/)
  assert.ok(sources.includes(h3Workflow), `${h3Workflow} must be loaded`)
  assert.equal(sources.includes(cloudWorkflow), false, `${cloudWorkflow} must no longer be loaded`)
  assert.ok(
    sources.indexOf(h3Resource) < sources.indexOf(h3Workflow),
    'H3 resource contract must load before the H3 workflow module',
  )
  assert.ok(
    sources.indexOf(h3OutputResource) < sources.indexOf(bundleModule),
    'H3 output Resource must load before the active bundle',
  )
  assert.ok(
    sources.indexOf(h3LoraResource) < sources.indexOf(h3Workflow),
    'H3 LoRA compatibility Resource must load before the H3 workflow module',
  )
})
