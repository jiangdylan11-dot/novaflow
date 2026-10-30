"use strict";

const RUNTIMES = {
  "3.7": {
    label: "3.7 JSON/SKEL compat / 3.8.95",
    script: "vendor/spine-player/3.8/spine-player.js?v=20260630-sharp",
    style: "vendor/spine-player/3.8/spine-player.css?v=20260630-sharp",
    binaryKey: "skelUrl",
  },
  "3.8": {
    label: "3.8.95",
    script: "vendor/spine-player/3.8/spine-player.js?v=20260630-sharp",
    style: "vendor/spine-player/3.8/spine-player.css?v=20260630-sharp",
    binaryKey: "skelUrl",
  },
  "4.0": {
    label: "4.0.31",
    script: "vendor/spine-player/4.0/spine-player.js",
    style: "vendor/spine-player/4.0/spine-player.css",
    binaryKey: "binaryUrl",
  },
  "4.1": {
    label: "4.1.56",
    script: "vendor/spine-player/4.1/spine-player.js",
    style: "vendor/spine-player/4.1/spine-player.css",
    binaryKey: "binaryUrl",
  },
  "4.2": {
    label: "4.2.119",
    script: "vendor/spine-player/4.2/spine-player.js",
    style: "vendor/spine-player/4.2/spine-player.css",
    binaryKey: "binaryUrl",
  },
};

const elements = {
  runtimeStyle: document.getElementById("spine-runtime-style"),
  runtimeBadge: document.getElementById("runtimeBadge"),
  dropZone: document.getElementById("dropZone"),
  filePicker: document.getElementById("filePicker"),
  resetTransformButton: document.getElementById("resetTransformButton"),
  detectedVersion: document.getElementById("detectedVersion"),
  layerList: document.getElementById("layerList"),
  moveLayerUp: document.getElementById("moveLayerUp"),
  moveLayerDown: document.getElementById("moveLayerDown"),
  pickBackgroundButton: document.getElementById("pickBackgroundButton"),
  clearBackgroundButton: document.getElementById("clearBackgroundButton"),
  backgroundPicker: document.getElementById("backgroundPicker"),
  backgroundHint: document.getElementById("backgroundHint"),
  animationSelect: document.getElementById("animationSelect"),
  nextAnimationButton: document.getElementById("nextAnimationButton"),
  carouselAnimationToggle: document.getElementById("carouselAnimationToggle"),
  skinSelect: document.getElementById("skinSelect"),
  speedRange: document.getElementById("speedRange"),
  speedValue: document.getElementById("speedValue"),
  mixRange: document.getElementById("mixRange"),
  mixValue: document.getElementById("mixValue"),
  premultiplyToggle: document.getElementById("premultiplyToggle"),
  playPauseButton: document.getElementById("playPauseButton"),
  progressRange: document.getElementById("progressRange"),
  progressValue: document.getElementById("progressValue"),
  timeInput: document.getElementById("timeInput"),
  statusText: document.getElementById("statusText"),
  playerMount: document.getElementById("playerMount"),
  backgroundImage: document.getElementById("backgroundImage"),
  sceneLayer: document.getElementById("sceneLayer"),
  emptyState: document.getElementById("emptyState"),
  actualSizeButton: document.getElementById("actualSizeButton"),
  autoFitButton: document.getElementById("autoFitButton"),
};

const state = {
  files: [],
  skeletonFiles: [],
  atlasFiles: [],
  imageFiles: [],
  projects: [],
  activeProjectIndex: -1,
  sceneItems: [],
  activeSceneId: "",
  selectedSceneIds: new Set(),
  selectionAnchorId: "",
  nextSceneId: 1,
  nextZIndex: 1,
  dismissedProjectKeys: new Set(),
  dragState: null,
  detectedRuntime: "",
  activeRuntime: "",
  runtimeCache: new Map(),
  runtimeScripts: new Map(),
  runtimeStyles: new Map(),
  player: null,
  loaded: false,
  loadToken: 0,
  progressFrame: 0,
  progressDragging: false,
  previewZoom: 1,
  carouselEnabled: false,
  canvasPanX: 0,
  canvasPanY: 0,
  importQueue: Promise.resolve(),
  backgroundObjectUrl: "",
  backgroundLoadToken: 0,
  backgroundNaturalWidth: 0,
  backgroundNaturalHeight: 0,
  rawDataCache: new WeakMap(),
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const SKELETON_EXTENSIONS = new Set([".json", ".skel"]);
const MIN_PREVIEW_ZOOM = 0.01;
const MAX_PREVIEW_ZOOM = 4;
const MIN_SCENE_VISIBLE_PX = 52;
const VIEWPORT_SAFE_PADDING = "100%";
const INITIAL_SCENE_OFFSETS = [
  [0, 0],
  [90, 48],
  [-90, 48],
  [90, -48],
  [-90, -48],
  [0, 96],
  [0, -96],
  [150, 0],
  [-150, 0],
];

function setStatus(message, isError = false) {
  elements.statusText.textContent = message;
  elements.statusText.classList.toggle("error", isError);
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function basename(value) {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function extensionOf(fileName) {
  const cleanName = basename(fileName).toLowerCase();
  const index = cleanName.lastIndexOf(".");
  return index >= 0 ? cleanName.slice(index) : "";
}

function fileLabel(file) {
  return normalizePath(file.webkitRelativePath || file.name);
}

function fileKey(file) {
  return fileLabel(file).toLowerCase();
}

function safeAssetPath(prefix, file) {
  const name = basename(file.name).replace(/[^\w.-]/g, "_") || "asset";
  return `${prefix}/${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`;
}

function resetSelect(select, placeholder) {
  select.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = placeholder;
  select.appendChild(option);
}

function fillFileSelect(select, files, placeholder) {
  resetSelect(select, placeholder);
  files.forEach((file, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = fileLabel(file);
    select.appendChild(option);
  });
  select.value = files.length ? "0" : "";
}

function fillNameSelect(select, names, placeholder) {
  select.innerHTML = "";
  if (!names.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    select.appendChild(option);
    select.disabled = true;
    return;
  }
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name || "(default)";
    select.appendChild(option);
  });
  select.disabled = false;
}

function setControlAvailability(enabled) {
  [
    elements.animationSelect,
    elements.nextAnimationButton,
    elements.skinSelect,
    elements.speedRange,
    elements.mixRange,
    elements.premultiplyToggle,
    elements.playPauseButton,
    elements.progressRange,
    elements.timeInput,
  ].forEach((control) => {
    control.disabled = !enabled;
  });
}

function updateRangeLabels() {
  elements.speedValue.textContent = `${Number(elements.speedRange.value).toFixed(2)}x`;
  elements.mixValue.textContent = `${Number(elements.mixRange.value).toFixed(2)}s`;
  updateRangeFill(elements.speedRange);
  updateRangeFill(elements.mixRange);
}

function updateRangeFill(input) {
  const min = Number(input.min || 0), max = Number(input.max || 1);
  const percent = max > min ? clamp((Number(input.value) - min) / (max - min) * 100, 0, 100) : 0;
  input.style.setProperty("--range-fill", `${percent}%`);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getSceneItemById(sceneId) {
  return state.sceneItems.find((item) => item.id === sceneId) || null;
}

function getActiveSceneItem() {
  return getSceneItemById(state.activeSceneId);
}

function getLayerItemsTopFirst() {
  return state.sceneItems.slice().sort((a, b) => b.zIndex - a.zIndex || b.order - a.order);
}

function getPreviewContainer(item = getActiveSceneItem()) {
  return item ? item.mount : null;
}

function normalizeViewportValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function createSafeViewportConfig() {
  return {
    padLeft: VIEWPORT_SAFE_PADDING,
    padRight: VIEWPORT_SAFE_PADDING,
    padTop: VIEWPORT_SAFE_PADDING,
    padBottom: VIEWPORT_SAFE_PADDING,
    animations: {},
    transitionTime: 0,
  };
}

function cloneViewport(viewport) {
  if (!viewport) return null;
  const clone = {
    x: normalizeViewportValue(viewport.x),
    y: normalizeViewportValue(viewport.y),
    width: normalizeViewportValue(viewport.width),
    height: normalizeViewportValue(viewport.height),
    padLeft: normalizeViewportValue(viewport.padLeft),
    padRight: normalizeViewportValue(viewport.padRight),
    padTop: normalizeViewportValue(viewport.padTop),
    padBottom: normalizeViewportValue(viewport.padBottom),
  };
  return clone.width > 0 && clone.height > 0 ? clone : null;
}

function captureBasePreviewViewport(force = false, item = getActiveSceneItem()) {
  if (!item || !item.player || !item.player.currentViewport) return null;
  if (!force && item.basePreviewViewport) return item.basePreviewViewport;
  item.basePreviewViewport = cloneViewport(item.player.currentViewport);
  if (item.basePreviewViewport && !item.originAnchor) {
    item.originAnchor = viewportOriginOffset(item.basePreviewViewport);
  }
  return item.basePreviewViewport;
}

// Skeleton origin relative to the scene element center at 1x, in screen px (y down).
function viewportOriginOffset(viewport) {
  return {
    x: viewport.padLeft - viewport.x - (viewport.width + viewport.padLeft + viewport.padRight) / 2,
    y: viewport.y + viewport.height + viewport.padTop - (viewport.height + viewport.padTop + viewport.padBottom) / 2,
  };
}

// Each animation has its own bounds, so centering the element on them would move the
// skeleton when switching animations. Shift the element so the origin stays where the
// first animation put it, like the Spine editor preview.
function sceneAnchorShift(item) {
  if (!item.originAnchor || !item.basePreviewViewport) return { x: 0, y: 0 };
  const current = viewportOriginOffset(item.basePreviewViewport);
  return {
    x: (item.originAnchor.x - current.x) * state.previewZoom,
    y: (item.originAnchor.y - current.y) * state.previewZoom,
  };
}

function invalidateBaseSceneSize(item) {
  if (!item) return;
  item.visibleBounds = null;
  item.baseSceneWidth = 0;
  item.baseSceneHeight = 0;
  item.baseRootOffsetX = 0;
  item.baseRootOffsetY = 0;
}

function sceneMetricsFromViewport(viewport) {
  if (!viewport) return null;
  const width = Math.ceil(viewport.width + viewport.padLeft + viewport.padRight);
  const height = Math.ceil(viewport.height + viewport.padTop + viewport.padBottom);
  if (width <= 0 || height <= 0) return null;

  return {
    width,
    height,
    rootOffsetX: viewport.padLeft - viewport.x,
    rootOffsetY: viewport.y + viewport.height + viewport.padTop,
  };
}

function captureBaseSceneSize(baseViewport, force = false, item = getActiveSceneItem()) {
  if (!item) return null;
  if (!force && item.baseSceneWidth > 0 && item.baseSceneHeight > 0) {
    return {
      width: item.baseSceneWidth,
      height: item.baseSceneHeight,
      rootOffsetX: item.baseRootOffsetX,
      rootOffsetY: item.baseRootOffsetY,
    };
  }

  const metrics = sceneMetricsFromViewport(baseViewport);
  if (!metrics) return null;
  item.baseSceneWidth = metrics.width;
  item.baseSceneHeight = metrics.height;
  item.baseRootOffsetX = metrics.rootOffsetX;
  item.baseRootOffsetY = metrics.rootOffsetY;
  return metrics;
}

function applyBackgroundPreviewZoom() {
  if (!state.backgroundNaturalWidth || !state.backgroundNaturalHeight || elements.backgroundImage.hidden) return;
  elements.backgroundImage.style.width = `${Math.round(state.backgroundNaturalWidth * state.previewZoom)}px`;
  elements.backgroundImage.style.height = `${Math.round(state.backgroundNaturalHeight * state.previewZoom)}px`;
  elements.backgroundImage.style.marginLeft = `${state.canvasPanX}px`;
  elements.backgroundImage.style.marginTop = `${state.canvasPanY}px`;
}

function syncCanvasGrid() {
  elements.playerMount.style.backgroundSize = `${32 * state.previewZoom}px ${32 * state.previewZoom}px`;
  elements.playerMount.style.backgroundPosition = `calc(50% + ${state.canvasPanX}px) calc(50% + ${state.canvasPanY}px)`;
}

function applyPreviewZoom(item = getActiveSceneItem()) {
  if (!item) return;
  const previousBounds = item.visibleBounds;
  const previousWidth = item.element?.offsetWidth, previousHeight = item.element?.offsetHeight;
  const baseViewport = captureBasePreviewViewport(false, item);
  const sceneSize = captureBaseSceneSize(baseViewport, false, item);
  if (sceneSize && item.element) {
    item.element.style.width = `${Math.round(sceneSize.width * state.previewZoom)}px`;
    item.element.style.height = `${Math.round(sceneSize.height * state.previewZoom)}px`;
  }

  const container = getPreviewContainer(item);
  if (container) container.style.transform = "";
  if (item.id === state.activeSceneId) {
    elements.playerMount.dataset.previewZoom = state.previewZoom.toFixed(3);
  }
  elements.playerMount.dataset.zoomMode = "global-layout";

  if (!baseViewport || !item.player) return;
  item.player.currentViewport = { ...baseViewport };
  item.player.previousViewport = null;
  if (typeof item.player.drawFrame === "function") item.player.drawFrame(false);
  applySceneItemTransform(item);
  if (state.selectedSceneIds.has(item.id)) {
    if (previousBounds && previousWidth && previousHeight) {
      const sx = item.element.offsetWidth / previousWidth, sy = item.element.offsetHeight / previousHeight;
      showSceneOutline(item, { left: previousBounds.left * sx, top: previousBounds.top * sy, width: previousBounds.width * sx, height: previousBounds.height * sy });
    } else updateSceneOutline(item);
  }
}

function applyAllPreviewZoom() {
  elements.actualSizeButton.textContent = `${Math.round(state.previewZoom * 100)}%`;
  syncCanvasGrid();
  elements.playerMount.dataset.previewZoom = state.previewZoom.toFixed(3);
  elements.playerMount.dataset.zoomMode = "global-layout";
  applyBackgroundPreviewZoom();
  state.sceneItems.forEach((item) => applyPreviewZoom(item));
  updateProjectHint();
}

function setPreviewZoom(nextZoom, { scaleLayout = true } = {}) {
  const zoom = clamp(nextZoom, MIN_PREVIEW_ZOOM, MAX_PREVIEW_ZOOM);
  if (scaleLayout) {
    const factor = zoom / state.previewZoom;
    state.sceneItems.forEach((item) => { item.x *= factor; item.y *= factor; });
    state.canvasPanX *= factor; state.canvasPanY *= factor;
  }
  state.previewZoom = zoom;
  applyAllPreviewZoom();
}

function resetPreviewZoomToActualSize() {
  setPreviewZoom(1);
}

function fitPreviewToCanvas() {
  const mount = elements.playerMount.getBoundingClientRect();
  const zoom = state.previewZoom;
  // Fit in original scene units. Rounded CSS pixels must never feed the next fit.
  const items = state.sceneItems.map((item) => {
    const bounds = getFixedArtworkBounds(item);
    const size = captureBaseSceneSize(captureBasePreviewViewport(false, item), false, item);
    const width = size?.width || item.element.offsetWidth / zoom;
    const height = size?.height || item.element.offsetHeight / zoom;
    const x = (item.x - state.canvasPanX) / zoom, y = (item.y - state.canvasPanY) / zoom;
    const shift = sceneAnchorShift(item);
    const left = x + shift.x / zoom + (bounds.left / item.element.offsetWidth - .5) * width;
    const top = y + shift.y / zoom + (bounds.top / item.element.offsetHeight - .5) * height;
    return { item, x, y, left, top, right: left + bounds.width / item.element.offsetWidth * width, bottom: top + bounds.height / item.element.offsetHeight * height };
  });
  const rects = [...items];
  const hasBackground = !elements.backgroundImage.hidden;
  if (hasBackground) rects.push({ left: -state.backgroundNaturalWidth / 2, top: -state.backgroundNaturalHeight / 2, right: state.backgroundNaturalWidth / 2, bottom: state.backgroundNaturalHeight / 2 });
  if (!rects.length || mount.width <= 48 || mount.height <= 80) return;
  const left = Math.min(...rects.map((rect) => rect.left)), right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top)), bottom = Math.max(...rects.map((rect) => rect.bottom));
  const cx = hasBackground ? 0 : (left + right) / 2;
  const cy = hasBackground ? 0 : (top + bottom) / 2;
  const width = Math.max(1, 2 * Math.max(cx - left, right - cx));
  const height = Math.max(1, 2 * Math.max(cy - top, bottom - cy));
  const nextZoom = clamp(Math.min((mount.width - 48) / width, (mount.height - 80) / height), MIN_PREVIEW_ZOOM, MAX_PREVIEW_ZOOM);
  state.canvasPanX = -cx * nextZoom;
  state.canvasPanY = -cy * nextZoom;
  items.forEach(({ item, x, y }) => {
    item.x = x * nextZoom + state.canvasPanX;
    item.y = y * nextZoom + state.canvasPanY;
    item.positionTouched = true;
  });
  setPreviewZoom(nextZoom, { scaleLayout: false });
}

