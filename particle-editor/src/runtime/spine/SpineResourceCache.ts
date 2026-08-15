import { buildSpineProject } from '../../engine/SpineMiniPlayer';
import { parseOfficialSpine38Resource, supportsOfficialSpine38 } from './OfficialSpine38Runtime';
import { parseOfficialSpineFourResource, supportsOfficialSpineFour } from './OfficialSpineWebGlRuntime';
import type {
  SpineParsedResource,
  SpineResourceCacheStats,
  SpineResourceLease,
  SpineResourceLoader,
  SpineSource
} from './SpineRuntimeTypes';
import {
  DEFAULT_SPINE_RELEASE_DELAY_MS,
  createSpineAbortError,
  getSpineResourceKey,
  isSpineAbortError,
  spineErrorMessage
} from './SpineRuntimeTypes';

type CacheEntry = {
  key: string;
  source: SpineSource;
  refCount: number;
  resource: SpineParsedResource | null;
  promise: Promise<SpineParsedResource> | null;
  controller: AbortController | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  loadedAt: number;
  lastUsedAt: number;
  releaseAt: number;
};

export type SpineResourceCacheOptions = {
  releaseDelayMs?: number;
  loadResource?: SpineResourceLoader;
  disposeResource?: (resource: SpineParsedResource) => void;
};

export type SpineResourceAcquireOptions = {
  signal?: AbortSignal;
  loadResource?: SpineResourceLoader;
};

export class SpineResourceCache {
  private readonly releaseDelayMs: number;
  private readonly defaultLoader: SpineResourceLoader;
  private readonly disposeResource?: (resource: SpineParsedResource) => void;
  private entries = new Map<string, CacheEntry>();
  private stats: Omit<
    SpineResourceCacheStats,
    'entryCount' | 'loadedCount' | 'pendingCount' | 'totalRefCount' | 'scheduledReleaseCount'
  > = {
    hits: 0,
    misses: 0,
    loads: 0,
    releases: 0,
    evictions: 0,
    lastError: null
  };

  constructor(options: SpineResourceCacheOptions = {}) {
    this.releaseDelayMs = Math.max(0, options.releaseDelayMs ?? DEFAULT_SPINE_RELEASE_DELAY_MS);
    this.defaultLoader = options.loadResource || defaultLoadResource;
    this.disposeResource = options.disposeResource;
  }

  async acquire(source: SpineSource, options: SpineResourceAcquireOptions = {}): Promise<SpineResourceLease> {
    const key = getSpineResourceKey(source);
    const signal = options.signal;
    if (signal?.aborted) throw createSpineAbortError('Spine resource acquire aborted');

    const entry = this.getOrCreateEntry(key, source);
    entry.refCount += 1;
    entry.lastUsedAt = nowMs();
    this.cancelRelease(entry);

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.release(key);
    };

