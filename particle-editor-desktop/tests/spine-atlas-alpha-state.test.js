const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function loadTool(api) {
  const source = fs.readFileSync(path.join(__dirname, '../../particle-editor/spine-atlas-webp.tool.js'), 'utf8');
  const boot = source.lastIndexOf('\n  installStyle()');
  assert.ok(boot > 0);
  const context = vm.createContext({
    window: { electronAPI: api }, TextEncoder, Blob, URL, alert: (message) => { throw new Error(message); }
  });
  vm.runInContext(source.slice(0, boot) + '\n render = () => {}; globalThis.tool = { state, setImageAlpha, processAll }; })()', context);
  return context.tool;
}

test('alpha selection belongs to one image and invalidates stale export results', () => {
  const tool = loadTool({});
  tool.state.images = [{ id: 'a', result: { bytes: [1] } }, { id: 'b', alphaMode: 'straight', result: { bytes: [2] } }];
  tool.state.resultAtlases = [{ text: 'old atlas' }];
  tool.setImageAlpha('a', 'pma');
  assert.equal(tool.state.images[0].alphaMode, 'pma');
  assert.equal(tool.state.images[1].alphaMode, 'straight');
  assert.ok(tool.state.images.every((item) => item.result === null));
  assert.equal(tool.state.resultAtlases.length, 0);
  tool.state.processing = true;
  tool.setImageAlpha('a', 'straight');
  assert.equal(tool.state.images[0].alphaMode, 'pma');
});

test('conversion sends per-image alpha modes and formats through the IPC payload', async () => {
  let payload;
  const tool = loadTool({ convertSpineAtlasWebp: async (value) => {
    payload = value;
    return { ok: true, atlases: [{ fileName: 'test.atlas', text: 'converted' }], images: [] };
  } });
  tool.state.atlases = [{ name: 'test.atlas', text: 'source' }];
  tool.state.images = [
    { id: 'a', name: 'a.png', bytes: [1], outputFormat: 'webp', alphaMode: 'pma' },
    { id: 'b', name: 'b.png', bytes: [2], outputFormat: 'jpg', alphaMode: 'straight' },
    { id: 'c', name: 'c.png', bytes: [3], outputFormat: 'webp' }
  ];
  await tool.processAll();
  assert.deepEqual(JSON.parse(JSON.stringify(payload.images.map((image) => [image.fileName, image.outputFormat, image.alphaMode]))), [
    ['a.png', 'webp', 'pma'], ['b.png', 'jpg', 'straight'], ['c.png', 'webp', 'auto']
  ]);
  assert.equal(tool.state.processing, false);
});
