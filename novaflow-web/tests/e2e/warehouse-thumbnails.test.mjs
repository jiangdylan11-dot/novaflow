import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = await readFile(new URL('../../renderer/novaflow-web-warehouse.js', import.meta.url), 'utf8');
function boot() {
  const start = source.indexOf('  const thumbnailUrls');
  const end = source.indexOf('  async function database()', start);
  return runInNewContext(`let directory={},folderTrail=[],listingVersion=1,panel={hidden:false};
    ${source.slice(start, end)}
    ({cacheThumbnail, thumbnailKey, pumpThumbnails, thumbnailCache, thumbnailQueue,
      bytes:()=>thumbnailBytes, running:()=>thumbnailRunning})`, { Map, WeakMap, Set, Promise });
}
test('thumbnail cache respects count and byte limits and replacement accounting', () => {
  const api = boot();
  for (let i = 0; i < 200; i++) api.cacheThumbnail(String(i), { blob: { size: 100 } });
  assert.equal(api.thumbnailCache.size, 160);
  assert.equal(api.bytes(), 16000);
  api.cacheThumbnail('199', { blob: { size: 200 } });
  assert.equal(api.bytes(), 16100);
  api.cacheThumbnail('large', { blob: { size: 25 * 1024 * 1024 } });
  assert.equal(api.bytes(), 0);
});
test('cache identity changes when the source file changes', () => {
  const api = boot();
  const item = { name: 'asset.webm', size: 100, modified: 1 };
  assert.equal(api.thumbnailKey(item), api.thumbnailKey({ ...item }));
  assert.notEqual(api.thumbnailKey(item), api.thumbnailKey({ ...item, modified: 2 }));
});
test('decode queue caps concurrency and skips stale and offscreen jobs', async () => {
  const api = boot(), releases = [];
  let started = 0;
  for (let i = 0; i < 8; i++) api.thumbnailQueue.push({ visible: i !== 0, version: i === 1 ? 0 : 1,
    load: () => { started++; return new Promise(resolve => releases.push(resolve)); } });
  api.pumpThumbnails();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 2); assert.equal(api.running(), 2);
  releases.splice(0).forEach(resolve => resolve());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 4); assert.equal(api.running(), 2);
  while (releases.length) {
    releases.splice(0).forEach(resolve => resolve());
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(started, 6); assert.equal(api.running(), 0);
});