function applySceneItemTransform(item) {
  if (!item || !item.element) return;
  const rootOffsetX = item.element.offsetWidth / 2;
  const rootOffsetY = item.element.offsetHeight / 2;
  const shift = sceneAnchorShift(item);
  item.element.style.transform = `translate3d(${item.x + shift.x - rootOffsetX}px, ${item.y + shift.y - rootOffsetY}px, 0)`;
}

function clampScenePosition(item, x, y) {
  if (!item || !item.element) return { x, y };
  const mountRect = elements.playerMount.getBoundingClientRect();
  const width = item.element.offsetWidth;
  const height = item.element.offsetHeight;
  if (!mountRect.width || !mountRect.height || !width || !height) return { x, y };
  const shift = sceneAnchorShift(item);
  const bounds = item.visibleBounds || { left: 0, top: 0, width, height };
  const left = shift.x - width / 2 + bounds.left;
  const top = shift.y - height / 2 + bounds.top;
  const visibleX = Math.min(MIN_SCENE_VISIBLE_PX, bounds.width);
  const visibleY = Math.min(MIN_SCENE_VISIBLE_PX, bounds.height);
  return {
    x: clamp(
      x,
      -mountRect.width / 2 + visibleX - left - bounds.width,
      mountRect.width / 2 - visibleX - left,
    ),
    y: clamp(
      y,
      -mountRect.height / 2 + visibleY - top - bounds.height,
      mountRect.height / 2 - visibleY - top,
    ),
  };
}

function resetSceneTransform(item = getActiveSceneItem()) {
  if (!item) return;
  item.x = 0;
  item.y = 0;
  item.positionTouched = true;
  applySceneItemTransform(item);
}

function resetSceneLayout() {
  if (state.sceneItems.length <= 1) { resetSceneTransform(getActiveSceneItem() || state.sceneItems[0]); return; }
  const mount = elements.playerMount.getBoundingClientRect();
  const gap = 24;
  const entries = state.sceneItems.slice().sort((a, b) => a.order - b.order).map((item) => {
    const bounds = getFixedArtworkBounds(item);
    const size = captureBaseSceneSize(captureBasePreviewViewport(false, item), false, item);
    return { item, width: Math.max(16, bounds.width / item.element.offsetWidth * size.width), height: Math.max(16, bounds.height / item.element.offsetHeight * size.height) };
  });
  const columns = Math.min(entries.length, Math.max(1, Math.ceil(Math.sqrt(entries.length * mount.width / Math.max(1, mount.height)))));
  const columnWidths = Array(columns).fill(0), rowHeights = Array(Math.ceil(entries.length / columns)).fill(0);
  entries.forEach((entry, index) => {
    columnWidths[index % columns] = Math.max(columnWidths[index % columns], entry.width);
    rowHeights[Math.floor(index / columns)] = Math.max(rowHeights[Math.floor(index / columns)], entry.height);
  });
  const centers = (sizes) => {
    let position = 0;
    return sizes.map((size) => { const center = position + size / 2; position += size + gap; return center; });
  };
  const columnCenters = centers(columnWidths), rowCenters = centers(rowHeights);
  const totalWidth = columnWidths.reduce((sum, value) => sum + value, 0) + gap * (columnWidths.length - 1);
  const totalHeight = rowHeights.reduce((sum, value) => sum + value, 0) + gap * (rowHeights.length - 1);
  const zoom = clamp(Math.min(1, (mount.width - 64) / Math.max(1, totalWidth), (mount.height - 80) / Math.max(1, totalHeight)), MIN_PREVIEW_ZOOM, MAX_PREVIEW_ZOOM);
  state.canvasPanX = state.canvasPanY = 0;
  setPreviewZoom(zoom, { scaleLayout: false });
  entries.forEach((entry, index) => {
    const item = entry.item, shift = sceneAnchorShift(item), bounds = getFixedArtworkBounds(item);
    item.x = (columnCenters[index % columns] - totalWidth / 2) * zoom - shift.x + item.element.offsetWidth / 2 - bounds.left - bounds.width / 2;
    item.y = (rowCenters[Math.floor(index / columns)] - totalHeight / 2) * zoom - shift.y + item.element.offsetHeight / 2 - bounds.top - bounds.height / 2;
    item.positionTouched = true;
    applySceneItemTransform(item); showSceneOutline(item, bounds);
  });
}

function handlePreviewWheel(event) {
  if (event.target.closest?.('button,input,[role="toolbar"]')) return;
  if (!state.sceneItems.length && !state.backgroundObjectUrl) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  setPreviewZoom(state.previewZoom * factor);
}

function resetProgressControls() {
  elements.progressRange.value = "0";
  updateRangeFill(elements.progressRange);
  elements.progressValue.textContent = "0.00s / 0.00s";
  elements.timeInput.value = "0.0";
  elements.timeInput.disabled = true;
}

function resetPlaybackDisplay() {
  updatePlaybackButton();
  state.progressDragging = false;
  resetProgressControls();
}

function resetPlaybackDefaults() {
  resetPlaybackDisplay();
}

function getCurrentTrackEntry() {
  const animationState = state.player && state.player.animationState;
  if (!animationState) return null;
  if (typeof animationState.getCurrent === "function") return animationState.getCurrent(0);
  return Array.isArray(animationState.tracks) ? animationState.tracks[0] : null;
}

function getTrackTiming(entry) {
  if (!entry) return null;
  const start = Number.isFinite(entry.animationStart) ? entry.animationStart : 0;
  let end = Number.isFinite(entry.animationEnd) ? entry.animationEnd : NaN;
  if (!Number.isFinite(end) && entry.animation && Number.isFinite(entry.animation.duration)) {
    end = start + entry.animation.duration;
  }
  const duration = end - start;
  if (!Number.isFinite(duration) || duration <= 0) return null;

  let animationTime = NaN;
  if (typeof entry.getAnimationTime === "function") {
    animationTime = entry.getAnimationTime();
  } else {
    const trackTime = Number(entry.trackTime) || 0;
    animationTime = entry.loop ? start + (trackTime % duration) : start + Math.min(trackTime, duration);
  }

  const elapsed = clamp((Number.isFinite(animationTime) ? animationTime : start) - start, 0, duration);
  return { start, duration, elapsed };
}

function formatSeconds(value) {
  return `${value.toFixed(2)}s`;
}

function updateProgressControls() {
  const timing = getTrackTiming(getCurrentTrackEntry());
  if (!state.loaded || !timing) {
    elements.progressRange.disabled = true;
    resetProgressControls();
    return;
  }

  elements.progressRange.disabled = false;
  elements.timeInput.disabled = false;
  elements.timeInput.max = String(timing.duration);
  elements.timeInput.title = `当前时间 / ${formatSeconds(timing.duration)}`;
  if (document.activeElement !== elements.timeInput) {
    elements.timeInput.value = timing.elapsed.toFixed(3).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, ".0");
  }
  if (!state.progressDragging) {
    elements.progressRange.value = String(timing.elapsed / timing.duration);
  }
  elements.progressValue.textContent = `${formatSeconds(timing.elapsed)} / ${formatSeconds(timing.duration)}`;
  updateRangeFill(elements.progressRange);
  updatePlaybackButton();
}

function updatePlaybackButton() {
  const playing = Boolean(getActiveSceneItem()?.player && !getActiveSceneItem().player.paused);
  const label = playing ? "暂停" : "播放";
  elements.playPauseButton.textContent = "";
  elements.playPauseButton.dataset.playing = String(playing);
  elements.playPauseButton.title = label;
  elements.playPauseButton.setAttribute('aria-label', label);
}

let timelineResumeId = "";
function beginTimelineScrub() {
  if (state.progressDragging) return;
  state.progressDragging = true;
  const item = getActiveSceneItem();
  timelineResumeId = item && !item.player.paused ? item.id : "";
  if (timelineResumeId) item.player.pause();
  updatePlaybackButton();
}

function endTimelineScrub() {
  state.progressDragging = false;
  const item = getSceneItemById(timelineResumeId);
  timelineResumeId = "";
  if (item) {
    if (viewerIsActive()) item.player.play();
    else viewerSuspendedPlayers.add(item.player);
  }
  updateProgressControls();
}

function stopProgressLoop() {
  if (!state.progressFrame) return;
  cancelAnimationFrame(state.progressFrame);
  state.progressFrame = 0;
}

function startProgressLoop() {
  stopProgressLoop();
  if (!viewerIsActive()) return;
  const tick = () => {
    updateAnimationCarousels();
    updateProgressControls();
    state.progressFrame = state.loaded || (state.carouselEnabled && state.sceneItems.length > 0) ? requestAnimationFrame(tick) : 0;
  };
  tick();
}

function updateWorldTransformForPlayer(player) {
  if (!player || !player.skeleton || typeof player.skeleton.updateWorldTransform !== "function") return;
  const runtimeApi = player.__spineViewerRuntimeApi || window.spine;
  const physicsUpdate = runtimeApi && runtimeApi.Physics && runtimeApi.Physics.update;
  try {
    if (physicsUpdate !== undefined) {
      player.skeleton.updateWorldTransform(physicsUpdate);
    } else {
      player.skeleton.updateWorldTransform();
    }
  } catch (error) {
    try {
      player.skeleton.updateWorldTransform();
    } catch (ignored) {
      // Some 4.x runtimes require a physics mode. The next render frame will still recover.
    }
  }
}

function drawCurrentFrame() {
  const player = state.player;
  if (!player || !player.skeleton || !player.animationState) return;
  const wasPaused = Boolean(player.paused);
  player.paused = true;
  try {
    player.animationState.apply(player.skeleton);
    updateWorldTransformForPlayer(player);
    if (typeof player.drawFrame === "function") player.drawFrame(false);
  } finally {
    player.paused = wasPaused;
  }
}

