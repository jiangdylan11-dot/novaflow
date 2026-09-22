import type { SpineProject } from '../../engine/SpineMiniPlayer';

export const DEFAULT_SPINE_RELEASE_DELAY_MS = 60_000;
export const SPINE_PARSE_WORKER_VERSION = 1;

export type SpineImageAsset = {
  fileName: string;
  dataUrl: string;
};

export type SpineSource = {
  key?: string;
  jsonText: string;
  atlasText: string;
  images: SpineImageAsset[];
  fileName?: string;
  atlasFileName?: string;
  project?: SpineProject | null;
};

export type SpineParsedResource = {
  key: string;
  project: SpineProject;
  officialFour?: import('./OfficialSpineWebGlRuntime').OfficialSpineFourResource;
  official38?: import('./OfficialSpine38Runtime').OfficialSpine38Resource;
  source: {
    fileName?: string;
    atlasFileName?: string;
    imageCount: number;
  };
  parsedAt: number;
};

export type SpineResourceLoaderContext = {
  key: string;
  signal: AbortSignal;
};

export type SpineResourceLoader = (
  source: SpineSource,
  context: SpineResourceLoaderContext
) => Promise<SpineParsedResource>;

export type SpineResourceLease = {
  key: string;
  resource: SpineParsedResource;
  release: () => void;
  readonly refCount: number;
};

export type SpineResourceCacheStats = {
  entryCount: number;
  loadedCount: number;
  pendingCount: number;
  totalRefCount: number;
  scheduledReleaseCount: number;
  hits: number;
  misses: number;
  loads: number;
  releases: number;
  evictions: number;
  lastError: string | null;
};

export type SpineLoadQueueStats = {
  activeCount: number;
  pendingCount: number;
  enqueued: number;
  started: number;
  completed: number;
  aborted: number;
  failed: number;
  latestOnlyDrops: number;
  lastError: string | null;
};

export type SpineLoadQueueOptions<T> = {
  concurrency?: number;
  loader: (source: SpineSource, context: SpineLoadQueueTaskContext) => Promise<T>;
};

export type SpineLoadQueueTaskContext = {
  id: number;
  scope: string;
  signal: AbortSignal;
};

export type SpineLoadRequestOptions = {
  latestOnly?: boolean;
  scope?: string;
  signal?: AbortSignal;
};

export type SpineMiniPlayerInstance = {
  setAnimation?: (name: string, loop?: boolean) => void;
  setSkin?: (name: string | null) => void;
  setProject?: (project: SpineProject | null) => void;
  setPlaying?: (playing: boolean) => void;
  setHud?: (enabled: boolean) => void;
  setDebugOverlays?: (overlays: { bones?: boolean; mesh?: boolean }) => void;
  setSelectedBoneName?: (name: string | null) => void;
  setSelectedBoneNames?: (names: string[] | null) => void;
  setVisibleBoneNames?: (names: string[] | null) => void;
  setLoop?: (loop: boolean) => void;
  setMix?: (from: string, to: string, duration: number) => void;
  setTimeScale?: (timeScale: number) => void;
  pickBoneAt?: (screenX: number, screenY: number) => string | null;
  update?: (dtSec: number) => void;
  seek?: (timeSec: number) => void;
  getTimeSec?: () => number;
  getDurationSec?: () => number;
  renderAt?: (timeSec: number, opts?: { clear?: boolean }) => void;
  start?: () => void;
  stop?: () => void;
  dispose?: () => void;
};

export type SpineMiniPlayerCtor = new (
  ctx: CanvasRenderingContext2D,
  project: SpineProject,
  animationName: string
) => SpineMiniPlayerInstance;

export type SpineRuntimeLayerOptions = {
  canvas?: HTMLCanvasElement | null;
  context?: CanvasRenderingContext2D | null;
  cache?: import('./SpineResourceCache').SpineResourceCache;
  queue?: import('./SpineLoadQueue').SpineLoadQueue<SpineResourceLease>;
  playerCtor?: SpineMiniPlayerCtor;
  defaultAnimation?: string;
  hud?: boolean;
  active?: boolean;
  visible?: boolean;
  loop?: boolean;
  timeScale?: number;
  useWorker?: boolean;
  latestOnly?: boolean;
  exclusiveActive?: boolean;
  layerId?: string;
};

export type SpineRuntimeLayerLoadOptions = SpineLoadRequestOptions & {
  source?: SpineSource;
  animationName?: string;
  skinName?: string | null;
  keepCurrentFrame?: boolean;
};

export type SpineRuntimeLayerLoadProjectOptions = {
  key?: string;
  animationName?: string;
  skinName?: string | null;
  keepCurrentFrame?: boolean;
};

export type SpineRuntimeLayerState = {
  layerId: string;
  active: boolean;
  visible: boolean;
  playing: boolean;
  loaded: boolean;
  loading: boolean;
  disposed: boolean;
  tickSuspended: boolean;
  interactionDepth: number;
  animationName: string | null;
  skinName: string | null;
  timeSec: number;
  durationSec: number;
  resourceKey: string | null;
  runtimeKind: string;
  estimatedTextureBytes: number;
};

export type SpineRuntimeDebugStats = SpineRuntimeLayerState & {
  frameCount: number;
  tickCount: number;
  renderCount: number;
  skippedFrameCount: number;
  directParseCount: number;
  workerParseCount: number;
  lastFrameMs: number;
  lastRenderMs: number;
  averageFrameMs: number;
  averageRenderMs: number;
  lastError: string | null;
  cache: SpineResourceCacheStats;
  queue: SpineLoadQueueStats;
};

export type SpineParseWorkerRequest = {
  id: number;
  type: 'parse';
  version: number;
  source: SpineSource & { key: string };
};

export type SpineParseWorkerResponse =
  | {
      id: number;
      type: 'parsed';
      version: number;
      resource: SpineParsedResource;
    }
  | {
      id: number;
      type: 'error';
      version: number;
      error: {
        name: string;
        message: string;
        stack?: string;
      };
    };

export function createSpineAbortError(message = 'Spine load aborted') {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function isSpineAbortError(error: unknown) {
  return !!error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError';
}

export function spineErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? 'Unknown Spine runtime error');
}

export function getSpineResourceKey(source: SpineSource) {
  const explicit = String(source.key || '').trim();
  if (explicit) return explicit;

  const imageSignature = (source.images || [])
    .map((image) => `${image.fileName}:${hashString(image.dataUrl || '')}`)
    .join('|');
  return `spine:${hashString(source.jsonText || '')}:${hashString(source.atlasText || '')}:${hashString(imageSignature)}`;
}

export function firstAnimationName(project: SpineProject | null | undefined) {
  return Object.keys(project?.animations || {})[0] || 'animation';
}

function hashString(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
