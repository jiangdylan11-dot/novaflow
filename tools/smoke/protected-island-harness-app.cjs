const { app, BrowserWindow, ipcMain } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(process.env.NOVAFLOW_SMOKE_REPO_ROOT || process.cwd());
const sessionId = String(process.env.NOVAFLOW_PROTECTED_HARNESS_SESSION || `g2-protected-island-${Date.now()}`);
const tempRoot = path.resolve(process.env.NOVAFLOW_PROTECTED_HARNESS_TEMP_ROOT || path.join(repoRoot, "debug-output", "protected-island-harness-2026-05-17"));
const smokeProfile = path.resolve(process.env.NOVAFLOW_PROTECTED_HARNESS_PROFILE || path.join(tempRoot, "smoke-profile", sessionId));
const fixtureRoot = path.resolve(process.env.NOVAFLOW_PROTECTED_HARNESS_FIXTURES || path.join(tempRoot, "fixtures", sessionId));
const packagedAppRoot = path.resolve(process.env.NOVAFLOW_PACKAGED_APP_ROOT || path.join(repoRoot, "particle-editor-desktop", "dist", "win-unpacked", "resources", "app"));
const rendererEntry = path.resolve(process.env.NOVAFLOW_PROTECTED_HARNESS_RENDERER_ENTRY || path.join(packagedAppRoot, "renderer", "index.html"));
const preloadPath = path.join(__dirname, "tools-smoke-preload.cjs");

const protectedFiles = [
  path.join(packagedAppRoot, "renderer", "spine-split-runtime.js"),
  path.join(packagedAppRoot, "renderer", "spine-official-runtime.js"),
  path.join(packagedAppRoot, "renderer", "ribbon-event-markers.js")
];

const consoleErrors = [];
const consoleWarnings = [];
const clientErrors = [];
let blockedLegacyWriteCount = 0;
let blockedPickDirectoryCount = 0;

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

