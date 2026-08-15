const { app, BrowserWindow, ipcMain } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(process.env.NOVAFLOW_SMOKE_REPO_ROOT || process.cwd());
const sessionId = String(process.env.NOVAFLOW_FIRST_FRAME_SESSION || `g3-first-frame-${Date.now()}`);
const tempRoot = path.resolve(process.env.NOVAFLOW_FIRST_FRAME_TEMP_ROOT || path.join(repoRoot, "debug-output", "first-frame-harness-2026-05-17"));
const smokeProfile = path.resolve(process.env.NOVAFLOW_FIRST_FRAME_PROFILE || path.join(tempRoot, "smoke-profile", sessionId));
const packagedAppRoot = path.resolve(process.env.NOVAFLOW_PACKAGED_APP_ROOT || path.join(repoRoot, "particle-editor-desktop", "dist", "win-unpacked", "resources", "app"));
const rendererEntry = path.resolve(process.env.NOVAFLOW_FIRST_FRAME_RENDERER_ENTRY || path.join(packagedAppRoot, "renderer", "index.html"));
const preloadPath = path.join(__dirname, "first-frame-harness-preload.cjs");

const consoleErrors = [];
const consoleWarnings = [];
const clientErrors = [];
let blockedLegacyWriteCount = 0;
let blockedPickDirectoryCount = 0;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex").toUpperCase();
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function toRepoPath(file) {
  return path.relative(repoRoot, file).replace(/\\/g, "/");
}

function localAssetPath(ref) {
  const clean = String(ref || "").split("?")[0].split("#")[0];
  if (!clean || clean.startsWith("http:") || clean.startsWith("https:") || clean.startsWith("//")) return null;
  if (!clean.startsWith("./")) return null;
  return path.resolve(path.dirname(rendererEntry), clean.slice(2));
}

function runtimeChainFiles() {
  const html = fs.readFileSync(rendererEntry, "utf8");
  const files = new Map([[rendererEntry, true]]);
  const attrPattern = /\b(?:src|href)=["']([^"']+)["']/g;
  let match;
  while ((match = attrPattern.exec(html))) {
    const resolved = localAssetPath(match[1]);
    if (!resolved) continue;
    if (!/\.(js|css|ico)$/i.test(resolved)) continue;
    if (fs.existsSync(resolved)) files.set(resolved, true);
  }
  return Array.from(files.keys()).sort();
}

function hashRuntimeChain() {
  return runtimeChainFiles().map((file) => ({
    path: toRepoPath(file),
    sha256: sha256File(file)
  }));
}

function isKnownHarnessWarning(message) {
  return String(message || "").includes("Unable to preventDefault inside passive event listener invocation");
}

function recordConsoleIssue(level, message, line, sourceId) {
  const entry = { level, message, line, sourceId };
  if (isKnownHarnessWarning(message)) {
    consoleWarnings.push({ ...entry, classification: "known_harness_input_warning" });
    return;
  }
  if (level >= 3) consoleErrors.push(entry);
}

function typedBlocked(code, message, details) {
  return {
    type: "TOOLS_BRIDGE_RESULT",
    ok: false,
    mode: "first_frame_harness",
    code,
    error: { code, message, details },
    realWriteCount: 0
  };
}

