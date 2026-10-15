// 骨骼动画「粒子特效」弹框的粒子核心：renderer/src/engine/particleFx.ts → renderer/assets/particle-fx.js（window.NovaFlowParticleFx）
// node novaflow-web/tools/build-particle-fx.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../renderer/package.json', import.meta.url));
const { build } = require('esbuild');

await build({
  entryPoints: [fileURLToPath(new URL('../renderer/src/engine/particleFx.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../renderer/assets/particle-fx.js', import.meta.url)),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none'
});
