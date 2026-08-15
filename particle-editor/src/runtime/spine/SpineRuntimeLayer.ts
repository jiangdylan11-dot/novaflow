import { buildSpineProject, SpineMiniPlayer } from '../../engine/SpineMiniPlayer';
import {
  OfficialSpine38Player,
  parseOfficialSpine38Resource,
  supportsOfficialSpine38
} from './OfficialSpine38Runtime';
import {
  OfficialSpineFourPlayer,
  parseOfficialSpineFourResource,
  supportsOfficialSpineFour
} from './OfficialSpineWebGlRuntime';
import { SpineLoadQueue } from './SpineLoadQueue';
import { SpineResourceCache } from './SpineResourceCache';
import type {
  SpineMiniPlayerCtor,
  SpineMiniPlayerInstance,
  SpineParseWorkerRequest,
  SpineParseWorkerResponse,
  SpineParsedResource,
  SpineResourceLease,
  SpineResourceLoader,
  SpineRuntimeDebugStats,
  SpineRuntimeLayerLoadOptions,
  SpineRuntimeLayerLoadProjectOptions,
  SpineRuntimeLayerOptions,
  SpineRuntimeLayerState,
  SpineSource
} from './SpineRuntimeTypes';
import {
  SPINE_PARSE_WORKER_VERSION,
  createSpineAbortError,
  firstAnimationName,
  getSpineResourceKey,
  spineErrorMessage
} from './SpineRuntimeTypes';

type FrameRequest = number;

let layerIdSeed = 1;
let workerRequestId = 1;

export class SpineRuntimeLayer {
  private static readonly instances = new Set<SpineRuntimeLayer>();
  private static activeLayer: SpineRuntimeLayer | null = null;

  readonly layerId: string;

  private canvas: HTMLCanvasElement | null;
  private mountedCanvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null;
  private readonly cache: SpineResourceCache;
  private readonly queue: SpineLoadQueue<SpineResourceLease>;
  private readonly ownsCache: boolean;
  private readonly ownsQueue: boolean;
  private readonly playerCtor: SpineMiniPlayerCtor;
  private readonly useWorker: boolean;
  private readonly latestOnly: boolean;
  private readonly exclusiveActive: boolean;

  private player: SpineMiniPlayerInstance | null = null;
  private lease: SpineResourceLease | null = null;
  private raf: FrameRequest | null = null;
  private active = true;
  private visible = true;
  private playing = true;
  private loop = true;
  private disposed = false;
  private loading = false;
  private hud = true;
  private debugOverlays: { bones?: boolean; mesh?: boolean } = {};
  private selectedBoneNames: string[] = [];
  private visibleBoneNames: string[] | null = null;
  private timeScale = 1;
  private timeSec = 0;
  private durationSec = 0;
  private animationName: string | null = null;
  private skinName: string | null = null;
  private tickSuspendDepth = 0;
  private interactionDepth = 0;
  private interactionSettling = false;
  private interactionResumeTimer: ReturnType<typeof setTimeout> | null = null;
  private loadGeneration = 0;
  private lastNow = 0;
  private frameCount = 0;
  private tickCount = 0;
  private renderCount = 0;
  private skippedFrameCount = 0;
  private directParseCount = 0;
  private workerParseCount = 0;
  private lastFrameMs = 0;
  private lastRenderMs = 0;
  private averageFrameMs = 0;
  private averageRenderMs = 0;
  private lastError: string | null = null;

