// A pen dragged over a canvas with touch-action:auto is taken over by the browser's pan gesture
// after a few pixels (pointercancel), so 视频抠图 擦除/修复 painted only a dot with a tablet.
// Every canvas FoartBrushLine watches turns the browser gestures off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('brush canvases turn off browser touch/pen gestures', () => {
  const styles = [];
  const document = { head: { appendChild: (el) => styles.push(el) }, createElement: () => ({ textContent: '', setAttribute() {} }) };
  const root = { document, addEventListener() {}, PointerEvent: function () {} };
  vm.runInNewContext(fs.readFileSync(__dirname + '/../../renderer/brush-straight-line.js', 'utf8'), { window: root });
  const css = styles.map((el) => el.textContent).join('');
  for (const selector of ['[data-novaflow-ai-cutout-edit-canvas]', '[data-novaflow-selection-tool-canvas]', '[data-novaflow-mask-tool-canvas]']) {
    assert.ok(css.includes(selector + '{touch-action:none !important}'), selector);
  }
  const canvas = { style: {} };
  root.FoartBrushLine.watch(canvas, () => true);
  assert.equal(canvas.style.touchAction, 'none');
});
