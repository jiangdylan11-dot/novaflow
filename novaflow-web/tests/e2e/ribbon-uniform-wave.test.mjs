import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../renderer/novaflow-brand-runtime.js', import.meta.url), 'utf8');
const functions = new Map([...source.matchAll(/^  function (\w+)\([^]*?^  \}/gm)].map(match => [match[1], match[0]]));
const selected = new Map();
function select(name) {
  if (selected.has(name) || name === 'getRibbonTimelineDuration') return;
  const code = functions.get(name);
  assert.ok(code, `missing ${name}`);
  selected.set(name, code);
  for (const match of code.matchAll(/\b(\w+)\s*\(/g)) if (functions.has(match[1])) select(match[1]);
}
['getRibbonUniformWaveLayout', 'buildRibbonUniformWaveRotateMap', 'buildRibbonParameterPresetPreview', 'normalizeRibbonParameterPresetValues', 'serializeRibbonRotateFramesForTimeline'].forEach(select);
const code = [...selected.values()].join('\n');
const constants = [...new Set(code.match(/\bRIBBON_[A-Z_]+\b/g))].map(name => {
  const match = source.match(new RegExp(`^  const ${name} = ([^;]+);`, 'm'));
  assert.ok(match, `missing ${name}`);
  return `const ${name} = ${match[1]};`;
});
const api = vm.createContext({ Math, Number, Map, Set, Array, JSON, getRibbonTimelineDuration: () => 2 });
vm.runInContext(constants.join('\n') + '\n' + code, api);
const presets = vm.runInNewContext(source.match(/^  const RIBBON_PARAMETER_PRESET_OVERRIDES = ([^]*?^  \]);/m)[1]);
const options = { duration: 2, fps: 30, stiffness: 0, elasticity: 18, amplitude: 36, wind: 0, delay: 57,
  offset: 0, wavePhase: 36, whip: 0, swingCount: 1, nativeSwingCount: 1, waveCount: 1, uniformWeight: 50 };
function chain(count, prefix = 'bone', lengths = []) {
  const bones = Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index}`, parent: index ? `${prefix}${index - 1}` : 'root', length: lengths[index] ?? 100, x: index ? lengths[index - 1] ?? 100 : 0 }));
  const entries = bones.map((bone, index) => ({ name: bone.name, sourceName: bones[0].name, chainIndex: index }));
  return { bones, entries };
}
function run(fixture, overrides = {}) {
  return api.buildRibbonUniformWaveRotateMap(api.getRibbonUniformWaveLayout(fixture, fixture.entries), { ...options, ...overrides });
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function near(actual, expected, epsilon = 0.005) { assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`); }

test('old presets default to zero weight and new values survive a preset JSON round trip', () => {
  const old = api.normalizeRibbonParameterPresetValues(options);
  const legacy = api.normalizeRibbonParameterPresetValues({ amplitude: 36, wavePhase: 36 });
  assert.equal(legacy.uniformWeight, 0);
  assert.equal(legacy.waveCount, 1);
  const loaded = api.normalizeRibbonParameterPresetValues(JSON.parse(JSON.stringify({ ...old, waveCount: 1.35, uniformWeight: 75 })));
  assert.equal(loaded.waveCount, 1.35);
  assert.equal(loaded.uniformWeight, 75);
  assert.equal(api.normalizeRibbonUniformWaveValue('uniformWeight', NaN), 0);
  const extended = api.normalizeRibbonParameterPresetValues(JSON.parse(JSON.stringify({ ...old, waveCount: 8.35 })));
  assert.equal(extended.waveCount, 8.35);
  assert.equal(api.normalizeRibbonUniformWaveValue('waveCount', -1), 0);
  assert.equal(api.normalizeRibbonUniformWaveValue('uniformWeight', 150), 100);
});

