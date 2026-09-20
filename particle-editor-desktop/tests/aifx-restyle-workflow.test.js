const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const workflowPath = path.join(root, 'particle-editor', 'aifx-restyle.workflow.js')
const window = {}
window.window = window
window.globalThis = window

vm.runInNewContext(readFileSync(workflowPath, 'utf8'), {
  window,
  globalThis: window,
  console,
}, { filename: workflowPath })

const api = window.NovaFlowAifxRestyleWorkflow
assert.ok(api, 'AI 特效 restyle workflow module must be exposed')

// --- presets -----------------------------------------------------------
// The module runs in its own vm realm, so its arrays do not share this
// realm's Array.prototype and deepStrictEqual would reject them on identity
// alone. Compare the shapes as JSON instead.
const json = (value) => JSON.stringify(value)
const ids = api.ATTRIBUTE_PRESETS.map(preset => preset.id)
assert.equal(new Set(ids).size, ids.length, 'attribute ids must be unique')
// The eight that have been render-checked end to end. New presets may be added
// freely, but these must not silently disappear or change meaning.
for (const id of ['fire', 'venom', 'ice', 'water', 'thunder', 'wind', 'shadow', 'holy', 'ink', 'pixel',
  'gold', 'neon', 'candy', 'confetti', 'chrome']) {
  assert.ok(ids.includes(id), `${id} must stay in the library`)
}
// 2026-09-20: the library was widened from 28 to 54 so it covers what a slot
// game artist actually asks for (jade, banknotes, marquee bulbs, silk ribbon,
// paper-cut, guochao ...). These must stay, in these groups.
assert.ok(api.ATTRIBUTE_PRESETS.length >= 54, 'the library must not shrink below 54 styles')
for (const id of ['smoke', 'snow', 'bubble', 'moltengold', 'rainbow', 'aurora', 'glitter', 'ghostfire',
  'jade', 'diamond', 'glass', 'bronze', 'silk', 'petal', 'feather', 'chocolate', 'gear',
  'cash', 'firework', 'marquee', 'cartoon', 'sketch', 'watercolor', 'papercut', 'guochao', 'lowpoly']) {
  assert.ok(ids.includes(id), `${id} must be in the widened library`)
}
for (const preset of api.ATTRIBUTE_PRESETS) {
  assert.equal(typeof preset.verified, 'boolean', `${preset.id} must say whether it was render-checked`)
}
// Every preset carries the group the panel renders it under.
for (const preset of api.ATTRIBUTE_PRESETS) {
  assert.ok(['元素', '能量', '物质', '界面', '画风'].includes(preset.group),
    `${preset.id} needs a known group`)
}
for (const preset of api.ATTRIBUTE_PRESETS) {
  assert.ok(preset.label, `${preset.id} needs a label`)
  assert.ok(preset.name, `${preset.id} needs a prompt name`)
  assert.ok(preset.material.length > 80, `${preset.id} needs a real material description`)
  // The dispersal sentence is a separate field so a looping element can leave
  // it out; keeping it inside `material` is what made a looping border light
  // explode into coins at the end of the shot.
  assert.ok(preset.breakup && preset.breakup.length > 20, `${preset.id} needs a breakup clause`)
  assert.ok(!/It [A-Z]{3,}/.test(preset.material),
    `${preset.id} must keep its terminal dispersal in breakup, not material`)
  // Colour alone produced recoloured copies of the source in testing; each
  // preset has to say how the material behaves, and what it is not.
  assert.match(preset.material, /\bNO\b|\bNOT\b/, `${preset.id} must exclude neighbouring materials`)
}

// --- strength <-> denoise ----------------------------------------------
assert.equal(api.strengthToDenoise(0), api.MIN_DENOISE)
assert.equal(api.strengthToDenoise(100), api.MAX_DENOISE)
assert.equal(api.strengthToDenoise(70), 0.8)
assert.equal(api.denoiseToStrength(api.strengthToDenoise(70)), 70)
assert.equal(api.strengthToDenoise(api.DEFAULT_STRENGTH), 0.7, 'the midpoint is the measured sweet spot')
assert.equal(api.strengthToDenoise(-50), api.MIN_DENOISE, 'strength clamps low')
assert.equal(api.strengthToDenoise(500), api.MAX_DENOISE, 'strength clamps high')
assert.equal(api.strengthToDenoise('not a number'), api.MIN_DENOISE)

