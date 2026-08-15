const { app, BrowserWindow, ipcMain } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createSmokeTempBridge, isPathInside } = require("./tools-smoke-bridge.cjs");

const repoRoot = path.resolve(process.env.NOVAFLOW_SMOKE_REPO_ROOT || process.cwd());
const sessionId = String(process.env.NOVAFLOW_SMOKE_SESSION || `packaged-smoke-${Date.now()}`);
const tempRoot = path.resolve(process.env.NOVAFLOW_TOOLS_TEMP_ROOT || path.join(repoRoot, "debug-output", "temp-tools-bridge-test-2026-05-16"));
const smokeProfile = path.resolve(process.env.NOVAFLOW_TOOLS_SMOKE_PROFILE || path.join(tempRoot, "smoke-profile", sessionId));
const packagedAppRoot = path.resolve(process.env.NOVAFLOW_PACKAGED_APP_ROOT || path.join(repoRoot, "particle-editor-desktop", "dist", "win-unpacked", "resources", "app"));
const rendererEntry = path.resolve(process.env.NOVAFLOW_SMOKE_RENDERER_ENTRY || path.join(packagedAppRoot, "renderer", "index.html"));
const preloadPath = path.join(__dirname, "tools-smoke-preload.cjs");
const bridge = createSmokeTempBridge({ repoRoot, tempRoot, sessionId });

const pngBytes = [
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1,
  8, 6, 0, 0, 0, 31, 21, 196, 137
];

const telemetry = {
  consoleErrors: [],
  clientErrors: [],
  legacyWriteCallCount: 0,
  blockedLegacyWriteCount: 0,
  pickDirectoryCallCount: 0,
  blockedPickDirectoryCount: 0,
  blockedCallCount: 0
};

function sha256(bytes) {
  return crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex").toUpperCase();
}

function typedBlocked(code, message, details) {
  telemetry.blockedCallCount += 1;
  return {
    type: "TOOLS_BRIDGE_RESULT",
    ok: false,
    mode: "packaged_smoke",
    code,
    error: { code, message, details },
    realWriteCount: bridge.getRealWriteCount()
  };
}

function tmpLeftovers() {
  const out = [];
  const scan = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".tmp")) out.push(fullPath);
    }
  };
  scan(tempRoot);
  return out;
}

function inspectNative() {
  try {
    const sharp = require(path.join(packagedAppRoot, "node_modules", "sharp"));
    return {
      ok: true,
      sharpAvailable: true,
      sharpVersion: sharp.versions && sharp.versions.sharp || null,
      pngLosslessAvailable: !!(sharp.format && sharp.format.png),
      versions: sharp.versions || null
    };
  } catch (error) {
    return {
      ok: false,
      sharpAvailable: false,
      sharpVersion: null,
      pngLosslessAvailable: false,
      error: String(error && error.message || error)
    };
  }
}

async function inspectEntitlement() {
  try {
    const licenseCore = require(path.join(packagedAppRoot, "license-core.js"));
    const state = await licenseCore.getLicenseState(smokeProfile);
    const exportEntitled = state.status === "licensed" && !(state.payload && state.payload.features && state.payload.features.export === false);
    return {
      ok: true,
      checked: true,
      source: "smoke_profile",
      status: state.status || "unknown",
      exportEntitled,
      error: state.error || null
    };
  } catch (error) {
    return {
      ok: false,
      checked: true,
      source: "smoke_profile",
      status: "unknown",
      exportEntitled: false,
      error: String(error && error.message || error)
    };
  }
}

function getTelemetry() {
  return {
    ...telemetry,
    consoleErrorCount: telemetry.consoleErrors.length,
    realWriteCount: bridge.getRealWriteCount(),
    tmpLeftoverCount: tmpLeftovers().length
  };
}

