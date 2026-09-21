const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const modulePath = path.join(root, 'particle-editor', 'aifx-shape-detect.js')
const window = {}
window.window = window
window.globalThis = window
vm.runInNewContext(readFileSync(modulePath, 'utf8'), { window, globalThis: window, console },
  { filename: modulePath })

const api = window.NovaFlowAifxShapeDetect
assert.ok(api, 'shape detector must be exposed')

// Synthetic plates rather than checked-in clips: the rules are geometric, so
// drawing the geometry exercises them exactly and keeps the fixture readable.
const SIZE = 96

function plate(draw) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  const set = (x, y, value) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    const index = (Math.round(y) * SIZE + Math.round(x)) * 4
    const level = Math.round(Math.min(1, value) * 255)
    if (level <= data[index]) return
    data[index] = level
    data[index + 1] = level
    data[index + 2] = level
    data[index + 3] = 255
  }
  draw(set)
  return { width: SIZE, height: SIZE, data }
}

const disc = (set, cx, cy, radius, value = 1) => {
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if (Math.hypot(x - cx, y - cy) <= radius) set(x, y, value)
    }
  }
}

const annulus = (set, cx, cy, radius, thickness) => {
  for (let y = cy - radius - thickness; y <= cy + radius + thickness; y += 1) {
    for (let x = cx - radius - thickness; x <= cx + radius + thickness; x += 1) {
      const d = Math.hypot(x - cx, y - cy)
      if (d >= radius - thickness && d <= radius + thickness) set(x, y, 1)
    }
  }
}

function crescentFrames() {
  // A disc with a second disc bitten out of it: square bounding box, a real
  // angular gap. Both properties the detector keys on. It also fades out,
  // because a slash is a one-shot - a crescent that merely shrinks and never
  // goes dark is a persistent element and the lifecycle test should say so.
  return Array.from({ length: 20 }, (unused, index) => plate((set) => {
    const radius = 34 - index * 0.4
    const level = Math.max(0, 1 - index / 16)
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const outer = Math.hypot(x - 48, y - 48) <= radius
        const bite = Math.hypot(x - 62, y - 44) <= radius - 4
        if (outer && !bite) set(x, y, level)
      }
    }
  }))
}

function burstFrames() {
  return Array.from({ length: 20 }, (unused, index) => plate((set) => {
    disc(set, 48, 48, 6 + index * 1.8)
  }))
}

function ringFrames() {
  return Array.from({ length: 20 }, (unused, index) => plate((set) => {
    if (index < 4) return disc(set, 48, 48, 4 + index)
    annulus(set, 48, 48, 6 + index * 1.7, 2)
  }))
}

function pillarFrames() {
  return Array.from({ length: 20 }, (unused, index) => plate((set) => {
    const height = Math.min(88, 6 + index * 6)
    for (let y = 95 - height; y <= 95; y += 1) {
      for (let x = 42; x <= 54; x += 1) set(x, y, 1)
    }
    annulus(set, 48, 92, 20, 2)   // the ground sigil that widens the box
  }))
}

// A running light only lights part of its border per frame, so per-frame
// measures call it an arc (measured 0.64 angular). The union over the clip is
// what it is. This is also a lifecycle case: it never disperses.
function runningLightFrames() {
  return Array.from({ length: 20 }, (unused, index) => plate((set) => {
    const lit = index % 4
    const on = (x, y, side) => { if (side === lit) set(x, y, 1) }
    for (let x = 18; x <= 78; x += 1) { on(x, 24, 0); on(x, 72, 2) }
    for (let y = 24; y <= 72; y += 1) { on(78, y, 1); on(18, y, 3) }
  }))
}

// A reel-stop impact: wide from its first frame, and it stays that width. A
// payline sweep reaches the same width but draws itself out to get there, so
// growth is what separates them, not the aspect ratio both of them have.
function reelStopFrames() {
  return Array.from({ length: 20 }, (unused, index) => plate((set) => {
    const half = Math.min(8, 2 + index * 0.5)
    for (let y = 48 - half; y <= 48 + half; y += 1) {
      for (let x = 6; x <= 90; x += 1) set(x, y, Math.max(0.2, 1 - index / 24))
    }
  }))
}