// --- per-attribute defaults --------------------------------------------
// Forked lightning needs a looser init than a liquid does, and the void body
// only inverts to black with extra freedom, so the presets carry their own.
assert.equal(api.defaultStrengthFor('ice'), api.DEFAULT_STRENGTH)
assert.equal(api.defaultStrengthFor('thunder'), 70)
assert.equal(api.defaultStrengthFor('shadow'), 70)
assert.equal(api.defaultStrengthFor('nope'), api.DEFAULT_STRENGTH)
const auto = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'thunder' })
assert.equal(auto[6].inputs.denoise, api.strengthToDenoise(70))

// No preset DEFAULT may sit above the last denoise that still tracked the
// source. Swept on the symbol-tile template: envelope 0.984 at 0.70, 0.78 and
// 0.80, then 0.018 at 0.82 and 0.85. 雷电 used to default to 0.85 on the
// strength of an earlier reading that 0.80 flattened its forks - re-measured
// at the same seed, 0.80 forks MORE and tracks the same (0.974 against 0.975),
// while 0.85 turned a shattering tile into an unrelated electric ring.
assert.equal(api.strengthToDenoise(api.MAX_DEFAULT_STRENGTH), 0.8)
for (const preset of api.ATTRIBUTE_PRESETS) {
  assert.ok(api.defaultStrengthFor(preset.id) <= api.MAX_DEFAULT_STRENGTH,
    preset.id + ' must not default past the point where the source stops tracking')
}
// The slider is not capped - this is a default, not a limit.
assert.equal(api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'thunder', strength: 95,
})[6].inputs.denoise, api.strengthToDenoise(95))
const overridden = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'thunder', strength: 10 })
assert.equal(overridden[6].inputs.denoise, api.strengthToDenoise(10), 'an explicit slider wins')

// --- a reference image needs no style ---------------------------------------
// The panel starts with nothing picked; with a reference image loaded that is
// a complete recipe, because the picture is the material. Without either it
// is an error, not a silent default.
const referenceOnly = api.buildWorkflow({ sourceVideo: 's.mp4', referenceImage: 'look.png' })
api.validateWorkflow(referenceOnly)
assert.equal(referenceOnly[5].class_type, 'MiniMaxH3ReferenceToVideo')
assert.match(referenceOnly[5].inputs.prompt, /<Picture 1>/)
assert.doesNotMatch(referenceOnly[5].inputs.prompt, /VENOM|ICE|FIRE|GOLD/)
assert.equal(referenceOnly[6].inputs.denoise, api.strengthToDenoise(api.DEFAULT_STRENGTH))
assert.throws(() => api.buildWorkflow({ sourceVideo: 's.mp4', attribute: '' }), /Unknown AI 特效 attribute/)

// --- plain graph --------------------------------------------------------
const plain = api.buildWorkflow({ sourceVideo: 'source.mp4', attribute: 'venom', strength: 70, seed: 7 })
api.validateWorkflow(plain)
assert.equal(plain[5].class_type, 'MiniMaxH3ImageToVideo', 'no references means the t2v node')
assert.equal(plain[6].inputs.denoise, 0.8)
assert.equal(json(plain[10].inputs.latent_image), json(['33', 0]), 'sampler must start from the source latent')
assert.equal(plain[33].inputs.desaturate, 1, 'the init is desaturated by default')
assert.equal(json(plain[33].inputs.images), json(['32', 0]))
assert.equal(json(plain[9].inputs.model), json(['16', 0]), 'guider runs through SageAttention')
assert.match(plain[5].inputs.prompt, /VENOM/)
assert.match(plain[5].inputs.prompt, /pure solid black/)

// --- the shape has to be named --------------------------------------------
// Measured at a fixed seed and denoise 0.70: leaving the silhouette unnamed
// turned a crescent into a shapeless drip (IoU 0.187 against the source),
// naming it kept the crescent (0.356). So the shape reaches the prompt twice,
// once in the subject and once as a hold instruction.
const CRESCENT = 'crescent slash, one clean half-moon arc thick at the middle'
const shaped = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'venom', shape: CRESCENT })
const shapedPrompt = shaped[5].inputs.prompt
assert.match(shapedPrompt, /anime-style VENOM crescent slash, one clean half-moon arc/)
assert.match(shapedPrompt, /The crescent slash KEEPS the same silhouette/)
assert.ok(!shapedPrompt.includes(api.DEFAULT_SHAPE), 'an explicit shape replaces the fallback')

const unshaped = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'venom' })
assert.match(unshaped[5].inputs.prompt, new RegExp('VENOM ' + api.DEFAULT_SHAPE))

