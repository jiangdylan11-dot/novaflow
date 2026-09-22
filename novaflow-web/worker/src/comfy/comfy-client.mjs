// ComfyUI client. Talks to 127.0.0.1 ONLY (spec 9).
//
// The worker owns the workflow graphs; the browser never sees one and never
// supplies one. A task arrives as {task_type, parameters}, the runner picks
// workflows/<task_type>.json, injects the parameters into named placeholder
// slots, and submits.

const LOCALHOST_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

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
  const base = assertLocalOnly(baseUrl);
  const doFetch = fetchImpl || globalThis.fetch;
  const log = logger || (() => {});
  const clientId = 'novaflow-worker-' + Math.random().toString(36).slice(2, 10);

  async function json(path, init) {
    const res = await doFetch(base + path, init);
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
    baseUrl: base,

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

    async viewFile({ filename, subfolder = '', type = 'output' }) {
      const qs = new URLSearchParams({ filename, subfolder, type });
      const res = await doFetch(base + '/view?' + qs.toString());
      if (!res.ok) throw new Error('ComfyUI view failed: ' + res.status);
      return Buffer.from(await res.arrayBuffer());
    },

    /**
     * Poll a prompt to completion.
     * onProgress receives 0..100 estimated from the queue position and the
     * executed-node count, which is the honest signal ComfyUI's HTTP API
     * offers without a websocket.
     */
    async waitForPrompt(promptId, { onProgress, pollMs = 1000, timeoutMs = 30 * 60 * 1000, signal } = {}) {
      const started = Date.now();
      let lastProgress = -1;
      for (;;) {
        if (signal?.aborted) throw new Error('cancelled');
        if (Date.now() - started > timeoutMs) throw new Error('ComfyUI prompt timed out');

        const hist = await this.history(promptId);
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

        const queue = await this.queueState().catch(() => null);
        if (queue) {
          const running = (queue.queue_running || []).some((item) => item?.[1] === promptId);
          const pendingIndex = (queue.queue_pending || []).findIndex((item) => item?.[1] === promptId);
          let progress = 0;
          let note = 'queued';
          if (running) {
            const executed = Object.keys(entry?.outputs || {}).length;
            progress = Math.min(95, 15 + executed * 20);
            note = 'rendering';
          } else if (pendingIndex >= 0) {
            progress = 5;
            note = 'waiting in queue (' + (pendingIndex + 1) + ')';
          } else if (!entry) {
            // Neither queued nor in history: ComfyUI dropped it.
            throw new Error('ComfyUI lost the prompt before it produced a result');
          }
          if (onProgress && progress !== lastProgress) {
            lastProgress = progress;
            await onProgress(progress, note);
          }
        }

        await new Promise((r) => setTimeout(r, pollMs));
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
    for (const key of ['images', 'gifs', 'videos']) {
      for (const item of node[key] || []) {
        if (!item?.filename) continue;
        outputs.push({
          filename: String(item.filename),
          subfolder: String(item.subfolder || ''),
          type: String(item.type || 'output'),
          nodeId
        });
      }
    }
  }
  return outputs;
}