function seekProgress(value) {
  const entry = getCurrentTrackEntry();
  const timing = getTrackTiming(entry);
  if (!entry || !timing) return;

  const nextElapsed = clamp(Number(value) || 0, 0, 1) * timing.duration;
  entry.trackTime = nextElapsed;
  if ("trackLast" in entry) entry.trackLast = nextElapsed;
  if ("nextTrackLast" in entry) entry.nextTrackLast = nextElapsed;
  if (typeof entry.setAnimationLast === "function") {
    entry.setAnimationLast(timing.start + nextElapsed);
  } else {
    entry.animationLast = timing.start + nextElapsed;
    entry.nextAnimationLast = timing.start + nextElapsed;
  }

  drawCurrentFrame();
  updateProgressControls();
}

function directoryOf(value) {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function stemOfPath(value) {
  return basename(value)
    .replace(/\.atlas\.txt$/i, "")
    .replace(/\.(json|skel|atlas)$/i, "");
}

function runtimeFromVersion(version) {
  const match = String(version || "").match(/^(3\.7|3\.8|4\.0|4\.1|4\.2)/);
  return match ? match[1] : "";
}

async function detectRuntimeFromSkeletonFile(file) {
  const extension = extensionOf(file.name);
  if (extension === ".json") {
    const json = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
    const version = json && json.skeleton && String(json.skeleton.spine || "");
    const runtimeVersion = runtimeFromVersion(version);
    if (!runtimeVersion) throw new Error(version ? `不支持 Spine ${version}` : "未读取到 skeleton.spine");
    return { runtimeVersion, version };
  }

  if (extension === ".skel") {
    const bytes = new Uint8Array(await file.slice(0, 2048).arrayBuffer());
    let text = "";
    for (const byte of bytes) text += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : " ";
    const match = text.match(/((?:3\.7|3\.8|4\.0|4\.1|4\.2)(?:\.\d+){1,2})/);
    if (!match) throw new Error("无法自动识别 .skel 版本");
    return { runtimeVersion: runtimeFromVersion(match[1]), version: match[1] };
  }

  throw new Error("不支持的骨骼格式");
}

function atlasScoreForSkeleton(skeletonFile, atlasFile, sameDirAtlasCount) {
  const skeletonPath = fileLabel(skeletonFile);
  const atlasPath = fileLabel(atlasFile);
  const skeletonDir = directoryOf(skeletonPath).toLowerCase();
  const atlasDir = directoryOf(atlasPath).toLowerCase();
  const skeletonStem = stemOfPath(skeletonPath).toLowerCase();
  const atlasStem = stemOfPath(atlasPath).toLowerCase();
  const sameDir = skeletonDir === atlasDir;

  if (sameDir && skeletonStem === atlasStem) return 100;
  if (skeletonStem === atlasStem) return 80;
  if (sameDir && (atlasStem.startsWith(skeletonStem) || skeletonStem.startsWith(atlasStem))) return 70;
  if (sameDir && sameDirAtlasCount === 1) return 50;
  if (state.atlasFiles.length === 1) return 10;
  return 0;
}

function findAtlasForSkeleton(skeletonFile) {
  const skeletonDir = directoryOf(fileLabel(skeletonFile)).toLowerCase();
  const sameDirAtlasCount = state.atlasFiles.filter((atlasFile) => directoryOf(fileLabel(atlasFile)).toLowerCase() === skeletonDir).length;
  const candidates = state.atlasFiles
    .map((atlasFile, index) => ({
      atlasFile,
      index,
      score: atlasScoreForSkeleton(skeletonFile, atlasFile, sameDirAtlasCount),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0] ? candidates[0].atlasFile : null;
}

function projectLabelForSkeleton(file, labels) {
  const base = basename(fileLabel(file));
  if (labels.filter((label) => label === base).length <= 1) return base;
  const directory = directoryOf(fileLabel(file));
  return directory ? `${base} - ${directory}` : base;
}

async function buildProjects() {
  const skeletonLabels = state.skeletonFiles.map((file) => basename(fileLabel(file)));
  const projects = [];
  for (const skeletonFile of state.skeletonFiles) {
    let runtimeVersion = "";
    let version = "";
    let issue = "";
    try {
      const detected = await detectRuntimeFromSkeletonFile(skeletonFile);
      runtimeVersion = detected.runtimeVersion;
      version = detected.version;
    } catch (error) {
      issue = error.message || String(error);
    }
    const atlasFile = findAtlasForSkeleton(skeletonFile);
    if (!issue && !atlasFile) issue = "缺少匹配 atlas";
    projects.push({
      key: fileKey(skeletonFile),
      label: projectLabelForSkeleton(skeletonFile, skeletonLabels),
      skeletonFile,
      atlasFile,
      runtimeVersion,
      version,
      issue,
      loadable: Boolean(runtimeVersion && atlasFile),
    });
  }
  return projects;
}

function syncResetControl() {
  elements.resetTransformButton.disabled = !state.sceneItems.length;
  elements.resetTransformButton.title = state.sceneItems.length > 1 ? '自动排列全部动画' : '重置位置';
}

function renderLayerList() {
  updateNextAnimationButton();
  elements.layerList.innerHTML = "";
  const layers = getLayerItemsTopFirst();
  const selectedIndex = layers.findIndex((item) => item.id === state.activeSceneId);
  elements.moveLayerUp.disabled = selectedIndex <= 0;
  elements.moveLayerDown.disabled = selectedIndex < 0 || selectedIndex === layers.length - 1;
  if (!layers.length) {
    const empty = document.createElement("div");
    empty.className = "layer-empty";
    empty.textContent = "暂无动画";
    elements.layerList.appendChild(empty);
    return;
  }

  layers.forEach((item) => {
    const row = document.createElement("div");
    row.className = "layer-item";
    row.classList.toggle("is-active", state.selectedSceneIds.has(item.id));
    row.dataset.sceneId = item.id;

    const name = document.createElement("button");
    name.className = "layer-name";
    name.type = "button";
    name.dataset.action = "select";
    name.textContent = item.project.label;
    name.setAttribute('aria-pressed', String(state.selectedSceneIds.has(item.id)));

    const remove = document.createElement("button");
    remove.className = "layer-delete-button";
    remove.type = "button";
    remove.dataset.action = "remove";
    remove.textContent = "×";
    remove.title = `删除 ${item.project.label}`;
    remove.setAttribute("aria-label", remove.title);
    row.append(name, remove);
    row.draggable = true;
    row.title = "拖动调整层级；+ 上移，- 下移";
    elements.layerList.appendChild(row);
  });
}

function moveSceneLayer(sceneId, direction) {
  const layers = getLayerItemsTopFirst();
  const index = layers.findIndex((item) => item.id === sceneId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= layers.length) return;

  const item = layers[index];
  const target = layers[targetIndex];
  const itemZ = item.zIndex;
  item.zIndex = target.zIndex;
  target.zIndex = itemZ;
  item.element.style.zIndex = String(item.zIndex);
  target.element.style.zIndex = String(target.zIndex);
  selectSceneItem(sceneId, { preserveSelection: true });
  focusActiveLayer();
}

function focusActiveLayer() {
  const row = elements.layerList.querySelector(`[data-scene-id="${state.activeSceneId}"]`);
  row?.querySelector('.layer-name')?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: 'nearest' });
}

let layerDragId = "";
function clearLayerDrag() {
  layerDragId = "";
  elements.layerList.querySelectorAll('.layer-item').forEach((row) => row.classList.remove('is-layer-dragging', 'drop-before', 'drop-after'));
}

function handleLayerDrop(event) {
  if (!layerDragId) return;
  event.preventDefault();
  const target = event.target.closest('.layer-item');
  const layers = getLayerItemsTopFirst();
  const item = getSceneItemById(layerDragId);
  if (target && item && target.dataset.sceneId !== item.id) {
    const reordered = layers.filter((layer) => layer.id !== item.id);
    let index = reordered.findIndex((layer) => layer.id === target.dataset.sceneId);
    if (event.clientY >= target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2) index += 1;
    reordered.splice(index, 0, item);
    reordered.forEach((layer, position) => {
      layer.zIndex = reordered.length - position;
      layer.element.style.zIndex = String(layer.zIndex);
    });
    state.nextZIndex = reordered.length + 1;
    selectSceneItem(item.id, { preserveSelection: true });
    focusActiveLayer();
  }
  clearLayerDrag();
}

function handleLayerShortcut(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && viewerIsActive() && !event.target.closest?.('input,select,textarea,[contenteditable],[aria-haspopup="listbox"],[role="listbox"]')) {
    event.preventDefault();
    state.sceneItems.forEach((item) => state.selectedSceneIds.add(item.id));
    if (state.sceneItems.length) selectSceneItem(state.activeSceneId || state.sceneItems[0].id, { preserveSelection: true });
    return;
  }
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || !viewerIsActive()) return;
  if (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[aria-haspopup="listbox"],[role="listbox"]')) return;
  const direction = ['+', '='].includes(event.key) || event.code === 'NumpadAdd' ? 'up'
    : event.key === '-' || event.code === 'NumpadSubtract' ? 'down' : '';
  if (!direction || !getActiveSceneItem()) return;
  event.preventDefault();
  moveSceneLayer(state.activeSceneId, direction);
}

function updateProjectHint(item = getActiveSceneItem()) {
  if (!item) {
    elements.detectedVersion.textContent = "画布中没有动画";
    return;
  }
  const countLabel = `共 ${state.sceneItems.length} 个动画`;
  const size = captureBaseSceneSize(captureBasePreviewViewport(false, item), false, item);
  const sizeLabel = size ? ` · 1x ${size.width} × ${size.height}px` : "";
  const autoMode = getAutoSceneCompositeMode(item);
  const blendLabel = autoMode !== "normal" ? ` · 自动混合 ${compositeModeLabel(autoMode)}` : "";
  elements.detectedVersion.textContent = `${countLabel} · 当前 Spine ${item.project.version}${sizeLabel}${blendLabel}`;
}

async function classifyFiles(files) {
  if (!files.length) return;
  const incoming = new Map();
  files.forEach((file) => incoming.set(fileKey(file), file));
  incoming.forEach((file) => {
    if (SKELETON_EXTENSIONS.has(extensionOf(file.name))) {
      state.dismissedProjectKeys.delete(fileKey(file));
    }
  });

  const unique = new Map(state.files.map((file) => [fileKey(file), file]));
  incoming.forEach((file, key) => unique.set(key, file));
  state.files = [...unique.values()];
  state.skeletonFiles = state.files.filter((file) => SKELETON_EXTENSIONS.has(extensionOf(file.name)));
  state.atlasFiles = state.files.filter((file) => extensionOf(file.name) === ".atlas" || file.name.toLowerCase().endsWith(".atlas.txt"));
  state.imageFiles = state.files.filter((file) => IMAGE_EXTENSIONS.has(extensionOf(file.name)));
  state.projects = await buildProjects();

  if (!state.projects.length) {
    setStatus("缺少骨骼文件", true);
    return;
  }

  const existingKeys = new Set(state.sceneItems.map((item) => item.project.key));
  const projectsToLoad = state.projects.filter(
    (project) => project.loadable && !existingKeys.has(project.key) && !state.dismissedProjectKeys.has(project.key),
  );
  if (!projectsToLoad.length) {
    const unavailable = state.projects.filter((project) => !project.loadable);
    if (!state.sceneItems.length && unavailable.length) {
      setStatus(unavailable[0].issue || "没有可加载的工程", true);
    } else {
      setStatus("没有发现可新增的动画");
    }
    return;
  }
  await loadProjectsIntoScene(projectsToLoad);
}

function readFileAsDataURL(file) {
  const cached = state.rawDataCache.get(file);
  if (cached) return cached;

  const pending = new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
  state.rawDataCache.set(file, pending);
  return pending;
}

function textToBase64DataURL(text, mimeType) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function skeletonToDataURL(file) {
  if (extensionOf(file.name) !== ".json") return readFileAsDataURL(file);
  const text = (await file.text()).replace(/^\uFEFF/, "");
  return textToBase64DataURL(text, "application/json;charset=utf-8");
}

function parseAtlasPages(atlasText) {
  const lines = atlasText.split(/\r?\n/);
  const pages = [];
  let expectingPage = true;
  const pageMetaKeys = new Set(["size", "format", "filter", "repeat", "pma"]);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      expectingPage = true;
      continue;
    }
    if (!expectingPage || line !== trimmed || trimmed.includes(":")) continue;

    const nextLine = lines.slice(index + 1).find((item) => item.trim());
    const nextKey = nextLine ? nextLine.trim().split(":")[0].toLowerCase() : "";
    if (pageMetaKeys.has(nextKey)) {
      pages.push(trimmed);
      expectingPage = false;
    }
  }

  return pages;
}

function detectAtlasPremultipliedAlpha(atlasText, atlasFile) {
  if (/-pma(?:\.|$)/i.test(atlasFile.name)) return true;
  const pmaLine = atlasText
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .find((line) => /^pma\s*:/.test(line));
  return pmaLine ? /:\s*true\s*$/.test(pmaLine) : false;
}

