import { buildSpineProject } from '../../engine/SpineMiniPlayer';
import type { SpineParseWorkerRequest, SpineParseWorkerResponse } from './SpineRuntimeTypes';
import { SPINE_PARSE_WORKER_VERSION } from './SpineRuntimeTypes';

type SpineParseWorkerScope = {
  onmessage: ((event: MessageEvent<SpineParseWorkerRequest>) => void) | null;
  postMessage: (message: SpineParseWorkerResponse) => void;
};

const workerScope = self as unknown as SpineParseWorkerScope;

workerScope.onmessage = (event: MessageEvent<SpineParseWorkerRequest>) => {
  const request = event.data;
  if (!request || request.type !== 'parse') return;

  try {
    // Transitional parser: buildSpineProject preserves current source behavior while RuntimeLayer stabilizes.
    // TODO(spine-runtime): replace this bridge with the official Spine WebGL runtime for exact 1:1 playback.
    const project = buildSpineProject(request.source.jsonText, request.source.atlasText, request.source.images);
    const response: SpineParseWorkerResponse = {
      id: request.id,
      type: 'parsed',
      version: SPINE_PARSE_WORKER_VERSION,
      resource: {
        key: request.source.key,
        project,
        source: {
          fileName: request.source.fileName,
          atlasFileName: request.source.atlasFileName,
          imageCount: request.source.images.length
        },
        parsedAt: nowMs()
      }
    };
    workerScope.postMessage(response);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const response: SpineParseWorkerResponse = {
      id: request.id,
      type: 'error',
      version: SPINE_PARSE_WORKER_VERSION,
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack
      }
    };
    workerScope.postMessage(response);
  }
};

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
