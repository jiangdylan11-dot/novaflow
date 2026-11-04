// Package the existing drawing framework inside the standalone admin app.
// Reject upstream module-shape changes rather than generating a partial copy.
import {readFile, writeFile} from 'node:fs/promises';

const source = new URL('../../supabase/functions/novaflow-backend/art-direction.mjs', import.meta.url);
const destination = new URL('../admin/admin-server/art-direction.generated.cjs', import.meta.url);
const input = await readFile(source, 'utf8');
const importLine = "import { DEFAULT_RUNNINGHUB_LLM_MODEL } from '../_art-shared/backend-legacy-v249-runninghub-llm.mjs';";
const exportLine = 'export { SCHEMA, SYSTEM, build, validate, buildReview, validateReview };';
const lines = input.split(/\r?\n/);
if (lines.filter(line => line === importLine).length !== 1 || lines.filter(line => line === exportLine).length !== 1 ||
    (input.match(/^import\s/gm) || []).length !== 1 || (input.match(/^export\s/gm) || []).length !== 1) {
  throw new Error('Admin art-direction source module shape changed');
}
const output = input.replace(importLine, "const { DEFAULT_RUNNINGHUB_LLM_MODEL } = require('../load-shared-esm.cjs');")
  .replace(exportLine, 'module.exports = { SCHEMA, SYSTEM, build, validate, buildReview, validateReview };');
if (process.argv.includes('--check')) {
  if (await readFile(destination, 'utf8') !== output) throw new Error('Admin art-direction generated module drift');
} else {
  await writeFile(destination, output, 'utf8');
}
console.log(`Admin art-direction module ${process.argv.includes('--check') ? 'verified' : 'synced'}`);
