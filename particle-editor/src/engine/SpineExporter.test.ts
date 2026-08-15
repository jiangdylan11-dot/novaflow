import { describe, expect, it } from 'vitest';
import { exportToSpine } from './SpineExporter';
import { defaultConfig, type ParticleSystemConfig } from '../types';

function alphaFromRgba8888(rgba: string) {
  const hex = (rgba || '').trim().replace('#', '');
  const a = hex.length === 8 ? hex.slice(6, 8) : '00';
  return parseInt(a, 16);
}

const sprite = {
  id: 's1',
  name: 'particle',
  dataUrl: '',
  path: '',
  weight: 1,
  mode: 'single',
  colorStops: [],
  colorMode: 'fixed',
  blendMode: 'add',
  color: '#ffffff'
} as const;

describe('SpineExporter', () => {
  it('exports loop stream with visible particles at time 0', () => {
    const cfg: ParticleSystemConfig = {
      ...defaultConfig,
      id: 'loop',
      systemName: 'loop',
      mode: 'stream',
      streamLoopEnabled: true,
      streamDurationSec: 2,
      rate: 30,
      lifetimeMin: 0.8,
      lifetimeMax: 1.2,
      gravityEnabled: false,
      dampingEnabled: false,
      noiseEnabled: false,
      rotationMode: 'direction',
      sprites: [sprite as any]
    };

    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const slots = json.animations.animation.slots as Record<string, { color?: { time?: number; color: string }[] }>;
    const keysAt0 = Object.values(slots)
      .flatMap((s) => (s.color || []).filter((k) => Math.abs(Number((k as any).time ?? 0) - 0) < 1e-6));
    const anyVisible = keysAt0.some((k) => alphaFromRgba8888(k.color) > 0);
    expect(anyVisible).toBe(true);
  });

  it('keeps non-trivial rotate timelines for direction rotation', () => {
    const cfg: ParticleSystemConfig = {
      ...defaultConfig,
      id: 'rot',
      systemName: 'rot',
      mode: 'stream',
      streamLoopEnabled: true,
      streamDurationSec: 2,
      rate: 10,
      lifetimeMin: 1.0,
      lifetimeMax: 1.0,
      gravityEnabled: true,
      gravityY: 800,
      noiseEnabled: true,
      noiseMode: 'random',
      noiseFrequency: 3,
      noiseIntensity: 50,
      rotationMode: 'direction',
      sprites: [sprite as any]
    };

    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const bones = json.animations.animation.bones as Record<string, { rotate?: { time: number; angle: number }[] }>;
    const some = Object.values(bones)
      .map((b) => b.rotate || [])
      .filter((r) => r.length > 0);
    expect(some.length).toBeGreaterThan(0);
    const rich = some.some((r) => {
      const angles = r.map((k) => k.angle);
      const uniq = new Set(angles.map((a) => Math.round(a * 10) / 10));
      return r.length >= 6 && uniq.size >= 4;
    });
    expect(rich).toBe(true);
  });

  it('exports sequence attachments for multi-frame sprite', () => {
    const seq = {
      ...sprite,
      id: 'seq-1',
      name: 'spark',
      mode: 'sequence',
      dataUrl: 'data:,',
      frames: [
        { name: '0001.png', dataUrl: 'data:,' },
        { name: '0002.png', dataUrl: 'data:,' },
        { name: '0003.png', dataUrl: 'data:,' }
      ]
    } as any;

    const cfg: ParticleSystemConfig = {
      ...defaultConfig,
      id: 'seq',
      systemName: 'seq',
      mode: 'stream',
      streamLoopEnabled: true,
      loopAnimation: false,
      streamDurationSec: 1.5,
      rate: 5,
      lifetimeMin: 1.0,
      lifetimeMax: 1.0,
      spritePlayback: 'sequence',
      spriteSequenceFps: 12,
      spriteSequenceLoop: true,
      sprites: [seq]
    };

    const clean = 'seq-1'.trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'sp'
    const seqAttachment = `spark_${clean}_seq`
    const seqPath = `spark_${clean}_`

    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const slot0 = (json.slots as { name: string; attachment?: string }[]).find((s) => s.name === 'sys_0_p_0');
    expect(slot0?.attachment).toBe(seqAttachment);

    const skins0 = (json.skins as { name: string; attachments: Record<string, Record<string, unknown>> }[])[0];
    const slotSkins = skins0.attachments['sys_0_p_0'] || {};
    const att = slotSkins[seqAttachment] as any
    expect(att).toBeTruthy()
    expect(att.path).toBe(seqPath)
    expect(att.sequence?.count).toBe(3)
    expect(att.sequence?.start).toBe(0)
    expect(att.sequence?.digits).toBe(4)
    expect(att.sequence?.setup).toBe(0)

    const animAttachments = (json.animations.animation.attachments as any) || {}
    const seqKeys = animAttachments?.default?.['sys_0_p_0']?.[seqAttachment]?.sequence
    expect(Array.isArray(seqKeys) && seqKeys.length > 0).toBe(true)
  });

  it('wraps attachment timeline at loop boundary', () => {
    const seq = {
      ...sprite,
      id: 'seq-2',
      name: 'coin',
      mode: 'sequence',
      dataUrl: 'data:,',
      frames: [
        { name: '0.png', dataUrl: 'data:,' },
        { name: '1.png', dataUrl: 'data:,' }
      ]
    } as any;

    const cfg: ParticleSystemConfig = {
      ...defaultConfig,
      id: 'seq-loop',
      systemName: 'seq-loop',
      mode: 'stream',
      streamLoopEnabled: true,
      loopAnimation: true,
      loopDurationSec: 0.8,
      rate: 5,
      lifetimeMin: 2.0,
      lifetimeMax: 2.0,
      spritePlayback: 'sequence',
      spriteSequenceFps: 12,
      spriteSequenceLoop: true,
      sprites: [seq]
    };

    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const clean = 'seq-2'.trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'sp'
    const seqAttachment = `coin_${clean}_seq`
    const animAttachments = (json.animations.animation.attachments as any) || {}
    const seqKeys = animAttachments?.default?.['sys_0_p_0']?.[seqAttachment]?.sequence || []
    const has0 = (seqKeys as any[]).some((k) => Math.abs(Number(k?.time ?? 0) - 0) < 1e-6)
    expect(has0).toBe(true)
  });


  it('keeps shape emission when attractor enabled (circle)', () => {
    const cfg: ParticleSystemConfig = {
      ...defaultConfig,
      id: 'circle-attractor',
      systemName: 'circle-attractor',
      mode: 'burst',
      burstCount: 1,
      gravityEnabled: false,
      dampingEnabled: false,
      noiseEnabled: false,
      attractorEnabled: true,
      attractorMode: 'linear',
      attractorStrength: 500,
      attractorRadius: 300,
      shape: { type: 'circle', x: 0, y: 0, innerRadius: 80, outerRadius: 120, emitInward: false },
      sprites: [sprite as any]
    };

    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const bones = json.animations.animation.bones as Record<string, { translate?: { time: number; x: number; y: number }[] }>;
    const p0 = bones['sys_0_p_0']?.translate?.[0];
    if (!p0) throw new Error('missing sys_0_p_0 translate');
    const r = Math.hypot(p0.x, p0.y);
    expect(r).toBeGreaterThan(10);
  });

  it('respects emissionAngle for rect shape', () => {
    // Particles should all emit near sysAngle (0) with small spread, not outward from center.
    // With emissionAngleDeg=10, all particles should travel mostly in +X direction.
    const cfg: ParticleSystemConfig = {
      ...defaultConfig,
      id: 'rect-emission',
      systemName: 'rect-emission',
      loopAnimation: false,
      mode: 'burst',
      burstCount: 20,
      gravityEnabled: false,
      dampingEnabled: false,
      noiseEnabled: false,
      attractorEnabled: false,
      emissionAngleEnabled: true,
      emissionAngleDeg: 10,
      emissionOffsetDeg: 0,
      speedMin: 200,
      speedMax: 200,
      lifetimeMin: 1,
      lifetimeMax: 1,
      shape: { type: 'rect', x: 0, y: 0, width: 100, height: 100 } as any,
      sprites: [sprite as any]
    };

    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const bones = json.animations.animation.bones as Record<string, { translate?: { time: number; x: number; y: number }[] }>;
    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
    expect(particleBones.length).toBeGreaterThan(0);
    const dirs: { x: number; y: number }[] = [];
    for (const boneName of particleBones) {
      const tr = bones[boneName]?.translate || [];
      if (tr.length < 2) continue;
      const first = tr[0];
      const last = [...tr].reverse().find((k) => Number(k?.time ?? 0) > Number(first?.time ?? 0) + 1e-6) || tr[tr.length - 1];
      if (!first || !last || first === last) continue;
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const len = Math.hypot(dx, dy);
      if (len <= 1e-6) continue;
      dirs.push({ x: dx / len, y: dy / len });
    }
    expect(dirs.length).toBeGreaterThan(0);
    const mean = dirs.reduce((acc, d) => ({ x: acc.x + d.x, y: acc.y + d.y }), { x: 0, y: 0 });
    const meanLen = Math.hypot(mean.x, mean.y);
    expect(meanLen).toBeGreaterThan(1e-6);
    const mx = mean.x / meanLen;
    const my = mean.y / meanLen;
    const cos30 = Math.cos((30 * Math.PI) / 180);
    const aligned = dirs.filter((d) => d.x * mx + d.y * my >= cos30).length;
    expect(aligned).toBeGreaterThan(dirs.length * 0.7);
  });

  it('spawns on edges when rectEdgeOnly is set', () => {
    const cfg: ParticleSystemConfig = {
      ...defaultConfig,
      id: 'rect-edge',
      systemName: 'rect-edge',
      mode: 'burst',
      burstCount: 30,
      gravityEnabled: false,
      dampingEnabled: false,
      noiseEnabled: false,
      attractorEnabled: false,
      emissionAngleEnabled: false,
      speedMin: 0,
      speedMax: 0,
      lifetimeMin: 2,
      lifetimeMax: 2,
      shape: { type: 'rect', x: 0, y: 0, width: 100, height: 100, rectEdgeOnly: true } as any,
      sprites: [sprite as any]
    };

    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const bones = json.animations.animation.bones as Record<string, { translate?: { time: number; x: number; y: number }[] }>;
    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
    expect(particleBones.length).toBeGreaterThan(0);
    // With speed=0, initial position should be on an edge (|x|=50 or |y|=50)
    let countOnEdge = 0;
    for (const boneName of particleBones) {
      const tr = bones[boneName]?.translate || [];
      const f0 = tr[0];
      if (!f0) continue;
      const onEdge = Math.abs(Math.abs(f0.x) - 50) < 2 || Math.abs(Math.abs(f0.y) - 50) < 2;
      if (onEdge) countOnEdge++;
    }
    expect(countOnEdge).toBeGreaterThan(particleBones.length * 0.8);
  });

  it('path emitter mode orbits particles on circle', () => {
    const cfg: ParticleSystemConfig = {
      ...defaultConfig,
      id: 'path-emitter',
      systemName: 'path-emitter',
      mode: 'stream',
      streamLoopEnabled: true,
      loopAnimation: true,
      loopDurationSec: 1,
      rate: 30,
      lifetimeMin: 0.6,
      lifetimeMax: 1.0,
      gravityEnabled: false,
      dampingEnabled: false,
      noiseEnabled: false,
      pathEnabled: true,
      pathMode: 'emitter',
      pathType: 'circle',
      pathRadiusX: 86,
      pathRadiusY: 86,
      pathSpeedDegPerSec: 260,
      pathRandomStartAngle: false,
      attractorEnabled: false,
      sprites: [sprite as any]
    } as any;

    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const bones = json.animations.animation.bones as Record<string, { translate?: { time: number; x: number; y: number }[] }>;
    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
    expect(particleBones.length).toBeGreaterThan(0);

    // All translate keyframes for path-mode particles should stay at radius ~86
    let onOrbitCount = 0;
    let totalFrames = 0;
    for (const boneName of particleBones.slice(0, 10)) {
      const tr = bones[boneName]?.translate || [];
      for (const k of tr) {
        const r = Math.hypot(k.x, k.y);
        totalFrames++;
        if (Math.abs(r - 86) < 10) onOrbitCount++;
      }
    }
    expect(totalFrames).toBeGreaterThan(0);
    expect(onOrbitCount / totalFrames).toBeGreaterThan(0.9);
  });

  it('linear attractor pulls particles toward center', () => {
    // Use circle shape so particles start at known radius (100px), fire outward.
    // With strong attractor (500), they should decelerate and end up closer to center.
    const cfg: ParticleSystemConfig = {
      ...defaultConfig,
      id: 'attractor-linear',
      systemName: 'attractor-linear',
      mode: 'burst',
      burstCount: 15,
      gravityEnabled: false,
      dampingEnabled: false,
      noiseEnabled: false,
      attractorEnabled: true,
      attractorMode: 'linear',
      attractorStrength: 500,
      attractorRadius: 0,
      lifetimeMin: 1.0,
      lifetimeMax: 1.0,
      speedMin: 50,
      speedMax: 50,
      shape: { type: 'circle', x: 0, y: 0, innerRadius: 100, outerRadius: 100, emitInward: false } as any,
      sprites: [sprite as any]
    };

    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const bones = json.animations.animation.bones as Record<string, { translate?: { time: number; x: number; y: number }[] }>;
    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
    expect(particleBones.length).toBeGreaterThan(0);

    // Particles spawn at r=100, fire outward with speed=50.
    // Attractor strength=500 >> speed=50, so they quickly turn around and converge to center.
    // Final position should have smaller radius than initial position.
    let convergeCount = 0;
    for (const boneName of particleBones) {
      const tr = bones[boneName]?.translate || [];
      if (tr.length < 2) continue;
      const first = tr[0];
      const last = tr[tr.length - 1];
      if (!first || !last) continue;
      const r0 = Math.hypot(first.x, first.y);
      const r1 = Math.hypot(last.x, last.y);
      if (r1 < r0) convergeCount++;
    }
    expect(convergeCount).toBeGreaterThan(particleBones.length * 0.7);
  });

  it('ignores loopDurationSec when loopAnimation is enabled (duration = max lifetime)', () => {
    const cfg: ParticleSystemConfig = {
      ...defaultConfig,
      id: 'dur',
      systemName: 'dur',
      mode: 'stream',
      streamLoopEnabled: true,
      loopAnimation: true,
      loopDurationSec: 0.8,
      streamDurationSec: 0,
      rate: 10,
      lifetimeMin: 0.9,
      lifetimeMax: 2.1,
      sprites: [sprite as any]
    };
    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const gen = (json.animations.animation.bones as any)['sys_0_GEN'];
    expect(gen?.translate?.[1]?.time).toBeCloseTo(2.1, 3);
  });
});
