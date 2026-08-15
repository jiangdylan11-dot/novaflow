import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')

const index = read('particle-editor/index.html')
const runtime = read('particle-editor/aifx-repaint-runtime.js')
const brandRuntime = read('particle-editor/novaflow-brand-runtime.js')
const accordionHelper = read('particle-editor/left-panel-accordion.helper.js')
const materialReconstruct = read('particle-editor/aifx-material-reconstruct.workflow.js')
const providerResource = read('particle-editor/aifx-provider.resource.js')
const syncRuntime = read('scripts/sync-runtime.mjs')
const materialWorkflowSandbox = {
  module: { exports: {} },
  console,
  Object,
  Error,
  Map,
  Set,
  Number,
  Math,
  String,
  Array,
  RegExp,
}
runInNewContext(materialReconstruct, materialWorkflowSandbox)
const materialWorkflow = materialWorkflowSandbox.module.exports
const anchorPipelineStart = materialReconstruct.indexOf('async function runAnchorPipeline')
const anchorPipelineEnd = materialReconstruct.indexOf('\n  function buildPipelineResult', anchorPipelineStart)
const anchorPipelineSource = materialReconstruct.slice(anchorPipelineStart, anchorPipelineEnd)
const resultContractStart = materialReconstruct.indexOf('function buildPipelineResult')
const resultContractEnd = materialReconstruct.indexOf('\n  async function reconstruct', resultContractStart)
const resultContractSource = materialReconstruct.slice(resultContractStart, resultContractEnd)

const orderedScripts = [
  'aifx-provider.resource.js',
  'aifx-provider.tool.js',
  'aifx-prompt.workflow.js',
  'aifx-template.resource.js',
  'aifx-motion-guide.resource.js',
  'aifx-postprocess.workflow.js',
  'aifx-temporal-conform.workflow.js',
  'aifx-material-identity.resource.js',
  'aifx-material-reconstruct.workflow.js',
  'aifx-template-materialize.workflow.js',
  'aifx-sequence-quality.workflow.js',
  'aifx-export.workflow.js',
  'aifx-local.workflow.js',
  'aifx-generate.workflow.js',
  'aifx-rmbg.workflow.js',
  'aifx-repaint-runtime.js',
]

let previous = -1
for (const fileName of orderedScripts) {
  const current = index.indexOf(`./${fileName}`)
  assert.ok(current > previous, `${fileName} must load in the source-owned AIFX module order`)
  previous = current
  assert.match(syncRuntime, new RegExp(fileName.replaceAll('.', '\\.')), `${fileName} must be mirrored by sync-runtime`)
}

const accordionScriptIndex = index.indexOf('./left-panel-accordion.helper.js')
const aifxRuntimeScriptIndex = index.indexOf('./aifx-repaint-runtime.js')
assert.ok(accordionScriptIndex >= 0 && accordionScriptIndex < aifxRuntimeScriptIndex,
  'the shared left-panel accordion helper must load before the AIFX runtime')
assert.match(accordionHelper, /function syncExpanded\(section, header, body, chevron, expanded\)/)
assert.match(runtime, /sectionOpen: \{ mode: false, template: false, generate: false \}/)

const aifxSectionOrder = ['mode', 'template', 'generate'].map((key) => runtime.indexOf(`data-aifx-section="${key}"`))
assert.ok(aifxSectionOrder.every((index) => index >= 0), 'all three AIFX accordion sections must exist')
assert.deepEqual([...aifxSectionOrder].sort((left, right) => left - right), aifxSectionOrder,
  'AIFX left-panel order must be mode, template, generate')
for (const key of ['mode', 'template', 'generate']) {
  assert.match(runtime, new RegExp(`data-aifx-section="${key}" data-open="0"`))
  assert.match(runtime, new RegExp(`data-section-toggle="${key}" aria-expanded="false"`))
  assert.match(runtime, new RegExp(`data-section-body="${key}" hidden`))
}
assert.doesNotMatch(runtime, /data-aifx-section="style"/,
  'the style reference must not occupy a standalone accordion section')
const aifxModeSectionSource = runtime.slice(aifxSectionOrder[0], aifxSectionOrder[1])
const aifxGenerateSectionEnd = runtime.indexOf('</aside>', aifxSectionOrder[2])
const aifxGenerateSectionSource = runtime.slice(aifxSectionOrder[2], aifxGenerateSectionEnd)
assert.match(aifxModeSectionSource, /<button class="aifx-section-header nf-panel-header" type="button"/)
assert.match(aifxModeSectionSource, /data-aifx-provider-host/,
  'the account and model provider host must live in the first mode section')
assert.equal((runtime.match(/<div data-aifx-provider-host/g) || []).length, 1,
  'the account and model provider host must have exactly one mount point')
assert.match(aifxGenerateSectionSource, /data-action="pick-style"/,
  'the existing reference upload dropzone must live inside generation controls')
assert.match(aifxGenerateSectionSource, /data-action="prompt-supplement"[\s\S]*?maxlength="400"/,
  'generation controls must expose one bounded prompt supplement field')
assert.equal((runtime.match(/<div class="nf-upload-dropzone nf-upload-dropzone--medium"[^>]*data-action="pick-style"/g) || []).length, 1,
  'the reference upload dropzone must keep exactly one source-owned instance')
assert.equal((runtime.match(/data-action="prompt-supplement"/g) || []).length, 2,
  'the prompt supplement must have one DOM field and one source-owned ref lookup')
