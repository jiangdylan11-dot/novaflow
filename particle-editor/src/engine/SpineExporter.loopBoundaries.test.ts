import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { exportToSpine } from './SpineExporter';
import type { ParticleSystemConfig } from '../types';

function templatesDir() {
  return path.resolve(__dirname, '..', '..', '..', 'particle-editor-desktop', 'resources', 'initial-templates');
}

function loadTemplate(basename: string): ParticleSystemConfig {
  const p = path.resolve(templatesDir(), basename);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function listTemplateBasenames() {
  return readdirSync(templatesDir()).filter((n) => n.toLowerCase().endsWith('.json')).sort();
}

function assertTimelineTimesWithin(frames: any, duration: number, label: string) {
  if (!Array.isArray(frames) || frames.length === 0) return;
  for (const f of frames) {
    const t = Number(f?.time ?? 0);
    expect(Number.isFinite(t), `${label} has non-finite time`).toBe(true);
    expect(t, `${label} time < 0`).toBeGreaterThanOrEqual(-1e-6);
    expect(t, `${label} time > duration`).toBeLessThanOrEqual(duration + 1e-6);
  }
}

describe('SpineExporter loop boundaries', () => {
  it('keeps all keyframe times within animation duration (3.8)', () => {
    const basenames = listTemplateBasenames();
    expect(basenames.length).toBeGreaterThan(0);

    for (const name of basenames) {
      const cfg = loadTemplate(name);
      const json = JSON.parse(exportToSpine([cfg], '3.8'));
      const anim = json.animations?.animation || {};
      const bones: Record<string, any> = anim.bones || {};
      const slots: Record<string, any> = anim.slots || {};

      const duration = Number(bones?.sys_0_GEN?.translate?.[1]?.time ?? NaN);
      expect(Number.isFinite(duration), `${name} missing duration`).toBe(true);
      expect(duration, `${name} duration <= 0`).toBeGreaterThan(1e-6);

      for (const [boneName, b] of Object.entries<any>(bones)) {
        assertTimelineTimesWithin(b?.translate, duration, `${name} bones.${boneName}.translate`);
        assertTimelineTimesWithin(b?.scale, duration, `${name} bones.${boneName}.scale`);
        assertTimelineTimesWithin(b?.rotate, duration, `${name} bones.${boneName}.rotate`);
      }
      for (const [slotName, s] of Object.entries<any>(slots)) {
        assertTimelineTimesWithin(s?.color, duration, `${name} slots.${slotName}.color`);
        assertTimelineTimesWithin(s?.attachment, duration, `${name} slots.${slotName}.attachment`);
      }
    }
  }, 60000);
});
