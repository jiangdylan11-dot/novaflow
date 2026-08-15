import {
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  FakeTexture,
  GLTexture,
  SceneRenderer,
  Skeleton,
  SkeletonData,
  SkeletonJson,
  TextureAtlas,
  Vector2,
  Vector3
} from '@esotericsoftware/spine-webgl';
import type { SpineImageAsset, SpineSource } from './SpineRuntimeTypes';
import { createSpineAbortError } from './SpineRuntimeTypes';

export type OfficialSpineFourImage = {
  pageName: string;
  image: HTMLImageElement | ImageBitmap;
  width: number;
  height: number;
  bytes: number;
  premultipliedAlphaLikely?: boolean;
  close?: () => void;
};

export type OfficialSpineFourResource = {
  kind: 'official-spine-webgl-4';
  version: string;
  jsonText: string;
  atlas: TextureAtlas;
  skeletonData: SkeletonData;
  imagesByPage: Map<string, OfficialSpineFourImage>;
  animationNames: string[];
  skinNames: string[];
  textureBytes: number;
  premultipliedAlpha: boolean;
  bounds: SpineStableBounds | null;
  dispose: () => void;
};

type SpineStableBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DebugColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

type OfficialSpineFourPlayerOptions = {
  loop?: boolean;
  skinName?: string | null;
  timeScale?: number;
};

export function detectSpineVersion(jsonText: string) {
  try {
    const parsed = JSON.parse(jsonText);
    return String(parsed?.skeleton?.spine || '').trim();
  } catch {
    return '';
  }
}

export function supportsOfficialSpineFour(jsonText: string) {
  const version = detectSpineVersion(jsonText);
  const major = Number(version.split('.')[0] || 0);
  return major >= 4;
}

export async function parseOfficialSpineFourResource(
  source: SpineSource,
  signal: AbortSignal
): Promise<OfficialSpineFourResource> {
  throwIfAborted(signal);

  const atlas = new TextureAtlas(source.atlasText);
  const imagesByPage = new Map<string, OfficialSpineFourImage>();

  for (const page of atlas.pages) {
    throwIfAborted(signal);
    const imageAsset = findPageImage(page.name, source.images);
    if (!imageAsset) {
      throw new Error(`Missing Spine atlas page image: ${page.name}`);
    }
    const loaded = await loadPageImage(page.name, imageAsset, signal);
    imagesByPage.set(page.name, loaded);
    page.setTexture(new FakeTexture(loaded.image));
  }

  throwIfAborted(signal);

  try {
    const atlasLoader = new AtlasAttachmentLoader(atlas);
    const json = new SkeletonJson(atlasLoader);
    json.scale = 1;
    const skeletonData = json.readSkeletonData(JSON.parse(source.jsonText));
    const textureBytes = [...imagesByPage.values()].reduce((sum, image) => sum + image.bytes, 0);

    return {
      kind: 'official-spine-webgl-4',
      version: skeletonData.version || detectSpineVersion(source.jsonText),
      jsonText: source.jsonText,
      atlas,
      skeletonData,
      imagesByPage,
      animationNames: skeletonData.animations.map((animation) => animation.name),
      skinNames: skeletonData.skins.map((skin) => skin.name).filter(Boolean),
      textureBytes,
      premultipliedAlpha: atlas.pages.some((page) => !!page.pma) || [...imagesByPage.values()].some((image) => !!image.premultipliedAlphaLikely),
      bounds: readSkeletonBounds(source.jsonText),
      dispose: () => {
        for (const image of imagesByPage.values()) image.close?.();
        imagesByPage.clear();
      }
    };
  } catch (error) {
    for (const image of imagesByPage.values()) image.close?.();
    throw error;
  }
}

