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
    if (!s.radial && !s.edge && s.id !== 'rays') assert.ok(c1 && c2 && c2[0] > c1[0] + 5, `${s.id} 0°: ${c1 && c1[0].toFixed(1)} → ${c2 && c2[0].toFixed(1)}`)
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
    if (!s.edge) assert.ok(effectiveWidth({ scheme: s.id, frames: 4, width: 1 }).wk > e.wk, `${s.id} 4 帧要加宽`)
    assert.ok(minFrames({ scheme: s.id, width: 1 }) >= 2)
  }
  assert.equal(effectiveWidth({ scheme: 'base', frames: 60, width: 1 }).wk, 1)
})

test('边距: auto = max(36, 24% for rays); manual wins', () => {
  assert.equal(generateSweepSequence(rgba, w, h, { scheme: 'base', frames: 2 }).pad, 36)
  assert.equal(generateSweepSequence(rgba, w, h, { scheme: 'rays', frames: 2 }).pad, 38)
  assert.equal(generateSweepSequence(rgba, w, h, { scheme: 'rays', frames: 2, pad: 50 }).pad, 50)
})

// ---------- 边缘扫光（2026-10-13）：光只沿轮廓走
const edgeIds = SWEEP_SCHEMES.filter((s) => s.edge).map((s) => s.id)
const lightAt = (f, x, y) => { const i = (y * f.w + x) * 4; return f.data[i + 3] }

test('边缘扫光: 20 种都在，绕一圈（wrap），默认 40 帧，边距自动 48', () => {
  assert.equal(edgeIds.length, 20)
  for (const s of SWEEP_SCHEMES.filter((x) => x.edge)) assert.ok(s.wrap && s.frames === 40, s.id)
  assert.equal(generateSweepSequence(rgba, w, h, { scheme: 'edge-meteor', frames: 2 }).pad, 48)
  assert.equal(generateSweepSequence(rgba, w, h, { scheme: 'edge-meteor', frames: 2, scale: 0.5 }).pad, 24)
})

test('边缘扫光: 光集中在轮廓上，椭圆中心（离边 30 px 以上）的光不到总量 3%', () => {
  for (const id of edgeIds) {
    const P = { scheme: id, frames: 40, blend: 'add' }
    const ctx = analyzeBase(rgba, w, h, P)
    for (const p of [0.1, 0.4, 0.75]) {
      const f = renderSweepFrame(ctx, p, P)
      let center = 0, total = 0
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
        const v = lightAt(f, x, y); total += v
        if (y >= 40 + f.pad && y <= 50 + f.pad && x >= 70 + f.pad && x <= 90 + f.pad) center += v
      }
      // 内光流转本来就把光伸进面里（约 18 px + 泛光）
      assert.ok(total > 0 && center / total < (id === 'edge-innerflow' ? 0.06 : 0.03), `${id} p=${p} 中心占 ${(center / total * 100).toFixed(1)}%`)
    }
  }
})

test('边缘扫光: 流星沿轮廓转圈（亮处的角度随 p 单调走），循环首尾相接（分流汇合 / 充能满圈 每圈重新开始除外）', () => {
  const P = { scheme: 'edge-meteor', frames: 40, blend: 'add' }
  const ctx = analyzeBase(rgba, w, h, P)
  const ang = (p) => { const f = renderSweepFrame(ctx, p, P); let best = -1, bx = 0, by = 0; for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const v = lightAt(f, x, y); if (v > best) { best = v; bx = x; by = y } } return Math.atan2(by - f.h / 2, bx - f.w / 2) }
  const seq = [0.1, 0.2, 0.3, 0.4].map(ang)
  const steps = seq.slice(1).map((v, i) => { let d = v - seq[i]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d })
  assert.ok(steps.every((d) => d < -0.2) || steps.every((d) => d > 0.2), `流星角度一路同向走 ${steps.map((d) => d.toFixed(2))}`)
  for (const id of edgeIds) {
    if (id === 'edge-meet' || id === 'edge-charge') continue
    const Q = { scheme: id, frames: 40, blend: 'add' }
    const c2 = analyzeBase(rgba, w, h, Q)
    const a = renderSweepFrame(c2, 0, Q), b = renderSweepFrame(c2, 1, Q)
    let mx = 0
    for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) mx = Math.max(mx, Math.abs((a.data[i + c] * a.data[i + 3] - b.data[i + c] * b.data[i + 3]) / 255))
    assert.ok(mx <= 5, `${id} p=0 与 p=1 差 ${mx.toFixed(1)}`)
  }
})

test('边缘扫光: 自带配色的不跟光色走，其余的 白光 / 自定义 生效', () => {
  const lit = (id, extra) => { const P = { scheme: id, frames: 40, blend: 'add', ...extra }; return meanLit(renderSweepFrame(analyzeBase(rgba, w, h, P), 0.3, P)) }
  const base = lit('edge-wideband', {}), pink = lit('edge-wideband', { colorMode: 'custom', color: '#ff3366' })
  assert.ok(base[2] > base[0] + 10, `底图色偏蓝 ${base.map((v) => v.toFixed(0))}`)
  assert.ok(pink[0] > pink[2] + 10, `自定义粉 ${pink.map((v) => v.toFixed(0))}`)
  const fire = lit('edge-fire', {}), fire2 = lit('edge-fire', { colorMode: 'custom', color: '#3366ff' })
  assert.equal(fire.map((v) => v.toFixed(1)).join(), fire2.map((v) => v.toFixed(1)).join(), '火焰描边自带配色')
  assert.ok(SWEEP_SCHEMES.find((s) => s.id === 'edge-fire').fixedColor && !SWEEP_SCHEMES.find((s) => s.id === 'edge-wideband').fixedColor)
})

