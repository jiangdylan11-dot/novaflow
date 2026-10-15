// 由 tools/extract-particle-templates.mjs 从 index-BbIa-2NM.js 取出（粒子特效页的 13 个内置模板）。不要手改。
export const BUILTIN_PARTICLE_TEMPLATES: { name: string; config: any }[] = [
 {
  "name": "基础·点爆发",
  "config": {
   "systemName": "基础·点爆发",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": 0,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "burst",
   "burstCount": 60,
   "loopIntervalSec": 1,
   "rate": 100,
   "streamDurationSec": 0,
   "loopAnimation": true,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 0.5,
   "lifetimeMax": 1.1,
   "speedMin": 160,
   "speedMax": 420,
   "gravityEnabled": false,
   "gravityX": 0,
   "gravityY": 500,
   "dampingEnabled": false,
   "noiseEnabled": false,
   "noiseMode": "random",
   "sNoiseStrengthMode": "linear",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "minTravelY": 0,
   "sizeStart": 1,
   "sizeEnd": 0.2,
   "sizeSeparate": false,
   "useSizeCurve": false,
   "sizeCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 0,
   "rotationMode": "fixed",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "point",
    "x": 0,
    "y": 0
   },
   "sprites": [
    {
     "builtin": "star"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "add",
   "colorStart": "#ffffff",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": false,
   "emissionAngleDeg": 360,
   "emissionOffsetDeg": 0,
   "attractorEnabled": false,
   "attractorMode": "linear",
   "attractorStrength": 0,
   "attractorRadius": 200,
   "spiralInward": false,
   "spiralStartRadius": 200,
   "spiralEndRadius": 0,
   "swirlStrength": 0
  }
 },
 {
  "name": "形状·圆环爆发",
  "config": {
   "systemName": "形状·圆环爆发",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": 0,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "burst",
   "burstCount": 80,
   "loopIntervalSec": 1.2,
   "rate": 100,
   "streamDurationSec": 0,
   "loopAnimation": true,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 0.7,
   "lifetimeMax": 1.4,
   "speedMin": 80,
   "speedMax": 220,
   "gravityEnabled": false,
   "gravityX": 0,
   "gravityY": 500,
   "dampingEnabled": false,
   "noiseEnabled": false,
   "noiseMode": "random",
   "sNoiseStrengthMode": "linear",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "minTravelY": 0,
   "sizeStart": 0.7,
   "sizeEnd": 0.15,
   "sizeSeparate": false,
   "useSizeCurve": false,
   "sizeCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 0,
   "rotationMode": "direction",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "circle",
    "x": 0,
    "y": 0,
    "innerRadius": 90,
    "outerRadius": 140,
    "emitInward": false
   },
   "sprites": [
    {
     "builtin": "ring"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "add",
   "colorStart": "#ffffff",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": false,
   "emissionAngleDeg": 360,
   "emissionOffsetDeg": 0,
   "attractorEnabled": false,
   "attractorMode": "linear",
   "attractorStrength": 0,
   "attractorRadius": 200,
   "spiralInward": false,
   "spiralStartRadius": 200,
   "spiralEndRadius": 0,
   "swirlStrength": 0
  }
 },
 {
  "name": "反向·向内圆",
  "config": {
   "systemName": "反向·向内圆",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": 0,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "burst",
   "burstCount": 90,
   "loopIntervalSec": 1,
   "rate": 100,
   "streamDurationSec": 0,
   "loopAnimation": true,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 0.6,
   "lifetimeMax": 1.2,
   "speedMin": 120,
   "speedMax": 260,
   "gravityEnabled": false,
   "gravityX": 0,
   "gravityY": 500,
   "dampingEnabled": false,
   "noiseEnabled": false,
   "noiseMode": "random",
   "sNoiseStrengthMode": "linear",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "minTravelY": 0,
   "sizeStart": 0.8,
   "sizeEnd": 0.2,
   "sizeSeparate": false,
   "useSizeCurve": false,
   "sizeCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 0,
   "rotationMode": "direction",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "circle",
    "x": 0,
    "y": 0,
    "innerRadius": 20,
    "outerRadius": 180,
    "emitInward": true
   },
   "sprites": [
    {
     "builtin": "feather_circle"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "add",
   "colorStart": "#ffffff",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": false,
   "emissionAngleDeg": 360,
   "emissionOffsetDeg": 0,
   "attractorEnabled": false,
   "attractorMode": "linear",
   "attractorStrength": 0,
   "attractorRadius": 200,
   "spiralInward": false,
   "spiralStartRadius": 200,
   "spiralEndRadius": 0,
   "swirlStrength": 0
  }
 },
 {
  "name": "路径·S形摆动",
  "config": {
   "systemName": "路径·S形摆动",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": 0,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "stream",
   "burstCount": 20,
   "loopIntervalSec": 1,
   "rate": 140,
   "streamDurationSec": 2,
   "loopAnimation": false,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 0.7,
   "lifetimeMax": 1.1,
   "speedMin": 220,
   "speedMax": 320,
   "gravityEnabled": false,
   "gravityX": 0,
   "gravityY": 500,
   "dampingEnabled": false,
   "noiseEnabled": true,
   "noiseMode": "s_curve",
   "sNoiseStrengthMode": "curve",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 0.2
    },
    {
     "t": 0.2,
     "v": 1
    },
    {
     "t": 1,
     "v": 0.1
    }
   ],
   "minTravelY": 700,
   "sizeStart": 0.7,
   "sizeEnd": 0.35,
   "sizeSeparate": false,
   "useSizeCurve": false,
   "sizeCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 0
    },
    {
     "t": 0.12,
     "v": 1
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 0,
   "rotationMode": "fixed",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "point",
    "x": 0,
    "y": 0
   },
   "sprites": [
    {
     "builtin": "smoke"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "add",
   "colorStart": "#ffffff",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": false,
   "emissionAngleDeg": 360,
   "emissionOffsetDeg": 0,
   "attractorEnabled": false,
   "attractorMode": "linear",
   "attractorStrength": 0,
   "attractorRadius": 200,
   "spiralInward": false,
   "spiralStartRadius": 200,
   "spiralEndRadius": 0,
   "swirlStrength": 0,
   "noiseIntensity": 220,
   "noiseFrequency": 3.5
  }
 },
 {
  "name": "光效·射线光",
  "config": {
   "systemName": "光效·射线光",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": 0,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "burst",
   "burstCount": 90,
   "loopIntervalSec": 1.2,
   "rate": 100,
   "streamDurationSec": 0,
   "loopAnimation": true,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 0.25,
   "lifetimeMax": 0.65,
   "speedMin": 0,
   "speedMax": 40,
   "gravityEnabled": false,
   "gravityX": 0,
   "gravityY": 500,
   "dampingEnabled": true,
   "noiseEnabled": false,
   "noiseMode": "random",
   "sNoiseStrengthMode": "linear",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "minTravelY": 0,
   "sizeStart": 420,
   "sizeEnd": 180,
   "sizeSeparate": false,
   "useSizeCurve": true,
   "sizeCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 0.25,
     "v": 0.85
    },
    {
     "t": 1,
     "v": 0.3
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 0
    },
    {
     "t": 0.08,
     "v": 1
    },
    {
     "t": 0.55,
     "v": 0.55
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 0,
   "rotationMode": "random",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "point",
    "x": 0,
    "y": 0
   },
   "sprites": [
    {
     "id": "svg_ray_1",
     "name": "ray",
     "dataUrl": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'><defs><linearGradient id='g' x1='64' y1='64' x2='64' y2='0'><stop offset='0' stop-color='white' stop-opacity='0.95'/><stop offset='0.25' stop-color='white' stop-opacity='0.65'/><stop offset='1' stop-color='white' stop-opacity='0'/></linearGradient><filter id='b' x='-30%25' y='-30%25' width='160%25' height='160%25'><feGaussianBlur stdDeviation='2'/></filter></defs><g filter='url(%23b)'><path d='M64 64 L78 0 L50 0 Z' fill='url(%23g)'/></g><path d='M64 64 L72 0 L56 0 Z' fill='url(%23g)' opacity='0.9'/></svg>",
     "path": "built-in/",
     "weight": 1,
     "mode": "single",
     "colorMode": "lifecycle",
     "colorStops": [
      {
       "t": 0,
       "color": "#ffffff"
      },
      {
       "t": 0.35,
       "color": "#bfe8d7"
      },
      {
       "t": 1,
       "color": "#ffffff"
      }
     ],
     "blendMode": "add",
     "color": "#ffffff"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "add",
   "colorStart": "#ffffff",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": true,
   "emissionAngleDeg": 360,
   "emissionOffsetDeg": 0,
   "attractorEnabled": false,
   "attractorMode": "linear",
   "attractorStrength": 0,
   "attractorRadius": 200,
   "spiralInward": false,
   "spiralStartRadius": 200,
   "spiralEndRadius": 0,
   "swirlStrength": 0,
   "targetSpeedRatio": 0.25
  }
 },
 {
  "name": "龙卷·飓风",
  "config": {
   "systemName": "龙卷·飓风",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": 0,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "stream",
   "burstCount": 20,
   "loopIntervalSec": 1,
   "rate": 220,
   "streamDurationSec": 0,
   "loopAnimation": true,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 1.2,
   "lifetimeMax": 2.2,
   "speedMin": 160,
   "speedMax": 260,
   "gravityEnabled": false,
   "gravityX": 0,
   "gravityY": 500,
   "dampingEnabled": true,
   "noiseEnabled": true,
   "noiseMode": "s_curve",
   "sNoiseStrengthMode": "curve",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 0.05
    },
    {
     "t": 0.08,
     "v": 0.35
    },
    {
     "t": 0.22,
     "v": 1
    },
    {
     "t": 0.55,
     "v": 0.55
    },
    {
     "t": 1,
     "v": 0.2
    }
   ],
   "minTravelY": 900,
   "sizeStart": 34,
   "sizeEnd": 10,
   "sizeSeparate": false,
   "useSizeCurve": false,
   "sizeCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 0
    },
    {
     "t": 0.08,
     "v": 0.65
    },
    {
     "t": 0.7,
     "v": 0.35
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 720,
   "rotationMode": "direction",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "point",
    "x": 0,
    "y": 0
   },
   "sprites": [
    {
     "id": "svg_tornado_1",
     "name": "tornado",
     "dataUrl": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'><defs><filter id='glow' x='-30%25' y='-30%25' width='160%25' height='160%25'><feGaussianBlur stdDeviation='4' result='b'/><feMerge><feMergeNode in='b'/><feMergeNode in='SourceGraphic'/></feMerge></filter></defs><g filter='url(%23glow)'><circle cx='64' cy='64' r='22' fill='white' opacity='0.22'/><polygon points='64,18 74,52 110,52 80,72 92,106 64,86 36,106 48,72 18,52 54,52' fill='white' opacity='0.95'/></g></svg>",
     "path": "built-in/",
     "weight": 1,
     "mode": "single",
     "colorMode": "lifecycle",
     "colorStops": [
      {
       "t": 0,
       "color": "#c8f7e5"
      },
      {
       "t": 0.4,
       "color": "#6ee7ff"
      },
      {
       "t": 0.8,
       "color": "#7c5cff"
      },
      {
       "t": 1,
       "color": "#ffffff"
      }
     ],
     "blendMode": "add",
     "color": "#ffffff"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "add",
   "colorStart": "#8be9ff",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": true,
   "emissionAngleDeg": 22,
   "emissionOffsetDeg": 0,
   "attractorEnabled": false,
   "attractorMode": "linear",
   "attractorStrength": 0,
   "attractorRadius": 200,
   "spiralInward": false,
   "spiralStartRadius": 200,
   "spiralEndRadius": 0,
   "swirlStrength": 0,
   "targetSpeedRatio": 0.15,
   "noiseFrequency": 3.2,
   "noiseIntensity": 420
  }
 },
 {
  "name": "漩涡·吸入",
  "config": {
   "systemName": "漩涡·吸入",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": 0,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "stream",
   "burstCount": 20,
   "loopIntervalSec": 1,
   "rate": 180,
   "streamDurationSec": 0,
   "loopAnimation": true,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 1.1,
   "lifetimeMax": 1.9,
   "speedMin": 60,
   "speedMax": 140,
   "gravityEnabled": false,
   "gravityX": 0,
   "gravityY": 500,
   "dampingEnabled": true,
   "noiseEnabled": true,
   "noiseMode": "random",
   "sNoiseStrengthMode": "linear",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "minTravelY": 0,
   "sizeStart": 46,
   "sizeEnd": 8,
   "sizeSeparate": false,
   "useSizeCurve": false,
   "sizeCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 0
    },
    {
     "t": 0.12,
     "v": 0.55
    },
    {
     "t": 0.75,
     "v": 0.35
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 480,
   "rotationMode": "direction",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "circle",
    "x": 0,
    "y": 0,
    "innerRadius": 120,
    "outerRadius": 220,
    "emitInward": true
   },
   "sprites": [
    {
     "id": "svg_vortex_1",
     "name": "vortex",
     "dataUrl": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'><defs><filter id='b' x='-20%25' y='-20%25' width='140%25' height='140%25'><feGaussianBlur stdDeviation='6'/></filter><radialGradient id='s' cx='50%25' cy='50%25' r='55%25'><stop offset='0' stop-color='white' stop-opacity='0.55'/><stop offset='0.6' stop-color='white' stop-opacity='0.22'/><stop offset='1' stop-color='white' stop-opacity='0'/></radialGradient></defs><g filter='url(%23b)'><circle cx='56' cy='64' r='34' fill='url(%23s)'/><circle cx='78' cy='58' r='26' fill='url(%23s)'/><circle cx='64' cy='84' r='30' fill='url(%23s)'/></g></svg>",
     "path": "built-in/",
     "weight": 1,
     "mode": "single",
     "colorMode": "lifecycle",
     "colorStops": [
      {
       "t": 0,
       "color": "#c8f7e5"
      },
      {
       "t": 0.6,
       "color": "#7c5cff"
      },
      {
       "t": 1,
       "color": "#ffffff"
      }
     ],
     "blendMode": "add",
     "color": "#ffffff"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "add",
   "colorStart": "#c8f7e5",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": true,
   "emissionAngleDeg": 360,
   "emissionOffsetDeg": 0,
   "attractorEnabled": true,
   "attractorMode": "spiral",
   "attractorStrength": 1600,
   "attractorRadius": 900,
   "spiralInward": true,
   "spiralStartRadius": 520,
   "spiralEndRadius": 0,
   "swirlStrength": 2200,
   "targetSpeedRatio": 0.22,
   "noiseFrequency": 1,
   "noiseIntensity": 18
  }
 },
 {
  "name": "魔法·漩涡",
  "config": {
   "systemName": "魔法·漩涡",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": 0,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "stream",
   "burstCount": 20,
   "loopIntervalSec": 1,
   "rate": 50,
   "streamDurationSec": 0,
   "loopAnimation": true,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 1.5,
   "lifetimeMax": 2.5,
   "speedMin": 40,
   "speedMax": 80,
   "gravityEnabled": false,
   "gravityX": 0,
   "gravityY": 500,
   "dampingEnabled": true,
   "noiseEnabled": true,
   "noiseMode": "random",
   "sNoiseStrengthMode": "linear",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "minTravelY": 0,
   "sizeStart": 60,
   "sizeEnd": 20,
   "sizeSeparate": false,
   "useSizeCurve": true,
   "sizeCurve": [
    {
     "t": 0,
     "v": 0.6
    },
    {
     "t": 0.5,
     "v": 0.4
    },
    {
     "t": 1,
     "v": 0.2
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 0.8
    },
    {
     "t": 0.7,
     "v": 0.35
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 300,
   "rotationMode": "random",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "circle",
    "x": 0,
    "y": 0,
    "innerRadius": 20,
    "outerRadius": 60,
    "emitInward": true
   },
   "sprites": [
    {
     "id": "svg_magic_swirl_1",
     "name": "magic_swirl",
     "dataUrl": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'><defs><radialGradient id='g' cx='50%25' cy='50%25' r='60%25'><stop offset='0' stop-color='white' stop-opacity='1'/><stop offset='0.35' stop-color='white' stop-opacity='0.55'/><stop offset='1' stop-color='white' stop-opacity='0'/></radialGradient><filter id='b' x='-40%25' y='-40%25' width='180%25' height='180%25'><feGaussianBlur stdDeviation='3'/></filter></defs><g filter='url(%23b)'><path d='M64 16 C40 16 24 32 24 52 C24 78 52 86 52 104 C52 114 44 118 36 118 C54 128 86 118 86 92 C86 72 66 66 66 52 C66 42 74 38 82 38 C76 24 72 16 64 16 Z' fill='url(%23g)' opacity='0.9'/></g><circle cx='64' cy='64' r='40' fill='none' stroke='white' stroke-opacity='0.16' stroke-width='2'/></svg>",
     "path": "built-in/",
     "weight": 1,
     "scale": 1,
     "opacity": 1,
     "mode": "single",
     "colorMode": "lifecycle",
     "colorStops": [
      {
       "t": 0,
       "color": "#6600ff"
      },
      {
       "t": 0.3,
       "color": "#00ccff"
      },
      {
       "t": 0.7,
       "color": "#00ffcc"
      },
      {
       "t": 1,
       "color": "#ffffff"
      }
     ],
     "blendMode": "add",
     "color": "#ffffff"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "add",
   "colorStart": "#ffffff",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": true,
   "emissionAngleDeg": 360,
   "emissionOffsetDeg": 0,
   "attractorEnabled": true,
   "attractorMode": "spiral",
   "attractorStrength": 1200,
   "attractorRadius": 280,
   "spiralInward": true,
   "spiralStartRadius": 160,
   "spiralEndRadius": 0,
   "swirlStrength": 1400,
   "targetSpeedRatio": 0.22,
   "noiseFrequency": 1.2,
   "noiseIntensity": 18
  }
 },
 {
  "name": "自然·水流",
  "config": {
   "systemName": "自然·水流",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": 90,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "stream",
   "burstCount": 20,
   "loopIntervalSec": 1,
   "rate": 160,
   "streamDurationSec": 0,
   "loopAnimation": true,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 0.55,
   "lifetimeMax": 1.15,
   "speedMin": 220,
   "speedMax": 360,
   "gravityEnabled": true,
   "gravityX": 0,
   "gravityY": 520,
   "dampingEnabled": true,
   "noiseEnabled": true,
   "noiseMode": "random",
   "sNoiseStrengthMode": "linear",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "minTravelY": 0,
   "sizeStart": 54,
   "sizeEnd": 22,
   "sizeSeparate": false,
   "useSizeCurve": true,
   "sizeCurve": [
    {
     "t": 0,
     "v": 0.9
    },
    {
     "t": 0.5,
     "v": 0.75
    },
    {
     "t": 1,
     "v": 0.55
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 0
    },
    {
     "t": 0.08,
     "v": 0.9
    },
    {
     "t": 0.65,
     "v": 0.7
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 0,
   "rotationMode": "direction",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "rect",
    "x": 0,
    "y": 0,
    "width": 220,
    "height": 10,
    "rectEdgeOnly": false,
    "rectRandomDirection": false
   },
   "sprites": [
    {
     "id": "svg_water_streak_1",
     "name": "water_streak",
     "dataUrl": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 256'><defs><linearGradient id='g' x1='32' y1='0' x2='32' y2='256'><stop offset='0' stop-color='white' stop-opacity='0'/><stop offset='0.12' stop-color='white' stop-opacity='0.55'/><stop offset='0.45' stop-color='white' stop-opacity='0.9'/><stop offset='0.85' stop-color='white' stop-opacity='0.35'/><stop offset='1' stop-color='white' stop-opacity='0'/></linearGradient><radialGradient id='h' cx='50%25' cy='30%25' r='60%25'><stop offset='0' stop-color='white' stop-opacity='0.65'/><stop offset='1' stop-color='white' stop-opacity='0'/></radialGradient><filter id='b' x='-40%25' y='-20%25' width='180%25' height='140%25'><feGaussianBlur stdDeviation='2'/></filter></defs><g filter='url(%23b)'><path d='M32 6 C22 28 18 54 18 90 C18 156 24 206 32 248 C40 206 46 156 46 90 C46 54 42 28 32 6 Z' fill='url(%23g)'/></g><ellipse cx='32' cy='76' rx='16' ry='40' fill='url(%23h)' opacity='0.65'/></svg>",
     "path": "built-in/",
     "weight": 1,
     "scale": 1,
     "opacity": 1,
     "mode": "single",
     "colorMode": "lifecycle",
     "colorStops": [
      {
       "t": 0,
       "color": "#bff2ff"
      },
      {
       "t": 0.4,
       "color": "#69d2ff"
      },
      {
       "t": 0.8,
       "color": "#2aa6ff"
      },
      {
       "t": 1,
       "color": "#ffffff"
      }
     ],
     "blendMode": "screen",
     "color": "#ffffff"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "screen",
   "colorStart": "#ffffff",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": true,
   "emissionAngleDeg": 10,
   "emissionOffsetDeg": 0,
   "attractorEnabled": false,
   "attractorMode": "linear",
   "attractorStrength": 0,
   "attractorRadius": 200,
   "spiralInward": false,
   "spiralStartRadius": 200,
   "spiralEndRadius": 0,
   "swirlStrength": 0,
   "targetSpeedRatio": 0.12,
   "noiseFrequency": 2.1,
   "noiseIntensity": 90
  }
 },
 {
  "name": "轨迹·螺旋",
  "config": {
   "systemName": "轨迹·螺旋",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": 0,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "stream",
   "burstCount": 20,
   "loopIntervalSec": 1,
   "rate": 120,
   "streamDurationSec": 2,
   "loopAnimation": false,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 0.9,
   "lifetimeMax": 1.4,
   "speedMin": 180,
   "speedMax": 260,
   "gravityEnabled": false,
   "gravityX": 0,
   "gravityY": 500,
   "dampingEnabled": false,
   "noiseEnabled": false,
   "noiseMode": "random",
   "sNoiseStrengthMode": "linear",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "minTravelY": 0,
   "sizeStart": 0.7,
   "sizeEnd": 0.2,
   "sizeSeparate": false,
   "useSizeCurve": false,
   "sizeCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 0
    },
    {
     "t": 0.15,
     "v": 1
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 0,
   "rotationMode": "fixed",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "point",
    "x": 0,
    "y": 0
   },
   "sprites": [
    {
     "builtin": "star4"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "add",
   "colorStart": "#ffffff",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": false,
   "emissionAngleDeg": 360,
   "emissionOffsetDeg": 0,
   "attractorEnabled": true,
   "attractorMode": "spiral",
   "attractorStrength": 1000,
   "attractorRadius": 800,
   "spiralInward": true,
   "spiralStartRadius": 800,
   "spiralEndRadius": 0,
   "swirlStrength": 1500
  }
 },
 {
  "name": "火焰·喷射",
  "config": {
   "systemName": "火焰·喷射",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": -90,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "stream",
   "burstCount": 20,
   "loopIntervalSec": 1,
   "rate": 220,
   "streamDurationSec": 0,
   "loopAnimation": true,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 0.25,
   "lifetimeMax": 0.65,
   "speedMin": 40,
   "speedMax": 120,
   "gravityEnabled": true,
   "gravityX": 0,
   "gravityY": -260,
   "dampingEnabled": true,
   "noiseEnabled": true,
   "noiseMode": "random",
   "sNoiseStrengthMode": "linear",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "minTravelY": 0,
   "sizeStart": 48,
   "sizeEnd": 10,
   "sizeSeparate": false,
   "useSizeCurve": false,
   "sizeCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 0
    },
    {
     "t": 0.06,
     "v": 1
    },
    {
     "t": 0.75,
     "v": 0.45
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 260,
   "rotationMode": "random",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "cone",
    "x": 0,
    "y": 0,
    "coneRadius": 10,
    "coneAngleDeg": 30
   },
   "sprites": [
    {
     "id": "svg_flame_1",
     "name": "flame",
     "dataUrl": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'><defs><radialGradient id='g' cx='50%25' cy='40%25' r='65%25'><stop offset='0' stop-color='white' stop-opacity='1'/><stop offset='0.45' stop-color='white' stop-opacity='0.75'/><stop offset='1' stop-color='white' stop-opacity='0'/></radialGradient></defs><path d='M64 8C90 32 92 56 80 80C73 93 69 108 64 120C59 108 55 93 48 80C36 56 38 32 64 8Z' fill='url(%23g)'/></svg>",
     "path": "built-in/",
     "weight": 1,
     "mode": "single",
     "colorMode": "lifecycle",
     "colorStops": [
      {
       "t": 0,
       "color": "#fff7d6"
      },
      {
       "t": 0.18,
       "color": "#ffd166"
      },
      {
       "t": 0.55,
       "color": "#ff6b35"
      },
      {
       "t": 1,
       "color": "#ff2d55"
      }
     ],
     "blendMode": "add",
     "color": "#ffffff"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "add",
   "colorStart": "#ffffff",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": true,
   "emissionAngleDeg": 40,
   "emissionOffsetDeg": 0,
   "attractorEnabled": false,
   "attractorMode": "linear",
   "attractorStrength": 0,
   "attractorRadius": 200,
   "spiralInward": false,
   "spiralStartRadius": 200,
   "spiralEndRadius": 0,
   "swirlStrength": 0,
   "targetSpeedRatio": 0.25,
   "noiseFrequency": 2.2,
   "noiseIntensity": 40
  }
 },
 {
  "name": "魔法·星尘爆发",
  "config": {
   "systemName": "魔法·星尘爆发",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": 0,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "burst",
   "burstCount": 160,
   "loopIntervalSec": 1.2,
   "rate": 100,
   "streamDurationSec": 0,
   "loopAnimation": true,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 0.55,
   "lifetimeMax": 1.25,
   "speedMin": 90,
   "speedMax": 380,
   "gravityEnabled": true,
   "gravityX": 0,
   "gravityY": 240,
   "dampingEnabled": true,
   "noiseEnabled": true,
   "noiseMode": "random",
   "sNoiseStrengthMode": "linear",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "minTravelY": 0,
   "sizeStart": 24,
   "sizeEnd": 3,
   "sizeSeparate": false,
   "useSizeCurve": false,
   "sizeCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 0.7,
     "v": 0.6
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 520,
   "rotationMode": "random",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "point",
    "x": 0,
    "y": 0
   },
   "sprites": [
    {
     "id": "svg_spark_1",
     "name": "spark",
     "dataUrl": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'><defs><filter id='glow' x='-30%25' y='-30%25' width='160%25' height='160%25'><feGaussianBlur stdDeviation='4' result='b'/><feMerge><feMergeNode in='b'/><feMergeNode in='SourceGraphic'/></feMerge></filter></defs><g filter='url(%23glow)'><circle cx='64' cy='64' r='22' fill='white' opacity='0.22'/><polygon points='64,18 74,52 110,52 80,72 92,106 64,86 36,106 48,72 18,52 54,52' fill='white' opacity='0.95'/></g></svg>",
     "path": "built-in/",
     "weight": 1,
     "mode": "single",
     "colorMode": "lifecycle",
     "colorStops": [
      {
       "t": 0,
       "color": "#c7b7ff"
      },
      {
       "t": 0.35,
       "color": "#7c5cff"
      },
      {
       "t": 0.7,
       "color": "#4cc9f0"
      },
      {
       "t": 1,
       "color": "#ffffff"
      }
     ],
     "blendMode": "add",
     "color": "#ffffff"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "add",
   "colorStart": "#ffffff",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": true,
   "emissionAngleDeg": 360,
   "emissionOffsetDeg": 0,
   "attractorEnabled": false,
   "attractorMode": "linear",
   "attractorStrength": 0,
   "attractorRadius": 200,
   "spiralInward": false,
   "spiralStartRadius": 200,
   "spiralEndRadius": 0,
   "swirlStrength": 0,
   "targetSpeedRatio": 0.12,
   "noiseFrequency": 1.2,
   "noiseIntensity": 80
  }
 },
 {
  "name": "烟雾·上升",
  "config": {
   "systemName": "烟雾·上升",
   "enabled": true,
   "systemX": 0,
   "systemY": 0,
   "systemRotationDeg": -90,
   "systemScale": 1,
   "systemScaleSeparate": false,
   "mode": "stream",
   "burstCount": 20,
   "loopIntervalSec": 1,
   "rate": 90,
   "streamDurationSec": 0,
   "loopAnimation": true,
   "loopDurationSec": 2,
   "streamLoopEnabled": true,
   "lifetimeMin": 1.6,
   "lifetimeMax": 2.8,
   "speedMin": 10,
   "speedMax": 45,
   "gravityEnabled": true,
   "gravityX": 0,
   "gravityY": -40,
   "dampingEnabled": true,
   "noiseEnabled": true,
   "noiseMode": "random",
   "sNoiseStrengthMode": "linear",
   "sNoiseCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "minTravelY": 0,
   "sizeStart": 60,
   "sizeEnd": 160,
   "sizeSeparate": false,
   "useSizeCurve": false,
   "sizeCurve": [
    {
     "t": 0,
     "v": 1
    },
    {
     "t": 1,
     "v": 1
    }
   ],
   "opacityStart": 1,
   "opacityEnd": 0,
   "useOpacityCurve": true,
   "opacityCurve": [
    {
     "t": 0,
     "v": 0
    },
    {
     "t": 0.12,
     "v": 0.35
    },
    {
     "t": 0.65,
     "v": 0.22
    },
    {
     "t": 1,
     "v": 0
    }
   ],
   "particleSpinDegPerSec": 40,
   "rotationMode": "random",
   "pathEnabled": false,
   "pathMode": "lock",
   "pathType": "circle",
   "pathClosed": true,
   "pathPoints": [
    {
     "x": -120,
     "y": 0
    },
    {
     "x": 120,
     "y": 0
    }
   ],
   "pathStartT": 0,
   "pathSpeedPxPerSec": 360,
   "pathRadiusX": 120,
   "pathRadiusY": 120,
   "pathRadiusOffset": 0,
   "pathThickness": 0,
   "pathSpeedDegPerSec": 180,
   "pathReverse": false,
   "pathRandomStartAngle": true,
   "pathStartAngleDeg": 0,
   "pathEmitSampleCount": 50,
   "pathEmitSideMode": "left",
   "pathEmitBothSideRatioLeft": 0.5,
   "pathEmitFacingEnabled": false,
   "pathEmitFacingDeg": 0,
   "shape": {
    "type": "circle",
    "x": 0,
    "y": 0,
    "innerRadius": 0,
    "outerRadius": 12,
    "emitInward": false
   },
   "sprites": [
    {
     "id": "svg_smoke_1",
     "name": "smoke",
     "dataUrl": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'><defs><filter id='b' x='-20%25' y='-20%25' width='140%25' height='140%25'><feGaussianBlur stdDeviation='6'/></filter><radialGradient id='s' cx='50%25' cy='50%25' r='55%25'><stop offset='0' stop-color='white' stop-opacity='0.55'/><stop offset='0.6' stop-color='white' stop-opacity='0.22'/><stop offset='1' stop-color='white' stop-opacity='0'/></radialGradient></defs><g filter='url(%23b)'><circle cx='56' cy='64' r='34' fill='url(%23s)'/><circle cx='78' cy='58' r='26' fill='url(%23s)'/><circle cx='64' cy='84' r='30' fill='url(%23s)'/></g></svg>",
     "path": "built-in/",
     "weight": 1,
     "mode": "single",
     "colorMode": "lifecycle",
     "colorStops": [
      {
       "t": 0,
       "color": "#e6e6e6"
      },
      {
       "t": 0.6,
       "color": "#9a9a9a"
      },
      {
       "t": 1,
       "color": "#777777"
      }
     ],
     "blendMode": "normal",
     "color": "#ffffff"
    }
   ],
   "spritePlayback": "single",
   "spriteSequenceFps": 12,
   "spriteSequenceLoop": true,
   "spriteSequenceRandom": false,
   "warmupEnabled": false,
   "warmupSeconds": 0,
   "blendMode": "normal",
   "colorStart": "#ffffff",
   "colorEnd": "#ffffff",
   "emissionAngleEnabled": false,
   "emissionAngleDeg": 360,
   "emissionOffsetDeg": 0,
   "attractorEnabled": false,
   "attractorMode": "linear",
   "attractorStrength": 0,
   "attractorRadius": 200,
   "spiralInward": false,
   "spiralStartRadius": 200,
   "spiralEndRadius": 0,
   "swirlStrength": 0,
   "targetSpeedRatio": 0.55,
   "noiseFrequency": 0.8,
   "noiseIntensity": 28
  }
 }
]
