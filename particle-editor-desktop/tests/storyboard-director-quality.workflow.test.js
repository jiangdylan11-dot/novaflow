const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const workflowPath = path.resolve(__dirname, '../../particle-editor/storyboard-director-quality.workflow.js')
const workflowSource = fs.readFileSync(workflowPath, 'utf8')
const sandbox = { module: { exports: {} } }
sandbox.globalThis = sandbox
vm.runInNewContext(workflowSource, sandbox, { filename: workflowPath })
const quality = sandbox.module.exports

assert.equal(quality, sandbox.NovaFlowStoryboardDirectorQuality, 'browser global and Node module.exports should expose the same frozen API')

function shot(number, camera, action, overrides) {
  const base = {
    scene: number,
    title: `镜头${number}`,
    displayCaption: `镜头${number}可见事件`,
    camera,
    action,
    prompt: `${camera}. ${action}`
  }
  return { ...base, ...(overrides || {}) }
}

const cyberShots = [
  shot(1, 'wide rear shot, subject on the left third', 'A hacker with long straight silver hair walks toward the data tower through rain.'),
  shot(2, 'medium eye-level shot, centered composition', 'The short silver-haired hacker stands still while patrol drones lock onto her.', {
    prompt: 'The short silver-haired hacker stands still while patrol drones lock onto her.'
  }),
  shot(3, 'medium low-angle shot, centered composition', 'She kneels beside the terminal case, both hands pressing its controls as red sparks jump from the lid.'),
  shot(4, 'medium low-angle shot, centered composition', 'She crouches beside the terminal case, gripping a cable while its blue light reflects across a puddle.'),
  shot(5, 'over-shoulder medium shot, subject on the right third', 'A billboard reads ACCESS GRANTED while she rewrites the counter-code.'),
  shot(6, 'wide eye-level shot, centered composition', 'She uploads the counter-code; a nearby screen shows 100%.'),
  shot(7, 'low-angle wide shot, subject on the right third', 'The terminal case self-destructs in a visible blast, scattering burning fragments across the wet street.'),
  shot(8, 'tracking profile medium shot, subject on the left third', 'She runs into a dark alley as sparks and smoke roll behind her.'),
  shot(9, 'extreme wide rear shot, subject in foreground', 'She carries the intact terminal case while a visible data storm coils around the tower.')
]

const cyber = quality.evaluateShots(cyberShots, {
  identityCues: 'A woman with a short silver bob haircut and black tactical suit.',
  keyProps: ['terminal case']
})

assert.equal(cyber.hardError, '', 'quality concerns should remain repairable warnings when schema is complete')
assert.equal(cyber.storyProgression, 'WARNING')
assert.equal(cyber.cameraDiversity, 'WARNING')
assert.ok(cyber.perScene[0].warnings.some((item) => item.includes('IDENTITY_CONFLICT:hairLength:short->long')))
assert.ok(cyber.perScene[1].warnings.some((item) => item.includes('CAMERA_NOT_INLINE')))
assert.ok(cyber.perScene[3].warnings.some((item) => item.includes('ADJACENT_VISUAL_SIGNATURE_REPEAT')))
assert.ok(cyber.perScene[4].warnings.some((item) => item.includes('READABLE_TEXT_DEPENDENCY')))
assert.ok(cyber.perScene[5].warnings.some((item) => item.includes('READABLE_TEXT_DEPENDENCY')))
assert.ok(cyber.perScene[5].warnings.some((item) => item.includes('ABSTRACT_EVENT_WITHOUT_VISIBLE_EVIDENCE')))
assert.ok(cyber.perScene[8].warnings.some((item) => item.includes('PROP_STATE_RECOVERY_RISK:terminal case')))