test('0% is exactly the previous solver, including wind, whip, offset and loop count', () => {
  const fixture = chain(5), o = { ...options, wind: 30, whip: 25, offset: 14, swingCount: 2, uniformWeight: 0 };
  const result = run(fixture, o), input = api.buildRibbonSyntheticSourceRotateFrames(o.duration);
  fixture.entries.forEach(entry => {
    const legacy = api.buildRibbonElasticRotateFrames(input, o.elasticity, o.duration, o.fps, o.swingCount, o.nativeSwingCount, o.stiffness, o.amplitude, o.wind, o.delay, o.offset, o.wavePhase, entry.chainIndex, o.whip);
    assert.deepEqual(plain(result.get(entry.name)), plain(legacy));
  });
  assert.deepEqual(plain([...run(fixture, { ...o, waveCount: 2 })]), plain([...result]));
});

test('phase is distributed by length and connected roots remain independent', () => {
  const a = chain(3, 'a', [100, 200, 100]), b = chain(5, 'b');
  const fixture = { bones: [...a.bones, ...b.bones], entries: [...b.entries, ...a.entries] };
  const layout = api.getRibbonUniformWaveLayout(fixture, fixture.entries);
  assert.equal(layout.length, 2);
  assert.deepEqual(Array.from(layout[1], item => item.position), [0.125, 0.5, 0.875]);
  const combined = run(fixture), separate = run(a);
  for (const entry of a.entries) assert.deepEqual(plain(combined.get(entry.name)), plain(separate.get(entry.name)));
  assert.equal(combined.has('root'), false);
});

test('100% reconstructs one traveling world-angle wave on both 5- and 15-bone chains', () => {
  for (const count of [5, 15]) {
    const fixture = chain(count), layout = api.getRibbonUniformWaveLayout(fixture, fixture.entries)[0];
    const result = run(fixture, { uniformWeight: 100 });
    const legacy = run(fixture, { uniformWeight: 0 });
    const rootFrames = legacy.get('bone0'), rootPeak = Math.max(...rootFrames.map(frame => Math.abs(frame.angle)));
    let worldPeak = 0;
    for (let frame = 0; frame <= 120; frame++) {
      let sum = 0;
      for (const entry of fixture.entries) {
        sum += api.sampleRibbonUniformLoop(legacy.get(entry.name), frame / 60, 2);
        worldPeak = Math.max(worldPeak, Math.abs(sum));
      }
    }
    for (const frame of [0, 15, 30, 45, 60, 90]) {
      let world = 0;
      layout.forEach(item => {
        world += result.get(item.name)[frame].angle;
        const expected = api.sampleRibbonUniformLoop(rootFrames, frame / 60 - 2 * item.position, 2) * worldPeak / rootPeak;
        near(world, expected, 0.01);
      });
    }
  }
});

test('the middle weight mixes local rotations before native whip, never after it', () => {
  const fixture = chain(5), mixed = run(fixture), uniform = run(fixture, { uniformWeight: 100 }), legacy = run(fixture, { uniformWeight: 0 });
  const whipped = run(fixture, { whip: 25 });
  for (const entry of fixture.entries) {
    const frames = mixed.get(entry.name);
    for (const frame of [0, 15, 30, 60, 90]) {
      const old = api.sampleRibbonUniformLoop(legacy.get(entry.name), frame / 60, 2);
      near(frames[frame].angle, (old + uniform.get(entry.name)[frame].angle) / 2, 0.002);
    }
    const expected = api.applyRibbonWhipStrengthToRotateFrames(frames, 2, 18, 57, 25, entry.chainIndex);
    assert.deepEqual(plain(whipped.get(entry.name)), plain(expected));
  }
});

test('counts, weights and whip produce finite closed loops; changing wave count affects the pose', () => {
  const fixture = chain(5);
  for (const waveCount of [0, 0.5, 1, 2, 3.25, 5, 8.35]) for (const uniformWeight of [50, 100]) {
    const output = run(fixture, { waveCount, uniformWeight, whip: 25 });
    for (const frames of output.values()) {
      assert.equal(frames[0].angle, frames.at(-1).angle);
      assert.ok(frames.every(frame => Number.isFinite(frame.angle) && Number.isFinite(frame.time)));
    }
  }
  assert.notDeepEqual(plain([...run(fixture, { waveCount: 1 })]), plain([...run(fixture, { waveCount: 1.5 })]));
  assert.notDeepEqual(plain([...run(chain(15), { waveCount: 5 })]), plain([...run(chain(15), { waveCount: 8.35 })]));
});