// The reference-image form has to carry it too, or a look reference silently
// costs the silhouette.
const shapedRef = api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'venom', shape: CRESCENT, referenceImage: 'look.png',
})
assert.match(shapedRef[5].inputs.prompt, /<Subject 1>: a crescent slash/)

// A reference image must get the light-free wording where one exists, or the
// phrase competes with the picture: measured on a copper photo over the symbol
// tile, "panel of light that flashes bright" gave 0.003 saturation against
// 0.209 without it, with the motion held either way.
const PLAIN = 'rounded-square panel that cracks and then breaks into angular shards'
const LIT = 'rounded-square panel of light that flashes bright'
const refPlain = api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'ice', referenceImage: 'look.png',
  shape: 'symbol tile shatter, one solid ' + LIT,
  plainShape: 'symbol tile shatter, one solid ' + PLAIN,
})
assert.ok(refPlain[5].inputs.prompt.includes(PLAIN), 'the reference path takes the plain wording')
assert.ok(!refPlain[5].inputs.prompt.includes(LIT), 'and drops the lit one entirely')
// Without a reference the lit wording is still the right one.
assert.ok(api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'ice',
  shape: 'symbol tile shatter, one solid ' + LIT,
  plainShape: 'symbol tile shatter, one solid ' + PLAIN,
})[5].inputs.prompt.includes(LIT), 'the plain wording is only for the reference path')
assert.match(shapedRef[5].inputs.prompt, /A single crescent slash, one clean half-moon arc/)
assert.match(shapedRef[5].inputs.prompt, /The crescent slash KEEPS the same silhouette/)

// ...and it must NOT name a material. Measured: give the model a venom still
// and write ICE in the text and it renders ice - the words beat the picture
// every time, which made uploading a reference do nothing at all. With the
// material left unnamed, four references gave four materials on one motion
// against a plain white control. So the preset is out of the prompt whenever
// a reference is attached, and the panel greys the picker to match.
assert.ok(!shapedRef[5].inputs.prompt.includes('VENOM'),
  'a reference image replaces the preset, so the preset must not be named')
assert.ok(!shapedRef[5].inputs.prompt.includes(api.getPreset('venom').breakup),
  'nor may its break-up sentence survive')
// The supplement box still reaches the subject, because that is the artist
// talking about this shot rather than a stored preset.
assert.ok(api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'venom', shape: CRESCENT, referenceImage: 'look.png',
  supplement: 'heavier droplets',
})[5].inputs.prompt.includes('<Subject 1>: a crescent slash, one clean half-moon arc thick at '
  + 'the middle heavier droplets'))

// --- lifecycle ------------------------------------------------------------
const LOOP_CLAUSE = 'LOOPS: it repeats and stays whole'
const once = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'gold', shape: CRESCENT })
assert.match(once[5].inputs.prompt, /It SCATTERS/, 'a one-shot says how it ends')
assert.match(once[5].inputs.prompt, new RegExp(api.DEFAULT_LIFECYCLE_CLAUSE))

const loop = api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'gold', shape: CRESCENT,
  lifecycle: 'loop', lifecycleClause: LOOP_CLAUSE,
})
assert.ok(!loop[5].inputs.prompt.includes('It SCATTERS'), 'a loop must not be told to disperse')
assert.ok(!loop[5].inputs.prompt.includes(api.DEFAULT_LIFECYCLE_CLAUSE))
assert.match(loop[5].inputs.prompt, new RegExp(LOOP_CLAUSE))
// The material itself must survive either way.
assert.match(loop[5].inputs.prompt, /polished yellow gold/)

// A loop's motion is its content, so it gets a much lower default than a
// one-shot. Measured on the border-light template: pulse-following went 0.54 at
// denoise 0.85, 0.69 at 0.70 and 0.94 at 0.55.
assert.equal(api.defaultStrengthFor('gold', 'loop', 'frame'), api.LOOP_MAX_STRENGTH)
assert.equal(api.defaultStrengthFor('thunder', 'loop', 'frame'), api.LOOP_MAX_STRENGTH,
  'the cap applies even to presets that normally want a loose init')
assert.equal(api.defaultStrengthFor('gold', 'once', 'frame'), 50,
  'a one-shot keeps its preset default')
assert.equal(api.strengthToDenoise(api.LOOP_MAX_STRENGTH), 0.55)

