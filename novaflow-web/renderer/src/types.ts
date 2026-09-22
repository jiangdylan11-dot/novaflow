export interface Key1D {
  t: number; // 0..1
  v: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface PathPoint {
  x: number;
  y: number;
  in?: Vec2;
  out?: Vec2;
}

export type EmitMode = 'burst' | 'stream';
export type ShapeType = 'point' | 'circle' | 'rect' | 'cone' | 'custom_path';
export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen' | 'overlay';

export type PathEmitSideMode = 'left' | 'right' | 'both';

export type ColorStop = {
  t: number;
  color: string;
};
export type SpritePlayback = 'single' | 'random' | 'sequence';
export type NoiseMode = 'random' | 's_curve';
export type StrengthMode = 'linear' | 'curve';

export interface EmitterShape {
  type: ShapeType;
  x: number;
  y: number;
  emitInward?: boolean;
  rectEdgeOnly?: boolean;
  rectRandomDirection?: boolean;
  innerRadius?: number;
  outerRadius?: number;
  width?: number;
  height?: number;
  coneRadius?: number;
  coneAngleDeg?: number;
  // 以下为兼容旧 Engine 代码保留的字段
  circleEdgeOnly?: boolean;
  circleEdgeThickness?: number;
  coneOffsetDeg?: number;
}

export interface ParticleSprite {
  id: string;
  name: string;
  dataUrl: string;
  path: string;
  weight: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  scaleSeparate?: boolean;
  opacity?: number;
  mode: 'single' | 'sequence';
  frames?: { name: string; dataUrl: string }[];
  colorStops?: ColorStop[];
  colorMode: 'fixed' | 'lifecycle';
  blendMode: BlendMode;
  color: string;
}

export interface ParticleSystemConfig {
  id: string;
  systemName: string;
  enabled?: boolean;
  systemX: number;
  systemY: number;
  systemRotationDeg: number;
  systemScale?: number;
  systemScaleX?: number;
  systemScaleY?: number;
  systemScaleSeparate?: boolean;

  mode: EmitMode;
  burstCount: number;
  loopIntervalSec: number;
  rate: number;
  streamDurationSec: number;
  loopAnimation: boolean;
  loopDurationSec?: number;
  streamLoopEnabled: boolean;

  lifetimeMin: number;
  lifetimeMax: number;
  speedMin: number;
  speedMax: number;

  gravityEnabled: boolean;
  gravityX: number;
  gravityY: number;
  dampingEnabled: boolean;
  noiseEnabled: boolean;
  noiseMode?: NoiseMode;
  sNoiseStrengthMode?: StrengthMode;
  sNoiseCurve?: Key1D[];

  sizeStart: number;
  sizeEnd: number;
  sizeStartX?: number;
  sizeStartY?: number;
  sizeEndX?: number;
  sizeEndY?: number;
  sizeSeparate?: boolean;
  useSizeCurve: boolean;
  sizeCurve: Key1D[];

  opacityStart: number;
  opacityEnd: number;
  useOpacityCurve: boolean;
  opacityCurve: Key1D[];

  particleSpinDegPerSec: number;
  rotationMode: 'fixed' | 'random' | 'direction';
  lockSpriteRotation?: boolean;

  pathEnabled?: boolean;
  pathMode?: 'lock' | 'emitter';
  pathType?: 'circle' | 'ellipse' | 'custom';
  pathClosed?: boolean;
  pathPoints?: PathPoint[];
  pathStartT?: number;
  pathSpeedPxPerSec?: number;
  pathRadiusX?: number;
  pathRadiusY?: number;
  pathRadiusOffset?: number;
  pathThickness?: number;
  pathSpeedDegPerSec?: number;
  pathReverse?: boolean;
  pathRandomStartAngle?: boolean;
  pathStartAngleDeg?: number;

  pathEmitSampleCount?: number;
  pathEmitSideMode?: PathEmitSideMode;
  pathEmitBothSideRatioLeft?: number;
  pathEmitFacingEnabled?: boolean;
  pathEmitFacingDeg?: number;

  shape: EmitterShape;
  sprites: ParticleSprite[];
  spritePlayback: SpritePlayback;
  spriteSequenceFps: number;
  spriteSequenceLoop: boolean;
  spriteSequenceRandom: boolean;

  // --- 兼容旧代码字段 ---
  warmupEnabled?: boolean;
  warmupSeconds?: number;
  scheduleEnabled?: boolean;
  streamStartSec?: number;
  loopEnabled?: boolean;
  burstScheduleEnabled?: boolean;
  burstScheduleCount?: number;
  burstScheduleStartSec?: number;
  burstScheduleIntervalSec?: number;
  attractorEnabled?: boolean;
  attractorMode?: 'linear' | 'spiral';
  attractorStrength?: number;
  attractorRadius?: number;
  radialInward?: boolean;
  spiralInward?: boolean;
  spiralStartRadius?: number;
  spiralEndRadius?: number;
  swirlStrength?: number;
  noiseFrequency?: number;
  noiseIntensity?: number;
  minTravelY?: number;
  targetSpeedRatio?: number;
  blendMode?: BlendMode;
  colorStart?: string;
  colorEnd?: string;
  spriteEnabled?: boolean;
  emissionAngleEnabled?: boolean;
  emissionAngleDeg?: number;
  emissionOffsetDeg?: number;
}

export const defaultConfig: ParticleSystemConfig = {
  id: '1',
  systemName: 'Particle System 1',
  enabled: true,
  systemX: 0,
  systemY: 0,
  systemRotationDeg: 0,
  systemScale: 1,
  systemScaleSeparate: false,
  mode: 'burst',
  burstCount: 20,
  loopIntervalSec: 1.0,
  rate: 100,
  streamDurationSec: 0,
  loopAnimation: true,
  loopDurationSec: 2,
  streamLoopEnabled: true,
  lifetimeMin: 0.8,
  lifetimeMax: 1.5,
  speedMin: 150,
  speedMax: 300,
  gravityEnabled: false,
  gravityX: 0,
  gravityY: 500,
  dampingEnabled: false,
  noiseEnabled: false,
  noiseMode: 'random',
  sNoiseStrengthMode: 'linear',
  sNoiseCurve: [{ t: 0, v: 1 }, { t: 1, v: 1 }],
  minTravelY: 0,
  sizeStart: 1.0,
  sizeEnd: 1.0,
  sizeSeparate: false,
  useSizeCurve: false,
  sizeCurve: [{ t: 0, v: 1 }, { t: 1, v: 1 }],
  opacityStart: 1.0,
  opacityEnd: 0.0,
  useOpacityCurve: true,
  opacityCurve: [{ t: 0, v: 1 }, { t: 1, v: 0 }],
  particleSpinDegPerSec: 0,
  rotationMode: 'fixed',
  pathEnabled: false,
  pathMode: 'lock',
  pathType: 'circle',
  pathClosed: true,
  pathPoints: [{ x: -120, y: 0 }, { x: 120, y: 0 }],
  pathStartT: 0,
  pathSpeedPxPerSec: 360,
  pathRadiusX: 120,
  pathRadiusY: 120,
  pathRadiusOffset: 0,
  pathThickness: 0,
  pathSpeedDegPerSec: 180,
  pathReverse: false,
  pathRandomStartAngle: true,
  pathStartAngleDeg: 0,
  pathEmitSampleCount: 50,
  pathEmitSideMode: 'left',
  pathEmitBothSideRatioLeft: 0.5,
  pathEmitFacingEnabled: false,
  pathEmitFacingDeg: 0,
  shape: { type: 'point', x: 0, y: 0 },
  sprites: [],
  spritePlayback: 'single',
  spriteSequenceFps: 12,
  spriteSequenceLoop: true,
  spriteSequenceRandom: false,
  warmupEnabled: false,
  warmupSeconds: 0,
  // 默认值补充
  blendMode: 'add',
  colorStart: '#ffffff',
  colorEnd: '#ffffff',
  emissionAngleEnabled: false,
  emissionAngleDeg: 360,
  emissionOffsetDeg: 0,
  attractorEnabled: false,
  attractorMode: 'linear',
  attractorStrength: 0,
  attractorRadius: 200,
  spiralInward: false,
  spiralStartRadius: 200,
  spiralEndRadius: 0,
  swirlStrength: 0
};
