const assert = require('node:assert/strict')
const workflow = require('../admin-server/storyboard-grok.workflow')

const request = workflow.buildStoryboardGrokPayload({
  storyText: 'A detective investigates a locked room disappearance.',
  sourceAnalysis: 'Reference identity only.',
  visualCuePack: 'Noir anime lighting.'
})

assert.equal(request.temperature, 0.5, 'universal director should balance creativity and theme adherence')
assert.equal(request.max_tokens, 4096)
assert.equal(request.messages.length, 2)

const system = request.messages[0].content
for (const rule of [
  '开放式故事大纲',
  '创作自由',
  '不得创作成另一个主题',
  '不要套用固定九格剧情模板',
  '用户故事始终拥有最高叙事优先级',
  '参考图连续性信息是强制视觉造型合同',
  '每格默认继承上一格已经建立的当前造型状态',
  '造型或装备变化可以是零次、一次或多次',
  '不得预设变化次数、固定格号、服装品类、颜色、道具或活动装备',
  '延续到下一次明确变化',
  '不得倒灌到更早镜头',
  '不得凭空添加参考图、用户剧情与服务主题的可见故事因果都没有的翅膀',
  '相邻镜头至少通过动作阶段、视线、空间位置、目标或关键道具自然衔接',
  '可直接用于图像生成模型的英文视觉描述',
  'title和displayCaption属于用户展示层，必须使用简体中文',
  '景别、机位角度、构图关系、主体位置',
  '剧情单元只是覆盖检查用的语义段落，不是镜头分配表',
  '禁止把逗号子句或U1、U2等编号机械地一格对应一个镜头',
  'CURRENT SUBJECT STATE与KEY PROP LEDGER',
  'subjectState={id,appearance,state,changeEvent}',
  'keyProps数组',
  '未变化字段逐字继承',
  '已损坏、销毁、遗失或消耗的道具',
  '每格必须单独输出英文visualEvent',
  '下游确定性编译器会按camera、subjectState、keyProps、visualEvent、prompt正文的顺序生成最终生图提示词',
  '每项必须包含 scene、title、displayCaption、visualEvent、prompt',
  '禁止把可读文字、字母、数字、字幕、标题、Logo',
  '进度条、进度环、进度仪表或进度指示器',
  '不要写glowing code',
  '可见的物理动作、空间变化、物体状态、光线信号或直接后果',
  '输出前在内部自检',
  'mandatory story contract',
  'Never replace an explicit contract item',
  'map every contract item to a scene number'
]) {
  assert.match(system, new RegExp(rule), `universal director system prompt should include: ${rule}`)
}

assert.doesNotMatch(system, /第一格必须|第四格必须|第七格必须|第九格必须/, 'director must not impose fixed scene beats')
assert.doesNotMatch(system, /可以自由安排一个清楚可见的准备或换装节点/, 'director must not imply exactly one appearance change')
assert.doesNotMatch(system, /第(?:[1-9]|一|二|三|四|五|六|七|八|九)格[^。\n]*(?:换装|造型|装备变化)/, 'director must not preassign an appearance-change scene')
assert.doesNotMatch(system, /橙色短袖|绿色短裤|绿色背包/, 'director contract must not contain sample-specific appearance values')
assert.match(request.messages[1].content, /用户剧情：\nA detective investigates a locked room disappearance\./)
assert.match(request.messages[1].content, /MANDATORY NARRATIVE CONTRACT \(verbatim user outline\):\nA detective investigates a locked room disappearance\./)
assert.match(request.messages[1].content, /MANDATORY STORY UNITS:\nU1: A detective investigates a locked room disappearance/)
assert.match(request.messages[1].content, /Reference analysis and visual cues may control appearance and style only/)
assert.match(request.messages[1].content, /SEQUENTIAL APPEARANCE STATE CONTRACT/)
assert.match(request.messages[1].content, /zero, one, or multiple visible appearance or equipment changes/i)
assert.match(request.messages[1].content, /Do not preassign the number of changes, shot numbers, costume types, colors, props, or activity gear/i)
assert.match(request.messages[1].content, /persist the new state forward until another explicit visible change/i)
assert.match(request.messages[1].content, /Story units are coverage paragraphs, not a one-unit-per-shot beat sheet/i)

