// Fetch the tunnel client the installer ships.
//
// A 52 MB binary does not belong in git, so it is downloaded here instead and
// the build picks it up from worker/vendor. Run this once on a fresh clone,
// or whenever you want a newer cloudflared:
//
//   node tools/fetch-cloudflared.mjs
//
// It is Cloudflare's own release binary, taken from their GitHub releases.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'worker/vendor/cloudflared.exe');
const SOURCE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

export async function fetchCloudflared({ force = false } = {}) {
  try {
    const info = await stat(TARGET);
    if (!force && info.size > 10_000_000) {
      return { path: TARGET, bytes: info.size, downloaded: false };
    }
  } catch { /* not there yet */ }

  const res = await fetch(SOURCE, { redirect: 'follow' });
  if (!res.ok) throw new Error('cloudflared download failed: ' + res.status);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 10_000_000) throw new Error('cloudflared download looks truncated: ' + bytes.length + ' bytes');

  await mkdir(dirname(TARGET), { recursive: true });
  await writeFile(TARGET, bytes);
  return { path: TARGET, bytes: bytes.length, downloaded: true };
}

if (String(process.argv[1] || '').endsWith('fetch-cloudflared.mjs')) {
  const out = await fetchCloudflared({ force: process.argv.includes('--force') });
  const version = execFileSync(out.path, ['--version'], { encoding: 'utf8' }).trim();
  console.log((out.downloaded ? 'downloaded' : 'already present') + ': ' +
    (out.bytes / 1024 / 1024).toFixed(1) + ' MB');
  console.log(version);
}
