#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const previewPath = "particle-editor/primary-entry-transition.preview.js";
const runtimePath = "particle-editor/novaflow-brand-runtime.js";

const previewSource = readFileSync(previewPath, "utf8");
const runtimeSource = readFileSync(runtimePath, "utf8");
const indexSource = readFileSync("particle-editor/index.html", "utf8");
const mainSource = readFileSync("particle-editor-desktop/main.js", "utf8");
const preloadSource = readFileSync("particle-editor-desktop/preload.js", "utf8");
const syncSource = readFileSync("scripts/sync-runtime.mjs", "utf8");
const syncCheckSource = readFileSync("scripts/check-runtime-sync.mjs", "utf8");
const buildSource = readFileSync("particle-editor-desktop/scripts/build-renderer.mjs", "utf8");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createPreviewHarness({ providers = [], decodes = [] } = {}) {
  let nextFrameId = 1;
  let now = 0;
  const frames = new Map();
  const hosts = [];
  const revokedUrls = [];

  class FakeHTMLElement {
    constructor() {
      this.attributes = new Map();
      this.isConnected = false;
      this.style = {};
      this.textContent = "";
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    removeAttribute(name) {
      this.attributes.delete(name);
    }

    append(...children) {
      this.children = [...(this.children || []), ...children];
    }

    attachShadow() {
      return { append() {} };
    }

    remove() {
      this.isConnected = false;
    }
  }

  class FakeImage extends FakeHTMLElement {
    decode() {
      const nextDecode = decodes.length ? decodes.shift() : Promise.resolve();
      return typeof nextDecode === "function" ? nextDecode() : nextDecode;
    }
  }

  const document = {
    activeElement: null,
    createElement(tagName) {
      if (tagName === "div") {
        const host = new FakeHTMLElement();
        hosts.push(host);
        return host;
      }
      if (tagName === "style") return new FakeHTMLElement();
      throw new Error(`Unexpected element: ${tagName}`);
    },
    documentElement: {
      append(host) {
        host.isConnected = true;
      }
    }
  };
  const window = {
    electronAPI: {
      windowCaptureContentFrame() {
        const provider = providers.shift();
        return typeof provider === "function" ? provider() : provider;
      }
    },
    requestAnimationFrame(callback) {
      const frameId = nextFrameId++;
      frames.set(frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(frameId) {
      frames.delete(frameId);
    },
    addEventListener() {},
    removeEventListener() {}
  };
  const context = {
    window,
    document,
    HTMLElement: FakeHTMLElement,
    Image: FakeImage,
    Blob: class FakeBlob {},
    URL: {
      createObjectURL: () => `blob:preview-${hosts.length + 1}`,
      revokeObjectURL: (url) => revokedUrls.push(url)
    },
    performance: {
      now() {
        now += 1;
        return now;
      }
    },
    ArrayBuffer,
    Uint8Array
  };
  vm.runInNewContext(previewSource, context, { filename: previewPath });

  return {
    api: window.NovaFlowPrimaryEntryTransitionPreview,
    hosts,
    revokedUrls,
    pendingFrameCount: () => frames.size,
    flushOneFrame() {
      const next = frames.entries().next();
      if (next.done) return false;
      const [frameId, callback] = next.value;
      frames.delete(frameId);
      callback(now + 1);
      return true;
    },
    flushAllFrames() {
      let flushed = 0;
      while (frames.size) {
        assert.ok(flushed < 20, "Preview release must not create an endless RAF chain");
        this.flushOneFrame();
        flushed += 1;
      }
      return flushed;
    }
  };
}

function validCapture() {
  return {
    ok: true,
    png: new Uint8Array([137, 80, 78, 71]),
    width: 1280,
    height: 720,
    captureMs: 4
  };
}

assert.match(
  previewSource,
  /attachShadow\(\{\s*mode:\s*["']closed["']\s*\}\)/,
  "The compositor frame must live in an isolated closed ShadowRoot"
);
assert.match(
  previewSource,
  /windowCaptureContentFrame/,
  "The Preview module must request the real Electron compositor frame"
);
assert.match(
  previewSource,
  /await image\.decode\(\)/,
  "The compositor image must decode before route replay can begin"
);
assert.match(
  previewSource,
  /new Blob\(\[.*png.*\][\s\S]*URL\.createObjectURL/,
  "The compositor frame must cross IPC as binary PNG and decode from an object URL"
);
assert.match(
  previewSource,
  /URL\.revokeObjectURL/,
  "The compositor object URL must be released with the Preview lifecycle"
);
assert.match(
  previewSource,
  /totalMs/,
  "Preview acceptance evidence must include the complete IPC and decode latency"
);
assert.match(
  previewSource,
  /data-novaflow-runtime-ignore/,
  "The Preview host must use Runtime's established mutation-ignore contract"
);
assert.match(
  previewSource,
  /pointerEvents:\s*["']auto["']/,
  "The frozen frame must block input to the hidden target page"
);
assert.match(
  previewSource,
  /document\.activeElement\.blur\(\)[\s\S]*addEventListener\(["']keydown["']/,
  "The frozen frame must also shield focus and keyboard activation"
);
assert.doesNotMatch(
  previewSource,
  /cloneNode|getComputedStyle|drawImage|toDataURL\(\)/,
  "The Preview module must not fall back to incomplete DOM, pseudo, or WebGL cloning"
);
assert.match(
  previewSource,
  /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame/,
  "A mounted target must receive two paint opportunities before preview release"
);
assert.doesNotMatch(
  previewSource,
  /setTimeout|setInterval/,
  "The Preview module must be paint-owned, not timer-owned"
);
assert.match(
  previewSource,
  /window\.NovaFlowPrimaryEntryTransitionPreview = Object\.freeze/,
  "The Preview module must expose one immutable browser API"
);
assert.match(
  previewSource,
  /isSupported:/,
  "Runtime must be able to distinguish browser preview from Electron capture failure"
);
assert.match(
  previewSource,
  /cancelPending/,
  "Route exit must cancel only in-flight capture without tearing down a scheduled release"
);
assert.match(
  previewSource,
  /snapshot:/,
  "Preview lifecycle must expose read-only capture/release evidence for acceptance"
);

assert.match(
  mainSource,
  /ipcMain\.handle\(["']window-capture-content-frame["']/,
  "Electron main must own one compositor capture IPC"
);
assert.match(
  mainSource,
  /BrowserWindow\.fromWebContents\(.*sender.*\)/,
  "Capture must be restricted to the invoking BrowserWindow"
);
assert.match(
  mainSource,
  /webContents\.capturePage\(\)/,
  "Capture must use Electron's compositor-backed webContents.capturePage()"
);
assert.match(
  mainSource,
  /capturedImage\.toPNG\(\)/,
  "Main must return an in-memory PNG buffer without base64 expansion or filesystem persistence"
);
assert.doesNotMatch(
  mainSource.slice(mainSource.indexOf('ipcMain.handle("window-capture-content-frame"'), mainSource.indexOf('ipcMain.handle("window-set-position"')),
  /toDataURL/,
  "The compositor IPC must not expand the full frame into a base64 data URL"
);
assert.match(
  mainSource,
  /windowCaptureContentFrameQueue[\s\S]*\.then\(runCapture,\s*runCapture\)/,
  "Compositor capture requests must be serialized per application window"
);
assert.match(
  preloadSource,
  /windowCaptureContentFrame:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(["']window-capture-content-frame["']\)/,
  "Preload must expose only the narrow capture method"
);

assert.doesNotMatch(
  runtimeSource,
  /startViewTransition|PRIMARY_ANIMATION_ENTRY_VIEW_|PRIMARY_ANIMATION_ENTRY_REPAINT_/,
  "Runtime must not retain the unreliable native compositor transition or repaint timers"
);
assert.match(
  runtimeSource,
  /NovaFlowPrimaryEntryTransitionPreview/,
  "Runtime must consume the dedicated Preview module"
);
assert.match(
  runtimeSource,
  /capturePrimaryAnimationEntryPreview/,
  "Runtime must retain compositor capture for non-Art Animation entry replay"
);
assert.match(
  runtimeSource,
  /releasePrimaryAnimationEntryPreviewAfterPaint/,
  "Runtime must release the frozen source only after the mounted commit"
);
assert.match(
  runtimeSource,
  /PRIMARY_ANIMATION_ENTRY_REPLAY_PROMISE/,
  "Concurrent Animation clicks must share one asynchronous capture/replay"
);
assert.match(
  runtimeSource,
  /PRIMARY_ANIMATION_ENTRY_REPLAY_TOKEN/,
  "Route-token ownership must reject stale Animation replay work"
);
assert.match(
  runtimeSource,
  /PRIMARY_ANIMATION_ENTRY_REPLAY_SERIAL/,
  "A canceled capture must not cancel or occupy a newer transaction that reuses the same route token"
);
assert.match(
  runtimeSource,
  /PRIMARY_ANIMATION_ENTRY_ROLLBACK_PENDING/,
  "Rollback must retain the compositor frame until the saved source owner is mounted"
);
assert.match(
  runtimeSource,
  /tryReleasePrimaryAnimationEntryRollbackPreview/,
  "The existing Runtime observer must release rollback through source readiness evidence"
);
assert.match(
  runtimeSource,
  /artGenerateMode:[\s\S]*ART_GENERATE_STATE\.mode/,
  "Rollback evidence must preserve the Art Generate mode"
);
assert.match(
  runtimeSource,
  /artGenerateRestoreRequested[\s\S]*activateArtGenerate\(pending\.sourceEvidence\?\.artGenerateMode\)/,
  "Rollback must restore the saved Art Generate owner before releasing the compositor frame"
);

const rollbackStart = runtimeSource.indexOf("function rollbackPrimaryAnimationEntryTransaction");
const rollbackEnd = runtimeSource.indexOf("\n  function ", rollbackStart + 1);
const rollbackBody = runtimeSource.slice(rollbackStart, rollbackEnd);
assert.doesNotMatch(
  rollbackBody,
  /releasePrimaryAnimationEntryPreviewAfterPaint/,
  "Rollback must not release immediately after sourceButton.click()"
);

const replayStart = runtimeSource.indexOf("function replayPrimaryAnimationEntryIntent");
assert.ok(replayStart >= 0, "Runtime must have one replay dispatcher");
const replayEnd = runtimeSource.indexOf("\n  function ", replayStart + 1);
const replayBody = runtimeSource.slice(replayStart, replayEnd);
const nativeReplayStart = runtimeSource.indexOf("function executePrimaryAnimationEntryNativeReplay");
const nativeReplayEnd = runtimeSource.indexOf("\n  function ", nativeReplayStart + 1);
const nativeReplayBody = runtimeSource.slice(nativeReplayStart, nativeReplayEnd);
const activationCaptureStart = runtimeSource.indexOf("function bindPrimaryEntryActivationCapture");
assert.ok(activationCaptureStart >= 0, "Runtime must have one primary activation capture owner");
const activationCaptureEnd = runtimeSource.indexOf("\n  function ", activationCaptureStart + 1);
const activationCaptureBody = runtimeSource.slice(activationCaptureStart, activationCaptureEnd);
assert.ok(
  replayBody.indexOf("isPrimaryAnimationEntryTransactionPending(PRIMARY_SWITCH_TOKEN)") >= 0 &&
  replayBody.indexOf("isPrimaryAnimationEntryTransactionPending(PRIMARY_SWITCH_TOKEN)") < replayBody.indexOf("PRIMARY_ANIMATION_ENTRY_REPLAY_PROMISE"),
  "A bound browser-fallback transaction must swallow repeated Animation intent before recursive replay"
);
assert.match(
  activationCaptureBody,
  /replayPrimaryAnimationEntryIntent\(\s*button\s*,\s*\{\s*bypassPreview:\s*sourceIndex\s*===\s*2\s*\}\s*\)/,
  "Only Art source index 2 may request the no-Preview Animation entry path"
);
const bypassStart = replayBody.indexOf("if (bypassPreview)");
const pendingStart = replayBody.indexOf("const pending = (async () =>", Math.max(0, bypassStart));
assert.ok(bypassStart >= 0, "Replay must expose one explicit Art Preview-bypass branch");
assert.ok(pendingStart > bypassStart, "Art Preview bypass must complete before the asynchronous capture path begins");
const bypassBody = replayBody.slice(bypassStart, pendingStart);
const previewReplayBody = replayBody.slice(pendingStart);
assert.doesNotMatch(
  bypassBody,
  /capturePrimaryAnimationEntryPreview|PRIMARY_ANIMATION_ENTRY_REPLAY_PROMISE/,
  "Art Preview bypass must not capture or allocate asynchronous replay ownership"
);
assert.ok(
  bypassBody.indexOf("executePrimaryAnimationEntryNativeReplay") >= 0 &&
    bypassBody.indexOf("armGeometryGuard: true") > bypassBody.indexOf("executePrimaryAnimationEntryNativeReplay"),
  "Art Preview bypass must arm the target-only geometry guard before its native click"
);
assert.ok(
  nativeReplayBody.indexOf("preparePrimaryAnimationEntryReplayIntent") >= 0 &&
    nativeReplayBody.indexOf("preparePrimaryAnimationEntryReplayIntent") < nativeReplayBody.indexOf("button.click()"),
  "Art Preview bypass must prepare source cleanup before its single native click"
);
assert.ok(
  previewReplayBody.indexOf("capturePrimaryAnimationEntryPreview") >= 0 &&
    previewReplayBody.indexOf("capturePrimaryAnimationEntryPreview") < previewReplayBody.indexOf("executePrimaryAnimationEntryNativeReplay"),
  "Non-Art replay must capture the frozen source before cleanup or route replay"
);
assert.ok(
  previewReplayBody.indexOf("armGeometryGuard: !previewSupported") >= 0 &&
    nativeReplayBody.indexOf("holdPrimaryAnimationEntryGeometrySurface") >= 0 &&
    nativeReplayBody.indexOf("holdPrimaryAnimationEntryGeometrySurface") < nativeReplayBody.indexOf("button.click()"),
  "Browser fallback must arm the target-only guard before click while supported Preview capture skips it"
);
assert.ok(
  nativeReplayBody.indexOf("replaySerial === PRIMARY_ANIMATION_ENTRY_TRANSACTION_SERIAL") >= 0 &&
    nativeReplayBody.indexOf("cancelPrimaryAnimationEntryTransaction(null, reason)") >= 0 &&
    nativeReplayBody.indexOf("releasePrimaryAnimationEntryGeometrySurfaceHold(replaySerial)") >= 0,
  "Non-Art source-owned cleanup must happen only after the frozen source exists"
);

const previewScriptIndex = indexSource.indexOf("primary-entry-transition.preview.js");
const bridgeScriptIndex = indexSource.indexOf("primary-entry-transition.bridge.js");
const runtimeScriptIndex = indexSource.indexOf("novaflow-brand-runtime.js");
assert.ok(previewScriptIndex >= 0, "index.html must load the Preview module");
assert.ok(
  previewScriptIndex < bridgeScriptIndex && bridgeScriptIndex < runtimeScriptIndex,
  "Preview and transaction state must load before Runtime"
);

for (const [label, source] of [
  ["Runtime sync", syncSource],
  ["Runtime sync check", syncCheckSource],
  ["clean renderer build", buildSource]
]) {
  assert.match(source, /primary-entry-transition\.preview\.js/, `${label} must ship the Preview module`);
}

{
  const harness = createPreviewHarness({
    providers: [validCapture(), validCapture()]
  });
  const firstHandle = await harness.api.capture();
  assert.ok(firstHandle?.isActive(), "Initial capture must return one active Preview handle");
  assert.equal(firstHandle.releaseAfterPaint("first-owner-mounted"), true);
  assert.equal(harness.flushOneFrame(), true, "Release must schedule its second paint frame");
  assert.equal(harness.pendingFrameCount(), 1);

  const reacquiredHandle = await harness.api.capture();
  assert.equal(reacquiredHandle, firstHandle, "An active Preview host must be reused rather than recaptured");
  assert.equal(
    harness.api.snapshot().phase,
    "frozen",
    "Reacquiring a releasing Preview must restore frozen ownership evidence"
  );
  assert.equal(
    harness.pendingFrameCount(),
    0,
    "Reacquiring after the first paint must cancel the old owner's second release frame"
  );
  assert.equal(harness.flushAllFrames(), 0);
  assert.equal(harness.api.hasActive(), true, "An old release callback must not remove a reacquired handle");
  assert.equal(harness.hosts[0].isConnected, true);

  assert.equal(reacquiredHandle.releaseAfterPaint("final-owner-mounted"), true);
  assert.equal(harness.flushAllFrames(), 2, "The final owner must still release after exactly two paints");
  assert.equal(harness.api.hasActive(), false);
  assert.equal(harness.hosts[0].isConnected, false);
  assert.equal(harness.api.snapshot().phase, "released");
  assert.equal(harness.api.snapshot().reason, "final-owner-mounted");

  const clearHandle = await harness.api.capture();
  assert.ok(clearHandle?.isActive());
  assert.equal(clearHandle.releaseAfterPaint("pending-release"), true);
  assert.equal(harness.api.clear("forced-clear"), true, "clear() must synchronously remove an active handle");
  assert.equal(harness.pendingFrameCount(), 0, "clear() must cancel any pending release frame");
  assert.equal(harness.flushAllFrames(), 0);
  assert.equal(harness.api.hasActive(), false);
  assert.equal(harness.hosts[1].isConnected, false);
  assert.equal(harness.api.snapshot().phase, "released");
  assert.equal(harness.api.snapshot().reason, "forced-clear");
  assert.equal(harness.revokedUrls.length, 2, "Each removed Preview must release its object URL once");
}

{
  const staleProvider = createDeferred();
  const harness = createPreviewHarness({
    providers: [() => staleProvider.promise, validCapture()]
  });
  const staleCapture = harness.api.capture();
  assert.equal(harness.api.cancelPending("provider-superseded"), true);
  const currentHandle = await harness.api.capture();
  assert.ok(currentHandle?.isActive());
  const currentSnapshot = harness.api.snapshot();
  assert.equal(currentSnapshot.phase, "frozen");

  staleProvider.reject(new Error("stale provider failed"));
  assert.equal(await staleCapture, null);
  assert.equal(
    harness.api.snapshot().phase,
    "frozen",
    "A stale provider rejection must not overwrite a newer frozen snapshot"
  );
  assert.equal(harness.api.snapshot().generation, currentSnapshot.generation);
  assert.equal(harness.api.snapshot().reason, currentSnapshot.reason);
  harness.api.clear("provider-test-cleanup");
}

{
  const staleDecode = createDeferred();
  const decodeStarted = createDeferred();
  const harness = createPreviewHarness({
    providers: [validCapture(), validCapture()],
    decodes: [
      () => {
        decodeStarted.resolve();
        return staleDecode.promise;
      },
      Promise.resolve()
    ]
  });
  const staleCapture = harness.api.capture();
  await decodeStarted.promise;
  assert.equal(harness.api.cancelPending("decode-superseded"), true);
  const currentHandle = await harness.api.capture();
  assert.ok(currentHandle?.isActive());
  const currentSnapshot = harness.api.snapshot();
  assert.equal(currentSnapshot.phase, "frozen");

  staleDecode.reject(new Error("stale decode failed"));
  assert.equal(await staleCapture, null);
  assert.equal(
    harness.api.snapshot().phase,
    "frozen",
    "A stale decode rejection must not overwrite a newer frozen snapshot"
  );
  assert.equal(harness.api.snapshot().generation, currentSnapshot.generation);
  assert.equal(harness.api.snapshot().reason, currentSnapshot.reason);
  harness.api.clear("decode-test-cleanup");
}

assert.match(
  previewSource,
  /activeHandle\.reacquire\(\)/,
  "capture() must explicitly reacquire a still-connected Preview before returning it"
);
assert.doesNotMatch(
  previewSource,
  /\b(?:ref|retain|lease)Count\b/i,
  "Preview ownership must use cancellation-based reacquire rather than reference counting"
);

console.log("PASS primary Animation entry Preview contract");