const percentPunctuationShots = cyberShots.map((item) => ({ ...item }))
percentPunctuationShots[5].prompt = 'Wide eye-level shot, centered composition; an abstract progress arc reaches 100%, while the surrounding machinery remains unchanged.'
const percentPunctuation = quality.evaluateShots(percentPunctuationShots)
assert.ok(percentPunctuation.perScene[5].warnings.some((item) => item.includes('READABLE_TEXT_DEPENDENCY')), '100% before punctuation must remain a readable-number dependency')

const structuredPilotShot = {
  camera: 'close-up, low angle, face on the right third',
  action: 'The pilot grips the broken control lever.',
  visibleConsequence: 'sparks illuminate her tense expression',
  currentSpace: 'inside a damaged cockpit',
  subjectPosition: 'control lever in the foreground',
  subjectState: {
    id: 'pilot',
    appearance: 'short black hair and the same orange flight suit',
    state: 'alert and uninjured',
    changeEvent: ''
  },
  keyProps: [{
    id: 'control_lever',
    name: 'control lever',
    appearance: 'black metal lever with a red grip',
    state: 'broken',
    location: 'in the pilot right hand',
    changeEvent: 'the cockpit impact snaps the lever'
  }]
}
const promptParts = quality.compileScenePromptParts(structuredPilotShot, {
  identityAnchor: 'same pilot, same orange flight suit',
  styleAnchor: 'cinematic science-fiction realism'
})
assert.match(promptParts.parts[0], /^Camera and composition:/)
assert.match(promptParts.parts[1], /^Subject state:/)
assert.match(promptParts.parts[2], /^Key prop states:/)
assert.match(promptParts.parts[3], /^Visible event:/)
assert.match(promptParts.prompt, /visible consequence: sparks illuminate her tense expression/i)
assert.doesNotMatch(promptParts.keyProps, /black metal lever with a red grip/i, 'a broken terminal prop prompt must not repeat its old intact appearance')
assert.match(promptParts.keyProps, /never show an intact or usable version/i)
assert.match(quality.terminalKeyPropPriorityRule(promptParts.prompt), /overrides image-reference and identity-lock equipment cues/i)
assert.equal(quality.validateCompiledPrompt({
  camera: 'close-up, low angle, face on the right third',
  compiledPrompt: promptParts.prompt
}).cameraInline, true)
const structuredCompiled = quality.validateCompiledPrompt({
  ...structuredPilotShot,
  compiledPrompt: promptParts.prompt
}, { validationStage: 'compiled', requireStructuredContinuity: true })
assert.equal(structuredCompiled.status, 'PASS')
assert.equal(structuredCompiled.subjectStateInline, true)
assert.equal(structuredCompiled.keyPropStatesInline, true)

const droppedStructuredCompiled = quality.validateCompiledPrompt({
  ...structuredPilotShot,
  compiledPrompt: `Camera and composition: ${structuredPilotShot.camera}. Visible event: The pilot grips the broken control lever.`
}, { validationStage: 'compiled', requireStructuredContinuity: true })
assert.ok(droppedStructuredCompiled.errors.includes('SUBJECT_STATE_NOT_INLINE'))
assert.ok(droppedStructuredCompiled.errors.includes('KEY_PROP_STATE_NOT_INLINE'))

