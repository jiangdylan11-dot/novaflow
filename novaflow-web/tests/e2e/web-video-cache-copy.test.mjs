import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';

const source = await readFile(new URL('../../renderer/novaflow-web-capabilities.js', import.meta.url), 'utf8');
test('Web merge copies video blobs and keeps the original usable after releasing its copy', async () => {
  const sandbox = createDomSandbox({ console, Blob, URL, crypto, fetch, Response,
    electronAPI: {}, NovaFlowWebRuntime: {} });
  runInNewContext(source, sandbox);
  const api = sandbox.electronAPI;
  const original = await api.aiSeqCacheTempFile({ bytes: new Blob(['video-fixture'], { type: 'video/mp4' }), cacheKey: 'original' });
  const copy = await api.aiSeqCacheCopyFromPath({ inputPath: original.path });
  assert.equal(copy.ok, true);
  assert.notEqual(copy.path, original.path);
  assert.equal(await (await fetch(copy.path)).text(), 'video-fixture');
  api.aiSeqProbeVideoMeta = async () => ({ ok: true, width: 448, height: 448, durationSec: 2, fps: 24 });
  const session = await api.videoCompositorOpenSession({});
  runInNewContext(await readFile(new URL('../../renderer/ai-sequence-video-merge.resource.js', import.meta.url), 'utf8'), sandbox);
  const resource = sandbox.NovaFlowAiSequenceVideoMergeResource;
  const store = resource.createStore({
    registerSource: payload => api.videoCompositorRegisterSource({ ...payload, sessionId: session.sessionId })
  });
  await store.importDescriptor('video-layer-top', { fileName: 'generated.mp4', localPath: copy.path });
  const layer = store.getState().layers.find(layer => layer.id === 'video-layer-top');
  assert.equal(layer.source.probe.displayWidth, 448);
  assert.equal(layer.source.probe.durationSec, 2);
  assert.ok(layer.source.objectUrl.startsWith('blob:'));
  await store.destroy();
  await api.videoCompositorCloseSession({ sessionId: session.sessionId });
  await api.aiSeqCacheReleaseOutput({ key: copy.key });
  assert.equal(await (await fetch(original.path)).text(), 'video-fixture');
  const invalid = await api.aiSeqCacheCopyFromPath({ inputPath: 'C:/missing/video.mp4' });
  assert.equal(invalid.ok, false);
  await api.aiSeqCacheReleaseOutput({ key: original.key });
});
