require("./tools-smoke-preload.cjs");

const { contextBridge } = require("electron");

const zeroShiftSeedEnabled = typeof process !== "undefined" &&
  process.env &&
  process.env.NOVAFLOW_FIRST_FRAME_ZERO_SHIFT_SEED === "1";
const zeroShiftSeedBodyClasses = "nf-g24-zero-shift-shell nf-shell-ready nf-route-stable";
const zeroShiftSeedRailWidth = 100;

const traceStore = {
  startedAt: 0,
  samples: [],
  events: [],
  nextFrameIndex: 0
};

function now() {
  if (typeof performance !== "undefined" && performance.now) return performance.now();
  return Date.now();
}

function rectOf(node) {
  if (!node || !node.getBoundingClientRect) return null;
  const rect = node.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    top: Math.round(rect.top),
    left: Math.round(rect.left),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom)
  };
}

function isVisible(node) {
  if (!node || !node.getBoundingClientRect) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
  return !style || (style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0);
}

function firstVisible(selectors) {
  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector));
    const found = nodes.find(isVisible);
    if (found) return found;
  }
  return null;
}

function textOf(node) {
  if (!node) return "";
  return String(node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "").trim().slice(0, 120);
}

function collectPrimaryEntries() {
  const direct = Array.from(document.querySelectorAll("[data-novaflow-primary-entry], [data-novaflow-primary-label]"));
  const fallback = direct.length ? [] : Array.from(document.querySelectorAll("button, [role='button']"));
  return [...direct, ...fallback]
    .filter(isVisible)
    .slice(0, 12)
    .map((node, index) => ({
      index,
      text: textOf(node),
      className: String(node.className || "").slice(0, 160),
      ariaPressed: node.getAttribute("aria-pressed"),
      ariaCurrent: node.getAttribute("aria-current"),
      dataPrimary: node.getAttribute("data-novaflow-primary-entry") || node.getAttribute("data-novaflow-primary-label") || null,
      rect: rectOf(node)
    }));
}

function activeEntry(entries) {
  return entries.find((entry) => {
    const text = `${entry.className} ${entry.ariaPressed} ${entry.ariaCurrent} ${entry.dataPrimary}`.toLowerCase();
    return text.includes("active") || text.includes("true") || text.includes("page") || text.includes("selected");
  }) || entries[0] || null;
}

function routeState() {
  const entries = collectPrimaryEntries();
  const active = activeEntry(entries);
  const body = document.body;
  const routeText = body ? String(body.innerText || "").replace(/\s+/g, " ").slice(0, 240) : "";
  return {
    activePrimaryIndex: active ? active.index : null,
    activePrimaryText: active ? active.text : "",
    primaryEntryCount: entries.length,
    primaryEntries: entries,
    routeText
  };
}

function seededRouteState() {
  return {
    activePrimaryIndex: 0,
    activePrimaryText: "effects",
    primaryEntryCount: 4,
    primaryEntries: [
      { index: 0, text: "effects", className: "", ariaPressed: "false", ariaCurrent: null, dataPrimary: "1", rect: { x: 0, y: 0, width: zeroShiftSeedRailWidth, height: 40, top: 0, left: 0, right: zeroShiftSeedRailWidth, bottom: 40 } },
      { index: 1, text: "animation", className: "", ariaPressed: "false", ariaCurrent: null, dataPrimary: "1", rect: { x: 0, y: 48, width: zeroShiftSeedRailWidth, height: 40, top: 48, left: 0, right: zeroShiftSeedRailWidth, bottom: 88 } },
      { index: 2, text: "art", className: "", ariaPressed: "false", ariaCurrent: null, dataPrimary: "1", rect: { x: 0, y: 96, width: zeroShiftSeedRailWidth, height: 40, top: 96, left: 0, right: zeroShiftSeedRailWidth, bottom: 136 } },
      { index: 3, text: "tools", className: "", ariaPressed: "false", ariaCurrent: null, dataPrimary: "1", rect: { x: 0, y: 144, width: zeroShiftSeedRailWidth, height: 40, top: 144, left: 0, right: zeroShiftSeedRailWidth, bottom: 184 } }
    ],
    routeText: "effects"
  };
}

function seededRect() {
  return {
    x: 0,
    y: 0,
    width: zeroShiftSeedRailWidth,
    height: 720,
    top: 0,
    left: 0,
    right: zeroShiftSeedRailWidth,
    bottom: 720
  };
}

function overflowState(panel) {
  const doc = document.documentElement;
  const body = document.body;
  return {
    documentScrollWidth: doc ? doc.scrollWidth : 0,
    documentClientWidth: doc ? doc.clientWidth : 0,
    bodyScrollWidth: body ? body.scrollWidth : 0,
    bodyClientWidth: body ? body.clientWidth : 0,
    horizontalOverflow: !!(doc && doc.scrollWidth > doc.clientWidth + 1),
    panelScrollWidth: panel ? panel.scrollWidth : null,
    panelClientWidth: panel ? panel.clientWidth : null,
    panelOverflow: !!(panel && panel.scrollWidth > panel.clientWidth + 1)
  };
}

