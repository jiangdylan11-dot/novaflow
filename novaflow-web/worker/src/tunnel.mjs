// A public address for a machine that has none.
//
// A worker behind a home router can only register http://127.0.0.1:8790, which
// is the right address for exactly one browser: one running on this machine.
// Everyone else's browser resolves it to their OWN machine. The scheduler has
// no owner filter, so a task goes wherever there is capacity - which makes
// "everyone else" the normal case rather than the edge case.
//
// cloudflared dials OUT from here and hands back an https address that maps to
// the gateway. Nothing is opened on the router, nothing is stored anywhere,
// and the bytes go from this disk to whoever asked for them.
//
// The tunnel is READ-ONLY and serves the warehouse only; the gateway enforces
// that, because a tunnel forwards whatever method it is given - a PUT through
// one reaches the origin exactly like a GET. See gateway.mjs.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// A quick tunnel prints its hostname once, on stderr, inside a box.
const URL_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;

/** Where cloudflared is: beside the source in dev, in resources when packaged. */
export function cloudflaredPath() {
  const candidates = [
    process.env.NOVAFLOW_CLOUDFLARED || '',
    join(HERE, '../vendor/cloudflared.exe'),
    join(process.resourcesPath || '', 'vendor/cloudflared.exe')
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return '';
}

export function createTunnel({ port, host = '127.0.0.1', exePath, logger } = {}) {
  const log = logger || (() => {});
  const exe = exePath || cloudflaredPath();

  let child = null;
  let url = '';
  let stopped = false;
  let restarts = 0;
  const waiters = [];

  function settle(value) {
    url = value;
    while (waiters.length) waiters.shift()(value);
  }

  function launch() {
    if (stopped) return;
    const target = 'http://' + host + ':' + port;
    child = spawn(exe, ['tunnel', '--url', target, '--no-autoupdate'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const read = (chunk) => {
      const text = String(chunk);
      if (url) return;
      const m = URL_RE.exec(text);
      if (m) {
        log('tunnel open', { url: m[0], target });
        settle(m[0]);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);

    child.on('exit', (code) => {
      if (stopped) return;
      // A quick tunnel is not guaranteed to stay up, and its hostname changes
      // when it comes back. The worker re-registers on every heartbeat, so a
      // new address propagates on its own within one interval.
      const had = url;
      url = '';
      restarts += 1;
      log('tunnel closed, reopening', { code, restarts, previous: had });
      setTimeout(launch, Math.min(30000, 2000 * restarts));
    });
  }

  return {
    get url() { return url; },
    get restarts() { return restarts; },
    available: Boolean(exe),
    exePath: exe,

    /** Resolves with the address, or '' if it does not appear in time. */
    async start({ timeoutMs = 45000 } = {}) {
      if (!exe) {
        log('no cloudflared, staying on the local address only');
        return '';
      }
      launch();
      if (url) return url;
      return await new Promise((resolve) => {
        const timer = setTimeout(() => {
          const at = waiters.indexOf(resolve);
          if (at >= 0) waiters.splice(at, 1);
          log('tunnel did not come up in time; staying on the local address');
          resolve('');
        }, timeoutMs);
        waiters.push((value) => { clearTimeout(timer); resolve(value); });
      });
    },

    stop() {
      stopped = true;
      if (!child) return;
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          child.kill('SIGTERM');
        }
      } catch (_) { /* already gone */ }
      child = null;
    }
  };
}