assert.deepEqual(workflow.buildStoryUnits('离开家乡，前往海边。潜水；冲浪。'), [
  { id: 'U1', text: '离开家乡，前往海边' },
  { id: 'U2', text: '潜水' },
  { id: 'U3', text: '冲浪' }
])

const validCameras = [
  'extreme wide shot, high-angle view, detective on the left third, doorway in foreground, static frame',
  'medium shot, eye-level angle, detective on the right third, clue table in foreground, tracking shot',
  'close-up, high-angle view, detective centered behind the clue, push-in',
  'full shot, low-angle view, detective on the left third, broken door in foreground, handheld frame',
  'medium close-up, eye-level angle, detective on the right third, mirror in foreground, static frame',
  'wide shot, top-down view, detective centered among evidence, tracking shot',
  'extreme close-up, dutch angle, detective on the left third behind the lock, push-in',
  'medium wide shot, low-angle view, detective on the right third, open doorway in foreground, handheld frame',
  'establishing wide shot, eye-level angle, detective centered beyond the empty room, pull-out'
]
const validShots = validCameras.map((camera, index) => {
  const subjectState = {
    id: 'named_detective',
    appearance: 'short black hair, dark wool coat, brown leather satchel',
    state: 'uninjured and alert',
    changeEvent: ''
  }
  const keyProps = [{
    id: 'leather_satchel',
    name: 'leather satchel',
    appearance: 'small weathered brown leather satchel with a brass buckle',
    state: 'intact',
    location: 'worn across the detective shoulder',
    changeEvent: ''
  }]
  return {
    scene: index + 1,
    title: `剧情节点${index + 1}`,
    displayCaption: `侦探正在检查第${index + 1}条线索`,
    visualEvent: `The named detective physically opens clue ${index + 1} inside the locked room while the moved evidence changes the visible arrangement on the table.`,
    prompt: `Camera and composition: ${camera}. Subject state: ${subjectState.id}; appearance: ${subjectState.appearance}; physical state: ${subjectState.state}; state change event: none. Key prop states: ${keyProps[0].name} [${keyProps[0].id}]; appearance: ${keyProps[0].appearance}; state: ${keyProps[0].state}; location: ${keyProps[0].location}; state change event: none. Visible moment: the named detective physically opens clue ${index + 1} inside the locked room, cinematic noir anime illustration, no readable text`,
    sceneAnchor: `locked room position ${index + 1}`,
    camera,
    subjectState,
    keyProps,
    storyUnitIds: index === 0 ? ['U1'] : []
  }
})
const parsed = workflow.parseStoryboardGrokResult({
  model: 'test-model',
  durationMs: 12,
  data: { choices: [{ message: { content: JSON.stringify(validShots) } }] }
}, 'test-seed')
assert.equal(parsed.shots.length, 9)
assert.equal(parsed.shots[0].title, '剧情节点1')
assert.equal(parsed.shots[0].displayCaption, '侦探正在检查第1条线索')
assert.equal(parsed.promptPreview, 'Grok Universal Storyboard Director')
assert.equal(parsed.directorQuality.status, 'PASS')
assert.equal(parsed.directorQuality.metrics.cameraInlineCount, 9)
assert.equal(parsed.directorQuality.metrics.subjectStateCount, 9)
assert.equal(parsed.shots[0].subjectState.id, 'named_detective')
assert.equal(parsed.shots[0].keyProps[0].state, 'intact')
assert.match(parsed.shots[0].prompt, new RegExp(`^Camera and composition: ${validCameras[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`))
assert.match(parsed.shots[0].prompt, /Subject state: named_detective; appearance: short black hair, dark wool coat, brown leather satchel; physical state: uninjured and alert; state change event: none\./)
assert.match(parsed.shots[0].prompt, /Key prop states: leather satchel \[leather_satchel\]; appearance: small weathered brown leather satchel with a brass buckle; state: intact;/)