function createEmptyBlendSummary() {
  return {
    totalSlots: 0,
    normalSlots: 0,
    additiveSlots: 0,
    multiplySlots: 0,
    screenSlots: 0,
    otherSlots: 0,
    totalDrawableAttachments: 0,
    blendedDrawableAttachments: 0,
    hasNonNormal: false,
    autoCompositeMode: "normal",
  };
}

function normalizeSkeletonBlend(value) {
  const blend = String(value || "normal").trim().toLowerCase();
  if (blend === "additive") return "additive";
  if (blend === "multiply") return "multiply";
  if (blend === "screen") return "screen";
  return blend === "normal" ? "normal" : "other";
}

function isDrawableAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return false;
  const type = attachment.type || "region";
  return type === "region" || type === "mesh" || Boolean(attachment.sequence);
}

function countDrawableAttachmentsForSlot(skins, slotName) {
  let count = 0;
  skins.forEach((skin) => {
    const attachments = skin && skin.attachments ? skin.attachments : {};
    const slotAttachments = attachments[slotName] || {};
    Object.values(slotAttachments).forEach((attachment) => {
      if (isDrawableAttachment(attachment)) count += 1;
    });
  });
  return count;
}

function selectAutoCompositeMode(summary) {
  // Slot blending is rendered inside Spine. Applying it again to the whole
  // canvas also blends normal artwork and doubles the effect on FX slots.
  return "normal";
}

function collectSkeletonBlendSummary(skeletonText) {
  const summary = createEmptyBlendSummary();
  if (!skeletonText) return summary;

  let skeletonData;
  try {
    skeletonData = JSON.parse(skeletonText.replace(/^\uFEFF/, ""));
  } catch (error) {
    return summary;
  }

  const slots = Array.isArray(skeletonData.slots) ? skeletonData.slots : [];
  const skins = Array.isArray(skeletonData.skins) ? skeletonData.skins : Object.values(skeletonData.skins || {});
  summary.totalSlots = slots.length;

  slots.forEach((slot) => {
    const blend = normalizeSkeletonBlend(slot && slot.blend);
    const attachmentCount = countDrawableAttachmentsForSlot(skins, slot && slot.name);
    summary.totalDrawableAttachments += attachmentCount;
    if (blend !== "normal") summary.blendedDrawableAttachments += attachmentCount;
    if (blend === "normal") summary.normalSlots += 1;
    else if (blend === "additive") summary.additiveSlots += 1;
    else if (blend === "multiply") summary.multiplySlots += 1;
    else if (blend === "screen") summary.screenSlots += 1;
    else summary.otherSlots += 1;
  });

  summary.hasNonNormal = summary.additiveSlots + summary.multiplySlots + summary.screenSlots + summary.otherSlots > 0;
  summary.autoCompositeMode = selectAutoCompositeMode(summary);
  return summary;
}

function addSkeletonTextureRef(refsByBase, path, attachment) {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) return;
  const base = basename(normalizedPath);
  if (!base) return;

  const refs = refsByBase.get(base) || new Map();
  const existing = refs.get(normalizedPath) || {};
  refs.set(normalizedPath, {
    path: normalizedPath,
    width: Number.isFinite(Number(attachment.width)) ? Number(attachment.width) : existing.width,
    height: Number.isFinite(Number(attachment.height)) ? Number(attachment.height) : existing.height,
  });
  refsByBase.set(base, refs);
}

function addSequenceTextureRefs(refsByBase, basePath, attachment) {
  const sequence = attachment.sequence;
  if (!sequence || !Number.isFinite(Number(sequence.count))) return;

  const count = Math.max(0, Number(sequence.count));
  const start = Number.isFinite(Number(sequence.start)) ? Number(sequence.start) : 1;
  const digits = Number.isFinite(Number(sequence.digits)) ? Number(sequence.digits) : 0;
  for (let index = 0; index < count; index += 1) {
    const frame = String(start + index).padStart(digits, "0");
    addSkeletonTextureRef(refsByBase, `${basePath}${frame}`, attachment);
  }
}

function collectSkeletonTextureRefs(skeletonText) {
  const refsByBase = new Map();
  let skeletonData;
  try {
    skeletonData = JSON.parse(skeletonText.replace(/^\uFEFF/, ""));
  } catch (error) {
    return refsByBase;
  }

  const skins = Array.isArray(skeletonData.skins) ? skeletonData.skins : Object.values(skeletonData.skins || {});
  skins.forEach((skin) => {
    const attachments = skin && skin.attachments ? skin.attachments : {};
    Object.values(attachments).forEach((slotAttachments) => {
      Object.entries(slotAttachments || {}).forEach(([attachmentName, attachment]) => {
        if (!attachment || typeof attachment !== "object") return;
        const type = attachment.type || "region";
        if (type !== "region" && type !== "mesh" && !attachment.sequence) return;

        const texturePath = attachment.path || attachmentName;
        if (attachment.sequence) {
          addSequenceTextureRefs(refsByBase, texturePath, attachment);
        } else {
          addSkeletonTextureRef(refsByBase, texturePath, attachment);
        }
      });
    });
  });

  return refsByBase;
}

function parseAtlasValues(line) {
  const value = String(line || "").split(":").slice(1).join(":");
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((number) => Number.isFinite(number));
}

function atlasLineKind(lines, index) {
  const raw = lines[index] || "";
  const trimmed = raw.trim();
  if (!trimmed || raw !== trimmed || trimmed.includes(":")) return "";

  const pageMetaKeys = new Set(["size", "format", "filter", "repeat", "pma", "scale"]);
  const nextLine = lines.slice(index + 1).find((item) => item.trim());
  const nextKey = nextLine ? nextLine.trim().split(":")[0].toLowerCase() : "";
  return pageMetaKeys.has(nextKey) ? "page" : "region";
}

function parseAtlasRegionEntries(atlasText) {
  const lines = atlasText.split(/\r?\n/);
  const entries = [];
  let pageScale = 1;

  for (let index = 0; index < lines.length; index += 1) {
    const kind = atlasLineKind(lines, index);
    if (!kind) continue;

    if (kind === "page") {
      pageScale = 1;
      for (let metaIndex = index + 1; metaIndex < lines.length; metaIndex += 1) {
        const meta = lines[metaIndex].trim();
        if (!meta || atlasLineKind(lines, metaIndex)) break;
        if (/^scale\s*:/i.test(meta)) {
          const scaleValue = Number(meta.split(":").slice(1).join(":").trim());
          if (Number.isFinite(scaleValue) && scaleValue > 0) pageScale = scaleValue;
        }
      }
      continue;
    }

    let endIndex = index + 1;
    let originalWidth = 0;
    let originalHeight = 0;
    while (endIndex < lines.length) {
      const meta = lines[endIndex].trim();
      if (!meta || atlasLineKind(lines, endIndex)) break;
      if (/^(offsets|orig)\s*:/i.test(meta)) {
        const values = parseAtlasValues(meta);
        if (values.length >= 4) {
          originalWidth = values[2];
          originalHeight = values[3];
        } else if (values.length >= 2) {
          originalWidth = values[0];
          originalHeight = values[1];
        }
      }
      endIndex += 1;
    }

    entries.push({
      name: lines[index].trim(),
      startIndex: index,
      endIndex,
      pageScale,
      originalWidth,
      originalHeight,
    });
  }

  return { lines, entries };
}

function atlasRefMatchesSize(ref, entry) {
  if (!entry.originalWidth || !entry.originalHeight || !ref.width || !ref.height) return false;
  const scaledWidth = Math.round(ref.width * entry.pageScale);
  const scaledHeight = Math.round(ref.height * entry.pageScale);
  return Math.abs(scaledWidth - entry.originalWidth) <= 1 && Math.abs(scaledHeight - entry.originalHeight) <= 1;
}

function selectAtlasAliasRef(entry, refs, usedPaths) {
  const availableRefs = refs.filter((ref) => ref.path !== entry.name && !usedPaths.has(ref.path));
  if (!availableRefs.length) return null;

  const sizeMatches = availableRefs.filter((ref) => atlasRefMatchesSize(ref, entry));
  if (sizeMatches.length === 1) return sizeMatches[0];
  if (availableRefs.length === 1) return availableRefs[0];
  return null;
}

async function repairAtlasPathAliases(atlasText, skeletonFile, skeletonText = "") {
  if (extensionOf(skeletonFile.name) !== ".json") return { atlasText, aliasCount: 0 };

  const refsByBase = collectSkeletonTextureRefs(skeletonText || await skeletonFile.text());
  if (!refsByBase.size) return { atlasText, aliasCount: 0 };

  const parsed = parseAtlasRegionEntries(atlasText);
  const atlasNames = new Set(parsed.entries.map((entry) => entry.name));
  const usedPaths = new Set(atlasNames);
  const insertions = new Map();
  let aliasCount = 0;

  parsed.entries.forEach((entry) => {
    const refs = [...(refsByBase.get(basename(entry.name)) || new Map()).values()];
    const missingRefs = refs.filter((ref) => !atlasNames.has(ref.path));
    const aliasRef = selectAtlasAliasRef(entry, missingRefs, usedPaths);
    if (!aliasRef) return;

    const block = parsed.lines.slice(entry.startIndex, entry.endIndex);
    if (!block.length) return;
    block[0] = aliasRef.path;
    const blocks = insertions.get(entry.endIndex) || [];
    blocks.push(block.join("\n"));
    insertions.set(entry.endIndex, blocks);
    usedPaths.add(aliasRef.path);
    aliasCount += 1;
  });

  if (!aliasCount) return { atlasText, aliasCount: 0 };

  const rebuiltLines = [];
  parsed.lines.forEach((line, index) => {
    rebuiltLines.push(line);
    const blocks = insertions.get(index + 1);
    if (blocks) rebuiltLines.push(...blocks);
  });

  return { atlasText: rebuiltLines.join("\n"), aliasCount };
}

function findImageFileForPage(pageName, atlasFile) {
  const normalizedPage = normalizePath(pageName).toLowerCase();
  const pageBase = basename(pageName).toLowerCase();
  const atlasDir = directoryOf(fileLabel(atlasFile)).toLowerCase();
  const sameDirPath = atlasDir ? `${atlasDir}/${normalizedPage}` : normalizedPage;

  const exact = state.imageFiles.find((file) => {
    const relative = normalizePath(file.webkitRelativePath || file.name).toLowerCase();
    return relative === sameDirPath || relative === normalizedPage;
  });
  if (exact) return exact;

  const suffixMatches = state.imageFiles.filter((file) => {
    const relative = normalizePath(file.webkitRelativePath || file.name).toLowerCase();
    return relative.endsWith(`/${sameDirPath}`) || relative.endsWith(`/${normalizedPage}`);
  });
  if (suffixMatches.length === 1) return suffixMatches[0];

  const sameDirBaseMatches = state.imageFiles.filter((file) => {
    const relative = normalizePath(file.webkitRelativePath || file.name).toLowerCase();
    return directoryOf(relative) === atlasDir && basename(relative).toLowerCase() === pageBase;
  });
  if (sameDirBaseMatches.length === 1) return sameDirBaseMatches[0];

  const baseMatches = state.imageFiles.filter((file) => basename(file.name).toLowerCase() === pageBase);
  return baseMatches.length === 1 ? baseMatches[0] : null;
}

async function buildRawDataURIs(skeletonFile, atlasFile) {
  const skeletonPath = safeAssetPath("skeleton", skeletonFile);
  const atlasPath = safeAssetPath("atlas", atlasFile).replace(/\.txt$/i, "");
  const atlasPrefix = atlasPath.includes("/") ? atlasPath.slice(0, atlasPath.lastIndexOf("/") + 1) : "";
  let isJson = extensionOf(skeletonFile.name) === ".json";
  let skeletonText = isJson ? (await skeletonFile.text()).replace(/^\uFEFF/, "") : "";
  if (!isJson && (await detectRuntimeFromSkeletonFile(skeletonFile)).runtimeVersion === "3.7") {
    skeletonText = window.NovaFlowSpineSkel.toJson(new Uint8Array(await skeletonFile.arrayBuffer())).text;
    isJson = true;
  }
  if (isJson) skeletonText = window.NovaFlowSpineVersion.runtimeJsonText(skeletonText);
  const rawAtlasText = (await atlasFile.text()).replace(/^\uFEFF/, "");
  const repairedAtlas = await repairAtlasPathAliases(rawAtlasText, skeletonFile, skeletonText);
  const atlasText = repairedAtlas.atlasText;
  const atlasPages = parseAtlasPages(atlasText);
  const premultipliedAlpha = detectAtlasPremultipliedAlpha(atlasText, atlasFile);
  const rawDataURIs = {
    [skeletonPath]: isJson
      ? textToBase64DataURL(skeletonText, "application/json;charset=utf-8")
      : await skeletonToDataURL(skeletonFile),
    [atlasPath]: textToBase64DataURL(atlasText, "text/plain;charset=utf-8"),
  };
  const missingImages = [];

  for (const pageName of atlasPages) {
    const imageFile = findImageFileForPage(pageName, atlasFile);
    if (!imageFile) {
      missingImages.push(pageName);
      continue;
    }
    const imageDataUrl = await readFileAsDataURL(imageFile);
    rawDataURIs[pageName] = imageDataUrl;
    rawDataURIs[`${atlasPrefix}${pageName}`] = imageDataUrl;
  }

  return {
    skeletonPath,
    skeletonIsJson: isJson,
    atlasPath,
    atlasPages,
    rawDataURIs,
    missingImages,
    premultipliedAlpha,
    atlasAliasCount: repairedAtlas.aliasCount,
    blendSummary: collectSkeletonBlendSummary(skeletonText),
  };
}