  constructor(options: SpineRuntimeLayerOptions = {}) {
    this.layerId = options.layerId || `spine-layer-${layerIdSeed++}`;
    this.canvas = options.canvas || null;
    this.ctx = options.context || null;
    this.cache = options.cache || new SpineResourceCache({ loadResource: this.loadResource });
    this.ownsCache = !options.cache;
    this.playerCtor = options.playerCtor || SpineMiniPlayer;
    this.useWorker = options.useWorker !== false;
    this.latestOnly = options.latestOnly !== false;
    this.exclusiveActive = options.exclusiveActive !== false;
    this.queue =
      options.queue ||
      new SpineLoadQueue<SpineResourceLease>({
        concurrency: 1,
        loader: (source, context) => {
          return this.cache.acquire(source, {
            signal: context.signal,
            loadResource: this.loadResource
          });
        }
      });
    this.ownsQueue = !options.queue;
    this.animationName = options.defaultAnimation || null;
    this.hud = options.hud !== false;
    this.active = options.active !== false;
    this.visible = options.visible !== false;
    this.loop = options.loop !== false;
    this.timeScale = Number.isFinite(options.timeScale || 1) ? Number(options.timeScale || 1) : 1;

    if (!this.ctx && this.canvas) this.ctx = this.canvas.getContext('2d');
    SpineRuntimeLayer.instances.add(this);
    this.syncRaf();
  }