const paraphrasedPromptShots = validShots.map((shot, index) => ({
  ...shot,
  prompt: `The detective visibly opens clue ${index + 1} inside the locked room; cinematic noir anime illustration.`
}))
const deterministicallyCompiled = workflow.parseStoryboardGrokResult({
  data: { choices: [{ message: { content: JSON.stringify(paraphrasedPromptShots) } }] }
}, 'test-seed')
assert.equal(deterministicallyCompiled.directorQuality.status, 'PASS', 'program compiler should guarantee camera and ledger inlining')
assert.match(deterministicallyCompiled.shots[2].prompt, /^Camera and composition:/)
assert.match(deterministicallyCompiled.shots[2].prompt, /Visible event: The named detective physically opens clue 3/)
assert.match(deterministicallyCompiled.shots[2].prompt, /Creative scene body: The detective visibly opens clue 3/)

const noEventDriftShots = deterministicallyCompiled.shots.map((shot) => ({
  ...shot,
  subjectState: { ...shot.subjectState },
  keyProps: shot.keyProps.map((prop) => ({ ...prop }))
}))
noEventDriftShots[1].subjectState.state = 'focused while crouching beside the clue'
noEventDriftShots[1].keyProps[0].state = 'functional beside the detective'
const reconciledNoEventDrift = workflow.reconcileStoryboardGrokContinuity(noEventDriftShots)
assert.equal(reconciledNoEventDrift.shots[1].subjectState.state, noEventDriftShots[0].subjectState.state, 'ephemeral subject wording without changeEvent must inherit the durable state')
assert.equal(reconciledNoEventDrift.shots[1].keyProps[0].state, noEventDriftShots[0].keyProps[0].state, 'prop wording without changeEvent must inherit the ledger state')
assert.equal(reconciledNoEventDrift.directorQuality.status, 'PASS')
assert.ok(reconciledNoEventDrift.actions.some((item) => item.code === 'SUBJECT_STATE_INHERITED_WITHOUT_EVENT'))
assert.ok(reconciledNoEventDrift.actions.some((item) => item.code === 'KEY_PROP_STATE_INHERITED_WITHOUT_EVENT'))

const emptyNeutralStateShots = deterministicallyCompiled.shots.map((shot) => ({
  ...shot,
  subjectState: { ...shot.subjectState, state: '', changeEvent: '' },
  keyProps: shot.keyProps.map((prop) => ({ ...prop }))
}))
const defaultedNeutralState = workflow.reconcileStoryboardGrokContinuity(emptyNeutralStateShots)
assert.equal(defaultedNeutralState.directorQuality.status, 'PASS', 'an otherwise complete subject ledger may use a deterministic neutral baseline when Grok leaves state empty')
assert.match(defaultedNeutralState.shots[0].subjectState.state, /baseline physical and functional condition/)
assert.equal(defaultedNeutralState.shots[1].subjectState.state, defaultedNeutralState.shots[0].subjectState.state)
assert.ok(defaultedNeutralState.actions.some((item) => item.code === 'SUBJECT_BASELINE_STATE_DEFAULTED' && item.scene === 1))

const droppedLedgerShots = deterministicallyCompiled.shots.map((shot) => ({
  ...shot,
  subjectState: { ...shot.subjectState },
  keyProps: shot.keyProps.map((prop) => ({ ...prop }))
}))
droppedLedgerShots[3].keyProps = []
const restoredLedger = workflow.reconcileStoryboardGrokContinuity(droppedLedgerShots)
assert.equal(restoredLedger.shots[3].keyProps[0].id, 'leather_satchel', 'temporarily off-screen props must remain in the ledger')
assert.ok(restoredLedger.actions.some((item) => item.code === 'KEY_PROP_LEDGER_RESTORED' && item.scene === 4))