test('边缘扫光: 镂空（圆环）里外两圈都亮', () => {
  const W2 = 120, H2 = 120, ring = new Uint8ClampedArray(W2 * H2 * 4)
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { const r = Math.hypot(x - 60, y - 60), i = (y * W2 + x) * 4; if (r < 50 && r > 25) { ring[i] = 230; ring[i + 1] = 180; ring[i + 2] = 60; ring[i + 3] = 255 } }
  const P = { scheme: 'edge-neon', frames: 40, blend: 'add' }
  const f = renderSweepFrame(analyzeBase(ring, W2, H2, P), 0.2, P)
  let inner = 0, outer = 0
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const r = Math.hypot(x - f.pad - 60, y - f.pad - 60), v = lightAt(f, x, y); if (r > 21 && r < 27) inner = Math.max(inner, v); if (r > 48 && r < 54) outer = Math.max(outer, v) }
  assert.ok(inner > 60 && outer > 60, `内圈 ${inner} 外圈 ${outer}`)
})

test('边缘扫光: 大片透明边的图只在内容附近算，光和裁好的图一模一样（平移），尺度按可见内容', () => {
  const BW = 3 * w, BH = 3 * h, big = new Uint8ClampedArray(BW * BH * 4)
  for (let y = 0; y < h; y++) big.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), ((y + h) * BW + w) * 4)
  for (const id of ['edge-meteor', 'edge-fire', 'edge-charge']) {
    const P = { scheme: id, frames: 40, blend: 'add' }
    const a = renderSweepFrame(analyzeBase(rgba, w, h, P), 0.3, P)
    const bctx = analyzeBase(big, BW, BH, P)
    const b = renderSweepFrame(bctx, 0.3, P)
    assert.equal(a.pad, b.pad, `${id} 边距按内容`)
    assert.ok(b.w === BW + 2 * b.pad && b.h === BH + 2 * b.pad, `${id} 帧尺寸 = 大图 + 边距`)
    let diff = 0, lit = 0
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
      const ia = (y * a.w + x) * 4, ib = ((y + h) * b.w + x + w) * 4
      for (let c = 0; c < 4; c++) diff = Math.max(diff, Math.abs(a.data[ia + c] - b.data[ib + c]))
      if (a.data[ia + 3] > 8) lit++
    }
    let litA = 0, litB = 0
    for (let i = 3; i < a.data.length; i += 4) if (a.data[i] > 0) litA++
    for (let i = 3; i < b.data.length; i += 4) if (b.data[i] > 0) litB++
    assert.ok(lit > 0 && diff <= 1, `${id} 和小图一致（差 ${diff}）`)
    assert.equal(litB, litA, `${id} 内容范围外没有光`)
  }
})

test('边缘扫光: 对话框里显示的每个参数都真改画面（默认 ↔ 最大 / 起点 90°，三个时刻的光总变化 > 6%）', () => {
  const PS = [0.13, 0.47, 0.81]
  const lightOf = (P) => { const ctx = analyzeBase(rgba, w, h, P); return PS.map((p) => { const f = renderSweepFrame(ctx, p, P), M = 70, CW = w + 2 * M, out = new Float32Array(CW * (h + 2 * M) * 3); for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const X = x - f.pad + M, Y = y - f.pad + M; if (X < 0 || Y < 0 || X >= CW || Y >= h + 2 * M) continue; const i = (y * f.w + x) * 4, o = (Y * CW + X) * 3, a = f.data[i + 3] / 255; out[o] = f.data[i] * a; out[o + 1] = f.data[i + 1] * a; out[o + 2] = f.data[i + 2] * a } return out }) }
  const rel = (A, B) => { let d = 0, s = 0; for (let k = 0; k < A.length; k++) for (let i = 0; i < A[k].length; i++) { d += Math.abs(A[k][i] - B[k][i]); s += A[k][i] } return d / Math.max(1, s) }
  const weak = []
  for (const s of SWEEP_SCHEMES.filter((x) => x.edge)) {
    const base = { scheme: s.id, frames: 40, blend: 'add' }
    const A = lightOf(base)
    const vary = [['width', 2.5], ['laps', 3], ['intensity', 2], ['glow', 2.5]]
    if (!s.noStart) vary.push(['start', 90])
    if (s.extra) vary.push(['extra', s.extra.max])
    if (s.fixedColor) vary.push(['hue', 120])
    for (const [k, v] of vary) { const r = rel(A, lightOf({ ...base, [k]: v })); if (!(r > 0.06)) weak.push(`${s.id}.${k}=${v}: ${r.toFixed(3)}`) }
  }
  assert.deepEqual(weak, [], '没起作用的参数')
})

test('边缘扫光: 次数是整数圈，循环照样首尾相接', () => {
  for (const id of ['edge-meteor', 'edge-ripple', 'edge-hop']) {
    const P = { scheme: id, frames: 40, blend: 'add', laps: 3 }
    const ctx = analyzeBase(rgba, w, h, P)
    const a = renderSweepFrame(ctx, 0, P), b = renderSweepFrame(ctx, 1, P), c = renderSweepFrame(ctx, 1 / 3, P)
    let ab = 0, ac = 0
    for (let i = 0; i < a.data.length; i++) { ab = Math.max(ab, Math.abs(a.data[i] - b.data[i])); ac = Math.max(ac, Math.abs(a.data[i] - c.data[i])) }
    assert.ok(ab <= 5 && ac <= 5, `${id} 3 圈：p=0 / 1/3 / 1 一样（${ab} ${ac}）`)
  }
})
