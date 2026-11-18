// Manual check on a machine with the Foart runtime and its image service (several minutes on the GPU, so it is
// not part of the suite):
//   node novaflow-web/tests/e2e/ui-layer-split-node.verify.mjs <image.png> <regions.json> <out dir>
// Runs the node's own split path (prompt-assistant.mjs → ui_layer_split_cli.py) and writes the layers as files.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPromptAssistant } from '../../worker/src/prompt-assistant.mjs';

const [imageFile, regionsFile, out] = process.argv.slice(2);
assert.ok(imageFile && regionsFile && out, 'usage: <image.png> <regions.json> <out dir>');
const comfyUrl = process.env.FOART_VERIFY_COMFY_URL || 'http://127.0.0.1:8188';
const queue = await (await fetch(comfyUrl + '/queue')).json();
assert.equal(queue.queue_running.length + queue.queue_pending.length, 0, 'the image service is busy; run this when the node is idle');
const lines = [];
const assistant = createPromptAssistant({ comfyUrls: [comfyUrl], logger: (message, meta) => { lines.push(message); console.log('[node]', message, JSON.stringify(meta || {})); } });
const probe = assistant.probeUiLayerSplit();
console.log('probe', JSON.stringify(probe));
assert.equal(probe.ok, true, 'this machine has what the split needs');
const regions = JSON.parse(await readFile(regionsFile, 'utf8'));
const dataUrl = 'data:image/png;base64,' + (await readFile(imageFile)).toString('base64');
const started = Date.now();
const result = await assistant.reverseImagePrompt({ surface: 'ui-design', purpose: 'ui-layer-split', visualSchema: 'nf.ui.layers.v1', images: [{ name: 'ui.png', role: 'source', dataUrl }], regions });
assert.equal(result.ok, true, result.error);
assert.equal(result.data.visualSchema, 'nf.ui.layers.v1');
assert.ok(result.data.layers.length > regions.filter(r => r.kind !== 'group').length / 2, 'most confirmed boxes became layers');
assert.ok(result.data.layers.some(layer => layer.group === 'background'), 'with a filled background');
assert.ok(lines.includes('ui layer split completed'));
await mkdir(out, { recursive: true });
const meta = [];
for (const [z, layer] of result.data.layers.entries()) {
  const file = String(z).padStart(2, '0') + '_' + layer.group + '_' + String(layer.id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) + '.png';
  await writeFile(join(out, file), Buffer.from(layer.dataUrl.split(',')[1], 'base64'));
  const { dataUrl: _omit, ...rest } = layer; meta.push({ ...rest, file, z });
}
await writeFile(join(out, 'layers.json'), JSON.stringify({ width: result.data.width, height: result.data.height, timing: result.data.timing, layers: meta }, null, 1));
console.log('ui layer split on the node path: ' + result.data.layers.length + ' layers in ' + Math.round((Date.now() - started) / 1000) + ' s, answer ' + Math.round(JSON.stringify(result).length / 1024) + ' KB → ' + out);
