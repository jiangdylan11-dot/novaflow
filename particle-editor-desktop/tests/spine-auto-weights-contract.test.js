const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..', '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const WEIGHTS = 'spine-auto-weights.js'
const WEIGHTS_EDITOR = 'spine-auto-weights.editor.js'
const ATTACH = 'spine-auto-mesh-attach.js'
const EDITOR = 'spine-auto-mesh.editor.js'
const PANEL = 'spine-auto-mesh.panel.js'
const CACHE_BUSTER = '20260920-auto-mesh-43'

// particle-editor is an ESM package, so `require` runs the script but its exports
// land on globalThis -- the same way the browser <script> path publishes it.
require(path.join(root, 'particle-editor', WEIGHTS))
require(path.join(root, 'particle-editor', WEIGHTS_EDITOR))
const W = globalThis.NovaFlowAutoWeights
const E = globalThis.NovaFlowAutoWeightsEditor

// ---------------------------------------------------------------- wiring ---

test('auto-weights and its editor are wired into index.html between attach and the mesh editor', () => {
  const html = read('particle-editor/index.html')
  for (const file of [WEIGHTS, WEIGHTS_EDITOR]) assert.ok(html.includes(`./${file}?v=${CACHE_BUSTER}`), `${file} missing or stale in index.html`)
  assert.ok(html.indexOf(`./${ATTACH}?v=`) < html.indexOf(`./${WEIGHTS}?v=`), 'attach must load before weights')
  assert.ok(html.indexOf(`./${WEIGHTS}?v=`) < html.indexOf(`./${WEIGHTS_EDITOR}?v=`), 'the solver must load before its editor')
  assert.ok(html.indexOf(`./${WEIGHTS_EDITOR}?v=`) < html.indexOf(`./${EDITOR}?v=`), 'weights must load before the mesh editor')
  assert.ok(html.indexOf(`./${EDITOR}?v=`) < html.indexOf(`./${PANEL}?v=`), 'the panel loads last: it calls into both editors')
})

test('auto-weights and its editor are shipped by the renderer build and the sync chain', () => {
  const build = read('particle-editor-desktop/scripts/build-renderer.mjs')
  const sync = read('scripts/sync-runtime.mjs'), check = read('scripts/check-runtime-sync.mjs')
  for (const file of [WEIGHTS, WEIGHTS_EDITOR]) {
    assert.equal(build.split(`"${file}"`).length - 1, 2, `${file} must appear in both build-renderer lists`)
    assert.ok(sync.includes(`label: '${file}'`), `${file} missing a sync-runtime group`)
    assert.ok(check.includes(`'${file}'`), `${file} missing from check-runtime-sync`)
  }
})

test('the panel exposes the weight flows and wires the editor buttons', () => {
  const panel = read(`particle-editor/${PANEL}`)
  for (const needle of ['autoWeights', 'editWeights', 'NovaFlowAutoWeightsEditor', 'applyWeights', 'matricesFromRuntime', '__NOVA_SPINE_CREATE_PLAYER', "'自动权重'", "'权重'"]) {
    assert.ok(panel.includes(needle), `panel must reference ${needle}`)
  }
})

