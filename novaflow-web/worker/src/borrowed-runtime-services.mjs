import { assertLocalOnly } from './comfy/comfy-client.mjs';
import { videoRuntimeUrl } from './runtime-services.mjs';

// Parallel trial assistants observe an existing runtime without owning its lifecycle.
export function createBorrowedRuntimeServices({ imageUrl = 'http://127.0.0.1:8188', videoUrl = '', fetchImpl = globalThis.fetch } = {}) {
  const image = assertLocalOnly(imageUrl);
  const video = assertLocalOnly(videoRuntimeUrl(videoUrl, image));
  const entries = [{ kind: 'image', url: image }];
  if (video !== image) entries.push({ kind: 'video', url: video });
  return {
    async start() {
      return Promise.all(entries.map(async entry => {
        let running = false;
        try { running = (await fetchImpl(entry.url + '/system_stats', { method: 'GET', signal: AbortSignal.timeout(2500) })).ok; } catch {}
        return { ...entry, running, reused: true, borrowOnly: true,
          ...(!running ? { error: '请先通过原启动助手启动现有运行环境' } : {}) };
      }));
    },
    async stop() { /* Another assistant owns the runtime and its loaded models. */ }
  };
}