export class OfficialSpineFourPlayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly resource: OfficialSpineFourResource;
  private readonly gl: WebGLRenderingContext;
  private readonly renderer: SceneRenderer;
  private readonly textures: GLTexture[] = [];
  private readonly boundsOffset = new Vector2();
  private readonly boundsSize = new Vector2();
  private readonly stableBounds: SpineStableBounds | null;
  private skeleton: Skeleton;
  private skeletonData: SkeletonData;
  private animationStateData: AnimationStateData;
  private animationState: AnimationState;
  private animationName: string;
  private animationNames: string[];
  private skinName: string | null = null;
  private loop: boolean;
  private timeScale: number;
  private hud = false;
  private disposed = false;
  private timeSec = 0;
  private durationSec = 0;
  private readonly autoPremultipliedAlpha: boolean;
  private premultipliedAlpha: boolean;
  private debugOverlays: { bones?: boolean; mesh?: boolean } = {};
  private selectedBoneNames: string[] = [];
  private visibleBoneNames: string[] | null = null;
  private meshDebugVertices = new Float32Array(0);
  private regionDebugVertices = new Float32Array(8);
  private projectAnimationsKey: string;
  private lastResizeWidth = 0;
  private lastResizeHeight = 0;

  constructor(canvas: HTMLCanvasElement, resource: OfficialSpineFourResource, animationName: string, options: OfficialSpineFourPlayerOptions = {}) {
    this.canvas = canvas;
    this.resource = resource;
    this.loop = options.loop !== false;
    this.timeScale = Number.isFinite(options.timeScale || 1) ? Number(options.timeScale || 1) : 1;
    this.autoPremultipliedAlpha = resource.premultipliedAlpha;
    this.premultipliedAlpha = resource.premultipliedAlpha;
    this.stableBounds = resource.bounds;
    this.skeletonData = resource.skeletonData;
    this.animationNames = resource.animationNames.slice();
    this.projectAnimationsKey = animationsSignatureFromJson(resource.jsonText);

    const contextOptions: WebGLContextAttributes = {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    };
    const gl = canvas.getContext('webgl2', contextOptions) || canvas.getContext('webgl', contextOptions);
    if (!gl) throw new Error('WebGL is required for official Spine rendering');
    this.gl = gl;
    this.renderer = new SceneRenderer(canvas, gl, true);

    this.installTextures();
    this.skeleton = new Skeleton(this.skeletonData);
    this.animationStateData = new AnimationStateData(this.skeletonData);
    this.animationState = new AnimationState(this.animationStateData);
    this.animationName = animationName || this.animationNames[0] || '';
    if (options.skinName) this.setSkin(options.skinName);
    this.setAnimation(this.animationName, this.loop);
  }

  setAnimation(name: string, loop = this.loop) {
    if (this.disposed) return;
    const next = String(name || '').trim() || this.animationNames[0] || '';
    if (!next) return;
    this.loop = loop !== false;
    try {
      const entry = this.animationState.setAnimation(0, next, this.loop);
      this.durationSec = Math.max(0, entry.animation?.duration || 0);
      this.animationName = next;
    } catch {
      const fallback = this.animationNames[0];
      if (!fallback || fallback === next) return;
      const entry = this.animationState.setAnimation(0, fallback, this.loop);
      this.durationSec = Math.max(0, entry.animation?.duration || 0);
      this.animationName = fallback;
    }
    this.timeSec = 0;
    this.applyAt(0);
    this.captureStableBounds();
    this.applyCameraFit();
  }

  setSkin(name: string | null) {
    if (this.disposed) return;
    const next = String(name || '').trim();
    this.skinName = next || null;
    if (this.skinName) this.skeleton.setSkinByName(this.skinName);
    else this.skeleton.setSkin(null as never);
    this.skeleton.setSlotsToSetupPose();
    this.animationState.apply(this.skeleton);
    this.skeleton.updateWorldTransform();
    this.renderAt(this.timeSec);
  }

  setPlaying(_playing: boolean) {
    // Playback clock is owned by SpineRuntimeLayer.
  }

  setHud(enabled: boolean) {
    this.hud = !!enabled;
  }

  setDebugOverlays(overlays: { bones?: boolean; mesh?: boolean } = {}) {
    this.debugOverlays = overlays || {};
    this.renderCurrentPose();
  }

  setSelectedBoneName(name: string | null) {
    const next = String(name || '').trim();
    this.setSelectedBoneNames(next ? [next] : []);
  }

  setSelectedBoneNames(names: string[] | null) {
    this.selectedBoneNames = Array.isArray(names)
      ? names.map((name) => String(name || '').trim()).filter(Boolean)
      : [];
    this.renderCurrentPose();
  }

  setVisibleBoneNames(names: string[] | null) {
    this.visibleBoneNames = Array.isArray(names)
      ? names.map((name) => String(name || '').trim()).filter(Boolean)
      : null;
    this.renderCurrentPose();
  }

  setPremultipliedAlpha(enabled?: boolean | null) {
    const next = enabled == null ? this.autoPremultipliedAlpha : !!enabled;
    if (this.premultipliedAlpha === next) return;
    this.premultipliedAlpha = next;
    this.renderCurrentPose();
  }

  setProject(project: { animations?: Record<string, unknown> } | null) {
    if (this.disposed || !project?.animations) return;
    const nextKey = animationsSignature(project.animations);
    if (!nextKey || nextKey === this.projectAnimationsKey) return;
    try {
      const parsed = JSON.parse(this.resource.jsonText);
      parsed.animations = project.animations || parsed.animations || {};
      const json = new SkeletonJson(new AtlasAttachmentLoader(this.resource.atlas));
      json.scale = 1;
      const skeletonData = json.readSkeletonData(parsed);
      const animationNames = skeletonData.animations.map((animation) => animation.name).filter(Boolean);
      const prevAnimation = this.animationName;
      const prevSkin = this.skinName;
      const prevTime = this.timeSec;
      this.skeletonData = skeletonData;
      this.animationNames = animationNames;
      this.skeleton = new Skeleton(skeletonData);
      this.animationStateData = new AnimationStateData(skeletonData);
      this.animationState = new AnimationState(this.animationStateData);
      this.projectAnimationsKey = nextKey;
      if (prevSkin) this.setSkin(prevSkin);
      this.setAnimation(animationNames.includes(prevAnimation) ? prevAnimation : animationNames[0] || '', this.loop);
      this.seek(prevTime);
    } catch (error) {
      console.warn('[spine-runtime] official project override failed', error);
    }
  }

  setLoop(loop: boolean) {
    this.loop = !!loop;
    const current = this.animationState.getCurrent(0);
    if (current) current.loop = this.loop;
  }

  setMix(from: string, to: string, duration: number) {
    this.animationStateData.setMix(from, to, Math.max(0, Number(duration) || 0));
  }

  setTimeScale(timeScale: number) {
    this.timeScale = Number.isFinite(timeScale) ? timeScale : 1;
    this.animationState.timeScale = this.timeScale;
  }

  update(dtSec: number) {
    if (this.disposed) return;
    const dt = Math.max(0, Number(dtSec) || 0) * this.timeScale;
    this.animationState.update(dt);
    this.animationState.apply(this.skeleton);
    this.skeleton.updateWorldTransform();
    const current = this.animationState.getCurrent(0);
    this.timeSec = current?.getAnimationTime?.() ?? normalizeTime(this.timeSec + dt, this.durationSec, this.loop);
    this.renderCurrentPose();
  }

  seek(timeSec: number) {
    if (this.disposed) return;
    const next = normalizeTime(timeSec, this.durationSec, this.loop);
    this.timeSec = next;
    this.applyAt(next);
    this.renderCurrentPose();
  }

  renderAt(timeSec: number) {
    this.seek(timeSec);
  }

  getTimeSec() {
    return this.timeSec;
  }

  getDurationSec() {
    return this.durationSec;
  }

  stop() {
    this.animationState.clearTracks();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const texture of this.textures) texture.dispose();
    this.textures.length = 0;
    this.renderer.dispose();
  }

  private applyAt(timeSec: number) {
    const current = this.animationState.getCurrent(0);
    if (current) {
      current.trackTime = timeSec;
      current.trackLast = timeSec;
      current.animationLast = timeSec;
      current.nextTrackLast = timeSec;
      current.nextAnimationLast = timeSec;
    }
    this.skeleton.setToSetupPose();
    this.animationState.apply(this.skeleton);
    this.skeleton.updateWorldTransform();
  }

  private installTextures() {
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (this.gl.UNPACK_COLORSPACE_CONVERSION_WEBGL != null) {
      this.gl.pixelStorei(this.gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, this.gl.NONE);
    }
    for (const page of this.resource.atlas.pages) {
      const image = this.resource.imagesByPage.get(page.name);
      if (!image) throw new Error(`Missing decoded Spine image for atlas page: ${page.name}`);
      const texture = new GLTexture(this.gl, image.image, false);
      this.textures.push(texture);
      setAtlasPageTexture(this.resource.atlas, page, texture);
    }
  }

  private renderCurrentPose() {
    if (this.disposed) return;
    this.installActiveTextures();
    const resized = this.resizeRenderer();
    if (resized) this.applyCameraFit();
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.renderer.begin();
    this.renderer.drawSkeleton(this.skeleton, this.premultipliedAlpha);
    const hasBoneFilter = !!(this.visibleBoneNames && this.visibleBoneNames.length > 0);
    if (this.debugOverlays.bones && !hasBoneFilter && (this.renderer as any).drawSkeletonDebug) {
      (this.renderer as any).drawSkeletonDebug(this.skeleton, this.premultipliedAlpha);
    }
    if (this.debugOverlays.mesh) this.drawMeshOverlay();
    this.drawSelectedBoneOverlay();
    if (this.hud) {
      // Keep HUD state available for future debug overlay without involving React per frame.
    }
    this.renderer.end();
  }

  private drawMeshOverlay() {
    const renderer = this.renderer as any;
    if (!this.skeleton) return;
    const canRectLine = typeof renderer.rectLine === 'function';
    const canLine = typeof renderer.line === 'function';
    if (!canRectLine && !canLine) return;
    const triangleColor: DebugColor = { r: 0.12, g: 0.85, b: 1, a: 0.56 };
    const hullColor: DebugColor = { r: 0.22, g: 1, b: 0.86, a: 0.72 };
    const regionColor: DebugColor = { r: 0.2, g: 0.75, b: 1, a: 0.62 };
    const fitSize = Math.max(
      Number(this.boundsSize?.x) || 0,
      Number(this.boundsSize?.y) || 0,
      Number(this.stableBounds?.width) || 0,
      Number(this.stableBounds?.height) || 0
    );
    const gridLineWidth = Math.max(0.55, Math.min(1.35, fitSize / 1100 || 0.8));
    const hullLineWidth = Math.max(0.85, Math.min(1.8, gridLineWidth * 1.35));
    let edgeDrawCount = 0;
    const drawEdge = (x1: number, y1: number, x2: number, y2: number, color: DebugColor, width = 1.8) => {
      if (![x1, y1, x2, y2].every(Number.isFinite)) return;
      if (canRectLine) renderer.rectLine(true, x1, y1, x2, y2, width, color);
      else renderer.line(x1, y1, x2, y2, color);
      edgeDrawCount += 1;
      if (edgeDrawCount % 200 === 0 && typeof renderer.end === 'function' && typeof renderer.begin === 'function') {
        renderer.end();
        renderer.begin();
      }
    };
    const slots = (this.skeleton as any).drawOrder || (this.skeleton as any).slots || [];
    for (const slot of slots) {
      if (slot?.bone?.active === false) continue;
      const attachment = typeof slot?.getAttachment === 'function' ? slot.getAttachment() : slot?.attachment;
      if (!attachment) continue;
      const isMeshLike = attachment && typeof attachment.computeWorldVertices === 'function' && attachment.triangles && typeof attachment.triangles.length === 'number';
      if (isMeshLike) {
        const worldVerticesLength = Math.max(
          0,
          Math.floor(Number(attachment.worldVerticesLength) || Number(attachment.uvs?.length) || Number(attachment.regionUVs?.length) || 0)
        );
        const triangles = attachment.triangles || [];
        if (worldVerticesLength <= 0 || triangles.length < 3) continue;
        if (!this.meshDebugVertices || this.meshDebugVertices.length < worldVerticesLength) {
          this.meshDebugVertices = new Float32Array(Math.max(worldVerticesLength, 64));
        }
        const vertices = this.meshDebugVertices;
        try {
          attachment.computeWorldVertices(slot, 0, worldVerticesLength, vertices, 0, 2);
        } catch {
          continue;
        }
        const drawnEdges = new Set<string>();
        const drawIndexedEdge = (a: number, b: number) => {
          const start = Math.min(a, b);
          const end = Math.max(a, b);
          const key = `${start}:${end}`;
          if (drawnEdges.has(key)) return;
          drawnEdges.add(key);
          const v1 = a * 2;
          const v2 = b * 2;
          drawEdge(vertices[v1], vertices[v1 + 1], vertices[v2], vertices[v2 + 1], triangleColor, gridLineWidth);
        };
        for (let i = 0; i + 2 < triangles.length; i += 3) {
          drawIndexedEdge(triangles[i], triangles[i + 1]);
          drawIndexedEdge(triangles[i + 1], triangles[i + 2]);
          drawIndexedEdge(triangles[i + 2], triangles[i]);
        }
        const hullLength = Math.min(worldVerticesLength, (Math.max(0, Number(attachment.hullLength) || 0) >> 1) * 2);
        if (hullLength >= 4) {
          let lastX = vertices[hullLength - 2];
          let lastY = vertices[hullLength - 1];
          for (let i = 0; i < hullLength; i += 2) {
            const x = vertices[i];
            const y = vertices[i + 1];
            drawEdge(x, y, lastX, lastY, hullColor, hullLineWidth);
            lastX = x;
            lastY = y;
          }
        }
        continue;
      }
      const isRegionLike = !attachment.triangles && typeof attachment.computeWorldVertices === 'function';
      if (!isRegionLike) continue;
      const vertices = this.regionDebugVertices;
      try {
        try {
          attachment.computeWorldVertices(slot.bone, vertices, 0, 2);
        } catch {
          attachment.computeWorldVertices(slot, vertices, 0, 2);
        }
      } catch {
        continue;
      }
      drawEdge(vertices[0], vertices[1], vertices[2], vertices[3], regionColor, gridLineWidth);
      drawEdge(vertices[2], vertices[3], vertices[4], vertices[5], regionColor, gridLineWidth);
      drawEdge(vertices[4], vertices[5], vertices[6], vertices[7], regionColor, gridLineWidth);
      drawEdge(vertices[6], vertices[7], vertices[0], vertices[1], regionColor, gridLineWidth);
    }
  }

  private drawSelectedBoneOverlay() {
    if (!this.debugOverlays.bones) return;
    const selected = new Set(this.selectedBoneNames.map((name) => String(name || '').trim()).filter(Boolean));
    const visible = this.visibleBoneNames && this.visibleBoneNames.length > 0
      ? new Set(this.visibleBoneNames.map((name) => String(name || '').trim()).filter(Boolean))
      : null;
    if (selected.size === 0 && !visible) return;

    const renderer = this.renderer as any;
    const canLine = typeof renderer.line === 'function';
    if (!canLine) return;

    const selectedColor: DebugColor = { r: 0.15, g: 0.85, b: 1, a: 1 };
    const chainColor: DebugColor = { r: 1, g: 0.82, b: 0.18, a: 0.92 };
    for (const bone of (this.skeleton as any).bones || []) {
      const name = String(bone?.data?.name || '').trim();
      if (!name || bone?.active === false) continue;
      const isSelected = selected.has(name);
      const isVisibleChain = !!visible?.has(name);
      if (!isSelected && !isVisibleChain) continue;
      const color = isSelected ? selectedColor : chainColor;
      const length = Math.max(18, Number(bone?.data?.length) || 0);
      const x1 = Number(bone?.worldX) || 0;
      const y1 = Number(bone?.worldY) || 0;
      const x2 = x1 + (Number(bone?.a) || 0) * length;
      const y2 = y1 + (Number(bone?.c) || 0) * length;
      if (canLine) {
        renderer.line(x1, y1, x2, y2, color);
        if (isSelected && length > 0) {
          renderer.line(x1 - 4, y1, x1 + 4, y1, color);
          renderer.line(x1, y1 - 4, x1, y1 + 4, color);
        }
      }
    }
  }

  private installActiveTextures() {
    for (let i = 0; i < this.resource.atlas.pages.length; i += 1) {
      const page = this.resource.atlas.pages[i];
      const texture = this.textures[i];
      if (texture && page.texture !== texture) setAtlasPageTexture(this.resource.atlas, page, texture);
    }
  }

  private resizeRenderer() {
    if (this.canvas.width <= 0 || this.canvas.height <= 0) return false;
    if (this.canvas.width === this.lastResizeWidth && this.canvas.height === this.lastResizeHeight) return false;
    this.lastResizeWidth = this.canvas.width;
    this.lastResizeHeight = this.canvas.height;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    (this.renderer.camera as any)?.setViewport?.(this.canvas.width, this.canvas.height);
    this.renderer.camera.update();
    return true;
  }

  private captureStableBounds() {
    if (this.stableBounds && this.stableBounds.width > 0 && this.stableBounds.height > 0) {
      this.boundsOffset.x = this.stableBounds.x;
      this.boundsOffset.y = this.stableBounds.y;
      this.boundsSize.x = this.stableBounds.width;
      this.boundsSize.y = this.stableBounds.height;
      return;
    }
    this.skeleton.getBounds(this.boundsOffset, this.boundsSize, []);
  }

  private applyCameraFit() {
    this.resizeRenderer();
    const width = Math.max(1, this.canvas.width || this.canvas.clientWidth || 1);
    const height = Math.max(1, this.canvas.height || this.canvas.clientHeight || 1);
    const camera = this.renderer.camera;
    camera.position.x = this.boundsOffset.x + this.boundsSize.x / 2;
    camera.position.y = this.boundsOffset.y + this.boundsSize.y / 2;
    const zoomX = this.boundsSize.x > 0 ? (this.boundsSize.x / width) * 2.4 : 1;
    const zoomY = this.boundsSize.y > 0 ? (this.boundsSize.y / height) * 2.4 : 1;
    camera.zoom = Math.max(0.001, Math.max(zoomX, zoomY));
    camera.update();
  }

  pickBoneAt(screenX: number, screenY: number) {
    if (this.disposed || !this.skeleton || !(this.renderer as any).camera?.screenToWorld) return null;
    this.resizeRenderer();
    const width = Math.max(1, this.canvas.width || 1);
    const height = Math.max(1, this.canvas.height || 1);
    const camera = (this.renderer as any).camera;
    const world = camera.screenToWorld(new Vector3(screenX, screenY, 0), width, height);
    let threshold = 12;
    try {
      const near = camera.screenToWorld(new Vector3(screenX + 12, screenY, 0), width, height);
      threshold = Math.max(4, Math.hypot((near.x || 0) - (world.x || 0), (near.y || 0) - (world.y || 0)));
    } catch {
      threshold = 12;
    }
    const visibleFilter = this.visibleBoneNames && this.visibleBoneNames.length > 0
      ? new Set(this.visibleBoneNames.map((name) => String(name || '').trim()).filter(Boolean))
      : null;
    let bestName: string | null = null;
    let bestDistance = threshold;
    for (const bone of (this.skeleton as any).bones || []) {
      if (bone?.active === false || !bone?.data?.name) continue;
      const name = String(bone.data.name);
      if (visibleFilter && !visibleFilter.has(name)) continue;
      const length = Math.max(0, Number(bone.data.length) || 0);
      const x1 = Number(bone.worldX) || 0;
      const y1 = Number(bone.worldY) || 0;
      const x2 = x1 + (Number(bone.a) || 0) * length;
      const y2 = y1 + (Number(bone.c) || 0) * length;
      const distance = length > 0
        ? distanceToSegment(world.x || 0, world.y || 0, x1, y1, x2, y2)
        : Math.hypot((world.x || 0) - x1, (world.y || 0) - y1);
      if (distance <= bestDistance) {
        bestDistance = distance;
        bestName = name;
      }
    }
    return bestName;
  }
}

