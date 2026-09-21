const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')

// Exercise the actual component shipped by the locked entry, including React's
// dependency comparison when a project arrives without a playback-prop change.
const bundle = fs.readFileSync(path.join(__dirname, '../../particle-editor/assets/index-BbIa-2NM.js'), 'utf8')
const start = bundle.indexOf('function Ye({project:')
const end = bundle.indexOf('}var Xe=', start)
assert.ok(start >= 0 && end > start, 'shipped Spine preview component must be found')
const component = bundle.slice(start, end + 1)

function harness() {
  const refs = [], effects = [], pending = [], players = []
  let refIndex = 0, effectIndex = 0
  const canvas = { width: 100, height: 100, clientWidth: 100, clientHeight: 100 }
  const window = {
    devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {},
    __NOVA_SPINE_CREATE_PLAYER(_canvas, source) {
      const player = {
        __novaOfficial: true, playing: true, stopped: 0, time: 0,
        matchesSource: next => next === source,
        start() { this.playing = true },
        stop() { this.playing = false; this.stopped++ },
        setPlaying(value) { this.playing = value },
        renderAt(time) { this.time = time },
        setProject() {}, setAnimation() {}, setSkin() {}, setHud() {},
        setDebugOverlays() {}, setSelectedBoneNames() {}, setVisibleBoneNames() {},
        setPremultipliedAlpha() {},
        dispose() { this.disposed = true; this.playing = false },
        advance(dt) { if (this.playing) this.time += dt }
      }
      players.push(player)
      return player
    }
  }
  const context = vm.createContext({
    window, he() {},
    _: {
      useRef(value) { const index = refIndex++; return refs[index] || (refs[index] = { current: value }) },
      useEffect(callback, deps) {
        const index = effectIndex++
        const previous = effects[index]
        if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
          pending.push(() => {
            previous?.cleanup?.()
            effects[index] = { deps, cleanup: callback() }
          })
        }
      }
    },
    X: { jsx(_type, props) { props.ref.current = canvas; return props } }
  })
  vm.runInContext(component, context)
  return {
    render(props) {
      refIndex = effectIndex = 0
      context.Ye({ animationName: 'idle', playing: true, ...props })
      while (pending.length) pending.shift()()
    },
    player: () => players.at(-1)
  }
}

const project = () => ({ animations: { idle: {} } })

test('first pause after import stops the newly created player and resume still advances', () => {
  const h = harness(), p = project(), source = {}
  h.render({ project: null })
  h.render({ project: p, source })
  h.player().advance(0.5)
  h.render({ project: p, source, playing: false, timeSec: 0.5 })
  h.player().advance(1)
  assert.equal(h.player().playing, false)
  assert.equal(h.player().time, 0.5)
  h.render({ project: p, source, playing: true })
  h.player().advance(0.25)
  assert.equal(h.player().time, 0.75)
  h.render({ project: p, source, playing: false, timeSec: 0.75 })
  h.player().advance(1)
  assert.equal(h.player().time, 0.75)
})

test('importing while paused applies the existing pause state to the first player', () => {
  const h = harness()
  h.render({ project: null, playing: false, timeSec: 0 })
  h.render({ project: project(), source: {}, playing: false, timeSec: 0 })
  h.player().advance(1)
  assert.equal(h.player().playing, false)
  assert.equal(h.player().time, 0)
})

test('replacing the source while paused does not autoplay the replacement', () => {
  const h = harness(), p = project(), source = {}
  h.render({ project: p, source, playing: false, timeSec: 0.8 })
  const old = h.player()
  h.render({ project: p, source: {}, playing: false, timeSec: 0.8 })
  assert.equal(old.disposed, true)
  assert.notEqual(h.player(), old)
  h.player().advance(1)
  assert.equal(h.player().playing, false)
  assert.equal(h.player().time, 0.8)
})
