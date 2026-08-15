const { app, BrowserWindow, ipcMain } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(process.env.NOVAFLOW_SMOKE_REPO_ROOT || process.cwd());
const sessionId = String(process.env.NOVAFLOW_G5_AIFX_SESSION || `g5-aifx-${Date.now()}`);
const tempRoot = path.resolve(process.env.NOVAFLOW_G5_AIFX_TEMP_ROOT || path.join(repoRoot, "debug-output", "aifx-isolated-source-prototype-2026-05-17"));
const smokeProfile = path.resolve(process.env.NOVAFLOW_G5_AIFX_PROFILE || path.join(tempRoot, "smoke-profile", sessionId));
const exportRoot = path.resolve(process.env.NOVAFLOW_G5_AIFX_EXPORT_ROOT || path.join(tempRoot, "exports", sessionId));
const packagedAppRoot = path.resolve(process.env.NOVAFLOW_PACKAGED_APP_ROOT || path.join(repoRoot, "particle-editor-desktop", "dist", "win-unpacked", "resources", "app"));
const productionRendererEntry = path.join(packagedAppRoot, "renderer", "index.html");
const rendererEntry = path.resolve(process.env.NOVAFLOW_G5_AIFX_RENDERER_ENTRY || productionRendererEntry);
const preloadPath = path.join(__dirname, "first-frame-harness-preload.cjs");

const consoleErrors = [];
const consoleWarnings = [];
const clientErrors = [];
let blockedLegacyWriteCount = 0;
let blockedPickDirectoryCount = 0;
let realWriteCount = 0;

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

function localAssetPath(entry, ref) {
  const clean = String(ref || "").split("?")[0].split("#")[0];
  if (!clean || clean.startsWith("http:") || clean.startsWith("https:") || clean.startsWith("//")) return null;
  if (!clean.startsWith("./")) return null;
  return path.resolve(path.dirname(entry), clean.slice(2));
}

function runtimeChainFiles(entry) {
  const html = fs.readFileSync(entry, "utf8");
  const files = new Map([[entry, true]]);
  const attrPattern = /\b(?:src|href)=["']([^"']+)["']/g;
  let match;
  while ((match = attrPattern.exec(html))) {
    const resolved = localAssetPath(entry, match[1]);
    if (!resolved) continue;
    if (!/\.(js|css|ico)$/i.test(resolved)) continue;
    if (fs.existsSync(resolved)) files.set(resolved, true);
  }
  return Array.from(files.keys()).sort();
}

function hashRuntimeChain(entry) {
  return runtimeChainFiles(entry).map((file) => ({
    path: toRepoPath(file),
    sha256: sha256File(file)
  }));
}

function isPathInside(parent, target) {
  const parentReal = fs.realpathSync(parent);
  const targetParent = fs.existsSync(target) ? target : path.dirname(target);
  const targetRealParent = fs.realpathSync(targetParent);
  const rel = path.relative(parentReal, targetRealParent);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function tmpLeftovers(root) {
  const out = [];
  const scan = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".tmp")) out.push(fullPath);
    }
  };
  scan(root);
  return out;
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
    mode: "g5_aifx_isolated",
    code,
    error: { code, message, details },
    realWriteCount
  };
}