function disposeRuntimePlayer(player) {
  if (!player) return;
  try {
    if (typeof player.dispose === "function") {
      player.dispose();
    } else {
      if (typeof player.stopRendering === "function") player.stopRendering();
      if (typeof player.drawFrame === "function") player.drawFrame = () => {};
      if (player.sceneRenderer && typeof player.sceneRenderer.dispose === "function") {
        player.sceneRenderer.dispose();
      }
      if (player.assetManager && typeof player.assetManager.dispose === "function") {
        player.assetManager.dispose();
      }
      if (player.canvas) {
        player.canvas.width = 0;
        player.canvas.height = 0;
      }
    }
  } catch (error) {
    console.warn("Spine player dispose failed", error);
  }
}

function drawSceneFrame(item) {
  if (!item || item.disposed || !item.player || typeof item.player.drawFrame !== "function") return;
  item.player.drawFrame(false);
}

function getAutoSceneCompositeMode(item) {
  const summary = item && item.blendSummary;
  if (summary && summary.totalSlots > 0 && summary.screenSlots === summary.totalSlots) return "screen";
  if (summary && summary.totalSlots > 0 && summary.additiveSlots === summary.totalSlots) return "plus-lighter";
  return (item && item.blendSummary && item.blendSummary.autoCompositeMode) || "normal";
}

function compositeModeLabel(mode) {
  if (mode === "screen") return "滤色";
  if (mode === "plus-lighter") return "加亮";
  if (mode === "multiply") return "正片叠底";
  return "普通";
}

function applySceneCompositeMode(item) {
  if (!item || !item.element) return;
  const mode = getAutoSceneCompositeMode(item);
  item.element.dataset.compositeMode = mode === "normal" ? "" : mode;
}

function syncSceneCompositeModes() {
  state.sceneItems.forEach((item) => applySceneCompositeMode(item));
}

function updateEmptyState() {
  const hasScenes = state.sceneItems.length > 0;
  const hasPreviewContent = hasScenes || Boolean(state.backgroundObjectUrl);
  elements.sceneLayer.dataset.sceneCount = String(state.sceneItems.length);
  state.sceneItems.forEach((item) => {
    invalidateBaseSceneSize(item);
    applyPreviewZoom(item);
  });
  applyBackgroundPreviewZoom();
  elements.emptyState.hidden = hasPreviewContent;
  elements.actualSizeButton.disabled = !hasPreviewContent;
  elements.autoFitButton.disabled = !hasPreviewContent;
  syncSceneCompositeModes();
  renderLayerList();
  if (!hasScenes) {
    state.player = null;
    state.loaded = false;
    state.activeSceneId = "";
    stopProgressLoop();
    resetPlaybackDisplay();
    updateNextAnimationButton();
    setControlAvailability(false);
  }
}

function removeSceneItem(sceneId, dismiss = true) {
  const item = getSceneItemById(sceneId);
  if (!item) return;
  if (state.dragState && state.dragState.itemId === sceneId) {
    endSceneDrag({ pointerId: state.dragState.pointerId });
  }
  item.disposed = true;
  disposeRuntimePlayer(item.player);
  item.element.remove();
  state.selectedSceneIds.delete(sceneId);
  state.sceneItems = state.sceneItems.filter((candidate) => candidate.id !== sceneId);
  syncLegacyRuntimeResizeHandler();
  if (dismiss) state.dismissedProjectKeys.add(item.project.key);

  if (state.activeSceneId === sceneId) {
    const layers = getLayerItemsTopFirst();
    const next = layers.find((candidate) => state.selectedSceneIds.has(candidate.id)) || layers[0] || null;
    state.activeSceneId = "";
    if (next) selectSceneItem(next.id, { preserveSelection: true });
  }
  syncResetControl();
  updateEmptyState();
  autoLayoutUntouchedScenes();
  updateProjectHint();
}

function disposePlayer() {
  state.loadToken += 1;
  state.sceneItems.forEach((item) => {
    item.disposed = true;
    disposeRuntimePlayer(item.player);
    item.element.remove();
  });
  state.sceneItems = [];
  state.selectedSceneIds.clear();
  state.selectionAnchorId = "";
  syncLegacyRuntimeResizeHandler();
  state.activeSceneId = "";
  state.player = null;
  state.loaded = false;
  syncResetControl();
  updateEmptyState();
}

function ensureRuntimeStyle(version) {
  const runtime = RUNTIMES[version];
  const styleKey = runtime.style;
  if (state.runtimeStyles.has(styleKey)) return;
  let link = elements.runtimeStyle;
  if (state.runtimeStyles.size > 0 || (link.getAttribute("href") && link.getAttribute("href") !== styleKey)) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    document.head.insertBefore(link, document.getElementById("app-style"));
  }
  link.href = styleKey;
  link.dataset.spineRuntimeStyle = version;
  state.runtimeStyles.set(styleKey, link);
}

async function loadRuntime(version) {
  const runtime = RUNTIMES[version];
  if (!runtime) throw new Error(`不支持 runtime ${version}`);
  ensureRuntimeStyle(version);

  let runtimeApi = state.runtimeCache.get(version);
  if (!runtimeApi) {
    const sharedVersion = [...state.runtimeCache.keys()].find(
      (cachedVersion) => RUNTIMES[cachedVersion].script === runtime.script,
    );
    if (sharedVersion) runtimeApi = state.runtimeCache.get(sharedVersion);
  }

  const scriptKey = runtime.script;
  let runtimeEntry = null;
  if (!runtimeApi) {
    runtimeEntry = state.runtimeScripts.get(scriptKey);
    if (!runtimeEntry) {
      window.spine = undefined;
      const script = document.createElement("script");
      const promise = new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          script.onload = null;
          script.onerror = null;
          fn(value);
        };
        const timer = setTimeout(
          () => finish(reject, new Error(`runtime ${runtime.label} 脚本加载超时`)),
          10000,
        );
        script.src = runtime.script;
        script.async = true;
        script.onload = () => finish(resolve, window.spine);
        script.onerror = () => finish(reject, new Error(`无法加载 runtime ${runtime.label}`));
        document.head.appendChild(script);
      });
      runtimeEntry = { script, promise };
      state.runtimeScripts.set(scriptKey, runtimeEntry);
    }
    try {
      runtimeApi = await runtimeEntry.promise;
    } catch (error) {
      runtimeEntry.script.remove();
      state.runtimeScripts.delete(scriptKey);
      throw error;
    }
  }

  if (!runtimeApi || !runtimeApi.SpinePlayer) {
    if (runtimeEntry) runtimeEntry.script.remove();
    state.runtimeScripts.delete(scriptKey);
    throw new Error("runtime 未暴露 spine.SpinePlayer");
  }
  window.spine = runtimeApi;
  state.runtimeCache.set(version, runtimeApi);
  patchRuntimeDownloader(runtimeApi);
  patchRuntimeBlendModes(runtimeApi);
  patchRuntimeBatcherAlpha(runtimeApi);
  patchRuntimeRendererResolution(runtimeApi);
  state.activeRuntime = version;
  if (elements.runtimeBadge) elements.runtimeBadge.textContent = `runtime ${runtime.label}`;
  return runtimeApi;
}

function patchRuntimeBlendModes(runtimeApi) {
  const webgl = runtimeApi && runtimeApi.webgl;
  const converter = webgl && webgl.WebGLBlendModeConverter;
  if (!converter || converter.__spineViewerBlendPatch) return;
  if (typeof converter.getDestGLBlendMode !== "function") return;
  if (!Number.isFinite(Number(converter.ONE_MINUS_SRC_COLOR))) return;

  const blendMode = runtimeApi.BlendMode || {};
  const screenMode = blendMode.Screen !== undefined ? blendMode.Screen : 3;
  const originalGetDestGLBlendMode = converter.getDestGLBlendMode.bind(converter);

  converter.getDestGLBlendMode = function getDestGLBlendModePatched(mode) {
    if (mode === screenMode) return converter.ONE_MINUS_SRC_COLOR;
    return originalGetDestGLBlendMode(mode);
  };
  converter.__spineViewerBlendPatch = true;
}

// Every scene item renders into its own transparent WebGL canvas that the
// browser then composites over the page. Runtimes use the same blend factors
// for the alpha channel as for color, so additive/screen slots drawn over an
// empty canvas area write alpha = src alpha (1 for JPG atlases) and end up as
// opaque black rectangles instead of a light-only glow. Keep the destination
// alpha untouched for those modes: the canvas stays premultiplied, its RGB
// carries the light, and the browser adds it onto whatever is underneath.
function applyBatcherBlendFunc(gl, srcColorBlend, dstBlend, srcAlphaBlend) {
  if (!gl) return;
  if (!gl.__opaqueFxCanvas && (dstBlend === gl.ONE || dstBlend === gl.ONE_MINUS_SRC_COLOR)) {
    gl.blendFuncSeparate(srcColorBlend, dstBlend, gl.ZERO, gl.ONE);
    return;
  }
  const srcAlpha = srcAlphaBlend === undefined ? srcColorBlend : srcAlphaBlend;
  gl.blendFuncSeparate(srcColorBlend, dstBlend, srcAlpha, dstBlend);
}

function reapplyBatcherBlendFunc(batcher) {
  const gl = batcher && batcher.context && batcher.context.gl;
  if (!gl) return;
  if (batcher.srcColorBlend !== undefined) {
    applyBatcherBlendFunc(gl, batcher.srcColorBlend, batcher.dstBlend, batcher.srcAlphaBlend);
  } else if (batcher.srcBlend !== undefined) {
    applyBatcherBlendFunc(gl, batcher.srcBlend, batcher.dstBlend);
  }
}

function patchRuntimeBatcherAlpha(runtimeApi) {
  // 3.x exposes spine.webgl.PolygonBatcher; 4.x exports it flat on spine.
  const webgl = runtimeApi && runtimeApi.webgl && runtimeApi.webgl.PolygonBatcher ? runtimeApi.webgl : runtimeApi;
  const batcherPrototype = webgl && webgl.PolygonBatcher && webgl.PolygonBatcher.prototype;
  if (!batcherPrototype || batcherPrototype.__spineViewerAlphaPatch) return;
  if (typeof batcherPrototype.begin !== "function" || typeof batcherPrototype.setBlendMode !== "function") return;

  const originalBegin = batcherPrototype.begin;
  const originalSetBlendMode = batcherPrototype.setBlendMode;

  batcherPrototype.begin = function beginPatched(...args) {
    const result = originalBegin.apply(this, args);
    reapplyBatcherBlendFunc(this);
    return result;
  };
  batcherPrototype.setBlendMode = function setBlendModePatched(...args) {
    const result = originalSetBlendMode.apply(this, args);
    if (this.isDrawing) reapplyBatcherBlendFunc(this);
    return result;
  };
  batcherPrototype.__spineViewerAlphaPatch = true;
}

function patchRuntimeDownloader(runtimeApi) {
  const downloaderPrototype = runtimeApi && runtimeApi.Downloader && runtimeApi.Downloader.prototype;
  if (!downloaderPrototype || downloaderPrototype.__spineViewerUtf8Patch) return;

  downloaderPrototype.dataUriToString = function dataUriToString(dataUri) {
    if (!dataUri.startsWith("data:")) throw new Error("Not a data URI.");
    const commaIndex = dataUri.indexOf(",");
    const meta = dataUri.slice(0, commaIndex).toLowerCase();
    const payload = dataUri.slice(commaIndex + 1);
    if (meta.includes(";base64")) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new TextDecoder("utf-8").decode(bytes);
    }
    return decodeURIComponent(payload);
  };
  downloaderPrototype.__spineViewerUtf8Patch = true;
}