const explicitUnstructuredInjury = deterministicallyCompiled.shots.map((shot) => ({
  ...shot,
  subjectState: { ...shot.subjectState },
  keyProps: shot.keyProps.map((prop) => ({ ...prop }))
}))
explicitUnstructuredInjury[2].subjectState.state = 'left arm visibly injured and bleeding'
explicitUnstructuredInjury[2].subjectState.changeEvent = ''
explicitUnstructuredInjury[2].prompt = `${explicitUnstructuredInjury[2].prompt} The detective is struck by falling glass and begins bleeding from the left arm.`
const unresolvedVisibleChange = workflow.reconcileStoryboardGrokContinuity(explicitUnstructuredInjury)
assert.equal(unresolvedVisibleChange.shots[2].subjectState.state, 'left arm visibly injured and bleeding', 'a visible material change must not be silently overwritten')
assert.ok(unresolvedVisibleChange.directorQuality.issues.some((issue) => issue.code === 'SUBJECT_STATE_DRIFT_WITHOUT_EVENT' && issue.scenes.includes(3)))

const explicitChangeEvent = deterministicallyCompiled.shots.map((shot) => ({
  ...shot,
  subjectState: { ...shot.subjectState },
  keyProps: shot.keyProps.map((prop) => ({ ...prop }))
}))
explicitChangeEvent[2].subjectState.state = 'left arm visibly injured and bleeding'
explicitChangeEvent[2].subjectState.changeEvent = 'falling glass visibly cuts the detective left arm'
for (let index = 3; index < explicitChangeEvent.length; index += 1) {
  explicitChangeEvent[index].subjectState.state = 'left arm visibly injured and bleeding'
  explicitChangeEvent[index].subjectState.changeEvent = ''
}
const preservedVisibleChange = workflow.reconcileStoryboardGrokContinuity(explicitChangeEvent)
assert.equal(preservedVisibleChange.shots[2].subjectState.state, 'left arm visibly injured and bleeding')
assert.equal(preservedVisibleChange.shots[3].subjectState.state, 'left arm visibly injured and bleeding', 'an accepted durable change must persist forward')

const coveredUnits = workflow.parseStoryboardGrokResult({
  data: { choices: [{ message: { content: JSON.stringify(validShots) } }] }
}, 'test-seed', 'A detective investigates a locked room disappearance.')
assert.deepEqual(coveredUnits.shots[0].storyUnitIds, ['U1'])

const numericUnitIds = validShots.map((shot, index) => ({ ...shot, storyUnitIds: index === 0 ? [1] : [] }))
const normalizedNumericUnits = workflow.parseStoryboardGrokResult({
  data: { choices: [{ message: { content: JSON.stringify(numericUnitIds) } }] }
}, 'test-seed', 'A detective investigates a locked room disappearance.')
assert.deepEqual(normalizedNumericUnits.shots[0].storyUnitIds, ['U1'])

const missingUnits = validShots.map((shot) => ({ ...shot, storyUnitIds: [] }))
assert.throws(() => workflow.parseStoryboardGrokResult({
  data: { choices: [{ message: { content: JSON.stringify(missingUnits) } }] }
}, 'test-seed', 'A detective investigates a locked room disappearance.'), /遗漏剧情单元：U1/)

const missingCamera = validShots.map((shot) => ({ ...shot }))
missingCamera[4].camera = ''
assert.throws(() => workflow.parseStoryboardGrokResult({
  data: { choices: [{ message: { content: JSON.stringify(missingCamera) } }] }
}, 'test-seed'), /第5格缺少导演镜头说明/)

const missingAnchor = validShots.map((shot) => ({ ...shot }))
missingAnchor[2].sceneAnchor = ''
assert.throws(() => workflow.parseStoryboardGrokResult({
  data: { choices: [{ message: { content: JSON.stringify(missingAnchor) } }] }
}, 'test-seed'), /第3格缺少空间锚点/)