test('Spine 4.2 value frames and 3.8 angle frames preserve their writeback format', () => {
  const next = run(chain(5)).get('bone0');
  const v42 = api.serializeRibbonRotateFramesForTimeline(next, [{ value: 0 }], { skeleton: { spine: '4.2.43' } }, 'value');
  const v38 = api.serializeRibbonRotateFramesForTimeline(next, [{ angle: 0 }], { skeleton: { spine: '3.8.99' } }, 'angle');
  assert.ok(v42.every(frame => Number.isFinite(frame.value) && !Object.hasOwn(frame, 'angle')));
  assert.ok(v38.every(frame => Number.isFinite(frame.angle) && !Object.hasOwn(frame, 'value')));
});

test('built-in and saved-parameter thumbnails use the production solver on ten equal bones', () => {
  const fixture = chain(10, 'bone', Array(10).fill(32));
  const builtin = presets.find(preset => preset.label === '鞭梢甩尾').values;
  const custom = { ...builtin, waveCount: 1.35, amplitude: 42 };
  const preview = api.buildRibbonParameterPresetPreview(custom);
  assert.equal(preview.boneCount, 10);
  assert.equal(preview.segmentLength, 32);
  assert.equal(preview.duration, 2);
  assert.deepEqual(plain(preview.curves), plain([...run(fixture, custom).values()]));
  assert.notDeepEqual(plain(preview.curves), plain(api.buildRibbonParameterPresetPreview(builtin).curves));
  assert.equal(custom.waveCount, 1.35);
  assert.equal(api.buildRibbonParameterPresetPreview(null), null);
});

test('approved built-ins replace the old catalog and keep ten-bone chains in closed, non-crossing loops', () => {
  assert.deepEqual(Array.from(presets, preset => preset.label), [
    '轻风细摆', '丝带长浪', '双浪游动', '厚重垂摆', '硬链摆锤', '鞭梢甩尾', '侧风翻卷', '快速颤动'
  ]);
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (const preset of presets) {
    assert.ok(preset.values.uniformWeight > 0);
    assert.deepEqual(plain(api.normalizeRibbonParameterPresetValues(preset.values)), plain(preset.values));
    const fixture = chain(10, 'bone', Array(10).fill(32)), curves = run(fixture, preset.values);
    const tailY = [];
    let maxJoint = 0;
    for (let frame = 0; frame <= 480; frame++) {
      let direction = 0, x = 0, y = 0;
      const points = [{ x, y }];
      for (const entry of fixture.entries) {
        const frames = curves.get(entry.name);
        assert.equal(frames[0].angle, frames.at(-1).angle);
        const angle = api.sampleRibbonUniformLoop(frames, frame / 240, 2);
        assert.ok(Number.isFinite(angle));
        if (entry.chainIndex > 0) maxJoint = Math.max(maxJoint, Math.abs(angle));
        direction += angle * Math.PI / 180;
        x += Math.cos(direction) * 32;
        y += Math.sin(direction) * 32;
        points.push({ x, y });
      }
      tailY.push(y);
      for (let a = 0; a < 10; a++) for (let b = a + 2; b < 10; b++) {
        const intersects = cross(points[a], points[a + 1], points[b]) * cross(points[a], points[a + 1], points[b + 1]) < -1e-8 &&
          cross(points[b], points[b + 1], points[a]) * cross(points[b], points[b + 1], points[a + 1]) < -1e-8;
        assert.equal(intersects, false, `${preset.label} crosses itself at frame ${frame}`);
      }
    }
    if (preset.label === '鞭梢甩尾') {
      assert.ok(maxJoint < 27, 'the rounded whip must avoid concentrated joint bends');
      const travel = Math.max(...tailY) - Math.min(...tailY);
      assert.ok(travel > 430 && travel < 455, 'the rounded whip must retain the approved tail swing');
    }
  }
});
