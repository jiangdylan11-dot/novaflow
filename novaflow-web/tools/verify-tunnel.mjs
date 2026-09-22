// Prove the public address works, against the real internet.
//
// The test suite deliberately runs with the tunnel off: a suite that has to
// reach the internet to pass is a suite that fails for reasons that have
// nothing to do with the code. So the suite checks the RULES - by sending the
// headers a tunnelled request carries - and this checks the THING: cloudflared
// really starts, really publishes an address, a fetch from outside really
// comes back with the bytes off this disk, and the limits really hold when the
// request has crossed the internet rather than been simulated.
//
//   node tools/verify-tunnel.mjs

import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
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
function check(label, ok, detail) {
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (ok ? '' : '  <- ' + JSON.stringify(detail)));
  if (!ok) failures += 1;
}

const dataDir = await mkdtemp(join(tmpdir(), 'nf-tunnel-'));
const workerId = '99999999-8888-4777-8666-555555555555';
const grantKey = await deriveWorkerGrantKey(workerId, 'verify-tunnel-secret');

await mkdir(join(dataDir, 'tasks', TASK, 'output'), { recursive: true });
await mkdir(join(dataDir, 'tasks', TASK, 'input'), { recursive: true });
await writeFile(join(dataDir, 'tasks', TASK, 'output', NAME), BYTES);
await writeFile(join(dataDir, 'tasks', TASK, 'input', NAME), BYTES);

const gateway = createGateway({ workerId, dataDir, getGrantKey: () => grantKey, logger: () => {} });
const port = await gateway.listen(0, '127.0.0.1');
console.log('gateway on 127.0.0.1:' + port);

const tunnel = createTunnel({ port, logger: (m, d) => console.log('  [tunnel] ' + m, d || '') });
if (!tunnel.available) {
  console.log('\ncloudflared is not here. Run: node tools/fetch-cloudflared.mjs');
  process.exit(1);
}

const url = await tunnel.start();
check('cloudflared published a public address',
  /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(url), url);

const token = await issueGrantToken(
  { userId: 'u1', taskId: TASK, workerId, op: GRANT_OP.DOWNLOAD, ttlSeconds: 600 }, grantKey
);

// A quick tunnel answers a little after it prints its address, and its
// hostname takes a moment to resolve. Every request goes through this, so a
// DNS miss is a retry rather than a stack trace.
async function req(path, init, { tries = 12, waitMs = 2500 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fetch(url + path, init);
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error('never answered ' + path + ': ' + String((last && last.message) || last));
}

const out = '/gw/tasks/' + TASK + '/output/' + NAME;
const input = '/gw/tasks/' + TASK + '/input/' + NAME;

if (url) {
  try {
    const res = await req(out + '?grant=' + token);
    const got = Buffer.from(await res.arrayBuffer());
    check('a browser anywhere gets the bytes off this disk',
      res.status === 200 && got.equals(BYTES),
      { status: res.status, got: got.length, want: BYTES.length });

    const noGrant = await req(out, {}, { tries: 3 });
    check('without a grant it is refused', noGrant.status === 401, { status: noGrant.status });

    // The one write the outside world may make needs a grant minted for that
    // exact task and worker; a download grant is not an upload grant.
    const write = await req('/gw/tasks/' + TASK + '/input/ref.png?grant=' + token,
      { method: 'PUT', body: 'x' }, { tries: 3 });
    check('a reference upload needs an upload grant', write.status === 403, { status: write.status });

    // And the write that IS allowed: a reference image, with a grant minted
    // for this task and this worker, landing on this disk from outside.
    const upToken = await issueGrantToken(
      { userId: 'u1', taskId: TASK, workerId, op: GRANT_OP.UPLOAD, ttlSeconds: 600 }, grantKey
    );
    const REF = Buffer.from('reference-bytes-' + Date.now());
    const placed = await req('/gw/tasks/' + TASK + '/input/ref.png?grant=' + upToken,
      { method: 'PUT', headers: { 'content-type': 'image/png' }, body: REF }, { tries: 3 });
    check('with the right grant, a reference image lands on the disk',
      placed.status === 200, { status: placed.status });

    const landed = await readFile(join(dataDir, 'tasks', TASK, 'input', 'ref.png')).catch(() => null);
    check('and the bytes on disk are the ones that were sent',
      Boolean(landed) && landed.equals(REF), landed ? landed.length : 'missing');

    const peek = await req(input + '?grant=' + token, {}, { tries: 3 });
    const peekBody = await peek.text();
    check('only the warehouse shows - nobody outside reads an input',
      peek.status === 403 && /results and reference uploads only/.test(peekBody),
      { status: peek.status, body: peekBody.slice(0, 120) });

    const over = await req(out + '?grant=' + token, { method: 'PUT', body: 'x' }, { tries: 3 });
    const overBody = await over.text();
    check('a result cannot be overwritten from outside',
      over.status === 403 && /results and reference uploads only/.test(overBody),
      { status: over.status, body: overBody.slice(0, 120) });

    const ranged = await req(out + '?grant=' + token, { headers: { range: 'bytes=0-99' } }, { tries: 3 });
    check('range works, so a video starts before it finishes downloading',
      ranged.status === 206, { status: ranged.status });
  } catch (error) {
    check('the tunnel answered at all', false, String(error.message || error));
  }
}

tunnel.stop();
await gateway.close();
await rm(dataDir, { recursive: true, force: true });
console.log(failures
  ? '\n' + failures + ' failed'
  : '\nthe public address works: results out, references in, nothing else');
process.exit(failures ? 1 : 0);
