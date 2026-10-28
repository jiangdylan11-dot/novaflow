import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtime = readFileSync(new URL('../../renderer/novaflow-brand-runtime.js', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../../renderer/novaflow-ui-theme.css', import.meta.url), 'utf8');
const audio = readFileSync(new URL('../../renderer/audio-studio.tool.js', import.meta.url), 'utf8');

test('image and UI prompt boxes share a full-width row instead of a fixed reference column', () => {
  assert.match(runtime, /data-novaflow-art-generate-prompt-row/);
  assert.match(runtime, /className: "novaflow-art-generate-prompt-row"/);
  assert.doesNotMatch(runtime, /416px minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(runtime, /repeat\(auto-fit, minmax\(min\(100%, 280px\), 1fr\)\)/);
  assert.match(theme, /\.novaflow-art-generate-prompt-row/);
  assert.match(theme, /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 280px\), 1fr\)\) !important/);
  assert.doesNotMatch(theme, /grid-template-columns: none !important/);
  const promptRule = theme.slice(theme.indexOf('.novaflow-art-generate-prompt {'));
  assert.match(promptRule.slice(0, 400), /width: 100% !important/);
});

test('animation, storyboard and audio prompt fields are not capped below the panel', () => {
  assert.match(runtime, /\[data-novaflow-ai-prompt-grid="1"\],\s*\n\s*body\.novaflow-ai-animation-section-layers \[data-novaflow-ai-prompt-column="1"\] \{\s*\n\s*width: 100% !important;/);
  assert.match(runtime, /\[data-novaflow-ai-storyboard-prompt-frame="1"\] textarea[\s\S]{0,220}width: 100% !important/);
  assert.match(audio, /\.nf-as-prompt\{[^}]*width:100%/);
  assert.match(audio, /\.nf-as-prompt textarea\{[^}]*width:100%/);
});
