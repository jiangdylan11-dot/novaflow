// The exact encoder uses the baseline WASM module directly, without runtime downloads.
export const spineWebpRuntimeFiles = [
  'main/spine-webp-pma-encoder.js',
  'main/spine-webp-exact-worker.mjs',
  'node_modules/@jsquash/webp/package.json',
  'node_modules/@jsquash/webp/LICENSE',
  'node_modules/@jsquash/webp/meta.js',
  'node_modules/@jsquash/webp/codec/enc/webp_enc.js',
  'node_modules/@jsquash/webp/codec/enc/webp_enc.wasm',
];
