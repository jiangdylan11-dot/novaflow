import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as SpineMiniPlayerModule from './SpineMiniPlayer';

import { analyzeSpineProjectMeshStats, buildSpineProject, composeSpineWorldBone, computeSpineUnweightedWorldPositions, computeSpineWeightedWorldPositions, detectLikelyPremultipliedAlphaFromImageData, interpolateSpineRotateAngle, makeSpineRegionCanvasCacheKey, parseAtlas, sampleSpineCurvePercent, sampleSpineScalarCurveValue, SpineMiniPlayer } from './SpineMiniPlayer';

function createStubCanvasContext() {
  const canvas = { width: 512, height: 512 } as HTMLCanvasElement;
  return {
    canvas,
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    rotate() {},
    drawImage() {},
    setTransform() {},
    transform() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    clip() {},
    fillText() {},
    fillRect() {},
    getImageData() {
      return { data: new Uint8ClampedArray(0) };
    },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    fillStyle: '',
    font: '',
  } as unknown as CanvasRenderingContext2D;
}

function expectOfficialNoRotationOrReflection(
  parent: { a: number; b: number; c: number; d: number; x: number; y: number },
  local: { x: number; y: number; rotation: number; scaleX: number; scaleY: number; shearX: number; shearY: number }
) {
  let pa = parent.a;
  let pb = parent.b;
  let pc = parent.c;
  let pd = parent.d;
  let s = pa * pa + pc * pc;
  let prx = 0;
  if (s > 0.0001) {
    s = Math.abs(pa * pd - pb * pc) / s;
    pb = pc * s;
    pd = pa * s;
    prx = (Math.atan2(pc, pa) * 180) / Math.PI;
  } else {
    pa = 0;
    pc = 0;
    prx = 90 - (Math.atan2(pd, pb) * 180) / Math.PI;
  }
  const rx = ((local.rotation + local.shearX - prx) * Math.PI) / 180;
  const ry = ((local.rotation + local.shearY - prx + 90) * Math.PI) / 180;
  const la = Math.cos(rx) * local.scaleX;
  const lb = Math.cos(ry) * local.scaleY;
  const lc = Math.sin(rx) * local.scaleX;
  const ld = Math.sin(ry) * local.scaleY;
  return {
    x: parent.a * local.x + parent.b * local.y + parent.x,
    y: parent.c * local.x + parent.d * local.y + parent.y,
    a: pa * la - pb * lc,
    b: pa * lb - pb * ld,
    c: pc * la + pd * lc,
    d: pc * lb + pd * ld,
  };
}