// A symbol tile: one filled square that flashes, then throws its shards out
// past four times their starting spread.
function symbolPopFrames() {
  return Array.from({ length: 20 }, (unused, index) => plate((set) => {
    if (index < 5) {
      for (let y = 38; y <= 58; y += 1) for (let x = 38; x <= 58; x += 1) set(x, y, 1)
      return
    }
    const spread = (index - 4) * 4
    for (let k = 0; k < 16; k += 1) {
      const angle = (k / 16) * Math.PI * 2
      disc(set, 48 + Math.cos(angle) * spread, 48 + Math.sin(angle) * spread, 2,
        Math.max(0, 1 - index / 22))
    }
  }))
}

// A collect: pieces spread over the frame that all gather to the middle. Its
// bounding box barely moves until the last frames, which is why this needs the
// radial measure and not `shrink`.
function collectFrames() {
  // Scattered over the whole area, middle included: a collect is a field of
  // coins, not a ring of them, and a ring fixture would be caught by the
  // hollow rule before it ever reached the converge test.
  const seeds = Array.from({ length: 80 }, (unused, k) => {
    const angle = k * 2.3999632
    const radius = 4 + Math.sqrt(k / 80) * 36
    return [Math.cos(angle) * radius, Math.sin(angle) * radius]
  })
  return Array.from({ length: 20 }, (unused, index) => plate((set) => {
    const pull = Math.max(0.06, 1 - index / 19)
    for (const [dx, dy] of seeds) disc(set, 48 + dx * pull, 48 + dy * pull, 2)
  }))
}

// A fountain: bottom-anchored, and its mass climbs.
function fountainFrames() {
  return Array.from({ length: 20 }, (unused, index) => plate((set) => {
    for (let k = 0; k < 20; k += 1) {
      const angle = -Math.PI / 2 + ((k / 19) - 0.5) * 1.5
      const reach = Math.min(70, 6 + index * 5) * (0.5 + (k % 4) / 6)
      disc(set, 48 + Math.cos(angle) * reach, 94 + Math.sin(angle) * reach, 2)
    }
    disc(set, 48, 93, 4)
  }))
}

// A shower: many separate pieces, all falling, keeping their spread.
function rainFrames() {
  return Array.from({ length: 20 }, (unused, index) => plate((set) => {
    for (let k = 0; k < 18; k += 1) {
      const x = 6 + ((k * 37) % 84)
      const y = ((k * 23) % 96) + index * 4 - 40
      if (y < 0 || y > 95) continue
      disc(set, x, y, 3)
    }
  }))
}

const runningLight = api.analyse(runningLightFrames())
assert.equal(runningLight.archetype, 'frame',
  `a running border light must union to a frame, got ${runningLight.archetype}`)
assert.ok(runningLight.metrics.angularUnion > runningLight.metrics.angular,
  'the union has to see more of the border than any single frame')
assert.equal(runningLight.lifecycle, 'loop', 'a persistent border light is a loop')

// A one-shot must not be dragged into the loop bucket by the same test.
assert.equal(api.analyse(crescentFrames()).lifecycle, 'once')
assert.equal(api.analyse(burstFrames()).lifecycle, 'once')

const cases = [
  ['arc', crescentFrames()],
  ['burst', burstFrames()],
  ['ring', ringFrames()],
  ['pillar', pillarFrames()],
  ['band', reelStopFrames()],
  ['shatter', symbolPopFrames()],
  ['converge', collectFrames()],
  ['fountain', fountainFrames()],
  ['rain', rainFrames()],
]
for (const [expected, frames] of cases) {
  const result = api.analyse(frames)
  assert.equal(result.archetype, expected,
    `${expected}: got ${result.archetype} (${JSON.stringify(result.metrics)})`)
  assert.ok(result.label, 'every archetype needs a Chinese label for the panel')
  assert.ok(result.shape.length > 30, 'every archetype needs a prompt phrase')
}