const dialogueCameras = [
  'wide establishing shot, eye-level, two-shot',
  'over-the-shoulder medium shot, subject on the left third',
  'close-up eye-level shot, subject on the right third',
  'over-the-shoulder medium shot, subject on the right third',
  'insert detail shot, hands in foreground',
  'profile medium two-shot, centered composition',
  'close-up low-angle shot, subject on the left third',
  'medium-wide rear shot, subjects on the right third',
  'wide static shot, silhouettes in foreground'
]
const dialogueActions = [
  'Two diplomats sit opposite each other at one dining table, their guarded posture visible.',
  'The older diplomat opens one palm toward the sealed envelope.',
  'The younger diplomat narrows her eyes, a tense expression crossing her face.',
  'The older diplomat grips the chair arm and turns toward the rainlit window.',
  'One hand slides the sealed envelope across the table into the pool of lamplight.',
  'Both diplomats lean forward as the envelope stops between them.',
  'The younger diplomat releases her clenched hand and gives a small visible nod.',
  'They stand on opposite sides of the same table while the older diplomat opens the door.',
  'The younger diplomat remains beside the empty chair as the other silhouette leaves through the doorway.'
]
const dialogueShots = dialogueActions.map((action, index) => shot(index + 1, dialogueCameras[index], action, {
  currentSpace: 'the same private dining room'
}))
const dialogue = quality.evaluateShots(dialogueShots)
assert.equal(dialogue.hardError, '')
assert.equal(dialogue.storyProgression, 'PASS', 'visible dialogue beats in one room are valid story progression')
assert.equal(dialogue.cameraDiversity, 'PASS', 'one location is not a visual-signature failure when coverage changes')
assert.equal(dialogue.endingQuality, 'PASS')
assert.ok(dialogue.warnings.every((item) => !/LOCATION|SPACE/.test(item)), 'location repetition must never be treated as an error by itself')

const glowingCodeShots = dialogueShots.map((item) => ({ ...item }))
glowingCodeShots[8].visualEvent = 'A storm of swirling glowing code expands through the rain behind the diplomats.'
glowingCodeShots[8].prompt = glowingCodeShots[8].visualEvent
const glowingCodeResult = quality.evaluateShots(glowingCodeShots)
assert.ok(glowingCodeResult.perScene[8].warnings.some((item) => item.includes('READABLE_TEXT_DEPENDENCY')), 'browser quality gate must reject glowing code and similar pseudo-text prompts')

const progressBarShots = dialogueShots.map((item) => ({ ...item }))
progressBarShots[5].visualEvent = 'The younger diplomat watches an upload progress bar fill while nothing else changes.'
progressBarShots[5].prompt = progressBarShots[5].visualEvent
const progressBarResult = quality.evaluateShots(progressBarShots)
assert.ok(progressBarResult.perScene[5].warnings.some((item) => item.includes('READABLE_TEXT_DEPENDENCY')), 'browser quality gate must reject progress UI used in place of a visible physical consequence')

const negativeConstraintShots = dialogueShots.map((item) => ({ ...item }))
negativeConstraintShots[8].prompt = `${negativeConstraintShots[8].prompt} Image-generation constraint: no readable text, code-like glyphs, letters, numbers, subtitles, logos, interface copy, or percentages.`
const negativeConstraintResult = quality.evaluateShots(negativeConstraintShots)
assert.equal(negativeConstraintResult.perScene[8].warnings.some((item) => item.includes('READABLE_TEXT_DEPENDENCY')), false, 'a negative no-text constraint must not trigger its own readable-text detector')

const cascadingCodeShots = dialogueShots.map((item) => ({ ...item }))
cascadingCodeShots[4].prompt = `${cascadingCodeShots[4].prompt} Cascading lines of source code fill the holographic interface.`
const cascadingCodeResult = quality.evaluateShots(cascadingCodeShots)
assert.ok(cascadingCodeResult.perScene[4].warnings.some((item) => item.includes('READABLE_TEXT_DEPENDENCY')), 'browser quality gate must reject visible lines of source code')

const blankIconShots = dialogueShots.map((item) => ({ ...item }))
blankIconShots[4].prompt = `${blankIconShots[4].prompt} A blank screen displays a red warning icon without any text.`
const blankIconResult = quality.evaluateShots(blankIconShots)
assert.equal(blankIconResult.perScene[4].warnings.some((item) => item.includes('READABLE_TEXT_DEPENDENCY')), false, 'browser quality gate must permit an icon-only blank screen')

