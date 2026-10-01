import { describe, expect, it } from 'vitest';
import { exportToSpine } from './SpineExporter';
import { exportSpinePackage } from './SpinePackageExporter';
import { defaultConfig } from '../types';
import { buildBezierSamples, computeUniformPathU, evalBezierSamples } from '../utils/customPath';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAgAB/6X2XQAAAABJRU5ErkJggg==';
const sprite = { id: 'template-texture', name: 'old_template', dataUrl: png, path: '', weight: 1, mode: 'single' as const };
const triangle = {
  ...defaultConfig, mode: 'burst' as const, burstCount: 50,
  loopAnimation: false, lifetimeMin: 1, lifetimeMax: 1,
  speedMin: 0, speedMax: 0, gravityEnabled: false, dampingEnabled: false, noiseEnabled: false,
  systemX: 0, systemY: 0, systemRotationDeg: 0, systemScale: 1,
  attractorEnabled: false, pathEnabled: false, pathClosed: true,
  shape: { type: 'custom_path' as const, x: 0, y: 0 },
  pathPoints: [{ x: -120, y: -120 }, { x: 150, y: 0 }, { x: -120, y: 120 }],
  pathEmitSampleCount: 50, sprites: [sprite]
};

describe('edited custom emitter export', () => {
  it('places all particles on the edited triangle, rather than the template origin', () => {
    const json = JSON.parse(exportToSpine([triangle], '3.8', { disablePooling: true }));
    const { samples, total } = buildBezierSamples(triangle.pathPoints, true);
    for (let i = 0; i < 50; i++) {
      const first = json.animations.animation.bones[`sys_0_p_${i}`].translate[0];
      const expected = evalBezierSamples(samples, total, true, computeUniformPathU(i, 50, true));
      expect(first.x ?? 0).toBeCloseTo(expected.x, 2);
      expect(first.y ?? 0).toBeCloseTo(-expected.y, 2);
    }
  });

  it('exports open endpoints and respects facing and emission side', () => {
    const cfg = { ...triangle, burstCount: 2, pathClosed: false, pathEmitSampleCount: 2,
      pathPoints: [{ x: 30, y: 40 }, { x: 130, y: 40 }], speedMin: 60, speedMax: 60 };
    const positions = (extra: object) => {
      const json = JSON.parse(exportToSpine([{ ...cfg, ...extra }], '3.8', { disablePooling: true }));
      return json.animations.animation.bones.sys_0_p_0.translate;
    };
    const left = positions({ pathEmitSideMode: 'left', emissionAngleEnabled: false });
    const right = positions({ pathEmitSideMode: 'right', emissionAngleEnabled: false });
    const facing = positions({ pathEmitSideMode: 'left', pathEmitFacingEnabled: true, pathEmitFacingDeg: 90, emissionAngleEnabled: false });
    expect(left[0].x).toBe(30);
    expect(left[0].y).toBe(-40);
    expect(left[1].y).toBeLessThan(left[0].y);
    expect(right[1].y).toBeGreaterThan(right[0].y);
    expect(facing[1].x).toBeLessThan(facing[0].x);
  });
});

describe('user named Spine package', () => {
  for (const version of ['3.8', '4.0', '4.1', '4.2']) {
    it(`keeps PNG, atlas and attachment references together in ${version}`, async () => {
      const pkg = await exportSpinePackage([triangle], version, { exportName: '三角烟雾' });
      expect(pkg.images.map(image => image.fileName)).toEqual(['三角烟雾.png']);
      expect(pkg.atlas).toContain('三角烟雾.png\n');
      expect(pkg.atlas).toContain('\n三角烟雾\n');
      const json = JSON.parse(pkg.json);
      expect(json.slots.every((slot: any) => slot.attachment === '三角烟雾')).toBe(true);
      expect(sprite.name).toBe('old_template');
    });
    it(`keeps sequence paths resolvable in ${version}`, async () => {
      const cfg = { ...triangle, burstCount: 1, spritePlayback: 'sequence' as const,
        sprites: [{ ...sprite, mode: 'sequence' as const, frames: [{ dataUrl: png }, { dataUrl: png }] }] };
      const pkg = await exportSpinePackage([cfg as any], version, { exportName: '烟雾' });
      expect(pkg.images.map(image => image.fileName)).toEqual(['烟雾_0000.png', '烟雾_0001.png']);
      const json = JSON.parse(pkg.json);
      const skins = json.skins[0].attachments;
      for (const slot of Object.values<any>(skins)) {
        for (const [name, attachment] of Object.entries<any>(slot)) {
          const region = attachment.sequence ? `${attachment.path}0000` : attachment.path || name;
          expect(pkg.images.some(image => image.regionName === region && image.fileName === `${region}.png`)).toBe(true);
        }
      }
    });
  }
});
