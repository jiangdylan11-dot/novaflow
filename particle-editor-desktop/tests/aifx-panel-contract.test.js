'use strict'
// AI 特效 panel contract: what the artist sees is upload + library + style,
// and nothing that has to be tuned.
//
// 2026-09-20 the user's rules: "基础风格这个东西应该使用无感才对，包括自定义模板也是，
// 理论上就是上传素材就可以了" and then, on the next look, 特效模板 first with a
// 模板库 panel instead of a <select>, styles picked from a 风格库 panel of
// playing cards with the pick shown (and cancellable) under the button, and
// 生成 folded into the renamed 特效生成 section. Shape and lifecycle detection
// still run, but as a reading the panel reports, not a control. 风格强度 was
// tried again on 2026-09-21 and taken back out the same day: at 4 steps
// BasicScheduler quantises denoise to int(steps/denoise), so a 0-100 slider
// has five reachable positions, three of them the values the rule already
// picks and one measured to break the result. The artist's verdict: "有一点
// 需求还不如多写2个提示词，这样感觉操作更复杂".
const assert = require('node:assert/strict')
const { readFileSync, existsSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const source = readFileSync(path.join(root, 'particle-editor', 'aifx-repaint-runtime.js'), 'utf8')

// --- controls that must not come back -----------------------------------
for (const gone of [
  'data-shape-chips', 'data-life-chips', 'data-shape-chip', 'data-life-chip',
  'renderShapeChips', 'renderLifecycleChips',
  'data-action="material"', 'data-material-value',
  'data-action="contour"',
  // The <select> rendered as a native popup in the app; the library panel
  // replaced it.
  'data-builtin-picker', 'renderBuiltinPicker',
  // The 4-column grid of style buttons; the 风格库 replaced it.
  'renderAttributePicker', 'data-aifx-attribute',
  // The preview mode is not a choice any more: the canvas shows the material
  // until a result exists, then the pair (2026-09-20: "右侧无需3个选项").
  'data-mode="template"', 'data-mode="result"', 'data-mode="compare"', 'aifx-mode',
  // 生成控制 is no longer a section of its own, and the other two were renamed.
  'data-section-body="generate"',
  '<span class="aifx-section-title">生成控制</span>',
  '<span class="aifx-section-title">基础风格</span>',
  '<span class="aifx-section-title">自定义模板</span>',
]) {
  assert.ok(!source.includes(gone), `${gone} must stay out of the panel`)
}

// --- what remains, in the order the artist meets it ----------------------
const at = (needle) => {
  const index = source.indexOf(needle)
  assert.ok(index >= 0, `${needle} must be in the panel markup`)
  return index
}
const aside = at('<aside class="aifx-side">')
const templateBody = at('data-section-body="template"')
const pickTemplate = at('data-action="pick-template"')
const detected = at('data-template-detected')
const openTemplateLibrary = at('data-action="open-template-library"')
const modeBody = at('data-section-body="mode"')
const openStyleLibrary = at('data-action="open-style-library"')
const styleCurrent = at('data-style-current')
const pickStyle = at('data-action="pick-style"')
const clearStyle = at('data-action="clear-style"')
const candidates = at('data-action="candidates"')
const generate = at('data-action="generate"')
const asideEnd = source.indexOf('</aside>', aside)
assert.ok(aside < templateBody && templateBody < modeBody, '特效模板 comes first, 特效生成 second')
assert.ok(templateBody < pickTemplate && pickTemplate < detected && detected < openTemplateLibrary
  && openTemplateLibrary < modeBody,
  'the template section is upload, what was read, then the 模板库 button')
assert.ok(modeBody < openStyleLibrary && openStyleLibrary < styleCurrent && styleCurrent < pickStyle
  && pickStyle < clearStyle && clearStyle < candidates && candidates < generate && generate < asideEnd,
  '特效生成 is 风格库, the picked style, the reference image, the candidate count and the button')
assert.ok(source.includes('<span class="aifx-section-title">特效模板</span>'))
assert.ok(source.includes('<span class="aifx-section-title">特效生成</span>'))

// 提示词补充 stays: it is the only way to ask for something the chosen style
// does not already say, and it reaches the prompt (2026-09-20, put back after
// the "无感" pass removed it: "这个提示词补充可能还是有必要的").
assert.ok(source.includes('data-action="prompt-supplement"'), '提示词补充 is in the panel')
assert.ok(source.includes('supplement: state.supplement,'), 'it reaches the pipeline')
const supplementIndex = source.indexOf('data-action="prompt-supplement"')
assert.ok(supplementIndex > clearStyle && supplementIndex < candidates,
  'it sits under the reference image, above the candidate count')

// The panel keeps exactly one slider: how many candidates to render.
const asideMarkup = source.slice(aside, asideEnd)
assert.equal((asideMarkup.match(/class="aifx-slider"/g) || []).length, 1,
  'the candidate count is the only slider left')
assert.equal((asideMarkup.match(/data-aifx-section=/g) || []).length, 2, 'two sections, not three')

// The panel has no strength control, so its fallback is a silent default and
// has to be the module's, not a number that drifted away from it.
{
  const restylePath = path.join(root, 'particle-editor', 'aifx-restyle.workflow.js')
  const sandbox = {}
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  vm.runInNewContext(readFileSync(restylePath, 'utf8'), sandbox, { filename: restylePath })
  const restyle = sandbox.NovaFlowAifxRestyleWorkflow
  assert.ok(source.includes('if (!restyle) return ' + restyle.DEFAULT_STRENGTH),
    'the panel fallback must be the module default')
  assert.ok(source.includes('restyle.defaultStrengthFor(attribute, state.lifecycle,'),
    'the panel asks the module for the default rather than carrying its own table')
  // The box having text in it is what raises the strength, so the panel has to
  // hand that fact over - not just the attribute and the lifecycle.
  assert.ok(source.includes("Boolean(String(state.supplement || '').trim())"),
    'the panel must tell the module whether 提示词补充 has anything in it')
  // Clearing the style and writing the material instead has to be reachable:
  // 生成 stays enabled on the supplement alone, and typing has to refresh or
  // the button never notices.
  const flat = source.replace(/\s+/g, ' ')
  assert.ok(flat.includes("const chosen = Boolean(state.reference) || Boolean(restyle "
    + "&& restyle.getPreset(state.attribute)) || Boolean(String(state.supplement || '').trim())"),
    '生成 must be allowed on a supplement with no style')
  assert.ok(flat.includes("state.supplement = String(refs.supplement.value || '')"),
    'the textarea still feeds state')
  assert.match(flat, /state\.supplement = String\(refs\.supplement\.value \|\| ''\).{0,320}?refreshUi\(\)/,
    'typing in 提示词补充 has to refresh the panel')
  // The style card is the one place that says where the material comes from;
  // the line under 候选数量 used to repeat it and now only carries what the
  // card cannot - that the picked style has not been render-checked.
  assert.ok(source.includes("empty.textContent = state.reference ? '材质来自参考图' : '未选风格'"),
    'the style card reports the material source')
  assert.ok(!source.includes('材质来自提示词补充'), 'and nothing else repeats it')
  // Neither weight slider belongs here. 风格强度 has five reachable positions
  // and three of them are the rule's own values; 参考图权重 would drive a model
  // knob that does nothing for a still, because the picture also reaches
  // qwen3vl as vision tokens and that path has no weight.
  assert.ok(!source.includes('data-action="strength"'), '风格强度 stays out of the panel')
  assert.ok(!source.includes('data-action="reference-strength"'), '参考图权重 stays out too')
}

assert.ok(source.includes("state.previewMode = state.resultFrames.length ? 'compare' : 'template'"),
  'one rule decides what the canvas shows')
assert.ok(source.includes('const syncPreviewMode = () => {'))
assert.equal((source.match(/syncPreviewMode\(\)/g) || []).length, 5,
  'upload, clear, first candidate, candidate pick and hide all go through it')

// The waiting message is plain centred text, not a plate in the corner
// (2026-09-20: "这个在预览区居中显示。不需要底框"). It steps aside to the top once
// there is something on the canvas.
const statusCss = source.slice(source.indexOf('      .aifx-preview-status {'),
  source.indexOf('.aifx-preview-status-title'))
assert.ok(statusCss.includes('left: 50%') && statusCss.includes('transform: translate(-50%, -50%)'),
  'the status sits in the middle of the preview')
assert.ok(statusCss.includes('background: transparent') && statusCss.includes('border: 0')
  && statusCss.includes('box-shadow: none'), 'no plate behind it')
assert.ok(source.includes("refs.previewStatus.setAttribute('data-placement', state.source ? 'top' : 'center')"),
  'it moves to the top once the canvas has something on it')

// A PNG sequence is a valid template: the panel composites it onto black and
// makes a clip out of it (2026-09-20: "特效模板需要支持序列帧上传自动转换为黑底视频").
assert.ok(source.includes('const sequenceToBlackClip = async (files) => {'))
assert.ok(source.includes('const adoptTemplateFiles = async (list) => {'), 'one entry point for clips and stills')
const seqBody = source.slice(source.indexOf('const sequenceToBlackClip'), source.indexOf('const adoptTemplateFiles'))
assert.ok(seqBody.includes("context.fillStyle = '#000000'") && seqBody.includes('context.fillRect(0, 0, width, height)'),
  'every frame is painted onto black before the still goes on top')
assert.ok(seqBody.indexOf('fillRect') < seqBody.indexOf('drawImage'), 'black goes down first')
assert.ok(source.includes('undefined, { numeric: true, sensitivity: ') && source.includes('sortSequence'),
  'frames are ordered the way an artist names them')
assert.ok(source.includes('type="file" multiple accept="video/*,image/gif,image/apng,image/png'),
  'the picker takes several stills')
assert.ok(source.includes('序列帧至少要两张'), 'a single still is not a sequence')

// --- the libraries -------------------------------------------------------
// One panel over the preview, the particle editor's 模板库 shape: title left,
// 关闭 right, a grid of playing cards with a name under each.
assert.ok(source.includes('data-library-body'), 'the library panel is in the markup')
assert.ok(source.includes('data-action="close-library"'), 'the library has a 关闭 button')
assert.ok(source.includes("openLibrary('template')") && source.includes("openLibrary('style')"),
  'both buttons open the same panel')
assert.ok(source.includes("kind === 'style' ? '风格库' : kind === 'shape' ? '形状' : '模板库'"),
  'the panel is titled by what it lists')
// The reading is automatic and can be wrong; the line that reports it is also
// the way to correct it, which is the only way out when the detector picks a
// round archetype for a square source.
assert.ok(source.includes("openLibrary('shape')"), 'the detected shape can be corrected')
assert.ok(source.includes("fix.textContent = '不对，改一下'"))
assert.ok(source.includes("data-shape-pick"), 'the picker lists the archetypes')
assert.ok(source.includes("state.shapeArchetype = id"), 'picking one applies it')
assert.ok(source.includes("const STYLE_PREVIEW_URL = (id) => './aifx-styles/' + id + '.mp4'"),
  'style cards play the shipped preview clips')
assert.ok(source.includes('new IntersectionObserver'), 'only the cards in view decode')
assert.ok(source.includes("clear.setAttribute('data-action', 'clear-attribute')"), 'the picked style can be unpicked')
assert.ok(source.includes("attribute: '',"), 'nothing is picked until the artist picks')
// 生成 waits for a material source, and 提示词补充 is one of the three.
assert.ok(source.includes('选个风格，或放参考图，或在提示词补充里写材质'),
  '生成 waits for a style, a reference or a supplement')

// 2026-09-20, second look: "现在的弹框样式也完全不一样" / "颜色偏蓝" / "风格库同样存在
// 这样的问题". Both panels are the particle 模板库 exactly - its greys, five
// columns, 16:10 thumbs, the dashed 点击存储 card first, a × on every template
// card, 重置 - and the artist's uploads can be saved into it.
for (const blue of ['rgba(15, 19, 25', '#0b0d10', '#1f2937', '#94a3b8', '#cbd5e1']) {
  assert.ok(!source.includes(blue), `${blue} reads blue next to the panel; the libraries use its greys`)
}
assert.ok(source.includes('grid-template-columns: repeat(5, minmax(0, 1fr))'), 'five columns, like the particle library')
assert.ok(source.includes('aspect-ratio: 16 / 10'), '16:10 thumbnails, like the particle library')
assert.ok(source.includes("add.setAttribute('data-action', 'library-save')"), 'the dashed 点击存储 card')
assert.ok(source.includes("del.setAttribute('data-action', 'library-delete')"), 'a × on every template card')
assert.ok(source.includes('data-action="reset-library"'), '重置 restores the shipped set')
assert.ok(source.includes("window.confirm('将清空自定义模板，并恢复全部内置模板。是否继续？')"), '重置 asks first, as the particle one does')
assert.ok(source.includes("const TEMPLATE_STORE_KEY = 'aifxTemplates'"), 'saved templates live in userData under one key')
assert.ok(source.includes("api.loadUserData(TEMPLATE_STORE_KEY)") && source.includes("api.saveUserData({ key: TEMPLATE_STORE_KEY, data })"),
  'the desktop app persists through the same user-data IPCs as the particle library')
assert.ok(source.includes("indexedDB.open('novaflow-aifx', 1)"), 'the preview falls back to IndexedDB')
assert.ok(source.includes('hiddenBuiltins'), 'deleting a built-in hides it rather than losing it')
assert.ok(source.includes('data: await blobToBase64(state.source.blob)'), 'the saved clip travels with its template')

// 2026-09-20, third look: "弹框的表现形式要居中。。并且有遮罩" /
// "点击存储 这个也需要有个和其他模板库一样的底框" / "点击模板名字需要能重命名".
// The panel is a modal over the whole shell, not a sheet on the preview, so
// its markup sits beside <aside>/<main> rather than inside the preview.
const asideEndIndex = source.indexOf('</aside>')
const mainEndIndex = source.indexOf('</main>')
const libraryIndex = source.indexOf('<div class="aifx-library" data-library')
assert.ok(libraryIndex > mainEndIndex, 'the library markup follows the shell it belongs to')
// The shell is pinned below the topbar (2147483620) and behind the 仓库/导出
// rail cells (2147483628), so a mask inside it can never cover them. The node
// is moved to the body once its listeners are bound.
assert.ok(source.includes('const AIFX_LIBRARY_STACK_Z = 2147483632'), 'the modal outranks the topbar and the rail')
assert.ok(source.includes('document.body.appendChild(refs.library)'), 'the modal is portalled out of the shell')
assert.ok(source.includes('.aifx-library, .aifx-library * { box-sizing: border-box; }'),
  'the shell reset no longer reaches it')
assert.ok(source.includes('data-novaflow-runtime-ignore="1"'), 'the host modal scanner leaves it alone')
const hideStart = source.indexOf('const hideApp = (options = {}) => {')
const hideBody = source.slice(hideStart, source.indexOf('  const ', hideStart + 40))
assert.ok(hideBody.includes('closeLibrary()'), 'hiding the shell takes the body-level modal with it')
// The shell root is pointer-events:none and every child opts back in, so an
// overlay without the opt-in is invisible to the mouse: the panel looked dead
// and the mask blocked nothing. And an absolute mask stops at the shell, which
// starts below the topbar and right of the rail.
const overlayCssBlock = () => source.slice(source.indexOf('      .aifx-library {'),
  source.indexOf('.aifx-library[hidden]'))
assert.ok(overlayCssBlock().includes('position: fixed; inset: 0;'), 'the backdrop covers the whole window')
assert.ok(overlayCssBlock().includes('pointer-events: auto;'),
  'the backdrop takes the mouse, so nothing behind it is clickable')
assert.ok(source.includes('background: rgba(0, 0, 0, 0.58);'), 'the backdrop dims what is behind it')
assert.ok(source.includes('display: flex; align-items: center; justify-content: center; padding: 72px 24px 24px;'),
  'the panel is centred in the backdrop and clears the topbar')
assert.ok(source.includes('if (event.target !== refs.library) return'), 'clicking the mask closes the modal')
// The 点击存储 card is a card like the others; only its border says "add".
assert.ok(source.includes("add.className = 'aifx-library-card aifx-library-add'"),
  '点击存储 carries the same card frame as every template')
assert.ok(source.includes('button.aifx-library-card.aifx-library-add[type="button"] {'),
  'only the border marks it as the add card')
// The host flattens every [role="button"] / button with transparent borders
// and no shadow, so the cards' hover and selected rings have to outrank it.
const ringSelector = '.aifx-library[data-library] .aifx-library-card[data-library-card][role="button"]'
assert.ok(source.includes(ringSelector + ':hover,'), 'the hover ring outranks the host selector')
assert.ok(source.includes(ringSelector + '.is-active {'), 'the selected ring outranks it too')
const ringBlock = source.slice(source.indexOf(ringSelector + ':hover,'), source.indexOf(ringSelector + ':hover,') + 320)
assert.ok(ringBlock.includes('border-color: ${AIFX_ACCENT} !important'))
assert.ok(ringBlock.includes('box-shadow: 0 0 0 1px ${AIFX_ACCENT} inset !important'))
// The upload boxes show what is in them instead of keeping the empty-state copy
// with the file name printed over it.
assert.ok(source.includes('const syncDropzonePreview = (zone, host, entry, build) => {'))
assert.ok(source.includes('data-template-preview') && source.includes('data-style-preview'))
assert.ok(source.includes('.nf-upload-dropzone[data-filled="1"] .nf-upload-dropzone__hint { display: none; }'))
assert.ok(source.includes('.nf-upload-dropzone[data-filled="1"] .nf-upload-dropzone__meta {'),
  'the name sits in normal flow once the box is filled')
// Clicking a name edits it in place; a built-in keeps its shipped label and
// stores an override, which 重置 clears along with the deletions.
assert.ok(source.includes('const startRename = (nameEl, current, commit) => {'), 'names edit in place')
assert.ok(source.includes('const renameTemplate = async (id, label) => {'))
assert.ok(source.includes('state.renamedBuiltins[key] = next'), 'a renamed built-in stores an override')
assert.ok(source.includes('renamedBuiltins: { ...state.renamedBuiltins },'), 'renames persist with the store')
const resetBody = source.slice(source.indexOf('const resetTemplates = async (options = {}) => {'),
  source.indexOf('const loadUserTemplate = async (id) => {'))
assert.ok(resetBody.includes('state.renamedBuiltins = {}'), '重置 clears the renames too')
assert.ok(source.includes("name.setAttribute('data-rename', '1')"))
assert.ok(source.includes("startRename(name, label, onRename)"))
// The style cards are not renameable and the style library has no add card.
const openLibraryBlock = source.slice(source.indexOf('const openLibrary = async (kind) => {'), source.indexOf('// The card under 风格库'))
const styleBranch = openLibraryBlock.slice(openLibraryBlock.indexOf("if (kind === 'style')"), openLibraryBlock.indexOf('} else {'))
assert.ok(!styleBranch.includes('onRename') && !styleBranch.includes('onDelete'),
  'style cards are neither renameable nor deletable')
assert.ok(source.includes("refs.libraryReset.hidden = kind !== 'template'"), '重置 only belongs to the template library')

// Every style has its preview clip on disk, so a card never plays black.
const workflowPath = path.join(root, 'particle-editor', 'aifx-restyle.workflow.js')
const win = {}
win.window = win
win.globalThis = win
vm.runInNewContext(readFileSync(workflowPath, 'utf8'), { window: win, globalThis: win, console }, { filename: workflowPath })
for (const preset of win.NovaFlowAifxRestyleWorkflow.ATTRIBUTE_PRESETS) {
  const clip = path.join(root, 'particle-editor', 'aifx-styles', preset.id + '.mp4')
  assert.ok(existsSync(clip), `${preset.id} needs its preview clip at aifx-styles/${preset.id}.mp4`)
}

// --- export: the 导出 dialog exports a result like a video on the board -----
// 2026-09-20 the user's rule: "AI特效版块接入导出，要支持现有的导出内容，参考视频版块的
// 导出，应该是一样的". The brand runtime opens its dialog in the "aifx" context
// and hands mode + name + format here; the panel writes through the same
// main-process IPCs as the video board (sourceConvert for the mp4 bytes,
// keyed RGBA PNGs for 序列帧).
assert.ok(!source.includes("notYet('dispatchExport')"), 'dispatchExport is implemented')
assert.ok(source.includes('const dispatchExport = async (mode, options = {}) => {'))
assert.ok(source.includes('sourceConvert: true,'), 'video export is the format-conversion branch')
assert.ok(source.includes("api.exportPickSaveFile({ baseName: exportBaseName(options), format })"))
assert.ok(source.includes('client.keyFrameToRgba(image, {})'), '序列帧 exports the keyed RGBA frames')
assert.ok(source.includes('generatedFrames: state.resultFrames'), 'getState exposes what the availability check reads')
const brand = readFileSync(path.join(root, 'particle-editor', 'novaflow-brand-runtime.js'), 'utf8')
assert.ok(!brand.includes('isAifx && mode === "video"'), 'the video tab is no longer taken away for AI 特效')
assert.ok(brand.includes('mode === "video" ? "video" : "final"'), 'the dispatcher forwards the video mode')
assert.ok(brand.includes('scalePct: getNovaflowAifxExportScalePct(root)'), 'the dialog scale reaches the panel')

// A click inside the body-level modal must not read as "outside the shell":
// that document-level rule closes 特效, and it took the panel down on the very
// first card click.
assert.ok(source.includes('|| Boolean(state.refs.library && state.refs.library.contains(event.target))'),
  'the modal counts as part of the shell for the click-outside rule')
assert.ok(source.includes("if (root?.classList.contains('is-open') && !insideShell) {"))

// The shell must start exactly where the topbar ends. It used to take the
// ROUNDED HEIGHT of a body child, which measured 58 against a topbar whose
// bottom is 56, and the particle canvas showed through the 2px strip that left
// (reported 2026-09-20: "顶部还有几像素没覆盖全").
assert.ok(source.includes("const bar = document.querySelector('.nf-topbar')"),
  "the shell measures the app's own topbar")
assert.ok(source.includes('top = Math.max(50, Math.min(90, Math.floor(topbarRect.bottom)))'),
  'it starts at the topbar bottom, floored, so a fraction never opens a gap')
assert.ok(!source.includes('Math.round(topCandidate.height)'), 'the height heuristic is gone')

// --- the detector still runs, and the reading is shown, not edited --------
assert.ok(source.includes("'已识别：' + state.shapeAuto"), 'the panel reports what it read')
assert.ok(source.includes('detectShape(decoded.frames)'), 'detection still runs on upload')

// --- the debug surface keeps the overrides the smokes drive ----------------
for (const method of ['setShape:', 'setLifecycle:', 'detectedShape:', 'setStrength:', 'setSupplement:',
  'openLibrary,', 'closeLibrary,']) {
  assert.ok(source.includes(method), `${method} must stay on the NovaFlowAifxMvp surface`)
}

// --- templates that loop by construction say so -----------------------------
// At the panel's ~26-frame budget both rotating loops read as a one-shot
// burst, and a one-shot prompt tells them to break up at the end.
const templatesStart = source.indexOf('const BUILTIN_TEMPLATES')
const templatesEnd = source.indexOf(String.fromCharCode(10) + '  ])', templatesStart)
const templatesBlock = source.slice(templatesStart, templatesEnd)
const entries = templatesBlock.split('Object.freeze({').slice(1)
const byId = new Map()
for (const entry of entries) {
  const id = /id: '([^']+)'/.exec(entry)
  if (id) byId.set(id[1], entry)
}
assert.equal(byId.size, 20, 'twenty built-in templates')
for (const id of ['slot-god-rays', 'slot-swirl']) {
  assert.match(byId.get(id), /lifecycle: 'loop'/, `${id} loops by construction`)
  assert.match(byId.get(id), /archetype: '(rays|swirl)'/, `${id} carries its archetype`)
}
for (const [id, entry] of byId) {
  if (id === 'slot-god-rays' || id === 'slot-swirl') continue
  assert.ok(!/lifecycle:/.test(entry), `${id} leaves lifecycle to the detector`)
}
assert.ok(source.includes('if (template.lifecycle) {'), 'loadBuiltinTemplate applies the pinned lifecycle')

console.log('aifx panel contract: ok')
