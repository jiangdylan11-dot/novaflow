import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { exportToSpine } from './SpineExporter';
import type { ParticleSystemConfig } from '../types';

function loadTemplate(basename: string): ParticleSystemConfig {
  const p = path.resolve(__dirname, '..', '..', '..', 'particle-editor-desktop', 'resources', 'initial-templates', basename);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function maxTimeInAnim(anim: any) {
  let m = 0;
  const bones = anim?.bones || {};
  for (const b of Object.values(bones)) {
    for (const arr of Object.values(b as any)) {
      if (!Array.isArray(arr)) continue;
      for (const k of arr) m = Math.max(m, Number((k as any)?.time ?? 0));
    }
  }
  const slots = anim?.slots || {};
  for (const s of Object.values(slots)) {
    for (const arr of Object.values(s as any)) {
      if (!Array.isArray(arr)) continue;
      for (const k of arr) m = Math.max(m, Number((k as any)?.time ?? 0));
    }
  }
  return m;
}

describe('SpineExporter loop regressions', () => {
  it('does not mass-inject keys at duration for loop templates (3.8)', () => {
    const templates = ['10_火焰_喷射.json', '30_烟雾_上升.json', 'NovaFlow项目_金币-放射.json'];
    for (const t of templates) {
      const cfg = loadTemplate(t);
      const json = JSON.parse(exportToSpine([cfg], '3.8'));
      const anim = json.animations?.animation || {};
      const T = maxTimeInAnim(anim);
      const bones: Record<string, any> = anim.bones || {};
      const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
      expect(particleBones.length).toBeGreaterThan(10);

      const keyAt = (arr: any[], time: number) => (arr || []).find((k) => Math.abs(Number(k?.time ?? 0) - time) <= 1e-6);
      let countSeamCopied = 0;
      for (const bn of particleBones) {
        const b = bones[bn] || {};
        const t0 = keyAt(b.translate || [], 0);
        const tT = keyAt(b.translate || [], T);
        const s0 = keyAt(b.scale || [], 0);
        const sT = keyAt(b.scale || [], T);
        if (!t0 || !tT || !s0 || !sT) continue;
        const eq = (a: number, c: number) => Math.abs(Number(a) - Number(c)) <= 1e-4;
        const sameTr = eq(t0.x ?? 0, tT.x ?? 0) && eq(t0.y ?? 0, tT.y ?? 0);
        const sameSc = eq(s0.x ?? 1, sT.x ?? 1) && eq(s0.y ?? 1, sT.y ?? 1);
        if (sameTr && sameSc) countSeamCopied++;
      }
      expect(countSeamCopied).toBeLessThanOrEqual(Math.ceil(particleBones.length * 0.4));
    }
  });
});
