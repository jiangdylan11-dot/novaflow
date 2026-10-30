// ComfyUI client. Talks to 127.0.0.1 ONLY (spec 9).
//
// The worker owns the workflow graphs; the browser never sees one and never
// supplies one. A task arrives as {task_type, parameters}, the runner picks
// workflows/<task_type>.json, injects the parameters into named placeholder
// slots, and submits.

import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { estimateQueueWait, withQueueNote } from '../../../packages/shared/src/protocol.mjs';

const LOCALHOST_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

// ComfyUI reports sampler steps only on its websocket; its HTTP API says nothing between "queued"
// and "done". The Node inside Electron 32 has no WebSocket, and this one is only read, so a reader
// of the server's (unmasked) frames on a plain HTTP upgrade is enough.
function readComfySocket(base, clientId, onMessage) {
  const url = new URL(base);
  const req = request({
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port || 80,
    path: '/ws?clientId=' + encodeURIComponent(clientId),
    headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') }
  });
  let socket = null;
  req.on('upgrade', (_res, upgraded) => {
    socket = upgraded;
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        let length = buffer[1] & 127;
        let at = 2;
        if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); at = 4; }
        if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); at = 10; }
        if (buffer.length < at + length) return;
        const opcode = buffer[0] & 15;
        const payload = buffer.subarray(at, at + length);
        buffer = buffer.subarray(at + length);
        if (opcode === 1) { try { onMessage(JSON.parse(payload.toString('utf8'))); } catch { /* not JSON */ } }
        if (opcode === 8) socket.destroy();
      }
    });
    socket.on('error', () => {});
  });
  req.on('error', () => {});
  req.end();
  return () => { req.destroy(); socket?.destroy(); };
}

export function assertLocalOnly(baseUrl) {
  const value = String(baseUrl || '').replace(/\/+$/, '');
  if (!LOCALHOST_RE.test(value)) {
    // A misconfigured worker pointing at 0.0.0.0 or a public host would expose
    // an unauthenticated ComfyUI. Refuse to start rather than run that way.
    throw new Error(
      'ComfyUI base url must be loopback (127.0.0.1 / localhost). Refusing to use: ' + value
    );
  }
  return value;
}

