import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runtimeFileMatches } from '../../tools/check-independent-workspace.mjs';
import { minifyTree } from '../../tools/minify-web-dist.mjs';

test('runtime check accepts exact development and actual packaged forms, rejects stale output', async () => {
  const name = 'novaflow-web-warehouse.js';
  const source = '// warehouse\n(function(root){root.result = function(value){return value + 7;};})(window);\n';
  const dir = await mkdtemp(join(tmpdir(), 'foart-runtime-check-'));
  const file = join(dir, name);
  try {
    await writeFile(file, source);
    const report = await minifyTree(dir);
    assert.equal(report.minified, 1);
    const packaged = await readFile(file, 'utf8');
    assert.notEqual(packaged, source);
    assert.equal(await runtimeFileMatches(name, source, source), true);
    assert.equal(await runtimeFileMatches(name, source, packaged), true);
    assert.equal(await runtimeFileMatches(name, source.replace('+ 7', '+ 8'), packaged), false);
    assert.equal(await runtimeFileMatches(name, source, packaged + '/* changed */'), false);
    assert.equal(await runtimeFileMatches(name, 'function (', packaged), false);
  } finally {
    await unlink(file);
    await rmdir(dir);
  }
});