function patchRuntimeRendererResolution(runtimeApi) {
  // Empty attachment frames return infinite bounds in legacy runtimes.
  // Keep those frames from poisoning the full-animation camera viewport.
  const playerPrototype = runtimeApi && runtimeApi.SpinePlayer && runtimeApi.SpinePlayer.prototype;
  if (playerPrototype && playerPrototype.calculateAnimationViewport && !playerPrototype.__finiteBoundsPatch) {
    const calculate = playerPrototype.calculateAnimationViewport;
    playerPrototype.calculateAnimationViewport = function (...args) {
      const skeleton = this.skeleton;
      const getBounds = skeleton.getBounds;
      let last = { x: 0, y: 0, width: 0, height: 0 };
      skeleton.getBounds = function (offset, size, ...rest) {
        getBounds.call(this, offset, size, ...rest);
        if ([offset.x, offset.y, size.x, size.y].every(Number.isFinite) && size.x >= 0 && size.y >= 0) {
          last = { x: offset.x, y: offset.y, width: size.x, height: size.y };
        } else {
          offset.x = last.x; offset.y = last.y;
          size.x = last.width; size.y = last.height;
        }
      };
      try { return calculate.apply(this, args); }
      finally { skeleton.getBounds = getBounds; }
    };
    playerPrototype.__finiteBoundsPatch = true;
  }
  const webgl = runtimeApi && runtimeApi.webgl;
  const rendererPrototype = webgl && webgl.SceneRenderer && webgl.SceneRenderer.prototype;
  if (!rendererPrototype) return;
  if (rendererPrototype.__spineViewerDprPatch) {
    document.documentElement.dataset.rendererDprMode = "patched";
    return;
  }
  if (typeof rendererPrototype.getSafeDevicePixelRatio === "function") {
    document.documentElement.dataset.rendererDprMode = "native";
    return;
  }

  rendererPrototype.getSafeDevicePixelRatio = function getSafeDevicePixelRatio(cssWidth, cssHeight) {
    const dpr = window.devicePixelRatio || 1;
    if (cssWidth <= 0 || cssHeight <= 0) return dpr;
    if (!this.maxCanvasWidth || !this.maxCanvasHeight) {
      const gl = this.context.gl;
      const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
      const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      this.maxCanvasWidth = Math.min(maxRenderbufferSize, maxViewportDims[0]);
      this.maxCanvasHeight = Math.min(maxRenderbufferSize, maxViewportDims[1]);
    }
    return Math.min(dpr, this.maxCanvasWidth / cssWidth, this.maxCanvasHeight / cssHeight);
  };

  rendererPrototype.resize = function resize(resizeMode) {
    const canvas = this.canvas;
    const dpr = this.getSafeDevicePixelRatio(canvas.clientWidth, canvas.clientHeight);
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.context.gl.viewport(0, 0, canvas.width, canvas.height);

    const resizeModes = webgl.ResizeMode || {};
    if (resizeMode === resizeModes.Expand) {
      this.camera.setViewport(width, height);
    } else if (resizeMode === resizeModes.Fit) {
      const sourceWidth = canvas.width;
      const sourceHeight = canvas.height;
      const targetWidth = this.camera.viewportWidth;
      const targetHeight = this.camera.viewportHeight;
      const targetRatio = targetHeight / targetWidth;
      const sourceRatio = sourceHeight / sourceWidth;
      const scale = targetRatio < sourceRatio ? targetWidth / sourceWidth : targetHeight / sourceHeight;
      this.camera.viewportWidth = sourceWidth * scale;
      this.camera.viewportHeight = sourceHeight * scale;
    }
    this.camera.update();
  };
  rendererPrototype.__spineViewerDprPatch = true;
  document.documentElement.dataset.rendererDprMode = "patched";
}

function getAnimationNames(player) {
  const animations = player && player.skeleton && player.skeleton.data && player.skeleton.data.animations;
  return Array.isArray(animations) ? animations.map((animation) => animation.name).filter(Boolean) : [];
}

function getSkinNames(player) {
  const skins = player && player.skeleton && player.skeleton.data && player.skeleton.data.skins;
  return Array.isArray(skins) ? skins.map((skin) => skin.name).filter((name) => name !== undefined && name !== null) : [];
}

function applyMix(item = getActiveSceneItem(), value = Number(elements.mixRange.value)) {
  if (!item || !item.player || !item.player.animationState || !item.player.animationState.data) return;
  item.mix = Number(value);
  item.player.animationState.data.defaultMix = item.mix;
}

function applyPremultipliedAlpha(item = getActiveSceneItem(), value = !item?.premultipliedAlpha) {
  if (!item || !item.player || !item.player.config) return;
  item.premultipliedAlpha = Boolean(value);
  item.premultiplyTouched = true;
  item.player.config.premultipliedAlpha = item.premultipliedAlpha;
  if (item.id === state.activeSceneId) elements.premultiplyToggle.setAttribute('aria-pressed', String(item.premultipliedAlpha));
  if (typeof item.player.drawFrame === "function") item.player.drawFrame(false);
}

function applySpeed(item = getActiveSceneItem(), value = Number(elements.speedRange.value)) {
  if (!item || !item.player) return;
  item.speed = Number(value);
  item.player.speed = item.speed;
  if (item.player.animationState) item.player.animationState.timeScale = item.speed;
}

function applyAnimation(item = getActiveSceneItem(), animationName = elements.animationSelect.value) {
  if (!item || !item.player || !item.player.animationState || !animationName) return;
  item.animationName = animationName;
  applyMix(item, item.mix);
  item.player.config.animation = animationName;
  item.player.config.loop = item.loop;
  if ("playTime" in item.player) item.player.playTime = 0;
  if (typeof item.player.setAnimation === "function") {
    item.player.setAnimation(animationName, item.loop);
  } else {
    item.player.animationState.setAnimation(0, animationName, item.loop);
  }
  applyLoop(item, item.loop);
  item.player.previousViewport = null;
  if (item.player.paused && typeof item.player.play === "function") {
    item.player.play();
    item.paused = false;
  }
  captureBasePreviewViewport(true, item);
  invalidateBaseSceneSize(item);
  applyPreviewZoom(item);
  if (item.id === state.activeSceneId) {
    updatePlaybackButton();
    updateProgressControls();
  }
}

function updateNextAnimationButton() {
  const selected = state.sceneItems.filter((item) => state.selectedSceneIds.has(item.id) && item.animationNames.length > 1);
  const enabled = selected.length > 0;
  elements.nextAnimationButton.disabled = !enabled;
  elements.carouselAnimationToggle.disabled = !state.sceneItems.some((item) => item.animationNames.length > 1);
  elements.carouselAnimationToggle.setAttribute('aria-checked', String(state.carouselEnabled));
}

function advanceSceneAnimation(item) {
  const index = item.animationNames.indexOf(item.animationName);
  const paused = item.player.paused;
  applyAnimation(item, item.animationNames[(index + 1) % item.animationNames.length]);
  if (paused) { item.player.pause(); item.paused = true; }
  item.carouselPending = false;
}

function nextSelectedAnimation() {
  for (const item of state.sceneItems) {
    if (!state.selectedSceneIds.has(item.id) || item.animationNames.length < 2) continue;
    advanceSceneAnimation(item);
  }
  syncControlsFromSceneItem(getActiveSceneItem());
}

function toggleGlobalCarousel() {
  state.carouselEnabled = !state.carouselEnabled;
  state.sceneItems.forEach((item) => { item.carouselPending = false; });
  updateNextAnimationButton(); startProgressLoop();
}

function updateAnimationCarousels() {
  let changed = false;
  for (const item of state.sceneItems) {
    if (!state.carouselEnabled || item.player.paused || item.animationNames.length < 2) continue;
    if (item.carouselPending) {
      advanceSceneAnimation(item);
      changed = changed || item.id === state.activeSceneId;
    }
  }
  if (changed) syncControlsFromSceneItem(getActiveSceneItem());
}

function applyLoop(item = getActiveSceneItem()) {
  if (!item || !item.player) return;
  item.loop = true;
  const animationState = item.player.animationState;
  const entry = animationState && (typeof animationState.getCurrent === "function" ? animationState.getCurrent(0) : animationState.tracks && animationState.tracks[0]);
  if (entry) entry.loop = item.loop;
  if (item.player.config) item.player.config.loop = item.loop;
  if (item.id === state.activeSceneId) updateProgressControls();
}

function refreshSceneViewport(item = getActiveSceneItem()) {
  if (!item || !item.player || !item.animationName) return;
  try {
    if (typeof item.player.setViewport === "function") {
      item.player.setViewport(item.animationName);
      item.player.previousViewport = null;
      captureBasePreviewViewport(true, item);
      invalidateBaseSceneSize(item);
      applyPreviewZoom(item);
    } else if (typeof item.player.setAnimation === "function") {
      const wasPaused = item.player.paused;
      item.player.setAnimation(item.animationName, item.loop);
      applyLoop(item, item.loop);
      if (wasPaused && typeof item.player.pause === "function") item.player.pause();
      item.player.previousViewport = null;
      captureBasePreviewViewport(true, item);
      invalidateBaseSceneSize(item);
      applyPreviewZoom(item);
    }
  } catch (error) {
    console.warn("Spine viewport refresh failed", error);
  }
}

function applySkin(item = getActiveSceneItem(), skinName = elements.skinSelect.value) {
  const player = item && item.player;
  if (!item || !player || !player.skeleton || !skinName) return;
  item.skinName = skinName;

  const skeleton = player.skeleton;
  try {
    if (typeof skeleton.setSkinByName === "function") {
      skeleton.setSkinByName(skinName);
    } else if (skeleton.data && typeof skeleton.data.findSkin === "function") {
      skeleton.setSkin(skeleton.data.findSkin(skinName));
    }
    if (typeof skeleton.setSlotsToSetupPose === "function") skeleton.setSlotsToSetupPose();
    if (player.animationState && typeof player.animationState.apply === "function") {
      player.animationState.apply(skeleton);
    }
    refreshSceneViewport(item);
  } catch (error) {
    setStatus(`皮肤切换失败: ${error.message}`, true);
  }
}

function initializeSceneItem(item) {
  const summary = item.blendSummary;
  const gl = item.player.context && item.player.context.gl;
  if (gl) gl.__opaqueFxCanvas = summary.totalSlots > 0 &&
    (summary.screenSlots === summary.totalSlots || summary.additiveSlots === summary.totalSlots);
  applySceneCompositeMode(item);
  item.animationNames = getAnimationNames(item.player);
  item.skinNames = getSkinNames(item.player);
  item.animationName = item.animationNames[0] || "";
  item.skinName = item.skinNames.includes("default") ? "default" : item.skinNames[0] || "";
  applyMix(item, item.mix);
  applySpeed(item, item.speed);
  if (item.animationName) applyAnimation(item, item.animationName);
  if (item.skinName) applySkin(item, item.skinName);
  captureBasePreviewViewport(true, item);
  applyPreviewZoom(item);
}

function syncControlsFromSceneItem(item) {
  if (!item) {
    elements.premultiplyToggle.setAttribute('aria-pressed', 'true');
    fillNameSelect(elements.animationSelect, [], "未加载");
    fillNameSelect(elements.skinSelect, [], "未加载");
    setControlAvailability(false);
    resetPlaybackDisplay();
    return;
  }

  fillNameSelect(elements.animationSelect, item.animationNames, "无动画");
  fillNameSelect(elements.skinSelect, item.skinNames, "无皮肤");
  setControlAvailability(true);
  elements.animationSelect.disabled = !item.animationNames.length;
  elements.skinSelect.disabled = !item.skinNames.length;
  elements.animationSelect.value = item.animationName;
  elements.skinSelect.value = item.skinName;
  elements.speedRange.value = String(item.speed);
  elements.mixRange.value = String(item.mix);
  elements.premultiplyToggle.setAttribute('aria-pressed', String(item.premultipliedAlpha));
  updateNextAnimationButton();
  updatePlaybackButton();
  updateRangeLabels();
  updateProgressControls();
}

function isLoadablePlayer(player) {
  return Boolean(player && player.skeleton && player.animationState);
}

function handleLegacyRuntimeResize() {
  state.sceneItems.forEach((item) => {
    if (!item.disposed && /^3\./.test(item.runtimeVersion) && typeof item.player.drawFrame === "function") {
      item.player.drawFrame(false);
    }
  });
}

function syncLegacyRuntimeResizeHandler() {
  const hasLegacyScenes = state.sceneItems.some((item) => !item.disposed && /^3\./.test(item.runtimeVersion));
  window.onresize = hasLegacyScenes ? handleLegacyRuntimeResize : null;
  document.documentElement.dataset.legacyResizeMode = hasLegacyScenes ? "dispatcher" : "idle";
}

function initialScenePosition(order) {
  const base = INITIAL_SCENE_OFFSETS[order % INITIAL_SCENE_OFFSETS.length];
  const ring = Math.floor(order / INITIAL_SCENE_OFFSETS.length);
  return {
    x: base[0] + ring * 24,
    y: base[1] + ring * 24,
  };
}

function autoLayoutUntouchedScenes() {
  const items = state.sceneItems.slice().sort((a, b) => a.order - b.order);
  if (!items.length || items.some((item) => item.positionTouched)) return;
  const rect = elements.sceneLayer.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const columns = Math.ceil(Math.sqrt(items.length));
  const rows = Math.ceil(items.length / columns);
  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const next = clampScenePosition(
      item,
      ((column + 0.5) / columns - 0.5) * rect.width,
      ((row + 0.5) / rows - 0.5) * rect.height,
    );
    item.x = next.x;
    item.y = next.y;
    applySceneItemTransform(item);
  });
}

function createSceneElement(item) {
  const element = document.createElement("div");
  element.className = "spine-scene";
  element.dataset.sceneId = item.id;
  element.style.zIndex = String(item.zIndex);

  const mount = document.createElement("div");
  mount.id = `spine-player-${item.id}`;
  mount.className = "spine-player-container";
  const label = document.createElement("div");
  label.className = "scene-label";
  label.textContent = item.project.label;
  const outline = document.createElement('div');
  outline.className = 'scene-outline';
  outline.hidden = true;
  outline.appendChild(label);
  element.append(mount, outline);
  item.outline = outline;
  elements.sceneLayer.appendChild(element);
  item.element = element;
  item.mount = mount;
  applySceneCompositeMode(item);
  applySceneItemTransform(item);
}