export function createComfyClient({ baseUrl, fetchImpl, logger }) {
  let base = assertLocalOnly(baseUrl);
  const doFetch = fetchImpl || globalThis.fetch;
  const log = logger || (() => {});
  const clientId = 'novaflow-worker-' + Math.random().toString(36).slice(2, 10);
  // promptId -> ids of the graph's sampling nodes (those that denoise a latent_image), whose step
  // counts are the run's progress.
  const samplers = new Map();

  async function json(path, init) {
    const res = await doFetch(base + path, { ...init, signal: init?.signal || AbortSignal.timeout(30000) });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!res.ok) {
      const err = new Error('ComfyUI ' + path + ' failed: ' + res.status + ' ' + String(text).slice(0, 300));
      err.status = res.status;
      throw err;
    }
    return body;
  }

  return {
    clientId,
    get baseUrl() { return base; },
    // The runtime moved to another port (its own was held by a ComfyUI that is not NovaFlow's).
    retarget(url) { base = assertLocalOnly(url); },

    // The workflow host may inspect only this worker's configured runtime.
    async requestJson(_baseUrl, path) {
      if (!/^\/object_info(?:\/[^/]+)?$/.test(path) && path !== '/system_stats') throw new Error('unsupported builder lookup');
      return await json(path, { method: 'GET' });
    },

    async systemStats() {
      return await json('/system_stats', { method: 'GET' });
    },

    async isUp() {
      try {
        await json('/system_stats', { method: 'GET' });
        return true;
      } catch {
        return false;
      }
    },

    /** Upload a file into ComfyUI's input folder so a LoadImage node can read it. */
    async uploadImage(name, bytes) {
      const form = new FormData();
      form.append('image', new Blob([bytes]), name);
      form.append('overwrite', 'true');
      const res = await doFetch(base + '/upload/image', { method: 'POST', body: form });
      if (!res.ok) throw new Error('ComfyUI upload failed: ' + res.status);
      return await res.json();
    },

    async queuePrompt(graph) {
      const body = await json('/prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: graph, client_id: clientId })
      });
      const promptId = String(body?.prompt_id || '');
      if (!promptId) throw new Error('ComfyUI did not return a prompt id');
      samplers.set(promptId, Object.keys(graph || {}).filter((id) => graph[id]?.inputs && 'latent_image' in graph[id].inputs));
      log('queued', { promptId });
      return promptId;
    },

    async history(promptId) {
      return await json('/history/' + encodeURIComponent(promptId), { method: 'GET' });
    },

    async queueState() {
      return await json('/queue', { method: 'GET' });
    },

    async interrupt() {
      try { await json('/interrupt', { method: 'POST' }); } catch { /* best effort */ }
    },

    /** Unload every model and release cached memory (VRAM and the RAM copies ComfyUI keeps). */
    async freeMemory() {
      await json('/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
    },

    async cancelPrompt(promptId) {
      const signal = AbortSignal.timeout(5000);
      await json('/queue', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) });
      const queue = await json('/queue', { method: 'GET', signal });
      if (queue.queue_running?.some(row => row?.[1] === promptId)) {
        await json('/interrupt', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt_id: promptId }) });
      }
    },

    async viewFile({ filename, subfolder = '', type = 'output' }) {
      const qs = new URLSearchParams({ filename, subfolder, type });
      const res = await doFetch(base + '/view?' + qs.toString());
      if (!res.ok) throw new Error('ComfyUI view failed: ' + res.status);
      return Buffer.from(await res.arrayBuffer());
    },

    /**
     * Poll a prompt to completion.
     * onProgress receives 0..100: the queue position while waiting, then the sampling nodes' steps
     * from the websocket (15..90, decoding after), or the executed-node count without them.
     */
    async waitForPrompt(promptId, { onProgress, pollMs = 1000, timeoutMs = 30 * 60 * 1000, signal } = {}) {
      const started = Date.now();
      let lastProgress = -1;
      let lastNote = '';
      // While other prompts run first (another task, another program on the same runtime), the note
      // carries how many are ahead and roughly how long (withQueueNote), for the page's queue notice.
      // Runs that came before are timed from the history; a running prompt from when it was first seen.
      const seenRunning = new Map();
      let recentAverage = null;
      let recentAt = 0;
      const averageRun = async () => {
        if (recentAverage !== null && Date.now() - recentAt < 30000) return recentAverage;
        recentAt = Date.now();
        const recent = await json('/history?max_items=12', { method: 'GET', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : undefined }).catch(() => null);
        const runs = Object.values(recent || {}).map((entry) => {
          const messages = Array.isArray(entry?.status?.messages) ? entry.status.messages : [];
          const at = (kind) => Number(messages.find((m) => Array.isArray(m) && m[0] === kind)?.[1]?.timestamp);
          return (at('execution_success') - at('execution_start')) / 1000;
        }).filter((seconds) => seconds > 0 && seconds < 3600);
        recentAverage = runs.length ? runs.reduce((sum, seconds) => sum + seconds, 0) / runs.length : 0;
        return recentAverage;
      };
      const sampling = samplers.get(promptId) || [];
      samplers.delete(promptId);
      const steps = new Map();
      const stopReading = sampling.length ? readComfySocket(base, clientId, (message) => {
        const data = message?.type === 'progress' ? message.data : null;
        if (!data || !(data.max > 0) || (data.prompt_id && data.prompt_id !== promptId) || !sampling.includes(String(data.node))) return;
        steps.set(String(data.node), Math.min(1, Number(data.value) / data.max || 0));
      }) : () => {};
      try {
        for (;;) {
          if (signal?.aborted) throw new Error('cancelled');
          if (Date.now() - started > timeoutMs) throw new Error('ComfyUI prompt timed out');

          const hist = await json('/history/' + encodeURIComponent(promptId), { method: 'GET', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : undefined });
          const entry = hist?.[promptId];
          if (entry) {
            const status = entry.status || {};
            if (status.completed === true || String(status.status_str || '') === 'success') {
              if (onProgress && lastProgress < 100) await onProgress(100, 'finished');
              return entry;
            }
            if (String(status.status_str || '') === 'error') {
              const messages = Array.isArray(status.messages) ? status.messages : [];
              const detail = messages
                .filter((m) => Array.isArray(m) && m[0] === 'execution_error')
                .map((m) => JSON.stringify(m[1]).slice(0, 400))
                .join('; ');
              throw new Error('ComfyUI execution error: ' + (detail || 'unknown'));
            }
          }

          const queue = await json('/queue', { method: 'GET', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : undefined }).catch(() => null);
          if (queue) {
            const running = (queue.queue_running || []).some((item) => item?.[1] === promptId);
            const pendingIndex = (queue.queue_pending || []).findIndex((item) => item?.[1] === promptId);
            let progress = 0;
            let note = 'queued';
            if (running && steps.size) {
              const done = [...steps.values()].reduce((sum, value) => sum + value, 0) / sampling.length;
              progress = 15 + Math.round(done * 75);
              note = done < 1 ? 'sampling' : 'decoding';
            } else if (running) {
              const executed = Object.keys(entry?.outputs || {}).length;
              progress = Math.min(95, 15 + executed * 20);
              note = 'rendering';
            } else if (pendingIndex >= 0) {
              // The node has already reported 12 for "queued in ComfyUI"; the page now shows it.
              progress = 12;
              const mine = Number(queue.queue_pending[pendingIndex]?.[0]);
              const queuedAhead = (queue.queue_pending || []).filter((item) => Number(item?.[0]) < mine).length;
              const now = Date.now();
              const runningElapsed = (queue.queue_running || []).map((item) => {
                if (!seenRunning.has(item?.[1])) seenRunning.set(item?.[1], now);
                return (now - seenRunning.get(item?.[1])) / 1000;
              });
              const eta = estimateQueueWait({ queuedAhead, runningElapsed, averageSeconds: await averageRun(), workers: 1 });
              // whole ten seconds: the page counts down between reports, a new one every second is noise
              note = withQueueNote('waiting in queue', { ahead: queuedAhead + runningElapsed.length, eta: eta === null ? null : Math.ceil(eta / 10) * 10 });
            } else if (!entry) {
              // Neither queued nor in history: ComfyUI dropped it.
              throw new Error('ComfyUI lost the prompt before it produced a result');
            }
            if (onProgress && (progress !== lastProgress || note !== lastNote)) {
              lastProgress = progress;
              lastNote = note;
              await onProgress(progress, note);
            }
          }

          await new Promise((r) => setTimeout(r, pollMs));
        }
      } finally {
        stopReading();
      }
    }
  };
}

/** Collect {filename, subfolder, type} entries from a ComfyUI history entry. */
export function collectOutputs(historyEntry) {
  const outputs = [];
  const nodes = historyEntry?.outputs || {};
  for (const nodeId of Object.keys(nodes)) {
    const node = nodes[nodeId] || {};
    for (const key of ['images', 'gifs', 'videos', 'audio']) {
      for (const item of node[key] || []) {
        // LoadVideo and other reference loaders can expose their INPUT files
        // as UI previews in history. They are not newly generated task outputs.
        if (!item?.filename || String(item.type || '').toLowerCase() === 'input') continue;
        outputs.push({
          filename: String(item.filename),
          subfolder: String(item.subfolder || ''),
          type: String(item.type || 'output'),
          nodeId,
          ...(typeof item.caption === 'string' && item.caption ? { caption: item.caption.slice(0, 2000) } : {})
        });
      }
    }
  }
  return outputs;
}