// A crescent's bounding box is square and a pillar's is widened by its sigil,
// so neither is separable by aspect ratio. Assert the measures that do work so
// a future tidy-up does not quietly reintroduce the elongation test.
const crescent = api.analyse(crescentFrames())
assert.ok(crescent.metrics.angular < 0.85, 'a crescent must leave an angular gap')
const ring = api.analyse(ringFrames())
assert.ok(ring.metrics.angular > 0.9, 'a ring must close the angle')
assert.ok(ring.metrics.hollow > 0.45, 'a ring must open its middle')
const pillar = api.analyse(pillarFrames())
assert.ok(pillar.metrics.taper < 0.6, 'a pillar must be narrower at the top')
assert.ok(pillar.metrics.topReach < 0.25, 'a pillar must reach the top of the frame')

// The measures the new archetypes rest on, asserted directly so a tidy-up
// cannot swap them back for the box-based pair that could not see them.
const collect = api.analyse(collectFrames())
assert.ok(collect.metrics.radialShrink < 0.5, 'a collect must pull its mass in')
assert.ok(collect.metrics.shrink > collect.metrics.radialShrink,
  'the bounding box misses the gather, which is why radialShrink exists')
const symbolPop = api.analyse(symbolPopFrames())
assert.ok(symbolPop.metrics.solidStart > 0.85, 'a tile fills its own box; a disc cannot')
assert.ok(symbolPop.metrics.radialGrow > 2, 'a shatter throws its shards well clear')
const fountain = api.analyse(fountainFrames())
assert.ok(fountain.metrics.rise > 0.04, 'a fountain climbs')
assert.ok(api.analyse(rainFrames()).metrics.rise < -0.15, 'a shower falls')
assert.ok(api.analyse(rainFrames()).metrics.pieces >= 4, 'a shower is many separate pieces')
assert.ok(api.analyse(reelStopFrames()).metrics.aspect > 1.8, 'a shock band is wide')

// Every archetype in the library needs a label and a phrase, including the two
// that are pickable but not auto-detected.
const LIGHT_WORDS = /\b(light|glow\w*|bright\w*|luminous|flash\w*)\b/i
for (const [id, entry] of Object.entries(api.ARCHETYPES)) {
  assert.ok(entry.label, id + ' needs a Chinese label')
  assert.ok(entry.shape.length > 30, id + ' needs a prompt phrase')
  // Whichever wording the reference path ends up using, it must not describe
  // the material: "of light" competes with the picture and wins, which took a
  // copper reference from 0.209 saturation down to 0.003 (plain white).
  const plain = entry.plainShape || entry.shape
  assert.ok(!LIGHT_WORDS.test(plain),
    id + ' must offer a wording with no light words for the reference path')
  if (entry.plainShape) {
    assert.ok(LIGHT_WORDS.test(entry.shape),
      id + ' only needs a plainShape if its own phrase mentions light')
    assert.ok(entry.plainShape.length > 30, id + ' plainShape needs to stay descriptive')
  }
}
// The eight that mention light are the ones that need it; the rest fall back.
assert.equal(Object.values(api.ARCHETYPES).filter(entry => entry.plainShape).length, 8)
for (const id of ['frame', 'ring', 'band', 'tile', 'shatter', 'fountain', 'rain', 'swirl', 'rays',
  'converge', 'burst', 'pillar', 'arc', 'trail', 'blob']) {
  assert.ok(api.ARCHETYPES[id], id + ' must stay in the library')
}
// A square that HOLDS, next to the square that breaks: without it a solid
// panel is described to the model as a ring, and a ring is what comes back.
assert.match(api.ARCHETYPES.tile.shape, /KEEPS its square silhouette/)
assert.match(api.ARCHETYPES.tile.shape, /does NOT break into pieces/)
assert.notEqual(api.ARCHETYPES.tile.shape, api.ARCHETYPES.shatter.shape)

// Degenerate input must not throw: an empty or one-frame clip still has to
// return something the prompt composer can use.
assert.equal(api.analyse([]).archetype, 'blob')
assert.equal(api.analyse(null).archetype, 'blob')
assert.ok(api.analyse([plate((set) => disc(set, 48, 48, 10))]).shape)

console.log('aifx shape detect: ok')
