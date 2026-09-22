import type {
  SpineLoadQueueOptions,
  SpineLoadQueueStats,
  SpineLoadQueueTaskContext,
  SpineLoadRequestOptions,
  SpineSource
} from './SpineRuntimeTypes';
import { createSpineAbortError, isSpineAbortError, spineErrorMessage } from './SpineRuntimeTypes';

type QueueTask<T> = {
  id: number;
  source: SpineSource;
  scope: string;
  controller: AbortController;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  started: boolean;
  settled: boolean;
  cleanupExternalAbort: () => void;
};

export class SpineLoadQueue<T> {
  private readonly loader: SpineLoadQueueOptions<T>['loader'];
  private readonly concurrency: number;
  private pending: QueueTask<T>[] = [];
  private active = new Set<QueueTask<T>>();
  private nextId = 1;
  private disposed = false;
  private stats: Omit<SpineLoadQueueStats, 'activeCount' | 'pendingCount'> = {
    enqueued: 0,
    started: 0,
    completed: 0,
    aborted: 0,
    failed: 0,
    latestOnlyDrops: 0,
    lastError: null
  };

  constructor(options: SpineLoadQueueOptions<T>) {
    this.loader = options.loader;
    this.concurrency = Math.max(1, Math.floor(options.concurrency || 1));
  }

  load(source: SpineSource, options: SpineLoadRequestOptions = {}) {
    if (this.disposed) {
      return Promise.reject(createSpineAbortError('Spine load queue disposed'));
    }

    const scope = options.scope || 'default';
    if (options.latestOnly) {
      this.abortScope(scope, 'Superseded by a newer Spine load', true);
    }

    const controller = new AbortController();
    const externalSignal = options.signal;
    let cleanupExternalAbort = () => {};
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        const onAbort = () => controller.abort();
        externalSignal.addEventListener('abort', onAbort, { once: true });
        cleanupExternalAbort = () => externalSignal.removeEventListener('abort', onAbort);
      }
    }

    const task = {} as QueueTask<T>;
    const promise = new Promise<T>((resolve, reject) => {
      Object.assign(task, {
        id: this.nextId++,
        source,
        scope,
        controller,
        resolve,
        reject,
        started: false,
        settled: false,
        cleanupExternalAbort
      });
    });

    this.stats.enqueued += 1;
    this.pending.push(task);
    this.pump();
    return promise;
  }

  cancel(scope?: string) {
    if (scope) {
      this.abortScope(scope, 'Spine load cancelled', false);
      return;
    }
    this.cancelAll();
  }

  cancelAll(reason = 'Spine load queue cancelled') {
    for (const task of [...this.pending, ...this.active]) {
      this.abortTask(task, reason, false);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll('Spine load queue disposed');
  }

  getDebugStats(): SpineLoadQueueStats {
    return {
      activeCount: this.active.size,
      pendingCount: this.pending.length,
      ...this.stats
    };
  }

  private pump() {
    if (this.disposed) return;
    while (this.active.size < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift();
      if (!task || task.settled) continue;
      if (task.controller.signal.aborted) {
        this.abortTask(task, 'Spine load aborted before start', false);
        continue;
      }
      this.runTask(task);
    }
  }

  private async runTask(task: QueueTask<T>) {
    task.started = true;
    this.active.add(task);
    this.stats.started += 1;

    const context: SpineLoadQueueTaskContext = {
      id: task.id,
      scope: task.scope,
      signal: task.controller.signal
    };

    try {
      const value = await this.loader(task.source, context);
      if (task.controller.signal.aborted) {
        throw createSpineAbortError('Spine load aborted after completion');
      }
      this.resolveTask(task, value);
      this.stats.completed += 1;
    } catch (error) {
      if (isSpineAbortError(error) || task.controller.signal.aborted) {
        this.rejectTask(task, createSpineAbortError(spineErrorMessage(error)));
        this.stats.aborted += 1;
      } else {
        this.stats.failed += 1;
        this.stats.lastError = spineErrorMessage(error);
        this.rejectTask(task, error);
      }
    } finally {
      this.active.delete(task);
      task.cleanupExternalAbort();
      this.pump();
    }
  }

  private abortScope(scope: string, reason: string, latestOnly: boolean) {
    for (const task of [...this.pending, ...this.active]) {
      if (task.scope === scope) {
        this.abortTask(task, reason, latestOnly);
      }
    }
  }

  private abortTask(task: QueueTask<T>, reason: string, latestOnly: boolean) {
    if (task.settled) return;
    if (latestOnly) this.stats.latestOnlyDrops += 1;
    task.controller.abort();
    if (!task.started) {
      this.pending = this.pending.filter((item) => item !== task);
      this.stats.aborted += 1;
      this.rejectTask(task, createSpineAbortError(reason));
      task.cleanupExternalAbort();
    }
  }

  private resolveTask(task: QueueTask<T>, value: T) {
    if (task.settled) return;
    task.settled = true;
    task.resolve(value);
  }

  private rejectTask(task: QueueTask<T>, error: unknown) {
    if (task.settled) return;
    task.settled = true;
    task.reject(error);
  }
}

export default SpineLoadQueue;
