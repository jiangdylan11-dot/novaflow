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
assert.equal(api.strengthToDenoise(api.DEFAULT_STRENGTH), 0.55, 'the default is set for following')
assert.equal(api.strengthToDenoise(-50), api.MIN_DENOISE, 'strength clamps low')
assert.equal(api.strengthToDenoise(500), api.MAX_DENOISE, 'strength clamps high')
assert.equal(api.strengthToDenoise('not a number'), api.MIN_DENOISE)

// --- per-attribute defaults --------------------------------------------
// A material carried by surface follows the source at the default; one carried
// by GRAIN says so in its own strength. Rendering all 54 on the crescent at
// 0.55 found four: pixel art came back as a smooth gold arc with a few stray
// blocks, sand as a smooth crescent with no dust, star with the nebula gone and
// rainbow with its bands blurred. All four hold at 0.60, and nothing needs more.
const GRAINY = ['pixel', 'sand', 'star', 'rainbow']
for (const preset of api.ATTRIBUTE_PRESETS) {
  assert.equal(api.defaultStrengthFor(preset.id), GRAINY.includes(preset.id) ? 30 : 20,
    preset.id + ' must default to the strength it was render-checked at')
}
assert.equal(api.strengthToDenoise(30), 0.6)

// --- 提示词补充 takes priority over following ---------------------------
// Typing in the box is the artist asking for something the preset does not do,
// so the words get the freedom. Measured on the artist's own clip with three
// asks they would plausibly type, the supplement's effect on the output runs
// 0.0067 at 0.55, 0.0079 at 0.60 and 0.0162 at 0.70, while the coverage
// envelope against the source runs 0.922 / 0.876 / 0.622. 0.60 buys almost
// nothing, and 0.70 is the top rung that exists at all: BasicScheduler
// quantises to int(steps/denoise) steps, so 0.70 and 0.80 are the same
// schedule at 4 steps and come back byte-identical.
assert.equal(api.strengthToDenoise(api.SUPPLEMENT_STRENGTH), 0.7)
assert.equal(api.defaultStrengthFor('ice', 'once', true), api.SUPPLEMENT_STRENGTH)
assert.equal(api.defaultStrengthFor('pixel', 'once', true), api.SUPPLEMENT_STRENGTH,
  'a grainy preset is raised to the same rung, not above it')
assert.equal(api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'ice', supplement: '中间长出一朵花',
})[6].inputs.denoise, 0.7, 'the graph has to move with it')
assert.equal(api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'ice', supplement: '   ',
})[6].inputs.denoise, 0.55, 'whitespace is not a supplement')
// A loop is the exception and not by choice: the freedom the words want is the
// freedom that destroys a loop. On the border-light template the envelope runs
// 0.834 at 0.55 and 0.289 at 0.60, while the supplement only moves the output
// from 0.0085 to 0.0174.
assert.equal(api.defaultStrengthFor('neon', 'loop', true), api.LOOP_MAX_STRENGTH)
assert.equal(api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'neon', lifecycle: 'loop', supplement: '加点星星',
})[6].inputs.denoise, 0.55)
// The slider still wins over both.
assert.equal(api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'ice', supplement: '加点星星', strength: 20,
})[6].inputs.denoise, 0.55)
assert.equal(api.defaultStrengthFor('ice'), api.DEFAULT_STRENGTH)
assert.equal(api.defaultStrengthFor('nope'), api.DEFAULT_STRENGTH)
assert.ok(api.defaultStrengthFor('pixel') > api.DEFAULT_STRENGTH)
const auto = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'pixel' })
assert.equal(auto[6].inputs.denoise, api.strengthToDenoise(api.defaultStrengthFor('pixel')))

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

// --- the clip's own length ------------------------------------------------
// H3 samples 17k+5 frames. The v2v node used to walk DOWN to that grid, which
// is invisible for the built-in templates (39 frames, already on it) and
// destroys anything else: a 0.7s clip resamples to 17 frames at 24fps and 17
// walks all the way down to 5, so the artist got 0.2s of their effect. The
// whole clip is resampled into the NEAREST grid point now, and the output
// plays at a rate that spans the source's duration.
assert.equal(api.gridFrameCount(39), 39)
assert.equal(api.gridFrameCount(17), 22, '17 rounds up, it does not collapse to 5')
assert.equal(api.gridFrameCount(25), 22)
assert.equal(api.gridFrameCount(31), 39)
assert.equal(api.gridFrameCount(1), 5, 'five is the floor')
assert.equal(api.gridFrameCount(400), 73, 'and 73 the ceiling')
for (const count of [5, 22, 39, 56, 73]) assert.equal(count % 17, 5, 'the grid is 17k+5')
const short = api.timingFor(0.7)
assert.equal(short.length, 22)
assert.ok(Math.abs(short.length / short.fps - 0.7) < 0.01, 'a 0.7s clip stays 0.7s')
const template = api.timingFor(1.625)
assert.equal(template.length, 39)
assert.equal(Math.round(template.fps), 24, 'the built-in templates are untouched')
const fallback = api.timingFor(0)
assert.equal(fallback.length, 39, 'no duration falls back to the old default')
assert.equal(fallback.fps, 24)
const timed = api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'ice', durationSec: 0.7 })
assert.equal(timed[33].inputs.length, 22, 'the init latent is asked for the whole clip')
assert.equal(timed[5].inputs.length, 22)
assert.equal(timed[34].inputs.fps, api.OUTPUT_FPS,
  'the frame resampler stays at the model rate, or it would duplicate frames')
