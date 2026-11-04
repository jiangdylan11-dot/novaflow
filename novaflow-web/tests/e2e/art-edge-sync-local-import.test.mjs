import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('art edge synchronization follows shared imports without treating function-local imports as shared', async () => {
  const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const tempRoot = await realpath(tmpdir());
  const fixture = await mkdtemp(join(tempRoot, 'foart-art-edge-graph-'));
  try {
    for (const dir of ['tools', 'packages/shared/src', 'supabase/functions/_art-shared', 'supabase/functions/novaflow-companion']) {
      await mkdir(join(fixture, dir), { recursive: true });
    }
    for (const file of ['sync-art-knowledge-edge.mjs', 'sync-edge-function.mjs']) {
      await writeFile(join(fixture, 'tools', file), await readFile(join(project, 'tools', file)));
    }
    await writeFile(join(fixture, 'supabase/functions/_art-shared/art-knowledge-edge.ts'), "import './art-knowledge.mjs';\n");
    await writeFile(join(fixture, 'supabase/functions/novaflow-companion/index.ts'),
      "import '../_art-shared/control-plane.mjs';\nimport './art-dependencies.mjs';\n");
    for (const name of ['art-knowledge.mjs', 'control-plane.mjs', 'companion-chat.mjs']) {
      const source = `export const fixture = ${JSON.stringify(name)};\n`;
      await writeFile(join(fixture, 'packages/shared/src', name), source);
      await writeFile(join(fixture, 'supabase/functions/_art-shared', name),
        `// GENERATED COPY - source: packages/shared/src/${name}\n${source}`);
    }
    const result = spawnSync(process.execPath, [join(fixture, 'tools/sync-art-knowledge-edge.mjs'), '--check'],
      { cwd: fixture, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /control-plane\.mjs/);
    assert.doesNotMatch(result.stdout, /art-dependencies\.mjs/);
  } finally {
    const actual = await realpath(fixture);
    assert.ok(actual.startsWith(tempRoot + sep), 'fixture must remain inside the temporary directory');
    await rm(actual, { recursive: true, force: true });
  }
});