function registerSmokeIpcHandlers() {
  ipcMain.handle("tools:inspect-entitlement", () => ({
    ok: true,
    checked: true,
    source: "g2_protected_island_harness",
    status: "smoke-blocked",
    exportEntitled: false,
    overwriteEntitled: false,
    reason: "PROTECTED_ISLAND_HARNESS_NO_PRODUCTION_ENTITLEMENT"
  }));
  ipcMain.handle("tools:get-smoke-user-data-path", () => ({
    ok: true,
    userData: smokeProfile
  }));
  ipcMain.handle("tools:get-capabilities", () => ({
    ok: true,
    capabilities: {
      mode: "protected-island-harness",
      packagedFileSmoke: true,
      tempExport: false,
      overwrite: false,
      userFileWrite: false,
      rendererProvidedPath: false,
      legacyWriteBlocked: true
    }
  }));
  ipcMain.handle("tools:inspect-native", () => ({
    ok: true,
    checked: true,
    sharpAvailable: false,
    reason: "PROTECTED_ISLAND_HARNESS_NATIVE_EXPORT_NOT_REQUIRED"
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
  ipcMain.handle("tools:legacy-write-blocked", () => {
    blockedLegacyWriteCount += 1;
    return {
      ok: false,
      code: "LEGACY_WRITE_BLOCKED",
      typedError: { code: "LEGACY_WRITE_BLOCKED", message: "Legacy writeBinaryFile is blocked in protected island harness." }
    };
  });
  ipcMain.handle("tools:pick-directory-blocked", () => {
    blockedPickDirectoryCount += 1;
    return {
      ok: false,
      code: "PICK_DIRECTORY_BLOCKED",
      typedError: { code: "PICK_DIRECTORY_BLOCKED", message: "pickDirectory is blocked in protected island harness." }
    };
  });
  ipcMain.handle("tools:client-error", (_event, payload) => {
    clientErrors.push(payload || {});
    return { ok: true };
  });
  ipcMain.handle("tools:temp-export", () => ({
    ok: false,
    code: "PROTECTED_ISLAND_HARNESS_EXPORT_BLOCKED",
    typedError: {
      code: "PROTECTED_ISLAND_HARNESS_EXPORT_BLOCKED",
      message: "Protected island harness does not perform export writes."
    }
  }));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

function hashProtectedFiles() {
  return protectedFiles.map((file) => ({
    path: path.relative(repoRoot, file).replace(/\\/g, "/"),
    sha256: sha256File(file)
  }));
}

function writeFixture(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function createFixtures() {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lS1mAAAAAABJRU5ErkJggg==",
    "base64"
  );
  writeFixture(path.join(fixtureRoot, "minimal-spine", "skeleton.json"), JSON.stringify({
    skeleton: { hash: "g2-minimal", spine: "4.0.00", x: 0, y: 0, width: 1, height: 1 },
    bones: [{ name: "root" }],
    slots: [],
    skins: [{ name: "default", attachments: {} }],
    animations: {}
  }, null, 2));
  writeFixture(path.join(fixtureRoot, "minimal-spine", "skeleton.atlas"), "g2-spine.png\nsize: 1,1\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n");
  writeFixture(path.join(fixtureRoot, "minimal-spine", "g2-spine.png"), png);
  writeFixture(path.join(fixtureRoot, "split", "split-fixture.png"), png);
  writeFixture(path.join(fixtureRoot, "ribbon", "ribbon-fixture.json"), JSON.stringify({
    version: 1,
    points: [{ x: 0, y: 0 }, { x: 32, y: 8 }, { x: 64, y: 0 }],
    width: 8,
    stiffness: 0.5
  }, null, 2));
  writeFixture(path.join(fixtureRoot, "drag-drop", "valid-drop.png"), png);
  writeFixture(path.join(fixtureRoot, "invalid", "invalid-file.txt"), "not a protected island asset");
  writeFixture(path.join(fixtureRoot, "invalid", "corrupt.png"), Buffer.from([0, 1, 2, 3, 4]));

  const scan = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(fullPath, out);
      else if (entry.isFile()) out.push({
        path: path.relative(repoRoot, fullPath).replace(/\\/g, "/"),
        sha256: sha256File(fullPath),
        bytes: fs.statSync(fullPath).size
      });
    }
    return out;
  };
  return scan(fixtureRoot);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitResult(result) {
  process.stdout.write(`__NOVAFLOW_G2_PROTECTED_RESULT__${JSON.stringify(result)}__END_NOVAFLOW_G2_PROTECTED_RESULT__\n`);
}

async function installRecorder(win) {
  await win.webContents.executeJavaScript(`(() => {
    if (window.__NOVAFLOW_PROTECTED_ISLAND_HARNESS__) return true;
    const store = {
      pointerEvents: [],
      mouseEvents: [],
      wheelEvents: [],
      dropEvents: [],
      receipts: [],
      startedAt: performance.now()
    };
    const shallowRect = (rect) => rect ? ({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      top: Math.round(rect.top),
      left: Math.round(rect.left)
    }) : null;
    const findProtectedTarget = () => {
      return document.querySelector('[data-novaflow-spine-split-workspace-overlay], [data-novaflow-spine-split-root], [data-psd-fusion-ui], canvas, #root') || document.body;
    };
    const findLayerTarget = () => {
      return document.querySelector('[data-novaflow-spine-split-layer], [data-novaflow-layer], [class*="layer"], #root') || findProtectedTarget();
    };
    const findDropTarget = () => {
      return document.querySelector('[data-novaflow-dropzone], [data-novaflow-spine-split-dropzone], [data-novaflow-ai-post-reference-dropzone], input[type="file"], #root') || document.body;
    };
    const canvasState = () => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      const style = getComputedStyle(canvas);
      return {
        rect: shallowRect(canvas.getBoundingClientRect()),
        transform: style.transform,
        width: canvas.width || null,
        height: canvas.height || null
      };
    };
    const layerOrder = () => {
      return Array.from(document.querySelectorAll('[data-novaflow-spine-split-layer], [data-novaflow-layer], [class*="layer"]'))
        .slice(0, 12)
        .map((node, index) => ({
          index,
          text: (node.textContent || '').trim().slice(0, 80),
          className: node.className ? String(node.className).slice(0, 120) : ''
        }));
    };
    const snapshot = (label) => {
      const root = document.querySelector('#root');
      const protectedTarget = findProtectedTarget();
      const dropTarget = findDropTarget();
      const rail = document.querySelector('[data-novaflow-primary-entry], [data-novaflow-primary-shell], nav, aside');
      const panel = document.querySelector('.nf-panel, .nf-panel-body, [data-novaflow-panel]');
      return {
        label,
        timestamp: performance.now(),
        readyState: document.readyState,
        protocol: window.location.protocol,
        title: document.title,
        bodyClass: document.body ? document.body.className : '',
        rootExists: !!root,
        rootTextLength: root ? (root.innerText || '').length : 0,
        protectedTargetTag: protectedTarget ? protectedTarget.tagName : null,
        dropTargetTag: dropTarget ? dropTarget.tagName : null,
        canvas: canvasState(),
        layerOrder: layerOrder(),
        railRect: rail ? shallowRect(rail.getBoundingClientRect()) : null,
        panelRect: panel ? shallowRect(panel.getBoundingClientRect()) : null,
        panelOverflow: panel ? {
          scrollWidth: panel.scrollWidth,
          clientWidth: panel.clientWidth,
          overflow: panel.scrollWidth > panel.clientWidth
        } : null,
        splitNodeCount: document.querySelectorAll('[data-novaflow-spine-split-workspace-overlay], [data-psd-fusion-ui], [data-novaflow-spine-split-layer]').length,
        ribbonNodeCount: Array.from(document.querySelectorAll('*')).filter((node) => /ribbon|飘带|飄帶/i.test(node.textContent || node.className || '')).length,
        consoleErrorCount: window.__NOVAFLOW_PROTECTED_CONSOLE_ERRORS__ || 0
      };
    };
    const pushEvent = (bucket, event) => {
      bucket.push({
        type: event.type,
        x: Math.round(event.clientX || 0),
        y: Math.round(event.clientY || 0),
        button: event.button,
        buttons: event.buttons,
        pointerId: event.pointerId || null,
        target: event.target && event.target.tagName,
        time: performance.now()
      });
    };
    const record = (interactionType, beforeState, afterState, extra) => {
      const receipt = {
        interactionType,
        beforeState,
        afterState,
        consoleErrorCount: window.__NOVAFLOW_PROTECTED_CONSOLE_ERRORS__ || 0,
        pointerCaptureResult: extra && Object.prototype.hasOwnProperty.call(extra, 'pointerCaptureResult') ? extra.pointerCaptureResult : null,
        dropAccepted: extra && Object.prototype.hasOwnProperty.call(extra, 'dropAccepted') ? extra.dropAccepted : null,
        dropRejected: extra && Object.prototype.hasOwnProperty.call(extra, 'dropRejected') ? extra.dropRejected : null,
        panDelta: extra && extra.panDelta || { x: 0, y: 0 },
        zoomDelta: extra && typeof extra.zoomDelta === 'number' ? extra.zoomDelta : 0,
        runtimeStability: !!(afterState && afterState.rootExists && afterState.protocol === 'file:'),
        details: extra || {}
      };
      store.receipts.push(receipt);
      return receipt;
    };
    document.addEventListener('pointerdown', (event) => pushEvent(store.pointerEvents, event), true);
    document.addEventListener('pointermove', (event) => pushEvent(store.pointerEvents, event), true);
    document.addEventListener('pointerup', (event) => pushEvent(store.pointerEvents, event), true);
    document.addEventListener('mousedown', (event) => pushEvent(store.mouseEvents, event), true);
    document.addEventListener('mousemove', (event) => pushEvent(store.mouseEvents, event), true);
    document.addEventListener('mouseup', (event) => pushEvent(store.mouseEvents, event), true);
    document.addEventListener('wheel', (event) => {
      store.wheelEvents.push({ deltaX: event.deltaX, deltaY: event.deltaY, x: event.clientX, y: event.clientY, time: performance.now() });
    }, true);
    document.addEventListener('dragenter', (event) => {
      store.dropEvents.push({ type: event.type, target: event.target && event.target.tagName, time: performance.now() });
    }, true);
    document.addEventListener('drop', (event) => {
      store.dropEvents.push({ type: event.type, target: event.target && event.target.tagName, time: performance.now(), files: event.dataTransfer ? event.dataTransfer.files.length : 0 });
    }, true);
    window.__NOVAFLOW_PROTECTED_ISLAND_HARNESS__ = {
      store,
      snapshot,
      record,
      findProtectedTargetRect: () => shallowRect(findProtectedTarget().getBoundingClientRect()),
      findLayerTargetRect: () => shallowRect(findLayerTarget().getBoundingClientRect()),
      simulateDrop: (name, type) => {
        const before = snapshot('drop-before');
        const target = findDropTarget();
        let syntheticFallback = true;
        let observedBefore = store.dropEvents.length;
        try {
          const data = new DataTransfer();
          data.items.add(new File(['g2-fixture'], name, { type }));
          target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }));
          target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
        } catch (error) {
          target.dispatchEvent(new Event('dragenter', { bubbles: true, cancelable: true }));
          target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
        }
        const after = snapshot('drop-after');
        const observed = store.dropEvents.length - observedBefore;
        const accepted = after.rootTextLength !== before.rootTextLength || after.splitNodeCount !== before.splitNodeCount;
        return record('drag-drop-import', before, after, {
          syntheticFallback,
          dropObserved: observed > 0,
          dropAccepted: accepted,
          dropRejected: !accepted,
          fixtureName: name,
          fixtureType: type
        });
      },
      attemptSplitOpenClose: () => {
        const before = snapshot('split-open-close-before');
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], [data-novaflow-primary-entry], [data-novaflow-secondary-entry]'));
        const openButton = buttons.find((button) => /骨|拆|split|spine|animation|动画|動/i.test(button.textContent || button.getAttribute('data-novaflow-primary-label') || button.getAttribute('data-novaflow-secondary-label') || ''));
        if (openButton) openButton.click();
        const middle = snapshot('split-open-close-middle');
        if (openButton) openButton.click();
        const after = snapshot('split-open-close-after');
        return record('split-editor-open-close-trace', before, after, {
          attempted: !!openButton,
          middleState: middle,
          pointerCaptureResult: null
        });
      },
      receipts: () => store.receipts
    };
    window.__NOVAFLOW_PROTECTED_CONSOLE_ERRORS__ = 0;
    const originalError = console.error;
    console.error = (...args) => {
      window.__NOVAFLOW_PROTECTED_CONSOLE_ERRORS__ += 1;
      return originalError.apply(console, args);
    };
    return true;
  })()`);
}

async function getPoint(win, fnName) {
  const rect = await win.webContents.executeJavaScript(`window.__NOVAFLOW_PROTECTED_ISLAND_HARNESS__.${fnName}()`);
  const fallback = { left: 320, top: 240, width: 160, height: 120 };
  const safe = rect && rect.width > 0 && rect.height > 0 ? rect : fallback;
  return {
    x: Math.round(safe.left + Math.max(4, Math.min(safe.width - 4, safe.width / 2))),
    y: Math.round(safe.top + Math.max(4, Math.min(safe.height - 4, safe.height / 2)))
  };
}

async function snapshot(win, label) {
  return win.webContents.executeJavaScript(`window.__NOVAFLOW_PROTECTED_ISLAND_HARNESS__.snapshot(${JSON.stringify(label)})`);
}

async function recordFromMain(win, interactionType, before, after, extra) {
  return win.webContents.executeJavaScript(`window.__NOVAFLOW_PROTECTED_ISLAND_HARNESS__.record(${JSON.stringify(interactionType)}, ${JSON.stringify(before)}, ${JSON.stringify(after)}, ${JSON.stringify(extra || {})})`);
}

async function runPointerTrace(win) {
  const point = await getPoint(win, "findProtectedTargetRect");
  const before = await snapshot(win, "pointer-before");
  win.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await delay(50);
  win.webContents.sendInputEvent({ type: "mouseMove", x: point.x + 28, y: point.y + 12, button: "left", buttons: 1 });
  await delay(50);
  win.webContents.sendInputEvent({ type: "mouseUp", x: point.x + 28, y: point.y + 12, button: "left", clickCount: 1 });
  await delay(150);
  const after = await snapshot(win, "pointer-after");
  const events = await win.webContents.executeJavaScript("window.__NOVAFLOW_PROTECTED_ISLAND_HARNESS__.store.pointerEvents.concat(window.__NOVAFLOW_PROTECTED_ISLAND_HARNESS__.store.mouseEvents)");
  return recordFromMain(win, "pointer-down-move-up", before, after, {
    pointerCaptureResult: events.some((event) => event.type === "pointerdown" || event.type === "mousedown") && events.some((event) => event.type === "pointerup" || event.type === "mouseup"),
    eventCount: events.length,
    panDelta: { x: 28, y: 12 }
  });
}

async function runPanTrace(win) {
  const point = await getPoint(win, "findProtectedTargetRect");
  const before = await snapshot(win, "pan-before");
  win.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "right", clickCount: 1 });
  await delay(50);
  win.webContents.sendInputEvent({ type: "mouseMove", x: point.x + 42, y: point.y + 24, button: "right", buttons: 2 });
  await delay(50);
  win.webContents.sendInputEvent({ type: "mouseUp", x: point.x + 42, y: point.y + 24, button: "right", clickCount: 1 });
  await delay(150);
  const after = await snapshot(win, "pan-after");
  return recordFromMain(win, "canvas-pan", before, after, {
    pointerCaptureResult: true,
    panDelta: { x: 42, y: 24 },
    canvasTransformBefore: before.canvas && before.canvas.transform,
    canvasTransformAfter: after.canvas && after.canvas.transform
  });
}

async function runZoomTrace(win) {
  const point = await getPoint(win, "findProtectedTargetRect");
  const before = await snapshot(win, "zoom-before");
  const beforeWheelCount = await win.webContents.executeJavaScript("window.__NOVAFLOW_PROTECTED_ISLAND_HARNESS__.store.wheelEvents.length");
  win.webContents.sendInputEvent({ type: "mouseWheel", x: point.x, y: point.y, deltaY: -240, deltaX: 0, canScroll: true });
  await delay(200);
  const after = await snapshot(win, "zoom-after");
  const afterWheelCount = await win.webContents.executeJavaScript("window.__NOVAFLOW_PROTECTED_ISLAND_HARNESS__.store.wheelEvents.length");
  return recordFromMain(win, "canvas-zoom", before, after, {
    pointerCaptureResult: null,
    zoomDelta: afterWheelCount - beforeWheelCount,
    wheelObserved: afterWheelCount > beforeWheelCount
  });
}

async function runLayerReorderTrace(win) {
  const point = await getPoint(win, "findLayerTargetRect");
  const before = await snapshot(win, "layer-reorder-before");
  win.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await delay(40);
  win.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y + 36, button: "left", buttons: 1 });
  await delay(40);
  win.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y + 36, button: "left", clickCount: 1 });
  await delay(150);
  const after = await snapshot(win, "layer-reorder-after");
  return recordFromMain(win, "layer-reorder-attempt", before, after, {
    pointerCaptureResult: true,
    layerOrderBefore: before.layerOrder,
    layerOrderAfter: after.layerOrder
  });
}