const negativeCodeShots = dialogueShots.map((item) => ({ ...item }))
negativeCodeShots[4].prompt = `${negativeCodeShots[4].prompt} Do not show glowing code or floating glyphs.`
const negativeCodeResult = quality.evaluateShots(negativeCodeShots)
assert.equal(negativeCodeResult.perScene[4].warnings.some((item) => item.includes('READABLE_TEXT_DEPENDENCY')), false, 'browser quality gate must ignore negative pseudo-text instructions')

const visibleParticleUploadShots = dialogueShots.map((item) => ({ ...item }))
visibleParticleUploadShots[6].visualEvent = 'The terminal emits streams of cyan particle flows connecting to the tower as the upload completes.'
visibleParticleUploadShots[6].prompt = visibleParticleUploadShots[6].visualEvent
const visibleParticleUpload = quality.evaluateShots(visibleParticleUploadShots)
assert.equal(visibleParticleUpload.perScene[6].warnings.some((item) => item.includes('ABSTRACT_EVENT_WITHOUT_VISIBLE_EVIDENCE')), false, 'visible particle flows and a physical connection must count as image-visible evidence')

assert.match(quality.terminalKeyPropPriorityRule('Key prop states: beacon [beacon]; state: absent; location: off-screen; state change event: none.'), /Terminal key-prop state priority/i, 'absent terminal props must receive current-state priority over reference cues')

const ambiguousReferenceLengthShots = dialogueShots.map((item) => ({
  ...item,
  prompt: `${item.prompt} The lead subject has silver-white shoulder-length hair.`
}))
const ambiguousReferenceLength = quality.evaluateShots(ambiguousReferenceLengthShots, {
  sourceCues: '银白色短发齐肩，受青色霓虹轮廓光影响'
})
assert.equal(ambiguousReferenceLength.warnings.some((item) => item.includes('IDENTITY_CONFLICT:hairLength')), false, 'a contradictory source-analysis length must be treated as ambiguous instead of inventing a false identity conflict')

const compiledPrompts = dialogueShots.map((item) => item.prompt)
compiledPrompts[3] = 'The older diplomat grips the chair arm and turns toward the rainlit window.'
const compiledFailure = quality.evaluateShots(dialogueShots, { compiledPrompts })
assert.equal(compiledFailure.status, 'FAIL', 'a final image prompt that drops its camera contract is a hard quality issue')
assert.match(compiledFailure.hardError, /SCENE_04:CAMERA_NOT_INLINE/)
assert.ok(compiledFailure.issues.some((issue) => issue.code === 'CAMERA_NOT_INLINE' && issue.severity === 'ERROR' && issue.scene === 4))
assert.ok(compiledFailure.perScene[3].issues.some((issue) => issue.code === 'CAMERA_NOT_INLINE' && issue.severity === 'ERROR'))

function continuityShot(index, subjectState, propState) {
  const base = shot(index + 1, dialogueCameras[index], dialogueActions[index], {
    subjectState,
    keyProps: [{
      id: 'sealed_envelope',
      name: 'sealed envelope',
      appearance: 'small cream paper envelope with a dark wax seal',
      state: propState.state,
      location: propState.location || 'on the dining table',
      changeEvent: propState.changeEvent || ''
    }]
  })
  return { ...base, prompt: quality.compileScenePromptParts(base).prompt }
}

