// Real disk writes behind File System Access handles; verify permission loss,
// session-only temporary outputs, legacy cleanup, collisions and permissions.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, readdir, rm, mkdir, unlink, stat } from 'node:fs/promises';
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
let failDelete = false;
function directoryHandle(folder) {
  return {
    name: folder.split(/[\\/]/).pop(), kind: 'directory',
    async queryPermission() { return granted ? 'granted' : 'prompt'; },
    async requestPermission() { requests++; granted = true; return 'granted'; },
    async isSameEntry(other) { return other.path === folder; },
    path: folder,
    async getDirectoryHandle(name, options = {}) {
      assert(!/[\\/]/.test(name));
      const child = join(folder, name);
      if (options.create) await mkdir(child, { recursive: true });
      return directoryHandle(child);
    },
    async removeEntry(name) { assert(!/[\\/]/.test(name)); if (failDelete) throw new Error('file locked'); await unlink(join(folder, name)); },
    async getFileHandle(name, options = {}) {
      assert(!/[\\/]/.test(name));
      const path = join(folder, name);
      if (!options.create) try { await readFile(path); } catch { throw missing(); }
      return {
        kind: 'file', name, path,
        async isSameEntry(other) { return path === other.path; },
        async getFile() { return new Blob([await readFile(path)]); },
        async createWritable() {
          if (!granted) throw Object.assign(new Error('permission revoked'), { name: 'NotAllowedError' });
          let bytes;
          return { async write(blob) { bytes = new Uint8Array(await blob.arrayBuffer()); }, async close() { writes++; await writeFile(path, bytes); }, async abort() {} };
        }
      };
    },
    async *entries() {
      for (const name of await readdir(folder)) yield [name, (await stat(join(folder, name))).isDirectory() ? directoryHandle(join(folder, name)) : await this.getFileHandle(name)];
    }
  };
}
const handle = directoryHandle(dir);

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
          }]).concat([['openCursor', () => {
            const request = {}, remaining = [...map.keys()];
            function next() {
              queueMicrotask(() => {
                const key = remaining.shift();
                request.result = key === undefined ? null : { value: map.get(key), delete: () => map.delete(key), continue: next };
                request.onsuccess();
                if (key === undefined) tx.oncomplete();
              });
            }
            next(); return request;
          }]]));
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
  // Old browser queues are removed without touching any user's local files.
  stores.outputs.set('legacy-image', { id: 'legacy-image', blob: new Blob(['old-image']) });
  stores.outputs.set('legacy-video', { id: 'legacy-video', blob: new Blob(['old-video']) });
  stores.outputs.set('saved-metadata', { id: 'saved-metadata', blob: null, savedName: 'user-original.png' });
  let warehouse = boot(); await warehouse.ready;
  check(stores.outputs.size, 1);
  check(stores.outputs.has('saved-metadata'), true);
  stores.outputs.clear();
  const image = new Blob(['original-image-bytes'], { type: 'image/png' });
  await warehouse.save({ name: '../fixture.png', blob: image });
  check((await readdir(dir)).length, 0);
  check(stores.outputs.size, 0); // Temporary bytes never enter the browser profile.
  check(requests, 0); // No background permission prompt.
  warehouse = boot(); await warehouse.ready;
  await warehouse.connect();
  check((await readdir(dir)).length, 0); // Closing/reloading does not resurrect unsaved media.
  await warehouse.save({ name: 'fixture.png', blob: image });
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
  check(writes, 1); check(requests, 1); // The previous session's unsaved video expired.
  await warehouse.save({ name: 'movie.mp4', blob: video });
  check(writes, 2);
  // Saved names never carry the source name: Image_/Video_ + day + a per-day number.
  const now = new Date();
  const day = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  check((await readdir(dir)).sort(), ['Image_' + day + '_001.png', 'Video_' + day + '_001.mp4']);
  const collision = new Blob(['next-image'], { type: 'image/png' });
  const occupied = 'Image_' + day + '_005.png';
  await writeFile(join(dir, occupied), 'user-original');
  await warehouse.save({ name: 'MiniMax_H3_existing.png', blob: collision });
  check(await readFile(join(dir, occupied), 'utf8'), 'user-original');
  const nextName = 'Image_' + day + '_006.png';
  check(await readFile(join(dir, nextName), 'utf8'), 'next-image');
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
  // Removing a pending result must not leave a blob that a later reconnect saves.
  const pendingRecord = { id: 'after-disconnect.png:' + Buffer.from(await webcrypto.subtle.digest('SHA-256', await image.arrayBuffer())).toString('hex') };
  await olderTab.removeAsset({ ...pendingRecord, pending: true });
  check(stores.outputs.get(pendingRecord.id).discarded, true);
  check(stores.outputs.get(pendingRecord.id).blob, null);
  await warehouse.connect();
  const deleteName = occupied;
  const selected = { name: deleteName, parent: handle, handle: await handle.getFileHandle(deleteName) };
  granted = false;
  await assert.rejects(warehouse.removeAsset(selected), /授权/); checks++;
  check(await readFile(join(dir, deleteName), 'utf8'), 'user-original');
  granted = true; failDelete = true;
  await assert.rejects(warehouse.removeAsset(selected), /file locked/); checks++;
  check(await readFile(join(dir, deleteName), 'utf8'), 'user-original');
  failDelete = false;
  await warehouse.removeAsset(selected);
  check((await readdir(dir)).includes(deleteName), false);
  check((await readdir(dir)).includes('.novaflow-trash'), false);
  check((await readdir(dir)).includes(nextName), true);

  // Stopping the local workbench clears its unsaved queue, while mapped files
  // survive cleanup, reload and reconnect. A new result can be saved afterwards.
  await warehouse.disconnect();
  await warehouse.save({ name: 'temporary.png', blob: collision });
  const beforeCleanup = await readdir(dir);
  await warehouse.clearTemporary();
  await warehouse.connect();
  check(await readdir(dir), beforeCleanup);
  await warehouse.save({ name: 'new-session.png', blob: image });
  check((await readdir(dir)).length, beforeCleanup.length + 1);

} finally { await rm(dir, { recursive: true, force: true }); }
console.log(checks + ' passed, 0 failed: local warehouse persistence and permissions');