async function runDropTrace(win) {
  return win.webContents.executeJavaScript("window.__NOVAFLOW_PROTECTED_ISLAND_HARNESS__.simulateDrop('valid-drop.png', 'image/png')");
}

async function runSplitOpenCloseTrace(win) {
  return win.webContents.executeJavaScript("window.__NOVAFLOW_PROTECTED_ISLAND_HARNESS__.attemptSplitOpenClose()");
}

async function runHarness(win) {
  await installRecorder(win);
  const before = await snapshot(win, "initial-before");
  const receipts = [];
  receipts.push(await runPointerTrace(win));
  receipts.push(await runDropTrace(win));
  receipts.push(await runZoomTrace(win));
  receipts.push(await runPanTrace(win));
  receipts.push(await runLayerReorderTrace(win));
  receipts.push(await runSplitOpenCloseTrace(win));
  const after = await snapshot(win, "final-after");
  const rendererReceipts = await win.webContents.executeJavaScript("window.__NOVAFLOW_PROTECTED_ISLAND_HARNESS__.receipts()");
  return {
    before,
    after,
    receipts: rendererReceipts.length >= receipts.length ? rendererReceipts : receipts
  };
}

async function main() {
  if (process.env.NOVAFLOW_PROTECTED_HARNESS !== "1") {
    throw new Error("Protected island harness requires NOVAFLOW_PROTECTED_HARNESS=1.");
  }
  fs.mkdirSync(smokeProfile, { recursive: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  app.setPath("userData", smokeProfile);
  registerSmokeIpcHandlers();
  await app.whenReady();

  const fixtures = createFixtures();
  const protectedHashesBefore = hashProtectedFiles();
  const win = new BrowserWindow({
    width: 1365,
    height: 860,
    show: false,
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
  await delay(1400);
  const protocol = await win.webContents.executeJavaScript("window.location.protocol");
  const harnessResult = await runHarness(win);
  const protectedHashesAfter = hashProtectedFiles();
  const hashStable = JSON.stringify(protectedHashesBefore) === JSON.stringify(protectedHashesAfter);
  const runtimeStability = protocol === "file:" && harnessResult.after && harnessResult.after.rootExists && hashStable;

  emitResult({
    ok: runtimeStability && consoleErrors.length === 0 && harnessResult.receipts.length >= 6,
    sessionId,
    rendererEntry,
    smokeProfile,
    fixtureRoot,
    fixtures,
    protocol,
    consoleErrorCount: consoleErrors.length,
    consoleErrors,
    consoleWarnings,
    clientErrors,
    smokeTelemetry: {
      realWriteCount: 0,
      blockedLegacyWriteCount,
      blockedPickDirectoryCount
    },
    protectedHashesBefore,
    protectedHashesAfter,
    protectedHashesStable: hashStable,
    receipts: harnessResult.receipts,
    receiptTypes: harnessResult.receipts.map((receipt) => receipt.interactionType),
    runtimeStability,
    beforeState: harnessResult.before,
    afterState: harnessResult.after
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
    fixtureRoot,
    consoleErrorCount: consoleErrors.length,
    consoleErrors,
    consoleWarnings,
    clientErrors,
    error: String(error && error.message || error),
    stack: String(error && error.stack || "")
  });
  try { app.quit(); } catch {}
});
