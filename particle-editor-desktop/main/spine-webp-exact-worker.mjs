import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import createEncoder from '@jsquash/webp/codec/enc/webp_enc.js';
import { defaultOptions } from '@jsquash/webp/meta.js';

const require = createRequire(import.meta.url);
try {
  const wasmBinary = await readFile(require.resolve('@jsquash/webp/codec/enc/webp_enc.wasm'));
  const encoder = await createEncoder({ wasmBinary });
  const encoded = encoder.encode(new Uint8Array(workerData.bytes), workerData.width, workerData.height, {
    ...defaultOptions, lossless: 1, exact: 1, quality: 100, method: 6, alpha_quality: 100
  });
  if (!encoded) throw new Error('Exact WebP encoding failed');
  const bytes = new Uint8Array(encoded).buffer;
  parentPort.postMessage({ bytes }, [bytes]);
} catch (error) {
  parentPort.postMessage({ error: String(error?.message || error) });
}