const englishDisplay = validShots.map((shot) => ({ ...shot }))
englishDisplay[0].title = 'Leaving hometown'
assert.throws(() => workflow.parseStoryboardGrokResult({
  data: { choices: [{ message: { content: JSON.stringify(englishDisplay) } }] }
}, 'test-seed'), /第1格剧情节点必须使用中文/)

const missingDisplayCaption = validShots.map((shot) => ({ ...shot }))
missingDisplayCaption[1].displayCaption = ''
assert.throws(() => workflow.parseStoryboardGrokResult({
  data: { choices: [{ message: { content: JSON.stringify(missingDisplayCaption) } }] }
}, 'test-seed'), /第2格缺少中文画面说明/)

const missingStructuredSubject = validShots.map((shot) => ({ ...shot }))
delete missingStructuredSubject[3].subjectState
const toleratedMissingSubject = workflow.parseStoryboardGrokResult({
  data: { choices: [{ message: { content: JSON.stringify(missingStructuredSubject) } }] }
}, 'test-seed')
assert.equal(toleratedMissingSubject.shots[3].subjectState, null)
assert.deepEqual(toleratedMissingSubject.directorQuality.issues.find((issue) => issue.code === 'SUBJECT_STATE_MISSING').scenes, [4])

const missingStructuredProps = validShots.map((shot) => ({ ...shot }))
delete missingStructuredProps[5].keyProps
const toleratedMissingProps = workflow.parseStoryboardGrokResult({
  data: { choices: [{ message: { content: JSON.stringify(missingStructuredProps) } }] }
}, 'test-seed')
assert.equal(toleratedMissingProps.shots[5].keyProps, null)
assert.deepEqual(toleratedMissingProps.directorQuality.issues.find((issue) => issue.code === 'KEY_PROP_LEDGER_MISSING').scenes, [6])

const missingVisualEvent = validShots.map((shot) => ({ ...shot }))
delete missingVisualEvent[3].visualEvent
missingVisualEvent[3].prompt = `Camera and composition: ${missingVisualEvent[3].camera}. Subject state: ${missingVisualEvent[3].subjectState.id}; appearance: ${missingVisualEvent[3].subjectState.appearance}; physical state: ${missingVisualEvent[3].subjectState.state}; state change event: none. Key prop states: ${missingVisualEvent[3].keyProps[0].name} [${missingVisualEvent[3].keyProps[0].id}]; appearance: ${missingVisualEvent[3].keyProps[0].appearance}; state: ${missingVisualEvent[3].keyProps[0].state}; location: ${missingVisualEvent[3].keyProps[0].location}; state change event: none.`
const missingVisualEventResult = workflow.parseStoryboardGrokResult({
  data: { choices: [{ message: { content: JSON.stringify(missingVisualEvent) } }] }
}, 'test-seed')
assert.deepEqual(missingVisualEventResult.directorQuality.issues.find((issue) => issue.code === 'VISUAL_EVENT_MISSING').scenes, [4])

const cameraNotInlined = validShots.map((shot) => ({ ...shot }))
cameraNotInlined[2].prompt = 'Subject state: named detective in the same dark coat; the detective opens the locked door.'
const cameraQuality = workflow.evaluateStoryboardDirectorQuality(cameraNotInlined)
assert.equal(cameraQuality.ok, false)
assert.deepEqual(cameraQuality.issues.find((issue) => issue.code === 'CAMERA_NOT_INLINE').scenes, [3])

const repeatedSignature = validShots.map((shot) => ({ ...shot }))
repeatedSignature[1].camera = repeatedSignature[0].camera
repeatedSignature[1].prompt = `Camera and composition: ${repeatedSignature[1].camera}. Subject state: named detective in the same dark coat; Visible moment: the detective enters the room.`
const repeatedQuality = workflow.evaluateStoryboardDirectorQuality(repeatedSignature)
assert.deepEqual(repeatedQuality.issues.find((issue) => issue.code === 'ADJACENT_VISUAL_SIGNATURE_REPEAT').scenes, [1, 2])