  mount(container: HTMLElement) {
    if (this.disposed) return;
    this.unmount();
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);
    this.mountedCanvas = canvas;
    this.attachCanvas(canvas);
    this.resize();
  }

  unmount() {
    const canvas = this.mountedCanvas;
    this.detach();
    if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
    this.mountedCanvas = null;
  }

  attach(canvas: HTMLCanvasElement | CanvasRenderingContext2D | null) {
    if (this.disposed) return;
    if (isCanvasContext(canvas)) {
      this.ctx = canvas;
      this.canvas = canvas.canvas;
    } else {
      this.canvas = canvas;
      this.ctx = canvas ? canvas.getContext('2d') : null;
    }
    if (this.lease) this.installPlayer(this.lease.resource);
    this.renderNow();
    this.syncRaf();
  }

  attachCanvas(canvas: HTMLCanvasElement | null) {
    this.attach(canvas);
  }

  detach() {
    this.stopRaf();
    this.stopPlayer();
    this.canvas = null;
    this.ctx = null;
  }

  async load(source: SpineSource, options: SpineRuntimeLayerLoadOptions = {}) {
    return this.loadSource(source, options);
  }

  async loadAsset(assetId: string, options: SpineRuntimeLayerLoadOptions = {}) {
    const source = options.source;
    if (!source) throw new Error(`Missing Spine source for asset ${assetId}`);
    return this.loadSource({ ...source, key: source.key || assetId }, options);
  }

  async loadSource(source: SpineSource, options: SpineRuntimeLayerLoadOptions = {}) {
    if (this.disposed) throw createSpineAbortError('Spine runtime layer disposed');
    const generation = ++this.loadGeneration;
    this.loading = true;
    this.lastError = null;

    try {
      const lease = await this.queue.load(source, {
        latestOnly: options.latestOnly ?? this.latestOnly,
        scope: options.scope || this.layerId,
        signal: options.signal
      });

      if (generation !== this.loadGeneration || this.disposed) {
        lease.release();
        throw createSpineAbortError('Spine load result superseded');
      }

      this.installLease(lease, options);
      return lease.resource;
    } catch (error) {
      this.lastError = spineErrorMessage(error);
      throw error;
    } finally {
      if (generation === this.loadGeneration) this.loading = false;
    }
  }

  loadProject(project: SpineParsedResource['project'], options: SpineRuntimeLayerLoadProjectOptions = {}) {
    if (this.disposed) throw createSpineAbortError('Spine runtime layer disposed');
    this.cancelLoad();
    const key = options.key || `${this.layerId}:project:${Date.now()}`;
    const resource: SpineParsedResource = {
      key,
      project,
      source: { imageCount: Object.keys(project.images || {}).length },
      parsedAt: nowMs()
    };
    const lease: SpineResourceLease = {
      key,
      resource,
      release: () => undefined,
      get refCount() {
        return 1;
      }
    };
    this.installLease(lease, options);
    return resource;
  }

  async preload(source: SpineSource, options: SpineRuntimeLayerLoadOptions = {}) {
    const lease = await this.queue.load(source, {
      latestOnly: options.latestOnly ?? false,
      scope: options.scope || `${this.layerId}:preload`,
      signal: options.signal
    });
    const resource = lease.resource;
    lease.release();
    return resource;
  }

  cancelLoad() {
    this.loadGeneration += 1;
    this.loading = false;
    this.queue.cancel(this.layerId);
  }

  unload(_assetId?: string) {
    this.cancelLoad();
    this.stopPlayer();
    if (this.lease) {
      this.lease.release();
      this.lease = null;
    }
    this.timeSec = 0;
    this.durationSec = 0;
    this.renderNow();
    this.syncRaf();
  }

  setActive(active: boolean) {
    this.setActiveLocal(!!active, true);
  }

  private setActiveLocal(active: boolean, updateRegistry: boolean) {
    if (active && updateRegistry && this.exclusiveActive) {
      const previous = SpineRuntimeLayer.activeLayer;
      if (previous && previous !== this && previous.exclusiveActive) {
        previous.setActiveLocal(false, false);
      }
      SpineRuntimeLayer.activeLayer = this;
    } else if (!active && SpineRuntimeLayer.activeLayer === this) {
      SpineRuntimeLayer.activeLayer = null;
    }

    this.active = active;
    this.syncRaf();
  }

  activate() {
    this.setActive(true);
  }

  deactivate() {
    this.setActive(false);
  }

  setVisible(visible: boolean) {
    this.visible = !!visible;
    if (this.visible) this.renderNow();
    this.syncRaf();
  }

  show() {
    this.setVisible(true);
  }

  hide() {
    this.setVisible(false);
  }

  beginInteraction() {
    this.clearInteractionResumeTimer();
    this.interactionSettling = false;
    this.interactionDepth += 1;
    this.syncRaf();
  }

  endInteraction(delayMs = 200) {
    this.interactionDepth = Math.max(0, this.interactionDepth - 1);
    this.clearInteractionResumeTimer();

    if (this.interactionDepth === 0 && delayMs > 0) {
      this.interactionSettling = true;
      this.interactionResumeTimer = setTimeout(() => {
        this.interactionResumeTimer = null;
        this.interactionSettling = false;
        this.lastNow = nowMs();
        this.syncRaf();
      }, Math.max(0, delayMs));
    } else {
      this.interactionSettling = false;
      this.lastNow = nowMs();
      this.syncRaf();
    }
  }

  suspendTick() {
    this.tickSuspendDepth += 1;
    this.syncRaf();
  }

  resumeTick() {
    this.tickSuspendDepth = Math.max(0, this.tickSuspendDepth - 1);
    this.lastNow = nowMs();
    this.syncRaf();
  }

  suspendAnimationTick() {
    this.suspendTick();
  }

  resumeAnimationTick() {
    this.resumeTick();
  }

  suspend() {
    this.suspendTick();
  }

  resume() {
    this.resumeTick();
    this.setPlaying(true);
  }

  play(animationName?: string, loop = true) {
    if (animationName) this.setAnimation(animationName, true);
    this.setLoop(loop);
    this.setPlaying(true);
  }

  pause() {
    this.setPlaying(false);
  }

  stop() {
    this.setPlaying(false);
    this.seek(0);
  }

  setPlaying(playing: boolean) {
    this.playing = !!playing;
    this.player?.setPlaying?.(false);
    this.lastNow = nowMs();
    this.syncRaf();
  }

  setAnimation(name: string, resetTime = true) {
    const next = String(name || '').trim();
    if (!next) return;
    this.animationName = next;
    this.player?.setAnimation?.(next, this.loop);
    this.durationSec = this.readDuration();
    if (resetTime) this.timeSec = 0;
    this.renderNow();
  }

  setSkin(name: string | null) {
    const next = String(name || '').trim();
    this.skinName = next ? next : null;
    this.player?.setSkin?.(this.skinName);
    this.renderNow();
  }

  setProject(project: SpineParsedResource['project'] | null) {
    this.player?.setProject?.(project);
    this.durationSec = this.readDuration();
    this.renderNow();
  }

  setHud(enabled: boolean) {
    this.hud = !!enabled;
    this.player?.setHud?.(this.hud);
    this.renderNow();
  }

  setDebugOverlays(overlays: { bones?: boolean; mesh?: boolean } = {}) {
    this.debugOverlays = overlays || {};
    this.player?.setDebugOverlays?.(this.debugOverlays);
    this.renderNow();
  }

  setSelectedBoneName(name: string | null) {
    const next = String(name || '').trim();
    this.setSelectedBoneNames(next ? [next] : []);
  }

  setSelectedBoneNames(names: string[] | null) {
    this.selectedBoneNames = Array.isArray(names)
      ? names.map((name) => String(name || '').trim()).filter(Boolean)
      : [];
    this.player?.setSelectedBoneNames?.(this.selectedBoneNames);
    this.renderNow();
  }

  setVisibleBoneNames(names: string[] | null) {
    this.visibleBoneNames = Array.isArray(names)
      ? names.map((name) => String(name || '').trim()).filter(Boolean)
      : null;
    this.player?.setVisibleBoneNames?.(this.visibleBoneNames);
    this.renderNow();
  }

  pickBoneAt(screenX: number, screenY: number) {
    return this.player?.pickBoneAt?.(screenX, screenY) || null;
  }

  setLoop(loop: boolean) {
    this.loop = !!loop;
    this.player?.setLoop?.(this.loop);
  }

  setMix(from: string, to: string, duration: number) {
    this.player?.setMix?.(from, to, duration);
  }

  setTimeScale(timeScale: number) {
    this.timeScale = Number.isFinite(timeScale) ? timeScale : 1;
    this.player?.setTimeScale?.(this.timeScale);
  }

  seek(timeSec: number) {
    this.timeSec = normalizeTime(timeSec, this.durationSec, this.loop);
    if (this.player?.seek) {
      this.player.seek(this.timeSec);
      return;
    }
    this.renderNow();
  }

  setTime(timeSec: number) {
    this.seek(timeSec);
  }

  renderAt(timeSec: number) {
    this.timeSec = normalizeTime(timeSec, this.durationSec, this.loop);
    this.renderNow();
  }

  renderNow() {
    if (!this.visible || !this.player?.renderAt) {
      this.skippedFrameCount += 1;
      return;
    }
    const start = nowMs();
    this.player.renderAt(this.timeSec, { clear: true });
    const elapsed = nowMs() - start;
    this.lastRenderMs = elapsed;
    this.averageRenderMs = smoothAverage(this.averageRenderMs, elapsed, this.renderCount);
    this.renderCount += 1;
  }

  resize(width?: number, height?: number) {
    if (!this.canvas) return;
    if (typeof width === 'number' && typeof height === 'number') {
      const nextWidth = Math.max(1, Math.floor(width));
      const nextHeight = Math.max(1, Math.floor(height));
      if (this.canvas.width !== nextWidth) this.canvas.width = nextWidth;
      if (this.canvas.height !== nextHeight) this.canvas.height = nextHeight;
    } else {
      const rect = this.canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.floor(rect.width));
      const nextHeight = Math.max(1, Math.floor(rect.height));
      if (this.canvas.width !== nextWidth) this.canvas.width = nextWidth;
      if (this.canvas.height !== nextHeight) this.canvas.height = nextHeight;
    }
    this.renderNow();
  }

  getProject() {
    return this.lease?.resource.project || null;
  }

  getResourceKey() {
    return this.lease?.key || null;
  }

  getTimeSec() {
    return this.timeSec;
  }

  getDurationSec() {
    return this.durationSec;
  }

  isLoaded() {
    return !!this.lease?.resource;
  }

  isLoading() {
    return this.loading;
  }

  getState(): SpineRuntimeLayerState {
    return {
      layerId: this.layerId,
      active: this.active,
      visible: this.visible,
      playing: this.playing,
      loaded: this.isLoaded(),
      loading: this.loading,
      disposed: this.disposed,
      tickSuspended: this.isTickSuspended(),
      interactionDepth: this.interactionDepth,
      animationName: this.animationName,
      skinName: this.skinName,
      timeSec: this.timeSec,
      durationSec: this.durationSec,
      resourceKey: this.getResourceKey(),
      runtimeKind: this.getRuntimeKind(),
      estimatedTextureBytes: this.getEstimatedTextureBytes()
    };
  }

  getDebugStats(): SpineRuntimeDebugStats {
    return {
      ...this.getState(),
      frameCount: this.frameCount,
      tickCount: this.tickCount,
      renderCount: this.renderCount,
      skippedFrameCount: this.skippedFrameCount,
      directParseCount: this.directParseCount,
      workerParseCount: this.workerParseCount,
      lastFrameMs: this.lastFrameMs,
      lastRenderMs: this.lastRenderMs,
      averageFrameMs: this.averageFrameMs,
      averageRenderMs: this.averageRenderMs,
      lastError: this.lastError,
      cache: this.cache.getDebugStats(),
      queue: this.queue.getDebugStats()
    };
  }

  getStats() {
    return this.getDebugStats();
  }

  private getRuntimeKind() {
    const resource = this.lease?.resource;
    if (resource?.officialFour) return resource.officialFour.kind;
    if (resource?.official38) return resource.official38.kind;
    if (resource) return 'spine-mini-player-bridge';
    return 'none';
  }

  private getEstimatedTextureBytes() {
    const resource = this.lease?.resource;
    if (resource?.officialFour) return resource.officialFour.textureBytes;
    if (resource?.official38) return resource.official38.textureBytes;
    return 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelLoad();
    this.stopRaf();
    this.clearInteractionResumeTimer();
    this.stopPlayer();
    if (this.lease) {
      this.lease.release();
      this.lease = null;
    }
    if (this.ownsQueue) this.queue.dispose();
    if (this.ownsCache) this.cache.clear();
    SpineRuntimeLayer.instances.delete(this);
    if (SpineRuntimeLayer.activeLayer === this) SpineRuntimeLayer.activeLayer = null;
  }

  destroy() {
    this.dispose();
  }

  private installLease(lease: SpineResourceLease, options: SpineRuntimeLayerLoadOptions) {
    const previousLease = this.lease;
    this.lease = lease;

    const resource = lease.resource;
    const nextAnimation = options.animationName || this.animationName || firstAnimationName(resource.project);
    this.animationName = nextAnimation;
    if ('skinName' in options) this.skinName = options.skinName ? String(options.skinName) : null;
    if (!options.keepCurrentFrame) this.timeSec = 0;

    this.installPlayer(resource);
    previousLease?.release();
    this.renderNow();
    this.syncRaf();
  }

  private installPlayer(resource: SpineParsedResource) {
    if (!this.ctx || !this.canvas) return;
    this.stopPlayer();
    const animationName = this.animationName || firstAnimationName(resource.project);
    if (resource.officialFour) {
      this.player = new OfficialSpineFourPlayer(this.canvas, resource.officialFour, animationName, {
        loop: this.loop,
        skinName: this.skinName,
        timeScale: this.timeScale
      });
    } else if (resource.official38) {
      this.player = new OfficialSpine38Player(this.canvas, resource.official38, animationName, {
        loop: this.loop,
        skinName: this.skinName,
        timeScale: this.timeScale
      });
    } else {
      this.player = new this.playerCtor(this.ctx, resource.project, animationName);
    }
    this.player.setPlaying?.(false);
    this.player.setHud?.(this.hud);
    this.player.setDebugOverlays?.(this.debugOverlays);
    this.player.setSelectedBoneNames?.(this.selectedBoneNames);
    this.player.setVisibleBoneNames?.(this.visibleBoneNames);
    this.player.setSkin?.(this.skinName);
    this.player.setLoop?.(this.loop);
    this.player.setTimeScale?.(this.timeScale);
    this.durationSec = this.readDuration();
  }

  private stopPlayer() {
    this.player?.setPlaying?.(false);
    this.player?.stop?.();
    this.player?.dispose?.();
    this.player = null;
  }

  private readonly onFrame = (timestamp: number) => {
    this.raf = null;
    if (!this.shouldRunTick()) return;

    const now = timestamp || nowMs();
    const previousNow = this.lastNow || now;
    const frameMs = Math.max(0, Math.min(250, now - previousNow));
    this.lastNow = now;
    this.lastFrameMs = frameMs;
    this.averageFrameMs = smoothAverage(this.averageFrameMs, frameMs, this.frameCount);
    this.frameCount += 1;

    if (this.playing && this.player) {
      const dtSec = (frameMs / 1000) * this.timeScale;
      this.tick(dtSec);
    } else {
      this.renderNow();
    }

    this.syncRaf();
  };

  private tick(dtSec: number) {
    this.tickCount += 1;
    if (this.player?.update) {
      this.player.update(dtSec);
      const playerTime = this.player.getTimeSec?.();
      this.timeSec = typeof playerTime === 'number' && Number.isFinite(playerTime)
        ? playerTime
        : normalizeTime(this.timeSec + dtSec, this.durationSec, this.loop);
      this.renderCount += 1;
      return;
    }
    this.timeSec = normalizeTime(this.timeSec + dtSec, this.durationSec, this.loop);
    this.renderNow();
  }

  private syncRaf() {
    if (this.shouldRunTick()) {
      if (this.raf == null) {
        this.lastNow = nowMs();
        this.raf = requestFrame(this.onFrame);
      }
      return;
    }
    this.stopRaf();
  }

  private stopRaf() {
    if (this.raf == null) return;
    cancelFrame(this.raf);
    this.raf = null;
  }

  private shouldRunTick() {
    return !this.disposed && this.active && this.visible && this.playing && !this.isTickSuspended() && !!this.player;
  }

  private isTickSuspended() {
    return this.tickSuspendDepth > 0 || this.interactionDepth > 0 || this.interactionSettling;
  }

  private clearInteractionResumeTimer() {
    if (!this.interactionResumeTimer) return;
    clearTimeout(this.interactionResumeTimer);
    this.interactionResumeTimer = null;
  }

  private readDuration() {
    const duration = this.player?.getDurationSec?.();
    return typeof duration === 'number' && Number.isFinite(duration) ? Math.max(0, duration) : 0;
  }

  private readonly loadResource: SpineResourceLoader = async (source, context) => {
    const key = context.key || getSpineResourceKey(source);
    if (supportsOfficialSpineFour(source.jsonText)) {
      const officialFour = await parseOfficialSpineFourResource({ ...source, key }, context.signal);
      const project = await this.resolveBridgeProject(source, key, context.signal);
      return {
        key,
        project,
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
      const official38 = await parseOfficialSpine38Resource({ ...source, key }, context.signal);
      const project = await this.resolveBridgeProject(source, key, context.signal);
      return {
        key,
        project,
        official38,
        source: {
          fileName: source.fileName,
          atlasFileName: source.atlasFileName,
          imageCount: source.images.length
        },
        parsedAt: nowMs()
      };
    }

    if (source.project) {
      if (context.signal.aborted) throw createSpineAbortError('Spine parse aborted');
      return {
        key,
        project: source.project,
        source: {
          fileName: source.fileName,
          atlasFileName: source.atlasFileName,
          imageCount: source.images.length
        },
        parsedAt: nowMs()
      };
    }

    if (this.useWorker && canUseWorker()) {
      try {
        this.workerParseCount += 1;
        return await parseWithWorker(stripParsedProjectFromSource({ ...source, key }), context.signal);
      } catch (error) {
        if (context.signal.aborted) throw error;
        this.workerParseCount = Math.max(0, this.workerParseCount - 1);
      }
    }

    if (context.signal.aborted) throw createSpineAbortError('Spine parse aborted');
    this.directParseCount += 1;
    // Transitional parser: bridge to SpineMiniPlayer data until official Spine WebGL runtime lands.
    // TODO(spine-runtime): swap this for official Spine WebGL parsing/rendering to reach exact 1:1 playback.
    const project = buildSpineProject(source.jsonText, source.atlasText, source.images);
    if (context.signal.aborted) throw createSpineAbortError('Spine parse aborted');
    return {
      key,
      project,
      source: {
        fileName: source.fileName,
        atlasFileName: source.atlasFileName,
        imageCount: source.images.length
      },
      parsedAt: nowMs()
    };
  };

  private async resolveBridgeProject(source: SpineSource, key: string, signal: AbortSignal) {
    if (signal.aborted) throw createSpineAbortError('Spine parse aborted');
    if (source.project) return source.project;

    if (this.useWorker && canUseWorker()) {
      try {
        this.workerParseCount += 1;
        const parsed = await parseWithWorker(stripParsedProjectFromSource({ ...source, key }), signal);
        return parsed.project;
      } catch (error) {
        if (signal.aborted) throw error;
        this.workerParseCount = Math.max(0, this.workerParseCount - 1);
      }
    }

    if (signal.aborted) throw createSpineAbortError('Spine parse aborted');
    this.directParseCount += 1;
    return buildSpineProject(source.jsonText, source.atlasText, source.images);
  }
}

