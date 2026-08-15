const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.resolve(__dirname, '../../particle-editor/spine-split-runtime.js'), 'utf8')
const adminServerSource = fs.readFileSync(path.resolve(__dirname, '../admin-server/server.js'), 'utf8')

const grokStart = source.indexOf('async function runStoryboardGrokReferencePrompt')
const analysisStart = source.indexOf('async function runStoryboardReferenceAnalysis')
const analysisEnd = source.indexOf('\n  function isImageWashRuntimeDisconnectError', analysisStart)
const unifiedStart = source.indexOf('async function runStoryboardUnifiedNineShots')
const unifiedEnd = source.indexOf('\n  function storyboardScenesFromUnifiedShots', unifiedStart)
const unifiedScenesStart = unifiedEnd + 3
const unifiedScenesEnd = source.indexOf('\n  function storyboardUnifiedDirectorResult', unifiedScenesStart)
const overviewStart = source.indexOf('async function composeStoryboardOverview')
const overviewEnd = source.indexOf('\n  async function finalizeStoryboardGroup', overviewStart)
const executeStart = source.indexOf('async function executeStoryboardTool()')
const executeEnd = source.indexOf('\n  async function regenerateStoryboardScene', executeStart)
const imageSafeStart = source.indexOf('function storyboardImageSafeActionText')
const imageSafeEnd = source.indexOf('\n  function storyboardQwenDualReferencePromptForScene', imageSafeStart)
const identityCueStart = source.indexOf('function storyboardDualReferenceIdentityCue')
const identityCueEnd = source.indexOf('\n  function storyboardIsCompactDualReferencePrompt', identityCueStart)
const formalPromptStart = source.indexOf('function storyboardQwenFormalReferencePromptForScene')
const formalPromptEnd = source.indexOf('\n  function storyboardStripReferenceImageRule', formalPromptStart)
const cueCompatibilityStart = source.indexOf('function storyboardReferenceCueCompatibleWithStory')
const cueCompatibilityEnd = source.indexOf('\n  function storyboardIdentityCueSentencesForStory', cueCompatibilityStart)

assert.ok(grokStart >= 0 && analysisStart > grokStart, 'Grok storyboard reference helper should exist')
assert.ok(analysisEnd > analysisStart, 'storyboard reference analysis should be extractable')
assert.ok(unifiedStart >= 0 && unifiedEnd > unifiedStart, 'unified storyboard planner should be extractable')
assert.ok(unifiedScenesEnd > unifiedScenesStart, 'unified storyboard scene mapping should be extractable')
assert.ok(overviewStart >= 0 && overviewEnd > overviewStart, 'storyboard overview renderer should be extractable')
assert.ok(executeStart >= 0 && executeEnd > executeStart, 'storyboard execution should be extractable')
assert.ok(imageSafeStart >= 0 && imageSafeEnd > imageSafeStart, 'image-safe action helper should be extractable')
assert.ok(identityCueStart >= 0 && identityCueEnd > identityCueStart, 'formal identity cue should be extractable')
assert.ok(formalPromptStart >= 0 && formalPromptEnd > formalPromptStart, 'formal Qwen prompt should be extractable')
assert.ok(cueCompatibilityStart >= 0 && cueCompatibilityEnd > cueCompatibilityStart, 'reference cue compatibility helper should be extractable')

const grokSource = source.slice(grokStart, analysisStart)
const analysisSource = source.slice(analysisStart, analysisEnd)
const unifiedSource = source.slice(unifiedStart, unifiedEnd)
const unifiedScenesSource = source.slice(unifiedScenesStart, unifiedScenesEnd)
const overviewSource = source.slice(overviewStart, overviewEnd)
const executeSource = source.slice(executeStart, executeEnd)
const imageSafeSource = source.slice(imageSafeStart, imageSafeEnd)
const identityCueSource = source.slice(identityCueStart, identityCueEnd)
const formalPromptSource = source.slice(formalPromptStart, formalPromptEnd)
const cueCompatibilitySource = source.slice(cueCompatibilityStart, cueCompatibilityEnd)

