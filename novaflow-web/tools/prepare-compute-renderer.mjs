// Build a node-only allow-list rather than copying the full renderer tree.
// The two legacy builder closures remain here until their core-code extraction
// is implemented; this pass deliberately does not claim to encrypt them.
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { instrumentModule } from './instrument-workflow-module.mjs';
import { WORKFLOW_MODULES } from '../packages/shared/src/workflow-modules.mjs';
import { createWorkflowHost } from '../worker/src/comfy/workflow-host.mjs';
import { RELEASE_VERSION } from '../packages/shared/src/release.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const COMPUTE_RENDERER_FILES = Object.freeze([
  'qwen21-turbo.workflow.js', 'comfyui-workflow-credit-cost.js',
  'art-quality-profile.workflow.js', 'art-reference-compiler.workflow.js',
  'art-generate-model.resource.js', 'art-generate-lora.js',
  'art-direction.workflow.js', 'generative-split.workflow.js',
  'art-generate-provider.workflow.js', 'ai-sequence-minimax-h3.workflow.js',
  'ai-sequence-video-merge-export.workflow.js', 'aifx-restyle.workflow.js',
  'split-inpaint-nsfw.workflow.js', 'novaflow-brand-runtime.js', 'spine-split-runtime.js'
]);

export async function verifyComputeRenderer(rendererDir) {
  const host = await createWorkflowHost({ rendererDir });
  const missing = [];
  for (const [moduleName, entry] of Object.entries(WORKFLOW_MODULES)) {
    const functions = new Set([...host.buildersFor(moduleName), ...(host.describe(moduleName)?.functions || [])]);
    for (const method of entry.methods) if (!functions.has(method)) missing.push(moduleName + '.' + method);
  }
  if (missing.length) throw new Error('精简节点缺少工作流入口：' + missing.join(', '));
  return { builders: host.builderCount, modules: Object.keys(WORKFLOW_MODULES).length };
}

export async function prepareComputeRenderer({ sourceDir = join(ROOT, 'renderer'), outputDir = join(ROOT, 'compute-renderer') } = {}) {
  const output = resolve(outputDir);
  // Remove only the files owned by this generated directory. A stale or nested
  // unexpected directory fails instead of silently shipping extra product code.
  if (output === resolve(sourceDir) || output === ROOT) throw new Error('精简节点输出目录不能覆盖源码');
  await mkdir(output, { recursive: true });
  for (const entry of await readdir(output, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error('精简节点目录含未知子目录：' + entry.name);
    await unlink(join(output, entry.name));
  }
  const files = [];
  for (const name of COMPUTE_RENDERER_FILES) {
    const source = await readFile(join(sourceDir, name), 'utf8');
    const moduleName = name.slice(0, -3);
    const forceNames = moduleName === 'novaflow-brand-runtime' ? ['buildArtGenerateRunWorkflow']
      : moduleName === 'spine-split-runtime' ? ['buildGenerativeSplitWorkflow'] : [];
    const result = instrumentModule(source, { moduleName, forceNames });
    await writeFile(join(output, name), result.code, 'utf8');
    files.push({ file: name, bytes: Buffer.byteLength(result.code), sha256: createHash('sha256').update(result.code).digest('hex') });
  }
  const verification = await verifyComputeRenderer(output);
  const report = { profile: 'compute-only', version: RELEASE_VERSION, ...verification, files,
    residualBuilderClosures: ['novaflow-brand-runtime.js', 'spine-split-runtime.js'], encrypted: false };
  await writeFile(join(output, 'compute-manifest.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await prepareComputeRenderer();
  console.log(JSON.stringify({ profile: report.profile, files: report.files.length, bytes: report.files.reduce((sum, f) => sum + f.bytes, 0), builders: report.builders, modules: report.modules }));
}