assert.match(runtime, /const open = state\.sectionOpen\?\.\[key\] === true/)
assert.match(runtime, /AIFX_LEFT_PANEL_ACCORDION\.syncExpanded\(section, toggle, body, chevron, open\)/)
assert.match(runtime, /if \(!root\.classList\.contains\('is-open'\)\) \{[\s\S]*?Object\.keys\(state\.sectionOpen\)[\s\S]*?syncSectionOpen\(root\)/,
  'a real AIFX re-entry must reset the accordion without resetting an already-open surface')
assert.match(runtime, /\.aifx-section-title \{[\s\S]*?font-weight: 700;[\s\S]*?\.aifx-side \.aifx-section\[data-aifx-section\] \.aifx-section-title \{[\s\S]*?font-weight: \$\{AIFX_LEFT_PANEL_TOKENS\.headerFontWeight\}/,
  'left accordion title styling must remain scoped to the source-owned controls')

assert.doesNotMatch(runtime, /class="aifx-result"/,
  'AIFX must not retain the deprecated persistent right-side result rail')
assert.doesNotMatch(runtime, /data-action="(?:export-png|export-spine|apply)"/,
  'AIFX export and apply actions must not be duplicated inside the workspace')
assert.doesNotMatch(runtime, /data-(?:output-count|output-size|output-fps|candidates-card|candidate-list)/,
  'removed result statistics and single-candidate UI must not be remounted')
assert.match(runtime, /data-preview-status[\s\S]*?aria-live="polite"/,
  'generation, cancellation, export, and failure feedback must remain visible on the main preview')
assert.match(runtime, /data-preview-status-title/)
assert.match(runtime, /data-preview-status-detail/)

assert.match(runtime, /hostScrollFreezeEpoch: 0,[\s\S]*?hostScrollFreezeRafId: 0,[\s\S]*?hostScrollFreezeTimerId: 0/,
  'AIFX must own an epoch and both delayed host-scroll callback handles')
const cancelHostScrollFreezeStart = runtime.indexOf('const cancelScheduledHostScrollFreeze = () =>')
const cancelHostScrollFreezeEnd = runtime.indexOf('\n  const isHostScrollFreezeActive', cancelHostScrollFreezeStart)
const cancelHostScrollFreezeSource = runtime.slice(cancelHostScrollFreezeStart, cancelHostScrollFreezeEnd)
assert.ok(cancelHostScrollFreezeStart >= 0 && cancelHostScrollFreezeEnd > cancelHostScrollFreezeStart,
  'the delayed host-scroll cancellation helper must have a bounded lifecycle owner')
assert.match(cancelHostScrollFreezeSource, /state\.hostScrollFreezeEpoch \+= 1/)
assert.match(cancelHostScrollFreezeSource, /window\.cancelAnimationFrame\(state\.hostScrollFreezeRafId\)/)
assert.match(cancelHostScrollFreezeSource, /window\.clearTimeout\(state\.hostScrollFreezeTimerId\)/)
assert.match(cancelHostScrollFreezeSource, /state\.hostScrollFreezeRafId = 0[\s\S]*?state\.hostScrollFreezeTimerId = 0/)

const hostScrollFreezeActiveStart = runtime.indexOf('const isHostScrollFreezeActive = (root, epoch) =>')
const hostScrollFreezeActiveEnd = runtime.indexOf('\n  const scheduleHostScrollFreeze', hostScrollFreezeActiveStart)
const hostScrollFreezeActiveSource = runtime.slice(hostScrollFreezeActiveStart, hostScrollFreezeActiveEnd)
assert.ok(hostScrollFreezeActiveStart >= 0 && hostScrollFreezeActiveEnd > hostScrollFreezeActiveStart,
  'the delayed host-scroll active-state guard must be independently locatable')
assert.match(hostScrollFreezeActiveSource, /epoch === state\.hostScrollFreezeEpoch/)
assert.match(hostScrollFreezeActiveSource, /root === state\.refs\.root/)
assert.match(hostScrollFreezeActiveSource, /root\.isConnected/)
assert.match(hostScrollFreezeActiveSource, /root\.classList\.contains\('is-open'\)/)
assert.match(hostScrollFreezeActiveSource, /document\.body\.classList\.contains\('novaflow-aifx-open'\)/)

const scheduleHostScrollFreezeStart = runtime.indexOf('const scheduleHostScrollFreeze = (root) =>')
const scheduleHostScrollFreezeEnd = runtime.indexOf('\n  const freezeHostLeftScroll', scheduleHostScrollFreezeStart)
const scheduleHostScrollFreezeSource = runtime.slice(scheduleHostScrollFreezeStart, scheduleHostScrollFreezeEnd)
assert.ok(scheduleHostScrollFreezeStart >= 0 && scheduleHostScrollFreezeEnd > scheduleHostScrollFreezeStart,
  'the delayed host-scroll scheduler must be independently locatable')
assert.equal((scheduleHostScrollFreezeSource.match(/epoch !== state\.hostScrollFreezeEpoch/g) || []).length, 2,
  'both delayed host-scroll callbacks must reject a stale open epoch')
assert.equal((scheduleHostScrollFreezeSource.match(/isHostScrollFreezeActive\(root, epoch\)/g) || []).length, 2,
  'both delayed host-scroll callbacks must verify the current connected open root')
assert.equal((scheduleHostScrollFreezeSource.match(/if \(!isHostScrollFreezeActive\(root, epoch\)\) return\s+freezeHostLeftScroll\(\)/g) || []).length, 2,
  'both delayed host-scroll callbacks must freeze only after the active-root guard passes')
assert.match(scheduleHostScrollFreezeSource, /state\.hostScrollFreezeRafId = window\.requestAnimationFrame/)
assert.match(scheduleHostScrollFreezeSource, /state\.hostScrollFreezeTimerId = window\.setTimeout/)

const aifxOpenStart = runtime.indexOf('const openApp = async (trigger) =>')
const aifxOpenEnd = runtime.indexOf('\n  const hideApp =', aifxOpenStart)
const aifxOpenSource = runtime.slice(aifxOpenStart, aifxOpenEnd)
const aifxHideStart = aifxOpenEnd + 1
const aifxHideEnd = runtime.indexOf('\n  const closeApp =', aifxHideStart)
const aifxHideSource = runtime.slice(aifxHideStart, aifxHideEnd)
assert.ok(aifxOpenStart >= 0 && aifxOpenEnd > aifxOpenStart && aifxHideEnd > aifxHideStart,
  'AIFX open and hide lifecycle functions must remain bounded')
assert.ok(aifxOpenSource.indexOf('cancelScheduledHostScrollFreeze()') >= 0
  && aifxOpenSource.indexOf('cancelScheduledHostScrollFreeze()') < aifxOpenSource.indexOf('const root = mount()')
  && aifxOpenSource.indexOf("root.classList.add('is-open')") < aifxOpenSource.indexOf('scheduleHostScrollFreeze(root)'),
  'each AIFX open must invalidate older callbacks before mounting and schedule only after the root is open')
assert.ok(aifxHideSource.indexOf('cancelScheduledHostScrollFreeze()') >= 0
  && aifxHideSource.indexOf('cancelScheduledHostScrollFreeze()') < aifxHideSource.indexOf("state.refs.root?.classList.remove('is-open')")
  && aifxHideSource.indexOf('cancelScheduledHostScrollFreeze()') < aifxHideSource.indexOf('restoreHostScroll()'),
  'AIFX hide must cancel delayed callbacks before closing the root or restoring host scroll')
assert.ok(aifxHideSource.indexOf('window.__NovaFlowAifxExportIntentUntil = 0') >= 0
  && aifxHideSource.indexOf('window.__NovaFlowAifxExportIntentUntil = 0') < aifxHideSource.indexOf('clearGeneratedState()'),
  'an ordinary AIFX hide must cancel stale export intent before the surface can be re-entered')
assert.doesNotMatch(aifxHideSource, /\.click\(/,
  'the public AIFX hide lifecycle must never replay a secondary-entry click')

const aifxOutsideClickStart = runtime.indexOf('document.addEventListener(', aifxHideEnd)
const aifxOutsideClickEnd = runtime.indexOf('document.addEventListener(', aifxOutsideClickStart + 1)
const aifxOutsideClickSource = runtime.slice(aifxOutsideClickStart, aifxOutsideClickEnd)
assert.ok(aifxOutsideClickStart >= 0 && aifxOutsideClickEnd > aifxOutsideClickStart,
  'the AIFX outside-click lifecycle guard must remain independently locatable')
const aifxProtectedExportStart = runtime.indexOf('const isProtectedExportInteraction = (target) =>')
const aifxProtectedExportEnd = runtime.indexOf('document.addEventListener(', aifxProtectedExportStart)
const aifxProtectedExportSource = runtime.slice(aifxProtectedExportStart, aifxProtectedExportEnd)
assert.ok(aifxProtectedExportStart >= 0 && aifxProtectedExportEnd > aifxProtectedExportStart,
  'the AIFX protected-export interaction adapter must remain independently locatable')
const aifxPrimaryExportBypassIndex = aifxProtectedExportSource.indexOf('[data-novaflow-primary-export-entry="1"]')
const aifxExportModalBypassIndex = aifxProtectedExportSource.indexOf('[data-novaflow-export-modal-root="1"][data-novaflow-export-context-kind="aifx"]')
const aifxLicenseModalBypassIndex = aifxProtectedExportSource.indexOf('[data-novaflow-license-modal-root="1"]')
const aifxLicenseDialogBypassIndex = aifxProtectedExportSource.indexOf('[data-novaflow-license-dialog="1"]')
const aifxExportDropdownBypassIndex = aifxProtectedExportSource.indexOf('[data-novaflow-export-modal-dropdown="1"]')
const aifxIntentGuardIndex = aifxProtectedExportSource.indexOf('__NovaFlowAifxExportIntentUntil')
const aifxTopbarGuardIndex = aifxProtectedExportSource.indexOf('.nf-topbar')
const aifxOutsideHideIndex = aifxOutsideClickSource.indexOf("if (root?.classList.contains('is-open') && !root.contains(event.target))")
assert.ok(aifxExportModalBypassIndex > aifxPrimaryExportBypassIndex
  && aifxLicenseModalBypassIndex > aifxExportModalBypassIndex
  && aifxLicenseDialogBypassIndex > aifxLicenseModalBypassIndex
  && aifxExportDropdownBypassIndex > aifxLicenseDialogBypassIndex
  && aifxTopbarGuardIndex > aifxExportDropdownBypassIndex
  && aifxIntentGuardIndex > aifxTopbarGuardIndex,
  'primary Export, export/auth dialogs, modal dropdowns, and topbar forwarding must all be protected')
assert.match(aifxProtectedExportSource,
  /const exportModalOpen[\s\S]*?const exportModalDropdownOpen[\s\S]*?data-novaflow-export-modal-dropdown[\s\S]*?#novaflow-global-dropdown-overlay, #novaflow-global-dropdown-portal/,
  'an open AIFX export modal must also protect its portaled dropdown panel and dismissal layer')
assert.match(aifxProtectedExportSource,
  /actionText === '文件' \|\| actionText\.startsWith\('导出'\)[\s\S]*?__NovaFlowAifxExportIntentUntil = Date\.now\(\) \+ 4000[\s\S]*?if \(action\) return false/,
  'direct File-to-Export forwarding must be protected without retaining unrelated concrete menu actions')
assert.match(aifxProtectedExportSource,
  /#novaflow-global-dropdown-overlay[\s\S]*?#novaflow-global-dropdown-portal[\s\S]*?data-novaflow-dropdown-panel/,
  'intent-scoped File-menu portal clicks must preserve AIFX until the unified export modal is mounted')
const aifxProtectedExportCallIndex = aifxOutsideClickSource.indexOf('isProtectedExportInteraction(event.target)')
assert.ok(aifxProtectedExportCallIndex >= 0 && aifxOutsideHideIndex > aifxProtectedExportCallIndex,
  'the protected export path must return before top-menu or generic outside-click hiding can clear AIFX state')
assert.match(aifxOutsideClickSource,
  /if \(root\?\.classList\.contains\('is-open'\) && isProtectedExportInteraction\(event\.target\)\) return/,
  'AIFX must leave the unified primary Export click for the Brand dispatcher without clearing result state')

const aifxSideCssStart = runtime.indexOf('      .aifx-side {')
const aifxSideCssEnd = runtime.indexOf('      .aifx-section {', aifxSideCssStart)
const aifxSideCssSource = runtime.slice(aifxSideCssStart, aifxSideCssEnd)
const aifxSectionBodyCssStart = runtime.indexOf('      .aifx-section-body {', aifxSideCssStart)
const aifxSectionBodyCssEnd = runtime.indexOf('      .aifx-section[data-open="0"]', aifxSectionBodyCssStart)
const aifxSectionBodyCssSource = runtime.slice(aifxSectionBodyCssStart, aifxSectionBodyCssEnd)
assert.ok(aifxSideCssStart >= 0 && aifxSideCssEnd > aifxSideCssStart,
  'AIFX left panel CSS must remain independently locatable')
assert.match(aifxSideCssSource, /padding: \$\{AIFX_LEFT_PANEL_TOKENS\.panelGap\} 0 28px;/,
  'AIFX panel top spacing must use the shared accordion gap token')
assert.match(aifxSideCssSource, /overflow-x: hidden;/)
assert.ok(aifxSectionBodyCssStart >= 0 && aifxSectionBodyCssEnd > aifxSectionBodyCssStart,
  'AIFX expanded section body CSS must remain independently locatable')
assert.match(aifxSectionBodyCssSource, /grid-template-columns: minmax\(0, 1fr\);/)
assert.match(aifxSectionBodyCssSource, /min-width: 0;[\s\S]*?max-width: 100%;/)
assert.match(aifxSectionBodyCssSource, /\.aifx-section-body > \* \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?box-sizing: border-box;/,
  'expanded AIFX controls must shrink inside the fixed left-panel width instead of clipping')

const brandAifxPrimaryResetStart = brandRuntime.indexOf('function resetAifxSurfaceForPrimaryEffectsEntry')
const brandAifxPrimaryResetEnd = brandRuntime.indexOf('\n  function isNovaflowAifxSecondaryActiveContext', brandAifxPrimaryResetStart)
const brandAifxPrimaryResetSource = brandRuntime.slice(brandAifxPrimaryResetStart, brandAifxPrimaryResetEnd)
assert.ok(brandAifxPrimaryResetStart >= 0 && brandAifxPrimaryResetEnd > brandAifxPrimaryResetStart,
  'Brand must provide one bounded adapter that resets a primary Effects return to Particle Effects')
const aifxExportGuardIndex = brandAifxPrimaryResetSource.indexOf('hasNovaflowAifxExportIntent()')
const aifxExportModalGuardIndex = brandAifxPrimaryResetSource.indexOf('isNovaflowAifxExportModalOpen()')
const aifxExportPreserveIndex = brandAifxPrimaryResetSource.indexOf('preserveNovaflowAifxExportSurface()', aifxExportModalGuardIndex)
const aifxExportReturnIndex = brandAifxPrimaryResetSource.indexOf('return false;', aifxExportPreserveIndex)
const aifxRememberParticleIndex = brandAifxPrimaryResetSource.indexOf('SECONDARY_ACTIVE_BY_GROUP.set(groupKey, "\\u7c92\\u5b50\\u7279\\u6548")')
const aifxClearUserChoiceIndex = brandAifxPrimaryResetSource.indexOf('SECONDARY_USER_SELECTED_BY_GROUP.delete(groupKey)')
const aifxRootCloseIndex = brandAifxPrimaryResetSource.indexOf('body.classList.remove("novaflow-aifx-open")')
const aifxRootClassCloseIndex = brandAifxPrimaryResetSource.indexOf('root.classList.remove("is-open")')
const aifxFinalRememberParticleIndex = brandAifxPrimaryResetSource.lastIndexOf('SECONDARY_ACTIVE_BY_GROUP.set(groupKey, "\\u7c92\\u5b50\\u7279\\u6548")')
const aifxFinalClearUserChoiceIndex = brandAifxPrimaryResetSource.lastIndexOf('SECONDARY_USER_SELECTED_BY_GROUP.delete(groupKey)')
assert.ok(aifxExportGuardIndex >= 0 && aifxExportModalGuardIndex >= 0
  && aifxExportGuardIndex < aifxRememberParticleIndex
  && aifxExportModalGuardIndex < aifxExportPreserveIndex
  && aifxExportPreserveIndex < aifxExportReturnIndex
  && aifxExportReturnIndex < aifxRememberParticleIndex,
  'an active AIFX export intent or modal must preserve and return before any default-state reset')
assert.ok(aifxRememberParticleIndex >= 0 && aifxClearUserChoiceIndex > aifxRememberParticleIndex,
  'primary Effects return must align remembered and user-selected state with Particle Effects')
assert.match(brandAifxPrimaryResetSource, /body\.classList\.contains\("novaflow-aifx-open"\)[\s\S]*?root instanceof HTMLElement && root\.classList\.contains\("is-open"\)/,
  'the reset must detect either residual AIFX open marker')
assert.match(brandAifxPrimaryResetSource, /window\.NovaFlowAifxMvp/)
assert.match(brandAifxPrimaryResetSource, /typeof api\.hide === "function"[\s\S]*?api\.hide\(\{ activateParticle: true \}\)/,
  'an open AIFX root must prefer the non-clicking public hide lifecycle bridge')
assert.match(runtime, /window\.NovaFlowAifxMvp = \{[\s\S]*?hide: hideApp,/,
  'the AIFX public API must expose its non-clicking hide lifecycle bridge')
assert.ok(aifxRootCloseIndex >= 0 && aifxRootClassCloseIndex > aifxRootCloseIndex
  && aifxFinalRememberParticleIndex > aifxRootClassCloseIndex
  && aifxFinalClearUserChoiceIndex > aifxFinalRememberParticleIndex,
  'root markers and both secondary-state stores must finish in the Particle state even after a close adapter error')
assert.doesNotMatch(brandAifxPrimaryResetSource, /\.open\(|\.click\(|setTimeout|requestAnimationFrame|queueMicrotask/,
  'primary Effects return must neither replay a secondary click nor reopen AIFX through a delayed callback')
assert.doesNotMatch(brandRuntime, /function restoreRememberedAifxSurfaceForPrimaryEffects/,
  'Brand must not retain the remembered-AI restore path')
const brandPrimaryPostActivationStart = brandRuntime.indexOf('function handlePrimaryEntryPostActivation')
const brandPrimaryPostActivationEnd = brandRuntime.indexOf('\n  function bindPrimaryEntryActivationCapture', brandPrimaryPostActivationStart)
const brandPrimaryPostActivationSource = brandRuntime.slice(brandPrimaryPostActivationStart, brandPrimaryPostActivationEnd)
const primaryTargetIndex = brandPrimaryPostActivationSource.indexOf('syncPrimarySwitchTarget(resolved);')
const primaryChromeIndex = brandPrimaryPostActivationSource.indexOf('syncPrimarySwitchChrome(resolved);')
const primaryAifxResetIndex = brandPrimaryPostActivationSource.indexOf('resetAifxSurfaceForPrimaryEffectsEntry();')
const primaryFirstFrameIndex = brandPrimaryPostActivationSource.indexOf('primePrimarySwitchFirstFrameLayout(resolved);')
assert.ok(primaryTargetIndex >= 0
  && primaryTargetIndex < primaryAifxResetIndex
  && primaryAifxResetIndex < primaryChromeIndex
  && primaryChromeIndex < primaryFirstFrameIndex,
  'the Particle default must reset after target sync and before chrome/first-frame layout')
assert.ok(brandPrimaryPostActivationSource.includes('if (resolved === "\\u7279\\u6548") resetAifxSurfaceForPrimaryEffectsEntry();'),
  'the Particle-default reset adapter must run only when the primary Effects route activates')

const brandAccordionBypassIndex = brandRuntime.indexOf('if (isAifxAccordionSection) return;')
assert.ok(brandAccordionBypassIndex >= 0, 'Brand normalization must bypass source-owned AIFX accordion sections')
assert.match(brandRuntime, /panel\.hasAttribute\("data-aifx-section"\)[\s\S]*?panel\.closest\("\.aifx-side"\) instanceof HTMLElement;[\s\S]*?if \(isAifxAccordionSection\) return;/,
  'the Brand bypass must be limited to left-side AIFX accordion sections')
assert.ok(!brandRuntime.includes('.aifx-section[data-aifx-section][data-open="0"] > .aifx-section-body'),
  'Brand CSS must not force collapsed AIFX bodies visible')
const brandNormalizeStart = brandRuntime.indexOf('function normalizeAifxLeftPanelTokens')
const brandNormalizeEnd = brandRuntime.indexOf('function scheduleAifxLeftPanelTokens', brandNormalizeStart)
const brandNormalizeSource = brandRuntime.slice(brandNormalizeStart, brandNormalizeEnd)
for (const forbiddenMutation of [
  'setAttributeIfChanged(panel, "data-open", "1")',
  'removeAttribute("data-section-toggle")',
  'body.hidden = false',
  'display: isAifxSection ? "block"',
  'title.textContent = "风格强度"',
  'label.textContent = ""',
]) {
  assert.ok(!brandNormalizeSource.includes(forbiddenMutation),
    `Brand AIFX normalization must not retain the flat-panel mutation: ${forbiddenMutation}`)
}

assert.match(runtime, /data-action="generate"[^\n]+runAifxProductionPipeline/)
assert.doesNotMatch(runtime, /data-action="generate"[^\n]+runAifxSpritesheetConditionedRegenPipelineSequence/)
assert.match(runtime, /createAifxGenerationSnapshot\(provider, generationController\)/)
assert.match(runtime, /createSpriteSheetPlan\(snapshot\.templateFrames, \{[\s\S]*?alignTo: 16/)
assert.match(runtime, /prepareAifxTemplateSheet\(modules\.template, modules\.motionGuide, snapshot\)/)
assert.match(runtime, /const buildAifxMaterialOnlyStyleContract = \(detected, materialType, materialDirection, styleReference\) =>/)
assert.match(runtime, /modules\.materialReconstruct\.buildReferenceContract\(\{/)
assert.match(materialReconstruct, /function selectAnchorSpecs\(value\)/)
assert.doesNotMatch(runtime, /plannedAifxPeakIndexFor|selectAifxAnchorFrames|retryableAnchorCodes|tailOnlyRetry/)
assert.match(runtime, /const measuredPeakFrame = maxEnergy > 0[\s\S]*?Math\.min\(measuredPeakFrame, safeFrameCount - 2\)/)
assert.match(runtime, /state\.templateFrames\.length < 2[\s\S]*?材质形体演变至少需要 2 帧/)
assert.match(materialReconstruct, /async function prepareAnchorGuide\(options = \{\}, dependencies = \{\}\)/)
assert.match(materialReconstruct, /function createReadableGuidePlan\(options = \{\}\)/)
assert.match(materialReconstruct, /function referenceModeForAnchor\(role\)/)
assert.match(materialReconstruct, /function modelStyleStrengthForAnchor\(role, styleStrength\)/)
assert.match(materialReconstruct, /function controlProfileForAnchor\(role, baseProfile = \{\}, attempt = 1\)/)
assert.match(materialReconstruct, /function evaluateAnchorIsolation\(metrics = \{\}, role = 'peak'\)/)
assert.match(materialReconstruct, /function refineGeneratedAnchorTopology\(frame, options = \{\}, dependencies = \{\}\)/)
assert.match(materialReconstruct, /const readability = createReadableGuidePlan\(\{/)
assert.match(materialReconstruct, /readability\.readabilityApplied[\s\S]*?safeContext\.scale\(readability\.scale, readability\.scale\)/)
assert.match(anchorPipelineSource, /guideNormalization: guide\.readability/)
assert.match(anchorPipelineSource, /const peakIdentityRun = attemptRuns\.find\(\(entry\) => entry\.spec\.role === 'peak'\)/)
assert.match(runtime, /materialIdentity: window\.NovaFlowAifxMaterialIdentityResource/)
assert.match(anchorPipelineSource, /const anchorStyleReference = referenceMode === 'generated-peak-material-token'/)
assert.match(anchorPipelineSource, /peakIdentityRun\?\.materialToken \|\| null/)
assert.match(anchorPipelineSource, /materialIdentity\.buildPeakMaterialToken\(safeAnchor\.frame\.canvas, \{/)
assert.match(anchorPipelineSource, /strength: anchorPrompt\.modelStyleStrength/)
assert.match(anchorPipelineSource, /const anchorControl = controlProfileForAnchor\(anchorSpec\.role, options\.localControl, anchorAttempt\)/)
assert.match(materialReconstruct, /const localGuideFrame = \{[\s\S]*?index: 0,[\s\S]*?sequenceNumber: 0,[\s\S]*?name: 'frame_000\.png'/)
assert.match(materialReconstruct, /createSpriteSheetPlan\(\[localGuideFrame\]/)
assert.match(materialReconstruct, /packFrames\(\[localGuideFrame\]/)
assert.match(runtime, /motionGuideResource\.createGuideFrames\(/)
assert.match(anchorPipelineSource, /postprocessWorkflow\.postprocessGeneratedSheet\(\{/)
assert.match(runtime, /const materializeAifxTemplateSequence = \(/)
assert.match(runtime, /materialReconstruct: window\.NovaFlowAifxMaterialReconstructWorkflow/)
assert.match(runtime, /window\.__AIFX_LAST_RAW_SEQUENCE_QUALITY__/)
assert.match(runtime, /window\.__AIFX_LAST_TEMPORAL_CORRECTION__/)
assert.match(runtime, /window\.__AIFX_LAST_TEMPLATE_MATERIALIZATION__/)
assert.match(anchorPipelineSource, /const motionConstraint = conformed\.motionConstraint/)
assert.match(runtime, /assertAifxGenerationCurrent\(snapshot\)[\s\S]*?state\.generatedFrames = runtimeFrames/)
assert.match(runtime, /signal: snapshot\.signal/)
assert.match(runtime, /data-aifx-generation-locked/)
assert.match(runtime, /refs\.templateInput\.disabled = generationLocked/)
assert.match(runtime, /refs\.styleInput\.disabled = generationLocked/)
assert.match(runtime, /refs\.promptSupplement\.disabled = generationLocked/)
assert.match(runtime, /state\.promptSupplement = String\(event\.currentTarget\.value \|\| ''\)\.slice\(0, 400\)[\s\S]*?state\.autoPrompt = null[\s\S]*?clearGeneratedState\(\)/)
assert.match(runtime, /promptSupplement: String\(state\.promptSupplement \|\| ''\)\.slice\(0, 400\)/)
assert.doesNotMatch(runtime, /materialTarget|material-target/,
  'manual material targeting must not remain in the AIFX UI or generation state')
assert.match(runtime, /refs\.material\.disabled = generationLocked/)
assert.match(runtime, /refs\.contour\.disabled = generationLocked/)
assert.match(runtime, /providerControl instanceof HTMLSelectElement\) providerControl\.disabled = generationLocked/)
assert.match(runtime, /state\.generationAbort\.abort\('AIFX panel closed by user'\)/)
assert.match(runtime, /modules\.prompt\.compile\(\{[\s\S]*?canvasWidth: plan\.sheetSize\.width/)
assert.match(runtime, /modules\.materialReconstruct\.runAnchorPipeline\(\{/)
assert.match(anchorPipelineSource, /const anchorPrompt = compileAnchorPrompt\(/)
assert.match(runtime, /sequencePlan,/)
assert.match(anchorPipelineSource, /generateWorkflow\.run\(\{/)
assert.match(runtime, /const normalizedSequencePlan = compiled\.sequencePlan/)
assert.match(anchorPipelineSource, /const anchorSpecs = selectAnchorSpecs\(sequencePlan\)/)
assert.match(runtime, /const materialType = inferredMaterialType/)
assert.match(anchorPipelineSource, /const morphologyPlan = createPlan\(\{/)
assert.match(anchorPipelineSource, /const modelAnchorSpecs = morphologyPlan\.anchors/)
assert.match(anchorPipelineSource, /prepareAnchorGuide\(\{[\s\S]*?motionGuideFrame: packed\.motionGuide\.frames\[globalIndex\]/)
assert.match(runtime, /materialPrompt: autoPrompt\.positivePrompt/)
assert.match(runtime, /modules\.prompt\.compile\(\{[\s\S]*?promptSupplement: snapshot\.promptSupplement/)
assert.match(runtime, /modules\.materialReconstruct\.runAnchorPipeline\(\{[\s\S]*?promptSupplement: snapshot\.promptSupplement/)
assert.match(materialReconstruct, /materialPrompt: options\.materialPrompt,[\s\S]*?promptSupplement: options\.promptSupplement,[\s\S]*?styleDescription: options\.styleDescription/)
assert.match(runtime, /styleDescription: autoPrompt\.styleDescription/)
assert.match(anchorPipelineSource, /structurePrompt: anchorPrompt\.structurePrompt/)
assert.match(anchorPipelineSource, /stylePrompt: anchorPrompt\.stylePrompt/)
assert.match(anchorPipelineSource, /promptsPrecompiled: true/)
assert.match(resultContractSource, /identityStrategy: morphologyPlan\.identityConditioning/)
assert.match(resultContractSource, /phaseAnchorsDerivedFromPeak:/)
assert.match(resultContractSource, /phaseAnchorsIdentityConditionedByPeak: run\.controlGuidance\.source\.includes\('macro-free-peak-material-token'\)/)
assert.match(anchorPipelineSource, /entry\.candidate\.peakMaterialTokenConditioning === true[\s\S]*?entry\.candidate\.visualReferenceConnected === true[\s\S]*?entry\.candidate\.visualReferenceEffective === true[\s\S]*?Number\(entry\.candidate\.visualReferenceEndPercent\) > 0/)
assert.match(resultContractSource, /phaseAnchorsSpatiallyConditionedByPeak: false/)
assert.match(resultContractSource, /phaseAnchorsMacroSilhouetteConditionedByPeak: false/)
assert.match(resultContractSource, /modelProducesFullSequence: false/)
assert.match(resultContractSource, /sequenceSynthesizer: 'material-morphology-anchor-conform'/)
assert.match(materialReconstruct, /directionAlignmentEnabled: true/)
assert.doesNotMatch(
  materialReconstruct,
  /qualityThresholds|applyTopologyBreakup|randomAlpha|Math\.random|crypto\.getRandomValues/,
  'formal morphology reconstruction must not relax quality or punch random holes into alpha',
)
assert.match(resultContractSource, /intermediateDirectionTransformApplied: true/)
assert.match(resultContractSource, /tailTopologyEvolutionApplied:/)
assert.match(resultContractSource, /perTemplateFrameStructureUsed: false/)
assert.match(anchorPipelineSource, /const retryPolicy = createRetryPolicy\(morphologyPlan, \{/)
assert.match(runtime, /maximumAnchorAttempts: 3/)
assert.match(runtime, /const initialSequenceSeed = Math\.floor\(Date\.now\(\) % 2147483647\)/)
assert.match(anchorPipelineSource, /for \(let anchorAttempt = 1; anchorAttempt <= maximumAnchorAttempts; anchorAttempt \+= 1\)/)
assert.match(anchorPipelineSource, /const sequenceSeed = sequenceSeedForAttempt\(retryPolicy, anchorAttempt\)/)
assert.match(anchorPipelineSource, /const anchorSeed = seedForAnchorRole\(sequenceSeed, anchorSpec\.role\)/)
assert.match(resultContractSource, /seedStrategy: run\.retryPolicy\.seedStrategy/)
assert.match(anchorPipelineSource, /const retainedRun = retainedStableAnchorRuns\.find/)
assert.match(anchorPipelineSource, /const retryDecision = evaluateRetry\(retryPolicy, \{/)
assert.match(anchorPipelineSource, /retryDecision\.retainedRoles\.includes\(entry\.spec\.role\)/)
assert.match(materialReconstruct, /AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_INCOMPATIBLE/)
assert.match(materialReconstruct, /AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_DUPLICATE/)
assert.match(materialReconstruct, /AIFX_TEMPORAL_CONFORM_PEAK_DOMINANCE_FAILED/)
assert.match(materialReconstruct, /AIFX_ANCHOR_MATERIAL_UNREADABLE/)
assert.match(materialReconstruct, /AIFX_ANCHOR_NOT_ISOLATED/)
assert.match(runtime, /const analyzeAifxAnchorMaterialDetail = \(frame\) =>/)
assert.match(materialReconstruct, /function analyzeRawAnchorIsolation\(image, dependencies = \{\}\)/)
assert.match(anchorPipelineSource, /evaluateAnchorIsolation\(/)
assert.match(anchorPipelineSource, /const materialDetail = assertAnchorMaterialReadable\(safeAnchor\.frame, materialType, anchorSpec\.role\)/)
assert.match(anchorPipelineSource, /const attemptSequenceQuality = qualityWorkflow\.evaluate/)
assert.match(resultContractSource, /fullPeakIdentityImageSent: anchorRuns\.some\(\(entry\) => entry\.referenceMode === 'generated-peak-material-identity'\)/)
assert.match(resultContractSource, /fullMaterialReferenceImageSent: true/)
assert.doesNotMatch(runtime, /aifx_peak_identity_swatch_attempt_/)
assert.doesNotMatch(runtime, /identityReferenceFor\(/)
assert.match(anchorPipelineSource, /if \(!retryDecision\.shouldRetry\) \{[\s\S]*?error\.rejectedAnchorAttempts = Object\.freeze/)
assert.match(anchorPipelineSource, /acceptedAnchorAttempt/)
assert.match(anchorPipelineSource, /rejectedAnchorAttempts/)
assert.match(anchorPipelineSource, /fitClippedAnchorToSafeMargin\(cleanedAnchor\.frame, rawAnchorGeometry\)/)
assert.match(anchorPipelineSource, /refineGeneratedAnchorTopology\(decodedRuntimeFrame, \{/)
assert.match(anchorPipelineSource, /removeIsolatedCoreObjects\(topologyRefined\.frame, materialType\)/)
assert.match(materialReconstruct, /source: 'ai-generated-anchor-pixels'[\s\S]*?templatePixelsUsed: false,[\s\S]*?templateMaskUsed: false/)
assert.match(runtime, /method: 'isolated-core-object-rejection'/)
assert.match(runtime, /method: 'ai-alpha-edge-feather-and-uniform-contain'/)
assert.match(runtime, /sequencePlan: normalizedSequencePlan/)
assert.match(anchorPipelineSource, /controlStrength: anchorControl\.strength/)
assert.match(anchorPipelineSource, /controlEndPercent: anchorControl\.endPercent/)
assert.match(anchorPipelineSource, /qualityWorkflow\.evaluate\(\{/)
assert.match(runtime, /previousPostPeakRank = Math\.max\(previousPostPeakRank, candidatePhaseRank\)/)
assert.match(runtime, /Number\.isFinite\(centerX\)/)
assert.match(runtime, /Number\.isFinite\(centerY\)/)
assert.match(runtime, /coverageRatio: clamp\(sampledActiveArea \/ Math\.max\(1, width \* height\), 0, 1\)/)
assert.match(runtime, /templateAlphaQuality\[index\]\?\.coverageRatio[\s\S]*?templateCoverageReliable[\s\S]*?Number\.isFinite\(coverageRatio\) \? coverageRatio : bboxOccupancy/)
assert.match(runtime, /buildAifxSequencePlan\(snapshot, plan\.lifecycle, packed\.templateAlphaQuality\)/)
assert.match(anchorPipelineSource, /log\('\[AIFX sequence quality\]', JSON\.stringify\(sequenceQuality\)\)/)
assert.match(anchorPipelineSource, /shapeSource: conformed\.shapeSource/)
const productionStart = runtime.indexOf('const runAifxProductionPipeline')
const productionEnd = runtime.indexOf('\n  const runAifxSpritesheetConditionedRegenPipelineSequence', productionStart)
const productionRuntime = runtime.slice(productionStart, productionEnd)
assert.match(productionRuntime, /modules\.materialReconstruct\.runAnchorPipeline\(\{/)
assert.match(productionRuntime, /modules\.materialReconstruct\.buildPipelineResult\(morphology, \{/)
assert.match(productionRuntime, /state\.lastPipelineSummary = pipelineResult\.pipelineSummary/)
assert.doesNotMatch(productionRuntime, /modules\.templateMaterialize|NovaFlowAifxTemplateMaterializeWorkflow|renderLockedMaterialTransfer\(|enforceAifxTemplateAlpha\(/)
assert.match(productionRuntime, /modules\.prompt\.compile\(\{[\s\S]*?materialType,[\s\S]*?sequencePlan,/)
assert.doesNotMatch(productionRuntime, /createPlan\(|generateWorkflow\.run|modules\.generate\.run|postprocessGeneratedSheet|createRetryPolicy|evaluateRetry|analyzeRawAnchorIsolation/)
assert.doesNotMatch(runtime, /deterministic-peak-material-lifecycle/)
assert.match(productionRuntime, /styleReference: snapshot\.styleReference/)
assert.doesNotMatch(productionRuntime, /materialSwatch|materialVocabularyInput|buildAifxCompositionNeutralMaterialSwatch/)
assert.match(anchorPipelineSource, /source: phaseAnchorsIdentityConditionedByPeak[\s\S]*?'full-reference-peak-plus-macro-free-peak-material-token-and-phase-guides'/)
assert.match(resultContractSource, /fullReferenceImageSent: morphologyPlan\.reference\.fullReferenceImageSent/)
const anchorSelectionIndex = anchorPipelineSource.indexOf('const anchorSpecs = selectAnchorSpecs(sequencePlan)')
const anchorPromptIndex = anchorPipelineSource.indexOf('const anchorPrompt = compileAnchorPrompt(')
const anchorGenerationIndex = anchorPipelineSource.indexOf('const candidate = await generateWorkflow.run({')
const anchorPostprocessIndex = anchorPipelineSource.indexOf('postprocessWorkflow.postprocessGeneratedSheet({')
const morphologyReconstructIndex = anchorPipelineSource.indexOf('const attemptConformed = await reconstruct({')
const attemptQualityLogIndex = anchorPipelineSource.indexOf("log('[AIFX anchor attempt quality]'")
const qualityLogIndex = anchorPipelineSource.indexOf("log('[AIFX sequence quality]', JSON.stringify(sequenceQuality))")
const qualityFailureIndex = anchorPipelineSource.indexOf('if (!attemptSequenceQuality.passed)')
assert.ok(anchorSelectionIndex >= 0 && anchorSelectionIndex < anchorPromptIndex)
assert.ok(anchorPromptIndex < anchorGenerationIndex, 'the peak material anchor must be compiled before its AI call')
assert.ok(anchorGenerationIndex < anchorPostprocessIndex, 'the AI peak must be postprocessed after generation')
assert.ok(anchorPostprocessIndex < morphologyReconstructIndex, 'all AI anchors must exist before morphology reconstruction')
assert.ok(morphologyReconstructIndex < attemptQualityLogIndex, 'attempt quality evidence must evaluate the anchor-driven sequence')
assert.ok(attemptQualityLogIndex < qualityFailureIndex, 'attempt quality evidence must be logged before a rejection is thrown')
assert.ok(qualityFailureIndex < qualityLogIndex, 'accepted final quality evidence must be logged after retry validation')
assert.doesNotMatch(anchorPipelineSource, /completedRuns: attemptRuns/)
const anchorGenerationEnd = anchorPipelineSource.indexOf('\n          })', anchorGenerationIndex)
const anchorGenerationCall = anchorPipelineSource.slice(anchorGenerationIndex, anchorGenerationEnd)
assert.match(anchorGenerationCall, /guide: \{/)
assert.match(anchorGenerationCall, /seed: anchorSeed/)
assert.doesNotMatch(anchorGenerationCall, /identityReference/)
assert.doesNotMatch(anchorGenerationCall, /sheet:/, 'formal local generation must not send the packed template atlas to the model')
assert.doesNotMatch(anchorPipelineSource, /\[AIFX raw sequence quality\]/, 'formal morphology reconstruction evaluates only the conformed final sequence')
assert.match(
  anchorPipelineSource,
  /const attemptSequenceQuality = qualityWorkflow\.evaluate\(\{\s*templateFrames,\s*generatedFrames: attemptConformed\.frames,\s*\}\)/,
  'formal reconstruction must use the strict shared quality gate without threshold overrides',
)
assert.doesNotMatch(anchorPipelineSource, /qualityThresholds|thresholds\s*:|applyTopologyBreakup|randomAlpha/)

const analysisStart = runtime.indexOf('  const analyzeFrame =')
const analysisEnd = runtime.indexOf('  const buildCenterline =', analysisStart)
assert.ok(analysisStart >= 0 && analysisEnd > analysisStart)
const analysisSandbox = {
  clamp(value, min, max) { return Math.max(min, Math.min(max, value)) },
  luminance(red, green, blue) { return (red + green + blue) / (255 * 3) },
  buildCenterline() { return [] },
}
runInNewContext(`${runtime.slice(analysisStart, analysisEnd)}\nglobalThis.__analyzeFrame = analyzeFrame`, analysisSandbox)
const coverageData = new Uint8ClampedArray(4 * 4 * 4)
coverageData[3] = 255
coverageData[((3 * 4 + 3) * 4) + 3] = 255
const coverageGuide = analysisSandbox.__analyzeFrame({
  width: 4,
  height: 4,
  getContext() { return { getImageData() { return { data: coverageData } } } },
})
assert.equal(coverageGuide.coverageRatio, 2 / 16, 'analyzeFrame occupancy input must measure active sampled area')
const fallbackGuideResult = analysisSandbox.__analyzeFrame({
  width: 32,
  height: 32,
  getContext() { return { getImageData() { return { data: new Uint8ClampedArray(32 * 32 * 4) } } } },
})
assert.ok(fallbackGuideResult.coverageRatio > 0 && fallbackGuideResult.coverageRatio <= 0.25)

const sequencePlanStart = runtime.indexOf('  const buildAifxSequencePlan =')
const sequencePlanEnd = runtime.indexOf('  const prepareAifxTemplateSheet =', sequencePlanStart)
assert.ok(sequencePlanStart >= 0 && sequencePlanEnd > sequencePlanStart)
const sequencePlanSandbox = {
  clamp(value, min, max) { return Math.max(min, Math.min(max, value)) },
  fallbackGuide() { throw new Error('fixture supplies every guide') },
}
runInNewContext(`${runtime.slice(sequencePlanStart, sequencePlanEnd)}\nglobalThis.__buildAifxSequencePlan = buildAifxSequencePlan`, sequencePlanSandbox)
const descendingPlan = JSON.parse(JSON.stringify(sequencePlanSandbox.__buildAifxSequencePlan({
  templateFrames: [{ width: 100, height: 100 }, { width: 100, height: 100 }, { width: 100, height: 100 }],
  templateGuides: [
    { energy: 100, coverageRatio: 0.6, center: { x: 0, y: 0 }, bbox: { width: 20, height: 20 }, canvasWidth: 100, canvasHeight: 100 },
    { energy: 50, coverageRatio: 0.3, center: { x: 50, y: 50 }, bbox: { width: 90, height: 90 }, canvasWidth: 100, canvasHeight: 100 },
    { energy: 10, coverageRatio: 0.1, center: { x: 60, y: 60 }, bbox: { width: 98, height: 98 }, canvasWidth: 100, canvasHeight: 100 },
  ],
}, { peakFrame: 0 })))
assert.deepEqual(descendingPlan.map((frame) => frame.occupancy), [0.6, 0.3, 0.1])
assert.ok(descendingPlan[0].occupancy > descendingPlan[1].occupancy && descendingPlan[1].occupancy > descendingPlan[2].occupancy,
  'declining energy/coverage must not be reversed by expanding sparse bounding boxes')
assert.equal(descendingPlan[0].centerX, 0, 'a valid zero-valued motion anchor must be preserved')
assert.equal(descendingPlan[0].centerY, 0, 'a valid zero-valued motion anchor must be preserved')
const alphaCalibratedPlan = JSON.parse(JSON.stringify(sequencePlanSandbox.__buildAifxSequencePlan({
  templateFrames: [{ width: 100, height: 100 }, { width: 100, height: 100 }, { width: 100, height: 100 }],
  templateGuides: [
    { energy: 100, coverageRatio: 0.6, center: { x: 0, y: 0 }, bbox: { width: 20, height: 20 }, canvasWidth: 100, canvasHeight: 100 },
    { energy: 50, coverageRatio: 0.3, center: { x: 50, y: 50 }, bbox: { width: 90, height: 90 }, canvasWidth: 100, canvasHeight: 100 },
    { energy: 10, coverageRatio: 0.1, center: { x: 60, y: 60 }, bbox: { width: 98, height: 98 }, canvasWidth: 100, canvasHeight: 100 },
  ],
}, { peakFrame: 0 }, [
  { coverageRatio: 0.52 },
  { coverageRatio: 0.21 },
  { coverageRatio: 0.04 },
])))
assert.deepEqual(alphaCalibratedPlan.map((frame) => frame.occupancy), [0.52, 0.21, 0.04])

const anchorSelection = JSON.parse(JSON.stringify(materialWorkflow.selectAnchorSpecs([
  { index: 0, phase: 'onset', energy: 0.2, occupancy: 0.08 },
  { index: 1, phase: 'growth', energy: 0.58, occupancy: 0.2 },
  { index: 2, phase: 'peak', energy: 1, occupancy: 0.3 },
  { index: 3, phase: 'follow-through', energy: 0.65, occupancy: 0.23 },
  { index: 4, phase: 'decay', energy: 0.42, occupancy: 0.18 },
  { index: 5, phase: 'decay', energy: 0.31, occupancy: 0.12 },
  { index: 6, phase: 'decay', energy: 0.2, occupancy: 0.09 },
  { index: 7, phase: 'breakup', energy: 0.1, occupancy: 0.05, directionDeg: 55 },
  { index: 8, phase: 'dissipation', energy: 0.01, occupancy: 0.002, directionDeg: 80 },
])))
assert.deepEqual(anchorSelection.map((entry) => [entry.role, entry.globalIndex]), [
  ['peak', 2],
  ['decay', 5],
  ['breakup', 7],
  ['dissipation', 8],
])
const skippedDecayPhaseSelection = JSON.parse(JSON.stringify(materialWorkflow.selectAnchorSpecs([
  { index: 0, phase: 'onset', energy: 0.34, occupancy: 0.12 },
  { index: 1, phase: 'peak', energy: 1, occupancy: 0.34 },
  { index: 2, phase: 'follow-through', energy: 0.92, occupancy: 0.33 },
  { index: 3, phase: 'follow-through', energy: 0.96, occupancy: 0.34 },
  { index: 4, phase: 'follow-through', energy: 0.78, occupancy: 0.29 },
  { index: 5, phase: 'follow-through', energy: 0.67, occupancy: 0.26 },
  { index: 6, phase: 'breakup', energy: 0.24, occupancy: 0.09, directionDeg: -17 },
  { index: 7, phase: 'breakup', energy: 0.03, occupancy: 0.012, directionDeg: 38 },
  { index: 8, phase: 'dissipation', energy: 0.01, occupancy: 0.004, directionDeg: 40 },
])))
assert.deepEqual(skippedDecayPhaseSelection.map((entry) => [entry.role, entry.globalIndex]), [
  ['peak', 1],
  ['decay', 5],
  ['breakup', 7],
  ['dissipation', 8],
])
const latePeakAnchorSelection = JSON.parse(JSON.stringify(materialWorkflow.selectAnchorSpecs([
  { index: 0, phase: 'onset', energy: 0.1, occupancy: 0.05 },
  { index: 1, phase: 'growth', energy: 0.3, occupancy: 0.12 },
  { index: 2, phase: 'growth', energy: 0.5, occupancy: 0.2 },
  { index: 3, phase: 'growth', energy: 0.7, occupancy: 0.27 },
  { index: 4, phase: 'growth', energy: 0.85, occupancy: 0.31 },
  { index: 5, phase: 'peak', energy: 1, occupancy: 0.34 },
  { index: 6, phase: 'decay', energy: 0.3, occupancy: 0.14 },
  { index: 7, phase: 'breakup', energy: 0.1, occupancy: 0.05, directionDeg: 55 },
  { index: 8, phase: 'dissipation', energy: 0.01, occupancy: 0.002, directionDeg: 80 },
])))
assert.deepEqual(latePeakAnchorSelection.map((entry) => [entry.role, entry.globalIndex]), [
  ['peak', 5],
  ['onset', 0],
  ['breakup', 7],
  ['dissipation', 8],
])
const terminalEnergySelection = JSON.parse(JSON.stringify(materialWorkflow.selectAnchorSpecs([
  { index: 0, phase: 'onset', energy: 0.1, occupancy: 0.05 },
  { index: 1, phase: 'growth', energy: 0.2, occupancy: 0.08 },
  { index: 2, phase: 'growth', energy: 0.3, occupancy: 0.12 },
  { index: 3, phase: 'growth', energy: 0.4, occupancy: 0.16 },
  { index: 4, phase: 'growth', energy: 0.5, occupancy: 0.2 },
  { index: 5, phase: 'growth', energy: 0.6, occupancy: 0.24 },
  { index: 6, phase: 'growth', energy: 0.7, occupancy: 0.28 },
  { index: 7, phase: 'peak', energy: 0.8, occupancy: 0.3 },
  { index: 8, phase: 'breakup', energy: 0.9, occupancy: 0.08, directionDeg: 45 },
  { index: 9, phase: 'dissipation', energy: 1, occupancy: 0.02, directionDeg: 80 },
])))
assert.deepEqual(terminalEnergySelection.map((entry) => [entry.role, entry.globalIndex]), [
  ['peak', 7],
  ['onset', 0],
  ['breakup', 8],
  ['dissipation', 9],
])
assert.doesNotMatch(productionRuntime, /buildAifxGeometryLockedFrames\(/)
assert.doesNotMatch(productionRuntime, /enforceAifxTemplateAlpha\(/)
assert.doesNotMatch(productionRuntime, /template-alpha-geometry-lock/)
assert.doesNotMatch(productionRuntime, /`\$\{materialDirection\}\. \$\{detected\.positivePrompt\}`/, 'formal generation must not forward reference-derived topology or motion prose')
assert.match(resultContractSource, /styleReferenceRole: autoPrompt\.styleReferenceRole/)
assert.match(resultContractSource, /referenceTopologyUsed: autoPrompt\.referenceTopologyUsed/)
assert.match(resultContractSource, /detectedPromptUsed: autoPrompt\.detectedPromptUsed/)
assert.doesNotMatch(productionRuntime, /materialSwatch:|materialSwatchSent:/)
assert.match(runtime, /data-aifx-acceptance-summary/)
assert.match(runtime, /modules\.export\.buildFinalProduct\(morphology\.exportInput\)/)
assert.match(anchorPipelineSource, /materialType,[\s\S]*?sequencePlan,[\s\S]*?sequenceQuality,[\s\S]*?shapeSource: conformed\.shapeSource,[\s\S]*?motionConstraint,[\s\S]*?temporalCorrection,[\s\S]*?structureTransfer/)
assert.match(anchorPipelineSource, /guideType: modelAnchorSpecs\.length >= 4[\s\S]*?\? 'four-ai-material-morphology-anchors'[\s\S]*?: 'adaptive-ai-material-morphology-anchors'/)
assert.match(runtime, /pixelFormat: 'rgba8'/)
assert.match(runtime, /alphaMode: 'straight'/)
assert.match(runtime, /product\.files\.atlasMetadata/)
assert.match(runtime, /product\.files\.generationManifest/)
assert.match(runtime, /downloadBrowserFinalProductZip\(product, \{ name: exportName \}\)/)
assert.match(runtime, /exportWorkflow\.buildBrowserZip\(product, \{/)
assert.match(runtime, /new Blob\(\[archive\.bytes\], \{ type: archive\.mimeType \}\)/)
assert.match(runtime, /window\.URL\.createObjectURL\(blob\)/)
assert.match(runtime, /window\.URL\.revokeObjectURL\(objectUrl\)/)
assert.doesNotMatch(runtime, /for \(const file of \[product\.files\.atlas, product\.files\.atlasMetadata, product\.files\.generationManifest\]\)/)
assert.match(runtime, /buildSpineAtlas\(base, state\.finalProduct\)/)
assert.match(runtime, /fileName: `\$\{base\}\.png`/)
assert.doesNotMatch(runtime, /const buildSimpleAtlas/)
assert.match(runtime, /const sanitizeAifxExportName = \(value, fallback = ''\) =>/)
assert.match(runtime, /const dispatchExport = \(mode, options = \{\}\) =>/)
assert.match(runtime, /if \(activeExportDispatch\) return activeExportDispatch/,
  'AIFX export dispatch must suppress duplicate folder pickers and writes')
assert.match(runtime, /exportFinalProduct: \(options = \{\}\) => dispatchExport\('final', options\)/)
assert.match(runtime, /exportSpineProject: \(options = \{\}\) => dispatchExport\('spine', options\)/)
assert.match(runtime, /downloadBrowserFinalProductZip\(product, \{ name: exportName \}\)/,
  'the shared export-dialog name must reach the browser ZIP')
assert.match(runtime, /const base = exportName \|\| 'aifx_conditioned_regen'/,
  'the shared export-dialog name must reach the Spine package files')

assert.doesNotMatch(brandRuntime, /\.aifx-button\[data-action="export-png"\]/,
  'the primary Export entry must not depend on a removed workspace button')
const brandManualBinaryStart = brandRuntime.indexOf('async function prepareNovaflowWriteBinaryPayloadForManualExport(payload)')
const brandManualBinaryEnd = brandRuntime.indexOf('\n  function setNovaflowExportModalRestoreSelectValue', brandManualBinaryStart)
const brandManualBinarySource = brandRuntime.slice(brandManualBinaryStart, brandManualBinaryEnd)
assert.ok(brandManualBinaryStart >= 0 && brandManualBinaryEnd > brandManualBinaryStart,
  'the manual binary export adapter must remain independently locatable')
const brandAifxBinaryBypassIndex = brandManualBinarySource.indexOf('state.context === "aifx"')
const brandManualBinaryMutationIndex = brandManualBinarySource.indexOf('const next = { ...payload }')
assert.ok(brandAifxBinaryBypassIndex >= 0
  && brandManualBinaryMutationIndex > brandAifxBinaryBypassIndex,
  'AIFX files must bypass generic manual renaming and compositing before the payload is cloned or mutated')
assert.match(brandManualBinarySource,
  /if \(!state \|\| state\.context === "aifx" \|\| !payload \|\| typeof payload !== "object"\) return payload;/,
  'AIFX owns its sequence, manifest, atlas, and Spine file names as one internally consistent package')
const brandAifxAvailabilityStart = brandRuntime.indexOf('function getNovaflowAifxExportAvailability()')
const brandAifxAvailabilityEnd = brandRuntime.indexOf('\n  function dispatchNovaflowAifxExport', brandAifxAvailabilityStart)
const brandAifxAvailabilitySource = brandRuntime.slice(brandAifxAvailabilityStart, brandAifxAvailabilityEnd)
assert.ok(brandAifxAvailabilityStart >= 0 && brandAifxAvailabilityEnd > brandAifxAvailabilityStart,
  'Brand must expose one bounded AIFX export readiness adapter')
assert.match(brandAifxAvailabilitySource, /typeof api\.getState !== "function" \|\| typeof api\.dispatchExport !== "function"/)
assert.match(brandAifxAvailabilitySource, /state\?\.isGenerating === true/)
assert.match(brandAifxAvailabilitySource, /state\?\.finalProduct/)
assert.match(brandAifxAvailabilitySource, /generatedFrames\.length < 1/)

const brandAifxModalControlsStart = brandRuntime.indexOf('function syncNovaflowAifxExportModalControls')
const brandAifxModalControlsEnd = brandRuntime.indexOf('\n  function pruneNovaflowExportModalContextControls', brandAifxModalControlsStart)
const brandAifxModalControlsSource = brandRuntime.slice(brandAifxModalControlsStart, brandAifxModalControlsEnd)
assert.ok(brandAifxModalControlsStart >= 0 && brandAifxModalControlsEnd > brandAifxModalControlsStart,
  'the unified export dialog must have one bounded AIFX control adapter')
assert.match(brandAifxModalControlsSource, /mode === "video"/)
assert.match(brandAifxModalControlsSource, /setNovaflowAifxExportControlUnavailable\(button, isAifx && mode === "video"\)/)
assert.match(brandAifxModalControlsSource, /getNovaflowExportModalActualTab\(root\) !== "video"/)
assert.match(brandAifxModalControlsSource, /setNovaflowExportPendingTabMode\(root, "seq"\)/)

const brandExportDialogActionStart = brandRuntime.indexOf('function handleNovaflowExportDialogActionEvent')
const brandExportDialogActionEnd = brandRuntime.indexOf('\n  function handleNovaflowExportDialogTabSettledEvent', brandExportDialogActionStart)
const brandExportDialogActionSource = brandRuntime.slice(brandExportDialogActionStart, brandExportDialogActionEnd)
assert.ok(brandExportDialogActionStart >= 0 && brandExportDialogActionEnd > brandExportDialogActionStart,
  'the unified export dialog action dispatcher must remain bounded')
assert.match(brandExportDialogActionSource, /context === "aifx"[\s\S]*?stopNovaflowExportDialogEvent\(event\)/,
  'AIFX export must stop the particle React handler before dispatching')
assert.match(brandExportDialogActionSource, /event\.type !== "click" && event\.type !== "keydown"/,
  'pointer and mouse pre-events must not duplicate an AIFX export')
assert.match(brandExportDialogActionSource, /dispatchNovaflowAifxExport\(mode === "spine" \? "spine" : "final", \{ name: state\.name \}, button\)/,
  'sequence and Spine actions must dispatch the AIFX result with the shared export name')
assert.match(runtime, /NovaFlowAifxProjectBridge/)
assert.match(runtime, /AIFX_PROJECT_BRIDGE_UNAVAILABLE/)
assert.doesNotMatch(runtime, /setStatus\('已应用', '结果已暂存到当前工程会话。'\)/)
assert.match(providerResource, /GPT|gpt/)
assert.match(providerResource, /Google|google/)
assert.match(runtime, /provider: 'local'/)

const materialContractStart = runtime.indexOf('  const buildAifxMaterialOnlyStyleContract =')
const materialContractEnd = runtime.indexOf('  const AIFX_LOCAL_CONTROL_PROFILES =', materialContractStart)
assert.ok(materialContractStart >= 0 && materialContractEnd > materialContractStart)
const materialContractSandbox = {}
runInNewContext(`${runtime.slice(materialContractStart, materialContractEnd)}\nglobalThis.__buildAifxMaterialOnlyStyleContract = buildAifxMaterialOnlyStyleContract`, materialContractSandbox)
const materialContract = JSON.parse(JSON.stringify(materialContractSandbox.__buildAifxMaterialOnlyStyleContract({
  positivePrompt: 'spiral vortex energy topology, circular motion, central core burst',
  styleTags: ['spiral vortex', 'central core burst', 'motion pattern'],
  stats: { rgb: [104, 191, 244], brightness: 0.748, saturation: 0.631, edge: 0.226, brightRatio: 0.171 },
}, 'ice', 'production game ice material with translucent facets')))
assert.equal(materialContract.styleReferenceRole, 'material-only')
assert.equal(materialContract.referenceTopologyUsed, false)
assert.equal(materialContract.detectedPromptUsed, false)
assert.match(materialContract.positivePrompt, /dominant material RGB 104 191 244/)
assert.match(materialContract.positivePrompt, /Read image2 only as spatially scrambled local material statistics/)
assert.doesNotMatch(materialContract.positivePrompt, /subject|outer shape|outline|composition|layout|symmetry|pose|motion pattern/i)
assert.doesNotMatch(materialContract.positivePrompt, /spiral vortex|central core burst|circular motion/i)
assert.doesNotMatch(materialContract.styleDescription, /spiral vortex|central core burst|motion pattern/i)

console.log('aifx-runtime-integration: PASS')