function registerSmokeIpcHandlers() {
  ipcMain.handle("tools:inspect-entitlement", () => ({
    ok: true,
    checked: true,
    source: "g3_first_frame_harness",
    status: "smoke-blocked",
    exportEntitled: false,
    overwriteEntitled: false,
    reason: "FIRST_FRAME_HARNESS_NO_PRODUCTION_ENTITLEMENT"
  }));
  ipcMain.handle("tools:get-smoke-user-data-path", () => ({
    ok: true,
    userData: smokeProfile
  }));
  ipcMain.handle("tools:get-capabilities", () => ({
    type: "TOOL_BRIDGE_CAPABILITIES",
    version: 1,
    mode: "first_frame_harness",
    runtime: {
      packaged: true,
      protocol: "file:",
      smokeMode: true,
      sessionId
    },
    writes: {
      realWriteAllowed: false,
      overwriteAllowed: false,
      userFileWriteAllowed: false,
      rendererDirectoryPolicy: "renderer_provided_forbidden"
    },
    legacy: {
      writeBinaryFileExposed: true,
      writeBinaryFileCallable: false,
      writeBinaryFilePolicy: "block",
      pickDirectoryExposed: true,
      pickDirectoryPolicy: "block"
    },
    telemetry: {
      realWriteCount: 0,
      blockedLegacyWriteCount,
      blockedPickDirectoryCount
    }
  }));
  ipcMain.handle("tools:inspect-native", () => ({
    ok: true,
    checked: true,
    sharpAvailable: false,
    reason: "FIRST_FRAME_HARNESS_NATIVE_EXPORT_NOT_REQUIRED"
  }));
  ipcMain.handle("tools:reset-smoke-telemetry", () => {
    blockedLegacyWriteCount = 0;
    blockedPickDirectoryCount = 0;
    clientErrors.length = 0;
    return { ok: true };
  });
  ipcMain.handle("tools:get-telemetry", () => ({
    ok: true,
    realWriteCount: 0,
    blockedLegacyWriteCount,
    blockedPickDirectoryCount,
    clientErrors
  }));
  ipcMain.handle("tools:legacy-write-blocked", (_event, payload) => {
    blockedLegacyWriteCount += 1;
    return typedBlocked("LEGACY_WRITE_BLOCKED", "Legacy writeBinaryFile is blocked in first-frame harness.", {
      payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : []
    });
  });
  ipcMain.handle("tools:pick-directory-blocked", () => {
    blockedPickDirectoryCount += 1;
    return typedBlocked("PICK_DIRECTORY_BLOCKED", "pickDirectory is blocked in first-frame harness.");
  });
  ipcMain.handle("tools:client-error", (_event, payload) => {
    clientErrors.push(payload || {});
    return { ok: true };
  });
  ipcMain.handle("tools:smoke-compress-png-lossless", () => typedBlocked("FIRST_FRAME_EXPORT_BLOCKED", "First-frame harness does not perform export writes."));
  ipcMain.handle("tools:validate-export", () => typedBlocked("FIRST_FRAME_EXPORT_BLOCKED", "First-frame harness does not validate exports."));
  ipcMain.handle("tools:get-temp-session", () => ({
    ok: false,
    code: "FIRST_FRAME_TEMP_SESSION_DISABLED",
    typedError: { code: "FIRST_FRAME_TEMP_SESSION_DISABLED", message: "First-frame harness is read-only." }
  }));
  ipcMain.handle("tools:get-operation-receipt", () => ({
    ok: false,
    code: "FIRST_FRAME_OPERATION_RECEIPT_DISABLED",
    typedError: { code: "FIRST_FRAME_OPERATION_RECEIPT_DISABLED", message: "First-frame harness has no write receipts." }
  }));
  ipcMain.handle("tools:dry-run", () => typedBlocked("FIRST_FRAME_EXPORT_BLOCKED", "First-frame harness dry-run export is blocked."));
  ipcMain.handle("tools:temp-export", () => typedBlocked("FIRST_FRAME_EXPORT_BLOCKED", "First-frame harness temp export is blocked."));
}

function emitResult(result) {
  process.stdout.write(`__NOVAFLOW_G3_FIRST_FRAME_RESULT__${JSON.stringify(result)}__END_NOVAFLOW_G3_FIRST_FRAME_RESULT__\n`);
}

async function getTrace(win) {
  return win.webContents.executeJavaScript("window.__NOVAFLOW_FIRST_FRAME_TRACE__.getTrace()");
}

async function sample(win, label) {
  return win.webContents.executeJavaScript(`window.__NOVAFLOW_FIRST_FRAME_TRACE__.sampleFrame(${JSON.stringify(label)})`);
}

async function clickPrimary(win, index) {
  return win.webContents.executeJavaScript(`window.__NOVAFLOW_FIRST_FRAME_TRACE__.clickPrimary(${JSON.stringify(index)})`);
}

