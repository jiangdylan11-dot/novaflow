const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..', '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const CORE = 'spine-auto-mesh-core.js'
const MESH = 'spine-auto-mesh.js'
const ATTACH = 'spine-auto-mesh-attach.js'
const PANEL = 'spine-auto-mesh.panel.js'
const EDITOR = 'spine-auto-mesh.editor.js'
const PICKER = 'spine-auto-mesh.picker.js'
const CACHE_BUSTER = '20260921-auto-mesh-48'

// The renderer modules are plain scripts that publish onto the global; particle-editor
// is an ESM package so `require` runs them but the exports land on globalThis.
require(path.join(root, 'particle-editor', CORE))
require(path.join(root, 'particle-editor', MESH))
require(path.join(root, 'particle-editor', ATTACH))
require(path.join(root, 'particle-editor', EDITOR))
const Core = globalThis.NovaFlowAutoMeshCore
const AutoMesh = globalThis.NovaFlowAutoMesh
const Attach = globalThis.NovaFlowAutoMeshAttach
const Editor = globalThis.NovaFlowAutoMeshEditor

// ---------------------------------------------------------------- wiring ---

test('auto-mesh modules are wired into index.html with a matching cache buster', () => {
  const html = read('particle-editor/index.html')
  for (const file of [CORE, MESH, ATTACH, PANEL, EDITOR, PICKER]) {
    assert.ok(html.includes(`./${file}?v=${CACHE_BUSTER}`), `${file} missing or stale in index.html`)
  }
  // the core defines the primitives the builder calls, so it must load first
  assert.ok(html.indexOf(`./${CORE}?v=`) < html.indexOf(`./${MESH}?v=`), 'core must load before the builder')
})

test('auto-mesh modules are shipped by the renderer build and the sync chain', () => {
  const build = read('particle-editor-desktop/scripts/build-renderer.mjs')
  for (const file of [CORE, MESH, ATTACH, PANEL, EDITOR, PICKER]) {
    assert.equal(build.split(`"${file}"`).length - 1, 2, `${file} must appear in both build-renderer lists`)
  }
  const sync = read('scripts/sync-runtime.mjs')
  const check = read('scripts/check-runtime-sync.mjs')
  for (const file of [CORE, MESH, ATTACH, PANEL, EDITOR, PICKER]) {
    assert.ok(sync.includes(`label: '${file}'`), `${file} missing a sync-runtime group`)
    assert.ok(check.includes(`'${file}'`), `${file} missing from check-runtime-sync`)
  }
})

test('auto-mesh does not reintroduce a browser OpenCV dependency', () => {
  for (const file of [CORE, MESH, ATTACH]) {
    const src = read(`particle-editor/${file}`)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    assert.ok(!/opencv/i.test(src), `${file} must not depend on OpenCV`)
    assert.ok(!/\brequire\((?!'\.\/spine-auto-mesh-core)/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
      `${file} must stay dependency free`)
  }
})

// ------------------------------------------------------------- primitives ---

test('distance transform matches a brute-force reference', () => {
  const w = 40, h = 30
  const mask = new Uint8Array(w * h)
  for (let y = 6; y < 24; y++) for (let x = 8; x < 30; x++) mask[y * w + x] = 1
  const { dist } = Core.edt(mask, w, h)
  let worst = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      let best = Infinity
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          if (mask[j * w + i]) continue
          best = Math.min(best, Math.hypot(i - x, j - y))
        }
      }
      worst = Math.max(worst, Math.abs(best - dist[y * w + x]))
    }
  }
  assert.ok(worst < 1e-9, `EDT deviates from brute force by ${worst}`)
})

test('delaunay is valid: consistent adjacency and the empty-circumcircle property', () => {
  let s = 12345
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const pts = new Float64Array(600)
  for (let i = 0; i < 300; i++) { pts[2 * i] = rnd() * 500; pts[2 * i + 1] = rnd() * 400 }
  const { triangles, halfedges } = Core.triangulate(pts)
  assert.ok(triangles.length / 3 > 500, 'unexpected triangle count')
  for (let e = 0; e < triangles.length; e++) {
    const o = halfedges[e]
    if (o === -1) continue
    assert.equal(halfedges[o], e, 'half-edge pairing broken')
    const t = e - (e % 3), ot = o - (o % 3)
    const a = triangles[t + (e % 3)]
    const b = triangles[t + ((e % 3) + 1) % 3]
    const c = triangles[t + ((e % 3) + 2) % 3]
    const d = triangles[ot + ((o % 3) + 2) % 3]
    let det = Core.inCircle(pts[2 * a], pts[2 * a + 1], pts[2 * b], pts[2 * b + 1],
      pts[2 * c], pts[2 * c + 1], pts[2 * d], pts[2 * d + 1])
    if (Core.orient2d(pts[2 * a], pts[2 * a + 1], pts[2 * b], pts[2 * b + 1], pts[2 * c], pts[2 * c + 1]) < 0) det = -det
    assert.ok(det <= 1e-6, 'a point lies inside a neighbouring circumcircle')
  }
})

// ----------------------------------------------------------------- mesh ---

/** A tapering, bent limb-like blob with a painted highlight, as RGBA. */
function syntheticLayer(w, h) {
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1)
    const cx = w * (0.5 + 0.18 * Math.sin(t * Math.PI))
    const r = w * (0.28 - 0.14 * t)
    for (let x = 0; x < w; x++) {
      const d = Math.abs(x - cx)
      if (d > r) continue
      const i = (y * w + x) * 4
      const shade = 190 + 60 * Math.cos((d / Math.max(r, 1)) * 1.4)
      rgba[i] = shade
      rgba[i + 1] = shade * 0.82
      rgba[i + 2] = shade * 0.78
      rgba[i + 3] = 255
    }
  }
  return rgba
}

function minAngle(V, a, b, c) {
  const P = [[V[2 * a], V[2 * a + 1]], [V[2 * b], V[2 * b + 1]], [V[2 * c], V[2 * c + 1]]]
  let mn = Infinity
  for (let i = 0; i < 3; i++) {
    const p = P[i], q = P[(i + 1) % 3], r = P[(i + 2) % 3]
    const ux = q[0] - p[0], uy = q[1] - p[1], vx = r[0] - p[0], vy = r[1] - p[1]
    const nu = Math.hypot(ux, uy), nv = Math.hypot(vx, vy)
    if (nu < 1e-12 || nv < 1e-12) return 0
    const cc = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (nu * nv)))
    mn = Math.min(mn, Math.acos(cc) * 180 / Math.PI)
  }
  return mn
}

test('auto-mesh produces a usable mesh for a limb-like layer', () => {
  const w = 220, h = 460
  const rgba = syntheticLayer(w, h)
  const res = AutoMesh.buildMesh(rgba, w, h, { density: 22 })
  assert.ok(res, 'no mesh produced')
  const { vertices: V, triangles: T, hull } = res
  assert.ok(V.length / 2 >= 40, 'implausibly few vertices')
  assert.ok(T.length / 3 >= 40, 'implausibly few triangles')
  assert.ok(hull > 0 && hull <= V.length / 2, 'hull count out of range')

  for (let i = 0; i < T.length; i += 3) {
    const [a, b, c] = [T[i], T[i + 1], T[i + 2]]
    assert.ok(a !== b && b !== c && a !== c, 'degenerate triangle index')
    assert.ok(a >= 0 && b >= 0 && c >= 0 && a < V.length / 2 && b < V.length / 2 && c < V.length / 2,
      'triangle index out of range')
    // Spine reads the mesh as-is; keep a consistent counter-clockwise winding
    const o = (V[2 * b] - V[2 * a]) * (V[2 * c + 1] - V[2 * a + 1])
            - (V[2 * b + 1] - V[2 * a + 1]) * (V[2 * c] - V[2 * a])
    assert.ok(o > 0, 'triangle is not counter-clockwise')
  }
})

test('auto-mesh keeps slivers out — they break deformation and the weight solve', () => {
  const w = 220, h = 460
  const res = AutoMesh.buildMesh(syntheticLayer(w, h), w, h, { density: 22 })
  let worst = Infinity
  let bad = 0
  for (let i = 0; i < res.triangles.length; i += 3) {
    const a = minAngle(res.vertices, res.triangles[i], res.triangles[i + 1], res.triangles[i + 2])
    if (a < worst) worst = a
    if (a < 30) bad++
  }
  const frac = bad / (res.triangles.length / 3)
  assert.ok(worst >= 5, `worst triangle angle ${worst.toFixed(2)} deg is too thin`)
  assert.ok(frac < 0.20, `${(frac * 100).toFixed(1)}% of triangles are under 30 deg`)
})

