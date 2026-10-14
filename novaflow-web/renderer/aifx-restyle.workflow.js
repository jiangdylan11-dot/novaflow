(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxRestyleWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // AI 特效 material restyle on MiniMax H3.
  //
  // The source clip enters as the sampler's INIT LATENT, not as reference
  // conditioning. That distinction is the whole feature: reference latents are
  // re-injected at every sampling step and never denoised, so they pin the
  // source silhouette no matter how the prompt is worded, while an init latent
  // loses its grip as denoise rises. `denoise` is therefore the 风格强度 slider.
  //
  // The init is desaturated first (inside NovaFlowH3VideoToVideoLatent). Colour
  // is the lowest-frequency content in a latent and survives a high denoise, so
  // a colour init hands the restyle the source palette - a lightning prompt on a
  // fire init comes back gold. Desaturated, the palette comes from the prompt.
  //
  // ...and is then painted back in the PRESET's colour. That same survival is
  // what makes the tint worth doing: colour is the one thing a denoise low
  // enough to follow the source cannot rebuild, so handing it over in the init
  // pays for the denoise the following needs. Without it the two pulled against
  // each other and 0.70 was the compromise; see 风格强度 below.

  const MODELS = Object.freeze({
    unet: 'Minimax_H3\\10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors',
    clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    videoVae: 'minimax_h3_video_vae_fp16.safetensors',
    audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  })

  const DEFAULT_PREFIX = 'video/NovaFlow_AIFX'
  const OUTPUT_FPS = 24
  const DEFAULT_STEPS = 4
  const RESOLUTION_MULTIPLE = 32
  const MIN_STRENGTH = 0
  const MAX_STRENGTH = 100
  // 风格强度 buys material at the cost of following, and 0.55 is where the
  // source's own evolution survives. Measured as the coverage envelope
  // against the source, averaged over the three clips an artist brought in
  // that read as 'nothing like my effect': 0.94 at 0.55 against 0.80 at
  // 0.70, and on the worst of them 0.92 against 0.54 - at 0.70 that clip's
  // restyle was still growing when the source had already cleared. The
  // built-in templates hid this because they follow at 0.70 too (0.92 for
  // the crescent); a small element in a big black frame does not.
  //
  // 0.55 used to be unaffordable. The init is desaturated on purpose and a
  // low denoise is not enough freedom to put a palette back, so the colour
  // drained out: a looping venom fountain came out at 0.077 saturation
  // against its source's 0.644, which is to say grey, and violet lightning
  // at 0.087 against 0.320 at 0.70. That is what the old 0.70 default was
  // paying for. The init now carries the preset's own accent instead of
  // grey (see `tint`), which puts the colour in ahead of the sampler: the
  // same fountain reads 0.569 and the same lightning 0.308, both at 0.55.
  // Colour and following stopped competing, so the default is now set for
  // following alone.
  const DEFAULT_STRENGTH = 20
  const MIN_DENOISE = 0.45
  const MAX_DENOISE = 0.95
  // A looping element's motion IS its content, so freeing the latent frees
  // the motion with it and a loop never gets more than the default, however
  // much freedom its material asks for. This used to be two caps - a tight
  // 0.55 for a travelling pulse and a loose 0.70 for anything radial - and
  // the loose one existed only to keep the radial ones from going grey,
  // which is the job the tint now does. One cap covers both: measured at
  // 0.55 with a tinted init, the border light's envelope reads 0.834
  // against 0.722 grey, and the fountain's 0.989.
  const LOOP_MAX_STRENGTH = DEFAULT_STRENGTH
  // A material carried by GRAIN rather than by surface needs one step more
  // than the default, and says so in its own `strength`. Rendering all 54 on
  // the crescent at 0.55 found exactly four: 像素 came back as a smooth gold
  // arc with a few stray blocks, 沙尘 as a smooth sandy crescent with no dust,
  // 星辰 as a plain white crescent with the nebula gone, and 彩虹 with its
  // bands blurred into a haze. All four are back at 0.60 and none of them
  // needs the 0.70-0.75 they used to carry. The cliff is the ceiling: swept on
  // the symbol-tile template, the coverage envelope against the source
  // reads 0.984 at denoise 0.70, 0.78 and 0.80, then 0.018 at 0.82 and
  // 0.85 - the element stops being a restyle of the source and becomes an
  // unrelated effect. The slider still goes to 0.95 if that is what the
  // artist wants; this only caps the DEFAULT.
  const MAX_DEFAULT_STRENGTH = 70
  // 提示词补充 is the artist saying, in words, that they want something the
  // preset does not do - so when the box has text in it the words get the
  // freedom instead of the following. Measured on the artist's own clip with
  // three asks they would plausibly type (the ring breaks into shards / it
  // becomes a vortex / a flower grows in the middle), the supplement's effect
  // on the output goes 0.0067 at 0.55 to 0.0079 at 0.60 to 0.0162 at 0.70,
  // while the coverage envelope against the source goes 0.922 / 0.876 / 0.622.
  // 0.60 buys almost nothing; 0.70 is where the words actually take over. It
  // is also the top rung that exists: BasicScheduler quantises denoise to
  // int(steps/denoise) sampling steps, so at 4 steps 0.70 and 0.80 are the
  // same schedule and produce the same bytes.
  const SUPPLEMENT_STRENGTH = 50
  // There is no 参考图权重 knob, and not for want of looking. The DiT does
  // expose one (visual_cond_noise_aug mixes noise into the condition rows and
  // every ref2v run has silently used its 0.999 default), but a reference
  // STILL does not reach the model only that way: MiniMaxH3ReferenceToVideo
  // also hands the picture to the qwen3vl text encoder as vision tokens, and
  // that path has no weight. Measured on a copper reference, the material came
  // back the same at 0.999, 0.95, 0.9, 0.8, 0.7, 0.6, 0.3 and 0.05, and the
  // same again with the picture itself faded 60% and 30% towards grey. What
  // does move a reference run is 风格强度, the same slider as everywhere else.

  // A loop is the exception, and not by choice: its motion IS its content, so
  // the freedom a supplement wants is the same freedom that destroys it. On
  // the border-light template the envelope against the template reads 0.834 at
  // 0.55 and 0.289 at 0.60, while the supplement only moves the output from
  // 0.0085 to 0.0174. A loop therefore keeps the following cap either way.
  function defaultStrengthFor(id, lifecycle, hasSupplement) {
    const preset = PRESET_BY_ID.get(String(id || ''))
    const stored = preset && preset.strength != null ? preset.strength : DEFAULT_STRENGTH
    const wanted = hasSupplement ? Math.max(stored, SUPPLEMENT_STRENGTH) : stored
    const strength = Math.min(wanted, MAX_DEFAULT_STRENGTH)
    return lifecycle === 'loop' ? Math.min(strength, LOOP_MAX_STRENGTH) : strength
  }

  // Shared framing. Every preset is judged against the same shot description so
  // the only thing that varies between attributes is the material.
  const SHOT_TAIL = [
    'Static locked-off camera. No character, no weapon, no hands, no environment, no text, no logo.',
    'Only the effect on solid black. 2D cel-shaded game VFX element, high contrast,',
    'flat pure black background.',
  ].join(' ')

  const LEAD = 'Game VFX element isolated on a pure solid black background. A single anime-style'

  // The init latent does not survive the denoise the material needs, so the
  // silhouette has to be NAMED. Measured at a fixed seed and denoise 0.70:
  // "the effect holds its silhouette" gave a shapeless drip (IoU 0.187 against
  // the source), while naming it a crescent gave a crescent (0.356). A concrete
  // noun works; a generic reminder does not.
  const DEFAULT_SHAPE = 'slash arc'
  // A one-shot element is told how it ends; a looping one is told it does not.
  // The detector supplies the clause, so the wording lives next to the
  // detection; this is the fallback when nothing is passed.
  const DEFAULT_LIFECYCLE_CLAUSE = 'appears, peaks, then breaks up and clears'

  function shapeNoun(shape) {
    // The clause before the first comma is the name; the rest is detail.
    return String(shape).split(',')[0].trim() || DEFAULT_SHAPE
  }

  function shapeSentence(shape, clause) {
    return `The ${shapeNoun(shape)} KEEPS the same silhouette the whole time and `
      + `${clause || DEFAULT_LIFECYCLE_CLAUSE}.`
  }

  // Every preset here has been render-checked end to end on the crescent
  // template; `verified` marks that, not a guarantee on every source.
  //
  // Materials are separated by BEHAVIOUR, not by colour. Naming a colour gets a
  // recoloured copy of the source; naming how the thing sags, shatters or
  // splashes is what makes the model rebuild the silhouette. Each preset also
  // says what it must not be, because an unconstrained material borrows its
  // neighbour's break-up.
  //
  // `accent` is not decoration: it is painted onto the init, so it has to be
  // the colour the material actually reads as. `strength` is the default
  // denoise, and only a material that has to REDRAW the element rather than
  // resurface it is allowed above DEFAULT_STRENGTH.
  const ATTRIBUTE_PRESETS = Object.freeze([
    // 元素
    Object.freeze({
      id: 'fire', group: '元素', strength: 20, label: '火焰', accent: '#ff7a2f', verified: true,
      name: 'FIRE', material: 'made of blazing orange and yellow flame with a white-hot inner edge and licking flame tongues '
        + 'along its outer edge, shedding rising sparks. Hot gas that RISES, NO dripping, NO shards, NO '
        + 'droplets.',
      breakup: 'It BURNS AWAY, thinning down to a glowing ember line and going out.',
    }),
    Object.freeze({
      id: 'lava', group: '元素', strength: 20, label: '熔岩', accent: '#ff5a1f', verified: true,
      name: 'MOLTEN LAVA', material: 'made of thick glowing molten rock, incandescent yellow-orange in its cracks and darkening to a '
        + 'crusted black skin on its surface, heavy and viscous, tearing open here and there to show the '
        + 'glow inside. Molten stone, NOT a gas flame, NO crystal facets, NO thin spray.',
      breakup: 'It SAGS apart and sheds slow fat droplets that fall and splat.',
    }),
    Object.freeze({
      id: 'ice', group: '元素', strength: 20, label: '冰霜', accent: '#9fe3f5', verified: true,
      name: 'ICE', material: 'made of hard translucent pale cyan crystal with flat polygonal facets, sharp straight edges, '
        + 'internal fracture lines and a cold glassy specular sheen, trailing cold white frost mist and '
        + 'fine snow grains. Rigid and brittle, NO dripping, NO sticky strands, NO round droplets, NO '
        + 'flame.',
      breakup: 'It SHATTERS into sharp angular fragments that fly outward in straight lines.',
    }),
    Object.freeze({
      id: 'water', group: '元素', strength: 20, label: '流水', accent: '#4fd1c5', verified: true,
      name: 'WATER', material: 'made of a clear TRANSPARENT turquoise sheet of water with visible internal swirls and caustics, '
        + 'a thick white foam edge and thin translucent membranes. Thin flowing liquid, NOT opaque, NOT '
        + 'sticky, NO stringy strands, NO crystal facets, NO shards, NO flame.',
      breakup: 'It SPLASHES into ROUND droplets and beads that arc outward and fall, trailing fine spray.',
    }),
    Object.freeze({
      id: 'thunder', group: '元素', strength: 20, label: '雷电', accent: '#8f7bff', verified: true,
      name: 'LIGHTNING', material: 'built ENTIRELY from jagged zigzag bolt segments with sharp angular kinks and many FORKED '
        + 'filaments branching off along the whole arc, a searing white core with electric blue and violet '
        + 'fringe, a crackling halo and popping sparks. The forked bolts KEEP re-striking and reshaping in '
        + 'EVERY frame and never settle into a smooth continuous arc. Electrical discharge, NOT a smooth '
        + 'glowing ribbon, NO dripping, NO shards, NO droplets, NO flame.',
      breakup: 'It SNAPS OUT, the last filaments flickering away.',
    }),
    Object.freeze({
      id: 'wind', group: '元素', strength: 20, label: '疾风', accent: '#cfe8d4', verified: true,
      name: 'WIND', material: 'made of thin translucent air blades and pale white-green vortex ribbons spiralling around it, '
        + 'with razor-sharp leading edges, swirling dust motes and torn leaves caught in the current, and '
        + 'visible pressure lines. Airy and nearly weightless, NOT solid, NO dripping, NO shards, NO '
        + 'droplets, NO flame.',
      breakup: 'It DISPERSES by unravelling into thinning spiral wisps that spin away.',
    }),
    Object.freeze({
      id: 'rock', group: '元素', strength: 20, label: '岩石', accent: '#a98c6b', verified: true,
      name: 'ROCK', material: 'made of broken grey-brown stone slabs with chipped edges, visible strata and a dry matte '
        + 'surface, NOT glowing, shedding thin brown dust. Dry opaque stone, NO glow, NO liquid, NO '
        + 'droplets, NO flame.',
      breakup: 'It CRUMBLES: heavy blocks tumble away under their own weight, grinding into gravel and thick '
        + 'dust clouds.',
    }),
    Object.freeze({
      id: 'sand', group: '元素', strength: 30, label: '沙尘', accent: '#e2c08d', verified: true,
      name: 'SAND', material: 'made of countless fine pale-gold grains streaming together in sheets, their edges blurring into '
        + 'drifting dust haze. Granular and dry, NO solid body, NO droplets, NO shards, NO flame.',
      breakup: 'It POURS AWAY, the grains streaming off on the air and settling.',
    }),
    Object.freeze({
      id: 'smoke', group: '元素', strength: 20, label: '烟雾', accent: '#b8bcc2', verified: true,
      name: 'THICK SMOKE', material: 'made of dense billowing grey-white smoke with soft rolling curls, dark shaded folds and a '
        + 'lighter lit rim, tumbling slowly and thinning at its edges. Soft opaque vapour, NOT solid, NO '
        + 'glow from within, NO droplets, NO shards, NO flame.',
      breakup: 'It THINS OUT, the curls unrolling and dissolving into haze.',
    }),
    Object.freeze({
      id: 'snow', group: '元素', strength: 20, label: '雪花', accent: '#eaf6ff', verified: true,
      name: 'SNOW', material: 'made of soft white snow and drifting six-pointed snowflakes packed together, with powdery edges, '
        + 'a cold blue shadow side and glittering ice dust blowing off it. Powder and flakes, NOT a solid '
        + 'crystal block, NO dripping, NO flame, NO glow.',
      breakup: 'It BLOWS AWAY as a flurry of loose flakes and powder.',
    }),
    Object.freeze({
      id: 'bubble', group: '元素', strength: 20, label: '泡泡', accent: '#9fd8ff', verified: true,
      name: 'SOAP BUBBLES', material: 'made of clustered transparent soap bubbles of different sizes, each with a thin iridescent '
        + 'rainbow film, a bright crescent highlight and a clear see-through middle, some wobbling as they '
        + 'float. Thin round bubbles, NOT solid, NO shards, NO flame, NO smoke.',
      breakup: 'It POPS, bubble by bubble, each vanishing with a tiny spray of droplets.',
    }),
    Object.freeze({
      id: 'moltengold', group: '元素', strength: 20, label: '熔金', accent: '#ffb028', verified: true,
      name: 'MOLTEN GOLD', material: 'made of thick glowing molten gold, bright yellow-white at its core and deep amber at its skin, '
        + 'heavy and syrupy, pouring and stretching in smooth mirror-glossy sheets with round gold beads '
        + 'shedding off. Liquid metal at heat, NOT a flame, NO crystal facets, NO frost.',
      breakup: 'It POURS DOWN in heavy glossy streams and rounded drops that fall away.',
    }),

    // 能量
    Object.freeze({
      id: 'holy', group: '能量', strength: 20, label: '圣光', accent: '#ffd98a', verified: true,
      name: 'HOLY LIGHT', material: 'made of blazing white-gold radiance with hard-edged crisp light shards layered along it, thin '
        + 'concentric halo rings, long god-ray streaks and drifting golden feathers and motes. Pure light, '
        + 'NOT liquid, NOT crystal, NO dripping, NO droplets, NO stringy strands.',
      breakup: 'It FADES by blooming outward into soft radiance.',
    }),
    Object.freeze({
      id: 'shadow', group: '能量', strength: 20, label: '暗影', accent: '#a05bd6', verified: true,
      // "Silhouette" and "unlit" both came back as a bright magenta arc. Calling
      // it a TEAR the light falls into is what finally produced a dark body.
      name: 'VOID', material: 'rendered as a TEAR IN SPACE: the body is a hole of pure black that the light falls into, framed '
        + 'by a thin cold violet edge and a faint purple heat-haze distortion just outside it, shedding '
        + 'drifting black flecks. Only the outline and the haze are visible; the inside stays empty black. '
        + 'NOT a glowing blade, NOT bright, NO white core.',
      breakup: 'It DISSOLVES, fraying into wisping black tatters.',
    }),
    Object.freeze({
      id: 'arcane', group: '能量', strength: 20, label: '秘法', accent: '#7aa2ff', verified: true,
      name: 'ARCANE MAGIC', material: 'made of glowing violet-blue geometric glyphs, rune rings and thin construction lines that snap '
        + 'into place, layered over a soft magical haze with drifting sigil fragments. Drawn geometry and '
        + 'light, NOT liquid, NOT crystal, NO dripping, NO droplets.',
      breakup: 'It RESOLVES: the glyphs rotate, lock, then break apart into scattered runes.',
    }),
    Object.freeze({
      id: 'plasma', group: '能量', strength: 20, label: '等离子', accent: '#ff6ad5', verified: true,
      name: 'PLASMA', material: 'made of superheated ionised gas, a searing white core wrapped in unstable magenta and cyan '
        + 'tongues that writhe and flicker violently, ringed by a faint magnetic halo and spitting bright '
        + 'filaments. Ionised gas, NO solid body, NO droplets, NO shards.',
      breakup: 'It DESTABILISES and blows apart into flickering wisps.',
    }),
    Object.freeze({
      id: 'soul', group: '能量', strength: 20, label: '幽魂', accent: '#8fe3c8', verified: true,
      name: 'SOUL', material: 'made of pale ghostly green-blue wisps, translucent and smoke-like, with faint hollow face and '
        + 'skull shapes forming and dissolving inside it and thin tails streaming off. Translucent vapour, '
        + 'NOT solid, NOT liquid, NO droplets, NO shards, NO flame.',
      breakup: 'It DRIFTS UPWARD and thins into nothing.',
    }),
    Object.freeze({
      id: 'star', group: '能量', strength: 30, label: '星辰', accent: '#9db4ff', verified: true,
      name: 'COSMIC STARLIGHT', material: 'made of deep indigo and magenta nebula cloud packed with pinpoint stars, with drifting cosmic '
        + 'dust and four-point star twinkles firing at random. Cosmic gas and points of light, NOT solid, '
        + 'NO droplets, NO shards, NO flame.',
      breakup: 'It DISPERSES into a slow spreading starfield.',
    }),
    Object.freeze({
      id: 'rainbow', group: '能量', strength: 30, label: '彩虹', accent: '#ff9ad5', verified: true,
      name: 'RAINBOW LIGHT', material: 'made of a smooth spectrum band, red through orange, yellow, green, blue to violet in clean '
        + 'parallel stripes running along its length, softly glowing with a pale mist at its edges. Banded '
        + 'coloured light, NOT a single colour, NO droplets, NO shards, NO flame.',
      breakup: 'It FADES, the stripes separating and dissolving one colour at a time.',
    }),
    Object.freeze({
      id: 'aurora', group: '能量', strength: 20, label: '极光', accent: '#5df2b8', verified: true,
      name: 'AURORA', material: 'made of tall rippling curtains of green and teal light with magenta and violet along their lower '
        + 'hem, folded like hanging drapery, slowly waving and shimmering with vertical streaks. Sheer '
        + 'waving light curtains, NOT solid, NO droplets, NO shards, NO flame.',
      breakup: 'It DIMS, the curtains folding thinner and fading into the dark.',
    }),
    Object.freeze({
      id: 'glitter', group: '能量', strength: 20, label: '闪粉', accent: '#ffe27a', verified: true,
      name: 'GLITTER SPARKLE', material: 'made of a dense cloud of tiny glittering particles, gold, silver and white, each flashing as a '
        + 'four-point star twinkle at random, packed thick at the core and thinning outward. Countless '
        + 'separate sparkling points, NOT one solid body, NO liquid, NO flame, NO smoke.',
      breakup: 'It SCATTERS into drifting twinkles that wink out one by one.',
    }),
    Object.freeze({
      id: 'ghostfire', group: '能量', strength: 20, label: '鬼火', accent: '#b36bff', verified: true,
      name: 'CURSED VIOLET FLAME', material: 'made of cold violet and deep purple flame with a pale lavender core and black smoke curling off '
        + 'its tips, its tongues licking upward and flickering unnaturally slowly, shedding tiny purple '
        + 'embers. Cold eerie fire, NOT orange, NO dripping, NO shards, NO droplets.',
      breakup: 'It GUTTERS OUT, the last violet tongues shrinking to embers.',
    }),

    // 物质
    Object.freeze({
      id: 'venom', group: '物质', strength: 20, label: '毒液', accent: '#bcd42a', verified: true,
      name: 'VENOM', material: 'made of thick OPAQUE chartreuse and acid-green slime with a wet glossy specular sheen and dark '
        + 'green shadows. Bubbles swell and pop across its surface, and it SAGS heavily under gravity, '
        + 'pulling long stringy strands, wrapped in a sickly yellow-green corrosive vapour. Sticky liquid, '
        + 'NOT glowing, NOT transparent, NOT on fire, NO crystal facets.',
      breakup: 'It DRIPS AWAY in heavy falling globs that stretch into thin threads before they snap.',
    }),
    Object.freeze({
      id: 'blood', group: '物质', strength: 20, label: '鲜血', accent: '#c0392b', verified: true,
      name: 'BLOOD', material: 'made of thick opaque crimson liquid with a dark wine-red core and a wet glossy highlight, NOT '
        + 'glowing. Opaque liquid, NO glow, NO crystal facets, NO flame.',
      breakup: 'It FLICKS and SPLATTERS outward into teardrop droplets and long thin streaks, then runs downward '
        + 'leaving trails.',
    }),
    Object.freeze({
      id: 'metal', group: '物质', strength: 20, label: '金属', accent: '#c9d1d9', verified: true,
      name: 'METAL', material: 'made of polished steel plates and blades with hard mirror specular streaks, cold grey '
        + 'reflections and bevelled edges. Solid reflective metal, NO liquid, NO droplets, NO glow from '
        + 'within, NO flame.',
      breakup: 'It BREAKS into clean straight-edged metal shards that spin away, throwing showers of orange '
        + 'grinding sparks.',
    }),
    Object.freeze({
      id: 'crystal', group: '物质', strength: 20, label: '水晶', accent: '#d8a7ff', verified: true,
      name: 'GEM CRYSTAL', material: 'made of clear faceted gemstone with sharp flat facets that split the light into prismatic '
        + 'rainbow caustics, with bright specular glints at every edge. Hard transparent gem, NO dripping, '
        + 'NO strands, NO frost mist, NO flame.',
      breakup: 'It FRACTURES into sharp glittering shards that scatter, each one still refracting.',
    }),
    Object.freeze({
      id: 'nature', group: '物质', strength: 20, label: '自然', accent: '#7fd18a', verified: true,
      name: 'NATURE', material: 'made of woven green vines and creepers that grow and curl, studded with fresh leaves and small '
        + 'flower petals, with soft pollen motes floating around them. Living plant matter, NO glow, NO '
        + 'liquid, NO shards, NO flame.',
      breakup: 'It WITHERS, leaves and petals peeling off and drifting down.',
    }),
    Object.freeze({
      id: 'bone', group: '物质', strength: 20, label: '骨刺', accent: '#e8e0cd', verified: true,
      name: 'BONE', material: 'made of pale ivory bone spikes and jagged plates with hairline cracks and a dry chalky surface, '
        + 'NOT glowing. Dry hard bone, NO glow, NO liquid, NO droplets, NO flame.',
      breakup: 'It SNAPS apart into splintered fragments that tumble away, shedding fine chalk dust.',
    }),
    Object.freeze({
      id: 'jade', group: '物质', strength: 20, label: '翡翠', accent: '#3fbf8f', verified: true,
      name: 'JADE', material: 'made of polished translucent green jade with soft milky veins, a smooth waxy sheen and gently '
        + 'rounded carved edges, light glowing faintly through its thinner parts. Solid carved stone, NOT a '
        + 'bright light, NO liquid, NO flame, NO sharp glass splinters.',
      breakup: 'It CRACKS and breaks into rounded polished chunks that tumble away.',
    }),
    Object.freeze({
      id: 'diamond', group: '物质', strength: 20, label: '钻石', accent: '#e8f4ff', verified: true,
      name: 'DIAMOND', material: 'made of clear brilliant-cut diamonds packed together, every facet throwing hard white flashes '
        + 'and small rainbow fire, with sharp bright edges and star-shaped specular glints. Hard clear '
        + 'gems, NOT coloured glass, NO liquid, NO flame, NO frost mist.',
      breakup: 'It SHATTERS into glittering brilliant fragments that spin away still flashing.',
    }),
    Object.freeze({
      id: 'glass', group: '物质', strength: 20, label: '玻璃', accent: '#cfeee6', verified: true,
      name: 'GLASS', material: 'made of thin clear window glass panes with pale green-tinted edges, straight bright reflections '
        + 'sliding across their flat surfaces and hairline cracks spreading through them. Flat transparent '
        + 'panes, NOT faceted gems, NO liquid, NO flame, NO frost.',
      breakup: 'It SHATTERS into flat sharp splinters that fall and tumble, glinting.',
    }),
    Object.freeze({
      id: 'bronze', group: '物质', strength: 20, label: '青铜', accent: '#a67c3d', verified: true,
      name: 'ANCIENT BRONZE', material: 'made of cast bronze with a dark green-brown patina, raised engraved patterns and worn golden '
        + 'highlights on its ridges, heavy and dull with only small hard glints. Dull old metal, NOT '
        + 'polished gold, NOT glowing, NO liquid, NO flame.',
      breakup: 'It CRACKS apart into heavy corroded plates that drop away with dust.',
    }),
    Object.freeze({
      id: 'silk', group: '物质', strength: 20, label: '绸带', accent: '#e6413f', verified: true,
      name: 'SILK RIBBON', material: 'made of long flowing red and gold silk ribbons, satin-glossy with soft folds and a bright sheen '
        + 'along each curve, rippling and billowing as if in wind. Soft cloth, NOT stiff, NOT liquid, NO '
        + 'shards, NO flame, NO smoke.',
      breakup: 'It UNRAVELS, the ribbons loosening and floating away.',
    }),
    Object.freeze({
      id: 'petal', group: '物质', strength: 20, label: '花瓣', accent: '#ffb3c6', verified: true,
      name: 'FLOWER PETALS', material: 'made of hundreds of soft pink cherry-blossom petals packed together, each a small curved '
        + 'teardrop with a darker base, catching the light on their glossy faces as they flutter. Many '
        + 'separate light petals, NOT one solid body, NO liquid, NO flame, NO shards.',
      breakup: 'It DRIFTS APART, the petals fluttering and spiralling down.',
    }),
    Object.freeze({
      id: 'feather', group: '物质', strength: 20, label: '羽毛', accent: '#f6f0dc', verified: true,
      name: 'FEATHERS', material: 'made of layered soft white and gold feathers with fine barbs and downy edges, overlapping like a '
        + 'wing, with light catching their glossy shafts and small down fluff floating off. Soft plumage, '
        + 'NOT liquid, NO shards, NO flame, NO smoke.',
      breakup: 'It SHEDS its feathers, which drift and float slowly down.',
    }),
    Object.freeze({
      id: 'chocolate', group: '物质', strength: 20, label: '巧克力', accent: '#7a4a2b', verified: true,
      name: 'CHOCOLATE', material: 'made of thick glossy melted milk chocolate, smooth and syrupy, with soft rounded folds, a bright '
        + 'sliding highlight and darker fudge shadows, dragging into slow strands and drops. Sweet heavy '
        + 'liquid, NOT glowing, NOT transparent, NO shards, NO flame.',
      breakup: 'It DRIPS DOWN in slow thick ribbons and rounded drops.',
    }),
    Object.freeze({
      id: 'gear', group: '物质', strength: 20, label: '机械', accent: '#c99a45', verified: true,
      name: 'CLOCKWORK BRASS', material: 'made of interlocking brass gears, cogs, pistons and riveted plates, polished brass and copper '
        + 'with dark oil grooves, the cog wheels visibly turning and meshing. Hard mechanical metal parts, '
        + 'NOT liquid, NO flame, NO frost, NO smooth blob.',
      breakup: 'It COMES APART, the cogs and plates unbolting and tumbling away.',
    }),

    // 界面
    Object.freeze({
      id: 'gold', group: '界面', strength: 20, label: '黄金', accent: '#ffc247', verified: true,
      name: 'POLISHED GOLD', material: 'made of polished yellow gold with mirror specular highlights racing across bevelled embossed '
        + 'edges, warm amber reflections and deep bronze shadows, studded with small round coins and gold '
        + 'flakes. Solid reflective metal, NO liquid, NO dripping, NO flame, NO frost.',
      breakup: 'It SCATTERS: the coins and plates tumble and spin away, each one catching a hard glint.',
    }),
    Object.freeze({
      id: 'neon', group: '界面', strength: 20, label: '霓虹', accent: '#ff4fd8', verified: true,
      name: 'NEON TUBE', material: 'made of glowing glass neon tubing with a white-hot core and a saturated magenta and cyan bloom '
        + 'halo around it, clean rounded tube ends and a faint reflected spill. Lit glass tube, NO liquid, '
        + 'NO droplets, NO shards, NO smoke.',
      breakup: 'It FLICKERS like failing neon and cuts out.',
    }),
    Object.freeze({
      id: 'candy', group: '界面', strength: 20, label: '糖果', accent: '#ff8fb1', verified: true,
      name: 'CANDY JELLY', material: 'made of glossy translucent jelly in bright candy pink and mint, with soft rounded bulging edges, '
        + 'a bright white highlight blob on every surface and a warm sub-surface glow through it, dusted '
        + 'with sugar sparkle. Soft squishy jelly, NO sharp edges, NO shards, NO flame, NO smoke.',
      breakup: 'It WOBBLES and breaks into bouncy rounded blobs.',
    }),
    Object.freeze({
      id: 'confetti', group: '界面', strength: 20, label: '彩带', accent: '#7ad6ff', verified: true,
      name: 'FOIL CONFETTI', material: 'made of hundreds of small metallic foil rectangles and curled ribbon streamers in bright party '
        + 'colours, each flipping between a bright face and a dark edge as it turns. Many small separate '
        + 'pieces, NOT one connected body, NO liquid, NO flame.',
      breakup: 'It BURSTS apart, the pieces tumbling and fluttering outward and drifting down.',
    }),
    Object.freeze({
      id: 'chrome', group: '界面', strength: 20, label: '液金', accent: '#b9c7d6', verified: true,
      name: 'LIQUID CHROME', material: 'made of mirror-polished liquid metal with a sharp horizon reflection line across every curve, '
        + 'cold blue-grey highlights and perfectly smooth skin. Reflective liquid metal, NO flame, NO '
        + 'frost, NO shards, NO texture or grain.',
      breakup: 'It BEADS UP and separates into rounded mercury droplets that wobble apart.',
    }),
    Object.freeze({
      id: 'cash', group: '界面', strength: 20, label: '钞票', accent: '#7fcf7a', verified: true,
      name: 'BANKNOTES', material: 'made of a thick flurry of green paper banknotes and bills, each a flat rectangle with printed '
        + 'patterns, fluttering and flipping so they show bright faces and thin edges. Many flat paper '
        + 'rectangles, NOT metal coins, NO liquid, NO flame, NO glow.',
      breakup: 'It FLIES APART, the bills fluttering outward and drifting down.',
    }),
    Object.freeze({
      id: 'firework', group: '界面', strength: 20, label: '烟花', accent: '#ffcf5a', verified: true,
      name: 'FIREWORK SPARKS', material: 'made of dense trails of crackling firework sparks, gold, red and white, each spark a short '
        + 'bright streak with a tiny glowing head, packed together and spitting out along its whole length. '
        + 'Countless burning sparks, NOT a smooth flame, NO liquid, NO shards.',
      breakup: 'It BURSTS into a chrysanthemum of sparks that streak outward and fade.',
    }),
    Object.freeze({
      id: 'marquee', group: '界面', strength: 20, label: '跑马灯', accent: '#ffd27a', verified: true,
      name: 'MARQUEE BULBS', material: 'made of rows of small round warm-white and amber light bulbs set in a polished gold casing, the '
        + 'bulbs chasing on and off in sequence like a casino sign, each with a soft glow halo. Rows of '
        + 'small lit bulbs in a solid frame, NOT liquid, NO shards, NO flame, NO smoke.',
      breakup: 'It SWITCHES OFF, the bulbs going dark one after another.',
    }),

    // 画风
    Object.freeze({
      id: 'ink', group: '画风', strength: 20, label: '水墨', accent: '#d7d7d7', verified: true,
      name: 'INK WASH', material: 'painted as traditional Chinese ink wash: a sweeping brush stroke of luminous white and grey ink '
        + 'with a dry-brush split-hair edge, bleeding wet ink blooms and flicked ink spatter on paper '
        + 'texture. Monochrome calligraphic brushwork, NO colour, NO glow.',
      breakup: 'It DRIES and the ink bleeds out and fades.',
    }),
    Object.freeze({
      id: 'pixel', group: '画风', strength: 30, label: '像素', accent: '#f5c451', verified: true,
      name: 'PIXEL ART', material: 'drawn as retro 16-bit pixel art in chunky visible square pixels with a hard limited palette, '
        + 'stair-stepped aliased edges and dithering. Sprite-sheet pixel art, NO anti-aliasing, NO '
        + 'gradients, NO soft glow.',
      breakup: 'It BREAKS UP into individual square pixels that blink out one by one.',
    }),
    Object.freeze({
      id: 'hologram', group: '画风', strength: 20, label: '全息', accent: '#59e0ff', verified: true,
      name: 'HOLOGRAM', material: 'rendered as a cyan digital hologram: translucent wireframe and scanline bands with chromatic '
        + 'fringing, flickering interference glitches and blocky datamosh artefacts, drawn over a faint '
        + 'grid. Projected light and data, NOT solid, NOT liquid, NO droplets, NO shards.',
      breakup: 'It DROPS OUT, breaking into scanline slices and static before cutting to black.',
    }),
    Object.freeze({
      id: 'cartoon', group: '画风', strength: 20, label: '卡通', accent: '#ffa640', verified: true,
      name: 'CARTOON', material: 'drawn as flat cel-shaded cartoon art with bold clean black outlines, two-tone flat colour fills '
        + 'with a single hard-edged shade step, and a few stylised star and swirl shapes. Flat 2D cartoon '
        + 'shading, NO gradients, NO photoreal texture, NO soft glow.',
      breakup: 'It POPS out with a cartoon puff of stylised smoke shapes.',
    }),
    Object.freeze({
      id: 'sketch', group: '画风', strength: 20, label: '手绘', accent: '#d9d9d9', verified: true,
      name: 'PENCIL SKETCH', material: 'drawn as a rough hand-drawn pencil sketch, scribbled graphite hatching and cross-hatching in '
        + 'white and grey on black, with loose overlapping construction lines and a wobbly hand-drawn '
        + 'outline. Rough linework, NO colour, NO smooth shading, NO glow.',
      breakup: 'It RUBS OUT, the lines smudging and fading away.',
    }),
    Object.freeze({
      id: 'watercolor', group: '画风', strength: 20, label: '水彩', accent: '#f28ca0', verified: true,
      name: 'WATERCOLOUR', material: 'painted as loose wet watercolour, soft bleeding washes of coral, teal and violet with darker '
        + 'pigment pooling at the edges, granular paper texture and drips running down. Translucent layered '
        + 'paint, NO hard edges, NO glow, NO 3D shading.',
      breakup: 'It BLEEDS OUT, the washes spreading thin and drying away.',
    }),
    Object.freeze({
      id: 'papercut', group: '画风', strength: 20, label: '剪纸', accent: '#e0302f', verified: true,
      name: 'PAPER CUT', material: 'made as layered red paper-cut art, flat crimson card with lace-like cut-out patterns and clean '
        + 'scissor-cut edges, stacked in slightly offset layers that cast thin drop shadows. Flat cut '
        + 'paper, NO gradients, NO glow, NO liquid, NO flame.',
      breakup: 'It FOLDS AWAY, the paper layers curling and lifting off one by one.',
    }),
    Object.freeze({
      id: 'guochao', group: '画风', strength: 20, label: '国潮', accent: '#ff4d3d', verified: true,
      name: 'CHINESE AUSPICIOUS CLOUD', material: 'drawn as Chinese guochao ornament: curling stylised auspicious cloud scrolls in vermilion red '
        + 'and bright gold with thick gold outlines, spiral cloud tips and flat decorative fills. Flat '
        + 'ornamental line art, NO photoreal texture, NO liquid, NO shards, NO soft glow.',
      breakup: 'It UNCURLS, the cloud scrolls loosening and drifting apart.',
    }),
    Object.freeze({
      id: 'lowpoly', group: '画风', strength: 20, label: '低多边形', accent: '#4fc3c8', verified: true,
      name: 'LOW POLY', material: 'built from flat-shaded low-polygon triangles, hard faceted geometry with crisp straight edges, '
        + 'each triangle a slightly different flat shade of teal and orange. Faceted polygon mesh, NO '
        + 'smooth curves, NO gradients, NO glow, NO liquid.',
      breakup: 'It BREAKS into separate flat triangles that spin away.',
    }),
  ])

  const PRESET_BY_ID = new Map(ATTRIBUTE_PRESETS.map(preset => [preset.id, preset]))

  function clamp(value, min, max) {
    const number = Number(value)
    if (!Number.isFinite(number)) return min
    return Math.min(max, Math.max(min, number))
  }

  function strengthToDenoise(strength) {
    const value = clamp(strength, MIN_STRENGTH, MAX_STRENGTH)
    const ratio = (value - MIN_STRENGTH) / (MAX_STRENGTH - MIN_STRENGTH)
    return Math.round((MIN_DENOISE + ratio * (MAX_DENOISE - MIN_DENOISE)) * 1000) / 1000
  }

  function denoiseToStrength(denoise) {
    const value = clamp(denoise, MIN_DENOISE, MAX_DENOISE)
    const ratio = (value - MIN_DENOISE) / (MAX_DENOISE - MIN_DENOISE)
    return Math.round(MIN_STRENGTH + ratio * (MAX_STRENGTH - MIN_STRENGTH))
  }

  // 重画力度 in the panel is four positions, not 0-100. BasicScheduler turns
  // denoise into int(steps/denoise) sampling steps, so at 4 steps the whole
  // range holds five schedules (8/7/6/5/4) and everything between two of
  // them is the same bytes. The fifth is denoise 1.0's own schedule: the init
  // starts at full noise and the source never reaches the result, which is
  // not a restyle any more. Each level sits on its own schedule, and the
  // defaults above (20 / 30 / 50, with 70 on the same schedule as 50) all
  // land on one of them.
  const STRENGTH_LEVELS = Object.freeze([0, 20, 30, 50])

  function strengthLevel(strength) {
    const value = Number(strength)
    let level = 1
    STRENGTH_LEVELS.forEach((step, index) => { if (value >= step) level = index + 1 })
    return level
  }

  // H3 only samples 17k+5 frames. A clip that is not already on that grid used
  // to be cut down to the grid point BELOW it, which threw away the tail: a
  // 0.7s clip (17 frames at 24fps) collapsed to 5 frames, so two thirds of the
  // effect never reached the model. The whole clip is resampled into the
  // NEAREST grid point instead, and the output is played back at a frame rate
  // that spans the source's own duration, so the result lasts as long as the
  // material did.
  const FRAME_GRID = 17
  const FRAME_GRID_OFFSET = 5
  const MAX_GRID_FRAMES = 73
  // 5 is a grid point but it is not an effect - it is a third of a second at
  // best, and the whole reason the old rounding was a bug. Rounding to the
  // NEAREST point still lands on it for anything under 0.5625s (13.5 frames
  // at 24fps is the midpoint between 5 and 22), so the floor is 22. A clip
  // short enough to want fewer than that gets the extra frames and plays them
  // at up to 60fps; below 22/60 = 0.367s the result runs a little longer than
  // the source, which is the smaller of the two failures by a wide margin.
  const MIN_GRID_FRAMES = FRAME_GRID_OFFSET + FRAME_GRID

  function gridFrameCount(frames) {
    const wanted = Math.max(1, Math.round(Number(frames) || 0))
    const steps = Math.round((wanted - FRAME_GRID_OFFSET) / FRAME_GRID)
    const count = FRAME_GRID_OFFSET + Math.max(0, steps) * FRAME_GRID
    return Math.min(MAX_GRID_FRAMES, Math.max(MIN_GRID_FRAMES, count))
  }

  // The frame count and playback rate for a clip of `durationSec`, or the
  // 39-frame default when the caller does not know the duration.
  function timingFor(durationSec) {
    const duration = Number(durationSec)
    if (!Number.isFinite(duration) || duration <= 0) return { length: 39, fps: OUTPUT_FPS }
    const length = gridFrameCount(duration * OUTPUT_FPS)
    return { length, fps: clamp(length / duration, 1, 60) }
  }

  function roundToMultiple(value, fallback) {
    const number = Math.round(Number(value) || 0)
    if (number <= 0) return fallback
    return Math.max(RESOLUTION_MULTIPLE,
      Math.round(number / RESOLUTION_MULTIPLE) * RESOLUTION_MULTIPLE)
  }

  // Generation time goes with the pixel count: the crescent takes ~40s at
  // 640x640 and ~82s at 960x960, so a 1920x1080 source would be ~200s per
  // candidate and four candidates would be a quarter of an hour, if it did
  // not run out of VRAM first. The source's own size is used up to this, and
  // scaled down past it with the aspect kept.
  const MAX_GENERATION_SIDE = 1024

  function generationSize(width, height) {
    const w = roundToMultiple(width, 640)
    const h = roundToMultiple(height, 640)
    const longest = Math.max(w, h)
    if (longest <= MAX_GENERATION_SIDE) return { width: w, height: h }
    const scale = MAX_GENERATION_SIDE / longest
    return { width: roundToMultiple(w * scale, 640), height: roundToMultiple(h * scale, 640) }
  }

  function resolvePreset(attribute) {
    if (attribute && typeof attribute === 'object' && typeof attribute.material === 'string') {
      return attribute
    }
    const preset = PRESET_BY_ID.get(String(attribute || '').trim())
    if (!preset) throw new TypeError('Unknown AI 特效 attribute: ' + attribute)
    return preset
  }

  // With a look reference the prompt switches to MiniMax's full-reference form,
  // because that is the only shape in which <Picture 1> is addressable. Without
  // one it stays plain prose, which is what the presets were tuned against.
  // Clearing the 风格 and writing 提示词补充 instead is the img2img case: the
  // words describe the material and nothing else may contradict them. That
  // last part is the whole trick - measured on the crescent, asking for deep
  // purple while the preset is still in the prompt comes back cyan at every
  // denoise, off a grey init, with the preset's material sentence deleted,
  // with the ask moved to the front, declared as an OVERRIDE, and in English.
  // The word that wins is the preset's NAME ('a single anime-style ICE
  // crescent slash'), so the only way to hand the words the material is to
  // take the preset out of the sentence altogether.
  function isPromptOnly(options) {
    return !options.attribute && !options.hasReferenceImage
      && Boolean(String(options.supplement || '').trim())
  }

  function composePrompt(options = {}) {
    // With a reference image the material comes from the picture, and in the
    // prompt-only case it comes from the artist's own words; otherwise an
    // unknown or missing attribute is an error rather than a silent default.
    const promptOnly = isPromptOnly(options)
    const preset = (options.hasReferenceImage || promptOnly) && !options.attribute
      ? null
      : resolvePreset(options.attribute)
    const supplement = String(options.supplement || '').trim()
    const extra = supplement ? ' ' + supplement : ''
    const shape = String(options.shape || '').trim() || DEFAULT_SHAPE
    // With a reference image the shape must not describe the material. Seven of
    // the archetypes say "of light"; the detector hands over a plain wording
    // for those and this is the only place it is used.
    const refShape = String(options.plainShape || '').trim() || shape
    const clause = String(options.lifecycleClause || '').trim() || DEFAULT_LIFECYCLE_CLAUSE
    // A looping element never disperses, so its preset's break-up sentence is
    // left out entirely rather than contradicted later in the prompt. Keeping
    // it in is what made a looping border light explode into coins.
    if (promptOnly) {
      // Only the silhouette and the shot framing survive; the subject is the
      // artist's sentence. No preset name, no preset material, no preset
      // break-up - there is nothing left for the words to argue with.
      return `${LEAD} ${shape}, ${supplement} ${shapeSentence(shape, clause)} ${SHOT_TAIL}`
    }
    if (!options.hasReferenceImage) {
      const dispersal = options.lifecycle === 'loop' ? '' : ' ' + preset.breakup
      // The shape sits between the material's name and its description, which
      // is exactly where the A/B that fixed this put it.
      const subject = `${preset.name} ${shape}, ${preset.material}${dispersal}`
      return `${LEAD} ${subject}${extra} ${shapeSentence(shape, clause)} ${SHOT_TAIL}`
    }
    // A reference image REPLACES the preset, it does not qualify it. Measured:
    // hand the model a venom still and write ICE in the text and it renders
    // ice - the words win every time, so naming a material here made the
    // upload do nothing. With no material named, the same four references gave
    // four different materials on one motion (cracked ice plate, viscous goo,
    // neon capsules, polished gold) where the no-reference control came back
    // as plain white light. So the subject here is the silhouette only, and
    // the panel greys the 基础风格 picker while a reference is loaded.
    return [
      'subject_definitions:',
      '<Picture 1>: a still of the target look - its material, colour, surface finish and the way it',
      'breaks apart.',
      `<Subject 1>: a ${refShape}${extra}`,
      '',
      'summary:',
      '[reference generation] Generate a 2D game VFX element on a pure solid black background.',
      'Source assets: <Picture 1>. <Picture 1> supplies the material, colour and surface of the',
      'effect; <Subject 1> is only its silhouette.',
      '',
      'retention_analysis:',
      '<Picture 1>: attribute_transfer - its material, colour and surface finish transfer onto the',
      'effect. Its own subject, framing and composition are not retained.',
      '<Subject 1>: fully_preserved - the silhouette and its motion.',
      '',
      'detailed_description:',
      `A single ${refShape} made of exactly the material shown in <Picture 1>, with the same`,
      'colour, the same surface finish and the same way of breaking apart.',
      shapeSentence(refShape, clause),
      SHOT_TAIL,
      '',
      'overall_soundscape:',
      'Silent.',
      '',
      'non_diegetic_music:',
      'None.',
      '',
    ].join('\n')
  }

  function node(classType, inputs, title) {
    return { inputs: inputs || {}, class_type: classType, _meta: { title: title || classType } }
  }

  function buildWorkflow(options = {}) {
    const sourceVideo = String(options.sourceVideo || '').trim()
    if (!sourceVideo) throw new TypeError('AI 特效 restyle needs a source clip')

    const referenceImage = String(options.referenceImage || '').trim()
    const motionReference = String(options.motionReference || '').trim()
    const { width, height } = generationSize(options.width, options.height)
    const steps = Math.max(1, Math.round(Number(options.steps) || DEFAULT_STEPS))
    const seed = Math.round(Number(options.seed) || 0)
    const timing = timingFor(options.durationSec)
    const length = Math.max(5, Math.round(Number(options.length) || timing.length))
    const outputFps = clamp(options.outputFps || timing.fps, 1, 60)
    const desaturate = clamp(options.desaturate == null ? 1 : options.desaturate, 0, 1)
    const promptOnly = isPromptOnly({ ...options, hasReferenceImage: Boolean(referenceImage) })
    // Clearing the style is allowed, but then something has to say what the
    // material is - the words or a picture. Nothing at all used to fall back
    // to 冰霜 without telling anyone.
    if (!options.attribute && !referenceImage && !promptOnly) {
      throw new TypeError('AI 特效 restyle needs a 风格, a 参考图 or a 提示词补充')
    }
    const preset = (referenceImage || promptOnly) && !options.attribute
      ? null
      : resolvePreset(options.attribute == null ? 'ice' : options.attribute)
    // The init is painted in the TARGET colour rather than left grey. Colour is
    // the one thing that survives a denoise low enough to follow the source, so
    // handing it over in the init is what buys the two at once; see the block
    // above strengthToDenoise. A reference image needs it just as much - off a
    // grey init at a loop's 0.55 a blue lightning ball came back as a white
    // frame with a few blue sparks - so the panel hands over the picture's own
    // colour as `tint`; a style still picked under a reference has given way
    // to it and never paints the init. In the prompt-only case painting the
    // init in the CLEARED style's colour is exactly what would fight the
    // words, so that one keeps the grey init.
    const tint = options.tint == null
      ? (preset && !referenceImage ? String(preset.accent || '') : '')
      : String(options.tint)
    const strength = options.strength == null
      ? (promptOnly
        ? SUPPLEMENT_STRENGTH
        : defaultStrengthFor(options.attribute == null ? 'ice' : options.attribute, options.lifecycle,
          Boolean(String(options.supplement || '').trim())))
      : options.strength
    const denoise = options.denoise == null
      ? strengthToDenoise(strength)
      : clamp(options.denoise, 0.05, 1)
    const prefix = String(options.filenamePrefix || DEFAULT_PREFIX)
    const prompt = options.prompt == null
      ? composePrompt({ ...options, hasReferenceImage: Boolean(referenceImage) })
      : String(options.prompt)

    const usesReferences = Boolean(referenceImage || motionReference)
    const conditioningClass = usesReferences
      ? 'MiniMaxH3ReferenceToVideo'
      : 'MiniMaxH3ImageToVideo'
    const conditioning = {
      clip: ['2', 0],
      vae: ['3', 0],
      prompt,
      width,
      height,
      // The init latent decides the real frame count; this only sizes the empty
      // latent the conditioning node returns, which the sampler never sees.
      length,
    }
    if (usesReferences) {
      conditioning.audio_vae = ['4', 0]
      conditioning.ref_image_size = 'match'
    }

    const workflow = {
      1: node('UNETLoader', { unet_name: MODELS.unet, weight_dtype: 'default' }, 'H3 UNet'),
      2: node('CLIPLoader', { clip_name: MODELS.clip, type: 'minimax', device: 'default' }, 'H3 文本编码器'),
      3: node('VAELoader', { vae_name: MODELS.videoVae }, 'H3 视频 VAE'),
      4: node('VAELoader', { vae_name: MODELS.audioVae }, 'H3 音频 VAE'),
      5: node(conditioningClass, conditioning, conditioningClass),
      6: node('BasicScheduler', { scheduler: 'simple', steps, denoise, model: ['1', 0] }, '风格强度 → denoise'),
      7: node('KSamplerSelect', { sampler_name: 'res_multistep' }, 'H3 采样器'),
      8: node('RandomNoise', { noise_seed: seed }, 'H3 种子'),
      9: node('BasicGuider', { model: ['16', 0], conditioning: ['5', 0] }, 'H3 引导'),
      10: node('SamplerCustomAdvanced', {
        noise: ['8', 0], guider: ['9', 0], sampler: ['7', 0], sigmas: ['6', 0],
        latent_image: ['33', 0],
      }, 'H3 采样'),
      11: node('VAEDecode', { samples: ['10', 0], vae: ['3', 0] }, '解码特效帧'),
      12: node('VAEDecodeAudio', { samples: ['10', 0], vae: ['4', 0] }, '解码音轨'),
      13: node('CreateVideo', { images: ['34', 0], audio: ['12', 0], fps: outputFps, bit_depth: 8 }, '合成预览视频'),
      14: node('SaveVideo', { video: ['13', 0], filename_prefix: prefix, format: 'auto', codec: 'auto' }, '保存预览视频'),
      15: node('SaveImage', { images: ['34', 0], filename_prefix: prefix + '_frame' }, '保存序列帧'),
      16: node('NovaFlowH3SageAttention', { model: ['1', 0] }, 'H3 SageAttention 加速'),
      30: node('LoadVideo', { file: sourceVideo }, '素材原片'),
      31: node('GetVideoComponents', { video: ['30', 0] }, '拆解原片'),
      32: node('NovaFlowH3ReferenceVideoFrames', { images: ['31', 0], source_fps: ['31', 2] }, '原片重采样到 24fps'),
      33: node('NovaFlowH3VideoToVideoLatent', {
        vae: ['3', 0], images: ['32', 0], width, height, length, desaturate, tint,
      }, '原片 → 初始潜变量（去色后上风格色）'),
      34: node('NovaFlowH3OutputVideoFrames', { images: ['11', 0], fps: OUTPUT_FPS }, '输出帧序列'),
    }

    if (referenceImage) {
      workflow[20] = node('LoadImage', { image: referenceImage }, '风格参考图')
      workflow[5].inputs['ref_images.ref_image_0'] = ['20', 0]
    }
    if (motionReference) {
      workflow[24] = node('LoadVideo', { file: motionReference }, '运动参考')
      workflow[25] = node('GetVideoComponents', { video: ['24', 0] }, '拆解运动参考')
      workflow[26] = node('NovaFlowH3ReferenceVideoFrames', { images: ['25', 0], source_fps: ['25', 2] }, '运动参考 24fps')
      workflow[5].inputs['ref_videos.ref_video_0'] = ['26', 0]
    }
    return workflow
  }

  function validateWorkflow(workflow) {
    if (!workflow || typeof workflow !== 'object') throw new TypeError('AI 特效 workflow is invalid')
    const byClass = (classType) => Object.entries(workflow)
      .filter(([, value]) => value && value.class_type === classType)

    const latents = byClass('NovaFlowH3VideoToVideoLatent')
    if (latents.length !== 1) {
      throw new TypeError('AI 特效 restyle requires exactly one NovaFlowH3VideoToVideoLatent')
    }
    const sampler = byClass('SamplerCustomAdvanced')
    if (sampler.length !== 1) throw new TypeError('AI 特效 restyle requires exactly one sampler')
    const latentLink = sampler[0][1].inputs.latent_image
    if (!Array.isArray(latentLink) || latentLink[0] !== latents[0][0]) {
      // Sampling from the empty latent instead of the source is the one failure
      // that still produces a plausible clip, so it has to be caught here.
      throw new TypeError('AI 特效 restyle must sample from the source latent, not an empty one')
    }
    const scheduler = byClass('BasicScheduler')
    if (scheduler.length !== 1) throw new TypeError('AI 特效 restyle requires exactly one scheduler')
    const denoise = Number(scheduler[0][1].inputs.denoise)
    if (!(denoise > 0 && denoise <= 1)) {
      throw new TypeError('AI 特效 denoise must sit in (0, 1]')
    }
    const conditioning = byClass('MiniMaxH3ReferenceToVideo').concat(byClass('MiniMaxH3ImageToVideo'))
    if (conditioning.length !== 1) throw new TypeError('AI 特效 restyle requires exactly one conditioning node')
    const refImages = Object.keys(conditioning[0][1].inputs)
      .filter(key => key.startsWith('ref_images.'))
    if (refImages.length && conditioning[0][1].class_type !== 'MiniMaxH3ReferenceToVideo') {
      throw new TypeError('AI 特效 reference images need MiniMaxH3ReferenceToVideo')
    }
    return true
  }

  return Object.freeze({
    MODELS,
    ATTRIBUTE_PRESETS,
    DEFAULT_STRENGTH,
    MIN_DENOISE,
    MAX_DENOISE,
    DEFAULT_STEPS,
    OUTPUT_FPS,
    gridFrameCount,
    timingFor,
    generationSize,
    MAX_GENERATION_SIDE,
    MIN_GRID_FRAMES,
    MAX_GRID_FRAMES,
    DEFAULT_SHAPE,
    DEFAULT_LIFECYCLE_CLAUSE,
    LOOP_MAX_STRENGTH,
    MAX_DEFAULT_STRENGTH,
    SUPPLEMENT_STRENGTH,
    strengthToDenoise,
    denoiseToStrength,
    STRENGTH_LEVELS,
    strengthLevel,
    defaultStrengthFor,
    isPromptOnly,
    composePrompt,
    buildWorkflow,
    validateWorkflow,
    getPreset: (id) => PRESET_BY_ID.get(String(id || '')) || null,
  })
})