// The tight cap is only right where the motion is a travelling pulse. A
// radially symmetric loop held at 0.55 keeps following (envelope 0.97-0.99 at
// 0.70 either way) but loses the material: a venom fountain measured 0.077
// saturation at 0.55 against 0.469 at 0.70, on a source whose own is 0.636.
assert.equal(json(api.TIGHT_LOOP_SHAPES), json(['frame', 'trail']))
for (const archetype of api.TIGHT_LOOP_SHAPES) {
  assert.equal(api.defaultStrengthFor('venom', 'loop', archetype), api.LOOP_MAX_STRENGTH,
    archetype + ' is a travelling pulse and needs the tight cap')
}
for (const archetype of ['fountain', 'rays', 'swirl', 'ring', 'burst', 'shatter']) {
  assert.equal(api.defaultStrengthFor('venom', 'loop', archetype), api.LOOP_SOFT_STRENGTH,
    archetype + ' is a mass and only needs the soft cap')
}
assert.equal(api.strengthToDenoise(api.LOOP_SOFT_STRENGTH), 0.7)
// Above the soft cap the envelope breaks (0.73 for a ray fan, -0.03 for a
// vortex at 0.85), so a loose preset is still pulled down to it.
assert.equal(api.defaultStrengthFor('thunder', 'loop', 'rays'), api.LOOP_SOFT_STRENGTH)
// An unnamed shape gets the conservative one.
assert.equal(api.defaultStrengthFor('venom', 'loop'), api.LOOP_MAX_STRENGTH)

assert.equal(api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'thunder', lifecycle: 'loop' })[6]
  .inputs.denoise, 0.55)
assert.equal(api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'thunder', lifecycle: 'loop', shapeArchetype: 'rays',
})[6].inputs.denoise, 0.7, 'buildWorkflow has to use the same cap the panel shows')
// An explicit slider still overrides the cap.
assert.equal(api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'gold', lifecycle: 'loop', strength: 90,
})[6].inputs.denoise, api.strengthToDenoise(90))

// --- reference image ----------------------------------------------------
const withRef = api.buildWorkflow({
  sourceVideo: 'source.mp4', referenceImage: 'look.png', attribute: 'ice', strength: 40, seed: 7,
})
api.validateWorkflow(withRef)
assert.equal(withRef[5].class_type, 'MiniMaxH3ReferenceToVideo', 'a look reference needs ref2v')
assert.equal(json(withRef[5].inputs['ref_images.ref_image_0']), json(['20', 0]))
assert.equal(withRef[20].inputs.image, 'look.png')
assert.equal(withRef[5].inputs.ref_image_size, 'match')
assert.match(withRef[5].inputs.prompt, /<Picture 1>/, 'the reference must be addressable')
assert.match(withRef[5].inputs.prompt, /retention_analysis:/)

// --- motion reference ---------------------------------------------------
const withMotion = api.buildWorkflow({
  sourceVideo: 'source.mp4', motionReference: 'spine.mp4', attribute: 'thunder', seed: 7,
})
api.validateWorkflow(withMotion)
assert.equal(json(withMotion[5].inputs['ref_videos.ref_video_0']), json(['26', 0]))
assert.equal(withMotion[24].inputs.file, 'spine.mp4')

// --- supplement ---------------------------------------------------------
const supplemented = api.buildWorkflow({
  sourceVideo: 'source.mp4', attribute: 'water', supplement: 'deep sapphire blue, heavier foam',
})
assert.match(supplemented[5].inputs.prompt, /deep sapphire blue, heavier foam/)

// --- guards -------------------------------------------------------------
assert.throws(() => api.buildWorkflow({ attribute: 'ice' }), /source clip/)
assert.throws(() => api.buildWorkflow({ sourceVideo: 's.mp4', attribute: '__not_a_style__' }),
  /Unknown AI 特效 attribute/)

// Sampling from the empty latent still renders a plausible clip, so it is the
// one wiring mistake that would ship silently.
const detached = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'ice' })
detached[10].inputs.latent_image = ['5', 1]
assert.throws(() => api.validateWorkflow(detached), /must sample from the source latent/)

const noLatent = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'ice' })
delete noLatent[33]
assert.throws(() => api.validateWorkflow(noLatent), /NovaFlowH3VideoToVideoLatent/)

const badDenoise = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'ice' })
badDenoise[6].inputs.denoise = 0
assert.throws(() => api.validateWorkflow(badDenoise), /denoise must sit/)

// --- resolution ---------------------------------------------------------
const sized = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'ice', width: 700, height: 401 })
assert.equal(sized[5].inputs.width % 32, 0)
assert.equal(sized[5].inputs.height % 32, 0)
assert.equal(sized[33].inputs.width, sized[5].inputs.width)

console.log('aifx-restyle workflow: ok')