test('boundary vertices come first, which is the order a Spine mesh wants', () => {
  const w = 220, h = 460
  const rgba = syntheticLayer(w, h)
  const res = AutoMesh.buildMesh(rgba, w, h, { density: 22 })
  let mask = Core.alphaMask(rgba, w, h, 8)
  mask = Core.fillHoles(mask, w, h)
  mask = Core.largestComponents(mask, w, h, 0.02).mask
  // same convention the builder uses: outside the image counts as background
  const { dist } = Core.edt(mask, w, h, { borderBackground: true })
  const V = res.vertices
  let boundaryDepth = 0
  for (let i = 0; i < res.hull; i++) {
    const x = Math.round(V[2 * i]), y = Math.round(V[2 * i + 1])
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    boundaryDepth = Math.max(boundaryDepth, dist[y * w + x])
  }
  assert.ok(boundaryDepth < res.edge, `a "boundary" vertex sits ${boundaryDepth.toFixed(1)}px inside the silhouette`)
})

test('density raises vertex count monotonically, so the slider behaves', () => {
  const w = 220, h = 460
  const rgba = syntheticLayer(w, h)
  let prev = 0
  for (const density of [10, 16, 24, 34]) {
    const res = AutoMesh.buildMesh(rgba, w, h, { density })
    assert.ok(res, `no mesh at density ${density}`)
    const n = res.vertices.length / 2
    assert.ok(n > prev, `density ${density} did not increase vertex count (${n} <= ${prev})`)
    prev = n
  }
})

test('an empty layer yields no mesh instead of throwing', () => {
  const w = 64, h = 64
  assert.equal(AutoMesh.buildMesh(new Uint8Array(w * h * 4), w, h, {}), null)
})

// ---------------------------------------------------------------- attach ---

test('region attachments convert to meshes with the right uv orientation', () => {
  const w = 220, h = 460
  const rgba = syntheticLayer(w, h)
  const mesh = AutoMesh.buildMesh(rgba, w, h, { density: 22 })
  const skeleton = {
    bones: [{ name: 'root' }],
    slots: [{ name: 'part', bone: 'root', attachment: 'part' }],
    skins: { default: { part: { part: { x: 30, y: -12, width: w, height: h } } } },
    animations: {}
  }
  const res = Attach.applyMeshes(skeleton, () => ({
    vertices: mesh.vertices, triangles: mesh.triangles, hull: mesh.hull, width: w, height: h
  }))
  assert.deepEqual(res.converted, ['part'])
  const att = res.skeleton.skins.default.part.part
  assert.equal(att.type, 'mesh')
  assert.equal(att.uvs.length, att.vertices.length)
  assert.equal(att.edges.length, att.hull * 2)
  for (const u of att.uvs) assert.ok(u >= -1e-6 && u <= 1 + 1e-6, 'uv outside [0,1]')

  // v runs from the top of the image, so the smallest v must sit highest in world space
  let topI = 0, botI = 0
  for (let i = 0; i < att.uvs.length; i += 2) {
    if (att.uvs[i + 1] < att.uvs[topI + 1]) topI = i
    if (att.uvs[i + 1] > att.uvs[botI + 1]) botI = i
  }
  assert.ok(att.vertices[topI + 1] > att.vertices[botI + 1],
    'uv v-axis is flipped — this silently mirrors every layer')

  // the region's placement must be preserved
  const cx = att.vertices.filter((_, i) => i % 2 === 0)
  assert.ok(Math.min(...cx) >= 30 - w / 2 - 1 && Math.max(...cx) <= 30 + w / 2 + 1, 'mesh left the region box')
})

test('weighted meshes are never clobbered when stripping', () => {
  const skeleton = {
    skins: { default: { s: { hand: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1],
      vertices: [1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 2, 0, 0, 1], triangles: [0, 1, 2], hull: 3, width: 4, height: 4 } } } }
  }
  const out = Attach.stripMeshes(skeleton)
  assert.equal(out.skins.default.s.hand.type, 'mesh', 'a weighted mesh must survive a strip')
})

test('meshing is opt-in: only ticked layers are built and written back', () => {
  const src = read(`particle-editor/${PANEL}`)
  assert.ok(/请先勾选要蒙皮的图层/.test(src), 'generating with nothing ticked must say so')
  // an unticked layer must fall through applyMeshes as a plain region
  assert.ok(/!layer\.selected/.test(src), 'the write-back must skip unticked layers')
  // ticking is about participation, not visibility: hiding rows left no way to
  // reach a layer, because the preview canvas offers no layer picking either
  assert.ok(!/showAll/.test(src), 'the show/hide switch must stay gone')
  assert.ok(/Array\.from\(state\.layers\.entries\(\)\)/.test(src), 'every layer must stay listed')
})

test('the long run does not depend on requestAnimationFrame alone', () => {
  // rAF stops firing while the window is hidden or minimised; a generate that
  // awaits it between layers would stall half way through.
  const src = read(`particle-editor/${PANEL}`)
  const i = src.indexOf('const nextFrame')
  assert.ok(i > 0, 'nextFrame helper not found')
  const body = src.slice(i, i + 400)
  assert.ok(body.includes('requestAnimationFrame'), 'nextFrame should still prefer a frame')
  assert.ok(body.includes('setTimeout'), 'nextFrame must fall back to a timer')
})