const baselineSubject = {
  id: 'younger_diplomat',
  appearance: 'short black hair, fitted navy suit, silver lapel pin',
  state: 'alert and uninjured',
  changeEvent: ''
}
const continuityShots = dialogueShots.map((_, index) => {
  const subjectState = { ...baselineSubject }
  if (index === 2) subjectState.appearance = 'long blonde hair, bright red coat, no lapel pin'
  if (index === 5) {
    subjectState.state = 'left arm visibly injured'
    subjectState.changeEvent = 'falling glass cuts the diplomat left arm'
  }
  if (index > 5) subjectState.state = 'left arm visibly injured'
  const propState = index < 5
    ? { state: 'intact' }
    : index === 5
      ? { state: 'damaged', changeEvent: 'falling glass tears the envelope edge' }
      : index === 6
        ? { state: 'destroyed', changeEvent: 'the envelope burns into ash in the lamp flame' }
        : index === 7
          ? { state: 'destroyed', location: 'ash remains on the table' }
          : { state: 'intact', location: 'in the diplomat hand' }
  return continuityShot(index, subjectState, propState)
})
const continuity = quality.evaluateShots(continuityShots, { requireStructuredContinuity: true })
assert.ok(continuity.perScene[2].warnings.some((item) => item.includes('SUBJECT_APPEARANCE_DRIFT_WITHOUT_EVENT')))
assert.ok(continuity.perScene[8].warnings.some((item) => item.includes('KEY_PROP_STATE_DRIFT_WITHOUT_EVENT')))
assert.ok(continuity.perScene[8].warnings.some((item) => item.includes('PROP_STATE_RECOVERY_RISK:sealed envelope')))

const synonymTerminalShot = {
  ...dialogueShots[6],
  subjectState: {
    ...baselineSubject,
    appearance: 'short black hair, fitted navy suit, black terminal equipment attached at the hip'
  },
  keyProps: [{
    id: 'terminal_case',
    name: 'high-tech terminal case',
    appearance: 'large matte black rectangular case with glowing blue interface lines and ports',
    state: 'destroyed, fragments scattered',
    location: 'debris on the floor',
    changeEvent: 'a visible self-destruct blast destroys the terminal case'
  }]
}
synonymTerminalShot.prompt = quality.compileScenePromptParts(synonymTerminalShot).prompt
const synonymTerminalShots = dialogueShots.map((item, index) => index === 6 ? synonymTerminalShot : item)
const synonymTerminalResult = quality.evaluateShots(synonymTerminalShots)
assert.ok(synonymTerminalResult.perScene[6].warnings.some((item) => item.includes('DEGRADED_PROP_STILL_IN_SUBJECT_APPEARANCE')), 'compiled quality must detect semantic shorthand for a destroyed prop inside subject appearance')

for (const terminalState of ['damaged', 'lost', 'consumed']) {
  const transitionShots = dialogueShots.map((_, index) => {
    const propState = index < 6
      ? { state: 'intact' }
      : index === 6
        ? { state: terminalState, changeEvent: `the visible story event leaves the envelope ${terminalState}` }
        : index === 7
          ? { state: terminalState }
          : { state: 'intact' }
    return continuityShot(index, { ...baselineSubject }, propState)
  })
  const transition = quality.evaluateShots(transitionShots, { requireStructuredContinuity: true })
  assert.ok(
    transition.perScene[8].warnings.some((item) => item.includes('PROP_STATE_RECOVERY_RISK:sealed envelope')),
    `${terminalState} key prop must not revive without a visible change event`
  )
}

const repairedTransitionShots = continuityShots.map((item, index) => {
  if (index !== 8) return item
  return continuityShot(index, { ...baselineSubject, state: 'left arm visibly injured' }, {
    state: 'intact',
    location: 'in the diplomat hand',
    changeEvent: 'the courier visibly hands over a replacement sealed envelope'
  })
})
const repairedTransition = quality.evaluateShots(repairedTransitionShots, { requireStructuredContinuity: true })
assert.equal(repairedTransition.perScene[8].warnings.some((item) => item.includes('PROP_STATE_RECOVERY_RISK')), false)

const shortResult = quality.evaluateShots(dialogueShots.slice(0, 8))
assert.match(shortResult.hardError, /SHOT_COUNT_EXPECTED_9:ACTUAL_8/)
assert.equal(shortResult.storyProgression, 'FAIL')
assert.equal(shortResult.cameraDiversity, 'FAIL')
assert.equal(shortResult.endingQuality, 'FAIL')

console.log('Storyboard director quality workflow tests passed.')