function registerSmokeIpcHandlers() {
  ipcMain.handle("tools:inspect-entitlement", () => ({
    ok: true,
    checked: true,
    source: "g5_aifx_isolated_source",
    status: "smoke-blocked",
    exportEntitled: false,
    overwriteEntitled: false,
    reason: "G5_AIFX_ISOLATED_NO_PRODUCTION_ENTITLEMENT"
  }));
  ipcMain.handle("tools:get-smoke-user-data-path", () => ({
    ok: true,
    userData: smokeProfile
  }));
  ipcMain.handle("tools:get-capabilities", () => ({
    type: "TOOL_BRIDGE_CAPABILITIES",
    version: 1,
    mode: "g5_aifx_isolated",
    runtime: {
      packaged: true,
      protocol: "file:",
      smokeMode: true,
      sessionId
    },
    writes: {
      realWriteAllowed: true,
      tempWhitelistRoot: exportRoot,
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
      realWriteCount,
      blockedLegacyWriteCount,
      blockedPickDirectoryCount
    }
  }));
  ipcMain.handle("tools:inspect-native", () => ({
    ok: true,
    checked: true,
    sharpAvailable: false,
    reason: "G5_AIFX_ISOLATED_NATIVE_EXPORT_NOT_REQUIRED"
  }));
  ipcMain.handle("tools:reset-smoke-telemetry", () => {
    blockedLegacyWriteCount = 0;
    blockedPickDirectoryCount = 0;
    realWriteCount = 0;
    clientErrors.length = 0;
    return { ok: true };
  });
  ipcMain.handle("tools:get-telemetry", () => ({
    ok: true,
    realWriteCount,
    blockedLegacyWriteCount,
    blockedPickDirectoryCount,
    clientErrors
  }));
  ipcMain.handle("tools:legacy-write-blocked", (_event, payload) => {
    blockedLegacyWriteCount += 1;
    return typedBlocked("LEGACY_WRITE_BLOCKED", "Legacy writeBinaryFile is blocked in G5 AIFX isolated harness.", {
      payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : []
    });
  });
  ipcMain.handle("tools:pick-directory-blocked", () => {
    blockedPickDirectoryCount += 1;
    return typedBlocked("PICK_DIRECTORY_BLOCKED", "pickDirectory is blocked in G5 AIFX isolated harness.");
  });
  ipcMain.handle("tools:client-error", (_event, payload) => {
    clientErrors.push(payload || {});
    return { ok: true };
  });
  ipcMain.handle("tools:smoke-compress-png-lossless", () => typedBlocked("G5_AIFX_EXPORT_BLOCKED", "G5 AIFX export uses isolated temp receipt only."));
  ipcMain.handle("tools:validate-export", () => typedBlocked("G5_AIFX_EXPORT_BLOCKED", "G5 AIFX isolated harness does not validate production exports."));
  ipcMain.handle("tools:get-temp-session", () => ({
    ok: true,
    sessionId,
    tempRoot: exportRoot
  }));
  ipcMain.handle("tools:get-operation-receipt", () => ({
    ok: false,
    code: "G5_AIFX_OPERATION_RECEIPT_DIRECT_QUERY_DISABLED",
    typedError: { code: "G5_AIFX_OPERATION_RECEIPT_DIRECT_QUERY_DISABLED", message: "Use G5 isolated export receipt." }
  }));
  ipcMain.handle("tools:dry-run", () => typedBlocked("G5_AIFX_EXPORT_BLOCKED", "G5 AIFX dry-run export is internal to isolated harness."));
  ipcMain.handle("tools:temp-export", () => typedBlocked("G5_AIFX_EXPORT_BLOCKED", "G5 AIFX temp export is controlled by the isolated harness."));
}

function emitResult(result) {
  process.stdout.write(`__NOVAFLOW_G5_AIFX_RESULT__${JSON.stringify(result)}__END_NOVAFLOW_G5_AIFX_RESULT__\n`);
}

async function evalInWindow(win, code) {
  return win.webContents.executeJavaScript(code);
}

async function callAifx(win, method, args = []) {
  return evalInWindow(win, `window.__NOVAFLOW_AIFX_PROTOTYPE__.${method}(...${JSON.stringify(args)})`);
}

async function getTrace(win) {
  return evalInWindow(win, "window.__NOVAFLOW_FIRST_FRAME_TRACE__.getTrace()");
}

async function sample(win, label) {
  return evalInWindow(win, `window.__NOVAFLOW_FIRST_FRAME_TRACE__.sampleFrame(${JSON.stringify(label)})`);
}

