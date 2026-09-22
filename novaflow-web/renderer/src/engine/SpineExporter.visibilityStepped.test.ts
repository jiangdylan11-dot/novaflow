import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { exportToSpine } from './SpineExporter';
import type { ParticleSystemConfig } from '../types';

function loadTemplate(basename: string): ParticleSystemConfig {
  const p = path.resolve(__dirname, '..', '..', '..', 'particle-editor-desktop', 'resources', 'initial-templates', basename);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function alpha255(c?: string) {
  const s = String(c || '').trim();
  if (/^[0-9a-fA-F]{8}$/.test(s)) return parseInt(s.slice(6, 8), 16);
  return 255;
}

describe('SpineExporter visibility stepped', () => {
  const isColorHidden = (f: any) => alpha255(f?.color) <= 10;

  const hasMissingStepped = (frames: any[], hidden: (f: any) => boolean) => {
    if (!Array.isArray(frames) || frames.length < 2) return false;
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i];
      const b = frames[i + 1];
      const ha = hidden(a);
      const hb = hidden(b);
      if (ha === hb) continue;
      if (ha && !hb) {
        if (a?.curve !== 'stepped') return true;
        continue;
      }
      const gap = Number(b?.time ?? 0) - Number(a?.time ?? 0);
      const ok = a?.curve === 'stepped' || b?.curve === 'stepped' || gap <= (1 / 60) * 1.1;
      if (!ok) return true;
    }
    return false;
  };

  const findMissingStepped = (frames: any[], hidden: (f: any) => boolean) => {
    if (!Array.isArray(frames) || frames.length < 2) return null as null | { i: number; a: any; b: any };
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i];
      const b = frames[i + 1];
      const ha = hidden(a);
      const hb = hidden(b);
      if (ha === hb) continue;
      if (ha && !hb) {
        if (a?.curve !== 'stepped') return { i, a, b };
        continue;
      }
      const gap = Number(b?.time ?? 0) - Number(a?.time ?? 0);
      const ok = a?.curve === 'stepped' || b?.curve === 'stepped' || gap <= (1 / 60) * 1.1;
      if (!ok) return { i, a, b };
    }
    return null;
  };

  it('adds stepped curve at visibility transitions for custom path (3.8)', () => {
    const cfg = loadTemplate('NovaFlow项目_自定义路径.json');
    const json = JSON.parse(exportToSpine([cfg], '3.8'));
    const anim = json.animations?.animation || {};
    const bones: Record<string, any> = anim.bones || {};
    const slots: Record<string, any> = anim.slots || {};

    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
    expect(particleBones.length).toBeGreaterThan(10);

    for (const bn of particleBones) {
      const co = slots[bn]?.color || [];
      expect(hasMissingStepped(co, isColorHidden)).toBe(false);
    }
  });

  it('adds stepped curve at visibility transitions for custom path (4.1)', () => {
    const cfg = loadTemplate('NovaFlow项目_自定义路径.json');
    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const anim = json.animations?.animation || {};
    const bones: Record<string, any> = anim.bones || {};
    const slots: Record<string, any> = anim.slots || {};

    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
    expect(particleBones.length).toBeGreaterThan(10);

    for (const bn of particleBones) {
      const co = slots[bn]?.color || [];
      const miss = findMissingStepped(co, isColorHidden);
      if (miss) throw new Error(`${bn} missing stepped at i=${miss.i} a=${JSON.stringify(miss.a)} b=${JSON.stringify(miss.b)}`);
    }
  });

  it('adds stepped curve at visibility transitions for ui glow (3.8)', () => {
    const cfg = loadTemplate('21_UI_按钮环绕流光.json');
    const json = JSON.parse(exportToSpine([cfg], '3.8'));
    const anim = json.animations?.animation || {};
    const bones: Record<string, any> = anim.bones || {};
    const slots: Record<string, any> = anim.slots || {};

    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
    expect(particleBones.length).toBeGreaterThan(10);

    for (const bn of particleBones) {
      const co = slots[bn]?.color || [];
      expect(hasMissingStepped(co, isColorHidden)).toBe(false);
    }
  });

  it('adds stepped curve at visibility transitions for ui glow (4.1)', () => {
    const cfg = loadTemplate('21_UI_按钮环绕流光.json');
    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const anim = json.animations?.animation || {};
    const bones: Record<string, any> = anim.bones || {};
    const slots: Record<string, any> = anim.slots || {};

    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
    expect(particleBones.length).toBeGreaterThan(10);

    for (const bn of particleBones) {
      const co = slots[bn]?.color || [];
      const miss = findMissingStepped(co, isColorHidden);
      if (miss) throw new Error(`${bn} missing stepped at i=${miss.i} a=${JSON.stringify(miss.a)} b=${JSON.stringify(miss.b)}`);
    }
  });

  it('injects stepped curves into translate/scale/rotate only near visibility transitions (3.8)', () => {
    const cfg = loadTemplate('10_火焰_喷射.json');
    const json = JSON.parse(exportToSpine([cfg], '3.8'));
    const anim = json.animations?.animation || {};
    const bones: Record<string, any> = anim.bones || {};
    const slots: Record<string, any> = anim.slots || {};
    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
    expect(particleBones.length).toBeGreaterThan(10);

    const hasAnyVisibilityTransition = (bn: string) => {
      const co = slots[bn]?.color || [];
      if (!Array.isArray(co) || co.length < 2) return false;
      for (let i = 0; i < co.length - 1; i++) {
        const a = co[i];
        const b = co[i + 1];
        if (isColorHidden(a) !== isColorHidden(b)) return true;
      }
      return false;
    };

    for (const bn of particleBones) {
      const b = bones[bn] || {};
      const hasTransition = hasAnyVisibilityTransition(bn);
      for (const key of ['translate', 'scale', 'rotate'] as const) {
        const arr = b[key] || [];
        for (const f of arr) {
          if (f?.curve !== 'stepped') continue;
          const tf = Number(f?.time ?? NaN);
          if (!Number.isFinite(tf)) continue;
          if (tf <= 1e-6) continue;
          if (!hasTransition) throw new Error(`${bn}:${key} has stepped at time=${tf} but slot.color has no visibility transitions`);
        }
      }
    }
  });
});
