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

describe('SpineExporter aura scale completeness', () => {
  it('does not truncate scale/rotate while still visible (4.1)', () => {
    const cfg = loadTemplate('NovaFlow项目_魔法·光环.json');
    const json = JSON.parse(exportToSpine([cfg], '4.1'));
    const anim = json.animations?.animation || {};
    const bones = anim.bones || {};
    const slots = anim.slots || {};
    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));

    const bad: any[] = [];
    for (const bn of particleBones) {
      const co = slots[bn]?.color || [];
      const sc = bones[bn]?.scale || [];
      const ro = bones[bn]?.rotate || [];
      if (!Array.isArray(co) || co.length === 0) continue;
      if (!Array.isArray(sc) || sc.length === 0) continue;

      let lastVis = -1;
      for (const k of co) {
        const t = Number(k?.time ?? NaN);
        if (!Number.isFinite(t)) continue;
        if (alpha255(k?.color) > 10) lastVis = Math.max(lastVis, t);
      }
      if (lastVis < 0) continue;

      const lastTime = (arr: any[]) => {
        let m = -1;
        for (const k of arr || []) {
          const t = Number(k?.time ?? NaN);
          if (Number.isFinite(t)) m = Math.max(m, t);
        }
        return m;
      };

      const lastSc = lastTime(sc);
      const lastRo = Array.isArray(ro) && ro.length ? lastTime(ro) : lastVis;
      const tol = 0.02;
      if (lastSc < lastVis - tol || lastRo < lastVis - tol) {
        bad.push({ bn, lastVis, lastSc, lastRo, scLen: sc.length, roLen: Array.isArray(ro) ? ro.length : 0, coLen: co.length });
      }
    }

    expect(bad).toEqual([]);
  });
});