assert.match(grokSource, /api\.smartAiImageReverse\(/, 'AI director reference analysis must call Grok image reverse')
assert.match(grokSource, /const grokMeta = result\.grok/, 'Grok reverse metadata must be read from the response grok envelope')
assert.match(grokSource, /model: String\(grokMeta\.model/, 'Grok model metadata must be propagated to director debug')
assert.match(grokSource, /durationMs: Number\(grokMeta\.durationMs/, 'Grok duration metadata must be propagated to director debug')
assert.match(adminServerSource, /requestId: String\(data\?\.id \|\| response\.headers\.get\("x-request-id"\)/, 'the admin provider call must capture a provider request id when available')
assert.match(adminServerSource, /requestId: grok\.requestId/, 'the image-reverse response must expose the provider request id in its grok envelope')
assert.doesNotMatch(grokSource, /promptAssistantReverseImagePrompt|runImageWashReversePrompt/, 'Grok helper must never call local reverse analysis')
assert.match(grokSource, /requirements:[\s\S]*?视觉锚点[\s\S]*?不得被当成固定剧情[\s\S]*?不要续写故事/, 'Grok reverse must receive storyboard-specific visual analysis rules')
assert.match(grokSource, /固有颜色[\s\S]*?霓虹灯[\s\S]*?环境光[\s\S]*?不等于[\s\S]*?渐变/, 'Grok reverse must distinguish intrinsic colors from neon or environmental color casts')
assert.match(grokSource, /发梢实际最低位置[\s\S]*?耳上[\s\S]*?下颌[\s\S]*?齐肩[\s\S]*?不要同时写/, 'Grok reverse must produce one non-conflicting hair-length category')
assert.match(analysisSource, /provider === 'grok'[\s\S]*?runStoryboardGrokReferencePrompt\(dataUrl, fileName\)[\s\S]*?: runImageWashReversePrompt\(/, 'reference analysis must branch exclusively by director provider')
assert.match(analysisSource, /const cacheKey = contentCacheKey \? `\$\{provider\}:\$\{contentCacheKey\}` : ''/, 'reference cache must be isolated by provider')
assert.match(analysisSource, /if \(provider === 'grok'\) \{[\s\S]*?throw new Error\(`/,'Grok reverse failure must stop the run')
assert.match(unifiedSource, /const directorSourceAnalysis = useGrok[\s\S]*?String\(sourceAnalysis \|\| ''\)\.trim\(\)\.slice\(0, 6000\)[\s\S]*?: worldContinuity/, 'Grok planner must receive the full reverse-analysis appearance contract while local planning keeps world-only continuity')
assert.match(unifiedSource, /sourceAnalysis: directorSourceAnalysis/, 'unified planner payload must use the provider-specific source analysis')
assert.match(unifiedScenesSource, /const displayCaption = [\s\S]*?shot && shot\.displayCaption/, 'unified storyboard scenes must preserve the Chinese display caption')
assert.match(unifiedScenesSource, /caption: displayCaption/, 'the overview caption must use the dedicated Chinese display field')
assert.match(overviewSource, /scene\.title[\s\S]*?scene\.caption \|\| scene\.beat/, 'the rendered overview must use the localized scene title and caption')
assert.match(executeSource, /runStoryboardReferenceAnalysis\(source\.dataUrl, source\.fileName, storyboardDirectorProvider\)/, 'one-key storyboard must pass the AI director provider into reference analysis')
assert.doesNotMatch(source, /weapon or force direction|wing spread|Reference-visible accessories, equipment, wings/, 'formal storyboard prompting must not positively prime ungrounded weapons or wings')
assert.match(source, /const STORYBOARD_FINAL_SHOT_PROMPT_MAX_CHARS = 12000/, 'formal Qwen prompting must preserve the complete canonical Grok prompt and terminal-state constraints')
assert.match(imageSafeSource, /slice\(0, STORYBOARD_FINAL_SHOT_PROMPT_MAX_CHARS\)/, 'image-safe processing must not truncate the Grok shot prompt to 180 characters')
assert.match(formalPromptSource, /scene\.finalShotPrompt[\s\S]*?slice\(0, STORYBOARD_FINAL_SHOT_PROMPT_MAX_CHARS\)/, 'formal Qwen prompt must retain the complete Grok current-scene prompt')
assert.doesNotMatch(formalPromptSource, /slice\(0,\s*180\)/, 'formal Qwen prompt must not discard late current-appearance details')
assert.match(identityCueSource, /initial appearance baseline, not an immutable costume/, 'image1 clothing and equipment must be an initial state instead of a permanent costume lock')
assert.match(formalPromptSource, /Appearance-state priority:[\s\S]*?zero, one, or multiple visible changes or restorations[\s\S]*?never preassign a shot number, costume, color, prop, activity gear, or change count/i, 'formal Qwen prompt must honor dynamic Grok appearance state without fixed change beats')
assert.doesNotMatch(cueCompatibilitySource, /baggagePattern|travel|journey|school/, 'reference appearance cues must not be deleted by a fixed story-type whitelist')
assert.ok(
  executeSource.indexOf('runStoryboardReferenceAnalysis(source.dataUrl, source.fileName, storyboardDirectorProvider)') < executeSource.indexOf('runStoryboardUnifiedNineShots('),
  'Grok reverse must finish successfully before nine-shot planning can start'
)

async function runBehaviorTests() {
  const calls = { grok: 0, local: 0 }
  const referenceCache = new Map()
  const context = vm.createContext({
    window: {
      electronAPI: {
        smartAiImageReverse: async (payload) => {
          calls.grok += 1
          const dataUrl = String(payload?.images?.[0]?.dataUrl || '')
          if (dataUrl === 'bad-image') return { ok: false, error: 'forced-grok-failure' }
          return {
            ok: true,
            provider: 'grok',
            prompt: `grok-analysis:${dataUrl}`,
            grok: { model: 'grok-test-model', durationMs: 321, requestId: 'resp_test_123' }
          }
        }
      },
      setTimeout() { return 0 }
    },
    safeDownloadFileName(value) { return String(value || 'source.png') },
    storyboardReferenceAnalysisCacheKey: async (value) => `hash:${String(value || '')}`,
    storyboardSubjectPixelPaletteHintFromDataUrl: async () => '',
    storyboardReferenceAnalysisCache: referenceCache,
    storyboardNormalizeReferenceAnalysisForStoryboard: (value) => String(value || '').trim(),
    storyboardTrimReferenceAnalysisCache() {},
    runImageWashReversePrompt: async (dataUrl) => {
      calls.local += 1
      return `local-analysis:${String(dataUrl || '')}`
    },
    STORYBOARD_REFERENCE_ANALYSIS_TIMEOUT_MS: 1000,
    Date,
    Error,
    Math,
    String,
    console: { warn() {} }
  })
  vm.runInContext(
    `${grokSource}\n${analysisSource}\nthis.runStoryboardReferenceAnalysis = runStoryboardReferenceAnalysis`,
    context,
    { filename: 'storyboard-reference-routing.vm.js' }
  )

  const localFirst = await context.runStoryboardReferenceAnalysis('same-image', 'same.png', 'local')
  assert.equal(localFirst.provider, 'local')
  assert.equal(calls.local, 1)
  assert.equal(calls.grok, 0)

  const grokAfterLocal = await context.runStoryboardReferenceAnalysis('same-image', 'same.png', 'grok')
  assert.equal(grokAfterLocal.provider, 'grok')
  assert.equal(grokAfterLocal.model, 'grok-test-model')
  assert.equal(grokAfterLocal.providerDurationMs, 321)
  assert.equal(grokAfterLocal.requestId, 'resp_test_123')
  assert.equal(grokAfterLocal.cacheHit, false, 'Grok must not reuse a local reverse cache entry')
  assert.equal(calls.local, 1)
  assert.equal(calls.grok, 1)

  const grokCached = await context.runStoryboardReferenceAnalysis('same-image', 'same.png', 'grok')
  assert.equal(grokCached.cacheHit, true, 'a prior Grok reverse result may be reused')
  assert.equal(calls.grok, 1, 'Grok cache hits must not trigger another provider call')

  await assert.rejects(
    context.runStoryboardReferenceAnalysis('bad-image', 'bad.png', 'grok'),
    /forced-grok-failure.*不会切换到本地反推/
  )
  assert.equal(calls.local, 1, 'Grok failure must never invoke local reverse analysis')
  assert.equal(calls.grok, 2)
}

runBehaviorTests().then(() => {
  console.log('storyboard AI director Grok reverse routing tests passed')
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