async function tryLoadProjectWithRuntime(project, resources, order) {
  const runtimeVersion = project.runtimeVersion;
  setStatus(`正在加载 ${project.label} · runtime ${RUNTIMES[runtimeVersion].label}`);
  const runtimeApi = await loadRuntime(runtimeVersion);
  const position = initialScenePosition(order);
  const item = {
    id: `scene-${state.nextSceneId++}`,
    project,
    order,
    zIndex: state.nextZIndex++,
    x: position.x,
    y: position.y,
    positionTouched: false,
    basePreviewViewport: null,
    originAnchor: null,
    runtimeApi,
    runtimeVersion,
    player: null,
    element: null,
    mount: null,
    animationNames: [],
    skinNames: [],
    animationName: "",
    skinName: "",
    speed: 1,
    mix: 0.2,
    loop: true,
    paused: false,
    premultipliedAlpha: true,
    premultiplyTouched: false,
    blendSummary: resources.blendSummary || createEmptyBlendSummary(),
    baseSceneWidth: 0,
    baseSceneHeight: 0,
    disposed: false,
  };
  createSceneElement(item);

  const skeletonFile = project.skeletonFile;
  const isJson = resources.skeletonIsJson;
  const config = {
    atlasUrl: resources.atlasPath,
    rawDataURIs: resources.rawDataURIs,
    alpha: true,
    backgroundColor: "00000000",
    showControls: false,
    defaultMix: item.mix,
    loop: item.loop,
    premultipliedAlpha: item.premultipliedAlpha,
    viewport: createSafeViewportConfig(),
  };
  if (isJson) {
    config.jsonUrl = resources.skeletonPath;
  } else {
    config[RUNTIMES[runtimeVersion].binaryKey] = resources.skeletonPath;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const fail = (error, player) => {
      if (settled) {
        if (player && player !== item.player) disposeRuntimePlayer(player);
        return;
      }
      disposeRuntimePlayer(player || item.player);
      item.element.remove();
      syncLegacyRuntimeResizeHandler();
      finish(reject, error);
    };
    const timer = setTimeout(() => {
      fail(new Error(`runtime ${RUNTIMES[runtimeVersion].label} 加载超时`));
    }, 10000);

    config.success = (player) => {
      if (settled) {
        disposeRuntimePlayer(player);
        return;
      }
      if (item.disposed) {
        fail(new Error("动画已取消加载"), player);
        return;
      }
      item.player = player;
      player.__spineViewerRuntimeApi = runtimeApi;
      if (!isLoadablePlayer(player)) {
        fail(new Error(`runtime ${RUNTIMES[runtimeVersion].label} 未返回可用骨骼`), player);
        return;
      }
      initializeSceneItem(item);
      player.animationState.addListener({ complete(entry) {
        const current = player.animationState.getCurrent?.(0) || player.animationState.tracks?.[0];
        if (entry === current && state.carouselEnabled && !player.paused && !item.measuringBounds && !(state.progressDragging && item.id === state.activeSceneId)) item.carouselPending = true;
      } });
      finish(resolve, item);
    };
    config.error = (player, message) => {
      fail(new Error(message || `runtime ${RUNTIMES[runtimeVersion].label} 加载失败`), player);
    };

    try {
      item.player = new runtimeApi.SpinePlayer(item.mount, config);
      if (item.player) item.player.__spineViewerRuntimeApi = runtimeApi;
      if (/^3\./.test(runtimeVersion)) syncLegacyRuntimeResizeHandler();
    } catch (error) {
      fail(error);
    }
  });
}

function selectSceneItem(sceneId, { preserveSelection = false } = {}) {
  const item = getSceneItemById(sceneId);
  if (!item) return;
  if (!preserveSelection) state.selectedSceneIds.clear();
  state.selectedSceneIds.add(sceneId);
  state.activeSceneId = item.id;
  state.player = item.player;
  state.loaded = Boolean(item.player);
  state.activeProjectIndex = state.projects.findIndex((project) => project.key === item.project.key);
  state.detectedRuntime = item.runtimeVersion;
  window.spine = item.runtimeApi;
  ensureRuntimeStyle(item.runtimeVersion);

  state.sceneItems.forEach((candidate) => {
    candidate.element.classList.toggle("is-active", candidate.id === item.id);
    candidate.element.classList.toggle('is-selected', state.selectedSceneIds.has(candidate.id));
    if (state.selectedSceneIds.has(candidate.id)) updateSceneOutline(candidate);
  });
  elements.playerMount.dataset.previewZoom = state.previewZoom.toFixed(3);
  renderLayerList();
  syncControlsFromSceneItem(item);
  updateProjectHint(item);
  startProgressLoop();
}