async function screenshotReceipt(win, label, frameIndex) {
  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  return {
    label,
    frameIndex,
    timestamp: Date.now(),
    width: image.getSize().width,
    height: image.getSize().height,
    bytes: png.length,
    sha256: sha256Bytes(png)
  };
}

function addConsoleCountToSamples(samples) {
  return samples.map((entry) => ({
    ...entry,
    consoleErrorCount: consoleErrors.length
  }));
}

function receiptFromSample(sampleEntry, traceType) {
  return {
    timestamp: sampleEntry.timestamp,
    frameIndex: sampleEntry.frameIndex,
    traceType,
    label: sampleEntry.label,
    railWidth: sampleEntry.railWidth,
    bodyClasses: sampleEntry.bodyClasses,
    overflowState: sampleEntry.overflowState,
    routeState: sampleEntry.routeState,
    consoleErrorCount: consoleErrors.length,
    legacyShellDetected: !!sampleEntry.legacyShellDetected,
    layoutShiftDetected: !!sampleEntry.layoutShiftDetected
  };
}

function summarizeTrace(trace, traceType, fromFrameIndex) {
  const scoped = trace.samples.filter((entry) => entry.frameIndex >= fromFrameIndex);
  const samples = scoped.length ? scoped : trace.samples.slice(-1);
  return {
    traceType,
    fromFrameIndex,
    toFrameIndex: samples.length ? samples[samples.length - 1].frameIndex : fromFrameIndex,
    sampleCount: samples.length,
    railWidths: samples.map((entry) => entry.railWidth),
    bodyClassTimeline: samples.map((entry) => ({ frameIndex: entry.frameIndex, bodyClasses: entry.bodyClasses })),
    panelContainmentTimeline: samples.map((entry) => ({ frameIndex: entry.frameIndex, overflowState: entry.overflowState })),
    receipts: samples.map((entry) => receiptFromSample(entry, traceType))
  };
}

async function runRouteTrace(win, traceType, primaryIndex, waitMs) {
  const before = await sample(win, `${traceType}-before`);
  await clickPrimary(win, primaryIndex);
  await delay(80);
  await sample(win, `${traceType}-post-click`);
  await delay(waitMs);
  const after = await sample(win, `${traceType}-stable`);
  const trace = await getTrace(win);
  return {
    traceType,
    primaryIndex,
    beforeFrameIndex: before.frameIndex,
    afterFrameIndex: after.frameIndex,
    summary: summarizeTrace(trace, traceType, before.frameIndex),
    beforeReceipt: receiptFromSample(before, traceType),
    afterReceipt: receiptFromSample(after, traceType)
  };
}

function compareTraceWindows(left, right) {
  const railLeft = left.summary.railWidths.filter((value) => typeof value === "number");
  const railRight = right.summary.railWidths.filter((value) => typeof value === "number");
  const maxRailDelta = Math.max(
    0,
    ...railLeft.map((value, index) => Math.abs(value - (railRight[index] ?? value)))
  );
  const leftOverflow = left.summary.receipts.some((receipt) => receipt.overflowState && (receipt.overflowState.horizontalOverflow || receipt.overflowState.panelOverflow));
  const rightOverflow = right.summary.receipts.some((receipt) => receipt.overflowState && (receipt.overflowState.horizontalOverflow || receipt.overflowState.panelOverflow));
  const leftLayoutShift = left.summary.receipts.some((receipt) => receipt.layoutShiftDetected);
  const rightLayoutShift = right.summary.receipts.some((receipt) => receipt.layoutShiftDetected);
  return {
    left: left.traceType,
    right: right.traceType,
    maxRailDelta,
    overflowChanged: leftOverflow !== rightOverflow,
    layoutShiftChanged: leftLayoutShift !== rightLayoutShift,
    comparable: true
  };
}

