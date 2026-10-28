// AI lives in 小桃AI. Prompt bars keep 编辑 and 历史记录, and no longer mount an 「AI 助手」 button.
// Dialog titles, comments, and error strings may still say AI 助手; button labels may not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const renderer = fileURLToPath(new URL('../../renderer/', import.meta.url));

function filesIn(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'assets' || name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) filesIn(path, out);
    else if (/\.(js|mjs|html)$/.test(name)) out.push(path);
  }
  return out;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const BUTTON_LABEL = /(?:setSmartAiTextIfChanged\s*\(\s*[^,]+,\s*|promptActionButton\s*\(\s*[^,]+,\s*|label\s*\(\s*el\s*\(\s*['"]button['"][\s\S]{0,120}?,\s*|el\s*\(\s*['"]button['"]\s*,[\s\S]{0,120}?,\s*|createArtEl\s*\(\s*['"]button['"][\s\S]{0,240}?)\s*['"]AI 助手['"]/;

test('no client button is labeled AI 助手', () => {
  const hits = [];
  for (const path of filesIn(renderer)) {
    const source = stripComments(readFileSync(path, 'utf8'));
    if (BUTTON_LABEL.test(source) || /<button\b[^>]*>\s*AI 助手\s*<\/button>/.test(source)) hits.push(path);
  }
  assert.deepEqual(hits, []);
});

test('the design-demand header has no 本地分析 or 在线分析 toggle', () => {
  const source = stripComments(readFileSync(join(renderer, 'ui-design.drawing.js'), 'utf8'));
  assert.equal(source.includes('本地分析'), false);
  assert.equal(source.includes('在线分析'), false);
  assert.match(source, /function renderAnalysisSelector\(\) \{\s*return null\s*\}/);
});
