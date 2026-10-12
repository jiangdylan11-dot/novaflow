// 序列扫光 生成核心 (renderer/sweep-light.core.js): a synthetic base (blue disc, two bright spots, a
// gold outline) through every scheme × blend mode — frame count, padded size, no NaN, light that
// travels with the angle, white / custom light colours, 正常 frames carrying the base, the
// 写入动画 alpha curves (wrap joins first and last), the flicker floor on the band width.
//
//   node --test novaflow-web/tests/e2e/sweep-light-core.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const ctxVm = vm.createContext({})
vm.runInContext(await readFile(new URL('../../renderer/sweep-light.core.js', import.meta.url), 'utf8'), ctxVm)
const L = ctxVm.NovaFlowSweepLight
const { analyzeBase, renderSweepFrame, generateSweepSequence, SWEEP_SCHEMES, BLEND_MODES, sweepAlphaAt, sweepAlphaKeys, effectiveWidth, minFrames } = L

const w = 160, h = 90
const rgba = new Uint8ClampedArray(w * h * 4)
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const dx = x - 80, dy = y - 45, r = Math.hypot(dx / 1.6, dy)
  const i = (y * w + x) * 4
  if (r < 40) {
    const edge = r > 35
    const spot = Math.exp(-((x - 60) ** 2 + (y - 35) ** 2) / 40) + Math.exp(-((x - 105) ** 2 + (y - 50) ** 2) / 30)
    rgba[i] = edge ? 200 : 40 + 120 * spot; rgba[i + 1] = edge ? 150 : 90 + 120 * spot; rgba[i + 2] = edge ? 60 : 220; rgba[i + 3] = 255
  }
}

const centroid = (f) => { let sx = 0, sy = 0, s = 0; for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const v = f.data[(y * f.w + x) * 4 + 3]; sx += x * v; sy += y * v; s += v } return s ? [sx / s, sy / s, s] : null }
const meanLit = (f) => { let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < f.data.length; i += 4) if (f.data[i + 3] > 40) { r += f.data[i]; g += f.data[i + 1]; b += f.data[i + 2]; n++ } return n ? [r / n, g / n, b / n] : [0, 0, 0] }

test('every scheme × blend mode: frames, padded size, no NaN, some light; 正常 carries the base', () => {
  for (const s of SWEEP_SCHEMES) {
    for (const b of BLEND_MODES) {
      const params = { scheme: s.id, blend: b.id, frames: 6, ...(s.colorMode ? { colorMode: s.colorMode, color: s.color } : {}) }
      const r = generateSweepSequence(rgba, w, h, params)
      assert.equal(r.frames.length, 6, `${s.id}/${b.id} 帧数`)
      assert.ok(r.w === w + r.pad * 2 && r.h === h + r.pad * 2, `${s.id}/${b.id} 尺寸含边距`)
      let nan = 0, lit = 0
      for (const f of r.frames) for (let i = 0; i < f.data.length; i++) { if (Number.isNaN(f.data[i])) nan++; if (i % 4 === 3 && f.data[i] > 8) lit++ }
      assert.equal(nan, 0, `${s.id}/${b.id} NaN`)
      assert.ok(lit > 0, `${s.id}/${b.id} 有光`)
      if (b.id === 'normal') {
        const f = r.frames[2], i = ((f.pad + 45) * f.w + f.pad + 40) * 4
        assert.ok(f.data[i + 3] === 255 && f.data[i + 2] > 150, `${s.id}/normal 帧里有底图（蓝）`)
      }
    }
  }
})

test('the light travels with the angle (0° left→right, 90° top→bottom); radial schemes change with p', () => {
  for (const s of SWEEP_SCHEMES) {
    const ctx = analyzeBase(rgba, w, h, { scheme: s.id, angle: 0 })
    const c1 = centroid(renderSweepFrame(ctx, 0.3, { scheme: s.id, angle: 0, blend: 'add', frames: 24 }))
    const c2 = centroid(renderSweepFrame(ctx, 0.7, { scheme: s.id, angle: 0, blend: 'add', frames: 24 }))
    if (!s.radial && s.id !== 'rays') assert.ok(c1 && c2 && c2[0] > c1[0] + 5, `${s.id} 0°: ${c1 && c1[0].toFixed(1)} → ${c2 && c2[0].toFixed(1)}`)
    else assert.ok(c1 && c2 && Math.abs(c2[2] - c1[2]) > 0, `${s.id} 径向：亮度随 p 变化`)
  }
  const ctx = analyzeBase(rgba, w, h, { scheme: 'base', angle: 90 })
  const c1 = centroid(renderSweepFrame(ctx, 0.3, { scheme: 'base', angle: 90, frames: 24 })), c2 = centroid(renderSweepFrame(ctx, 0.7, { scheme: 'base', angle: 90, frames: 24 }))
  assert.ok(c2[1] > c1[1] + 3 && Math.abs(c2[0] - c1[0]) < 6, `90°: ${c1[1].toFixed(1)} → ${c2[1].toFixed(1)}`)
})

