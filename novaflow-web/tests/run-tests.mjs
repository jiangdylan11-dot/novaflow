// NovaFlow Web test runner.
//
// Runs each suite in its own process, because several of them stand up a real
// PostgreSQL, a real HTTP server and a real worker; isolating them keeps one
// suite's ports and timers out of the next one's way.

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { availableParallelism } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const SUITES = [
  { name: 'video-matting', file: 'e2e/video-matting.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'cutout-edge-clean', file: 'e2e/cutout-edge-clean.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'cutout-sheer-material', file: 'e2e/cutout-sheer-material.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'cutout-key-entry', file: 'e2e/cutout-key-entry.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'cutout-light-hue', file: 'e2e/cutout-light-hue.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'cutout-frame-capture', file: 'e2e/cutout-frame-capture.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'video-merge-alpha-decode', file: 'e2e/video-merge-alpha-decode.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'seamless-loop', file: 'e2e/seamless-loop.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'video-matting-queue', file: 'e2e/video-matting-queue.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'queue-notice', file: 'e2e/queue-notice.test.mjs', needs: [], timeoutMs: 90000 },
  { name: 'spine-head-layer', file: 'e2e/spine-head-layer.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'spine-bounds-audio', file: 'e2e/spine-bounds-audio.test.cjs', needs: [], timeoutMs: 60000 },
  { name: 'spine-skeleton-editor', file: 'e2e/spine-skeleton-editor.test.cjs', needs: [], timeoutMs: 120000 },
  { name: 'spine-version-convert', file: 'e2e/spine-version-convert.test.cjs', needs: [], timeoutMs: 120000 },
  { name: 'ribbon-uniform-wave', file: 'e2e/ribbon-uniform-wave.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'runtime-launcher', file: 'e2e/runtime-launcher.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'tunnel-address', file: 'e2e/tunnel-address.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'local-launcher', file: 'e2e/local-launcher.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'local-assistant', file: 'e2e/local-assistant.test.mjs', needs: [], timeoutMs: 90000 },
  { name: 'local-prompt-assistant', file: 'e2e/local-prompt-assistant.test.mjs', needs: [], timeoutMs: 90000 },
  { name: 'h3-generate-compile', file: 'e2e/h3-generate-compile.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'smart-ai-dialog', file: 'e2e/smart-ai-dialog.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'ui-design-assistant-dialog', file: 'e2e/ui-design-assistant-dialog.test.mjs', needs: [], timeoutMs: 30000 },
  { name: 'ui-design-prompt-actions', file: 'e2e/ui-design-prompt-actions.test.mjs', needs: [], timeoutMs: 30000 },
  { name: 'model-selector-labels', file: 'e2e/model-selector-labels.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'retired-assistant-buttons', file: 'e2e/retired-assistant-buttons.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'generate-button-estimate', file: 'e2e/generate-button-estimate.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'gpt-image-token-billing', file: 'e2e/gpt-image-token-billing.test.mjs', needs: [], timeoutMs: 120000 },
  { name: 'ui-analysis-source-routing', file: 'e2e/ui-analysis-source-routing.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'aifx-material-engine', file: 'e2e/aifx-material-engine.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'audio-studio', file: 'e2e/audio-studio.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'xiaotao-upload', file: 'e2e/xiaotao-upload.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'qwen21-style-redraw', file: 'e2e/qwen21-style-redraw.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'art-prepare', file: 'e2e/art-prepare.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'xiaotao-art-phrasings', file: 'e2e/xiaotao-art-phrasings.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'art-reference-size-fill-settle', file: 'art-reference-size-fill-settle.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'foart-planner-selected-images', file: 'e2e/foart-planner-selected-images.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'xiaotao-online-billing', file: 'e2e/xiaotao-online-billing.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'prompt-box-width', file: 'e2e/prompt-box-width.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-compute-mode', file: 'e2e/web-compute-mode.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-compute-node', file: 'e2e/web-compute-node.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'worker-account-binding', file: 'e2e/worker-account-binding.test.mjs', needs: [], timeoutMs: 90000 },
  { name: 'protocol', file: 'e2e/protocol.test.mjs', needs: [], timeoutMs: 180000 },
  { name: 'runninghub-gpt-image', file: 'e2e/runninghub-gpt-image.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'workflow-redaction', file: 'e2e/workflow-redaction.test.mjs', needs: [], timeoutMs: 600000 },
  { name: 'web-renderer-build', file: 'e2e/web-renderer-build.test.mjs', needs: [], timeoutMs: 600000 },
  { name: 'pages-gate', file: 'e2e/pages-gate.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-generation-routes', file: 'e2e/web-generation-routes.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-animation-pool-task', file: 'e2e/web-animation-pool-task.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-split-outputs', file: 'e2e/web-split-outputs.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-ui-design-qwen21', file: 'e2e/web-ui-design-qwen21.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'warehouse-folder', file: 'e2e/warehouse-folder.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-warehouse', file: 'e2e/web-warehouse.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'video-frame-edit', file: 'e2e/video-frame-edit.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-lora', file: 'e2e/web-lora.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-lora-qwen21', file: 'e2e/web-lora-qwen21.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-shared-qwen21', file: 'e2e/web-shared-qwen21.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-object-transfer-qwen21', file: 'e2e/web-object-transfer-qwen21.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-split-source-cards', file: 'e2e/web-split-source-cards.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-templates', file: 'e2e/web-templates.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-account', file: 'e2e/web-account.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'feature-credits', file: 'e2e/feature-credits.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'quota-migration-concurrency', file: 'e2e/quota-migration-concurrency.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-png-compress', file: 'e2e/web-png-compress.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-spine-atlas-webp', file: 'e2e/web-spine-atlas-webp.test.mjs', needs: [], timeoutMs: 120000 },
  { name: 'web-spine-skel-import', file: 'e2e/web-spine-skel-import.test.mjs', needs: [], timeoutMs: 120000 },
  { name: 'web-png-strong', file: 'e2e/web-png-strong.test.mjs', needs: [], timeoutMs: 120000 },
  { name: 'web-video-tools', file: 'e2e/web-video-tools.test.mjs', needs: [], timeoutMs: 120000 },
  { name: 'sql-contract', file: 'e2e/sql-contract.test.mjs', needs: [], timeoutMs: 300000 },
  { name: 'control-plane', file: 'e2e/control-plane.test.mjs', needs: [], timeoutMs: 300000 },
  { name: 'security', file: 'e2e/security.test.mjs', needs: [], timeoutMs: 240000 },
  { name: 'user-session-limits', file: 'e2e/user-session-limits.test.mjs', needs: [], timeoutMs: 180000 },
  { name: 'multi-worker', file: 'e2e/multi-worker.test.mjs', needs: [], timeoutMs: 300000 },
  { name: 'worker-onboarding', file: 'e2e/worker-onboarding.test.mjs', needs: [], timeoutMs: 300000 },
  { name: 'worker-start-retry', file: 'e2e/worker-start-retry.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'worker-runtime-health', file: 'e2e/worker-runtime-health.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'renderer-workflow', file: 'e2e/renderer-workflow.test.mjs', needs: [], timeoutMs: 400000 },
  { name: 'full-pipeline', file: 'e2e/full-pipeline.test.mjs', needs: [], timeoutMs: 600000 }
];

// Every other test file under tests/ and tests/e2e/ runs too, in one parallel node:test pass, so a
// new or forgotten file can no longer drift red without anyone seeing it.
// These e2e files were already red when the runner started collecting them (2.0.332) and are not yet
// triaged. Each must be fixed or deleted and then taken off this list; never add to it.
const PENDING_TRIAGE = new Set([
  // read a built bundle (web-dist / worker-dist / hashed renderer asset) that a bare checkout does not have
  'e2e/cutout-original-source.test.cjs', 'e2e/cutout-progress-reentry.test.cjs', 'e2e/cutout-save-frame-plan.test.cjs',
  'e2e/cutout-save-overlay.test.cjs', 'e2e/cutout-session-reentry.test.cjs', 'e2e/cutout-timeline-bounds.test.cjs',
  'e2e/resource-media-recovery.test.cjs', 'e2e/sequence-playable-output.test.cjs', 'e2e/h3-custom-resolution.test.cjs',
  'e2e/foart-branding.test.mjs', 'e2e/generative-split.test.mjs', 'e2e/h3-beta6-retired.test.mjs',
  'e2e/h3-multireference-transport.test.mjs', 'e2e/sam-point-contract.test.mjs', 'e2e/ui-design-native-mask-workflow.test.mjs',
  'e2e/ui-natural-draft-render.test.mjs', 'e2e/ui-release-bundle.test.mjs', 'e2e/web-art-reference-payload.test.mjs',
  'e2e/art-edge-sync-local-import.test.mjs',
  // slice functions out of renderer sources that have since been refactored
  'e2e/ai-sequence-board-fps.test.mjs', 'e2e/ai-sequence-board-names.test.mjs', 'e2e/spine-sequence-atlas.test.mjs',
  'e2e/animation-export-cache.test.cjs', 'e2e/spine-project-exports.test.cjs', 'e2e/spine-attachment-selection.test.cjs',
  'e2e/ui-design-design-language.test.mjs', 'e2e/ui-design-drawing.test.mjs', 'e2e/ui-design-entry-routing.test.mjs',
  'e2e/ui-design-native-mask.test.mjs',
  // wait on a timer the code unrefs, or hang
  'e2e/flash-chat-residency.test.mjs', 'e2e/prompt-request-cancellation.test.mjs', 'e2e/strata-art-agent-progress.test.mjs',
  'e2e/strata-prompt-handoff.test.mjs', 'e2e/aifx-template-maker.test.mjs',
  // need a live service, Electron or a package the workspace does not install
  'e2e/local-assistant-live.test.mjs', 'e2e/login-design.test.cjs', 'e2e/image-reverse-settle.test.mjs',
  // expectations that predate later decided rules; check each against project rules before changing
  'e2e/art-direction-qwen-budgets.test.mjs', 'e2e/compute-shared-dependency-closure.test.mjs', 'e2e/foart-tool-plan.test.mjs',
  'e2e/qwen-capability-copy.test.mjs', 'e2e/ui-design-catalog-integration.test.mjs', 'e2e/ui-design-first-draft-contract.test.mjs',
  'e2e/ui-design-qwen-transport.test.mjs', 'e2e/ui-design-surface-lifecycle.test.mjs', 'e2e/ui-native-production.test.mjs',
  'e2e/ui-natural-draft.test.mjs', 'e2e/video-generation-preview-state.test.mjs', 'e2e/xiaotao-local-animation-routing.test.mjs',
  'e2e/xiaotao-local-qwen-v3-policy.test.mjs', 'e2e/xiaotao-qwen-capability-ui.test.mjs'
]);

async function collectNodeTests() {
  const listed = new Set(SUITES.map((suite) => suite.file));
  const files = [];
  for (const dir of ['', 'e2e/']) {
    for (const name of (await readdir(join(HERE, dir))).sort()) {
      const file = dir + name;
      if (/\.test\.(mjs|cjs|js)$/.test(name) && !listed.has(file) && !PENDING_TRIAGE.has(file)) files.push(join(HERE, file));
    }
  }
  return { name: 'node-tests', args: ['--test', '--test-reporter=tap', '--test-concurrency=' + Math.min(8, availableParallelism()), ...files], needs: [], timeoutMs: 1200000 };
}

function runSuite(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, suite.args || [join(HERE, suite.file)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    let out = '';
    child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      out += '\nSUITE TIMED OUT after ' + suite.timeoutMs + 'ms\n';
    }, suite.timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      // Custom suites print "N passed, M failed"; node:test files print TAP "# pass N" / "# fail M".
      const m = out.match(/(\d+) passed, (\d+) failed/) || out.match(/^# pass (\d+)\n# fail (\d+)$/m);
      resolve({
        name: suite.name,
        code,
        passed: m ? Number(m[1]) : 0,
        failed: m ? Number(m[2]) : (code === 0 ? 0 : 1),
        elapsedMs: Date.now() - started,
        output: out
      });
    });
  });
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const ALL_SUITES = [...SUITES, await collectNodeTests()];
const suites = only.length ? ALL_SUITES.filter((s) => only.includes(s.name)) : ALL_SUITES;

const results = [];
for (const suite of suites) {
  console.log('\n' + '='.repeat(66));
  console.log('SUITE: ' + suite.name + (suite.needs.length ? '   (needs: ' + suite.needs.join(', ') + ')' : ''));
  console.log('='.repeat(66));
  results.push(await runSuite(suite));
}

console.log('\n' + '='.repeat(66));
console.log('SUMMARY');
console.log('='.repeat(66));
let totalPassed = 0;
let totalFailed = 0;
for (const r of results) {
  totalPassed += r.passed;
  totalFailed += r.failed;
  const flag = r.code === 0 ? 'OK  ' : 'FAIL';
  console.log(
    '  ' + flag + '  ' + r.name.padEnd(16) +
    String(r.passed).padStart(4) + ' passed  ' +
    String(r.failed).padStart(3) + ' failed  ' +
    (r.elapsedMs / 1000).toFixed(1) + 's'
  );
}
console.log('  ' + '-'.repeat(60));
console.log('  TOTAL' + String(totalPassed).padStart(15) + ' passed  ' + String(totalFailed).padStart(3) + ' failed');

await mkdir(join(ROOT, '.artifacts'), { recursive: true });
await writeFile(
  join(ROOT, '.artifacts/test-results.json'),
  JSON.stringify({
    ranAt: new Date().toISOString(),
    totalPassed,
    totalFailed,
    // A passing suite's output is noise; a failing one's is the whole point,
    // and dropping it meant re-running the suite to find out what happened.
    suites: results.map(({ output, ...rest }) =>
      rest.failed || rest.code !== 0 ? { ...rest, tail: output.slice(-4000) } : rest)
  }, null, 2),
  'utf8'
);
console.log('\n  results written to novaflow-web/.artifacts/test-results.json');

process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