test('auto-weights stays dependency free', () => {
  const src = read(`particle-editor/${WEIGHTS}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/opencv/i.test(src), 'must not depend on OpenCV')
  assert.ok(!/\brequire\(/.test(src), 'must not require anything')
  assert.equal(typeof W.heatWeights, 'function')
  assert.equal(typeof W.assignBones, 'function')
  assert.equal(typeof W.mechanismBones, 'function')
  assert.equal(typeof W.weightedVertices, 'function')
})

// --------------------------------------------------------------- helpers ---

/** Regular grid triangulation; `keep(cx, cy)` drops triangles by centroid. Re-indexes. */
function grid(nx, ny, step, x0, y0, keep) {
  const V = [], T = []
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) V.push(x0 + i * step, y0 + j * step)
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1
    for (const tri of [[a, b, d], [a, d, c]]) {
      const cx = (V[2 * tri[0]] + V[2 * tri[1]] + V[2 * tri[2]]) / 3, cy = (V[2 * tri[0] + 1] + V[2 * tri[1] + 1] + V[2 * tri[2] + 1]) / 3
      if (!keep || keep(cx, cy)) T.push(...tri)
    }
  }
  const map = new Map(), V2 = [], T2 = []
  for (const idx of T) {
    if (!map.has(idx)) { map.set(idx, V2.length / 2); V2.push(V[2 * idx], V[2 * idx + 1]) }
    T2.push(map.get(idx))
  }
  const find = (x, y) => { for (let i = 0; i < V2.length / 2; i++) if (Math.abs(V2[2 * i] - x) < 1e-9 && Math.abs(V2[2 * i + 1] - y) < 1e-9) return i; return -1 }
  return { V: V2, T: T2, find }
}

// ---------------------------------------------------------------- solver ---

test('heat weights: pinned on the bone, a smooth blend away from it, rows sum to one', () => {
  const { V, T, find } = grid(21, 5, 10, 0, 0)
  const bones = [{ ax: 0, ay: 20, bx: 100, by: 20 }, { ax: 100, ay: 20, bx: 200, by: 20 }]
  const r = W.heatWeights(V, T, bones)
  const w0 = (x, y) => r.weights[find(x, y) * 2]
  // on the bone line the nearest bone owns the vertex outright, the seam splits evenly
  assert.equal(w0(90, 20), 1); assert.equal(w0(110, 20), 0); assert.ok(Math.abs(w0(100, 20) - 0.5) < 1e-6)
  // two rows away the ownership blends across the seam, monotonically
  const row = [0, 70, 80, 90, 100, 110, 120, 130, 200].map((x) => w0(x, 0))
  for (let i = 1; i < row.length; i++) assert.ok(row[i] <= row[i - 1] + 1e-9, 'weights must fall monotonically along the strip')
  assert.ok(row[3] > 0.6 && row[3] < 0.95, `x=90 should be a blend, got ${row[3]}`)
  assert.ok(Math.abs(w0(100, 0) - 0.5) < 1e-3)
  for (let i = 0; i < V.length / 2; i++) assert.ok(Math.abs(r.weights[2 * i] + r.weights[2 * i + 1] - 1) < 1e-9)
  // the solve must not stop after the pinned rows are satisfied (the old relative-residual bug)
  assert.ok(r.iterations > 3, `expected a real CG run, got ${r.iterations} iterations`)
})

test('heat weights: a bone across a slit is not visible, so it does not grab the far side', () => {
  // two lobes joined by a bridge at the bottom; the slit is x in (90,110), y > 10
  const { V, T, find } = grid(21, 5, 10, 0, 0, (cx, cy) => !(cx > 90 && cx < 110 && cy > 10))
  const bones = [{ ax: 80, ay: 25, bx: 80, by: 25 }, { ax: 190, ay: 25, bx: 190, by: 25 }]
  const p = find(110, 30)
  assert.ok(p >= 0)
  const seen = W.heatWeights(V, T, bones, { visibility: true })
  const blind = W.heatWeights(V, T, bones, { visibility: false })
  assert.ok(seen.weights[p * 2 + 1] > 0.7, `with visibility the right lobe belongs to the right bone, got ${seen.weights[p * 2 + 1]}`)
  assert.ok(blind.weights[p * 2] > 0.5, `by raw distance the left bone would take it, got ${blind.weights[p * 2]}`)
})

test('heat weights: a single bone owns everything, and pruning keeps at most maxInfluences bones', () => {
  const { V, T } = grid(6, 6, 10, 0, 0)
  const one = W.heatWeights(V, T, [{ ax: 0, ay: 0, bx: 50, by: 50 }])
  for (let i = 0; i < V.length / 2; i++) assert.equal(one.weights[i], 1)
  const bones = []
  for (let k = 0; k < 6; k++) bones.push({ ax: k * 10, ay: 25, bx: k * 10, by: 25 })
  const many = W.heatWeights(V, T, bones, { maxInfluences: 2 })
  for (let i = 0; i < V.length / 2; i++) {
    let nz = 0, s = 0
    for (let j = 0; j < 6; j++) { if (many.weights[i * 6 + j] > 0) nz++; s += many.weights[i * 6 + j] }
    assert.ok(nz <= 2 && Math.abs(s - 1) < 1e-9)
  }
})

// ----------------------------------------------------------- assignment ---

test('assignBones: tighter layer wins, chains vote as one, touching bones are the fallback', () => {
  const torso = grid(3, 4, 100, 0, 0)                 // 0..200 x 0..300
  const strand = grid(3, 21, 10, 150, 50)             // 150..170 x 50..250, inside the torso
  const necklace = grid(2, 3, 10, 95, 240)            // 95..105 x 240..260, on the end of the spine bone
  const gem = grid(2, 2, 10, 300, 100)                // far from every bone
  const layers = [
    { name: 'torso', vertices: torso.V, triangles: torso.T, drawIndex: 0 },
    { name: 'strand', vertices: strand.V, triangles: strand.T, drawIndex: 1 },
    { name: 'necklace', vertices: necklace.V, triangles: necklace.T, drawIndex: 2 },
    { name: 'gem', vertices: gem.V, triangles: gem.T, drawIndex: 3 }
  ]
  const segs = [
    { ax: 100, ay: 50, bx: 100, by: 250 },   // 0 spine, torso only
    { ax: 50, ay: 100, bx: 50, by: 160 },    // 1 a second child of the spine, torso
    { ax: 160, ay: 60, bx: 160, by: 120 },   // 2 strand chain
    { ax: 160, ay: 120, bx: 160, by: 180 },  // 3
    { ax: 160, ay: 180, bx: 160, by: 240 },  // 4
    { ax: 160, ay: 240, bx: 160, by: 290 }   // 5 chain tail poking out of the strand into the torso
  ]
  const parents = [-1, 0, 0, 2, 3, 4]
  const r = W.assignBones(layers, segs, parents, { anchors: false })
  assert.deepEqual(r.layers.get('torso').slice().sort(), [0, 1])
  assert.deepEqual(r.layers.get('strand').slice().sort(), [2, 3, 4, 5], 'the chain tail must follow its chain, not the torso it pokes into')
  // by default the strand chain also brings the spine it hangs from
  assert.deepEqual(W.assignBones(layers, segs, parents).layers.get('strand').slice().sort(), [0, 2, 3, 4, 5])
  assert.deepEqual(r.layers.get('necklace'), [0], 'a layer with no bone inside hangs off the bone touching it')
  assert.equal(r.layers.get('gem').length, 1, 'a layer far from every bone still gets a carrier')
  // without the chain vote the tail goes to the torso by geometry alone
  const solo = W.assignBones(layers, segs, parents, { chainVote: false })
  assert.ok(solo.layers.get('torso').includes(5))
  // skipped bones are never assigned
  const skipped = W.assignBones(layers, segs.map((s, i) => (i === 1 ? { ...s, skip: true } : s)), parents)
  assert.ok(!skipped.layers.get('torso').includes(1))
})

test('heat weights: a point controller beside a real bone peaks at pointPeak, alone it owns outright', () => {
  const { V, T, find } = grid(21, 5, 10, 0, 0)
  const seg = { ax: 0, ay: 20, bx: 200, by: 20 }
  const point = { ax: 100, ay: 5, bx: 100, by: 5 }
  const p = find(100, 0)                    // 5 px from the controller, 20 px from the bone
  const split = W.heatWeights(V, T, [seg, point])
  assert.ok(split.weights[p * 2 + 1] <= 0.6 + 1e-6 && split.weights[p * 2 + 1] > 0.3, `controller should hold a partial peak, got ${split.weights[p * 2 + 1]}`)
  assert.ok(split.weights[p * 2] >= 0.4 - 1e-6, 'the real bone keeps the remainder')
  const own = W.heatWeights(V, T, [seg, point], { pointPeak: 1 })
  assert.ok(own.weights[p * 2 + 1] > split.weights[p * 2 + 1] + 0.05 && own.weights[p * 2 + 1] > 0.6, `pointPeak 1 lets the controller own the vertex, got ${own.weights[p * 2 + 1]}`)
  // a layer with only controllers: plain Voronoi ownership
  const two = W.heatWeights(V, T, [{ ax: 50, ay: 20, bx: 50, by: 20 }, { ax: 150, ay: 20, bx: 150, by: 20 }])
  assert.equal(two.weights[find(50, 20) * 2], 1)
  assert.equal(two.weights[find(150, 20) * 2 + 1], 1)
})

test('heat weights: a controller reaches only its radius, and per-bone presets override peak, radius and stiffness', () => {
  const { V, T, find } = grid(21, 5, 10, 0, 0)          // diag ~204 px -> default radius ~24 px
  const seg = { ax: 0, ay: 20, bx: 200, by: 20 }
  const near = find(100, 0), far = find(150, 0)         // 5 px and ~50 px from a controller at (100,5)
  const soft = W.heatWeights(V, T, [seg, { ax: 100, ay: 5, bx: 100, by: 5 }])
  assert.ok(soft.weights[near * 2 + 1] > 0.3, 'inside the radius the controller shares the vertex')
  assert.ok(soft.weights[far * 2 + 1] < 0.02, `outside the radius the controller does not exist, got ${soft.weights[far * 2 + 1]}`)
  // an eyelid preset: compact, strong, rigid
  const lid = W.heatWeights(V, T, [seg, { ax: 100, ay: 5, bx: 100, by: 5, peak: 0.9, radiusPx: 8, pin: 5 }])
  assert.ok(lid.weights[near * 2 + 1] > 0.8, `a pinned patch holds its peak, got ${lid.weights[near * 2 + 1]}`)
  assert.ok(lid.weights[find(110, 0) * 2 + 1] < 0.4, 'a vertex 11 px away is outside the 8 px preset radius')
  // a lip preset: wide and faint
  const lip = W.heatWeights(V, T, [seg, { ax: 100, ay: 5, bx: 100, by: 5, peak: 0.3, radiusFrac: 0.2 }])
  assert.ok(lip.weights[near * 2 + 1] <= 0.3 + 1e-6 && lip.weights[near * 2 + 1] > 0.1)
  assert.ok(lip.weights[find(130, 0) * 2 + 1] > 0.02, 'a wide preset still reaches 30 px out')
})

test('assignBones: controllers go to the smallest layer holding them and bring their parent only when the layer needs it', () => {
  const torso = grid(3, 4, 100, 0, 0)                  // 0..200 x 0..300
  const face = grid(9, 9, 10, 60, 190)                 // 60..140 x 190..270
  const bra = grid(13, 5, 10, 40, 100)                 // 40..160 x 100..140
  const layers = [
    { name: 'torso', vertices: torso.V, triangles: torso.T, drawIndex: 0 },
    { name: 'face', vertices: face.V, triangles: face.T, drawIndex: 2 },
    { name: 'bra', vertices: bra.V, triangles: bra.T, drawIndex: 1 }
  ]
  const segs = [
    { ax: 100, ay: 50, bx: 100, by: 290 },   // 0 spine: runs through the face, torso owns it
    { ax: 100, ay: 90, bx: 100, by: 150 },   // 1 chest: reaches into the bra
    { ax: 30, ay: 150, bx: 30, by: 250 },    // 2 arm
    { ax: 80, ay: 230, bx: 80, by: 230 },    // 3 eye point, child of the spine
    { ax: 120, ay: 230, bx: 120, by: 230 },  // 4 eye point
    { ax: 75, ay: 120, bx: 75, by: 120 },    // 5 breast point, child of the chest
    { ax: 125, ay: 120, bx: 125, by: 120 }   // 6 breast point
  ]
  const parents = [-1, 0, 0, 0, 0, 1, 1]
  const r = W.assignBones(layers, segs, parents, { anchors: 'points' })
  assert.deepEqual(r.layers.get('torso').slice().sort(), [0, 1, 2])
  assert.deepEqual(r.layers.get('face').slice().sort(), [0, 3, 4], 'the face is mostly head: eye points plus the spine they hang from')
  assert.deepEqual(r.layers.get('bra').slice().sort(), [5, 6], 'the bra is all breast points: the chest bone stays out')
  const plain = W.assignBones(layers, segs, parents, { anchors: false })
  assert.deepEqual(plain.layers.get('face').slice().sort(), [3, 4])
  // the default ('both') also lets every chain bring the bone it hangs from
  const both = W.assignBones(layers, segs, parents)
  assert.deepEqual(both.layers.get('face').slice().sort(), [0, 3, 4])
  assert.deepEqual(both.layers.get('bra').slice().sort(), [1, 5, 6], 'chain-parent anchors give the bra the chest bone its points hang from')
})

test('assignBones: a bone running along a layer edge belongs to the overlapping neighbour', () => {
  const a = grid(11, 11, 10, 0, 0)                     // 0..100
  const b = grid(11, 11, 10, 92, 0)                    // 92..192, overlapping the right rim of a
  const layers = [{ name: 'a', vertices: a.V, triangles: a.T, drawIndex: 0 }, { name: 'b', vertices: b.V, triangles: b.T, drawIndex: 1 }]
  const segs = [{ ax: 98, ay: 20, bx: 98, by: 80 }]    // 2 px inside the edge of a, 6 px inside b
  assert.deepEqual(W.assignBones(layers, segs, [-1]).layers.get('b'), [0])
  assert.deepEqual(W.assignBones(layers, segs, [-1], { edgeMin: 0 }).layers.get('a'), [0], 'without the edge rule tightness alone picks a')
})

test('mechanismBones: targets, zero-length pivots and helper IK chains, never feature points', () => {
  const json = {
    bones: [
      { name: 'root' },
      { name: 'x', parent: 'root' },                       // zero-length pivot with children
      { name: 'head', parent: 'x', length: 50 },
      { name: 'eye', parent: 'head' },                     // zero-length leaf: a controller, keeps weights
      { name: 'tgt', parent: 'root' },                     // IK target
      { name: 'c1', parent: 'x', length: 40 },             // helper IK chain ...
      { name: 'c2', parent: 'c1', length: 40 },            // ... whose member is a transform target
      { name: 'v1', parent: 'x', length: 40 },             // the visible bone copying c2
      { name: 'arm1', parent: 'x', length: 30 },           // an ordinary IK chain stays
      { name: 'armTgt', parent: 'root' }
    ],
    ik: [{ name: 'helper', bones: ['c1', 'c2'], target: 'tgt' }, { name: 'arm', bones: ['arm1'], target: 'armTgt' }],
    transform: [{ name: 'copy', bones: ['v1'], target: 'c2' }]
  }
  const skip = W.mechanismBones(json)
  const names = json.bones.map((b) => b.name)
  assert.deepEqual(Array.from(skip).map((i) => names[i]).sort(), ['armTgt', 'c1', 'c2', 'root', 'tgt', 'x'])
})

test('logicalParents: a child of an IK target hangs off the chain that target drives', () => {
  const json = {
    bones: [
      { name: 'root' },
      { name: 'hip', parent: 'root', length: 50 },
      { name: 'thigh', parent: 'hip', length: 100 },
      { name: 'ikA', parent: 'root' },                 // target of the thigh IK
      { name: 'shin', parent: 'ikA', length: 100 },    // planted on the thigh's target
      { name: 'ikB', parent: 'root' },                 // target of the shin IK
      { name: 'foot', parent: 'ikB', length: 40 },
      { name: 'toe', parent: 'foot', length: 15 },
      { name: 'h1', parent: 'root', length: 80 },      // helper 2-bone chain on the same target
      { name: 'h2', parent: 'h1', length: 80 }
    ],
    ik: [
      { name: 'legBa', bones: ['h1', 'h2'], target: 'ikB' },   // declared first, must not adopt the foot
      { name: 'legA', bones: ['thigh'], target: 'ikA' },
      { name: 'legB', bones: ['shin'], target: 'ikB' }
    ]
  }
  const names = json.bones.map((b) => b.name)
  const p = Array.from(W.logicalParents(json)).map((i) => (i < 0 ? null : names[i]))
  assert.equal(p[names.indexOf('shin')], 'thigh')
  assert.equal(p[names.indexOf('foot')], 'shin')
  assert.equal(p[names.indexOf('toe')], 'foot')
  assert.equal(p[names.indexOf('thigh')], 'hip')
  assert.equal(p[names.indexOf('ikA')], 'root')
})

// --------------------------------------------------------- weight editor ---

test('weight editor: brush maths keeps every row summing to one', () => {
  const I = E._internals
  const nb = 3
  const W = new Float64Array([1, 0, 0, 0.5, 0.5, 0, 0, 0, 1])
  I.paintSet(W, nb, 1, [{ i: 0, f: 1 }], 0.4)
  assert.deepEqual(Array.from(W.slice(0, 3)).map((v) => +v.toFixed(6)), [0.6, 0.4, 0], '直接 sets the bone and rescales the rest')
  I.paintAdd(W, nb, 2, [{ i: 1, f: 1 }], 0.2)
  assert.deepEqual(Array.from(W.slice(3, 6)).map((v) => +v.toFixed(6)), [0.4, 0.4, 0.2], '叠加 adds and rescales the rest')
  const sole = new Float64Array([0, 1, 0])
  I.paintSet(sole, nb, 1, [{ i: 0, f: 1 }], 0.3)
  assert.deepEqual(Array.from(sole), [0, 1, 0], 'a bone that holds the vertex alone cannot give weight to nobody')
  const chain = I.adjacency(3, [0, 1, 2])
  const S = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
  I.paintSmooth(S, nb, chain, [{ i: 1, f: 1 }], 1)
  assert.deepEqual(Array.from(S.slice(3, 6)).map((v) => +v.toFixed(6)), [0.5, 0, 0.5], '平滑 pulls a vertex toward its neighbours')
  const P = new Float64Array([0.005, 0.995, 0])
  I.prune(P, 1, nb, 0.01, 4)
  assert.deepEqual(Array.from(P), [0, 1, 0])
  const grown = I.addBoneColumn(new Float64Array([0.7, 0.3, 1, 0]), 2, 2)
  assert.deepEqual(Array.from(grown), [0.7, 0.3, 0, 1, 0, 0])
  const shrunk = I.removeBoneColumn(new Float64Array([0.7, 0.3, 1, 0]), 2, 2, 0)
  assert.deepEqual(Array.from(shrunk), [1, 1], 'removing a bone hands its weight to what is left')
  const hits = I.brushHits([0, 0, 10, 0, 30, 0], 3, 0, 0, 20, 1)
  assert.deepEqual(hits.map((h) => h.i), [0, 1])
  assert.ok(Math.abs(hits[1].f - 0.5625) < 1e-9, 'soft falloff')
  for (const row of [W.slice(0, 3), W.slice(3, 6), S.slice(3, 6)]) assert.ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9)
})

// ----------------------------------------------------- skeleton helpers ---

test('setupPoseMatrices walks the tree and applyWeights binds a converted mesh through its slot bone', () => {
  const json = {
    bones: [{ name: 'root' }, { name: 'b1', parent: 'root', x: 10, y: 20, rotation: 90, length: 50 }, { name: 'b2', parent: 'b1', x: 50, length: 30 }],
    slots: [{ name: 's', bone: 'b1', attachment: 'm' }],
    skins: [{ name: 'default', attachments: { s: { m: { type: 'mesh', uvs: [0, 0, 1, 0, 0, 1], vertices: [0, 0, 10, 0, 0, 10], triangles: [0, 1, 2], hull: 3, width: 10, height: 10 } } } }]
  }
  const mats = W.setupPoseMatrices(json)
  assert.ok(Math.abs(mats[1].worldX - 10) < 1e-9 && Math.abs(mats[1].worldY - 20) < 1e-9)
  assert.ok(Math.abs(mats[2].worldX - 10) < 1e-9 && Math.abs(mats[2].worldY - 70) < 1e-9, 'a child at the tip of a bone rotated 90° sits straight above it')
  const worldBefore = W.attachmentWorld(json.skins[0].attachments.s.m, mats, 1)
  assert.ok(Math.abs(worldBefore[2] - 10) < 1e-9 && Math.abs(worldBefore[3] - 30) < 1e-9, 'local (10,0) on b1 is world (10,30)')
  const res = W.applyWeights(json, () => ({ boneIds: [1, 2], weights: new Float64Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]) }), mats)
  assert.deepEqual(res.written, ['m'])
  const att = res.skeleton.skins[0].attachments.s.m
  assert.ok(att.vertices.length !== att.uvs.length, 'the attachment is weighted now')
  const worldAfter = W.attachmentWorld(att, mats, 1)
  for (let i = 0; i < 6; i++) assert.ok(Math.abs(worldAfter[i] - worldBefore[i]) < 1e-3, 'binding keeps every vertex where it was')
  const back = W.weightsOfAttachment(att)
  assert.deepEqual(back.boneIds, [1, 2])
  assert.ok(Math.abs(back.weights[0] - 0.5) < 1e-6)
  assert.equal(json.skins[0].attachments.s.m.vertices.length, 6, 'the input skeleton is untouched')
})

// ---------------------------------------------------------- Spine format ---

test('weightedVertices: Spine locals map back to the bound world position through the bone matrices', () => {
  const rot = Math.PI / 6
  const mats = [
    { a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0, length: 10 },
    { a: Math.cos(rot), b: -Math.sin(rot), c: Math.sin(rot), d: Math.cos(rot), worldX: 10, worldY: 20, length: 30 }
  ]
  const world = [50, 60, -5, 12]
  const weights = new Float64Array([0.6, 0.4, 0, 1])
  const enc = W.weightedVertices(world, weights, [0, 1], mats)
  const dec = W.decodeWeighted(enc, 2)
  assert.equal(dec[0].length, 2); assert.equal(dec[1].length, 1); assert.equal(dec[1][0].bone, 1)
  for (let i = 0; i < 2; i++) {
    let x = 0, y = 0
    for (const e of dec[i]) { const m = mats[e.bone]; x += (m.a * e.x + m.b * e.y + m.worldX) * e.w; y += (m.c * e.x + m.d * e.y + m.worldY) * e.w }
    assert.ok(Math.abs(x - world[2 * i]) < 1e-3 && Math.abs(y - world[2 * i + 1]) < 1e-3)
  }
  const seg = W.boneSegment(mats[1])
  assert.ok(Math.abs(seg.bx - (10 + 30 * Math.cos(rot))) < 1e-9 && Math.abs(seg.by - (20 + 30 * Math.sin(rot))) < 1e-9)
})
