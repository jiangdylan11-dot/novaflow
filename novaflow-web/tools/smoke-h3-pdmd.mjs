// A short execution check, not a quality or speed benchmark. Uses the installed builder.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createWorkflowHost } from '../worker/src/comfy/workflow-host.mjs';

const rendererDir = process.env.NOVAFLOW_PDMD_RENDERER || 'C:/Program1/NovaFlow/resources/worker-renderer';
const origin = process.env.NOVAFLOW_COMFY_IMAGE_URL || 'http://127.0.0.1:8188';
const out = resolve('artifacts/h3-pdmd-20261004');
const host = await createWorkflowHost({ rendererDir });
await mkdir(out, { recursive: true });
const info = await (await fetch(origin + '/object_info')).json();
const results = [];
for (const profile of ['pdmd_4step', 'pdmd_2step']) {
  const options = { profile, mode: 't2v', prompt: 'A red paper boat floats gently on calm blue water. Static camera, daylight, soft ripples. Quiet water sounds.', width: 320, height: 640, durationSeconds: 1, fps: 24, seed: 42, outputPrefix: 'video/PDMD_smoke_' + profile };
  const graph = await host.buildGraph({ module: 'NovaFlowAiSequenceMiniMaxH3Workflow', method: 'buildWorkflow', options });
  for (const node of Object.values(graph)) {
    if (!info[node.class_type]) throw new Error('Missing runtime node: ' + node.class_type);
    for (const [key, value] of Object.entries(node.inputs)) {
      const schema = info[node.class_type].input.required?.[key] || info[node.class_type].input.optional?.[key];
      if (schema && Array.isArray(schema[0]) && !Array.isArray(value) && !schema[0].includes(value)) throw new Error('Unavailable runtime choice: ' + node.class_type + '.' + key + '=' + value);
    }
  }
  await writeFile(out + '/' + profile + '-graph.json', JSON.stringify({ options, graph }, null, 2));
  const start = Date.now();
  const response = await fetch(origin + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: 'novaflow-pdmd-smoke', prompt: graph }) });
  const submitted = await response.json();
  if (!response.ok || !submitted.prompt_id) throw new Error('Submission failed: ' + JSON.stringify(submitted));
  console.log('QUEUED', profile, submitted.prompt_id);
  let record;
  while (Date.now() - start < 30 * 60 * 1000) {
    const history = await (await fetch(origin + '/history/' + submitted.prompt_id)).json();
    record = history[submitted.prompt_id];
    if (record) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!record) throw new Error('Execution timed out: ' + profile);
  await writeFile(out + '/' + profile + '-history.json', JSON.stringify(record, null, 2));
  if (record.status?.status_str !== 'success') throw new Error('Execution failed: ' + JSON.stringify(record.status));
  const files = Object.values(record.outputs || {}).flatMap(node => node.images || node.videos || []);
  if (!files.length) throw new Error('No output video: ' + profile);
  for (const file of files) {
    const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' });
    const media = await fetch(origin + '/view?' + query);
    if (!media.ok) throw new Error('Output download failed');
    await writeFile(out + '/' + file.filename, new Uint8Array(await media.arrayBuffer()));
  }
  results.push({ profile, promptId: submitted.prompt_id, seconds: (Date.now() - start) / 1000, files });
  console.log('PASS', JSON.stringify(results.at(-1)));
  await writeFile(out + '/smoke-results.json', JSON.stringify(results, null, 2));
}
