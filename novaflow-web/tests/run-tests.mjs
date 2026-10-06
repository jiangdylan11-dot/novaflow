// NovaFlow Web test runner.
//
// Runs each suite in its own process, because several of them stand up a real
// PostgreSQL, a real HTTP server and a real worker; isolating them keeps one
// suite's ports and timers out of the next one's way.

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const SUITES = [
  { name: 'video-matting', file: 'e2e/video-matting.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'video-matting-queue', file: 'e2e/video-matting-queue.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'spine-head-layer', file: 'e2e/spine-head-layer.test.mjs', needs: [], timeoutMs: 60000 },
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
  { name: 'web-compute-mode', file: 'e2e/web-compute-mode.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-compute-node', file: 'e2e/web-compute-node.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'worker-account-binding', file: 'e2e/worker-account-binding.test.mjs', needs: [], timeoutMs: 90000 },
  { name: 'protocol', file: 'e2e/protocol.test.mjs', needs: [], timeoutMs: 180000 },
  { name: 'workflow-redaction', file: 'e2e/workflow-redaction.test.mjs', needs: [], timeoutMs: 600000 },
  { name: 'web-renderer-build', file: 'e2e/web-renderer-build.test.mjs', needs: [], timeoutMs: 600000 },
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
  { name: 'web-png-compress', file: 'e2e/web-png-compress.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'web-spine-atlas-webp', file: 'e2e/web-spine-atlas-webp.test.mjs', needs: [], timeoutMs: 120000 },
  { name: 'web-spine-skel-import', file: 'e2e/web-spine-skel-import.test.mjs', needs: [], timeoutMs: 120000 },
  { name: 'web-png-strong', file: 'e2e/web-png-strong.test.mjs', needs: [], timeoutMs: 120000 },
  { name: 'web-video-tools', file: 'e2e/web-video-tools.test.mjs', needs: [], timeoutMs: 120000 },
  { name: 'sql-contract', file: 'e2e/sql-contract.test.mjs', needs: [], timeoutMs: 300000 },
  { name: 'control-plane', file: 'e2e/control-plane.test.mjs', needs: [], timeoutMs: 300000 },
  { name: 'security', file: 'e2e/security.test.mjs', needs: [], timeoutMs: 240000 },
  { name: 'multi-worker', file: 'e2e/multi-worker.test.mjs', needs: [], timeoutMs: 300000 },
  { name: 'worker-onboarding', file: 'e2e/worker-onboarding.test.mjs', needs: [], timeoutMs: 300000 },
  { name: 'worker-start-retry', file: 'e2e/worker-start-retry.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'worker-runtime-health', file: 'e2e/worker-runtime-health.test.mjs', needs: [], timeoutMs: 60000 },
  { name: 'renderer-workflow', file: 'e2e/renderer-workflow.test.mjs', needs: ['comfyui'], timeoutMs: 400000 },
  { name: 'full-pipeline', file: 'e2e/full-pipeline.test.mjs', needs: ['comfyui'], timeoutMs: 600000 }
];

function runSuite(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(HERE, suite.file)], {
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
      const m = out.match(/(\d+) passed, (\d+) failed/);
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
const suites = only.length ? SUITES.filter((s) => only.includes(s.name)) : SUITES;

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