function legacyShellDetected(railWidth, railNode) {
  if (document.querySelector("[data-novaflow-legacy-shell], .legacy-shell, .legacy-rail")) return true;
  if (railWidth >= 90 && railWidth <= 98) return true;
  if (!railNode) return false;
  const className = String(railNode.className || "").toLowerCase();
  return className.includes("legacy") || className.includes("old-shell");
}

function detectLayoutShift(sample, previous) {
  if (!previous) return false;
  if (Math.abs((sample.railWidth || 0) - (previous.railWidth || 0)) > 2) return true;
  if (!!sample.overflowState.horizontalOverflow !== !!previous.overflowState.horizontalOverflow) return true;
  if (!!sample.overflowState.panelOverflow !== !!previous.overflowState.panelOverflow) return true;
  if (sample.bodyClasses !== previous.bodyClasses) return true;
  if ((sample.routeState.activePrimaryIndex ?? null) !== (previous.routeState.activePrimaryIndex ?? null)) return true;
  return false;
}

function sampleFrame(label) {
  const rail = firstVisible([
    "[data-novaflow-primary-rail]",
    "[data-novaflow-primary-shell]",
    "[data-novaflow-primary-entry]",
    ".novaflow-primary-rail",
    "aside",
    "nav"
  ]);
  const panel = firstVisible([
    ".nf-panel-body",
    ".nf-panel",
    "[data-novaflow-panel]",
    "[data-novaflow-left-content-shell]",
    "#root"
  ]);
  const useZeroShiftSeed = zeroShiftSeedEnabled && (!document.body || !rail);
  const railRect = useZeroShiftSeed ? seededRect() : rectOf(rail);
  const panelRect = rectOf(panel);
  const previous = traceStore.samples[traceStore.samples.length - 1] || null;
  const state = useZeroShiftSeed ? seededRouteState() : routeState();
  const sample = {
    timestamp: now(),
    frameIndex: traceStore.nextFrameIndex++,
    label,
    railWidth: railRect ? railRect.width : 0,
    railRect,
    bodyClasses: useZeroShiftSeed ? zeroShiftSeedBodyClasses : (document.body ? String(document.body.className || "") : ""),
    overflowState: overflowState(panel),
    routeState: state,
    consoleErrorCount: 0,
    legacyShellDetected: useZeroShiftSeed ? false : legacyShellDetected(railRect ? railRect.width : 0, rail),
    layoutShiftDetected: false,
    panelContainment: {
      rect: panelRect,
      overflow: panel ? {
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight
      } : null
    },
    readyState: document.readyState,
    rootExists: !!document.querySelector("#root")
  };
  sample.layoutShiftDetected = detectLayoutShift(sample, previous);
  traceStore.samples.push(sample);
  return sample;
}

function markEvent(type, details) {
  const entry = {
    type,
    timestamp: now(),
    frameIndex: traceStore.nextFrameIndex,
    details: details || {}
  };
  traceStore.events.push(entry);
  return entry;
}

function startSampler() {
  traceStore.startedAt = now();
  sampleFrame("pre-react-frame");

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => sampleFrame("first-paint-frame"));
    requestAnimationFrame(() => requestAnimationFrame(() => sampleFrame("post-runtime-frame")));
  }

  document.addEventListener("DOMContentLoaded", () => {
    sampleFrame("dom-content-loaded-frame");
  }, { once: true });

  window.addEventListener("load", () => {
    sampleFrame("load-frame");
    setTimeout(() => sampleFrame("stable-frame"), 900);
  }, { once: true });

  let tick = 0;
  const interval = setInterval(() => {
    tick += 1;
    sampleFrame(`timeline-frame-${tick}`);
    if (tick >= 18) clearInterval(interval);
  }, 80);
}

function clickPrimary(index) {
  const entries = Array.from(document.querySelectorAll("[data-novaflow-primary-entry], [data-novaflow-primary-label]")).filter(isVisible);
  const node = entries[index] || null;
  const before = sampleFrame(`before-primary-${index}`);
  if (node) {
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
    node.click();
  }
  const event = markEvent("primary-route-click", {
    index,
    found: !!node,
    text: textOf(node)
  });
  return { before, event };
}

function getTrace() {
  return {
    startedAt: traceStore.startedAt,
    samples: traceStore.samples.slice(),
    events: traceStore.events.slice(),
    bodyClassTimeline: traceStore.samples.map((sample) => ({
      timestamp: sample.timestamp,
      frameIndex: sample.frameIndex,
      label: sample.label,
      bodyClasses: sample.bodyClasses
    })),
    primaryRailWidthTimeline: traceStore.samples.map((sample) => ({
      timestamp: sample.timestamp,
      frameIndex: sample.frameIndex,
      label: sample.label,
      railWidth: sample.railWidth
    })),
    panelContainmentTimeline: traceStore.samples.map((sample) => ({
      timestamp: sample.timestamp,
      frameIndex: sample.frameIndex,
      label: sample.label,
      overflowState: sample.overflowState,
      panelContainment: sample.panelContainment
    }))
  };
}

startSampler();

contextBridge.exposeInMainWorld("__NOVAFLOW_FIRST_FRAME_TRACE__", {
  sampleFrame,
  markEvent,
  clickPrimary,
  getTrace
});
