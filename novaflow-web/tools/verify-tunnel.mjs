// Prove the public address works, against the real internet.
//
// The test suite deliberately runs with the tunnel off: a suite that has to
// reach the internet to pass is a suite that fails for reasons that have
// nothing to do with the code. So the suite checks the RULES (read-only,
// warehouse-only) by sending the headers a tunnelled request carries, and this
// checks the THING: cloudflared really starts, really publishes an address,
// and a fetch from outside really comes back with the bytes - and really
// cannot write.
//
//   node tools/verify-tunnel.mjs

import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway } from '../worker/src/gateway/gateway.mjs';
import { createTunnel } from '../worker/src/tunnel.mjs';
import { issueGrantToken, deriveWorkerGrantKey } from '../packages/shared/src/tokens.mjs';
import { GRANT_OP } from '../packages/shared/src/protocol.mjs';

const TASK = '11111111-2222-4333-8444-555555555555';
const NAME = 'out_0001.png';
const BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(4096, 7)
]);

let failures = 0;
const check = (label, ok, detail) => {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (ok ? '' : '  <- ' + JSON.stringify(detail)));
  if (!ok) failures += 1;
};

const dataDir = await mkdtemp(join(tmpdir(), 'nf-tunnel-'));
const workerId = '99999999-8888-4777-8666-555555555555';
const grantKey = await deriveWorkerGrantKey(workerId, 'verify-tunnel-secret');

await mkdir(join(dataDir, 'tasks', TASK, 'output'), { recursive: true });
await writeFile(join(dataDir, 'tasks', TASK, 'output', NAME), BYTES);

const gateway = createGateway({ workerId, dataDir, getGrantKey: () => grantKey, logger: () => {} });
const port = await gateway.listen(0, '127.0.0.1');
console.log('gateway on 127.0.0.1:' + port);

const tunnel = createTunnel({ port, logger: (m, d) => console.log('  [tunnel] ' + m, d || '') });
if (!tunnel.available) {
  console.log('\ncloudflared is not here. Expected at worker/vendor/cloudflared.exe');
  process.exit(1);
}

const url = await tunnel.start();
check('cloudflared published a public address', /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(url), url);
if (!url) {
  tunnel.stop(); await gateway.close(); await rm(dataDir, { recursive: true, force: true });
  process.exit(1);
}

const token = await issueGrantToken(
  { userId: 'u1', taskId: TASK, workerId, op: GRANT_OP.DOWNLOAD, ttlSeconds: 600 }, grantKey
);

// A quick tunnel answers a moment after it prints its address.
let read = null;
for (let i = 0; i < 12 && !read; i += 1) {
  await new Promise((r) => setTimeout(r, 2500));
  try {
    const res = await fetch(url + '/gw/tasks/' + TASK + '/output/' + NAME + '?grant=' + token);
    read = { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') };
  } catch (_) { /* not up yet */ }
}
check('a browser anywhere gets the bytes off this disk',
  Boolean(read) && read.status === 200 && read.bytes.equals(BYTES),
  read ? { status: read.status, got: read.bytes.length, want: BYTES.length } : 'never answered');

const noGrant = await fetch(url + '/gw/tasks/' + TASK + '/output/' + NAME);
check('without a grant it is refused', noGrant.status === 401, { status: noGrant.status });

const write = await fetch(url + '/gw/tasks/' + TASK + '/input/evil.png?grant=' + token, {
  method: 'PUT', body: 'x'
});
const writeBody = await write.text();
check('through the real tunnel, nothing may be written to this disk',
  write.status === 403 && /finished results only/.test(writeBody),
  { status: write.status, body: writeBody.slice(0, 120) });

const peek = await fetch(url + '/gw/tasks/' + TASK + '/input/' + NAME + '?grant=' + token);
check('through the real tunnel, only the warehouse is visible', peek.status === 403, { status: peek.status });

const ranged = await fetch(url + '/gw/tasks/' + TASK + '/output/' + NAME + '?grant=' + token, {
  headers: { range: 'bytes=0-99' }
});
check('range works, so a video can start before it finishes downloading',
  ranged.status === 206, { status: ranged.status });

tunnel.stop();
await gateway.close();
await rm(dataDir, { recursive: true, force: true });
console.log(failures ? '\n' + failures + ' failed' : '\nthe public address works, and it is read-only');
process.exit(failures ? 1 : 0);
