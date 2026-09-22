// Real disk writes behind File System Access handles; verify permission loss,
// persisted pending outputs, collisions, deduplication, and cancellation.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../../renderer/novaflow-web-warehouse.js', import.meta.url), 'utf8');
const dir = await mkdtemp(join(tmpdir(), 'nf-warehouse-'));
const stores = { settings: new Map(), outputs: new Map() };
let granted = false, requests = 0, writes = 0, cancel = false, checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const missing = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
const handle = {
  name: 'local-warehouse', kind: 'directory',
  async queryPermission() { return granted ? 'granted' : 'prompt'; },
  async requestPermission() { requests++; granted = true; return 'granted'; },
  async getFileHandle(name, options = {}) {
    assert.equal(name.includes('/'), false); assert.equal(name.includes('\\'), false);
    const path = join(dir, name);
    if (!options.create) try { await readFile(path); } catch { throw missing(); }
    return {
      kind: 'file', name,
      async getFile() { return new Blob([await readFile(path)]); },
      async createWritable() {
        if (!granted) throw Object.assign(new Error('permission revoked'), { name: 'NotAllowedError' });
        let bytes;
        return { async write(blob) { bytes = new Uint8Array(await blob.arrayBuffer()); }, async close() { writes++; await writeFile(path, bytes); }, async abort() {} };
      }
    };
  },
  async *entries() { for (const name of await readdir(dir)) yield [name, await this.getFileHandle(name)]; }
};
function idb() {
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = { transaction(name) {
          const tx = {}; const map = stores[name];
          tx.objectStore = () => Object.fromEntries(['get', 'getAll', 'put', 'delete'].map(op => [op, (value, key) => {
            const result = op === 'get' ? map.get(value) : op === 'getAll' ? [...map.values()] : undefined;
            if (op === 'put') map.set(key || value.id, value);
            if (op === 'delete') map.delete(value);
            queueMicrotask(() => tx.oncomplete()); return { result };
          }]));
          return tx;
        } };
        request.onsuccess();
      });
      return request;
    }
  };
}
function boot() {
  const elements = new Map();
  const document = {
    body: { appendChild(node) { elements.set(node.id, node); } },
    getElementById(id) { return elements.get(id); },
    createElement() { return { style: {} }; }
  };
  const sandbox = { Blob, Uint8Array, Map, URL, crypto: webcrypto, document, navigator: {}, indexedDB: idb(),
    showDirectoryPicker: async () => {
      if (cancel) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      granted = true; return handle;
    }
  };
  runInContext(source, createContext(sandbox)); return sandbox.NovaFlowWebWarehouse;
}
try {
  let warehouse = boot(); await warehouse.ready;
  const image = new Blob(['original-image-bytes'], { type: 'image/png' });
  await warehouse.save({ name: '../fixture.png', blob: image });
  check((await readdir(dir)).length, 0);
  check(stores.outputs.size, 1);
  check(requests, 0); // No background permission prompt.
  warehouse = boot(); await warehouse.ready;
  await warehouse.connect();
  check((await readdir(dir)).length, 1);
  check(await readFile(join(dir, (await readdir(dir))[0]), 'utf8'), 'original-image-bytes');
  check([...stores.outputs.values()][0].blob, null);
  await Promise.all([warehouse.save({ name: 'fixture.png', blob: image }), warehouse.save({ name: 'fixture.png', blob: image })]);
  check(writes, 1);
  granted = false;
  const video = new Blob(['video-bytes'], { type: 'video/mp4' });
  await warehouse.save({ name: 'movie.mp4', blob: video });
  check(writes, 1); check(requests, 0);
  warehouse = boot(); await warehouse.ready;
  await warehouse.authorize();
  check(writes, 2); check(requests, 1);
  check((await readdir(dir)).some(name => name.endsWith('.mp4')), true);
  const collision = new Blob(['next-image'], { type: 'image/png' });
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', await collision.arrayBuffer())).toString('hex');
  const occupied = 'existing_' + hash.slice(0, 12) + '.png';
  await writeFile(join(dir, occupied), 'user-original');
  await warehouse.save({ name: 'existing.png', blob: collision });
  check(await readFile(join(dir, occupied), 'utf8'), 'user-original');
  check(await readFile(join(dir, 'existing_' + hash.slice(0, 12) + '_1.png'), 'utf8'), 'next-image');
  cancel = true; await warehouse.connect();
  check(stores.settings.get('directory'), handle);
  await warehouse.disconnect();
  check(stores.settings.has('directory'), false);
  check((await readdir(dir)).length, 4); // Disconnect never deletes local files.
  check((await warehouse.save({ name: 'secret.txt', blob: new Blob(['not media']) })).ok, false);
  const olderTab = boot(); await olderTab.ready;
  cancel = false; await warehouse.connect();
  const crossTab = await olderTab.save({ name: 'other-tab.png', blob: image });
  check(crossTab.ok, true); // A tab opened before mapping uses the latest folder.
  check((await readdir(dir)).length, 5);
  await warehouse.disconnect();
  const disconnected = await olderTab.save({ name: 'after-disconnect.png', blob: image });
  check(disconnected.pending, true); // Another tab cannot retain a disconnected mapping.
  check((await readdir(dir)).length, 5);
} finally { await rm(dir, { recursive: true, force: true }); }
console.log(checks + ' passed, 0 failed: local warehouse persistence and permissions');