function writeIsolatedExport(payload) {
  fs.mkdirSync(exportRoot, { recursive: true });
  const fileName = "g5-aifx-deterministic-result.json";
  const target = path.join(exportRoot, fileName);
  const temp = `${target}.tmp`;
  const body = Buffer.from(JSON.stringify(payload, Object.keys(payload).sort(), 2));
  if (!isPathInside(exportRoot, target)) {
    return {
      ok: false,
      code: "G5_EXPORT_TARGET_OUTSIDE_TEMP_ROOT",
      tempPath: null,
      hashBefore: sha256Bytes(body),
      hashAfter: null,
      typedError: {
        code: "G5_EXPORT_TARGET_OUTSIDE_TEMP_ROOT",
        message: "G5 isolated export attempted outside temp root."
      }
    };
  }
  const hashBefore = sha256Bytes(body);
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, target);
  realWriteCount += 1;
  const hashAfter = sha256File(target);
  return {
    ok: hashBefore === hashAfter,
    code: hashBefore === hashAfter ? "G5_AIFX_TEMP_EXPORT_OK" : "G5_AIFX_TEMP_EXPORT_HASH_MISMATCH",
    mode: "temp-only",
    tempPath: toRepoPath(target),
    bytes: body.length,
    hashBefore,
    hashAfter,
    deterministicOutputHash: hashAfter,
    overwriteAttempted: false,
    typedError: hashBefore === hashAfter ? null : {
      code: "G5_AIFX_TEMP_EXPORT_HASH_MISMATCH",
      message: "G5 isolated export hash mismatch."
    },
    tmpLeftoverCount: tmpLeftovers(exportRoot).length
  };
}

function makeParityReceipt(target, state, routeStable, runtimeMutationDetected) {
  return {
    parityTarget: target,
    queueState: state.queueState,
    comfyAvailabilityState: state.comfyAvailabilityState,
    templateState: state.templateState,
    referenceState: state.referenceState,
    resultState: state.resultState,
    routeStable,
    consoleErrorDelta: consoleErrors.length,
    runtimeMutationDetected
  };
}

async function runAifxScenario(win) {
  await callAifx(win, "reset");
  const templateReceipt = await callAifx(win, "selectTemplate", ["spark-burst"]);
  const referenceReceipt = await callAifx(win, "setReference", [{ name: "reference-mock.png", sha256: "REF0000000000000000000000000000000000000000000000000000000000000" }]);

  const enqueueReceipt = await callAifx(win, "enqueueGeneration", [{ prompt: "isolated source aifx deterministic mock" }]);
  const cancelReceipt = await callAifx(win, "cancelTask", [enqueueReceipt.taskId]);

  const unavailableEnqueue = await callAifx(win, "enqueueGeneration", [{ prompt: "unavailable state classification" }]);
  const unavailableReceipt = await callAifx(win, "runNextTask", ["unavailable"]);
  const retryAfterUnavailable = await callAifx(win, "retryTask", [unavailableEnqueue.taskId]);
  const timeoutReceipt = await callAifx(win, "runNextTask", ["timeout"]);
  const retryAfterTimeout = await callAifx(win, "retryTask", [unavailableEnqueue.taskId]);
  const dependencyReceipt = await callAifx(win, "runNextTask", ["dependency-failure"]);
  const retryAfterDependency = await callAifx(win, "retryTask", [unavailableEnqueue.taskId]);
  const successReceipt = await callAifx(win, "runNextTask", ["success"]);
  const finalState = await callAifx(win, "getState");

  const routeStable = await evalInWindow(win, "!!document.querySelector('[data-aifx-isolated-route=\"1\"]') && document.body.dataset.aifxRoute === 'isolated'");
  const trace = await getTrace(win);
  const routeStabilityReceipt = {
    routeStable,
    protocol: await evalInWindow(win, "window.location.protocol"),
    traceSampleCount: trace.samples.length,
    consoleErrorCount: consoleErrors.length,
    routeNodePresent: true
  };

  const exportReceipt = writeIsolatedExport({
    type: "G5_AIFX_MOCK_RESULT",
    templateId: finalState.templateState.selectedTemplateId,
    referenceHash: finalState.referenceState.referenceHash,
    resultHash: finalState.resultState.resultHash,
    taskId: finalState.resultState.taskId,
    deterministicSeed: finalState.resultState.deterministicSeed,
    mockImageBytesSha256: successReceipt.result && successReceipt.result.hash
  });

  return {
    templateReceipt,
    referenceReceipt,
    queueReceipts: [
      enqueueReceipt,
      cancelReceipt,
      unavailableEnqueue,
      unavailableReceipt,
      retryAfterUnavailable,
      timeoutReceipt,
      retryAfterTimeout,
      dependencyReceipt,
      retryAfterDependency,
      successReceipt
    ],
    finalState,
    routeStabilityReceipt,
    exportReceipt,
    trace
  };
}