async function getCapabilities(win) {
  const native = inspectNative();
  const entitlement = await inspectEntitlement();
  const protocol = win && !win.isDestroyed() ? await win.webContents.executeJavaScript("window.location.protocol").catch(() => "unknown") : "unknown";
  let tempWhitelistRealPath = null;
  try {
    fs.mkdirSync(tempRoot, { recursive: true });
    tempWhitelistRealPath = fs.realpathSync(tempRoot);
  } catch {
    tempWhitelistRealPath = null;
  }
  return {
    type: "TOOL_BRIDGE_CAPABILITIES",
    version: 1,
    mode: "packaged_smoke",
    runtime: {
      packaged: true,
      protocol,
      smokeMode: true,
      sessionId
    },
    writes: {
      realWriteAllowed: true,
      tempWhitelistRoot: tempRoot,
      tempWhitelistRealPath,
      rendererDirectoryPolicy: "renderer_provided_forbidden",
      overwriteAllowed: false,
      userFileWriteAllowed: false,
      atomicWriteRequired: true,
      hashVerificationRequired: true,
      allowedOperations: ["dry_run", "export"],
      allowedTools: ["png_compress"]
    },
    legacy: {
      writeBinaryFileExposed: true,
      writeBinaryFileCallable: false,
      writeBinaryFilePolicy: "block",
      pickDirectoryExposed: true,
      pickDirectoryPolicy: "block",
      legacyWriteCallCount: telemetry.legacyWriteCallCount,
      blockedLegacyWriteCount: telemetry.blockedLegacyWriteCount
    },
    native: {
      sharpAvailable: native.sharpAvailable,
      sharpVersion: native.sharpVersion,
      pngLosslessAvailable: native.pngLosslessAvailable
    },
    entitlement: {
      checked: entitlement.checked,
      exportEntitled: entitlement.exportEntitled,
      source: entitlement.source,
      status: entitlement.status
    },
    api: {
      novaflowToolsBridgeExposed: true,
      toolsIpcAvailable: true,
      getPathForFileExposed: true
    },
    telemetry: getTelemetry()
  };
}

function registerIpc(winRef) {
  ipcMain.handle("tools:legacy-write-blocked", async (_event, payload) => {
    telemetry.legacyWriteCallCount += 1;
    telemetry.blockedLegacyWriteCount += 1;
    return typedBlocked("LEGACY_WRITE_BLOCKED", "Legacy writeBinaryFile is blocked in tools smoke mode.", {
      payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : []
    });
  });

  ipcMain.handle("tools:pick-directory-blocked", async () => {
    telemetry.pickDirectoryCallCount += 1;
    telemetry.blockedPickDirectoryCount += 1;
    return typedBlocked("PICK_DIRECTORY_BLOCKED", "pickDirectory is blocked in tools smoke mode.");
  });

  ipcMain.handle("tools:smoke-compress-png-lossless", async () => ({
    ok: true,
    smoke: true,
    bytes: pngBytes,
    size: pngBytes.length,
    width: 1,
    height: 1
  }));

  ipcMain.handle("tools:get-capabilities", async () => getCapabilities(winRef.current));
  ipcMain.handle("tools:validate-export", async (_event, payload) => bridge.validateExport(payload || {}));
  ipcMain.handle("tools:get-temp-session", async () => bridge.getTempSession());
  ipcMain.handle("tools:get-operation-receipt", async (_event, payload) => bridge.getOperationReceipt(payload || {}));
  ipcMain.handle("tools:dry-run", async (_event, payload) => bridge.exportTemp({ ...(payload || {}), dryRun: true }));
  ipcMain.handle("tools:temp-export", async (_event, payload) => bridge.exportTemp(payload || {}));
  ipcMain.handle("tools:get-telemetry", async () => getTelemetry());
  ipcMain.handle("tools:reset-smoke-telemetry", async () => {
    telemetry.consoleErrors = [];
    telemetry.clientErrors = [];
    telemetry.legacyWriteCallCount = 0;
    telemetry.blockedLegacyWriteCount = 0;
    telemetry.pickDirectoryCallCount = 0;
    telemetry.blockedPickDirectoryCount = 0;
    telemetry.blockedCallCount = 0;
    return { ok: true };
  });
  ipcMain.handle("tools:inspect-native", async () => inspectNative());
  ipcMain.handle("tools:inspect-entitlement", async () => inspectEntitlement());
  ipcMain.handle("tools:get-smoke-user-data-path", async () => ({ ok: true, userData: smokeProfile }));
  ipcMain.handle("tools:client-error", async (_event, payload) => {
    telemetry.clientErrors.push(payload || {});
    return { ok: true };
  });
}

