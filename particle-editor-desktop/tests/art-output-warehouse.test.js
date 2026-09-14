const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const renderer = fs.readFileSync(path.join(root, 'particle-editor/novaflow-brand-runtime.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'particle-editor-desktop/main.js'), 'utf8');
function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaflow-image-warehouse-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = {};
  let opened = '';
  const context = vm.createContext({
    fs, path, Buffer, ArrayBuffer, Uint8Array, Blob, URL, URLSearchParams, atob,
    getNovaFlowTempCategoryDir(category) {
      assert.equal(category, 'ai-sequence-cache');
      return dir;
    },
    guessMimeFromPath(file) {
      return /\.mp4$/.test(file) ? 'video/mp4' : `image/${path.extname(file).slice(1)}`;
    },
    handleNovaFlowTempIpc(name, handler) { handlers[name] = handler; },
    shell: { async openPath(target) { opened = target; return ''; } },
  });
  vm.runInContext(between(main, 'const ensureAiSeqCacheDir =', 'const miniMaxH3OutputPublisher ='), context);
  vm.runInContext(between(main, 'handleNovaFlowTempIpc("ai-seq-cache-temp-file"', 'handleNovaFlowTempIpc("ai-seq-cache-copy-from-path"'), context);
  vm.runInContext(between(main, 'handleNovaFlowTempIpc("runtime-open-output-folder"', 'ipcMain.handle("runtime-open-logs-folder"'), context);
  // Real downloaded PNG bytes, including transparency; the storage path must not re-encode them.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const api = {
    async runtimeRequestBinary() { return { ok: true, dataBase64: bytes.toString('base64'), contentType: 'image/png' }; },
    aiSeqCacheTempFile: payload => handlers['ai-seq-cache-temp-file'](null, payload),
  };
  context.window = { electronAPI: api };
  vm.runInContext(between(renderer, '  async function artFetchBlob(', '  async function artUploadDataUrl('), context);
  return { dir, context, api, handlers, bytes, opened: () => opened };
}

test('generated image downloads reach the exact primary warehouse with unchanged bytes and deduplication', async t => {
  const h = setup(t);
  const base = 'http://127.0.0.1:8188';
  for (const name of ['local.png', 'gpt.jpg', 'google.webp']) {
    const url = `/view?filename=${name}&subfolder=generated&type=output`;
    const blob = await h.context.artFetchBlob(base, url);
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), h.bytes);
    await h.context.artFetchBlob(base, url);
  }
  const names = fs.readdirSync(h.dir).filter(name => !name.startsWith('.'));
  assert.equal(names.length, 3);
  for (const name of names) {
    assert.match(name, /^image_\d{8}_\d{6}(?:_\d+)?\.(png|jpg|webp)$/);
    assert.deepEqual(fs.readFileSync(path.join(h.dir, name)), h.bytes);
  }
  const opened = await h.handlers['runtime-open-output-folder']();
  assert.equal(opened.ok, true);
  assert.equal(h.opened(), h.dir);
  // The existing video route continues to use the same directory and filename convention.
  const video = await h.api.aiSeqCacheTempFile({ fileName: 'video.mp4', bytes: h.bytes, cacheKey: 'video-prompt:output:video.mp4' });
  assert.equal(path.dirname(video.path), h.dir);
  assert.match(video.fileName, /^wan_/);
  // An identical filename in a different subfolder is a different output.
  await h.context.artFetchBlob(base, '/view?filename=local.png&subfolder=other&type=output');
  assert.equal(fs.readdirSync(h.dir).filter(name => !name.startsWith('.')).length, 5);
});

test('reference reads and failed downloads do not enter the warehouse; write failures are explicit', async t => {
  const h = setup(t);
  const base = 'http://127.0.0.1:8188';
  await h.context.artFetchBlob(base, '/view?filename=reference.png&type=input');
  assert.equal(fs.readdirSync(h.dir).length, 0);
  h.api.runtimeRequestBinary = async () => ({ ok: false });
  assert.equal(await h.context.artFetchBlob(base, '/view?filename=missing.png'), null);
  assert.equal(fs.readdirSync(h.dir).length, 0);
  h.api.runtimeRequestBinary = async () => ({ ok: true, dataBase64: h.bytes.toString('base64') });
  h.api.aiSeqCacheTempFile = async () => ({ ok: false, error: 'disk full' });
  await assert.rejects(h.context.artFetchBlob(base, '/view?filename=result.png'), /图片已生成，但加入临时仓库失败.*disk full/);
});

test('Draw and UI result collection download every output while keeping the first image as preview', async t => {
  const h = setup(t);
  for (const ui of [false, true]) {
    const source = ui ? fs.readFileSync(path.join(root, 'particle-editor/ui-design-generate.workflow.js'), 'utf8') : renderer;
    const start = source.indexOf(ui ? '      const file = files[0]' : '      const file = files[0];', ui ? 0 : source.indexOf('  async function runArtGenerate()'));
    const end = source.indexOf(ui ? '      const imageUrl = await bridge.blobToDataUrl(blob)' : '      const imageUrl = await artBlobToDataUrl(blob)', start);
    const files = [{ filename: `${ui}-first.png` }, { filename: `${ui}-second.png` }];
    Object.assign(h.context, {
      files, baseUrl: 'http://127.0.0.1:8188', promptId: 'batch', runToken: 1, signal: null, onProgress() {},
      ART_GENERATE_DOWNLOAD_TIMEOUT_MS: 1000, DOWNLOAD_TIMEOUT_MS: 1000,
      setArtGenerateProgress() {}, emitProgress() {}, throwIfAborted() {}, isArtGenerateRunCurrent: () => true,
      withArtGenerateTimeout: fn => fn(), bridgeTimeout: (bridge, fn) => fn(),
      resultFileUrl: file => `/view?filename=${file.filename}&type=output`,
      bridge: { fetchBlob: h.context.artFetchBlob },
    });
    assert.ok(start >= 0 && end > start);
    const result = await vm.runInContext(`(async () => { ${source.slice(start, end)}; return {file, blob}; })()`, h.context);
    assert.equal(result.file.filename, files[0].filename);
    assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()), h.bytes);
  }
  assert.equal(fs.readdirSync(h.dir).filter(name => !name.startsWith('.')).length, 4);
});