const textDependent = validShots.map((shot) => ({ ...shot }))
textDependent[5].prompt = `Camera and composition: ${textDependent[5].camera}. Subject state: named detective in the same dark coat; a monitor shows upload progress at 100 percent as the only proof of completion.`
const textQuality = workflow.evaluateStoryboardDirectorQuality(textDependent)
assert.deepEqual(textQuality.issues.find((issue) => issue.code === 'READABLE_TEXT_DEPENDENCY').scenes, [6])

const percentSignDependent = validShots.map((shot) => ({ ...shot }))
percentSignDependent[5].prompt = `Camera and composition: ${percentSignDependent[5].camera}. Subject state: named detective in a dark coat; a screen shows a green progress bar at 100%, with no other physical consequence.`
const percentSignQuality = workflow.evaluateStoryboardDirectorQuality(percentSignDependent)
assert.deepEqual(percentSignQuality.issues.find((issue) => issue.code === 'READABLE_TEXT_DEPENDENCY').scenes, [6], 'a percent sign followed by punctuation must still be rejected')

const progressBarDependent = validShots.map((shot) => ({ ...shot }))
progressBarDependent[5].visualEvent = 'The detective watches an upload progress bar fill while no physical consequence appears.'
progressBarDependent[5].prompt = `Camera and composition: ${progressBarDependent[5].camera}. Subject state: named detective in a dark coat; an upload progress bar fills without text or numbers.`
const progressBarQuality = workflow.evaluateStoryboardDirectorQuality(progressBarDependent)
assert.deepEqual(progressBarQuality.issues.find((issue) => issue.code === 'READABLE_TEXT_DEPENDENCY').scenes, [6], 'a non-text progress bar must not replace a visible physical story result')

const billboardText = validShots.map((shot) => ({ ...shot }))
billboardText[4].prompt = `Camera and composition: ${billboardText[4].camera}. Subject state: named detective in the same dark coat; a neon billboard with giant Chinese characters announces the result.`
const billboardQuality = workflow.evaluateStoryboardDirectorQuality(billboardText)
assert.deepEqual(billboardQuality.issues.find((issue) => issue.code === 'READABLE_TEXT_DEPENDENCY').scenes, [5])

const glowingCodeText = validShots.map((shot) => ({ ...shot }))
glowingCodeText[8].visualEvent = 'A massive data storm of swirling glowing code expands behind the detective.'
glowingCodeText[8].prompt = `${glowingCodeText[8].prompt} A massive data storm of swirling glowing code expands behind the detective.`
const glowingCodeQuality = workflow.evaluateStoryboardDirectorQuality(glowingCodeText)
assert.deepEqual(glowingCodeQuality.issues.find((issue) => issue.code === 'READABLE_TEXT_DEPENDENCY').scenes, [9], 'glowing or swirling code must be treated as a pseudo-text generation risk')

const cascadingCodeText = validShots.map((shot) => ({ ...shot }))
cascadingCodeText[8].prompt = `${cascadingCodeText[8].prompt} Cascading lines of source code fill the holographic interface.`
const cascadingCodeQuality = workflow.evaluateStoryboardDirectorQuality(cascadingCodeText)
assert.deepEqual(cascadingCodeQuality.issues.find((issue) => issue.code === 'READABLE_TEXT_DEPENDENCY').scenes, [9], 'visible lines of source code must be rejected as pseudo text')

const blankIconScreen = validShots.map((shot) => ({ ...shot }))
blankIconScreen[3].prompt = `${blankIconScreen[3].prompt} A blank screen displays a red warning icon without any text.`
const blankIconQuality = workflow.evaluateStoryboardDirectorQuality(blankIconScreen)
assert.equal(blankIconQuality.issues.some((issue) => issue.code === 'READABLE_TEXT_DEPENDENCY' && issue.scenes.includes(4)), false, 'an icon-only blank screen must remain image-safe')

