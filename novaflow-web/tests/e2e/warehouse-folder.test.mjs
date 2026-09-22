import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import helper from '../../worker/electron/warehouse-folder.cjs';
const root = await mkdtemp(join(tmpdir(), 'nf-folder-test-'));
const id = randomUUID();
const request = helper.parseRequest('novaflow://warehouse/open?id=' + id + '&sub=images');
let opened = '', remembered = '', picks = 0;
const proof = () => writeFile(join(root, request.name), JSON.stringify({ id, createdAt: Date.now() }));
const adapters = { candidates: [root], pickFolder: async () => { picks++; return root; }, openPath: async folder => { opened = folder; return ''; }, remember: folder => { remembered = folder; } };
try {
  await mkdir(join(root, 'images')); await proof();
  assert.deepEqual(await helper.openWarehouseFolder('novaflow://warehouse/open?id=' + id + '&sub=images', adapters), { ok: true });
  assert.equal(opened, join(root, 'images')); assert.equal(remembered, root); assert.equal(picks, 0);
  await assert.rejects(access(join(root, request.name)));
  await proof();
  await helper.openWarehouseFolder('novaflow://warehouse/open?id=' + id, { ...adapters, candidates: [] });
  assert.equal(picks, 1); assert.equal(opened, root);
  await assert.rejects(helper.openWarehouseFolder('novaflow://warehouse/open?id=' + id + '&sub=../elsewhere', adapters));
  assert.throws(() => helper.parseRequest('novaflow://warehouse/open?id=invalid'));
  assert.throws(() => helper.parseRequest('file:///etc/passwd'));
  await writeFile(join(root, request.name), JSON.stringify({ id, createdAt: 0 }));
  await assert.rejects(helper.verifyFolder(root, request), /失效/);
  await writeFile(join(root, request.name), JSON.stringify({ id: randomUUID(), createdAt: Date.now() }));
  await assert.rejects(helper.verifyFolder(root, request), /失效/);
  await proof();
  await assert.rejects(helper.openWarehouseFolder('novaflow://warehouse/open?id=' + id, { ...adapters, openPath: async () => 'shell failed' }), /shell failed/);
  await access(join(root, request.name)); // Failed OS opens remain retryable.
  assert.deepEqual(await helper.openWarehouseFolder('novaflow://warehouse/open?id=' + id, { ...adapters, candidates: [], pickFolder: async () => '' }), { canceled: true });
  console.log('15 passed: folder proof, traversal rejection, first selection, expiry, cancellation and shell failure');
} finally { await rm(root, { recursive: true, force: true }); }
