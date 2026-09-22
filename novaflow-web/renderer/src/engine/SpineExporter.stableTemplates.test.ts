import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { exportToSpine } from './SpineExporter';
import type { ParticleSystemConfig } from '../types';

function loadTemplate(basename: string): ParticleSystemConfig {
  const p = path.resolve(__dirname, '..', '..', '..', 'particle-editor-desktop', 'resources', 'initial-templates', basename);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function signatureFor(cfg: ParticleSystemConfig, spineVersion: string) {
  const json = JSON.parse(exportToSpine([cfg], spineVersion));
  const anim = json.animations?.animation || {};
  const gen = anim.bones?.sys_0_GEN?.translate || [];
  const duration = gen?.[1]?.time ?? null;
  const expectedLoopDuration = cfg.loopAnimation
    ? Math.max(0.01, Number(cfg.lifetimeMin || 0), Number(cfg.lifetimeMax || 0))
    : null;

  const bones = anim.bones || {};
  const slots = anim.slots || {};

  const particleBoneNames = Object.keys(bones).filter((n) => n.includes('_p_'));
  const particleSlotNames = Object.keys(slots).filter((n) => n.includes('_p_'));

  const hasEmptyTimeline = () => {
    for (const b of Object.values<any>(bones)) {
      for (const k of ['translate', 'scale', 'rotate']) {
        if (k in b && (!Array.isArray(b[k]) || b[k].length === 0)) return true;
      }
    }
    for (const s of Object.values<any>(slots)) {
      for (const k of ['color', 'attachment']) {
        if (k in s && (!Array.isArray(s[k]) || s[k].length === 0)) return true;
      }
    }
    return false;
  };

  const attachmentSeamMismatch = () => {
    if (!cfg.loopAnimation) return null;
    if (duration == null) return null;
    const mismatches: string[] = [];
    for (const [slotName, s] of Object.entries<any>(slots)) {
      const att = s?.attachment;
      if (!Array.isArray(att) || att.length === 0) continue;
      const at0 = att.find((k: any) => Math.abs((k.time ?? 0) - 0) <= 1e-6);
      const atEnd = att.find((k: any) => Math.abs((k.time ?? 0) - duration) <= 1e-6);
      if (!at0 || !atEnd) continue;
      if (String(at0.name) !== String(atEnd.name)) mismatches.push(slotName);
    }
    return mismatches.length ? mismatches.slice(0, 10) : null;
  };

  return {
    systemName: cfg.systemName,
    mode: cfg.mode,
    loopAnimation: !!cfg.loopAnimation,
    loopDurationSec: cfg.loopDurationSec ?? null,
    streamLoopEnabled: !!cfg.streamLoopEnabled,
    rate: cfg.rate ?? null,
    spritePlayback: cfg.spritePlayback ?? null,
    expectedLoopDuration,
    duration,
    particleBones: particleBoneNames.length,
    particleSlots: particleSlotNames.length,
    hasEmptyTimeline: hasEmptyTimeline(),
    attachmentSeamMismatch: attachmentSeamMismatch()
  };
}

describe('SpineExporter stable templates', () => {
  it('keeps golden signatures (3.8)', () => {
    const templates = [
      '21_UI_按钮环绕流光.json',
      'NovaFlow项目_自定义路径.json',
      'NovaFlow项目_上升S走位.json',
      'NovaFlow项目_金币-放射.json',
      'NovaFlow项目_金币-点喷.json',
      'NovaFlow项目_金币-掉落.json'
    ] as const;

    const signatures = templates.map((t) => signatureFor(loadTemplate(t), '3.8'));

    for (const s of signatures) {
      expect(s.hasEmptyTimeline).toBe(false);
      if (s.loopAnimation) {
        expect(Number(s.duration)).toBeGreaterThanOrEqual(Number(s.expectedLoopDuration) - 0.001);
      }
    }

    expect(signatures).toMatchSnapshot();
  });
});