const negativeCodeRule = validShots.map((shot) => ({ ...shot }))
negativeCodeRule[2].prompt = `${negativeCodeRule[2].prompt} Do not show glowing code or floating glyphs.`
const negativeCodeQuality = workflow.evaluateStoryboardDirectorQuality(negativeCodeRule)
assert.equal(negativeCodeQuality.issues.some((issue) => issue.code === 'READABLE_TEXT_DEPENDENCY' && issue.scenes.includes(3)), false, 'a negative pseudo-text instruction must not flag itself')

const degradedPropInSubject = deterministicallyCompiled.shots.map((shot) => ({
  ...shot,
  subjectState: {
    ...shot.subjectState,
    appearance: 'short black hair, dark wool coat, small weathered brown leather satchel with a brass buckle'
  },
  keyProps: shot.keyProps.map((prop) => ({ ...prop }))
}))
degradedPropInSubject[6].keyProps[0].state = 'destroyed and burned into ash'
degradedPropInSubject[6].keyProps[0].location = 'charred fragments on the locked-room floor'
degradedPropInSubject[6].keyProps[0].changeEvent = 'a visible fire burns the leather satchel into ash'
for (let index = 7; index < degradedPropInSubject.length; index += 1) {
  degradedPropInSubject[index].keyProps[0].state = 'destroyed and burned into ash'
  degradedPropInSubject[index].keyProps[0].location = 'ash remains on the locked-room floor'
  degradedPropInSubject[index].keyProps[0].changeEvent = ''
}
const degradedConflictQuality = workflow.evaluateStoryboardDirectorQuality(degradedPropInSubject)
assert.ok(degradedConflictQuality.issues.some((issue) => issue.code === 'DEGRADED_PROP_STILL_IN_SUBJECT_APPEARANCE' && issue.scenes.includes(7)))
const reconciledDegradedProp = workflow.reconcileStoryboardGrokContinuity(degradedPropInSubject)
for (let index = 6; index < reconciledDegradedProp.shots.length; index += 1) {
  assert.doesNotMatch(reconciledDegradedProp.shots[index].subjectState.appearance, /small weathered brown leather satchel with a brass buckle/i, 'a terminal prop must be removed from the subject appearance and stay removed')
}
assert.ok(reconciledDegradedProp.actions.some((item) => item.code === 'DEGRADED_PROP_REMOVED_FROM_SUBJECT_APPEARANCE' && item.scene === 7))
assert.match(reconciledDegradedProp.shots[6].prompt, /never show the intact or usable prop/i)
assert.match(reconciledDegradedProp.shots[6].prompt, /if the current Visible event does not explicitly involve its residue, keep the prop absent and off-screen/i)
assert.doesNotMatch(reconciledDegradedProp.shots[6].prompt, /small weathered brown leather satchel with a brass buckle/i, 'terminal prompt must not positively repeat the old intact appearance')
assert.equal(reconciledDegradedProp.directorQuality.status, 'PASS')

const synonymDegradedProp = deterministicallyCompiled.shots.map((shot) => ({
  ...shot,
  subjectState: {
    ...shot.subjectState,
    appearance: 'short black hair, dark wool coat, weathered brown shoulder satchel with brass hardware'
  },
  keyProps: shot.keyProps.map((prop) => ({ ...prop }))
}))
synonymDegradedProp[6].keyProps[0].state = 'destroyed and burned into ash'
synonymDegradedProp[6].keyProps[0].location = 'ash on the floor'
synonymDegradedProp[6].keyProps[0].changeEvent = 'a visible fire burns the satchel into ash'
for (let index = 7; index < synonymDegradedProp.length; index += 1) {
  synonymDegradedProp[index].keyProps[0].state = 'destroyed and burned into ash'
  synonymDegradedProp[index].keyProps[0].location = 'ash on the floor'
  synonymDegradedProp[index].keyProps[0].changeEvent = ''
}
const synonymConflictQuality = workflow.evaluateStoryboardDirectorQuality(synonymDegradedProp)
assert.ok(synonymConflictQuality.issues.some((issue) => issue.code === 'DEGRADED_PROP_STILL_IN_SUBJECT_APPEARANCE' && issue.scenes.includes(7)), 'semantic shorthand for a destroyed prop must still be detected in subject appearance')
const reconciledSynonymProp = workflow.reconcileStoryboardGrokContinuity(synonymDegradedProp)
assert.doesNotMatch(reconciledSynonymProp.shots[6].subjectState.appearance, /satchel/i, 'comma-delimited shorthand for a terminal prop must be removed locally')
assert.equal(reconciledSynonymProp.directorQuality.status, 'PASS')