async function loadProjectsIntoScene(projects) {
  const token = ++state.loadToken;
  const errors = [];
  let loadedCount = 0;
  for (const project of projects) {
    if (token !== state.loadToken) return;
    try {
      setStatus(`正在准备 ${project.label}`);
      const resources = await buildRawDataURIs(project.skeletonFile, project.atlasFile);
      if (token !== state.loadToken) return;
      if (resources.atlasPages.length && resources.missingImages.length) {
        throw new Error(`${project.label} 缺少贴图: ${resources.missingImages.join(", ")}`);
      }

      const nextOrder = state.sceneItems.reduce((max, item) => Math.max(max, item.order), -1) + 1;
      const item = await tryLoadProjectWithRuntime(project, resources, nextOrder);
      if (token !== state.loadToken) {
        item.disposed = true;
        disposeRuntimePlayer(item.player);
        item.element.remove();
        return;
      }
      state.sceneItems.push(item);
      syncViewerPlayback();
      syncLegacyRuntimeResizeHandler();
      loadedCount += 1;
      syncResetControl();
      updateEmptyState();
      autoLayoutUntouchedScenes();
      if (!state.activeSceneId) selectSceneItem(item.id);
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }

  syncResetControl();
  updateEmptyState();
  if (getActiveSceneItem()) selectSceneItem(state.activeSceneId, { preserveSelection: true });
  if (errors.length) {
    setStatus(`${loadedCount ? `已新增 ${loadedCount} 个动画；` : ""}${errors.join("；")}`, true);
  } else {
    setStatus(`已新增 ${loadedCount} 个动画，画布共 ${state.sceneItems.length} 个`);
  }
}

function togglePlayback() {
  const item = getActiveSceneItem();
  if (!item || !item.player) return;
  if (item.player.paused) {
    if (typeof item.player.play === "function") item.player.play();
    item.paused = false;
    updatePlaybackButton();
  } else {
    if (typeof item.player.pause === "function") item.player.pause();
    item.paused = true;
    updatePlaybackButton();
  }
  updateProgressControls();
}

function enqueueFiles(files) {
  const nextFiles = [...files];
  state.importQueue = state.importQueue
    .then(() => classifyFiles(nextFiles))
    .catch((error) => setStatus(error.message || String(error), true))
    .finally(() => {
      elements.filePicker.value = "";
    });
  return state.importQueue;
}

function setBackgroundFile(file) {
  if (!file) return;
  const token = ++state.backgroundLoadToken;
  const nextUrl = URL.createObjectURL(file);
  const probe = new Image();
  probe.onload = () => {
    if (token !== state.backgroundLoadToken) {
      URL.revokeObjectURL(nextUrl);
      return;
    }
    const previousUrl = state.backgroundObjectUrl;
    state.backgroundObjectUrl = nextUrl;
    state.backgroundNaturalWidth = probe.naturalWidth;
    state.backgroundNaturalHeight = probe.naturalHeight;
    elements.backgroundImage.src = nextUrl;
    elements.backgroundImage.hidden = false;
    applyBackgroundPreviewZoom();
    elements.backgroundHint.textContent = `${file.name} · ${probe.naturalWidth} × ${probe.naturalHeight}`;
    elements.clearBackgroundButton.disabled = false;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    updateEmptyState();
    setStatus(`已设置背景 ${file.name}`);
  };
  probe.onerror = () => {
    URL.revokeObjectURL(nextUrl);
    if (token !== state.backgroundLoadToken) return;
    setStatus(`背景图片无法读取: ${file.name}`, true);
  };
  probe.src = nextUrl;
}

function clearBackground() {
  state.backgroundLoadToken += 1;
  if (state.backgroundObjectUrl) URL.revokeObjectURL(state.backgroundObjectUrl);
  state.backgroundObjectUrl = "";
  state.backgroundNaturalWidth = 0;
  state.backgroundNaturalHeight = 0;
  elements.backgroundImage.removeAttribute("src");
  elements.backgroundImage.style.width = "";
  elements.backgroundImage.style.height = "";
  elements.backgroundImage.hidden = true;
  elements.backgroundHint.textContent = "未设置背景";
  elements.clearBackgroundButton.disabled = true;
  updateEmptyState();
}

function pixelHasArtwork(gl, rgba, offset = 0) {
  const color = Math.max(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
  return color > 1 || (!gl.__opaqueFxCanvas && rgba[offset + 3] > 1);
}

function getFixedArtworkBounds(item) {
  const v = captureBasePreviewViewport(false, item);
  const key = `${item.animationName}|${item.skinName}|${JSON.stringify(v)}`;
  item.artworkBoundsCache ||= new Map();
  let normalized = item.artworkBoundsCache.get(key);
  if (!normalized) {
    const player = item.player, element = item.element;
    const savedWidth = element.style.width, savedHeight = element.style.height;
    const paused = player.paused;
    const entry = player.animationState.getCurrent?.(0) || player.animationState.tracks?.[0];
    const fields = ['trackTime', 'trackLast', 'nextTrackLast', 'animationLast', 'nextAnimationLast'];
    const saved = Object.fromEntries(fields.map((name) => [name, entry?.[name]]));
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    item.measuringBounds = true; player.paused = true;
    try {
      const size = captureBaseSceneSize(v, false, item) || { width: 64, height: 64 };
      const factor = 256 / Math.max(1, size.width, size.height) / (window.devicePixelRatio || 1);
      element.style.width = `${Math.max(4, Math.round(size.width * factor))}px`;
      element.style.height = `${Math.max(4, Math.round(size.height * factor))}px`;
      const duration = getTrackTiming(entry)?.duration || 0;
      // A fixed envelope across the animation remains selectable during fades.
      for (let sample = 0; sample <= (duration ? 16 : 0); sample++) {
        if (entry && duration) entry.trackTime = duration * Math.min(.9999, sample / 16);
        player.skeleton.setToSetupPose();
        player.animationState.apply(player.skeleton);
        updateWorldTransformForPlayer(player);
        drawSceneFrame(item);
        const gl = player.context.gl, width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
        if (!width || !height || width * height > 1024 * 1024 || gl.isContextLost()) continue;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const canvas = player.canvas.getBoundingClientRect(), r = element.getBoundingClientRect();
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          if (!pixelHasArtwork(gl, pixels, (y * width + x) * 4)) continue;
          minX = Math.min(minX, (canvas.left - r.left + x / width * canvas.width) / r.width);
          maxX = Math.max(maxX, (canvas.left - r.left + (x + 1) / width * canvas.width) / r.width);
          minY = Math.min(minY, (canvas.top - r.top + (height - y - 1) / height * canvas.height) / r.height);
          maxY = Math.max(maxY, (canvas.top - r.top + (height - y) / height * canvas.height) / r.height);
        }
      }
    } finally {
      if (entry) for (const name of fields) if (saved[name] !== undefined) entry[name] = saved[name];
      element.style.width = savedWidth; element.style.height = savedHeight;
      player.skeleton.setToSetupPose(); player.animationState.apply(player.skeleton);
      updateWorldTransformForPlayer(player); drawSceneFrame(item);
      player.paused = paused; item.measuringBounds = false;
    }
    if (maxX <= minX || maxY <= minY) {
      const width = Math.max(1, (v?.width || 1) + (v?.padLeft || 0) + (v?.padRight || 0));
      const height = Math.max(1, (v?.height || 1) + (v?.padTop || 0) + (v?.padBottom || 0));
      minX = (v?.padLeft || 0) / width; maxX = minX + (v?.width || 1) / width;
      minY = (v?.padTop || 0) / height; maxY = minY + (v?.height || 1) / height;
    }
    normalized = { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
    item.artworkBoundsCache.set(key, normalized);
  }
  return { left: normalized.left * item.element.offsetWidth, top: normalized.top * item.element.offsetHeight, width: normalized.width * item.element.offsetWidth, height: normalized.height * item.element.offsetHeight };
}

function hitTestScene(clientX, clientY) {
  for (const item of getLayerItemsTopFirst()) {
    if (item.disposed || !item.player?.canvas) continue;
    const r = item.element.getBoundingClientRect(), b = getFixedArtworkBounds(item);
    if (clientX >= r.left + b.left - 4 && clientX <= r.left + b.left + b.width + 4 && clientY >= r.top + b.top - 4 && clientY <= r.top + b.top + b.height + 4) return item;
  }
  return null;
}

function updateSceneOutline(item) {
  if (!item.player?.canvas || !item.outline || item.disposed) return;
  showSceneOutline(item, getFixedArtworkBounds(item));
}

function showSceneOutline(item, bounds) {
  item.visibleBounds = bounds;
  item.outline.hidden = false;
  Object.assign(item.outline.style, { left: `${bounds.left - 3}px`, top: `${bounds.top - 3}px`, width: `${bounds.width + 6}px`, height: `${bounds.height + 6}px` });
}

function clearSceneSelection() {
  state.selectedSceneIds.clear();
  state.activeSceneId = '';
  state.player = null;
  state.loaded = false;
  state.sceneItems.forEach((item) => item.element.classList.remove('is-active', 'is-selected'));
  renderLayerList();
  syncControlsFromSceneItem(null);
  updateProjectHint();
  if ((state.carouselEnabled && state.sceneItems.length > 0)) startProgressLoop();
  else stopProgressLoop();
}

function selectFromList(sceneId, event) {
  const ids = getLayerItemsTopFirst().map((item) => item.id);
  const additive = event.ctrlKey || event.metaKey;
  if (event.shiftKey && ids.includes(state.selectionAnchorId)) {
    if (!additive) state.selectedSceneIds.clear();
    const from = ids.indexOf(state.selectionAnchorId), to = ids.indexOf(sceneId);
    ids.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((id) => state.selectedSceneIds.add(id));
  } else {
    if (!additive) state.selectedSceneIds.clear();
    if (additive && state.selectedSceneIds.has(sceneId)) state.selectedSceneIds.delete(sceneId);
    else state.selectedSceneIds.add(sceneId);
    state.selectionAnchorId = sceneId;
  }
  const activeId = state.selectedSceneIds.has(sceneId) ? sceneId : ids.find((id) => state.selectedSceneIds.has(id));
  if (activeId) selectSceneItem(activeId, { preserveSelection: true });
  else clearSceneSelection();
}

function beginSceneDrag(event) {
  if (state.dragState) return;
  if (event.target.closest?.('button,input,[role="toolbar"]')) return;
  if (event.button === 2) {
    state.dragState = { mode: 'pan', pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, panX: state.canvasPanX, panY: state.canvasPanY, items: state.sceneItems.map((item) => ({ id: item.id, x: item.x, y: item.y })) };
    elements.playerMount.setPointerCapture(event.pointerId);
    elements.playerMount.classList.add('is-panning');
    event.preventDefault(); return;
  }
  if (event.button !== 0) return;
  const item = hitTestScene(event.clientX, event.clientY);
  if (!item) { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) clearSceneSelection(); return; }
  if (event.ctrlKey || event.metaKey || event.shiftKey) { selectFromList(item.id, event); event.preventDefault(); return; }
  selectSceneItem(item.id, { preserveSelection: state.selectedSceneIds.has(item.id) });
  const pointerTarget = elements.playerMount;
  pointerTarget.setPointerCapture(event.pointerId);
  const items = state.sceneItems.filter((candidate) => state.selectedSceneIds.has(candidate.id));
  items.forEach((candidate) => candidate.element.classList.add('is-dragging'));
  state.dragState = {
    itemId: item.id,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    items: items.map((candidate) => ({ id: candidate.id, x: candidate.x, y: candidate.y })),
  };
  event.preventDefault();
}

function moveSceneDrag(event) {
  const drag = state.dragState;
  if (!drag || drag.pointerId !== event.pointerId) return;
  let dx = event.clientX - drag.startClientX, dy = event.clientY - drag.startClientY;
  const items = drag.items.map((start) => ({ start, item: getSceneItemById(start.id) })).filter(({ item }) => item);
  if (drag.mode === 'pan') {
    state.canvasPanX = drag.panX + dx; state.canvasPanY = drag.panY + dy;
    for (const { start, item } of items) { item.x = start.x + dx; item.y = start.y + dy; item.positionTouched = true; applySceneItemTransform(item); }
    applyBackgroundPreviewZoom(); syncCanvasGrid();
    event.preventDefault(); return;
  }
  let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
  for (const { start, item } of items) {
    const min = clampScenePosition(item, -1e9, -1e9), max = clampScenePosition(item, 1e9, 1e9);
    minX = Math.max(minX, min.x - start.x); maxX = Math.min(maxX, max.x - start.x);
    minY = Math.max(minY, min.y - start.y); maxY = Math.min(maxY, max.y - start.y);
  }
  if (minX <= maxX) dx = clamp(dx, minX, maxX);
  if (minY <= maxY) dy = clamp(dy, minY, maxY);
  for (const { start, item } of items) {
    item.x = start.x + dx; item.y = start.y + dy;
    item.positionTouched = true;
    applySceneItemTransform(item);
  }
  event.preventDefault();
}

function endSceneDrag(event) {
  const drag = state.dragState;
  if (!drag || (event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
  state.dragState = null;
  elements.playerMount.classList.remove('is-panning');
  for (const start of drag.items) {
    const item = getSceneItemById(start.id);
    if (item) { item.element.classList.remove('is-dragging'); updateSceneOutline(item); }
  }
  if (elements.playerMount.hasPointerCapture(drag.pointerId)) elements.playerMount.releasePointerCapture(drag.pointerId);
}

function handleSceneDoubleClick(event) {
  if (event.target.closest?.('button,input,[role="toolbar"]')) return;
  const item = hitTestScene(event.clientX, event.clientY);
  if (!item) return;
  selectSceneItem(item.id);
  resetSceneTransform(item);
  event.preventDefault();
}

function bindEvents() {
  elements.dropZone.addEventListener("click", () => elements.filePicker.click());
  elements.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); elements.filePicker.click(); }
  });
  elements.filePicker.addEventListener("change", () => enqueueFiles(elements.filePicker.files));
  elements.resetTransformButton.addEventListener("click", resetSceneLayout);
  elements.pickBackgroundButton.addEventListener("click", () => elements.backgroundPicker.click());
  elements.backgroundPicker.addEventListener("change", () => {
    setBackgroundFile(elements.backgroundPicker.files[0]);
    elements.backgroundPicker.value = "";
  });
  elements.clearBackgroundButton.addEventListener("click", clearBackground);
  elements.animationSelect.addEventListener("change", () => applyAnimation());
  elements.nextAnimationButton.addEventListener('click', nextSelectedAnimation);
  elements.carouselAnimationToggle.addEventListener('click', toggleGlobalCarousel);
  elements.skinSelect.addEventListener("change", () => applySkin());
  elements.speedRange.addEventListener("input", () => {
    updateRangeLabels();
    applySpeed();
  });
  elements.mixRange.addEventListener("input", () => {
    updateRangeLabels();
    applyMix();
  });
  elements.premultiplyToggle.addEventListener("click", () => {
    applyPremultipliedAlpha();
  });
  elements.playPauseButton.addEventListener("click", togglePlayback);
  elements.actualSizeButton.addEventListener("click", () => resetPreviewZoomToActualSize());
  elements.autoFitButton.addEventListener("click", fitPreviewToCanvas);
  elements.moveLayerUp.addEventListener('click', () => moveSceneLayer(state.activeSceneId, 'up'));
  elements.moveLayerDown.addEventListener('click', () => moveSceneLayer(state.activeSceneId, 'down'));
  elements.layerList.addEventListener("click", (event) => {
    const button = event.target.closest && event.target.closest("button[data-action]");
    const row = button && button.closest(".layer-item");
    if (!button || !row) return;
    const sceneId = row.dataset.sceneId;
    if (button.dataset.action === "select") {
      selectFromList(sceneId, event);
      focusActiveLayer();
    } else if (button.dataset.action === "remove") {
      removeSceneItem(sceneId);
    }
  });
  elements.layerList.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.layer-item');
    const action = event.target.closest('button')?.dataset.action;
    if (!row || !event.dataTransfer || (action && action !== 'select')) { event.preventDefault(); return; }
    layerDragId = row.dataset.sceneId;
    event.dataTransfer.setData('application/x-foart-spine-layer', layerDragId);
    event.dataTransfer.effectAllowed = 'move';
    row.classList.add('is-layer-dragging');
  });
  elements.layerList.addEventListener('dragover', (event) => {
    if (!layerDragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    elements.layerList.querySelectorAll('.layer-item').forEach((row) => row.classList.remove('drop-before', 'drop-after'));
    const row = event.target.closest('.layer-item');
    if (!row || row.dataset.sceneId === layerDragId) return;
    const rect = row.getBoundingClientRect();
    row.classList.add(event.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
    if (event.clientY < elements.layerList.getBoundingClientRect().top + 24) elements.layerList.scrollTop -= 12;
    else if (event.clientY > elements.layerList.getBoundingClientRect().bottom - 24) elements.layerList.scrollTop += 12;
  });
  elements.layerList.addEventListener('drop', handleLayerDrop);
  elements.layerList.addEventListener('dragend', clearLayerDrag);
  document.addEventListener('keydown', handleLayerShortcut);
  elements.playerMount.tabIndex = 0;
  elements.playerMount.addEventListener('pointerdown', () => elements.playerMount.focus({ preventScroll: true }));
  elements.progressRange.addEventListener("pointerdown", beginTimelineScrub);
  elements.progressRange.addEventListener("input", () => {
    seekProgress(elements.progressRange.value);
  });
  ["pointerup", "pointercancel", "change", "blur"].forEach((eventName) => {
    elements.progressRange.addEventListener(eventName, endTimelineScrub);
  });
  window.addEventListener('pointerup', () => { if (state.progressDragging) endTimelineScrub(); });
  elements.timeInput.addEventListener('input', () => {
    const timing = getTrackTiming(getCurrentTrackEntry());
    if (timing && elements.timeInput.value !== '') seekProgress(Number(elements.timeInput.value) / timing.duration);
  });
  elements.timeInput.addEventListener('blur', updateProgressControls);
  elements.timeInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') elements.timeInput.blur(); });
  elements.playerMount.addEventListener("wheel", handlePreviewWheel, { passive: false });
  elements.playerMount.addEventListener("pointerdown", beginSceneDrag);
  elements.playerMount.addEventListener("pointermove", moveSceneDrag);
  elements.playerMount.addEventListener("pointerup", endSceneDrag);
  elements.playerMount.addEventListener("pointercancel", endSceneDrag);
  elements.playerMount.addEventListener("lostpointercapture", endSceneDrag);
  elements.playerMount.addEventListener("dblclick", handleSceneDoubleClick);
  elements.playerMount.addEventListener('contextmenu', (event) => { if (!event.target.closest?.('button,input,[role="toolbar"]')) event.preventDefault(); });
  window.addEventListener("blur", () => endSceneDrag({}));
  window.addEventListener("resize", () => {
    state.sceneItems.forEach((item) => {
      invalidateBaseSceneSize(item);
      applyPreviewZoom(item);
      const next = clampScenePosition(item, item.x, item.y);
      item.x = next.x;
      item.y = next.y;
      applySceneItemTransform(item);
    });
  });
  window.addEventListener("beforeunload", () => {
    disposePlayer();
    if (state.backgroundObjectUrl) URL.revokeObjectURL(state.backgroundObjectUrl);
  });

  [elements.dropZone, elements.playerMount].forEach(bindFileDrop);
  ['dragover', 'drop'].forEach((type) => document.addEventListener(type, (event) => {
    if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault();
  }));
}

function bindFileDrop(zone) {
  ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    zone.classList.add('drag-over');
  }));
  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove('drag-over');
  });
  zone.addEventListener('drop', async (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    zone.classList.remove('drag-over');
    try { await enqueueFiles(await filesFromDrop(event.dataTransfer)); }
    catch (error) { setStatus(`导入失败：${error.message || error}`, true); }
  });
}

async function filesFromDrop(transfer) {
  // Capture entries during the drop event; the browser locks its data store afterwards.
  const entries = Array.from(transfer.items || []).map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  const fallback = Array.from(transfer.files || []);
  if (!entries.length) return fallback;
  const files = [];
  async function visit(entry, prefix = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      Object.defineProperty(file, 'webkitRelativePath', { value: prefix + file.name });
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      while (true) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await visit(child, prefix + entry.name + '/');
      }
    }
  }
  for (const entry of entries) await visit(entry);
  return files;
}

async function fileFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`资源读取失败: ${url}`);
  const blob = await response.blob();
  const cleanUrl = url.split("?")[0].split("#")[0];
  const name = decodeURIComponent(cleanUrl.slice(cleanUrl.lastIndexOf("/") + 1)) || "asset";
  return new File([blob], name, { type: blob.type || "application/octet-stream" });
}

async function loadFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const skeletonUrl = params.get("skeleton");
  const atlasUrl = params.get("atlas");
  if (!skeletonUrl || !atlasUrl) return;

  const imageUrls = [
    ...params.getAll("image"),
    ...params
      .getAll("images")
      .flatMap((value) => String(value || "").split(","))
      .map((item) => item.trim())
      .filter(Boolean),
  ];

  try {
    setStatus("正在读取 URL 资源");
    const files = await Promise.all([skeletonUrl, atlasUrl, ...imageUrls].map(fileFromUrl));
    await enqueueFiles(files);
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
}

// Keep imported files and scene positions when changing tools. Only players that
// were running are resumed; an animation paused by the user stays paused.
let viewerHostActive = true;
const viewerSuspendedPlayers = new Set();
function viewerIsActive() { return viewerHostActive && !document.hidden; }
function syncViewerPlayback() {
  const visible = viewerIsActive();
  state.sceneItems.forEach((item) => {
    if (!visible && !item.player.paused) {
      viewerSuspendedPlayers.add(item.player);
      item.player.pause();
    } else if (visible && viewerSuspendedPlayers.delete(item.player)) {
      item.player.play();
    }
  });
  for (const player of viewerSuspendedPlayers) {
    if (!state.sceneItems.some((item) => item.player === player)) viewerSuspendedPlayers.delete(player);
  }
  if (visible) {
    syncControlsFromSceneItem(getActiveSceneItem());
    if (state.loaded || (state.carouselEnabled && state.sceneItems.length > 0)) startProgressLoop();
  } else stopProgressLoop();
}
window.NovaFlowSpineViewer = {
  setActive(value) { viewerHostActive = Boolean(value); syncViewerPlayback(); },
};
document.addEventListener("visibilitychange", syncViewerPlayback);

fillNameSelect(elements.animationSelect, [], "未加载");
fillNameSelect(elements.skinSelect, [], "未加载");
updateRangeLabels();
resetPlaybackDefaults();
bindEvents();
loadFromQuery();