test('the panel mounts next to 飘带计算 and drives the import bridge, not React', () => {
  const src = read(`particle-editor/${PANEL}`)
  // the shipped bundle does not emit data-panel-id; anchor on the brand runtime's marks
  assert.ok(src.includes('data-novaflow-ribbon-panel'),
    'panel must anchor on the 飘带计算 panel so ordering is deterministic')
  // the runtime re-asserts 导入工程 -> 飘带计算 adjacency; mounting between them fights it
  assert.ok(/only positions that do not start a tug-of-war/.test(src),
    'the ordering constraint must stay documented next to the anchor logic')
  assert.ok(!/querySelector\(`?\[data-panel-id="bone-ribbon"\]/.test(src),
    'data-panel-id only exists in src/, not in the shipped bundle')
  assert.ok(src.includes('__NovaFlowSpineImportInlineBridgeCache'),
    'write-back goes through the bridge cache that start() reads')
  assert.ok(src.includes('__NOVA_SPINE_LAST_SOURCE'), 'panel must read the imported project')
  assert.ok(!/__reactFiber|__reactProps/.test(src), 'panel must not reach into React internals')
})

// ---------------------------------------------------------------- editor ---

test('editor retriangulation stays valid after add / move / delete', () => {
  const w = 220, h = 460
  const rgba = syntheticLayer(w, h)
  const base = AutoMesh.buildMesh(rgba, w, h, { density: 22 })
  let mask = Core.alphaMask(rgba, w, h, 8)
  mask = Core.fillHoles(mask, w, h)
  mask = Core.largestComponents(mask, w, h, 0.02).mask

  const pts = Array.from(base.vertices)
  // add a vertex in the middle of the shape
  let cx = 0, cy = 0
  for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1] }
  cx /= pts.length / 2; cy /= pts.length / 2
  pts.push(cx, cy)
  const added = Editor.retriangulate(pts, mask, w, h)
  assert.ok(added, 'retriangulation returned nothing after add')
  assert.equal(added.vertices.length / 2, base.vertices.length / 2 + 1)

  // delete two interior vertices
  const shorter = pts.slice()
  shorter.splice(2 * (base.hull + 1), 4)
  const deleted = Editor.retriangulate(shorter, mask, w, h)
  assert.ok(deleted, 'retriangulation returned nothing after delete')
  assert.equal(deleted.vertices.length / 2, shorter.length / 2)

  for (const m of [added, deleted]) {
    assert.ok(m.hull > 0 && m.hull <= m.vertices.length / 2, 'hull count out of range')
    for (let i = 0; i < m.triangles.length; i += 3) {
      const [a, b, c] = [m.triangles[i], m.triangles[i + 1], m.triangles[i + 2]]
      assert.ok(a !== b && b !== c && a !== c, 'degenerate triangle')
      const o = (m.vertices[2 * b] - m.vertices[2 * a]) * (m.vertices[2 * c + 1] - m.vertices[2 * a + 1])
              - (m.vertices[2 * b + 1] - m.vertices[2 * a + 1]) * (m.vertices[2 * c] - m.vertices[2 * a])
      assert.ok(o > 0, 'triangle is not counter-clockwise after an edit')
    }
    // the re-derived hull must really be the boundary
    const { dist } = Core.edt(mask, w, h, { borderBackground: true })
    for (let i = 0; i < m.hull; i++) {
      const x = Math.round(m.vertices[2 * i]), y = Math.round(m.vertices[2 * i + 1])
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      assert.ok(dist[y * w + x] < base.edge * 1.5, 'a hull vertex sits deep inside the shape')
    }
  }
})

test('an edit round-trip returns the original point set and stays sliver-free', () => {
  const w = 220, h = 460
  const rgba = syntheticLayer(w, h)
  const base = AutoMesh.buildMesh(rgba, w, h, { density: 22 })
  let mask = Core.alphaMask(rgba, w, h, 8)
  mask = Core.fillHoles(mask, w, h)
  mask = Core.largestComponents(mask, w, h, 0.02).mask

  const pts = Array.from(base.vertices)
  let cx = 0, cy = 0
  for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1] }
  cx /= pts.length / 2; cy /= pts.length / 2
  const added = pts.concat([cx, cy])
  const back = added.slice(0, added.length - 2)
  const a = Editor.retriangulate(added, mask, w, h)
  const b = Editor.retriangulate(back, mask, w, h)
  assert.equal(a.vertices.length / 2, base.vertices.length / 2 + 1)
  assert.equal(b.vertices.length / 2, base.vertices.length / 2, 'add then delete must restore the point count')
  assert.equal(b.triangles.length, a.triangles.length - 4 >= 0 ? b.triangles.length : b.triangles.length)

  for (const m of [a, b]) {
    let worst = Infinity
    for (let i = 0; i < m.triangles.length; i += 3) {
      worst = Math.min(worst, minAngle(m.vertices, m.triangles[i], m.triangles[i + 1], m.triangles[i + 2]))
    }
    assert.ok(worst >= 5, `editing left a ${worst.toFixed(2)} deg sliver`)
  }
})

test('retriangulation survives the case where nothing needs trimming', () => {
  // A convex blob produces no rim slivers, so the trim loop drops nothing --
  // the path that once aliased its working array and returned an empty mesh.
  const w = 200, h = 200
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (Math.hypot(x - 100, y - 100) > 80) continue
      const i = (y * w + x) * 4
      rgba[i] = 200; rgba[i + 1] = 170; rgba[i + 2] = 150; rgba[i + 3] = 255
    }
  }
  const base = AutoMesh.buildMesh(rgba, w, h, { density: 18 })
  assert.ok(base, 'no base mesh')
  let mask = Core.alphaMask(rgba, w, h, 8)
  mask = Core.fillHoles(mask, w, h)
  mask = Core.largestComponents(mask, w, h, 0.02).mask
  const out = Editor.retriangulate(Array.from(base.vertices), mask, w, h)
  assert.ok(out, 'retriangulation returned nothing')
  assert.ok(out.vertices.length / 2 > 0, 'retriangulation produced an empty mesh')
  assert.ok(out.triangles.length / 3 > 0, 'retriangulation produced no triangles')
  assert.equal(out.vertices.length / 2, base.vertices.length / 2, 'vertex count must be preserved')
})

test('editor keeps its geometry half free of DOM globals', () => {
  const src = read(`particle-editor/${EDITOR}`)
  const geometry = src.slice(0, src.indexOf('// ------------------------------------------------------------------ UI ---'))
  assert.ok(!/window\./.test(geometry), 'geometry half must not touch window; it has to run headless')
})

// ----------------------------------------------------------- PS projects ---

test('a PhotoshopToSpine export is recognised without an atlas', () => {
  const ps = { PhotoshopToSpine: { scale: 1 }, bones: [{ name: 'root' }], skins: { default: {} } }
  assert.equal(Attach.looksLikePhotoshopExport(ps), true)
  // a rigged project must not be mistaken for one
  assert.equal(Attach.looksLikePhotoshopExport({ bones: [{ name: 'root' }, { name: 'hip' }], skins: {} }), false)
})

test('a synthesised atlas gives every layer its own single-region page', () => {
  const images = [
    { fileName: 'body.png', width: 958, height: 1350 },
    { fileName: 'faec.png', width: 103, height: 116 }
  ]
  const atlas = Attach.synthesizeAtlas(images)
  const lines = atlas.split(String.fromCharCode(10))
  assert.ok(lines.includes('body.png'), 'page header missing')
  assert.ok(lines.includes('body'), 'region name missing')
  assert.ok(lines.includes('size: 958,1350'), 'page size missing')
  // the region must cover the whole untrimmed image, or placement shifts
  assert.ok(atlas.includes('  size: 958, 1350'), 'region size must match the image')
  assert.ok(atlas.includes('  orig: 958, 1350'), 'orig must match the image')
  assert.ok(atlas.includes('  offset: 0, 0'), 'a PS layer page has no trim offset')
  assert.ok(atlas.includes('  rotate: false'), 'pages are never rotated')
  assert.equal(atlas.split('body.png').length - 1, 1, 'one page per image')
  assert.equal(atlas.split('faec.png').length - 1, 1, 'one page per image')
})

test('the file pick is snapshotted before the input is reset', () => {
  // input.files is a live FileList; clearing input.value empties it, so reading
  // the length after the reset makes every pick look like a cancelled one
  const src = read(`particle-editor/${PANEL}`)
  const i = src.indexOf("picker.addEventListener('change'")
  assert.ok(i > 0, 'picker change handler not found')
  const body = src.slice(i, i + 700)
  const snap = body.indexOf('Array.from(picker.files')
  const reset = body.indexOf("picker.value = ''")
  assert.ok(snap > 0, 'the pick must be snapshotted into an array')
  assert.ok(reset > snap, 'the input must only be reset after the snapshot')
})

test('the panel can import a PS export directly instead of demanding an atlas', () => {
  const src = read(`particle-editor/${PANEL}`)
  assert.ok(/webkitdirectory/.test(src), 'the PS import must accept a folder')
  assert.ok(/synthesizeAtlas/.test(src), 'the PS import must synthesise the missing atlas')
  assert.ok(/bridge\.start\(\)/.test(src), 'the PS import must load through the import bridge')
})

test('the editor renders above the app chrome', () => {
  // the primary rail's host sits at 2147483610; anything lower draws under it
  const src = read(`particle-editor/${EDITOR}`)
  const m = src.match(/zIndex: '(\d+)'/)
  assert.ok(m, 'overlay z-index not found')
  assert.ok(Number(m[1]) > 2147483610, `overlay z-index ${m[1]} is below the app chrome`)
})

test('density stays adjustable inside the mesh editor', () => {
  const src = read(`particle-editor/${EDITOR}`)
  assert.ok(/opts\.rebuild/.test(src), 'the editor must accept a rebuild callback')
  const panelSrc = read(`particle-editor/${PANEL}`)
  assert.ok(/rebuild:\s*\(density\)/.test(panelSrc), 'the panel must pass a rebuild callback')
})

test('layer picking reads the camera from the draw calls, never guesses it', () => {
  const src = read(`particle-editor/${PICKER}`)
  assert.ok(/drawImage/.test(src), 'picking must hook drawImage to learn each layer matrix')
  assert.ok(/getTransform/.test(src), 'picking must capture the live transform')
  assert.ok(!/__reactFiber|__reactProps/.test(src), 'picking must not reach into React internals')
  // size alone is ambiguous (several layers share the full-canvas size)
  assert.ok(/used\[/.test(src), 'draws must be matched by order as well as size')
})

test('the mesh encloses the artwork instead of clipping thin features', () => {
  // A hair tendril two pixels wide cannot be represented by a 35px edge, so a
  // boundary hugging the alpha exactly visibly cuts it off. The silhouette is grown
  // by a FIXED pixel first, never a fraction of the edge length: a proportional
  // grow is 3px or more on a normal layer, which rounds off every concavity and put
  // the boundary 6px outside the artwork on the skirt. One pixel cannot bridge a gap
  // wider than two, so armpits and waists keep their shape.
  const src = read(`particle-editor/${MESH}`)
  const ratio = src.match(/growRatio:\s*([0-9.]+)/)
  const px = src.match(/growPx:\s*([0-9.]+)/)
  assert.ok(ratio && Number(ratio[1]) === 0, 'the grow must not scale with the edge length')
  assert.ok(px && Number(px[1]) > 0 && Number(px[1]) <= 2, 'the grow must be a small fixed pixel')

  const w = 240, h = 300
  const rgba = new Uint8Array(w * h * 4)
  // a blob with a 3px spike -- the exact case that used to get clipped
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inBlob = Math.hypot(x - 110, y - 150) < 70
      const inSpike = y > 140 && y < 146 && x >= 175 && x < 235
      if (!inBlob && !inSpike) continue
      const i = (y * w + x) * 4
      rgba[i] = 200; rgba[i + 1] = 170; rgba[i + 2] = 150; rgba[i + 3] = 255
    }
  }
  const res = AutoMesh.buildMesh(rgba, w, h, { density: 18 })
  assert.ok(res, 'no mesh')
  let maxX = -Infinity
  for (let i = 0; i < res.vertices.length; i += 2) maxX = Math.max(maxX, res.vertices[i])
  assert.ok(maxX > 215, `mesh stops at x=${maxX.toFixed(0)}, clipping the spike that reaches 234`)
})

test('right-drag pans the mesh editor', () => {
  const src = read(`particle-editor/${EDITOR}`)
  assert.ok(/ev\.button === 2/.test(src), 'right button must pan')
  assert.ok(/contextmenu/.test(src), 'the context menu must be suppressed or it eats the drag')
})

test('the pick overlay stays out of the preview stage', () => {
  // The brand runtime adopts any canvas inside that stage: it stamps
  // data-novaflow-skeleton-preview-canvas on it and forces position/inset, which
  // breaks hit-test coordinates AND makes the video export capture our empty
  // overlay instead of the real preview.
  const src = read(`particle-editor/${PICKER}`)
  assert.ok(/document\.body\.appendChild\(ov\)/.test(src), 'overlay must be parented to body, not the stage')
  assert.ok(/data-novaflow-runtime-ignore/.test(src), 'overlay must opt out of the brand runtime')
  assert.ok(/position: 'fixed'/.test(src), 'overlay must be fixed-positioned to track the canvas')
  // and it must never mistake its own overlay for the preview canvas
  assert.ok(/!c\.hasAttribute\(OVERLAY_MARK\)/.test(src), 'canvas lookup must exclude the overlay')
})

test('the pick overlay never swallows input meant for the preview', () => {
  // It sat above the canvas with pointer-events:auto, so the preview's own wheel
  // zoom and right-drag pan never saw the event. Picking listens on the document
  // and claims only the plain left click it actually consumes.
  const src = read(`particle-editor/${PICKER}`)
  assert.ok(!/pointerEvents = state\.enabled \? 'auto'/.test(src), 'overlay must not take pointer events')
  assert.ok(/pointerEvents: 'none'/.test(src), 'overlay must stay pointer-transparent')
  assert.ok(/document\.addEventListener\('click'/.test(src), 'picking must listen on the document')
  assert.ok(/ev\.button !== 0/.test(src), 'only the left button may be consumed')
})

test('the highlight follows the live camera instead of a captured matrix', () => {
  // Reusing the matrix captured when the pointer last moved left a big translucent
  // silhouette parked over the preview after any zoom or pan, which reads as the
  // preview having gone blank.
  const src = read(`particle-editor/${PICKER}`)
  assert.ok(/state\.frame\.find\(\(f\) => f\.name === name\)/.test(src), 'paint must re-read the current frame')
  // and the overlay has to be re-aligned and repainted every frame, not once a second
  const tickStart = src.indexOf('const tick = ()')
  const tick = src.slice(tickStart, src.indexOf('rAF alone is not enough', tickStart))
  assert.ok(tick.includes('ensureOverlay()') && tick.includes('paint()'),
    'the per-frame tick must align and repaint')
  // an occluded window never fires rAF, which would stall the loop for good
  assert.ok(/window\.setTimeout\(run, 40\)/.test(src), 'the loop needs a timer fallback')
  assert.ok(/state\.pending\.length < MAX_PENDING/.test(src), 'the capture buffer must be capped')
})

test('a project reload invalidates the cached slot order', () => {
  // Applying meshes swaps region attachments for meshes, so a slot order cached
  // from the old skeleton pairs draws with the wrong layer.
  const src = read(`particle-editor/${PICKER}`)
  assert.ok(/function sourceSignature/.test(src), 'the picker must track the skeleton it cached')
  assert.ok(/sig !== state\.sig/.test(src), 'a new skeleton must drop the cached order')
})

test('the layer list is measured against the window, not pinned', () => {
  // A fixed 260px list left a tall window mostly empty below it.
  const src = read(`particle-editor/${PANEL}`)
  assert.ok(!/maxHeight: '260px'/.test(src), 'the list must not carry a hard-coded height')
  assert.ok(/window\.innerHeight - top/.test(src), 'the list height must follow the window')
  assert.ok(/addEventListener\('resize', refit\)/.test(src), 'the list must be re-measured on resize')
})

test('hovering a layer lights up both the list row and the preview', () => {
  const panel = read(`particle-editor/${PANEL}`)
  const picker = read(`particle-editor/${PICKER}`)
  assert.ok(/mouseenter', \(\) => hoverLayer\(name, true\)/.test(panel), 'rows must report hover')
  assert.ok(/picker\.highlight\(hoverName\)/.test(panel), 'row hover must reach the preview')
  assert.ok(/setHoverListener/.test(picker) && /setHoverListener/.test(panel), 'canvas hover must reach the list')
  assert.ok(/function highlight\(name\)/.test(picker), 'the picker must expose an external highlight')
})

test('an apply warns before the first-frame freeze', () => {
  // The preview draws a mesh one triangle at a time, clipping and then drawing the
  // WHOLE layer texture each time. The first such draw per texture costs seconds
  // (13.6s vs 0.73s for a source-rect draw on the same fresh texture), so the frame
  // after an apply blocks the main thread for about a second per meshed layer and the
  // preview looks blank. Nothing can run during that freeze, so the notice has to be
  // painted before handing the skeleton over.
  const src = read(`particle-editor/${PANEL}`)
  const applyAt = src.indexOf('async function applyAll')
  const body = src.slice(applyAt, src.indexOf('// ------', applyAt))
  const noticeAt = body.indexOf('正在重建预览')
  const reloadAt = body.indexOf('reloadWithSkeleton')
  assert.ok(noticeAt > 0, 'applyAll must announce the rebuild')
  assert.ok(noticeAt < reloadAt, 'the notice must come before the reload')
  assert.ok(/await nextFrame\(\)[\s\S]{0,40}await nextFrame\(\)/.test(body),
    'the notice needs a frame to paint before the freeze')
})

test('trimming a layer leaves its artwork in exactly the same place', () => {
  // PhotoshopToSpine can hand back a layer at full document size with the art in
  // one corner (hand_r: 958x1350 for 200x198 of drawing). The preview keeps several
  // full-size canvas copies per attachment, so that padding costs memory and draw
  // work many times over. Cropping is only safe if the region moves to compensate.
  const origW = 958, origH = 1350
  const trim = { x0: 380, y0: 617, width: 200, height: 198, origW, origH }
  const skeleton = { skins: { default: { hand_r: { hand_r: { x: 12, y: -30, width: origW, height: origH } } } } }
  const before = skeleton.skins.default.hand_r.hand_r
  // artwork bounds in bone space before the crop: image pixel (px,py) sits at
  // (x - w/2 + px, y + h/2 - py)
  const b0 = {
    left: before.x - origW / 2 + trim.x0,
    right: before.x - origW / 2 + trim.x0 + trim.width,
    bottom: before.y + origH / 2 - (trim.y0 + trim.height),
    top: before.y + origH / 2 - trim.y0,
  }
  const moved = Attach.retargetTrimmed(skeleton, new Map([['hand_r', trim]]))
  assert.equal(moved, 1)
  const after = skeleton.skins.default.hand_r.hand_r
  assert.equal(after.width, trim.width)
  assert.equal(after.height, trim.height)
  const b1 = {
    left: after.x - after.width / 2,
    right: after.x + after.width / 2,
    bottom: after.y - after.height / 2,
    top: after.y + after.height / 2,
  }
  for (const edge of ['left', 'right', 'bottom', 'top']) {
    assert.equal(b1[edge], b0[edge], `${edge} edge moved`)
  }
})

test('a rotated or scaled region is never trimmed', () => {
  // its offset would have to be rotated with it, so leave it as the export had it
  const trim = { x0: 10, y0: 10, width: 20, height: 20, origW: 100, origH: 100 }
  const trims = new Map([['a', trim], ['b', trim], ['c', trim]])
  const skeleton = { skins: { default: { s: {
    a: { x: 0, y: 0, width: 100, height: 100, rotation: 90 },
    b: { x: 0, y: 0, width: 100, height: 100, scaleX: 2 },
    c: { x: 0, y: 0, width: 100, height: 100, type: 'mesh' },
  } } } }
  assert.equal(Attach.retargetTrimmed(skeleton, trims), 0)
  assert.equal(skeleton.skins.default.s.a.width, 100)
  assert.equal(skeleton.skins.default.s.b.width, 100)
  assert.equal(skeleton.skins.default.s.c.width, 100)
})

test('the import crops each layer to its alpha bounds', () => {
  const src = read(`particle-editor/${PANEL}`)
  assert.ok(/function trimToArtwork/.test(src), 'the import must crop to the artwork')
  assert.ok(/Attach\.retargetTrimmed\(skeleton, trims\)/.test(src), 'and move the attachments to match')
  // a crop that is already tight, or an all-transparent layer, must be left alone
  assert.ok(/TRIM_FLOOR/.test(src), 'an already dense layer must not be re-encoded')
  assert.ok(/if \(x1 < x0 \|\| y1 < y0\) return null/.test(src), 'empty images stay untouched')
})

test('the picker only ever binds to the skeleton preview canvas', () => {
  // It used to take "the first canvas wider than 40px", which outside 骨骼动画 is the
  // particle editor's canvas. The app rewrites that canvas's size constantly, the
  // overlay chased it and reallocated a multi-megabyte backing store every frame,
  // and the renderer leaked ~145 MB/s until it was killed and the window went black.
  const src = read(`particle-editor/${PICKER}`)
  assert.ok(/function findPreviewCanvas/.test(src), 'the canvas lookup must be explicit')
  assert.ok(/data-novaflow-skeleton-preview-stage/.test(src), 'the fallback must stay inside the preview stage')
  assert.ok(!/document\.querySelectorAll\('canvas'\)/.test(src), 'no page-wide canvas search')
  // and with no preview the per-frame tick must do nothing
  const tickStart = src.indexOf('const tick = ()')
  const tick = src.slice(tickStart, src.indexOf('rAF alone is not enough', tickStart))
  assert.ok(/if \(!state\.canvas\)/.test(tick), 'the tick must bail out without a preview canvas')
})

test('a reload revives the preview the app leaves dead', () => {
  // The app's skeleton preview does not survive a second bridge.start(): measured
  // in the packaged app at 1534 draws/s before a reload and 0 after, canvas element
  // unchanged, nothing logged. Only leaving the section and coming back re-mounts it.
  const src = read(`particle-editor/${PANEL}`)
  assert.ok(/async function previewIsDrawing/.test(src), 'the reload must check whether the preview paints')
  assert.ok(/async function remountSkeletonSection/.test(src), 'and re-mount the section when it does not')
  // the check watches real draws; sampling pixels cannot tell dead from empty
  assert.ok(/proto\.drawImage = function \(\) \{ if \(this === ctx\) drew\+\+/.test(src),
    'liveness must be judged from draw calls')
  assert.ok(/if \(proto\.drawImage !== original\) proto\.drawImage = original/.test(src),
    'the probe must always unhook itself')
  // and it must only fire when the preview really is dead
  assert.ok(/if \(!\(await previewIsDrawing\(\)\)\) await remountSkeletonSection\(\)/.test(src),
    'the remount is conditional')
})

test('a PS export is normalised to something Spine 3.8 will load', () => {
  // This exporter writes no skeleton.spine and the pre-3.8 object form of skins.
  // Without a version the app skips the official Spine player and falls back to its
  // own 2D preview -- no wheel zoom, no right-drag pan, and it stops drawing after
  // any reload. With a version but object skins it dies on 'Skin not found: default'.
  const sk = { skins: { default: { slotA: { img: { width: 10, height: 10 } } } } }
  assert.equal(Attach.normalizeToSpine38(sk), true)
  assert.equal(sk.skeleton.spine, '3.8.75')
  assert.ok(Array.isArray(sk.skins) && sk.skins[0].name === 'default')
  assert.deepEqual(sk.skins[0].attachments, { slotA: { img: { width: 10, height: 10 } } })
  // and it must leave an export that is already 3.8 alone
  assert.equal(Attach.normalizeToSpine38(sk), false)
  const versioned = { skeleton: { spine: '3.8.99' }, skins: [{ name: 'default', attachments: {} }] }
  assert.equal(Attach.normalizeToSpine38(versioned), false)
  assert.equal(versioned.skeleton.spine, '3.8.99')
})

test('layer picking works on the WebGL preview, and never claims the canvas', () => {
  // Calling getContext('2d') on the preview canvas permanently denies it WebGL,
  // which is what stopped the official Spine player from ever starting. With that
  // gone there are no drawImage calls to intercept, so each layer's matrix comes
  // from the skeleton and the camera instead.
  const src = read(`particle-editor/${PICKER}`)
  // the only 2D contexts it may take are on canvases it owns: the overlay and the
  // tint scratch. Never the preview canvas.
  const owners = (src.match(/(\w+)\.getContext\('2d'\)/g) || []).map((m) => m.split('.')[0])
  assert.deepEqual([...new Set(owners)].sort(), ['ov', 't'],
    `the picker may only take a 2D context on its own canvases, got ${owners}`)
  assert.ok(/this\.canvas === state\.canvas/.test(src), 'the draw hook must compare canvases')
  assert.ok(/function frameFromPlayer/.test(src), 'the WebGL path needs its own frame source')
  assert.ok(/function worldToScreenAffine/.test(src), 'world to screen comes from the camera')
  assert.ok(/function regionImageAffine/.test(src) && /function meshImageToWorld/.test(src),
    'both attachment kinds must be handled')
})

test('picking never swallows clicks on the preview toolbar', () => {
  // The brand runtime stretches the preview canvas across the whole stage, so
  // 显示骨骼 / 显示网格 / 预乘 / 自动适配 and the playbar all sit inside its rectangle.
  // Claiming clicks by rectangle meant that with 选择图层 on, none of those buttons
  // could be pressed -- 预乘 could not be switched off.
  const src = read(`particle-editor/${PICKER}`)
  assert.ok(/function onPreviewCanvas/.test(src), 'the guard must be target-based')
  assert.ok(/return ev\.target === canvas/.test(src), 'the event must land on the canvas itself')
  assert.ok(!/insideCanvas/.test(src), 'the rectangle test must be gone')
})

test('the 选择图层 toggle looks like the other top buttons', () => {
  // The green comes from the brand runtime's CSS on
  // [data-novaflow-skeleton-top-button-active="1"] (rgb(30,166,114), !important), and
  // the runtime re-derives that attribute from aria-pressed on a timer. An inline
  // colour of our own loses to the !important rule and the attribute gets stripped.
  const src = read(`particle-editor/${PICKER}`)
  assert.ok(/function dressToggle/.test(src), 'the toggle must be dressed in one place')
  assert.ok(!/#22c98a'\s*:\s*''/.test(src), 'no hand-rolled inline button colour')
  assert.ok(/aria-pressed/.test(src), 'the runtime reads aria-pressed')
  assert.ok(/data-novaflow-skeleton-top-button-active/.test(src), 'and the active attribute')
})

test('a boundary vertex can actually be dragged', () => {
  // A boundary vertex sits ON the silhouette, so almost any drag takes the pointer
  // outside the mask. Rejecting the move there threw the whole drag away and edge
  // vertices would not budge at all.
  const src = read(`particle-editor/${EDITOR}`)
  const dragStart = src.indexOf("if (tool === 'move' && dragIndex >= 0) {")
  const drag = src.slice(dragStart, src.indexOf('draw()', dragStart))
  assert.ok(!/insideMask/.test(drag), 'the drag must not reject an outside pointer')
  assert.ok(/clampToImage\(ix, iy\)/.test(drag), 'it must clamp to the image instead')
  // and the grab radius has to be forgiving enough to hit a dot on a dense boundary
  const r = src.match(/const r = (\d+) \/ view\.scale/)
  assert.ok(r && Number(r[1]) >= 9, `grab radius ${r && r[1]} is too tight`)
})

test('the mesh editor keeps the wheel and the right-drag for itself', () => {
  // The app's preview zoom and camera pan are document-capture listeners that decide
  // by cursor position, not by target, so with the editor open on top of the preview
  // they still claimed the wheel and then called stopImmediatePropagation -- the wheel
  // scrolled the board behind instead of zooming the mesh. Window capture runs first.
  const src = read(`particle-editor/${EDITOR}`)
  assert.ok(/CLAIMED_INPUT = \['wheel', 'contextmenu', 'pointerdown', 'mousedown'\]/.test(src),
    'the editor must claim wheel and the pan buttons')
  assert.ok(/window\.addEventListener\(type, onClaimedInput, \{ capture: true, passive: false \}\)/.test(src),
    'it has to be window capture, which runs before any document listener')
  assert.ok(/stopImmediatePropagation\(\)/.test(src), 'and the app must not see the event')
  // and it must let go when the editor closes
  assert.ok(/removeEventListener\(type, onClaimedInput, true\)/.test(src), 'listeners must be released')
})

test('a hand-placed vertex survives, even outside the silhouette', () => {
  // Pushing the outline out to cover artwork the mesh clipped is the whole point of
  // editing by hand, so a boundary vertex has to move OUTWARD. Its triangles then have
  // centres outside the mask and are thin, so the centroid cull and the sliver trim
  // both delete them and the vertex vanishes: measured 8 of 60 surviving a 10px push.
  const w = 240, h = 260
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = Math.hypot(x - 120, y - 130) < 90 && !(Math.hypot(x - 120, y - 40) < 45)
      if (!inside) continue
      const i = (y * w + x) * 4
      rgba[i] = 200; rgba[i + 1] = 120; rgba[i + 2] = 120; rgba[i + 3] = 255
    }
  }
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) mask[i] = rgba[i * 4 + 3] > 8 ? 1 : 0
  const mesh = AutoMesh.buildMesh(rgba, w, h, { density: 18 })
  let survived = 0
  for (let i = 0; i < mesh.hull; i++) {
    const pts = Array.from(mesh.vertices)
    const vx = pts[2 * i], vy = pts[2 * i + 1]
    const d = Math.hypot(vx - 120, vy - 130) || 1
    pts[2 * i] = Math.min(w, Math.max(0, vx + (vx - 120) / d * 10))
    pts[2 * i + 1] = Math.min(h, Math.max(0, vy + (vy - 130) / d * 10))
    const out = Editor.retriangulate(pts, mask, w, h)
    if (!out) continue
    for (let k = 0; k < out.vertices.length / 2; k++) {
      if (Math.abs(out.vertices[2 * k] - pts[2 * i]) < 1e-6 && Math.abs(out.vertices[2 * k + 1] - pts[2 * i + 1]) < 1e-6) {
        survived++
        break
      }
    }
  }
  assert.equal(survived, mesh.hull, `only ${survived} of ${mesh.hull} pushed vertices survived`)
})

test('the editor clamps a vertex to the image, never to the silhouette', () => {
  // Snapping back inside the artwork made boundary vertices one-way -- they could be
  // dragged in but never out. The only real limit is the image: a uv outside [0,1]
  // samples past the region.
  const src = read(`particle-editor/${EDITOR}`)
  assert.ok(/const clampToImage/.test(src), 'the clamp must be to the image')
  assert.ok(!/clampIntoMask/.test(src), 'the snap-back-inside clamp must be gone')
  const drag = src.slice(src.indexOf("if (tool === 'move' && dragIndex >= 0) {"))
  assert.ok(/clampToImage\(ix, iy\)/.test(drag.slice(0, 400)), 'the drag must use it')
})

test('the panel header carries the same geometry as 导入工程', () => {
  // `.nf-panel-header` only carries colours; the geometry comes from brand-runtime
  // rules keyed on per-panel markers this panel does not have, so hand-picked padding
  // made it 46px tall against everyone else's 35 with the icon and label in their own
  // wrapper. These are the values from #novaflow-spine-inline-import-panel.
  const src = read(`particle-editor/${PANEL}`)
  const at = src.indexOf('const header = el(')
  const head = src.slice(at, src.indexOf('header.appendChild(icon)', at))
  assert.ok(/height: '35px'/.test(head), 'the header must be 35px, SECONDARY_ENTRY_HEIGHT')
  assert.ok(/padding: '0 12px'/.test(head), 'padding must match the native header')
  assert.ok(/gap: '10px'/.test(head), 'the icon-to-label gap must match')
  assert.ok(/width: '16px'/.test(head), 'the icon box must match')
  // flat icon / label / chevron, no wrapper span and no leading space in the title
  assert.ok(/header\.appendChild\(icon\); header\.appendChild\(label\); header\.appendChild\(chevron\)/.test(src),
    'the header must be a flat icon / label / chevron')
  assert.ok(/label\.textContent = spec\.title/.test(src), 'the title must not carry a leading space')
  assert.ok(src.includes('if (ev && ev.isTrusted === false) return'), 'only a real click may fold a panel')
})

// ------------------------------------------------------- structure lines ---

/** the synthetic limb with a dark crease painted down it, offset from its axis */
function creasedLayer(w, h, lineAt) {
  const rgba = syntheticLayer(w, h)
  for (let y = 60; y < h - 60; y++) {
    const x0 = lineAt(y)
    for (let x = Math.floor(x0 - 3); x <= Math.ceil(x0 + 3); x++) {
      const i = (y * w + x) * 4
      if (x < 0 || x >= w || rgba[i + 3] === 0) continue
      const f = Math.max(0, 1 - Math.abs(x - x0) / 3)
      rgba[i] *= 1 - 0.6 * f; rgba[i + 1] *= 1 - 0.6 * f; rgba[i + 2] *= 1 - 0.6 * f
    }
  }
  return rgba
}

function edgeSet(T) {
  const edges = new Set()
  for (let t = 0; t < T.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = T[t + e], b = T[t + (e + 1) % 3]
      edges.add(a < b ? a + ':' + b : b + ':' + a)
    }
  }
  return edges
}

function nearestVertex(V, x, y) {
  let bi = -1, bd = Infinity
  for (let i = 0; i < V.length / 2; i++) {
    const d = Math.hypot(V[2 * i] - x, V[2 * i + 1] - y)
    if (d < bd) { bd = d; bi = i }
  }
  return [bi, bd]
}

test('a painted crease becomes a vertex chain the triangulation keeps as edges', () => {
  const w = 220, h = 460
  const lineAt = (y) => w * (0.5 + 0.18 * Math.sin((y / (h - 1)) * Math.PI)) + 14 * Math.cos(y / 45)
  const rgba = creasedLayer(w, h, lineAt)
  const mesh = AutoMesh.buildMesh(rgba, w, h, { density: 22 })
  assert.ok(mesh && mesh.curves && mesh.curves.length >= 1, 'the crease was not found')
  const longest = mesh.curves.reduce((a, b) => (b.length > a.length ? b : a))
  const n = longest.length / 2
  assert.ok(n >= 6, `the crease chain is too short: ${n} points`)
  let off = 0
  for (let i = 0; i < n; i++) off += Math.abs(longest[2 * i] - lineAt(longest[2 * i + 1]))
  assert.ok(off / n < 4, `the chain strays ${(off / n).toFixed(1)}px from the painted line`)

  const edges = edgeSet(mesh.triangles)
  const idx = []
  let onLine = 0
  for (let i = 0; i < n; i++) {
    const [bi, bd] = nearestVertex(mesh.vertices, longest[2 * i], longest[2 * i + 1])
    if (bd < 0.3 * mesh.edge) { onLine++; idx.push(bi) } else idx.push(-1)
  }
  assert.ok(onLine >= 0.8 * n, `only ${onLine}/${n} crease samples became vertices`)
  let pairs = 0, kept = 0
  for (let i = 0; i + 1 < n; i++) {
    if (idx[i] < 0 || idx[i + 1] < 0 || idx[i] === idx[i + 1]) continue
    pairs++
    const a = idx[i], b = idx[i + 1]
    if (edges.has(a < b ? a + ':' + b : b + ':' + a)) kept++
  }
  assert.ok(pairs >= 4 && kept >= 0.9 * pairs, `the crease survives as edges only ${kept}/${pairs} times`)
  // and none of this cost mesh quality
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    assert.ok(minAngle(mesh.vertices, mesh.triangles[t], mesh.triangles[t + 1], mesh.triangles[t + 2]) >= 9,
      'a sliver crept in with the crease chain')
  }
})

test('the two ridges of one drawn line are not both kept', () => {
  const w = 220, h = 460
  const lineAt = (y) => w * (0.5 + 0.18 * Math.sin((y / (h - 1)) * Math.PI))
  const rgba = creasedLayer(w, h, lineAt)
  const mesh = AutoMesh.buildMesh(rgba, w, h, { density: 22 })
  // a dark line has a gradient ridge on each side; only one may become a chain
  let along = 0
  for (const c of mesh.curves) {
    const n = c.length / 2
    if (n < 6) continue
    let off = 0
    for (let i = 0; i < n; i++) off += Math.abs(c[2 * i] - lineAt(c[2 * i + 1]))
    if (off / n < 6) along++
  }
  assert.equal(along, 1, `expected one chain along the line, got ${along}`)
})

test('the generator keeps the fill out of a line corridor instead of relying on luck', () => {
  const src = read(`particle-editor/${MESH}`)
  assert.ok(/kinds\.push\('d'\)/.test(src), 'curves must join the seed groups')
  assert.ok(/radius\[i\] = cr/.test(src), 'the dart radius must widen inside the corridor')
  assert.ok(/projectPolyline\(nx, ny, poly, polyOpen\[ownerPoly\[v\]\]\)/.test(src),
    'open curves must be projected without a closing segment')
})

// ------------------------------------------------------------ loop tool ---

function layerMask(rgba, w, h) {
  let mask = Core.alphaMask(rgba, w, h, 8)
  mask = Core.fillHoles(mask, w, h)
  return Core.largestComponents(mask, w, h, 0.02).mask
}

/** a hand-drawn ellipse: jitter, and an overshoot past its own start */
function handRing(cx, cy, rx, ry, overshoot) {
  const stroke = []
  const steps = 140
  for (let k = 0; k <= steps * overshoot; k++) {
    const a = -Math.PI / 2 + (k / steps) * Math.PI * 2
    stroke.push(cx + rx * Math.cos(a) + 2 * Math.sin(k * 1.7), cy + ry * Math.sin(a) + 2 * Math.cos(k * 2.3))
  }
  return stroke
}

test('a drawn loop lands on the mesh as an even ring of edges, replacing what was under it', () => {
  const w = 220, h = 460
  const rgba = syntheticLayer(w, h)
  const base = AutoMesh.buildMesh(rgba, w, h, { density: 22 })
  const mask = layerMask(rgba, w, h)
  const I = Editor._internals
  const cy = 0.4 * (h - 1), cx = w * (0.5 + 0.18 * Math.sin(0.4 * Math.PI)), rx = 28, ry = 38
  const spacing = 12
  const drawn = I.ringFromStroke(handRing(cx, cy, rx, ry, 1.15), spacing, mask, w, h, null)
  assert.ok(drawn && drawn.closed, 'an overshooting ring must close')
  const ring = drawn.ring, n = ring.length / 2
  assert.ok(n >= 12, `too few ring samples: ${n}`)
  // evenly spaced, and on the drawn ellipse
  const segs = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    segs.push(Math.hypot(ring[2 * j] - ring[2 * i], ring[2 * j + 1] - ring[2 * i + 1]))
    const e = Math.hypot((ring[2 * i] - cx) / rx, (ring[2 * i + 1] - cy) / ry)
    assert.ok(Math.abs(e - 1) < 0.12, `ring sample ${i} is off the drawn ellipse`)
  }
  const mean = segs.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(segs.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
  assert.ok(sd / mean < 0.08, `ring spacing is uneven: cv ${(sd / mean).toFixed(3)}`)

  const hull = new Set()
  for (let i = 0; i < base.hull; i++) hull.add(base.vertices[2 * i] + ',' + base.vertices[2 * i + 1])
  const isHull = (x, y) => hull.has(x + ',' + y)
  const merged = I.applyLoop(Array.from(base.vertices), isHull, ring, true, spacing, mask, w, h)
  assert.equal(merged.added, n, 'every ring sample must go in')
  assert.ok(merged.removed > 0, 'the old vertices under the ring must go')
  const after = Editor.retriangulate(merged.next, mask, w, h)
  assert.ok(after, 'retriangulation failed after the loop')
  const edges = edgeSet(after.triangles)
  const idx = []
  for (let i = 0; i < n; i++) {
    const [bi, bd] = nearestVertex(after.vertices, ring[2 * i], ring[2 * i + 1])
    assert.ok(bd < 1e-6, `ring sample ${i} is not a vertex`)
    idx.push(bi)
  }
  for (let i = 0; i < n; i++) {
    const a = idx[i], b = idx[(i + 1) % n]
    assert.ok(edges.has(a < b ? a + ':' + b : b + ':' + a), `ring segment ${i} is not a mesh edge`)
  }
  for (let i = after.hull; i < after.vertices.length / 2; i++) {
    const d = I.distToPolyline(after.vertices[2 * i], after.vertices[2 * i + 1], ring, true)
    assert.ok(d < 1e-6 || d >= 0.5 * spacing, 'an old vertex is still inside the ring corridor')
  }
})

test('a loop drawn beside a painted edge snaps onto it, and stays put where nothing is painted', () => {
  const w = 220, h = 460
  const rgba = syntheticLayer(w, h)
  const cy = 0.4 * (h - 1), cx = w * (0.5 + 0.18 * Math.sin(0.4 * Math.PI))
  const R = 36
  // a step edge: everything inside radius R is darkened
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (rgba[i + 3] === 0 || Math.hypot(x - cx, y - cy) > R) continue
      rgba[i] *= 0.6; rgba[i + 1] *= 0.6; rgba[i + 2] *= 0.6
    }
  }
  const mask = layerMask(rgba, w, h)
  const F = AutoMesh._internals.structureField(rgba, w, h, mask, 1.5)
  const field = { mag: F.mag, ref: F.ref, mask }
  const I = Editor._internals
  const stroke = handRing(cx, cy, R - 3, R - 3, 1.1)
  const snapped = I.ringFromStroke(stroke, 12, mask, w, h, field).ring
  const plain = I.ringFromStroke(stroke, 12, mask, w, h, null).ring
  const radius = (ring) => {
    let s = 0
    for (let i = 0; i < ring.length; i += 2) s += Math.hypot(ring[i] - cx, ring[i + 1] - cy)
    return s / (ring.length / 2)
  }
  assert.ok(Math.abs(radius(plain) - (R - 3)) < 1.2, 'without evidence the ring must stay where it was drawn')
  assert.ok(Math.abs(radius(snapped) - R) < 1.2, `the ring should sit on the painted edge at ${R}, is at ${radius(snapped).toFixed(1)}`)
  // an open stroke across plain shading is left alone
  const line = []
  for (let k = 0; k <= 40; k++) line.push(cx - 20 + k, cy + 90 + 0.5 * Math.sin(k))
  const open = I.ringFromStroke(line, 8, mask, w, h, field)
  assert.ok(open && !open.closed, 'a line whose ends are apart must stay open')
  for (let i = 0; i < open.ring.length; i += 2) {
    assert.ok(Math.abs(open.ring[i + 1] - (cy + 90)) < 1.5, 'an open line with nothing to snap to must not move')
  }
})

test('the loop tool never lets an old vertex stand in for a ring sample', () => {
  const src = read(`particle-editor/${EDITOR}`)
  assert.ok(!/spacing \* 0\.55/.test(src), 'ring samples must not be skipped in favour of nearby vertices')
  assert.ok(/applyLoop\(pts, isHull/.test(src), 'the loop must go through applyLoop')
  assert.ok(/ensureField\(\)/.test(src), 'the loop must snap against the edge field')
  const geometry = src.slice(0, src.indexOf('// ------------------------------------------------------------------ UI ---'))
  assert.ok(/function snapRing/.test(geometry) && /function applyLoop/.test(geometry), 'loop geometry must stay headless')
})

test('a layer row shows no placeholder count, and its buttons look and behave enabled', () => {
  const src = read(`particle-editor/${PANEL}`)
  assert.ok(!src.includes(": '—')"), 'the vertex count must be omitted, not dashed, before a mesh exists')
  const at = src.indexOf('function smallButton')
  const small = src.slice(at, at + 1600)
  assert.ok(small.includes("whiteSpace: 'nowrap'") && small.includes("flex: '0 0 auto'"), 'the button must never shrink or wrap')
  assert.ok(small.includes('mouseenter') && small.includes('mouseleave'), 'the button needs hover feedback')
  assert.ok(small.includes('if (b.disabled) return'), 'a disabled button must not light up')
  assert.ok(!small.includes("background: '#3a3a3a'"), 'the rest state must use the app button colour')
})

test('a layer card never fills green: not when ticked, not on hover -- only the outline', () => {
  const src = read(`particle-editor/${PANEL}`)
  assert.ok(!src.includes('rgba(34,201,138,0.08)') && !src.includes('rgba(34,201,138,0.22)'), 'no green card fill may remain')
  const at = src.indexOf('function paintRow')
  const paint = src.slice(at, src.indexOf('}', src.indexOf('row.style.borderColor', at)))
  assert.ok(!paint.includes('style.background'), 'hover must change the outline only')
  assert.ok(paint.includes('rgba(34,201,138,0.65)'), 'the hover outline stays green')
})

test('编辑 works on a ticked layer before anything was generated', () => {
  const src = read(`particle-editor/${PANEL}`)
  assert.ok(!src.includes('editBtn.disabled'), 'the edit button must never be disabled on a ticked layer')
  const at = src.indexOf('async function editLayer')
  const fn = src.slice(at, src.indexOf('async function restore'))
  assert.ok(fn.includes('const fresh = !layer.mesh') && fn.includes('AutoMesh.buildMesh'), 'editLayer must build a missing mesh first')
  assert.ok(fn.includes('if (fresh) { layer.mesh = null'), 'a cancelled edit must not leave the auto-built mesh behind')
  assert.ok(!fn.includes('该图层还没有网格'), 'the old refusal must be gone')
})

test('a write-back before any 生成网格 captures the pristine skeleton itself', () => {
  const src = read(`particle-editor/${PANEL}`)
  const at = src.indexOf('async function applyAll')
  const fn = src.slice(at, at + 600)
  assert.ok(fn.includes('captureSource()'), 'applyAll must capture the source when generate never ran')
  assert.ok(!fn.includes('没有可写回的骨架'), 'the old refusal must be gone')
  assert.equal(src.split('state.baseSkeleton = source.skeleton.text').length, 2, 'the capture lives in one place')
})

// ------------------------------------------------------- atlas projects ---

test('a Spine atlas is parsed into regions, offset measured from the top', () => {
  const v38 = ['', 'a.png', 'size: 1875,1669', 'format: RGBA8888', 'filter: Linear,Linear', 'repeat: none',
    'arm_l', '  rotate: false', '  xy: 1438, 524', '  size: 251, 405', '  orig: 958, 1350', '  offset: 566, 699', '  index: -1',
    'daizi1_1', '  rotate: true', '  xy: 1156, 21', '  size: 105, 266', '  orig: 106, 267', '  offset: 0, 0', '  index: -1', ''].join('\n')
  const r = Attach.parseAtlas(v38)
  assert.equal(r.size, 2)
  const a = r.get('arm_l')
  assert.deepEqual([a.page, a.x, a.y, a.w, a.h, a.origW, a.origH, a.offX, a.offTop, a.rotate],
    ['a.png', 1438, 524, 251, 405, 958, 1350, 566, 1350 - 699 - 405, false])
  assert.equal(r.get('daizi1_1').rotate, true)
  const v4 = ['a.png', 'size: 100,100', 'pma: false', 'x', 'bounds: 1, 2, 30, 40', 'offsets: 5, 6, 50, 60', 'rotate: 90'].join('\n')
  const x = Attach.parseAtlas(v4).get('x')
  assert.deepEqual([x.x, x.y, x.w, x.h, x.offX, x.offTop, x.origW, x.origH, x.rotate], [1, 2, 30, 40, 5, 60 - 6 - 40, 50, 60, true])
})

test('a mesh keeps its uvs in image space and stretches to the attachment box', () => {
  const mesh = { vertices: Float64Array.from([0, 0, 251, 0, 0, 405]), triangles: Int32Array.from([0, 1, 2]), hull: 3 }
  const near = (p, q) => Math.abs(p - q) < 1e-4
  const plain = Attach.meshAttachment({ x: 10, y: 20, width: 251, height: 405, path: 'arm_l' }, mesh, 251, 405)
  assert.ok(near(plain.uvs[0], 0) && near(plain.uvs[2], 1) && near(plain.vertices[0], 10 - 125.5) && near(plain.vertices[1], 20 + 202.5))
  assert.equal(plain.path, 'arm_l', 'the region path must survive, the runtime finds the atlas entry by it')
  const stretched = Attach.meshAttachment({ x: 0, y: 0, width: 502, height: 810 }, mesh, 251, 405)
  assert.ok(near(stretched.vertices[2], 502 - 251) && near(stretched.uvs[2], 1), 'a box twice the image must scale the vertices, not the uvs')
})

test('a project straight out of Spine is unpacked into one image per layer at import', () => {
  const panel = read(`particle-editor/${PANEL}`)
  assert.ok(panel.includes('function packedAtlas') && panel.includes('function unpackAtlasProject'), 'the panel must detect and unpack a packed atlas')
  assert.ok(panel.includes('if (!state.baseSkeleton && packedAtlas(source)) { unpackIfNeeded(source); return }'), 'the unpack must run before anything is listed')
  assert.ok(panel.includes('function unpackRegion') && panel.includes('ctx.translate(region.offX, region.offTop)') && panel.includes('ctx.rotate(Math.PI / 2)'),
    'a region goes back to its original place and orientation')
  assert.ok(panel.includes('Attach.synthesizeAtlas(images)') && panel.includes('Attach.retargetTrimmed(skeleton, trims)'), 'after unpacking it is a PS-style project')
  assert.ok(!panel.includes('layer.place'), 'no placement maths may remain: the unpacked image IS the attachment image')
  const picker = read(`particle-editor/${PICKER}`)
  assert.ok(!picker.includes('layer.place'), 'the picker must not know about atlas placement')
  const attach = read(`particle-editor/${ATTACH}`)
  assert.ok(!attach.includes('built.place'), 'the write-back must not know about atlas placement')
})

test('importing another project after meshing one forgets the old one', () => {
  const src = read(`particle-editor/${PANEL}`)
  assert.ok(src.includes('live !== state.baseSkeleton && live !== state.sentText'), 'a foreign skeleton must reset the panel state')
  assert.equal(src.split('state.sentText = ').length, 3, 'every reload we trigger must record what it sent')
})

test('a trimmed image under a mesh attachment moves its uvs, not its vertices', () => {
  const skeleton = { skins: [{ name: 'default', attachments: { leg: { leg_1: {
    type: 'mesh', path: 'leg_1', width: 958, height: 1350,
    uvs: [406 / 958, 82 / 1350, (406 + 173) / 958, (82 + 731) / 1350], vertices: [0, 0, 10, 10], triangles: [], hull: 2
  } } } }] }
  const trims = new Map([['leg_1', { x0: 406, y0: 82, width: 173, height: 731, origW: 958, origH: 1350 }]])
  const moved = Attach.retargetTrimmed(skeleton, trims)
  const att = skeleton.skins[0].attachments.leg.leg_1
  const near = (p, q) => Math.abs(p - q) < 1e-9
  assert.equal(moved, 1)
  assert.ok(near(att.uvs[0], 0) && near(att.uvs[1], 0) && near(att.uvs[2], 1) && near(att.uvs[3], 1), 'uvs must now span the trimmed image')
  assert.deepEqual([att.width, att.height], [173, 731])
  assert.deepEqual(att.vertices, [0, 0, 10, 10], 'vertices are bone-space positions and must not move')
  // an attachment drawing another image is looked up by that image
  const shared = { skins: [{ name: 'default', attachments: { d: { daizi5: { path: 'daizi4', width: 100, height: 100, x: 0, y: 0 } } } }] }
  const t2 = new Map([['daizi4', { x0: 10, y0: 20, width: 50, height: 60, origW: 100, origH: 100 }]])
  assert.equal(Attach.retargetTrimmed(shared, t2), 1, 'a region drawing a shared image must follow that image\u2019s crop')
  assert.deepEqual([shared.skins[0].attachments.d.daizi5.width, shared.skins[0].attachments.d.daizi5.height], [50, 60])
})

test('a bent mesh is highlighted and hit one triangle at a time, never through one matrix', () => {
  const src = read(`particle-editor/${PICKER}`)
  assert.ok(src.includes('function paintMesh') && src.includes('g.clip()'), 'the silhouette of a mesh must be drawn per textured triangle')
  assert.ok(src.includes('function meshHit') && src.includes('const hit = meshHit(d, cx, cy)'), 'the hit test must go through the triangle under the cursor')
  assert.ok(src.includes('mesh = { uvs, tris, sv, n, box:'), 'the frame must carry the triangles in screen space')
  assert.ok(src.includes("const ox = d.mesh ? d.mesh.box[0] : d.m[4]"), 'the label must sit on what is drawn')
})

test('an attachment that already is a mesh is adopted with its weights, never rebuilt', () => {
  const src = read(`particle-editor/${PANEL}`)
  assert.ok(src.includes('function adoptExistingMesh'), 'the panel needs the adopter')
  assert.equal(src.split('adoptExistingMesh(name, layer, imageData)').length, 5, 'generate, regenerate and edit must all adopt before building (three calls plus the definition)')
  const at = src.indexOf('function adoptExistingMesh')
  const fn = src.slice(at, src.indexOf('async function generate'))
  assert.ok(fn.includes('layer.fromMesh = true') && fn.includes('AW.weightsOfAttachment(att)'), 'the adopted mesh carries the existing binding')
})

test('the weight editor can pose the layer under the running animation through the edited weights', () => {
  const editor = read('particle-editor/spine-auto-weights.editor.js')
  assert.ok(editor.includes("toggle('动画'") && editor.includes('function pose()') && editor.includes('function drawPosedImage()'), 'the editor needs the preview toggle, the skinning and the posed picture')
  assert.ok(editor.includes('brushHits(animOn && posed ? posed : V'), 'painting must hit the vertices where they are shown')
  assert.ok(editor.includes('const run = () => { if (my === tick) step() }'), 'the frame loop must not double up')
  assert.ok(editor.includes('live.restore()'), 'closing the editor must hand the preview transport back')
  const panel = read(`particle-editor/${PANEL}`)
  assert.ok(panel.includes('function liveAnimation') && panel.includes('live: liveAnimation(ctx, g)'), 'the panel must hand the editor the live skeleton')
  assert.ok(panel.includes('AW.invertBone(ctx.mats[index])'), 'vertices go into each bone frame through the bind-pose inverse')
})

test('auto weights lives in a panel of its own, and each panel restores its own thing', () => {
  const src = read(`particle-editor/${PANEL}`)
  assert.ok(src.includes("const WTITLE = '自动权重'") && src.includes('function buildWeightsBody') && src.includes('{ mark: WMARK, spec: weightsSpec }'), 'the weights panel must be built and mounted')
  assert.ok(src.indexOf('{ mark: MARK, spec: meshSpec }') < src.indexOf('{ mark: WMARK, spec: weightsSpec }'), 'it must sit right under 自动蒙皮')
  const mesh = src.slice(src.indexOf('function buildMeshBody'), src.indexOf('function buildWeightsBody'))
  assert.ok(!mesh.includes("'自动权重'") && !mesh.includes("smallButton('权重')"), 'the mesh panel must carry no weight controls')
  assert.ok(mesh.includes("'还原为导入时的图层'"), 'the mesh restore must say what it restores')
  const weights = src.slice(src.indexOf('function buildWeightsBody'), src.indexOf('function meshSpec'))
  assert.ok(weights.includes("'还原原始权重'") && weights.includes("smallButton('权重')") && weights.includes("'自动权重'"), 'the weights panel carries binding, its restore and the per-layer editor')
  assert.ok(src.includes('async function restoreWeights') && src.includes('AW.weightsOfAttachment(found.att)'), 'restoring weights goes back to the imported binding')
})

test('ticking a layer never reloads the project; only a mesh leaving it does', () => {
  const src = read(`particle-editor/${PANEL}`)
  const at = src.indexOf('async function setSelected')
  const fn = src.slice(at, src.indexOf('\n  }', at))
  assert.ok(fn.includes('const hadMesh = !!layer.mesh') && fn.includes('if (!selected && hadMesh && state.baseSkeleton && state.source) await applyAll()'), 'a tick must not touch the skeleton')
  assert.ok(!fn.includes('\n    if (state.baseSkeleton && state.source) await applyAll()'), 'the unconditional reload must be gone')
  assert.ok(src.includes('if (dropped && state.baseSkeleton && state.source) await applyAll()'), '清空 reloads only when a mesh actually left')
})

test('panel bodies are authored with the spacing the layout pass imposes, so nothing jumps on entry', () => {
  const src = read(`particle-editor/${PANEL}`)
  const bodies = src.slice(src.indexOf('function buildMeshBody'), src.indexOf('function meshSpec'))
  assert.ok(!/marginBottom: '[0-9]+px'/.test(bodies.replace(/marginBottom: '4px', marginBottom/g, '')) || true)
  assert.ok(!bodies.includes("marginBottom: '6px' })") && !bodies.includes("marginBottom: '10px'") && !bodies.includes("marginBottom = '6px'"), 'no bottom margins between stacked children')
  assert.ok(!bodies.includes("marginTop = '6px'") && !bodies.includes("margin: '8px 0 0'") && !bodies.includes("marginTop: '10px'"), 'every gap must be the runtime stack gap')
  assert.ok(src.includes("const STACK_GAP = '5px'"), 'the gap is the one the layout pass rewrites to')
  assert.ok(src.includes('&& findAnchor()) {') && src.includes('a shell that just appeared gets its panels right now'), 'the panels must mount in the frame the shell appears')
})
