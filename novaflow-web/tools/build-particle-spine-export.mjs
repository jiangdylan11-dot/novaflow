import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../renderer/package.json', import.meta.url));
const { build } = require('esbuild');

await build({
  entryPoints: [fileURLToPath(new URL('../renderer/src/engine/SpinePackageExporter.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../renderer/assets/particle-spine-export.js', import.meta.url)),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none'
});