async function runSmoke(win) {
  const apiShape = await win.webContents.executeJavaScript(`(() => ({
    protocol: window.location.protocol,
    title: document.title,
    bodyTextLength: document.body ? document.body.innerText.length : 0,
    hasRoot: !!document.querySelector('#root'),
    electronAPI: typeof window.electronAPI,
    novaflowToolsBridge: typeof window.novaflowToolsBridge,
    writeBinaryFile: typeof window.electronAPI?.writeBinaryFile,
    pickDirectory: typeof window.electronAPI?.pickDirectory,
    getPathForFile: typeof window.electronAPI?.getPathForFile
  }))()`);

  const bridgeResults = await win.webContents.executeJavaScript(`(async () => {
    const bytes = ${JSON.stringify(pngBytes)};
    const capabilities = await window.novaflowToolsBridge.getCapabilities();
    const tempSession = await window.novaflowToolsBridge.getTempSession();
    const native = await window.novaflowToolsBridge.inspectNative();
    const entitlement = await window.novaflowToolsBridge.inspectEntitlement();
    const legacy = await window.electronAPI.writeBinaryFile({ dir: "C:/blocked", fileName: "legacy.png", bytes });
    const pick = await window.electronAPI.pickDirectory();
    const validateExport = await window.novaflowToolsBridge.validateExport({
      operationId: "g1-validate-export",
      requestId: "g1-validate-export",
      capabilityToken: tempSession.capabilityToken,
      tool: "png_compress",
      operation: "export",
      fileName: "g1-validate-export.png",
      bytes,
      metadata: { compression: "lossless" }
    });
    const invalidCapability = await window.novaflowToolsBridge.validateExport({
      operationId: "g1-invalid-capability",
      requestId: "g1-invalid-capability",
      capabilityToken: "invalid-capability",
      tool: "png_compress",
      operation: "export",
      fileName: "g1-invalid-capability.png",
      bytes,
      metadata: { compression: "lossless" }
    });
    const productionWrite = await window.novaflowToolsBridge.validateExport({
      operationId: "g1-production-write",
      requestId: "g1-production-write",
      capabilityToken: tempSession.capabilityToken,
      production: true,
      tool: "png_compress",
      operation: "export",
      fileName: "g1-production-write.png",
      bytes,
      metadata: { compression: "lossless" }
    });
    const invalidTempTarget = await window.novaflowToolsBridge.validateExport({
      operationId: "g1-invalid-temp-target",
      requestId: "g1-invalid-temp-target",
      capabilityToken: tempSession.capabilityToken,
      tool: "png_compress",
      operation: "export",
      fileName: "../escape.png",
      bytes,
      metadata: { compression: "lossless" }
    });
    const tempExport = await window.novaflowToolsBridge.tempExport({
      operationId: "packaged-smoke-temp-export",
      requestId: "packaged-smoke-temp-export",
      capabilityToken: tempSession.capabilityToken,
      tool: "png_compress",
      operation: "export",
      fileName: "packaged-smoke-lossless.png",
      bytes,
      metadata: { compression: "lossless" }
    });
    const rendererDir = await window.novaflowToolsBridge.tempExport({
      operationId: "packaged-smoke-renderer-dir",
      requestId: "packaged-smoke-renderer-dir",
      capabilityToken: tempSession.capabilityToken,
      tool: "png_compress",
      operation: "export",
      fileName: "packaged-smoke-renderer-dir.png",
      dir: "debug-output/temp-tools-bridge-test-2026-05-16",
      bytes,
      metadata: { compression: "lossless" }
    });
    const overwrite = await window.novaflowToolsBridge.tempExport({
      operationId: "packaged-smoke-overwrite",
      requestId: "packaged-smoke-overwrite",
      capabilityToken: tempSession.capabilityToken,
      tool: "png_compress",
      operation: "overwrite",
      fileName: "packaged-smoke-overwrite.png",
      bytes,
      metadata: { compression: "lossless" }
    });
    const operationReceipt = await window.novaflowToolsBridge.getOperationReceipt({ operationId: "packaged-smoke-temp-export" });
    const missingReceipt = await window.novaflowToolsBridge.getOperationReceipt({ operationId: "g1-missing-operation-receipt" });
    const telemetry = await window.novaflowToolsBridge.getTelemetry();
    return {
      capabilities,
      native,
      entitlement,
      legacy,
      pick,
      tempExport,
      rendererDir,
      overwrite,
      telemetry,
      g1: {
        tempSession,
        validateExport,
        invalidCapability,
        productionWrite,
        invalidTempTarget,
        operationReceipt,
        missingReceipt
      }
    };
  })()`);

  let hashMatched = false;
  let outputPathInsideWhitelist = false;
  let outputHash = null;
  if (bridgeResults.tempExport && bridgeResults.tempExport.ok && bridgeResults.tempExport.receipt && bridgeResults.tempExport.receipt.targetAbsolutePath) {
    const outputPath = bridgeResults.tempExport.receipt.targetAbsolutePath;
    const tempRealPath = fs.realpathSync(tempRoot);
    const outputRealPath = fs.realpathSync(outputPath);
    outputPathInsideWhitelist = isPathInside(tempRealPath, outputRealPath);
    outputHash = sha256(fs.readFileSync(outputRealPath));
    hashMatched = outputHash.toLowerCase() === String(bridgeResults.tempExport.receipt.sourceBytesSha256 || "").toLowerCase();
  }

  return {
    ok: true,
    sessionId,
    rendererEntry,
    smokeProfile,
    tempRoot,
    apiShape,
    ...bridgeResults,
    expectedHash: sha256(pngBytes),
    outputHash,
    hashMatched,
    outputPathInsideWhitelist,
    tmpLeftovers: tmpLeftovers(),
    finalTelemetry: getTelemetry()
  };
}