async function main() {
  if (process.env.NOVAFLOW_FIRST_FRAME_HARNESS !== "1") {
    throw new Error("First-frame harness requires NOVAFLOW_FIRST_FRAME_HARNESS=1.");
  }

  fs.mkdirSync(smokeProfile, { recursive: true });
  app.setPath("userData", smokeProfile);
  registerSmokeIpcHandlers();
  await app.whenReady();

  const runtimeChainBefore = hashRuntimeChain();
  const screenshotSequence = [];
  const win = new BrowserWindow({
    width: 1365,
    height: 860,
    show: false,
    backgroundColor: "#0f1720",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    recordConsoleIssue(level, message, line, sourceId);
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    consoleErrors.push({ level: 3, message: `did-fail-load ${errorCode}: ${errorDescription}`, sourceId: validatedURL });
  });

  await win.loadFile(rendererEntry);
  await delay(100);
  screenshotSequence.push(await screenshotReceipt(win, "first-paint-screenshot", 0));
  await sample(win, "cold-start-post-load");
  await delay(450);
  screenshotSequence.push(await screenshotReceipt(win, "post-runtime-screenshot", 1));
  await delay(900);
  const coldStable = await sample(win, "cold-start-stable");
  screenshotSequence.push(await screenshotReceipt(win, "stable-screenshot", coldStable.frameIndex));

  const protocol = await win.webContents.executeJavaScript("window.location.protocol");
  let trace = await getTrace(win);
  const coldStartTrace = {
    traceType: "cold-start",
    summary: summarizeTrace(trace, "cold-start", 0)
  };

  const routeSwitchTrace = await runRouteTrace(win, "route-switch-trace", 0, 350);
  const animationRouteTrace = await runRouteTrace(win, "animation-route-trace", 1, 450);
  screenshotSequence.push(await screenshotReceipt(win, "animation-route-screenshot", animationRouteTrace.afterFrameIndex));
  const toolsRouteTrace = await runRouteTrace(win, "tools-route-trace", 3, 450);
  screenshotSequence.push(await screenshotReceipt(win, "tools-route-screenshot", toolsRouteTrace.afterFrameIndex));

  trace = await getTrace(win);
  trace.samples = addConsoleCountToSamples(trace.samples);

  const runtimeChainAfter = hashRuntimeChain();
  const runtimeChainStable = JSON.stringify(runtimeChainBefore) === JSON.stringify(runtimeChainAfter);
  const traceComparisons = [
    compareTraceWindows(routeSwitchTrace, animationRouteTrace),
    compareTraceWindows(animationRouteTrace, toolsRouteTrace)
  ];
  const measurementReceipts = [
    ...coldStartTrace.summary.receipts,
    ...routeSwitchTrace.summary.receipts,
    ...animationRouteTrace.summary.receipts,
    ...toolsRouteTrace.summary.receipts
  ];
  const requiredLabels = new Set(trace.samples.map((entry) => entry.label));

  emitResult({
    ok: protocol === "file:" &&
      runtimeChainStable &&
      consoleErrors.length === 0 &&
      measurementReceipts.length >= 8 &&
      requiredLabels.has("pre-react-frame") &&
      requiredLabels.has("first-paint-frame") &&
      requiredLabels.has("post-runtime-frame") &&
      requiredLabels.has("stable-frame"),
    sessionId,
    rendererEntry,
    smokeProfile,
    protocol,
    consoleErrorCount: consoleErrors.length,
    consoleErrors,
    consoleWarnings,
    clientErrors,
    runtimeChainBefore,
    runtimeChainAfter,
    runtimeChainStable,
    trace,
    coldStartTrace,
    routeSwitchTrace,
    animationRouteTrace,
    toolsRouteTrace,
    measurementReceipts,
    screenshotSequence,
    traceComparisons,
    smokeTelemetry: {
      realWriteCount: 0,
      blockedLegacyWriteCount,
      blockedPickDirectoryCount
    }
  });

  await win.close();
  app.quit();
}

main().catch((error) => {
  emitResult({
    ok: false,
    sessionId,
    rendererEntry,
    smokeProfile,
    consoleErrorCount: consoleErrors.length,
    consoleErrors,
    consoleWarnings,
    clientErrors,
    error: String(error && error.message || error),
    stack: String(error && error.stack || "")
  });
  try { app.quit(); } catch {}
});