    try {
      const resource = await this.waitForResource(entry, source, options.loadResource || this.defaultLoader, signal);
      return {
        key,
        resource,
        release,
        get refCount() {
          return entry.refCount;
        }
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  peek(key: string) {
    return this.entries.get(key)?.resource || null;
  }

  has(key: string) {
    return this.entries.has(key);
  }

  release(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refCount = Math.max(0, entry.refCount - 1);
    entry.lastUsedAt = nowMs();
    this.stats.releases += 1;

    if (entry.refCount > 0) return;
    if (entry.promise && !entry.resource) {
      entry.controller?.abort();
      return;
    }
    this.scheduleRelease(entry);
  }

  evict(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.evictEntry(entry);
  }

  clear() {
    for (const entry of [...this.entries.values()]) {
      this.evictEntry(entry);
    }
  }

  getDebugStats(): SpineResourceCacheStats {
    let loadedCount = 0;
    let pendingCount = 0;
    let totalRefCount = 0;
    let scheduledReleaseCount = 0;

    for (const entry of this.entries.values()) {
      if (entry.resource) loadedCount += 1;
      if (entry.promise && !entry.resource) pendingCount += 1;
      totalRefCount += entry.refCount;
      if (entry.releaseTimer) scheduledReleaseCount += 1;
    }

    return {
      entryCount: this.entries.size,
      loadedCount,
      pendingCount,
      totalRefCount,
      scheduledReleaseCount,
      ...this.stats
    };
  }

  private getOrCreateEntry(key: string, source: SpineSource) {
    const existing = this.entries.get(key);
    if (existing) {
      this.stats.hits += 1;
      existing.source = source;
      return existing;
    }

    this.stats.misses += 1;
    const entry: CacheEntry = {
      key,
      source,
      refCount: 0,
      resource: null,
      promise: null,
      controller: null,
      releaseTimer: null,
      loadedAt: 0,
      lastUsedAt: nowMs(),
      releaseAt: 0
    };
    this.entries.set(key, entry);
    return entry;
  }

  private waitForResource(
    entry: CacheEntry,
    source: SpineSource,
    loader: SpineResourceLoader,
    signal: AbortSignal | undefined
  ) {
    if (entry.resource) return Promise.resolve(entry.resource);
    if (!entry.promise) {
      const controller = new AbortController();
      entry.controller = controller;
      this.stats.loads += 1;
      entry.promise = loader(source, { key: entry.key, signal: controller.signal })
        .then((resource) => {
          entry.resource = resource;
          entry.loadedAt = nowMs();
          entry.promise = null;
          entry.controller = null;
          return resource;
        })
        .catch((error) => {
          entry.promise = null;
          entry.controller = null;
          if (!isSpineAbortError(error)) this.stats.lastError = spineErrorMessage(error);
          if (entry.refCount <= 0) {
            this.cancelRelease(entry);
            this.entries.delete(entry.key);
          }
          throw error;
        });
    }

    return signal ? abortable(entry.promise, signal) : entry.promise;
  }

  private scheduleRelease(entry: CacheEntry) {
    this.cancelRelease(entry);
    if (this.releaseDelayMs === 0) {
      this.evictEntry(entry);
      return;
    }
    entry.releaseAt = nowMs() + this.releaseDelayMs;
    entry.releaseTimer = setTimeout(() => {
      if (entry.refCount > 0) return;
      this.evictEntry(entry);
    }, this.releaseDelayMs);
  }

  private cancelRelease(entry: CacheEntry) {
    if (!entry.releaseTimer) return;
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
    entry.releaseAt = 0;
  }

  private evictEntry(entry: CacheEntry) {
    this.cancelRelease(entry);
    entry.controller?.abort();
    entry.resource?.officialFour?.dispose();
    entry.resource?.official38?.dispose();
    if (entry.resource && this.disposeResource) {
      this.disposeResource(entry.resource);
    }
    this.entries.delete(entry.key);
    this.stats.evictions += 1;
  }
}

async function defaultLoadResource(source: SpineSource, context: { key: string; signal: AbortSignal }) {
  if (context.signal.aborted) throw createSpineAbortError('Spine parse aborted');
  if (supportsOfficialSpineFour(source.jsonText)) {
    const officialFour = await parseOfficialSpineFourResource(source, context.signal);
    return {
      key: context.key,
      project: buildSpineProject(source.jsonText, source.atlasText, source.images),
      officialFour,
      source: {
        fileName: source.fileName,
        atlasFileName: source.atlasFileName,
        imageCount: source.images.length
      },
      parsedAt: nowMs()
    };
  }
  if (supportsOfficialSpine38(source.jsonText)) {
    const official38 = await parseOfficialSpine38Resource(source, context.signal);
    return {
      key: context.key,
      project: buildSpineProject(source.jsonText, source.atlasText, source.images),
      official38,
      source: {
        fileName: source.fileName,
        atlasFileName: source.atlasFileName,
        imageCount: source.images.length
      },
      parsedAt: nowMs()
    };
  }
  // Transitional parser: keep source fidelity and bridge to SpineMiniPlayer until the official Spine WebGL runtime is wired.
  const project = buildSpineProject(source.jsonText, source.atlasText, source.images);
  if (context.signal.aborted) throw createSpineAbortError('Spine parse aborted');
  return {
    key: context.key,
    project,
    source: {
      fileName: source.fileName,
      atlasFileName: source.atlasFileName,
      imageCount: source.images.length
    },
    parsedAt: nowMs()
  };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(createSpineAbortError('Spine resource wait aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(createSpineAbortError('Spine resource wait aborted'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export default SpineResourceCache;