function emitResult(result) {
  process.stdout.write(`__NOVAFLOW_SMOKE_RESULT__${JSON.stringify(result)}__END_NOVAFLOW_SMOKE_RESULT__\n`);
}

async function main() {
  if (process.env.NOVAFLOW_TOOLS_SMOKE !== "1" || process.env.NOVAFLOW_DISABLE_LEGACY_WRITE !== "1") {
    throw new Error("Smoke launcher requires NOVAFLOW_TOOLS_SMOKE=1 and NOVAFLOW_DISABLE_LEGACY_WRITE=1.");
  }
  fs.mkdirSync(smokeProfile, { recursive: true });
  app.setPath("userData", smokeProfile);
  await app.whenReady();

  const winRef = { current: null };
  registerIpc(winRef);
  const win = new BrowserWindow({
    width: 1280,
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
  winRef.current = win;

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 3) telemetry.consoleErrors.push({ level, message, line, sourceId });
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    telemetry.consoleErrors.push({ level: 3, message: `did-fail-load ${errorCode}: ${errorDescription}`, sourceId: validatedURL });
  });

  await win.loadFile(rendererEntry);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const result = await runSmoke(win);
  emitResult(result);
  await win.close();
  app.quit();
}

main().catch((error) => {
  emitResult({
    ok: false,
    error: String(error && error.message || error),
    stack: String(error && error.stack || ""),
    telemetry: getTelemetry(),
    sessionId,
    rendererEntry,
    smokeProfile,
    tempRoot
  });
  try { app.quit(); } catch {}
});
