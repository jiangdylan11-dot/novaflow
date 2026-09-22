// GPU and system detection (spec 7, 21).
//
// nvidia-smi is the source of truth when present. If it is absent we report
// what we could not determine rather than inventing a plausible GPU - the
// scheduler uses vram_mb to decide what this machine may run, so a guess here
// would hand it work it cannot finish.

import { exec } from 'node:child_process';
import { totalmem, freemem, cpus, hostname } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(exec);

async function nvidiaSmi(query) {
  const { stdout } = await run(
    'nvidia-smi --query-gpu=' + query + ' --format=csv,noheader,nounits',
    { timeout: 15000, windowsHide: true }
  );
  return String(stdout || '').trim();
}

export async function detectGpu() {
  try {
    const raw = await nvidiaSmi('name,memory.total,driver_version');
    const first = raw.split('\n')[0] || '';
    const [name, vram, driver] = first.split(',').map((s) => s.trim());
    if (!name) throw new Error('nvidia-smi returned no GPU');

    let cudaVersion = '';
    try {
      const { stdout } = await run('nvidia-smi', { timeout: 15000, windowsHide: true });
      cudaVersion = (String(stdout).match(/CUDA Version:\s*([\d.]+)/) || [])[1] || '';
    } catch { /* the header form differs across drivers; not fatal */ }

    return {
      name,
      vramMb: Number(vram) || 0,
      driverVersion: driver || '',
      cudaVersion,
      detected: true,
      gpuCount: raw.split('\n').filter(Boolean).length
    };
  } catch (error) {
    return {
      name: '',
      vramMb: 0,
      driverVersion: '',
      cudaVersion: '',
      detected: false,
      // Surfaced in the worker UI so the operator sees why it is not eligible
      // for work, instead of a silent idle node.
      error: 'nvidia-smi not available: ' + String(error?.message || error).slice(0, 200)
    };
  }
}

export async function detectSystem() {
  return {
    hostname: hostname(),
    ramMb: Math.round(totalmem() / (1024 * 1024)),
    freeRamMb: Math.round(freemem() / (1024 * 1024)),
    cpuModel: cpus()?.[0]?.model || '',
    cpuCount: cpus()?.length || 0,
    platform: process.platform,
    nodeVersion: process.version
  };
}