test('light colour: 底图色 keeps the picture\'s blue, 白光 is near white, 自定义 pink is pink', () => {
  const one = (extra) => { const P = { scheme: 'metal-highlight', blend: 'screen', frames: 32, ...extra }; return meanLit(renderSweepFrame(analyzeBase(rgba, w, h, P), 0.5, P)) }
  const base = one({}), white = one({ colorMode: 'white' }), pink = one({ colorMode: 'custom', color: '#ff66aa' })
  assert.ok(base[2] > base[0] + 20, `底图色偏蓝 ${base.map((v) => v.toFixed(0))}`)
  assert.ok(Math.abs(white[0] - white[2]) < 12 && white[0] > 180, `白光近白 ${white.map((v) => v.toFixed(0))}`)
  assert.ok(pink[0] > pink[2] + 20 && pink[0] > pink[1] + 40, `粉 ${pink.map((v) => v.toFixed(0))}`)
})

test('写入动画 curves: linear 0→1→0 one step apart; wrap sums to 1 everywhere and joins first to last', () => {
  assert.equal(sweepAlphaAt(0, 3, 1, 1), 1); assert.equal(sweepAlphaAt(1, 3, 1, 1), 0); assert.equal(sweepAlphaAt(1, 3, 1.5, 1), 0.5); assert.equal(sweepAlphaAt(0, 3, 1.5, 1), 0.5)
  for (let t = 0; t < 4; t += 0.25) { let s = 0; for (let i = 0; i < 4; i++) s += sweepAlphaAt(i, 4, t, 1, true); assert.ok(Math.abs(s - 1) < 1e-9, `wrap t=${t} sum ${s}`) }
  // the core's arrays come from the vm realm: compare by value, not by prototype
  const J = (v) => JSON.stringify(v)
  assert.equal(J(sweepAlphaKeys(1, 4, 1, false)), J([[0, 0], [1, 0], [2, 1], [3, 0]]))
  assert.equal(J(sweepAlphaKeys(0, 4, 1, true)), J([[0, 1], [1, 0], [3, 0], [4, 1]]))
  assert.equal(J(sweepAlphaKeys(3, 4, 1, true)), J([[0, 0], [2, 0], [3, 1], [4, 0]]))
  assert.equal(J(sweepAlphaKeys(1, 4, 1, true)), J([[0, 0], [1, 1], [2, 0], [4, 0]]))
})

test('wrap schemes sample p = i/n (the last frame is not the first again); linear ones p = i/(n-1)', () => {
  const o = generateSweepSequence(rgba, w, h, { scheme: 'outline', frames: 8 })
  const same = (a, b) => a.data.every((v, i) => v === b.data[i])
  assert.ok(!same(o.frames[0], o.frames[7]), 'outline 末帧 ≠ 首帧')
  const ctx = analyzeBase(rgba, w, h, { scheme: 'outline', frames: 8 })
  assert.ok(same(o.frames[7], renderSweepFrame(ctx, 7 / 8, { scheme: 'outline', frames: 8 })), 'outline 末帧 = p 7/8')
})

test('flicker floor: few frames widen the band to 1.7 × step; the scheme defaults stay close to their design width (the sharp 金属高光 widens most)', () => {
  for (const s of SWEEP_SCHEMES) {
    const e = effectiveWidth({ scheme: s.id, frames: s.frames, width: 1 })
    assert.ok(e.floor <= (s.id === 'metal-highlight' ? 3 : 1.5), `${s.id} 默认 ${s.frames} 帧 floor ${e.floor.toFixed(2)}`)
    assert.ok(effectiveWidth({ scheme: s.id, frames: 4, width: 1 }).wk > e.wk, `${s.id} 4 帧要加宽`)
    assert.ok(minFrames({ scheme: s.id, width: 1 }) >= 2)
  }
  assert.equal(effectiveWidth({ scheme: 'base', frames: 60, width: 1 }).wk, 1)
})

test('边距: auto = max(36, 24% for rays); manual wins', () => {
  assert.equal(generateSweepSequence(rgba, w, h, { scheme: 'base', frames: 2 }).pad, 36)
  assert.equal(generateSweepSequence(rgba, w, h, { scheme: 'rays', frames: 2 }).pad, 38)
  assert.equal(generateSweepSequence(rgba, w, h, { scheme: 'rays', frames: 2, pad: 50 }).pad, 50)
})