assert.ok(Math.abs(timed[13].inputs.fps - 22 / 0.7) < 0.01, 'the writer plays them back over 0.7s')

// --- plain graph --------------------------------------------------------
const plain = api.buildWorkflow({ sourceVideo: 'source.mp4', attribute: 'venom', strength: 70, seed: 7 })
api.validateWorkflow(plain)
assert.equal(plain[5].class_type, 'MiniMaxH3ImageToVideo', 'no references means the t2v node')
assert.equal(plain[6].inputs.denoise, 0.8)
assert.equal(json(plain[10].inputs.latent_image), json(['33', 0]), 'sampler must start from the source latent')
assert.equal(plain[33].inputs.desaturate, 1, 'the init is desaturated by default')
assert.equal(json(plain[33].inputs.images), json(['32', 0]))
// ...and then painted in the preset's own colour. Colour is what a denoise low
// enough to follow the source cannot rebuild - the same looping fountain reads
// 0.077 saturation at 0.55 off a grey init and 0.569 off a tinted one - so the
// palette arrives with the init and denoise is left to buy following alone.
assert.equal(plain[33].inputs.tint, api.getPreset('venom').accent)
for (const preset of api.ATTRIBUTE_PRESETS) {
  assert.match(preset.accent, /^#[0-9a-f]{6}$/i, preset.id + ' needs a tintable accent')
  assert.equal(api.buildWorkflow({ sourceVideo: 's.mp4', attribute: preset.id })[33].inputs.tint,
    preset.accent, preset.id + ' must hand its own colour to the init')
}
assert.equal(api.buildWorkflow({
  sourceVideo: 's.mp4', attribute: 'venom', tint: '#123456',
})[33].inputs.tint, '#123456', 'the tint stays overridable')
// A reference image replaces the preset, and its palette is in the picture
// rather than in a hex the graph knows, so that path keeps the grey init.
assert.equal(api.buildWorkflow({
  sourceVideo: 's.mp4', referenceImage: 'look.png',
})[33].inputs.tint, '', 'a reference image leaves the init grey')
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

// A loop's motion is its content, so it never gets more than the default,
// however much freedom its material asks for. Measured on the border-light
// template: pulse-following went 0.54 at denoise 0.85, 0.69 at 0.70 and 0.94
// at 0.55.
assert.equal(api.LOOP_MAX_STRENGTH, api.DEFAULT_STRENGTH)
assert.equal(api.strengthToDenoise(api.LOOP_MAX_STRENGTH), 0.55)
assert.equal(api.defaultStrengthFor('gold', 'loop'), api.LOOP_MAX_STRENGTH)
assert.equal(api.defaultStrengthFor('pixel', 'loop'), api.LOOP_MAX_STRENGTH,
  'the cap applies even to presets that have to redraw the element')
assert.ok(api.defaultStrengthFor('pixel', 'once') > api.LOOP_MAX_STRENGTH,
  'a one-shot keeps its preset default')
// This used to be two caps, the looser one for radially symmetric loops -
// which follow at 0.55 either way (envelope 0.99 for a fountain) but used to
// come back grey there: venom measured 0.077 saturation against its source's
// 0.644. That was the init being grey, not the denoise being wrong, and the
// tint fixed it at the source - 0.569 at the same 0.55 - so the archetype no
// longer changes the cap.
for (const archetype of ['frame', 'trail', 'fountain', 'rays', 'swirl', 'ring']) {
  assert.equal(api.buildWorkflow({
    sourceVideo: 's.mp4', attribute: 'venom', lifecycle: 'loop', shapeArchetype: archetype,
  })[6].inputs.denoise, 0.55, archetype + ' loops at the following denoise')
}

assert.equal(api.buildWorkflow({ sourceVideo: 's.mp4', attribute: 'thunder', lifecycle: 'loop' })[6]
  .inputs.denoise, 0.55)
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
