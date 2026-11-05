// A stand-in ComfyUI for tests that drive the whole pipeline without a GPU.
//
// It speaks the HTTP the worker uses and offers the Qwen-Image-2.1 Turbo nodes
// and weights, so a node reports Turbo ready. Every queued prompt finishes at
// once with one real PNG. Nothing ever reaches a ComfyUI on this machine.

import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { MODEL_MANIFEST } from '../../packages/shared/src/model-manifest.mjs';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
/** A real, decodable grey PNG: large enough that a result is not an empty file. */
export function stubPng(size = 64) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = [];
  let seed = 1;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let i = 1; i < row.length; i++) row[i] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16;
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))
  ]);
}

const WEIGHTS = MODEL_MANIFEST.flatMap((model) => model.required_files.map((file) => file.path.split('/').pop()));

function nodeInfo(name) {
  const required = { model_name: [WEIGHTS] };
  if (name === 'NovaFlowGGUFBF16Loader') required.unet_name = [['Qwen-Image-2.1-Turbo-BF16.gguf']];
  if (name === 'CLIPLoader') required.clip_name = [['qwen3vl_8b_bf16.safetensors']];
  if (name === 'VAELoader') required.vae_name = [['qwen_image_2.1_vae_bf16.safetensors']];
  return { [name]: { input: { required } } };
}

export async function startComfyStub() {
  const history = new Map();
  const prompts = [];
  const uploads = [];
  const png = stubPng();
  let next = 1;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://stub');
    const send = (value) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === '/system_stats') return send({ system: { comfyui_version: '0.31.1-test', os: 'test' }, devices: [] });
    const node = /^\/object_info\/(.+)$/.exec(url.pathname);
    if (node) return send(nodeInfo(decodeURIComponent(node[1])));
    if (url.pathname === '/object_info') return send({});
    if (url.pathname === '/upload/image') {
      uploads.push(body.length);
      return send({ name: 'upload-' + uploads.length + '.png', subfolder: '', type: 'input' });
    }
    if (url.pathname === '/prompt' && req.method === 'POST') {
      const promptId = 'stub-' + next++;
      prompts.push({ promptId, graph: JSON.parse(body.toString()).prompt });
      history.set(promptId, {
        status: { completed: true, status_str: 'success', messages: [] },
        outputs: { 9: { images: [{ filename: promptId + '.png', subfolder: '', type: 'output' }] } }
      });
      return send({ prompt_id: promptId, number: next });
    }
    const entry = /^\/history\/(.+)$/.exec(url.pathname);
    if (entry) {
      const id = decodeURIComponent(entry[1]);
      return send(history.has(id) ? { [id]: history.get(id) } : {});
    }
    if (url.pathname === '/history') return send({});
    if (url.pathname === '/queue') return send({ queue_running: [], queue_pending: [] });
    if (url.pathname === '/view') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(png);
    }
    if (['/free', '/interrupt'].includes(url.pathname)) return send({});
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    prompts,
    uploads,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); })
  };
}