function findPageImage(pageName: string, images: SpineImageAsset[]) {
  const normalizedPage = normalizeName(pageName);
  return images.find((image) => normalizeName(image.fileName) === normalizedPage) || images.find((image) => normalizeName(image.fileName).endsWith(normalizedPage));
}

function setAtlasPageTexture(atlas: TextureAtlas, page: any, texture: any) {
  page.setTexture(texture);
  for (const region of atlas.regions || []) {
    if ((region as any)?.page === page) (region as any).texture = texture;
  }
}

async function loadPageImage(pageName: string, imageAsset: SpineImageAsset, signal: AbortSignal): Promise<OfficialSpineFourImage> {
  throwIfAborted(signal);
  const blob = await (await fetch(imageAsset.dataUrl)).blob();
  throwIfAborted(signal);

  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch {
      bitmap = await createImageBitmap(blob);
    }
    throwIfAborted(signal);
    return {
      pageName,
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      bytes: estimateTextureBytes(bitmap.width, bitmap.height),
      premultipliedAlphaLikely: detectPremultipliedImage(bitmap, bitmap.width, bitmap.height),
      close: () => bitmap.close()
    };
  }

  const image = await loadHtmlImage(imageAsset.dataUrl, signal);
  return {
    pageName,
    image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    bytes: estimateTextureBytes(image.naturalWidth || image.width, image.naturalHeight || image.height),
    premultipliedAlphaLikely: detectPremultipliedImage(image, image.naturalWidth || image.width, image.naturalHeight || image.height)
  };
}