describe('SpineMiniPlayer mesh regressions', () => {
  it('composes child bone translation using the parent world matrix', () => {
    const parent = composeSpineWorldBone({
      x: 0,
      y: 0,
      rotation: 90,
      scaleX: 2,
      scaleY: 3,
      shearX: 0,
      shearY: 0,
      length: 0,
    });

    const child = composeSpineWorldBone({
      x: 10,
      y: 20,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
      length: 0,
      parent: 'root',
    }, parent);

    expect(child.x).toBeCloseTo(-60, 6);
    expect(child.y).toBeCloseTo(20, 6);
  });

  it('keeps weighted mesh vertices in Spine world coordinates before canvas conversion', () => {
    const positions = computeSpineWeightedWorldPositions(
      [1, 0, 2, 3, 1],
      1,
      ['root'],
      {
        root: {
          x: 5,
          y: 6,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          a: 1,
          b: 0,
          c: 0,
          d: 1,
        },
      },
      null,
      0,
      0,
      0,
      1,
      1,
    );

    expect(positions).toEqual([7, 9]);
  });

  it('applies weighted mesh deform values per bone influence instead of per final vertex', () => {
    const positions = computeSpineWeightedWorldPositions(
      [2, 0, 1, 2, 0.5, 1, 10, 20, 0.5],
      1,
      ['a', 'b'],
      {
        a: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, a: 1, b: 0, c: 0, d: 1 },
        b: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, a: 1, b: 0, c: 0, d: 1 },
      },
      [100, 200, 1000, 2000],
      0,
      0,
      0,
      1,
      1,
    );

    expect(positions[0]).toBeCloseTo(555.5, 6);
    expect(positions[1]).toBeCloseTo(1111, 6);
  });

  it('projects unweighted mesh vertices through attachment and bone world transforms', () => {
    const positions = computeSpineUnweightedWorldPositions(
      [1, 2, 3, 4],
      2,
      {
        x: 10,
        y: 20,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        a: 2,
        b: 0,
        c: 0,
        d: 3,
      },
      null,
      5,
      6,
      0,
      1,
      1,
    );

    expect(positions).toEqual([22, 44, 26, 50]);
  });

  it('does not inherit parent scale for noScale bones', () => {
    const parent = composeSpineWorldBone({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 2,
      scaleY: 3,
      shearX: 0,
      shearY: 0,
      length: 0,
    });

    const child = composeSpineWorldBone({
      x: 10,
      y: 20,
      rotation: 0,
      scaleX: 4,
      scaleY: 5,
      shearX: 0,
      shearY: 0,
      length: 0,
      parent: 'root',
      transformMode: 'noScale',
    }, parent);

    expect(child.x).toBeCloseTo(20, 6);
    expect(child.y).toBeCloseTo(60, 6);
    expect(child.scaleX).toBeCloseTo(4, 6);
    expect(child.scaleY).toBeCloseTo(5, 6);
  });

  it('matches Spine noRotationOrReflection bone inheritance', () => {
    const parent = composeSpineWorldBone({
      x: 12,
      y: 18,
      rotation: 37,
      scaleX: 1.8,
      scaleY: 0.7,
      shearX: 0,
      shearY: 0,
      length: 0,
    });

    const child = composeSpineWorldBone({
      x: 9,
      y: -6,
      rotation: 25,
      scaleX: 1.2,
      scaleY: 0.8,
      shearX: 10,
      shearY: -5,
      length: 0,
      parent: 'root',
      transformMode: 'noRotationOrReflection',
    }, parent);

    const expected = expectOfficialNoRotationOrReflection(
      { a: parent.a, b: parent.c, c: parent.b, d: parent.d, x: parent.x, y: parent.y },
      { x: 9, y: -6, rotation: 25, scaleX: 1.2, scaleY: 0.8, shearX: 10, shearY: -5 }
    );

    expect(child.x).toBeCloseTo(expected.x, 6);
    expect(child.y).toBeCloseTo(expected.y, 6);
    expect(child.a).toBeCloseTo(expected.a, 6);
    expect(child.c).toBeCloseTo(expected.b, 6);
    expect(child.b).toBeCloseTo(expected.c, 6);
    expect(child.d).toBeCloseTo(expected.d, 6);
  });

  it('normalizes string-encoded mesh arrays during Spine project import', () => {
    const jsonText = JSON.stringify({
      skeleton: {},
      bones: [{ name: 'root' }],
      slots: [{ name: 'slot', bone: 'root', attachment: 'mesh' }],
      skins: [
        {
          name: 'default',
          attachments: {
            slot: {
              mesh: {
                type: 'mesh',
                uvs: '0 0 1 0 1 1 0 1',
                triangles: '0 1 2 0 2 3',
                vertices: '1 0 0 0 1 1 0 0 1 0 0 1 1',
                edges: '0 1 2 3',
                width: 64,
                height: 64,
              },
            },
          },
        },
      ],
      animations: {},
    });
    const atlasText = [
      'atlas.png',
      'size: 64,64',
      'format: RGBA8888',
      'filter: Linear,Linear',
      'repeat: none',
      'mesh',
      '  rotate: false',
      '  xy: 0, 0',
      '  size: 64, 64',
      '  orig: 64, 64',
      '  offset: 0, 0',
      '  index: -1',
      '',
    ].join('\n');
    const project = buildSpineProject(jsonText, atlasText, [{ fileName: 'atlas.png', dataUrl: 'data:image/png;base64,AA==' }]);
    const attachment = ((project.skins as any[])[0]?.attachments?.slot?.mesh) as {
      uvs?: unknown;
      triangles?: unknown;
      vertices?: unknown;
      edges?: unknown;
    };

    expect(Array.isArray(attachment.uvs)).toBe(true);
    expect(Array.isArray(attachment.triangles)).toBe(true);
    expect(Array.isArray(attachment.vertices)).toBe(true);
    expect(Array.isArray(attachment.edges)).toBe(true);
    expect(attachment.uvs).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(attachment.triangles).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('maps multi-atlas page names to distinct imported images', () => {
    const jsonText = JSON.stringify({
      skeleton: {},
      bones: [{ name: 'root' }],
      slots: [
        { name: 'bg', bone: 'root', attachment: 'bg/beijing' },
        { name: 'weapon', bone: 'root', attachment: 'no/wuqi01' },
      ],
      skins: {
        default: {
          bg: {
            'bg/beijing': {
              type: 'mesh',
              uvs: [0, 0, 1, 0, 1, 1, 0, 1],
              triangles: [0, 1, 2, 0, 2, 3],
              vertices: [0, 0, 32, 0, 32, 32, 0, 32],
            },
          },
          weapon: {
            'no/wuqi01': {
              type: 'mesh',
              uvs: [0, 0, 1, 0, 1, 1, 0, 1],
              triangles: [0, 1, 2, 0, 2, 3],
              vertices: [0, 0, 16, 0, 16, 16, 0, 16],
            },
          },
        },
      },
      animations: {},
    });
    const atlasText = [
      'pageA.png',
      'size: 64,64',
      'format: RGBA8888',
      'filter: Linear,Linear',
      'repeat: none',
      'bg/beijing',
      '  rotate: false',
      '  xy: 0, 0',
      '  size: 32, 32',
      '  orig: 32, 32',
      '  offset: 0, 0',
      '  index: -1',
      '',
      'pageB.png',
      'size: 64,64',
      'format: RGBA8888',
      'filter: Linear,Linear',
      'repeat: none',
      'no/wuqi01',
      '  rotate: false',
      '  xy: 0, 0',
      '  size: 16, 16',
      '  orig: 16, 16',
      '  offset: 0, 0',
      '  index: -1',
      '',
    ].join('\n');

    const project = buildSpineProject(jsonText, atlasText, [
      { fileName: 'pageA.png', dataUrl: 'data:image/png;base64,AAAA' },
      { fileName: 'pageB.png', dataUrl: 'data:image/png;base64,BBBB' },
    ]);

    expect(project.images['pageA.png']).toBe('data:image/png;base64,AAAA');
    expect(project.images['pageB.png']).toBe('data:image/png;base64,BBBB');
    expect(project.atlas.regionToPage['bg/beijing']).toBe('pageA.png');
    expect(project.atlas.regionToPage['no/wuqi01']).toBe('pageB.png');
  });

  it('uses distinct region cache keys for different attachments on the same atlas page', () => {
    const a = makeSpineRegionCanvasCacheKey('data:image/png;base64,page', 'rgb(255,255,255)', 'pageA.png', 'm1-tou');
    const b = makeSpineRegionCanvasCacheKey('data:image/png;base64,page', 'rgb(255,255,255)', 'pageA.png', 'm1-shenti');
    const c = makeSpineRegionCanvasCacheKey('data:image/png;base64,page', 'rgb(255,255,255)', 'pageB.png', 'm1-tou');

    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('parses atlas pma metadata per page', () => {
    const atlas = parseAtlas([
      'pageA.png',
      'size: 64,64',
      'format: RGBA8888',
      'filter: Linear,Linear',
      'pma: true',
      'repeat: none',
      'a',
      '  rotate: false',
      '  xy: 0, 0',
      '  size: 32, 32',
      '',
      'pageB.png',
      'size: 64,64',
      'format: RGBA8888',
      'filter: Linear,Linear',
      'pma: false',
      'repeat: none',
      'b',
      '  rotate: false',
      '  xy: 0, 0',
      '  size: 16, 16',
      '',
    ].join('\n'));

    expect(atlas.pages['pageA.png']?.pma).toBe(true);
    expect(atlas.pages['pageB.png']?.pma).toBe(false);
  });

  it('detects likely premultiplied alpha from edge pixels', () => {
    const width = 8;
    const height = 8;
    const premultiplied = new Uint8ClampedArray(width * height * 4);
    const straight = new Uint8ClampedArray(width * height * 4);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const isEdge = x === 1;
        premultiplied[idx] = isEdge ? 60 : 240;
        premultiplied[idx + 1] = isEdge ? 40 : 160;
        premultiplied[idx + 2] = isEdge ? 20 : 80;
        premultiplied[idx + 3] = isEdge ? 64 : 255;

        straight[idx] = 240;
        straight[idx + 1] = 160;
        straight[idx + 2] = 80;
        straight[idx + 3] = isEdge ? 64 : 255;
      }
    }

    expect(detectLikelyPremultipliedAlphaFromImageData(premultiplied, width, height)).toBe(true);
    expect(detectLikelyPremultipliedAlphaFromImageData(straight, width, height)).toBe(false);
  });

  it('parses Spine 4 atlas bounds and offsets metadata', () => {
    const atlas = parseAtlas([
      'wheelspin.png',
      'size: 2014,984',
      'filter: Linear,Linear',
      'scale: 0.3',
      'head01',
      'bounds: 1572,457,117,73',
      'rotate: 90',
      'dragon_0',
      'bounds: 672,19,196,118',
      'offsets: 286,198,483,983',
      'rotate: 90',
      '',
    ].join('\n'));

    expect(atlas.pages['wheelspin.png']).toBeTruthy();
    expect(atlas.pages['wheelspin.png']?.regions.head01).toMatchObject({
      x: 1572,
      y: 457,
      w: 117,
      h: 73,
      rotate: true,
    });
    expect(atlas.pages['wheelspin.png']?.regions.dragon_0).toMatchObject({
      x: 672,
      y: 19,
      w: 196,
      h: 118,
      rotate: true,
      offX: 286,
      offY: 198,
      origW: 483,
      origH: 983,
    });
  });

  it('counts mesh attachment and triangle complexity for adaptive playback', () => {
    const stats = analyzeSpineProjectMeshStats({
      skins: {
        default: {
          slotA: {
            meshA: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3], vertices: [0, 0, 1, 0, 1, 1, 0, 1] },
          },
          slotB: {
            meshB: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], vertices: [1, 0, 0, 0, 1] },
          },
        },
      },
    } as any);

    expect(stats.attachmentCount).toBe(2);
    expect(stats.triangleCount).toBe(3);
    expect(stats.weightedCount).toBe(1);
  });

  it('supports shorthand Spine bezier curve fields during timeline interpolation', () => {
    expect(sampleSpineCurvePercent(0.5, { curve: 'stepped' })).toBe(0);
    expect(sampleSpineCurvePercent(0.5, { curve: 0.25, c3: 0.75 })).toBeCloseTo(0.5, 3);
    expect(sampleSpineCurvePercent(0.25, { curve: 0.382, c2: 0.57, c3: 0.735 })).toBeGreaterThan(0.25);
  });

  it('uses Spine half-turn tie-breaking for alternating 0 and 180 rotate keys', () => {
    expect(interpolateSpineRotateAngle(0, 180, 0.5)).toBeCloseTo(-90, 6);
    expect(interpolateSpineRotateAngle(180, 0, 0.5)).toBeCloseTo(90, 6);
  });

  it('applies negative transform translate mixes instead of dropping them', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [
          { name: 'root' },
          { name: 'target', parent: 'root', x: 100, y: 0 },
          { name: 'bone', parent: 'root', x: 0, y: 0 },
        ],
        slots: [],
        skins: {},
        transform: [
          {
            name: 'neg',
            order: 0,
            bones: ['bone'],
            target: 'target',
            rotateMix: 0,
            translateMix: -1,
            scaleMix: 0,
            shearMix: 0,
          },
        ],
        animations: { idle: {} },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0);
    const world = (player as any).lastComputedWorld;

    expect(world.bone.x).toBeCloseTo(-100, 6);
    expect(world.bone.y).toBeCloseTo(0, 6);
  });

  it('interpolates transform constraint mixes between keyframes', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [
          { name: 'root' },
          { name: 'target', parent: 'root', x: 100, y: 0 },
          { name: 'bone', parent: 'root', x: 0, y: 0 },
        ],
        slots: [],
        skins: {},
        transform: [
          {
            name: 'mixTrack',
            order: 0,
            bones: ['bone'],
            target: 'target',
            rotateMix: 0,
            translateMix: 0,
            scaleMix: 0,
            shearMix: 0,
          },
        ],
        animations: {
          idle: {
            transform: {
              mixTrack: [
                { time: 0, translateMix: 0 },
                { time: 1, translateMix: 1 },
              ],
            },
          },
        },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0.5);
    const world = (player as any).lastComputedWorld;

    expect(world.bone.x).toBeCloseTo(50, 6);
    expect(world.bone.y).toBeCloseTo(0, 6);
  });

  it('derives animation duration from constraint and deform timelines', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [{ name: 'root' }],
        slots: [],
        skins: {},
        animations: {
          idle: {
            bones: {
              root: {
                shear: [{ time: 1.5, x: 0, y: 0 }],
              },
            },
            ik: {
              ik1: [{ time: 2, mix: 1 }],
            },
            transform: {
              tr1: [{ time: 2.5, translateMix: 1 }],
            },
            path: {
              path1: {
                position: [{ time: 3, position: 1 }],
              },
            },
            deform: {
              default: {
                slot: {
                  attachment: [{ time: 4, offset: 0, vertices: [1, 2] }],
                },
              },
            },
          },
        },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    expect(player.getDurationSec()).toBeCloseTo(4, 6);
  });

  it('evaluates Spine 4 rgba slot timelines as full RGBA colors', () => {
    expect(
      SpineMiniPlayerModule.evalSlotTimelineHex(
        {
          rgba: [
            { time: 0, color: 'ffffff00' },
            { time: 1, color: 'ffffffff' },
          ],
        },
        0.5,
        'ffffffff'
      )
    ).toBe('ffffff80');
  });

  it('derives animation duration from Spine 4 slot rgba timelines', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [{ name: 'root' }],
        slots: [{ name: 'fx', bone: 'root' }],
        skins: {},
        animations: {
          idle: {
            slots: {
              fx: {
                rgba: [
                  { color: 'ffffff00' },
                  { time: 2.25, color: 'ffffffff' },
                ],
              },
            },
          },
        },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    expect(player.getDurationSec()).toBeCloseTo(2.25, 6);
  });

  it('moves path-constrained bones along the current path attachment', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [
          { name: 'root' },
          { name: 'bone', parent: 'root', x: 0, y: 0 },
        ],
        slots: [{ name: 'pathSlot', bone: 'root', attachment: 'path' }],
        skins: {
          default: {
            pathSlot: {
              path: {
                type: 'path',
                vertexCount: 2,
                vertices: [0, 0, 100, 0],
              },
            },
          },
        },
        path: [
          {
            name: 'pc',
            order: 0,
            bones: ['bone'],
            target: 'pathSlot',
            position: 1,
            translateMix: 1,
          },
        ],
        animations: { idle: {} },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0);
    const world = (player as any).lastComputedWorld;

    expect(world.bone.x).toBeCloseTo(100, 6);
    expect(world.bone.y).toBeCloseTo(0, 6);
  });

  it('samples bezier path constraints from the curve instead of the control polygon', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [
          { name: 'root' },
          { name: 'bone', parent: 'root', x: 0, y: 0 },
        ],
        slots: [{ name: 'pathSlot', bone: 'root', attachment: 'path' }],
        skins: {
          default: {
            pathSlot: {
              path: {
                type: 'path',
                closed: false,
                vertexCount: 2,
                vertices: [
                  0, 0,
                  0, 0,
                  0, 100,
                  100, 100,
                  100, 0,
                  100, 0,
                ],
              },
            },
          },
        },
        path: [
          {
            name: 'pc',
            order: 0,
            bones: ['bone'],
            target: 'pathSlot',
            position: 0.5,
            translateMix: 1,
          },
        ],
        animations: { idle: {} },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0);
    const world = (player as any).lastComputedWorld;

    expect(world.bone.x).toBeCloseTo(50, 1);
    expect(world.bone.y).toBeGreaterThan(60);
  });

  it('distributes chained path-constrained bones along the path using bone length when spacing is omitted', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [
          { name: 'root' },
          { name: 'boneA', parent: 'root', x: 0, y: 0, length: 30 },
          { name: 'boneB', parent: 'root', x: 0, y: 0, length: 30 },
        ],
        slots: [{ name: 'pathSlot', bone: 'root', attachment: 'path' }],
        skins: {
          default: {
            pathSlot: {
              path: {
                type: 'path',
                vertexCount: 2,
                vertices: [0, 0, 100, 0],
              },
            },
          },
        },
        path: [
          {
            name: 'pc',
            order: 0,
            bones: ['boneA', 'boneB'],
            target: 'pathSlot',
            position: 0,
            translateMix: 1,
          },
        ],
        animations: { idle: {} },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0);
    const world = (player as any).lastComputedWorld;

    expect(world.boneA.x).toBeCloseTo(0, 6);
    expect(world.boneB.x).toBeCloseTo(30, 6);
  });

  it('recomputes parented path chains between constrained bones before placing descendants', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [
          { name: 'root' },
          { name: 'boneA', parent: 'root', x: 0, y: 0, length: 30 },
          { name: 'boneB', parent: 'boneA', x: 30, y: 0, length: 30 },
        ],
        slots: [{ name: 'pathSlot', bone: 'root', attachment: 'path' }],
        skins: {
          default: {
            pathSlot: {
              path: {
                type: 'path',
                closed: false,
                vertexCount: 2,
                vertices: [100, 0, 200, 0],
              },
            },
          },
        },
        path: [
          {
            name: 'pc',
            order: 0,
            bones: ['boneA', 'boneB'],
            target: 'pathSlot',
            position: 0,
            translateMix: 1,
            mixRotate: 0,
          },
        ],
        animations: { idle: {} },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0);
    const world = (player as any).lastComputedWorld;

    expect(world.boneA.x).toBeCloseTo(100, 6);
    expect(world.boneB.x).toBeCloseTo(130, 6);
  });

  it('interpolates omitted translate components back to the setup fallback instead of holding the previous key', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [{ name: 'root' }, { name: 'bone', parent: 'root' }],
        slots: [],
        skins: {},
        animations: {
          idle: {
            bones: {
              bone: {
                translate: [
                  { time: 0, x: 10, y: 20 },
                  { time: 1 },
                ],
              },
            },
          },
        },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0.5);
    const world = (player as any).lastComputedWorld;

    expect(world.bone.x).toBeCloseTo(5, 6);
    expect(world.bone.y).toBeCloseTo(10, 6);
  });

  it('interpolates omitted rotate keys back to the setup fallback instead of holding the previous angle', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [{ name: 'root' }, { name: 'bone', parent: 'root' }],
        slots: [],
        skins: {},
        animations: {
          idle: {
            bones: {
              bone: {
                rotate: [
                  { time: 0, angle: 30 },
                  { time: 1 },
                ],
              },
            },
          },
        },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0.5);
    const world = (player as any).lastComputedWorld;

    expect(world.bone.rotation).toBeCloseTo(15, 6);
  });

  it('interpolates omitted transform constraint offsets back to setup values', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [
          { name: 'root' },
          { name: 'target', parent: 'root', x: 100, y: 0 },
          { name: 'bone', parent: 'root', x: 0, y: 0 },
        ],
        slots: [],
        skins: {},
        transform: [
          {
            name: 'track',
            order: 0,
            bones: ['bone'],
            target: 'target',
            rotateMix: 0,
            translateMix: 1,
            scaleMix: 0,
            shearMix: 0,
          },
        ],
        animations: {
          idle: {
            transform: {
              track: [
                { time: 0, x: 20 },
                { time: 1 },
              ],
            },
          },
        },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0.5);
    const world = (player as any).lastComputedWorld;

    expect(world.bone.x).toBeCloseTo(110, 6);
  });

  it('does not fall back to the first skin attachment before the first attachment keyframe', () => {
    const slot = { name: 'fx', bone: 'root' } as any;
    const project = {
      skeleton: {},
      bones: [{ name: 'root' }],
      slots: [slot],
      skins: [{ name: 'default', attachments: { fx: { glow: { width: 32, height: 32 } } } }],
      animations: {
        anim: {
          slots: {
            fx: {
              attachment: [
                { time: 0.5, name: 'glow' },
                { time: 1, name: null },
              ],
            },
          },
        },
      },
      atlas: { pages: {}, regionToPage: {} },
      images: {},
    } as any;

    const player = new SpineMiniPlayer(createStubCanvasContext(), project, 'anim');

    expect((player as any).resolveSlotAttachmentName(slot, project.animations.anim, 0.25)).toBeNull();
    expect((player as any).resolveSlotAttachmentName(slot, project.animations.anim, 0.75)).toBe('glow');
    expect((player as any).resolveSlotAttachmentName(slot, project.animations.anim, 1.25)).toBeNull();
  });

  it('keeps tolerant fallback only when a slot has no setup attachment and no attachment timeline', () => {
    const slot = { name: 'fx', bone: 'root' } as any;
    const project = {
      skeleton: {},
      bones: [{ name: 'root' }],
      slots: [slot],
      skins: [{ name: 'default', attachments: { fx: { glow: { width: 32, height: 32 } } } }],
      animations: { anim: { slots: {} } },
      atlas: { pages: {}, regionToPage: {} },
      images: {},
    } as any;

    const player = new SpineMiniPlayer(createStubCanvasContext(), project, 'anim');

    expect((player as any).resolveSlotAttachmentName(slot, project.animations.anim, 0)).toBe('glow');
  });

  it('does not fallback in one animation when the slot has attachment timelines in other animations', () => {
    const slot = { name: 'fx', bone: 'root' } as any;
    const project = {
      skeleton: {},
      bones: [{ name: 'root' }],
      slots: [slot],
      skins: [{ name: 'default', attachments: { fx: { glow: { width: 32, height: 32 } } } }],
      animations: {
        idle: { slots: {} },
        burst: {
          slots: {
            fx: {
              attachment: [
                { time: 0, name: 'glow' },
                { time: 1, name: null },
              ],
            },
          },
        },
      },
      atlas: { pages: {}, regionToPage: {} },
      images: {},
    } as any;

    const player = new SpineMiniPlayer(createStubCanvasContext(), project, 'idle');

    expect((player as any).resolveSlotAttachmentName(slot, project.animations.idle, 0)).toBeNull();
  });

  it('does not fallback to a static first frame for multi-attachment slots without setup attachment', () => {
    const slot = { name: 'fx', bone: 'root' } as any;
    const project = {
      skeleton: {},
      bones: [{ name: 'root' }],
      slots: [slot],
      skins: [{ name: 'default', attachments: { fx: { glow_00: { width: 32, height: 32 }, glow_02: { width: 32, height: 32 } } } }],
      animations: { anim: { slots: {} } },
      atlas: { pages: {}, regionToPage: {} },
      images: {},
    } as any;

    const player = new SpineMiniPlayer(createStubCanvasContext(), project, 'anim');

    expect((player as any).resolveSlotAttachmentName(slot, project.animations.anim, 0)).toBeNull();
  });

  it('honors Spine 4 path mixX instead of defaulting translate mix to 1', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [
          { name: 'root' },
          { name: 'driver', parent: 'root', x: 0, y: 0 },
          { name: 'chain', parent: 'root', x: 0, y: 0 },
        ],
        slots: [
          { name: 'driver', bone: 'driver', attachment: 'driverPath' },
        ],
        skins: {
          default: {
            driver: {
              driverPath: {
                type: 'path',
                closed: false,
                vertexCount: 2,
                vertices: [100, 0, 100, 0, 200, 0, 200, 0],
              },
            },
          },
        },
        path: [
          {
            name: 'driver',
            bones: ['chain'],
            target: 'driver',
            mixX: 0.2,
          },
        ],
        animations: {
          idle: {},
        },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0);
    const world = (player as any).lastComputedWorld;
    expect(world.chain.x).toBeCloseTo(20, 6);
  });

  it('reads Spine path timeline scalar frames from value fields', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [
          { name: 'root' },
          { name: 'driver', parent: 'root', x: 0, y: 0 },
          { name: 'chain', parent: 'root', x: 0, y: 0 },
        ],
        slots: [
          { name: 'driver', bone: 'driver', attachment: 'driverPath' },
        ],
        skins: {
          default: {
            driver: {
              driverPath: {
                type: 'path',
                closed: false,
                vertexCount: 2,
                vertices: [100, 0, 100, 0, 200, 0, 200, 0],
              },
            },
          },
        },
        path: [
          {
            name: 'driver',
            bones: ['chain'],
            target: 'driver',
            mixX: 1,
          },
        ],
        animations: {
          idle: {
            path: {
              driver: {
                position: [
                  { value: 0 },
                  { time: 1, value: 0.5 },
                ],
              },
            },
          },
        },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0.5);
    const world = (player as any).lastComputedWorld;
    expect(world.chain.x).toBeCloseTo(125, 6);
  });

  it('reads Spine rotate timelines from value fields', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [{ name: 'root' }, { name: 'bone', parent: 'root', rotation: 10 }],
        slots: [],
        skins: { default: {} },
        animations: {
          idle: {
            bones: {
              bone: {
                rotate: [
                  { value: 0 },
                  { time: 1, value: 90 },
                ],
              },
            },
          },
        },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0.5);
    const world = (player as any).lastComputedWorld;
    expect(world.bone.rotation).toBeCloseTo(55, 6);
  });

  it('reads Spine 4 absolute scalar bezier curves for rotate timelines', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [{ name: 'root' }, { name: 'bone', parent: 'root', rotation: 0 }],
        slots: [],
        skins: { default: {} },
        animations: {
          idle: {
            bones: {
              bone: {
                rotate: [
                  { value: 0, curve: [0.25, 2.5, 0.75, 7.5] },
                  { time: 1, value: 10 },
                ],
              },
            },
          },
        },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0.5);
    const world = (player as any).lastComputedWorld;
    expect(world.bone.rotation).toBeCloseTo(5, 6);
  });

  it('treats small Spine 4 scalar bezier curves as absolute time/value curves', () => {
    const frame = { curve: [0.25, 0, 0.75, 0.03] };
    const absolute = sampleSpineScalarCurveValue(0.5, frame, 0, 1, 0, 0.03, true);
    const normalized = sampleSpineScalarCurveValue(0.5, frame, 0, 1, 0, 0.03, false);
    expect(absolute).toBeCloseTo(0.015, 6);
    expect(normalized).toBeLessThan(0.005);
  });

  it('recomputes descendant world bones after path constraints move an ancestor chain', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: { spine: '4.0.64' },
        bones: [
          { name: 'root' },
          { name: 'driver', parent: 'root', x: 0, y: 0 },
          { name: 'child', parent: 'driver', x: 50, y: 0 },
        ],
        slots: [
          { name: 'driver', bone: 'root', attachment: 'driverPath' },
        ],
        skins: {
          default: {
            driver: {
              driverPath: {
                type: 'path',
                closed: false,
                constantSpeed: true,
                vertexCount: 2,
                vertices: [100, 0, 100, 0, 200, 0, 200, 0],
              },
            },
          },
        },
        path: [
          {
            name: 'driver',
            bones: ['driver'],
            target: 'driver',
            mixX: 1,
          },
        ],
        animations: {
          idle: {
            path: {
              driver: {
                position: [
                  { value: 0 },
                  { time: 1, value: 0.5 },
                ],
              },
            },
          },
        },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0.5);
    const world = (player as any).lastComputedWorld;
    expect(world.driver.x).toBeCloseTo(125, 6);
    expect(world.child.x).toBeCloseTo(175, 6);
  });

  it('keeps wheelspin dragon head IK targets stable when translate curves use component bezier data', () => {
    const rootDir = path.resolve(process.cwd(), 'debug-assets', 'wheelspin-local');
    const jsonText = fs.readFileSync(path.join(rootDir, 'wheelspin.json'), 'utf8');
    const atlasText = fs.readFileSync(path.join(rootDir, 'wheelspin.atlas'), 'utf8');
    const project = buildSpineProject(jsonText, atlasText, []);
    const player = new SpineMiniPlayer(createStubCanvasContext(), project, 'idle');
    player.renderAt(0.63);
    const world = (player as any).lastComputedWorld;
    const ikDiagnostics = (project.ik || [])
      .filter((constraint: any) => ['bone18', 'bone19', 'bone20', 'bone21', 'bone22', 'bone71', 'bone72', 'bone73', 'bone75', 'bone76', 'bone77'].includes(constraint.bones?.[0]))
      .map((constraint: any) => {
        const boneName = constraint.bones?.[0];
        const bone = world?.[boneName];
        const target = world?.[constraint.target];
        const localBone = project.bones.find((item: any) => item.name === boneName);
        const tipX = bone ? bone.x + bone.a * (localBone?.length || 0) : null;
        const tipY = bone ? bone.y + bone.b * (localBone?.length || 0) : null;
        const error = bone && target && tipX != null && tipY != null
          ? Math.hypot((target.x ?? 0) - tipX, (target.y ?? 0) - tipY)
          : null;
        return {
          name: constraint.name,
          bone: boneName,
          target: constraint.target,
          tipX,
          tipY,
          targetX: target?.x,
          targetY: target?.y,
          error,
        };
      });
    const dragonNames = ['dragon_0', 'dragon_2', 'dragon_3', 'dragon_4', 'dragon_6', 'dragon_7', 'dragon_8'];
    const dragonBounds = dragonNames.map((name) => {
      const resolved = (player as any).resolveAttachment(name, name);
      const att = resolved?.attachment;
      const verts = att?.vertices || [];
      const uvs = att?.uvs || [];
      const triangles = att?.triangles || [];
      const vertCount = Math.floor(uvs.length / 2);
      const meshPositions = (player as any).computeWeightedWorldPositions(
        verts,
        vertCount,
        project.bones.map((bone: any) => bone.name),
        world,
        null,
        0,
        0,
        0,
        1,
        1
      );
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < meshPositions.length; i += 2) {
        minX = Math.min(minX, meshPositions[i]);
        maxX = Math.max(maxX, meshPositions[i]);
        minY = Math.min(minY, meshPositions[i + 1]);
        maxY = Math.max(maxY, meshPositions[i + 1]);
      }
      let maxEdge = 0;
      for (let i = 0; i + 2 < triangles.length; i += 3) {
        const ia = triangles[i] * 2;
        const ib = triangles[i + 1] * 2;
        const ic = triangles[i + 2] * 2;
        const ax = meshPositions[ia] ?? 0;
        const ay = meshPositions[ia + 1] ?? 0;
        const bx = meshPositions[ib] ?? 0;
        const by = meshPositions[ib + 1] ?? 0;
        const cx = meshPositions[ic] ?? 0;
        const cy = meshPositions[ic + 1] ?? 0;
        maxEdge = Math.max(
          maxEdge,
          Math.hypot(ax - bx, ay - by),
          Math.hypot(bx - cx, by - cy),
          Math.hypot(cx - ax, cy - ay)
        );
      }
      return { name, minX, maxX, minY, maxY, maxEdge };
    });
    const maxIkError = Math.max(...ikDiagnostics.map((item) => item.error ?? 0));
    expect(world?.target55?.y ?? 0).toBeLessThan(380);
    expect(world?.target6?.y ?? 0).toBeLessThan(390);
    expect(world?.target7?.y ?? 0).toBeLessThan(400);
    expect(world?.bone73?.y ?? 0).toBeLessThan(390);
    expect(maxIkError).toBeLessThan(20);
    expect(Math.max(...dragonBounds.map((item) => item.maxEdge))).toBeLessThan(120);
  });

  it('falls back to mixX for path Y translation when mixY is omitted', () => {
    const player = new SpineMiniPlayer(
      createStubCanvasContext(),
      {
        skeleton: {},
        bones: [
          { name: 'root' },
          { name: 'driver', parent: 'root', x: 0, y: 0 },
          { name: 'chain', parent: 'root', x: 0, y: 0, length: 100 },
        ],
        slots: [
          { name: 'pathSlot', bone: 'driver', attachment: 'pathSlot' },
        ],
        skins: {
          default: {
            pathSlot: {
              pathSlot: {
                type: 'path',
                closed: false,
                constantSpeed: true,
                vertexCount: 2,
                vertices: [
                  100, 50,
                  100, 50,
                  200, 50,
                  200, 50,
                ],
              },
            },
          },
        },
        path: [
          {
            name: 'pathSlot',
            bones: ['chain'],
            target: 'pathSlot',
            mixRotate: 0,
            mixX: 0.5,
          },
        ],
        animations: { idle: {} },
        atlas: { pages: {}, regionToPage: {} },
        images: {},
      } as any,
      'idle'
    );

    player.renderAt(0);
    const world = (player as any).lastComputedWorld;
    expect(world.chain.x).toBeCloseTo(50, 6);
    expect(world.chain.y).toBeCloseTo(25, 6);
  });
});
