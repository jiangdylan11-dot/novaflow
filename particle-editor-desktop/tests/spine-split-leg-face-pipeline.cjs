// Electron-driven regression for the See-through post-processing of the one-click split (美工 → 拆图):
// legwear/footwear are split into left/right thigh, shin and foot layers and facial features are merged into the
// face unless the "五官细拆" toggle is on. Run with: npx electron particle-editor-desktop/tests/spine-split-leg-face-pipeline.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'logs/spine-split-leg-face');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `runtime must still contain ${startMarker.trim()} … ${endMarker.trim()}`);
  return source.slice(start, end);
}

app.whenReady().then(async () => {
  const source = fs.readFileSync(path.join(root, 'particle-editor/spine-split-runtime.js'), 'utf8');
  const ast = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, true);
  const declarations = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ast.getLineAndCharacterOfPosition(node.getStart(ast)).character === 2) declarations.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const presetBlocks = sliceBetween(source, '  const PRESETS = [', '  const AUTO_PARTS = ');
  // Top-level scalar constants (thresholds, version tags) that the crop/layer helpers read.
  const manual = new Set(['SPLIT_RUNTIME_QUERY']);
  const scalarConstants = [...source.matchAll(/^  const ([A-Z][A-Z0-9_]+) = ('[^'\n]*'|"[^"\n]*"|-?\d+(?:\.\d+)?|true|false|null)\s*$/gm)]
    .filter((m) => !manual.has(m[1]))
    .map((m) => `const ${m[1]} = ${m[2]};`)
    .join('\n');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
  await win.loadURL('about:blank');
  const results = await win.webContents.executeJavaScript(`(async () => {
    const SPLIT_RUNTIME_QUERY = new URLSearchParams('');
    const splitPreviewImageCache = new Map();
    ${scalarConstants}
    ${presetBlocks}
    const state = { includeFaceDetails: false, sourceSize: { width: 300, height: 600 }, sourceImageSize: { width: 300, height: 600 }, sourceOffset: { x: 0, y: 0 }, source: { fileName: 'pipeline.png', dataUrl: '' }, sourceResources: [], activeSourceResourceId: '', spineFix: true, purpose: 'spine', quality: 'fine', edgeMode: 'removeWhite', inpaintMode: 'standard', mode: 'auto', parts: [] };
    ${declarations.join('\n')}
    const png = (draw, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); draw(ctx); return c.toDataURL('image/png'); };
    const part = (id, x, y, w, h, color, drawExtra) => ({ id, name: id, x, y, width: w, height: h, layer: 50, visible: true, dataUrl: png((ctx) => { ctx.fillStyle = color; if (drawExtra) drawExtra(ctx); else ctx.fillRect(0, 0, w, h); }, w, h) });
    state.source.dataUrl = png((ctx) => { ctx.fillStyle = '#888'; ctx.fillRect(0, 0, 300, 600); }, 300, 600);
    const character = () => [
      part('head', 100, 0, 100, 90, '#f0c8a0'),
      part('face', 110, 20, 80, 70, '#f5d5b0'),
      part('eyebrow_l', 150, 30, 20, 5, '#222'),
      part('eyebrow_r', 120, 30, 20, 5, '#222'),
      part('ears_l', 188, 40, 10, 20, '#e0b090'),
      part('mouth', 140, 70, 20, 6, '#a33'),
      part('nose', 148, 55, 6, 8, '#c96'),
      part('body', 90, 90, 120, 210, '#39f'),
      part('legwear', 90, 300, 120, 240, '#333', (ctx) => { ctx.fillRect(0, 0, 120, 40); ctx.fillRect(0, 40, 50, 200); ctx.fillRect(70, 40, 50, 200); }),
      part('footwear', 85, 540, 130, 40, '#111', (ctx) => { ctx.fillRect(0, 0, 55, 40); ctx.fillRect(75, 0, 55, 40); })
    ];
    const ids = (list) => list.map((p) => p.id).sort();
    const out = { warnings: [] };
    console.warn = (...args) => { out.warnings.push(args.map((a) => (a && a.stack) || String(a)).join(' ')); };
    try {
      state.includeFaceDetails = false;
      out.merged = ids(await prepareSeeThroughPsdParts(character()));
      const face = (await prepareSeeThroughPsdParts(character())).find((p) => p.id === 'face');
      out.mergedFaceBox = { x: face.x, y: face.y, width: face.width, height: face.height };
      state.includeFaceDetails = true;
      out.detailed = ids(await prepareSeeThroughPsdParts(character()));
      state.includeFaceDetails = false;
      out.noFace = ids(await prepareSeeThroughPsdParts(character().filter((p) => p.id !== 'face' && p.id !== 'head')));
      out.singleLeg = ids(await prepareSeeThroughPsdParts([part('head', 100, 0, 100, 90, '#f0c8a0'), part('legwear', 120, 300, 40, 240, '#333'), part('footwear', 115, 540, 60, 40, '#111')]));
      out.sockOnly = ids(await prepareSeeThroughPsdParts([part('head', 100, 0, 100, 90, '#f0c8a0'), part('legwear', 90, 470, 120, 70, '#333', (ctx) => { ctx.fillRect(0, 0, 50, 70); ctx.fillRect(70, 0, 50, 70); }), part('footwear', 85, 540, 130, 40, '#111', (ctx) => { ctx.fillRect(0, 0, 55, 40); ctx.fillRect(75, 0, 55, 40); })]));
      const wholeHead = { ...part('head', 95, 0, 110, 95, '#f0c8a0'), seeThroughHeadLayer: true };
      state.includeFaceDetails = false;
      out.wholeHeadOff = ids(await prepareSeeThroughPsdParts([...character().filter((p) => p.id !== 'head'), wholeHead]));
      state.includeFaceDetails = true;
      out.wholeHeadOn = ids(await prepareSeeThroughPsdParts([...character().filter((p) => p.id !== 'head'), wholeHead]));
      state.includeFaceDetails = false;
      const legs = (await prepareSeeThroughPsdParts(character())).filter((p) => /thigh|shin|foot/.test(p.id));
      out.legBoxes = Object.fromEntries(legs.map((p) => [p.id, { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) }]));
    } catch (error) {
      out.error = String(error && error.stack || error);
    }
    return out;
  })()`);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  assert.equal(results.error, undefined, results.error);
  assert.deepEqual(results.merged, ['body', 'face', 'head', 'left_foot', 'left_shin', 'left_thigh', 'right_foot', 'right_shin', 'right_thigh']);
  assert.ok(results.mergedFaceBox.width >= 88 && results.mergedFaceBox.height >= 70, 'merged face must grow to cover the ear and eyebrows');
  assert.deepEqual(results.detailed, ['body', 'ears_l', 'eyebrow_l', 'eyebrow_r', 'face', 'head', 'left_foot', 'left_shin', 'left_thigh', 'mouth', 'nose', 'right_foot', 'right_shin', 'right_thigh']);
  assert.deepEqual(results.noFace, ['body', 'ears_l', 'eyebrow_l', 'eyebrow_r', 'left_foot', 'left_shin', 'left_thigh', 'mouth', 'nose', 'right_foot', 'right_shin', 'right_thigh']);
  assert.deepEqual(results.wholeHeadOff, ['body', 'head', 'left_foot', 'left_shin', 'left_thigh', 'right_foot', 'right_shin', 'right_thigh'], 'a whole-head layer replaces face and feature layers when features are not split');
  assert.deepEqual(results.wholeHeadOn, ['body', 'ears_l', 'eyebrow_l', 'eyebrow_r', 'face', 'left_foot', 'left_shin', 'left_thigh', 'mouth', 'nose', 'right_foot', 'right_shin', 'right_thigh'], 'with features split the whole-head layer is dropped');
  assert.deepEqual(results.singleLeg, ['footwear', 'head', 'legwear'], 'a single narrow leg must stay one legwear layer');
  assert.deepEqual(results.sockOnly, ['head', 'left_foot', 'left_shin', 'right_foot', 'right_shin'], 'legwear below the knee becomes shins, never a fabricated thigh');
  assert.ok(results.legBoxes.right_thigh.x < results.legBoxes.left_thigh.x, 'image-left leg is the character\'s right leg');
  assert.ok(results.legBoxes.right_shin.y > results.legBoxes.right_thigh.y && results.legBoxes.right_foot.y > results.legBoxes.right_shin.y, 'thigh, shin and foot stack top to bottom');
  console.log(JSON.stringify({ pass: true, results }));
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
