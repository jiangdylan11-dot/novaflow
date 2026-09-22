import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { exportToSpine } from './SpineExporter';
import type { ParticleSystemConfig } from '../types';

function loadTemplate(basename: string): ParticleSystemConfig {
  const p = path.resolve(__dirname, '..', '..', '..', 'particle-editor-desktop', 'resources', 'initial-templates', basename);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function angleOf(x: number, y: number) {
  return Math.atan2(y, x);
}

function unwrap(angles: number[]) {
  const out: number[] = [];
  let prev = angles[0] ?? 0;
  out.push(prev);
  for (let i = 1; i < angles.length; i++) {
    let a = angles[i] ?? 0;
    while (a - prev > Math.PI) a -= Math.PI * 2;
    while (a - prev < -Math.PI) a += Math.PI * 2;
    out.push(a);
    prev = a;
  }
  return out;
}

describe('SpineExporter spiral templates', () => {
  it('exports spiral motion for vortex templates (3.8)', () => {
    const templates = ['23_魔法_漩涡.json', 'NovaFlow项目_漩涡.json'] as const;

    for (const t of templates) {
      const cfg = loadTemplate(t);
      const json = JSON.parse(exportToSpine([cfg], '3.8'));
      const anim = json.animations?.animation || {};
      const bones: Record<string, any> = anim.bones || {};

      const firstParticle = Object.keys(bones).find((n) => n.includes('_p_'));
      if (!firstParticle) throw new Error(`missing particle bone for ${t}`);

      const tr = (bones[firstParticle]?.translate || []) as { time: number; x: number; y: number }[];
      expect(tr.length).toBeGreaterThan(10);

      const angles = tr.map((k) => angleOf(Number(k.x || 0), Number(k.y || 0)));
      const unwrapped = unwrap(angles);
      const delta = Math.abs((unwrapped[unwrapped.length - 1] ?? 0) - (unwrapped[0] ?? 0));

      expect(delta).toBeGreaterThan(0.5);
    }
  });

  it('keeps NovaFlow项目_漩涡 stable for loop seam (3.8)', () => {
    const cfg = loadTemplate('NovaFlow项目_漩涡.json');
    const json = JSON.parse(exportToSpine([cfg], '3.8'));
    const anim = json.animations?.animation || {};
    const bones: Record<string, any> = anim.bones || {};
    const slots: Record<string, any> = anim.slots || {};

    const duration = Number(bones?.sys_0_GEN?.translate?.[1]?.time ?? NaN);
    const expectDur = Math.max(0.01, Number(cfg.lifetimeMin || 0), Number(cfg.lifetimeMax || 0));
    expect(duration).toBeCloseTo(expectDur, 3);

    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
    expect(particleBones.length).toBeGreaterThan(20);

    const hasCurveOnLast = (frames: any) => {
      if (!Array.isArray(frames) || frames.length === 0) return false;
      const last = frames[frames.length - 1];
      return last && last.curve !== undefined;
    };

    for (const bn of particleBones) {
      const b = bones[bn] || {};
      const tr = b.translate;
      const sc = b.scale;
      const co = slots[bn]?.color;

      expect(Array.isArray(tr) && tr.length > 0).toBe(true);
      expect(Array.isArray(sc) && sc.length > 0).toBe(true);
      expect(Array.isArray(co) && co.length > 0).toBe(true);

      expect(hasCurveOnLast(tr)).toBe(false);
      expect(hasCurveOnLast(sc)).toBe(false);
      expect(hasCurveOnLast(co)).toBe(false);
    }
  });

  it('keeps NovaFlow项目_外扩散漩涡 stable for loop seam (3.8)', () => {
    const cfg = loadTemplate('NovaFlow项目_外扩散漩涡.json');
    const json = JSON.parse(exportToSpine([cfg], '3.8'));
    const anim = json.animations?.animation || {};
    const bones: Record<string, any> = anim.bones || {};
    const slots: Record<string, any> = anim.slots || {};

    const duration = Number(bones?.sys_0_GEN?.translate?.[1]?.time ?? NaN);
    const expectDur = Math.max(0.01, Number(cfg.lifetimeMin || 0), Number(cfg.lifetimeMax || 0));
    expect(duration).toBeCloseTo(expectDur, 3);

    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
    expect(particleBones.length).toBeGreaterThan(20);

    const hasCurveOnLast = (frames: any) => {
      if (!Array.isArray(frames) || frames.length === 0) return false;
      const last = frames[frames.length - 1];
      return last && last.curve !== undefined;
    };

    for (const bn of particleBones) {
      const b = bones[bn] || {};
      const tr = b.translate;
      const sc = b.scale;
      const co = slots[bn]?.color;

      expect(Array.isArray(tr) && tr.length > 0).toBe(true);
      expect(Array.isArray(sc) && sc.length > 0).toBe(true);
      expect(Array.isArray(co) && co.length > 0).toBe(true);

      expect(hasCurveOnLast(tr)).toBe(false);
      expect(hasCurveOnLast(sc)).toBe(false);
      expect(hasCurveOnLast(co)).toBe(false);
    }
  });
});