function stripParsedProjectFromSource(source: SpineSource & { key: string }): SpineSource & { key: string } {
  if (!source.project) return source;
  return {
    key: source.key,
    jsonText: source.jsonText,
    atlasText: source.atlasText,
    images: source.images,
    fileName: source.fileName,
    atlasFileName: source.atlasFileName
  };
}

function parseWithWorker(source: SpineSource & { key: string }, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(createSpineAbortError('Spine worker parse aborted'));

  return new Promise<SpineParsedResource>((resolve, reject) => {
    const id = workerRequestId++;
    const worker = new Worker(new URL('./SpineParseWorker.ts', import.meta.url), {
      type: 'module',
      name: 'NovaFlowSpineParseWorker'
    });

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
    };
    const onAbort = () => {
      cleanup();
      reject(createSpineAbortError('Spine worker parse aborted'));
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(event.error || new Error(event.message || 'Spine worker parse failed'));
    };
    const onMessage = (event: MessageEvent<SpineParseWorkerResponse>) => {
      const response = event.data;
      if (!response || response.id !== id) return;
      cleanup();
      if (response.type === 'parsed') {
        resolve(response.resource);
        return;
      }
      const error = new Error(response.error.message);
      error.name = response.error.name;
      reject(error);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    const request: SpineParseWorkerRequest = {
      id,
      type: 'parse',
      version: SPINE_PARSE_WORKER_VERSION,
      source
    };
    worker.postMessage(request);
  });
}

function normalizeTime(value: number, durationSec: number, loop: boolean) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (durationSec <= 0) return safeValue;
  if (loop) return safeValue % durationSec;
  return Math.min(durationSec, safeValue);
}

function smoothAverage(current: number, next: number, count: number) {
  if (count <= 0) return next;
  const weight = Math.min(0.1, 1 / (count + 1));
  return current * (1 - weight) + next * weight;
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function requestFrame(callback: (timestamp: number) => void) {
  if (typeof requestAnimationFrame !== 'undefined') return requestAnimationFrame(callback);
  return setTimeout(() => callback(nowMs()), 16) as unknown as number;
}

function cancelFrame(id: number) {
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id);
}

function isCanvasContext(value: unknown): value is CanvasRenderingContext2D {
  return !!value && typeof value === 'object' && 'canvas' in value && typeof (value as CanvasRenderingContext2D).drawImage === 'function';
}

function canUseWorker() {
  return typeof Worker !== 'undefined' && typeof URL !== 'undefined';
}

export default SpineRuntimeLayer;