function loadHtmlImage(dataUrl: string, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(createSpineAbortError('Spine image load aborted'));
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      image.onload = null;
      image.onerror = null;
    };
    const onAbort = () => {
      cleanup();
      reject(createSpineAbortError('Spine image load aborted'));
    };
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('Failed to decode Spine image'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    image.src = dataUrl;
  });
}

function normalizeName(name: string) {
  return String(name || '').trim().replace(/\\/g, '/').split('/').pop()?.toLowerCase() || '';
}

function estimateTextureBytes(width: number, height: number) {
  return Math.max(0, Math.floor(width || 0) * Math.floor(height || 0) * 4);
}

function readSkeletonBounds(jsonText: string): SpineStableBounds | null {
  try {
    const skeleton = JSON.parse(jsonText)?.skeleton || {};
    const x = Number(skeleton.x);
    const y = Number(skeleton.y);
    const width = Number(skeleton.width);
    const height = Number(skeleton.height);
    if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
      return { x, y, width, height };
    }
  } catch {
    return null;
  }
  return null;
}

function animationsSignatureFromJson(jsonText: string) {
  try {
    return animationsSignature(JSON.parse(String(jsonText || '{}'))?.animations || {});
  } catch {
    return '';
  }
}

function animationsSignature(animations: unknown) {
  try {
    return JSON.stringify(animations || {});
  } catch {
    return '';
  }
}

function detectPremultipliedImage(image: CanvasImageSource, width: number, height: number) {
  if (!image || !(width > 0) || !(height > 0) || typeof document === 'undefined') return false;
  const maxSide = 128;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  try {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(image, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let translucent = 0;
    let premulLike = 0;
    let straightLike = 0;
    const stride = Math.max(4, Math.floor(data.length / 4096 / 4) * 4);
    for (let i = 0; i + 3 < data.length; i += stride) {
      const a = data[i + 3];
      if (a <= 4 || a >= 250) continue;
      const maxRgb = Math.max(data[i], data[i + 1], data[i + 2]);
      translucent += 1;
      if (maxRgb <= a + 3) premulLike += 1;
      if (maxRgb > a + 18) straightLike += 1;
    }
    if (translucent < 24) return false;
    return premulLike / translucent > 0.92 && straightLike / translucent < 0.04;
  } catch {
    return false;
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw createSpineAbortError('Spine official runtime load aborted');
}

function normalizeTime(value: number, durationSec: number, loop: boolean) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (durationSec <= 0) return safeValue;
  if (loop) return safeValue % durationSec;
  return Math.min(durationSec, safeValue);
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-8) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}
