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

describe('SpineExporter loop seam carry-over', () => {
  it('does not leave end-visible particles hidden at t=0 for loop templates (3.8)', () => {
    const cfg = loadTemplate('21_UI_按钮环绕流光.json');
    const json = JSON.parse(exportToSpine([cfg], '3.8'));
    const anim = json.animations?.animation || {};
    const bones: Record<string, any> = anim.bones || {};
    const slots: Record<string, any> = anim.slots || {};

    const T = Number(bones?.sys_0_GEN?.translate?.[1]?.time ?? NaN);
    expect(Number.isFinite(T)).toBe(true);

    const particleBones = Object.keys(bones).filter((n) => n.includes('_p_'));
    expect(particleBones.length).toBeGreaterThan(10);

    const keyAt = (arr: any[], time: number) => (arr || []).find((k) => Math.abs(Number(k?.time ?? 0) - time) <= 1e-6);

    let mismatched = 0;
    for (const bn of particleBones) {
      const co = (slots[bn]?.color || []) as { time: number; color: string }[];
      if (!Array.isArray(co) || co.length === 0) continue;

      const c0 = keyAt(co as any, 0);
      const cEnd = co[co.length - 1];
      const a0 = c0 ? alpha255(String((c0 as any).color || '')) : 0;
      const aEnd = alpha255(String((cEnd as any).color || ''));

      if (aEnd > 10 && a0 <= 10) mismatched++;
    }

    expect(mismatched).toBe(0);
  });
});
