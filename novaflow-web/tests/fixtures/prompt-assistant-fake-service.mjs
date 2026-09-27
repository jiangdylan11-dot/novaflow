// Stands in for prompt-assistant-service.py: the same ready line on start,
// the same one-JSON-line-per-request protocol, none of the model.
import { createInterface } from 'node:readline';
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
if (process.env.FAKE_PROMPT_ASSISTANT_STARTUP === 'already-running') {
  emit({ type: 'startup-error', ok: false, errorCode: 'prompt-assistant-already-running', error: 'busy elsewhere' });
  process.exit(73);
}
emit({ type: 'ready', status: { runtimeStatus: '模型可用' } });
const answer = (request, data) => emit({ id: request.id, ok: true, data, elapsedSeconds: 0 });
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.command === 'shutdown') process.exit(0);
  if (request.command === 'optimizePrompt') {
    const data = {
      positivePrompt: 'optimized: ' + request.prompt,
      negativePrompt: 'blurry',
      echo: { provider: request.provider, surface: request.surface, purpose: request.purpose, currentPrompt: request.currentPrompt,
        modelPath: process.env.NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH, cachePath: process.env.NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_PATH,
        legacyModelPath: process.env.NOVAFLOW_PROMPT_ASSISTANT_MODEL_PATH ?? null,
        comfyRoot: process.env.NOVAFLOW_COMFY_ROOT, runtimeJson: process.env.NOVAFLOW_RUNTIME_JSON }
    };
    if (request.prompt === 'delay') setTimeout(() => answer(request, data), 400);
    else if (request.prompt === 'fail') emit({ id: request.id, ok: false, error: 'model refused', errorCode: 'generation-blocked', retryable: false });
    else answer(request, data);
    return;
  }
  if (request.command === 'reverseImagePrompt') {
    return answer(request, { prompt: 'a cat on a mat', images: request.images.length, bytes: request.images.reduce((n, image) => n + image.dataUrl.length, 0), purpose: request.purpose });
  }
  if (request.command === 'describeArtStyle') return answer(request, { style: 'flat vector', model: 'fake' });
  emit({ id: request.id, ok: false, error: 'unknown command ' + request.command, errorCode: 'unknown-command' });
});
process.stdin.on('end', () => process.exit(0));