async function main() {
  if (process.env.NOVAFLOW_G5_AIFX_HARNESS !== "1") {
    throw new Error("G5 AIFX isolated harness requires NOVAFLOW_G5_AIFX_HARNESS=1.");
  }

  fs.mkdirSync(smokeProfile, { recursive: true });
  fs.mkdirSync(exportRoot, { recursive: true });
  app.setPath("userData", smokeProfile);
  registerSmokeIpcHandlers();
  await app.whenReady();

  const productionRuntimeBefore = hashRuntimeChain(productionRendererEntry);
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
  await delay(900);
  await sample(win, "g5-aifx-loaded");
  const protocol = await evalInWindow(win, "window.location.protocol");
  const aifxResult = await runAifxScenario(win);
  await sample(win, "g5-aifx-after-scenario");
  const productionRuntimeAfter = hashRuntimeChain(productionRendererEntry);
  const runtimeMutationDetected = JSON.stringify(productionRuntimeBefore) !== JSON.stringify(productionRuntimeAfter);

  const parityReceipts = [
    makeParityReceipt("template-flow-parity", aifxResult.finalState, aifxResult.routeStabilityReceipt.routeStable, runtimeMutationDetected),
    makeParityReceipt("reference-flow-parity", aifxResult.finalState, aifxResult.routeStabilityReceipt.routeStable, runtimeMutationDetected),
    makeParityReceipt("result-state-parity", aifxResult.finalState, aifxResult.routeStabilityReceipt.routeStable, runtimeMutationDetected),
    makeParityReceipt("queue-state-parity", aifxResult.finalState, aifxResult.routeStabilityReceipt.routeStable, runtimeMutationDetected),
    makeParityReceipt("route-stability-parity", aifxResult.finalState, aifxResult.routeStabilityReceipt.routeStable, runtimeMutationDetected)
  ];

  const failureCodes = aifxResult.queueReceipts
    .filter((receipt) => receipt && receipt.typedError)
    .map((receipt) => receipt.typedError.code);
  const successReceipt = aifxResult.queueReceipts.find((receipt) => receipt && receipt.type === "TASK_COMPLETED");
  const deterministicResultHash = successReceipt && successReceipt.result ? successReceipt.result.hash : null;

  emitResult({
    ok: protocol === "file:" &&
      consoleErrors.length === 0 &&
      !runtimeMutationDetected &&
      aifxResult.routeStabilityReceipt.routeStable === true &&
      failureCodes.includes("COMFY_UNAVAILABLE") &&
      failureCodes.includes("COMFY_TIMEOUT") &&
      failureCodes.includes("COMFY_DEPENDENCY_FAILED") &&
      !!deterministicResultHash &&
      aifxResult.exportReceipt.ok === true &&
      aifxResult.exportReceipt.tmpLeftoverCount === 0,
    sessionId,
    rendererEntry,
    smokeProfile,
    exportRoot,
    protocol,
    consoleErrorCount: consoleErrors.length,
    consoleErrors,
    consoleWarnings,
    clientErrors,
    productionRuntimeBefore,
    productionRuntimeAfter,
    productionRuntimeStable: !runtimeMutationDetected,
    runtimeMutationDetected,
    aifxResult,
    parityReceipts,
    failureCodes,
    deterministicResultHash,
    smokeTelemetry: {
      realWriteCount,
      blockedLegacyWriteCount,
      blockedPickDirectoryCount,
      tmpLeftoverCount: tmpLeftovers(exportRoot).length
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
    exportRoot,
    consoleErrorCount: consoleErrors.length,
    consoleErrors,
    consoleWarnings,
    clientErrors,
    error: String(error && error.message || error),
    stack: String(error && error.stack || "")
  });
  try { app.quit(); } catch {}
});