const missingSubjectState = validShots.map((shot) => ({ ...shot }))
missingSubjectState[7].prompt = `Camera and composition: ${missingSubjectState[7].camera}. The detective runs into the corridor.`
const subjectQuality = workflow.evaluateStoryboardDirectorQuality(missingSubjectState)
assert.deepEqual(subjectQuality.issues.find((issue) => issue.code === 'SUBJECT_STATE_NOT_INLINE').scenes, [8])

const repairPayload = workflow.buildStoryboardGrokRepairPayload({
  storyText: 'A detective investigates a locked room disappearance.',
  sourceAnalysis: 'Named detective with a dark coat and leather satchel.',
  visualCuePack: 'Noir anime lighting.'
}, { shots: cameraNotInlined, directorQuality: cameraQuality })
assert.equal(repairPayload.temperature, 0.2)
assert.equal(repairPayload.max_tokens, 4096)
assert.equal(repairPayload.messages.length, 2)
assert.match(repairPayload.messages[0].content, /最多执行一次的定向质量修复/)
assert.match(repairPayload.messages[0].content, /只修复质量报告指出的镜头3/)
assert.match(repairPayload.messages[0].content, /CAMERA_NOT_INLINE/)
assert.match(repairPayload.messages[0].content, /禁止借修复加入新角色、新地点、新事件、新道具、新造型变化/)
assert.match(repairPayload.messages[0].content, /glowing code[\s\S]*?抽象光带/)
assert.match(repairPayload.messages[0].content, /progress bar[\s\S]*?物理结果/)
assert.match(repairPayload.messages[0].content, /DEGRADED_PROP_STILL_IN_SUBJECT_APPEARANCE[\s\S]*?subjectState\.appearance/)
assert.match(repairPayload.messages[1].content, /FIRST PASS JSON/)
assert.match(repairPayload.messages[1].content, /DIRECTOR QUALITY ISSUES/)
assert.match(repairPayload.messages[1].content, /CAMERA_NOT_INLINE/)
const externalQualityRepair = workflow.buildStoryboardGrokRepairPayload({
  storyText: 'A detective investigates a locked room disappearance.'
}, { shots: validShots }, {
  issues: [{ code: 'IDENTITY_CONFLICT', severity: 'WARNING', scene: 2, detail: 'hairLength:short->long' }]
})
assert.match(externalQualityRepair.messages[0].content, /只修复质量报告指出的镜头2/)
assert.match(externalQualityRepair.messages[1].content, /IDENTITY_CONFLICT/)
assert.throws(() => workflow.buildStoryboardGrokRepairPayload({
  storyText: 'A detective investigates a locked room disappearance.'
}, { shots: validShots, directorQuality: workflow.evaluateStoryboardDirectorQuality(validShots) }), /没有需要处理的质量问题/)

const invalidCountQuality = workflow.evaluateStoryboardDirectorQuality(validShots.slice(0, 8))
assert.equal(invalidCountQuality.issues.some((issue) => issue.code === 'SCENE_COUNT_INVALID'), true)

assert.deepEqual(workflow.buildStoryboardVisualSignature({
  camera: 'medium shot, eye-level angle, protagonist on the left third, static frame'
}), {
  framing: 'medium',
  angle: 'eye-level',
  placement: 'left-third',
  motion: 'static',
  componentCount: 4,
  key: 'medium|eye-level|left-third|static'
})

console.log('storyboard Grok universal director tests passed')
