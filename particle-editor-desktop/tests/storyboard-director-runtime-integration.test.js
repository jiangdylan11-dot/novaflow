const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const repoRoot = path.resolve(__dirname, '..', '..')
const runtimePath = path.join(repoRoot, 'particle-editor', 'spine-split-runtime.js')
const indexPath = path.join(repoRoot, 'particle-editor', 'index.html')
const buildPath = path.join(repoRoot, 'particle-editor-desktop', 'scripts', 'build-renderer.mjs')
const syncPath = path.join(repoRoot, 'scripts', 'sync-runtime.mjs')
const checkPath = path.join(repoRoot, 'scripts', 'check-runtime-sync.mjs')

const runtime = fs.readFileSync(runtimePath, 'utf8')
const index = fs.readFileSync(indexPath, 'utf8')
const build = fs.readFileSync(buildPath, 'utf8')
const sync = fs.readFileSync(syncPath, 'utf8')
const check = fs.readFileSync(checkPath, 'utf8')

const qualityScript = index.indexOf('./storyboard-director-quality.workflow.js')
const runtimeScript = index.indexOf('./spine-split-runtime.js')
assert.ok(qualityScript >= 0, 'director quality workflow must be loaded by the source entry')
assert.ok(qualityScript < runtimeScript, 'director quality workflow must load before the Runtime')
for (const [label, source] of [['build', build], ['sync', sync], ['check', check]]) {
  assert.match(source, /storyboard-director-quality\.workflow\.js/, `${label} contract must include the quality workflow`)
}

assert.doesNotMatch(runtime, /const useSceneImageReference = true/, 'one-key and regenerate paths must not force the original image into every shot')
assert.match(runtime, /storyboardReferenceConditionMode\(storyboardReferenceStrength, !!subjectStyleReferenceName\)/)
assert.match(runtime, /storyboardReferenceConditionMode\(storyboardReferenceStrength, hasSubjectReference\)/)
assert.match(runtime, /allowGeneratedFallback: false/, 'identity-card preprocessing must not enter an extra image-generation module')
assert.match(runtime, /all_scenes_pose_muted_subject_identity_condition/)
assert.match(runtime, /all_scenes_text_identity_no_image_condition/)
assert.match(runtime, /all_scenes_original_reference_condition/)

assert.match(runtime, /const compiledDirectorQuality = storyboardEvaluateDirectorQuality\(finalShotResult\.shots/, 'compiled validation must evaluate the actual final-shot source, including local fallback shots')
assert.match(runtime, /validationStage: 'compiled'/)
assert.match(runtime, /subjectState: subjectStateSource \? \{ \.\.\.subjectStateSource \} : null/, 'normalized Grok shots must retain the structured subject state')
assert.match(runtime, /keyProps: keyPropsSource\.filter/, 'normalized Grok shots must retain the key-prop ledger')
assert.match(runtime, /visualEvent: storyboardNormalizePlannerField\(source\.visualEvent/, 'normalized Grok shots must retain the independent visible event')
assert.match(runtime, /PROVIDER_DIRECTOR_QUALITY_FAIL:/, 'a Grok result that still fails after its repair pass must stop before image generation')
assert.match(runtime, /if \(directorResult\.qualityHardError\) \{\s*throw new Error\(`Storyboard 导演质量校验未通过/)
const unifiedResultStart = runtime.indexOf('function storyboardUnifiedDirectorResult')
const unifiedResultEnd = runtime.indexOf('async function runStoryboardAiDirectorPlanner', unifiedResultStart)
const unifiedResultSource = runtime.slice(unifiedResultStart, unifiedResultEnd)
assert.ok(unifiedResultStart >= 0 && unifiedResultEnd > unifiedResultStart)
assert.doesNotMatch(unifiedResultSource, /storyProgression: 'PASS',[\s\S]{0,120}cameraDiversity: 'PASS'/, 'unified results must not report fixed PASS values')

assert.match(runtime, /cameraText = [^\n]+\.slice\(0, 240\)/)
assert.match(runtime, /New composition and camera: \$\{cameraText\}/)
assert.match(runtime, /const STORYBOARD_FINAL_SHOT_PROMPT_MAX_CHARS = 12000/, 'Runtime must not truncate terminal-state or no-text constraints from canonical prompts')
assert.match(runtime, /function storyboardTerminalKeyPropPriorityRule\(promptText\)/, 'Runtime must bridge the shared terminal key-prop priority rule')
assert.match(runtime, /terminalKeyPropPriority[\s\S]*?Use image1 only for protagonist identity/, 'current terminal key-prop state must be injected before reference identity locks')
assert.match(runtime, /参考图反推 Provider：/)
assert.match(runtime, /统一导演规划：剧情＋参考图视觉合同/)
assert.match(runtime, /compiledScenePromptText \|\| result && result\.promptPreview/)
assert.match(runtime, /function storyboardRefreshRegeneratedGroupDirectorTruth\(group\)/, 'single-shot regeneration must refresh group-level director truth')
assert.match(runtime, /group\.finalShots = finalShots[\s\S]*?group\.directorQuality = compiledDirectorQuality/, 'single-shot regeneration must update the final-shot and quality records together')
assert.match(runtime, /group\.directorDebugText = storyboardDirectorPlannerDebugText/, 'single-shot regeneration must rebuild the visible director debug text')
assert.match(runtime, /storyboardRefreshRegeneratedGroupDirectorTruth\(group\)[\s\S]*?composeStoryboardOverview/, 'truth refresh must run after the regenerated prompt succeeds and before the overview is rebuilt')

const refreshStart = runtime.indexOf('function storyboardFinalShotFromRegeneratedScene')
const refreshEnd = runtime.indexOf('\n  async function regenerateStoryboardScene', refreshStart)
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'regeneration truth helpers must be extractable')
const refreshSource = runtime.slice(refreshStart, refreshEnd)
let recordedResult = null
const refreshContext = vm.createContext({
  STORYBOARD_SCENE_COUNT: 9,
  storyboardNormalizePlannerField(value) { return String(value || '').replace(/\s+/g, ' ').trim() },
  storyboardEvaluateDirectorQuality(shots, options) {
    assert.equal(shots.length, 9)
    assert.equal(options.compiledPrompts.length, 9)
    return {
      status: 'WARNING',
      storyProgression: 'PASS',
      cameraDiversity: 'WARNING',
      endingQuality: 'PASS',
      warningText: 'SCENE_04:CAMERA_NOT_INLINE',
      hardError: ''
    }
  },
  storyboardDirectorQualityIssueText() { return '' },
  recordStoryboardDirectorPlannerDebug(_story, _source, result) { recordedResult = result },
  storyboardDirectorPlannerDebugText(_story, _source, result) { return `current:${result.compiledScenePrompts[3]}` },
  String,
  Number,
  Math,
  Array
})
vm.runInContext(`${refreshSource}\nthis.refreshGroup = storyboardRefreshRegeneratedGroupDirectorTruth`, refreshContext, { filename: 'storyboard-regenerate-truth.vm.js' })
const refreshGroup = {
  storyText: 'story',
  sourceAnalysis: 'source',
  characterIdentityCard: 'identity',
  directorSource: 'Unified 9-Shot AI',
  directorDebugResult: { providerDirectorQuality: { status: 'PASS', issues: [] } },
  finalShots: Array.from({ length: 9 }, (_, index) => ({
    scene: index + 1,
    title: `old-${index + 1}`,
    displayCaption: `old-caption-${index + 1}`,
    visualEvent: `old-visible-${index + 1}`,
    prompt: `old-prompt-${index + 1}`,
    camera: `camera-${index + 1}`,
    sceneAnchor: `space-${index + 1}`
  })),
  scenes: Array.from({ length: 9 }, (_, index) => ({
    number: index + 1,
    title: `scene-${index + 1}`,
    caption: `caption-${index + 1}`,
    visualEvent: index === 3 ? 'edited visible action and consequence' : `visible-${index + 1}`,
    finalShotPrompt: index === 3 ? 'edited visible event' : `event-${index + 1}`,
    finalShotCamera: `camera-${index + 1}`,
    finalShotSceneAnchor: `space-${index + 1}`,
    prompt: index === 3 ? 'compiled edited visible event' : `compiled-${index + 1}`
  }))
}
const refreshedQuality = refreshContext.refreshGroup(refreshGroup)
assert.equal(refreshGroup.finalShots[3].prompt, 'edited visible event')
assert.equal(refreshGroup.finalShots[3].visualEvent, 'edited visible action and consequence')
assert.equal(refreshGroup.directorQuality, refreshedQuality)
assert.equal(refreshGroup.directorDebugText, 'current:compiled edited visible event')
assert.equal(recordedResult.compiledScenePrompts[3], 'compiled edited visible event')
assert.equal(recordedResult.cameraDiversity, 'WARNING')

console.log('storyboard director Runtime integration tests passed')
